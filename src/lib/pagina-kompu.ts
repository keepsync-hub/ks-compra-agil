/**
 * Genera `docs/kompu.html`: el radar de hardware TI para Kompu.cl.
 *
 * Página **nueva y separada**, escrita entera desde cero — mismo patrón que `docs/leads.html` y
 * `docs/transformacion-digital.html`. No usa marcadores y por lo tanto no puede pisar los tres
 * pares que `npm run radar` y `npm run cotizar-capacitacion` refrescan en `docs/index.html`.
 *
 * El criterio de qué va acá es el mismo del resto de las páginas publicadas: si un párrafo no
 * ayuda a decidir si participar en una compra concreta —o si el rubro vale la pena—, no va.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ROOT_DIR } from "./config.js";
import { escaparHtml } from "./estilo-keepsync.js";
import type { CeldaCenso, Naturaleza, ObservacionKompu, ResumenRubro, RubroKompu } from "./kompu.js";

const PAGINA_PATH = path.join(ROOT_DIR, "docs", "kompu.html");

const esc = (s: string | number | null | undefined): string => escaparHtml(String(s ?? ""));

const clp = (n: number | null): string => (n == null ? "—" : `$${n.toLocaleString("es-CL")}`);
const pct = (x: number | null, dec = 0): string => (x == null ? "—" : `${(x * 100).toFixed(dec)}%`);
const fecha = (s: string | null): string => (s ? s.slice(0, 10) : "—");

const GLOSA_ESTADO: Record<string, string> = {
  publicada: "abierta",
  proveedor_seleccionado: "con proveedor",
  cerrada: "cerrada",
  desierta: "desierta",
  cancelada: "cancelada",
};

export interface ResumenCorridaKompu {
  generado_en: string;
  rubros: ResumenRubro[];
  celdas: CeldaCenso[];
  /** Cuándo se midió el censo. Puede ser anterior a `generado_en` si se republicó con `--solo-indice`. */
  censo_de: string | null;
  descartados: { codigo: string; nombre: string; rubros: string[] }[];
  observaciones: ObservacionKompu[];
  requests: number;
  cuota_agotada: boolean;
  solo_indice: boolean;
  estados: string[];
  /** Tasa de éxito transversal ya medida para TODO Compra Ágil (output/estudio-mercado.md). */
  referencia_exito: [number, number];
}

function diasRestantes(cierre: string): number | null {
  if (!cierre) return null;
  const t = Date.parse(cierre.replace(" ", "T"));
  if (Number.isNaN(t)) return null;
  return Math.ceil((t - Date.now()) / 86_400_000);
}

// ── Sección 1: ¿hay mercado? ──────────────────────────────────────────────────────────────────

