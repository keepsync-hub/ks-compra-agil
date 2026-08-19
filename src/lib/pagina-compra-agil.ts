/**
 * Genera lo que se publica en `docs/index.html`: la grilla de Compras Ágiles abiertas y el bloque
 * de palabras clave con su formulario.
 *
 * Esa página era, hasta el 2026-08-19, un informe del estado del proyecto escrito a mano —con las
 * oportunidades pegadas a mano también, y por lo tanto siempre desactualizadas. A pedido del
 * usuario quedó enfocada en una sola pregunta: **¿conviene participar en esta Compra Ágil?**. Todo
 * lo que no aporta a esa decisión (estado de cada componente, pendientes del agente, comparaciones
 * entre nichos) se eliminó: eso se lee en el repositorio.
 *
 * Mismo criterio que `licitaciones/src/lib/pagina.ts`, en el otro instrumento de compra. Las dos
 * páginas no comparten código a propósito: son dominios separados, con APIs y datos distintos, y
 * ya se pagó una vez el costo de confundirlos.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ROOT_DIR } from "./config.js";
import type { CompraAgilDetalle } from "./api.js";
import type { Condiciones } from "./condiciones.js";
import { leer, type Observacion } from "./indice.js";

const PAGINA_PATH = path.join(ROOT_DIR, "docs", "index.html");

const MARCA_INICIO = "<!-- OPORTUNIDADES:INICIO (generado por `npm run radar` — no editar a mano) -->";
const MARCA_FIN = "<!-- OPORTUNIDADES:FIN -->";
const MARCA_KEYWORDS_INICIO = "<!-- KEYWORDS:INICIO (generado por `npm run radar` — no editar a mano) -->";
const MARCA_KEYWORDS_FIN = "<!-- KEYWORDS:FIN -->";

/**
 * Enlace "editar en GitHub" del overlay de palabras clave. La rama va explícita y **no es `main`**:
 * este repositorio no tiene `main` — su rama por defecto es la que sirve GitHub Pages.
 */
const REPO_RAMA_POR_DEFECTO = "claude/mercadopublico-agente-compras-pgyedf";
const REPO_CATEGORIAS_EXTRA_URL =
  `https://github.com/keepsync-hub/ks-compra-agil/edit/${REPO_RAMA_POR_DEFECTO}/config/categorias-extra.json`;

export interface HallazgoCompraAgil {
  categoriaId: string;
  categoriaNombre: string;
  detalle: CompraAgilDetalle;
  condiciones: Condiciones;
  /** Nombres de los adjuntos que el radar alcanzó a descargar (`data/<codigo>/attachments/`). */
  adjuntosDescargados: string[];
  esNuevo: boolean;
  /**
   * `"api"` = ficha completa. `"listado"` = ficha reducida, porque la cuota diaria se agotó antes
   * de poder pedirla: trae tope, cierre, comprador, competencia y tipo de llamado, pero no la
   * descripción, los productos ni el plazo de entrega. La tarjeta lo dice en vez de disimularlo.
   */
  fuente: "api" | "listado";
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function fmtClp(n: number): string {
  return `$${n.toLocaleString("es-CL")} CLP`;
}

/** "2026-08-21 15:30" -> "2026-08-21 15:30"; tolera formato inesperado devolviéndolo tal cual. */
function fmtFecha(f: string | undefined | null): string | null {
  if (!f) return null;
  const m = f.trim().match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/);
  return m ? `${m[1]} ${m[2]}` : f.trim() || null;
}

function diasHastaCierre(fechaCierre: string | undefined, ahora: Date): number | null {
  if (!fechaCierre) return null;
  const m = fechaCierre.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const cierre = Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!);
  const hoy = Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth(), ahora.getUTCDate());
  return Math.round((cierre - hoy) / 86_400_000);
}

