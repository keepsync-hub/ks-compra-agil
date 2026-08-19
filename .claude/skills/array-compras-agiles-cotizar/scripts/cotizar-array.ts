import { mkdirSync, writeFileSync, copyFileSync } from "node:fs";
import path from "node:path";
import { ROOT_DIR, loadCompanyConfig } from "../../../../src/lib/config.js";
import { loadArrayServiciosConfig, buscarHallazgosArray, type HallazgoArray } from "../../../../src/lib/array-servicios.js";
import { descargarAdjuntosSiExisten } from "../../../../src/lib/adjuntos.js";
import { generarCotizacionArrayPdf, type CotizacionArrayData } from "../../../../src/lib/array-cotizacion.js";
import { generarPaginaArrayHtml, type CotizacionArrayEnlace } from "../../../../src/lib/array-pagina.js";
import { nombreArchivoCotizacion } from "../../../../src/lib/nombre-archivo.js";
import { cierreYaPaso } from "../../../../src/lib/tiempo.js";

/** Precio de exploración de mercado: 80% del presupuesto disponible, pedido explícitamente por el usuario. */
const DESCUENTO_SOBRE_PRESUPUESTO = 0.2;

async function cotizarHallazgo(
  h: HallazgoArray,
  company: ReturnType<typeof loadCompanyConfig>,
  fecha: Date,
): Promise<{ enlace: CotizacionArrayEnlace } | null> {
  const codigo = h.item.codigo;

  if (h.detalle.estado.codigo !== "publicada") {
    console.warn(`  ${codigo}: ya no está publicada (${h.detalle.estado.glosa}) — se omite.`);
    return null;
  }
  if (cierreYaPaso(h.item.fechas.fecha_cierre)) {
    console.warn(`  ${codigo}: ya cerró (${h.item.fechas.fecha_cierre}, hora de Chile) — se omite.`);
    return null;
  }

  const dirSalida = path.join(ROOT_DIR, "output", "array", codigo);
  mkdirSync(dirSalida, { recursive: true });

  // Adjuntos: solo si el organismo declaró documentos (mismo criterio que compra-agil-radar-claude).
  let nombresAdjuntos: string[] = [];
  if (h.detalle.documentos.length > 0) {
    try {
      const adjuntos = await descargarAdjuntosSiExisten(codigo, true);
      if (adjuntos.length > 0) {
        const dirAdjuntos = path.join(dirSalida, "adjuntos");
        mkdirSync(dirAdjuntos, { recursive: true });
        for (const a of adjuntos) {
          writeFileSync(path.join(dirAdjuntos, a.nombreArchivo), a.contenido);
        }
        nombresAdjuntos = adjuntos.map((a) => a.nombreArchivo);
        console.log(`  ${codigo}: ${adjuntos.length} adjunto(s) descargado(s).`);
      }
    } catch (err) {
      console.warn(`  ${codigo}: no se pudieron descargar adjuntos — ${(err as Error).message}`);
    }
  }

  // Precio = 80% del presupuesto disponible. Se desglosa neto/IVA solo para mostrarlo en el PDF;
  // el total (lo único que importa contra el tope) es siempre <= tope por construcción.
  const totalClp = Math.round(h.condiciones.tope_clp * (1 - DESCUENTO_SOBRE_PRESUPUESTO));
  const netoClp = Math.round(totalClp / 1.19);
  const ivaClp = totalClp - netoClp;

  const categoriaNombre = h.categorias.map((c) => c.nombre).join(" + ");
  const categoriaDescripcion = h.categorias.map((c) => c.descripcion_array).join(" ");

  const condicionesComerciales = [
    `Plazo de entrega / activación: ${h.condiciones.plazo_entrega_dias ?? "a confirmar"} día(s) hábil(es) desde la adjudicación.`,
    "Proveedor con habilidad vigente en el Sistema de Información (Mercado Público).",
    "Precio calculado como 80% del presupuesto disponible informado por el organismo — cotización preliminar de exploración de mercado, no basada en costos reales de Array. Confirmar antes de usar.",
    ...h.condiciones.documentos_exigidos.map((d) => `Documento exigido: ${d} — adjuntar junto con la oferta.`),
  ];
  if (h.condiciones.excluyentes.length > 0) {
    condicionesComerciales.push(`Condiciones excluyentes detectadas en las bases: ${h.condiciones.excluyentes.join(" | ")}`);
  }

  const datosCotizacion: CotizacionArrayData = {
    codigo,
    nombreCompra: h.detalle.nombre,
    organismoComprador: h.item.institucion.organismo_comprador,
    direccionEntrega: h.detalle.entrega?.direccion_entrega,
    categoriaNombre,
    categoriaDescripcion,
    netoClp,
    ivaClp,
    totalClp,
    topeClp: h.condiciones.tope_clp,
    plazoEntregaDias: h.condiciones.plazo_entrega_dias,
    documentosExigidos: h.condiciones.documentos_exigidos,
    condicionesComerciales,
    fecha,
    company,
  };

  const nombreBase = nombreArchivoCotizacion(fecha, h.item.institucion.organismo_comprador);
  const nombreArchivoPdf = `${nombreBase}.pdf`;
  const rutaPdf = path.join(dirSalida, nombreArchivoPdf);
  await generarCotizacionArrayPdf(datosCotizacion, rutaPdf);

  writeFileSync(
    path.join(dirSalida, "cotizacion-resumen.json"),
    JSON.stringify(
      {
        codigo,
        categoria: categoriaNombre,
        neto_clp: netoClp,
        iva_clp: ivaClp,
        total_clp: totalClp,
        tope_clp: h.condiciones.tope_clp,
        formula: "80% del presupuesto disponible — precio de exploración de mercado, no cotización final",
        archivo_pdf: nombreArchivoPdf,
        adjuntos: nombresAdjuntos,
      },
      null,
      2,
    ),
    "utf-8",
  );

  // docs/ es lo único que publica GitHub Pages: se copia ahí para poder enlazarlo desde la página.
  const dirDocs = path.join(ROOT_DIR, "docs", "array-cotizaciones", codigo);
  mkdirSync(dirDocs, { recursive: true });
  copyFileSync(rutaPdf, path.join(dirDocs, nombreArchivoPdf));
  for (const nombre of nombresAdjuntos) {
    copyFileSync(path.join(dirSalida, "adjuntos", nombre), path.join(dirDocs, nombre));
  }

  return {
    enlace: {
      precioClp: totalClp,
      archivoPdfRelativo: `array-cotizaciones/${codigo}/${nombreArchivoPdf}`,
      adjuntos: nombresAdjuntos,
    },
  };
}