function tarjetaRubro(r: ResumenRubro, ref: [number, number]): string {
  if (r.total === 0 && r.resueltasEstimadas === 0) {
    return `<article class="rubro vacio">
      <h3>${esc(r.nombre)}</h3>
      <p class="section-sub">Sin compras observadas todavía. <strong>No es un cero medido</strong>: es que
      ninguna consulta de este rubro devolvió una compra que pasara el filtro sobre el nombre.</p>
    </article>`;
  }
  const [refMin, refMax] = ref;
  let veredicto = "";
  if (r.tasaExito != null && r.resueltasEstimadas >= 50) {
    const t = r.tasaExito;
    const clase = t > refMax ? "ok" : t < refMin ? "bad" : "";
    // "muy por encima" para un 1,2× sería exagerar: el adjetivo sigue a la magnitud, no al signo.
    const compara =
      t > refMax * 1.5 ? "muy por encima" : t > refMax ? "algo por encima" : t < refMin ? "por debajo" : "dentro";
    const veces = t > refMax ? ` (<strong>${(t / refMax).toFixed(1)}×</strong> el techo de esa referencia)` : "";
    veredicto = `<p class="veredicto ${clase}">Termina en compra el <strong>${pct(t)}</strong> de las
      ~${r.resueltasEstimadas.toLocaleString("es-CL")} ya resueltas: ${compara} del ${pct(refMin)}–${pct(refMax)}
      que rinde Compra Ágil en todos los rubros medidos${veces}.</p>`;
  } else if (r.tasaExito != null) {
    veredicto = `<p class="veredicto">~${r.resueltasEstimadas} compra(s) resueltas estimadas:
      <strong>muy pocas para una tasa confiable</strong>. Se publica el volumen, no un porcentaje.</p>`;
  }

  const filasVol = ["publicada", "proveedor_seleccionado", "cerrada", "desierta", "cancelada"]
    .filter((e) => r.volumen[e])
    .map((e) => {
      const v = r.volumen[e]!;
      const rango =
        v.mayorVariante === v.sumaVariantes
          ? v.sumaVariantes.toLocaleString("es-CL")
          : `${v.mayorVariante.toLocaleString("es-CL")} – ${v.sumaVariantes.toLocaleString("es-CL")}`;
      const avisos = [v.topeado ? "topeado en 10.000" : "", v.truncado ? "muestra parcial" : ""]
        .filter(Boolean)
        .join(", ");
      return `<tr><th><span class="est est-${esc(e)}">${esc(GLOSA_ESTADO[e] ?? e)}</span></th>
        <td>${rango}</td><td class="aviso">${esc(avisos) || "—"}</td></tr>`;
    })
    .join("");

  const nat = (["producto", "servicio", "arriendo"] as Naturaleza[])
    .filter((k) => r.porNaturaleza[k] > 0)
    .map((k) => `<li><span class="nat nat-${k}">${k}</span> ${r.porNaturaleza[k]}</li>`)
    .join("");

  const recomp = r.recompradores.length
    ? `<details class="recomp"><summary>${r.recompradores.length} organismo(s) compraron esto más de una vez</summary>
         <ul>${r.recompradores
           .slice(0, 15)
           .map((o) => `<li>${esc(o.organismo)} — <strong>${o.compras}</strong> compras, ${clp(o.montoTotalClp)} en total</li>`)
           .join("")}</ul>
         <p class="cobertura">Contado sobre la muestra, así que es un <strong>piso</strong>: un organismo
         que compró diez veces y del que la muestra vio dos, aparece con dos.</p>
       </details>`
    : `<p class="section-sub">Ningún organismo repitió compra en este rubro dentro de la muestra.</p>`;

  return `<article class="rubro">
    <h3>${esc(r.nombre)}</h3>
    <div class="stat-grid">
      <div class="stat"><div class="num">${r.abiertas}</div><div class="label">abiertas ahora</div></div>
      <div class="stat"><div class="num">${r.tasaExito == null ? "—" : pct(r.tasaExito)}</div><div class="label">termina en compra</div></div>
      <div class="stat"><div class="num">${clp(r.montoMedianoClp)}</div><div class="label">monto mediano (muestra)</div></div>
      <div class="stat"><div class="num">${r.ofertasMedianas ?? "—"}</div><div class="label">ofertas por compra (muestra)</div></div>
    </div>
    ${veredicto}
    <div class="cols">
      <div>
        <h4>Volumen por estado</h4>
        <table class="detalle vol"><tbody>${filasVol}</tbody></table>
        <p class="cobertura">Estimado desde <code>total_resultados</code> corregido por la precisión medida.
        El rango va del <strong>piso</strong> (la variante más grande sola, sin contar dos veces) al
        <strong>techo</strong> (la suma de las variantes, que sí cuenta los solapes).</p>
      </div>
      <div>
        <h4>Qué se compra <span class="aviso">(muestra: ${r.total})</span></h4>
        <ul class="pills">${nat}</ul>
        ${recomp}
      </div>
    </div>
    <p class="cobertura">Publicaciones de la muestra entre <strong>${fecha(r.fechaMin)}</strong> y
      <strong>${fecha(r.fechaMax)}</strong>. Es el rango que alcanzó este barrido, no la historia completa
      del rubro.</p>
  </article>`;
}

// ── Sección 2: abiertas ahora ─────────────────────────────────────────────────────────────────

