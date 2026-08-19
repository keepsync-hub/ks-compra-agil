/**
 * Cliente para la API PÚBLICA CLÁSICA de Licitaciones de Mercado Público (`api.mercadopublico.cl`).
 *
 * ADVERTENCIA DE VERIFICACIÓN (a diferencia de `src/lib/api.ts` en la raíz, que sí está verificado
 * contra `api2.mercadopublico.cl` en producción — ver PLAN.md de la raíz): este cliente **no se ha
 * probado contra la API real con un ticket válido** en esta sesión (falta `LICITACIONES_API_TICKET`
 * en el entorno). Se probó únicamente que el endpoint responde (HTTP 200 con
 * `{"Codigo":203,"Mensaje":"Ticket no válido."}` usando un ticket de prueba público desactualizado),
 * lo que confirma que el host es alcanzable pero NO confirma la forma real del payload en runtime.
 *
 * Los nombres de campo de `LicitacionListItem`/`ItemLicitacion` (incluido `Comprador`) SÍ están
 * confirmados contra el "Diccionario de Datos" oficial de ChileCompra
 * (`licitaciones/docs/diccionario-api-licitaciones-mercadopublico.pdf` — ojo: ese documento NO
 * confirma los parámetros de búsqueda `estado`/`fecha`, solo `codigo`; ver más abajo). Ese
 * diccionario corrigió un error de esta misma interfaz: el RUT del comprador es
 * `Comprador.RutUnidad`, no `Comprador.RutOrganismo` como se había supuesto antes de tener el
 * diccionario a mano. `Garantia` y `Adjuntos`, en cambio, siguen sin aparecer en ese diccionario —
 * probablemente viven en otro endpoint o documento no revisado todavía — así que sus formas siguen
 * siendo una suposición y el parseo se mantiene defensivo (campos opcionales) por eso.
 *
 * Diferencia estructural importante respecto a Compra Ágil: esta API **no tiene un parámetro de
 * búsqueda por texto libre como `q`**. El diccionario oficial solo documenta `codigo` (ficha de una
 * licitación); `fecha` (día de publicación) y `estado` los usa ya el radar (`buscarLicitaciones`)
 * pero **siguen sin confirmar contra el diccionario oficial** — vienen de ejemplos públicos conocidos
 * de esta API, no de este documento. Por eso el radar de licitaciones no puede repetir el patrón
 * "~8 queries de marca" del radar de Compra Ágil: trae el listado de un estado (o de una fecha) y
 * filtra las palabras clave LOCALMENTE sobre `Nombre`/`Descripcion` — el mismo mecanismo que ya
 * existía como filtro de ruido en Compra Ágil, pero acá es el mecanismo de descubrimiento primario,
 * no un filtro secundario. Confirmar con un ticket real si `estado=activas` devuelve todas las
 * licitaciones vigentes en una sola llamada o si hace falta paginar por fecha.
 */
import { getApiTicket } from "./config.js";

const BASE_URL = "https://api.mercadopublico.cl";

export type EstadoLicitacion =
  | "activas"
  | "publicada"
  | "cerrada"
  | "desierta"
  | "adjudicada"
  | "revocada"
  | "suspendida";

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
  Adjuntos?: { Listado?: { Nombre?: string; URL?: string }[] } | { Nombre?: string; URL?: string }[];
  Garantia?: GarantiaLicitacion;
  PlazosContrato?: { Plazo?: number; Glosa?: string };
  Adjudicacion?: {
    Listado?: { NombreProveedor?: string; RutProveedor?: string; MontoTotalOfertaEvaluada?: number }[];
  };
  CantidadReclamos?: number;
}

interface ListadoEnvelope {
  Cantidad?: number;
  FechaCreacion?: string;
  Version?: string;
  Listado: LicitacionListItem[];
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
      const retryAfter = res.headers.get("Retry-After");
      throw new Error(
        `Cuota de la API de Licitaciones agotada (429). Retry-After: ${retryAfter ?? "no informado"}. ` +
          `No reintentar a ciegas.`,
      );
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

export interface BuscarLicitacionesParams {
  estado?: EstadoLicitacion;
  /** ddmmaaaa — día de publicación. La API no soporta rango de fechas ni texto libre. */
  fecha?: string;
}

export async function buscarLicitaciones(params: BuscarLicitacionesParams): Promise<LicitacionListItem[]> {
  const query: Record<string, string> = {};
  if (params.estado) query.estado = params.estado;
  if (params.fecha) query.fecha = params.fecha;
  const payload = await apiGet<ListadoEnvelope>(query);
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

/** Formatea una Date como ddmmaaaa, el formato que usa `fecha` en esta API. */
export function fechaDdmmaaaa(d: Date): string {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}${mm}${d.getFullYear()}`;
}
