/**
 * Genera `docs/leads.html`: el listado de contactos extraídos del barrido histórico de Compras
 * Ágiles (`npm run leads`), y `output/leads.md` con el mismo contenido en texto.
 *
 * Es una página NUEVA y separada de `docs/index.html` a propósito: el radar diario responde
 * "¿conviene participar en esta compra?" y esta responde otra pregunta —"¿a quién le escribo?"—.
 * Además, `index.html` se reescribe entre marcadores en cada corrida del radar, y meter acá un
 * cuarto par de marcadores acoplaría dos scripts que no tienen por qué correr juntos.
 *
 * Criterio editorial, el mismo que el resto de las páginas del repo: si un dato no ayuda a decidir
 * a quién escribirle y con qué excusa, no va. Por eso cada tarjeta muestra la CITA del documento de
 * donde salió el contacto: sin eso, el listado sería una lista de correos que nadie puede
 * verificar antes de usarla.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ROOT_DIR } from "./config.js";
import { aCsv, type LeadConsolidado } from "./leads.js";

const PAGINA_PATH = path.join(ROOT_DIR, "docs", "leads.html");
const INFORME_PATH = path.join(ROOT_DIR, "output", "leads.md");

export interface ResumenCorridaLeads {
  generado_en: string;
  categorias: { id: string; nombre: string }[];
  estados: string[];
  consultas_hechas: number;
  compras_vistas: number;
  compras_confirmadas: number;
  compras_por_verificar?: number;
  compras_revisadas: number;
  compras_ya_revisadas: number;
  adjuntos_leidos: number;
  adjuntos_sin_texto: number;
  compras_sin_adjuntos: number;
  /** Compras revisadas de las que salió al menos un contacto: el rendimiento real del método. */
  compras_con_contacto: number;
  /** Confirmadas que quedaron fuera por el tope de la corrida, no por estar ya revisadas. */
  compras_postergadas: number;
  leads_nuevos: number;
  cuota_agotada: boolean;
  solo_indice: boolean;
  variantes_fallidas: { variante: string; estado: string; error: string }[];
  requests_api: number;
}

function esc(s: string | number | null | undefined): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const CLP = new Intl.NumberFormat("es-CL");

const GLOSA_ESTADO: Record<string, string> = {
  publicada: "abierta ahora",
  proveedor_seleccionado: "proveedor seleccionado",
  cerrada: "cerrada",
  desierta: "desierta",
  cancelada: "cancelada",
};

function fechaCorta(iso: string): string {
  return (iso || "").slice(0, 10);
}

function urlPortal(codigo: string): string {
  return `https://www.mercadopublico.cl/Portal/CompraAgil/DetalleCompra?codigo=${encodeURIComponent(codigo)}`;
}

