/**
 * Inteligencia de mercado sobre el índice histórico (ver PLAN-VOLUMEN.md, Fase 3). Cero requests:
 * todo se calcula leyendo `historico/observaciones.jsonl`, ya versionado. Es la respuesta directa
 * a lo que plataformas como Licify venden como "analítica" (monto promedio/mediano, competencia,
 * tasa de fracaso, recompradores) — acá sale gratis porque ya se paga la cuota para capturarlo.
 *
 * Honestidad de tamaño de muestra obligatoria: con pocos casos observados, `percentiles()` y las
 * tasas siguen siendo aritméticamente correctas pero no representativas — quien consuma esto
 * (`digest.ts`, `docs/`) debe mostrar `n` junto a cada cifra, nunca la cifra sola.
 */
import { leer, ultimaPorCodigo, type Observacion } from "./indice.js";
import { clasificarMotivo, type CategoriaMotivo } from "./motivos.js";
import { fechaChileAUtc } from "./tiempo.js";

export interface Percentiles {
  p25: number;
  mediana: number;
  p75: number;
}

/** Percentil lineal simple (interpolado). Devuelve null sobre lista vacía. */
export function percentiles(valores: number[]): Percentiles | null {
  if (valores.length === 0) return null;
  const ordenados = [...valores].sort((a, b) => a - b);
  const en = (p: number): number => {
    const idx = (ordenados.length - 1) * p;
    const lo = Math.floor(idx);
    const hi = Math.ceil(idx);
    if (lo === hi) return ordenados[lo]!;
    return ordenados[lo]! + (ordenados[hi]! - ordenados[lo]!) * (idx - lo);
  };
  return { p25: en(0.25), mediana: en(0.5), p75: en(0.75) };
}

const ESTADOS_FRACASO = new Set(["desierta", "cancelada"]);
const ESTADOS_TERMINALES = new Set(["desierta", "cancelada", "cerrada", "proveedor_seleccionado"]);

export interface MetricasCategoria {
  categoria: string;
  n_observados: number; // códigos únicos en el índice (cualquier estado)
  n_con_desenlace: number; // en estado terminal
  distribucion_estados: Record<string, number>;
  tasa_fracaso_pct: number | null; // (desierta+cancelada) / con_desenlace, null si n_con_desenlace=0
  monto: Percentiles | null;
  monto_n: number;
  competencia_mediana: number | null; // mediana de total_ofertas_recibidas entre los con desenlace
  organismos_recompradores: number; // organismos (RUT) con >=2 códigos distintos en el índice
  motivos: Record<CategoriaMotivo, number>; // solo sobre los fracasos (desierta/cancelada)
}

/** Métricas agregadas de una categoría (o de todas, si se omite) sobre el índice histórico. */
export function calcularMetricas(categoria?: string): MetricasCategoria {
  const lista = [...ultimaPorCodigo(leer(categoria ? { categoria } : undefined)).values()];
  const conDesenlace = lista.filter((o) => ESTADOS_TERMINALES.has(o.estado));
  const fracasos = conDesenlace.filter((o) => ESTADOS_FRACASO.has(o.estado));

  const distribucion: Record<string, number> = {};
  for (const o of lista) distribucion[o.estado] = (distribucion[o.estado] ?? 0) + 1;

  const porOrganismo = new Map<string, number>();
  for (const o of lista) porOrganismo.set(o.rut, (porOrganismo.get(o.rut) ?? 0) + 1);

  const motivos: Record<CategoriaMotivo, number> = { comprador: 0, precio: 0, tecnico: 0, administrativo: 0, sin_info: 0 };
  for (const o of fracasos) {
    const texto = o.estado === "desierta" ? o.motivo_desierta : o.motivo_cancelacion;
    motivos[clasificarMotivo(texto).categoria]++;
  }

  const montos = lista.map((o) => o.monto_disponible_clp).filter((m) => m > 0);

  return {
    categoria: categoria ?? "(todas)",
    n_observados: lista.length,
    n_con_desenlace: conDesenlace.length,
    distribucion_estados: distribucion,
    tasa_fracaso_pct: conDesenlace.length > 0 ? (fracasos.length / conDesenlace.length) * 100 : null,
    monto: percentiles(montos),
    monto_n: montos.length,
    competencia_mediana: percentiles(conDesenlace.map((o) => o.total_ofertas_recibidas))?.mediana ?? null,
    organismos_recompradores: [...porOrganismo.values()].filter((n) => n >= 2).length,
    motivos,
  };
}

export interface RepublicacionOrganismo {
  rut: string;
  organismo: string;
  intervalos_dias: number[]; // entre publicaciones consecutivas del mismo organismo, códigos distintos
}

/**
 * Intervalos reales (en días) entre republicaciones de un mismo organismo (mismo RUT), ordenadas
 * por fecha de publicación. Base para `ventanaRepublicacionEstimada` — con pocos organismos
 * recompradores en el índice todavía, esta lista puede estar vacía; eso es correcto, no un bug.
 */
