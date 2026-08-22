import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";
import { ROOT_DIR } from "./config.js";

/**
 * Rellena los anexos que el organismo entrega en su propio formato .docx.
 *
 * Por qué hace falta una plantilla y no basta el anexo en blanco: un .docx recién bajado del
 * portal no tiene marcadores, y Word parte el texto en `<w:r>` arbitrarios — "Razón social:" puede
 * vivir repartido en tres nodos. Buscar y reemplazar sobre el XML crudo funciona hasta que el
 * organismo reedita el archivo, y entonces falla en silencio dejando un anexo a medio llenar, que
 * es causal de inadmisibilidad.
 *
 * Por eso el paso manual, una sola vez por anexo: se abre el anexo en blanco, se escriben los
 * marcadores `{campo}` donde van los datos y se guarda como `config/anexos/<slug>.docx`. Desde ahí
 * el relleno es determinista y conserva intacto el diseño oficial. Los tres códigos de Dipres
 * (1618-67/68/69) comparten los mismos Anexos N°1 y N°2, así que una plantilla sirve para los tres.
 */
export const DIR_ANEXOS = path.join(ROOT_DIR, "config", "anexos");

export interface MapaAnexo {
  /** Para qué anexo es, en palabras — se lee en los mensajes de error. */
  descripcion: string;
  /** De qué archivo del organismo salió la plantilla. Trazabilidad, no decoración. */
  fuente: string;
  /**
   * Marcador → expresión de dónde sale el dato. Las expresiones las resuelve
   * `generar-documento.ts` contra el contexto que arma; acá solo se declaran.
   */
  campos: Record<string, string>;
  /** Marcadores que pueden quedar vacíos sin invalidar el anexo. */
  opcionales?: string[];
}

export interface ResultadoAnexo {
  buffer: Buffer;
  /** Marcadores de la plantilla que no recibieron valor. Vacío = anexo completo. */
  sinDato: string[];
}

export function rutaPlantilla(slug: string): string {
  return path.join(DIR_ANEXOS, `${slug}.docx`);
}

export function rutaMapa(slug: string): string {
  return path.join(DIR_ANEXOS, `${slug}.json`);
}

export function cargarMapa(slug: string): MapaAnexo {
  const p = rutaMapa(slug);
  if (!existsSync(p)) {
    throw new Error(
      `Falta el mapa de campos config/anexos/${slug}.json. Sin él no se sabe qué dato va en qué ` +
        `marcador, y este generador no adivina: ver "El anexo del organismo" en README.md.`,
    );
  }
  return JSON.parse(readFileSync(p, "utf-8")) as MapaAnexo;
}

/**
 * Toda lectura de una plantilla pasa por acá: un ENOENT crudo no le dice a nadie qué hacer, y este
 * es justo el caso que el flujo espera encontrar la primera vez que se toca un anexo nuevo.
 */
function exigirPlantilla(slug: string): string {
  const p = rutaPlantilla(slug);
  if (!existsSync(p)) {
    throw new Error(
      `Falta la plantilla config/anexos/${slug}.docx. Se crea una sola vez: abrir el anexo en ` +
        `blanco del organismo (data/<codigo>/attachments/), escribir los marcadores {campo} donde ` +
        `van los datos y guardarlo con ese nombre — ver config/anexos/README.md. No se genera un ` +
        `documento propio en su lugar: varias bases exigen su formato y un equivalente se rechaza ` +
        `en admisibilidad.`,
    );
  }
  return p;
}

/**
 * Rellena `config/anexos/<slug>.docx` con `valores` y devuelve el .docx resultante.
 *
 * No lanza cuando falta un dato: devuelve la lista en `sinDato` para que quien llame decida. Un
 * anexo con un campo vacío sigue siendo mejor que ninguno —una persona lo completa a mano— pero
 * tiene que quedar dicho cuáles son, no descubrirse al subirlo al portal.
 */
export function rellenarAnexo(slug: string, valores: Record<string, string>): ResultadoAnexo {
  const plantilla = exigirPlantilla(slug);

  const zip = new PizZip(readFileSync(plantilla));
  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
    // Un marcador sin valor queda vacío en vez de tirar la generación abajo; el faltante se
    // reporta en `sinDato`, que es información útil, y no un stacktrace.
    nullGetter: () => "",
  });

  const usados = new Set<string>();
  const completos: Record<string, string> = {};
  for (const [k, v] of Object.entries(valores)) {
    completos[k] = v ?? "";
    if (String(v ?? "").trim() !== "") usados.add(k);
  }

  doc.render(completos);

  const declarados = Object.keys(valores);
  const sinDato = declarados.filter((k) => !usados.has(k));

  return {
    buffer: doc.getZip().generate({ type: "nodebuffer", compression: "DEFLATE" }) as Buffer,
    sinDato,
  };
}

/**
 * Los marcadores que la plantilla realmente contiene. Sirve para avisar cuando el mapa y la
 * plantilla se desincronizan — el error que produce un anexo con un campo en blanco sin que
 * nadie se entere hasta que el organismo lo rechaza.
 */
export function marcadoresDePlantilla(slug: string): string[] {
  const zip = new PizZip(readFileSync(exigirPlantilla(slug)));
  const xml = zip.file("word/document.xml")?.asText() ?? "";
  // El texto visible, sin las etiquetas: así un marcador partido en varios <w:r> se vuelve a unir.
  const texto = xml.replace(/<[^>]+>/g, "");
  return [...new Set([...texto.matchAll(/\{([^{}]+)\}/g)].map((m) => m[1]!.trim()))];
}

export function verificarMapaContraPlantilla(slug: string): {
  faltanEnMapa: string[];
  sobranEnMapa: string[];
} {
  const mapa = cargarMapa(slug);
  const enPlantilla = new Set(marcadoresDePlantilla(slug));
  const enMapa = new Set(Object.keys(mapa.campos));
  return {
    faltanEnMapa: [...enPlantilla].filter((m) => !enMapa.has(m)),
    sobranEnMapa: [...enMapa].filter((m) => !enPlantilla.has(m)),
  };
}
