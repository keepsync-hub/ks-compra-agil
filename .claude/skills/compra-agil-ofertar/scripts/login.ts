/**
 * Login a mercadopublico.cl vía ClaveÚnica + 2FA, guardando storageState.json para reutilizar
 * la sesión entre corridas. El código de 2FA se lee de Gmail vía mcp__Gmail__* — este script
 * corre standalone y NO tiene acceso al MCP de Gmail, así que expone `esperarCodigo2fa` para
 * que el agente (que sí tiene el MCP) lo complete de forma interactiva. Ver "Handshake con
 * Gmail" más abajo.
 *
 * ADVERTENCIA DE ESTADO: en la sesión donde se escribió este script, tanto
 * https://claveunica.gob.cl como https://www.mercadopublico.cl devolvieron
 * ERR_CONNECTION_RESET para Chromium headless (Playwright), mientras que `curl` con el mismo
 * User-Agent llegó sin problema (200/302). Es decir, hay algún bloqueo a nivel de fingerprint
 * de navegador/WAF que no se pudo diagnosticar más a fondo en ese entorno. Antes de confiar en
 * este script:
 *   1. Correr `npm run login -- --diagnostico` y confirmar que la navegación llega a la página
 *      de ClaveÚnica sin ERR_CONNECTION_RESET.
 *   2. Si persiste el bloqueo, probar con `headless: false` (requiere entorno con display) o
 *      desde la máquina del usuario en vez de este sandbox — no es un problema del código, es
 *      el portal rechazando la conexión antes de que el código pueda hacer nada.
 * Los selectores de ClaveÚnica de abajo (`#uname`, `#pword`) son los históricamente estables de
 * ese formulario (usados por prácticamente todo el Estado), pero no se pudieron verificar en
 * vivo en esta sesión — confirmarlos contra la página real antes del primer uso real.
 */
import { chromium, type Browser, type Page } from "playwright";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { ROOT_DIR } from "../../../../src/lib/config.js";
import "dotenv/config";

const STORAGE_STATE_PATH = path.join(ROOT_DIR, "data", "storageState.json");
const CLAVE_UNICA_LOGIN_SELECTORS = {
  run: "#uname",
  clave: "#pword",
  submit: "button[type='submit']",
  // El campo de 2FA de ClaveÚnica pide el código enviado por correo/SMS; el id exacto varía
  // según la campaña — buscar por atributos accesibles (aria-label / placeholder) como respaldo.
  codigo2fa: "input[name='otp'], input[aria-label*='código' i], input[placeholder*='código' i]",
};

export interface Login2faHandshake {
  /** Llamado cuando la página de login pide el código de 2FA; debe devolver el código leído de Gmail. */
  esperarCodigo2fa: (contexto: { emailDestino?: string }) => Promise<string>;
}

async function diagnosticoConectividad(browser: Browser): Promise<boolean> {
  const page = await browser.newPage();
  let ok = true;
  for (const url of ["https://claveunica.gob.cl", "https://www.mercadopublico.cl/CompraAgil"]) {
    try {
      const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
      console.log(`  ${url} -> HTTP ${resp?.status()}`);
    } catch (err) {
      console.error(`  ${url} -> BLOQUEADO: ${(err as Error).message.split("\n")[0]}`);
      ok = false;
    }
  }
  await page.close();
  return ok;
}

export async function login(handshake: Login2faHandshake): Promise<void> {
  const run = process.env.CLAVE_UNICA_RUN;
  const clave = process.env.CLAVE_UNICA_CLAVE;
  if (!run || !clave) {
    throw new Error("Faltan CLAVE_UNICA_RUN / CLAVE_UNICA_CLAVE en .env — no se puede iniciar sesión.");
  }

  const browser = await chromium.launch({ headless: true, executablePath: "/opt/pw-browsers/chromium" });
  try {
    const conectividadOk = await diagnosticoConectividad(browser);
    if (!conectividadOk) {
      throw new Error(
        "El portal rechazó la conexión (ver log arriba). Esto es un bloqueo del portal, no un error del " +
          "script — DETENERSE y pedir intervención humana en vez de reintentar a ciegas (ver guardrails en CLAUDE.md).",
      );
    }

    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
      locale: "es-CL",
    });
    const page = await context.newPage();

    await page.goto("https://www.mercadopublico.cl/CompraAgil", { waitUntil: "domcontentloaded" });
    // TODO(verificar en vivo): nombre exacto del botón/link de login e ir a ClaveÚnica.
    await page.getByRole("link", { name: /iniciar sesión|ingresar/i }).first().click({ timeout: 15000 });

    await page.waitForURL(/claveunica\.gob\.cl/, { timeout: 20000 });
    await page.locator(CLAVE_UNICA_LOGIN_SELECTORS.run).fill(run);
    await page.locator(CLAVE_UNICA_LOGIN_SELECTORS.clave).fill(clave);
    await page.locator(CLAVE_UNICA_LOGIN_SELECTORS.submit).click();

    await detectarCaptchaOBloqueo(page);

    const pidioCodigo = await page
      .locator(CLAVE_UNICA_LOGIN_SELECTORS.codigo2fa)
      .first()
      .isVisible({ timeout: 15000 })
      .catch(() => false);
    if (pidioCodigo) {
      const codigo = await handshake.esperarCodigo2fa({});
      await page.locator(CLAVE_UNICA_LOGIN_SELECTORS.codigo2fa).first().fill(codigo);
      await page.keyboard.press("Enter");
    }

    await page.waitForURL(/mercadopublico\.cl/, { timeout: 30000 });
    await detectarCaptchaOBloqueo(page);

    mkdirSync(path.dirname(STORAGE_STATE_PATH), { recursive: true });
    await context.storageState({ path: STORAGE_STATE_PATH });
    console.log(`Sesión guardada en ${STORAGE_STATE_PATH}`);
  } finally {
    await browser.close();
  }
}

async function detectarCaptchaOBloqueo(page: Page): Promise<void> {
  const html = await page.content();
  if (/captcha/i.test(html)) {
    throw new Error("CAPTCHA detectado. DETENERSE — pedir intervención humana, no reintentar a ciegas.");
  }
}

export function tieneSesionGuardada(): boolean {
  return existsSync(STORAGE_STATE_PATH);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (process.argv.includes("--diagnostico")) {
    const browser = await chromium.launch({ headless: true, executablePath: "/opt/pw-browsers/chromium" });
    console.log("Diagnóstico de conectividad al portal:");
    const ok = await diagnosticoConectividad(browser);
    await browser.close();
    console.log(ok ? "\nOK: el portal es alcanzable desde este navegador." : "\nBLOQUEADO: ver mensajes arriba.");
    process.exitCode = ok ? 0 : 1;
  } else {
    console.error(
      "Este script expone login() para ser llamado por el agente (que sí tiene acceso al MCP de Gmail " +
        "para leer el código de 2FA). Ejecutarlo directo solo sirve para --diagnostico.",
    );
    process.exitCode = 1;
  }
}
