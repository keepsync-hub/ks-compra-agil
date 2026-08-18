/**
 * Medición pasiva de la cuota diaria de la API (ver PLAN-VOLUMEN.md, Fase 0): nadie midió nunca
 * el límite exacto, solo se sabe que existe (429 + Retry-After). Método: instrumentar cada
 * request, y cuando llegue el primer 429 del día, el ledger dice cuántas requests se hicieron.
 * Pasivo a propósito — sondear activamente hasta agotar la cuota quemaría el radar de ese día.
 *
 * También actúa como circuit breaker LOCAL por corrida: cada script declara un presupuesto
 * (`configurarCuota`) y `contarRequest()` corta antes de superarlo, para que un script nuevo
 * (indexar, informe) no pueda comerse el presupuesto del radar diario.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import path from "node:path";
import { ROOT_DIR } from "./config.js";
import { formatearEnChile } from "./tiempo.js";

const CUOTA_DIR = path.join(ROOT_DIR, "data", "cuota");
const LEDGER_HISTORICO_PATH = path.join(ROOT_DIR, "historico", "cuota.jsonl");

export interface LedgerDia {
  fecha: string; // AAAA-MM-DD, hora de Chile
  total_requests: number;
  por_script: Record<string, number>;
  hubo_429: boolean;
  requests_hasta_429: number | null;
  retry_after: string | null;
}

export class CuotaLocalAgotadaError extends Error {
  constructor(script: string, maxRequests: number) {
    super(
      `El script "${script}" alcanzó su presupuesto local de ${maxRequests} requests en esta corrida. ` +
        `Corte preventivo para no arriesgar la cuota diaria real (aún sin medir con precisión) — no es un ` +
        `error de la API. Ver PLAN-VOLUMEN.md, Fase 0/6.`,
    );
    this.name = "CuotaLocalAgotadaError";
  }
}

function fechaChileHoy(): string {
  // formatearEnChile da "AAAA-MM-DD HH:mm (hora de Chile)"; solo interesa la fecha.
  return formatearEnChile(new Date()).slice(0, 10);
}

function ledgerPath(fecha: string): string {
  return path.join(CUOTA_DIR, `${fecha}.json`);
}

function ledgerVacio(fecha: string): LedgerDia {
  return { fecha, total_requests: 0, por_script: {}, hubo_429: false, requests_hasta_429: null, retry_after: null };
}

function leerLedgerHoy(): LedgerDia {
  const fecha = fechaChileHoy();
  const p = ledgerPath(fecha);
  if (!existsSync(p)) return ledgerVacio(fecha);
  try {
    const l = JSON.parse(readFileSync(p, "utf-8")) as LedgerDia;
    return l.fecha === fecha ? l : ledgerVacio(fecha);
  } catch {
    return ledgerVacio(fecha);
  }
}

function guardarLedgerHoy(l: LedgerDia): void {
  mkdirSync(CUOTA_DIR, { recursive: true });
  writeFileSync(ledgerPath(l.fecha), JSON.stringify(l, null, 2), "utf-8");
}

/** Cierra el día en el rollup versionado (`historico/cuota.jsonl`) — una línea por día, append-only. */
function anexarRollup(l: LedgerDia): void {
  mkdirSync(path.dirname(LEDGER_HISTORICO_PATH), { recursive: true });
  appendFileSync(LEDGER_HISTORICO_PATH, JSON.stringify(l) + "\n", "utf-8");
}

let scriptActual: string | null = null;
let maxRequestsActual = Infinity;
let requestsEnEstaCorrida = 0;

/** Cada script la llama una vez al arrancar, antes del primer fetch. */
export function configurarCuota(opts: { script: string; maxRequests: number }): void {
  scriptActual = opts.script;
  maxRequestsActual = opts.maxRequests;
  requestsEnEstaCorrida = 0;
}

/** La llama `apiGet` antes de cada fetch. Lanza `CuotaLocalAgotadaError` si supera el presupuesto de esta corrida. */
export function contarRequest(): void {
  requestsEnEstaCorrida++;
  if (requestsEnEstaCorrida > maxRequestsActual) {
    throw new CuotaLocalAgotadaError(scriptActual ?? "desconocido", maxRequestsActual);
  }
  const script = scriptActual ?? "desconocido";
  const l = leerLedgerHoy();
  l.total_requests++;
  l.por_script[script] = (l.por_script[script] ?? 0) + 1;
  guardarLedgerHoy(l);
}

/** La llama `apiGet` en la rama 429, antes de lanzar el error al caller. */
export function registrar429(retryAfter: string | null): void {
  const l = leerLedgerHoy();
  if (!l.hubo_429) {
    l.hubo_429 = true;
    l.requests_hasta_429 = l.total_requests;
    l.retry_after = retryAfter;
    guardarLedgerHoy(l);
    anexarRollup(l); // el día queda "cerrado" con el dato más valioso: cuántas requests hicieron falta.
  }
}

export function ledgerHoy(): LedgerDia {
  return leerLedgerHoy();
}

/** ¿Ya corrió `radar` hoy? Usado por scripts no-radar para respetar la reserva prioritaria. */
export function radarYaCorrioHoy(): boolean {
  return (leerLedgerHoy().por_script["radar"] ?? 0) > 0;
}

function leerRollup(): LedgerDia[] {
  if (!existsSync(LEDGER_HISTORICO_PATH)) return [];
  return readFileSync(LEDGER_HISTORICO_PATH, "utf-8")
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as LedgerDia);
}

export interface ResumenCuota {
  /** max(total_requests) de días SIN 429 — cota inferior confiable del límite diario. */
  cota_inferior: number | null;
  /** min(requests_hasta_429) de días CON 429 — cota superior. */
  cota_superior: number | null;
  dias_observados: number;
}

/** Convergencia pasiva del límite diario a partir del rollup histórico. Ver cabecera del archivo. */
export function resumenCuota(): ResumenCuota {
  const dias = leerRollup();
  const sinLimite = dias.filter((d) => !d.hubo_429).map((d) => d.total_requests);
  const conLimite = dias.filter((d) => d.hubo_429 && d.requests_hasta_429 != null).map((d) => d.requests_hasta_429!);
  return {
    cota_inferior: sinLimite.length > 0 ? Math.max(...sinLimite) : null,
    cota_superior: conLimite.length > 0 ? Math.min(...conLimite) : null,
    dias_observados: dias.length,
  };
}
