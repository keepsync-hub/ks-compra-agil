/**
 * Cliente para la API PÚBLICA CLÁSICA de Licitaciones de Mercado Público (`api.mercadopublico.cl`).
 *
 * VERIFICADO CONTRA PRODUCCIÓN el 2026-08-19 con un `LICITACIONES_API_TICKET` válido (antes de esa
 * fecha este módulo estaba escrito pero sin correr: los comentarios hablaban de campos "asumidos").
 * Lo que esa corrida confirmó y corrigió:
 *
 * - `estado=activas` devuelve TODAS las licitaciones vigentes del país en una sola llamada, sin
 *   paginar (4.381 en esa corrida). No hace falta barrer por fecha para tener cobertura.
 * - El ítem del LISTADO es mucho más pobre que la ficha: trae `CodigoExterno`, `Nombre`,
 *   `CodigoEstado` y poco más — **sin `Comprador`, sin `Estado`, sin `Tipo`, sin `FechaPublicacion`
 *   y sin `MontoEstimado`**, todos campos que el diccionario documenta bajo la misma ruta
 *   `Licitaciones/Listado/Licitacion/...`. Todo eso solo llega pidiendo la ficha (`?codigo=`). Por
 *   eso cualquier consumidor que necesite comprador, monto o tipo tiene que usar el `detalle`, no
 *   el ítem del listado (ver `historial.ts`, donde confundirlos producía alertas falsas).
 * - `Comprador.RutUnidad` existe y trae el RUT (confirma la corrección que ya había hecho el
 *   diccionario oficial frente a la suposición original `RutOrganismo`).
 * - `Adjuntos` y `Garantia` **no existen en la ficha de este endpoint**: no aparecieron en ninguna
 *   de las fichas revisadas, igual que no aparecen en el diccionario oficial. Los documentos de
 *   las bases (donde vive la exigencia de boleta de garantía) hay que leerlos en el portal; este
 *   dominio no tiene el equivalente al servicio de adjuntos sin login que sí existe en Compra Ágil.
 *   Los campos se mantienen tipados y el parseo defensivo por si otro estado/tipo sí los trae.
 * - El plazo de contrato vive en `TiempoDuracionContrato` + `UnidadTiempoDuracionContrato` (tabla
 *   3.6 del diccionario), no en un `PlazosContrato.Plazo`, que era una suposición y no existe.
 * - `CantidadReclamos` es, según el diccionario, el número de reclamos recibidos por el ORGANISMO,
 *   no por esta licitación (valores como 387 en una licitación chica lo confirman en la práctica).
 *
 * Los nombres de campo también están confirmados contra el "Diccionario de Datos" oficial de
 * ChileCompra (`licitaciones/docs/diccionario-api-licitaciones-mercadopublico.pdf`).
 *
 * Diferencia estructural importante respecto a Compra Ágil: esta API **no tiene un parámetro de
 * búsqueda por texto libre como `q`**. Por eso el radar de licitaciones no puede repetir el patrón
 * "~8 queries de marca" del radar de Compra Ágil: trae el listado nacional de licitaciones activas
 * y filtra las palabras clave LOCALMENTE sobre `Nombre`/`Descripcion` — el mismo mecanismo que ya
 * existía como filtro de ruido en Compra Ágil, pero acá es el mecanismo de descubrimiento primario,
 * no un filtro secundario.
 *
 * Este módulo expone deliberadamente **solo dos llamadas**: el listado de activas y la ficha por
 * código. Toda la cuota del ticket se gasta en saber qué está abierto ahora — ver
 * `buscarLicitacionesActivas`.
 */
import { getApiTicket } from "./config.js";

const BASE_URL = "https://api.mercadopublico.cl";

/** Forma flexible del ítem de listado — se tipa laxo porque no está verificado contra producción. */
export interface LicitacionListItem {
  CodigoExterno: string;
  Nombre: string;
  CodigoEstado?: number;
  Estado?: string;
  Descripcion?: string;
  FechaCierre?: string;
  FechaPublicacion?: string;
  Comprador?: {
    CodigoOrganismo?: string;
    NombreOrganismo?: string;
    // Confirmado contra licitaciones/docs/diccionario-api-licitaciones-mercadopublico.pdf
    // (Diccionario de Datos oficial): el campo es RutUnidad, no RutOrganismo como se había
    // supuesto antes de tener el diccionario a mano.
    RutUnidad?: string;
    CodigoUnidad?: string;
    NombreUnidad?: string;
    DireccionUnidad?: string;
    ComunaUnidad?: string;
    RegionUnidad?: string;
  };
  Tipo?: string;
  MontoEstimado?: number;
  Moneda?: string;
  [k: string]: unknown;
}

export interface ItemLicitacion {
  Correlativo?: number;
  CodigoProducto?: string;
  NombreProducto?: string;
  Descripcion?: string;
  Cantidad?: number;
  UnidadMedida?: string;
  [k: string]: unknown;
}

export interface GarantiaLicitacion {
  MontoGarantiaSeriedad?: number;
  DiasValidezGarantiaSeriedad?: number;
  GlosaGarantiaSeriedad?: string;
  MontoGarantiaFielCumplimiento?: number;
  DiasValidezGarantiaFielCumplimiento?: number;
  [k: string]: unknown;
}

