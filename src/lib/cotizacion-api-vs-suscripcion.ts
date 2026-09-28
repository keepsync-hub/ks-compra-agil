import {
  PALETA_KEEPSYNC as COLOR,
  cssLaminasKeepsync,
  escaparHtml as esc,
  formatoClp,
  logoKeepsyncBase64,
  mesAnoEs,
  renderizarPdfDesdeHtml,
} from "./estilo-keepsync.js";
import {
  IMPUESTO_NO_RECUPERABLE_PCT,
  IVA_VENTA_PCT,
  MARKUP_USD_PCT,
  RECARGO_TIPO_CAMBIO_PCT,
  calcularCotizacionUsd,
  type CotizacionUsdResultado,
} from "./pricing-usd.js";
import type { IdentidadOferente } from "./capacitaciones.js";

/**
 * Propuesta para una Compra Ágil de licencias Claude cuyo tope no alcanza para las suscripciones
 * pedidas: compara la suscripción (valorizada con la regla `cotizar-usd`, la misma de
 * `npm run cotizar`) contra entregar las capacidades de Claude por **créditos prepagados de la API
 * de Anthropic**, con un valor final fijado bajo el tope (por defecto, 90% del presupuesto).
 *
 * Nació con `5178-4851-COT26` (U. de Chile, 12 Claude Pro × 12 meses con tope $183.120): la
 * suscripción sale en más de veinte veces el tope y el usuario pidió ofrecer la API como la forma
 * de entregar esas capacidades con el presupuesto publicado.
 *
 * Los créditos salen de invertir la misma regla: `usd = valor_final / (tc × 1,055 × 1,19 × 1,15 ×
 * 1,19)`, truncado al centavo para no prometer un dólar que el precio no cubre. El valor final es
 * exactamente el objetivo (tope × factor, redondeado al peso hacia abajo) y el neto se despeja
 * quitándole el IVA de venta: así el documento dice el número que pidió el usuario y la cantidad
 * de créditos es la que ese número paga bajo la regla.
 *
 * Lo que la API **no** es, y el documento lo dice en vez de esconderlo: no es la suscripción
 * individual Claude Pro. No incluye la aplicación claude.ai ni sus apps, y el uso queda acotado por
 * el saldo de créditos en vez de por los límites del plan. Las estimaciones de uso se publican con
 * sus supuestos (tokens por consulta) y el precio de lista de cada modelo con su fuente.
 */

export interface SuscripcionComparada {
  producto: string;
  precioListaUsdMes: number;
  usuarios: number;
  meses: number;
  fuentePrecioLista: string;
}

export interface ModeloApi {
  nombre: string;
  usdPorMillonEntrada: number;
  usdPorMillonSalida: number;
  fuente: string;
}

export interface PerfilConsulta {
  tokensEntrada: number;
  tokensSalida: number;
}

export interface ApiVsSuscripcionEntrada {
  id: string;
  codigo: string;
  nombreCompra: string;
  cliente: string;
  topeClp: number;
  /** Fracción del tope que se fija como valor final de la opción API (0,9 = 10% bajo el tope). */
  factorTope: number;
  /**
   * Fija los créditos en vez del precio: el valor en CLP sale de aplicarles la regla `cotizar-usd`
   * tal cual (en 5178-4851-COT26 el usuario pidió USD 100 redondos en vez de los 99,49 que paga el
   * 90% del tope). Si se pasa, `factorTope` no fija el precio; el resultado igual se rechaza si
   * supera el tope.
   */
  creditosUsd?: number;
  plazoEntregaDiasHabiles: number | null;
  suscripcion: SuscripcionComparada;
  /**
   * Usuarios a los que se habilita el acceso por API. Puede diferir de los de la suscripción: en
   * 5178-4851-COT26 el usuario pidió valorizar la suscripción para 1 usuario (lo mínimo que se
   * puede comprar) y mantener la API para los 12 que pide la compra. Por defecto, los mismos.
   */
  usuariosApi?: number;
  modelos: ModeloApi[];
  perfil: PerfilConsulta;
  tipoCambioObservado: number;
  fuenteTipoCambio: string;
  oferente: IdentidadOferente;
  fecha: Date;
}

export interface UsoEstimadoModelo {
  modelo: string;
  usd_por_consulta: number;
  consultas_totales: number;
  consultas_por_usuario_mes: number;
  fuente_precio: string;
}

