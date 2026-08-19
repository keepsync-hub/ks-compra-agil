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
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { LIC_ROOT_DIR } from "../lib/config.js";
import {
  obtenerAntecedentes,
  descargarPreguntasRespuestas,
  referenciasDocumentales,
  type AntecedentesLicitacion,
  type ReferenciaDocumento,
} from "../lib/portal-ficha.js";
import type { FichaDecision } from "../lib/decision.js";
import { hallazgosDesdeCache } from "../lib/cache.js";
import { escribirFichaDecision } from "../lib/ficha-decision-archivo.js";
import { renderTarjetasLicitaciones, actualizarPaginaLicitaciones } from "../lib/pagina.js";

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
  // El HTML crudo ya quedó en su propio archivo: duplicarlo dentro del JSON lo haría inmanejable.
  const { html: _html, ...sinHtml } = a;
  writeFileSync(path.join(dir, "antecedentes.json"), JSON.stringify(sinHtml, null, 2), "utf-8");
  return dir;
}

/**
 * Baja los ARCHIVOS de antecedentes que el portal entrega sin verificación humana. Hoy es uno: el
 * Excel de preguntas y respuestas del foro (las respuestas del organismo modifican las bases). Los
 * demás adjuntos viven tras el CAPTCHA del visor — para esos, `npm run adjuntos-licitacion`.
 */
async function guardarDocumentos(a: AntecedentesLicitacion, dir: string): Promise<string | undefined> {
  if (!a.enlaces.foroPreguntas) return undefined;
  try {
    const documento = await descargarPreguntasRespuestas(a.enlaces.foroPreguntas);
    if (!documento) return undefined;
    const destino = path.join(dir, "documentos");
    mkdirSync(destino, { recursive: true });
    // Nombre estable: el portal bautiza el archivo con la hora de descarga, así que cada corrida
    // dejaba una copia nueva del mismo documento. La fecha real ya está en `obtenidoEn`.
    const ruta = path.join(destino, "Foro_PreguntasRespuestas.xls");
    for (const viejo of readdirSync(destino).filter((f) => /^Foro_PreguntasRespuestas_.+\.xls$/.test(f))) {
      rmSync(path.join(destino, viejo), { force: true });
    }
    writeFileSync(ruta, documento.contenido);
    console.log(`    ↓ Foro_PreguntasRespuestas.xls (${documento.contenido.length} bytes) — archivo oficial, sin CAPTCHA`);
    return path.relative(process.cwd(), ruta);
  } catch (err) {
    console.warn(`    (no se pudo bajar el Excel de preguntas: ${(err as Error).message})`);
    return undefined;
  }
}

/**
 * El entregable de este comando, además del texto: el índice de documentos con su URL. Tener la URL
 * ya es tener acceso al documento — bajar los bytes solo hace falta para leerlos con un programa, y
 * el texto de las bases ya viene parseado. `documentos.json` es lo que consume la página publicada.
 */
function guardarReferencias(a: AntecedentesLicitacion, dir: string, xlsLocal?: string): ReferenciaDocumento[] {
  const referencias = referenciasDocumentales(a, { preguntasRespuestasLocal: xlsLocal });
  writeFileSync(
    path.join(dir, "documentos.json"),
    JSON.stringify({ codigo: a.codigo, obtenidoEn: a.obtenidoEn, documentos: referencias }, null, 2),
    "utf-8",
  );
  return referencias;
}

/** Una línea por sección, para que la corrida se pueda revisar sin abrir los archivos. */
function resumir(a: AntecedentesLicitacion): void {
  for (const s of a.secciones) {
    const primeraLinea = s.texto.split("\n").slice(1).join(" ").trim().slice(0, 110);
    console.log(`    ${s.numero}. ${s.titulo} — ${s.texto.length} car. ${primeraLinea ? `· ${primeraLinea}…` : ""}`);
  }
  if (a.foro) console.log(`    foro de preguntas: ${a.foro.length} car.`);
}

function resumirDocumentos(referencias: ReferenciaDocumento[]): void {
  for (const r of referencias) {
    console.log(`    ${r.acceso === "directo" ? "→" : "↗"} ${r.titulo}`);
    console.log(`      ${r.url}`);
  }
  if (!referencias.some((r) => r.clave === "adjuntos")) {
    console.log(`    (esta licitación no publica archivos adjuntos en la ficha)`);
  }
}

/**
 * Deja la página publicada al día con los enlaces recién descubiertos, sin gastar cuota: se
 * reconstruye desde las fichas ya cacheadas. Si la caché está vacía **no se toca la página** —
 * publicar una grilla vacía borraría oportunidades que siguen abiertas (mismo criterio que el
 * radar ante una corrida incompleta).
 */
function republicarPagina(): void {
  const { hallazgos } = hallazgosDesdeCache();
  if (hallazgos.length === 0) {
    console.log("Página no tocada: no hay fichas vigentes en caché (correr `npm run radar-licitaciones`).");
    return;
  }
  const ok = actualizarPaginaLicitaciones(renderTarjetasLicitaciones(hallazgos));
  console.log(
    ok
      ? `Página actualizada con los enlaces a documentos de ${hallazgos.length} licitación(es): docs/licitaciones.html`
      : "No se pudo actualizar docs/licitaciones.html (faltan los marcadores OPORTUNIDADES).",
  );
}

const ICONO_BANDERA: Record<string, string> = { bloqueante: "⛔", atencion: "⚠️", favorable: "✅" };

/** Lo que decide si vale la pena presentarse, en la consola de la corrida. */
function resumirDecision(ficha: FichaDecision): void {
  const precio = ficha.pesoPrecio !== undefined ? `precio ${ficha.pesoPrecio}%` : "sin criterios parseados";
  const garantia = ficha.garantia.exigida ? `garantía ${ficha.garantia.monto ?? "sí"}` : "sin garantía";
  console.log(
    `    decisión: cierre en ${ficha.fechas.diasHastaCierre ?? "?"} día(s) · ${precio} · ${garantia} · ` +
      `${ficha.anexos.total} anexo(s) · ${ficha.clausulasExcluyentes.length} cláusula(s) excluyente(s)`,
  );
  for (const b of ficha.banderas.filter((x) => x.nivel !== "favorable")) {
    console.log(`      ${ICONO_BANDERA[b.nivel]} ${b.titulo}`);
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
      const xlsLocal = await guardarDocumentos(antecedentes, dir);
      resumirDocumentos(guardarReferencias(antecedentes, dir, xlsLocal));
      resumirDecision(await escribirFichaDecision(antecedentes));
      console.log(`    → ${path.relative(process.cwd(), dir)}/decision.md (y antecedentes.md)\n`);
    } catch (err) {
      fallidas++;
      // Una licitación que falla no debe costar las demás de la corrida.
      console.error(`    ✗ ${(err as Error).message}\n`);
    }
  }

  republicarPagina();

  if (fallidas > 0) {
    console.error(`${fallidas} de ${codigos.length} licitación(es) no se pudieron leer.`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