function glosaCierre(fechaCierre: string | undefined, ahora: Date): string {
  const fecha = fmtFecha(fechaCierre);
  if (!fecha) return "sin informar";
  const dias = diasHastaCierre(fechaCierre, ahora);
  if (dias == null) return escapeHtml(fecha);
  if (dias < 0) return `${escapeHtml(fecha)} — <strong>ya cerró</strong>`;
  if (dias === 0) return `${escapeHtml(fecha)} — <strong>cierra hoy</strong>`;
  if (dias === 1) return `${escapeHtml(fecha)} — <strong>cierra mañana</strong>`;
  return `${escapeHtml(fecha)} — cierra en ${dias} días`;
}

/** Cuánto queda para ofertar, como etiqueta escaneable: es lo que ordena la grilla. */
function badgeCierre(fechaCierre: string | undefined, ahora: Date): string {
  const dias = diasHastaCierre(fechaCierre, ahora);
  if (dias == null) return `<span class="badge warn">Sin fecha de cierre informada</span>`;
  if (dias < 0) return `<span class="badge bad">Ya cerró</span>`;
  if (dias === 0) return `<span class="badge bad">Cierra hoy</span>`;
  if (dias === 1) return `<span class="badge bad">Cierra mañana</span>`;
  const clase = dias <= 3 ? "warn" : "ok";
  return `<span class="badge ${clase}">Quedan ${dias} días para ofertar</span>`;
}

/**
 * Lo que este mismo organismo hizo antes, según el índice histórico versionado
 * (`historico/observaciones.jsonl`). Se empata por **RUT exacto**, no por nombre: los nombres
 * llegan truncados y en varias grafías, y atribuirle a un comprador el historial de otro sería
 * peor que no decir nada.
 *
 * Es el dato que más pesa en "¿participo?": un organismo que ya declaró desierta esta misma compra
 * probablemente vuelva a hacerlo, y uno que recibió 6 ofertas la vez pasada dice cómo está la
 * competencia. El índice se llena solo con cada corrida del radar y con `npm run indexar`.
 */
export interface HistorialOrganismo {
  previas: Observacion[];
  desiertas: number;
  canceladas: number;
  adjudicadas: number;
  /** Promedio de ofertas recibidas en sus compras previas, si alguna informó. */
  ofertasPromedio: number | null;
}

export function historialDelOrganismo(rut: string, codigoActual: string): HistorialOrganismo | null {
  if (!rut) return null;
  const previas = leer()
    .filter((o) => o.rut === rut && o.codigo !== codigoActual)
    .sort((a, b) => b.observado_en.localeCompare(a.observado_en));
  // Una observación por código: el índice es append-only y guarda una fila por cambio observado.
  const porCodigo = new Map<string, Observacion>();
  for (const o of previas) if (!porCodigo.has(o.codigo)) porCodigo.set(o.codigo, o);
  const unicas = [...porCodigo.values()];
  if (unicas.length === 0) return null;

  const conOfertas = unicas.filter((o) => typeof o.total_ofertas_recibidas === "number");
  return {
    previas: unicas,
    desiertas: unicas.filter((o) => o.estado === "desierta").length,
    canceladas: unicas.filter((o) => o.estado === "cancelada").length,
    adjudicadas: unicas.filter((o) => o.estado === "proveedor_seleccionado" || o.estado === "cerrada").length,
    ofertasPromedio:
      conOfertas.length > 0
        ? Math.round((conOfertas.reduce((s, o) => s + o.total_ofertas_recibidas, 0) / conOfertas.length) * 10) / 10
        : null,
  };
}

/** Chips de decisión: lo que se mira antes de leer el detalle. */
function chips(h: HallazgoCompraAgil, historial: HistorialOrganismo | null): string {
  const primerLlamado = h.detalle.convocatoria.estado_convocatoria === 1;
  const valores = [
    primerLlamado ? "primer llamado · solo EMT" : "segundo llamado · abierto",
    `${h.condiciones.competencia_ofertas} oferta(s) ya recibida(s)`,
    h.condiciones.plazo_entrega_dias != null ? `entrega ${h.condiciones.plazo_entrega_dias} día(s)` : null,
    h.condiciones.excluyentes.length > 0 ? `${h.condiciones.excluyentes.length} cláusula(s) excluyente(s)` : null,
    h.detalle.documentos.length > 0 ? `${h.detalle.documentos.length} adjunto(s)` : "sin adjuntos",
    historial && historial.desiertas > 0 ? `${historial.desiertas} desierta(s) antes` : null,
  ].filter((c): c is string => Boolean(c));
  return `<div class="chips">${valores.map((c) => `<span>${escapeHtml(c)}</span>`).join("")}</div>`;
}

