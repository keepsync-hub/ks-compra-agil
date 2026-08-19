import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import "dotenv/config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** licitaciones/src/lib -> licitaciones/ */
export const LIC_ROOT_DIR = path.resolve(__dirname, "..", "..");

export function getApiTicket(): string {
  const ticket = process.env.LICITACIONES_API_TICKET;
  if (!ticket) {
    throw new Error(
      "Falta LICITACIONES_API_TICKET en el entorno. Ponlo en .env (ver .env.example). Es un ticket " +
        "DISTINTO de COMPRA_AGIL_API_TICKET: la API clásica de Licitaciones (api.mercadopublico.cl) " +
        "usa su propio sistema de tickets, que se solicita en https://www.mercadopublico.cl/Home/Api " +
        "(no sirve el ticket de Compra Ágil, que es para api2.mercadopublico.cl). Nunca lo hardcodees.",
    );
  }
  return ticket;
}

export interface ItemPricingLicitaciones {
  nombre: string;
  /** Costo real que paga KeepSync (no precio de lista público — acá no existe tal cosa). */
  costo_clp: number;
  unidad: "usuario_mes" | "hora" | "documento" | "proyecto" | "mensual" | "gb";
  notas?: string;
}

export interface CompanyConfigLicitaciones {
  razon_social: string;
  rut: string;
  es_emt: true;
  giro?: string;
  direccion?: string;
  representante_legal?: string;
  /**
   * false mientras razon_social/rut/direccion/representante_legal no estén confirmados. El
   * generador de PDF/PPTX marca el documento como BORRADOR mientras esto sea false.
   */
  identidad_confirmada: boolean;
  contacto: {
    nombre: string;
    email: string;
    telefono?: string;
  };
  pricing: {
    moneda: "CLP";
    markup_pct: number;
    iva_pct: number;
    /**
     * Catálogo de ítems de costo real (no hay precio de lista público como en Compra Ágil de
     * licencias Claude: acá KeepSync define su propio catálogo de servicios/licencias de
     * gestión documental). Cada ítem se cotiza como costo_clp × (1+markup) × (1+iva).
     */
    items: Record<string, ItemPricingLicitaciones>;
  };
  documentos_estandar?: string[];
}

const COMPANY_CONFIG_PATH = path.join(LIC_ROOT_DIR, "config", "company.json");
const COMPANY_CONFIG_EXAMPLE_PATH = path.join(LIC_ROOT_DIR, "config", "company.json.example");

export function loadCompanyConfig(): CompanyConfigLicitaciones {
  if (!existsSync(COMPANY_CONFIG_PATH)) {
    throw new Error(
      `Falta licitaciones/config/company.json con datos reales de la empresa y el catálogo de costos. ` +
        `Copia ${COMPANY_CONFIG_EXAMPLE_PATH} y completa RUT, razón social y costos reales de los ` +
        `servicios/licencias de gestión documental que KeepSync efectivamente puede proveer. El agente ` +
        `no inventa precios.`,
    );
  }
  const raw = readFileSync(COMPANY_CONFIG_PATH, "utf-8");
  if (/COMPLETAR/.test(raw)) {
    throw new Error(
      `licitaciones/config/company.json todavía tiene placeholders sin completar ("COMPLETAR"). No usar ` +
        `para cotizar hasta reemplazarlos con datos reales (RUT, razón social, contacto, y sobre todo el ` +
        `catálogo de costos: acá no hay precio de lista público que copiar, como sí existe para licencias ` +
        `Claude — son los costos reales de KeepSync para proveer/implementar gestión documental).`,
    );
  }
  return JSON.parse(raw) as CompanyConfigLicitaciones;
}

/**
 * Una categoría del catálogo de servicios de Array (http://www.array.cl/) tal como se busca en
 * licitaciones. Mismo contrato que `config/array-servicios.json` (Compra Ágil), con los patrones
 * adaptados a la redacción de bases de licitación.
 */
export interface CategoriaKeyword {
  id: string;
  nombre: string;
  descripcion_array?: string;
  /** Regex (string, case-insensitive al compilar) que descubre la licitación. */
  patron_mencion: string;
  /**
   * Textos que se le piden al buscador público del portal (`buscador-portal.ts`), que sí filtra
   * por texto en el servidor. Es el barrido grueso; la precisión la pone `patron_mencion`.
   */
  consultas_portal?: string[];
  /** Contexto donde `patron_mencion` acierta la palabra pero se equivoca de rubro (ej. "RPA" = dron). */
  patron_excluyente?: string;
}

export interface KeywordsConfig {
  categorias: CategoriaKeyword[];
}

export function loadKeywordsConfig(): KeywordsConfig {
  const p = path.join(LIC_ROOT_DIR, "config", "keywords.json");
  return JSON.parse(readFileSync(p, "utf-8")) as KeywordsConfig;
}

/**
 * Un término agregado a mano (desde la página publicada o desde `npm run keywords-licitaciones`).
 * Es una frase literal, no una regex: quien la escribe no tiene por qué saber de expresiones
 * regulares, y una regex mal formada rompería el radar entero.
 */
export interface TerminoExtra {
  /** `id` de una categoría de keywords.json, o `"otros"`. */
  categoria: string;
  termino: string;
  /** ISO corto de cuándo se agregó. Solo informativo. */
  agregado?: string;
}

export interface KeywordsExtraConfig {
  terminos: TerminoExtra[];
}

export const KEYWORDS_EXTRA_PATH = path.join(LIC_ROOT_DIR, "config", "keywords-extra.json");

/** Overlay opcional: si el archivo no está o no parsea, el radar sigue con las categorías base. */
export function loadKeywordsExtra(): KeywordsExtraConfig {
  if (!existsSync(KEYWORDS_EXTRA_PATH)) return { terminos: [] };
  try {
    const datos = JSON.parse(readFileSync(KEYWORDS_EXTRA_PATH, "utf-8")) as Partial<KeywordsExtraConfig>;
    const terminos = (datos.terminos ?? []).filter(
      (t): t is TerminoExtra => typeof t?.categoria === "string" && typeof t?.termino === "string" && t.termino.trim() !== "",
    );
    return { terminos };
  } catch {
    return { terminos: [] };
  }
}
