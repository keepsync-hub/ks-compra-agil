/**
 * Descarga los antecedentes (contenido completo de las bases) de una o varias licitaciones desde la
 * ficha PÚBLICA del portal de Mercado Público — sin ticket, sin cuota de API y sin login.
 *
 *   npm run antecedentes-licitacion -- 4174-29-LE26 [otro-codigo ...]
 *   npm run antecedentes-licitacion               # todas las licitaciones ya detectadas en caché
 *
 * Escribe por cada licitación, en `licitaciones/data/<codigo>/` (caché regenerable, gitignored):
 *   - `ficha-portal.html`  — HTML crudo tal como lo sirvió el portal
 *   - `antecedentes.md`    — las 9 secciones de las bases + foro de preguntas, en texto
 *   - `antecedentes.json`  — lo mismo estructurado, para que lo consuma otro script
 *
 * Por qué esto existe y qué NO hace: ver la cabecera de `licitaciones/src/lib/portal-ficha.ts`. En
 * una línea: la API de licitaciones no expone documentos ni garantías, pero el HTML público de la
 * ficha sí trae el texto de las bases; los ARCHIVOS adjuntos siguen detrás de un reCAPTCHA que este
 * script no intenta rodear — deja su URL anotada para un navegador real o una persona.
 */
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { LIC_ROOT_DIR } from "../lib/config.js";
import { obtenerAntecedentes, antecedentesAMarkdown, type AntecedentesLicitacion } from "../lib/portal-ficha.js";

const DATA_DIR = path.join(LIC_ROOT_DIR, "data");

/**
 * Códigos ya conocidos en caché: los que detectó el radar (`detalle.json`) y también los que ya
 * procesó este script antes (`antecedentes.json`), para poder refrescar las bases —el organismo
 * publica aclaraciones que las modifican— sin depender de una corrida de radar con cuota.
 */
function codigosEnCache(): string[] {
  if (!existsSync(DATA_DIR)) return [];
  return readdirSync(DATA_DIR, { withFileTypes: true })
    .filter(
      (d) =>
        d.isDirectory() &&
        (existsSync(path.join(DATA_DIR, d.name, "detalle.json")) ||
          existsSync(path.join(DATA_DIR, d.name, "antecedentes.json"))),
    )
    .map((d) => d.name)
    .sort();
}

function guardar(a: AntecedentesLicitacion): string {
  const dir = path.join(DATA_DIR, a.codigo);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "ficha-portal.html"), a.html, "utf-8");
  writeFileSync(path.join(dir, "antecedentes.md"), antecedentesAMarkdown(a), "utf-8");
  // El HTML crudo ya quedó en su propio archivo: duplicarlo dentro del JSON lo haría inmanejable.
  const { html: _html, ...sinHtml } = a;
  writeFileSync(path.join(dir, "antecedentes.json"), JSON.stringify(sinHtml, null, 2), "utf-8");
  return dir;
}

/** Una línea por sección, para que la corrida se pueda revisar sin abrir los archivos. */
function resumir(a: AntecedentesLicitacion): void {
  for (const s of a.secciones) {
    const primeraLinea = s.texto.split("\n").slice(1).join(" ").trim().slice(0, 110);
    console.log(`    ${s.numero}. ${s.titulo} — ${s.texto.length} car. ${primeraLinea ? `· ${primeraLinea}…` : ""}`);
  }
  if (a.foro) console.log(`    foro de preguntas: ${a.foro.length} car.`);
  if (a.enlaces.visorAdjuntos) {
    console.log(`    adjuntos (requieren navegador real, reCAPTCHA): ${a.enlaces.visorAdjuntos}`);
  } else {
    console.log(`    esta licitación no publica archivos adjuntos en la ficha`);
  }
}

async function main(): Promise<void> {
  const argumentos = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const codigos = argumentos.length > 0 ? argumentos : codigosEnCache();

  if (codigos.length === 0) {
    console.error(
      "No se indicaron códigos y no hay fichas en caché (licitaciones/data/<codigo>/detalle.json).\n" +
        "Uso: npm run antecedentes-licitacion -- <codigo> [<codigo> ...]\n" +
        "O corre primero `npm run radar-licitaciones` para detectar oportunidades.",
    );
    process.exitCode = 1;
    return;
  }

  console.log(`Antecedentes desde la ficha pública del portal (no gasta cuota de la API): ${codigos.length} licitación(es)\n`);
  let fallidas = 0;
  for (const codigo of codigos) {
    console.log(`  ${codigo}`);
    try {
      const antecedentes = await obtenerAntecedentes(codigo);
      const dir = guardar(antecedentes);
      resumir(antecedentes);
      console.log(`    → ${path.relative(process.cwd(), dir)}/antecedentes.md\n`);
    } catch (err) {
      fallidas++;
      // Una licitación que falla no debe costar las demás de la corrida.
      console.error(`    ✗ ${(err as Error).message}\n`);
    }
  }

  if (fallidas > 0) {
    console.error(`${fallidas} de ${codigos.length} licitación(es) no se pudieron leer.`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
