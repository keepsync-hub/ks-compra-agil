import { readFileSync } from "node:fs";
import path from "node:path";
import { ROOT_DIR } from "../src/lib/config.js";

/**
 * Corre un chunk de `n8n/chunks/` como lo corre n8n: el archivo es el CUERPO de una función, con
 * `$json`, `$input` y `$()` inyectados, y su `return` es la salida del nodo Code.
 *
 * Existe porque esos nueve archivos son el punto más ciego del repo: viajan como strings dentro de
 * un workflow, así que no los ve el typecheck ni ningún import, y su único ambiente de ejecución
 * era producción. Los dos bugs más caros de la revisión del panel vivían ahí.
 */

const DIR_CHUNKS = path.join(ROOT_DIR, "n8n", "chunks");

interface Item {
  json: Record<string, unknown>;
}

function comoItems(filas: readonly Record<string, unknown>[]): Item[] {
  return filas.map((json) => ({ json }));
}

function acceso(items: Item[]) {
  return {
    all: () => items,
    first: () => items[0],
    last: () => items[items.length - 1],
  };
}

export interface EntornoChunk {
  /** Lo que ve el chunk como `$json`. Por defecto, el json del primer item de entrada. */
  json?: Record<string, unknown>;
  /** Los items que entran al nodo: `$input.all()`. */
  entrada?: readonly Record<string, unknown>[];
  /** Salidas de otros nodos, por nombre: lo que devuelve `$("Nombre del nodo")`. */
  nodos?: Record<string, readonly Record<string, unknown>[]>;
}

export function correrChunk(archivo: string, entorno: EntornoChunk = {}): Item[] {
  const codigo = readFileSync(path.join(DIR_CHUNKS, archivo), "utf-8");
  const items = comoItems(entorno.entrada ?? []);
  const nodos = entorno.nodos ?? {};

  // n8n lanza si se pide un nodo que no corrió, y `resumen-drive.js` depende de eso para
  // distinguir "no se creó ninguna carpeta" de "se creó alguna". Replicarlo importa.
  const porNodo = (nombre: string) => {
    const salida = nodos[nombre];
    if (!salida) throw new Error(`El chunk pidió el nodo "${nombre}", que este test no definió.`);
    return acceso(comoItems(salida));
  };

  const fn = new Function("$json", "$input", "$", codigo) as (
    json: unknown,
    input: unknown,
    porNodo: unknown,
  ) => Item[];

  return fn(entorno.json ?? items[0]?.json ?? {}, acceso(items), porNodo);
}

/** El `<script id="__data">` que los chunks de render dejan en la página, ya decodificado. */
export function datosIncrustados(html: string): Record<string, unknown> {
  const m = /<script id="__data" type="application\/json">([^<]*)<\/script>/.exec(html);
  if (!m) throw new Error("La página no trae el bloque __data que lee docs/panel/*.js.");
  return JSON.parse(Buffer.from(m[1]!, "base64").toString("utf-8")) as Record<string, unknown>;
}
