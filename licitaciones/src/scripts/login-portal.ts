/**
 * Login a mercadopublico.cl para dejar una sesión de proveedor reutilizable en
 * `data/storageState.json` — el artefacto que `adjuntos-navegador.ts` usa para descargar los
 * archivos adjuntos de una licitación (ver "Acceso a los antecedentes" en `licitaciones/PLAN.md`).
 *
 *   npm run login-portal -- --diagnostico   # NO usa credenciales: solo reporta qué formulario hay
 *   npm run login-portal                    # login real (requiere las variables de entorno)
 *   npm run login-portal -- --ruta extranjero   # fuerza la pestaña "Extranjero" del portal
 *
 * Variables de entorno (nunca hardcodear, nunca commitear — `.env` está gitignored):
 *   MP_USUARIO  RUN del titular de la ClaveÚnica (o el identificador de la cuenta Extranjero)
 *   MP_CLAVE    su contraseña
 *
 * ── Qué autentica realmente el portal (VERIFICADO el 2026-08-19, en el navegador) ────────────
 *
 * El botón "Iniciar Sesión" del Home llama a `keycloak.login()` y lleva a
 * `heimdall.mercadopublico.cl` (Keycloak, realm `mercadopublico`). Esa página tiene DOS pestañas:
 *
 *   • **ClaveÚnica** (`#liClaveUnica`, la activa): un solo enlace, `#zocial-oidc`, que federa a
 *     `accounts.claveunica.gob.cl`. Es la ruta de cualquier proveedor con RUN chileno.
 *   • **Extranjero** (`#liExtranjero`, oculta hasta hacer clic): ahí —y solo ahí— viven
 *     `#username-re` / `#password-re` / `#kc-login-re`, para oferentes sin RUN.
 *
 * Esto corrige la conclusión con la que se escribió la primera versión de este archivo ("el portal
 * tiene credencial propia, no hace falta ClaveÚnica"): el formulario de usuario y contraseña que se
 * había encontrado en el HTML **existe pero está oculto**, es el de la pestaña Extranjero, y por eso
 * `page.fill('#username-re')` moría con "element is not visible". Para un RUN chileno la única
 * puerta es ClaveÚnica.
 *
 * También corrige la afirmación de que los selectores del viejo `login.ts` ya no existían:
 * `#uname` y `#pword` **sí** son los campos vigentes de ClaveÚnica; el envío es `#login-submit`
 * (un `<button type="button">` que la propia página procesa por JS: cifra la clave en el campo
 * oculto `#password-encoded` antes de enviar, así que hay que hacerle clic, no un submit del form).
 * La página de ClaveÚnica no muestra reCAPTCHA.
 *
 * ── El paso intermedio que hay entre la clave y el código ───────────────────────────────────
 *
 * Aceptada la clave, ClaveÚnica NO manda el correo todavía: muestra "ClaveÚnica necesita validar tu
 * identidad · Te enviaremos un código de 6 dígitos a tu correo registrado" con un botón
 * **Continuar**. Recién ese clic dispara el envío. Sin darlo, la sesión se queda en esa pantalla —
 * que desde afuera se parece a un rechazo de credenciales, y así se malinterpretó la primera
 * corrida real.
 *
 * ── Handshake del código 2FA ────────────────────────────────────────────────────────────────
 *
 * Este script corre standalone y NO tiene acceso a MCP, así que no puede leer el correo por su
 * cuenta. Cuando el formulario pide el segundo factor:
 *   1. escribe `licitaciones/data/2fa-solicitado.json` (marca de "necesito el código ahora"),
 *   2. queda esperando a que aparezca `licitaciones/data/2fa-codigo.txt`,
 *   3. lo lee, lo usa y lo borra.
 * El agente —que sí tiene el MCP con la credencial de Gmail— lee el correo de
 * `no-reply@digital.gob.cl` y escribe ese archivo. Así el código nunca queda en el historial de
 * comandos ni en una variable de entorno.
 *
 * ── Entorno ─────────────────────────────────────────────────────────────────────────────────
 *
 * `CHROMIUM_EXECUTABLE_PATH` y `CHROMIUM_EXTRA_ARGS` existen para sandboxes con proxy: acá hizo
 * falta `--ssl-version-max=tls1.2` para que Chromium saliera por el proxy (sin eso:
 * ERR_CONNECTION_RESET, el síntoma que `login.ts` documentaba como "bloqueo de WAF" sin serlo).
 */
import { chromium, type Browser, type Page } from "playwright";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { LIC_ROOT_DIR } from "../lib/config.js";
import { ROOT_DIR } from "../../../src/lib/config.js";
import "dotenv/config";

