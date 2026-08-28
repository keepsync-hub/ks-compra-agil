import { generarCotizacionHtml } from "./cotizacion-html.js";
import { renderizarPdfDesdeHtml } from "./estilo-keepsync.js";
import type { CotizacionPptxData } from "./cotizacion-pptx.js";

/**
 * Genera el PDF final de la cotización renderizando HTML con Chromium (Playwright), no
 * convirtiendo el .pptx con LibreOffice: `soffice` no funciona en este entorno (falla incluso
 * al convertir un .txt vacío — diagnosticado con strace, no es un problema del archivo). Este
 * PDF es el artefacto que se publica; el .pptx se conserva como fuente editable.
 */
export async function generarCotizacionPdf(data: CotizacionPptxData, outputPdfPath: string): Promise<void> {
  const html = generarCotizacionHtml(data);
  await renderizarPdfDesdeHtml(html, outputPdfPath, "cotizacion-");
}
