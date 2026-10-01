/**
 * PDF descargable del estudio Fortinet (`npm run estudio-fortinet -- --solo-informe --pdf`).
 *
 * Mismo estilo único que las cotizaciones (`estilo-keepsync.ts`): láminas apaisadas, paleta y logo
 * KeepSync, Chromium para renderizar. Toda cifra sale de las filas que también producen
 * `output/estudio-fortinet.md`; lo único escrito a mano es la lectura (veredicto y oportunidades),
 * que es la misma de la sección de conclusiones del informe.
 */
import {
  PALETA_KEEPSYNC as C,
  cssLaminasKeepsync,
  escaparHtml as e,
  formatoClp as clp,
  logoKeepsyncBase64,
  renderizarPdfDesdeHtml,
} from "./estilo-keepsync.js";

export interface FilaPdf {
  codigo: string;
  nombre: string;
  texto: string;
  mes: string;
  anio: string;
  estado: string;
  tope: number;
  ofertas: number;
  organismo: string;
  familia: string;
  segmento: string;
  motivo: string | null;
}

const SEGMENTOS: [string, string][] = [
  ["fortinet", "Fortinet (marca o SKU)"],
  ["firewall", "Firewall, otras marcas"],
  ["switch", "Switch de red"],
  ["access_point", "Access point / WiFi"],
  ["transceptor", "Transceptores SFP"],
];

/** El stock del mayorista (Adistec, 2026-10-01), agrupado como lo nombra un TDR. */
const STOCK: [string, string, RegExp][] = [
  ["FortiGate 40F", "26", /\b(?:fg|fortigate)[- ]?40f\b/i],
  ["FortiGate 50G", "3", /\b(?:fg|fortigate)[- ]?50g\b/i],
  ["FortiGate 60F", "11", /\b(?:fg|fortigate)[- ]?60f\b/i],
  ["FortiGate 70G", "8", /\b(?:fg|fortigate)[- ]?70g\b/i],
  ["FortiGate 80F + FortiCare 80F", "30 + 1", /\b(?:fg|fortigate)[- ]?80f\b|fc-10-0080f/i],
  ["FortiGate 90G", "10", /\b(?:fg|fortigate)[- ]?90g\b/i],
  ["FortiGate 120G", "6", /\b(?:fg|fortigate)[- ]?120g\b/i],
  ["FortiGate 200G", "4", /\b(?:fg|fortigate)[- ]?200g\b/i],
  ["FortiSwitch 124F/124G/148F/1024E", "48", /\b(?:fs|fortiswitch)[- ]?(?:124[fg]|148f|1024e)\b/i],
  ["FortiAP 231K / 441K", "64", /\b(?:fap|fortiap)[- ]?(?:231k|441k)\b/i],
  ["Transceptores FN-TRAN / SFP+ SR", "11", /fn-tran|sfp\+? ?sr|10ge sfp\+ short range/i],
  ["GPI-130 / SP-FG80E-POE-PDC", "15", /gpi-?130|sp-fg80e/i],
];

/** Cómo terminan las que fracasan, leído del texto que escribió el organismo. */
const MOTIVOS: [string, RegExp][] = [
  ["Venció el plazo de selección (cancelación automática)", /vencimiento del plazo/i],
  ["Error de especificación, duplicidad o cambio del requerimiento", /error|duplicidad|cambio en el requerimiento|se modificar|volver[aá] a subir|nuevo proceso|ingreso los proveedores/i],
  ["Ofertas sobre el presupuesto o sobre 100 UTM", /presupuesto|100 utm|monto m[aá]ximo|monto solo/i],
  ["Ofertas inadmisibles técnicamente o de otro giro", /inadmisible|no cumple|no cumplen|giro/i],
  ["Nadie ofertó", /no se (?:presentaron|recibieron)|sin oferentes/i],
];