const STORAGE_STATE_PATH = path.join(ROOT_DIR, "data", "storageState.json");
const DATA_DIR = path.join(LIC_ROOT_DIR, "data");
const MARCA_2FA = path.join(DATA_DIR, "2fa-solicitado.json");
const EVIDENCIA_PNG = path.join(DATA_DIR, "login-fallido.png");
const EVIDENCIA_TXT = path.join(DATA_DIR, "login-fallido.txt");
const CODIGO_2FA = path.join(DATA_DIR, "2fa-codigo.txt");

/**
 * El login no tiene una URL directa estable: el Home dispara `keycloak.login()`, que arma la URL de
 * autorización con su `client_id`, `state`, `nonce` y `code_challenge`. Por eso se entra por el Home
 * y se hace clic, en vez de hardcodear una URL de Keycloak que quedaría inválida.
 */
const URL_HOME = "https://www.mercadopublico.cl/Home";
const TEXTO_BOTON_LOGIN = /Iniciar Sesi/i;

type Ruta = "claveunica" | "extranjero";

/**
 * Un juego de selectores por ruta. Cada campo se busca por varias estrategias porque ambos
 * formularios cambian de markup entre campañas; `--diagnostico` reporta cuál pegó.
 */
const CANDIDATOS: Record<Ruta, { usuario: string[]; clave: string[]; enviar: string[] }> = {
  claveunica: {
    usuario: ["#uname", 'input[name="run"]', '#login-form input[type="text"]'],
    clave: ["#pword", '#login-form input[type="password"]'],
    // `#login-submit` es type="button": la página cifra la clave por JS antes de enviar el form.
    enviar: ["#login-submit", '#login-form button:not([type="button"])', '#login-form button'],
  },
  extranjero: {
    usuario: ["#username-re", 'input[name="username"]', 'input[placeholder*="Identificador" i]'],
    clave: ["#password-re", 'input[name="password"][type="password"]'],
    enviar: ["#kc-login-re", 'input[type="submit"][name="login"]', 'button[type="submit"]'],
  },
};

/**
 * Entre la clave y el código hay una pantalla intermedia: "ClaveÚnica necesita validar tu
 * identidad · Te enviaremos un código de 6 dígitos a tu correo registrado" con un botón
 * **Continuar**. El correo NO se envía hasta que se hace ese clic — la primera corrida real murió
 * acá: dio por rechazada una sesión que en realidad estaba esperando esta confirmación.
 */
const TEXTO_CONTINUAR = /Continuar|Enviar código|Validar/i;

const CANDIDATOS_2FA = [
  'input[name="otp"]',
  'input[name="codigo"]',
  'input[name="code"]',
  'input[autocomplete="one-time-code"]',
  'input[aria-label*="código" i]',
  'input[placeholder*="código" i]',
  'input[maxlength="6"]',
  "#codigo",
  "input.gob-input-code",
];

/** Algunas pantallas parten el código en seis casillas de un dígito. */
const CANDIDATO_2FA_DIGITOS = 'input[maxlength="1"]';

/** Pestaña ClaveÚnica: no tiene formulario, tiene un enlace que federa a accounts.claveunica.gob.cl. */
const ENLACE_CLAVEUNICA = "#zocial-oidc";
/** Pestaña Extranjero: hay que abrirla para que su formulario se haga visible. */
const PESTANA_EXTRANJERO = "#liExtranjero";

const ESPERA_FORMULARIO_MS = 30_000;
const ESPERA_CODIGO_MS = 5 * 60_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Un RUN chileno (con o sin puntos/guión) va por ClaveÚnica; cualquier otro identificador, no. */
export function rutaSegunUsuario(usuario: string | undefined): Ruta {
  return usuario && /^\s*\d{1,3}(\.?\d{3})*-?[\dkK]\s*$/.test(usuario) ? "claveunica" : "extranjero";
}

/**
 * Playwright incluye el valor del `fill` en el log de sus errores (`fill("…")`). Sin esto, una clave
 * podría terminar en consola o en un log de CI.
 */
function sinSecretos(texto: string, secretos: (string | undefined)[]): string {
  return secretos.filter(Boolean).reduce<string>((acc, s) => acc.split(s as string).join("«oculto»"), texto);
}

async function abrirNavegador(visible: boolean): Promise<Browser> {
  const extra = process.env.CHROMIUM_EXTRA_ARGS?.split(" ").filter(Boolean) ?? [];
  return chromium.launch({
    headless: !visible,
    executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined,
    proxy: process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined,
    args: ["--no-sandbox", ...extra],
  });
}

