import type { CotizacionLicitacionData } from "./cotizacion-pptx.js";
import {
  PALETA_KEEPSYNC as COLOR,
  MESES_ES,
  cssLaminasKeepsync,
  formatoClp,
  escaparHtml as esc,
  logoKeepsyncBase64,
} from "../../../src/lib/estilo-keepsync.js";

/**
 * Misma cotización que cotizacion-pptx.ts pero como HTML para imprimir a PDF con Chromium —
 * mismo motivo que en Compra Ágil (src/lib/cotizacion-pdf.ts, raíz): LibreOffice no funciona en
 * este sandbox, así que el PDF final se genera renderizando esto con Playwright.
 */
export function generarCotizacionHtml(data: CotizacionLicitacionData): string {
  const logoBase64 = logoKeepsyncBase64();
  const mesAno = `${MESES_ES[data.fecha.getMonth()]} de ${data.fecha.getFullYear()}`;
  const bajoTope = data.totalClp <= data.topeClp;

  const filasTabla = data.lineas
    .map(
      (l) => `
      <tr>
        <td>${esc(l.descripcion)}</td>
        <td class="c">${l.cantidad}</td>
        <td class="c">${esc(l.unidad)}</td>
        <td class="r">${l.valorUnitClp != null ? formatoClp(l.valorUnitClp) : "—"}</td>
        <td class="r">${l.subtotalNetoClp != null ? formatoClp(l.subtotalNetoClp) : "Incluida"}</td>
      </tr>`,
    )
    .join("");

  const puntosNormativos = [
    { t: "Expediente electrónico", d: "Constituye y ordena el expediente electrónico exigido por la ley, con trazabilidad completa de cada actuación." },
    { t: "Interoperabilidad", d: "Facilita el intercambio de documentos entre órganos de la administración, uno de los principios centrales de la ley." },
    { t: "Firma y notificación electrónica", d: "Soporta la escrituración y notificación de actos administrativos por medios electrónicos." },
    { t: "Reducción de papel y trazabilidad", d: "Elimina flujos en papel, reduce tiempos de tramitación y deja registro íntegro y auditable de cada documento." },
  ];

  const filasCumplimiento = [
    `Producto/servicio — ${esc(data.resumenSolucion)}`,
    ...(data.plazoContratoDias != null ? [`Plazo de contrato — ${data.plazoContratoDias} día(s)`] : []),
    ...(data.garantiaSeriedadClp != null ? [`Garantía de seriedad de la oferta — ${formatoClp(data.garantiaSeriedadClp)}`] : []),
    ...data.documentosExigidos.map((d) => `Documento exigido — ${esc(d)}`),
  ];

  return `<!doctype html>
<html lang="es-CL">
<head>
<meta charset="utf-8">
<title>Cotización ${esc(data.codigo)}</title>
<style>${cssLaminasKeepsync()}</style>
</head>
<body>

<div class="slide">
  ${!data.company.identidad_confirmada ? `<div class="badge">BORRADOR — identidad KeepSync sin confirmar</div>` : ""}
  <img src="data:image/png;base64,${logoBase64}" style="width:52pt;height:52pt;position:absolute;top:0.6in;left:0.7in;">
  <div style="position:absolute;top:0.75in;left:1.5in;font-size:16pt;font-weight:bold;">KeepSync</div>
  <div style="margin-top:1.7in;">
    <h1>PROPUESTA COMERCIAL</h1>
    <div class="accent" style="font-size:15pt;margin-bottom:10pt;">Gestión documental y digitalización de procesos para ${esc(data.organismoComprador)}</div>
    <div class="gray" style="font-size:11pt;">Respuesta a licitación pública — ${esc(data.codigo)}</div>
  </div>
  <div class="card" style="margin-top:24pt;">
    <div class="info-row"><span class="lbl">CLIENTE</span><span>${esc(data.organismoComprador)}</span></div>
    <div class="info-row"><span class="lbl">PROYECTO</span><span>${esc(data.nombreCompra)}</span></div>
    <div class="info-row"><span class="lbl">DIRIGIDO A</span><span>${esc(data.direccionEntrega || "Unidad de compras")}</span></div>
  </div>
  <div class="footer">Presentado por KeepSync — ${mesAno}</div>
</div>

<div class="slide">
  ${!data.company.identidad_confirmada ? `<div class="badge">BORRADOR — identidad KeepSync sin confirmar</div>` : ""}
  <h2>Solución propuesta</h2>
  <p class="gray" style="font-size:11pt;max-width:9in;">${esc(data.resumenSolucion)}</p>
  <div class="grid3">
    <div class="card"><div class="num-badge">1</div><strong>Gestión documental</strong><p class="gray" style="font-size:9.5pt;">Repositorio centralizado, control de versiones y trazabilidad de toda la documentación institucional.</p></div>
    <div class="card"><div class="num-badge">2</div><strong>Oficina de partes digital</strong><p class="gray" style="font-size:9.5pt;">Recepción, derivación y seguimiento electrónico de correspondencia y expedientes, sin papel.</p></div>
    <div class="card"><div class="num-badge">3</div><strong>Digitalización de procesos</strong><p class="gray" style="font-size:9.5pt;">Flujos de trabajo, firma electrónica y expediente electrónico alineados a la tramitación digital del Estado.</p></div>
  </div>
  <h2 style="font-size:14pt;margin-top:22pt;">Cumplimiento del requerimiento</h2>
  ${filasCumplimiento.map((f) => `<div style="font-size:10.5pt;padding:4pt 0;"><span class="check">✓</span>${f}</div>`).join("")}
</div>

<div class="slide">
  ${!data.company.identidad_confirmada ? `<div class="badge">BORRADOR — identidad KeepSync sin confirmar</div>` : ""}
  <div class="accent" style="font-size:10pt;letter-spacing:1px;font-weight:bold;">MARCO NORMATIVO</div>
  <h2 style="font-size:22pt;margin-top:6pt;">Alineación con la Ley 21.180</h2>
  <p class="gray" style="font-size:10.5pt;max-width:9.2in;">Ley de Transformación Digital del Estado (modifica la Ley 19.880). La solución de gestión documental propuesta apoya directamente a ${esc(data.organismoComprador)} en el cumplimiento de la tramitación digital de los procedimientos administrativos que la ley exige.</p>
  <div class="grid2">
    ${puntosNormativos.map((p) => `<div class="card"><div class="num-badge">✓</div><strong style="font-size:11pt;">${p.t}</strong><p class="gray" style="font-size:9.5pt;">${p.d}</p></div>`).join("")}
  </div>
</div>

<div class="slide">
  ${!data.company.identidad_confirmada ? `<div class="badge">BORRADOR — identidad KeepSync sin confirmar</div>` : ""}
  <h1 style="font-size:24pt;">Cotización formal</h1>
  <p class="gray" style="font-size:10.5pt;">Valores en pesos chilenos (CLP), impuestos incluidos. Servicios de gestión documental y digitalización de procesos, gestión y soporte de KeepSync.</p>
  <table class="card">
    <thead><tr><th>Descripción</th><th class="c">Cant.</th><th class="c">Unidad</th><th class="r">Valor unitario</th><th class="r">Subtotal neto</th></tr></thead>
    <tbody>${filasTabla}</tbody>
  </table>
  <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-top:10pt;">
    <div style="max-width:4.5in;font-size:11pt;font-weight:${bajoTope ? "normal" : "bold"};color:${bajoTope ? COLOR.accentLight : COLOR.warn};">
      ${bajoTope ? `Oferta bajo el presupuesto disponible de ${formatoClp(data.topeClp)}` : `⚠ ADVERTENCIA: esta oferta (${formatoClp(data.totalClp)}) supera el presupuesto disponible de ${formatoClp(data.topeClp)} — sería inadmisible. No enviar.`}
    </div>
    <div class="totales" style="width:3.3in;">
      <div class="fila"><span class="gray">Neto</span><span>${formatoClp(data.netoClp)}</span></div>
      <div class="fila"><span class="gray">IVA 19%</span><span>${formatoClp(data.ivaClp)}</span></div>
      <div class="fila total"><span>TOTAL</span><span>${formatoClp(data.totalClp)}</span></div>
    </div>
  </div>
  <h2 style="font-size:13pt;margin-top:16pt;">Condiciones comerciales</h2>
  <ul class="cond">${data.condicionesComerciales.map((c) => `<li>${esc(c)}</li>`).join("")}</ul>
  <div class="footer" style="color:${data.company.identidad_confirmada ? COLOR.gray : COLOR.warn};font-weight:${data.company.identidad_confirmada ? "normal" : "bold"};">
    KeepSync — ${esc(data.company.contacto.email)} — ${data.company.identidad_confirmada ? "Válido por 30 días" : "BORRADOR: RUT y razón social pendientes de confirmar antes de enviar"}
  </div>
</div>

</body>
</html>`;
}
