/**
 * Todo lo que se puede saber de una licitación **sin gastar cuota de la API**, en una función:
 * baja la ficha pública del portal, la guarda, baja el único documento que el portal entrega sin
 * verificación humana (el Excel del foro de preguntas), deja el índice de documentos y escribe la
 * ficha de decisión.
 *
 * Vive en una lib porque la usan dos comandos: `npm run antecedentes-licitacion` (que es este
 * pipeline con una CLI encima) y `npm run radar-licitaciones`, que desde que el descubrimiento
 * también es gratis (ver `buscador-portal.ts`) puede completar una corrida entera sin tocar la API.
 */
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { LIC_ROOT_DIR } from "./config.js";
import {
  obtenerAntecedentes,
  descargarPreguntasRespuestas,
  referenciasDocumentales,
  type AntecedentesLicitacion,
  type ReferenciaDocumento,
} from "./portal-ficha.js";
import { escribirFichaDecision } from "./ficha-decision-archivo.js";
import type { FichaDecision } from "./decision.js";

const DATA_DIR = path.join(LIC_ROOT_DIR, "data");

export interface AntecedentesProcesados {
  antecedentes: AntecedentesLicitacion;
  referencias: ReferenciaDocumento[];
  decision: FichaDecision;
  /** Directorio `licitaciones/data/<codigo>/` donde quedó todo. */
  dir: string;
  /** Ruta relativa del Excel de preguntas y respuestas, si el portal lo entregó. */
  preguntasRespuestas?: string;
}

function guardar(a: AntecedentesLicitacion): string {
  const dir = path.join(DATA_DIR, a.codigo);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "ficha-portal.html"), a.html, "utf-8");
  // El HTML crudo ya quedó en su propio archivo: duplicarlo dentro del JSON lo haría inmanejable.
  const { html: _html, ...sinHtml } = a;
  writeFileSync(path.join(dir, "antecedentes.json"), JSON.stringify(sinHtml, null, 2), "utf-8");
  return dir;
}

/**
 * Baja los ARCHIVOS de antecedentes que el portal entrega sin verificación humana. Hoy es uno: el
 * Excel de preguntas y respuestas del foro (las respuestas del organismo modifican las bases). Los
 * demás adjuntos viven tras el CAPTCHA del visor — para esos, `npm run adjuntos-licitacion`.
 */
async function guardarDocumentos(
  a: AntecedentesLicitacion,
  dir: string,
  avisar: (mensaje: string) => void,
): Promise<string | undefined> {
  if (!a.enlaces.foroPreguntas) return undefined;
  try {
    const documento = await descargarPreguntasRespuestas(a.enlaces.foroPreguntas);
    if (!documento) return undefined;
    const destino = path.join(dir, "documentos");
    mkdirSync(destino, { recursive: true });
    // Nombre estable: el portal bautiza el archivo con la hora de descarga, así que cada corrida
    // dejaba una copia nueva del mismo documento. La fecha real ya está en `obtenidoEn`.
    const ruta = path.join(destino, "Foro_PreguntasRespuestas.xls");
    for (const viejo of readdirSync(destino).filter((f) => /^Foro_PreguntasRespuestas_.+\.xls$/.test(f))) {
      rmSync(path.join(destino, viejo), { force: true });
    }
    writeFileSync(ruta, documento.contenido);
    avisar(`    ↓ Foro_PreguntasRespuestas.xls (${documento.contenido.length} bytes) — archivo oficial, sin CAPTCHA`);
    return path.relative(process.cwd(), ruta);
  } catch (err) {
    avisar(`    (no se pudo bajar el Excel de preguntas: ${(err as Error).message})`);
    return undefined;
  }
}

/**
 * El entregable de este pipeline, además del texto: el índice de documentos con su URL. Tener la
 * URL ya es tener acceso al documento — bajar los bytes solo hace falta para leerlos con un
 * programa, y el texto de las bases ya viene parseado. `documentos.json` es lo que consume la
 * página publicada.
 */
function guardarReferencias(a: AntecedentesLicitacion, dir: string, xlsLocal?: string): ReferenciaDocumento[] {
  const referencias = referenciasDocumentales(a, { preguntasRespuestasLocal: xlsLocal });
  writeFileSync(
    path.join(dir, "documentos.json"),
    JSON.stringify({ codigo: a.codigo, obtenidoEn: a.obtenidoEn, documentos: referencias }, null, 2),
    "utf-8",
  );
  return referencias;
}

/** Procesa una licitación completa desde el portal. Cero llamadas a la API con ticket. */
export async function procesarAntecedentes(
  codigo: string,
  avisar: (mensaje: string) => void = () => {},
): Promise<AntecedentesProcesados> {
  const antecedentes = await obtenerAntecedentes(codigo);
  const dir = guardar(antecedentes);
  const preguntasRespuestas = await guardarDocumentos(antecedentes, dir, avisar);
  const referencias = guardarReferencias(antecedentes, dir, preguntasRespuestas);
  const decision = await escribirFichaDecision(antecedentes);
  return { antecedentes, referencias, decision, dir, preguntasRespuestas };
}
