import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { LIC_ROOT_DIR, loadKeywordsConfig } from "../../../../licitaciones/src/lib/config.js";
import { buscarLicitaciones, obtenerDetalleLicitacion, itemsDeLicitacion, type LicitacionListItem } from "../../../../licitaciones/src/lib/api.js";
import { itemMencionaKeyword, detalleMencionaKeyword } from "../../../../licitaciones/src/lib/keywords.js";
import { extraerCondicionesLicitacion } from "../../../../licitaciones/src/lib/condiciones.js";
import { cargarState, guardarState, registrarHallazgo } from "../../../../licitaciones/src/lib/historial.js";

// Tope de items a revisar en detalle por corrida: "estado=activas" puede traer TODAS las
// licitaciones vigentes del país (miles), y esta API no permite filtrar por texto en el servidor
// (a diferencia de Compra Ágil, ver PLAN.md). Este cap evita agotar la cuota diaria del ticket
// pidiendo el detalle de candidatos de más — si se alcanza, el reporte lo declara explícitamente.
const MAX_DETALLES_POR_CORRIDA = 60;

async function main() {
  const ahoraIso = new Date().toISOString();
  const keywords = loadKeywordsConfig();

  console.log(
    `Radar licitaciones — gestión documental / digitalización de procesos / oficina de partes.\n` +
      `Consultando estado=activas (esta API no soporta búsqueda por texto; el filtrado por palabra ` +
      `clave es local, ver PLAN.md de licitaciones/).\n`,
  );

  let listado: LicitacionListItem[] = [];
  try {
    listado = await buscarLicitaciones({ estado: "activas" });
  } catch (err) {
    console.error(`No se pudo consultar la API de Licitaciones: ${(err as Error).message}`);
    process.exitCode = 1;
    return;
  }
  console.log(`${listado.length} licitación(es) activa(s) traídas del listado.`);

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
  let descartadosPorFalsoPositivo = 0;

  for (const item of aRevisar) {
    let detalle;
    try {
      detalle = await obtenerDetalleLicitacion(item.CodigoExterno);
    } catch (err) {
      console.warn(`  ${item.CodigoExterno}: no se pudo obtener el detalle — ${(err as Error).message}`);
      continue;
    }
    const items = itemsDeLicitacion(detalle);
    if (!detalleMencionaKeyword(detalle, items)) {
      descartadosPorFalsoPositivo++;
      console.log(`  ${item.CodigoExterno}: descartado, el detalle no confirma la mención (falso positivo del listado).`);
      continue;
    }
    const condiciones = extraerCondicionesLicitacion(detalle);

    const dirDatos = path.join(LIC_ROOT_DIR, "data", item.CodigoExterno);
    mkdirSync(dirDatos, { recursive: true });
    writeFileSync(path.join(dirDatos, "detalle.json"), JSON.stringify(detalle, null, 2), "utf-8");
    writeFileSync(path.join(dirDatos, "condiciones.json"), JSON.stringify(condiciones, null, 2), "utf-8");

    const adjuntos = Array.isArray(detalle.Adjuntos) ? detalle.Adjuntos : (detalle.Adjuntos?.Listado ?? []);
    if (adjuntos.length > 0) {
      console.log(`  ${item.CodigoExterno}: ${adjuntos.length} adjunto(s) listado(s) en la ficha (no se descargan — URL sin verificar, ver PLAN.md).`);
    }

    const registro = registrarHallazgo(state, item, ahoraIso);
    if (registro.esReintentoDeOrganismo) {
      alertasRecompra.push(
        `${detalle.Comprador?.NombreOrganismo ?? "organismo desconocido"} republica (${item.CodigoExterno}) — ya tenía ${registro.procesosPreviosDelOrganismo.length} proceso(s) previo(s): ` +
          registro.procesosPreviosDelOrganismo.map((p) => `${p.codigo} (${p.estado})`).join(", "),
      );
    }

    filasReporte.push(
      [
        `### ${item.CodigoExterno} — ${detalle.Comprador?.NombreOrganismo ?? "organismo desconocido"}`,
        `- ${detalle.Nombre}`,
        `- Cierre: ${detalle.FechaCierre ?? detalle.Fechas?.FechaCierre ?? "sin dato"}`,
        `- Tipo: ${condiciones.tipo_licitacion ?? "sin dato"}`,
        `- Tope: $${condiciones.tope_clp.toLocaleString("es-CL")} CLP (moneda: ${condiciones.moneda_original})`,
        condiciones.plazo_contrato_dias != null ? `- Plazo de contrato: ${condiciones.plazo_contrato_dias} día(s)` : null,
        condiciones.garantia_seriedad_clp != null ? `- Garantía de seriedad: $${condiciones.garantia_seriedad_clp.toLocaleString("es-CL")} CLP` : null,
        condiciones.documentos_exigidos.length > 0 ? `- Documentos exigidos: ${condiciones.documentos_exigidos.join(", ")}` : null,
        condiciones.excluyentes.length > 0 ? `- Excluyentes detectados: ${condiciones.excluyentes.join(" | ")}` : null,
        adjuntos.length > 0 ? `- Adjuntos en la ficha: ${adjuntos.length} (ver data/${item.CodigoExterno}/detalle.json)` : null,
        registro.esNuevo ? "- **NUEVO** desde la última corrida" : null,
        registro.esReintentoDeOrganismo ? "- **RECOMPRADOR**: este organismo ya tuvo procesos previos" : null,
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }

  state.ultima_corrida = ahoraIso;
  guardarState(state);

  const reporte = [
    `# Radar Licitaciones — Gestión Documental / Digitalización de Procesos / Oficina de Partes`,
    ``,
    `Corrida: ${ahoraIso}`,
    ``,
    `> ⚠ Este radar no se ha ejecutado contra la API real con un ticket válido (ver ` +
      `\`licitaciones/PLAN.md\`, sección "Insumos bloqueantes"). Los nombres de campo pueden no ` +
      `coincidir con la respuesta real hasta que se verifiquen.`,
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
    `${listado.length} licitación(es) activa(s) en el listado, ${candidatos.length} con mención local de la palabra clave, ` +
      `${aRevisar.length} revisada(s) en detalle` +
      (truncado ? ` (cap de ${MAX_DETALLES_POR_CORRIDA} alcanzado — cobertura parcial, volver a correr)` : "") +
      `, ${descartadosPorFalsoPositivo} descartada(s) por falso positivo del listado.`,
  ].join("\n");

  const outputDir = path.join(LIC_ROOT_DIR, "output");
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(path.join(outputDir, "radar-ultima-corrida.md"), reporte, "utf-8");

  console.log("\n" + reporte);
}

main().catch((err) => {
  console.error("Radar de licitaciones falló:", err);
  process.exitCode = 1;
});
