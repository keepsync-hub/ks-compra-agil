import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { LIC_ROOT_DIR, loadKeywordsConfig } from "../../../../licitaciones/src/lib/config.js";
import {
  buscarLicitacionesActivas,
  obtenerDetalleLicitacion,
  CuotaAgotadaError,
  type LicitacionDetalle,
  type LicitacionListItem,
} from "../../../../licitaciones/src/lib/api.js";
import { itemMencionaKeyword, detalleMencionaKeyword } from "../../../../licitaciones/src/lib/keywords.js";
import { itemsDeLicitacion } from "../../../../licitaciones/src/lib/api.js";
import { extraerCondicionesLicitacion } from "../../../../licitaciones/src/lib/condiciones.js";
import { cargarState, guardarState, registrarHallazgo } from "../../../../licitaciones/src/lib/historial.js";
import { cierreYaPaso } from "../../../../licitaciones/src/lib/tiempo.js";
import {
  renderTarjetasLicitaciones,
  actualizarPaginaLicitaciones,
  type HallazgoLicitacion,
} from "../../../../licitaciones/src/lib/pagina.js";

// Tope de items a revisar en detalle por corrida: "estado=activas" trae TODAS las licitaciones
// vigentes del país (4.381 en la corrida de verificación del 2026-08-19), y esta API no permite
// filtrar por texto en el servidor (a diferencia de Compra Ágil, ver PLAN.md). Este cap evita
// agotar la cuota diaria del ticket pidiendo fichas de más — si se alcanza, el reporte lo declara.
const MAX_DETALLES_POR_CORRIDA = 60;

const DATA_DIR = path.join(LIC_ROOT_DIR, "data");

/** Ficha guardada por una corrida anterior, si existe. La cuota de esta API es escasa: cuando una
 *  ficha no se puede refrescar, reusar la cacheada es mejor que perder la oportunidad del reporte. */
function fichaCacheada(codigo: string): LicitacionDetalle | null {
  const ruta = path.join(DATA_DIR, codigo, "detalle.json");
  if (!existsSync(ruta)) return null;
  try {
    return JSON.parse(readFileSync(ruta, "utf-8")) as LicitacionDetalle;
  } catch {
    return null;
  }
}

function guardarFicha(detalle: LicitacionDetalle, condiciones: unknown): void {
  const dir = path.join(DATA_DIR, detalle.CodigoExterno);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "detalle.json"), JSON.stringify(detalle, null, 2), "utf-8");
  writeFileSync(path.join(dir, "condiciones.json"), JSON.stringify(condiciones, null, 2), "utf-8");
}

/** Vuelve a armar reporte y página desde las fichas ya guardadas, sin gastar una sola llamada a la
 *  API. Sirve cuando la cuota diaria está agotada o cuando cambió el formateo del reporte/página. */
function hallazgosDesdeCache(): { hallazgos: HallazgoLicitacion[]; cerradas: number } {
  if (!existsSync(DATA_DIR)) return { hallazgos: [], cerradas: 0 };
  const hallazgos: HallazgoLicitacion[] = [];
  let cerradas = 0;
  for (const entrada of readdirSync(DATA_DIR, { withFileTypes: true })) {
    if (!entrada.isDirectory()) continue;
    const detalle = fichaCacheada(entrada.name);
    if (!detalle) continue;
    // La caché acumula fichas de corridas anteriores: una licitación que ya cerró no es una
    // oportunidad y no debe volver a publicarse como si lo fuera.
    const cierre = detalle.FechaCierre ?? detalle.Fechas?.FechaCierre;
    if (cierre && cierreYaPaso(cierre)) {
      cerradas++;
      continue;
    }
    const condiciones = extraerCondicionesLicitacion(detalle);
    guardarFicha(detalle, condiciones); // reescribe condiciones.json con el extractor vigente
    hallazgos.push({ item: detalle, detalle, condiciones });
  }
  hallazgos.sort((a, b) => a.detalle.CodigoExterno.localeCompare(b.detalle.CodigoExterno));
  return { hallazgos, cerradas };
}

function filaReporte(h: HallazgoLicitacion, marcas: string[]): string {
  const { detalle, condiciones } = h;
  return [
    `### ${detalle.CodigoExterno} — ${detalle.Comprador?.NombreOrganismo ?? "organismo desconocido"}`,
    `- ${detalle.Nombre}`,
    `- Cierre: ${detalle.FechaCierre ?? detalle.Fechas?.FechaCierre ?? "sin dato"}`,
    `- Tipo: ${condiciones.tipo_licitacion ?? "sin dato"}`,
    condiciones.tope_clp > 0
      ? `- Tope: $${condiciones.tope_clp.toLocaleString("es-CL")} CLP (moneda: ${condiciones.moneda_original})`
      : `- Tope: no publicado por el organismo`,
    condiciones.plazo_contrato_texto != null ? `- Plazo de contrato: ${condiciones.plazo_contrato_texto}` : null,
    condiciones.documentos_exigidos.length > 0 ? `- Documentos exigidos: ${condiciones.documentos_exigidos.join(", ")}` : null,
    condiciones.excluyentes.length > 0 ? `- Excluyentes detectados: ${condiciones.excluyentes.join(" | ")}` : null,
    ...marcas.map((m) => `- ${m}`),
  ]
    .filter(Boolean)
    .join("\n");
}

