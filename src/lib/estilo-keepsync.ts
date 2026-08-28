import { readFileSync, mkdtempSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Page } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Identidad visual única de KeepSync para cualquier PDF de cotización que este repo genera —
 * licencias Claude (`cotizacion-html.ts`), cursos (`capacitacion-cotizacion.ts`), Array
 * (`array-cotizacion.ts`) y licitaciones (`licitaciones/src/lib/cotizacion-html.ts`) importaban
 * los mismos nueve colores, el mismo logo y el mismo arranque de Chromium copiados y pegados en
 * cuatro archivos — cualquier retoque de marca (o bug del renderizador) había que aplicarlo cuatro
 * veces y ya se habían empezado a desalinear (`ok` solo existía en la de cursos). Este módulo es
 * ahora la única fuente: quien construya un PDF nuevo para KeepSync importa de acá en vez de
 * copiar un archivo existente. Ver la skill `ks-comun:ks-skill-keepsync-pdf` de la libreria
 * (keepsync-hub/ks-skill-hub).
 */
export const LOGO_KEEPSYNC_PATH = path.join(__dirname, "..", "assets", "logo-keepsync-blanco.png");

export function logoKeepsyncBase64(): string {
  return readFileSync(LOGO_KEEPSYNC_PATH).toString("base64");
}

export const PALETA_KEEPSYNC = {
  bg: "#0E0E17",
  card: "#161527",
  cardAlt: "#1D1B33",
  border: "#2A2844",
  accent: "#786CF0",
  accentLight: "#B4AAFA",
  white: "#FFFFFF",
  gray: "#9A9FB0",
  warn: "#FB7185",
  ok: "#34D399",
} as const;

export const MESES_ES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

export function mesAnoEs(fecha: Date): string {
  return `${MESES_ES[fecha.getMonth()]} de ${fecha.getFullYear()}`;
}

export function formatoClp(n: number): string {
  return "$" + Math.round(n).toLocaleString("es-CL");
}

export function escaparHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * El CSS exacto que comparten las cotizaciones de 4 láminas (licencias Claude, Array,
 * licitaciones): página apaisada de 11.69×8.27in, una `.slide` por página con `page-break-after`,
 * y el mismo vocabulario de componentes (`.card`, `.badge`, tabla, `.info-row`, `.totales`,
 * `.footer`). La cotización de cursos (`capacitacion-cotizacion.ts`) usa una variante más densa
 * (más láminas, menos padding, componentes propios como `.kpi`/`.mod`) y no la reutiliza — pero
 * comparte igual la paleta, el logo y el renderizador de más abajo.
 */
