import {
  PALETA_KEEPSYNC as COLOR,
  cssLaminasKeepsync,
  escaparHtml as esc,
  formatoClp,
  logoKeepsyncBase64,
  mesAnoEs,
  renderizarPdfDesdeHtml,
} from "./estilo-keepsync.js";
import { calcularCotizacionUsd, type CotizacionUsdResultado } from "./pricing-usd.js";
import type { IdentidadOferente } from "./capacitaciones.js";

/**
 * Cotización comercial directa (fuera de Compra Ágil y de licitaciones) para una suscripción SaaS
 * con precio de lista en USD por usuario y por mes: Perplexity Pro hoy, cualquier otra mañana.
 *
 * Por qué existe como módulo y no como un script de una sola vez: la cotización de Perplexity Pro
 * para INIA se generó primero a mano y quedó solo como PDF en Drive — sin código en el repo, no se
 * podía regenerar ni auditar el cálculo. Acá el precio sale íntegro de `calcularCotizacionUsd`
 * (`.claude/skills/cotizar-usd/`) y el PDF de `estilo-keepsync.ts` (`.claude/skills/keepsync-pdf/`),
 * sin duplicar ni la fórmula ni la paleta.
 *
 * El monto en USD que se le pasa a la regla es el **anual**: precio de lista mensual × usuarios ×
 * meses. La regla se aplica una sola vez sobre ese total, no mes a mes — multiplicar primero y
 * convertir después es lo que pidió el usuario, y además evita arrastrar el redondeo doce veces.
 *
 * Lo que este documento NO muestra: el tipo de cambio, el impuesto no recuperable y el markup. Es
 * un documento de cliente final y esa fue la instrucción del usuario para la cotización de
 * licencias Claude del 2026-08-28 (commit a84c1bf, "Simplificar cotización INIA a solo valores
 * finales en CLP"). El desglose completo de los cinco pasos sí queda en el `resumen` que devuelve
 * `cotizarSuscripcionUsd`, para el registro interno en `output/`.
 */
export interface SuscripcionUsdEntrada {
  /** Identificador de la cotización, p.ej. "Q-20260828-INIA". Va en la carátula y en el nombre del archivo. */
  id: string;
  /** Nombre comercial del producto tal como se factura, p.ej. "Perplexity Pro". */
  producto: string;
  /** A quién se dirige la cotización. */
  cliente: string;
  /** Precio de lista publicado por el proveedor, en USD por usuario y por mes. */
  precioListaUsdMes: number;
  /** Cuántas suscripciones (una por usuario). */
  usuarios: number;
  /** Duración del compromiso, en meses. */
  meses: number;
  /** Dólar observado SIN el recargo de 5,5% — el recargo lo aplica la regla. */
  tipoCambioObservado: number;
  /** De dónde salió el tipo de cambio (queda en el resumen interno, no en el PDF). */
  fuenteTipoCambio: string;
  /** De dónde salió el precio de lista — nunca se inventa (guardrail de CLAUDE.md). */
  fuentePrecioLista: string;
  oferente: IdentidadOferente;
  fecha: Date;
  /** Condiciones extra, además de las que este módulo agrega siempre. */
  condicionesExtra?: string[];
}

export interface SuscripcionUsdResumen {
  id: string;
  producto: string;
  cliente: string;
  usuarios: number;
  meses: number;
  precio_lista_usd_mes: number;
  fuente_precio_lista: string;
  monto_usd_anual: number;
  fuente_tipo_cambio: string;
  neto_unitario_mensual_clp: number;
  neto_clp: number;
  iva_clp: number;
  total_clp: number;
  calculo: CotizacionUsdResultado;
  oferente: { razon_social: string; rut: string; contacto_email: string; campos_por_confirmar: string[] };
  emitida_en: string;
}

export interface SuscripcionUsdCotizada {
  resumen: SuscripcionUsdResumen;
  html: string;
}

/**
 * Aplica la regla `cotizar-usd` al total anual y arma el HTML de las tres láminas. No escribe nada:
 * quien llame decide dónde va el PDF y el resumen.
 */
