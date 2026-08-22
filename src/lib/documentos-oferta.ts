import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { ROOT_DIR } from "./config.js";
import type { Condiciones } from "./condiciones.js";
import type { RequisitosCapacitacion } from "./capacitaciones.js";

/**
 * Catálogo de documentos que exige una Compra Ágil, y de qué naturaleza es cada uno.
 *
 * La distinción de abajo es la que hace honesto el botón "Generar" del expediente: de los seis
 * documentos que pide Dipres, tres son evidencia emitida por terceros. Producirlos no sería
 * "generar", sería falsificarlos. El agente los acopia; no los fabrica.
 */
export type TipoDocumento = "formulario" | "generable" | "acopio";

export const TIPOS_DOCUMENTO: readonly TipoDocumento[] = ["formulario", "generable", "acopio"];

export const GLOSA_TIPO: Record<TipoDocumento, string> = {
  formulario: "Formulario del organismo",
  generable: "Lo genera KeepSync",
  acopio: "Se sube, no se genera",
};

export const EXPLICACION_TIPO: Record<TipoDocumento, string> = {
  formulario:
    "El anexo viene en el formato del organismo. Se rellena la plantilla oficial, conservando su diseño.",
  generable:
    "Se arma con datos ya transcritos del TDR y del catálogo de KeepSync, y se renderiza a PDF.",
  acopio:
    "Es un documento emitido por un tercero (título, certificado, orden de compra). Solo puede subirse: generarlo sería falsificarlo.",
};

export interface DocumentoOferta {
  /** Orden dentro del expediente, 1-based. */
  n: number;
  /** "01", "02", … — la clave con que se emparejan carpeta y entregable. */
  prefijo: string;
  documento: string;
  tipo: TipoDocumento;
  /**
   * Solo para `formulario`: slug de la plantilla en `config/anexos/<slug>.docx` + `<slug>.json`.
   * Sin ella, "Generar" se detiene y dice qué falta, en vez de improvisar un documento propio.
   */
  plantilla?: string;
  /**
   * true cuando el documento no salió del TDR leído a mano sino de la detección automática.
   * Una carpeta de más es ruido; una de menos es inadmisibilidad, así que se marca y se avisa.
   */
  provisional: boolean;
}

export interface CatalogoDocumentos {
  codigo: string;
  documentos: DocumentoOferta[];
  /** De dónde salió: importa para saber cuánto confiar en la lista. */
  fuente: "capacitaciones.json" | "condiciones.json" | "base";
  provisional: boolean;
}

/** Lo que se pide en cualquier Compra Ágil cuando no hay nada mejor. Siempre provisional. */
const CATALOGO_BASE: Array<{ documento: string; tipo: TipoDocumento }> = [
  { documento: "Oferta económica", tipo: "generable" },
  { documento: "Propuesta técnica", tipo: "generable" },
  { documento: "Antecedentes del relator-a", tipo: "acopio" },
  { documento: "Certificado de habilidad en Mercado Público", tipo: "acopio" },
];

/**
 * Drive rechaza "/" en el nombre y topea en 255 bytes. Varios documentos vienen descritos con su
 * contenido completo ("Propuesta de curso en formato PDF: objetivo principal, …"), así que se
 * recorta en el último espacio antes del tope: un corte a mitad de palabra se lee como un error.
 * El nombre largo íntegro vive en el catálogo; acá solo hace falta reconocer la carpeta.
 */
const MAX_NOMBRE = 100;

export function nombreCarpeta(doc: DocumentoOferta): string {
  const limpio = doc.documento.replace(/[/\\]/g, "-").replace(/\s+/g, " ").trim();
  const cuerpo =
    limpio.length <= MAX_NOMBRE
      ? limpio
      : `${limpio.slice(0, limpio.lastIndexOf(" ", MAX_NOMBRE) + 1 || MAX_NOMBRE).trimEnd()}…`;
  return `${doc.prefijo} - ${cuerpo}`;
}

