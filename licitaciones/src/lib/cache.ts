/**
 * Caché en disco de las fichas de licitación (`licitaciones/data/<codigo>/`), y reconstrucción de
 * los hallazgos a partir de ella **sin gastar una sola llamada a la API**.
 *
 * Vive en una lib —y no dentro del script del radar, que es donde nació— porque la usan dos
 * comandos: `radar-licitaciones --desde-cache` (republicar cuando la cuota diaria está agotada) y
 * `antecedentes-licitacion` (republicar la página ya con los enlaces a los documentos, que es lo
 * que ese comando acaba de descubrir). La cuota de esta API es escasa: todo lo que se pueda hacer
 * desde la caché, se hace desde la caché.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { LIC_ROOT_DIR } from "./config.js";
import type { LicitacionDetalle } from "./api.js";
import { extraerCondicionesLicitacion } from "./condiciones.js";
import { cierreYaPaso } from "./tiempo.js";
import type { HallazgoLicitacion } from "./pagina.js";

export const DATA_DIR = path.join(LIC_ROOT_DIR, "data");

/** Ficha guardada por una corrida anterior, si existe. */
export function fichaCacheada(codigo: string): LicitacionDetalle | null {
  const ruta = path.join(DATA_DIR, codigo, "detalle.json");
  if (!existsSync(ruta)) return null;
  try {
    return JSON.parse(readFileSync(ruta, "utf-8")) as LicitacionDetalle;
  } catch {
    return null;
  }
}

export function guardarFicha(detalle: LicitacionDetalle, condiciones: unknown): void {
  const dir = path.join(DATA_DIR, detalle.CodigoExterno);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "detalle.json"), JSON.stringify(detalle, null, 2), "utf-8");
  writeFileSync(path.join(dir, "condiciones.json"), JSON.stringify(condiciones, null, 2), "utf-8");
}

/**
 * Vuelve a armar los hallazgos desde las fichas ya guardadas. Las licitaciones cuyo cierre ya pasó
 * se descartan: la caché acumula corridas anteriores y una licitación cerrada no es una oportunidad.
 */
export function hallazgosDesdeCache(): { hallazgos: HallazgoLicitacion[]; cerradas: number } {
  if (!existsSync(DATA_DIR)) return { hallazgos: [], cerradas: 0 };
  const hallazgos: HallazgoLicitacion[] = [];
  let cerradas = 0;
  for (const entrada of readdirSync(DATA_DIR, { withFileTypes: true })) {
    if (!entrada.isDirectory()) continue;
    const detalle = fichaCacheada(entrada.name);
    if (!detalle) continue;
    const cierre = detalle.FechaCierre ?? detalle.Fechas?.FechaCierre;
    if (cierre && cierreYaPaso(cierre)) {
      cerradas++;
      continue;
    }
    const condiciones = extraerCondicionesLicitacion(detalle);
    guardarFicha(detalle, condiciones); // reescribe condiciones.json con el extractor vigente
    hallazgos.push({ item: detalle, detalle, condiciones });
  }
  hallazgos.sort((a, b) => a.detalle.CodigoExterno.localeCompare(b.detalle.CodigoExterno));
  return { hallazgos, cerradas };
}
