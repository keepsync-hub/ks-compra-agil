import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { LicitacionListItem, LicitacionDetalle } from "./api.js";
import type { CondicionesLicitacion } from "./condiciones.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** licitaciones/src/lib -> raíz del repo (docs/ vive en la raíz, no dentro de licitaciones/). */
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const PAGINA_PATH = path.join(REPO_ROOT, "docs", "licitaciones.html");

/**
 * Marcadores dentro de `docs/licitaciones.html`. Solo se reemplaza lo que hay entre ellos: el
 * resto de esa página es análisis escrito a mano (insumos bloqueantes, diferencias con Compra
 * Ágil, qué falta para operar) que una corrida del radar no debe pisar. Es la diferencia con
 * `docs/array-compras-agiles.html`, que sí se genera entera porque no tiene prosa curada.
 */
const MARCA_INICIO = "<!-- OPORTUNIDADES:INICIO (generado por `npm run radar-licitaciones` — no editar a mano) -->";
const MARCA_FIN = "<!-- OPORTUNIDADES:FIN -->";

export interface HallazgoLicitacion {
  item: LicitacionListItem;
  detalle: LicitacionDetalle;
  condiciones: CondicionesLicitacion;
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
function filasDatos(h: HallazgoLicitacion, ahora: Date): string {
  const filas: [string, string][] = [];

  filas.push([
    "Tope",
    h.condiciones.tope_clp > 0
      ? fmtClp(h.condiciones.tope_clp)
      : "<span class=\"sin-dato\">no publicado por el organismo</span>",
  ]);
  filas.push(["Cierre", glosaCierre(h.item.FechaCierre ?? h.detalle.Fechas?.FechaCierre, ahora)]);

  if (h.item.Tipo) filas.push(["Tipo", `${escapeHtml(h.item.Tipo)} — ${escapeHtml(glosaTipo(h.item.Tipo))}`]);
  if (h.condiciones.plazo_contrato_dias != null) {
    filas.push(["Plazo de contrato", `${h.condiciones.plazo_contrato_dias} día(s)`]);
  }
  if (h.condiciones.garantia_seriedad_clp != null) {
    filas.push(["Garantía de seriedad", fmtClp(h.condiciones.garantia_seriedad_clp)]);
  }
  if (h.condiciones.garantia_fiel_cumplimiento_clp != null) {
    filas.push(["Garantía fiel cumpl.", fmtClp(h.condiciones.garantia_fiel_cumplimiento_clp)]);
  }
  // Solo el día: la API entrega esta fecha con hora 00:00, que no informa nada.
  const adjudicacion = fmtFecha(h.detalle.Fechas?.FechaAdjudicacion)?.slice(0, 10);
  if (adjudicacion) filas.push(["Adjudicación", escapeHtml(adjudicacion)]);
  if (typeof h.detalle.CantidadReclamos === "number" && h.detalle.CantidadReclamos > 0) {
    filas.push(["Reclamos", String(h.detalle.CantidadReclamos)]);
  }
  const region = h.item.Comprador?.RegionUnidad;
  if (region) filas.push(["Región", escapeHtml(region)]);

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

function tarjeta(h: HallazgoLicitacion, ahora: Date): string {
  const codigo = h.item.CodigoExterno;
  const organismo = h.item.Comprador?.NombreOrganismo ?? "Organismo sin identificar";
  const nombre = h.item.Nombre ?? "";
  const unidad = h.item.Comprador?.NombreUnidad;

  return `      <div class="opp-card" id="${escapeHtml(codigo)}">
        <span class="codigo">${escapeHtml(codigo)}</span>
        <span class="org">${escapeHtml(organismo)}</span>
        <span class="nombre">${escapeHtml(nombre)}</span>${
          unidad ? `\n        <span class="unidad">${escapeHtml(unidad)}</span>` : ""
        }
        <dl>
${filasDatos(h, ahora)}
        </dl>
        <div class="cta">
          <span class="badge warn">Detectada — cotización pendiente</span>
          <a class="btn secondary" href="https://www.mercadopublico.cl/Procurement/Modules/RFB/DetailsAcquisition.aspx?idlicitacion=${encodeURIComponent(codigo)}">Ver en el portal</a>
        </div>
      </div>`;
}

const ESTADO_VACIO = `      <p class="note">
        Ninguna licitación abierta de este nicho en la última corrida del radar, o el radar
        todavía no se ha podido correr contra la API real. Este bloque se llena solo al ejecutar
        <code>npm run radar-licitaciones</code> con un <code>LICITACIONES_API_TICKET</code>
        válido — hasta entonces no hay oportunidades que mostrar, y esta página no inventa
        ninguna.
      </p>`;

/** Fragmento HTML de la grilla de tarjetas (o el estado vacío), sin los marcadores. */
export function renderTarjetasLicitaciones(hallazgos: HallazgoLicitacion[], ahora: Date = new Date()): string {
  const generado = ahora.toISOString().slice(0, 10);
  const cuerpo =
    hallazgos.length > 0
      ? `    <div class="card-grid">
${hallazgos.map((h) => tarjeta(h, ahora)).join("\n\n")}
    </div>`
      : ESTADO_VACIO;

  return `  <section>
    <h2>Oportunidades detectadas</h2>
    <p class="section-sub">
      Licitaciones públicas abiertas que mencionan gestión documental, digitalización de procesos
      u oficina de partes, según la última corrida de <code>npm run radar-licitaciones</code>.
      El estado de cada una es <strong>detectada</strong>: el radar solo observa — cotizar es un
      paso aparte (<code>npm run cotizar-licitaciones -- &lt;codigo&gt;</code>) y el envío de una
      oferta lo hace siempre una persona.
    </p>
    <p class="meta-corrida">${hallazgos.length} oportunidad(es) en la corrida del ${generado}.</p>
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
