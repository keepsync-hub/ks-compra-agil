import type { LicitacionListItem, LicitacionDetalle, ItemLicitacion } from "./api.js";

/**
 * A diferencia de Compra Ágil (donde `q` es la búsqueda del servidor y esto solo filtra ruido),
 * acá la API no ofrece búsqueda por texto — esta regex es el mecanismo PRIMARIO de descubrimiento
 * sobre el listado traído por `estado`/`fecha`. Cubre gestión documental, digitalización de
 * procesos y oficina de partes, con las variantes más comunes de redacción de bases de licitación.
 */
const MENCION_KEYWORDS_REGEX =
  /\b(gesti[oó]n\s+documental|gestor\s+documental|digitalizaci[oó]n\s+de\s+(?:procesos|documentos|archivos|expedientes)|oficina\s+de\s+partes|expediente\s+electr[oó]nico|tramitaci[oó]n\s+documental|sistema\s+de\s+gesti[oó]n\s+documental|archivo\s+digital|correspondencia\s+digital)\b/i;

export function tieneMencionRealDeKeyword(texto: string | null | undefined): boolean {
  if (!texto) return false;
  return MENCION_KEYWORDS_REGEX.test(texto);
}

export function itemMencionaKeyword(item: LicitacionListItem): boolean {
  return tieneMencionRealDeKeyword(item.Nombre) || tieneMencionRealDeKeyword(item.Descripcion);
}

export function detalleMencionaKeyword(detalle: LicitacionDetalle, items: ItemLicitacion[]): boolean {
  if (tieneMencionRealDeKeyword(detalle.Nombre) || tieneMencionRealDeKeyword(detalle.Descripcion)) return true;
  return items.some((i) => tieneMencionRealDeKeyword(i.Descripcion) || tieneMencionRealDeKeyword(i.NombreProducto));
}