/** El prefijo `NN` con que se empareja un entregable con su carpeta. */
export function prefijoDe(nombre: string): string | null {
  const m = /^(\d{2})\s*-\s/.exec(nombre.trim());
  return m ? m[1]! : null;
}

/**
 * Acepta las dos formas de `documentos_obligatorios_oferta`: el `string[]` histórico y el
 * `{documento, tipo}[]` de ahora. Un string suelto entra como `acopio` —el tipo que nunca
 * genera nada— para que una entrada sin migrar no produzca un documento inventado.
 */
export type EntradaDocumento =
  | string
  | { documento: string; tipo?: TipoDocumento; plantilla?: string };

export function normalizarDocumentos(
  entradas: readonly EntradaDocumento[],
  provisional: boolean,
): DocumentoOferta[] {
  return entradas.map((e, i) => {
    const crudo = typeof e === "string" ? { documento: e } : e;
    return {
      n: i + 1,
      prefijo: String(i + 1).padStart(2, "0"),
      documento: crudo.documento,
      tipo: crudo.tipo ?? "acopio",
      plantilla: typeof e === "string" ? undefined : e.plantilla,
      provisional,
    };
  });
}

/** Vía preferida: la lista curada a mano desde el TDR. */
export function catalogoDesdeCapacitacion(
  codigo: string,
  req: RequisitosCapacitacion,
): CatalogoDocumentos {
  return {
    codigo,
    documentos: normalizarDocumentos(req.documentos_obligatorios_oferta, false),
    fuente: "capacitaciones.json",
    provisional: false,
  };
}

/**
 * Vía automática: lo que `extraerCondiciones()` alcanzó a detectar en el texto de la compra.
 * Todo entra como `acopio` — el detector reconoce nombres de documentos, no su naturaleza.
 */
export function catalogoDesdeCondiciones(
  codigo: string,
  cond: Condiciones,
): CatalogoDocumentos | null {
  const nombres = [
    ...cond.documentos_exigidos,
    ...cond.acreditaciones_exigidas.map((a) => `Acreditación: ${a.replace(/_/g, " ")}`),
  ];
  if (nombres.length === 0) return null;
  return {
    codigo,
    documentos: normalizarDocumentos(nombres, true),
    fuente: "condiciones.json",
    provisional: true,
  };
}

function leerCondiciones(codigo: string): Condiciones | null {
  const p = path.join(ROOT_DIR, "data", codigo, "condiciones.json");
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf-8")) as Condiciones;
  } catch {
    return null;
  }
}

/**
 * El catálogo de una oportunidad, en orden de preferencia: la ficha curada, lo detectado por el
 * radar, y recién al final un set base. Nunca devuelve vacío: una oportunidad sin documentos
 * exigidos no existe, y una lista vacía se leería como "no falta nada".
 */
export function catalogoDeOportunidad(
  codigo: string,
  req?: RequisitosCapacitacion,
): CatalogoDocumentos {
  if (req) return catalogoDesdeCapacitacion(codigo, req);
  const cond = leerCondiciones(codigo);
  if (cond) {
    const desdeCondiciones = catalogoDesdeCondiciones(codigo, cond);
    if (desdeCondiciones) return desdeCondiciones;
  }
  return {
    codigo,
    documentos: normalizarDocumentos(CATALOGO_BASE, true),
    fuente: "base",
    provisional: true,
  };
}

export function resumenCatalogo(cat: CatalogoDocumentos): string {
  const porTipo = new Map<TipoDocumento, number>();
  for (const d of cat.documentos) porTipo.set(d.tipo, (porTipo.get(d.tipo) ?? 0) + 1);
  const partes = [...porTipo.entries()].map(([t, n]) => `${n} ${GLOSA_TIPO[t].toLowerCase()}`);
  return `${cat.documentos.length} documento(s): ${partes.join(", ")}`;
}