export interface ApiVsSuscripcionResumen {
  id: string;
  codigo: string;
  cliente: string;
  tope_clp: number;
  factor_tope: number | null;
  fuente_tipo_cambio: string;
  tipo_cambio_observado: number;
  suscripcion: {
    producto: string;
    usuarios: number;
    meses: number;
    precio_lista_usd_mes: number;
    fuente_precio_lista: string;
    monto_usd: number;
    neto_clp: number;
    iva_clp: number;
    total_clp: number;
    veces_el_tope: number;
    calculo: CotizacionUsdResultado;
  };
  api: {
    usuarios: number;
    creditos_usd: number;
    neto_clp: number;
    iva_clp: number;
    total_clp: number;
    creditos_usd_por_usuario_mes: number;
    factor_regla: number;
    perfil_consulta: PerfilConsulta;
    uso_estimado: UsoEstimadoModelo[];
  };
  oferente: { razon_social: string; rut: string; contacto_email: string; campos_por_confirmar: string[] };
  emitida_en: string;
}

/** El multiplicador completo de la regla `cotizar-usd`, sin el tipo de cambio. */
export function factorReglaUsd(): number {
  return (
    (1 + RECARGO_TIPO_CAMBIO_PCT / 100) *
    (1 + IMPUESTO_NO_RECUPERABLE_PCT / 100) *
    (1 + MARKUP_USD_PCT / 100) *
    (1 + IVA_VENTA_PCT / 100)
  );
}

/**
 * Cuántos USD de créditos paga un valor final en CLP bajo la regla `cotizar-usd`, truncado al
 * centavo (redondear hacia arriba prometería créditos que el precio no cubre).
 */
export function creditosUsdParaValorFinal(valorFinalClp: number, tipoCambioObservado: number): number {
  if (!(valorFinalClp > 0)) throw new Error(`valor final debe ser mayor que 0 (recibido: ${valorFinalClp})`);
  if (!(tipoCambioObservado > 0)) throw new Error(`tipo de cambio debe ser mayor que 0 (recibido: ${tipoCambioObservado})`);
  return Math.floor((valorFinalClp / (tipoCambioObservado * factorReglaUsd())) * 100) / 100;
}

