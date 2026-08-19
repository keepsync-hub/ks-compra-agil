import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ROOT_DIR } from "../../../../src/lib/config.js";
import {
  cargarCategorias,
  categoriasActivas,
  itemMencionaCategoria,
  detalleCompraAgilMencionaCategoria,
  variantesDeBusqueda,
  type CategoriaCompilada,
} from "../../../../src/lib/categorias.js";
import {
  renderTarjetasCompraAgil,
  actualizarPaginaCompraAgil,
  renderKeywordsCompraAgil,
  actualizarBloqueKeywordsCompraAgil,
  type HallazgoCompraAgil,
} from "../../../../src/lib/pagina-compra-agil.js";
import {
  buscarCompraAgil,
  obtenerDetalleCompraAgil,
  extraerAdjudicacion,
  detalleDesdeListado,
  CuotaApiAgotadaError,
  type CompraAgilDetalle,
  type CompraAgilListItem,
} from "../../../../src/lib/api.js";
import { extraerCondiciones } from "../../../../src/lib/condiciones.js";
import { descargarAdjuntosSiExisten } from "../../../../src/lib/adjuntos.js";
import { cargarState, guardarState, registrarHallazgo, sembrarDesdeIndice } from "../../../../src/lib/historial.js";
import { configurarCuota } from "../../../../src/lib/cuota.js";
import { anexar, proyectar, ultimaPorCodigo } from "../../../../src/lib/indice.js";

interface VarianteFallida {
  variante: string;
  error: string;
}

/**
 * Cuota diaria agotada, compartida por toda la corrida: una vez que la API contesta 429, ninguna
 * categoría vuelve a pedirle nada. La corrida sigue con fichas reducidas del listado en vez de
 * abortar — antes, un 429 a mitad de camino tiraba abajo el radar y no se publicaba nada.
 */
let cuotaAgotada: CuotaApiAgotadaError | null = null;

/** Barrido de una categoría contra `estado=publicada`: mismo procedimiento que antes tenía
 * `radar.ts` hardcodeado a "marca" — generalizado a cualquier categoría de config/categorias.json
 * (ver PLAN-VOLUMEN.md, Fase 1). Con una sola categoría activa, produce exactamente el mismo
 * resultado que la versión anterior de este archivo. */
