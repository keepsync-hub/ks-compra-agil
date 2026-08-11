import type { CompraAgilDetalle } from "./api.js";

export type PlanClaude = "Pro" | "Max 5x" | "Max 20x" | "Team" | "Code" | "Enterprise" | "no identificado";

export interface Condiciones {
  tope_clp: number;
  moneda_original: string;
  cantidad_usuarios: number | null;
  plan_detectado: PlanClaude;
  plazo_entrega_dias: number | null;
  meses_vigencia: number | null;
  documentos_exigidos: string[];
  excluyentes: string[];
  competencia_ofertas: number;
}

/** Frases que en la práctica de Compra Ágil declaran una condición de inadmisibilidad. */
const PATRONES_EXCLUYENTE = [
  /inadmisible[a-záéíóú]*/gi,
  /de lo contrario[^.]*\./gi,
  /no ser[aá]n? consideradas? ofertas[^.]*\./gi,
  /quedar[aá][^.]*fuera[^.]*\./gi,
  /obligatorio[^.]*\./gi,
];

/** Documentos habitualmente exigidos en estas compras; se busca la mención literal en el texto. */
const DOCUMENTOS_CONOCIDOS: { patron: RegExp; etiqueta: string }[] = [
  { patron: /patente municipal/i, etiqueta: "Patente municipal al día" },
  { patron: /certificado de vigencia/i, etiqueta: "Certificado de vigencia de la sociedad" },
  { patron: /antecedentes laborales|f30/i, etiqueta: "Certificado de antecedentes laborales (F30)" },
  { patron: /boleta de garant[ií]a/i, etiqueta: "Boleta de garantía" },
  { patron: /factura electr[oó]nica/i, etiqueta: "Facturación electrónica" },
  { patron: /declaraci[oó]n jurada/i, etiqueta: "Declaración jurada" },
];

function detectarPlan(texto: string): PlanClaude {
  const t = texto.toLowerCase();
  if (/max\s*20\s*x/.test(t)) return "Max 20x";
  if (/max\s*5\s*x/.test(t)) return "Max 5x";
  if (/\bmax\b/.test(t)) return "Max 5x"; // "Max" sin sufijo casi siempre refiere al tier base 5x
  if (/\bteam\b/.test(t)) return "Team";
  if (/\bcode\b/.test(t)) return "Code";
  if (/enterprise/.test(t)) return "Enterprise";
  if (/\bpro\b/.test(t)) return "Pro";
  return "no identificado";
}

function detectarCantidadUsuarios(texto: string): number | null {
  const m = texto.match(/(\d+)\s*(usuarios?|licencias?|puestos?|seats?)/i);
  return m ? Number(m[1]) : null;
}

function detectarMesesVigencia(texto: string): number | null {
  const m = texto.match(/(\d+)\s*mes(es)?/i);
  return m ? Number(m[1]) : null;
}

function extraerCoincidencias(texto: string, patrones: RegExp[]): string[] {
  const encontrados = new Set<string>();
  for (const patron of patrones) {
    const matches = texto.matchAll(patron);
    for (const m of matches) {
      const frase = m[0].trim();
      if (frase.length > 3) encontrados.add(frase);
    }
  }
  return [...encontrados];
}

export function extraerCondiciones(detalle: CompraAgilDetalle): Condiciones {
  const textoCompleto = [
    detalle.nombre,
    detalle.descripcion,
    ...detalle.productos_solicitados.map((p) => p.descripcion),
  ].join("\n");

  const documentosExigidos = DOCUMENTOS_CONOCIDOS.filter((d) => d.patron.test(textoCompleto)).map(
    (d) => d.etiqueta,
  );

  const cantidadUsuarios =
    detectarCantidadUsuarios(textoCompleto) ??
    detalle.productos_solicitados.reduce((acc, p) => acc + (p.cantidad || 0), 0) ??
    null;

  return {
    // El tope viene del presupuesto declarado por la API (ya convertido a CLP), no de un
    // parseo de texto: es el número que efectivamente causa inadmisibilidad si se supera.
    tope_clp: detalle.presupuesto.monto_disponible_clp,
    moneda_original: detalle.presupuesto.moneda,
    cantidad_usuarios: cantidadUsuarios || null,
    plan_detectado: detectarPlan(textoCompleto),
    plazo_entrega_dias: detalle.entrega?.plazo_entrega_dias ?? null,
    meses_vigencia: detectarMesesVigencia(textoCompleto),
    documentos_exigidos: documentosExigidos,
    excluyentes: extraerCoincidencias(textoCompleto, PATRONES_EXCLUYENTE),
    competencia_ofertas: detalle.resumen.total_ofertas_recibidas,
  };
}
