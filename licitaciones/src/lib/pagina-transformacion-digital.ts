/**
 * Publica los tres artefactos del nicho de Transformación Digital / Ley 21.180, los tres desde el
 * MISMO array ya ordenado y el mismo resumen:
 *
 *   - `docs/transformacion-digital.html`               — para leer y decidir
 *   - `docs/transformacion-digital-documentos.json`    — el manifiesto que consume Claude Cowork
 *   - `output/transformacion-digital.md`               — el gemelo en texto, para leerlo del repo
 *
 * Una sola función de escritura y no tres, porque página y manifiesto publican los mismos números:
 * dos caminos de código habrían podido divergir sin que nada lo delatara. Además la página imprime
 * el conteo del manifiesto, así que una divergencia sería visible en pantalla.
 *
 * Es una página NUEVA y entera, no un bloque entre marcadores: no se inserta en ninguna página
 * existente, así que no hace falta `reemplazarBloque` ni tocar `docs/licitaciones.html`.
 *
 * El manifiesto vive en `docs/` —y no en `historico/`— porque `docs/` está versionado *y* lo
 * publica GitHub Pages: Cowork lo lee del checkout o por HTTP sin clonar nada. `historico/` es, por
 * definición, índices jsonl append-only; un JSON completo reescrito en cada corrida no va ahí.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  REPO_ROOT,
  configTd,
  fechaOrdenable,
  motivoOrden,
  type Completitud,
  type RegistroIndice,
  type RegistroTd,
} from "./transformacion-digital.js";

const PAGINA_PATH = path.join(REPO_ROOT, "docs", "transformacion-digital.html");
const MANIFIESTO_PATH = path.join(REPO_ROOT, "docs", "transformacion-digital-documentos.json");
const INFORME_PATH = path.join(REPO_ROOT, "output", "transformacion-digital.md");

/** Esquema versionado: la Fase 2 debe fallar ruidosamente si cambia, no adivinar. */
const ESQUEMA = "ks-td-documentos/1";
const CARPETA_RAIZ = "descargas/transformacion-digital";

export interface CombinacionTruncada {
  consulta: string;
  estado: string;
}

