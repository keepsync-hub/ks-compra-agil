/**
 * Score de apertura de una Compra Ágil (0–100%).
 *
 * Regla fijada por el usuario el 2026-08-22:
 *
 *   100% = la compra no presenta ningún filtro o criterio que dirija la adjudicación hacia un
 *          proveedor con una característica, capacidad o certificación muy particular.
 *   −5%  = por cada criterio que haya que revisar y del que hoy NO se tiene información.
 *
 * Para qué sirve: ordenar el foco. Un score alto no dice que se vaya a ganar — dice que lo que
 * separa a KeepSync de poder presentarse son pocas cosas y son averiguables. Un score bajo marca
 * una compra escrita alrededor de un perfil de proveedor que ya existe (12 órdenes de compra
 * previas del mismo curso, un magíster específico, infraestructura física), donde el esfuerzo de
 * cotizar rinde menos.
 *
 * Qué NO es: una probabilidad de adjudicación. No pondera monto, competencia ni precio. Es una
 * medida de cuánto de la admisibilidad está hoy sin resolver.
 *
 * El score sube solo,sin tocar código, a medida que una persona confirma criterios en
 * `config/capacitaciones.json` (`estado: "cubierto"` con su evidencia). Esa es la gracia: el
 * porcentaje es el avance de una lista de verificación real, no una opinión.
 */

export const PENALIZACION_POR_CRITERIO_PCT = 5;

export type TipoCriterio =
  | "certificacion"
  | "titulo_grado"
  | "experiencia_relator"
  | "historial_portal"
  | "infraestructura"
  | "tributario"
  | "identidad"
  | "alcance";

export interface CriterioDireccionador {
  id: string;
  /** Qué exige el organismo, en términos verificables. */
  exige: string;
  /** De dónde sale la exigencia (documento y apartado). Nada se infiere sin cita. */
  cita: string;
  tipo: TipoCriterio;
  /**
   * `sin_informacion`: hay que revisarlo y hoy no sabemos si KeepSync lo cumple → penaliza.
   * `cubierto`: ya se confirmó que se cumple (con la evidencia en `resuelto_por`) → no penaliza.
   */
  estado: "sin_informacion" | "cubierto";
  /** Por qué se considera cubierto. Obligatorio cuando `estado` es "cubierto". */
  resuelto_por?: string;
}

export interface ScoreCapacitacion {
  /** 0–100, entero. */
  score: number;
  sinInformacion: number;
  cubiertos: number;
  total: number;
  /** Cuántos criterios sin información hay de cada tipo, de mayor a menor. */
  porTipo: { tipo: TipoCriterio; n: number }[];
}

export const GLOSA_TIPO: Record<TipoCriterio, string> = {
  certificacion: "Certificación",
  titulo_grado: "Título o grado",
  experiencia_relator: "Experiencia del relator",
  historial_portal: "Historial en el portal",
  infraestructura: "Infraestructura",
  tributario: "Régimen tributario",
  identidad: "Identidad del oferente",
  alcance: "Alcance por definir",
};

export function calcularScore(criterios: CriterioDireccionador[]): ScoreCapacitacion {
  const pendientes = criterios.filter((c) => c.estado === "sin_informacion");

  const conteo = new Map<TipoCriterio, number>();
  for (const c of pendientes) conteo.set(c.tipo, (conteo.get(c.tipo) ?? 0) + 1);

  return {
    // El piso en 0 importa: una compra con más de 20 criterios abiertos daría negativo, y un
    // porcentaje negativo no significa nada para quien lee la página.
    score: Math.max(0, 100 - pendientes.length * PENALIZACION_POR_CRITERIO_PCT),
    sinInformacion: pendientes.length,
    cubiertos: criterios.length - pendientes.length,
    total: criterios.length,
    porTipo: [...conteo.entries()]
      .map(([tipo, n]) => ({ tipo, n }))
      .sort((a, b) => b.n - a.n || a.tipo.localeCompare(b.tipo)),
  };
}

/** Banda de color para la página. Los cortes son de lectura, no tienen significado propio. */
export function bandaScore(score: number): "ok" | "warn" | "bad" {
  if (score >= 75) return "ok";
  if (score >= 60) return "warn";
  return "bad";
}