/** Ficha completa (`?codigo=`). Todos los campos opcionales salvo el código: sin verificar en vivo. */
export interface LicitacionDetalle extends LicitacionListItem {
  Fechas?: {
    FechaPublicacion?: string;
    FechaCierre?: string;
    FechaActoAperturaTecnica?: string;
    FechaAdjudicacion?: string;
    FechaEstimadaFirmaContrato?: string;
    [k: string]: unknown;
  };
  Items?: { Listado?: ItemLicitacion[] } | ItemLicitacion[];
  /** No apareció en ninguna ficha verificada (2026-08-19). Se mantiene por parseo defensivo. */
  Adjuntos?: { Listado?: { Nombre?: string; URL?: string }[] } | { Nombre?: string; URL?: string }[];
  /** Idem: este endpoint no expone las garantías; hay que leer las bases en el portal. */
  Garantia?: GarantiaLicitacion;
  /** Duración del contrato declarada por el organismo. Verificado: llega como string ("16"). */
  TiempoDuracionContrato?: string | number;
  /** Código de unidad de tiempo del campo anterior (tabla 3.6: 1 hora … 5 año). Verificado. */
  UnidadTiempoDuracionContrato?: number;
  TipoDuracionContrato?: string;
  Adjudicacion?: {
    Listado?: { NombreProveedor?: string; RutProveedor?: string; MontoTotalOfertaEvaluada?: number }[];
  };
  /** Reclamos recibidos por el ORGANISMO comprador, no por esta licitación (diccionario, campo 35). */
  CantidadReclamos?: number;
}

interface ListadoEnvelope {
  Cantidad?: number;
  FechaCreacion?: string;
  Version?: string;
  Listado: LicitacionListItem[];
}

/**
 * 429 de esta API: la cuota del ticket se agotó. Es un error de tipo propio y no un fallo más
 * porque el llamador tiene que reaccionar distinto — dejar de pedir en vez de seguir iterando
 * candidatos que van a fallar todos igual (guardrail: no reintentar a ciegas ante un bloqueo).
 */
export class CuotaAgotadaError extends Error {
  readonly retryAfter: string | null;
  constructor(retryAfter: string | null) {
    super(
      `Cuota de la API de Licitaciones agotada (429). Retry-After: ${retryAfter ?? "no informado"}. ` +
        `No reintentar a ciegas.`,
    );
    this.name = "CuotaAgotadaError";
    this.retryAfter = retryAfter;
  }
}

const TRANSIENT_STATUS = new Set([502, 503, 504]);
const MAX_INTENTOS = 3;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function apiGet<T>(query: Record<string, string>): Promise<T> {
  const ticket = getApiTicket();
  const qs = new URLSearchParams({ ...query, ticket });
  const url = `${BASE_URL}/servicios/v1/publico/licitaciones.json?${qs.toString()}`;

  let ultimoError: Error | undefined;
  for (let intento = 1; intento <= MAX_INTENTOS; intento++) {
    let res: Response;
    try {
      res = await fetch(url);
    } catch (err) {
      ultimoError = err as Error;
      if (intento < MAX_INTENTOS) {
        await sleep(1000 * 2 ** (intento - 1));
        continue;
      }
      throw new Error(`API licitaciones falló por red tras ${MAX_INTENTOS} intentos: ${ultimoError.message}`);
    }

    if (res.status === 429) {
      throw new CuotaAgotadaError(res.headers.get("Retry-After"));
    }
    if (TRANSIENT_STATUS.has(res.status) && intento < MAX_INTENTOS) {
      await res.body?.cancel().catch(() => {});
      await sleep(1000 * 2 ** (intento - 1));
      continue;
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`API licitaciones respondió ${res.status}: ${body.slice(0, 500)}`);
    }
    const json = (await res.json()) as { Codigo?: number; Mensaje?: string } & T;
    // Esta API devuelve HTTP 200 incluso para errores propios (ej. ticket inválido), con un
    // envelope {Codigo, Mensaje} en vez de la lista esperada — a diferencia de api2 (Compra
    // Ágil) que sí usa códigos HTTP de error. Detectarlo explícitamente en vez de asumir éxito.
    if (json && typeof json === "object" && "Codigo" in json && "Mensaje" in json && !("Listado" in json)) {
      throw new Error(`API licitaciones error: ${json.Mensaje} (código ${json.Codigo}).`);
    }
    return json as T;
  }
  throw ultimoError ?? new Error("API licitaciones: fallo desconocido");
}

/**
 * Único listado que este dominio consulta: las licitaciones vigentes.
 *
 * La API acepta otros estados (`cerrada`, `desierta`, `adjudicada`, …) y un parámetro `fecha`, pero
 * **acá no se usan a propósito**. La cuota de este ticket es muy escasa —se agotó en la segunda
 * corrida del mismo día— y cada estado extra obliga a traerse un listado nacional completo. Se
 * decidió gastar toda la cuota en lo único que produce valor accionable: qué está abierto ahora y
 * la ficha de cada candidato. Si alguna vez se quiere volver a barrer el histórico, esta firma es
 * el lugar donde ampliarla, y hay que presupuestar la cuota antes.
 */
export async function buscarLicitacionesActivas(): Promise<LicitacionListItem[]> {
  const payload = await apiGet<ListadoEnvelope>({ estado: "activas" });
  return payload.Listado ?? [];
}

export async function obtenerDetalleLicitacion(codigo: string): Promise<LicitacionDetalle> {
  const payload = await apiGet<ListadoEnvelope>({ codigo });
  const detalle = payload.Listado?.[0] as LicitacionDetalle | undefined;
  if (!detalle) throw new Error(`Ficha de ${codigo} no encontrada en la respuesta de la API.`);
  return detalle;
}

/** Normaliza `Items` (a veces objeto envuelto, a veces array plano según la fuente/versión). */
export function itemsDeLicitacion(detalle: LicitacionDetalle): ItemLicitacion[] {
  const raw = detalle.Items;
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  return raw.Listado ?? [];
}
