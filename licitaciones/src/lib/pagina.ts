import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { itemsDeLicitacion, type LicitacionListItem, type LicitacionDetalle } from "./api.js";
import { categoriasDeDetalle } from "./keywords.js";
import type { CondicionesLicitacion } from "./condiciones.js";
import type { ReferenciaDocumento } from "./portal-ficha.js";
import type { Bandera, FichaDecision } from "./decision.js";
import type { FichaBuscador } from "./buscador-portal.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** licitaciones/src/lib -> raíz del repo (docs/ vive en la raíz, no dentro de licitaciones/). */
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const PAGINA_PATH = path.join(REPO_ROOT, "docs", "licitaciones.html");

/**
 * Marcadores dentro de `docs/licitaciones.html`. Solo se reemplaza lo que hay entre ellos; lo que
 * queda fuera es la cabecera y el pie de la página.
 *
 * Esa página tuvo secciones escritas a mano sobre el estado del proyecto (insumos bloqueantes,
 * diferencias con Compra Ágil, qué falta para operar) y se eliminaron a pedido del usuario: la
 * página es para decidir sobre licitaciones, y el estado del agente se lee en el repo. Si se
 * vuelve a agregar prosa, va fuera de los marcadores — el radar sigue sin pisarla.
 */
const MARCA_INICIO = "<!-- OPORTUNIDADES:INICIO (generado por `npm run radar-licitaciones` — no editar a mano) -->";
const MARCA_FIN = "<!-- OPORTUNIDADES:FIN -->";

export interface HallazgoLicitacion {
  item: LicitacionListItem;
  detalle: LicitacionDetalle;
  condiciones: CondicionesLicitacion;
  /**
   * De dónde salieron los datos de la ficha: `"api"` (ticket, cuota) o `"portal"` (ficha pública,
   * gratis — ver `detalle-portal.ts`). La tarjeta es la misma; la diferencia es que la del portal
   * no trae los reclamos del organismo, y la página no debe sugerir que sí.
   */
  fuente?: "api" | "portal";
}

/**
 * Índice de documentos que dejó `npm run antecedentes-licitacion` para esta licitación, si corrió.
 * Se lee de disco en vez de pedirlo por parámetro para no acoplar el radar al portal: si no está,
 * la tarjeta simplemente muestra un enlace menos.
 */
function referenciasDeCache(codigo: string): ReferenciaDocumento[] {
  const ruta = path.join(REPO_ROOT, "licitaciones", "data", codigo, "documentos.json");
  if (!existsSync(ruta)) return [];
  try {
    const datos = JSON.parse(readFileSync(ruta, "utf-8")) as { documentos?: ReferenciaDocumento[] };
    return datos.documentos ?? [];
  } catch {
    return [];
  }
}

/**
 * Lo que dejó el radar del buscador público: rango de monto cuando el organismo no publica el
 * monto exacto, y el comportamiento de pago del comprador. Gratis, y no está en la API.
 */
function buscadorDeCache(codigo: string): FichaBuscador | null {
  const ruta = path.join(REPO_ROOT, "licitaciones", "data", codigo, "buscador.json");
  if (!existsSync(ruta)) return null;
  try {
    return JSON.parse(readFileSync(ruta, "utf-8")) as FichaBuscador;
  } catch {
    return null;
  }
}

function decisionDeCache(codigo: string): FichaDecision | null {
  const ruta = path.join(REPO_ROOT, "licitaciones", "data", codigo, "decision.json");
  if (!existsSync(ruta)) return null;
  try {
    return JSON.parse(readFileSync(ruta, "utf-8")) as FichaDecision;
  } catch {
    return null;
  }
}

/**
 * `decision.json` lo consume tanto la persona que opera el agente (en `decision.md`, con rutas y
 * comandos) como esta página, que es pública y solo debe hablar de la licitación. Esa bandera es
 * la única que describe el estado local del repo: acá se enuncia el hecho que sí importa para
 * evaluar — que las bases en PDF todavía no se leyeron y pueden agregar exigencias.
 */
