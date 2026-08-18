import type { CompraAgilListItem, ProductoSolicitado } from "./api.js";
import { categoriaPorId, mencionaCategoria, detalleMencionaCategoria } from "./categorias.js";

/**
 * Wrapper delgado sobre la categoría "claude" de config/categorias.json (ver PLAN-VOLUMEN.md,
 * Fase 1). Mantiene las mismas tres firmas de antes para no tocar `radar.ts`/`informe-nicho.ts`
 * durante la migración a multi-categoría — la regex y el comportamiento son idénticos a los que
 * tenía este archivo antes de generalizarse (`\b(claude|anthropic|clo?ude|clude)\b`, flag "i").
 */
export function tieneMencionRealDeMarca(texto: string | null | undefined): boolean {
  return mencionaCategoria(categoriaPorId("claude"), texto);
}

export function itemMencionaMarca(item: CompraAgilListItem): boolean {
  return tieneMencionRealDeMarca(item.nombre);
}

export function detalleMencionaMarca(
  descripcion: string | null | undefined,
  productos: ProductoSolicitado[] | undefined,
): boolean {
  return detalleMencionaCategoria(categoriaPorId("claude"), descripcion, productos);
}
