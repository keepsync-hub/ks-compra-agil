import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { CotizacionPptxData } from "./cotizacion-pptx.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOGO_PATH = path.join(__dirname, "..", "assets", "logo-keepsync-blanco.png");

const COLOR = {
  bg: "#0E0E17",
  card: "#161527",
  cardAlt: "#1D1B33",
  border: "#2A2844",
  accent: "#786CF0",
  accentLight: "#B4AAFA",
  white: "#FFFFFF",
  gray: "#9A9FB0",
  warn: "#FB7185",
};

function formatoClp(n: number): string {
  return "$" + Math.round(n).toLocaleString("es-CL");
}

const MESES_ES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Genera la misma cotización que cotizacion-pptx.ts pero como HTML para imprimir a PDF con
 * Chromium — LibreOffice (soffice) no funciona en este sandbox (falla incluso con un .txt
 * vacío, ver notas en cotizar.ts), así que el PDF final se genera renderizando esto con
 * Playwright en vez de convertir el .pptx.
 */
export function generarCotizacionHtml(data: CotizacionPptxData): string {
  const logoBase64 = readFileSync(LOGO_PATH).toString("base64");
  const mesAno = `${MESES_ES[data.fecha.getMonth()]} de ${data.fecha.getFullYear()}`;
  const bajoTope = data.totalClp <= data.topeClp;

  const filasTabla = data.lineas
    .map(
      (l) => `
      <tr>
        <td>${esc(l.descripcion)}</td>
        <td class="c">${l.cantidad}</td>
        <td class="c">${l.meses ?? "—"}</td>
        <td class="r">${l.valorUnitMensualClp != null ? formatoClp(l.valorUnitMensualClp) : "—"}</td>
        <td class="r">${l.subtotalNetoClp != null ? formatoClp(l.subtotalNetoClp) : "Incluida"}</td>
      </tr>`,
    )
    .join("");

  const puntosNormativos = [
    { t: "Actualización", d: `${data.planPrincipal} es tecnología de IA vigente y con soporte activo: evita el uso de plataformas obsoletas y mantiene al equipo con herramientas de última generación.` },
    { t: "Escrituración electrónica", d: "Acelera la redacción, revisión y estandarización de actos y documentos administrativos expresados por medios electrónicos." },
    { t: "Fidelidad del expediente", d: "Apoya el análisis, resumen y ordenamiento de la documentación, ayudando a mantener registros íntegros y trazables." },
    { t: "Eficiencia y cooperación", d: "Automatiza tareas repetitivas y facilita el trabajo colaborativo entre equipos, liberando tiempo para modernizar los servicios." },
  ];

  const filasCumplimiento = [
    `Producto/servicio — ${data.cantidadUsuarios} licencia${data.cantidadUsuarios === 1 ? "" : "s"} ${esc(data.planPrincipal)} — ${data.mesesVigencia} meses`,
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
  @page { size: 11.69in 8.27in; margin: 0; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: Arial, "Segoe UI", sans-serif; background: ${COLOR.bg}; color: ${COLOR.white}; }
  .slide { width: 11.69in; height: 8.27in; padding: 0.7in; position: relative; page-break-after: always; overflow: hidden; }
  .slide:last-child { page-break-after: auto; }
  .gray { color: ${COLOR.gray}; }
  .accent { color: ${COLOR.accentLight}; }
  h1 { font-size: 30pt; margin: 0 0 8pt; }
  h2 { font-size: 20pt; margin: 0 0 8pt; }
  .card { background: ${COLOR.card}; border: 1px solid ${COLOR.border}; border-radius: 10px; padding: 14pt 16pt; }
  .badge {
    position: absolute; top: 0.35in; right: 0.35in; background: ${COLOR.warn}; color: ${COLOR.white};
    font-size: 9pt; font-weight: bold; padding: 6pt 12pt; border-radius: 20px;
  }
  table { width: 100%; border-collapse: collapse; font-size: 11pt; }
  th, td { text-align: left; padding: 8pt 10pt; }
  th { color: ${COLOR.gray}; font-size: 9pt; text-transform: uppercase; background: ${COLOR.cardAlt}; }
  td.c, th.c { text-align: center; }
  td.r, th.r { text-align: right; }
  .info-row { display: flex; gap: 10pt; font-size: 11pt; padding: 4pt 0; }
  .info-row .lbl { width: 140pt; color: ${COLOR.gray}; font-weight: bold; font-size: 9pt; }
  .grid3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10pt; margin-top: 14pt; }
  .grid2 { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10pt; margin-top: 14pt; }
  .num-badge { width: 26pt; height: 26pt; border-radius: 50%; background: ${COLOR.accent}; display: flex; align-items: center; justify-content: center; font-weight: bold; margin-bottom: 8pt; }
  .check { color: ${COLOR.accent}; font-weight: bold; margin-right: 6pt; }
  .totales { margin-top: 10pt; font-size: 12pt; }
  .totales .fila { display: flex; justify-content: space-between; padding: 4pt 0; }
  .totales .total { background: ${COLOR.accent}; border-radius: 8px; padding: 8pt 14pt; font-size: 15pt; font-weight: bold; margin-top: 6pt; }
  .footer { position: absolute; bottom: 0.4in; left: 0.7in; right: 0.7in; font-size: 9pt; color: ${COLOR.gray}; }
  ul.cond { margin: 8pt 0 0; padding-left: 16pt; font-size: 10.5pt; color: ${COLOR.gray}; }
  ul.cond li { margin-bottom: 4pt; }
</style>
</head>
<body>

<div class="slide">
  ${!data.company.identidad_confirmada ? `<div class="badge">BORRADOR — identidad KeepSync sin confirmar</div>` : ""}
  <img src="data:image/png;base64,${logoBase64}" style="width:52pt;height:52pt;position:absolute;top:0.6in;left:0.7in;">
  <div style="position:absolute;top:0.75in;left:1.5in;font-size:16pt;font-weight:bold;">KeepSync</div>
  <div style="margin-top:1.7in;">
    <h1>PROPUESTA COMERCIAL</h1>
    <div class="accent" style="font-size:16pt;margin-bottom:10pt;">Licencias ${esc(data.planPrincipal)} para ${esc(data.organismoComprador)}</div>
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
  ${!data.company.identidad_confirmada ? `<div class="badge">BORRADOR — identidad KeepSync sin confirmar</div>` : ""}
  <h2>Solución propuesta</h2>
  <p class="gray" style="font-size:11pt;max-width:9in;">${data.cantidadUsuarios} cuenta${data.cantidadUsuarios === 1 ? "" : "s"} ${esc(data.planPrincipal)} por ${data.mesesVigencia} meses, con acceso al asistente de IA de Anthropic para el equipo de ${esc(data.organismoComprador)}.</p>
  <div class="grid3">
    <div class="card"><div class="num-badge">1</div><strong>Capacidad ampliada</strong><p class="gray" style="font-size:9.5pt;">Uso significativamente mayor que el plan gratuito, con acceso prioritario en horas de alta demanda.</p></div>
    <div class="card"><div class="num-badge">2</div><strong>Modelos avanzados</strong><p class="gray" style="font-size:9.5pt;">Acceso a los modelos más capaces de Claude para redacción, análisis de documentos, código y automatización.</p></div>
    <div class="card"><div class="num-badge">3</div><strong>Herramientas de trabajo</strong><p class="gray" style="font-size:9.5pt;">Proyectos, carga de archivos y funciones de investigación y razonamiento extendido para tareas complejas.</p></div>
  </div>
  <h2 style="font-size:14pt;margin-top:22pt;">Cumplimiento del requerimiento</h2>
  ${filasCumplimiento.map((f) => `<div style="font-size:10.5pt;padding:4pt 0;"><span class="check">✓</span>${f}</div>`).join("")}
</div>

<div class="slide">
  ${!data.company.identidad_confirmada ? `<div class="badge">BORRADOR — identidad KeepSync sin confirmar</div>` : ""}
  <div class="accent" style="font-size:10pt;letter-spacing:1px;font-weight:bold;">MARCO NORMATIVO</div>
  <h2 style="font-size:22pt;margin-top:6pt;">Alineación con la Ley 21.180</h2>
  <p class="gray" style="font-size:10.5pt;max-width:9.2in;">Ley de Transformación Digital del Estado (Art. 16 bis). Las licencias ${esc(data.planPrincipal)} potencian al equipo de ${esc(data.organismoComprador)} para operar bajo los principios que la ley establece en la tramitación electrónica de los procedimientos administrativos.</p>
  <div class="grid2">
    ${puntosNormativos.map((p) => `<div class="card"><div class="num-badge">✓</div><strong style="font-size:11pt;">${p.t}</strong><p class="gray" style="font-size:9.5pt;">${p.d}</p></div>`).join("")}
  </div>
</div>

<div class="slide">
  ${!data.company.identidad_confirmada ? `<div class="badge">BORRADOR — identidad KeepSync sin confirmar</div>` : ""}
  <h1 style="font-size:24pt;">Cotización formal</h1>
  <p class="gray" style="font-size:10.5pt;">Valores en pesos chilenos (CLP), impuestos incluidos. Licencias ${esc(data.planPrincipal)} por ${data.mesesVigencia} meses, gestión y soporte de KeepSync.</p>
  <table class="card">
    <thead><tr><th>Descripción</th><th class="c">Cant.</th><th class="c">Meses</th><th class="r">Valor unit. mensual</th><th class="r">Subtotal neto</th></tr></thead>
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
