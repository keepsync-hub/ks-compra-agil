/**
 * Descubrimiento de licitaciones por palabra clave.
 *
 * A diferencia de Compra Ágil (donde `q` es la búsqueda del servidor y esto solo filtra ruido),
 * acá la API **no ofrece búsqueda por texto**: estos patrones son el mecanismo PRIMARIO de
 * descubrimiento sobre el listado nacional de licitaciones activas.
 *
 * El nicho que se busca es el **catálogo de servicios de Array** (http://www.array.cl/): oficina
 * de partes electrónica, seguimiento de trámites, gestión documental y firma electrónica,
 * RPA/automatización de procesos, business intelligence y plataformas de gestión de proyectos.
 * Los patrones viven en `licitaciones/config/keywords.json` — antes esta regex estaba hardcodeada
 * acá y el JSON se cargaba sin usarse, así que editar la config no cambiaba nada.
 */
import { loadKeywordsConfig, loadKeywordsExtra, type CategoriaKeyword, type TerminoExtra } from "./config.js";
import type { LicitacionListItem, LicitacionDetalle, ItemLicitacion } from "./api.js";

interface CategoriaCompilada extends CategoriaKeyword {
  mencion: RegExp;
  excluyente: RegExp | null;
  /** Frases agregadas a mano para esta categoría (`keywords-extra.json`). */
  extra: string[];
}

/** Categoría de destino de los términos que no caen en ninguna de las del catálogo de Array. */
export const CATEGORIA_OTROS: CategoriaKeyword = {
  id: "otros",
  nombre: "Otros términos agregados a mano",
  patron_mencion: "(?!)", // no matchea nada por sí sola: esta categoría vive solo de sus extras
};

let cache: CategoriaCompilada[] | null = null;

/**
 * Comparación de las frases agregadas a mano: sin tildes, sin mayúsculas y con los espacios
 * colapsados. Quien escribe "expediente electronico" en un formulario espera que encuentre
 * "Expediente Electrónico" — y no tiene por qué escribir una regex para lograrlo.
 */
function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Invalida la caché de categorías: la usan los comandos que editan `keywords-extra.json`. */
export function recargarKeywords(): void {
  cache = null;
}

/** Categorías de la config, con sus patrones ya compilados (una sola vez por proceso). */
export function categoriasKeyword(): CategoriaCompilada[] {
  if (cache) return cache;
  const extras = loadKeywordsExtra().terminos;
  const base = loadKeywordsConfig().categorias;
  // "otros" solo aparece si alguien agregó términos que no caen en ninguna categoría del catálogo.
  const conocidas = new Set(base.map((c) => c.id));
  const hayOtros = extras.some((t) => !conocidas.has(t.categoria));
  const categorias = hayOtros ? [...base, CATEGORIA_OTROS] : base;

  cache = categorias.map((c) => ({
    ...c,
    mencion: new RegExp(c.patron_mencion, "i"),
    excluyente: c.patron_excluyente ? new RegExp(c.patron_excluyente, "i") : null,
    extra: extras
      .filter((t) => (conocidas.has(t.categoria) ? t.categoria === c.id : c.id === CATEGORIA_OTROS.id))
      .map((t) => t.termino.trim()),
  }));
  return cache;
}

/** Todos los términos agregados a mano, tal como están guardados. */
export function terminosExtra(): TerminoExtra[] {
  return loadKeywordsExtra().terminos;
}

/**
 * Lo que se le pide al buscador del portal: las consultas de cada categoría más las frases
 * agregadas a mano, que también sirven como consulta — agregar una palabra clave amplía el
 * descubrimiento, no solo el filtro.
 */
export function consultasDeDescubrimiento(categoria: CategoriaCompilada): string[] {
  return [...new Set([...(categoria.consultas_portal ?? []), ...categoria.extra])];
}

function textoDeItem(item: LicitacionListItem): string {
  return [item.Nombre ?? "", item.Descripcion ?? ""].join("\n");
}

function textoDeDetalle(detalle: LicitacionDetalle, items: ItemLicitacion[]): string {
  return [
    detalle.Nombre ?? "",
    detalle.Descripcion ?? "",
    ...items.flatMap((i) => [i.NombreProducto ?? "", i.Descripcion ?? ""]),
  ].join("\n");
}

/**
 * Categorías que menciona un texto. El `patron_excluyente` se evalúa sobre el MISMO texto: una
 * licitación de drones menciona "RPA" y hay que descartarla, no reportarla como automatización
 * robótica (ver los `_patron_excluyente_nota` de la config, con los casos reales que la motivaron).
 */
export function categoriasDeTexto(texto: string | null | undefined): CategoriaCompilada[] {
  if (!texto) return [];
  const normalizado = normalizar(texto);
  return categoriasKeyword().filter((c) => {
    const menciona = c.mencion.test(texto) || c.extra.some((t) => normalizado.includes(normalizar(t)));
    // El excluyente vale también para los términos agregados a mano: si el contexto desmiente la
    // categoría (un dron para "RPA"), da lo mismo por cuál de las dos vías se haya encontrado.
    return menciona && !c.excluyente?.test(texto);
  });
}

export function tieneMencionRealDeKeyword(texto: string | null | undefined): boolean {
  return categoriasDeTexto(texto).length > 0;
}

export function itemMencionaKeyword(item: LicitacionListItem): boolean {
  return categoriasDeTexto(textoDeItem(item)).length > 0;
}

/**
 * Categorías que confirma la ficha completa (nombre, descripción e ítems). El radar la usa para
 * descartar falsos positivos del listado, y la página para decir a qué servicio de Array
 * corresponde cada licitación — que es el dato que decide si vale la pena leerla.
 */
export function categoriasDeDetalle(detalle: LicitacionDetalle, items: ItemLicitacion[]): CategoriaCompilada[] {
  return categoriasDeTexto(textoDeDetalle(detalle, items));
}

export function detalleMencionaKeyword(detalle: LicitacionDetalle, items: ItemLicitacion[]): boolean {
  return categoriasDeDetalle(detalle, items).length > 0;
}