function paraLaPagina(b: Bandera): Bandera {
  if (b.fuente !== "estado local") return b;
  return {
    ...b,
    titulo: "Las bases en PDF no están leídas",
    motivo:
      "Esta evaluación se armó con la ficha pública de la licitación. Las bases administrativas y " +
      "las especificaciones técnicas en PDF, que se abren desde el portal, pueden agregar " +
      "exigencias que no aparecen en la ficha.",
    fuente: "alcance de esta ficha",
  };
}

/**
 * Lo que decide si vale la pena presentarse, en la tarjeta: las banderas que exigen mirar, los
 * datos que casi siempre las causan (peso del precio, garantía, cantidad de anexos) y los
 * criterios de evaluación con su ponderación. Cada bandera viene con el motivo y la sección de
 * donde salió, así que acá se muestra el título y el motivo queda en el `title` del elemento — la
 * página no resume ni reinterpreta nada.
 */
function bloqueDecision(f: FichaDecision | null): string {
  if (!f) return "";
  const criticas = f.banderas.filter((b) => b.nivel !== "favorable");
  const chips = [
    f.comerciales.montoMensualEstimado !== undefined
      ? `$${Math.round(f.comerciales.montoMensualEstimado).toLocaleString("es-CL")}/mes`
      : null,
    f.pesoPrecio !== undefined ? `precio ${f.pesoPrecio}%` : null,
    f.garantia.exigida ? `garantía ${f.garantia.monto ?? "sí"}` : "sin garantía",
    f.anexos.total > 0 ? `${f.anexos.total} anexos` : null,
    f.fechas.ventanaPreguntasAbierta === true ? "preguntas abiertas" : "preguntas cerradas",
    f.adjuntos.faltan ? "bases en PDF sin leer" : `${f.adjuntos.leidos.length} adjunto(s) leídos`,
  ].filter((c): c is string => Boolean(c));

  const alertas = criticas
    .map(paraLaPagina)
    .map(
      (b) =>
        `            <li title="${escapeHtml(b.motivo)} (${escapeHtml(b.fuente)})">${escapeHtml(b.titulo)}</li>`,
    )
    .join("\n");

  // Con qué se evalúa la oferta: es lo que dice si se compite por precio o por antecedentes, y no
  // cabe en un chip. Sale de la sección 6 de las bases, ya parseada en decision.json.
  const criterios =
    f.criterios.length > 0
      ? `
          <details>
            <summary>Criterios de evaluación${
              f.sumaPonderaciones !== undefined && Math.round(f.sumaPonderaciones) !== 100
                ? ` (las ponderaciones suman ${f.sumaPonderaciones}%)`
                : ""
            }</summary>
            <ul>
${f.criterios
  .map(
    (c) =>
      `            <li${c.observaciones ? ` title="${escapeHtml(c.observaciones)}"` : ""}>${escapeHtml(
        c.nombre,
      )} — <strong>${c.ponderacion}%</strong></li>`,
  )
  .join("\n")}
            </ul>
          </details>`
      : "";

  return `
        <div class="decision">
          <div class="chips">${chips.map((c) => `<span>${escapeHtml(c)}</span>`).join("")}</div>${
            criticas.length > 0
              ? `
          <details>
            <summary>${criticas.length} punto(s) a revisar antes de cotizar</summary>
            <ul>
${alertas}
            </ul>
          </details>`
              : ""
          }${criterios}
        </div>`;
}

/**
 * Los documentos, como enlaces. Tener la URL es tener el documento: la página no los aloja ni los
 * duplica, los referencia — y dice cuáles abre un script y cuál necesita el clic de una persona
 * (el visor de adjuntos del portal, tras su reCAPTCHA).
 */
