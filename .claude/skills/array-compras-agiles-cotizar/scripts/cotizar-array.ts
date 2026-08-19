import { mkdirSync, writeFileSync, copyFileSync } from "node:fs";
import path from "node:path";
import { ROOT_DIR, loadCompanyConfig } from "../../../../src/lib/config.js";
import {
  loadArrayServiciosConfig,
  buscarHallazgosArray,
  presupuestoRequestsArray,
  type HallazgoArray,
} from "../../../../src/lib/array-servicios.js";
import { descargarAdjuntosSiExisten } from "../../../../src/lib/adjuntos.js";
import { generarCotizacionArrayPdf, type CotizacionArrayData } from "../../../../src/lib/array-cotizacion.js";
import {
  generarPaginaArrayHtml,
  guardarIndiceCotizaciones,
  type CotizacionArrayEnlace,
} from "../../../../src/lib/array-pagina.js";
import { nombreArchivoCotizacion } from "../../../../src/lib/nombre-archivo.js";
import { cierreYaPaso } from "../../../../src/lib/tiempo.js";
import { configurarCuota, radarYaCorrioHoy } from "../../../../src/lib/cuota.js";

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
  // Sin tope no hay precio: toda la fórmula de esta página es un porcentaje del presupuesto
  // disponible, así que un tope 0/ausente daría una cotización de $0. Se omite en vez de emitir
  // un PDF sin sentido — mismo criterio que el cotizador de licitaciones.
  if (!(h.condiciones.tope_clp > 0)) {
    console.warn(
      `  ${codigo}: la ficha no informa un presupuesto disponible (tope=${h.condiciones.tope_clp}) — ` +
        `no se puede derivar un precio como % del tope. Se omite; revisar manualmente.`,
    );
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
          // `nombreArchivo` viene del servicio de adjuntos, que NO es API documentada (ver
          // src/lib/adjuntos.ts): se trata como entrada no confiable. `basename` evita que un
          // nombre con `../` escriba fuera de output/array/<codigo>/adjuntos/.
          const nombreSeguro = path.basename(a.nombreArchivo);
          if (!nombreSeguro || nombreSeguro === "." || nombreSeguro === "..") {
            console.warn(`  ${codigo}: adjunto con nombre inutilizable ("${a.nombreArchivo}") — se omite.`);
            continue;
          }
          writeFileSync(path.join(dirAdjuntos, nombreSeguro), a.contenido);
          nombresAdjuntos.push(nombreSeguro);
        }
        console.log(`  ${codigo}: ${nombresAdjuntos.length} adjunto(s) descargado(s).`);
      }
    } catch (err) {
      console.warn(`  ${codigo}: no se pudieron descargar adjuntos — ${(err as Error).message}`);
    }
  }

  // Precio = 80% del presupuesto disponible. Se desglosa neto/IVA solo para mostrarlo en el PDF;
  // el total (lo único que importa contra el tope) es siempre <= tope por construcción, y el
  // desglose se deriva del total para que redondear el neto nunca lo altere.
  const totalClp = Math.round(h.condiciones.tope_clp * (1 - DESCUENTO_SOBRE_PRESUPUESTO));
  const netoClp = Math.round(totalClp / (1 + company.pricing.iva_pct / 100));
  const ivaClp = totalClp - netoClp;

  // Guardrail no negociable del proyecto (ver CLAUDE.md): nunca cotizar sobre el tope. Acá se
  // cumple "por construcción", pero eso es un argumento, no una verificación — y el cotizador de
  // licencias Claude sí tiene el chequeo explícito. Si alguien cambia la fórmula, esto corta.
  if (totalClp > h.condiciones.tope_clp) {
    console.error(
      `  ${codigo}: INADMISIBLE — la cotización ($${totalClp.toLocaleString("es-CL")}) supera el tope ` +
        `($${h.condiciones.tope_clp.toLocaleString("es-CL")}). No se genera PDF.`,
    );
    return null;
  }

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

  // docs/ es lo único que publica GitHub Pages: se copia ahí SOLO nuestra cotización, para poder
  // enlazarla desde la página. Los adjuntos del organismo comprador se quedan en output/ a
  // propósito — ver la nota en CotizacionArrayEnlace.adjuntos.
  const dirDocs = path.join(ROOT_DIR, "docs", "array-cotizaciones", codigo);
  mkdirSync(dirDocs, { recursive: true });
  copyFileSync(rutaPdf, path.join(dirDocs, nombreArchivoPdf));

  return {
    enlace: {
      precioClp: totalClp,
      archivoPdfRelativo: `array-cotizaciones/${codigo}/${nombreArchivoPdf}`,
      adjuntos: nombresAdjuntos,
      generado: fechaIsoDia(fecha),
    },
  };
}

/** AAAA-MM-DD en hora local del proceso, consistente con `nombreArchivoCotizacion`. */
function fechaIsoDia(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function main() {
  const config = loadArrayServiciosConfig();
  // El radar de licencias Claude tiene reserva prioritaria de cuota (PLAN-VOLUMEN.md, Fase 0/6) y
  // su presupuesto es 40 requests; este barrido cuesta ~111 y es exploración de otro nicho, así
  // que no debe adelantársele. Mismo criterio que `informe` e `indexar`.
  const forzar = process.argv.includes("--forzar");
  if (!forzar && !radarYaCorrioHoy()) {
    console.error(
      "El radar de licencias Claude (`npm run radar`) todavía no corrió hoy. Este cotizador es mucho " +
        "más caro en cuota y tiene prioridad menor — correr el radar primero, o pasar --forzar si es intencional.",
    );
    process.exitCode = 1;
    return;
  }
  const company = loadCompanyConfig();
  configurarCuota({ script: "array-cotizar", maxRequests: presupuestoRequestsArray(config) });

  console.log(`Cotizador compra-agil-array — precio = ${(1 - DESCUENTO_SOBRE_PRESUPUESTO) * 100}% del presupuesto disponible por oportunidad.\n`);

  const { hallazgos, variantesFallidas, codigosUnicosTraidos, candidatosConMencionEnNombre, descartadosPorContexto } =
    await buscarHallazgosArray(config);

  const ruido = codigosUnicosTraidos - candidatosConMencionEnNombre;
  console.log(
    `${codigosUnicosTraidos} códigos únicos traídos por \`q\`, ${candidatosConMencionEnNombre} con mención real en el nombre` +
      (ruido > 0 ? ` (${ruido} descartados como ruido de \`q\`)` : "") +
      `. ${hallazgos.length} oportunidad(es) a cotizar.\n`,
  );

  for (const d of descartadosPorContexto) {
    console.log(`  (no se cotiza) ${d.codigo}: contexto desmiente ${d.categorias.join(", ")} — ${d.nombre}`);
  }

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

  // Índice versionado primero: es lo que deja que `npm run array-radar` refresque la página más
  // tarde sin borrar estas cotizaciones.
  guardarIndiceCotizaciones(cotizaciones);

  const html = generarPaginaArrayHtml(hallazgos, config, { cotizaciones, variantesFallidas, descartadosPorContexto });
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
