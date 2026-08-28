import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import "dotenv/config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = path.resolve(__dirname, "..", "..");

export function getApiTicket(): string {
  const ticket = process.env.COMPRA_AGIL_API_TICKET;
  if (!ticket) {
    throw new Error(
      "Falta COMPRA_AGIL_API_TICKET en el entorno. Ponlo en .env (ver .env.example) — nunca lo hardcodees.",
    );
  }
  return ticket;
}

export interface CompanyConfig {
  razon_social: string;
  rut: string;
  es_emt: true;
  giro?: string;
  direccion?: string;
  representante_legal?: string;
  /**
   * false mientras razon_social/rut/direccion/representante_legal no estén confirmados con
   * KeepSync. cotizacion-pptx.ts marca el documento como BORRADOR mientras esto sea false —
   * no es apto para enviar a un organismo comprador aunque el precio ya sea real.
   */
  identidad_confirmada: boolean;
  contacto: {
    nombre: string;
    email: string;
    telefono?: string;
  };
  pricing: {
    moneda_lista: "USD";
    /**
     * Se usa hoy solo para mostrar el rótulo "IVA {iva_pct}%" en la cotización de Array
     * (`array-cotizacion.ts`, regla del 80% del presupuesto, no la de licencias Claude). La
     * fórmula de licencias Claude (`cotizarLinea`) ya no lee este campo ni `markup_pct`: son
     * parte fija de la regla en `src/lib/pricing-usd.ts` (5,5% de recargo de tipo de cambio, 19%
     * de impuesto no recuperable, 15% de markup, 19% de IVA de venta), no un parámetro por
     * empresa.
     */
    iva_pct: number;
    fx_fuente: string;
    fx_fallback_clp_por_usd: number;
    planes: Record<
      string,
      {
        nombre: string;
        precio_lista_usd_mes: number;
        facturacion: "mensual" | "anual";
        notas?: string;
      }
    >;
  };
  documentos_estandar?: string[];
}

const COMPANY_CONFIG_PATH = path.join(ROOT_DIR, "config", "company.json");
const COMPANY_CONFIG_EXAMPLE_PATH = path.join(ROOT_DIR, "config", "company.json.example");

export function loadCompanyConfig(): CompanyConfig {
  if (!existsSync(COMPANY_CONFIG_PATH)) {
    throw new Error(
      `Falta config/company.json con datos reales de la empresa. Copia ${COMPANY_CONFIG_EXAMPLE_PATH} y completa RUT, razón social y pricing real. El agente no inventa precios.`,
    );
  }
  const raw = readFileSync(COMPANY_CONFIG_PATH, "utf-8");
  if (/COMPLETAR/.test(raw)) {
    throw new Error(
      `config/company.json todavía tiene placeholders sin completar ("COMPLETAR"). No usar para cotizar ni ofertar ` +
        `hasta reemplazarlos con los datos reales de la empresa (RUT, razón social, contacto, etc.).`,
    );
  }
  return JSON.parse(raw) as CompanyConfig;
}

export interface MarcasConfig {
  variantes: string[];
}

/**
 * Deriva de config/categorias.json (categoría "claude") en vez de config/marcas.json, que se
 * eliminó — ver PLAN-VOLUMEN.md, Fase 1. Lee el JSON directo (sin pasar por src/lib/categorias.ts)
 * a propósito, para no crear un import circular: categorias.ts ya depende de este módulo (ROOT_DIR).
 */
export function loadMarcasConfig(): MarcasConfig {
  const p = path.join(ROOT_DIR, "config", "categorias.json");
  const raw = JSON.parse(readFileSync(p, "utf-8")) as { categorias: { id: string; variantes_q: string[] }[] };
  const claude = raw.categorias.find((c) => c.id === "claude");
  if (!claude) throw new Error(`config/categorias.json no tiene una categoría con id "claude".`);
  return { variantes: claude.variantes_q };
}
