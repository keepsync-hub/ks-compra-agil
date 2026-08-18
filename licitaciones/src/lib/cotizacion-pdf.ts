import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { generarCotizacionHtml } from "./cotizacion-html.js";
import type { CotizacionLicitacionData } from "./cotizacion-pptx.js";

const CHROMIUM_PATH = "/opt/pw-browsers/chromium";

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
