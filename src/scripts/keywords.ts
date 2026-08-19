/**
 * Palabras clave del radar de Compra Ágil, desde la línea de comandos.
 *
 *   npm run keywords                                   # lista lo que busca el radar hoy
 *   npm run keywords -- agregar claude "Claude Sonnet"
 *   npm run keywords -- quitar "Claude Sonnet"
 *
 * Escribe `config/categorias-extra.json`, que el radar lee en la corrida siguiente: la frase se usa
 * como variante `q` contra la API (descubrimiento) y como verificación local del texto. Es la misma
 * vía que ofrece el formulario de `docs/index.html`, para quien prefiere no pasar por el navegador.
 *
 * Ojo con la cuota: cada frase agregada a una categoría ACTIVA suma un request por corrida.
 *
 * Lo que este comando NO hace: tocar `categorias.json`. Sus `verificacion_regex` están afinadas
 * contra casos reales y validadas al compilar; ampliarlas es trabajo de código, no de CLI.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ROOT_DIR } from "../lib/config.js";
import {
  cargarCategorias,
  cargarCategoriasExtra,
  recargarCategorias,
  variantesDeBusqueda,
  CATEGORIAS_EXTRA_PATH_REL,
  type TerminoExtra,
} from "../lib/categorias.js";

const RUTA = path.join(ROOT_DIR, CATEGORIAS_EXTRA_PATH_REL);

function guardar(terminos: TerminoExtra[]): void {
  // Se preserva el resto del archivo (sus notas explicativas) en vez de reescribirlo entero.
  const actual = JSON.parse(readFileSync(RUTA, "utf-8")) as Record<string, unknown>;
  writeFileSync(RUTA, JSON.stringify({ ...actual, terminos }, null, 2) + "\n", "utf-8");
  recargarCategorias();
}

function listar(): void {
  console.log(`Palabras que busca el radar de Compra Ágil (config/):\n`);
  for (const c of cargarCategorias()) {
    console.log(`  ${c.id} — ${c.nombre}${c.activa ? "" : "   [inactiva: no se consulta]"}`);
    console.log(`    variantes q:        ${variantesDeBusqueda(c).join(" · ")}`);
    console.log(`    verificación local: ${c.regex}`);
    if (c.extra.length > 0) console.log(`    agregadas a mano:   ${c.extra.join(" · ")}`);
    console.log();
  }
  const extras = cargarCategoriasExtra().terminos;
  console.log(
    extras.length > 0
      ? `${extras.length} término(s) agregado(s) a mano en ${CATEGORIAS_EXTRA_PATH_REL}.`
      : `Sin términos agregados a mano todavía (${CATEGORIAS_EXTRA_PATH_REL} vacío).`,
  );
}

function agregar(categoria: string, termino: string): void {
  const categorias = cargarCategorias();
  const cat = categorias.find((c) => c.id === categoria);
  if (!cat) {
    console.error(`Categoría desconocida: "${categoria}". Válidas: ${categorias.map((c) => c.id).join(", ")}.`);
    process.exitCode = 1;
    return;
  }
  const limpio = termino.trim();
  if (limpio.length < 3) {
    console.error(`"${limpio}" es demasiado corto: una palabra clave de 1 o 2 caracteres pesca cualquier cosa.`);
    process.exitCode = 1;
    return;
  }
  const terminos = cargarCategoriasExtra().terminos;
  if (terminos.some((t) => t.termino.trim().toLowerCase() === limpio.toLowerCase())) {
    console.log(`"${limpio}" ya estaba en la lista. Sin cambios.`);
    return;
  }
  terminos.push({ categoria, termino: limpio, agregado: new Date().toISOString().slice(0, 10) });
  guardar(terminos);
  console.log(
    `Agregada: "${limpio}" (${categoria}).\n` +
      (cat.activa
        ? `La usará la próxima corrida de \`npm run radar\`, como variante de búsqueda y como ` +
          `verificación local. Suma 1 request por corrida.`
        : `La categoría "${categoria}" está inactiva, así que el radar todavía no la consulta: ` +
          `activarla en config/categorias.json.`),
  );
}

function quitar(termino: string): void {
  const terminos = cargarCategoriasExtra().terminos;
  const quedan = terminos.filter((t) => t.termino.trim().toLowerCase() !== termino.trim().toLowerCase());
  if (quedan.length === terminos.length) {
    console.error(`"${termino}" no estaba en ${CATEGORIAS_EXTRA_PATH_REL}.`);
    process.exitCode = 1;
    return;
  }
  guardar(quedan);
  console.log(`Quitada: "${termino}".`);
}

const [accion, ...resto] = process.argv.slice(2);

if (!accion || accion === "listar") {
  listar();
} else if (accion === "agregar") {
  const [categoria, ...frase] = resto;
  const termino = frase.join(" ");
  if (!categoria || !termino) {
    console.error(`Uso: npm run keywords -- agregar <categoria> "<frase>"`);
    console.error(`Categorías: ${cargarCategorias().map((c) => c.id).join(", ")}`);
    process.exitCode = 1;
  } else {
    agregar(categoria, termino);
  }
} else if (accion === "quitar") {
  const termino = resto.join(" ");
  if (!termino) {
    console.error(`Uso: npm run keywords -- quitar "<frase>"`);
    process.exitCode = 1;
  } else {
    quitar(termino);
  }
} else {
  console.error(`Acción desconocida: "${accion}". Usar: listar | agregar | quitar.`);
  process.exitCode = 1;
}
