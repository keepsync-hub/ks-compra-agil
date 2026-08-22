import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ROOT_DIR } from "../lib/config.js";
import { loadCapacitacionesConfig, cargarIdentidadOferente } from "../lib/capacitaciones.js";
import {
  catalogoDeOportunidad,
  nombreCarpeta,
  GLOSA_TIPO,
  type DocumentoOferta,
} from "../lib/documentos-oferta.js";
import { rellenarAnexo, cargarMapa, verificarMapaContraPlantilla } from "../lib/anexo-docx.js";
import { generarDocumentoPdf, type TipoGenerable } from "../lib/documento-generable.js";
import { ahora } from "../lib/tiempo.js";

/**
 * Genera los documentos de una oferta: rellena los anexos del organismo y arma los documentos
 * propios de KeepSync. No toca Google Drive — el expediente en n8n se encarga de subir y bajar.
 *
 *   npm run generar-documento -- <codigo> [NN ...]     (sin NN: todos los que puede)
 *   npm run generar-documento -- <codigo> --json       (resumen JSON para el posteo a n8n)
 *
 * Lo que NO hace, y es deliberado: no genera los documentos `acopio`. Un título profesional, un
 * certificado SENCE o una orden de compra de otro comprador los emite un tercero; producirlos acá
 * no sería generar un documento sino falsificar evidencia. El expediente los pide subidos.
 */

const DESCUENTO_SOBRE_TOPE = 0.1;

interface ResultadoDocumento {
  prefijo: string;
  documento: string;
  tipo: string;
  estado: "generado" | "omitido" | "bloqueado";
  archivo?: string;
  motivo?: string;
  /** Marcadores del anexo que quedaron sin dato: hay que completarlos a mano antes de presentar. */
  sin_dato?: string[];
}

function dirSalida(codigo: string): string {
  return path.join(ROOT_DIR, "output", "expedientes", codigo);
}

function leerDetalle(codigo: string): {
  organismo: string;
  topeClp: number;
  fechaCierre: string;
  nombre: string;
} | null {
  const p = path.join(ROOT_DIR, "data", codigo, "detalle.json");
  if (!existsSync(p)) return null;
  const d = JSON.parse(readFileSync(p, "utf-8")) as {
    nombre: string;
    fechas: { fecha_cierre: string };
    presupuesto: { monto_disponible_clp: number };
    institucion: { organismo_comprador: string };
  };
  return {
    organismo: d.institucion.organismo_comprador,
    topeClp: d.presupuesto.monto_disponible_clp,
    fechaCierre: d.fechas.fecha_cierre,
    nombre: d.nombre,
  };
}

/**
 * A qué documento propio corresponde cada entrada `generable`. Se decide por el nombre porque es
 * lo que el TDR usa; si no calza ninguno, se asume propuesta técnica, que es el documento largo.
 */
function tipoGenerable(doc: DocumentoOferta): TipoGenerable {
  return /econ[óo]mic/i.test(doc.documento) ? "oferta_economica" : "propuesta_tecnica";
}

/** El contexto contra el que se resuelven las expresiones del mapa de un anexo. */
function contextoAnexo(datos: {
  codigo: string;
  organismo: string;
  totalClp: number;
  topeClp: number;
  req: ReturnType<typeof loadCapacitacionesConfig>["cotizaciones"][string];
  oferente: ReturnType<typeof cargarIdentidadOferente>;
  fecha: Date;
}): Record<string, unknown> {
  const { req, oferente } = datos;
  return {
    codigo: datos.codigo,
    organismo: datos.organismo,
    fecha: datos.fecha.toISOString().slice(0, 10),
    total_clp: "$" + Math.round(datos.totalClp).toLocaleString("es-CL"),
    total_numero: String(Math.round(datos.totalClp)),
    tope_clp: "$" + Math.round(datos.topeClp).toLocaleString("es-CL"),
    oferente,
    curso: req.curso,
    objetivo: req.objetivo,
    duracion: req.duracion,
    participantes: req.participantes,
    modalidad: req.modalidad,
    fechas_ejecucion: req.fechas_ejecucion,
    modulos: req.modulos,
    entregables: req.entregables,
    // Deliberadamente vacío: mientras ninguna oferta designe relator/a, el marcador queda en blanco
    // y aparece en `sin_dato`, en vez de rellenarse con un nombre que nadie confirmó.
    relator: "",
  };
}

