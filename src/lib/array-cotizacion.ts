import type { CompanyConfig } from "./config.js";
import {
  PALETA_KEEPSYNC as COLOR,
  MESES_ES,
  cssLaminasKeepsync,
  formatoClp,
  escaparHtml as esc,
  logoKeepsyncBase64,
  renderizarPdfDesdeHtml,
} from "./estilo-keepsync.js";

export interface CotizacionArrayData {
  codigo: string;
  nombreCompra: string;
  organismoComprador: string;
  direccionEntrega?: string;
  categoriaNombre: string;
  categoriaDescripcion: string;
  netoClp: number;
  ivaClp: number;
  totalClp: number;
  topeClp: number;
  plazoEntregaDias: number | null;
  documentosExigidos: string[];
  condicionesComerciales: string[];
  fecha: Date;
  company: CompanyConfig;
}

/**
 * Cotización preliminar de exploración de mercado para una oportunidad de tipo Array, con el
 * precio calculado como 80% del presupuesto disponible (no a partir de un costo real de Array:
 * no existe ese catálogo hoy — ver array-compras-agiles-cotizar/SKILL.md). El oferente que
 * figura es KeepSync (config/company.json), igual que en la cotización de licencias Claude de
 * este repo — misma plantilla visual, misma vía de renderizado (Chromium/Playwright, no
 * LibreOffice, ver notas en cotizacion-pdf.ts).
 */