async function barrerCategoria(
  categoria: CategoriaCompilada,
  state: ReturnType<typeof cargarState>,
  ahoraIso: string,
  variantesFallidas: VarianteFallida[],
  alertasRecompra: string[],
  hallazgos: HallazgoCompraAgil[],
): Promise<string[]> {
  // Incluye las palabras agregadas a mano (config/categorias-extra.json): agregar una amplía la
  // búsqueda contra la API, no solo el filtro local.
  const variantes = variantesDeBusqueda(categoria);
  console.log(`\n— ${categoria.nombre} (${variantes.length} variante(s), estado=publicada)`);

  const encontrados = new Map<string, CompraAgilListItem>();
  for (const variante of variantes) {
    try {
      const items = await buscarCompraAgil({ q: variante, estado: "publicada" });
      for (const item of items) {
        if (!encontrados.has(item.codigo)) encontrados.set(item.codigo, item);
      }
    } catch (err) {
      // Una variante que sigue fallando (p.ej. 504 persistente del API para esa query) no debe
      // abortar toda la corrida: las variantes multi-palabra son subconjuntos de las de una palabra
      // (todo lo que menciona "Claude Pro" también menciona "Claude"), así que la cobertura se
      // recupera vía dedup. Se registra el fallo para reportarlo con honestidad.
      const mensaje = (err as Error).message;
      console.warn(`  variante "${variante}": falló, se continúa sin ella — ${mensaje}`);
      variantesFallidas.push({ variante: `${variante} (${categoria.id})`, error: mensaje });
    }
  }

  const conMencionReal = [...encontrados.values()].filter((item) => itemMencionaCategoria(categoria, item));
  const ruido = encontrados.size - conMencionReal.length;
  console.log(
    `  ${encontrados.size} códigos únicos traídos por \`q\`, ${conMencionReal.length} con mención real` +
      (ruido > 0 ? ` (${ruido} descartados como ruido de \`q\`)` : "") +
      ".",
  );

  const filasReporte: string[] = [];
  for (const item of conMencionReal) {
    // Con la cuota agotada ya no se pide nada más: seguir iterando solo produce 429 en cadena. Se
    // sigue con la ficha REDUCIDA del listado, que trae tope, cierre, comprador, competencia y si
    // es primer llamado — suficiente para decidir si mirar la compra, y honesto sobre lo que falta.
    let detalle: CompraAgilDetalle;
    let fuente: "api" | "listado" = "api";
    if (cuotaAgotada) {
      detalle = detalleDesdeListado(item);
      fuente = "listado";
    } else {
      try {
        detalle = await obtenerDetalleCompraAgil(item.codigo);
      } catch (err) {
        if (!(err instanceof CuotaApiAgotadaError)) throw err;
        cuotaAgotada = err;
        console.warn(`  ⚠ ${err.message}\n    Se sigue con la ficha reducida del listado para el resto de la corrida.`);
        detalle = detalleDesdeListado(item);
        fuente = "listado";
      }
    }

    // El descarte de falsos positivos exige el texto completo, que la ficha reducida no tiene: con
    // ella solo se sabe que el NOMBRE menciona la categoría (`itemMencionaCategoria`, ya aplicado).
    if (fuente === "api" && !detalleCompraAgilMencionaCategoria(categoria, detalle)) {
      console.log(`  ${item.codigo}: descartado, el detalle no confirma la mención (falso positivo de \`q\`).`);
      continue;
    }
    const condiciones = extraerCondiciones(detalle);

    const dirDatos = path.join(ROOT_DIR, "data", item.codigo);
    mkdirSync(dirDatos, { recursive: true });
    writeFileSync(path.join(dirDatos, "detalle.json"), JSON.stringify(detalle, null, 2), "utf-8");
    writeFileSync(path.join(dirDatos, "condiciones.json"), JSON.stringify(condiciones, null, 2), "utf-8");
    // Alimenta el índice histórico versionado (ver PLAN-VOLUMEN.md, Fase 2) — de paso, con cero
    // requests extra: el detalle ya se pagó arriba. Es lo que le permite a una corrida en la nube
    // (checkout limpio, sin data/state.json) sembrar recompradores desde corridas anteriores.
    //
    // Solo con la ficha completa: una reducida entraría al índice con ceros y nulls que parecen
    // datos observados (0 multas, 0 productos, sin plazo) y contaminaría la analítica de mercado.
    if (fuente === "api") anexar(proyectar(detalle, categoria.id, ahoraIso));

    const adjuntosDescargados: string[] = [];
    // El servicio de adjuntos es otro host y no gasta el ticket, así que se intenta igual.
    if (detalle.documentos.length > 0) {
      try {
        const adjuntos = await descargarAdjuntosSiExisten(item.codigo, true);
        if (adjuntos.length > 0) {
          adjuntosDescargados.push(...adjuntos.map((a) => a.nombreArchivo));
          const dirAdjuntos = path.join(dirDatos, "attachments");
          mkdirSync(dirAdjuntos, { recursive: true });
          for (const a of adjuntos) {
            writeFileSync(path.join(dirAdjuntos, a.nombreArchivo), a.contenido);
          }
          console.log(`  ${item.codigo}: ${adjuntos.length} adjunto(s) descargado(s).`);
        }
      } catch (err) {
        console.warn(`  ${item.codigo}: no se pudieron descargar adjuntos — ${(err as Error).message}`);
      }
    }

    const registro = registrarHallazgo(state, item, ahoraIso);
    if (registro.esReintentoDeOrganismo) {
      alertasRecompra.push(
        `${item.institucion.organismo_comprador} republica (${item.codigo}, ${categoria.nombre}) — ya tenía ${registro.procesosPreviosDelOrganismo.length} proceso(s) previo(s): ` +
          registro.procesosPreviosDelOrganismo.map((p) => `${p.codigo} (${p.estado})`).join(", "),
      );
    }

    hallazgos.push({
      categoriaId: categoria.id,
      categoriaNombre: categoria.nombre,
      detalle,
      condiciones,
      adjuntosDescargados,
      esNuevo: registro.esNuevo,
      fuente,
    });

    const elegible = item.convocatoria.estado_convocatoria === 1 ? "primer llamado — EMT puede ofertar" : "segundo llamado";
    filasReporte.push(
      [
        `### ${item.codigo} — ${item.institucion.organismo_comprador}`,
        `- ${detalle.nombre}`,
        `- Cierre: ${item.fechas.fecha_cierre} (${elegible})`,
        `- Tope: $${condiciones.tope_clp.toLocaleString("es-CL")} CLP (moneda original: ${condiciones.moneda_original})`,
        `- Plan detectado: ${condiciones.plan_detectado}` + (condiciones.cantidad_usuarios ? `, ${condiciones.cantidad_usuarios} usuarios` : ""),
        `- Competencia: ${condiciones.competencia_ofertas} oferta(s) recibida(s)`,
        condiciones.plazo_entrega_dias != null ? `- Plazo de entrega: ${condiciones.plazo_entrega_dias} día(s)` : null,
        condiciones.documentos_exigidos.length > 0 ? `- Documentos exigidos: ${condiciones.documentos_exigidos.join(", ")}` : null,
        condiciones.excluyentes.length > 0 ? `- Excluyentes detectados: ${condiciones.excluyentes.join(" | ")}` : null,
        registro.esNuevo ? "- **NUEVO** desde la última corrida" : null,
        registro.esReintentoDeOrganismo ? "- **RECOMPRADOR**: este organismo ya tuvo procesos previos" : null,
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }
  return filasReporte;
}

/** Barrido de `estado=proveedor_seleccionado` de una categoría, con el ahorro 8→1 ya aplicado
 * (medido en 0 casos para "claude" en cada corrida hasta ahora — ver PLAN-VOLUMEN.md, Fase 0):
 * una sola variante ancha en vez de todas las de la categoría. */
async function barrerAdjudicacionesCategoria(
  categoria: CategoriaCompilada,
  variantesFallidas: VarianteFallida[],
  ahoraIso: string,
): Promise<string[]> {
  if (cuotaAgotada) return [];
  const varianteAmplia = categoria.variantes_q[0] ?? categoria.nombre;
  const adjudicadas = new Map<string, CompraAgilListItem>();
  try {
    const items = await buscarCompraAgil({ q: varianteAmplia, estado: "proveedor_seleccionado" });
    for (const item of items) if (!adjudicadas.has(item.codigo)) adjudicadas.set(item.codigo, item);
  } catch (err) {
    variantesFallidas.push({ variante: `${varianteAmplia} (${categoria.id}, proveedor_seleccionado)`, error: (err as Error).message });
    return [];
  }

  const adjudicadasReales = [...adjudicadas.values()].filter((item) => itemMencionaCategoria(categoria, item));
  const filas: string[] = [];
  for (const item of adjudicadasReales) {
    const detalle = await obtenerDetalleCompraAgil(item.codigo);
    if (!detalleCompraAgilMencionaCategoria(categoria, detalle)) continue;
    const condiciones = extraerCondiciones(detalle);
    const adj = extraerAdjudicacion(detalle);

    const dirDatos = path.join(ROOT_DIR, "data", item.codigo);
    mkdirSync(dirDatos, { recursive: true });
    writeFileSync(path.join(dirDatos, "detalle.json"), JSON.stringify(detalle, null, 2), "utf-8");
    writeFileSync(path.join(dirDatos, "adjudicacion.json"), JSON.stringify(adj, null, 2), "utf-8");
    anexar(proyectar(detalle, categoria.id, ahoraIso));

    filas.push(
      [
        `### ${item.codigo} — ${item.institucion.organismo_comprador} (${categoria.nombre})`,
        `- ${detalle.nombre}`,
        `- Tope: $${condiciones.tope_clp.toLocaleString("es-CL")} CLP · ${condiciones.competencia_ofertas} oferta(s) recibida(s)`,
        `- Proveedor seleccionado: ${adj.proveedor_seleccionado ?? "_no expuesto por la API v2 (ver Orden de Compra en el portal)_"}`,
        adj.monto_adjudicado_clp != null ? `- Monto adjudicado: $${adj.monto_adjudicado_clp.toLocaleString("es-CL")} CLP` : null,
        adj.orden_compra != null ? `- Orden de compra: ${adj.orden_compra}` : null,
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }
  return filas;
}

async function main() {
  const categorias = categoriasActivas();
  if (categorias.length === 0) {
    console.error("Ninguna categoría activa en config/categorias.json — nada que buscar.");
    process.exitCode = 1;
    return;
  }
  const presupuestoTotal = categorias.reduce((a, c) => a + c.presupuesto_requests_por_corrida, 0);
  configurarCuota({ script: "radar", maxRequests: presupuestoTotal }); // reserva prioritaria — ver PLAN-VOLUMEN.md

  const ahoraIso = new Date().toISOString();
  console.log(`Radar Compra Ágil — ${categorias.length} categoría(s) activa(s): ${categorias.map((c) => c.nombre).join(", ")}`);

  const state = cargarState();
  // Puebla el estado desde el índice versionado ANTES de barrer — es lo que arregla el bug de
  // la nube: sin esto, un checkout limpio (data/state.json gitignored) nunca ve recompradores
  // de corridas anteriores, aunque estén registradas en historico/observaciones.jsonl.
  sembrarDesdeIndice(state, ultimaPorCodigo().values());
  const variantesFallidas: VarianteFallida[] = [];
  const alertasRecompra: string[] = [];
  const seccionesOportunidades: { categoria: CategoriaCompilada; filas: string[] }[] = [];
  const hallazgos: HallazgoCompraAgil[] = [];

  for (const categoria of categorias) {
    const filas = await barrerCategoria(categoria, state, ahoraIso, variantesFallidas, alertasRecompra, hallazgos);
    seccionesOportunidades.push({ categoria, filas });
  }

  // --- Adjudicaciones: compras con Proveedor Seleccionado, por categoría ---
  // Se monitorean junto con las publicadas para saber qué se adjudicó y a quién. Nota: el endpoint
  // v2 hoy no puebla el proveedor ganador ni el monto adjudicado (viven en la Orden de Compra del
  // portal); se extrae lo que haya y se declara con honestidad si la API no lo expone.
  const seccionesAdjudicaciones: { categoria: CategoriaCompilada; filas: string[] }[] = [];
  for (const categoria of categorias) {
    const filas = await barrerAdjudicacionesCategoria(categoria, variantesFallidas, ahoraIso);
    seccionesAdjudicaciones.push({ categoria, filas });
  }
  const totalAdjudicaciones = seccionesAdjudicaciones.reduce((a, s) => a + s.filas.length, 0);
  console.log(`\nAdjudicaciones (proveedor seleccionado) totales: ${totalAdjudicaciones}.`);

  state.ultima_corrida = ahoraIso;
  guardarState(state);

  const totalOportunidades = seccionesOportunidades.reduce((a, s) => a + s.filas.length, 0);
  const totalVariantes = categorias.reduce((a, c) => a + variantesDeBusqueda(c).length, 0);

  const reporte = [
    `# Radar Compra Ágil`,
    ``,
    `Corrida: ${ahoraIso}`,
    `Categorías activas: ${categorias.map((c) => c.nombre).join(", ")}`,
    ``,
    ...(cuotaAgotada
      ? [
          `> ⚠ **La cuota diaria de la API se agotó durante esta corrida** (429, Retry-After: ` +
            `${cuotaAgotada.retryAfter ?? "no informado"}). Las compras que no alcanzaron a leerse en ` +
            `detalle se reportan con la **ficha reducida del listado** (tope, cierre, comprador, ` +
            `competencia y tipo de llamado); les falta la descripción, los productos solicitados y el ` +
            `plazo de entrega, y su mención está confirmada solo por el nombre. No entran al índice ` +
            `histórico: entrarían con ceros que parecen datos observados.`,
          ``,
        ]
      : []),
    `## Oportunidades abiertas (${totalOportunidades})`,
    ``,
    ...seccionesOportunidades.map(({ categoria, filas }) =>
      [
        `### ${categoria.nombre} (${filas.length})`,
        ``,
        filas.length > 0 ? filas.join("\n\n") : "_Ninguna oportunidad abierta en esta corrida._",
      ].join("\n"),
    ),
    ``,
    `## Adjudicaciones (proveedor seleccionado) (${totalAdjudicaciones})`,
    ``,
    totalAdjudicaciones > 0
      ? seccionesAdjudicaciones
          .filter((s) => s.filas.length > 0)
          .map((s) => s.filas.join("\n\n"))
          .join("\n\n")
      : `_Ninguna Compra Ágil en estado "proveedor seleccionado" en esta corrida (todas las categorías)._`,
    `\n> Nota: la API v2 no expone el proveedor ganador ni el monto adjudicado (campos vacíos); ese dato está en la Orden de Compra del portal.`,
    ``,
    `## Alertas de recompradores`,
    ``,
    alertasRecompra.length > 0 ? alertasRecompra.map((a) => `- ${a}`).join("\n") : "_Sin reintentos detectados en esta corrida._",
    ``,
    `## Cobertura`,
    ``,
    variantesFallidas.length > 0
      ? `⚠️ ${variantesFallidas.length} variante(s) fallaron y se omitieron (cobertura parcial):\n` +
        variantesFallidas.map((v) => `- \`${v.variante}\`: ${v.error}`).join("\n")
      : `Las ${totalVariantes} variantes de búsqueda (todas las categorías activas) respondieron correctamente.`,
    `\nEl barrido de \`proveedor_seleccionado\` usa 1 sola variante ancha por categoría (no todas sus variantes) — medido en 0 casos para "claude" en cada corrida hasta ahora, no se justifica gastar N requests para confirmar N veces el mismo cero (ver PLAN-VOLUMEN.md).`,
  ].join("\n");

  const outputDir = path.join(ROOT_DIR, "output");
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(path.join(outputDir, "radar-ultima-corrida.md"), reporte, "utf-8");

  publicarPagina(hallazgos, variantesFallidas.length === 0);

  console.log("\n" + reporte);
}

/**
 * Publica en `docs/index.html` la grilla de oportunidades y las palabras clave.
 *
 * La grilla **no se publica si la corrida quedó incompleta** (alguna variante falló): una compra
 * que hoy no se pudo leer sigue abierta, y borrarla de la página la haría desaparecer sin que
 * nadie lo note. El bloque de palabras clave sí se publica siempre: es la config, que está entera.
 */
function publicarPagina(hallazgos: HallazgoCompraAgil[], corridaCompleta: boolean): void {
  const okKeywords = actualizarBloqueKeywordsCompraAgil(
    renderKeywordsCompraAgil(
      cargarCategorias().map((c) => ({
        id: c.id,
        nombre: c.nombre,
        activa: c.activa,
        variantes: variantesDeBusqueda(c),
        extra: c.extra,
        regex: String(c.regex),
      })),
    ),
  );
  if (!okKeywords) {
    console.warn(`⚠ No se pudo publicar el bloque de palabras clave: faltan los marcadores KEYWORDS en docs/index.html.`);
  }

  if (!corridaCompleta) {
    console.warn(
      `\n⚠ La grilla de docs/index.html se dejó intacta: la corrida quedó incompleta (alguna variante ` +
        `falló) y publicar una grilla parcial borraría oportunidades que siguen abiertas.`,
    );
    return;
  }
  const ok = actualizarPaginaCompraAgil(renderTarjetasCompraAgil(hallazgos));
  console.log(
    ok
      ? `\nPágina actualizada: docs/index.html (${hallazgos.length} oportunidad(es) en la grilla).`
      : `\n⚠ No se pudo actualizar docs/index.html: faltan los marcadores OPORTUNIDADES:INICIO/FIN.`,
  );
}

main().catch((err) => {
  console.error("Radar falló:", err);
  process.exitCode = 1;
});
