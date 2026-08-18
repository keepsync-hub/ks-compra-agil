/**
 * Manejo de fechas en la zona horaria de Chile continental (America/Santiago).
 *
 * Duplicado de `src/lib/tiempo.ts` (raíz) sin cambios — es lógica genérica de zona horaria, no
 * específica de Compra Ágil, y esta carpeta se mantiene autocontenida a propósito.
 */

const TZ_CHILE = "America/Santiago";

function offsetZonaMs(instante: Date, tz: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const p = Object.fromEntries(dtf.formatToParts(instante).map((x) => [x.type, x.value])) as Record<string, string>;
  const hora = p.hour === "24" ? "00" : (p.hour ?? "00");
  const comoUtc = Date.UTC(+p.year!, +p.month! - 1, +p.day!, +hora, +p.minute!, +p.second!);
  return comoUtc - instante.getTime();
}

export function fechaChileAUtc(fechaHora: string): Date | null {
  const m = fechaHora.trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  const guessUtc = Date.UTC(+y!, +mo! - 1, +d!, +h!, +mi!, s ? +s : 0);
  const off = offsetZonaMs(new Date(guessUtc), TZ_CHILE);
  return new Date(guessUtc - off);
}

export function ahora(): Date {
  return new Date();
}

export function cierreYaPaso(fechaCierre: string, referencia: Date = ahora()): boolean {
  const cierre = fechaChileAUtc(fechaCierre);
  if (!cierre) return false;
  return cierre.getTime() < referencia.getTime();
}

export function formatearEnChile(instante: Date): string {
  const dtf = new Intl.DateTimeFormat("es-CL", {
    timeZone: TZ_CHILE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const p = Object.fromEntries(dtf.formatToParts(instante).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute} (hora de Chile)`;
}
