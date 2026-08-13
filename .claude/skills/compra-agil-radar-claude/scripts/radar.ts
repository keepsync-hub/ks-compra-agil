import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ROOT_DIR, loadMarcasConfig } from "../../../../src/lib/config.js";
import { buscarCompraAgil, obtenerDetalleCompraAgil, extraerAdjudicacion, type CompraAgilListItem } from "../../../../src/lib/api.js";
import { itemMencionaMarca, detalleMencionaMarca } from "../../../../src/lib/marca.js";
import { extraerCondiciones } from "../../../../src/lib/condiciones.js";
import { descargarAdjuntosSiExisten } from "../../../../src/lib/adjuntos.js";
import { cargarState, guardarState, registrarHallazgo } from "../../../../src/lib/historial.js";

async function main() {
  const ahoraIso = new Date().toISOString();
  const marcas = loadMarcasConfig();

  console.log(`Radar compra-agil-claude — ${marcas.variantes.length} variantes de búsqueda, estado=publicada\n`);

  const encontrados = new Map<string, CompraAgilListItem>();
  const variantesFallidas: { variante: string; error: string }[] = [];
  for (const variante of marcas.variantes) {
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
      variantesFallidas.push({ variante, error: mensaje });
    }
  }

  const conMencionReal = [...encontrados.values()].filter(itemMencionaMarca);
  const ruido = encontrados.size - conMencionReal.length;
  console.log(`${encontrados.size} códigos únicos traídos por \`q\`, ${conMencionReal.length} con mención real de marca` + (ruido > 0 ? ` (${ruido} descartados como ruido de \`q\`)` : "") + ".\n");

  const state = cargarState();
  const filasReporte: string[] = [];
  const alertasRecompra: string[] = [];

  for (const item of conMencionReal) {
    const detalle = await obtenerDetalleCompraAgil(item.codigo);
    if (!detalleMencionaMarca(detalle.descripcion, detalle.productos_solicitados)) {
      console.log(`  ${item.codigo}: descartado, la descripción del detalle no confirma mención de marca (falso positivo de \`q\`).`);
      continue;
    }
    const condiciones = extraerCondiciones(detalle);

    const dirDatos = path.join(ROOT_DIR, "data", item.codigo);
    mkdirSync(dirDatos, { recursive: true });
    writeFileSync(path.join(dirDatos, "detalle.json"), JSON.stringify(detalle, null, 2), "utf-8");
    writeFileSync(path.join(dirDatos, "condiciones.json"), JSON.stringify(condiciones, null, 2), "utf-8");

    if (detalle.documentos.length > 0) {
      try {
        const adjuntos = await descargarAdjuntosSiExisten(item.codigo, true);
        if (adjuntos.length > 0) {
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
        `${item.institucion.organismo_comprador} republica (${item.codigo}) — ya tenía ${registro.procesosPreviosDelOrganismo.length} proceso(s) previo(s): ` +
          registro.procesosPreviosDelOrganismo.map((p) => `${p.codigo} (${p.estado})`).join(", "),
      );
    }

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

  // --- Adjudicaciones: compras con Proveedor Seleccionado ---
  // Se monitorean junto con las publicadas para saber qué se adjudicó y a quién. Nota: el endpoint
  // v2 hoy no puebla el proveedor ganador ni el monto adjudicado (viven en la Orden de Compra del
  // portal); se extrae lo que haya y se declara con honestidad si la API no lo expone.
  const adjudicadas = new Map<string, CompraAgilListItem>();
  for (const variante of marcas.variantes) {
    try {
      const items = await buscarCompraAgil({ q: variante, estado: "proveedor_seleccionado" });
      for (const item of items) if (!adjudicadas.has(item.codigo)) adjudicadas.set(item.codigo, item);
    } catch (err) {
      variantesFallidas.push({ variante: `${variante} (proveedor_seleccionado)`, error: (err as Error).message });
    }
  }
  const adjudicadasReales = [...adjudicadas.values()].filter(itemMencionaMarca);
  const filasAdjudicaciones: string[] = [];
  let adjudicacionesSinProveedorExpuesto = 0;
  for (const item of adjudicadasReales) {
    const detalle = await obtenerDetalleCompraAgil(item.codigo);
    if (!detalleMencionaMarca(detalle.descripcion, detalle.productos_solicitados)) continue;
    const condiciones = extraerCondiciones(detalle);
    const adj = extraerAdjudicacion(detalle);
    if (!adj.expuesta_por_api) adjudicacionesSinProveedorExpuesto++;

    const dirDatos = path.join(ROOT_DIR, "data", item.codigo);
    mkdirSync(dirDatos, { recursive: true });
    writeFileSync(path.join(dirDatos, "detalle.json"), JSON.stringify(detalle, null, 2), "utf-8");
    writeFileSync(path.join(dirDatos, "adjudicacion.json"), JSON.stringify(adj, null, 2), "utf-8");

    filasAdjudicaciones.push(
      [
        `### ${item.codigo} — ${item.institucion.organismo_comprador}`,
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
  console.log(
    `\nAdjudicaciones (proveedor seleccionado) con Claude: ${adjudicadasReales.length}` +
      (adjudicadasReales.length > 0 ? ` (${adjudicacionesSinProveedorExpuesto} sin proveedor expuesto por la API)` : "") +
      ".",
  );

  state.ultima_corrida = ahoraIso;
  guardarState(state);

  const reporte = [
    `# Radar Compra Ágil — Claude`,
    ``,
    `Corrida: ${ahoraIso}`,
    ``,
    `## Oportunidades abiertas (${filasReporte.length})`,
    ``,
    filasReporte.length > 0 ? filasReporte.join("\n\n") : "_Ninguna oportunidad abierta en esta corrida._",
    ``,
    `## Adjudicaciones (proveedor seleccionado) (${filasAdjudicaciones.length})`,
    ``,
    filasAdjudicaciones.length > 0
      ? filasAdjudicaciones.join("\n\n")
      : "_Ninguna Compra Ágil de Claude en estado \"proveedor seleccionado\" en esta corrida._",
    adjudicacionesSinProveedorExpuesto > 0
      ? `\n> Nota: la API v2 no expone el proveedor ganador ni el monto adjudicado (campos vacíos); ese dato está en la Orden de Compra del portal.`
      : ``,
    ``,
    `## Alertas de recompradores`,
    ``,
    alertasRecompra.length > 0 ? alertasRecompra.map((a) => `- ${a}`).join("\n") : "_Sin reintentos detectados en esta corrida._",
    ``,
    `## Cobertura`,
    ``,
    variantesFallidas.length > 0
      ? `⚠️ ${variantesFallidas.length} de ${marcas.variantes.length} variantes fallaron y se omitieron (cobertura parcial):\n` +
        variantesFallidas.map((v) => `- \`${v.variante}\`: ${v.error}`).join("\n")
      : `Las ${marcas.variantes.length} variantes de búsqueda respondieron correctamente.`,
  ].join("\n");

  const outputDir = path.join(ROOT_DIR, "output");
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(path.join(outputDir, "radar-ultima-corrida.md"), reporte, "utf-8");

  console.log("\n" + reporte);
}

main().catch((err) => {
  console.error("Radar falló:", err);
  process.exitCode = 1;
});
