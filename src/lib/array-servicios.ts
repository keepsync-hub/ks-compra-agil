import { readFileSync } from "node:fs";
import path from "node:path";
import { ROOT_DIR } from "./config.js";
import type { CompraAgilDetalle, ProductoSolicitado } from "./api.js";

export interface CategoriaArray {
  id: string;
  nombre: string;
  descripcion_array: string;
  variantes: string[];
  patron_mencion: string;
}

export interface ArrayServiciosConfig {
  categorias: CategoriaArray[];
}

export function loadArrayServiciosConfig(): ArrayServiciosConfig {
  const p = path.join(ROOT_DIR, "config", "array-servicios.json");
  return JSON.parse(readFileSync(p, "utf-8")) as ArrayServiciosConfig;
}

/**
 * El `q` de la API es matching laxo (mismo comportamiento que con "Claude"): trae ruido que hay
 * que confirmar localmente contra el patrón real de cada categoría antes de reportarlo.
 */
export function textoMencionaCategoria(categoria: CategoriaArray, texto: string | null | undefined): boolean {
  if (!texto) return false;
  return new RegExp(categoria.patron_mencion, "i").test(texto);
}

export function detalleMencionaCategoria(
  categoria: CategoriaArray,
  descripcion: string | null | undefined,
  productos: ProductoSolicitado[] | undefined,
): boolean {
  if (textoMencionaCategoria(categoria, descripcion)) return true;
  return (productos ?? []).some(
    (p) => textoMencionaCategoria(categoria, p.descripcion) || textoMencionaCategoria(categoria, p.nombre),
  );
}

export function categoriasQueMenciona(
  categorias: CategoriaArray[],
  detalle: Pick<CompraAgilDetalle, "descripcion" | "productos_solicitados">,
): CategoriaArray[] {
  return categorias.filter((c) => detalleMencionaCategoria(c, detalle.descripcion, detalle.productos_solicitados));
}