const NOTA_ALCANCE = [
  `> Este radar corre contra la API real de Licitaciones (\`api.mercadopublico.cl\`), verificada en ` +
    `producción desde el 2026-08-19. Es de solo lectura: detectar no es cotizar, y ninguna oferta se ` +
    `envía sin que una persona la revise.`,
  `>`,
  `> Esta API **no expone los adjuntos ni las garantías** de la licitación (a diferencia de Compra ` +
    `Ágil): las bases administrativas —donde vive la exigencia de boleta de garantía— hay que leerlas ` +
    `en el portal antes de decidir si conviene ofertar.`,
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

/** Re-render sin llamadas a la API: no observa nada nuevo, así que no toca state.json ni declara
 *  hallazgos "NUEVO" ni recompradores — solo vuelve a publicar lo ya detectado. */
function correrDesdeCache(ahoraIso: string): void {
  const { hallazgos, cerradas } = hallazgosDesdeCache();
  console.log(
    `Modo --desde-cache: ${hallazgos.length} ficha(s) vigente(s) en licitaciones/data/` +
      (cerradas > 0 ? `, ${cerradas} ya cerrada(s) y omitida(s)` : "") +
      `. Sin llamadas a la API.`,
  );

  const reporte = [
    `# Radar Licitaciones — Gestión Documental / Digitalización de Procesos / Oficina de Partes`,
    ``,
    `Re-render desde caché: ${ahoraIso}`,
    ``,
    ...NOTA_ALCANCE,
    `>`,
    `> ⚠ Esta salida se regeneró desde las fichas ya guardadas en \`licitaciones/data/\`, **sin ` +
      `consultar la API** (\`--desde-cache\`). No hay detección nueva: puede haber licitaciones ` +
      `publicadas después de la última corrida real que no aparecen acá, y alguna de las listadas ` +
      `puede haber cerrado.`,
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
      `. Para cobertura real correr \`npm run radar-licitaciones\` sin \`--desde-cache\` ` +
      `(requiere cuota disponible del ticket).`,
  ].join("\n");

  escribirSalidas(reporte, hallazgos, hallazgos.length > 0);
  console.log("\n" + reporte);
}

async function main() {
  const ahoraIso = new Date().toISOString();
  loadKeywordsConfig();

  if (process.argv.includes("--desde-cache")) {
    correrDesdeCache(ahoraIso);
    return;
  }

  console.log(
    `Radar licitaciones — gestión documental / digitalización de procesos / oficina de partes.\n` +
      `Consultando estado=activas (esta API no soporta búsqueda por texto; el filtrado por palabra ` +
      `clave es local, ver PLAN.md de licitaciones/).\n`,
  );

  let listado: LicitacionListItem[] = [];
  try {
    listado = await buscarLicitacionesActivas();
  } catch (err) {
    console.error(`No se pudo consultar la API de Licitaciones: ${(err as Error).message}`);
    if (err instanceof CuotaAgotadaError) {
      console.error(
        `Se puede volver a publicar lo ya detectado sin gastar cuota: npm run radar-licitaciones -- --desde-cache`,
      );
    }
    console.error(`docs/licitaciones.html se dejó intacta.`);
    process.exitCode = 1;
    return;
  }
  console.log(`${listado.length} licitación(es) activa(s) traídas del listado.`);

  // Deja una muestra cruda del ítem de listado: ese ítem resultó traer muchos menos campos que la
  // ficha (ver api.ts), y tener una muestra a mano evita volver a gastar cuota para descubrirlo.
  if (listado[0]) {
    mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(
      path.join(DATA_DIR, "_muestra-item-listado.json"),
      JSON.stringify({ corrida: ahoraIso, campos: Object.keys(listado[0]), ejemplo: listado[0] }, null, 2),
      "utf-8",
    );
  }

  const candidatos = listado.filter(itemMencionaKeyword);
  console.log(`${candidatos.length} con mención local de gestión documental / digitalización / oficina de partes.`);

  const aRevisar = candidatos.slice(0, MAX_DETALLES_POR_CORRIDA);
  const truncado = candidatos.length > aRevisar.length;
  if (truncado) {
    console.warn(
      `⚠ ${candidatos.length - aRevisar.length} candidato(s) no se revisaron en esta corrida (cap de ` +
        `${MAX_DETALLES_POR_CORRIDA} para no agotar la cuota diaria). Volver a correr para cubrir el resto.`,
    );
  }

  const state = cargarState();
  const filasReporte: string[] = [];
  const alertasRecompra: string[] = [];
  const hallazgos: HallazgoLicitacion[] = [];
  let descartadosPorFalsoPositivo = 0;
  let fichasFrescas = 0;
  let fichasDesdeCache = 0;
  const sinFicha: string[] = [];
  let cuotaAgotada: CuotaAgotadaError | null = null;

  for (const item of aRevisar) {
    let detalle: LicitacionDetalle | null = null;
    let usadaDesdeCache = false;

    // Con la cuota agotada ya no se pide nada más: seguir iterando solo produce 429 en cadena
    // (guardrail: ante un bloqueo, detenerse). Igual se intenta rescatar la ficha desde caché.
    if (!cuotaAgotada) {
      try {
        detalle = await obtenerDetalleLicitacion(item.CodigoExterno);
        fichasFrescas++;
      } catch (err) {
        if (err instanceof CuotaAgotadaError) {
          cuotaAgotada = err;
          console.warn(`  ⚠ ${err.message} Se deja de consultar la API en esta corrida.`);
        } else {
          console.warn(`  ${item.CodigoExterno}: no se pudo obtener el detalle — ${(err as Error).message}`);
        }
      }
    }

    if (!detalle) {
      detalle = fichaCacheada(item.CodigoExterno);
      if (detalle) {
        usadaDesdeCache = true;
        fichasDesdeCache++;
        console.log(`  ${item.CodigoExterno}: ficha no refrescada, se usa la guardada por una corrida anterior.`);
      } else {
        sinFicha.push(item.CodigoExterno);
        console.warn(`  ${item.CodigoExterno}: sin ficha fresca ni en caché — queda fuera de esta corrida.`);
        continue;
      }
    }

    if (!detalleMencionaKeyword(detalle, itemsDeLicitacion(detalle))) {
      descartadosPorFalsoPositivo++;
      console.log(`  ${item.CodigoExterno}: descartado, el detalle no confirma la mención (falso positivo del listado).`);
      continue;
    }

    const condiciones = extraerCondicionesLicitacion(detalle);
    guardarFicha(detalle, condiciones);
    const hallazgo: HallazgoLicitacion = { item, detalle, condiciones };
    hallazgos.push(hallazgo);

    // Con el DETALLE, no con el ítem del listado: ese ítem no trae `Comprador`, así que agrupar
    // por él metía todos los hallazgos en un mismo bucket y los declaraba recompradores entre sí.
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
      usadaDesdeCache ? "_Ficha reusada desde caché: no se pudo refrescar en esta corrida._" : null,
    ].filter((m): m is string => m != null);
    filasReporte.push(filaReporte(hallazgo, marcas));
  }

  state.ultima_corrida = ahoraIso;
  guardarState(state);

  const corridaCompleta = cuotaAgotada == null && sinFicha.length === 0 && !truncado;

  const reporte = [
    `# Radar Licitaciones — Gestión Documental / Digitalización de Procesos / Oficina de Partes`,
    ``,
    `Corrida: ${ahoraIso}`,
    ``,
    ...NOTA_ALCANCE,
    ...(cuotaAgotada
      ? [
          `>`,
          `> ⚠ **La cuota diaria del ticket se agotó a mitad de esta corrida** (429, Retry-After: ` +
            `${cuotaAgotada.retryAfter ?? "no informado"}). Las fichas que no alcanzaron a refrescarse ` +
            `se tomaron de la caché local cuando existía; ${sinFicha.length} candidato(s) quedaron sin ` +
            `datos. Cobertura incompleta: volver a correr cuando la cuota se reponga.`,
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
    `${listado.length} licitación(es) activa(s) en el listado, ${candidatos.length} con mención local de la ` +
      `palabra clave, ${aRevisar.length} candidato(s) a revisar` +
      (truncado ? ` (cap de ${MAX_DETALLES_POR_CORRIDA} alcanzado — volver a correr)` : "") +
      `: ${fichasFrescas} ficha(s) traída(s) de la API` +
      (fichasDesdeCache > 0 ? `, ${fichasDesdeCache} reusada(s) desde caché` : "") +
      (sinFicha.length > 0 ? `, ${sinFicha.length} sin ficha (${sinFicha.join(", ")})` : "") +
      `, ${descartadosPorFalsoPositivo} descartada(s) por falso positivo del listado.`,
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
