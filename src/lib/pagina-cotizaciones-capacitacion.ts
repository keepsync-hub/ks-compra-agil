import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ROOT_DIR } from "./config.js";
import { reemplazarBloque } from "./pagina-compra-agil.js";
import { GLOSA_TIPO, bandaScore, type CriterioDireccionador, type ScoreCapacitacion } from "./scoring-capacitacion.js";
import { cierreYaPaso } from "./tiempo.js";

const MARCA_INICIO =
  "<!-- COTIZACIONES:INICIO (generado por `npm run cotizar-capacitacion` — no editar a mano) -->";
const MARCA_FIN = "<!-- COTIZACIONES:FIN -->";

/**
 * Índice versionado de las cotizaciones publicadas. Cumple el mismo papel que
 * `docs/array-cotizaciones/index.json`: el bloque de la página se re-renderiza entero en cada
 * corrida, así que sin este índice una corrida parcial (`npm run cotizar-capacitacion -- <codigo>`)
 * borraría de la página las cotizaciones que no volvió a generar.
 */
const INDICE_PATH = path.join(ROOT_DIR, "docs", "capacitaciones-cotizaciones", "index.json");

export interface CotizacionPublicada {
  codigo: string;
  curso: string;
  organismo: string;
  topeClp: number;
  totalClp: number;
  descuentoPct: number;
  regimenTributario: "exento" | "impuestos_incluidos" | "no_declarado";
  citaTributaria: string;
  criterioEvaluacion: "menor_precio" | "puntaje" | "no_declarado";
  fechaCierre: string;
  /** Ruta relativa a docs/, que es la raíz que publica GitHub Pages. */
  archivoPdfRelativo: string;
  fuenteDocumentos: string[];
  requisitosPorConfirmar: number;
  /**
   * Relator/a designado/a, si la config ya lo declara. Es lo primero que mira el organismo en
   * admisibilidad, así que la tarjeta lo muestra antes que el precio.
   */
  relator?: { nombre: string; titulo: string; documentosFaltantes: string[] };
  pendientes: string[];
  /** Score de apertura (0–100%) y su desglose. Ver src/lib/scoring-capacitacion.ts. */
  score: ScoreCapacitacion;
  /** Los criterios que produjeron el score, para poder auditarlo desde la página. */
  criterios: CriterioDireccionador[];
  generado: string;
}

export function leerIndiceCotizaciones(): Map<string, CotizacionPublicada> {
  if (!existsSync(INDICE_PATH)) return new Map();
  try {
    const raw = JSON.parse(readFileSync(INDICE_PATH, "utf-8")) as Record<string, CotizacionPublicada>;
    return new Map(Object.entries(raw));
  } catch {
    return new Map();
  }
}

