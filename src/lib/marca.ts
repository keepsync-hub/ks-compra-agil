import type { CompraAgilListItem, ProductoSolicitado } from "./api.js";

/**
 * `q` en la API es un matching laxo (capturó "LICENCIAS CLOUDE" y "TIPO CLAUDE VERSION PRO"),
 * lo cual ayuda a encontrar variantes con errores de tipeo pero también trae ruido no
 * relacionado. Esta regex es la verificación local de que la mención de marca es real.
 */
const MENCION_MARCA_REGEX = /\b(claude|anthropic|clo?ude|clude)\b/i;

export function tieneMencionRealDeMarca(texto: string | null | undefined): boolean {
  if (!texto) return false;
  return MENCION_MARCA_REGEX.test(texto);
}

export function itemMencionaMarca(item: CompraAgilListItem): boolean {
  return tieneMencionRealDeMarca(item.nombre);
}

export function detalleMencionaMarca(
  descripcion: string | null | undefined,
  productos: ProductoSolicitado[] | undefined,
): boolean {
  if (tieneMencionRealDeMarca(descripcion)) return true;
  return (productos ?? []).some((p) => tieneMencionRealDeMarca(p.descripcion) || tieneMencionRealDeMarca(p.nombre));
}