function tarjetaCompra(o: ObservacionKompu, rubros: RubroKompu[]): string {
  const dias = diasRestantes(o.fecha_cierre);
  const urgente = dias != null && dias <= 2;
  const chips = o.rubros
    .map((id) => rubros.find((r) => r.id === id)?.nombreCorto ?? id)
    .map((n) => `<span class="chip">${esc(n)}</span>`)
    .join("");
  const emt =
    o.estado_convocatoria === 1
      ? `<span class="chip emt">primer llamado — solo EMT</span>`
      : `<span class="chip">segundo llamado — abierto a todos</span>`;
  return `<article class="compra" data-rubros="${esc(o.rubros.join(","))}" data-naturaleza="${esc(o.naturaleza)}">
    <h3><a href="https://www.mercadopublico.cl" rel="noopener">${esc(o.nombre || o.codigo)}</a></h3>
    <p class="org">${esc(o.organismo)} · ${esc(o.nombre_region)}</p>
    <div class="chips">${chips}<span class="chip nat nat-${esc(o.naturaleza)}">${esc(o.naturaleza)}</span>${emt}</div>
    <table class="detalle">
      <tr><th>Código</th><td class="mono">${esc(o.codigo)}</td></tr>
      <tr><th>Tope disponible</th><td><strong>${clp(o.monto_disponible_clp)}</strong></td></tr>
      <tr><th>Cierra</th><td class="${urgente ? "urgente" : ""}">${esc(o.fecha_cierre || "—")}${
        dias != null ? ` (${dias <= 0 ? "hoy o vencida" : `${dias} día(s)`})` : ""
      }</td></tr>
      <tr><th>Ofertas recibidas</th><td>${o.total_ofertas_recibidas}</td></tr>
    </table>
  </article>`;
}

// ── Sección 4: cobertura y método ─────────────────────────────────────────────────────────────

function tablaCobertura(celdas: CeldaCenso[]): string {
  const porVariante = new Map<string, CeldaCenso[]>();
  for (const c of celdas) {
    const l = porVariante.get(c.variante) ?? [];
    l.push(c);
    porVariante.set(c.variante, l);
  }
  const filas = [...porVariante.entries()]
    .map(([variante, cs]) => {
      const total = cs.reduce((a, c) => a + (c.error ? 0 : c.total_resultados), 0);
      const prec = cs.map((c) => c.precision).filter((p): p is number => p != null);
      const precMedia = prec.length ? prec.reduce((a, b) => a + b, 0) / prec.length : null;
      const fallidas = cs.filter((c) => c.error);
      const topeadas = cs.filter((c) => c.topeado);
      const truncadas = cs.filter((c) => c.truncado);
      const avisos = [
        topeadas.length ? `${topeadas.length} topeada(s) en 10.000` : "",
        truncadas.length ? `${truncadas.length} truncada(s)` : "",
        fallidas.length ? `${fallidas.length} no medida(s)` : "",
      ]
        .filter(Boolean)
        .join(" · ");
      return `<tr>
        <td class="mono">${esc(variante)}</td>
        <td>${total.toLocaleString("es-CL")}${topeadas.length || truncadas.length ? " <span class=\"cota\">≥</span>" : ""}</td>
        <td>${precMedia == null ? "—" : pct(precMedia)}</td>
        <td class="aviso">${esc(avisos) || "—"}</td>
      </tr>`;
    })
    .join("");
  return `<table class="detalle">
    <thead><tr><th>Consulta <code>q</code></th><th>Resultados (cota superior)</th><th>Precisión en el nombre</th><th>Avisos</th></tr></thead>
    <tbody>${filas}</tbody>
  </table>`;
}

// ── Página ────────────────────────────────────────────────────────────────────────────────────

