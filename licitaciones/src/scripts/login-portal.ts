/**
 * Login a mercadopublico.cl para dejar una sesión de proveedor reutilizable en
 * `data/storageState.json` — el artefacto que `adjuntos-navegador.ts` usa para descargar los
 * archivos adjuntos de una licitación (ver "Acceso a los antecedentes" en `licitaciones/PLAN.md`).
 *
 *   npm run login-portal -- --diagnostico   # NO usa credenciales: solo reporta qué formulario hay
 *   npm run login-portal                    # login real (requiere las variables de entorno)
 *
 * Variables de entorno (nunca hardcodear, nunca commitear — `.env` está gitignored):
 *   MP_USUARIO  identificador de la cuenta de Mercado Público
 *   MP_CLAVE    contraseña de esa cuenta
 *
 * VERIFICADO el 2026-08-19: el portal **sí tiene credencial propia**, contra lo que se había
 * concluido antes al ver que `mercadopublico.cl/portal/login.aspx` redirige al Home. El botón
 * "Iniciar Sesión" del Home llama a `keycloak.login()` y lleva a `heimdall.mercadopublico.cl`
 * (Keycloak, realm `mercadopublico`), cuyo formulario pide usuario y contraseña del portal —
 * `#username-re`, `#password-re`, `#kc-login-re`— y no muestra reCAPTCHA. O sea: para esto NO
 * hace falta la credencial de Clave\u00danica (identidad nacional), basta la cuenta del portal.
 *
 * ── Handshake del código 2FA ────────────────────────────────────────────────────────────────
 *
 * Este script corre standalone y NO tiene acceso a MCP, así que no puede leer el correo por su
 * cuenta. Cuando el formulario pide el segundo factor:
 *   1. escribe `licitaciones/data/2fa-solicitado.json` (marca de "necesito el código ahora"),
 *   2. queda esperando a que aparezca `licitaciones/data/2fa-codigo.txt`,
 *   3. lo lee, lo usa y lo borra.
 * El agente —que sí tiene el MCP de n8n con la credencial de Gmail— lee el correo de
 * `no-reply@digital.gob.cl` y escribe ese archivo. Así el código nunca queda en el historial de
 * comandos ni en una variable de entorno.
 *
 * ── Estado ──────────────────────────────────────────────────────────────────────────────────
 *
 * NO VERIFICADO contra un login real: se escribió sin credenciales disponibles. Lo que sí está
 * verificado en este entorno (2026-08-19): `claveunica.gob.cl` responde 200 desde acá — el
 * `ERR_CONNECTION_RESET` que `login.ts` documentaba como "bloqueo de fingerprint/WAF" era en
 * realidad TLS 1.3 contra el proxy, y con `--ssl-version-max=tls1.2` navega normal (ver
 * `CHROMIUM_EXTRA_ARGS`). También está verificado que los selectores que asumía `login.ts`
 * (`#uname`, `#pword`) NO existen en la página actual. Por eso acá los campos se buscan por varias
 * estrategias y `--diagnostico` reporta cuál pegó, sin necesidad de credenciales.
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
const CODIGO_2FA = path.join(DATA_DIR, "2fa-codigo.txt");

/**
 * El login no tiene una URL directa estable: el Home dispara `keycloak.login()`, que arma la URL de
 * autorización con su `client_id`, `redirect_uri` y `state`. Por eso se entra por el Home y se hace
 * clic, en vez de hardcodear una URL de Keycloak que quedaría inválida.
 */
const URL_HOME = "https://www.mercadopublico.cl/Home";
const TEXTO_BOTON_LOGIN = /Iniciar Sesi/i;

/**
 * Cada campo se busca por varias estrategias porque el formulario de ClaveÚnica cambia de markup
 * entre campañas y se renderiza por JS. La primera que exista gana; `--diagnostico` reporta cuál.
 */
const CANDIDATOS = {
  usuario: ["#username-re", 'input[name="username"]', 'input[placeholder*="Identificador" i]', "#uname"],
  clave: ["#password-re", 'input[name="password"]', 'input[type="password"]', "#pword"],
  enviar: ["#kc-login-re", 'input[type="submit"][name="login"]', 'button[type="submit"]', 'input[type="submit"]'],
  codigo2fa: [
    'input[name="otp"]',
    'input[name="codigo"]',
    'input[autocomplete="one-time-code"]',
    'input[aria-label*="código" i]',
    'input[placeholder*="código" i]',
    'input[maxlength="6"]',
  ],
};

