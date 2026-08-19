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
  /**
   * Contexto en el que `patron_mencion` acierta la palabra pero se equivoca de rubro, evaluado
   * sobre el texto completo de la ficha. Existe porque el cotizador convierte cada hallazgo en
   * una propuesta comercial firmada: un falso positivo que en un radar de solo lectura era ruido
   * tolerable, acá se vuelve una oferta absurda a un organismo real (ver los `_patron_excluyente_nota`
   * de config/array-servicios.json con los casos que lo motivaron).
   */
  patron_excluyente?: string;
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

/** Texto completo de la ficha, que es sobre lo que se evalúa `patron_excluyente`. */
function textoCompletoDetalle(
  detalle: Pick<CompraAgilDetalle, "nombre" | "descripcion" | "productos_solicitados">,
): string {
  return [
    detalle.nombre ?? "",
    detalle.descripcion ?? "",
    ...(detalle.productos_solicitados ?? []).flatMap((p) => [p.nombre ?? "", p.descripcion ?? ""]),
  ].join("\n");
}

export function categoriaExcluidaPorContexto(
  categoria: CategoriaArray,
  detalle: Pick<CompraAgilDetalle, "nombre" | "descripcion" | "productos_solicitados">,
): boolean {
  if (!categoria.patron_excluyente) return false;
  return new RegExp(categoria.patron_excluyente, "i").test(textoCompletoDetalle(detalle));
}

export function categoriasQueMenciona(
  categorias: CategoriaArray[],
  detalle: Pick<CompraAgilDetalle, "nombre" | "descripcion" | "productos_solicitados">,
): CategoriaArray[] {
  return categorias.filter(
    (c) =>
      detalleMencionaCategoria(c, detalle.descripcion, detalle.productos_solicitados) &&
      !categoriaExcluidaPorContexto(c, detalle),
  );
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

export interface DescartePorContexto {
  codigo: string;
  nombre: string;
  categorias: string[];
}

export interface ResultadoBusquedaArray {
  hallazgos: HallazgoArray[];
  variantesFallidas: VarianteFallidaArray[];
  totalVariantes: number;
  codigosUnicosTraidos: number;
  candidatosConMencionEnNombre: number;
  /** Fichas que mencionaban una categoría pero cuyo contexto la desmiente (`patron_excluyente`). */
  descartadosPorContexto: DescartePorContexto[];
}

// Términos genéricos (a diferencia de "Claude"): pueden traer miles de resultados poco relevantes.
// Se limita la paginación para evitar 504 de la API al paginar a fondo consultas amplias; la
// relevancia real igual se confirma después contra el patrón de cada categoría, así que el tope
// solo acota volumen, no precisión.
export const MAX_PAGINAS_POR_VARIANTE_ARRAY = 3;

/** Margen para los `GET /v2/compra-agil/{codigo}` de detalle, más un colchón de reintentos. */
const PRESUPUESTO_DETALLES_ARRAY = 60;

/**
 * Presupuesto de requests por corrida para los scripts de Array, en el mismo formato que
 * `categorias.presupuesto_requests_por_corrida` usa para el radar de Claude. Es el techo del
 * circuit breaker local de `src/lib/cuota.ts`: sin él, estos scripts (los más caros del repo —
 * búsquedas genéricas con varias páginas por variante) podrían comerse la cuota diaria que
 * comparten con el radar de licencias Claude, que es la reserva prioritaria.
 */
export function presupuestoRequestsArray(config: ArrayServiciosConfig): number {
  const variantes = config.categorias.reduce((acc, c) => acc + c.variantes.length, 0);
  return variantes * MAX_PAGINAS_POR_VARIANTE_ARRAY + PRESUPUESTO_DETALLES_ARRAY;
}

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
  const descartadosPorContexto: DescartePorContexto[] = [];
  for (const item of candidatos) {
    const detalle = await obtenerDetalleCompraAgil(item.codigo);
    const categorias = categoriasQueMenciona(config.categorias, detalle);
    if (categorias.length === 0) {
      // Distinguir "no mencionaba nada" (ruido de `q`, silencioso) de "mencionaba pero el
      // contexto la desmiente": lo segundo se reporta, porque un patrón excluyente demasiado
      // amplio se vería como oportunidades que desaparecen sin explicación.
      const excluidas = config.categorias.filter(
        (c) =>
          detalleMencionaCategoria(c, detalle.descripcion, detalle.productos_solicitados) &&
          categoriaExcluidaPorContexto(c, detalle),
      );
      if (excluidas.length > 0) {
        descartadosPorContexto.push({
          codigo: item.codigo,
          nombre: detalle.nombre,
          categorias: excluidas.map((c) => c.nombre),
        });
      }
      continue;
    }
    const condiciones = extraerCondiciones(detalle);
    hallazgos.push({ item, detalle, condiciones, categorias });
  }

  return {
    hallazgos,
    variantesFallidas,
    totalVariantes,
    descartadosPorContexto,
    codigosUnicosTraidos: encontrados.size,
    candidatosConMencionEnNombre: candidatos.length,
  };
}