export function cotizarSuscripcionUsd(e: SuscripcionUsdEntrada): SuscripcionUsdCotizada {
  if (!(e.usuarios > 0) || !Number.isInteger(e.usuarios)) {
    throw new Error(`usuarios debe ser un entero mayor que 0 (recibido: ${e.usuarios})`);
  }
  if (!(e.meses > 0) || !Number.isInteger(e.meses)) {
    throw new Error(`meses debe ser un entero mayor que 0 (recibido: ${e.meses})`);
  }

  const montoUsdAnual = e.precioListaUsdMes * e.usuarios * e.meses;
  const calculo = calcularCotizacionUsd(montoUsdAnual, e.tipoCambioObservado);

  const netoClp = calculo.precio_cotizacion_clp;
  const totalClp = calculo.valor_final_clp;
  const ivaClp = totalClp - netoClp;
  const netoUnitarioMensualClp = Math.round(netoClp / (e.usuarios * e.meses));

  const resumen: SuscripcionUsdResumen = {
    id: e.id,
    producto: e.producto,
    cliente: e.cliente,
    usuarios: e.usuarios,
    meses: e.meses,
    precio_lista_usd_mes: e.precioListaUsdMes,
    fuente_precio_lista: e.fuentePrecioLista,
    monto_usd_anual: montoUsdAnual,
    fuente_tipo_cambio: e.fuenteTipoCambio,
    neto_unitario_mensual_clp: netoUnitarioMensualClp,
    neto_clp: netoClp,
    iva_clp: ivaClp,
    total_clp: totalClp,
    calculo,
    oferente: {
      razon_social: e.oferente.razon_social,
      rut: e.oferente.rut,
      contacto_email: e.oferente.contacto_email,
      campos_por_confirmar: e.oferente.campos_por_confirmar,
    },
    emitida_en: e.fecha.toISOString(),
  };

  return { resumen, html: generarHtml(e, resumen) };
}

/**
 * `identidad_confirmada` es false mientras falten domicilio, giro SII o representante legal, que es
 * lo que se necesita para **firmar anexos de una compra pública**. Este documento no los usa: solo
 * afirma razón social, RUT y correo, los tres ya confirmados contra el Registro de Proveedores. Por
 * eso el sello de BORRADOR se levanta con esos tres campos y no con `identidad_confirmada`: sellar
 * como borrador una cotización comercial por un dato que no aparece en ella sería ruido, y no
 * sellarla cuando falta la razón social o el RUT sería el defecto real.
 */
function identidadSuficiente(o: IdentidadOferente): boolean {
  const pendiente = (v: string) => !v || /por confirmar/i.test(v);
  return !pendiente(o.razon_social) && !pendiente(o.rut) && !pendiente(o.contacto_email);
}

