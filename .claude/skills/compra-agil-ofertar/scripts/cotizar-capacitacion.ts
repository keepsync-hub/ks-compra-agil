import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ROOT_DIR } from "../../../../src/lib/config.js";
import {
  loadCapacitacionesConfig,
  cargarIdentidadOferente,
  derivarCumplimiento,
  derivarPendientes,
} from "../../../../src/lib/capacitaciones.js";
import {
  generarCotizacionCapacitacionPdf,
  type CotizacionCapacitacionData,
} from "../../../../src/lib/capacitacion-cotizacion.js";
import { nombreArchivoCotizacion } from "../../../../src/lib/nombre-archivo.js";
import { cierreYaPaso } from "../../../../src/lib/tiempo.js";

/**
 * Descuento sobre el tope para el nicho de capacitación: el usuario lo fijó explícitamente el
 * 2026-08-22 ("toma el monto indicado como tope y genera un 10% de descuento"). No sale de un
 * costo real de KeepSync — no existe ese catálogo (ver config/keepsync-oferta.json). Es la misma
 * clase de heurística que el 20% del cotizador de Array, y por eso el PDF sale PRELIMINAR.
 */
const DESCUENTO_SOBRE_TOPE = 0.1;

interface Detalle {
  codigo: string;
  nombre: string;
  estado: { codigo: string; glosa: string };
  fechas: { fecha_cierre: string };
  presupuesto: { monto_disponible_clp: number };
  institucion: { organismo_comprador: string };
}

function leerDetalle(codigo: string): Detalle | null {
  const p = path.join(ROOT_DIR, "data", codigo, "detalle.json");
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, "utf-8")) as Detalle;
}

