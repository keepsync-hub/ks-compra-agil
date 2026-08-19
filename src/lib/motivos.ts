/**
 * Clasificador de motivos declarados de fracaso (ver PLAN-VOLUMEN.md, Fase 3).
 *
 * Por qué existe: el 73% de los fracasos de Compra Ágil es atribuible al comprador (organismo que
 * se equivoca y va a republicar), no a que nuestro precio no calzara — pero `motivo_desierta` /
 * `motivo_cancelacion` es texto libre que cada organismo escribe distinto. Sin clasificar, todo
 * fracaso se ve igual en el índice, y la señal más valiosa (un error del comprador es la
 * oportunidad más limpia que existe: va a volver, corregido, en ~8 días de mediana) se pierde.
 *
 * Reglas ordenadas, la primera que calza gana — el orden importa: "error en el monto publicado"
 * clasifica `comprador` (el organismo se equivocó), no `precio` (nuestra oferta no calzó), aunque
 * ambas mencionen "monto". Esto es SOLO sobre el texto declarado por el comprador — nunca se
 * cruza aquí con si nuestro precio efectivamente cabía bajo el tope (eso lo hace `calificador.ts`
 * con `estimarTotal`, con su propia columna separada, tal como pide CLAUDE.md: nunca fusionar
 * ambas señales en una "causa real").
 */

export type CategoriaMotivo = "comprador" | "precio" | "tecnico" | "administrativo" | "sin_info";

export interface MotivoClasificado {
  categoria: CategoriaMotivo;
  regla: string;
}

interface Regla {
  categoria: CategoriaMotivo;
  regla: string;
  patron: RegExp;
}

const REGLAS: Regla[] = [
  {
    categoria: "comprador",
    regla: "el organismo declara un error propio (monto, ficha técnica, especificaciones, cantidad)",
    patron:
      /error\s+(?:involuntario\s+)?(?:en|de|al)\s+(?:el\s+|la\s+|las\s+)?(?:monto|presupuesto|estimaci[oó]n|ficha\s+t[eé]cnica|especificaciones?|n[uú]mero|cantidad(?:es)?|subir)/i,
  },
  {
    categoria: "comprador",
    regla: "el organismo va a modificar/republicar/reevaluar el requerimiento por decisión propia",
    patron:
      /se\s+modific\w*|se\s+republicar[aá]|se\s+volver[aá]\s+a\s+public\w*|se\s+tramitar[aá]\s+nuevo|nuevo\s+proceso|se\s+anula.*(?:cambio|modific)|se\s+aument[oó]|reevaluaci[oó]n|usuario\s+solicita\s+cancelar/i,
  },
  {
    categoria: "precio",
    regla: "las ofertas recibidas superan el monto/presupuesto disponible",
    patron: /supera(?:n)?\s+el\s+monto|sobrepasa(?:n)?\s+el\s+(?:monto|presupuesto)|sobre\s+el\s+presupuesto|inadmisibles?\s+seg[uú]n/i,
  },
  {
    categoria: "tecnico",
    regla: "ninguna oferta cumple las especificaciones/requisitos técnicos o la acreditación exigida",
    patron:
      /no\s+(?:se\s+)?cumple\w*|ninguna\s+oferta\s+cumple|no\s+acredita\w*|no\s+existen\s+ofertas\s+que\s+acrediten|especificaciones?\s+t[eé]cnicas|condiciones\s+m[ií]nimas|problemas\s+con\s+las?\s+especificaciones|carta\s+vigente|distribuidor\s+autorizado|canal\s+oficial|proveedor\s+autorizado/i,
  },
  {
    categoria: "administrativo",
    regla: "venció el plazo de selección, no se presentaron oferentes, o falta un documento formal exigido",
    patron: /vencimiento\s+del\s+plazo|no\s+se\s+presentan\s+oferentes|no\s+adjunta\s+cotizaci[oó]n/i,
  },
];

/**
 * Clasifica el texto de un `motivo_desierta`/`motivo_cancelacion` (o cualquier motivo declarado
 * por el organismo). Devuelve `sin_info` si no hay texto o ninguna regla calza — nunca adivina.
 */
export function clasificarMotivo(texto: string | null | undefined): MotivoClasificado {
  if (!texto || !texto.trim()) return { categoria: "sin_info", regla: "sin motivo declarado" };
  for (const r of REGLAS) {
    if (r.patron.test(texto)) return { categoria: r.categoria, regla: r.regla };
  }
  return { categoria: "sin_info", regla: "no calza con ninguna regla conocida" };
}