export function generarPaginaKompu(r: ResumenCorridaKompu, rubros: RubroKompu[]): string {
  const abiertas = r.observaciones
    .filter((o) => o.estado === "publicada" && o.rubros.length > 0)
    .sort((a, b) => (a.fecha_cierre || "").localeCompare(b.fecha_cierre || ""));
  const porVerificar = r.observaciones.filter((o) => o.rubros.length === 0 && o.por_verificar.length > 0);
  const totalObs = r.observaciones.length;
  const [refMin, refMax] = r.referencia_exito;

  const avisoCuota = r.cuota_agotada
    ? `<div class="note">La cuota de la API se agotó a mitad de corrida. <strong>La página se publica igual</strong>
       con lo ya descubierto, pero la cobertura de abajo está incompleta y los conteos son cotas inferiores.
       No se reintentó a ciegas: es el guardrail del repositorio.</div>`
    : "";
  const avisoIndice = r.solo_indice
    ? `<div class="note info">Corrida <code>--solo-indice</code>: <strong>0 requests a la API</strong>. Todo
       sale de <code>historico/kompu.jsonl</code> y del censo${
         r.censo_de ? ` medido el ${esc(r.censo_de.slice(0, 10))}` : ""
       }, así que puede estar desactualizado — un estado «abierta» de hace días hoy puede estar cerrado.</div>`
    : "";

  return `<!doctype html>
<html lang="es-CL">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Kompu — hardware TI en Compra Ágil</title>
<meta name="description" content="Compras Ágiles de tóner, impresoras, multifuncionales, notebooks, UPS y CCTV en mercadopublico.cl: qué está abierto ahora y si el rubro tiene mercado, medido sobre los cinco estados.">
<meta name="robots" content="noindex, nofollow">
<style>
  :root {
    --bg: #0E0E17; --bg-alt: #09090B; --card: #161527; --card-alt: #1D1B33; --border: #2A2844;
    --accent: #786CF0; --accent-light: #B4AAFA; --white: #FFFFFF; --gray: #9A9FB0; --gray-dim: #6E7284;
    --ok: #4ADE80; --warn: #FBBF24; --bad: #FB7185;
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--white); font-family: -apple-system, "Segoe UI", Arial, sans-serif; line-height: 1.55; }
  .wrap { max-width: 1080px; margin: 0 auto; padding: 0 1.5rem; }
  header.hero { background: linear-gradient(180deg, var(--bg-alt) 0%, var(--bg) 100%); border-bottom: 1px solid var(--border); padding: 2.5rem 0 2rem; }
  h1 { font-size: clamp(1.6rem, 4vw, 2.3rem); margin: 0 0 0.5rem; }
  .subtitle { color: var(--gray); font-size: 1.02rem; max-width: 72ch; }
  .meta { color: var(--gray-dim); font-size: 0.85rem; margin-top: 1rem; }
  main { padding: 2.5rem 0 4rem; }
  section { margin-bottom: 2.8rem; }
  h2 { font-size: 1.35rem; margin: 0 0 0.3rem; }
  h3 { font-size: 1.05rem; margin: 0 0 0.35rem; }
  h4 { font-size: 0.82rem; color: var(--gray-dim); font-weight: 500; margin: 0 0 0.4rem; text-transform: uppercase; letter-spacing: 0.04em; }
  .section-sub { color: var(--gray); font-size: 0.92rem; margin: 0 0 1.1rem; max-width: 74ch; }
  .stat-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 0.7rem; margin: 0.9rem 0; }
  .stat { background: var(--card-alt); border: 1px solid var(--border); border-radius: 10px; padding: 0.85rem 1rem; }
  .stat .num { font-size: 1.45rem; font-weight: 700; color: var(--accent-light); line-height: 1.15; }
  .stat .label { color: var(--gray); font-size: 0.78rem; margin-top: 0.3rem; }
  .rubro { background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 1.2rem 1.3rem; margin-bottom: 1rem; }
  .rubro.vacio { opacity: 0.72; }
  .veredicto { font-size: 0.92rem; color: var(--gray); margin: 0.5rem 0 0.9rem; }
  .veredicto.ok strong { color: var(--ok); }
  .veredicto.bad strong { color: var(--bad); }
  .cols { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 1.2rem; margin-bottom: 0.9rem; }
  ul.pills { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 0.4rem; }
  ul.pills li { background: var(--card-alt); border: 1px solid var(--border); border-radius: 999px; padding: 0.15rem 0.65rem; font-size: 0.8rem; color: var(--gray); }
  .est-publicada { color: var(--ok); } .est-desierta, .est-cancelada { color: var(--bad); }
  .nat-producto { color: var(--ok); } .nat-servicio { color: var(--warn); } .nat-arriendo { color: var(--gray-dim); }
  .recomp summary { cursor: pointer; color: var(--accent-light); font-size: 0.88rem; }
  .recomp ul { margin: 0.5rem 0 0; padding-left: 1.1rem; color: var(--gray); font-size: 0.85rem; }
  .cobertura { color: var(--gray-dim); font-size: 0.8rem; margin: 0.8rem 0 0; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(330px, 1fr)); gap: 1rem; }
  .compra { background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 1.1rem 1.2rem; }
  .compra h3 a { text-decoration: none; }
  .org { color: var(--gray); font-size: 0.86rem; margin: 0 0 0.6rem; }
  .chips { display: flex; flex-wrap: wrap; gap: 0.35rem; margin-bottom: 0.7rem; }
  .chip { font-size: 0.72rem; padding: 0.12rem 0.55rem; border-radius: 999px; border: 1px solid var(--border); color: var(--gray); background: var(--card-alt); }
  .chip.emt { border-color: var(--ok); color: var(--ok); }
  .urgente { color: var(--warn); font-weight: 600; }
  .cota { color: var(--warn); font-weight: 700; }
  .aviso { color: var(--gray-dim); font-size: 0.8rem; }
  .note { background: var(--card-alt); border: 1px solid var(--border); border-left: 3px solid var(--warn); border-radius: 8px; padding: 0.85rem 1rem; font-size: 0.87rem; color: var(--gray); margin-bottom: 1.2rem; }
  .note.info { border-left-color: var(--accent); }
  .note.ok { border-left-color: var(--ok); }
  .note strong { color: var(--white); }
  table.detalle { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
  table.detalle th, table.detalle td { text-align: left; padding: 0.4rem 0.55rem; border-bottom: 1px solid var(--border); }
  table.detalle th { color: var(--gray-dim); font-weight: 500; white-space: nowrap; }
  table.detalle.vol td:first-of-type { font-variant-numeric: tabular-nums; }
  code, .mono { font-family: ui-monospace, Menlo, monospace; }
  a { color: var(--accent-light); } a:hover { color: var(--white); }
  ul.simple { color: var(--gray); font-size: 0.86rem; }
  footer { border-top: 1px solid var(--border); padding: 2rem 0; color: var(--gray-dim); font-size: 0.85rem; }
  .links-row { display: flex; flex-wrap: wrap; gap: 0.6rem; margin-top: 1rem; }
</style>
</head>
<body>

<header class="hero">
  <div class="wrap">
    <h1>Hardware TI en Compra Ágil</h1>
    <p class="subtitle">
      Compras Ágiles de <strong>tóner e insumos de impresión, impresoras y multifuncionales,
      notebooks, UPS y CCTV</strong> en <code>mercadopublico.cl</code> — los rubros que vende
      Kompu.cl. Mira los <strong>cinco estados</strong>, no solo las abiertas: para saber si un rubro
      tiene mercado, las cerradas, desiertas y canceladas dicen más que las vivas.
    </p>
    <p class="meta">
      Generado ${esc(r.generado_en.slice(0, 16).replace("T", " "))} UTC ·
      ${r.requests} request(s) a la API en esta corrida ·
      <a href="index.html">← radar de los otros nichos</a>
    </p>
  </div>
</header>

<main class="wrap">

  ${avisoCuota}${avisoIndice}

  <section>
    <h2>¿Hay mercado?</h2>
    <p class="section-sub">
      Dos cosas distintas, y conviene no confundirlas. El <strong>volumen y la tasa</strong> salen del
      conteo que la API devuelve para cada consulta —un censo, no una muestra—, corregido por la
      contaminación medida. Lo demás (monto mediano, qué se compra, recompradores) sale de las
      <strong>~25 filas por consulta y estado</strong> que se leyeron: es una muestra, y se rotula como
      tal. Una tasa sacada de esa muestra no diría nada, porque lee las mismas 25 filas tenga el estado
      2.208 compras o 55.
    </p>
    <p class="section-sub">
      Todo sale del <strong>listado</strong>: este radar no pide la ficha completa de ninguna compra.
      Alcanza para monto, estado, comprador, región, ofertas recibidas y motivo de fracaso, y significa
      que el filtro corrió sobre el <strong>nombre</strong>, nada más.
    </p>
    ${r.rubros.map((x) => tarjetaRubro(x, r.referencia_exito)).join("\n")}
  </section>

  <section>
    <h2>Abiertas ahora <span class="cota">(${abiertas.length})</span></h2>
    <p class="section-sub">
      Las únicas donde todavía se puede ofertar. El chip <strong>primer llamado</strong> importa:
      esa ventana está reservada a Empresas de Menor Tamaño.
    </p>
    ${
      abiertas.length
        ? `<div class="grid">${abiertas.map((o) => tarjetaCompra(o, rubros)).join("\n")}</div>`
        : `<div class="note">Ninguna compra abierta de estos rubros en la última corrida. No es un fallo del
             radar: es el estado del mercado en este momento, o una corrida que no alcanzó a barrer todo
             (ver cobertura abajo).</div>`
    }
  </section>

  <section>
    <h2>Por verificar <span class="cota">(${porVerificar.length})</span></h2>
    <p class="section-sub">
      El nombre menciona la materia pero <strong>no confirma el rubro</strong> — «Tintas Escuela Rural
      Peñasmo» no dice si son de impresora. Se publican aparte y rotuladas en vez de mezclarlas con las
      confirmadas: resolverlas exige leer los adjuntos o la ficha, que este radar no baja.
    </p>
    ${
      porVerificar.length
        ? `<ul class="simple">${porVerificar
            .slice(0, 40)
            .map(
              (o) =>
                `<li><span class="mono">${esc(o.codigo)}</span> — ${esc(o.nombre)} <span class="aviso">(${esc(
                  o.por_verificar.join(", "),
                )})</span></li>`,
            )
            .join("")}</ul>`
        : `<p class="section-sub">Ninguna.</p>`
    }
  </section>

  <section>
    <h2>Cobertura y método</h2>
    <p class="section-sub">
      Cada consulta <code>q</code> se mide antes de usarla. <strong>El número de resultados es una cota
      superior contaminada</strong>: el buscador de la API hace OR de los tokens y busca también en la
      descripción, así que <code>q=camara</code> trae cámaras de frío y sépticas. La columna de precisión
      mide qué fracción de la muestra menciona el término en el <em>nombre</em> — sin gastar un request
      más. Un <span class="cota">≥</span> marca conteos topeados en 10.000 por la API o truncados por el
      límite de páginas: son cotas inferiores, no conteos.
    </p>
    ${tablaCobertura(r.celdas)}
    <div class="stat-grid">
      <div class="stat"><div class="num">${r.requests}</div><div class="label">requests gastados</div></div>
      <div class="stat"><div class="num">${totalObs}</div><div class="label">compras en el índice</div></div>
      <div class="stat"><div class="num">${r.estados.length}</div><div class="label">estados barridos</div></div>
      <div class="stat"><div class="num">${r.descartados.length}</div><div class="label">descartadas por contexto</div></div>
    </div>
    ${
      r.descartados.length
        ? `<details class="recomp"><summary>Qué descartó el filtro por contexto, y de qué rubro</summary>
             <ul>${r.descartados
               .slice(0, 30)
               .map((d) => `<li><span class="mono">${esc(d.codigo)}</span> ${esc(d.nombre)} — descartada de ${esc(d.rubros.join(", "))}</li>`)
               .join("")}</ul>
             <p class="cobertura">Se publica porque un patrón excluyente demasiado ancho, si no se
             muestra, se ve como oportunidades que desaparecen sin explicación.</p>
           </details>`
        : `<p class="cobertura">Ninguna compra fue descartada por contexto en esta corrida.</p>`
    }
    <p class="cobertura">
      Referencia: Compra Ágil rinde entre ${pct(refMin)} y ${pct(refMax)} de compras efectivas en
      <em>todos</em> los rubros medidos, incluidos los que nada tienen que ver con tecnología
      (<code>output/estudio-mercado.md</code>). Un rubro que rinde eso no es malo: es normal.
    </p>
  </section>

</main>

<footer>
  <div class="wrap">
    <p>
      Los datos salen de la ficha oficial de cada Compra Ágil publicada por el propio organismo
      comprador, vía <code>api2.mercadopublico.cl</code>. Esta página es de <strong>lectura</strong>:
      no cotiza ni prepara ofertas — no existe todavía un catálogo de costos de Kompu con el que fijar
      precio bajo el tope. La oferta se presenta en
      <a href="https://www.mercadopublico.cl">mercadopublico.cl</a>, siempre por una persona.
    </p>
    <div class="links-row">
      <a href="index.html">Compras Ágiles — IA, BI y capacitación</a>
      <a href="leads.html">Quién compra esto en el Estado</a>
      <a href="estudio-mercado.html">Estudio de mercado: qué se demanda en Compra Ágil</a>
    </div>
  </div>
</footer>

</body>
</html>`;
}

export function escribirPaginaKompu(r: ResumenCorridaKompu, rubros: RubroKompu[]): string {
  mkdirSync(path.dirname(PAGINA_PATH), { recursive: true });
  writeFileSync(PAGINA_PATH, generarPaginaKompu(r, rubros), "utf-8");
  return PAGINA_PATH;
}