async function cotizar(codigo: string, fecha: Date): Promise<boolean> {
  const config = loadCapacitacionesConfig();
  const requisitos = config.cotizaciones[codigo];
  if (!requisitos) {
    console.error(
      `  ${codigo}: no hay requisitos en config/capacitaciones.json. Extraer primero lo que piden sus ` +
        `adjuntos (data/${codigo}/attachments/) y agregarlos ahí — este cotizador no inventa el contenido del curso.`,
    );
    return false;
  }

  const detalle = leerDetalle(codigo);
  if (!detalle) {
    console.error(`  ${codigo}: falta data/${codigo}/detalle.json. Correr \`npm run radar\` primero.`);
    return false;
  }

  if (detalle.estado.codigo !== "publicada") {
    console.warn(`  ${codigo}: ya no está publicada (${detalle.estado.glosa}) — se omite.`);
    return false;
  }
  if (cierreYaPaso(detalle.fechas.fecha_cierre)) {
    console.warn(`  ${codigo}: ya cerró (${detalle.fechas.fecha_cierre}, hora de Chile) — se omite.`);
    return false;
  }

  const topeClp = detalle.presupuesto.monto_disponible_clp;
  if (!(topeClp > 0)) {
    console.error(`  ${codigo}: la ficha no informa presupuesto disponible (tope=${topeClp}) — no hay de dónde derivar el precio.`);
    return false;
  }

  const totalClp = Math.round(topeClp * (1 - DESCUENTO_SOBRE_TOPE));

  // Guardrail no negociable (CLAUDE.md): nunca cotizar sobre el tope. Acá se cumple por
  // construcción, pero eso es un argumento y no una verificación — si alguien cambia la fórmula,
  // esto corta antes de emitir el PDF.
  if (totalClp > topeClp) {
    console.error(
      `  ${codigo}: INADMISIBLE — la cotización (${totalClp.toLocaleString("es-CL")}) supera el tope ` +
        `(${topeClp.toLocaleString("es-CL")}). No se genera PDF.`,
    );
    return false;
  }

  const oferente = cargarIdentidadOferente();
  const descuentoPct = Math.round(DESCUENTO_SOBRE_TOPE * 100);

  const data: CotizacionCapacitacionData = {
    codigo,
    nombreCompra: detalle.nombre,
    organismoComprador: detalle.institucion.organismo_comprador.trim(),
    requisitos,
    totalClp,
    topeClp,
    descuentoPct,
    fechaCierre: detalle.fechas.fecha_cierre,
    cumplimiento: derivarCumplimiento(requisitos),
    pendientes: derivarPendientes(requisitos, oferente, descuentoPct),
    fecha,
    oferente,
  };

  const dirSalida = path.join(ROOT_DIR, "output", "capacitaciones", codigo);
  mkdirSync(dirSalida, { recursive: true });

  const nombreArchivoPdf = `${nombreArchivoCotizacion(fecha, data.organismoComprador)}.pdf`;
  const rutaPdf = path.join(dirSalida, nombreArchivoPdf);
  const { laminasDesbordadas } = await generarCotizacionCapacitacionPdf(data, rutaPdf);

  // El documento tiene 5 láminas de alto fijo: si algo no cupo, se recortó sin avisar. Un
  // requisito recortado es un requisito no declarado ante el organismo, así que esto se reporta
  // como error de la corrida y no como una advertencia perdida entre el resto de la salida.
  if (laminasDesbordadas.length > 0) {
    const detalle = laminasDesbordadas.map((l) => `lámina ${l.indice} (+${l.excesoPx}px)`).join(", ");
    console.error(`  ${codigo}: CONTENIDO RECORTADO en ${detalle}. Ajustar la plantilla antes de usar este PDF.`);
    return false;
  }

  const pendientesPorConfirmar = data.cumplimiento.filter((f) => f.estado === "por-confirmar").length;

  writeFileSync(
    path.join(dirSalida, "cotizacion-resumen.json"),
    JSON.stringify(
      {
        codigo,
        curso: requisitos.curso,
        organismo: data.organismoComprador,
        tope_clp: topeClp,
        total_clp: totalClp,
        descuento_pct: descuentoPct,
        regimen_tributario: requisitos.tributacion.regimen,
        formula: `${100 - descuentoPct}% del presupuesto disponible — regla del usuario, no derivada de costos reales`,
        criterio_evaluacion_organismo: requisitos.evaluacion.tipo,
        archivo_publicable: nombreArchivoPdf,
        fuente_documentos: requisitos.fuente_documentos,
        requisitos_por_confirmar: pendientesPorConfirmar,
        pendientes: data.pendientes,
        apto_para_enviar: false,
        _apto_nota:
          "Siempre false: falta designar relator/a con credenciales verificables, y el precio no sale de un costo real. El envío lo hace un humano, nunca este script.",
      },
      null,
      2,
    ),
    "utf-8",
  );

  console.log(
    `  ${codigo} — ${requisitos.curso}\n` +
      `    Tope ${topeClp.toLocaleString("es-CL")} → ofertado ${totalClp.toLocaleString("es-CL")} CLP ` +
      `(${descuentoPct}% bajo el tope, ${requisitos.tributacion.regimen})\n` +
      `    PDF: output/capacitaciones/${codigo}/${nombreArchivoPdf}` +
      ` · ${pendientesPorConfirmar} requisito(s) por confirmar · ${data.pendientes.length} pendiente(s) antes de presentar`,
  );
  return true;
}

async function main() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const config = loadCapacitacionesConfig();
  const codigos = args.length > 0 ? args : Object.keys(config.cotizaciones);

  console.log(
    `Cotizador de capacitaciones — precio = ${100 - DESCUENTO_SOBRE_TOPE * 100}% del presupuesto disponible ` +
      `(${DESCUENTO_SOBRE_TOPE * 100}% de descuento sobre el tope).\n` +
      `${codigos.length} oportunidad(es).\n`,
  );

  let ok = 0;
  for (const codigo of codigos) {
    try {
      if (await cotizar(codigo, new Date())) ok++;
    } catch (err) {
      console.error(`  ${codigo}: falló — ${(err as Error).message}`);
    }
  }

  console.log(`\n${ok}/${codigos.length} cotización(es) generada(s) en output/capacitaciones/.`);
  console.log(
    "Esto NO envía nada y ninguna de estas ofertas está lista para presentar: falta designar relator/a " +
      "con credenciales verificables en todas, y el precio se derivó del tope publicado, no de un costo real.",
  );
}

main().catch((err) => {
  console.error("Cotizador de capacitaciones falló:", err);
  process.exitCode = 1;
});