function resolver(contexto: Record<string, unknown>, expresion: string): string {
  const valor = expresion
    .split(".")
    .reduce<unknown>((acc, k) => (acc == null ? undefined : (acc as Record<string, unknown>)[k]), contexto);
  if (valor == null) return "";
  if (Array.isArray(valor)) return valor.map((v) => (typeof v === "string" ? v : JSON.stringify(v))).join("; ");
  return typeof valor === "string" ? valor : String(valor);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const soloJson = args.includes("--json");
  const positional = args.filter((a) => !a.startsWith("--"));
  const codigo = positional[0];
  const pedidos = positional.slice(1);

  if (!codigo) {
    console.error("Uso: npm run generar-documento -- <codigo> [NN ...] [--json]");
    process.exit(1);
  }

  const cfg = loadCapacitacionesConfig();
  const req = cfg.cotizaciones[codigo];
  const detalle = leerDetalle(codigo);

  if (!detalle) {
    const msg =
      `No hay data/${codigo}/detalle.json. Ese archivo lo escribe el radar y data/ es efímero ` +
      `(gitignored): correr 'npm run radar' antes, o generar desde el mismo job de CI.`;
    if (soloJson) {
      console.log(JSON.stringify({ codigo, error: msg, documentos: [] }));
      process.exit(1);
    }
    throw new Error(msg);
  }

  const catalogo = catalogoDeOportunidad(codigo, req);
  const oferente = cargarIdentidadOferente();
  const fecha = ahora();
  const totalClp = Math.round(detalle.topeClp * (1 - DESCUENTO_SOBRE_TOPE));

  // El mismo guardrail del cotizador, repetido acá porque este script puede correr solo: ofertar
  // sobre el presupuesto disponible es causal de inadmisibilidad.
  if (totalClp > detalle.topeClp) {
    throw new Error(`${codigo}: el total calculado (${totalClp}) supera el tope (${detalle.topeClp}).`);
  }

  const salida = dirSalida(codigo);
  mkdirSync(salida, { recursive: true });

  const objetivo = pedidos.length
    ? catalogo.documentos.filter((d) => pedidos.includes(d.prefijo))
    : catalogo.documentos;

  const resultados: ResultadoDocumento[] = [];

  for (const doc of objetivo) {
    const base: ResultadoDocumento = {
      prefijo: doc.prefijo,
      documento: doc.documento,
      tipo: doc.tipo,
      estado: "omitido",
    };

    if (doc.tipo === "acopio") {
      resultados.push({
        ...base,
        motivo:
          "Lo emite un tercero (título, certificado, orden de compra). Se sube al expediente; " +
          "generarlo sería falsificarlo.",
      });
      continue;
    }

    try {
      if (doc.tipo === "formulario") {
        if (!doc.plantilla) {
          resultados.push({
            ...base,
            estado: "bloqueado",
            motivo:
              "Es un formulario del organismo pero no declara 'plantilla' en " +
              "config/capacitaciones.json.",
          });
          continue;
        }
        const mapa = cargarMapa(doc.plantilla);
        const desalineado = verificarMapaContraPlantilla(doc.plantilla);
        const contexto = contextoAnexo({
          codigo,
          organismo: detalle.organismo,
          totalClp,
          topeClp: detalle.topeClp,
          req: req!,
          oferente,
          fecha,
        });
        const valores: Record<string, string> = {};
        for (const [marcador, expr] of Object.entries(mapa.campos)) {
          valores[marcador] = resolver(contexto, expr);
        }
        const { buffer, sinDato } = rellenarAnexo(doc.plantilla, valores);
        const archivo = path.join(salida, `${nombreCarpeta(doc)}.docx`);
        writeFileSync(archivo, buffer);
        const opcionales = new Set(mapa.opcionales ?? []);
        resultados.push({
          ...base,
          estado: "generado",
          archivo: path.relative(ROOT_DIR, archivo),
          sin_dato: [...sinDato.filter((m) => !opcionales.has(m)), ...desalineado.faltanEnMapa],
        });
        continue;
      }

      // generable
      if (!req) {
        resultados.push({
          ...base,
          estado: "bloqueado",
          motivo:
            `Falta la ficha del curso en config/capacitaciones.json para ${codigo}. Sin objetivo, ` +
            `módulos ni citas del TDR no hay con qué armar el documento, y este generador no los inventa.`,
        });
        continue;
      }
      const archivo = path.join(salida, `${nombreCarpeta(doc)}.pdf`);
      await generarDocumentoPdf(tipoGenerable(doc), {
        codigo,
        organismo: detalle.organismo,
        tituloDocumento: doc.documento,
        requisitos: req,
        oferente,
        totalClp,
        topeClp: detalle.topeClp,
        descuentoPct: Math.round(DESCUENTO_SOBRE_TOPE * 100),
        fecha,
      }, archivo);
      resultados.push({ ...base, estado: "generado", archivo: path.relative(ROOT_DIR, archivo) });
    } catch (e) {
      resultados.push({ ...base, estado: "bloqueado", motivo: (e as Error).message });
    }
  }

  const resumen = {
    codigo,
    organismo: detalle.organismo,
    fuente_catalogo: catalogo.fuente,
    catalogo_provisional: catalogo.provisional,
    total_clp: totalClp,
    tope_clp: detalle.topeClp,
    generado: fecha.toISOString(),
    apto_para_enviar: false,
    documentos: resultados,
  };
  writeFileSync(path.join(salida, "expediente-resumen.json"), JSON.stringify(resumen, null, 2) + "\n");

  if (soloJson) {
    console.log(JSON.stringify(resumen));
    return;
  }

  console.log(`\n${codigo} — ${detalle.organismo}`);
  console.log(`Catálogo: ${catalogo.fuente}${catalogo.provisional ? " (PROVISIONAL)" : ""}`);
  for (const r of resultados) {
    const marca = r.estado === "generado" ? "✓" : r.estado === "bloqueado" ? "⛔" : "·";
    console.log(`  ${marca} ${r.prefijo} [${GLOSA_TIPO[r.tipo as keyof typeof GLOSA_TIPO]}] ${r.documento}`);
    if (r.archivo) console.log(`      → ${r.archivo}`);
    if (r.motivo) console.log(`      ${r.motivo}`);
    if (r.sin_dato?.length) console.log(`      Campos sin dato: ${r.sin_dato.join(", ")}`);
  }
  console.log(`\nResumen en ${path.relative(ROOT_DIR, path.join(salida, "expediente-resumen.json"))}`);
  console.log("Ningún documento se envía: el expediente queda para revisión humana.\n");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