async function main() {
  const company = loadCompanyConfig();
  const config = loadArrayServiciosConfig();

  console.log(`Cotizador compra-agil-array — precio = ${(1 - DESCUENTO_SOBRE_PRESUPUESTO) * 100}% del presupuesto disponible por oportunidad.\n`);

  const { hallazgos, variantesFallidas, codigosUnicosTraidos, candidatosConMencionEnNombre } =
    await buscarHallazgosArray(config);

  const ruido = codigosUnicosTraidos - candidatosConMencionEnNombre;
  console.log(
    `${codigosUnicosTraidos} códigos únicos traídos por \`q\`, ${candidatosConMencionEnNombre} con mención real en el nombre` +
      (ruido > 0 ? ` (${ruido} descartados como ruido de \`q\`)` : "") +
      `. ${hallazgos.length} oportunidad(es) a cotizar.\n`,
  );

  const fecha = new Date();
  const cotizaciones = new Map<string, CotizacionArrayEnlace>();
  for (const h of hallazgos) {
    console.log(`${h.item.codigo} — ${h.item.institucion.organismo_comprador}`);
    try {
      const resultado = await cotizarHallazgo(h, company, fecha);
      if (resultado) {
        cotizaciones.set(h.item.codigo, resultado.enlace);
        console.log(`  Cotización: $${resultado.enlace.precioClp.toLocaleString("es-CL")} CLP (80% del tope).`);
      }
    } catch (err) {
      console.warn(`  ${h.item.codigo}: no se pudo generar la cotización — ${(err as Error).message}`);
    }
  }

  const html = generarPaginaArrayHtml(hallazgos, config, { cotizaciones, variantesFallidas });
  const docsDir = path.join(ROOT_DIR, "docs");
  mkdirSync(docsDir, { recursive: true });
  writeFileSync(path.join(docsDir, "array-compras-agiles.html"), html, "utf-8");

  console.log(`\n${cotizaciones.size}/${hallazgos.length} cotización(es) generada(s).`);
  console.log(`Página regenerada: docs/array-compras-agiles.html`);
  console.log(`\nEsto NO envía nada. Precio de exploración de mercado (80% del presupuesto), oferente KeepSync — revisar cada PDF y confirmar la vía de fulfillment antes de cualquier uso real.`);
}

main().catch((err) => {
  console.error("Cotizador Array falló:", err);
  process.exitCode = 1;
});
