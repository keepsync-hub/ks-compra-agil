/**
 * Score de apertura de una Compra Ágil (0–100%).
 *
 * Regla fijada por el usuario el 2026-08-22:
 *
 *   100% = la compra no presenta ningún filtro o criterio que dirija la adjudicación hacia un
 *          proveedor con una característica, capacidad o certificación muy particular.
 *   −5%  = por cada criterio que hoy NO está resuelto a favor de KeepSync.
 *
 * "No resuelto a favor" son dos cosas distintas y la diferencia importa al leer la ficha, aunque
 * penalicen igual: `sin_informacion` es que falta revisarlo, y `no_cumple` es que ya se revisó y
 * KeepSync no lo cumple. El segundo estado se agregó el 2026-09-08, cuando el usuario confirmó que
 * KeepSync **no** es OTEC registrada en SENCE. Hasta ese día el modelo solo sabía preguntar: los
 * criterios de OTEC estaban en `sin_informacion` y la única salida era `cubierto`, que afirma lo
 * contrario de lo que pasó. Marcarlos `cubierto` habría subido el score justo con la peor noticia.
 *
 * Y por qué `no_cumple` sigue descontando: el score mide cuánto de la admisibilidad no está
 * resuelto a favor. Un criterio confirmado como incumplido no deja de ser el obstáculo que era —es
 * el mismo obstáculo, ahora sin la esperanza de que se resuelva mirándolo—, así que dejar de
 * penalizarlo convertiría una mala noticia en un score más alto. Lo que sí cambia es que ya no hay
 * nada que averiguar: por eso se muestra aparte.
 *
 * El caso en que una confirmación negativa sí sube el score es distinto y va como `cubierto`: la
 * exigencia era condicional y al no cumplirse la condición desaparece. Puerto Montt pide el
 * certificado SENCE "en caso de estar acreditado": KeepSync no lo está, no hay certificado que
 * presentar y las bases no lo penalizan. Ahí no queda obstáculo, queda un trámite menos.
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
 * El score sube solo, sin tocar código, a medida que una persona confirma criterios en
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

export type EstadoCriterio = "sin_informacion" | "cubierto" | "no_cumple";

export interface CriterioDireccionador {
  id: string;
  /** Qué exige el organismo, en términos verificables. */
  exige: string;
  /** De dónde sale la exigencia (documento y apartado). Nada se infiere sin cita. */
  cita: string;
  tipo: TipoCriterio;
  /**
   * `sin_informacion`: hay que revisarlo y hoy no sabemos si KeepSync lo cumple → penaliza.
   * `cubierto`: ya se confirmó que se cumple, o que la exigencia no aplica (con la evidencia en
   *   `resuelto_por`) → no penaliza.
   * `no_cumple`: ya se confirmó que KeepSync NO lo cumple (con la evidencia en `resuelto_por`) →
   *   penaliza igual que `sin_informacion`, porque el obstáculo sigue ahí; lo que cambia es que ya
   *   no hay nada que averiguar.
   */
  estado: EstadoCriterio;
  /** Con qué evidencia se resolvió. Obligatorio cuando `estado` es "cubierto" o "no_cumple". */
  resuelto_por?: string;
}

export interface ScoreCapacitacion {
  /** 0–100, entero. */
  score: number;
  sinInformacion: number;
  cubiertos: number;
  /** Criterios confirmados como incumplidos. Descuentan, pero ya no hay qué averiguar. */
  noCumple: number;
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
  const sinInformacion = criterios.filter((c) => c.estado === "sin_informacion");
  const noCumple = criterios.filter((c) => c.estado === "no_cumple");
  // Los dos descuentan (ver la cabecera del archivo): el score mide lo que no está resuelto a
  // favor, y un criterio confirmado como incumplido es el mismo obstáculo de antes.
  const descuentan = [...sinInformacion, ...noCumple];

  const conteo = new Map<TipoCriterio, number>();
  for (const c of descuentan) conteo.set(c.tipo, (conteo.get(c.tipo) ?? 0) + 1);

  return {
    // El piso en 0 importa: una compra con más de 20 criterios abiertos daría negativo, y un
    // porcentaje negativo no significa nada para quien lee la página.
    score: Math.max(0, 100 - descuentan.length * PENALIZACION_POR_CRITERIO_PCT),
    sinInformacion: sinInformacion.length,
    noCumple: noCumple.length,
    cubiertos: criterios.length - sinInformacion.length - noCumple.length,
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
