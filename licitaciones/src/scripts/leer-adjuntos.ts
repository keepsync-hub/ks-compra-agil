/**
 * Lee los ARCHIVOS adjuntos que estén en `licitaciones/data/<codigo>/adjuntos/` y regenera la ficha
 * de decisión incorporando su texto.
 *
 *   npm run leer-adjuntos                 # todas las licitaciones en caché
 *   npm run leer-adjuntos -- <codigo>     # una
 *
 * Es el paso siguiente al clic humano en el visor del portal: bajados los PDF de bases y EE.TT. a
 * esa carpeta, su contenido entra a `decision.json` y a `antecedentes.md` con cita del archivo, que
 * es lo que faltaba para decidir con el detalle fino y no solo con la ficha pública.
 */
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { LIC_ROOT_DIR } from "../lib/config.js";
import { leerAdjuntosLocales, directorioAdjuntos } from "../lib/adjuntos-locales.js";
import { regenerarFichaDecision } from "../lib/ficha-decision-archivo.js";

const DATA_DIR = path.join(LIC_ROOT_DIR, "data");

function codigosEnCache(): string[] {
  if (!existsSync(DATA_DIR)) return [];
  return readdirSync(DATA_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(path.join(DATA_DIR, d.name, "antecedentes.json")))
    .map((d) => d.name)
    .sort();
}

async function main(): Promise<void> {
  const argumentos = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const codigos = argumentos.length > 0 ? argumentos : codigosEnCache();
  if (codigos.length === 0) {
    console.error(
      "No hay licitaciones con antecedentes en caché. Correr primero:\n" +
        "  npm run radar-licitaciones && npm run antecedentes-licitacion",
    );
    process.exitCode = 1;
    return;
  }

  for (const codigo of codigos) {
    const lectura = await leerAdjuntosLocales(codigo);
    if (lectura.documentos.length === 0) {
      console.log(
        `  ${codigo}: sin adjuntos en ${path.relative(process.cwd(), directorioAdjuntos(codigo))}/ ` +
          `— la ficha queda advertida de que le falta el detalle fino.`,
      );
    } else {
      console.log(`  ${codigo}: ${lectura.documentos.length} archivo(s)`);
      for (const d of lectura.documentos) {
        console.log(
          `    ${d.caracteres > 0 ? "✓" : "✗"} ${d.archivo} — ${d.formato}` +
            `${d.paginas ? `, ${d.paginas} pág.` : ""}, ${d.caracteres.toLocaleString("es-CL")} car.` +
            (d.problema ? ` (${d.problema})` : ""),
        );
      }
    }
    // Se regenera siempre, haya adjuntos o no: la ficha de decisión también refleja **su ausencia**,
    // y saltarse este paso dejaba en disco una ficha vieja sin que nada lo dijera.
    const ficha = await regenerarFichaDecision(codigo);
    if (ficha) {
      const criticas = ficha.banderas.filter((b) => b.nivel !== "favorable").length;
      console.log(`    → ficha de decisión regenerada: ${ficha.banderas.length} bandera(s), ${criticas} a revisar`);
    }
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
