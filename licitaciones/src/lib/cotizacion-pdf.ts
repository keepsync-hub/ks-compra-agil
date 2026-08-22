import { mkdtempSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { generarCotizacionHtml } from "./cotizacion-html.js";
import type { CotizacionLicitacionData } from "./cotizacion-pptx.js";

// Chromium: el entorno manda. En esta máquina vive en /opt/pw-browsers; en un runner de CI no
// existe esa ruta y hay que dejar que Playwright use el que instaló. Misma convención que
// licitaciones/src/scripts/login-portal.ts.
const CHROMIUM_PATH =
  process.env.CHROMIUM_EXECUTABLE_PATH ||
  (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);

/**
 * Genera el PDF final renderizando HTML con Chromium (Playwright) — mismo enfoque que Compra
 * Ágil (`src/lib/cotizacion-pdf.ts`, raíz): LibreOffice no funciona en este entorno. Este PDF es
 * el artefacto que se publica; el .pptx se conserva como fuente editable.
 */
export async function generarCotizacionPdf(data: CotizacionLicitacionData, outputPdfPath: string): Promise<void> {
  const html = generarCotizacionHtml(data);
  const tmpDir = mkdtempSync(path.join(tmpdir(), "cotizacion-licitacion-"));
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
