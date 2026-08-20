import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { ROOT_DIR } from "./config.js";
import type { CompraAgilListItem, CompraAgilDetalle, ProductoSolicitado } from "./api.js";

export type PricingModo = "planes_usd" | "manual";

/** El mismo default que `buscarCompraAgil`: una categoría que no declara nada se comporta igual que antes. */
const MAX_PAGINAS_POR_VARIANTE_DEFAULT = 20;

export interface CategoriaNegocio {
  id: string;
  nombre: string;
  /** Etiqueta corta para el chip de categoría de cada tarjeta en docs/index.html. Default: `nombre`. */
  nombre_corto?: string;
  activa: boolean;
  variantes_q: string[];
  verificacion_regex: string;
  verificacion_flags?: string;
  /**
   * Segunda puerta del filtro: además de mencionar la materia (`verificacion_regex`), el texto
   * tiene que hablar del SERVICIO que se busca — "curso"/"capacitación" para las categorías de
   * formación, "asesoría"/"implementación" para las de servicio profesional.
   *
   * Se evalúa sobre el texto COMPLETO concatenado de la ficha, no campo por campo como
   * `mencionaCategoria`: la co-ocurrencia que interesa ("curso" + "Power BI") casi siempre vive en
   * campos distintos —el nombre dice "Curso de capacitación" y el producto dice "Power BI"—, así
   * que ninguna regex sobre un campo suelto puede expresarla.
   */
  patron_requerido?: string;
  /**
   * Tercera puerta: contexto en el que la categoría acierta la palabra pero se equivoca de rubro,
   * evaluado también sobre el texto completo. Mismo mecanismo que `patron_excluyente` de
   * config/array-servicios.json. Se agrega **solo con un caso real que lo motive**, citado en
   * `_patron_excluyente_nota` — un excluyente conjeturado descarta oportunidades verdaderas sin
   * que nadie se entere.
   */
  patron_excluyente?: string;
  /** Tope de páginas por variante `q`. Default: el de `buscarCompraAgil` (20). */
  max_paginas_por_variante?: number;
  /** Barrer también `estado=proveedor_seleccionado` (1 request extra por corrida). Default: true. */
  barrer_adjudicaciones?: boolean;
  pricing: { modo: PricingModo };
  presupuesto_requests_por_corrida: number;
  acreditaciones_conocidas_faltantes: string[];
}