/** Primer selector de la lista que exista **y esté visible**, o null. */
async function primerSelectorVisible(page: Page, candidatos: string[], esperaMs = 0): Promise<string | null> {
  const limite = Date.now() + esperaMs;
  do {
    for (const selector of candidatos) {
      if (await page.locator(selector).first().isVisible().catch(() => false)) return selector;
    }
    if (esperaMs > 0) await sleep(500);
  } while (Date.now() < limite);
  return null;
}

/**
 * Texto que la página de login muestra SIEMPRE, gane o falle el intento. Se descuenta del texto
 * visible para quedarse con el mensaje de rechazo, que ClaveÚnica no marca con ninguna clase
 * distintiva: lo escribe como un párrafo más ("Usuario no encontrado", "Datos incorrectos"…).
 */
const RUIDO_LOGIN =
  /^(Mercado Público|Ingresa tu RUN|Ingresa tu ClaveÚnica|visibility|Recupera tu ClaveÚnica|Solicita tu ClaveÚnica|INGRESA|¿Necesitas ayuda\?|Colabora:|Administra:|Servicio de autenticación ClaveÚnica®|Gobierno de Chile|ClaveÚnica|Extranjero|Contraseña|Ingresar Ahora)$/i;

/** El mensaje con el que el sitio explica el rechazo, si lo hay. */
async function mensajeDeRechazo(page: Page): Promise<string> {
  const texto = await page.evaluate("document.body.innerText").catch(() => "");
  return String(texto ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 3 && l.length < 160 && !RUIDO_LOGIN.test(l))
    .slice(0, 2)
    .join(" | ");
}

/**
 * Un rechazo cuesta un intento contra una cuenta que se bloquea, así que se guarda lo que se vio:
 * sin evidencia, la única forma de diagnosticar es reintentar, que es justo lo que no hay que hacer.
 */
async function dejarEvidencia(page: Page): Promise<void> {
  mkdirSync(DATA_DIR, { recursive: true });
  await page.screenshot({ path: EVIDENCIA_PNG, fullPage: true }).catch(() => {});
  const texto = await page.evaluate("document.body.innerText").catch(() => "");
  writeFileSync(EVIDENCIA_TXT, `URL: ${page.url()}\n\n${String(texto ?? "")}`, "utf-8");
}

/**
 * Hace clic en el "Continuar" de la pantalla de validación de identidad, que es lo que dispara el
 * envío del correo con el código. Si esa pantalla no aparece, no hace nada: hay cuentas y sesiones
 * que van directo al campo del código.
 */
async function confirmarEnvioDelCodigo(page: Page): Promise<boolean> {
  const boton = page.locator("button, a, input[type='submit']").filter({ hasText: TEXTO_CONTINUAR }).first();
  if (!(await boton.isVisible().catch(() => false))) return false;
  console.log("  Pantalla de validación de identidad: confirmando el envío del código al correo…");
  await boton.click();
  await page.waitForLoadState("domcontentloaded").catch(() => {});
  await sleep(4000);
  return true;
}

/** Escribe el código en un campo único o repartido en casillas de un dígito. */
async function escribirCodigo(page: Page, codigo: string): Promise<void> {
  const casillas = page.locator(CANDIDATO_2FA_DIGITOS);
  const cuantas = await casillas.count().catch(() => 0);
  if (cuantas >= codigo.length) {
    for (const [i, digito] of [...codigo].entries()) {
      await casillas.nth(i).click();
      await casillas.nth(i).pressSequentially(digito, { delay: 60 });
    }
    return;
  }
  const selector = await primerSelectorVisible(page, CANDIDATOS_2FA, 5000);
  if (!selector) throw new Error("Desapareció el campo del código antes de poder escribirlo.");
  await escribir(page, selector, codigo);
}

/**
 * Escribe tecla por tecla, no con `fill`. VERIFICADO el 2026-08-19: el botón "INGRESA" de
 * ClaveÚnica nace `disabled` y su página lo habilita escuchando eventos de teclado; `page.fill()`
 * deja el valor puesto pero el botón deshabilitado para siempre (así murió la primera corrida real,
 * con un timeout de 30 s sobre `#login-submit` — sin llegar a enviar credencial alguna).
 */
async function escribir(page: Page, selector: string, valor: string): Promise<void> {
  const campo = page.locator(selector).first();
  await campo.click();
  await campo.fill("");
  await campo.pressSequentially(valor, { delay: 40 });
}

/**
 * Espera el código que escribe el agente tras leer el correo. No lo pide por stdin a propósito:
 * esta corrida puede ser no interactiva.
 */
