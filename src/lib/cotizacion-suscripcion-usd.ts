import {
  PALETA_KEEPSYNC as COLOR,
  conPaginaHtml,
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
 * Cotización comercial directa (fuera de Compra Ágil y de licitaciones) para una o varias
 * suscripciones SaaS con precio de lista en USD por usuario y por mes: Perplexity Pro, ChatGPT
 * Plus, un par de cuentas Claude Max con tarifas distintas, cualquier combinación.
 *
 * Por qué existe como módulo y no como un script de una sola vez: la cotización de Perplexity Pro
 * para INIA se generó primero a mano y quedó solo como PDF en Drive — sin código en el repo, no se
 * podía regenerar ni auditar el cálculo. Acá el precio sale íntegro de `calcularCotizacionUsd`
 * (skill `ks-comun:ks-skill-cotizar-usd`) y el PDF de `estilo-keepsync.ts`
 * (skill `ks-comun:ks-skill-keepsync-pdf`),
 * sin duplicar ni la fórmula ni la paleta.
 *
 * El monto en USD que se le pasa a la regla es el **anual de cada línea**: precio de lista mensual
 * × usuarios × meses. La regla se aplica una vez por línea, no mes a mes — multiplicar primero y
 * convertir después es lo que pidió el usuario, y además evita arrastrar el redondeo doce veces.
 * Se aplica por línea y no sobre el total porque así el subtotal que muestra cada fila de la tabla
 * es el que sale de la regla, no un prorrateo; como la regla es una cadena de multiplicaciones, la
 * suma de las líneas y el cálculo sobre el total solo pueden diferir en el redondeo al peso.
 *
 * Lo que este documento NO muestra: el tipo de cambio, el impuesto no recuperable y el markup. Es
 * un documento de cliente final y esa fue la instrucción del usuario para la cotización de
 * licencias Claude del 2026-08-28 (commit a84c1bf, "Simplificar cotización INIA a solo valores
 * finales en CLP"). El desglose completo de los cinco pasos, línea por línea, sí queda en el
 * `resumen` que devuelve `cotizarSuscripcionUsd`, para el registro interno en `output/`.
 */
export interface LineaSuscripcionUsd {
  /** Nombre comercial del producto tal como se factura, p.ej. "Claude Max 5x". */
  producto: string;
  /** Precio de lista publicado por el proveedor, en USD por usuario y por mes. */
  precioListaUsdMes: number;
  /** Cuántas suscripciones de este producto (una por usuario). */
  usuarios: number;
  /** Duración del compromiso, en meses. */
  meses: number;
  /** De dónde salió el precio de lista — nunca se inventa (guardrail de CLAUDE.md). */
  fuentePrecioLista: string;
}

export interface SuscripcionUsdEntrada {
  /** Identificador de la cotización, p.ej. "Q-20260828-INIA". Va en la carátula y en el archivo. */
  id: string;
  /** Cómo se llama el conjunto en la carátula, p.ej. "Claude Max 5x y Max 20x". */
  titulo: string;
  /** A quién se dirige la cotización. */
  cliente: string;
  lineas: LineaSuscripcionUsd[];
  /** Dólar observado SIN el recargo de 5,5% — el recargo lo aplica la regla. */
  tipoCambioObservado: number;
  /** De dónde salió el tipo de cambio (queda en el resumen interno, no en el PDF). */
  fuenteTipoCambio: string;
  oferente: IdentidadOferente;
  fecha: Date;
  /** Condiciones extra, además de las que este módulo agrega siempre. */
  condicionesExtra?: string[];
  /**
   * Reemplaza la frase de validez por defecto (30 días desde la emisión, con el valor sujeto al
   * tipo de cambio de la facturación). Hace falta cuando las bases fijan otra vigencia y exigen un
   * valor total final, como el TDR de Alto Hospicio 3447-431-COT26 (Arts. 26 y 42).
   */
  validez?: string;
  /** Texto corto para la fila VALIDEZ de la portada cuando `validez` reemplaza la de 30 días. */
  validezCorta?: string;
  /**
   * El cliente es el titular: la cuenta o workspace se crea a su nombre y lo administra él, y
   * KeepSync activa, soporta y factura. Cambia las frases que de otro modo afirman que KeepSync
   * "contrata y administra" — en Alto Hospicio 3447-431-COT26 eso contradiría el Art. 11 e) del
   * TDR, que rechaza cuentas a nombre de terceros o atadas a correos del proveedor.
   */
  titularCliente?: boolean;
  /** Lámina de cumplimiento: requisito por requisito con su cita, y el procedimiento de alta. */
  laminaCumplimiento?: LaminaCumplimiento;
}

export interface LaminaCumplimiento {
  titulo: string;
  intro: string;
  /** Una fila por exigencia de las bases. `referencia` es el artículo citado: no hay fila sin cita. */
  filas: { requisito: string; referencia: string; cumplimiento: string }[];
  titulo_procedimiento: string;
  pasos: string[];
  nota?: string;
}

/** Valida la lámina antes de imprimir: el documento afirma cumplimiento, cada fila debe citar su artículo. */
export function validarLaminaCumplimiento(l: LaminaCumplimiento): void {
  if (!l.titulo?.trim() || !l.titulo_procedimiento?.trim()) throw new Error("Lámina de cumplimiento sin título.");
  if (!Array.isArray(l.filas) || l.filas.length === 0) throw new Error("Lámina de cumplimiento sin filas.");
  l.filas.forEach((f, i) => {
    if (!f.requisito?.trim() || !f.referencia?.trim() || !f.cumplimiento?.trim()) {
      throw new Error(`Lámina de cumplimiento, fila ${i + 1}: requisito, referencia y cumplimiento son obligatorios.`);
    }
  });
  if (!Array.isArray(l.pasos) || l.pasos.length === 0) throw new Error("Lámina de cumplimiento sin pasos de procedimiento.");
}

export interface LineaSuscripcionUsdResumen {
  producto: string;
  usuarios: number;
  meses: number;
  precio_lista_usd_mes: number;
  fuente_precio_lista: string;
  monto_usd: number;
  neto_unitario_mensual_clp: number;
  neto_clp: number;
  iva_clp: number;
  total_clp: number;
  calculo: CotizacionUsdResultado;
}

export interface SuscripcionUsdResumen {
  id: string;
  titulo: string;
  cliente: string;
  fuente_tipo_cambio: string;
  tipo_cambio_observado: number;
  monto_usd_total: number;
  neto_clp: number;
  iva_clp: number;
  total_clp: number;
  lineas: LineaSuscripcionUsdResumen[];
  oferente: { razon_social: string; rut: string; contacto_email: string; campos_por_confirmar: string[] };
  emitida_en: string;
}

export interface SuscripcionUsdCotizada {
  resumen: SuscripcionUsdResumen;
  html: string;
}

/**
 * Aplica la regla `cotizar-usd` a cada línea y arma el HTML de las tres láminas. No escribe nada:
 * quien llame decide dónde va el PDF y el resumen.
 */
export function cotizarSuscripcionUsd(e: SuscripcionUsdEntrada): SuscripcionUsdCotizada {
  if (!e.lineas.length) {
    throw new Error("La cotización necesita al menos una línea.");
  }
  for (const l of e.lineas) {
    if (!(l.usuarios > 0) || !Number.isInteger(l.usuarios)) {
      throw new Error(`usuarios debe ser un entero mayor que 0 en "${l.producto}" (recibido: ${l.usuarios})`);
    }
    if (!(l.meses > 0) || !Number.isInteger(l.meses)) {
      throw new Error(`meses debe ser un entero mayor que 0 en "${l.producto}" (recibido: ${l.meses})`);
    }
  }

  const lineas: LineaSuscripcionUsdResumen[] = e.lineas.map((l) => {
    const montoUsd = l.precioListaUsdMes * l.usuarios * l.meses;
    const calculo = calcularCotizacionUsd(montoUsd, e.tipoCambioObservado);
    const netoClp = calculo.precio_cotizacion_clp;
    const totalClp = calculo.valor_final_clp;
    return {
      producto: l.producto,
      usuarios: l.usuarios,
      meses: l.meses,
      precio_lista_usd_mes: l.precioListaUsdMes,
      fuente_precio_lista: l.fuentePrecioLista,
      monto_usd: montoUsd,
      neto_unitario_mensual_clp: Math.round(netoClp / (l.usuarios * l.meses)),
      neto_clp: netoClp,
      iva_clp: totalClp - netoClp,
      total_clp: totalClp,
      calculo,
    };
  });

  const suma = (f: (l: LineaSuscripcionUsdResumen) => number) => lineas.reduce((a, l) => a + f(l), 0);

  const resumen: SuscripcionUsdResumen = {
    id: e.id,
    titulo: e.titulo,
    cliente: e.cliente,
    fuente_tipo_cambio: e.fuenteTipoCambio,
    tipo_cambio_observado: e.tipoCambioObservado,
    monto_usd_total: suma((l) => l.monto_usd),
    neto_clp: suma((l) => l.neto_clp),
    iva_clp: suma((l) => l.iva_clp),
    total_clp: suma((l) => l.total_clp),
    lineas,
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

/** Los meses de vigencia solo se pueden anunciar como uno si todas las líneas coinciden. */
function mesesComunes(r: SuscripcionUsdResumen): number | null {
  const primera = r.lineas[0];
  if (!primera) return null;
  return r.lineas.every((l) => l.meses === primera.meses) ? primera.meses : null;
}

function generarHtml(e: SuscripcionUsdEntrada, r: SuscripcionUsdResumen): string {
  const logoBase64 = logoKeepsyncBase64();
  const mesAno = mesAnoEs(e.fecha);
  const suficiente = identidadSuficiente(e.oferente);
  const sello = suficiente
    ? ""
    : `<div class="badge">BORRADOR — identidad del oferente sin confirmar</div>`;

  const usuariosTotal = r.lineas.reduce((a, l) => a + l.usuarios, 0);
  const plural = usuariosTotal === 1 ? "" : "s";
  const meses = mesesComunes(r);
  const glosaVigencia = meses !== null ? `${meses} meses` : "vigencia por línea";
  const subtitulo = `${e.titulo} — ${usuariosTotal} usuario${plural}, ${glosaVigencia}`;

  // "2 suscripciones Claude Max 5x" cuando hay varias del mismo producto; "1 suscripción X y 1
  // suscripción Y" cuando son distintas. Es la misma frase que encabeza la lámina de alcance.
  const glosaLinea = (l: { usuarios: number; producto: string }) =>
    `${l.usuarios} ${l.usuarios === 1 ? "suscripción" : "suscripciones"} ${l.producto}`;
  const glosaLineas = r.lineas.map(glosaLinea).join(" y ");

  const condiciones = [
    `Suscripciones nominativas: ${glosaLineas}, un usuario por suscripción, por ${glosaVigencia} corridos desde la activación.`,
    e.titularCliente
      ? `La cuenta y su administración quedan a nombre de ${e.cliente}; activación asistida y soporte de primer nivel a cargo de KeepSync; facturación en pesos chilenos.`
      : "Activación, administración de los asientos y soporte de primer nivel a cargo de KeepSync; facturación en pesos chilenos.",
    // Acá iba "Cotización comercial directa: no constituye oferta ni respuesta a ningún proceso de
    // compra pública." El usuario la sacó el 2026-08-28: es una salvedad interna, no una condición
    // comercial, y no aporta nada al cliente que recibe el documento. Que este cotizador no sirva
    // para ofertar en Compra Ágil (no respeta tope ni admisibilidad) sigue dicho donde corresponde:
    // el encabezado de este módulo, el de `src/scripts/cotizar-suscripcion.ts` y CLAUDE.md.
    e.validez ??
      "Válida por 30 días desde la fecha de emisión. El valor puede cambiar de acuerdo al tipo de cambio vigente al momento de la facturación.",
    ...(e.condicionesExtra ?? []),
  ];

  const alcance = [
    ...r.lineas.map((l) => `${glosaLinea(l)}, una por usuario, por ${l.meses} meses.`),
    e.titularCliente
      ? "Alta asistida: el cliente es titular y administrador; los usuarios activan su acceso con su propio correo institucional."
      : "Alta de las cuentas y entrega de accesos a las personas que designe el cliente.",
    e.titularCliente
      ? "Apoyo en altas, bajas y reasignación de usuarios durante la vigencia."
      : "Gestión de la renovación, cambios de titular y bajas durante la vigencia.",
    "Facturación en pesos chilenos por KeepSync: el cliente no asume el pago en dólares ni la variación cambiaria dentro del período cotizado.",
    "Soporte de primer nivel por correo durante toda la vigencia.",
  ];

  const filas = r.lineas
    .map(
      (l) => `
      <tr>
        <td>Suscripción ${esc(l.producto)}${l.usuarios > 1 ? " (1 usuario c/u)" : ""}</td>
        <td class="c">${l.usuarios}</td>
        <td class="c">${l.meses}</td>
        <td class="r">${formatoClp(l.neto_unitario_mensual_clp)}</td>
        <td class="r">${formatoClp(l.neto_clp)}</td>
      </tr>`,
    )
    .join("");

  return `<!doctype html>
<html lang="es-CL">
<head>
<meta charset="utf-8">
<title>Cotización ${esc(e.id)} — ${esc(e.titulo)}</title>
<style>${cssLaminasKeepsync()}</style>
</head>
<body>

<div class="slide">
  ${sello}
  <img src="data:image/png;base64,${logoBase64}" style="width:52pt;height:52pt;position:absolute;top:0.6in;left:0.7in;">
  <div style="position:absolute;top:0.75in;left:1.5in;font-size:16pt;font-weight:bold;">KeepSync</div>
  <div style="margin-top:1.7in;">
    <h1>COTIZACIÓN</h1>
    <div class="accent" style="font-size:16pt;margin-bottom:10pt;">${esc(subtitulo)}</div>
    <div class="gray" style="font-size:11pt;">Dirigida a ${esc(e.cliente)}</div>
  </div>
  <div class="card" style="margin-top:24pt;">
    <div class="info-row"><span class="lbl">N° COTIZACIÓN</span><span>${esc(e.id)}</span></div>
    <div class="info-row"><span class="lbl">CLIENTE</span><span>${esc(e.cliente)}</span></div>
    <div class="info-row"><span class="lbl">OFERENTE</span><span>${esc(e.oferente.razon_social)} — RUT ${esc(e.oferente.rut)}</span></div>
    <div class="info-row"><span class="lbl">VALIDEZ</span><span>${esc(e.validez ? (e.validezCorta ?? e.validez) : "30 días desde la emisión")}</span></div>
  </div>
  <div class="footer">Presentado por KeepSync — ${mesAno}</div>
</div>

<div class="slide">
  ${sello}
  <h2>Alcance de la suscripción</h2>
  <p class="gray" style="font-size:11pt;max-width:9in;">${esc(glosaLineas)}, un usuario por suscripción, por ${esc(glosaVigencia)}, ${e.titularCliente ? `a nombre de ${esc(e.cliente)}, con activación, soporte y facturación de KeepSync` : `contratadas y administradas por KeepSync para ${esc(e.cliente)}`}.</p>
  <div class="grid3">
    <div class="card"><div class="num-badge">${usuariosTotal}</div><strong>${usuariosTotal === 1 ? "Suscripción" : "Suscripciones"}</strong><p class="gray" style="font-size:9.5pt;">Un asiento nominativo por usuario, sin compartir credenciales.</p></div>
    <div class="card"><div class="num-badge">${meses ?? "—"}</div><strong>Meses de vigencia</strong><p class="gray" style="font-size:9.5pt;">Período completo cotizado por adelantado, a precio cerrado en pesos.</p></div>
    <div class="card"><div class="num-badge">✓</div><strong>Gestión KeepSync</strong><p class="gray" style="font-size:9.5pt;">${e.titularCliente ? "Titularidad del cliente; activación asistida, soporte y facturación en CLP a cargo del oferente." : "Alta, soporte, renovación y facturación en CLP a cargo del oferente."}</p></div>
  </div>
  <h2 style="font-size:14pt;margin-top:22pt;">Qué incluye</h2>
  ${alcance.map((a) => `<div style="font-size:10.5pt;padding:3.5pt 0;"><span class="check">✓</span>${esc(a)}</div>`).join("")}
</div>

${e.laminaCumplimiento ? laminaCumplimientoHtml(e.laminaCumplimiento, sello) : ""}

<div class="slide">
  ${sello}
  <h1 style="font-size:24pt;">Cotización formal</h1>
  <p class="gray" style="font-size:10.5pt;">Valores en pesos chilenos (CLP). ${esc(e.titulo)} por ${esc(glosaVigencia)}, gestión y soporte de KeepSync.</p>
  <table class="card">
    <thead><tr><th>Descripción</th><th class="c">Cant.</th><th class="c">Meses</th><th class="r">Valor unit. mensual</th><th class="r">Subtotal neto</th></tr></thead>
    <tbody>${filas}</tbody>
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
    ${esc(e.oferente.razon_social)} — RUT ${esc(e.oferente.rut)} — ${esc(e.oferente.contacto_email)}${e.validez ? "" : " — Válido por 30 días"}
  </div>
</div>

</body>
</html>`;
}

function laminaCumplimientoHtml(l: LaminaCumplimiento, sello: string): string {
  const filas = l.filas
    .map(
      (f) =>
        `<tr><td style="width:23%;font-weight:bold;">${esc(f.requisito)}</td><td style="width:12%;" class="gray">${esc(f.referencia)}</td><td>${esc(f.cumplimiento)}</td><td class="c" style="width:7%;"><span class="check">✓</span></td></tr>`,
    )
    .join("");
  return `<div class="slide cumplimiento">
  ${sello}
  <style>
    .cumplimiento table { font-size: 7.6pt; }
    .cumplimiento th, .cumplimiento td { padding: 2.6pt 6pt; vertical-align: top; }
    .cumplimiento tbody tr { border-top: 1px solid rgba(255,255,255,0.07); }
    .cumplimiento ol { margin: 4pt 0 0; padding-left: 15pt; font-size: 7.8pt; }
    .cumplimiento ol li { margin-bottom: 2pt; }
  </style>
  <h2 style="font-size:17pt;margin-bottom:3pt;">${esc(l.titulo)}</h2>
  <p class="gray" style="font-size:8.5pt;margin:0 0 6pt;">${esc(l.intro)}</p>
  <table class="card" style="padding:0;">
    <thead><tr><th>Requisito</th><th>TDR</th><th>Cómo se cumple</th><th class="c">Cumple</th></tr></thead>
    <tbody>${filas}</tbody>
  </table>
  <h2 style="font-size:11.5pt;margin:9pt 0 0;">${esc(l.titulo_procedimiento)}</h2>
  <ol>${l.pasos.map((p) => `<li>${esc(p)}</li>`).join("")}</ol>
  ${l.nota ? `<p class="gray" style="font-size:7.4pt;margin:5pt 0 0;">${esc(l.nota)}</p>` : ""}
</div>`;
}

/**
 * Láminas cuyo contenido no cabe en su alto fijo. Las láminas llevan `overflow:hidden`, así que el
 * modo de falla natural es que una fila se corte en silencio — mismo control que el cotizador de
 * cursos (`generarCotizacionCapacitacionPdf`).
 */
export async function laminasDesbordadasSuscripcion(html: string): Promise<number[]> {
  return conPaginaHtml(html, "keepsync-suscripcion-mide-", (page) =>
    page.$$eval(".slide", (els) =>
      els.map((el, i) => (el.scrollHeight > el.clientHeight + 1 ? i + 1 : 0)).filter((n) => n > 0),
    ),
  );
}

/** Renderiza el HTML de `cotizarSuscripcionUsd` a PDF con el mismo Chromium que el resto de los nichos. */
export async function generarCotizacionSuscripcionPdf(html: string, outputPdfPath: string): Promise<void> {
  await renderizarPdfDesdeHtml(html, outputPdfPath, "keepsync-suscripcion-");
}