export interface CategoriaCompilada
  extends Omit<
    CategoriaNegocio,
    | "verificacion_regex"
    | "verificacion_flags"
    | "patron_requerido"
    | "patron_excluyente"
    | "nombre_corto"
    | "max_paginas_por_variante"
    | "barrer_adjudicaciones"
  > {
  regex: RegExp;
  /** `patron_requerido` compilado, o `null` si la categoría no exige nada más que la mención. */
  requerido: RegExp | null;
  /** `patron_excluyente` compilado, o `null`. */
  excluyente: RegExp | null;
  nombreCorto: string;
  maxPaginasPorVariante: number;
  barrerAdjudicaciones: boolean;
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

/**
 * La palabra suelta "de" en un `q` es un quirk verificado del endpoint `/v2/compra-agil`: responde
 * `500 ERROR_INTERNO` de forma reproducible, no es un fallo transitorio de gateway (ver
 * `.claude/skills/array-compras-agiles-radar/SKILL.md`). Se valida al compilar y no al consultar
 * para que el error salte al escribir la config, no a mitad de una corrida que ya gastó cuota.
 */
const DE_SUELTO = /(^|\s)de(\s|$)/i;

function compilarPatron(id: string, campo: string, patron: string | undefined, flags: string): RegExp | null {
  if (patron == null || patron === "") return null;
  try {
    return new RegExp(patron, flags);
  } catch (err) {
    throw new Error(
      `config/categorias.json: regex inválida en "${campo}" de la categoría "${id}": ${(err as Error).message}`,
    );
  }
}

function compilar(cat: CategoriaNegocio, extras: TerminoExtra[]): CategoriaCompilada {
  if (!/^[a-z0-9-]+$/.test(cat.id)) {
    throw new Error(
      `config/categorias.json: id inválido "${cat.id}" — debe cumplir /^[a-z0-9-]+$/ (se usa como componente ` +
        `de ruta en data/ y output/).`,
    );
  }
  for (const variante of cat.variantes_q) {
    if (DE_SUELTO.test(variante)) {
      throw new Error(
        `config/categorias.json: la variante "${variante}" de la categoría "${cat.id}" contiene la palabra ` +
          `suelta "de". Quirk verificado del endpoint /v2/compra-agil: cualquier \`q\` con "de" suelto ` +
          `responde 500 ERROR_INTERNO de forma reproducible. El buscador es laxo, así que quitarla encuentra ` +
          `lo mismo ("Oficina Partes" trae "Oficina de Partes").`,
      );
    }
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
  const regex = compilarPatron(cat.id, "verificacion_regex", cat.verificacion_regex, flags);
  if (!regex) {
    throw new Error(`config/categorias.json: la categoría "${cat.id}" no tiene verificacion_regex.`);
  }
  const {
    verificacion_regex: _vr,
    verificacion_flags: _vf,
    patron_requerido: _pr,
    patron_excluyente: _pe,
    nombre_corto: _nc,
    max_paginas_por_variante: _mp,
    barrer_adjudicaciones: _ba,
    ...resto
  } = cat;
  return {
    ...resto,
    regex,
    requerido: compilarPatron(cat.id, "patron_requerido", cat.patron_requerido, flags),
    excluyente: compilarPatron(cat.id, "patron_excluyente", cat.patron_excluyente, flags),
    nombreCorto: cat.nombre_corto ?? cat.nombre,
    maxPaginasPorVariante: cat.max_paginas_por_variante ?? MAX_PAGINAS_POR_VARIANTE_DEFAULT,
    barrerAdjudicaciones: cat.barrer_adjudicaciones ?? true,
    extra: extras.filter((t) => t.categoria === cat.id).map((t) => t.termino.trim()),
  };
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

/**
 * Texto completo de la ficha, que es sobre lo que se evalúan `requerido` y `excluyente`.
 *
 * Gemela de la función homónima de `src/lib/array-servicios.ts`, y no compartida a propósito: son
 * dos configs con dos formas distintas de categoría, y el repo mantiene los dos dominios
 * deliberadamente sin acoplar.
 */
export function textoCompletoDetalle(
  detalle: Pick<CompraAgilDetalle, "nombre" | "descripcion" | "productos_solicitados">,
): string {
  return [
    detalle.nombre ?? "",
    detalle.descripcion ?? "",
    ...(detalle.productos_solicitados ?? []).flatMap((p) => [p.nombre ?? "", p.descripcion ?? ""]),
  ].join("\n");
}

/**
 * Por qué no alcanza con `true`/`false`: un descarte por `requerido`/`excluyente` no es lo mismo
 * que "no menciona nada". El primero hay que reportarlo con el código concreto (un excluyente
 * demasiado ancho se ve como oportunidades que desaparecen sin explicación); el segundo es ruido
 * esperable del `q` laxo y no vale la pena listarlo.
 */
export type ResultadoConfirmacion = "confirmada" | "no-menciona" | "falta-requerido" | "excluida";

/** Las tres puertas del filtro, en orden, sobre un texto ya concatenado. */
export function confirmarCategoriaEnTexto(cat: CategoriaCompilada, texto: string): ResultadoConfirmacion {
  if (!mencionaCategoria(cat, texto)) return "no-menciona";
  if (cat.requerido && !cat.requerido.test(texto)) return "falta-requerido";
  if (cat.excluyente && cat.excluyente.test(texto)) return "excluida";
  return "confirmada";
}

/** Nivel 1 del embudo: solo el `nombre` del listado, que es lo único que se tiene sin pagar el detalle. */
export function itemConfirmaCategoria(cat: CategoriaCompilada, item: CompraAgilListItem): ResultadoConfirmacion {
  return confirmarCategoriaEnTexto(cat, item.nombre ?? "");
}

/** Nivel 2 del embudo: el texto completo de la ficha (nombre + descripción + productos). */
export function detalleConfirmaCategoria(cat: CategoriaCompilada, detalle: CompraAgilDetalle): ResultadoConfirmacion {
  return confirmarCategoriaEnTexto(cat, textoCompletoDetalle(detalle));
}