export function cotizarApiVsSuscripcion(e: ApiVsSuscripcionEntrada): { resumen: ApiVsSuscripcionResumen; html: string } {
  if (!(e.factorTope > 0 && e.factorTope <= 1)) {
    throw new Error(`factorTope debe estar en (0, 1] — nunca se cotiza sobre el tope (recibido: ${e.factorTope})`);
  }
  if (!e.modelos.length) throw new Error("Falta al menos un modelo de la API para estimar el uso.");

  const s = e.suscripcion;
  const montoUsd = s.precioListaUsdMes * s.usuarios * s.meses;
  const calc = calcularCotizacionUsd(montoUsd, e.tipoCambioObservado);

  let totalApi: number;
  let netoApi: number;
  let creditos: number;
  if (e.creditosUsd !== undefined) {
    if (!(e.creditosUsd > 0)) throw new Error(`creditosUsd debe ser mayor que 0 (recibido: ${e.creditosUsd})`);
    const calcApi = calcularCotizacionUsd(e.creditosUsd, e.tipoCambioObservado);
    creditos = e.creditosUsd;
    totalApi = calcApi.valor_final_clp;
    netoApi = calcApi.precio_cotizacion_clp;
  } else {
    totalApi = Math.floor(e.topeClp * e.factorTope);
    netoApi = Math.round(totalApi / (1 + IVA_VENTA_PCT / 100));
    creditos = creditosUsdParaValorFinal(totalApi, e.tipoCambioObservado);
  }
  if (totalApi > e.topeClp) {
    throw new Error(`El valor final de la opción API (${totalApi}) supera el tope (${e.topeClp}): no se cotiza.`);
  }
  const usuariosApi = e.usuariosApi ?? s.usuarios;
  if (!(usuariosApi > 0) || !Number.isInteger(usuariosApi)) throw new Error(`usuariosApi debe ser un entero mayor que 0 (recibido: ${usuariosApi})`);
  const usuariosMes = usuariosApi * s.meses;

  const uso: UsoEstimadoModelo[] = e.modelos.map((m) => {
    const usdConsulta =
      (e.perfil.tokensEntrada * m.usdPorMillonEntrada + e.perfil.tokensSalida * m.usdPorMillonSalida) / 1_000_000;
    const total = Math.floor(creditos / usdConsulta);
    return {
      modelo: m.nombre,
      usd_por_consulta: Math.round(usdConsulta * 100000) / 100000,
      consultas_totales: total,
      consultas_por_usuario_mes: Math.floor(total / usuariosMes),
      fuente_precio: m.fuente,
    };
  });

  const resumen: ApiVsSuscripcionResumen = {
    id: e.id,
    codigo: e.codigo,
    cliente: e.cliente,
    tope_clp: e.topeClp,
    factor_tope: e.creditosUsd !== undefined ? null : e.factorTope,
    fuente_tipo_cambio: e.fuenteTipoCambio,
    tipo_cambio_observado: e.tipoCambioObservado,
    suscripcion: {
      producto: s.producto,
      usuarios: s.usuarios,
      meses: s.meses,
      precio_lista_usd_mes: s.precioListaUsdMes,
      fuente_precio_lista: s.fuentePrecioLista,
      monto_usd: montoUsd,
      neto_clp: calc.precio_cotizacion_clp,
      iva_clp: calc.valor_final_clp - calc.precio_cotizacion_clp,
      total_clp: calc.valor_final_clp,
      veces_el_tope: Math.round((calc.valor_final_clp / e.topeClp) * 10) / 10,
      calculo: calc,
    },
    api: {
      usuarios: usuariosApi,
      creditos_usd: creditos,
      neto_clp: netoApi,
      iva_clp: totalApi - netoApi,
      total_clp: totalApi,
      creditos_usd_por_usuario_mes: Math.round((creditos / usuariosMes) * 100) / 100,
      factor_regla: Math.round(factorReglaUsd() * 1e6) / 1e6,
      perfil_consulta: e.perfil,
      uso_estimado: uso,
    },
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

/** Mismo criterio que `cotizacion-suscripcion-usd.ts`: el sello depende de lo que el documento afirma. */
function identidadSuficiente(o: IdentidadOferente): boolean {
  const pendiente = (v: string) => !v || /por confirmar/i.test(v);
  return !pendiente(o.razon_social) && !pendiente(o.rut) && !pendiente(o.contacto_email);
}

const usd = (n: number) => "USD " + n.toLocaleString("es-CL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const entero = (n: number) => n.toLocaleString("es-CL");

function generarHtml(e: ApiVsSuscripcionEntrada, r: ApiVsSuscripcionResumen): string {
  const logoBase64 = logoKeepsyncBase64();
  const mesAno = mesAnoEs(e.fecha);
  const suficiente = identidadSuficiente(e.oferente);
  const sello = suficiente ? "" : `<div class="badge">BORRADOR — identidad del oferente sin confirmar</div>`;
  const s = r.suscripcion;
  const a = r.api;
  const pctTope = (Math.round((a.total_clp / e.topeClp) * 1000) / 10).toLocaleString("es-CL");
  const ua = a.usuarios;
  const pl = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;
  const glosaSus = pl(s.usuarios, "usuario", "usuarios");
  const glosaApi = pl(ua, "usuario", "usuarios");
  const losApi = ua === 1 ? "del usuario" : `de los ${ua} usuarios`;
  const plazo =
    e.plazoEntregaDiasHabiles !== null
      ? `${e.plazoEntregaDiasHabiles} días hábiles desde la emisión de la orden de compra`
      : "a convenir con el organismo";

  const filasUso = a.uso_estimado
    .map(
      (u) => `
      <tr>
        <td>${esc(u.modelo)}</td>
        <td class="r">USD ${u.usd_por_consulta.toLocaleString("es-CL", { minimumFractionDigits: 3, maximumFractionDigits: 3 })}</td>
        <td class="r">${entero(u.consultas_totales)}</td>
        <td class="r">${entero(u.consultas_por_usuario_mes)}</td>
      </tr>`,
    )
    .join("");

  const condiciones = [
    `Forma propuesta por KeepSync para entregar las capacidades de ${s.producto} a ${glosaApi} durante ${s.meses} meses con el presupuesto publicado en la Compra Ágil ${e.codigo}.`,
    `Plazo de entrega: ${plazo}.`,
    `Garantía por toda la duración del servicio (${s.meses} meses): KeepSync responde por la habilitación y continuidad del acceso ${losApi} y por el saldo de créditos contratado.`,
    "Facturación en pesos chilenos por KeepSync, una vez entregado el servicio: el organismo no asume pagos en dólares ni variación cambiaria.",
    "Válida por 30 días desde la emisión.",
  ];

  return `<!doctype html>
<html lang="es-CL">
<head>
<meta charset="utf-8">
<title>Propuesta ${esc(e.id)} — Claude vía API</title>
<style>${cssLaminasKeepsync()}
  table.cmp td { font-size: 10pt; padding: 6pt 9pt; vertical-align: top; border-top: 1px solid ${COLOR.border}; }
  table.cmp th { font-size: 8.5pt; }
  .ok { color: ${COLOR.ok}; font-weight: bold; }
  .warn { color: ${COLOR.warn}; font-weight: bold; }
  .nota { font-size: 8.5pt; color: ${COLOR.gray}; margin-top: 6pt; }
</style>
</head>
<body>

<div class="slide">
  ${sello}
  <img src="data:image/png;base64,${logoBase64}" style="width:52pt;height:52pt;position:absolute;top:0.6in;left:0.7in;">
  <div style="position:absolute;top:0.75in;left:1.5in;font-size:16pt;font-weight:bold;">KeepSync</div>
  <div style="margin-top:1.6in;">
    <h1>PROPUESTA</h1>
    <div class="accent" style="font-size:16pt;margin-bottom:10pt;">Capacidades de ${esc(s.producto)} a través de la API de Anthropic — ${glosaApi}, ${s.meses} meses</div>
    <div class="gray" style="font-size:11pt;">Dirigida a ${esc(e.cliente)} — Compra Ágil ${esc(e.codigo)}</div>
  </div>
  <div class="card" style="margin-top:22pt;">
    <div class="info-row"><span class="lbl">N° PROPUESTA</span><span>${esc(e.id)}</span></div>
    <div class="info-row"><span class="lbl">COMPRA ÁGIL</span><span>${esc(e.codigo)} — ${esc(e.nombreCompra)}</span></div>
    <div class="info-row"><span class="lbl">OFERENTE</span><span>${esc(e.oferente.razon_social)} — RUT ${esc(e.oferente.rut)}</span></div>
    <div class="info-row"><span class="lbl">VALOR TOTAL</span><span>${formatoClp(a.total_clp)} IVA incluido (${pctTope}% del presupuesto de ${formatoClp(e.topeClp)})</span></div>
    <div class="info-row"><span class="lbl">VALIDEZ</span><span>30 días desde la emisión</span></div>
  </div>
  <div class="footer">Presentado por KeepSync — ${mesAno}</div>
</div>

<div class="slide">
  ${sello}
  <h2>Suscripción o API: la comparación</h2>
  <p class="gray" style="font-size:10.5pt;max-width:10in;margin:0 0 10pt;">Ambas opciones valorizadas con el mismo tipo de cambio y la misma regla de precios de KeepSync. La suscripción individual no cabe en el presupuesto publicado; la API sí, y es la forma que KeepSync propone para entregar las capacidades de ${esc(s.producto)} con ese presupuesto.</p>
  <table class="card cmp">
    <thead><tr><th style="width:24%"></th><th style="width:38%">Suscripción ${esc(s.producto)} (${glosaSus})</th><th style="width:38%">Créditos API de Anthropic (propuesta)</th></tr></thead>
    <tbody>
      <tr><td class="gray">Qué se entrega</td><td>${s.usuarios === 1 ? "1 suscripción individual" : `${s.usuarios} suscripciones individuales, una por usuario,`} por ${s.meses} meses${s.usuarios < ua ? `: cubre ${glosaSus} de los ${ua} que pide la compra` : ""}.</td><td>Saldo prepagado de ${usd(a.creditos_usd)} en créditos de la API, con acceso para ${ua === 1 ? "1 usuario" : `los ${ua} usuarios`} durante ${s.meses} meses.</td></tr>
      <tr><td class="gray">Cómo se usa</td><td>Aplicación claude.ai (web, escritorio y móvil).</td><td>Acceso a los modelos de Claude por la API de Anthropic, con cuentas habilitadas por KeepSync.</td></tr>
      <tr><td class="gray">Límite de uso</td><td>Los límites de uso del plan, por usuario.</td><td>El saldo de créditos${ua === 1 ? "" : ", compartido"}: se consume por tokens según el modelo que se use.</td></tr>
      <tr><td class="gray">Valor total (IVA incl.)</td><td class="warn">${formatoClp(s.total_clp)}</td><td class="ok">${formatoClp(a.total_clp)}</td></tr>
      <tr><td class="gray">Frente al presupuesto de ${formatoClp(e.topeClp)}</td><td class="warn">${s.veces_el_tope.toLocaleString("es-CL")} veces el presupuesto — no cabe</td><td class="ok">${pctTope}% del presupuesto — cabe</td></tr>
    </tbody>
  </table>
  <div class="nota">Suscripción: precio de lista USD ${s.precio_lista_usd_mes}/usuario/mes × ${glosaSus} × ${s.meses} meses (${esc(s.fuente_precio_lista)}). Tipo de cambio: dólar observado del Banco Central de Chile a la fecha de emisión.</div>
</div>

<div class="slide">
  ${sello}
  <h2>Cuánto rinde el saldo de créditos</h2>
  <p class="gray" style="font-size:10.5pt;max-width:10in;margin:0 0 8pt;">${usd(a.creditos_usd)} equivalen a ${usd(a.creditos_usd_por_usuario_mes)} por usuario y por mes. La API cobra por tokens procesados, así que el rendimiento depende del modelo elegido y del largo de cada consulta. Estimación para una consulta típica de ${entero(e.perfil.tokensEntrada)} tokens de entrada y ${entero(e.perfil.tokensSalida)} de salida:</p>
  <table class="card cmp">
    <thead><tr><th>Modelo</th><th class="r">Costo por consulta</th><th class="r">Consultas con el saldo</th><th class="r">Por usuario al mes</th></tr></thead>
    <tbody>${filasUso}</tbody>
  </table>
  <div class="nota">Precios públicos de la API de Anthropic por millón de tokens: ${a.uso_estimado.map((u) => esc(u.modelo) + " — " + esc(u.fuente_precio)).join("; ")}. Consultas más largas, documentos adjuntos o razonamiento extendido consumen más tokens y reducen estas cifras.</div>
  <div class="grid2" style="margin-top:12pt;">
    <div class="card">
      <strong>Qué incluye</strong>
      <div style="font-size:9.5pt;padding-top:4pt;"><span class="check">✓</span>Habilitación del acceso ${losApi} y carga del saldo de créditos.</div>
      <div style="font-size:9.5pt;"><span class="check">✓</span>Seguimiento del consumo y aviso al organismo antes de agotar el saldo.</div>
      <div style="font-size:9.5pt;"><span class="check">✓</span>Taller de buenas prácticas de 3 horas y acceso a la comunidad de usuarios de Claude en Chile, sin costo.</div>
      <div style="font-size:9.5pt;"><span class="check">✓</span>Soporte de primer nivel por correo durante los ${s.meses} meses.</div>
    </div>
    <div class="card">
      <strong>Qué no incluye</strong>
      <div class="gray" style="font-size:9.5pt;padding-top:4pt;">• No es la suscripción individual ${esc(s.producto)}: no incluye la aplicación claude.ai ni sus apps de escritorio y móvil.</div>
      <div class="gray" style="font-size:9.5pt;">• El uso no es ilimitado dentro de límites del plan: lo acota el saldo de créditos.</div>
      <div class="gray" style="font-size:9.5pt;">• Recargas de saldo adicionales se cotizan aparte, a solicitud del organismo.</div>
    </div>
  </div>
</div>

<div class="slide">
  ${sello}
  <h1 style="font-size:24pt;">Cotización formal</h1>
  <p class="gray" style="font-size:10.5pt;">Valores en pesos chilenos (CLP). Compra Ágil ${esc(e.codigo)} — ${esc(e.cliente)}.</p>
  <table class="card">
    <thead><tr><th>Descripción</th><th class="c">Usuarios</th><th class="c">Meses</th><th class="r">Subtotal neto</th></tr></thead>
    <tbody>
      <tr>
        <td>Acceso a las capacidades de ${esc(s.producto)} mediante créditos prepagados de la API de Anthropic (${usd(a.creditos_usd)}), habilitación, taller y soporte KeepSync</td>
        <td class="c">${ua}</td>
        <td class="c">${s.meses}</td>
        <td class="r">${formatoClp(a.neto_clp)}</td>
      </tr>
    </tbody>
  </table>
  <div style="display:flex;justify-content:flex-end;margin-top:10pt;">
    <div class="totales" style="width:3.3in;">
      <div class="fila"><span class="gray">Neto</span><span>${formatoClp(a.neto_clp)}</span></div>
      <div class="fila"><span class="gray">IVA 19%</span><span>${formatoClp(a.iva_clp)}</span></div>
      <div class="fila total"><span>TOTAL</span><span>${formatoClp(a.total_clp)}</span></div>
    </div>
  </div>
  <h2 style="font-size:13pt;margin-top:14pt;">Condiciones comerciales</h2>
  <ul class="cond">${condiciones.map((c) => `<li>${esc(c)}</li>`).join("")}</ul>
  <div class="footer" style="color:${suficiente ? COLOR.gray : COLOR.warn};font-weight:${suficiente ? "normal" : "bold"};">
    ${esc(e.oferente.razon_social)} — RUT ${esc(e.oferente.rut)} — ${esc(e.oferente.contacto_email)} — Válido por 30 días
  </div>
</div>

</body>
</html>`;
}

export async function generarApiVsSuscripcionPdf(html: string, outputPdfPath: string): Promise<void> {
  await renderizarPdfDesdeHtml(html, outputPdfPath, "keepsync-api-vs-suscripcion-");
}
