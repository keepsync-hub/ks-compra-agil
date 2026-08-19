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
import { loadKeywordsConfig, type CategoriaKeyword } from "./config.js";
import type { LicitacionListItem, LicitacionDetalle, ItemLicitacion } from "./api.js";

interface CategoriaCompilada extends CategoriaKeyword {
  mencion: RegExp;
  excluyente: RegExp | null;
}

let cache: CategoriaCompilada[] | null = null;

/** Categorías de la config, con sus patrones ya compilados (una sola vez por proceso). */
export function categoriasKeyword(): CategoriaCompilada[] {
  if (cache) return cache;
  cache = loadKeywordsConfig().categorias.map((c) => ({
    ...c,
    mencion: new RegExp(c.patron_mencion, "i"),
    excluyente: c.patron_excluyente ? new RegExp(c.patron_excluyente, "i") : null,
  }));
  return cache;
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
  return categoriasKeyword().filter((c) => c.mencion.test(texto) && !c.excluyente?.test(texto));
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
