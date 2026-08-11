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
  motivos: { motivo_cancelacion: string | null; motivo_desierta: string | null };
}

interface ApiEnvelope<T> {
  success: string;
  trace: unknown;
  payload: T;
  errors: unknown;
}

async function apiGet<T>(pathAndQuery: string): Promise<T> {
  const ticket = getApiTicket();
  const url = `${BASE_URL}${pathAndQuery}`;
  const res = await fetch(url, { headers: { ticket } });

  if (res.status === 429) {
    const retryAfter = res.headers.get("Retry-After");
    throw new Error(
      `Cuota diaria de la API agotada (429). Retry-After: ${retryAfter ?? "no informado"}. No reintentar a ciegas: esperar al reset diario.`,
    );
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

const PAGE_SIZE_MIN = 10; // no documentado: tamano_pagina < 10 es rechazado o ignorado por la API

export interface BuscarCompraAgilParams {
  q: string;
  estado?: "publicada" | "desierta" | "cancelada" | "cerrada";
  tamanoPagina?: number;
}

/** Trae todas las páginas para una consulta `q` dada, deduplicando no es responsabilidad de esta función. */
export async function buscarCompraAgil(params: BuscarCompraAgilParams): Promise<CompraAgilListItem[]> {
  const tamanoPagina = Math.max(params.tamanoPagina ?? 50, PAGE_SIZE_MIN);
  const items: CompraAgilListItem[] = [];
  let pagina = 1;
  // Guardrail de seguridad: no dar más de 20 vueltas por consulta aunque la API pagine mal.
  for (; pagina <= 20; pagina++) {
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
