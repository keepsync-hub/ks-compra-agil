/**
 * Persistencia de la ficha de decisión: la arma desde lo que ya hay en disco (antecedentes, ficha
 * de la API, adjuntos leídos) y la escribe donde la consumen los demás — `decision.json`,
 * `decision.md` y el bloque de cabecera de `antecedentes.md`.
 *
 * Vive aparte de `decision.ts` (que es puro cálculo y no toca el disco) para que la lógica de
 * extracción se pueda razonar y probar sin archivos de por medio.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { LIC_ROOT_DIR } from "./config.js";
import { fichaCacheada } from "./cache.js";
import { leerAdjuntosLocales } from "./adjuntos-locales.js";
import { construirFichaDecision, fichaDecisionAMarkdown, type FichaDecision } from "./decision.js";
import { antecedentesAMarkdown, type AntecedentesLicitacion } from "./portal-ficha.js";

function directorio(codigo: string): string {
  return path.join(LIC_ROOT_DIR, "data", codigo);
}

export function antecedentesGuardados(codigo: string): AntecedentesLicitacion | null {
  const ruta = path.join(directorio(codigo), "antecedentes.json");
  if (!existsSync(ruta)) return null;
  try {
    const datos = JSON.parse(readFileSync(ruta, "utf-8")) as AntecedentesLicitacion;
    // `antecedentes.json` se guarda sin el HTML crudo (vive en su propio archivo).
    return { ...datos, html: datos.html ?? "" };
  } catch {
    return null;
  }
}

/**
 * Escribe la ficha de decisión y deja `antecedentes.md` encabezado por ella: quien abra ese archivo
 * ve primero lo que decide (banderas, plazos, garantías, criterios) y después el texto completo.
 */
export async function escribirFichaDecision(a: AntecedentesLicitacion): Promise<FichaDecision> {
  const dir = directorio(a.codigo);
  const adjuntos = await leerAdjuntosLocales(a.codigo);
  const ficha = construirFichaDecision(a, fichaCacheada(a.codigo), adjuntos);
  const markdown = fichaDecisionAMarkdown(ficha);
  writeFileSync(path.join(dir, "decision.json"), JSON.stringify(ficha, null, 2), "utf-8");
  writeFileSync(path.join(dir, "decision.md"), markdown, "utf-8");
  writeFileSync(path.join(dir, "antecedentes.md"), `${markdown}\n---\n\n${antecedentesAMarkdown(a)}`, "utf-8");
  return ficha;
}

/** Rehace la ficha de una licitación ya procesada, sin volver a pedirle nada al portal. */
export async function regenerarFichaDecision(codigo: string): Promise<FichaDecision | null> {
  const a = antecedentesGuardados(codigo);
  return a ? escribirFichaDecision(a) : null;
}