/**
 * Una fila `<dt>/<dd>` por dato realmente informado. Se omite la fila en vez de imprimir "—":
 * la tarjeta no debe sugerir que el organismo declaró algo que no declaró.
 */
function filasDatos(h: HallazgoCompraAgil, historial: HistorialOrganismo | null, ahora: Date): string {
  const filas: [string, string][] = [];
  const d = h.detalle;

  filas.push([
    "Tope",
    h.condiciones.tope_clp > 0
      ? fmtClp(h.condiciones.tope_clp)
      : '<span class="sin-dato">no publicado por el organismo</span>',
  ]);
  filas.push(["Cierre", glosaCierre(d.fechas.fecha_cierre, ahora)]);

  // Causal de inadmisibilidad si se ignora: en primer llamado solo pueden ofertar Empresas de
  // Menor Tamaño. KeepSync lo es (dato confirmado, ver CLAUDE.md), así que acá es una vía libre.
  filas.push([
    "Quién puede ofertar",
    d.convocatoria.estado_convocatoria === 1
      ? "Primer llamado — <strong>reservado a Empresas de Menor Tamaño</strong> (KeepSync es EMT)"
      : "Segundo llamado — abierto a cualquier proveedor",
  ]);
  filas.push([
    "Competencia",
    `${h.condiciones.competencia_ofertas} oferta(s) recibida(s)` +
      (h.condiciones.competencia_ofertas === 0 ? ' <span class="sin-dato">(nadie ha ofertado aún)</span>' : ""),
  ]);

  // "no identificado" es el valor que usa condiciones.ts cuando el texto no dice el plan: se omite
  // la fila en vez de publicar un dato que no se sabe.
  if (h.condiciones.plan_detectado && h.condiciones.plan_detectado !== "no identificado") {
    filas.push([
      "Plan detectado",
      escapeHtml(h.condiciones.plan_detectado) +
        (h.condiciones.cantidad_usuarios ? ` · ${h.condiciones.cantidad_usuarios} usuario(s)` : ""),
    ]);
  }
  if (h.condiciones.meses_vigencia) filas.push(["Vigencia pedida", `${h.condiciones.meses_vigencia} mes(es)`]);
  if (h.condiciones.plazo_entrega_dias != null) {
    filas.push(["Plazo de entrega", `${h.condiciones.plazo_entrega_dias} día(s) desde la orden de compra`]);
  }
  if (d.entrega?.direccion_entrega) filas.push(["Dirección de entrega", escapeHtml(d.entrega.direccion_entrega)]);

  // Historial del mismo comprador (por RUT). Lo que más pesa para decidir si vale la pena.
  if (historial) {
    const partes = [
      `${historial.previas.length} compra(s) ágil(es) previa(s)`,
      historial.desiertas > 0 ? `<strong>${historial.desiertas} declarada(s) desierta(s)</strong>` : null,
      historial.canceladas > 0 ? `${historial.canceladas} cancelada(s)` : null,
      historial.adjudicadas > 0 ? `${historial.adjudicadas} con proveedor seleccionado` : null,
      historial.ofertasPromedio != null ? `${historial.ofertasPromedio} oferta(s) en promedio` : null,
    ].filter(Boolean);
    filas.push(["Este comprador, antes", partes.join(" · ")]);
  }

  if (typeof d.resumen?.multa_sancion === "number" && d.resumen.multa_sancion > 0) {
    filas.push(["Multas/sanciones del organismo", String(d.resumen.multa_sancion)]);
  }
  if (d.institucion.nombre_region) filas.push(["Región", escapeHtml(d.institucion.nombre_region)]);
  filas.push(["Categoría del radar", escapeHtml(h.categoriaNombre)]);
  if (h.fuente === "listado") {
    filas.push([
      "Detalle",
      '<span class="sin-dato">ficha resumida: la cuota diaria de la API se agotó antes de poder leer ' +
        "la ficha completa. Falta la descripción, los productos pedidos y el plazo de entrega — " +
        'están en la ficha del portal.</span>',
    ]);
  }

  return filas.map(([k, v]) => `          <dt>${k}</dt><dd>${v}</dd>`).join("\n");
}

