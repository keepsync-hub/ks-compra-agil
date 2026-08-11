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
  contacto: {
    nombre: string;
    email: string;
    telefono?: string;
  };
  pricing: {
    moneda_lista: "USD";
    margen_pct: number;
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

export function loadMarcasConfig(): MarcasConfig {
  const p = path.join(ROOT_DIR, "config", "marcas.json");
  return JSON.parse(readFileSync(p, "utf-8")) as MarcasConfig;
}
