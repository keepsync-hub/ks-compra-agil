import { getApiTicket } from "./config.js";

const BASE_URL = "https://api2.mercadopublico.cl";

export type EstadoConvocatoria = 1 | 2; // 1 = primer llamado (solo EMT), 2 = segundo llamado (todos)

export interface CompraAgilListItem {
  codigo: string;
  nombre: string;
  estado: { id_estado: number; codigo: string; glosa: string };
  convocatoria: { estado_convocatoria: EstadoConvocatoria; descripcion: string };
  documentos: { id: number; nombre: string }[];
  fechas: {
    fecha_publicacion: string;
    fecha_cierre: string;
    fecha_ultimo_cambio: string;
    fecha_cierre_primer_llamado?: string;
    fecha_cierre_segundo_llamado?: string;
  };
  montos: { moneda: string; monto_disponible: number; monto_disponible_clp: number };
  institucion: {
    organismo_comprador: string;
    rut: string;
    unidad_compra: string;
    region: number;
    nombre_region: string;
  };
  resumen: { total_ofertas_recibidas: number };
  motivos: { motivo_cancelacion: string | null; motivo_desierta: string | null; motivo_seleccion?: string | null };
  links: { detalle: string };
}

export interface ProductoSolicitado {
  codigo_producto: number;
  nombre: string;
  descripcion: string;
  cantidad: number;
  unidad_medida: string;
}

export interface CompraAgilDetalle {
  codigo: string;
  nombre: string;
  descripcion: string;
  estado: { id_estado: number; codigo: string; glosa: string };
  convocatoria: {
    estado_convocatoria: EstadoConvocatoria;
    descripcion: string;
    fecha_cierre_primer_llamado?: string;
    fecha_cierre_segundo_llamado?: string;
  };
  fechas: {
    fecha_publicacion: string;
    fecha_cierre: string;
    fecha_ultimo_cambio: string;
    fecha_cancelacion?: string | null;
  };
  entrega?: { direccion_entrega?: string; plazo_entrega_dias?: number };
  documentos: { id: number; nombre: string }[];
  presupuesto: {
    tipo_presupuesto: string;
    moneda: string;
    presupuesto_estimado: number;
    monto_disponible: number;
    monto_disponible_clp: number;
  };
  institucion: {
    organismo_comprador: string;
    rut: string;
    unidad_compra: string;
    region: number;
    nombre_region: string;
  };
  productos_solicitados: ProductoSolicitado[];
  resumen: { multa_sancion: number; total_ofertas_recibidas: number; total_demandas: number };
  motivos: { motivo_cancelacion: string | null; motivo_desierta: string | null; motivo_seleccion?: string | null };
  // Campos de adjudicación. El endpoint v2 los declara pero hoy los entrega vacíos incluso para
  // compras cerradas/adjudicadas (el proveedor ganador y su monto viven en la Orden de Compra del
  // portal, fuera de esta API). Se tipan como opcionales para leerlos si algún día se pueblan.
  id_orden_compra?: string | number | null;
  proveedores_cotizando?: ProveedorCotizando[];
}

/** Forma flexible: la API entrega este arreglo vacío hoy; se deja laxo para leer lo que venga. */
export interface ProveedorCotizando {
  nombre?: string;
  razon_social?: string;
  rut?: string;
  monto_clp?: number;
  monto?: number;
  seleccionado?: boolean;
  [k: string]: unknown;
}

export interface Adjudicacion {
  proveedor_seleccionado: string | null;
  monto_adjudicado_clp: number | null;
  orden_compra: string | null;
  /** true si la API entregó algún dato de adjudicación; false si vino todo vacío. */
  expuesta_por_api: boolean;
}

/** Extrae la adjudicación del detalle, tolerando que el endpoint v2 la entregue vacía. */
export function extraerAdjudicacion(detalle: CompraAgilDetalle): Adjudicacion {
  const proveedores = detalle.proveedores_cotizando ?? [];
  const ganador = proveedores.find((p) => p.seleccionado) ?? proveedores[0];
  const proveedor = ganador?.razon_social ?? ganador?.nombre ?? null;
  const monto = ganador?.monto_clp ?? ganador?.monto ?? null;
  const oc = detalle.id_orden_compra != null ? String(detalle.id_orden_compra) : null;
  return {
    proveedor_seleccionado: proveedor,
    monto_adjudicado_clp: typeof monto === "number" ? monto : null,
    orden_compra: oc,
    expuesta_por_api: proveedor != null || oc != null,
  };
}

