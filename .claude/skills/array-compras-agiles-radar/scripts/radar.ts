import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ROOT_DIR } from "../../../../src/lib/config.js";
import { loadArrayServiciosConfig, buscarHallazgosArray, presupuestoRequestsArray } from "../../../../src/lib/array-servicios.js";
import { generarPaginaArrayHtml, leerIndiceCotizaciones } from "../../../../src/lib/array-pagina.js";
import { configurarCuota, radarYaCorrioHoy } from "../../../../src/lib/cuota.js";

function fmtClp(n: number): string {
  return `$${n.toLocaleString("es-CL")} CLP`;
}

async function main() {
  const ahoraIso = new Date().toISOString();
  const config = loadArrayServiciosConfig();
  const totalVariantes = config.categorias.reduce((acc, c) => acc + c.variantes.length, 0);
  // Reserva prioritaria del radar de licencias Claude (PLAN-VOLUMEN.md, Fase 0/6): este barrido
  // usa términos genéricos y cuesta ~111 requests contra los 40 de aquel, así que no se le adelanta.
  const forzar = process.argv.includes("--forzar");
  if (!forzar && !radarYaCorrioHoy()) {
    console.error(
      "El radar de licencias Claude (`npm run radar`) todavía no corrió hoy. Este barrido es mucho más " +
        "caro en cuota y tiene prioridad menor — correr el radar primero, o pasar --forzar si es intencional.",
    );
    process.exitCode = 1;
    return;
  }
  configurarCuota({ script: "array-radar", maxRequests: presupuestoRequestsArray(config) });

  console.log(
    `Radar compra-agil-array — ${config.categorias.length} categorías de servicio, ${totalVariantes} variantes de búsqueda, estado=publicada\n`,
  );

  const { hallazgos, variantesFallidas, codigosUnicosTraidos, candidatosConMencionEnNombre, descartadosPorContexto } =
    await buscarHallazgosArray(config);

  const ruido = codigosUnicosTraidos - candidatosConMencionEnNombre;
  console.log(
    `${codigosUnicosTraidos} códigos únicos traídos por \`q\`, ${candidatosConMencionEnNombre} con mención real en el nombre` +
      (ruido > 0 ? ` (${ruido} descartados como ruido de \`q\`)` : "") +
      ".\n",
  );
  for (const h of hallazgos) {
    console.log(`  ${h.item.codigo}: ${h.item.institucion.organismo_comprador} — ${h.categorias.map((c) => c.nombre).join(", ")}`);
  }
  for (const d of descartadosPorContexto) {
    console.log(`  ${d.codigo}: descartado por contexto (${d.categorias.join(", ")}) — ${d.nombre}`);
  }
  for (const v of variantesFallidas) {
    console.warn(`  variante "${v.variante}": falló, se continuó sin ella — ${v.error}`);
  }

  const dirDatos = path.join(ROOT_DIR, "data", "array");
  mkdirSync(dirDatos, { recursive: true });
  writeFileSync(
    path.join(dirDatos, "compras-agiles.json"),
    JSON.stringify(
      {
        ultima_corrida: ahoraIso,
        hallazgos: hallazgos.map((h) => ({
          codigo: h.item.codigo,
          organismo: h.item.institucion.organismo_comprador,
          nombre: h.detalle.nombre,
          categorias: h.categorias.map((c) => c.id),
          fecha_cierre: h.item.fechas.fecha_cierre,
          tope_clp: h.condiciones.tope_clp,
          competencia_ofertas: h.condiciones.competencia_ofertas,
          estado_convocatoria: h.item.convocatoria.estado_convocatoria,
          region: h.item.institucion.nombre_region,
        })),
      },
      null,
      2,
    ),
    "utf-8",
  );

  // --- Reporte markdown ---
  const filasReporte = hallazgos.map((h) => {
    const elegible = h.item.convocatoria.estado_convocatoria === 1 ? "primer llamado" : "segundo llamado";
    return [
      `### ${h.item.codigo} — ${h.item.institucion.organismo_comprador}`,
      `- ${h.detalle.nombre}`,
      `- Categoría(s) Array: ${h.categorias.map((c) => c.nombre).join(", ")}`,
      `- Cierre: ${h.item.fechas.fecha_cierre} (${elegible})`,
      `- Tope: ${fmtClp(h.condiciones.tope_clp)}`,
      `- Competencia: ${h.condiciones.competencia_ofertas} oferta(s) recibida(s)`,
      `- Región: ${h.item.institucion.nombre_region}`,
    ].join("\n");
  });

  const reporte = [
    `# Radar Compra Ágil — servicios tipo Array`,
    ``,
    `Corrida: ${ahoraIso}`,
    ``,
    `## Oportunidades abiertas (${hallazgos.length})`,
    ``,
    filasReporte.length > 0 ? filasReporte.join("\n\n") : "_Ninguna oportunidad abierta en esta corrida._",
    ``,
    `## Cobertura`,
    ``,
    `Nota: a diferencia del radar de licencias Claude, estas variantes son términos genéricos ` +
      `("proyectos", "partes", "trámites") que pueden traer miles de resultados; se limita la ` +
      `paginación por variante para no forzar 504 de la API. ` +
      `La relevancia real se confirma después contra el patrón de cada categoría, así que el tope acota volumen, no precisión — pero puede dejar fuera coincidencias que solo aparecen en páginas más profundas.`,
    ``,
    variantesFallidas.length > 0
      ? `⚠️ ${variantesFallidas.length} de ${totalVariantes} variantes fallaron y se omitieron (cobertura parcial):\n` +
        variantesFallidas.map((v) => `- \`${v.variante}\`: ${v.error}`).join("\n")
      : `Las ${totalVariantes} variantes de búsqueda respondieron correctamente.`,
  ].join("\n");

  const outputDir = path.join(ROOT_DIR, "output");
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(path.join(outputDir, "array-compras-agiles.md"), reporte, "utf-8");
  console.log("\n" + reporte);

  // --- Página HTML ---
  // Este script no cotiza, pero tampoco debe BORRAR las cotizaciones que dejó `npm run
  // array-cotizar`: ambos escriben el mismo archivo, y el radar puede correr programado (ver la
  // automatización de Copilot en README.md). Se releen del índice versionado y se vuelven a
  // renderizar las que sigan correspondiendo a una oportunidad abierta.
  const cotizaciones = leerIndiceCotizaciones();
  const html = generarPaginaArrayHtml(hallazgos, config, {
    variantesFallidas,
    descartadosPorContexto,
    cotizaciones: cotizaciones.size > 0 ? cotizaciones : undefined,
  });
  const docsDir = path.join(ROOT_DIR, "docs");
  mkdirSync(docsDir, { recursive: true });
  writeFileSync(path.join(docsDir, "array-compras-agiles.html"), html, "utf-8");
  console.log(`\nPágina generada: docs/array-compras-agiles.html`);
}

main().catch((err) => {
  console.error("Radar Array falló:", err);
  process.exitCode = 1;
});
