import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ROOT_DIR } from "../../../../src/lib/config.js";
import {
  cargarCategorias,
  categoriasActivas,
  itemConfirmaCategoria,
  detalleConfirmaCategoria,
  variantesDeBusqueda,
  type CategoriaCompilada,
  type ResultadoConfirmacion,
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
  buscarCompraAgilPagina,
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
import { configurarCuota, CuotaLocalAgotadaError } from "../../../../src/lib/cuota.js";
import { anexar, proyectar, ultimaPorCodigo, oportunidadesArrastradas } from "../../../../src/lib/indice.js";

interface VarianteFallida {
  variante: string;
  error: string;
}

/** Una compra que mencionaba la categoría pero que `patron_requerido`/`patron_excluyente` descartó. */
interface DescarteContexto {
  codigo: string;
  nombre: string;
  categoriaId: string;
  motivo: ResultadoConfirmacion;
}

const ARGS = process.argv.slice(2);

function flag(nombre: string): string | null {
  const encontrado = ARGS.find((a) => a.startsWith(`${nombre}=`));
  return encontrado ? encontrado.slice(nombre.length + 1) : null;
}

/** `--solo=claude,bi-capacitacion`: barrer solo esas categorías. Es la palanca para probar una sin pagar el resto. */
const SOLO = (flag("--solo") ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
/** `--sondeo`: dry-run de 1 request por variante, sin pedir detalles ni escribir nada. */
const SONDEO = ARGS.includes("--sondeo");
/** `--q="..."`: sondear una consulta suelta que todavía no está en ninguna categoría. */
const Q_SUELTA = flag("--q");

/**
 * Cuota agotada, compartida por toda la corrida: una vez que la API contesta 429 (o que se alcanza
 * el presupuesto local), ninguna categoría vuelve a pedirle nada. La corrida sigue con fichas
 * reducidas del listado en vez de abortar — antes, un 429 a mitad de camino tiraba abajo el radar
 * y no se publicaba nada.
 */
let cuotaAgotada: CuotaApiAgotadaError | null = null;
let cuotaLocalAgotada: CuotaLocalAgotadaError | null = null;

function sinCuota(): boolean {
  return cuotaAgotada != null || cuotaLocalAgotada != null;
}

/**
 * Quedarse sin cuota **no es** que una variante esté rota, y confundir las dos cosas es lo que
 * dejaba la página congelada: `variantesFallidas` marca la corrida como incompleta, y una corrida
 * incompleta antes no publicaba nada. Ahora la falta de cuota recorta la cobertura (y se declara
 * en la página), mientras que `variantesFallidas` queda para los fallos reales del endpoint.
 */
function registrarSiEsCuota(err: unknown): boolean {
  if (err instanceof CuotaApiAgotadaError) {
    if (!cuotaAgotada) {
      cuotaAgotada = err;
      console.warn(`  ⚠ ${err.message}`);
    }
    return true;
  }
  if (err instanceof CuotaLocalAgotadaError) {
    if (!cuotaLocalAgotada) {
      cuotaLocalAgotada = err;
      console.warn(`  ⚠ ${err.message}`);
    }
    return true;
  }
  return false;
}

/**
 * Las consultas de la corrida: la UNIÓN de las variantes de todas las categorías activas, con el
 * tope de páginas más alto que declare cualquiera de las que la usan.
 *
 * Antes cada categoría barría por su cuenta, así que `inteligencia artificial` —que usan tanto
 * `ia-asesoria` como `ia-capacitacion`— se pagaba dos veces, y una compra que sobreviviera en dos
 * categorías pagaba dos veces su detalle. Con la cuota diaria que mide `historico/cuota.jsonl`,
 * eso no es un lujo que se pueda dar.
 */
function consultasDeLaCorrida(categorias: CategoriaCompilada[]): Map<string, number> {
  const variantes = new Map<string, number>();
  for (const cat of categorias) {
    for (const v of variantesDeBusqueda(cat)) {
      variantes.set(v, Math.max(variantes.get(v) ?? 0, cat.maxPaginasPorVariante));
    }
  }
  return variantes;
}

interface Barrido {
  hallazgos: HallazgoCompraAgil[];
  filasPorCategoria: Map<string, string[]>;
  descartados: DescarteContexto[];
  /** Variantes que no se pudieron consultar por falta de cuota (no por un fallo del endpoint). */
  variantesSinConsultar: string[];
  /** Fichas cuyo detalle falló (504 y similares): se reportaron con la ficha reducida del listado. */
  detallesFallidos: VarianteFallida[];
}

/**
 * Barrido único de `estado=publicada` para todas las categorías activas: se consulta la unión de
 * las variantes, se deduplica por código una sola vez y cada superviviente se clasifica contra
 * todas las categorías (una compra puede caer en varias).
 */
async function barrerTodas(
  categorias: CategoriaCompilada[],
  state: ReturnType<typeof cargarState>,
  ahoraIso: string,
  variantesFallidas: VarianteFallida[],
  alertasRecompra: string[],
): Promise<Barrido> {
  const consultas = consultasDeLaCorrida(categorias);
  console.log(
    `\n— Barrido de ${consultas.size} consulta(s) única(s) para ${categorias.length} categoría(s), estado=publicada`,
  );

  const encontrados = new Map<string, CompraAgilListItem>();
  const variantesSinConsultar: string[] = [];
  for (const [variante, maxPaginas] of consultas) {
    if (sinCuota()) {
      variantesSinConsultar.push(variante);
      continue;
    }
    try {
      const items = await buscarCompraAgil({ q: variante, estado: "publicada", maxPaginas });
      for (const item of items) {
        if (!encontrados.has(item.codigo)) encontrados.set(item.codigo, item);
      }
    } catch (err) {
      if (registrarSiEsCuota(err)) {
        variantesSinConsultar.push(variante);
        continue;
      }
      // Una variante que sigue fallando (p.ej. 504 persistente del API para esa query) no debe
      // abortar toda la corrida: las variantes multi-palabra son subconjuntos de las de una palabra
      // (todo lo que menciona "Claude Pro" también menciona "Claude"), así que la cobertura se
      // recupera vía dedup. Se registra el fallo para reportarlo con honestidad.
      const mensaje = (err as Error).message;
      console.warn(`  variante "${variante}": falló, se continúa sin ella — ${mensaje}`);
      variantesFallidas.push({ variante, error: mensaje });
    }
  }

  // Nivel 1 del embudo: solo decide si vale la pena PAGAR el detalle. Basta que una categoría
  // confirme con el nombre; la clasificación fina se hace abajo con el texto completo.
  const candidatos = [...encontrados.values()].filter((item) =>
    categorias.some((c) => itemConfirmaCategoria(c, item) === "confirmada"),
  );
  const ruido = encontrados.size - candidatos.length;
  console.log(
    `  ${encontrados.size} códigos únicos traídos por \`q\`, ${candidatos.length} con mención real` +
      (ruido > 0 ? ` (${ruido} descartados como ruido de \`q\`)` : "") +
      ".",
  );

  const hallazgos: HallazgoCompraAgil[] = [];
  const filasPorCategoria = new Map<string, string[]>(categorias.map((c) => [c.id, []]));
  const descartados: DescarteContexto[] = [];
  const detallesFallidos: VarianteFallida[] = [];

  for (const item of candidatos) {
    // Con la cuota agotada ya no se pide nada más: seguir iterando solo produce 429 en cadena. Se
    // sigue con la ficha REDUCIDA del listado, que trae tope, cierre, comprador, competencia y si
    // es primer llamado — suficiente para decidir si mirar la compra, y honesto sobre lo que falta.
    let detalle: CompraAgilDetalle;
    let fuente: "api" | "listado" = "api";
    if (sinCuota()) {
      detalle = detalleDesdeListado(item);
      fuente = "listado";
    } else {
      try {
        detalle = await obtenerDetalleCompraAgil(item.codigo);
      } catch (err) {
        // Un fallo del endpoint en UNA ficha (un 504 transitorio, visto en producción) no puede
        // tirar abajo la corrida entera: antes lo hacía, y el efecto era que no se publicaba nada
        // —ni siquiera las compras que sí se habían leído—. Se sigue con la ficha reducida del
        // listado, igual que cuando se acaba la cuota, y se declara en el reporte.
        if (!registrarSiEsCuota(err)) {
          const mensaje = (err as Error).message;
          console.warn(`  ${item.codigo}: no se pudo leer el detalle, se sigue con la ficha reducida — ${mensaje}`);
          detallesFallidos.push({ variante: `detalle de ${item.codigo}`, error: mensaje });
        } else {
          console.warn(`    Se sigue con la ficha reducida del listado para el resto de la corrida.`);
        }
        detalle = detalleDesdeListado(item);
        fuente = "listado";
      }
    }

    // Nivel 2: se clasifica contra TODAS las categorías, no solo contra las que pasaron el nivel 1.
    // El detalle ya está pagado, así que recuperar acá una categoría que el nombre truncado no
    // alcanzaba a confirmar ("Capacitación en herramientas analíticas", que recién en los productos
    // dice "Power BI") no cuesta una request más.
    //
    // Con la ficha reducida no hay texto completo que evaluar: se queda con lo que ya se sabe del
    // nombre, y el descarte de falsos positivos se posterga a la próxima corrida con cuota.
    const confirmadas: CategoriaCompilada[] = [];
    for (const cat of categorias) {
      const veredicto = fuente === "api" ? detalleConfirmaCategoria(cat, detalle) : itemConfirmaCategoria(cat, item);
      if (veredicto === "confirmada") {
        confirmadas.push(cat);
      } else if (veredicto === "falta-requerido" || veredicto === "excluida") {
        // Se reporta con el código concreto: un `patron_excluyente` demasiado ancho, si no se
        // publica, se ve como oportunidades que desaparecen sin explicación.
        descartados.push({ codigo: item.codigo, nombre: detalle.nombre, categoriaId: cat.id, motivo: veredicto });
      }
    }
    if (confirmadas.length === 0) {
      console.log(`  ${item.codigo}: descartado, ninguna categoría lo confirma con el texto completo.`);
      continue;
    }

    // La primera es la de mayor prioridad: el orden de `config/categorias.json` es el orden en el
    // que se gasta la cuota, y también el que manda para el índice histórico (que guarda una sola).
    const principal = confirmadas[0]!;
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
    if (fuente === "api") anexar(proyectar(detalle, principal.id, ahoraIso));

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
        `${item.institucion.organismo_comprador} republica (${item.codigo}, ${principal.nombre}) — ya tenía ${registro.procesosPreviosDelOrganismo.length} proceso(s) previo(s): ` +
          registro.procesosPreviosDelOrganismo.map((p) => `${p.codigo} (${p.estado})`).join(", "),
      );
    }

    hallazgos.push({
      categoriaId: principal.id,
      categoriaNombre: principal.nombre,
      categoriasNombresCortos: confirmadas.map((c) => c.nombreCorto),
      detalle,
      condiciones,
      adjuntosDescargados,
      esNuevo: registro.esNuevo,
      fuente,
    });

    const elegible = item.convocatoria.estado_convocatoria === 1 ? "primer llamado — EMT puede ofertar" : "segundo llamado";
    filasPorCategoria.get(principal.id)?.push(
      [
        `### ${item.codigo} — ${item.institucion.organismo_comprador}`,
        `- ${detalle.nombre}`,
        confirmadas.length > 1 ? `- También cae en: ${confirmadas.slice(1).map((c) => c.nombre).join(", ")}` : null,
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

  return { hallazgos, filasPorCategoria, descartados, variantesSinConsultar, detallesFallidos };
}

/** Barrido de `estado=proveedor_seleccionado` de una categoría, con el ahorro 8→1 ya aplicado
 * (medido en 0 casos para "claude" en cada corrida hasta ahora — ver PLAN-VOLUMEN.md, Fase 0):
 * una sola variante ancha en vez de todas las de la categoría. Las categorías que declaran
 * `barrer_adjudicaciones: false` se saltan del todo: mientras un nicho no demuestre volumen, no
 * hay razón para gastarle una request por corrida a confirmar el mismo cero. */
async function barrerAdjudicacionesCategoria(
  categoria: CategoriaCompilada,
  variantesFallidas: VarianteFallida[],
  ahoraIso: string,
): Promise<string[]> {
  if (!categoria.barrerAdjudicaciones || sinCuota()) return [];
  const varianteAmplia = categoria.variantes_q[0] ?? categoria.nombre;
  const adjudicadas = new Map<string, CompraAgilListItem>();
  try {
    const items = await buscarCompraAgil({ q: varianteAmplia, estado: "proveedor_seleccionado" });
    for (const item of items) if (!adjudicadas.has(item.codigo)) adjudicadas.set(item.codigo, item);
  } catch (err) {
    if (registrarSiEsCuota(err)) return [];
    variantesFallidas.push({ variante: `${varianteAmplia} (${categoria.id}, proveedor_seleccionado)`, error: (err as Error).message });
    return [];
  }

  const adjudicadasReales = [...adjudicadas.values()].filter((item) => itemConfirmaCategoria(categoria, item) === "confirmada");
  const filas: string[] = [];
  for (const item of adjudicadasReales) {
    if (sinCuota()) break;
    let detalle: CompraAgilDetalle;
    try {
      detalle = await obtenerDetalleCompraAgil(item.codigo);
    } catch (err) {
      if (registrarSiEsCuota(err)) break;
      variantesFallidas.push({ variante: `detalle de ${item.codigo} (adjudicación)`, error: (err as Error).message });
      continue;
    }
    if (detalleConfirmaCategoria(categoria, detalle) !== "confirmada") continue;
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

/**
 * Dry-run: una sola request por consulta (primera página, 10 resultados) para medir **antes** de
 * gastar la cuota de una corrida entera. Responde las tres preguntas que deciden si una variante
 * sirve: ¿el endpoint la acepta (el quirk del "de" responde 500)?, ¿cuántos resultados trae (una
 * `q` de miles no cabe en `max_paginas_por_variante`)?, y ¿qué precisión tiene (imprime el
 * veredicto de cada resultado sin pagar un solo detalle)?
 */
async function sondear(categorias: CategoriaCompilada[]): Promise<void> {
  const consultas = Q_SUELTA ? [Q_SUELTA] : [...consultasDeLaCorrida(categorias).keys()];
  configurarCuota({ script: "sondeo", maxRequests: consultas.length });
  console.log(`Sondeo de ${consultas.length} consulta(s) — 1 request cada una, sin pedir detalles ni escribir en docs/.\n`);

  const lineas: string[] = [`# Sondeo de variantes`, ``, `Corrida: ${new Date().toISOString()}`, ``];
  const sinProbar: string[] = [];

  for (const [i, q] of consultas.entries()) {
    if (sinCuota()) {
      sinProbar.push(q);
      continue;
    }
    try {
      const pagina = await buscarCompraAgilPagina({ q, estado: "publicada", tamanoPagina: 10, numeroPagina: 1 });
      const total = pagina.paginacion?.total_resultados ?? pagina.items.length;
      const paginas = pagina.paginacion?.total_paginas ?? 1;
      console.log(`[${i + 1}/${consultas.length}] "${q}" → ${total} resultado(s), ${paginas} página(s) de 10`);
      lineas.push(`## \`${q}\` — ${total} resultado(s)`, ``);
      for (const item of pagina.items) {
        const veredictos = categorias
          .map((c) => [c.id, itemConfirmaCategoria(c, item)] as const)
          .filter(([, v]) => v !== "no-menciona")
          .map(([id, v]) => `${id}:${v}`);
        const resumen = veredictos.length > 0 ? veredictos.join("  ") : "ninguna categoría lo confirma (ruido de `q`)";
        console.log(`    ${item.codigo}  ${(item.nombre ?? "").slice(0, 72)}`);
        console.log(`      → ${resumen}`);
        lineas.push(`- \`${item.codigo}\` ${(item.nombre ?? "").slice(0, 90)} — ${resumen}`);
      }
      lineas.push(``);
    } catch (err) {
      if (registrarSiEsCuota(err)) {
        sinProbar.push(q);
        continue;
      }
      const mensaje = (err as Error).message;
      const pista = /500|ERROR_INTERNO/.test(mensaje)
        ? ' — 500: revisar si la consulta trae la palabra suelta "de" (quirk verificado del endpoint)'
        : "";
      console.warn(`[${i + 1}/${consultas.length}] "${q}" → FALLÓ: ${mensaje}${pista}`);
      lineas.push(`## \`${q}\` — falló`, ``, `${mensaje}${pista}`, ``);
    }
  }

  if (sinProbar.length > 0) {
    const aviso = `Quedaron ${sinProbar.length} consulta(s) sin probar por falta de cuota: ${sinProbar.map((q) => `\`${q}\``).join(", ")}. Retomar mañana.`;
    console.warn(`\n⚠ ${aviso}`);
    lineas.push(`## Sin probar`, ``, aviso, ``);
  }

  const outputDir = path.join(ROOT_DIR, "output");
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(path.join(outputDir, "sondeo-variantes.md"), lineas.join("\n"), "utf-8");
  console.log(`\nSondeo escrito en output/sondeo-variantes.md`);
}

async function main() {
  let categorias = categoriasActivas();
  if (SOLO.length > 0) {
    const desconocidas = SOLO.filter((id) => !cargarCategorias().some((c) => c.id === id));
    if (desconocidas.length > 0) {
      console.error(
        `--solo: categoría(s) desconocida(s): ${desconocidas.join(", ")}. Disponibles: ` +
          cargarCategorias().map((c) => c.id).join(", "),
      );
      process.exitCode = 1;
      return;
    }
    // A propósito sobre `cargarCategorias()` y no sobre las activas: `--solo` sirve justamente
    // para probar una categoría recién agregada antes de encenderla para todos.
    categorias = cargarCategorias().filter((c) => SOLO.includes(c.id));
  }
  if (categorias.length === 0) {
    console.error("Ninguna categoría activa en config/categorias.json — nada que buscar.");
    process.exitCode = 1;
    return;
  }

  if (SONDEO) {
    await sondear(categorias);
    return;
  }

  const presupuestoTotal = categorias.reduce((a, c) => a + c.presupuesto_requests_por_corrida, 0);
  configurarCuota({ script: "radar", maxRequests: presupuestoTotal }); // reserva prioritaria — ver PLAN-VOLUMEN.md

  const ahoraIso = new Date().toISOString();
  console.log(`Radar Compra Ágil — ${categorias.length} categoría(s): ${categorias.map((c) => c.nombre).join(", ")}`);

  const state = cargarState();
  // Puebla el estado desde el índice versionado ANTES de barrer — es lo que arregla el bug de
  // la nube: sin esto, un checkout limpio (data/state.json gitignored) nunca ve recompradores
  // de corridas anteriores, aunque estén registradas en historico/observaciones.jsonl.
  sembrarDesdeIndice(state, ultimaPorCodigo().values());
  const variantesFallidas: VarianteFallida[] = [];
  const alertasRecompra: string[] = [];

  const barrido = await barrerTodas(categorias, state, ahoraIso, variantesFallidas, alertasRecompra);

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

  // Una categoría quedó "sin barrer" si alguna de sus consultas no se pudo hacer: sus resultados
  // de hoy son, en el mejor de los casos, parciales.
  const consultasCaidas = new Set([...barrido.variantesSinConsultar, ...variantesFallidas.map((v) => v.variante)]);
  // Las categorías activas que `--solo` dejó fuera cuentan igual que las que se quedaron sin
  // cuota: no se barrieron hoy. Si no, publicar una corrida con `--solo` borraría de la grilla las
  // oportunidades de todas las demás, que siguen abiertas.
  const omitidasPorSolo = categoriasActivas().filter((c) => !categorias.some((activa) => activa.id === c.id));
  const categoriasSinBarrer = [
    ...categorias.filter((c) => variantesDeBusqueda(c).some((v) => consultasCaidas.has(v))),
    ...omitidasPorSolo,
  ];

  const totalOportunidades = barrido.hallazgos.length;
  const totalConsultas = consultasDeLaCorrida(categorias).size;

  const reporte = [
    `# Radar Compra Ágil`,
    ``,
    `Corrida: ${ahoraIso}`,
    `Categorías: ${categorias.map((c) => c.nombre).join(", ")}`,
    `Consultas únicas a la API: ${totalConsultas} (unión de las variantes de todas las categorías)`,
    ``,
    ...(sinCuota()
      ? [
          `> ⚠ **La cuota de la API se agotó durante esta corrida** ` +
            (cuotaAgotada ? `(429, Retry-After: ${cuotaAgotada.retryAfter ?? "no informado"})` : `(presupuesto local)`) +
            `. Las compras que no alcanzaron a leerse en detalle se reportan con la **ficha reducida ` +
            `del listado** (tope, cierre, comprador, competencia y tipo de llamado); les falta la ` +
            `descripción, los productos solicitados y el plazo de entrega, y su mención está confirmada ` +
            `solo por el nombre. No entran al índice histórico: entrarían con ceros que parecen datos ` +
            `observados.`,
          ``,
        ]
      : []),
    `## Oportunidades abiertas (${totalOportunidades})`,
    ``,
    ...categorias.map((categoria) => {
      const filas = barrido.filasPorCategoria.get(categoria.id) ?? [];
      return [
        `### ${categoria.nombre} (${filas.length})`,
        ``,
        filas.length > 0 ? filas.join("\n\n") : "_Ninguna oportunidad abierta en esta corrida._",
      ].join("\n");
    }),
    ``,
    `## Descartados por el filtro estricto (${barrido.descartados.length})`,
    ``,
    `Compras que sí mencionaban la materia pero que no pasaron \`patron_requerido\` (no es el servicio que se busca) o que cayó en \`patron_excluyente\` (es otro rubro). Se listan a propósito: un patrón demasiado ancho, si no se publica, se ve como oportunidades que desaparecen sin explicación.`,
    ``,
    barrido.descartados.length > 0
      ? barrido.descartados
          .map((d) => `- \`${d.codigo}\` (${d.categoriaId}, ${d.motivo}): ${d.nombre.slice(0, 110)}`)
          .join("\n")
      : `_Ninguno en esta corrida._`,
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
      ? `⚠️ ${variantesFallidas.length} consulta(s) fallaron y se omitieron:\n` +
        variantesFallidas.map((v) => `- \`${v.variante}\`: ${v.error}`).join("\n")
      : `Las ${totalConsultas} consultas de la corrida respondieron correctamente.`,
    ``,
    barrido.variantesSinConsultar.length > 0
      ? `⚠️ ${barrido.variantesSinConsultar.length} consulta(s) no se hicieron por falta de cuota: ` +
        barrido.variantesSinConsultar.map((v) => `\`${v}\``).join(", ")
      : "",
    barrido.detallesFallidos.length > 0
      ? `⚠️ ${barrido.detallesFallidos.length} ficha(s) se publicaron con el detalle reducido del listado porque su detalle falló:\n` +
        barrido.detallesFallidos.map((v) => `- \`${v.variante}\`: ${v.error}`).join("\n")
      : "",
    categoriasSinBarrer.length > 0
      ? `\nCategorías con cobertura parcial hoy: ${categoriasSinBarrer.map((c) => c.nombre).join(", ")}. Sus oportunidades se arrastran del índice en la página, marcadas como no re-verificadas.`
      : "",
    `\nEl barrido de \`proveedor_seleccionado\` usa 1 sola variante ancha por categoría, y solo en las que declaran \`barrer_adjudicaciones\` (ver PLAN-VOLUMEN.md).`,
  ].join("\n");

  const outputDir = path.join(ROOT_DIR, "output");
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(path.join(outputDir, "radar-ultima-corrida.md"), reporte, "utf-8");

  const huboAlgunListado = barrido.variantesSinConsultar.length + variantesFallidas.length < totalConsultas;
  publicarPagina(barrido.hallazgos, [...categorias, ...omitidasPorSolo], categoriasSinBarrer, huboAlgunListado);

  console.log("\n" + reporte);
}

/**
 * Publica en `docs/index.html` la grilla de oportunidades y las palabras clave.
 *
 * La grilla se publica **siempre**, salvo que la corrida no haya conseguido ningún listado: en ese
 * caso no hay evidencia nueva de nada y la página se deja intacta. Antes la regla era todo-o-nada
 * —si una sola variante fallaba no se publicaba—, para no borrar oportunidades que siguen
 * abiertas. Esa premisa desapareció: las categorías que no se alcanzaron a barrer se arrastran
 * desde `historico/observaciones.jsonl`, así que ya nada se borra, y una corrida parcial se puede
 * publicar declarando exactamente qué no se re-verificó hoy.
 */
function publicarPagina(
  hallazgos: HallazgoCompraAgil[],
  categorias: CategoriaCompilada[],
  categoriasSinBarrer: CategoriaCompilada[],
  huboAlgunListado: boolean,
): void {
  const okKeywords = actualizarBloqueKeywordsCompraAgil(
    renderKeywordsCompraAgil(
      cargarCategorias().map((c) => ({
        id: c.id,
        nombre: c.nombre,
        activa: c.activa,
        variantes: variantesDeBusqueda(c),
        extra: c.extra,
        regex: String(c.regex),
        requerido: c.requerido ? String(c.requerido) : undefined,
        excluyente: c.excluyente ? String(c.excluyente) : undefined,
      })),
    ),
  );
  if (!okKeywords) {
    console.warn(`⚠ No se pudo publicar el bloque de palabras clave: faltan los marcadores KEYWORDS en docs/index.html.`);
  }

  if (!huboAlgunListado) {
    console.warn(
      `\n⚠ La grilla de docs/index.html se dejó intacta: ninguna consulta llegó a la API en esta ` +
        `corrida, así que no hay nada nuevo que decir sobre lo que está abierto.`,
    );
    return;
  }

  // Lo que esta corrida no pudo re-verificar, pero el índice sí conoce y sigue abierto.
  const yaVistos = new Set(hallazgos.map((h) => h.detalle.codigo));
  const arrastradas = oportunidadesArrastradas(
    categoriasSinBarrer.map((c) => c.id),
    yaVistos,
  );
  const porId = new Map(categorias.map((c) => [c.id, c]));
  const hallazgosArrastrados: HallazgoCompraAgil[] = arrastradas.map(({ observacion, detalle }) => {
    const cat = porId.get(observacion.categoria);
    return {
      categoriaId: observacion.categoria,
      categoriaNombre: cat?.nombre ?? observacion.categoria,
      categoriasNombresCortos: [cat?.nombreCorto ?? observacion.categoria],
      detalle,
      condiciones: extraerCondiciones(detalle),
      adjuntosDescargados: [],
      esNuevo: false,
      fuente: "indice",
      observadoEn: observacion.observado_en,
    };
  });

  const todos = [...hallazgos, ...hallazgosArrastrados];
  const ok = actualizarPaginaCompraAgil(
    renderTarjetasCompraAgil(todos, new Date(), categoriasSinBarrer.map((c) => c.nombre)),
  );
  console.log(
    ok
      ? `\nPágina actualizada: docs/index.html (${todos.length} oportunidad(es) en la grilla` +
        (hallazgosArrastrados.length > 0 ? `, ${hallazgosArrastrados.length} arrastrada(s) del índice` : "") +
        `).`
      : `\n⚠ No se pudo actualizar docs/index.html: faltan los marcadores OPORTUNIDADES:INICIO/FIN.`,
  );
}

main().catch((err) => {
  console.error("Radar falló:", err);
  process.exitCode = 1;
});
