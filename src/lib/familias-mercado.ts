/**
 * Familias de servicio del mercado de Compra Ágil.
 *
 * Una familia NO es un criterio de búsqueda: nunca se le pide a la API. Se evalúa localmente sobre
 * los nombres ya medidos. Por eso su contrato es más angosto que `CategoriaNegocio` —sin
 * `variantes_q`, sin `pricing`, sin `presupuesto_requests_por_corrida`—: rellenar esos campos con
 * valores de adorno sería mentir sobre lo que la estructura hace. Los criterios de búsqueda viven en
 * `config/categorias.json`, y la propuesta de nuevos en `config/categorias-propuestas.json`.
 *
 * El embudo de tres puertas se REUSA tal cual de `src/lib/categorias.ts`
 * (`compilarPatrones` + `confirmarCategoriaEnTexto`), no se reimplementa: son las mismas
 * validaciones afinadas contra casos reales, incluida la prohibición de los flags "g"/"y".
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { ROOT_DIR } from "./config.js";
import {
  compilarPatrones,
  confirmarCategoriaEnTexto,
  type PatronesConfirmables,
  type ResultadoConfirmacion,
} from "./categorias.js";

export const FAMILIAS_PATH_REL = "config/familias-mercado.json";

export interface FamiliaMercado {
  id: string;
  nombre: string;
  nombre_corto?: string;
  /** "gruesa" cubre el universo entero (para el denominador); "fina" describe la porción relevante. */
  capa: "gruesa" | "fina";
  verificacion_regex: string;
  verificacion_flags?: string;
  patron_requerido?: string;
  patron_excluyente?: string;
  /** Los términos MEDIDOS que la motivaron. Obligatorio: sin esto la familia es una conjetura. */
  _derivada_de: string[];
  /** La cifra concreta y su fecha. Obligatorio por el mismo motivo. */
  _evidencia: string;
  _patron_excluyente_nota?: string;
}

export interface FamiliaCompilada extends PatronesConfirmables {
  id: string;
  nombre: string;
  nombreCorto: string;
  capa: "gruesa" | "fina";
  derivadaDe: string[];
  evidencia: string;
}

export function cargarFamilias(): FamiliaCompilada[] {
  const p = path.join(ROOT_DIR, "config", "familias-mercado.json");
  if (!existsSync(p)) throw new Error(`Falta ${FAMILIAS_PATH_REL}.`);
  const raw = JSON.parse(readFileSync(p, "utf-8")) as { familias?: FamiliaMercado[] };
  const familias = raw.familias ?? [];
  if (familias.length === 0) throw new Error(`${FAMILIAS_PATH_REL}: "familias" vacío.`);

  return familias.map((f) => {
    if (!/^[a-z0-9-]+$/.test(f.id)) {
      throw new Error(`${FAMILIAS_PATH_REL}: id inválido "${f.id}" — debe cumplir /^[a-z0-9-]+$/.`);
    }
    // La validación que corta el sesgo circular: una familia sin evidencia medida no se carga.
    // No es documentación opcional — es la diferencia entre derivar del mercado y elegir a dedo.
    if (!Array.isArray(f._derivada_de) || f._derivada_de.length === 0) {
      throw new Error(
        `${FAMILIAS_PATH_REL}: la familia "${f.id}" no declara "_derivada_de". Toda familia debe citar los ` +
          `términos medidos que la motivaron (ver el análisis de términos de \`npm run estudio\`).`,
      );
    }
    if (!f._evidencia || f._evidencia.trim().length < 10) {
      throw new Error(
        `${FAMILIAS_PATH_REL}: la familia "${f.id}" no declara "_evidencia" (n, monto y fecha de la medición).`,
      );
    }
    const patrones = compilarPatrones(f.id, f, FAMILIAS_PATH_REL);
    return {
      ...patrones,
      id: f.id,
      nombre: f.nombre,
      nombreCorto: f.nombre_corto ?? f.nombre,
      capa: f.capa,
      derivadaDe: f._derivada_de,
      evidencia: f._evidencia,
    };
  });
}

export interface ClasificacionCompra {
  confirmadas: FamiliaCompilada[];
  descartes: { familia: FamiliaCompilada; veredicto: ResultadoConfirmacion }[];
}

/**
 * Clasifica un texto contra todas las familias. Una compra puede caer en varias (la suma de los n
 * por familia SUPERA el universo, y el informe declara cuánto). Los descartes por
 * `patron_requerido`/`patron_excluyente` se devuelven aparte y se publican, por el mismo motivo por
 * el que el radar publica su sección "Descartados por el filtro estricto": un excluyente demasiado
 * ancho, si no se lista, se ve como demanda que desaparece sin explicación.
 */
export function clasificar(familias: FamiliaCompilada[], texto: string): ClasificacionCompra {
  const confirmadas: FamiliaCompilada[] = [];
  const descartes: { familia: FamiliaCompilada; veredicto: ResultadoConfirmacion }[] = [];
  for (const f of familias) {
    const veredicto = confirmarCategoriaEnTexto(f, texto);
    if (veredicto === "confirmada") confirmadas.push(f);
    else if (veredicto !== "no-menciona") descartes.push({ familia: f, veredicto });
  }
  return { confirmadas, descartes };
}
