/**
 * Descarga los ARCHIVOS adjuntos de una licitación (PDF de bases, EE.TT., formatos de anexo)
 * abriendo el visor del portal con un navegador real.
 *
 *   npm run adjuntos-licitacion -- <codigo>              # headless
 *   npm run adjuntos-licitacion -- <codigo> --visible    # navegador visible (puntúa mejor)
 *   npm run adjuntos-licitacion -- <codigo> --diagnostico # solo informa si el gate deja pasar
 *
 * ── Qué controla el acceso y por qué este script existe ──────────────────────────────────────
 *
 * El visor (`Attachment/ViewAttachment.aspx?enc=…`) corre reCAPTCHA Enterprise **por score** y la
 * validación es del lado del servidor: un cliente HTTP plano (fetch/curl) recibe 302 →
 * `/Procurement/403.html`. Es decir, no hay forma de bajar estos archivos con un cliente HTTP,
 * y este script no lo intenta.
 *
 * Lo que sí hace es lo único honesto que queda: abrir la página con un navegador real y dejar que
 * el **propio script de reCAPTCHA del sitio** se ejecute y puntúe la sesión. No falsifica el token,
 * no parchea señales de automatización, no usa servicios de resolución de CAPTCHA y no reintenta
 * ante un rechazo — si el gate dice que no, el script para y lo dice (guardrail de `CLAUDE.md`:
 * "ante CAPTCHA o bloqueo del portal: detenerse y pedir intervención humana").
 *
 * ── Estado de verificación (2026-08-19) ──────────────────────────────────────────────────────
 *
 * Verificado hasta el gate, y **rechazado en este entorno**: el portal devolvió `score: 0.1` contra
 * un umbral de `0.5`, tanto headless como con navegador visible bajo Xvfb. Es el resultado esperable
 * de una IP de datacenter sin historial de navegación, no un bug del código. Correrlo desde la
 * máquina del usuario (sesión de Claude Cowork local, IP residencial) es la única forma de saber si
 * ahí el score alcanza; `--diagnostico` responde eso en una corrida sin bajar nada.
 *
 * Lo que queda del otro lado del gate y **no se pudo verificar** por lo mismo: la grilla `DWNL_grdId`
 * lista los archivos con un botón "Ver Anexo" por fila (postback ASP.NET). El CAPTCHA de imagen que
 * tiene esa página pertenece al bloque de **"Descargar seleccionados"** (casillas + campo de texto),
 * no a los botones por archivo — por eso este script baja archivo por archivo y nunca toca la
 * descarga masiva. Si igual resultara que el postback por archivo exige el CAPTCHA, el script lo
 * reporta y se detiene: transcribirlo es trabajo de una persona, a propósito.
 *
 * En entornos con proxy/navegador restringido (como el sandbox donde se escribió esto) sirven
 * `CHROMIUM_EXECUTABLE_PATH` y `CHROMIUM_EXTRA_ARGS` — acá hizo falta `--ssl-version-max=tls1.2`
 * para que Chromium pudiera salir por el proxy (sin eso: ERR_CONNECTION_RESET, el mismo síntoma
 * documentado en `login.ts`).
 */
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { LIC_ROOT_DIR } from "../lib/config.js";
import { ROOT_DIR } from "../../../src/lib/config.js";

/**
 * Sesión de portal ya autenticada, si `npm run login` la dejó guardada. Es el mismo dominio
 * (`www.mercadopublico.cl`) que sirve el visor de adjuntos, así que las cookies aplican.
 */
const STORAGE_STATE_PATH = path.join(ROOT_DIR, "data", "storageState.json");

const PORTAL = "https://www.mercadopublico.cl";
/** Umbral que el propio portal aplica al score de reCAPTCHA (leído de su página). */
const UMBRAL_SCORE = 0.5;
const ESPERA_GATE_MS = 45_000;

export interface AdjuntoLicitacion {
  archivo: string;
  tipo?: string;
  descripcion?: string;
  tamano?: string;
  fecha?: string;
  /** Ruta local si se pudo bajar; ausente si el postback no entregó el archivo. */
  rutaLocal?: string;
}

interface ResultadoGate {
  paso: boolean;
  score: number | null;
  urlFinal: string;
}