/** Qué está pidiendo exactamente el organismo, con cantidades: es lo que hay que poder entregar. */
function bloqueProductos(h: HallazgoCompraAgil): string {
  const productos = h.detalle.productos_solicitados ?? [];
  if (productos.length === 0) return "";
  const items = productos
    .map((p) => {
      const cantidad = typeof p.cantidad === "number" ? `${p.cantidad.toLocaleString("es-CL")} × ` : "";
      const detalle = [p.nombre, p.descripcion].filter(Boolean).join(" — ");
      return `            <li>${escapeHtml(cantidad)}${escapeHtml(detalle)}</li>`;
    })
    .join("\n");
  return `
        <details class="detalle-lista">
          <summary>${productos.length} producto(s) solicitado(s)</summary>
          <ul>
${items}
          </ul>
        </details>`;
}

/**
 * Lo que deja una oferta fuera y lo que hay que acompañar. Sale de `condiciones.ts`, que lo extrae
 * del texto que publicó el organismo — se cita tal cual, sin interpretar.
 */
function bloqueRequisitos(h: HallazgoCompraAgil): string {
  const { documentos_exigidos: documentos, excluyentes } = h.condiciones;
  if (documentos.length === 0 && excluyentes.length === 0) return "";
  const secciones = [
    documentos.length > 0
      ? `<p><strong>Documentos exigidos:</strong> ${documentos.map((d) => escapeHtml(d)).join(" · ")}</p>`
      : "",
    excluyentes.length > 0
      ? `<p><strong>Frases que dejan la oferta fuera</strong>, tal como las escribió el organismo:</p><ul>${excluyentes
          .map((e) => `<li>${escapeHtml(e)}</li>`)
          .join("")}</ul>`
      : "",
  ].join("");
  return `
        <details class="detalle-lista alerta">
          <summary>Requisitos y causales de inadmisibilidad</summary>
          ${secciones}
        </details>`;
}

/**
 * Los adjuntos del organismo. A diferencia de licitaciones, en Compra Ágil el portal los entrega
 * sin login ni CAPTCHA, así que el radar ya los bajó: acá se dice cuáles son y dónde quedaron.
 */
function bloqueAdjuntos(h: HallazgoCompraAgil): string {
  const documentos = h.detalle.documentos ?? [];
  if (documentos.length === 0) return "";
  const items = documentos
    .map((doc) => {
      const bajado = h.adjuntosDescargados.some((a) => a.includes(doc.nombre) || doc.nombre.includes(a));
      return `            <li>${escapeHtml(doc.nombre)}${bajado ? "" : ' <span class="hint">(no se pudo descargar en la última corrida)</span>'}</li>`;
    })
    .join("\n");
  return `
        <details class="detalle-lista">
          <summary>${documentos.length} documento(s) publicado(s) por el organismo</summary>
          <ul>
${items}
          </ul>
          <p class="hint">El portal los entrega sin login: el radar los deja en <code>data/${escapeHtml(
            h.detalle.codigo,
          )}/attachments/</code>. Son documentos del comprador, no se republican acá.</p>
        </details>`;
}