export interface ResumenCorridaTd {
  generado_en: string;
  /** Nombres de estado barridos ("publicadas", "adjudicadas", …). */
  estados: string[];
  consultas: string[];
  combinaciones: number;
  combinaciones_truncadas: CombinacionTruncada[];
  ordenes_rotados: number;
  filas_brutas: number;
  codigos_distintos: number;
  confirmados: number;
  /** Cuántas filas mató cada motivo/patrón del embudo. Se publica: un excluyente puede matar un acierto. */
  descartes: { motivo: string; patron?: string; filas: number }[];
  enriquecidos_esta_corrida: number;
  consultas_fallidas: { consulta: string; estado: string; error: string }[];
  solo_indice: boolean;
  refiltrado: boolean;
  requests: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers de formato
// ─────────────────────────────────────────────────────────────────────────────

function esc(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return "";
  return String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const CLP = new Intl.NumberFormat("es-CL");

function fmtClp(n: number | null | undefined): string | null {
  return typeof n === "number" && n > 0 ? `$${CLP.format(n)}` : null;
}

/** "16/06/2026 11:36:34" -> "16-06-2026". Se conserva el día porque es lo que ordena la lista. */
function fechaCorta(fecha: string): string {
  const m = fecha.match(/^(\d{2})[/-](\d{2})[/-](\d{4})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : fecha;
}

/** Clase CSS del chip de estado, a partir de la glosa que entrega el portal. */
function claseEstado(estado: string): string {
  const e = estado.toLowerCase();
  if (e.includes("publicada")) return "est-abierta";
  if (e.includes("adjudicada")) return "est-adjudicada";
  if (e.includes("desierta") || e.includes("revocada")) return "est-fallida";
  return "est-cerrada";
}

const GLOSA_COMPLETITUD: Record<Completitud, string> = {
  "solo-listado":
    "Leído solo del listado del buscador (nombre y descripción). La ficha de esta licitación todavía no se indexó.",
  "solo-ficha-publica":
    "Leído de la ficha pública del portal. El detalle fino —EE.TT., bases administrativas, anexos técnicos— vive en los adjuntos en PDF, que esta fase no bajó a propósito.",
  "con-adjuntos": "Leído de la ficha pública y del texto de los adjuntos ya descargados.",
};

function carpetaDe(codigo: string): string {
  return `${CARPETA_RAIZ}/${codigo}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Manifiesto
// ─────────────────────────────────────────────────────────────────────────────

export interface EntradaManifiesto {
  orden: number;
  codigo: string;
  nombre: string;
  organismo: string;
  estado: string;
  categorias: string[];
  fecha_publicacion: string;
  monto_clp: number | null;
  carpeta: string;
  motivo_orden: string;
  url_ficha: string;
  documentos: { clave: string; titulo: string; url: string; acceso: string; archivo_sugerido?: string; nota?: string }[];
  requerimientos_funcionales: {
    completitud: Completitud;
    detectados: { eje: string; requisito: string; evidencia: string; fuente: string }[];
    pendiente?: string;
  };
  exigencias_administrativas?: { requisito: string; evidencia: string; fuente: string }[];
}

function urlFicha(codigo: string): string {
  return `https://www.mercadopublico.cl/Procurement/Modules/RFB/DetailsAcquisition.aspx?idlicitacion=${encodeURIComponent(codigo)}`;
}

/** Nombre sugerido de archivo por documento. Es una sugerencia, no una promesa de que exista. */
function archivoSugerido(clave: string, indice: number): string | undefined {
  const nn = String(indice + 1).padStart(2, "0");
  if (clave === "ficha") return `${nn}-bases-ficha-publica.html`;
  if (clave === "adjuntos") return `${nn}-adjuntos/`;
  if (clave === "preguntas-respuestas") return `${nn}-preguntas-respuestas.xls`;
  if (clave === "foro") return undefined; // es una vista web, no un archivo
  return `${nn}-${clave}`;
}

export function construirManifiesto(registros: RegistroTd[], r: ResumenCorridaTd): {
  esquema: string;
  generado_en: string;
  generado_por: string;
  pagina: string;
  indice: string;
  carpeta_destino_sugerida: string;
  cobertura: Record<string, unknown>;
  advertencias: string[];
  licitaciones: EntradaManifiesto[];
  pendientes_de_enriquecer: { orden: number; codigo: string; nombre: string; motivo: string }[];
} {
  const enriquecidas = registros.filter((x) => x.enriquecido_en);
  const licitaciones: EntradaManifiesto[] = registros.map((x, i) => ({
    orden: i + 1,
    codigo: x.codigo,
    nombre: x.nombre,
    organismo: x.organismo,
    estado: x.estado,
    categorias: x.categorias,
    fecha_publicacion: fechaOrdenable(x.fecha_publicacion).slice(0, 10),
    monto_clp: x.monto_clp,
    carpeta: carpetaDe(x.codigo),
    motivo_orden: motivoOrden(x),
    url_ficha: urlFicha(x.codigo),
    documentos: (x.documentos ?? []).map((d, j) => ({
      clave: d.clave,
      titulo: d.titulo,
      url: d.url,
      acceso: d.acceso,
      archivo_sugerido: archivoSugerido(d.clave, j),
      nota: d.nota,
    })),
    requerimientos_funcionales: {
      completitud: x.completitud,
      detectados: x.requerimientos,
      pendiente:
        x.completitud === "con-adjuntos"
          ? undefined
          : "El detalle fino está en los adjuntos en PDF (documentos con clave=adjuntos), tras el reCAPTCHA del visor del portal.",
    },
    exigencias_administrativas: x.exigencias_administrativas,
  }));

  return {
    esquema: ESQUEMA,
    generado_en: r.generado_en,
    generado_por: "npm run transformacion-digital",
    pagina: "docs/transformacion-digital.html",
    indice: "historico/transformacion-digital.jsonl",
    carpeta_destino_sugerida: CARPETA_RAIZ,
    cobertura: {
      estados: r.estados,
      consultas: r.consultas.length,
      combinaciones: r.combinaciones,
      combinaciones_truncadas: r.combinaciones_truncadas.length,
      ordenes_rotados: r.ordenes_rotados,
      filas_brutas: r.filas_brutas,
      codigos_distintos: r.codigos_distintos,
      confirmados: registros.length,
      enriquecidos: enriquecidas.length,
      pendientes_de_enriquecer: registros.length - enriquecidas.length,
    },
    advertencias: [
      `El buscador del portal topa en 1.000 filas por descarga: ${r.combinaciones_truncadas.length} de ${r.combinaciones} combinaciones consulta×estado quedaron truncadas y en esas se rotó el criterio de orden para ver otro corte.`,
      'Los documentos con acceso "navegador" están tras un reCAPTCHA por score del visor del portal: los abre un navegador real o una persona, no un cliente HTTP. Este repo no rodea ese control.',
      "Los requerimientos funcionales se detectan por patrón sobre el texto del listado y de la ficha pública, con su cita literal. El detalle fino vive en los adjuntos en PDF, que esta fase no bajó.",
    ],
    licitaciones,
    pendientes_de_enriquecer: registros
      .map((x, i) => ({ x, i }))
      .filter(({ x }) => !x.enriquecido_en)
      .map(({ x, i }) => ({
        orden: i + 1,
        codigo: x.codigo,
        nombre: x.nombre,
        motivo: "no alcanzó el cap de --fichas de esta corrida",
      })),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Página
// ─────────────────────────────────────────────────────────────────────────────

function nombreCategoria(id: string): string {
  return configTd().categorias.find((c) => c.id === id)?.nombre ?? id;
}

function nombreEje(id: string): string {
  return configTd().ejes.find((e) => e.id === id)?.nombre ?? id;
}

function filasDatos(x: RegistroTd): string {
  // Se emite SOLO el dato informado: una fila con "—" haría creer que el organismo declaró algo
  // que no declaró. Mismo criterio que `licitaciones/src/lib/pagina.ts`.
  const filas: [string, string][] = [];
  const monto = fmtClp(x.monto_clp);
  if (monto) filas.push(["Monto", monto]);
  else if (x.monto_texto) filas.push(["Monto", x.monto_texto]);
  if (x.tipo) filas.push(["Tipo", x.tipo]);
  if (x.fecha_publicacion) filas.push(["Publicada", fechaCorta(x.fecha_publicacion)]);
  if (x.ficha?.cierre) filas.push(["Cierre", x.ficha.cierre.replace("T", " ").slice(0, 16)]);
  if (x.ficha?.adjudicacion) filas.push(["Adjudicación", x.ficha.adjudicacion.slice(0, 10)]);
  if (x.ficha?.duracion_contrato) filas.push(["Duración", x.ficha.duracion_contrato]);
  if (typeof x.ficha?.peso_precio === "number") filas.push(["Peso del precio", `${x.ficha.peso_precio}%`]);
  if (x.ficha?.garantia_exigida) filas.push(["Garantía", "exigida"]);
  if (typeof x.ficha?.anexos_total === "number") filas.push(["Anexos exigidos", String(x.ficha.anexos_total)]);
  if (x.ficha?.clausulas_excluyentes) filas.push(["Cláusulas excluyentes", String(x.ficha.clausulas_excluyentes)]);
  if (filas.length === 0) return "";
  return `<dl class="datos">${filas.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl>`;
}

function bloqueDocumentos(x: RegistroTd): string {
  const docs = x.documentos ?? [];
  if (!x.enriquecido_en) {
    return `<p class="doc-vacio">Los documentos de esta licitación todavía no se indexaron. Se indexan corriendo <code>npm run transformacion-digital -- --fichas=N</code>; mientras tanto, la ficha del portal se abre con el botón de abajo.</p>`;
  }
  if (docs.length === 0) {
    return `<p class="doc-vacio">La ficha se indexó y el organismo no publicó documentos descargables más allá de las propias bases.</p>`;
  }
  const items = docs
    .map((d, j) => {
      const chip =
        d.acceso === "directo"
          ? '<span class="chip acceso ok">lo baja un script</span>'
          : '<span class="chip acceso warn">abrir en el portal — reCAPTCHA</span>';
      const archivo = archivoSugerido(d.clave, j);
      const sugerido = archivo ? ` <span class="sugerido mono">${esc(archivo)}</span>` : "";
      const nota = d.nota ? `<p class="doc-nota">${esc(d.nota)}</p>` : "";
      return `<li><a href="${esc(d.url)}" rel="noopener">${esc(d.titulo)}</a> ${chip}${sugerido}${nota}</li>`;
    })
    .join("");
  return `<ul class="docs">${items}</ul>
      <p class="carpeta">Carpeta destino sugerida: <code>${esc(carpetaDe(x.codigo))}</code> <button class="btn secondary mini" data-copiar="${esc(carpetaDe(x.codigo))}">copiar</button></p>`;
}

function bloqueRequerimientos(x: RegistroTd): string {
  const glosa = `<p class="completitud">${esc(GLOSA_COMPLETITUD[x.completitud])}</p>`;
  if (x.requerimientos.length === 0) {
    return `<details class="reqs"><summary>Requerimientos funcionales — ninguno detectado todavía</summary>${glosa}</details>`;
  }
  const porEje = new Map<string, RegistroTd["requerimientos"]>();
  for (const q of x.requerimientos) {
    const lista = porEje.get(q.eje) ?? [];
    lista.push(q);
    porEje.set(q.eje, lista);
  }
  const grupos = [...porEje]
    .map(
      ([eje, lista]) =>
        `<div class="eje"><h4>${esc(nombreEje(eje))}</h4><ul>${lista
          .map(
            (q) =>
              `<li><strong>${esc(q.requisito)}</strong><blockquote>${esc(q.evidencia)}</blockquote><span class="fuente">${esc(q.fuente)}</span></li>`,
          )
          .join("")}</ul></div>`,
    )
    .join("");
  return `<details class="reqs"><summary>${x.requerimientos.length} requerimiento(s) funcional(es) detectado(s)</summary>${glosa}${grupos}</details>`;
}

function bloqueExigencias(x: RegistroTd): string {
  const ex = x.exigencias_administrativas ?? [];
  if (ex.length === 0) return "";
  return `<details class="reqs admin"><summary>${ex.length} exigencia(s) administrativa(s)</summary><ul>${ex
    .map(
      (e) =>
        `<li><strong>${esc(e.requisito)}</strong><blockquote>${esc(e.evidencia)}</blockquote><span class="fuente">${esc(e.fuente)}</span></li>`,
    )
    .join("")}</ul></details>`;
}

function tarjeta(x: RegistroTd, orden: number): string {
  const filtro = `${x.codigo} ${x.nombre} ${x.organismo} ${x.descripcion}`.toLowerCase();
  const anio = fechaOrdenable(x.fecha_publicacion).slice(0, 4);
  const chips = x.categorias.map((c) => `<span class="chip cat">${esc(nombreCategoria(c))}</span>`).join("");
  const evidencia = x.evidencia
    .map(
      (e) =>
        `<li><strong>${esc(nombreCategoria(e.categoria))}</strong><blockquote>${esc(e.cita)}</blockquote></li>`,
    )
    .join("");
  return `
    <article class="lic" id="${esc(x.codigo)}"
      data-filtro="${esc(filtro)}"
      data-categorias="${esc(x.categorias.join(","))}"
      data-estado="${esc(claseEstado(x.estado))}"
      data-anio="${esc(anio)}"
      data-docs="${(x.documentos ?? []).length}"
      data-enriquecida="${x.enriquecido_en ? "si" : "no"}">
      <header>
        <span class="orden">#${orden}</span>
        <a class="codigo mono" href="${esc(urlFicha(x.codigo))}" rel="noopener">${esc(x.codigo)}</a>
        <span class="chip estado ${claseEstado(x.estado)}">${esc(x.estado)}</span>
      </header>
      <h3>${esc(x.nombre)}</h3>
      <p class="org">${esc(x.organismo)}</p>
      <div class="chips">${chips}</div>
      ${x.descripcion ? `<p class="descripcion">${esc(x.descripcion)}</p>` : ""}
      ${filasDatos(x)}
      <p class="motivo">${esc(motivoOrden(x))}</p>
      <details class="porque"><summary>Por qué está en esta lista</summary><ul class="citas">${evidencia}</ul>
        <p class="fuente">Encontrada con: ${esc(x.consultas.join(" · "))}</p></details>
      ${bloqueRequerimientos(x)}
      ${bloqueExigencias(x)}
      <div class="documentos"><h4>Documentos</h4>${bloqueDocumentos(x)}</div>
      <a class="btn" href="${esc(urlFicha(x.codigo))}" rel="noopener">Ver la ficha en el portal</a>
    </article>`;
}

function bloqueResumen(registros: RegistroTd[], r: ResumenCorridaTd): string {
  const conLey = registros.filter((x) => x.categorias.includes("ley21180")).length;
  const organismos = new Set(registros.map((x) => x.organismo)).size;
  const docs = registros.reduce((n, x) => n + (x.documentos?.length ?? 0), 0);
  const trasCaptcha = registros.reduce(
    (n, x) => n + (x.documentos ?? []).filter((d) => d.acceso === "navegador").length,
    0,
  );
  const abiertas = registros.filter((x) => claseEstado(x.estado) === "est-abierta").length;
  const stats: [number, string][] = [
    [registros.length, "licitaciones del nicho"],
    [conLey, "citan la Ley 21.180 o la transformación digital del Estado"],
    [organismos, "organismos distintos"],
    [docs, "documentos indexados"],
    [trasCaptcha, "de ellos, tras el reCAPTCHA del portal"],
    [abiertas, "abiertas para ofertar ahora"],
  ];
  return `<div class="stat-grid">${stats
    .map(([n, l]) => `<div class="stat"><div class="num">${n}</div><div class="label">${esc(l)}</div></div>`)
    .join("")}</div>`;
}

function bloqueLimites(registros: RegistroTd[], r: ResumenCorridaTd): string {
  const sinEnriquecer = registros.filter((x) => !x.enriquecido_en).length;
  const truncadas = r.combinaciones_truncadas
    .slice(0, 12)
    .map((c) => `<code>${esc(c.consulta)}</code> · ${esc(c.estado)}`)
    .join("; ");
  const descartes = r.descartes
    .slice(0, 12)
    .map((d) => `<tr><td>${esc(d.patron ?? d.motivo)}</td><td>${esc(d.motivo)}</td><td>${d.filas}</td></tr>`)
    .join("");
  return `
    <table class="detalle">
      <tr><th>Qué</th><th>Cuánto</th></tr>
      <tr><td>Combinaciones consulta × estado corridas</td><td>${r.combinaciones}</td></tr>
      <tr><td>De ellas, truncadas en el tope de 1.000 filas</td><td>${r.combinaciones_truncadas.length}</td></tr>
      <tr><td>Consultas repetidas rotando el criterio de orden, para ver otro corte</td><td>${r.ordenes_rotados}</td></tr>
      <tr><td>Filas revisadas en total</td><td>${r.filas_brutas}</td></tr>
      <tr><td>Códigos distintos vistos</td><td>${r.codigos_distintos}</td></tr>
      <tr><td>Confirmados por el embudo local</td><td>${registros.length}</td></tr>
      <tr><td>Fichas todavía sin indexar</td><td>${sinEnriquecer}</td></tr>
      <tr><td>Consultas que fallaron</td><td>${r.consultas_fallidas.length}</td></tr>
    </table>

    <p><strong>El tope de 1.000 filas por descarga es del portal y no se puede subir.</strong>
    ${r.combinaciones_truncadas.length > 0 ? `Quedaron truncadas: ${truncadas}${r.combinaciones_truncadas.length > 12 ? " y otras" : ""}.` : "Ninguna combinación llegó al tope en esta corrida."}
    El buscador ordena por relevancia, así que lo que queda fuera es la cola — pero eso es una
    expectativa, no una garantía. La mitigación que sí se aplicó es rotar el criterio de orden en
    las combinaciones truncadas: medido el 2026-08-25, tres órdenes distintos sobre la misma
    consulta comparten solo 162 de sus 1.000 filas y su unión da 2.545 códigos únicos.</p>

    <p><strong>El buscador del portal matchea tokens sueltos, no frases.</strong> Medido:
    <code>ley 21.180</code> sobre licitaciones cerradas devuelve 1.000 filas encabezadas por
    «ADQUISICIÓN DE MATERIAL DEPORTIVO» y «Construcción Multicancha», porque matcheó la palabra
    «ley». Ese ruido es del servidor y no se puede evitar; la precisión la pone el embudo local,
    que exige que la compra sea del <em>servicio</em> buscado y no solo que mencione la materia.</p>

    ${
      descartes
        ? `<p><strong>Qué descartó el embudo.</strong> Un excluyente puede matar un acierto real, así que se publica lo que mató cada uno. El volcado completo queda en <code>licitaciones/data/_td-descartados.json</code> y se recalibra con <code>npm run transformacion-digital -- --refiltrar</code>, que no gasta ningún request.</p>
    <table class="detalle"><tr><th>Patrón</th><th>Motivo</th><th>Filas</th></tr>${descartes}</table>`
        : ""
    }

    <p><strong>Los archivos adjuntos no se bajaron, y es a propósito.</strong> El visor del portal
    los protege con un reCAPTCHA por score que este repo ya midió cinco veces, incluso con sesión
    de ClaveÚnica autenticada (score 0 contra un umbral de 0,5). El guardrail del proyecto es
    detenerse ante un CAPTCHA y pedir intervención humana, nunca rodearlo. Lo que se publica es la
    <em>URL</em>, marcada como <span class="chip acceso warn">abrir en el portal</span>; bajarla es
    la Fase 2, en la máquina del usuario.</p>

    <p><strong>Los requerimientos funcionales son un detector por patrón, no una lectura del
    pliego.</strong> Encuentran lo que está nombrado en el texto disponible y citan la frase
    exacta. Cada tarjeta declara qué alcanzó a ver — solo el listado, la ficha pública, o también
    los adjuntos.</p>`;
}

export function renderPagina(registros: RegistroTd[], r: ResumenCorridaTd, manifiesto: unknown): string {
  const tarjetas = registros.map((x, i) => tarjeta(x, i + 1)).join("\n");
  const categorias = configTd().categorias;
  const anios = [...new Set(registros.map((x) => fechaOrdenable(x.fecha_publicacion).slice(0, 4)))]
    .filter((a) => /^\d{4}$/.test(a))
    .sort()
    .reverse();
  const cfg = configTd().cruda;

  return `<!doctype html>
<html lang="es-CL">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Licitaciones de Transformación Digital y Ley 21.180 — KeepSync</title>
<meta name="description" content="Licitaciones públicas de Chile, activas y pasadas, que piden sistemas de gestión documental, firma electrónica o cumplimiento de la Ley 21.180, con acceso ordenado a sus documentos." />
<meta name="robots" content="noindex, nofollow" />
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
  section { margin-bottom: 2.6rem; }
  h2 { font-size: 1.35rem; margin: 0 0 0.3rem; }
  h4 { font-size: 0.9rem; margin: 0.8rem 0 0.3rem; color: var(--accent-light); }
  .section-sub { color: var(--gray); font-size: 0.92rem; margin: 0 0 1.1rem; max-width: 74ch; }
  .stat-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 0.9rem; }
  .stat { background: var(--card); border: 1px solid var(--border); border-radius: 10px; padding: 1.1rem 1.2rem; }
  .stat .num { font-size: 1.9rem; font-weight: 700; color: var(--accent-light); line-height: 1.1; }
  .stat .label { color: var(--gray); font-size: 0.85rem; margin-top: 0.35rem; }
  .controls { display: flex; flex-wrap: wrap; gap: 0.6rem; align-items: center; margin-bottom: 1rem; }
  .controls input[type=search], .controls select { background: var(--card); color: var(--white); border: 1px solid var(--border); border-radius: 8px; padding: 0.55rem 0.8rem; font-size: 0.9rem; font-family: inherit; }
  .controls input[type=search] { flex: 1 1 260px; }
  .controls label { color: var(--gray-dim); font-size: 0.85rem; display: flex; align-items: center; gap: 0.35rem; }
  .btn { display: inline-block; background: var(--accent); color: var(--white); border: none; text-decoration: none; padding: 0.55rem 0.9rem; border-radius: 8px; font-size: 0.85rem; font-weight: 600; cursor: pointer; font-family: inherit; }
  .btn:hover { background: var(--accent-light); color: var(--bg); }
  .btn.secondary { background: transparent; border: 1px solid var(--border); color: var(--gray); }
  .btn.secondary:hover { border-color: var(--accent-light); color: var(--accent-light); }
  .btn.mini { padding: 0.15rem 0.45rem; font-size: 0.72rem; font-weight: 500; }
  #conteo { color: var(--gray-dim); font-size: 0.85rem; margin-bottom: 0.9rem; }
  .lic-grid { display: grid; gap: 1.1rem; }
  .lic { background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 1.15rem 1.25rem; }
  .lic > header { display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: center; background: none; border: none; padding: 0; }
  .orden { font-weight: 700; color: var(--accent-light); font-size: 0.95rem; }
  .codigo { font-size: 0.85rem; text-decoration: none; }
  .lic h3 { margin: 0.5rem 0 0.15rem; font-size: 1.06rem; }
  .org { margin: 0 0 0.5rem; color: var(--gray); font-size: 0.88rem; }
  .descripcion { color: var(--gray); font-size: 0.88rem; margin: 0.5rem 0; }
  .chips { display: flex; flex-wrap: wrap; gap: 0.3rem; }
  .chip { font-size: 0.72rem; padding: 0.12rem 0.5rem; border-radius: 999px; border: 1px solid var(--border); color: var(--gray); background: var(--card-alt); }
  .chip.cat { border-color: var(--accent); color: var(--accent-light); }
  .chip.est-abierta { border-color: var(--ok); color: var(--ok); }
  .chip.est-adjudicada { border-color: var(--accent-light); color: var(--accent-light); }
  .chip.est-fallida { border-color: var(--bad); color: var(--bad); }
  .chip.acceso.ok { border-color: var(--ok); color: var(--ok); }
  .chip.acceso.warn { border-color: var(--warn); color: var(--warn); }
  dl.datos { display: grid; grid-template-columns: auto 1fr; gap: 0.15rem 0.8rem; margin: 0.7rem 0; font-size: 0.85rem; }
  dl.datos dt { color: var(--gray-dim); }
  dl.datos dd { margin: 0; }
  .motivo { color: var(--gray-dim); font-size: 0.8rem; margin: 0.5rem 0; font-style: italic; }
  details { margin: 0.5rem 0; }
  details summary { cursor: pointer; color: var(--gray); font-size: 0.85rem; }
  details ul { margin: 0.5rem 0 0; padding-left: 1.1rem; }
  details li { font-size: 0.84rem; margin-bottom: 0.5rem; }
  blockquote { margin: 0.25rem 0; padding-left: 0.7rem; border-left: 2px solid var(--border); color: var(--gray); font-size: 0.82rem; }
  .fuente { color: var(--gray-dim); font-size: 0.76rem; font-family: ui-monospace, Menlo, monospace; }
  .completitud { color: var(--gray-dim); font-size: 0.8rem; margin: 0.4rem 0; }
  .documentos { margin-top: 0.9rem; padding-top: 0.8rem; border-top: 1px solid var(--border); }
  ul.docs { list-style: none; margin: 0.4rem 0 0.6rem; padding: 0; display: flex; flex-direction: column; gap: 0.5rem; }
  ul.docs li { font-size: 0.86rem; }
  .sugerido { color: var(--gray-dim); font-size: 0.76rem; }
  .doc-nota { color: var(--gray-dim); font-size: 0.78rem; margin: 0.15rem 0 0; }
  .doc-vacio { color: var(--gray-dim); font-size: 0.84rem; margin: 0.4rem 0; }
  .carpeta { font-size: 0.8rem; color: var(--gray-dim); margin: 0.3rem 0 0.7rem; }
  .note { background: var(--card-alt); border: 1px solid var(--border); border-left: 3px solid var(--warn); border-radius: 8px; padding: 0.8rem 1rem; font-size: 0.86rem; color: var(--gray); }
  .note.info { border-left-color: var(--accent); }
  .note p:last-child { margin-bottom: 0; }
  table.detalle { width: 100%; border-collapse: collapse; font-size: 0.86rem; margin: 0.8rem 0; }
  table.detalle th, table.detalle td { text-align: left; padding: 0.45rem 0.6rem; border-bottom: 1px solid var(--border); }
  table.detalle th { color: var(--gray-dim); font-weight: 500; }
  .kw-grid { display: grid; gap: 0.9rem; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); }
  .kw-card { background: var(--card); border: 1px solid var(--border); border-radius: 10px; padding: 1rem 1.1rem; }
  .kw-card h3 { margin: 0 0 0.4rem; font-size: 0.98rem; }
  .kw-card pre { white-space: pre-wrap; word-break: break-all; font-size: 0.72rem; color: var(--gray-dim); margin: 0.3rem 0 0; }
  code, .mono { font-family: ui-monospace, Menlo, monospace; }
  a { color: var(--accent-light); }
  a:hover { color: var(--white); }
  footer { border-top: 1px solid var(--border); padding: 2rem 0; color: var(--gray-dim); font-size: 0.85rem; }
  .links-row { display: flex; flex-wrap: wrap; gap: 0.6rem; margin-top: 1rem; }
  .vacio { background: var(--card); border: 1px dashed var(--border); border-radius: 12px; padding: 2rem; text-align: center; color: var(--gray); }
</style>
</head>
<body>

<header class="hero">
  <div class="wrap">
    <h1>Licitaciones de Transformación Digital y Ley 21.180</h1>
    <p class="subtitle">
      Licitaciones públicas de mercadopublico.cl —<strong>activas y pasadas</strong>— que piden un
      sistema de gestión documental web, procesos documentales, firma electrónica, o que invocan la
      Ley 21.180 y los servicios DocDigital, FirmaGob y Exedoc. Esta página no existe para decidir
      si ofertar: existe para <strong>llegar a los documentos</strong> y leer en ellos qué le está
      pidiendo el Estado a un sistema como este.
    </p>
    <p class="meta">
      Generada el ${esc(r.generado_en)} por <code>npm run transformacion-digital</code>${r.solo_indice ? " (republicación desde el índice, sin consultar el portal)" : ""}.
      Manifiesto para Claude Cowork: <a href="transformacion-digital-documentos.json">transformacion-digital-documentos.json</a>.
      Índice histórico: <code>historico/transformacion-digital.jsonl</code>.
    </p>
  </div>
</header>

<main class="wrap">

  <section>
    <h2>Lo que encontró esta corrida</h2>
    ${bloqueResumen(registros, r)}
  </section>

  <section>
    <h2>Las licitaciones, en orden de descarga</h2>
    <p class="section-sub">
      El orden por defecto <strong>no es cronológico</strong>, y conviene saber por qué. Esta lista
      existe para decidir de qué licitación bajar los documentos primero, y para eso una licitación
      <strong>adjudicada del año pasado vale más que una publicada ayer</strong>: ya tiene el foro
      de preguntas respondido, las bases definitivas y el acta de adjudicación. Así que ordena por
      cuánto material hay para leer —documentos indexados y requerimientos ya detectados—, y recién
      desempata por fecha. La recencia es un criterio de venta; acá el criterio es aprender.
    </p>

    <div class="controls">
      <input type="search" id="q" placeholder="Buscar por código, organismo, nombre o descripción…" />
      <select id="orden">
        <option value="lista">Orden de descarga (por defecto)</option>
        <option value="reciente">Más reciente primero</option>
        <option value="monto">Mayor monto primero</option>
      </select>
      <select id="categoria">
        <option value="">Todas las categorías</option>
        ${categorias.map((c) => `<option value="${esc(c.id)}">${esc(c.nombre)}</option>`).join("")}
      </select>
      <select id="estado">
        <option value="">Todos los estados</option>
        <option value="est-abierta">Abiertas para ofertar</option>
        <option value="est-adjudicada">Adjudicadas</option>
        <option value="est-cerrada">Cerradas</option>
        <option value="est-fallida">Desiertas o revocadas</option>
      </select>
      <select id="anio">
        <option value="">Todos los años</option>
        ${anios.map((a) => `<option value="${esc(a)}">${esc(a)}</option>`).join("")}
      </select>
      <label><input type="checkbox" id="soloDocs" /> solo con documentos</label>
      <button class="btn secondary" id="copiarCodigos">Copiar códigos visibles</button>
      <button class="btn secondary" id="bajarManifiesto">Descargar manifiesto de lo visible</button>
    </div>
    <div id="conteo"></div>

    ${
      registros.length === 0
        ? `<div class="vacio"><p>Ninguna licitación pasó el embudo en esta corrida.</p>
           <p>Esta página no inventa oportunidades: si no hay, no hay. Revisa
           <code>licitaciones/data/_td-descartados.json</code> para ver qué descartó cada patrón.</p></div>`
        : `<div class="lic-grid" id="grid">${tarjetas}</div>`
    }
  </section>

  <section>
    <h2>Cómo bajar los documentos (Fase 2)</h2>
    <div class="note info">
      <p>El archivo <a href="transformacion-digital-documentos.json"><code>transformacion-digital-documentos.json</code></a>
      es el mismo listado de arriba en un formato que lee una máquina: por cada licitación trae su
      orden, la carpeta destino sugerida y cada documento con su URL y su campo <code>acceso</code>.</p>
      <p><strong><code>acceso: "directo"</code></strong> — un <code>fetch</code> lo trae sin
      autenticación: la ficha pública, el foro de preguntas y el Excel oficial de preguntas y
      respuestas.<br />
      <strong><code>acceso: "navegador"</code></strong> — el visor de adjuntos del portal, protegido
      por un reCAPTCHA por score. Lo abre un navegador real o una persona. Este repo no rodea ese
      control, y ya midió que ni siquiera una sesión autenticada con ClaveÚnica lo abre.</p>
      <p>El campo <code>esquema</code> está versionado a propósito: si cambia, la Fase 2 debe
      fallar en vez de adivinar. Y el estado de las descargas <strong>no</strong> se escribe en este
      archivo — la Fase 2 lleva el suyo en su propia carpeta, para que el manifiesto siga siendo
      reproducible desde el índice.</p>
    </div>
  </section>

  <section>
    <h2>Qué palabras busca este barrido</h2>
    <p class="section-sub">
      Se publican para que se puedan discutir. Son de <strong>solo lectura</strong>: la página es
      estática y no puede escribir en el repo, así que fingir un formulario de guardado sería
      mentir. Se editan en <code>licitaciones/config/transformacion-digital.json</code> y se
      recalibran con <code>npm run transformacion-digital -- --refiltrar</code>, que reprocesa el
      barrido ya descargado sin gastar un solo request.
    </p>
    <div class="kw-grid">
      ${categorias
        .map(
          (c) => `<div class="kw-card">
        <h3>${esc(c.nombre)}</h3>
        ${c.descripcion ? `<p class="section-sub" style="margin:0 0 .5rem">${esc(c.descripcion)}</p>` : ""}
        <div class="chips">${(cfg.categorias.find((k) => k.id === c.id)?.consultas_portal ?? [])
          .map((q) => `<span class="chip">${esc(q)}</span>`)
          .join("")}</div>
        <details><summary>patrón de confirmación</summary><pre>${esc(cfg.categorias.find((k) => k.id === c.id)?.patron_mencion ?? "")}</pre></details>
      </div>`,
        )
        .join("")}
    </div>
    <div class="note" style="margin-top:1rem">
      <p>Una palabra encontrada por el buscador <strong>no basta</strong>: además tiene que pasar el
      <code>patron_requerido</code> —que exige que la compra sea del <em>servicio</em> buscado y no
      solo que mencione la materia— y no caer en ninguno de los dos patrones excluyentes. Ese
      embudo es lo que convierte miles de filas de ruido en esta lista.</p>
      <details><summary>ver <code>patron_requerido</code> y los excluyentes</summary>
        <p class="fuente">patron_requerido</p><pre>${esc(cfg.patron_requerido)}</pre>
        <p class="fuente">patron_excluyente (sobre nombre + descripción)</p><pre>${esc(cfg.patron_excluyente)}</pre>
        <p class="fuente">patron_excluyente_nombre (solo sobre el nombre)</p><pre>${esc(cfg.patron_excluyente_nombre)}</pre>
      </details>
    </div>
  </section>

  <section>
    <h2>Qué mide y qué no alcanza a ver esta corrida</h2>
    <p class="section-sub">
      El método tiene límites conocidos y medidos. Publicarlos es parte del resultado: una lista sin
      su margen de error se lee como si fuera completa.
    </p>
    ${bloqueLimites(registros, r)}
  </section>

</main>

<footer>
  <div class="wrap">
    <p>KeepSync · datos públicos de mercadopublico.cl, leídos del buscador público y de las fichas
    públicas de cada licitación. Sin ticket de API, sin login y sin cuota.</p>
    <div class="links-row">
      <a class="btn secondary" href="index.html">Compras Ágiles</a>
      <a class="btn secondary" href="licitaciones.html">Licitaciones (servicios Array)</a>
      <a class="btn secondary" href="leads.html">Leads</a>
      <a class="btn secondary" href="transformacion-digital-documentos.json">Manifiesto JSON</a>
    </div>
  </div>
</footer>

<script type="application/json" id="manifiesto">${JSON.stringify(manifiesto).replace(/</g, "\\u003c")}</script>
<script>
(function () {
  var grid = document.getElementById("grid");
  if (!grid) return;
  var tarjetas = Array.prototype.slice.call(grid.querySelectorAll(".lic"));
  var orig = tarjetas.slice();
  var manifiesto = JSON.parse(document.getElementById("manifiesto").textContent);
  var porCodigo = {};
  for (var i = 0; i < manifiesto.licitaciones.length; i++) porCodigo[manifiesto.licitaciones[i].codigo] = manifiesto.licitaciones[i];

  var q = document.getElementById("q");
  var orden = document.getElementById("orden");
  var categoria = document.getElementById("categoria");
  var estado = document.getElementById("estado");
  var anio = document.getElementById("anio");
  var soloDocs = document.getElementById("soloDocs");
  var conteo = document.getElementById("conteo");

  function visibles() {
    var out = [];
    for (var i = 0; i < tarjetas.length; i++) if (tarjetas[i].style.display !== "none") out.push(tarjetas[i]);
    return out;
  }

  function montoDe(t) {
    var m = porCodigo[t.id];
    return m && m.monto_clp ? m.monto_clp : 0;
  }

  function fechaDe(t) {
    var m = porCodigo[t.id];
    return m && m.fecha_publicacion ? m.fecha_publicacion : "";
  }

  function aplicar() {
    var texto = q.value.toLowerCase().trim();
    var c = categoria.value, e = estado.value, a = anio.value, d = soloDocs.checked;
    var n = 0;
    for (var i = 0; i < tarjetas.length; i++) {
      var t = tarjetas[i];
      var ok = true;
      if (texto && t.getAttribute("data-filtro").indexOf(texto) === -1) ok = false;
      if (ok && c && ("," + t.getAttribute("data-categorias") + ",").indexOf("," + c + ",") === -1) ok = false;
      if (ok && e && t.getAttribute("data-estado") !== e) ok = false;
      if (ok && a && t.getAttribute("data-anio") !== a) ok = false;
      if (ok && d && Number(t.getAttribute("data-docs")) === 0) ok = false;
      t.style.display = ok ? "" : "none";
      if (ok) n++;
    }
    conteo.textContent = n + " de " + tarjetas.length + " licitaciones · el manifiesto trae " + manifiesto.licitaciones.length;
  }

  function reordenar() {
    var v = orden.value;
    var lista = orig.slice();
    if (v === "reciente") lista.sort(function (x, y) { return fechaDe(y).localeCompare(fechaDe(x)); });
    else if (v === "monto") lista.sort(function (x, y) { return montoDe(y) - montoDe(x); });
    for (var i = 0; i < lista.length; i++) grid.appendChild(lista[i]);
    tarjetas = lista;
    aplicar();
  }

  q.addEventListener("input", aplicar);
  categoria.addEventListener("change", aplicar);
  estado.addEventListener("change", aplicar);
  anio.addEventListener("change", aplicar);
  soloDocs.addEventListener("change", aplicar);
  orden.addEventListener("change", reordenar);

  document.getElementById("copiarCodigos").addEventListener("click", function () {
    var v = visibles(), codigos = [];
    for (var i = 0; i < v.length; i++) codigos.push(v[i].id);
    copiar(codigos.join("\\n"), this, "Copiar códigos visibles");
  });

  document.getElementById("bajarManifiesto").addEventListener("click", function () {
    var v = visibles(), sel = {};
    for (var i = 0; i < v.length; i++) sel[v[i].id] = true;
    var filtrado = {};
    for (var k in manifiesto) if (Object.prototype.hasOwnProperty.call(manifiesto, k)) filtrado[k] = manifiesto[k];
    var lics = [];
    for (var j = 0; j < manifiesto.licitaciones.length; j++) if (sel[manifiesto.licitaciones[j].codigo]) lics.push(manifiesto.licitaciones[j]);
    filtrado.licitaciones = lics;
    filtrado.nota_subconjunto = "Subconjunto filtrado en la página: " + lics.length + " de " + manifiesto.licitaciones.length + ".";
    var blob = new Blob([JSON.stringify(filtrado, null, 2)], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url; a.download = "transformacion-digital-documentos.json";
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  });

  var copiables = document.querySelectorAll("[data-copiar]");
  for (var k = 0; k < copiables.length; k++) {
    (function (b) {
      b.addEventListener("click", function () { copiar(b.getAttribute("data-copiar"), b, "copiar"); });
    })(copiables[k]);
  }

  function copiar(texto, boton, etiqueta) {
    var listo = function () { boton.textContent = "copiado"; setTimeout(function () { boton.textContent = etiqueta; }, 1400); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(texto).then(listo, function () {});
    else {
      var ta = document.createElement("textarea");
      ta.value = texto; document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); listo(); } catch (err) {}
      document.body.removeChild(ta);
    }
  }

  aplicar();
})();
</script>
</body>
</html>
`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Markdown gemelo
// ─────────────────────────────────────────────────────────────────────────────

function renderInforme(registros: RegistroTd[], r: ResumenCorridaTd): string {
  const lineas: string[] = [
    "# Licitaciones de Transformación Digital y Ley 21.180",
    "",
    `Generado ${r.generado_en} por \`npm run transformacion-digital\`. La página está en`,
    "`docs/transformacion-digital.html`, el manifiesto para Claude Cowork en",
    "`docs/transformacion-digital-documentos.json` y el índice acumulado en",
    "`historico/transformacion-digital.jsonl`.",
    "",
    `- **${registros.length}** licitaciones del nicho · ${registros.filter((x) => x.enriquecido_en).length} con la ficha indexada`,
    `- **${registros.filter((x) => x.categorias.includes("ley21180")).length}** citan la Ley 21.180 o la transformación digital del Estado`,
    `- **${new Set(registros.map((x) => x.organismo)).size}** organismos distintos`,
    `- **${registros.reduce((n, x) => n + (x.documentos?.length ?? 0), 0)}** documentos indexados`,
    `- Estados barridos: ${r.estados.join(", ")}`,
    `- ${r.combinaciones_truncadas.length} de ${r.combinaciones} combinaciones consulta×estado toparon en las 1.000 filas del portal`,
    `- Requests HTTP de esta corrida: ${r.requests} · cuota de API gastada: 0`,
    "",
    "El orden es de **descarga**, no cronológico: primero lo que tiene más material para leer.",
    "",
    "| # | Código | Organismo | Nombre | Estado | Docs | Req. |",
    "|---|---|---|---|---|---|---|",
  ];
  registros.forEach((x, i) => {
    const nombre = x.nombre.replace(/\|/g, "\\|").slice(0, 70);
    const org = x.organismo.replace(/\|/g, "\\|").slice(0, 40);
    lineas.push(
      `| ${i + 1} | ${x.codigo} | ${org} | ${nombre} | ${x.estado} | ${(x.documentos ?? []).length} | ${x.requerimientos.length} |`,
    );
  });
  lineas.push(
    "",
    "## Requerimientos funcionales más pedidos",
    "",
    "Detectados por patrón sobre el texto disponible, cada uno con su cita en la página. No son una",
    "lectura del pliego: el detalle fino vive en los adjuntos en PDF, que esta fase no bajó.",
    "",
    "| Requisito | Eje | Licitaciones |",
    "|---|---|---|",
  );
  const conteo = new Map<string, { eje: string; n: number }>();
  for (const x of registros)
    for (const q of x.requerimientos) {
      const actual = conteo.get(q.requisito) ?? { eje: q.eje, n: 0 };
      actual.n += 1;
      conteo.set(q.requisito, actual);
    }
  [...conteo]
    .sort((a, b) => b[1].n - a[1].n)
    .forEach(([requisito, { eje, n }]) => lineas.push(`| ${requisito} | ${eje} | ${n} |`));
  lineas.push("");
  return lineas.join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// Escritura
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Escribe los tres artefactos desde el mismo array ordenado y el mismo resumen. Devuelve las rutas
 * para que el script las imprima.
 */
export function escribirTransformacionDigital(
  registros: RegistroTd[],
  resumen: ResumenCorridaTd,
): { pagina: string; manifiesto: string; informe: string } {
  const manifiesto = construirManifiesto(registros, resumen);

  mkdirSync(path.dirname(PAGINA_PATH), { recursive: true });
  writeFileSync(PAGINA_PATH, renderPagina(registros, resumen, manifiesto), "utf-8");
  writeFileSync(MANIFIESTO_PATH, `${JSON.stringify(manifiesto, null, 2)}\n`, "utf-8");

  mkdirSync(path.dirname(INFORME_PATH), { recursive: true });
  writeFileSync(INFORME_PATH, renderInforme(registros, resumen), "utf-8");

  return { pagina: PAGINA_PATH, manifiesto: MANIFIESTO_PATH, informe: INFORME_PATH };
}

/**
 * Vuelve a juntar el índice con el payload del manifiesto.
 *
 * El jsonl guarda la observación (qué se vio, cuándo, con qué consulta y con qué cita) y el
 * manifiesto guarda el contenido pesado (documentos con sus URLs, requerimientos, exigencias),
 * porque una línea de jsonl tiene que caber en 4.000 bytes y un registro completo pesa más. No son
 * dos fuentes de verdad: los dos salen del mismo array en la misma corrida. Esta función es la que
 * permite que `--solo-indice` republique —y que `--fichas=N` continúe— sin volver a bajar ninguna
 * ficha ya indexada.
 *
 * Si el manifiesto no está o no parsea, se devuelven los registros sin payload: la licitación queda
 * publicada con lo que sí se sabe de ella y la próxima corrida con `--fichas` la vuelve a indexar.
 * Eso es preferible a abortar, y visible: la tarjeta dice que no tiene documentos indexados.
 */
export function rehidratar(registros: RegistroIndice[]): RegistroTd[] {
  let payload = new Map<string, EntradaManifiesto>();
  if (existsSync(MANIFIESTO_PATH)) {
    try {
      const m = JSON.parse(readFileSync(MANIFIESTO_PATH, "utf-8")) as { licitaciones?: EntradaManifiesto[] };
      payload = new Map((m.licitaciones ?? []).map((l) => [l.codigo, l]));
    } catch {
      // Manifiesto corrupto o de un formato anterior: se ignora en vez de abortar la corrida.
    }
  }
  return registros.map((r) => {
    const p = payload.get(r.codigo);
    const { conteos: _c, ...base } = r;
    if (!r.enriquecido_en || !p) {
      return { ...base, documentos: [], requerimientos: r.enriquecido_en ? [] : [], exigencias_administrativas: [] };
    }
    return {
      ...base,
      documentos: p.documentos.map((d) => ({
        clave: d.clave,
        titulo: d.titulo,
        url: d.url,
        acceso: d.acceso === "navegador" ? "navegador" : "directo",
        nota: d.nota,
      })),
      requerimientos: p.requerimientos_funcionales?.detectados ?? [],
      exigencias_administrativas: p.exigencias_administrativas ?? [],
    };
  });
}
