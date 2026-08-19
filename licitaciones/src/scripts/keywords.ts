/**
 * Palabras clave del radar de licitaciones, desde la línea de comandos.
 *
 *   npm run keywords-licitaciones                          # lista lo que busca el radar hoy
 *   npm run keywords-licitaciones -- agregar ged "expediente digital"
 *   npm run keywords-licitaciones -- quitar "expediente digital"
 *
 * Escribe `licitaciones/config/keywords-extra.json`, que el radar lee en la corrida siguiente: la
 * frase se usa como consulta al buscador del portal (descubrimiento) y como confirmación local.
 * Es la misma vía que ofrece el formulario de `docs/licitaciones.html`, para quien prefiere no
 * pasar por el navegador.
 *
 * Lo que este comando NO hace: tocar `keywords.json`. Esos patrones son regex afinadas contra
 * casos reales (ver los `_patron_excluyente_nota`); ampliarlas es trabajo de código, no de CLI.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { KEYWORDS_EXTRA_PATH, loadKeywordsConfig, loadKeywordsExtra, type TerminoExtra } from "../lib/config.js";
import { categoriasKeyword, consultasDeDescubrimiento, recargarKeywords, CATEGORIA_OTROS } from "../lib/keywords.js";

function guardar(terminos: TerminoExtra[]): void {
  // Se preserva el resto del archivo (sus notas explicativas) en vez de reescribirlo entero.
  const actual = JSON.parse(readFileSync(KEYWORDS_EXTRA_PATH, "utf-8")) as Record<string, unknown>;
  writeFileSync(KEYWORDS_EXTRA_PATH, JSON.stringify({ ...actual, terminos }, null, 2) + "\n", "utf-8");
  recargarKeywords();
}

function listar(): void {
  console.log(`Palabras que busca el radar de licitaciones (licitaciones/config/):\n`);
  for (const c of categoriasKeyword()) {
    console.log(`  ${c.id} — ${c.nombre}`);
    const consultas = consultasDeDescubrimiento(c);
    if (consultas.length > 0) console.log(`    consultas al buscador: ${consultas.join(" · ")}`);
    if (c.id !== CATEGORIA_OTROS.id) console.log(`    confirmación local:    /${c.patron_mencion}/i`);
    if (c.patron_excluyente) console.log(`    descarta si aparece:   /${c.patron_excluyente}/i`);
    if (c.extra.length > 0) console.log(`    agregadas a mano:      ${c.extra.join(" · ")}`);
    console.log();
  }
  const extras = loadKeywordsExtra().terminos;
  console.log(
    extras.length > 0
      ? `${extras.length} término(s) agregado(s) a mano en keywords-extra.json.`
      : `Sin términos agregados a mano todavía (keywords-extra.json vacío).`,
  );
}

function categoriasValidas(): string[] {
  return [...loadKeywordsConfig().categorias.map((c) => c.id), CATEGORIA_OTROS.id];
}

function agregar(categoria: string, termino: string): void {
  const validas = categoriasValidas();
  if (!validas.includes(categoria)) {
    console.error(`Categoría desconocida: "${categoria}". Válidas: ${validas.join(", ")}.`);
    process.exitCode = 1;
    return;
  }
  const limpio = termino.trim();
  if (limpio.length < 3) {
    console.error(`"${limpio}" es demasiado corto: una palabra clave de 1 o 2 caracteres pesca cualquier cosa.`);
    process.exitCode = 1;
    return;
  }
  const terminos = loadKeywordsExtra().terminos;
  if (terminos.some((t) => t.termino.trim().toLowerCase() === limpio.toLowerCase())) {
    console.log(`"${limpio}" ya estaba en la lista. Sin cambios.`);
    return;
  }
  terminos.push({ categoria, termino: limpio, agregado: new Date().toISOString().slice(0, 10) });
  guardar(terminos);
  console.log(
    `Agregada: "${limpio}" (${categoria}).\n` +
      `La usará la próxima corrida de \`npm run radar-licitaciones\`, como consulta al buscador y como ` +
      `confirmación local.`,
  );
}

function quitar(termino: string): void {
  const terminos = loadKeywordsExtra().terminos;
  const quedan = terminos.filter((t) => t.termino.trim().toLowerCase() !== termino.trim().toLowerCase());
  if (quedan.length === terminos.length) {
    console.error(`"${termino}" no estaba en keywords-extra.json.`);
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
    console.error(`Uso: npm run keywords-licitaciones -- agregar <categoria> "<frase>"`);
    console.error(`Categorías: ${categoriasValidas().join(", ")}`);
    process.exitCode = 1;
  } else {
    agregar(categoria, termino);
  }
} else if (accion === "quitar") {
  const termino = resto.join(" ");
  if (!termino) {
    console.error(`Uso: npm run keywords-licitaciones -- quitar "<frase>"`);
    process.exitCode = 1;
  } else {
    quitar(termino);
  }
} else {
  console.error(`Acción desconocida: "${accion}". Usar: listar | agregar | quitar.`);
  process.exitCode = 1;
}