interface ApiEnvelope<T> {
  success: string;
  trace: unknown;
  payload: T;
  errors: unknown;
}

// 502/503/504 son fallos transitorios del gateway del API (no cuota agotada): se reintentan.
// 429 nunca se reintenta acá — es cuota diaria y hay que esperar al reset (ver guardrail).
const TRANSIENT_STATUS = new Set([502, 503, 504]);
const MAX_INTENTOS = 3;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function apiGet<T>(pathAndQuery: string): Promise<T> {
  const ticket = getApiTicket();
  const url = `${BASE_URL}${pathAndQuery}`;

  let ultimoError: Error | undefined;
  for (let intento = 1; intento <= MAX_INTENTOS; intento++) {
    let res: Response;
    try {
      res = await fetch(url, { headers: { ticket } });
    } catch (err) {
      // Error de red (DNS, conexión, timeout de fetch): transitorio, reintentar.
      ultimoError = err as Error;
      if (intento < MAX_INTENTOS) {
        await sleep(1000 * 2 ** (intento - 1)); // 1s, 2s
        continue;
      }
      throw new Error(`API ${pathAndQuery} falló por red tras ${MAX_INTENTOS} intentos: ${ultimoError.message}`);
    }

    if (res.status === 429) {
      const retryAfter = res.headers.get("Retry-After");
      throw new Error(
        `Cuota diaria de la API agotada (429). Retry-After: ${retryAfter ?? "no informado"}. No reintentar a ciegas: esperar al reset diario.`,
      );
    }
    if (TRANSIENT_STATUS.has(res.status) && intento < MAX_INTENTOS) {
      await res.body?.cancel().catch(() => {});
      await sleep(1000 * 2 ** (intento - 1)); // 1s, 2s
      continue;
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`API ${pathAndQuery} respondió ${res.status}: ${body.slice(0, 500)}`);
    }
    const json = (await res.json()) as ApiEnvelope<T>;
    if (json.success !== "OK") {
      throw new Error(`API ${pathAndQuery} success=${json.success}: ${JSON.stringify(json.errors)}`);
    }
    return json.payload;
  }
  // Inalcanzable: el bucle retorna o lanza en cada rama, pero TS necesita el cierre.
  throw ultimoError ?? new Error(`API ${pathAndQuery}: fallo desconocido`);
}

const PAGE_SIZE_MIN = 10; // no documentado: tamano_pagina < 10 es rechazado o ignorado por la API

export type EstadoCompraAgil =
  | "publicada"
  | "proveedor_seleccionado"
  | "cerrada"
  | "desierta"
  | "cancelada";

export interface BuscarCompraAgilParams {
  q: string;
  estado?: EstadoCompraAgil;
  tamanoPagina?: number;
  /** Tope de páginas a recorrer (default 20). Bajarlo para queries deliberadamente genéricas
   * que devuelven miles de resultados poco relevantes, donde paginar a fondo solo suma riesgo
   * de 504 sin aportar hallazgos (la relevancia real se confirma después, localmente). */
  maxPaginas?: number;
}

/** Trae todas las páginas para una consulta `q` dada, deduplicando no es responsabilidad de esta función. */
export async function buscarCompraAgil(params: BuscarCompraAgilParams): Promise<CompraAgilListItem[]> {
  const tamanoPagina = Math.max(params.tamanoPagina ?? 50, PAGE_SIZE_MIN);
  const items: CompraAgilListItem[] = [];
  let pagina = 1;
  // Guardrail de seguridad: no dar más vueltas por consulta aunque la API pagine mal.
  const topePaginas = params.maxPaginas ?? 20;
  for (; pagina <= topePaginas; pagina++) {
    const qs = new URLSearchParams({
      q: params.q,
      tamano_pagina: String(tamanoPagina),
      numero_pagina: String(pagina),
    });
    if (params.estado) qs.set("estado", params.estado);
    const payload = await apiGet<{ items: CompraAgilListItem[] }>(`/v2/compra-agil?${qs.toString()}`);
    const pageItems = payload.items ?? [];
    items.push(...pageItems);
    if (pageItems.length < tamanoPagina) break; // última página
  }
  return items;
}

export async function obtenerDetalleCompraAgil(codigo: string): Promise<CompraAgilDetalle> {
  return apiGet<CompraAgilDetalle>(`/v2/compra-agil/${encodeURIComponent(codigo)}`);
}