export function generarCotizacionArrayHtml(data: CotizacionArrayData): string {
  const logoBase64 = logoKeepsyncBase64();
  const mesAno = `${MESES_ES[data.fecha.getMonth()]} de ${data.fecha.getFullYear()}`;
  const bajoTope = data.totalClp <= data.topeClp;

  const puntosNormativos = [
    { t: "Tramitación digital", d: `Apoya a ${esc(data.organismoComprador)} a operar bajo los principios de tramitación electrónica que establece la Ley 21.180 de Transformación Digital del Estado.` },
    { t: "Trazabilidad", d: "Registro íntegro y auditable de cada actuación, expediente o flujo gestionado con la solución." },
    { t: "Interoperabilidad", d: "Facilita el intercambio de información entre unidades y, cuando aplica, con otros órganos de la administración." },
    { t: "Eficiencia operativa", d: "Reduce tareas manuales repetitivas y tiempos de tramitación, liberando capacidad del equipo." },
  ];

  const filasCumplimiento = [
    `Producto/servicio — ${esc(data.categoriaNombre)}`,
    ...(data.plazoEntregaDias != null ? [`Plazo de entrega — activación en ${data.plazoEntregaDias} día(s) hábil(es)`] : []),
    ...data.documentosExigidos.map((d) => `Documento exigido — ${esc(d)}`),
    "Despacho digital — incluido en el valor total",
  ];

  return `<!doctype html>
<html lang="es-CL">
<head>
<meta charset="utf-8">
<title>Cotización ${esc(data.codigo)}</title>
<style>
${cssLaminasKeepsync()}
  .badge.prelim { top: 0.35in; right: 0.35in; }
  .badge.borrador { top: 0.95in; }
</style>
</head>
<body>

<div class="slide">
  <div class="badge prelim">PRELIMINAR — exploración de mercado</div>
  ${!data.company.identidad_confirmada ? `<div class="badge borrador">BORRADOR — identidad KeepSync sin confirmar</div>` : ""}
  <img src="data:image/png;base64,${logoBase64}" style="width:52pt;height:52pt;position:absolute;top:0.6in;left:0.7in;">
  <div style="position:absolute;top:0.75in;left:1.5in;font-size:16pt;font-weight:bold;">KeepSync</div>
  <div style="margin-top:1.7in;">
    <h1>PROPUESTA COMERCIAL</h1>
    <div class="accent" style="font-size:15pt;margin-bottom:10pt;">${esc(data.categoriaNombre)} para ${esc(data.organismoComprador)}</div>
    <div class="gray" style="font-size:11pt;">Respuesta a solicitud de Compra Ágil — ${esc(data.codigo)}</div>
  </div>
  <div class="card" style="margin-top:24pt;">
    <div class="info-row"><span class="lbl">CLIENTE</span><span>${esc(data.organismoComprador)}</span></div>
    <div class="info-row"><span class="lbl">PROYECTO</span><span>${esc(data.nombreCompra)}</span></div>
    <div class="info-row"><span class="lbl">DIRIGIDO A</span><span>${esc(data.direccionEntrega || "Unidad de compras")}</span></div>
  </div>
  <div class="footer">Presentado por KeepSync — ${mesAno}</div>
</div>

<div class="slide">
  <div class="badge prelim">PRELIMINAR — exploración de mercado</div>
  <h2>Solución propuesta</h2>
  <p class="gray" style="font-size:11pt;max-width:9in;">${esc(data.categoriaDescripcion)}</p>
  <h2 style="font-size:14pt;margin-top:26pt;">Cumplimiento del requerimiento</h2>
  ${filasCumplimiento.map((f) => `<div style="font-size:10.5pt;padding:4pt 0;"><span class="check">✓</span>${f}</div>`).join("")}
</div>

<div class="slide">
  <div class="badge prelim">PRELIMINAR — exploración de mercado</div>
  <div class="accent" style="font-size:10pt;letter-spacing:1px;font-weight:bold;">MARCO NORMATIVO</div>
  <h2 style="font-size:22pt;margin-top:6pt;">Alineación con la Ley 21.180</h2>
  <p class="gray" style="font-size:10.5pt;max-width:9.2in;">Ley de Transformación Digital del Estado (modifica la Ley 19.880). La solución propuesta apoya a ${esc(data.organismoComprador)} en el cumplimiento de la tramitación digital de los procedimientos administrativos que la ley exige.</p>
  <div class="grid2">
    ${puntosNormativos.map((p) => `<div class="card"><div class="num-badge">✓</div><strong style="font-size:11pt;">${p.t}</strong><p class="gray" style="font-size:9.5pt;">${p.d}</p></div>`).join("")}
  </div>
</div>

<div class="slide">
  <div class="badge prelim">PRELIMINAR — exploración de mercado</div>
  ${!data.company.identidad_confirmada ? `<div class="badge borrador">BORRADOR — identidad KeepSync sin confirmar</div>` : ""}
  <h1 style="font-size:24pt;">Cotización formal</h1>
  <p class="gray" style="font-size:10.5pt;">Valores en pesos chilenos (CLP), impuestos incluidos. Precio estimado como 80% del presupuesto disponible informado por el organismo comprador — <strong>no</strong> calculado a partir de un costo real de Array; confirmar antes de enviar.</p>
  <table class="card">
    <thead><tr><th>Descripción</th><th class="c">Cant.</th><th class="r">Subtotal neto</th></tr></thead>
    <tbody>
      <tr>
        <td>${esc(data.categoriaNombre)}</td>
        <td class="c">1</td>
        <td class="r">${formatoClp(data.netoClp)}</td>
      </tr>
    </tbody>
  </table>
  <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-top:10pt;">
    <div style="max-width:4.5in;font-size:11pt;color:${COLOR.accentLight};">
      Precio = 80% del presupuesto disponible de ${formatoClp(data.topeClp)}${bajoTope ? "" : ` — ⚠ por redondeo esta oferta (${formatoClp(data.totalClp)}) queda sobre el tope, revisar antes de usar`}.
    </div>
    <div class="totales" style="width:3.3in;">
      <div class="fila"><span class="gray">Neto</span><span>${formatoClp(data.netoClp)}</span></div>
      <div class="fila"><span class="gray">IVA ${data.company.pricing.iva_pct}%</span><span>${formatoClp(data.ivaClp)}</span></div>
      <div class="fila total"><span>TOTAL</span><span>${formatoClp(data.totalClp)}</span></div>
    </div>
  </div>
  <h2 style="font-size:13pt;margin-top:16pt;">Condiciones comerciales</h2>
  <ul class="cond">${data.condicionesComerciales.map((c) => `<li>${esc(c)}</li>`).join("")}</ul>
  <div class="footer" style="color:${data.company.identidad_confirmada ? COLOR.gray : COLOR.warn};font-weight:${data.company.identidad_confirmada ? "normal" : "bold"};">
    KeepSync — ${esc(data.company.contacto.email)} — PRELIMINAR: precio de exploración de mercado, no cotización final
  </div>
</div>

</body>
</html>`;
}

/** Renderiza el PDF con Chromium/Playwright (no LibreOffice — ver notas en src/lib/cotizacion-pdf.ts). */
export async function generarCotizacionArrayPdf(data: CotizacionArrayData, outputPdfPath: string): Promise<void> {
  const html = generarCotizacionArrayHtml(data);
  await renderizarPdfDesdeHtml(html, outputPdfPath, "cotizacion-array-");
}