function tarjeta(l: LeadConsolidado): string {
  const nombre = l.nombre ?? (l.buzon_funcional ? "Buzón institucional" : "Sin nombre en los documentos");
  const claseNombre = l.nombre ? "" : " sin-nombre";
  const insignias: string[] = [];
  if (l.compras.length > 1) insignias.push(`<span class="chip repetidor">${l.compras.length} compras</span>`);
  if (l.buzon_funcional) insignias.push(`<span class="chip">buzón de área</span>`);
  if (l.tipo_dominio === "correo genérico") insignias.push(`<span class="chip aviso">correo no institucional</span>`);
  if (l.confianza_nombre === "baja") insignias.push(`<span class="chip aviso">nombre deducido</span>`);

  const estados = [...new Set(l.compras.map((c) => c.estado))];
  const filtro = esc(
    [l.nombre ?? "", l.email, l.organismo, l.unidad_compra, l.nombre_region, l.cargo ?? "", ...l.compras.map((c) => c.codigo + " " + c.nombre)]
      .join(" ")
      .toLowerCase(),
  );

  const compras = l.compras
    .slice()
    .sort((a, b) => b.fecha_publicacion.localeCompare(a.fecha_publicacion))
    .map(
      (c) => `
        <li>
          <a class="mono" href="${urlPortal(c.codigo)}" rel="noopener">${esc(c.codigo)}</a>
          <span class="estado est-${esc(c.estado)}">${esc(GLOSA_ESTADO[c.estado] ?? c.estado)}</span>
          <span class="compra-nombre">${esc(c.nombre)}</span>
          <span class="compra-meta">${esc(fechaCorta(c.fecha_publicacion))} · $${CLP.format(c.monto_disponible_clp)} CLP</span>
          <details class="cita"><summary>cita del documento</summary>
            <p class="fuente">${esc(c.fuente)}</p>
            <blockquote>${esc(c.cita)}</blockquote>
          </details>
        </li>`,
    )
    .join("");

  return `
      <article class="lead" data-filtro="${filtro}" data-categorias="${esc(l.categorias.join(" "))}" data-estados="${esc(estados.join(" "))}" data-tipo="${esc(l.tipo_dominio)}" data-persona="${l.nombre && !l.buzon_funcional ? "si" : "no"}">
        <header>
          <h3 class="${claseNombre.trim()}">${esc(nombre)}</h3>
          <div class="chips">${insignias.join("")}</div>
        </header>
        <a class="email" href="mailto:${esc(l.email)}">${esc(l.email)}</a>
        ${l.cargo ? `<p class="cargo">${esc(l.cargo)}</p>` : ""}
        ${l.telefono ? `<p class="cargo">Tel. ${esc(l.telefono)}</p>` : ""}
        <p class="org">${esc(l.organismo)}${l.unidad_compra ? ` · <span class="gray">${esc(l.unidad_compra)}</span>` : ""}</p>
        <p class="gray small">${esc(l.nombre_region)}${l.categorias.length ? ` · ${esc(l.categorias.join(", "))}` : ""}</p>
        ${
          l.origen_nombre
            ? `<p class="gray small origen">Nombre: ${esc(l.origen_nombre)}${l.confianza_nombre ? ` (confianza ${esc(l.confianza_nombre)})` : ""}.</p>`
            : ""
        }
        <ul class="compras">${compras}</ul>
      </article>`;
}

function bloqueResumen(leads: LeadConsolidado[], r: ResumenCorridaLeads): string {
  const conNombre = leads.filter((l) => l.nombre && !l.buzon_funcional).length;
  const instituciones = new Set(leads.map((l) => l.organismo)).size;
  const repetidores = leads.filter((l) => l.compras.length > 1).length;
  const compras = new Set(leads.flatMap((l) => l.compras.map((c) => c.codigo))).size;
  const stat = (n: number | string, label: string) =>
    `<div class="stat"><div class="num">${n}</div><div class="label">${label}</div></div>`;
  return `
    <div class="stat-grid">
      ${stat(leads.length, "contactos únicos")}
      ${stat(conNombre, "con nombre de persona")}
      ${stat(instituciones, "instituciones distintas")}
      ${stat(repetidores, "contactos que compraron más de una vez")}
      ${stat(compras, "Compras Ágiles que los evidencian")}
      ${stat(r.requests_api, "requests a la API en la última corrida")}
    </div>`;
}