function generarHtml(e: SuscripcionUsdEntrada, r: SuscripcionUsdResumen): string {
  const logoBase64 = logoKeepsyncBase64();
  const mesAno = mesAnoEs(e.fecha);
  const suficiente = identidadSuficiente(e.oferente);
  const sello = suficiente
    ? ""
    : `<div class="badge">BORRADOR — identidad del oferente sin confirmar</div>`;
  const plural = e.usuarios === 1 ? "" : "s";

  const condiciones = [
    `Suscripciones nominativas: ${e.usuarios} asiento${plural} de ${e.producto}, un usuario por suscripción, por ${e.meses} meses corridos desde la activación.`,
    "Activación, administración de los asientos y soporte de primer nivel a cargo de KeepSync; facturación en pesos chilenos.",
    "Cotización comercial directa: no constituye oferta ni respuesta a ningún proceso de compra pública.",
    "Válida por 30 días desde la fecha de emisión. El valor puede cambiar de acuerdo al tipo de cambio vigente al momento de la facturación.",
    ...(e.condicionesExtra ?? []),
  ];

  const alcance = [
    `${e.usuarios} suscripción${e.usuarios === 1 ? "" : "es"} ${e.producto}, una por usuario.`,
    `Vigencia de ${e.meses} meses (${e.meses === 12 ? "un año" : `${e.meses} meses`}) desde la activación.`,
    "Alta de las cuentas y entrega de accesos a las personas que designe el cliente.",
    "Gestión de la renovación, cambios de titular y bajas durante la vigencia.",
    "Facturación en pesos chilenos por KeepSync: el cliente no asume el pago en dólares ni la variación cambiaria dentro del período cotizado.",
    "Soporte de primer nivel por correo durante toda la vigencia.",
  ];

  return `<!doctype html>
<html lang="es-CL">
<head>
<meta charset="utf-8">
<title>Cotización ${esc(e.id)} — ${esc(e.producto)}</title>
<style>${cssLaminasKeepsync()}</style>
</head>
<body>

<div class="slide">
  ${sello}
  <img src="data:image/png;base64,${logoBase64}" style="width:52pt;height:52pt;position:absolute;top:0.6in;left:0.7in;">
  <div style="position:absolute;top:0.75in;left:1.5in;font-size:16pt;font-weight:bold;">KeepSync</div>
  <div style="margin-top:1.7in;">
    <h1>COTIZACIÓN</h1>
    <div class="accent" style="font-size:16pt;margin-bottom:10pt;">Suscripciones ${esc(e.producto)} — ${e.usuarios} usuario${plural}, ${e.meses} meses</div>
    <div class="gray" style="font-size:11pt;">Dirigida a ${esc(e.cliente)}</div>
  </div>
  <div class="card" style="margin-top:24pt;">
    <div class="info-row"><span class="lbl">N° COTIZACIÓN</span><span>${esc(e.id)}</span></div>
    <div class="info-row"><span class="lbl">CLIENTE</span><span>${esc(e.cliente)}</span></div>
    <div class="info-row"><span class="lbl">OFERENTE</span><span>${esc(e.oferente.razon_social)} — RUT ${esc(e.oferente.rut)}</span></div>
    <div class="info-row"><span class="lbl">VALIDEZ</span><span>30 días desde la emisión</span></div>
  </div>
  <div class="footer">Presentado por KeepSync — ${mesAno}</div>
</div>

<div class="slide">
  ${sello}
  <h2>Alcance de la suscripción</h2>
  <p class="gray" style="font-size:11pt;max-width:9in;">${e.usuarios} suscripción${e.usuarios === 1 ? "" : "es"} ${esc(e.producto)}, un usuario por suscripción, por ${e.meses} meses, contratadas y administradas por KeepSync para ${esc(e.cliente)}.</p>
  <div class="grid3">
    <div class="card"><div class="num-badge">${e.usuarios}</div><strong>Suscripciones</strong><p class="gray" style="font-size:9.5pt;">Un asiento nominativo por usuario, sin compartir credenciales.</p></div>
    <div class="card"><div class="num-badge">${e.meses}</div><strong>Meses de vigencia</strong><p class="gray" style="font-size:9.5pt;">Período completo cotizado por adelantado, a precio cerrado en pesos.</p></div>
    <div class="card"><div class="num-badge">✓</div><strong>Gestión KeepSync</strong><p class="gray" style="font-size:9.5pt;">Alta, soporte, renovación y facturación en CLP a cargo del oferente.</p></div>
  </div>
  <h2 style="font-size:14pt;margin-top:22pt;">Qué incluye</h2>
  ${alcance.map((a) => `<div style="font-size:10.5pt;padding:3.5pt 0;"><span class="check">✓</span>${esc(a)}</div>`).join("")}
</div>

<div class="slide">
  ${sello}
  <h1 style="font-size:24pt;">Cotización formal</h1>
  <p class="gray" style="font-size:10.5pt;">Valores en pesos chilenos (CLP). ${esc(e.producto)} por ${e.meses} meses, gestión y soporte de KeepSync.</p>
  <table class="card">
    <thead><tr><th>Descripción</th><th class="c">Cant.</th><th class="c">Meses</th><th class="r">Valor unit. mensual</th><th class="r">Subtotal neto</th></tr></thead>
    <tbody>
      <tr>
        <td>Suscripción ${esc(e.producto)} (1 usuario c/u)</td>
        <td class="c">${e.usuarios}</td>
        <td class="c">${e.meses}</td>
        <td class="r">${formatoClp(r.neto_unitario_mensual_clp)}</td>
        <td class="r">${formatoClp(r.neto_clp)}</td>
      </tr>
    </tbody>
  </table>
  <div style="display:flex;justify-content:flex-end;margin-top:10pt;">
    <div class="totales" style="width:3.3in;">
      <div class="fila"><span class="gray">Neto</span><span>${formatoClp(r.neto_clp)}</span></div>
      <div class="fila"><span class="gray">IVA 19%</span><span>${formatoClp(r.iva_clp)}</span></div>
      <div class="fila total"><span>TOTAL</span><span>${formatoClp(r.total_clp)}</span></div>
    </div>
  </div>
  <h2 style="font-size:13pt;margin-top:16pt;">Condiciones comerciales</h2>
  <ul class="cond">${condiciones.map((c) => `<li>${esc(c)}</li>`).join("")}</ul>
  <div class="footer" style="color:${suficiente ? COLOR.gray : COLOR.warn};font-weight:${suficiente ? "normal" : "bold"};">
    ${esc(e.oferente.razon_social)} — RUT ${esc(e.oferente.rut)} — ${esc(e.oferente.contacto_email)} — Válido por 30 días
  </div>
</div>

</body>
</html>`;
}

/** Renderiza el HTML de `cotizarSuscripcionUsd` a PDF con el mismo Chromium que el resto de los nichos. */
export async function generarCotizacionSuscripcionPdf(html: string, outputPdfPath: string): Promise<void> {
  await renderizarPdfDesdeHtml(html, outputPdfPath, "keepsync-suscripcion-");
}
