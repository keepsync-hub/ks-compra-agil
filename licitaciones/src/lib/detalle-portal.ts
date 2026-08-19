/**
 * Reconstruye una ficha equivalente a la de la API (`LicitacionDetalle`) **desde la ficha pública
 * del portal**, que se baja sin ticket, sin cuota y sin login (ver `portal-ficha.ts`).
 *
 * Por qué existe: la cuota del `LICITACIONES_API_TICKET` es muy escasa —se agota en la segunda
 * corrida del mismo día, y el 2026-08-19 se agotó apenas después del listado nacional—, y sin
 * `detalle.json` el radar no tenía con qué armar una tarjeta: ni organismo, ni tope, ni tipo. Todo
 * eso está en las secciones 1, 2, 3 y 7 de la ficha pública, que ya se descargan para los
 * antecedentes. Con esto, la única llamada indispensable a la API es la del listado.
 *
 * Lo que NO se puede reconstruir se deja fuera en vez de inventarse: `CantidadReclamos` (reclamos
 * recibidos por el organismo) solo existe en la API, y el `Nombre` del portal viene truncado igual
 * que en el listado — por eso la `Descripcion`, que sí llega completa, es el texto que describe
 * de verdad el objeto de la licitación.
 */
import type { LicitacionDetalle } from "./api.js";
import type { AntecedentesLicitacion, SeccionFicha } from "./portal-ficha.js";

/** Etiqueta ("Razón social:") seguida del valor en la línea siguiente, tal como emite el portal. */
function campo(seccion: SeccionFicha | undefined, etiqueta: RegExp): string | undefined {
  if (!seccion) return undefined;
  const lineas = seccion.texto
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const i = lineas.findIndex((l) => etiqueta.test(l));
  if (i === -1) return undefined;
  const propia = lineas[i] ?? "";
  const dosPuntos = propia.indexOf(":");
  const valor = (dosPuntos >= 0 ? propia.slice(dosPuntos + 1).trim() : "") || lineas[i + 1]?.trim();
  if (!valor || /^(no hay|sin) informaci/i.test(valor)) return undefined;
  return valor;
}

function seccion(a: AntecedentesLicitacion, numero: number): SeccionFicha | undefined {
  return a.secciones.find((s) => s.numero === numero);
}

/** "21-08-2026 15:00:00" -> "2026-08-21T15:00:00" (el formato que usa la API y espera la página). */
function fechaChilena(valor: string | undefined): string | undefined {
  const m = valor?.match(/(\d{2})-(\d{2})-(\d{4})(?:\s+(\d{2}):(\d{2}))?/);
  if (!m) return undefined;
  const [, d, mes, anio, hh = "00", mm = "00"] = m;
  return `${anio}-${mes}-${d}T${hh}:${mm}:00`;
}

/**
 * "Pública-Licitación Pública igual o superior a 100 UTM e inferior a 1.000 UTM (LE)" -> "LE".
 * El código entre paréntesis es el mismo `Tipo` de la API (tabla 3.1 del diccionario), que la
 * página traduce a su glosa por monto en UTM.
 */
function codigoTipo(glosa: string | undefined): string | undefined {
  return glosa?.match(/\(([A-Z][A-Z0-9])\)\s*$/)?.[1];
}

/** El portal escribe la moneda en glosa; la API usa el código, que es lo que muestra la tarjeta. */
function codigoMoneda(glosa: string | undefined): string | undefined {
  if (!glosa) return undefined;
  if (/peso\s+chileno/i.test(glosa)) return "CLP";
  if (/d[oó]lar/i.test(glosa)) return "USD";
  if (/unidad\s+de\s+fomento|\buf\b/i.test(glosa)) return "UF";
  if (/euro/i.test(glosa)) return "EUR";
  return glosa;
}

/** "12 Meses" -> {cantidad: 12, unidad: 4}, con los códigos de la tabla 3.6 del diccionario. */
function duracionContrato(valor: string | undefined): { cantidad: number; unidad: number } | undefined {
  const m = valor?.match(/(\d+)\s*(hora|d[ií]a|semana|mes|añ?o)/i);
  if (!m?.[1] || !m[2]) return undefined;
  const unidades: Record<string, number> = { hora: 1, dia: 2, día: 2, semana: 3, mes: 4, ano: 5, año: 5 };
  const unidad = unidades[m[2].toLowerCase()];
  return unidad ? { cantidad: Number(m[1]), unidad } : undefined;
}

/** Marca de origen en la ficha reconstruida: la tarjeta y el reporte distinguen una de la otra. */
export const FUENTE_PORTAL = "ficha-portal";

export function detalleDesdeAntecedentes(a: AntecedentesLicitacion): LicitacionDetalle {
  const s1 = seccion(a, 1);
  const s2 = seccion(a, 2);
  const s3 = seccion(a, 3);
  const s7 = seccion(a, 7);

  const cierre = fechaChilena(campo(s3, /^Fecha de cierre de recepci[oó]n/i));
  const montoTexto = campo(s7, /^Monto Total Estimado/i);
  const monto = montoTexto ? Number(montoTexto.replace(/[^\d]/g, "")) : NaN;
  const duracion = duracionContrato(campo(s7, /^Tiempo del Contrato/i));

  return {
    CodigoExterno: a.codigo,
    Nombre: campo(s1, /^Nombre de la licitaci[oó]n/i) ?? a.codigo,
    Descripcion: campo(s1, /^Descripci[oó]n/i),
    Estado: campo(s1, /^Estado/i),
    Tipo: codigoTipo(campo(s1, /^Tipo de licitaci[oó]n/i)),
    Moneda: codigoMoneda(campo(s1, /^Moneda/i)),
    MontoEstimado: Number.isFinite(monto) && monto > 0 ? monto : undefined,
    FechaCierre: cierre,
    Fechas: {
      FechaPublicacion: fechaChilena(campo(s3, /^Fecha de Publicaci[oó]n/i)),
      FechaCierre: cierre,
      FechaActoAperturaTecnica: fechaChilena(campo(s3, /^Fecha de acto de apertura t[eé]cnica/i)),
      FechaAdjudicacion: fechaChilena(campo(s3, /^Fecha de Adjudicaci[oó]n/i)),
    },
    Comprador: {
      NombreOrganismo: campo(s2, /^Raz[oó]n social/i),
      NombreUnidad: campo(s2, /^Unidad de compra/i),
      RutUnidad: campo(s2, /^R\.?U\.?T\.?/i),
      DireccionUnidad: campo(s2, /^Direcci[oó]n/i),
      ComunaUnidad: campo(s2, /^Comuna/i),
      RegionUnidad: campo(s2, /^Regi[oó]n en que se genera/i),
    },
    TiempoDuracionContrato: duracion?.cantidad,
    UnidadTiempoDuracionContrato: duracion?.unidad,
    _fuente: FUENTE_PORTAL,
  };
}
