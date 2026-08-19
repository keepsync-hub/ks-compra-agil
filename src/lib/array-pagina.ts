import { existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ROOT_DIR } from "./config.js";
import type { ArrayServiciosConfig, HallazgoArray } from "./array-servicios.js";
import { MAX_PAGINAS_POR_VARIANTE_ARRAY } from "./array-servicios.js";

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function fmtClp(n: number): string {
  return `$${n.toLocaleString("es-CL")} CLP`;
}

/** Info de cotización de un código, para enlazarla desde la tarjeta de la oportunidad. */
export interface CotizacionArrayEnlace {
  precioClp: number;
  archivoPdfRelativo: string; // ruta relativa a docs/, ej. "array-cotizaciones/1234-56-COT26/Q-....pdf"
  /**
   * Nombres de los adjuntos del organismo comprador descargados a `output/array/<codigo>/adjuntos/`.
   * Se listan por nombre pero NO se republican en GitHub Pages: son documentos del organismo, no
   * nuestros, y ya están disponibles en el portal oficial (al que enlaza la tarjeta). Publicarlos
   * bajo nuestro sitio atribuiría procedencia ajena y haría crecer el repo con binarios de terceros
   * que además se pueden volver a descargar en cualquier momento.
   */
  adjuntos: string[];
  /** AAAA-MM-DD en que se generó la cotización (puede ser anterior a la corrida del radar). */
  generado: string;
}

/**
 * Índice versionado de cotizaciones, en `docs/` para que sobreviva a un checkout limpio en la nube
 * (a diferencia de `data/`, que está gitignored). Es lo que permite que `npm run array-radar`
 * refresque las oportunidades sin borrar las cotizaciones que dejó `npm run array-cotizar`.
 */
const INDICE_COTIZACIONES_PATH = path.join(ROOT_DIR, "docs", "array-cotizaciones", "index.json");

export function leerIndiceCotizaciones(): Map<string, CotizacionArrayEnlace> {
  if (!existsSync(INDICE_COTIZACIONES_PATH)) return new Map();
  try {
    const raw = JSON.parse(readFileSync(INDICE_COTIZACIONES_PATH, "utf-8")) as Record<string, CotizacionArrayEnlace>;
    return new Map(Object.entries(raw));
  } catch {
    // Índice corrupto o de un formato anterior: se ignora en vez de abortar la corrida. La página
    // simplemente sale sin cotizaciones, y la próxima corrida de `array-cotizar` lo reescribe.
    return new Map();
  }
}

/** Fusiona sobre lo ya indexado: una corrida parcial no debe perder cotizaciones anteriores. */
export function guardarIndiceCotizaciones(nuevas: Map<string, CotizacionArrayEnlace>): void {
  const combinado = leerIndiceCotizaciones();
  for (const [codigo, enlace] of nuevas) combinado.set(codigo, enlace);
  mkdirSync(path.dirname(INDICE_COTIZACIONES_PATH), { recursive: true });
  writeFileSync(
    INDICE_COTIZACIONES_PATH,
    JSON.stringify(Object.fromEntries([...combinado.entries()].sort()), null, 2),
    "utf-8",
  );
}

export interface OpcionesPaginaArray {
  /** Si viene, la página se genera en modo "cotizador" con precio, PDF y adjuntos por código. */
  cotizaciones?: Map<string, CotizacionArrayEnlace>;
  variantesFallidas: { variante: string; error: string }[];
}

