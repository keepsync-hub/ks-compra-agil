import { readFileSync } from "node:fs";
import path from "node:path";
import { ROOT_DIR } from "./config.js";
import { buscarCompraAgil, obtenerDetalleCompraAgil, type CompraAgilListItem, type CompraAgilDetalle, type ProductoSolicitado } from "./api.js";
import { extraerCondiciones, type Condiciones } from "./condiciones.js";

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

export interface HallazgoArray {
  item: CompraAgilListItem;
  detalle: CompraAgilDetalle;
  condiciones: Condiciones;
  categorias: CategoriaArray[];
}

export interface VarianteFallidaArray {
  variante: string;
  error: string;
}

export interface ResultadoBusquedaArray {
  hallazgos: HallazgoArray[];
  variantesFallidas: VarianteFallidaArray[];
  totalVariantes: number;
  codigosUnicosTraidos: number;
  candidatosConMencionEnNombre: number;
}

// Términos genéricos (a diferencia de "Claude"): pueden traer miles de resultados poco relevantes.
// Se limita la paginación para evitar 504 de la API al paginar a fondo consultas amplias; la
// relevancia real igual se confirma después contra el patrón de cada categoría, así que el tope
// solo acota volumen, no precisión.
export const MAX_PAGINAS_POR_VARIANTE_ARRAY = 3;

/**
 * Búsqueda + filtrado completo de Compras Ágiles relacionadas con los servicios de Array: barre
 * `config/array-servicios.json`, descarta ruido local con `textoMencionaCategoria`, y trae el
 * detalle de cada código sobreviviente. Compartido por el radar (solo lectura) y el cotizador —
 * mismo procedimiento exacto para que ambos vean siempre las mismas oportunidades.
 */
export async function buscarHallazgosArray(config: ArrayServiciosConfig): Promise<ResultadoBusquedaArray> {
  const totalVariantes = config.categorias.reduce((acc, c) => acc + c.variantes.length, 0);
  const encontrados = new Map<string, CompraAgilListItem>();
  const variantesFallidas: VarianteFallidaArray[] = [];

  for (const categoria of config.categorias) {
    for (const variante of categoria.variantes) {
      try {
        const items = await buscarCompraAgil({ q: variante, estado: "publicada", maxPaginas: MAX_PAGINAS_POR_VARIANTE_ARRAY });
        for (const item of items) {
          if (!encontrados.has(item.codigo)) encontrados.set(item.codigo, item);
        }
      } catch (err) {
        const mensaje = (err as Error).message;
        variantesFallidas.push({ variante: `${categoria.id}: ${variante}`, error: mensaje });
      }
    }
  }

  const candidatos = [...encontrados.values()].filter((item) =>
    config.categorias.some((c) => textoMencionaCategoria(c, item.nombre)),
  );

  const hallazgos: HallazgoArray[] = [];
  for (const item of candidatos) {
    const detalle = await obtenerDetalleCompraAgil(item.codigo);
    const categorias = categoriasQueMenciona(config.categorias, detalle);
    if (categorias.length === 0) continue;
    const condiciones = extraerCondiciones(detalle);
    hallazgos.push({ item, detalle, condiciones, categorias });
  }

  return {
    hallazgos,
    variantesFallidas,
    totalVariantes,
    codigosUnicosTraidos: encontrados.size,
    candidatosConMencionEnNombre: candidatos.length,
  };
}