function enlacesDocumentos(codigo: string): string {
  const referencias = referenciasDeCache(codigo).filter((r) => r.clave !== "ficha");
  if (referencias.length === 0) return "";
  const items = referencias
    .map(
      (r) =>
        `            <li><a href="${escapeHtml(r.url)}"${r.acceso === "navegador" ? ' class="humano"' : ""}>${escapeHtml(
          r.titulo,
        )}</a>${r.acceso === "navegador" ? ' <span class="hint">abre en el portal</span>' : ""}</li>`,
    )
    .join("\n");
  return `
        <details class="docs">
          <summary>Documentos publicados por el organismo</summary>
          <ul>
${items}
          </ul>
        </details>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function fmtClp(n: number): string {
  return `$${n.toLocaleString("es-CL")} CLP`;
}

/** "2026-08-21T12:00:00" -> "2026-08-21 12:00". Tolera formato inesperado devolviéndolo tal cual. */
function fmtFecha(f: string | undefined): string | null {
  if (!f) return null;
  const m = f.trim().match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/);
  if (m) return `${m[1]} ${m[2]}`;
  const soloDia = f.trim().match(/^\d{4}-\d{2}-\d{2}$/);
  return soloDia ? f.trim() : f.trim() || null;
}

/** Días calendario hasta el cierre, para poder destacar "cierra mañana" como en la página de Compra Ágil. */
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

/**
 * Una fila `<dt>/<dd>` por dato realmente informado. Las licitaciones traen muchos campos
 * opcionales (garantías, plazo de contrato, adjudicación estimada) y la ficha de una licitación
 * chica puede no traer casi ninguno: se omite la fila en vez de imprimir "—", para que la
 * tarjeta no mienta sobre lo que el organismo declaró.
 */
function filasDatos(h: HallazgoLicitacion, f: FichaDecision | null, b: FichaBuscador | null, ahora: Date): string {
  const filas: [string, string][] = [];

  // Cuando el organismo no publica el monto exacto, el buscador igual muestra el tramo en UTM
  // ("Entre 100 y 1000 UTM"). Es menos que un tope, pero es la única cifra que hay: decirla es
  // mejor que decir "no publicado" a secas, y no se convierte a pesos porque el portal no lo hace.
  const rango = !b?.montoEsDisponible && b?.montoTexto && !/^[\d.]+$/.test(b.montoTexto) ? b.montoTexto : null;
  filas.push([
    "Tope",
    h.condiciones.tope_clp > 0
      ? fmtClp(h.condiciones.tope_clp)
      : rango
        ? `${escapeHtml(rango)} <span class="sin-dato">(tramo; el organismo no publicó el monto)</span>`
        : "<span class=\"sin-dato\">no publicado por el organismo</span>",
  ]);
  filas.push(["Cierre", glosaCierre(h.detalle.FechaCierre ?? h.detalle.Fechas?.FechaCierre, ahora)]);

  // Siempre desde la ficha, nunca desde el ítem del listado: ese ítem no trae Tipo, Comprador ni
  // monto (verificado contra producción el 2026-08-19, ver api.ts). Leerlo de `h.item` dejaba las
  // tarjetas sin tipo, sin región y con "Organismo sin identificar".
  const tipo = h.detalle.Tipo;
  if (tipo) filas.push(["Tipo", `${escapeHtml(tipo)} — ${escapeHtml(glosaTipo(tipo))}`]);
  if (h.condiciones.plazo_contrato_texto) {
    filas.push(["Plazo de contrato", escapeHtml(h.condiciones.plazo_contrato_texto)]);
  }
  if (h.condiciones.garantia_seriedad_clp != null) {
    filas.push(["Garantía de seriedad", fmtClp(h.condiciones.garantia_seriedad_clp)]);
  }
  if (h.condiciones.garantia_fiel_cumplimiento_clp != null) {
    filas.push(["Garantía fiel cumpl.", fmtClp(h.condiciones.garantia_fiel_cumplimiento_clp)]);
  }
  // La API no expone las garantías (verificado): las que se muestran salen de la sección 8 de las
  // bases, ya parseada en decision.json. Hay que poder emitirla, así que es dato de decisión.
  if (f?.garantia.exigida && h.condiciones.garantia_fiel_cumplimiento_clp == null) {
    const glosa = [f.garantia.tipo, f.garantia.monto ? `por ${f.garantia.monto}` : null]
      .filter(Boolean)
      .join(" ");
    filas.push([
      "Garantía exigida",
      escapeHtml(glosa || "sí") +
        (f.garantia.vencimiento ? ` <span class="sin-dato">(vence ${escapeHtml(f.garantia.vencimiento.slice(0, 10))})</span>` : ""),
    ]);
  }
  // Cuándo se cierran las preguntas: pasada esa fecha, una duda de las bases ya no se aclara.
  if (f?.fechas.finPreguntas) {
    filas.push([
      "Preguntas hasta",
      `${escapeHtml(f.fechas.finPreguntas.replace("T", " ").slice(0, 16))}` +
        (f.fechas.ventanaPreguntasAbierta === false ? ' <span class="sin-dato">(cerradas)</span>' : ""),
    ]);
  }
  // Solo el día: la API entrega esta fecha con hora 00:00, que no informa nada.
  const adjudicacion = fmtFecha(h.detalle.Fechas?.FechaAdjudicacion)?.slice(0, 10);
  if (adjudicacion) filas.push(["Adjudicación", escapeHtml(adjudicacion)]);
  // Cómo paga el comprador, en sus últimos 12 meses. Es el dato que decide si el contrato se
  // financia solo o hay que aguantar la mora: el portal publica ambas cifras y el porcentaje es
  // aritmética sobre ellas, no una interpretación.
  if (typeof b?.comprasEfectuadas === "number" && typeof b.reclamosPagoNoOportuno === "number") {
    const pct = b.comprasEfectuadas > 0 ? Math.round((b.reclamosPagoNoOportuno / b.comprasEfectuadas) * 100) : null;
    filas.push([
      "Pago del organismo",
      `${b.reclamosPagoNoOportuno.toLocaleString("es-CL")} reclamo(s) por pago no oportuno en ` +
        `${b.comprasEfectuadas.toLocaleString("es-CL")} compras (12 meses)` +
        (pct != null ? ` — <strong>${pct}%</strong>` : ""),
    ]);
  }
  // El diccionario oficial define este campo como reclamos recibidos por el ORGANISMO, no por
  // esta licitación: la etiqueta lo dice para que no se lea como "387 reclamos por esta compra".
  // Solo llega cuando la ficha vino de la API (`--con-api`).
  if (typeof h.detalle.CantidadReclamos === "number" && h.detalle.CantidadReclamos > 0) {
    filas.push(["Reclamos al organismo", String(h.detalle.CantidadReclamos)]);
  }
  const region = h.detalle.Comprador?.RegionUnidad;
  if (region) filas.push(["Región", escapeHtml(region)]);

  // Por qué esta licitación está en la lista: qué servicio del catálogo de Array (array.cl) la
  // pescó. Sin esta fila la tarjeta no dice si es un gestor documental, un RPA o un BI — que es lo
  // primero que hay que saber para decidir si vale la pena leer las bases.
  const servicios = categoriasDeDetalle(h.detalle, itemsDeLicitacion(h.detalle)).map((c) => c.nombre);
  if (servicios.length > 0) filas.push(["Servicio Array", escapeHtml(servicios.join(" · "))]);

  return filas.map(([k, v]) => `          <dt>${k}</dt><dd>${v}</dd>`).join("\n");
}

/** Tabla 3.1 del diccionario oficial (licitaciones/docs/), por monto en UTM. */
function glosaTipo(tipo: string): string {
  const tabla: Record<string, string> = {
    L1: "pública < 100 UTM",
    LE: "pública 100–1.000 UTM",
    LP: "pública 1.000–2.000 UTM",
    LQ: "pública 2.000–5.000 UTM",
    LR: "pública ≥ 5.000 UTM",
    LS: "pública, servicios personales especializados",
    E2: "privada < 100 UTM",
    CO: "privada 100–1.000 UTM",
    B2: "privada 1.000–2.000 UTM",
    H2: "privada 2.000–5.000 UTM",
    I2: "privada > 5.000 UTM",
  };
  return tabla[tipo.trim().toUpperCase()] ?? "tipo no reconocido";
}

/** Cuánto queda para ofertar, como etiqueta escaneable: es lo que ordena la grilla. */
function badgeCierre(fechaCierre: string | undefined, ahora: Date): string {
  const dias = diasHastaCierre(fechaCierre, ahora);
  if (dias == null) return `<span class="badge warn">Sin fecha de cierre informada</span>`;
  if (dias < 0) return `<span class="badge bad">Ya cerró</span>`;
  if (dias === 0) return `<span class="badge bad">Cierra hoy</span>`;
  if (dias === 1) return `<span class="badge bad">Cierra mañana</span>`;
  const clase = dias <= 5 ? "warn" : "ok";
  return `<span class="badge ${clase}">Quedan ${dias} días para ofertar</span>`;
}

function tarjeta(h: HallazgoLicitacion, ahora: Date): string {
  const codigo = h.detalle.CodigoExterno;
  const ficha = decisionDeCache(codigo);
  const buscador = buscadorDeCache(codigo);
  const organismo = h.detalle.Comprador?.NombreOrganismo ?? "Organismo sin identificar";
  // El `Nombre` llega truncado (~50 car.) tanto en el listado de la API como en la ficha del
  // portal; la `Descripcion` es el texto completo de lo que el organismo está pidiendo, y es lo
  // primero que hay que leer para saber si la licitación es del rubro o no.
  const nombre = h.detalle.Nombre ?? h.item.Nombre ?? "";
  const descripcion = h.detalle.Descripcion;
  const unidad = h.detalle.Comprador?.NombreUnidad;

  return `      <div class="opp-card" id="${escapeHtml(codigo)}">
        <span class="codigo">${escapeHtml(codigo)}</span>
        <span class="org">${escapeHtml(organismo)}</span>
        <span class="nombre">${escapeHtml(nombre)}</span>${
          unidad ? `\n        <span class="unidad">${escapeHtml(unidad)}</span>` : ""
        }${descripcion ? `\n        <p class="descripcion">${escapeHtml(descripcion)}</p>` : ""}
        <dl>
${filasDatos(h, ficha, buscador, ahora)}
        </dl>${bloqueDecision(ficha)}${enlacesDocumentos(codigo)}
        <div class="cta">
          ${badgeCierre(h.detalle.FechaCierre ?? h.detalle.Fechas?.FechaCierre, ahora)}
          <a class="btn secondary" href="https://www.mercadopublico.cl/Procurement/Modules/RFB/DetailsAcquisition.aspx?idlicitacion=${encodeURIComponent(codigo)}">Ver en el portal y ofertar</a>
        </div>
      </div>`;
}

const ESTADO_VACIO = `      <p class="note">
        Ninguna licitación abierta de estos servicios en la última revisión, o no se pudo consultar
        la API (falta <code>LICITACIONES_API_TICKET</code>, o se agotó la cuota del ticket). Esta
        página no inventa licitaciones: si no hay nada, no muestra nada.
      </p>`;

/** Primero lo que cierra antes: el plazo es lo que decide si todavía se alcanza a ofertar. */
function porCierre(a: HallazgoLicitacion, b: HallazgoLicitacion): number {
  const f = (h: HallazgoLicitacion) => h.detalle.FechaCierre ?? h.detalle.Fechas?.FechaCierre ?? "9999";
  return f(a).localeCompare(f(b)) || a.detalle.CodigoExterno.localeCompare(b.detalle.CodigoExterno);
}

/** Fragmento HTML de la grilla de tarjetas (o el estado vacío), sin los marcadores. */
export function renderTarjetasLicitaciones(hallazgos: HallazgoLicitacion[], ahora: Date = new Date()): string {
  const generado = ahora.toISOString().slice(0, 10);
  const ordenados = [...hallazgos].sort(porCierre);
  const cuerpo =
    ordenados.length > 0
      ? `    <div class="card-grid">
${ordenados.map((h) => tarjeta(h, ahora)).join("\n\n")}
    </div>`
      : ESTADO_VACIO;

  // De dónde salen los datos: la ficha de la API (ticket con cuota) o la ficha pública del portal
  // (gratis). Importa para leer la tarjeta: la del portal no trae los reclamos del organismo.
  const dePortal = ordenados.filter((h) => h.fuente === "portal").length;
  const origen =
    dePortal === 0
      ? "Datos de la ficha oficial de cada licitación (API de Mercado Público) y de las bases publicadas en el portal."
      : dePortal === ordenados.length
        ? "Datos leídos de la ficha pública y las bases de cada licitación en el portal de Mercado Público."
        : `Datos de la ficha oficial (API) y, en ${dePortal} de ${ordenados.length}, de la ficha pública del portal.`;

  return `  <section>
    <h2>Licitaciones abiertas</h2>
    <p class="section-sub">
      Licitaciones públicas de <strong>mercadopublico.cl abiertas ahora</strong> que piden alguno de
      los servicios de <a href="http://www.array.cl/">Array</a>: oficina de partes electrónica,
      seguimiento de trámites, gestión documental y firma electrónica, automatización de procesos
      (RPA), business intelligence y plataformas de gestión de proyectos. Cada tarjeta trae lo que
      decide si conviene presentarse — tope, plazos, garantías, criterios de evaluación, anexos
      exigidos y los documentos publicados por el organismo — con su fuente citada; nada está
      inferido.
    </p>
    <p class="meta-corrida">${ordenados.length} licitación(es) abierta(s) · revisado el ${generado} · ${origen}</p>
${cuerpo}
  </section>`;
}

/**
 * Reemplaza el bloque entre marcadores en `docs/licitaciones.html`. Devuelve false (sin escribir)
 * si la página no tiene los marcadores, para no corromper una página editada a mano.
 */
export function actualizarPaginaLicitaciones(fragmento: string): boolean {
  if (!existsSync(PAGINA_PATH)) return false;
  const html = readFileSync(PAGINA_PATH, "utf-8");
  const inicio = html.indexOf(MARCA_INICIO);
  const fin = html.indexOf(MARCA_FIN);
  if (inicio === -1 || fin === -1 || fin < inicio) return false;

  const nuevo = html.slice(0, inicio + MARCA_INICIO.length) + "\n" + fragmento + "\n  " + html.slice(fin);
  writeFileSync(PAGINA_PATH, nuevo, "utf-8");
  return true;
}

/* ------------------------------------------------------------------------------------------- *
 * Bloque "Qué palabras busca el radar": qué se busca, y cómo agregar más.
 *
 * Por qué está en la página y no solo en la config: quien mira las oportunidades es quien nota que
 * falta un término ("acá dicen 'ventanilla única' y no lo estamos pescando"). Mostrar las palabras
 * al lado de los resultados convierte esa observación en una acción de un minuto.
 *
 * Y por qué el formulario no guarda solo: esta página es estática (GitHub Pages), no tiene backend
 * ni puede escribir en el repositorio. Entonces no finge que guarda: deja el término en el propio
 * navegador, lo marca como PENDIENTE mientras el radar no lo use, y ofrece las dos vías reales de
 * persistirlo — pegar el JSON en `keywords-extra.json` desde GitHub, o el comando equivalente.
 * ------------------------------------------------------------------------------------------- */

const MARCA_KEYWORDS_INICIO = "<!-- KEYWORDS:INICIO (generado por `npm run radar-licitaciones` — no editar a mano) -->";
const MARCA_KEYWORDS_FIN = "<!-- KEYWORDS:FIN -->";

/**
 * Enlace "editar en GitHub" del overlay de palabras clave. La rama va explícita y **no es `main`**:
 * este repositorio no tiene `main` — su rama por defecto es `claude/mercadopublico-agente-compras-pgyedf`,
 * que es también la que sirve GitHub Pages. Con `main` el enlace daba 404.
 * Si alguna vez cambia la rama por defecto, hay que cambiarla acá.
 */
const REPO_RAMA_POR_DEFECTO = "claude/mercadopublico-agente-compras-pgyedf";
const REPO_KEYWORDS_EXTRA_URL =
  `https://github.com/keepsync-hub/ks-compra-agil/edit/${REPO_RAMA_POR_DEFECTO}/licitaciones/config/keywords-extra.json`;

function chipsConsultas(consultas: string[], extra: string[]): string {
  const propias = consultas.filter((c) => !extra.includes(c));
  return [
    ...propias.map((c) => `<span class="kw">${escapeHtml(c)}</span>`),
    ...extra.map((c) => `<span class="kw agregada" title="Agregada a mano en keywords-extra.json">${escapeHtml(c)}</span>`),
  ].join("");
}

export interface CategoriaPublicada {
  id: string;
  nombre: string;
  consultas: string[];
  extra: string[];
  patronMencion: string;
  patronExcluyente?: string;
}

/** Fragmento HTML del bloque de palabras clave, sin los marcadores. */
export function renderKeywords(categorias: CategoriaPublicada[]): string {
  const tarjetas = categorias
    .map(
      (c) => `      <div class="kw-card">
        <div class="kw-cat">${escapeHtml(c.nombre)} <span class="kw-id">${escapeHtml(c.id)}</span></div>
        <div class="kw-chips">${chipsConsultas(c.consultas, c.extra)}</div>
        <details class="kw-patron">
          <summary>Cómo confirma que la licitación es de este tipo</summary>
          <p>Se busca por las palabras de arriba y después se confirma sobre el texto completo con:</p>
          <code>${escapeHtml(c.patronMencion)}</code>${
            c.patronExcluyente
              ? `
          <p>Y se descarta si además aparece:</p>
          <code>${escapeHtml(c.patronExcluyente)}</code>`
              : ""
          }
        </details>
      </div>`,
    )
    .join("\n");

  const opciones = categorias
    .map((c) => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.nombre)}</option>`)
    .join("");

  return `  <section id="palabras-clave">
    <h2>Qué palabras busca el radar</h2>
    <p class="section-sub">
      Con estas palabras se le pregunta al buscador de mercadopublico.cl qué hay abierto; lo que
      vuelve se confirma sobre el nombre y la descripción completos de cada licitación. Si ves un
      término que debería estar y no está, agrégalo acá abajo.
    </p>
    <div class="kw-grid">
${tarjetas}
    </div>

    <div class="kw-form">
      <h3>Agregar una palabra clave</h3>
      <p>
        Esta página es estática: no puede guardar por sí sola en el repositorio. Lo que agregues
        queda en <strong>este navegador</strong> y marcado como pendiente hasta que lo guardes en
        <code>licitaciones/config/keywords-extra.json</code>, que es de donde el radar las lee en su
        próxima corrida.
      </p>
      <div class="kw-form-row">
        <select id="kw-categoria" aria-label="Categoría">${opciones}</select>
        <input id="kw-termino" type="text" placeholder="ej: ventanilla única digital" aria-label="Palabra o frase">
        <button class="btn" id="kw-agregar" type="button">Agregar</button>
      </div>
      <p class="kw-aviso" id="kw-aviso" hidden></p>
      <div id="kw-pendientes"></div>
    </div>
  </section>

  <script>
  /* Términos ya guardados en el repo, embebidos por el radar: el JSON que se copia tiene que
     incluirlos, porque reemplaza el contenido completo del archivo. */
  window.KW_GUARDADOS = ${JSON.stringify(
    categorias.flatMap((c) => c.extra.map((t) => ({ categoria: c.id, termino: t }))),
  )};
  window.KW_EDIT_URL = ${JSON.stringify(REPO_KEYWORDS_EXTRA_URL)};
  window.KW_ARCHIVO = "licitaciones/config/keywords-extra.json";
  </script>`;
}

/** Reemplaza el bloque de palabras clave. Devuelve false si la página no tiene los marcadores. */
export function actualizarBloqueKeywords(fragmento: string): boolean {
  if (!existsSync(PAGINA_PATH)) return false;
  const html = readFileSync(PAGINA_PATH, "utf-8");
  const inicio = html.indexOf(MARCA_KEYWORDS_INICIO);
  const fin = html.indexOf(MARCA_KEYWORDS_FIN);
  if (inicio === -1 || fin === -1 || fin < inicio) return false;
  const nuevo = html.slice(0, inicio + MARCA_KEYWORDS_INICIO.length) + "\n" + fragmento + "\n  " + html.slice(fin);
  writeFileSync(PAGINA_PATH, nuevo, "utf-8");
  return true;
}
