import { generarCotizacionHtml } from "./cotizacion-html.js";
import { renderizarPdfDesdeHtml } from "../../../src/lib/estilo-keepsync.js";
import type { CotizacionLicitacionData } from "./cotizacion-pptx.js";

/**
 * Genera el PDF final renderizando HTML con Chromium (Playwright) — mismo enfoque que Compra
 * Ágil (`src/lib/cotizacion-pdf.ts`, raíz): LibreOffice no funciona en este entorno. Este PDF es
 * el artefacto que se publica; el .pptx se conserva como fuente editable.
 */
export async function generarCotizacionPdf(data: CotizacionLicitacionData, outputPdfPath: string): Promise<void> {
  const html = generarCotizacionHtml(data);
  await renderizarPdfDesdeHtml(html, outputPdfPath, "cotizacion-licitacion-");
}