export function renderPaginaLeads(leads: LeadConsolidado[], r: ResumenCorridaLeads): string {
  const categorias = [...new Set(leads.flatMap((l) => l.categorias))].sort();
  const estados = [...new Set(leads.flatMap((l) => l.compras.map((c) => c.estado)))].sort();
  const csv = aCsv(leads);

  const opcionesCategoria = categorias.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join("");
  const opcionesEstado = estados
    .map((e) => `<option value="${esc(e)}">${esc(GLOSA_ESTADO[e] ?? e)}</option>`)
    .join("");

  const fallidas = r.variantes_fallidas.length
    ? `<p class="note">${r.variantes_fallidas.length} consulta(s) fallaron en la última corrida y no se midieron:
        ${esc(r.variantes_fallidas.slice(0, 8).map((f) => `${f.variante}/${f.estado}`).join(", "))}. No se cuentan como cero.</p>`
    : "";

  return `<!doctype html>
<html lang="es-CL">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Leads — quién compra IA, BI y capacitación en Compra Ágil</title>
<meta name="description" content="Contactos (nombre, correo, institución) extraídos de los documentos de Compras Ágiles históricas de mercadopublico.cl en los nichos de licencias Claude, inteligencia artificial, Power BI/Tableau y automatización no-code.">
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
  .subtitle { color: var(--gray); font-size: 1.02rem; max-width: 70ch; }
  .meta { color: var(--gray-dim); font-size: 0.85rem; margin-top: 1rem; }
  main { padding: 2.5rem 0 4rem; }
  section { margin-bottom: 2.6rem; }
  h2 { font-size: 1.35rem; margin: 0 0 0.3rem; }
  .section-sub { color: var(--gray); font-size: 0.92rem; margin: 0 0 1.1rem; max-width: 72ch; }
  .stat-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 0.9rem; }
  .stat { background: var(--card); border: 1px solid var(--border); border-radius: 10px; padding: 1.1rem 1.2rem; }
  .stat .num { font-size: 1.9rem; font-weight: 700; color: var(--accent-light); line-height: 1.1; }
  .stat .label { color: var(--gray); font-size: 0.85rem; margin-top: 0.35rem; }
  .controls { display: flex; flex-wrap: wrap; gap: 0.6rem; align-items: center; margin-bottom: 1.2rem; }
  .controls input[type=search], .controls select { background: var(--card); color: var(--white); border: 1px solid var(--border); border-radius: 8px; padding: 0.55rem 0.8rem; font-size: 0.9rem; font-family: inherit; }
  .controls input[type=search] { flex: 1 1 260px; }
  .controls label { color: var(--gray-dim); font-size: 0.85rem; display: flex; align-items: center; gap: 0.35rem; }
  .btn { display: inline-block; background: var(--accent); color: var(--white); border: none; text-decoration: none; padding: 0.55rem 0.9rem; border-radius: 8px; font-size: 0.85rem; font-weight: 600; cursor: pointer; font-family: inherit; }
  .btn:hover { background: var(--accent-light); color: var(--bg); }
  .btn.secondary { background: transparent; border: 1px solid var(--border); color: var(--gray); }
  .btn.secondary:hover { border-color: var(--accent-light); color: var(--accent-light); }
  #conteo { color: var(--gray-dim); font-size: 0.85rem; margin-bottom: 0.9rem; }
  .lead-grid { display: grid; gap: 1rem; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); }
  .lead { background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 1.15rem 1.25rem; display: flex; flex-direction: column; gap: 0.35rem; }
  .lead header { display: flex; flex-wrap: wrap; gap: 0.4rem; align-items: baseline; justify-content: space-between; }
  .lead h3 { margin: 0; font-size: 1.05rem; }
  .lead h3.sin-nombre { color: var(--gray-dim); font-weight: 500; font-style: italic; }
  .chips { display: flex; flex-wrap: wrap; gap: 0.3rem; }
  .chip { font-size: 0.72rem; padding: 0.12rem 0.5rem; border-radius: 999px; border: 1px solid var(--border); color: var(--gray); background: var(--card-alt); }
  .chip.repetidor { border-color: var(--ok); color: var(--ok); }
  .chip.aviso { border-color: var(--warn); color: var(--warn); }
  .email { font-family: ui-monospace, Menlo, monospace; font-size: 0.9rem; word-break: break-all; }
  .cargo { margin: 0; color: var(--accent-light); font-size: 0.86rem; }
  .org { margin: 0.2rem 0 0; font-size: 0.9rem; font-weight: 600; }
  .gray { color: var(--gray); font-weight: 400; }
  .small { font-size: 0.8rem; margin: 0; }
  .origen { color: var(--gray-dim); font-style: italic; }
  ul.compras { list-style: none; margin: 0.6rem 0 0; padding: 0.6rem 0 0; border-top: 1px solid var(--border); display: flex; flex-direction: column; gap: 0.6rem; }
  ul.compras li { font-size: 0.82rem; display: flex; flex-direction: column; gap: 0.15rem; }
  .compra-nombre { color: var(--gray); }
  .compra-meta { color: var(--gray-dim); font-size: 0.78rem; }
  .estado { font-size: 0.72rem; color: var(--gray-dim); }
  .estado.est-publicada { color: var(--ok); }
  .estado.est-desierta, .estado.est-cancelada { color: var(--bad); }
  .cita summary { cursor: pointer; color: var(--gray-dim); font-size: 0.76rem; }
  .cita blockquote { margin: 0.3rem 0 0; padding-left: 0.7rem; border-left: 2px solid var(--border); color: var(--gray); font-size: 0.78rem; }
  .cita .fuente { margin: 0.3rem 0 0; color: var(--gray-dim); font-size: 0.74rem; font-family: ui-monospace, Menlo, monospace; word-break: break-all; }
  .note { background: var(--card-alt); border: 1px solid var(--border); border-left: 3px solid var(--warn); border-radius: 8px; padding: 0.8rem 1rem; font-size: 0.86rem; color: var(--gray); }
  .note.ok { border-left-color: var(--ok); }
  .note.info { border-left-color: var(--accent); }
  .note p:last-child { margin-bottom: 0; }
  table.detalle { width: 100%; border-collapse: collapse; font-size: 0.86rem; }
  table.detalle th, table.detalle td { text-align: left; padding: 0.45rem 0.6rem; border-bottom: 1px solid var(--border); }
  table.detalle th { color: var(--gray-dim); font-weight: 500; }
  code, .mono { font-family: ui-monospace, Menlo, monospace; }
  a { color: var(--accent-light); }
  a:hover { color: var(--white); }
  footer { border-top: 1px solid var(--border); padding: 2rem 0; color: var(--gray-dim); font-size: 0.85rem; }
  .links-row { display: flex; flex-wrap: wrap; gap: 0.6rem; margin-top: 1rem; }
</style>
</head>
<body>

<header class="hero">
  <div class="wrap">
    <h1>Quién compra esto en el Estado</h1>
    <p class="subtitle">
      Contactos extraídos de los <strong>documentos adjuntos</strong> de Compras Ágiles históricas de
      <code>mercadopublico.cl</code> en los nichos que este repositorio monitorea: licencias
      Claude/Anthropic, adopción de inteligencia artificial, y cursos de IA, Power BI/Tableau y
      automatización no-code. A diferencia del radar, este barrido mira <strong>todos los estados</strong>
      —incluidas las cerradas, las que ya tienen proveedor seleccionado, las desiertas y las
      canceladas—: para vender, un organismo que ya compró vale más que uno que todavía no.
    </p>
    <p class="meta">
      Generado ${esc(r.generado_en.slice(0, 16).replace("T", " "))} UTC ·
      <a href="index.html">← radar de oportunidades abiertas</a>
    </p>
  </div>
</header>

<main class="wrap">

  <section>
    <h2>Resumen</h2>
    ${bloqueResumen(leads, r)}
  </section>

  <section>
    <h2>Listado</h2>
    <p class="section-sub">
      Cada tarjeta trae la cita textual del documento de donde salió el contacto. Verificarla antes
      de escribir: los nombres se leen de PDF y .docx del propio organismo, y un PDF mal maquetado
      puede pegar dos campos de una tabla.
    </p>
    <div class="controls">
      <input type="search" id="q" placeholder="Buscar por nombre, correo, institución o código…" autocomplete="off">
      <select id="f-categoria"><option value="">Todas las categorías</option>${opcionesCategoria}</select>
      <select id="f-estado"><option value="">Todos los estados</option>${opcionesEstado}</select>
      <label><input type="checkbox" id="f-persona"> solo con nombre de persona</label>
      <label><input type="checkbox" id="f-repetidor"> solo repetidores</label>
      <button class="btn secondary" id="copiar">Copiar correos visibles</button>
      <button class="btn" id="csv">Descargar CSV</button>
    </div>
    <p id="conteo"></p>
    <div class="lead-grid" id="grid">
${leads.map(tarjeta).join("\n")}
    </div>
    ${leads.length === 0 ? `<p class="note">Todavía no hay contactos en el índice. Correr <code>npm run leads</code>.</p>` : ""}
  </section>

  <section>
    <h2>De dónde salen estos datos</h2>
    <div class="note info">
      <p>
        La API de Compra Ágil <strong>no publica ningún dato de contacto</strong>: entrega el organismo
        comprador y su unidad de compra, nada más. Todo lo que hay acá se leyó del texto de los
        documentos que el propio organismo adjuntó a la compra (especificaciones técnicas, solicitud
        de cotización, formulario de requerimiento), que el portal sirve públicamente y sin login.
      </p>
      <p>
        Son datos de contacto <strong>funcionales y publicados por el propio Estado</strong> dentro de un
        procedimiento de compra: el correo aparece ahí justamente para que un proveedor escriba. Aun así,
        un primer contacto en frío debería mencionar la compra concreta de la que salió el dato —está en
        la tarjeta— y ofrecer una salida clara si la persona no quiere seguir recibiendo correos.
        Esta página se publica con <code>noindex</code> para que no la levanten los buscadores.
      </p>
    </div>
  </section>

  <section>
    <h2>Qué mide y qué no alcanza a ver esta corrida</h2>
    <table class="detalle">
      <tr><th>Estados barridos</th><td>${esc(r.estados.join(", "))}</td></tr>
      <tr><th>Categorías</th><td>${esc(r.categorias.map((c) => `${c.nombre} (${c.id})`).join(" · "))}</td></tr>
      <tr><th>Consultas a la API</th><td>${r.consultas_hechas} · ${r.compras_vistas} resultado(s) revisado(s)</td></tr>
      <tr><th>Compras confirmadas por el filtro</th><td>${r.compras_confirmadas}${r.compras_por_verificar ? ` (+${r.compras_por_verificar} verificadas con el texto de sus adjuntos)` : ""}</td></tr>
      <tr><th>Compras cuyos adjuntos se leyeron</th><td>${r.compras_revisadas} en esta corrida · ${r.compras_ya_revisadas} ya revisadas antes</td></tr>
      <tr><th>Adjuntos con texto</th><td>${r.adjuntos_leidos} leído(s) · ${r.adjuntos_sin_texto} sin capa de texto o ilegibles</td></tr>
      <tr><th>Compras sin ningún adjunto</th><td>${r.compras_sin_adjuntos} — de esas no se puede sacar contacto</td></tr>
      <tr><th>Rendimiento del método</th><td>${r.compras_con_contacto} de ${r.compras_revisadas} compra(s) revisada(s) dejaron algún contacto${r.compras_revisadas ? ` (${Math.round((r.compras_con_contacto / r.compras_revisadas) * 100)}%)` : ""}</td></tr>
      ${r.compras_postergadas ? `<tr><th>Postergadas para la próxima corrida</th><td>${r.compras_postergadas} — quedaron fuera por el tope de compras por corrida</td></tr>` : ""}
    </table>
    <p class="section-sub" style="margin-top:1rem">
      Los tres huecos conocidos, dichos de frente: (1) una compra <strong>sin adjuntos</strong> no deja
      ningún contacto, y son muchas; (2) un PDF <strong>escaneado</strong> no tiene capa de texto y
      haría falta OCR; (3) el filtro por categoría se evalúa sobre el <em>nombre</em> de la compra y el
      texto de sus adjuntos, así que una compra que solo nombra el producto en su descripción se
      escapa salvo que se corra con <code>--con-detalle</code>.
    </p>
    ${r.cuota_agotada ? `<p class="note">La cuota de la API se agotó a mitad del barrido: el listado está incompleto y la próxima corrida lo continúa desde donde quedó (las compras ya revisadas no se vuelven a bajar).</p>` : ""}
    ${r.solo_indice ? `<p class="note">Corrida con <code>--solo-indice</code>: no se consultó la API, solo se revisaron compras ya conocidas.</p>` : ""}
    ${fallidas}
  </section>

</main>

<footer>
  <div class="wrap">
    <p>
      Generado por <code>npm run leads</code> del repositorio <code>ks-compra-agil</code>. El índice
      acumulado vive en <code>historico/leads.jsonl</code>; esta página se regenera entero desde ahí.
    </p>
    <div class="links-row">
      <a class="btn secondary" href="index.html">Radar de Compra Ágil</a>
      <a class="btn secondary" href="licitaciones.html">Licitaciones</a>
      <a class="btn secondary" href="estudio-mercado.html">Estudio de mercado</a>
    </div>
  </div>
</footer>

<script type="application/json" id="csv-datos">${JSON.stringify(csv).replace(/</g, "\\u003c")}</script>
<script>
(function () {
  var grid = document.getElementById("grid");
  if (!grid) return;
  var tarjetas = Array.prototype.slice.call(grid.querySelectorAll(".lead"));
  var q = document.getElementById("q");
  var fCat = document.getElementById("f-categoria");
  var fEst = document.getElementById("f-estado");
  var fPer = document.getElementById("f-persona");
  var fRep = document.getElementById("f-repetidor");
  var conteo = document.getElementById("conteo");

  function visibles() {
    return tarjetas.filter(function (t) { return t.style.display !== "none"; });
  }

  function filtrar() {
    var texto = (q.value || "").toLowerCase().trim();
    var cat = fCat.value, est = fEst.value;
    tarjetas.forEach(function (t) {
      var ok = true;
      if (texto && t.getAttribute("data-filtro").indexOf(texto) === -1) ok = false;
      if (ok && cat && (" " + t.getAttribute("data-categorias") + " ").indexOf(" " + cat + " ") === -1) ok = false;
      if (ok && est && (" " + t.getAttribute("data-estados") + " ").indexOf(" " + est + " ") === -1) ok = false;
      if (ok && fPer.checked && t.getAttribute("data-persona") !== "si") ok = false;
      if (ok && fRep.checked && t.querySelectorAll("ul.compras li").length < 2) ok = false;
      t.style.display = ok ? "" : "none";
    });
    conteo.textContent = visibles().length + " de " + tarjetas.length + " contacto(s)";
  }

  [q, fCat, fEst, fPer, fRep].forEach(function (el) {
    el.addEventListener("input", filtrar);
    el.addEventListener("change", filtrar);
  });
  filtrar();

  document.getElementById("copiar").addEventListener("click", function () {
    var correos = visibles().map(function (t) { return t.querySelector(".email").textContent.trim(); });
    var texto = correos.join("; ");
    var boton = this;
    function listo() { boton.textContent = correos.length + " correos copiados"; setTimeout(function () { boton.textContent = "Copiar correos visibles"; }, 2500); }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(texto).then(listo, function () { window.prompt("Copiar:", texto); });
    } else {
      window.prompt("Copiar:", texto);
    }
  });

  document.getElementById("csv").addEventListener("click", function () {
    var csv = JSON.parse(document.getElementById("csv-datos").textContent);
    // BOM: sin él, Excel en español abre las tildes como caracteres raros.
    var blob = new Blob(["\\ufeff" + csv], { type: "text/csv;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url; a.download = "leads-compra-agil.csv";
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  });
})();
</script>

</body>
</html>
`;
}