function tarjeta(h: HallazgoCompraAgil, ahora: Date): string {
  const d = h.detalle;
  const historial = historialDelOrganismo(d.institucion.rut, d.codigo);
  return `      <div class="opp-card" id="${escapeHtml(d.codigo)}">
        <span class="codigo">${escapeHtml(d.codigo)}</span>
        <span class="org">${escapeHtml(d.institucion.organismo_comprador)}</span>
        <span class="nombre">${escapeHtml(d.nombre)}</span>${
          d.institucion.unidad_compra ? `\n        <span class="unidad">${escapeHtml(d.institucion.unidad_compra)}</span>` : ""
        }${d.descripcion ? `\n        <p class="descripcion">${escapeHtml(d.descripcion)}</p>` : ""}
        ${chips(h, historial)}
        <dl>
${filasDatos(h, historial, ahora)}
        </dl>${bloqueProductos(h)}${bloqueRequisitos(h)}${bloqueAdjuntos(h)}
        <div class="cta">
          ${badgeCierre(d.fechas.fecha_cierre, ahora)}
          <a class="btn secondary" href="https://www.mercadopublico.cl/Portal/CompraAgil/DetalleCompra?codigo=${encodeURIComponent(
            d.codigo,
          )}">Ver en el portal y ofertar</a>
        </div>
      </div>`;
}

const ESTADO_VACIO = `      <p class="note">
        Ninguna Compra Ágil abierta de estas palabras clave en la última corrida del radar. Es lo
        normal: son ventanas de días y el nicho es chico. Esta página no inventa oportunidades — si
        no hay nada abierto, no muestra nada.
      </p>`;

/** Primero lo que cierra antes: el plazo es lo que decide si todavía se alcanza a ofertar. */
function porCierre(a: HallazgoCompraAgil, b: HallazgoCompraAgil): number {
  const f = (h: HallazgoCompraAgil) => h.detalle.fechas.fecha_cierre ?? "9999";
  return f(a).localeCompare(f(b)) || a.detalle.codigo.localeCompare(b.detalle.codigo);
}

/** Fragmento HTML de la grilla de tarjetas (o el estado vacío), sin los marcadores. */
export function renderTarjetasCompraAgil(hallazgos: HallazgoCompraAgil[], ahora: Date = new Date()): string {
  const generado = ahora.toISOString().slice(0, 10);
  const ordenados = [...hallazgos].sort(porCierre);
  const cuerpo =
    ordenados.length > 0
      ? `    <div class="card-grid">
${ordenados.map((h) => tarjeta(h, ahora)).join("\n\n")}
    </div>`
      : ESTADO_VACIO;

  return `  <section>
    <h2>Compras Ágiles abiertas</h2>
    <p class="section-sub">
      Compras Ágiles de <strong>mercadopublico.cl publicadas y recibiendo ofertas ahora</strong> que
      mencionan las palabras del radar. Cada tarjeta reúne lo que decide si conviene participar:
      cuánto hay, hasta cuándo, quién puede ofertar, cuánta competencia ya se presentó, qué piden
      exactamente, qué documentos exige y qué frases dejan una oferta fuera — más lo que este mismo
      comprador hizo en sus compras anteriores. Todo sale de la ficha oficial; nada está inferido.
    </p>
    <p class="meta-corrida">${ordenados.length} Compra(s) Ágil(es) abierta(s) · revisado el ${generado}</p>
${cuerpo}
  </section>`;
}

/** Reemplaza la grilla. Devuelve false (sin escribir) si la página no tiene los marcadores. */
export function actualizarPaginaCompraAgil(fragmento: string): boolean {
  return reemplazarBloque(MARCA_INICIO, MARCA_FIN, fragmento);
}

function reemplazarBloque(marcaInicio: string, marcaFin: string, fragmento: string): boolean {
  if (!existsSync(PAGINA_PATH)) return false;
  const html = readFileSync(PAGINA_PATH, "utf-8");
  const inicio = html.indexOf(marcaInicio);
  const fin = html.indexOf(marcaFin);
  if (inicio === -1 || fin === -1 || fin < inicio) return false;
  writeFileSync(
    PAGINA_PATH,
    html.slice(0, inicio + marcaInicio.length) + "\n" + fragmento + "\n  " + html.slice(fin),
    "utf-8",
  );
  return true;
}

