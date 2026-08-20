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
  /** Etiquetas de acreditación exigidas por el texto (ver `detectarAcreditacionesExigidas`), p.ej. "distribuidor_autorizado". */
  acreditaciones_exigidas: string[];
}

/** Frases que en la práctica de Compra Ágil declaran una condición de inadmisibilidad. */
const PATRONES_EXCLUYENTE = [
  /inadmisible[a-záéíóú]*/gi,
  /de lo contrario[^.]*\./gi,
  /no ser[aá]n? consideradas? ofertas[^.]*\./gi,
  /quedar[aá][^.]*fuera[^.]*\./gi,
  /obligatorio[^.]*\./gi,
];

/**
 * Instrucciones enfáticas de adjuntar documentos (p.ej. "IMPORTANTE POR FAVOR ADJUNTAR PATENTE
 * MUNICIPAL VIGENTE Y COTIZACIÓN FORMAL"). Se monitorean como restricción porque condicionan la
 * admisibilidad de la oferta aunque no usen la palabra "inadmisible": el organismo puede exigir
 * el documento en un plazo perentorio o descartar la oferta si no se acompaña.
 */
const PATRONES_REQUISITO_ADJUNTO = [
  /\b(?:importante|por favor|favor de|se solicita|se requiere|deber[aá]n?|se debe(?:r[aá])?)\b[^.\n]*\badjunt\w*[^.\n]*/gi,
  /\badjunt\w*[^.\n]*\bvigente\b[^.\n]*/gi,
  /\bsi no (?:adjunta|acompa[nñ]a|presenta|incluye)\b[^.\n]*/gi,
];

/**
 * Frases que declaran una exigencia de acreditación como proveedor autorizado — el gate que un
 * comprador declaró textualmente en al menos un caso real (`output/informe-nicho-claude.md`:
 * "Proveedores no entregan Certificado o carta vigente que acredite proveedor autorizado...").
 * La etiqueta debe calzar con los valores usados en `acreditaciones_conocidas_faltantes` de
 * `config/categorias.json` (ver PLAN-VOLUMEN.md, Fase 4) — solo bloquea si la categoría la declaró
 * ahí, así que el día que se resuelva el insumo de fulfillment deja de bloquear sin tocar código.
 */
const PATRONES_ACREDITACION: { patron: RegExp; etiqueta: string }[] = [
  { patron: /distribuidor(?:es)?\s+autorizado/i, etiqueta: "distribuidor_autorizado" },
  { patron: /canal\s+oficial/i, etiqueta: "canal_oficial" },
  { patron: /carta\s+(?:del\s+)?fabricante/i, etiqueta: "carta_fabricante" },
  { patron: /proveedor\s+autorizado|carta\s+vigente\s+que\s+acredite/i, etiqueta: "distribuidor_autorizado" },
  // Las Compras Ágiles de capacitación suelen exigir ser OTEC registrada en SENCE. Se detecta para
  // que la exigencia aparezca en la tarjeta; NO está en `acreditaciones_conocidas_faltantes` de las
  // categorías de cursos porque no está confirmado si KeepSync lo es — declararlo ahí haría que el
  // calificador las descarte solas, y eso es una decisión del usuario, no un supuesto del agente.
  { patron: /\botec\b|organismo\s+t[eé]cnico\s+de\s+capacitaci[oó]n|\bsence\b/i, etiqueta: "otec_sence" },
];

/** Etiquetas de acreditación exigidas por el texto (deduplicadas), en el mismo vocabulario que `acreditaciones_conocidas_faltantes`. */
export function detectarAcreditacionesExigidas(texto: string): string[] {
  return [...new Set(PATRONES_ACREDITACION.filter((p) => p.patron.test(texto)).map((p) => p.etiqueta))];
}

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

/** Normaliza una frase capturada: colapsa espacios y quita marcas de markdown/adornos en los bordes. */
function limpiarFrase(frase: string): string {
  return frase
    .replace(/\s+/g, " ")
    .replace(/^[*\s"'¡¿(]+/, "")
    .replace(/[*\s"']+$/, "")
    .trim();
}

/** Descarta frases que son subcadena (case-insensitive) de otra frase más larga ya capturada,
 * para no reportar el mismo requisito varias veces cuando varios patrones solapan. */
function dedupPorContencion(frases: string[]): string[] {
  const ordenadas = [...frases].sort((a, b) => b.length - a.length);
  const resultado: string[] = [];
  for (const frase of ordenadas) {
    const lower = frase.toLowerCase();
    if (!resultado.some((r) => r.toLowerCase().includes(lower))) resultado.push(frase);
  }
  return resultado;
}

function extraerCoincidencias(texto: string, patrones: RegExp[]): string[] {
  const encontrados = new Set<string>();
  for (const patron of patrones) {
    const matches = texto.matchAll(patron);
    for (const m of matches) {
      const frase = limpiarFrase(m[0]);
      if (frase.length > 3) encontrados.add(frase);
    }
  }
  return dedupPorContencion([...encontrados]);
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
    excluyentes: extraerCoincidencias(textoCompleto, [
      ...PATRONES_EXCLUYENTE,
      ...PATRONES_REQUISITO_ADJUNTO,
    ]),
    competencia_ofertas: detalle.resumen.total_ofertas_recibidas,
    acreditaciones_exigidas: detectarAcreditacionesExigidas(textoCompleto),
  };
}