export function escribirPaginaLeads(leads: LeadConsolidado[], r: ResumenCorridaLeads): string {
  mkdirSync(path.dirname(PAGINA_PATH), { recursive: true });
  writeFileSync(PAGINA_PATH, renderPaginaLeads(leads, r), "utf-8");
  return PAGINA_PATH;
}

/** Mismo contenido en Markdown, para leerlo desde el repo sin abrir el navegador. */
export function escribirInformeLeads(leads: LeadConsolidado[], r: ResumenCorridaLeads): string {
  const conNombre = leads.filter((l) => l.nombre && !l.buzon_funcional).length;
  const instituciones = new Set(leads.map((l) => l.organismo)).size;
  const lineas: string[] = [
    `# Leads de Compra Ágil — barrido histórico`,
    ``,
    `Generado ${r.generado_en} por \`npm run leads\`. Regenerable; el índice acumulado está en`,
    `\`historico/leads.jsonl\` y la página publicada en \`docs/leads.html\`.`,
    ``,
    `- **${leads.length}** contactos únicos · **${conNombre}** con nombre de persona · **${instituciones}** instituciones`,
    `- Estados barridos: ${r.estados.join(", ")}`,
    `- Categorías: ${r.categorias.map((c) => c.id).join(", ")}`,
    `- Compras con adjuntos leídos: ${r.compras_revisadas} en esta corrida (${r.compras_ya_revisadas} ya revisadas antes)`,
    `- Requests a la API en esta corrida: ${r.requests_api}`,
    ``,
    `El dato de contacto **no viene de la API** —no lo expone— sino del texto de los adjuntos que`,
    `publica el propio organismo comprador. Cada fila cita el archivo de donde salió.`,
    ``,
    `| Nombre | Correo | Cargo | Institución | Compras | Última |`,
    `|---|---|---|---|---|---|`,
  ];
  for (const l of leads) {
    const nombre = l.nombre ?? (l.buzon_funcional ? "_(buzón de área)_" : "_(sin nombre)_");
    const marca = l.confianza_nombre === "baja" ? " ⚠︎" : "";
    lineas.push(
      `| ${nombre}${marca} | ${l.email} | ${l.cargo ?? "—"} | ${l.organismo} | ${l.compras.length} (${l.compras
        .map((c) => c.codigo)
        .join(", ")}) | ${fechaCorta(l.ultima_fecha)} |`,
    );
  }
  lineas.push(``, `⚠︎ = nombre deducido del propio correo, no leído del documento.`, ``);
  mkdirSync(path.dirname(INFORME_PATH), { recursive: true });
  writeFileSync(INFORME_PATH, lineas.join("\n"), "utf-8");
  return INFORME_PATH;
}
