import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { ROOT_DIR } from "./config.js";
import type { CompraAgilListItem, CompraAgilDetalle, ProductoSolicitado } from "./api.js";

export type PricingModo = "planes_usd" | "manual";

export interface CategoriaNegocio {
  id: string;
  nombre: string;
  activa: boolean;
  variantes_q: string[];
  verificacion_regex: string;
  verificacion_flags?: string;
  pricing: { modo: PricingModo };
  presupuesto_requests_por_corrida: number;
  acreditaciones_conocidas_faltantes: string[];
}

export interface CategoriaCompilada extends Omit<CategoriaNegocio, "verificacion_regex" | "verificacion_flags"> {
  regex: RegExp;
  /**
   * Frases agregadas a mano para esta categoría (`config/categorias-extra.json`). Se usan en los
   * dos lados del embudo: como variante `q` contra la API (descubrimiento) y como verificación
   * local del texto. Son literales, no regex: quien agrega una palabra desde la página publicada
   * no tiene por qué escribir expresiones regulares, y una regex mal formada rompería el radar.
   */
  extra: string[];
}

/** Un término agregado a mano, tal como se guarda en `config/categorias-extra.json`. */
export interface TerminoExtra {
  categoria: string;
  termino: string;
  agregado?: string;
}

export interface CategoriasExtraConfig {
  terminos: TerminoExtra[];
}

/**
 * Normalización de las frases agregadas a mano: sin tildes, sin mayúsculas y con los espacios
 * colapsados. Quien escribe "claude code" espera que encuentre "Claude Code" y "CLAUDE CODE".
 */
function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function compilar(cat: CategoriaNegocio, extras: TerminoExtra[]): CategoriaCompilada {
  if (!/^[a-z0-9-]+$/.test(cat.id)) {
    throw new Error(
      `config/categorias.json: id inválido "${cat.id}" — debe cumplir /^[a-z0-9-]+$/ (se usa como componente ` +
        `de ruta en data/ y output/).`,
    );
  }
  const flags = cat.verificacion_flags ?? "i";
  // Con el flag "g" (o "y"), RegExp.test() conserva `lastIndex` entre llamadas: en un bucle que
  // reusa la misma instancia (como itemMencionaCategoria sobre una lista), alterna true/false de
  // forma silenciosa e intermitente — un bug muy difícil de reproducir. Se prohíbe a propósito.
  if (/[gy]/.test(flags)) {
    throw new Error(
      `config/categorias.json: la categoría "${cat.id}" tiene flags "${flags}" — "g"/"y" no están permitidos ` +
        `(con "g", RegExp.test() arrastra estado entre llamadas y produce falsos negativos intermitentes). ` +
        `Usar solo "i" o dejar vacío.`,
    );
  }
  let regex: RegExp;
  try {
    regex = new RegExp(cat.verificacion_regex, flags);
  } catch (err) {
    throw new Error(`config/categorias.json: regex inválida en categoría "${cat.id}": ${(err as Error).message}`);
  }
  const { verificacion_regex: _vr, verificacion_flags: _vf, ...resto } = cat;
  return { ...resto, regex, extra: extras.filter((t) => t.categoria === cat.id).map((t) => t.termino.trim()) };
}

export const CATEGORIAS_EXTRA_PATH_REL = "config/categorias-extra.json";

/** Overlay opcional: si el archivo no está o no parsea, el radar sigue con las categorías base. */
export function cargarCategoriasExtra(): CategoriasExtraConfig {
  const p = path.join(ROOT_DIR, CATEGORIAS_EXTRA_PATH_REL);
  if (!existsSync(p)) return { terminos: [] };
  try {
    const datos = JSON.parse(readFileSync(p, "utf-8")) as Partial<CategoriasExtraConfig>;
    return {
      terminos: (datos.terminos ?? []).filter(
        (t): t is TerminoExtra =>
          typeof t?.categoria === "string" && typeof t?.termino === "string" && t.termino.trim() !== "",
      ),
    };
  } catch {
    return { terminos: [] };
  }
}

/** Invalida la caché: la usa el comando que edita `categorias-extra.json`. */
export function recargarCategorias(): void {
  cache = null;
}

let cache: CategoriaCompilada[] | null = null;

export function cargarCategorias(): CategoriaCompilada[] {
  if (cache) return cache;
  const p = path.join(ROOT_DIR, "config", "categorias.json");
  const raw = JSON.parse(readFileSync(p, "utf-8")) as { categorias: CategoriaNegocio[] };
  const extras = cargarCategoriasExtra().terminos;
  cache = raw.categorias.map((c) => compilar(c, extras));
  return cache;
}

export function categoriaPorId(id: string): CategoriaCompilada {
  const cat = cargarCategorias().find((c) => c.id === id);
  if (!cat) {
    throw new Error(
      `Categoría "${id}" no existe en config/categorias.json. Categorías disponibles: ` +
        cargarCategorias().map((c) => c.id).join(", "),
    );
  }
  return cat;
}

export function categoriasActivas(): CategoriaCompilada[] {
  return cargarCategorias().filter((c) => c.activa);
}

export function mencionaCategoria(cat: CategoriaCompilada, texto: string | null | undefined): boolean {
  if (!texto) return false;
  if (cat.regex.test(texto)) return true;
  if (cat.extra.length === 0) return false;
  const normalizado = normalizar(texto);
  return cat.extra.some((t) => normalizado.includes(normalizar(t)));
}

/** Lo que se le pide a la API como `q`: las variantes de la categoría más las agregadas a mano. */
export function variantesDeBusqueda(cat: CategoriaCompilada): string[] {
  return [...new Set([...cat.variantes_q, ...cat.extra])];
}

export function itemMencionaCategoria(cat: CategoriaCompilada, item: CompraAgilListItem): boolean {
  return mencionaCategoria(cat, item.nombre);
}

export function detalleMencionaCategoria(
  cat: CategoriaCompilada,
  descripcion: string | null | undefined,
  productos: ProductoSolicitado[] | undefined,
): boolean {
  if (mencionaCategoria(cat, descripcion)) return true;
  return (productos ?? []).some((p) => mencionaCategoria(cat, p.descripcion) || mencionaCategoria(cat, p.nombre));
}

/** Firma de conveniencia sobre el detalle completo (evita repetir `.descripcion`/`.productos_solicitados` en cada caller). */
export function detalleCompraAgilMencionaCategoria(cat: CategoriaCompilada, detalle: CompraAgilDetalle): boolean {
  return detalleMencionaCategoria(cat, detalle.descripcion, detalle.productos_solicitados);
}