export function generarPaginaArrayHtml(
  hallazgos: HallazgoArray[],
  config: ArrayServiciosConfig,
  opciones: OpcionesPaginaArray,
): string {
  const totalVariantes = config.categorias.reduce((acc, c) => acc + c.variantes.length, 0);
  const modoCotizador = opciones.cotizaciones != null;
  const fechaGenerada = new Date().toISOString().slice(0, 10);

  const porCategoria = new Map<string, HallazgoArray[]>();
  for (const c of config.categorias) porCategoria.set(c.id, []);
  for (const h of hallazgos) for (const c of h.categorias) porCategoria.get(c.id)!.push(h);

  const seccionesCategoria = config.categorias
    .map((c) => {
      const items = porCategoria.get(c.id) ?? [];
      const cards =
        items.length > 0
          ? items
              .map((h) => {
                const elegible =
                  h.item.convocatoria.estado_convocatoria === 1 ? "primer llamado — EMT puede ofertar" : "segundo llamado";
                const cot = opciones.cotizaciones?.get(h.item.codigo);
                const listaAdjuntos =
                  cot && cot.adjuntos.length > 0
                    ? `<details class="adjuntos"><summary>${cot.adjuntos.length} documento(s) del organismo descargado(s)</summary>
            <ul>${cot.adjuntos.map((a) => `<li>${escapeHtml(a)}</li>`).join("")}</ul>
            <p>Descargados a <code>output/array/${escapeHtml(h.item.codigo)}/adjuntos/</code>. No se republican acá: son documentos del organismo comprador y se obtienen desde su ficha en el portal.</p>
          </details>`
                    : "";
                const bloqueCotizacion = modoCotizador
                  ? cot
                    ? `
        <div class="note ok">
          Cotización preliminar KeepSync: <strong>${fmtClp(cot.precioClp)}</strong> (80% del presupuesto disponible)<span class="gen"> · generada ${escapeHtml(cot.generado)}</span>.
          ${cot.adjuntos.length === 0 ? " Sin adjuntos declarados por el organismo." : ""}
        </div>
        ${listaAdjuntos}`
                    : `<div class="note">Sin cotización generada para este código en la última corrida de <code>npm run array-cotizar</code> — revisar manualmente.</div>`
                  : "";
                return `
      <div class="opp-card">
        <span class="codigo">${escapeHtml(h.item.codigo)}</span>
        <span class="org">${escapeHtml(h.item.institucion.organismo_comprador)}</span>
        <span class="nombre">${escapeHtml(h.detalle.nombre)}</span>
        <dl>
          <dt>Tope</dt><dd>${fmtClp(h.condiciones.tope_clp)}</dd>
          <dt>Cierre</dt><dd>${escapeHtml(h.item.fechas.fecha_cierre)} (${elegible})</dd>
          <dt>Competencia</dt><dd>${h.condiciones.competencia_ofertas} oferta(s) recibida(s)</dd>
          <dt>Región</dt><dd>${escapeHtml(h.item.institucion.nombre_region)}</dd>
        </dl>
        ${bloqueCotizacion}
        <div class="cta">
          <a class="btn secondary" href="https://www.mercadopublico.cl/Portal/CompraAgil/DetalleCompra?codigo=${encodeURIComponent(h.item.codigo)}">Ver en el portal</a>
          ${cot ? `<a class="btn" href="${escapeHtml(cot.archivoPdfRelativo)}">Cotización (PDF)</a>` : ""}
        </div>
      </div>`;
              })
              .join("\n")
          : `<p class="note">Sin oportunidades abiertas en esta corrida para "${escapeHtml(c.nombre)}".</p>`;

      return `
  <section>
    <h2>${escapeHtml(c.nombre)}</h2>
    <p class="section-sub">${escapeHtml(c.descripcion_array)}</p>
    <div class="card-grid">
${cards}
    </div>
  </section>`;
    })
    .join("\n");

  const disclaimerCotizador = modoCotizador
    ? `
  <section>
    <h2>⚠️ Sobre las cotizaciones de esta página</h2>
    <div class="note" style="border-left-color: var(--bad);">
      El precio mostrado es una <strong>estimación de exploración de mercado</strong>: 80% del presupuesto
      disponible declarado por el organismo, <strong>no</strong> un cálculo a partir de costos reales de Array
      ni de un catálogo de precios propio (a diferencia de la cotización de licencias Claude de este mismo
      repositorio). El oferente que figura en el PDF es <strong>KeepSync</strong>
      (<code>config/company.json</code>), no Array. Antes de usar cualquiera de estas cotizaciones para una
      oferta real hace falta confirmar con el usuario si existe una vía real de fulfillment/facturación para
      estos servicios y reemplazar el precio por uno basado en costos reales. Ningún PDF de esta página se
      envía automáticamente a ningún organismo.
    </div>
  </section>`
    : "";

  return `<!doctype html>
<html lang="es-CL">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Compras Ágiles — servicios Array | mercadopublico.cl</title>
<meta name="description" content="Compras Ágiles publicadas en mercadopublico.cl relacionadas con los servicios de Array (array.cl): oficina de partes electrónica, gestión documental, RPA, business intelligence y gestión de proyectos.">
<style>
  :root {
    --bg: #0E0E17; --bg-alt: #09090B; --card: #161527; --card-alt: #1D1B33; --border: #2A2844;
    --accent: #786CF0; --accent-light: #B4AAFA; --white: #FFFFFF; --gray: #9A9FB0; --gray-dim: #6E7284;
    --ok: #4ADE80; --warn: #FBBF24; --bad: #FB7185;
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--white); font-family: -apple-system, "Segoe UI", Arial, sans-serif; line-height: 1.55; }
  .wrap { max-width: 980px; margin: 0 auto; padding: 0 1.5rem; }
  header.hero { background: linear-gradient(180deg, var(--bg-alt) 0%, var(--bg) 100%); border-bottom: 1px solid var(--border); padding: 2.5rem 0 2rem; }
  h1 { font-size: clamp(1.6rem, 4vw, 2.3rem); margin: 0 0 0.5rem; }
  .subtitle { color: var(--gray); font-size: 1.02rem; max-width: 66ch; }
  .meta { color: var(--gray-dim); font-size: 0.85rem; margin-top: 1rem; }
  main { padding: 2.5rem 0 4rem; }
  section { margin-bottom: 3rem; }
  h2 { font-size: 1.35rem; margin: 0 0 0.3rem; }
  .section-sub { color: var(--gray); font-size: 0.92rem; margin: 0 0 1.1rem; max-width: 68ch; }
  .stat-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 0.9rem; }
  .stat { background: var(--card); border: 1px solid var(--border); border-radius: 10px; padding: 1.1rem 1.2rem; }
  .stat .num { font-size: 1.9rem; font-weight: 700; color: var(--accent-light); line-height: 1.1; }
  .stat .label { color: var(--gray); font-size: 0.85rem; margin-top: 0.35rem; }
  .card-grid { display: grid; gap: 1rem; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); }
  .opp-card { background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 1.25rem; display: flex; flex-direction: column; gap: 0.6rem; }
  .opp-card .codigo { font-family: ui-monospace, Menlo, monospace; color: var(--accent-light); font-size: 0.85rem; }
  .opp-card .org { font-weight: 700; font-size: 1.05rem; }
  .opp-card .nombre { color: var(--gray); font-size: 0.88rem; }
  .opp-card dl { display: grid; grid-template-columns: auto 1fr; gap: 0.25rem 0.6rem; font-size: 0.86rem; margin: 0.4rem 0; }
  .opp-card dt { color: var(--gray-dim); }
  .opp-card dd { margin: 0; }
  .opp-card .cta { display: flex; flex-wrap: wrap; gap: 0.5rem; }
  .btn { display: inline-block; background: var(--accent); color: var(--white); text-decoration: none; padding: 0.5rem 0.9rem; border-radius: 8px; font-size: 0.85rem; font-weight: 600; }
  .btn:hover { background: var(--accent-light); color: var(--bg); }
  .btn.secondary { background: transparent; border: 1px solid var(--border); color: var(--gray); }
  .btn.secondary:hover { border-color: var(--accent-light); color: var(--accent-light); }
  .note { background: var(--card-alt); border: 1px solid var(--border); border-left: 3px solid var(--warn); border-radius: 8px; padding: 0.8rem 1rem; font-size: 0.86rem; color: var(--gray); }
  .note.ok { border-left-color: var(--ok); }
  .note .gen { color: var(--gray-dim); }
  .adjuntos { font-size: 0.82rem; color: var(--gray); }
  .adjuntos summary { cursor: pointer; color: var(--accent-light); }
  .adjuntos ul { margin: 0.5rem 0; padding-left: 1.1rem; word-break: break-word; }
  .adjuntos p { color: var(--gray-dim); margin: 0.4rem 0 0; }
  code, .mono { font-family: ui-monospace, Menlo, monospace; }
  a { color: var(--accent-light); }
  a:hover { color: var(--white); }
  footer { border-top: 1px solid var(--border); padding: 2rem 0; color: var(--gray-dim); font-size: 0.85rem; }
  footer a { color: var(--gray); }
  .links-row { display: flex; flex-wrap: wrap; gap: 0.6rem; margin-top: 1rem; }
</style>
</head>
<body>

<header class="hero">
  <div class="wrap">
    <h1>Compras Ágiles — servicios tipo Array</h1>
    <p class="subtitle">
      Búsqueda contra la API real de Compra Ágil (<code>api2.mercadopublico.cl</code>) de
      oportunidades publicadas relacionadas con las líneas de negocio de
      <a href="http://www.array.cl/">Array</a> (array.cl): oficina de partes electrónica,
      gestión documental y firma electrónica, automatización de procesos (RPA), business
      intelligence y gestión de proyectos.${
        modoCotizador
          ? " Incluye una cotización preliminar automática por oportunidad — ver el aviso más abajo antes de usarla."
          : " Exploración de mercado independiente del radar de licencias Claude de este repo — de solo lectura, no genera cotizaciones."
      }
    </p>
    <p class="meta">Generado ${fechaGenerada} · <a href="index.html">← volver al radar de licencias Claude</a></p>
  </div>
</header>

<main class="wrap">

  <section>
    <h2>Resumen</h2>
    <div class="stat-grid">
      <div class="stat"><div class="num">${hallazgos.length}</div><div class="label">oportunidad(es) abierta(s) en esta corrida</div></div>
      <div class="stat"><div class="num">${config.categorias.length}</div><div class="label">categorías de servicio monitoreadas</div></div>
      <div class="stat"><div class="num">${totalVariantes}</div><div class="label">variantes de búsqueda</div></div>
    </div>
  </section>
${disclaimerCotizador}
${seccionesCategoria}

  <section>
    <h2>Metodología</h2>
    <p class="section-sub">
      Cada categoría busca por varias frases (ver <code>config/array-servicios.json</code>)
      contra el buscador de texto libre de la API, que es laxo (matching parcial, sin distinguir
      orden de palabras). El resultado se filtra localmente contra un patrón específico de la
      categoría, primero sobre el nombre de la publicación y luego sobre la descripción completa
      y los productos solicitados del detalle — el mismo enfoque de dos pasos que usa el radar de
      licencias Claude de este repo (<code>src/lib/marca.ts</code>), generalizado en
      <code>src/lib/array-servicios.ts</code>. Solo se muestran compras en estado
      <strong>Publicada</strong> (abiertas a la fecha de esta corrida).
    </p>
    <p class="note">
      A diferencia de "Claude", los términos de búsqueda de esta página son genéricos
      ("proyectos", "partes", "trámites") y pueden traer miles de resultados en la API; la
      paginación se limita a ${MAX_PAGINAS_POR_VARIANTE_ARRAY * 50} códigos por variante para evitar
      errores 504 del servicio, lo que puede dejar fuera coincidencias en páginas más profundas.
      Además, ciertas combinaciones de palabras con "de" suelto (p.ej. "gestión de proyectos")
      hacen que la API responda <code>500 ERROR_INTERNO</code> de forma reproducible — las
      variantes de búsqueda evitan esa palabra por eso.
    </p>
    ${
      opciones.variantesFallidas.length > 0
        ? `<p class="note">⚠️ ${opciones.variantesFallidas.length} de ${totalVariantes} variantes fallaron y se omitieron en esta corrida (cobertura parcial).</p>`
        : ""
    }
    <p class="note">Volver a correr <code>npm run ${modoCotizador ? "array-cotizar" : "array-radar"}</code> para refrescar esta página con datos actuales.</p>
  </section>

</main>

<footer>
  <div class="wrap">
    <p>Página generada automáticamente a partir de la API de Compra Ágil en la fecha indicada arriba — no se actualiza sola.</p>
    <div class="links-row">
      <a href="index.html">Radar de licencias Claude</a>
      <a href="http://www.array.cl/">array.cl</a>
      <a href="https://github.com/keepsync-hub/ks-compra-agil">Repositorio</a>
    </div>
  </div>
</footer>

</body>
</html>
`;
}
