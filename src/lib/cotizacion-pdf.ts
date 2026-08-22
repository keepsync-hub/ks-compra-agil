import { mkdtempSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { generarCotizacionHtml } from "./cotizacion-html.js";
import type { CotizacionPptxData } from "./cotizacion-pptx.js";

// Chromium: el entorno manda. En esta máquina vive en /opt/pw-browsers; en un runner de CI no
// existe esa ruta y hay que dejar que Playwright use el que instaló. Misma convención que
// licitaciones/src/scripts/login-portal.ts.
const CHROMIUM_PATH =
  process.env.CHROMIUM_EXECUTABLE_PATH ||
  (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);

/**
 * Genera el PDF final de la cotización renderizando HTML con Chromium (Playwright), no
 * convirtiendo el .pptx con LibreOffice: `soffice` no funciona en este entorno (falla incluso
 * al convertir un .txt vacío — diagnosticado con strace, no es un problema del archivo). Este
 * PDF es el artefacto que se publica; el .pptx se conserva como fuente editable.
 */
export async function generarCotizacionPdf(data: CotizacionPptxData, outputPdfPath: string): Promise<void> {
  const html = generarCotizacionHtml(data);
  const tmpDir = mkdtempSync(path.join(tmpdir(), "cotizacion-"));
  const tmpHtmlPath = path.join(tmpDir, "cotizacion.html");
  writeFileSync(tmpHtmlPath, html, "utf-8");

  const browser = await chromium.launch({ headless: true, executablePath: CHROMIUM_PATH });
  try {
    const page = await browser.newPage();
    await page.goto(`file://${tmpHtmlPath}`, { waitUntil: "networkidle" });
    await page.pdf({
      path: outputPdfPath,
      width: "11.69in",
      height: "8.27in",
      printBackground: true,
      margin: { top: "0in", bottom: "0in", left: "0in", right: "0in" },
    });
  } finally {
    await browser.close();
    rmSync(tmpDir, { recursive: true, force: true });
  }
}