const pct = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)}%` : "—");
const mediana = (xs: number[]) => {
  const s = xs.filter((x) => x > 0).sort((a, b) => a - b);
  if (!s.length) return 0;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};
const resueltas = (fs: FilaPdf[]) => fs.filter((f) => f.estado !== "publicada");
const cerradas = (fs: FilaPdf[]) => fs.filter((f) => f.estado === "cerrada");

const FAMILIA_ES: Record<string, string> = {
  licencia_soporte: "Licencias y renovaciones",
  servicio: "Servicios (migración, configuración, cursos)",
  transceptor: "Transceptores",
  firewall: "Equipo firewall",
  switch: "Switch",
  access_point: "Access point",
  otro: "Otro",
};
const ESTADO_ES: Record<string, string> = {
  publicada: "Abierta",
  cerrada: "Cerrada ✓",
  desierta: "Desierta",
  cancelada: "Cancelada",
};

function css(): string {
  return (
    cssLaminasKeepsync() +
    `
  .slide { padding: 0.55in 0.7in; }
  .logo { height: 26pt; width: auto; align-self: flex-start; }
  .anexo td:nth-child(-n+2) { white-space: nowrap; }
  .top { display: flex; justify-content: space-between; align-items: center; margin-bottom: 14pt; }
  .kicker { font-size: 9pt; letter-spacing: .12em; text-transform: uppercase; color: ${C.accentLight}; }
  .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10pt; margin: 12pt 0 14pt; }
  .kpi { background: ${C.card}; border: 1px solid ${C.border}; border-radius: 10px; padding: 12pt 14pt; }
  .kpi .v { font-size: 26pt; font-weight: bold; }
  .kpi .l { font-size: 9pt; color: ${C.gray}; margin-top: 2pt; }
  .lead { font-size: 13pt; line-height: 1.45; }
  ul.b { margin: 0; padding-left: 15pt; font-size: 11pt; line-height: 1.45; }
  ul.b li { margin-bottom: 5pt; }
  table { font-size: 10pt; }
  th, td { padding: 6pt 8pt; border-bottom: 1px solid ${C.border}; }
  td.mut { color: ${C.gray}; }
  .bar { height: 12pt; border-radius: 0 4px 4px 0; background: ${C.accent}; }
  .bar.cero { background: none; }
  .ok { color: ${C.ok}; font-weight: bold; }
  .no { color: ${C.gray}; }
  .anexo td, .anexo th { font-size: 8.2pt; padding: 3.5pt 6pt; }
  .tag { display: inline-block; font-size: 8pt; border: 1px solid ${C.border}; border-radius: 10px; padding: 1pt 7pt; color: ${C.accentLight}; }
  .portada { display: flex; flex-direction: column; justify-content: space-between; height: 100%; }
  .portada h1 { font-size: 38pt; line-height: 1.1; max-width: 8.5in; }
  .veredicto { border-left: 4px solid ${C.accent}; padding: 8pt 0 8pt 14pt; font-size: 15pt; line-height: 1.4; max-width: 9in; }
  .footer { bottom: 0.3in; }`
  );
}

function marco(titulo: string, kicker: string, cuerpo: string, n: number, total: number, logo: string): string {
  return `<section class="slide">
  <div class="top"><div><div class="kicker">${e(kicker)}</div><h2>${e(titulo)}</h2></div>
  <img class="logo" src="data:image/png;base64,${logo}"></div>
  ${cuerpo}
  <div class="footer">Fuente: API de Compra Ágil (api2.mercadopublico.cl), compras publicadas entre ene-2025 y sep-2026, barrido del 2026-10-01 · KeepSync · ${n}/${total}</div>
