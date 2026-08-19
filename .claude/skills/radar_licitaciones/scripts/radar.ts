/**
 * Radar de Licitaciones — servicios de Array (array.cl).
 *
 * **Por defecto no gasta cuota de la API.** Se reordenó el 2026-08-19, después de medir que la
 * cuota del ticket es tan escasa que se agotaba antes de la primera ficha: hoy todo el camino
 * normal sale de fuentes públicas del portal, sin ticket ni cuota.
 *
 *   descubrimiento → buscador público del portal (`buscador-portal.ts`): filtra por texto en el
 *                    servidor —la API no puede— y entrega nombre y descripción COMPLETOS
 *   ficha          → ficha pública de cada licitación (`portal-ficha.ts` + `detalle-portal.ts`):
 *                    organismo, tope, tipo, plazos, garantías, criterios, anexos, documentos
 *   API con ticket → opcional (`--con-api`), solo para lo que ninguna vía gratis entrega
 *
 * Lo único que hoy justifica gastar cuota es `CantidadReclamos` (reclamos recibidos por el
 * organismo comprador, campo 35 del diccionario), que no aparece en ninguna fuente pública. Si eso
 * no importa para la decisión, `--con-api` no hace falta.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { LIC_ROOT_DIR } from "../../../../licitaciones/src/lib/config.js";
import {
  obtenerDetalleLicitacion,
  CuotaAgotadaError,
  itemsDeLicitacion,
  type LicitacionDetalle,
} from "../../../../licitaciones/src/lib/api.js";
import {
  buscarEnPortal,
  fichaEnBuscador,
  type ResultadoBusquedaPortal,
} from "../../../../licitaciones/src/lib/buscador-portal.js";
import { categoriasDeTexto, categoriasDeDetalle, categoriasKeyword } from "../../../../licitaciones/src/lib/keywords.js";
import { extraerCondicionesLicitacion } from "../../../../licitaciones/src/lib/condiciones.js";
import { cargarState, guardarState, registrarHallazgo } from "../../../../licitaciones/src/lib/historial.js";
// La lectura/escritura de la caché vive en una lib porque `antecedentes-licitacion` también
// republica la página desde ella (ver licitaciones/src/lib/cache.ts).
import { fichaDesdePortal, guardarFicha, hallazgosDesdeCache } from "../../../../licitaciones/src/lib/cache.js";
import { procesarAntecedentes } from "../../../../licitaciones/src/lib/antecedentes-pipeline.js";
import {
  renderTarjetasLicitaciones,
  actualizarPaginaLicitaciones,
  type HallazgoLicitacion,
} from "../../../../licitaciones/src/lib/pagina.js";

/**
 * Tope de licitaciones a procesar en detalle por corrida. Ya no protege la cuota de la API (el
 * camino normal no la usa): protege al portal de una ráfaga y a la corrida de durar de más. Cada
 * licitación son ~3 requests públicos (ficha, foro, Excel de preguntas).
 */
const MAX_DETALLES_POR_CORRIDA_DEFAULT = 60;