export function cssLaminasKeepsync(color: typeof PALETA_KEEPSYNC = PALETA_KEEPSYNC): string {
  return `
  @page { size: 11.69in 8.27in; margin: 0; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: Arial, "Segoe UI", sans-serif; background: ${color.bg}; color: ${color.white}; }
  .slide { width: 11.69in; height: 8.27in; padding: 0.7in; position: relative; page-break-after: always; overflow: hidden; }
  .slide:last-child { page-break-after: auto; }
  .gray { color: ${color.gray}; }
  .accent { color: ${color.accentLight}; }
  h1 { font-size: 30pt; margin: 0 0 8pt; }
  h2 { font-size: 20pt; margin: 0 0 8pt; }
  .card { background: ${color.card}; border: 1px solid ${color.border}; border-radius: 10px; padding: 14pt 16pt; }
  .badge {
    position: absolute; top: 0.35in; right: 0.35in; background: ${color.warn}; color: ${color.white};
    font-size: 9pt; font-weight: bold; padding: 6pt 12pt; border-radius: 20px;
  }
  table { width: 100%; border-collapse: collapse; font-size: 11pt; }
  th, td { text-align: left; padding: 8pt 10pt; }
  th { color: ${color.gray}; font-size: 9pt; text-transform: uppercase; background: ${color.cardAlt}; }
  td.c, th.c { text-align: center; }
  td.r, th.r { text-align: right; }
  .info-row { display: flex; gap: 10pt; font-size: 11pt; padding: 4pt 0; }
  .info-row .lbl { width: 140pt; color: ${color.gray}; font-weight: bold; font-size: 9pt; }
  .grid3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10pt; margin-top: 14pt; }
  .grid2 { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10pt; margin-top: 14pt; }
  .num-badge { width: 26pt; height: 26pt; border-radius: 50%; background: ${color.accent}; display: flex; align-items: center; justify-content: center; font-weight: bold; margin-bottom: 8pt; }
  .check { color: ${color.accent}; font-weight: bold; margin-right: 6pt; }
  .totales { margin-top: 10pt; font-size: 12pt; }
  .totales .fila { display: flex; justify-content: space-between; padding: 4pt 0; }
  .totales .total { background: ${color.accent}; border-radius: 8px; padding: 8pt 14pt; font-size: 15pt; font-weight: bold; margin-top: 6pt; }
  .footer { position: absolute; bottom: 0.4in; left: 0.7in; right: 0.7in; font-size: 9pt; color: ${color.gray}; }
  ul.cond { margin: 8pt 0 0; padding-left: 16pt; font-size: 10.5pt; color: ${color.gray}; }
  ul.cond li { margin-bottom: 4pt; }`;
}

// Chromium: el entorno manda. En esta máquina vive en /opt/pw-browsers; en un runner de CI no
// existe esa ruta y hay que dejar que Playwright use el que instaló. Misma convención que
// licitaciones/src/scripts/login-portal.ts.
const CHROMIUM_PATH =
  process.env.CHROMIUM_EXECUTABLE_PATH ||
  (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);

/**
 * Abre el HTML de una cotización en Chromium headless (Playwright) y le entrega la página a `fn`
 * para que haga lo que necesite (imprimir a PDF, medir desbordes de lámina, ambas cosas). Encapsula
 * el bootstrap que las cuatro cotizaciones repetían: escribir el HTML a un archivo temporal (un PDF
 * no se puede imprimir desde un string en memoria, Playwright necesita navegar a una URL),
 * lanzar/cerrar el navegador y limpiar el directorio temporal pase lo que pase.
 */
export async function conPaginaHtml<T>(
  html: string,
  prefijoTmp: string,
  fn: (page: Page) => Promise<T>,
): Promise<T> {
  const tmpDir = mkdtempSync(path.join(tmpdir(), prefijoTmp));
  const tmpHtmlPath = path.join(tmpDir, "cotizacion.html");
  writeFileSync(tmpHtmlPath, html, "utf-8");

  const browser = await chromium.launch({ headless: true, executablePath: CHROMIUM_PATH });
  try {
    const page = await browser.newPage();
    await page.goto(`file://${tmpHtmlPath}`, { waitUntil: "networkidle" });
    return await fn(page);
  } finally {
    await browser.close();
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

/**
 * Genera el PDF final renderizando HTML con Chromium (Playwright), no convirtiendo un .pptx con
 * LibreOffice: `soffice` no funciona en este entorno (falla incluso al convertir un .txt vacío —
 * diagnosticado con strace, no es un problema del archivo). Tamaño carta apaisado (11.69×8.27in,
 * A4 landscape), sin márgenes — cada `.slide` del HTML ya trae su propio padding.
 */
export async function renderizarPdfDesdeHtml(
  html: string,
  outputPdfPath: string,
  prefijoTmp = "keepsync-pdf-",
): Promise<void> {
  await conPaginaHtml(html, prefijoTmp, (page) =>
    page.pdf({
      path: outputPdfPath,
      width: "11.69in",
      height: "8.27in",
      printBackground: true,
      margin: { top: "0in", bottom: "0in", left: "0in", right: "0in" },
    }),
  );
}