export function guardarIndiceCotizaciones(nuevas: Map<string, CotizacionPublicada>): void {
  const combinado = leerIndiceCotizaciones();
  for (const [codigo, c] of nuevas) combinado.set(codigo, c);
  mkdirSync(path.dirname(INDICE_PATH), { recursive: true });
  writeFileSync(INDICE_PATH, JSON.stringify(Object.fromEntries(combinado), null, 2) + "\n", "utf-8");
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function clp(n: number): string {
  return "$" + Math.round(n).toLocaleString("es-CL");
}

const GLOSA_REGIMEN: Record<CotizacionPublicada["regimenTributario"], string> = {
  exento: "Exento de impuesto",
  impuestos_incluidos: "Impuestos incluidos",
  no_declarado: "Régimen sin declarar",
};

const GLOSA_CRITERIO: Record<CotizacionPublicada["criterioEvaluacion"], string> = {
  menor_precio: "Adjudica al menor precio",
  puntaje: "Adjudica por puntaje",
  no_declarado: "Sin pauta publicada",
};

function tarjeta(c: CotizacionPublicada): string {
  // Este índice se acumula y nunca borra: una corrida de un solo código no puede hacer desaparecer
  // de la página a las demás. El efecto secundario es que los borradores siguen publicados después
  // del cierre, y una tarjeta cerrada es indistinguible de una viva salvo por leer la fecha. Se
  // marca acá, en hora de Chile, y se manda al final de la grilla: publicar un borrador de una
  // compra en la que ya no se puede ofertar, sin decirlo, es el mismo defecto que la grilla de
  // oportunidades corrigió (ver CLAUDE.md, "Cuota agotada").
  const cerrada = cierreYaPaso(c.fechaCierre);
  // El chip del régimen es `bad` cuando el organismo no lo declaró: no es un detalle contable
  // menor, decide qué número se ingresa en el portal y hay que preguntarlo antes de ofertar.
  const claseRegimen = c.regimenTributario === "no_declarado" ? "bad" : "ok";
  // "Menor precio" en amarillo a propósito: es la condición que vuelve frágil un precio fijado
  // como porcentaje del tope, que es exactamente cómo se fijó este.
  const claseCriterio = c.criterioEvaluacion === "menor_precio" ? "warn" : "ok";

  const banda = bandaScore(c.score.score);
  const resumenTipos = c.score.porTipo
    .map((t) => `${t.n} de ${GLOSA_TIPO[t.tipo].toLowerCase()}`)
    .join(", ");

  return `      <article class="opp-card${cerrada ? " cerrada" : ""}">
        <div class="score-row">
          <div class="score ${banda}">
            <span class="score-n">${c.score.score}%</span>
            <span class="score-l">apertura</span>
          </div>
          <div class="score-txt">
            ${c.score.sinInformacion} criterio(s) por resolver × −5%${
              c.score.cubiertos > 0 ? ` · ${c.score.cubiertos} ya cubierto(s)` : ""
            }<br>
            <span class="hint">${esc(resumenTipos)}</span>
          </div>
        </div>
        <div class="codigo">${esc(c.codigo)}</div>
        <div class="org">${esc(c.organismo)}</div>
        <div class="nombre">${esc(c.curso)}</div>
        <dl>
          <dt>Presupuesto del organismo</dt><dd>${clp(c.topeClp)}</dd>
          <dt>Valor ofertado</dt><dd><strong>${clp(c.totalClp)}</strong> · ${c.descuentoPct}% bajo el tope</dd>
          <dt>Cierre de ofertas</dt><dd>${esc(c.fechaCierre)}${cerrada ? ' <span class="badge bad">Cerrada — ya no se puede ofertar</span>' : ""}</dd>
          <dt>Relator/a</dt><dd>${
            c.relator
              ? `<strong>${esc(c.relator.nombre)}</strong> · ${esc(c.relator.titulo)}${
                  c.relator.documentosFaltantes.length > 0
                    ? `<br><span class="hint">Faltan ${c.relator.documentosFaltantes.length} antecedente(s) por adjuntar</span>`
                    : `<br><span class="hint">Antecedentes completos</span>`
                }`
              : "<span class=\"hint\">Por designar — sin relator/a la oferta se descarta en admisibilidad</span>"
          }</dd>
          <dt>Requisitos por confirmar</dt><dd>${c.requisitosPorConfirmar}</dd>
        </dl>
        <div class="chips">
          <span class="badge ${claseRegimen}">${GLOSA_REGIMEN[c.regimenTributario]}</span>
          <span class="badge ${claseCriterio}">${GLOSA_CRITERIO[c.criterioEvaluacion]}</span>
        </div>
        <details class="detalle-lista">
          <summary>Qué baja el score: criterios que dirigen la compra (${c.criterios.length})</summary>
          <ul>${c.criterios
            .map(
              (k) =>
                `<li><span class="crit ${k.estado === "cubierto" ? "ok" : "pend"}">${
                  k.estado === "cubierto" ? "cubierto" : "−5%"
                }</span> <strong>${esc(GLOSA_TIPO[k.tipo])}</strong> — ${esc(k.exige)} <span class="hint">(${esc(k.cita)})</span>${
                  k.resuelto_por ? ` <span class="hint">${esc(k.resuelto_por)}</span>` : ""
                }</li>`,
            )
            .join("")}</ul>
        </details>
        <details class="detalle-lista alerta">
          <summary>Observaciones antes de presentar (${c.pendientes.length})</summary>
          <ul>${c.pendientes.map((p) => `<li>${esc(p)}</li>`).join("")}</ul>
        </details>
        <details class="detalle-lista">
          <summary>De dónde salen los requisitos (${c.fuenteDocumentos.length})</summary>
          <ul>${c.fuenteDocumentos.map((f) => `<li>${esc(f)}</li>`).join("")}</ul>
          <p>${esc(c.citaTributaria)}</p>
        </details>
        <div class="cta">
          <a class="btn" href="${esc(c.archivoPdfRelativo)}">Ver borrador (PDF, 5 págs.)</a>
          <a class="btn secondary" href="https://www.mercadopublico.cl">Ficha en Mercado Público</a>
        </div>
      </article>`;
}

/**
 * Bloque "Borradores de cotización" para `docs/index.html`. Publica el PDF de cada oportunidad
 * junto a lo que impide presentarla, que es lo que de verdad decide si conviene seguir: los
 * documentos ya están completos en todo lo que se puede derivar de las bases, y lo que falta es
 * un dato que solo puede aportar una persona.
 */
export function renderCotizacionesCapacitacion(cotizaciones: Map<string, CotizacionPublicada>): string {
  // Ordenado por score y no por fecha de cierre, que es como se ordena la grilla de oportunidades:
  // este bloque existe para decidir dónde poner el esfuerzo, y lo primero que hay que ver es la
  // compra más abierta. El cierre desempata.
  const lista = [...cotizaciones.values()].sort(
    (a, b) =>
      Number(cierreYaPaso(a.fechaCierre)) - Number(cierreYaPaso(b.fechaCierre)) ||
      b.score.score - a.score.score ||
      a.fechaCierre.localeCompare(b.fechaCierre),
  );

  if (lista.length === 0) {
    return `  <section id="cotizaciones">
    <h2>Borradores de cotización</h2>
    <p class="section-sub">Todavía no hay borradores generados. Se crean con <code>npm run cotizar-capacitacion</code>.</p>
  </section>`;
  }

  const totalPendientes = new Set(lista.flatMap((c) => c.pendientes)).size;
  const conRelator = lista.filter((c) => c.relator);
  const sinRelator = lista.length - conRelator.length;
  // Con relator/a designado/a el bloqueo cambia de naturaleza: deja de ser "no hay a quién
  // presentar" y pasa a ser "falta este papel". La página tiene que decir cuál de las dos cosas
  // es, porque son decisiones distintas para quien la lee.
  const relatoresFaltantes = conRelator.reduce((n, c) => n + (c.relator!.documentosFaltantes.length > 0 ? 1 : 0), 0);
  const glosaRelator =
    conRelator.length === 0
      ? `Ninguna de estas propuestas nombra relator/a: el agente no inventa credenciales.`
      : `${conRelator.length} de estas ${lista.length} propuestas ya nombra relator/a con sus antecedentes` +
        ` (${[...new Set(conRelator.map((c) => c.relator!.nombre))].map(esc).join(", ")})` +
        `${
          relatoresFaltantes > 0
            ? `, aunque en ${relatoresFaltantes} todavía falta adjuntar parte del respaldo documental que las bases exigen`
            : ""
        }.` +
        `${
          sinRelator > 0
            ? ` Las otras ${sinRelator} siguen sin nombrar a nadie: el agente no inventa credenciales.`
            : ""
        }`;
  const menorPrecio = lista.filter((c) => c.criterioEvaluacion === "menor_precio").length;
  const sinRegimen = lista.filter((c) => c.regimenTributario === "no_declarado").length;
  const generado = lista.map((c) => c.generado).sort().at(-1) ?? "";

  return `  <section id="cotizaciones">
    <h2>Borradores de cotización</h2>
    <p class="section-sub">
      Una propuesta de 5 páginas por cada Compra Ágil de capacitación abierta, con el programa
      completo, el cuadro de cumplimiento y la oferta económica. El precio de todas es un
      <strong>10% bajo el tope publicado</strong> por el organismo — una regla de exploración, no un
      cálculo desde costos reales de KeepSync, que hoy no existen. Por eso cada PDF sale marcado
      <strong>PRELIMINAR</strong>, y <strong>BORRADOR</strong> mientras la identidad del oferente no
      esté confirmada.
    </p>
    <p class="meta-corrida">${lista.length} borrador(es) · generados el ${esc(generado)} · ordenados por score de apertura</p>
    <div class="note" style="border-left-color: var(--accent); margin-bottom:1rem;">
      <strong>Score de apertura (0–100%).</strong> Mide qué tan libre está la cancha:
      <strong>100%</strong> sería una compra que no exige ninguna característica, capacidad o
      certificación particular que dirija la adjudicación hacia un proveedor determinado. Se
      descuenta <strong>5% por cada criterio que haya que revisar y del que hoy no se tenga
      información</strong>. Un score alto no dice que se vaya a ganar: dice que lo que falta para
      poder presentarse son pocas cosas y son averiguables. Uno bajo marca una compra escrita
      alrededor de un proveedor que ya existe. Cada criterio va citado en la tarjeta, y el score
      sube solo a medida que se confirman en <code>config/capacitaciones.json</code>.
    </div>
    <div class="note" style="margin-bottom:1.25rem;">
      <strong>Ninguno está listo para presentar, y el bloqueo no es el precio.</strong>
      Los ${lista.length} organismos exigen un/a relator/a con título, currículum y certificados
      verificables, y una oferta sin esos antecedentes se descarta en admisibilidad antes de que
      nadie mire el monto. ${glosaRelator} Sigue además sin confirmarse si KeepSync es <strong>OTEC registrada en
      SENCE</strong>, de lo que dependen tanto puntaje directo en algunas bases como la exención de
      IVA del artículo 13 N°4 con que varios presupuestaron el servicio.
      ${
        menorPrecio > 0
          ? `Y en ${menorPrecio} de estas compras el organismo <strong>adjudica al menor precio</strong>, así que
      fijar el valor como un porcentaje del tope es por construcción una posición débil frente a
      quien cotice más abajo.`
          : ""
      }
      ${
        sinRegimen > 0
          ? `En ${sinRegimen} el organismo <strong>no declara</strong> si el presupuesto es neto, con impuestos o
      exento — hay que preguntarlo antes de ingresar el valor en el portal.`
          : ""
      }
      En total, ${totalPendientes} observación(es) distintas repartidas en las tarjetas.
    </div>
    <div class="card-grid">
${lista.map(tarjeta).join("\n")}
    </div>
  </section>`;
}

/** Reemplaza el bloque de cotizaciones. Devuelve false si la página no tiene los marcadores. */
export function actualizarBloqueCotizacionesCapacitacion(fragmento: string): boolean {
  return reemplazarBloque(MARCA_INICIO, MARCA_FIN, fragmento);
}