export function intervalosRepublicacion(categoria?: string): RepublicacionOrganismo[] {
  const obs = leer(categoria ? { categoria } : undefined);
  const porOrganismo = new Map<string, Observacion[]>();
  for (const o of obs) {
    const lista = porOrganismo.get(o.rut) ?? [];
    lista.push(o);
    porOrganismo.set(o.rut, lista);
  }

  const resultado: RepublicacionOrganismo[] = [];
  for (const [rut, items] of porOrganismo) {
    const porCodigo = [...ultimaPorCodigo(items).values()].sort((a, b) =>
      a.fecha_publicacion.localeCompare(b.fecha_publicacion),
    );
    if (porCodigo.length < 2) continue;
    const intervalos: number[] = [];
    for (let i = 1; i < porCodigo.length; i++) {
      const anterior = fechaChileAUtc(porCodigo[i - 1]!.fecha_publicacion);
      const actual = fechaChileAUtc(porCodigo[i]!.fecha_publicacion);
      if (anterior && actual) intervalos.push((actual.getTime() - anterior.getTime()) / 86_400_000);
    }
    if (intervalos.length > 0) resultado.push({ rut, organismo: porCodigo[0]!.organismo, intervalos_dias: intervalos });
  }
  return resultado;
}

/** Percentiles de los intervalos de republicación observados. Null si aún no hay ningún par medible. */
export function ventanaRepublicacionEstimada(categoria?: string): Percentiles | null {
  return percentiles(intervalosRepublicacion(categoria).flatMap((r) => r.intervalos_dias));
}

export interface PerfilOrganismo {
  rut: string;
  organismo: string;
  n_procesos: number; // códigos únicos en el índice
  n_con_desenlace: number;
  tasa_fracaso_pct: number | null;
  monto: Percentiles | null;
  motivos: Record<CategoriaMotivo, number>;
  ultimo_fracaso: Observacion | null; // el fracaso terminal más reciente, si lo hay
}

/**
 * Perfil por organismo comprador (RUT) — la respuesta directa, con datos propios, a lo que
 * plataformas como Licify venden como "perfil de comprador": acá sale del índice histórico ya
 * versionado, cero requests, y solo para organismos con >=2 códigos observados (si aparece una
 * sola vez todavía no hay historial que perfilar).
 */
export function perfilesOrganismosRecompradores(categoria?: string): PerfilOrganismo[] {
  const lista = [...ultimaPorCodigo(leer(categoria ? { categoria } : undefined)).values()];
  const porOrganismo = new Map<string, Observacion[]>();
  for (const o of lista) {
    const l = porOrganismo.get(o.rut) ?? [];
    l.push(o);
    porOrganismo.set(o.rut, l);
  }

  const perfiles: PerfilOrganismo[] = [];
  for (const [rut, items] of porOrganismo) {
    if (items.length < 2) continue;
    const conDesenlace = items.filter((o) => ESTADOS_TERMINALES.has(o.estado));
    const fracasos = conDesenlace.filter((o) => ESTADOS_FRACASO.has(o.estado));
    const motivos: Record<CategoriaMotivo, number> = { comprador: 0, precio: 0, tecnico: 0, administrativo: 0, sin_info: 0 };
    for (const o of fracasos) motivos[clasificarMotivo(o.estado === "desierta" ? o.motivo_desierta : o.motivo_cancelacion).categoria]++;
    const ultimoFracaso = [...fracasos].sort((a, b) => b.fecha_publicacion.localeCompare(a.fecha_publicacion))[0] ?? null;

    perfiles.push({
      rut,
      organismo: items[0]!.organismo,
      n_procesos: items.length,
      n_con_desenlace: conDesenlace.length,
      tasa_fracaso_pct: conDesenlace.length > 0 ? (fracasos.length / conDesenlace.length) * 100 : null,
      monto: percentiles(items.map((o) => o.monto_disponible_clp).filter((m) => m > 0)),
      motivos,
      ultimo_fracaso: ultimoFracaso,
    });
  }
  return perfiles.sort((a, b) => b.n_procesos - a.n_procesos);
}

/**
 * Para un organismo (RUT) dado, su fracaso terminal más reciente ANTES del código actual, si
 * existe — usado por `calificador.ts` para la señal `fracaso_previo_ganable`: un fracaso previo
 * clasificado `comprador` es la oportunidad más limpia que hay (el organismo se equivocó y va a
 * volver, no un rechazo de precio/técnico).
 */
export function fracasoPrevioDelOrganismo(rut: string, codigoActual: string, categoria?: string): Observacion | null {
  const previos = leer(categoria ? { categoria } : undefined).filter(
    (o) => o.rut === rut && o.codigo !== codigoActual && ESTADOS_FRACASO.has(o.estado),
  );
  const porCodigo = [...ultimaPorCodigo(previos).values()].sort((a, b) => b.fecha_publicacion.localeCompare(a.fecha_publicacion));
  return porCodigo[0] ?? null;
}
