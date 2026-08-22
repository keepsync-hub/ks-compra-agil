#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Arma el código SDK final de un workflow reemplazando los marcadores `__CHUNK:archivo__` por el
 * contenido de `n8n/chunks/archivo`, ya escapado como literal de JavaScript.
 *
 *   node n8n/construir.mjs panel            → n8n/build/panel.ts
 *   node n8n/construir.mjs carpetas-drive
 *
 * Por qué existe: el código del SDK de n8n es un subconjunto muy restringido de TypeScript. No
 * admite `import`, ni `require`, ni `.join()`, ni funciones — así que el cuerpo de un nodo Code y
 * el HTML de una página no pueden leerse de un archivo desde ahí, y pegarlos a mano dentro de un
 * literal es justo donde aparecen los errores de escapado. Se resuelve acá, antes de validar.
 */

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const MARCADOR = /__CHUNK:([A-Za-z0-9._-]+)__/g;

const nombre = process.argv[2];
if (!nombre) {
  console.error("Uso: node n8n/construir.mjs <workflow>   (p.ej. panel, carpetas-drive)");
  process.exit(1);
}

const fuente = path.join(AQUI, "workflows", `${nombre}.ts`);
const salida = path.join(AQUI, "build", `${nombre}.ts`);

const usados = [];

/**
 * Los chunks se resuelven en cascada: el cuerpo de un nodo Code puede a su vez incrustar una
 * página HTML. El anidado se resuelve ANTES de escapar, así que el HTML entra como un literal
 * dentro del JS, y el JS entero como un literal dentro del workflow. Un solo escapado por nivel.
 */
function resolver(contenido) {
  return contenido.replace(MARCADOR, (_, archivo) => {
    const bruto = readFileSync(path.join(AQUI, "chunks", archivo), "utf-8");
    usados.push(`${archivo} (${bruto.length} car.)`);
    return JSON.stringify(resolver(bruto));
  });
}

const codigo = resolver(readFileSync(fuente, "utf-8"));

mkdirSync(path.dirname(salida), { recursive: true });
writeFileSync(salida, codigo, "utf-8");

console.log(`${path.relative(AQUI, salida)} — ${codigo.length} caracteres`);
for (const u of usados) console.log(`  chunk: ${u}`);
if (usados.length === 0) console.log("  (sin chunks: el workflow no usa marcadores)");
