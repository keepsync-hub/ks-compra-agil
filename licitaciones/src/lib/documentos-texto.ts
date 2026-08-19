/**
 * Extracción de texto de los documentos de una licitación (PDF de bases, EE.TT., anexos .docx).
 *
 * Por qué existe: el portal protege los ARCHIVOS adjuntos con reCAPTCHA, así que en el peor caso
 * los baja una persona con un clic (ver "Acceso a los antecedentes" en `licitaciones/PLAN.md`). Ese
 * clic no servía de nada: nada leía los archivos después. Esto cierra ese hueco — puestos los
 * archivos en `licitaciones/data/<codigo>/adjuntos/`, su texto entra a la ficha de decisión igual
 * que el de la ficha pública, y se puede citar de dónde salió cada exigencia.
 *
 * PDF: `pdfjs-dist` (el mismo motor del visor de Firefox), en su build `legacy` para Node.
 * DOCX/XLSX: son ZIP con XML adentro; se leen con un lector de ZIP mínimo sobre `zlib`, sin
 * dependencias nuevas. Los `.xls` viejos (BIFF8, que es lo que exporta el foro) NO se parsean: su
 * contenido —las preguntas y respuestas— ya viene en texto desde la ficha pública.
 */
import { inflateRawSync } from "node:zlib";
import { readFileSync } from "node:fs";
import path from "node:path";

export interface TextoDocumento {
  archivo: string;
  formato: "pdf" | "ooxml" | "texto" | "no-soportado";
  texto: string;
  paginas?: number;
  /** Motivo, cuando no se pudo extraer nada. */
  problema?: string;
}

/** Entradas de un ZIP (DOCX/XLSX son ZIP). Solo lo necesario: nombre → contenido descomprimido. */
function leerZip(buffer: Buffer): Map<string, Buffer> {
  const archivos = new Map<string, Buffer>();
  // El End Of Central Directory está al final; se busca hacia atrás su firma.
  let eocd = -1;
  for (let i = buffer.length - 22; i >= 0 && i > buffer.length - 65_557; i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return archivos;
  const total = buffer.readUInt16LE(eocd + 10);
  let puntero = buffer.readUInt32LE(eocd + 16);
  for (let n = 0; n < total; n++) {
    if (buffer.readUInt32LE(puntero) !== 0x02014b50) break;
    const metodo = buffer.readUInt16LE(puntero + 10);
    const comprimido = buffer.readUInt32LE(puntero + 20);
    const largoNombre = buffer.readUInt16LE(puntero + 28);
    const largoExtra = buffer.readUInt16LE(puntero + 30);
    const largoComentario = buffer.readUInt16LE(puntero + 32);
    const offsetLocal = buffer.readUInt32LE(puntero + 42);
    const nombre = buffer.subarray(puntero + 46, puntero + 46 + largoNombre).toString("utf-8");
    // El header local repite nombre y extra con largos propios: hay que releerlos ahí.
    const nombreLocal = buffer.readUInt16LE(offsetLocal + 26);
    const extraLocal = buffer.readUInt16LE(offsetLocal + 28);
    const inicio = offsetLocal + 30 + nombreLocal + extraLocal;
    const datos = buffer.subarray(inicio, inicio + comprimido);
    try {
      archivos.set(nombre, metodo === 0 ? datos : inflateRawSync(datos));
    } catch {
      // Una entrada ilegible no debe costar el resto del documento.
    }
    puntero += 46 + largoNombre + largoExtra + largoComentario;
  }
  return archivos;
}

function xmlATexto(xml: string): string {
  return xml
    .replace(/<\/w:p>|<\/a:p>|<w:br\s*\/>/g, "\n")
    .replace(/<\/w:tc>/g, "\t")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n");
}

function textoOoxml(buffer: Buffer): string {
  const zip = leerZip(buffer);
  const partes: string[] = [];
  for (const [nombre, contenido] of zip) {
    // Cuerpo de Word, hojas de Excel y sus cadenas compartidas: lo demás es estilo o metadatos.
    if (/^word\/(document|header\d*|footer\d*)\.xml$/.test(nombre) || /^xl\/(sharedStrings|worksheets\/.+)\.xml$/.test(nombre)) {
      partes.push(xmlATexto(contenido.toString("utf-8")));
    }
  }
  return partes.join("\n").trim();
}

async function textoPdf(buffer: Buffer): Promise<{ texto: string; paginas: number }> {
  // Import dinámico: pdfjs es pesado y solo hace falta cuando de verdad hay un PDF que leer.
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buffer), useSystemFonts: false, isEvalSupported: false }).promise;
  const partes: string[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const pagina = await doc.getPage(n);
    const contenido = await pagina.getTextContent();
    const texto = contenido.items
      .map((i) => ("str" in i ? i.str : ""))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    if (texto) partes.push(`[página ${n}]\n${texto}`);
  }
  const paginas = doc.numPages;
  await doc.destroy();
  return { texto: partes.join("\n\n"), paginas };
}

/** Texto de un documento en disco. Nunca lanza: un archivo ilegible se reporta, no rompe la corrida. */
export async function extraerTexto(ruta: string): Promise<TextoDocumento> {
  const archivo = path.basename(ruta);
  const extension = path.extname(ruta).toLowerCase();
  let buffer: Buffer;
  try {
    buffer = readFileSync(ruta);
  } catch (err) {
    return { archivo, formato: "no-soportado", texto: "", problema: (err as Error).message };
  }
  const esPdf = buffer.subarray(0, 5).toString("latin1") === "%PDF-";
  const esZip = buffer.readUInt32LE(0) === 0x04034b50;
  try {
    if (esPdf) {
      const { texto, paginas } = await textoPdf(buffer);
      return {
        archivo,
        formato: "pdf",
        texto,
        paginas,
        problema: texto.trim() ? undefined : "PDF sin capa de texto (probablemente escaneado): haría falta OCR.",
      };
    }
    if (esZip) {
      const texto = textoOoxml(buffer);
      return { archivo, formato: "ooxml", texto, problema: texto ? undefined : "ZIP sin partes de texto reconocibles." };
    }
    if ([".txt", ".csv", ".md"].includes(extension)) {
      return { archivo, formato: "texto", texto: buffer.toString("utf-8") };
    }
    return {
      archivo,
      formato: "no-soportado",
      texto: "",
      problema:
        extension === ".xls"
          ? "Excel BIFF8 antiguo: no se parsea. Si es el foro, su contenido ya viene en la ficha pública."
          : `Formato ${extension || "desconocido"} sin extractor.`,
    };
  } catch (err) {
    return { archivo, formato: "no-soportado", texto: "", problema: (err as Error).message };
  }
}