async function esperarCodigo2fa(): Promise<string> {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(
    MARCA_2FA,
    JSON.stringify({ solicitadoEn: new Date().toISOString(), remitenteEsperado: "no-reply@digital.gob.cl" }, null, 2),
    "utf-8",
  );
  console.log(
    `\n  El portal pidió el código de doble factor.\n` +
      `  Esperando a que aparezca ${path.relative(process.cwd(), CODIGO_2FA)} (hasta 5 min).\n` +
      `  El agente lo obtiene del correo de no-reply@digital.gob.cl y lo escribe ahí.\n`,
  );
  const limite = Date.now() + ESPERA_CODIGO_MS;
  while (Date.now() < limite) {
    if (existsSync(CODIGO_2FA)) {
      const codigo = readFileSync(CODIGO_2FA, "utf-8").trim();
      // Se borra apenas se lee: un código de un solo uso no debe quedar en disco.
      rmSync(CODIGO_2FA, { force: true });
      rmSync(MARCA_2FA, { force: true });
      if (codigo) return codigo;
    }
    await sleep(2000);
  }
  rmSync(MARCA_2FA, { force: true });
  throw new Error("No llegó el código de 2FA en 5 minutos. No se reintenta a ciegas.");
}

/** Home → clic en "Iniciar Sesión" → página de Keycloak con las dos pestañas. */
async function irAKeycloak(page: Page): Promise<void> {
  await page.goto(URL_HOME, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await sleep(3000);
  await page.locator("a,button").filter({ hasText: TEXTO_BOTON_LOGIN }).first().click();
  await page.waitForLoadState("domcontentloaded").catch(() => {});
  await sleep(6000);
}

/** Desde Keycloak, deja la página en el formulario que corresponde a la ruta pedida. */
async function irAlFormulario(page: Page, ruta: Ruta): Promise<void> {
  await irAKeycloak(page);
  if (ruta === "claveunica") {
    await page.click(ENLACE_CLAVEUNICA, { timeout: 15_000 });
    await page.waitForLoadState("domcontentloaded").catch(() => {});
    await sleep(6000);
  } else {
    // La pestaña Extranjero existe en el DOM desde el principio, pero su formulario está oculto.
    await page.click(PESTANA_EXTRANJERO, { timeout: 15_000 });
    await sleep(1500);
  }
}

async function diagnostico(page: Page, ruta: Ruta): Promise<void> {
  await irAlFormulario(page, ruta);
  console.log(`  Ruta: ${ruta}`);
  console.log(`  URL del formulario: ${page.url().slice(0, 110)}`);
  for (const [campo, candidatos] of Object.entries(CANDIDATOS[ruta])) {
    const encontrado = await primerSelectorVisible(page, candidatos, campo === "usuario" ? 10_000 : 0);
    console.log(`  ${campo.padEnd(8)} → ${encontrado ?? "NINGUNO de los candidatos está visible"}`);
  }
  const html = await page.content();
  console.log(`  ¿reCAPTCHA en el login? ${/recaptcha/i.test(html)}`);
  console.log(`\n  Diagnóstico sin credenciales. Si algún campo dice NINGUNO, hay que actualizar CANDIDATOS.`);
}

export type RutaLogin = Ruta;

/**
 * Deja `page` con la sesión iniciada. Se exporta porque `adjuntos-navegador.ts` necesita hacer el
 * login **en el mismo contexto** en que después abre el visor: la sesión del portal no sobrevive a
 * `storageState.json` (el token del SPA vive en memoria, no en cookies restaurables).
 */
export async function login(page: Page, ruta: Ruta, usuario: string, clave: string): Promise<void> {
  await irAlFormulario(page, ruta);

  const selUsuario = await primerSelectorVisible(page, CANDIDATOS[ruta].usuario, ESPERA_FORMULARIO_MS);
  const selClave = await primerSelectorVisible(page, CANDIDATOS[ruta].clave, 5000);
  if (!selUsuario || !selClave) {
    throw new Error(
      `No se encontró el formulario de login (ruta ${ruta}) en ${page.url().slice(0, 90)} ` +
        `(usuario: ${selUsuario ?? "no"}, clave: ${selClave ?? "no"}). ` +
        `Correr con --diagnostico y actualizar CANDIDATOS en este archivo.`,
    );
  }
  await escribir(page, selUsuario, usuario);
  await escribir(page, selClave, clave);
  console.log(`  Formulario completado (${selUsuario} / ${selClave}). Enviando…`);

  const selEnviar = await primerSelectorVisible(page, CANDIDATOS[ruta].enviar, 5000);
  if (selEnviar) await page.click(selEnviar);
  else await page.keyboard.press("Enter");
  await page.waitForLoadState("domcontentloaded").catch(() => {});
  await sleep(5000);

  const huboConfirmacion = await confirmarEnvioDelCodigo(page);
  const hayCasillas = (await page.locator(CANDIDATO_2FA_DIGITOS).count().catch(() => 0)) >= 6;
  const selCodigo = hayCasillas ? CANDIDATO_2FA_DIGITOS : await primerSelectorVisible(page, CANDIDATOS_2FA, 20_000);
  if (selCodigo) {
    const codigo = await esperarCodigo2fa();
    await escribirCodigo(page, codigo);
    // El botón de envío del código no es el mismo del formulario de clave: suele decir "Continuar".
    const botonCodigo = page.locator("button, a, input[type='submit']").filter({ hasText: TEXTO_CONTINUAR }).first();
    if (await botonCodigo.isVisible().catch(() => false)) await botonCodigo.click();
    else {
      const selEnviar2 = await primerSelectorVisible(page, CANDIDATOS[ruta].enviar, 5000);
      if (selEnviar2) await page.click(selEnviar2);
      else await page.keyboard.press("Enter");
    }
    await page.waitForLoadState("domcontentloaded").catch(() => {});
    await sleep(8000);
  } else if (huboConfirmacion) {
    await dejarEvidencia(page);
    throw new Error(
      "Se confirmó el envío del código pero no apareció el campo donde escribirlo. " +
        `Evidencia: ${path.relative(process.cwd(), EVIDENCIA_PNG)} y .txt`,
    );
  } else {
    console.log("  (El portal no pidió segundo factor en esta sesión.)");
  }

  if (/heimdall|claveunica|accounts\./i.test(page.url())) {
    const aviso = await mensajeDeRechazo(page);
    await dejarEvidencia(page);
    throw new Error(
      `Después del login la página sigue en ${page.url().slice(0, 90)}: las credenciales o el código no fueron ` +
        `aceptados${aviso ? `. El sitio dice: "${aviso}"` : " (el sitio no mostró un mensaje reconocible)"}.\n` +
        `  Evidencia: ${path.relative(process.cwd(), EVIDENCIA_PNG)} y .txt\n` +
        `  No se reintenta — ClaveÚnica bloquea la cuenta por intentos fallidos: revisar la credencial antes de` +
        ` volver a correr.`,
    );
  }
  console.log(`  Sesión establecida. URL final: ${page.url().slice(0, 90)}`);
}

async function main(): Promise<void> {
  const soloDiagnostico = process.argv.includes("--diagnostico");
  const visible = process.argv.includes("--visible");

  const usuario = process.env.MP_USUARIO;
  const clave = process.env.MP_CLAVE;

  const posRuta = process.argv.indexOf("--ruta");
  const rutaPedida = posRuta === -1 ? undefined : process.argv[posRuta + 1];
  const ruta: Ruta =
    rutaPedida === "claveunica" || rutaPedida === "extranjero" ? rutaPedida : rutaSegunUsuario(usuario);

  if (!soloDiagnostico && (!usuario || !clave)) {
    console.error(
      "Faltan MP_USUARIO y/o MP_CLAVE en el entorno (ponerlas en .env, que está gitignored).\n" +
        "Para revisar el formulario sin credenciales: npm run login-portal -- --diagnostico",
    );
    process.exitCode = 1;
    return;
  }

  const browser = await abrirNavegador(visible);
  try {
    const contexto = await browser.newContext({ locale: "es-CL" });
    const page = await contexto.newPage();
    if (soloDiagnostico) {
      await diagnostico(page, ruta);
      return;
    }
    console.log(`  Ruta de autenticación: ${ruta}${rutaPedida ? " (forzada)" : " (deducida del identificador)"}`);
    await login(page, ruta, usuario!, clave!);
    mkdirSync(path.dirname(STORAGE_STATE_PATH), { recursive: true });
    await contexto.storageState({ path: STORAGE_STATE_PATH });
    console.log(`  → sesión guardada en ${path.relative(process.cwd(), STORAGE_STATE_PATH)}`);
    console.log(`  Ahora: npm run adjuntos-licitacion -- <codigo>`);
  } finally {
    await browser.close();
  }
}

// Solo corre el flujo completo cuando se invoca directamente; importado, exporta `login`.
if (process.argv[1] && /login-portal\.[tj]s$/.test(process.argv[1])) {
  main().catch((err) => {
    const mensaje = err instanceof Error ? err.message : String(err);
    console.error(sinSecretos(mensaje, [process.env.MP_CLAVE, process.env.MP_USUARIO]));
    process.exitCode = 1;
  });
}

export { sinSecretos };