/* ------------------------------------------------------------------------------------------- *
 * Bloque "Qué palabras busca el radar".
 *
 * Igual que en la página de licitaciones: quien mira las oportunidades es quien nota que falta un
 * término. Y el formulario no finge guardar — esta página es estática y no puede escribir en el
 * repositorio, así que deja lo agregado en el navegador, marcado como pendiente, y entrega las dos
 * vías reales de persistirlo (pegar el JSON en `config/categorias-extra.json`, o el comando).
 * ------------------------------------------------------------------------------------------- */

export interface CategoriaPublicadaCompraAgil {
  id: string;
  nombre: string;
  activa: boolean;
  variantes: string[];
  extra: string[];
  regex: string;
}

export function renderKeywordsCompraAgil(categorias: CategoriaPublicadaCompraAgil[]): string {
  const tarjetas = categorias
    .map(
      (c) => `      <div class="kw-card">
        <div class="kw-cat">${escapeHtml(c.nombre)} <span class="kw-id">${escapeHtml(c.id)}</span>${
          c.activa ? "" : ' <span class="kw-inactiva">inactiva</span>'
        }</div>
        <div class="kw-chips">${[
          ...c.variantes.filter((v) => !c.extra.includes(v)).map((v) => `<span class="kw">${escapeHtml(v)}</span>`),
          ...c.extra.map(
            (v) => `<span class="kw agregada" title="Agregada a mano en config/categorias-extra.json">${escapeHtml(v)}</span>`,
          ),
        ].join("")}</div>
        <details class="kw-patron">
          <summary>Cómo confirma que la compra es de este tipo</summary>
          <p>Se le piden esas palabras a la API y después se confirma sobre el texto de la compra con:</p>
          <code>${escapeHtml(c.regex)}</code>
        </details>
      </div>`,
    )
    .join("\n");

  const opciones = categorias
    .map((c) => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.nombre)}${c.activa ? "" : " (inactiva)"}</option>`)
    .join("");

  return `  <section id="palabras-clave">
    <h2>Qué palabras busca el radar</h2>
    <p class="section-sub">
      Con estas palabras se le pregunta a la API de Compra Ágil qué hay publicado; lo que vuelve se
      confirma sobre el nombre, la descripción y los productos de cada compra. Las categorías
      marcadas <em>inactiva</em> no se consultan todavía. Si ves un término que debería estar y no
      está, agrégalo acá abajo.
    </p>
    <div class="kw-grid">
${tarjetas}
    </div>

    <div class="kw-form">
      <h3>Agregar una palabra clave</h3>
      <p>
        Esta página es estática: no puede guardar por sí sola en el repositorio. Lo que agregues
        queda en <strong>este navegador</strong> y marcado como pendiente hasta que lo guardes en
        <code>config/categorias-extra.json</code>, que es de donde el radar las lee en su próxima
        corrida. Cada palabra agregada a una categoría activa suma una consulta por corrida.
      </p>
      <div class="kw-form-row">
        <select id="kw-categoria" aria-label="Categoría">${opciones}</select>
        <input id="kw-termino" type="text" placeholder="ej: Claude Sonnet" aria-label="Palabra o frase">
        <button class="btn" id="kw-agregar" type="button">Agregar</button>
      </div>
      <p class="kw-aviso" id="kw-aviso" hidden></p>
      <div id="kw-pendientes"></div>
    </div>
  </section>

  <script>
  /* Términos ya guardados en el repo, embebidos por el radar: el JSON que se copia tiene que
     incluirlos, porque reemplaza el contenido completo del archivo. */
  window.KW_GUARDADOS = ${JSON.stringify(categorias.flatMap((c) => c.extra.map((t) => ({ categoria: c.id, termino: t }))))};
  window.KW_EDIT_URL = ${JSON.stringify(REPO_CATEGORIAS_EXTRA_URL)};
  window.KW_COMANDO = "npm run keywords -- agregar";
  window.KW_ARCHIVO = "config/categorias-extra.json";
  </script>`;
}

/** Reemplaza el bloque de palabras clave. Devuelve false si la página no tiene los marcadores. */
export function actualizarBloqueKeywordsCompraAgil(fragmento: string): boolean {
  return reemplazarBloque(MARCA_KEYWORDS_INICIO, MARCA_KEYWORDS_FIN, fragmento);
}
