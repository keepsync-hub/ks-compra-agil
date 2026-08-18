import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ROOT_DIR } from "../../../../src/lib/config.js";
import { buscarCompraAgil, obtenerDetalleCompraAgil, type CompraAgilListItem, type CompraAgilDetalle } from "../../../../src/lib/api.js";
import { extraerCondiciones, type Condiciones } from "../../../../src/lib/condiciones.js";
import {
  loadArrayServiciosConfig,
  textoMencionaCategoria,
  categoriasQueMenciona,
  type CategoriaArray,
} from "../../../../src/lib/array-servicios.js";

interface Hallazgo {
  item: CompraAgilListItem;
  detalle: CompraAgilDetalle;
  condiciones: Condiciones;
  categorias: CategoriaArray[];
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function fmtClp(n: number): string {
  return `$${n.toLocaleString("es-CL")} CLP`;
}

async function main() {
  const ahoraIso = new Date().toISOString();
  const config = loadArrayServiciosConfig();
  const totalVariantes = config.categorias.reduce((acc, c) => acc + c.variantes.length, 0);

  console.log(
    `Radar compra-agil-array — ${config.categorias.length} categorías de servicio, ${totalVariantes} variantes de búsqueda, estado=publicada\n`,
  );

  // codigo -> item de lista (deduplicado; el detalle decide a qué categoría(s) pertenece de verdad)
  const encontrados = new Map<string, CompraAgilListItem>();
  const variantesFallidas: { variante: string; error: string }[] = [];

  // Estas variantes son términos genéricos (a diferencia de "Claude"): pueden traer miles de
  // resultados poco relevantes. Se limita la paginación (3 páginas × 50 = 150 por variante) para
  // evitar 504 de la API al paginar a fondo consultas amplias; la relevancia real igual se
  // confirma después contra el patrón de cada categoría, así que el tope solo acota volumen, no
  // precisión.
  const MAX_PAGINAS_POR_VARIANTE = 3;

  for (const categoria of config.categorias) {
    for (const variante of categoria.variantes) {
      try {
        const items = await buscarCompraAgil({ q: variante, estado: "publicada", maxPaginas: MAX_PAGINAS_POR_VARIANTE });
        for (const item of items) {
          if (!encontrados.has(item.codigo)) encontrados.set(item.codigo, item);
        }
      } catch (err) {
        const mensaje = (err as Error).message;
        console.warn(`  [${categoria.id}] variante "${variante}": falló, se continúa sin ella — ${mensaje}`);
        variantesFallidas.push({ variante: `${categoria.id}: ${variante}`, error: mensaje });
      }
    }
  }

  // Primer filtro (barato): el nombre en la lista debe calzar con al menos una categoría real.
  const candidatos = [...encontrados.values()].filter((item) =>
    config.categorias.some((c) => textoMencionaCategoria(c, item.nombre)),
  );
  const ruido = encontrados.size - candidatos.length;
  console.log(
    `${encontrados.size} códigos únicos traídos por \`q\`, ${candidatos.length} con mención real en el nombre` +
      (ruido > 0 ? ` (${ruido} descartados como ruido de \`q\`)` : "") +
      ".\n",
  );

  const hallazgos: Hallazgo[] = [];
  for (const item of candidatos) {
    const detalle = await obtenerDetalleCompraAgil(item.codigo);
    const categorias = categoriasQueMenciona(config.categorias, detalle);
    if (categorias.length === 0) {
      console.log(`  ${item.codigo}: descartado, el detalle no confirma ninguna categoría (falso positivo de \`q\`).`);
      continue;
    }
    const condiciones = extraerCondiciones(detalle);
    hallazgos.push({ item, detalle, condiciones, categorias });
    console.log(`  ${item.codigo}: ${item.institucion.organismo_comprador} — ${categorias.map((c) => c.nombre).join(", ")}`);
  }

  const dirDatos = path.join(ROOT_DIR, "data", "array");
  mkdirSync(dirDatos, { recursive: true });
  writeFileSync(
    path.join(dirDatos, "compras-agiles.json"),
    JSON.stringify(
      {
        ultima_corrida: ahoraIso,
        hallazgos: hallazgos.map((h) => ({
          codigo: h.item.codigo,
          organismo: h.item.institucion.organismo_comprador,
          nombre: h.detalle.nombre,
          categorias: h.categorias.map((c) => c.id),
          fecha_cierre: h.item.fechas.fecha_cierre,
          tope_clp: h.condiciones.tope_clp,
          competencia_ofertas: h.condiciones.competencia_ofertas,
          estado_convocatoria: h.item.convocatoria.estado_convocatoria,
          region: h.item.institucion.nombre_region,
        })),
      },
      null,
      2,
    ),
    "utf-8",
  );

  // --- Reporte markdown ---
  const filasReporte = hallazgos.map((h) => {
    const elegible = h.item.convocatoria.estado_convocatoria === 1 ? "primer llamado" : "segundo llamado";
    return [
      `### ${h.item.codigo} — ${h.item.institucion.organismo_comprador}`,
      `- ${h.detalle.nombre}`,
      `- Categoría(s) Array: ${h.categorias.map((c) => c.nombre).join(", ")}`,
      `- Cierre: ${h.item.fechas.fecha_cierre} (${elegible})`,
      `- Tope: ${fmtClp(h.condiciones.tope_clp)}`,
      `- Competencia: ${h.condiciones.competencia_ofertas} oferta(s) recibida(s)`,
      `- Región: ${h.item.institucion.nombre_region}`,
    ].join("\n");
  });

  const reporte = [
    `# Radar Compra Ágil — servicios tipo Array`,
    ``,
    `Corrida: ${ahoraIso}`,
    ``,
    `## Oportunidades abiertas (${hallazgos.length})`,
    ``,
    filasReporte.length > 0 ? filasReporte.join("\n\n") : "_Ninguna oportunidad abierta en esta corrida._",
    ``,
    `## Cobertura`,
    ``,
    `Nota: a diferencia del radar de licencias Claude, estas variantes son términos genéricos ` +
      `("proyectos", "partes", "trámites") que pueden traer miles de resultados; se limita la ` +
      `paginación a ${MAX_PAGINAS_POR_VARIANTE} páginas (${MAX_PAGINAS_POR_VARIANTE * 50} códigos) por variante para no forzar 504 de la API. ` +
      `La relevancia real se confirma después contra el patrón de cada categoría, así que el tope acota volumen, no precisión — pero puede dejar fuera coincidencias que solo aparecen en páginas más profundas.`,
    ``,
    variantesFallidas.length > 0
      ? `⚠️ ${variantesFallidas.length} de ${totalVariantes} variantes fallaron y se omitieron (cobertura parcial):\n` +
        variantesFallidas.map((v) => `- \`${v.variante}\`: ${v.error}`).join("\n")
      : `Las ${totalVariantes} variantes de búsqueda respondieron correctamente.`,
  ].join("\n");

  const outputDir = path.join(ROOT_DIR, "output");
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(path.join(outputDir, "array-compras-agiles.md"), reporte, "utf-8");
  console.log("\n" + reporte);

  // --- Página HTML ---
  const porCategoria = new Map<string, Hallazgo[]>();
  for (const c of config.categorias) porCategoria.set(c.id, []);
  for (const h of hallazgos) for (const c of h.categorias) porCategoria.get(c.id)!.push(h);

  const fechaGenerada = ahoraIso.slice(0, 10);

  const seccionesCategoria = config.categorias
    .map((c) => {
      const items = porCategoria.get(c.id) ?? [];
      const cards =
        items.length > 0
          ? items
              .map((h) => {
                const elegible =
                  h.item.convocatoria.estado_convocatoria === 1 ? "primer llamado — EMT puede ofertar" : "segundo llamado";
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
        <div class="cta">
          <a class="btn secondary" href="https://www.mercadopublico.cl/Portal/CompraAgil/DetalleCompra?codigo=${encodeURIComponent(h.item.codigo)}">Ver en el portal</a>
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

  const html = `<!doctype html>
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
  .btn { display: inline-block; background: var(--accent); color: var(--white); text-decoration: none; padding: 0.5rem 0.9rem; border-radius: 8px; font-size: 0.85rem; font-weight: 600; }
  .btn:hover { background: var(--accent-light); color: var(--bg); }
  .btn.secondary { background: transparent; border: 1px solid var(--border); color: var(--gray); }
  .btn.secondary:hover { border-color: var(--accent-light); color: var(--accent-light); }
  .note { background: var(--card-alt); border: 1px solid var(--border); border-left: 3px solid var(--warn); border-radius: 8px; padding: 0.8rem 1rem; font-size: 0.86rem; color: var(--gray); }
  .note.ok { border-left-color: var(--ok); }
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
      intelligence y gestión de proyectos. Exploración de mercado independiente del radar de
      licencias Claude de este repo — de solo lectura, no genera cotizaciones.
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
      paginación se limita a ${MAX_PAGINAS_POR_VARIANTE * 50} códigos por variante para evitar
      errores 504 del servicio, lo que puede dejar fuera coincidencias en páginas más profundas.
      Además, ciertas combinaciones de palabras con "de" suelto (p.ej. "gestión de proyectos")
      hacen que la API responda <code>500 ERROR_INTERNO</code> de forma reproducible — las
      variantes de búsqueda evitan esa palabra por eso.
    </p>
    <p class="note">Volver a correr <code>npm run array-radar</code> para refrescar esta página con datos actuales.</p>
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

  const docsDir = path.join(ROOT_DIR, "docs");
  mkdirSync(docsDir, { recursive: true });
  writeFileSync(path.join(docsDir, "array-compras-agiles.html"), html, "utf-8");
  console.log(`\nPágina generada: docs/array-compras-agiles.html`);
}

main().catch((err) => {
  console.error("Radar Array falló:", err);
  process.exitCode = 1;
});