</section>`;
}

export function htmlEstudioFortinet(filas: FilaPdf[], fechaBarrido: string): string {
  const logo = logoKeepsyncBase64();
  const seg = (s: string) => filas.filter((f) => f.segmento === s);
  const forti = seg("fortinet");
  const fr = resueltas(forti);
  const meses = 21;
  const ofertasProm = forti.reduce((s, f) => s + f.ofertas, 0) / (forti.length || 1);
  const montoCerrado = cerradas(forti).reduce((s, f) => s + f.tope, 0);
  const laminas: string[] = [];

  // 1 · Portada
  laminas.push(`<section class="slide"><div class="portada">
    <img class="logo" style="height:34pt" src="data:image/png;base64,${logo}">
    <div>
      <div class="kicker">Estudio de mercado · Compra Ágil 2025–2026</div>
      <h1>¿Hay negocio vendiendo equipos Fortinet por Compra Ágil?</h1>
      <p class="gray" style="font-size:13pt;max-width:8.5in">Demanda del Estado para el stock Fortinet del mayorista: FortiGate 40F a 200G, FortiSwitch, FortiAP, transceptores FN-TRAN y FortiCare.</p>
    </div>
    <div class="veredicto"><b>No como negocio de volumen.</b> Sí como nicho oportunista: renovaciones de licencia, transceptores y firewalls «o similar» de gama baja, con alerta en el radar y sin comprar stock.</div>
    <div class="gray" style="font-size:10pt">Barrido del ${e(fechaBarrido)} · ${filas.filter((f) => f.segmento !== "fuera").length} compras analizadas · KeepSync</div>
  </div></section>`);

  // 2 · Veredicto en cifras
  laminas.push(
    marco("La demanda Fortinet es chica y casi no se concreta", "Resumen ejecutivo", `
    <div class="kpis">
      <div class="kpi"><div class="v">${forti.length}</div><div class="l">compras que nombran Fortinet o un SKU en ${meses} meses</div></div>
      <div class="kpi"><div class="v">${(forti.length / meses).toFixed(1).replace(".", ",")}</div><div class="l">compras por mes (${forti.filter((f) => f.anio === "2025").length} en 2025, ${forti.filter((f) => f.anio === "2026").length} en 2026)</div></div>
      <div class="kpi"><div class="v">${pct(cerradas(forti).length, fr.length)}</div><div class="l">terminan cerradas (${cerradas(forti).length} de ${fr.length}); el instrumento rinde 7–10%</div></div>
      <div class="kpi"><div class="v">${ofertasProm.toFixed(1).replace(".", ",")}</div><div class="l">ofertas promedio por compra: casi no hay competencia</div></div>
    </div>
    <div class="grid2" style="margin-top:0">
      <div class="card"><b class="accent">Lo que dicen los datos</b><ul class="b" style="margin-top:6pt">
        <li>Suma de topes ${clp(forti.reduce((s, f) => s + f.tope, 0))}, pero lo que efectivamente cerró suma ${clp(montoCerrado)}.</li>
        <li>Se compran <b>licencias y servicios</b>, no equipos: ${forti.filter((f) => f.familia === "licencia_soporte").length} renovaciones y ${forti.filter((f) => f.familia === "servicio").length} servicios de ${forti.length}.</li>
        <li>El tope de <b>100 UTM (~$7M)</b> deja fuera a FortiGate medianos con licencia.</li>
        <li>Los fracasos son sobre todo del comprador: plazos vencidos, errores de especificación, ofertas inadmisibles.</li>
      </ul></div>
      <div class="card"><b class="accent">Qué hacer</b><ul class="b" style="margin-top:6pt">
        <li><b>No comprar stock</b> para Compra Ágil: de 12 grupos del stock, solo 3 aparecen alguna vez.</li>
        <li>Agregar Fortinet como <b>alerta del radar</b> (costo casi cero) y ofertar caso a caso.</li>
        <li>Foco: renovaciones FortiCare/UTP y FortiToken, transceptores, y firewall «o similar» con FG-40F a 90G.</li>
        <li>Medir el mismo stock en <b>licitaciones y Convenio Marco</b>, donde probablemente está el volumen.</li>
      </ul></div>
    </div>`, 2, 0, logo),
  );

  // 3 · Mercado por segmento
  const maxN = Math.max(...SEGMENTOS.map(([s]) => seg(s).length), 1);
  const filasSeg = SEGMENTOS.map(([s, nombre]) => {
    const fs = seg(s);
    const w = (fs.length / maxN) * 100;
    return `<tr><td>${s === "fortinet" ? `<b>${e(nombre)}</b>` : e(nombre)}</td>
      <td style="width:28%"><div style="display:flex;align-items:center;gap:6pt"><div class="bar" style="width:${w}%"></div><span>${fs.length}</span></div></td>
      <td class="r">${fs.filter((f) => f.anio === "2025").length}</td><td class="r">${fs.filter((f) => f.anio === "2026").length}</td>
      <td class="r">${cerradas(fs).length}</td><td class="r"><b>${pct(cerradas(fs).length, resueltas(fs).length)}</b></td>
      <td class="r">${clp(mediana(fs.map((f) => f.tope)))}</td><td class="r">${clp(fs.reduce((a, f) => a + f.tope, 0))}</td></tr>`;
  }).join("");
  laminas.push(
    marco("Fortinet frente a su mercado vecino", "Mercado por segmento · 2025–2026", `
    <table><thead><tr><th>Segmento</th><th>Compras</th><th class="r">2025</th><th class="r">2026</th><th class="r">Cerradas</th><th class="r">Éxito</th><th class="r">Tope mediano</th><th class="r">Suma de topes</th></tr></thead>
    <tbody>${filasSeg}</tbody></table>
    <div class="grid2">
      <div class="card"><b class="accent">Cómo leerlo</b><ul class="b" style="margin-top:6pt;font-size:10pt">
        <li>«Cerrada» es el único desenlace exitoso que expone la API; éxito = cerradas / compras ya resueltas.</li>
        <li>Switch, access point y SFP se cuentan por el nombre de la compra, de cualquier marca: es contra lo que compite un FortiSwitch o un FortiAP.</li>
        <li>El monto es el tope declarado, no lo adjudicado: la API no expone ganador ni precio.</li>
      </ul></div>
      <div class="card"><b class="accent">Lectura</b><ul class="b" style="margin-top:6pt;font-size:10pt">
        <li>Switch y WiFi tienen volumen pero son compras chicas y genéricas (mediana ~$1M), donde se compite por precio contra TP-Link o Ubiquiti.</li>
        <li>El <b>firewall genérico</b> es el único segmento sano (${pct(cerradas(seg("firewall")).length, resueltas(seg("firewall")).length)} de éxito), aunque parte son servicios de firewall administrado.</li>
      </ul></div>
    </div>`, 3, 0, logo),
  );

  // 4 · Stock vs demanda
  const filasStock = STOCK.map(([grupo, unidades, re]) => {
    const fs = forti.filter((f) => re.test(f.texto));
    const det = fs.map((f) => `${f.codigo} (${ESTADO_ES[f.estado] ?? f.estado})`).join(", ");
    return `<tr><td>${e(grupo)}</td><td class="r mut">${unidades}</td><td class="c ${fs.length ? "ok" : "no"}">${fs.length}</td><td class="mut" style="font-size:8.5pt">${e(det || "Nunca pedido en el período")}</td></tr>`;
  }).join("");
  const otrosModelos = "FG-100E/100F, FG-200F (licencias), FG-600E, FS-424E, FAP-221E";
  laminas.push(
    marco("Lo que hay en stock casi no aparece en la demanda", "Stock del mayorista vs. compras", `
    <table><thead><tr><th>Producto en stock</th><th class="r">Unidades</th><th class="c">Compras que lo piden</th><th>Cuáles y cómo terminaron</th></tr></thead>
    <tbody>${filasStock}</tbody></table>
    <p class="gray" style="font-size:10pt;margin-top:10pt">Los modelos Fortinet que sí pide el Estado en Compra Ágil son otros, mayoritariamente instalados hace años y para renovar su licencia: ${otrosModelos}.</p>`, 4, 0, logo),
  );

  // 5 · Qué se compra y por qué fracasa
  const fams = new Map<string, FilaPdf[]>();
  forti.forEach((f) => fams.set(f.familia, [...(fams.get(f.familia) ?? []), f]));
  const filasFam = [...fams].sort((a, b) => b[1].length - a[1].length).map(([fa, fs]) =>
    `<tr><td>${e(FAMILIA_ES[fa] ?? fa)}</td><td class="r">${fs.length}</td><td class="r">${cerradas(fs).length}</td><td class="r">${clp(mediana(fs.map((f) => f.tope)))}</td></tr>`).join("");
  const fracasos = fr.filter((f) => f.estado !== "cerrada");
  const conteoMot = MOTIVOS.map(([m, re]) => [m, fracasos.filter((f) => f.motivo && re.test(f.motivo)).length] as const);
  const sinClasificar = fracasos.filter((f) => !f.motivo || !MOTIVOS.some(([, re]) => re.test(f.motivo!))).length;
  const maxM = Math.max(...conteoMot.map(([, n]) => n), 1);
  const filasMot = [...conteoMot, ["Otro o sin motivo publicado", sinClasificar] as const].map(([m, n]) =>
    `<tr><td>${e(m)}</td><td style="width:34%"><div style="display:flex;align-items:center;gap:6pt"><div class="bar${n ? "" : " cero"}" style="width:${(n / maxM) * 100}%"></div><span>${n}</span></div></td></tr>`).join("");
  laminas.push(
    marco("Se compran licencias, y fracasan por el comprador", "Qué se compra y por qué no se concreta", `
    <div class="grid2" style="margin-top:0;grid-template-columns:1fr 1.15fr">
      <div><table><thead><tr><th>Qué se compra (Fortinet)</th><th class="r">Compras</th><th class="r">Cerradas</th><th class="r">Tope mediano</th></tr></thead><tbody>${filasFam}</tbody></table></div>
      <div><table><thead><tr><th>Motivo del fracaso (${fracasos.length} compras)</th><th>Compras</th></tr></thead><tbody>${filasMot}</tbody></table>
      <p class="gray" style="font-size:8.5pt;margin-top:6pt">Clasificado a partir del motivo que publica el organismo; una compra puede caer en más de una categoría.</p></div>
    </div>
    <div class="card" style="margin-top:14pt"><b class="accent">El tope de 100 UTM manda.</b>
      <span style="font-size:10.5pt">Segpres (<code>1051173-20-COT26</code>) quedó desierta porque las cotizaciones superaban las 100 UTM. Limache pidió FortiSwitch dos veces y las dos fracasaron por «superan presupuesto disponible». Varias compras se van al tope ($6,9M–$7,15M). Con licencia anual, solo un FortiGate de la gama 40F–90G cabe con holgura.</span></div>`, 5, 0, logo),
  );

  // 6 · Oportunidades
  const abiertas = filas.filter((f) => f.estado === "publicada" && (f.segmento === "fortinet" || f.segmento === "firewall"));
  laminas.push(
    marco("Dónde sí hay una oportunidad", "Recomendación", `
    <div class="grid3" style="margin-top:0">
      <div class="card"><div class="num-badge">1</div><b>Renovaciones de licencia</b><p class="gray" style="font-size:10pt">FortiCare/UTP, FortiToken, FortiAnalyzer. Se repiten cada año y el organismo republica tras un fracaso (Subsecretaría del Deporte 3 veces; Limache, Tarapacá, San Esteban, DIRECTEMAR). El SKU <b>FC-10-0080F-950-02-12</b> del stock es exactamente esto.</p></div>
      <div class="card"><div class="num-badge">2</div><b>Transceptores FN-TRAN</b><p class="gray" style="font-size:10pt">La única familia que cerró una compra en 2026: MINVU <code>587-172-COT26</code>, 12 SFP+ SR, tope $4M, 3 ofertas. Producto chico, fácil de despachar.</p></div>
      <div class="card"><div class="num-badge">3</div><b>Firewall «o similar»</b><p class="gray" style="font-size:10pt">Compras genéricas de firewall (${pct(cerradas(seg("firewall")).length, resueltas(seg("firewall")).length)} de éxito) donde un FG-40F a FG-90G con licencia de 1 año entra bajo ~$6M.</p></div>
    </div>
    <div class="grid2">
      <div class="card"><b class="accent">Abiertas hoy</b><ul class="b" style="margin-top:6pt;font-size:10pt">
        ${abiertas.map((f) => `<li><code>${e(f.codigo)}</code> · ${e(f.nombre.slice(0, 70))} · ${e(f.organismo.slice(0, 40))} · tope ${clp(f.tope)}</li>`).join("") || "<li>Ninguna</li>"}
      </ul></div>
      <div class="card"><b class="accent">Lo que este estudio no mide</b><ul class="b" style="margin-top:6pt;font-size:10pt">
        <li>El grueso del hardware Fortinet del Estado probablemente se compra por <b>Convenio Marco o licitación</b>: no está verificado acá.</li>
        <li>Ni ganador ni precio adjudicado: la API no los expone.</li>
        <li>3 detalles no se pudieron leer (error 500/504 de la API); se clasificaron solo por nombre.</li>
      </ul></div>
    </div>`, 6, 0, logo),
  );

  // 7+ · Anexo: las compras Fortinet
  const porLamina = 14;
  for (let i = 0; i < forti.length; i += porLamina) {
    const trozo = forti.slice(i, i + porLamina);
    const tr = trozo.map((f) => `<tr><td>${f.mes}</td><td><code>${e(f.codigo)}</code></td><td>${e(f.nombre.slice(0, 72))}</td><td>${e(f.organismo.slice(0, 38))}</td><td>${ESTADO_ES[f.estado] ?? f.estado}</td><td class="r">${clp(f.tope)}</td><td class="c">${f.ofertas}</td></tr>`).join("");
    laminas.push(
      marco(`Las ${forti.length} compras Fortinet (${i + 1}–${i + trozo.length})`, "Anexo", `
      <table class="anexo"><thead><tr><th>Mes</th><th>Código</th><th>Compra</th><th>Organismo</th><th>Estado</th><th class="r">Tope</th><th class="c">Ofertas</th></tr></thead><tbody>${tr}</tbody></table>`, 0, 0, logo),
    );
  }

  // Numeración real ahora que se sabe el total.
  const total = laminas.length;
  const numeradas = laminas.map((l, i) => l.replace(/ · \d+\/0<\/div>/, ` · ${i + 1}/${total}</div>`));
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Estudio Fortinet en Compra Ágil</title><style>${css()}</style></head><body>${numeradas.join("\n")}</body></html>`;
}

export async function generarPdfEstudioFortinet(filas: FilaPdf[], fechaBarrido: string, destino: string): Promise<void> {
  await renderizarPdfDesdeHtml(htmlEstudioFortinet(filas, fechaBarrido), destino, "estudio-fortinet-");
}