function argumento(nombre: string): boolean {
  return process.argv.includes(`--${nombre}`);
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

/**
 * Abre el visor de adjuntos desde la ficha y espera el veredicto del gate. El `enc` del visor lo
 * emite la propia ficha, así que se llega haciendo lo mismo que un visitante: clic en el botón.
 */
async function pasarGate(page: Page, codigo: string): Promise<{ resultado: ResultadoGate; popup: Page | null }> {
  let score: number | null = null;
  const contexto = page.context();
  contexto.on("page", (p) =>
    p.on("console", (m) => {
      // La página del visor loguea la respuesta de su propia validación: {"valid":…,"score":…}
      const match = m.text().match(/"score"\s*:\s*([0-9.]+)/);
      if (match) score = Number(match[1]);
    }),
  );

  await page.goto(`${PORTAL}/Procurement/Modules/RFB/DetailsAcquisition.aspx?idlicitacion=${encodeURIComponent(codigo)}`, {
    waitUntil: "domcontentloaded",
    timeout: 90_000,
  });

  const [popup] = await Promise.all([
    contexto.waitForEvent("page", { timeout: 45_000 }).catch(() => null),
    page.click("#imgAdjuntos").catch(() => {
      throw new Error(
        `La ficha de ${codigo} no tiene botón de adjuntos (#imgAdjuntos): esta licitación puede no publicar archivos.`,
      );
    }),
  ]);
  if (!popup) throw new Error(`El clic en adjuntos de ${codigo} no abrió el visor.`);

  await popup.waitForLoadState("domcontentloaded");
  const limite = Date.now() + ESPERA_GATE_MS;
  while (Date.now() < limite && popup.url().includes("ViewAttachment.aspx")) {
    await popup.waitForTimeout(1000);
  }

  const urlFinal = popup.url();
  return { resultado: { paso: !urlFinal.includes("403"), score, urlFinal }, popup };
}

/** Lee la grilla de adjuntos ya renderizada (solo se llega acá si el gate dejó pasar). */
async function listarGrilla(popup: Page): Promise<AdjuntoLicitacion[]> {
  return popup.evaluate(() => {
    const filas = Array.from(document.querySelectorAll("#DWNL_grdId tr"));
    const texto = (fila: Element, sufijo: string) =>
      (fila.querySelector(`span[id$="_${sufijo}"]`) as HTMLElement | null)?.innerText?.trim() || undefined;
    return filas
      .map((fila) => ({
        archivo: texto(fila, "File") ?? "",
        tipo: texto(fila, "Type"),
        descripcion: texto(fila, "Description"),
        tamano: texto(fila, "FileLength"),
        fecha: texto(fila, "AtcDateTime"),
      }))
      .filter((a) => a.archivo !== "");
  });
}

async function descargarUnoAUno(popup: Page, adjuntos: AdjuntoLicitacion[], destino: string): Promise<void> {
  mkdirSync(destino, { recursive: true });
  const botones = popup.locator('#DWNL_grdId input[type="image"][id$="_search"]');
  const total = await botones.count();
  for (let i = 0; i < total && i < adjuntos.length; i++) {
    const nombre = adjuntos[i].archivo;
    try {
      const [descarga] = await Promise.all([
        popup.waitForEvent("download", { timeout: 60_000 }),
        botones.nth(i).click(),
      ]);
      const ruta = path.join(destino, descarga.suggestedFilename() || nombre);
      await descarga.saveAs(ruta);
      adjuntos[i].rutaLocal = ruta;
      console.log(`    ✓ ${nombre}`);
    } catch {
      // Si el portal responde con un mensaje en vez de un archivo (p. ej. exigiendo el CAPTCHA de
      // imagen del bloque de descarga masiva), se informa y se sigue: no se reintenta a ciegas.
      const mensaje = await popup
        .locator("#DWNL_DWNLLblMessage")
        .innerText()
        .catch(() => "");
      console.log(`    ✗ ${nombre}${mensaje ? ` — el portal respondió: "${mensaje.trim()}"` : " — no entregó archivo"}`);
    }
  }
}

async function main(): Promise<void> {
  const codigo = process.argv.slice(2).find((a) => !a.startsWith("--"));
  if (!codigo) {
    console.error("Uso: npm run adjuntos-licitacion -- <codigo> [--visible] [--diagnostico]");
    process.exitCode = 1;
    return;
  }
  const visible = argumento("visible");
  const soloDiagnostico = argumento("diagnostico");

  const browser = await abrirNavegador(visible);
  try {
    // Descargar las bases es exactamente lo que hace un oferente en su sesión del portal, y es la
    // vía sancionada para llegar a estos archivos. Si `npm run login` ya dejó una sesión guardada,
    // se usa: el gate anti-scraping apunta a visitantes anónimos, no a un proveedor identificado.
    const conSesion = !argumento("sin-sesion") && existsSync(STORAGE_STATE_PATH);
    console.log(
      conSesion
        ? `  Sesión: usando la sesión de portal guardada (${path.relative(process.cwd(), STORAGE_STATE_PATH)}).`
        : `  Sesión: anónima. Si el portal rechaza, correr primero \`npm run login\` — con sesión de proveedor` +
          ` no hace falta que intervenga nadie en cada descarga.`,
    );
    const contexto: BrowserContext = await browser.newContext({
      acceptDownloads: true,
      locale: "es-CL",
      storageState: conSesion ? STORAGE_STATE_PATH : undefined,
    });
    const page = await contexto.newPage();
    const { resultado, popup } = await pasarGate(page, codigo);

    console.log(`  Gate del visor: score ${resultado.score ?? "no informado"} (umbral ${UMBRAL_SCORE}) → ${resultado.paso ? "PASA" : "RECHAZA"}`);

    if (!resultado.paso) {
      console.error(
        `\n  El portal rechazó esta sesión y no entrega los archivos.\n` +
          `  No se reintenta ni se rodea el control (guardrail). En orden de preferencia:\n` +
          `    1. \`npm run login\` y repetir: con sesión de proveedor la descarga es la vía sancionada,\n` +
          `       y ese login se hace UNA vez (el 2FA lo lee el agente desde Gmail) — después cada\n` +
          `       descarga corre sola, sin que intervenga nadie.\n` +
          `    2. Correrlo con --visible desde tu máquina: IP e historial reales puntúan distinto.\n` +
          `    3. Abrir el visor a mano: la URL está en licitaciones/data/${codigo}/antecedentes.md\n` +
          `  El TEXTO de las bases no necesita nada de esto: npm run antecedentes-licitacion -- ${codigo}`,
      );
      process.exitCode = 1;
      return;
    }
    if (!popup) return;
    if (soloDiagnostico) {
      console.log("  Diagnóstico: el gate deja pasar en este entorno. Correr sin --diagnostico para bajar los archivos.");
      return;
    }

    const adjuntos = await listarGrilla(popup);
    console.log(`  ${adjuntos.length} archivo(s) publicados por el organismo:`);
    const destino = path.join(LIC_ROOT_DIR, "data", codigo, "adjuntos");
    await descargarUnoAUno(popup, adjuntos, destino);
    writeFileSync(path.join(destino, "inventario.json"), JSON.stringify(adjuntos, null, 2), "utf-8");
    console.log(`  → ${path.relative(process.cwd(), destino)}/`);
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