function capDeCorrida(): number {
  const arg = process.argv.find((a) => a.startsWith("--max="));
  const n = arg ? Number.parseInt(arg.slice("--max=".length), 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : MAX_DETALLES_POR_CORRIDA_DEFAULT;
}

const DATA_DIR = path.join(LIC_ROOT_DIR, "data");

function filaReporte(h: HallazgoLicitacion, marcas: string[]): string {
  const { detalle, condiciones } = h;
  const servicios = categoriasDeDetalle(detalle, itemsDeLicitacion(detalle)).map((c) => c.nombre);
  return [
    `### ${detalle.CodigoExterno} — ${detalle.Comprador?.NombreOrganismo ?? "organismo desconocido"}`,
    `- ${detalle.Nombre}`,
    servicios.length > 0 ? `- Servicio Array: ${servicios.join(", ")}` : null,
    `- Cierre: ${detalle.FechaCierre ?? detalle.Fechas?.FechaCierre ?? "sin dato"}`,
    `- Tipo: ${condiciones.tipo_licitacion ?? "sin dato"}`,
    condiciones.tope_clp > 0
      ? `- Tope: $${condiciones.tope_clp.toLocaleString("es-CL")} CLP (moneda: ${condiciones.moneda_original})`
      : `- Tope: no publicado por el organismo`,
    condiciones.plazo_contrato_texto != null ? `- Plazo de contrato: ${condiciones.plazo_contrato_texto}` : null,
    condiciones.documentos_exigidos.length > 0 ? `- Documentos exigidos: ${condiciones.documentos_exigidos.join(", ")}` : null,
    condiciones.excluyentes.length > 0 ? `- Excluyentes detectados: ${condiciones.excluyentes.join(" | ")}` : null,
    `- Fuente de la ficha: ${h.fuente === "api" ? "API con ticket" : "ficha pública del portal (sin cuota)"}`,
    ...marcas.map((m) => `- ${m}`),
  ]
    .filter(Boolean)
    .join("\n");
}

const NOTA_ALCANCE = [
  `> Radar de solo lectura: detectar no es cotizar, y ninguna oferta se envía sin que una persona ` +
    `la revise.`,
  `>`,
  `> El nicho buscado es el catálogo de servicios de **Array** (array.cl): oficina de partes ` +
    `electrónica, seguimiento de trámites, gestión documental y firma electrónica, RPA, business ` +
    `intelligence y plataformas de gestión de proyectos. Los patrones viven en ` +
    `\`licitaciones/config/keywords.json\`.`,
  `>`,
  `> **Esta corrida no gasta cuota de la API salvo que se pida \`--con-api\`.** El descubrimiento usa ` +
    `el buscador público del portal (que sí filtra por texto y entrega la descripción completa) y ` +
    `cada ficha sale de la ficha pública de la licitación, con sus bases, garantías, criterios de ` +
    `evaluación, anexos exigidos y documentos.`,
];

function escribirSalidas(reporte: string, hallazgos: HallazgoLicitacion[], actualizarPagina: boolean): void {
  mkdirSync(path.join(LIC_ROOT_DIR, "output"), { recursive: true });
  writeFileSync(path.join(LIC_ROOT_DIR, "output", "radar-ultima-corrida.md"), reporte, "utf-8");

  if (!actualizarPagina) {
    console.warn(
      `\n⚠ docs/licitaciones.html se dejó intacta: la corrida quedó incompleta y publicar una grilla ` +
        `parcial borraría oportunidades abiertas que sí se habían detectado antes.`,
    );
    return;
  }
  const ok = actualizarPaginaLicitaciones(renderTarjetasLicitaciones(hallazgos));
  console.log(
    ok
      ? `\nPágina actualizada: docs/licitaciones.html (${hallazgos.length} oportunidad(es) en la grilla).`
      : `\n⚠ No se pudo actualizar docs/licitaciones.html: faltan los marcadores OPORTUNIDADES:INICIO/FIN. ` +
          `Se dejó la página intacta a propósito.`,
  );
}

/** Re-render sin pedir nada a ninguna fuente: solo vuelve a publicar lo ya detectado. */
function correrDesdeCache(ahoraIso: string): void {
  const { hallazgos, cerradas } = hallazgosDesdeCache();
  console.log(
    `Modo --desde-cache: ${hallazgos.length} ficha(s) vigente(s) en licitaciones/data/` +
      (cerradas > 0 ? `, ${cerradas} ya cerrada(s) y omitida(s)` : "") +
      `. Sin llamadas a ninguna fuente.`,
  );

  const reporte = [
    `# Radar Licitaciones — Servicios de Array (array.cl)`,
    ``,
    `Re-render desde caché: ${ahoraIso}`,
    ``,
    ...NOTA_ALCANCE,
    `>`,
    `> ⚠ Esta salida se regeneró desde lo ya guardado en \`licitaciones/data/\`, **sin consultar ` +
      `nada** (\`--desde-cache\`). No hay detección nueva: puede haber licitaciones publicadas ` +
      `después de la última corrida real que no aparecen acá, y alguna de las listadas puede haber ` +
      `cerrado.`,
    ``,
    `## Oportunidades detectadas (${hallazgos.length})`,
    ``,
    hallazgos.length > 0
      ? hallazgos.map((h) => filaReporte(h, [])).join("\n\n")
      : "_Ninguna ficha guardada en licitaciones/data/._",
    ``,
    `## Cobertura`,
    ``,
    `Re-render de ${hallazgos.length} ficha(s) en caché con cierre vigente` +
      (cerradas > 0 ? ` (${cerradas} omitida(s) por tener el cierre ya pasado)` : "") +
      `. Para detectar lo publicado desde entonces, correr \`npm run radar-licitaciones\` sin ` +
      `\`--desde-cache\` (tampoco gasta cuota).`,
  ].join("\n");

  escribirSalidas(reporte, hallazgos, hallazgos.length > 0);
  console.log("\n" + reporte);
}

interface Descubrimiento {
  resultados: Map<string, ResultadoBusquedaPortal>;
  consultasCorridas: number;
  consultasFallidas: string[];
  /** Total de filas devueltas por el buscador, antes del filtro local. */
  filasBrutas: number;
}

/**
 * Barrido por el buscador público: una consulta por término de cada categoría. El matching del
 * buscador es laxo (devuelve cientos de resultados por consulta), así que la precisión la pone el
 * filtro local sobre el texto completo — que acá sí está completo, a diferencia del listado de la API.
 */
async function descubrirEnPortal(): Promise<Descubrimiento> {
  const resultados = new Map<string, ResultadoBusquedaPortal>();
  const consultasFallidas: string[] = [];
  let consultasCorridas = 0;
  let filasBrutas = 0;

  for (const categoria of categoriasKeyword()) {
    for (const consulta of categoria.consultas_portal ?? []) {
      consultasCorridas++;
      try {
        const filas = await buscarEnPortal(consulta);
        filasBrutas += filas.length;
        for (const fila of filas) if (!resultados.has(fila.codigo)) resultados.set(fila.codigo, fila);
        console.log(`  [${categoria.id}] "${consulta}": ${filas.length} resultado(s) del buscador.`);
      } catch (err) {
        consultasFallidas.push(consulta);
        console.warn(`  [${categoria.id}] "${consulta}": falló — ${(err as Error).message}`);
      }
    }
  }
  return { resultados, consultasCorridas, consultasFallidas, filasBrutas };
}

async function main() {
  const ahoraIso = new Date().toISOString();
  const conApi = process.argv.includes("--con-api");

  if (process.argv.includes("--desde-cache")) {
    correrDesdeCache(ahoraIso);
    return;
  }

  console.log(
    `Radar licitaciones — servicios de Array (array.cl): ` +
      categoriasKeyword()
        .map((c) => c.nombre)
        .join(", ") +
      `.\nDescubrimiento por el buscador público del portal (sin ticket ni cuota).` +
      (conApi ? ` La ficha se pedirá también a la API (--con-api).` : "") +
      `\n`,
  );

  const descubrimiento = await descubrirEnPortal();
  if (descubrimiento.resultados.size === 0 && descubrimiento.consultasFallidas.length > 0) {
    console.error(
      `No se pudo consultar el buscador del portal en ninguna de las ${descubrimiento.consultasCorridas} ` +
        `consulta(s). docs/licitaciones.html se dejó intacta.`,
    );
    process.exitCode = 1;
    return;
  }
  console.log(
    `\n${descubrimiento.resultados.size} licitación(es) distintas devueltas por el buscador ` +
      `(${descubrimiento.filasBrutas} filas en total, con repetidos).`,
  );

  // El buscador entrega nombre y descripción COMPLETOS: el filtro local ya puede decidir sin pedir
  // la ficha. Con el listado de la API había que pedir la ficha solo para descartar falsos positivos.
  const candidatos = [...descubrimiento.resultados.values()].filter(
    (r) => categoriasDeTexto(`${r.nombre}\n${r.descripcion}`).length > 0,
  );
  const descartadosPorFiltroLocal = descubrimiento.resultados.size - candidatos.length;
  console.log(
    `${candidatos.length} confirmada(s) por los patrones de config/keywords.json ` +
      `(${descartadosPorFiltroLocal} descartada(s) por el filtro local).\n`,
  );

  const maxDetalles = capDeCorrida();
  const aRevisar = candidatos.slice(0, maxDetalles);
  const truncado = candidatos.length > aRevisar.length;
  if (truncado) {
    console.warn(
      `⚠ ${candidatos.length - aRevisar.length} candidato(s) quedaron fuera de esta corrida (cap de ` +
        `${maxDetalles}). Subirlo con --max=N.`,
    );
  }

  const state = cargarState();
  const filasReporte: string[] = [];
  const alertasRecompra: string[] = [];
  const hallazgos: HallazgoLicitacion[] = [];
  const sinFicha: string[] = [];
  let cuotaAgotada: CuotaAgotadaError | null = null;
  let fichasApi = 0;

  for (const candidato of aRevisar) {
    console.log(`  ${candidato.codigo} — ${candidato.organismo}`);
    let detalle: LicitacionDetalle | null = null;
    let fuente: "api" | "portal" = "portal";

    // 1. Antecedentes desde el portal: bases, garantías, criterios, anexos, documentos y ficha de
    //    decisión. Es gratis y es lo que de verdad decide si conviene presentarse.
    try {
      const { decision } = await procesarAntecedentes(candidato.codigo, (m) => console.log(m));
      const criticas = decision.banderas.filter((b) => b.nivel !== "favorable").length;
      console.log(
        `    decisión: cierre en ${decision.fechas.diasHastaCierre ?? "?"} día(s) · ` +
          `${decision.pesoPrecio !== undefined ? `precio ${decision.pesoPrecio}%` : "sin criterios parseados"} · ` +
          `${decision.garantia.exigida ? `garantía ${decision.garantia.monto ?? "sí"}` : "sin garantía"} · ` +
          `${criticas} punto(s) a revisar`,
      );
      detalle = fichaDesdePortal(candidato.codigo);
    } catch (err) {
      console.warn(`    ✗ no se pudieron leer los antecedentes: ${(err as Error).message}`);
    }

    // 1b. Lo que solo sabe el buscador: el tramo de monto cuando el organismo no publica la cifra,
    //     y cómo paga ese comprador (reclamos por pago no oportuno sobre compras de 12 meses).
    try {
      const enBuscador = await fichaEnBuscador(candidato.codigo);
      if (enBuscador) {
        writeFileSync(
          path.join(DATA_DIR, candidato.codigo, "buscador.json"),
          JSON.stringify(enBuscador, null, 2),
          "utf-8",
        );
        if (enBuscador.comprasEfectuadas != null && enBuscador.reclamosPagoNoOportuno != null) {
          console.log(
            `    comprador: ${enBuscador.reclamosPagoNoOportuno} reclamo(s) por pago no oportuno en ` +
              `${enBuscador.comprasEfectuadas} compras (12 meses)`,
          );
        }
      }
    } catch (err) {
      console.warn(`    (no se pudo leer la ficha del buscador: ${(err as Error).message})`);
    }

    // 2. Solo si se pidió: la ficha de la API, que aporta lo que ninguna fuente pública tiene
    //    (CantidadReclamos). Si la cuota está agotada no se insiste: ya hay ficha del portal.
    if (conApi && !cuotaAgotada) {
      try {
        detalle = await obtenerDetalleLicitacion(candidato.codigo);
        fuente = "api";
        fichasApi++;
      } catch (err) {
        if (err instanceof CuotaAgotadaError) {
          cuotaAgotada = err;
          console.warn(`    ⚠ ${err.message} Se sigue con la ficha pública del portal.`);
        } else {
          console.warn(`    ⚠ no se pudo pedir la ficha a la API: ${(err as Error).message}`);
        }
      }
    }

    if (!detalle) {
      sinFicha.push(candidato.codigo);
      console.warn(`    ✗ sin ficha utilizable — queda fuera de esta corrida.`);
      continue;
    }

    const condiciones = extraerCondicionesLicitacion(detalle);
    if (fuente === "api") guardarFicha(detalle, condiciones);
    const hallazgo: HallazgoLicitacion = { item: detalle, detalle, condiciones, fuente };
    hallazgos.push(hallazgo);

    // Con el DETALLE, no con el resultado del buscador: agrupar por un comprador que no está
    // metía todos los hallazgos en un mismo bucket y los declaraba recompradores entre sí.
    const registro = registrarHallazgo(state, detalle, ahoraIso);
    if (registro.esReintentoDeOrganismo) {
      alertasRecompra.push(
        `${detalle.Comprador?.NombreOrganismo ?? "organismo desconocido"} republica (${detalle.CodigoExterno}) — ` +
          `ya tenía ${registro.procesosPreviosDelOrganismo.length} proceso(s) previo(s): ` +
          registro.procesosPreviosDelOrganismo.map((p) => `${p.codigo} (${p.estado})`).join(", "),
      );
    }

    const marcas = [
      registro.esNuevo ? "**NUEVO** desde la última corrida" : null,
      registro.esReintentoDeOrganismo ? "**RECOMPRADOR**: este organismo ya tuvo procesos previos" : null,
    ].filter((m): m is string => m != null);
    filasReporte.push(filaReporte(hallazgo, marcas));
  }

  state.ultima_corrida = ahoraIso;
  guardarState(state);

  // Deja el barrido crudo del buscador: permite ajustar los patrones de config/keywords.json y ver
  // a quiénes habría pescado, sin volver a pedirle nada al portal.
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(
    path.join(DATA_DIR, "_busqueda-portal.json"),
    JSON.stringify(
      { corrida: ahoraIso, consultas: descubrimiento.consultasCorridas, resultados: [...descubrimiento.resultados.values()] },
      null,
      2,
    ),
    "utf-8",
  );

  const corridaCompleta = descubrimiento.consultasFallidas.length === 0 && sinFicha.length === 0 && !truncado;

  const reporte = [
    `# Radar Licitaciones — Servicios de Array (array.cl)`,
    ``,
    `Corrida: ${ahoraIso}`,
    ``,
    ...NOTA_ALCANCE,
    ...(descubrimiento.consultasFallidas.length > 0
      ? [
          `>`,
          `> ⚠ ${descubrimiento.consultasFallidas.length} consulta(s) al buscador fallaron ` +
            `(${descubrimiento.consultasFallidas.join(", ")}): la cobertura de esta corrida es parcial.`,
        ]
      : []),
    ...(cuotaAgotada
      ? [
          `>`,
          `> ⚠ Se pidió \`--con-api\` y **la cuota del ticket se agotó** (429, Retry-After: ` +
            `${cuotaAgotada.retryAfter ?? "no informado"}). No afecta a las oportunidades listadas: sus ` +
            `fichas salieron del portal. Lo único que se pierde es \`CantidadReclamos\`.`,
        ]
      : []),
    ``,
    `## Oportunidades detectadas (${filasReporte.length})`,
    ``,
    filasReporte.length > 0 ? filasReporte.join("\n\n") : "_Ninguna oportunidad detectada en esta corrida._",
    ``,
    `## Alertas de recompradores`,
    ``,
    alertasRecompra.length > 0 ? alertasRecompra.map((a) => `- ${a}`).join("\n") : "_Sin reintentos detectados en esta corrida._",
    ``,
    `## Cobertura`,
    ``,
    `${descubrimiento.consultasCorridas} consulta(s) al buscador público del portal ` +
      `(${descubrimiento.filasBrutas} filas, ${descubrimiento.resultados.size} licitaciones distintas), ` +
      `${candidatos.length} confirmada(s) por los patrones locales, ${aRevisar.length} procesada(s)` +
      (truncado ? ` (cap de ${maxDetalles} alcanzado — subirlo con --max=N)` : "") +
      (sinFicha.length > 0 ? `, ${sinFicha.length} sin ficha utilizable (${sinFicha.join(", ")})` : "") +
      `. Llamadas a la API con ticket: ${fichasApi}.`,
  ].join("\n");

  // Una corrida incompleta no debe pisar la grilla publicada: una oportunidad que hoy no se pudo
  // leer sigue abierta, y borrarla de la página la haría desaparecer sin que nadie lo note.
  escribirSalidas(reporte, hallazgos, corridaCompleta);
  console.log("\n" + reporte);
}

main().catch((err) => {
  console.error("Radar de licitaciones falló:", err);
  process.exitCode = 1;
});
