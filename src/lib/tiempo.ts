/**
 * Manejo de fechas en la zona horaria de Chile continental (America/Santiago).
 *
 * La API de Compra Ágil entrega `fecha_cierre` como "AAAA-MM-DD HH:mm" SIN zona horaria, pero el
 * portal las expresa en hora de Chile. Interpretarlas como hora local del proceso (que en el
 * sandbox es UTC) adelantaba el cierre hasta 3–4 horas y hacía descartar oportunidades aún
 * abiertas. Chile cambia de huso (UTC-4 en invierno, UTC-3 en verano por horario de verano), así
 * que no se puede hardcodear el offset: se calcula con Intl para la fecha concreta.
 */

const TZ_CHILE = "America/Santiago";

/** Offset (ms) de una zona horaria respecto de UTC en el instante dado. */
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
  const hora = p.hour === "24" ? "00" : (p.hour ?? "00"); // Intl puede devolver "24" a medianoche
  const comoUtc = Date.UTC(+p.year!, +p.month! - 1, +p.day!, +hora, +p.minute!, +p.second!);
  return comoUtc - instante.getTime();
}

/**
 * Convierte una hora de pared de Chile ("AAAA-MM-DD HH:mm[:ss]") al instante UTC correcto,
 * respetando el horario de verano vigente en esa fecha. Devuelve null si el formato no calza.
 */
export function fechaChileAUtc(fechaHora: string): Date | null {
  const m = fechaHora.trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  const guessUtc = Date.UTC(+y!, +mo! - 1, +d!, +h!, +mi!, s ? +s : 0);
  // Una iteración basta salvo en el salto de DST; suficiente para comparar cierres.
  const off = offsetZonaMs(new Date(guessUtc), TZ_CHILE);
  return new Date(guessUtc - off);
}

/** Instante "ahora" (UTC real; independiente de la zona del proceso). */
export function ahora(): Date {
  return new Date();
}

/**
 * ¿Ya pasó el cierre, evaluado en hora de Chile? Si la fecha no parsea, se considera NO cerrada
 * (mejor dejar pasar a validaciones posteriores que descartar por un formato inesperado).
 */
export function cierreYaPaso(fechaCierre: string, referencia: Date = ahora()): boolean {
  const cierre = fechaChileAUtc(fechaCierre);
  if (!cierre) return false;
  return cierre.getTime() < referencia.getTime();
}

/** Formatea un instante en hora de Chile para mostrar (ej. "2026-08-13 15:40 (hora de Chile)"). */
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