const ESPERA_FORMULARIO_MS = 30_000;
const ESPERA_CODIGO_MS = 5 * 60_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function abrirNavegador(visible: boolean): Promise<Browser> {
  const extra = process.env.CHROMIUM_EXTRA_ARGS?.split(" ").filter(Boolean) ?? [];
  return chromium.launch({
    headless: !visible,
    executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined,
    proxy: process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined,
    args: ["--no-sandbox", ...extra],
  });
}

/** Primer selector de la lista que exista en la página, o null. */
async function primerSelectorPresente(page: Page, candidatos: string[], esperaMs = 0): Promise<string | null> {
  const limite = Date.now() + esperaMs;
  do {
    for (const selector of candidatos) {
      if ((await page.locator(selector).count()) > 0) return selector;
    }
    if (esperaMs > 0) await sleep(500);
  } while (Date.now() < limite);
  return null;
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

/** Home → clic en "Iniciar Sesión" → formulario de Keycloak. */
async function irAlFormulario(page: Page): Promise<void> {
  await page.goto(URL_HOME, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await sleep(3000);
  await page.locator("a,button").filter({ hasText: TEXTO_BOTON_LOGIN }).first().click();
  await page.waitForLoadState("domcontentloaded").catch(() => {});
  await sleep(6000);
}

async function diagnostico(page: Page): Promise<void> {
  await irAlFormulario(page);
  console.log(`  URL tras el redirect: ${page.url()}`);
  for (const [campo, candidatos] of Object.entries(CANDIDATOS)) {
    const encontrado = await primerSelectorPresente(page, candidatos);
    console.log(`  ${campo.padEnd(10)} → ${encontrado ?? "NINGUNO de los candidatos existe"}`);
  }
  const html = await page.content();
  console.log(`  ¿reCAPTCHA en el login? ${/recaptcha/i.test(html)}`);
  console.log(`\n  Diagnóstico sin credenciales. Si algún campo dice NINGUNO, hay que actualizar CANDIDATOS.`);
}

async function login(page: Page, usuario: string, clave: string): Promise<void> {
  await irAlFormulario(page);

  const selUsuario = await primerSelectorPresente(page, CANDIDATOS.usuario, ESPERA_FORMULARIO_MS);
  const selClave = await primerSelectorPresente(page, CANDIDATOS.clave, 5000);
  if (!selUsuario || !selClave) {
    throw new Error(
      `No se encontró el formulario de login en ${page.url()} (usuario: ${selUsuario ?? "no"}, clave: ${selClave ?? "no"}). ` +
        `Correr con --diagnostico y actualizar CANDIDATOS en este archivo.`,
    );
  }
  await page.fill(selUsuario, usuario);
  await page.fill(selClave, clave);
  console.log(`  Formulario completado (${selUsuario} / ${selClave}). Enviando…`);

  const selEnviar = await primerSelectorPresente(page, CANDIDATOS.enviar, 5000);
  if (selEnviar) await page.click(selEnviar);
  else await page.keyboard.press("Enter");
  await page.waitForLoadState("domcontentloaded").catch(() => {});
  await sleep(4000);

  const selCodigo = await primerSelectorPresente(page, CANDIDATOS.codigo2fa, 15_000);
  if (selCodigo) {
    const codigo = await esperarCodigo2fa();
    await page.fill(selCodigo, codigo);
    const selEnviar2 = await primerSelectorPresente(page, CANDIDATOS.enviar, 5000);
    if (selEnviar2) await page.click(selEnviar2);
    else await page.keyboard.press("Enter");
    await page.waitForLoadState("domcontentloaded").catch(() => {});
    await sleep(5000);
  } else {
    console.log("  (El portal no pidió segundo factor en esta sesión.)");
  }

  if (/heimdall|claveunica|accounts\./i.test(page.url())) {
    throw new Error(
      `Después del login la página sigue en ${page.url()}: las credenciales o el código no fueron aceptados. ` +
        `No se reintenta — revisar a mano antes de volver a correr (ClaveÚnica bloquea por intentos fallidos).`,
    );
  }
  console.log(`  Sesión establecida. URL final: ${page.url().slice(0, 90)}`);
}

async function main(): Promise<void> {
  const soloDiagnostico = process.argv.includes("--diagnostico");
  const visible = process.argv.includes("--visible");

  const usuario = process.env.MP_USUARIO;
  const clave = process.env.MP_CLAVE;
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
      await diagnostico(page);
      return;
    }
    await login(page, usuario!, clave!);
    mkdirSync(path.dirname(STORAGE_STATE_PATH), { recursive: true });
    await contexto.storageState({ path: STORAGE_STATE_PATH });
    console.log(`  → sesión guardada en ${path.relative(process.cwd(), STORAGE_STATE_PATH)}`);
    console.log(`  Ahora: npm run adjuntos-licitacion -- <codigo>`);
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
