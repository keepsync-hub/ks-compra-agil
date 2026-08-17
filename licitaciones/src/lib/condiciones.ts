import type { LicitacionDetalle, ItemLicitacion } from "./api.js";
import { itemsDeLicitacion } from "./api.js";

export interface CondicionesLicitacion {
  tope_clp: number;
  moneda_original: string;
  tipo_licitacion: string | null;
  plazo_contrato_dias: number | null;
  garantia_seriedad_clp: number | null;
  garantia_seriedad_dias: number | null;
  garantia_fiel_cumplimiento_clp: number | null;
  documentos_exigidos: string[];
  excluyentes: string[];
}

/** Mismos patrones de exigencia usados en Compra Ágil (`src/lib/condiciones.ts` de la raíz) —
 * el fraseo de bases administrativas chilenas es consistente entre ambos instrumentos. */
const PATRONES_EXCLUYENTE = [
  /inadmisible[a-záéíóú]*/gi,
  /de lo contrario[^.]*\./gi,
  /no ser[aá]n? consideradas? ofertas[^.]*\./gi,
  /quedar[aá][^.]*fuera[^.]*\./gi,
  /obligatorio[^.]*\./gi,
  /causal de rechazo[^.]*\./gi,
  /bases administrativas[^.]*inadmisib[^.]*\./gi,
];

const DOCUMENTOS_CONOCIDOS: { patron: RegExp; etiqueta: string }[] = [
  { patron: /patente municipal/i, etiqueta: "Patente municipal al día" },
  { patron: /certificado de vigencia/i, etiqueta: "Certificado de vigencia de la sociedad" },
  { patron: /antecedentes laborales|f30/i, etiqueta: "Certificado de antecedentes laborales (F30)" },
  { patron: /boleta de garant[ií]a|garant[ií]a de seriedad/i, etiqueta: "Garantía de seriedad de la oferta" },
  { patron: /garant[ií]a de fiel cumplimiento/i, etiqueta: "Garantía de fiel cumplimiento de contrato" },
  { patron: /factura electr[oó]nica/i, etiqueta: "Facturación electrónica" },
  { patron: /declaraci[oó]n jurada/i, etiqueta: "Declaración jurada" },
  { patron: /certificado.{0,20}anexo.{0,10}experiencia|experiencia acreditada/i, etiqueta: "Certificado de experiencia" },
];

function limpiarFrase(frase: string): string {
  return frase
    .replace(/\s+/g, " ")
    .replace(/^[*\s"'¡¿(]+/, "")
    .replace(/[*\s"']+$/, "")
    .trim();
}

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
    for (const m of texto.matchAll(patron)) {
      const frase = limpiarFrase(m[0]);
      if (frase.length > 3) encontrados.add(frase);
    }
  }
  return dedupPorContencion([...encontrados]);
}

function detectarPlazoContratoDias(texto: string): number | null {
  const m = texto.match(/(\d+)\s*d[ií]as?\s*(?:corridos|h[aá]biles)?\s*(?:de\s+)?(?:plazo|vigencia|duraci[oó]n)/i);
  if (m) return Number(m[1]);
  const meses = texto.match(/(\d+)\s*mes(es)?\s*(?:de\s+)?(?:plazo|vigencia|duraci[oó]n)/i);
  return meses ? Number(meses[1]) * 30 : null;
}

function textoCompletoDe(detalle: LicitacionDetalle, items: ItemLicitacion[]): string {
  return [detalle.Nombre, detalle.Descripcion, ...items.map((i) => i.Descripcion)].filter(Boolean).join("\n");
}

/**
 * Extrae condiciones de una ficha de licitación. IMPORTANTE: a diferencia de
 * `src/lib/condiciones.ts` de Compra Ágil (verificado contra `presupuesto.monto_disponible_clp`
 * real), acá `MontoEstimado`/`Garantia.*` son campos SIN VERIFICAR contra producción — confirmar
 * los nombres reales apenas se tenga un `LICITACIONES_API_TICKET` válido (ver api.ts).
 */
export function extraerCondicionesLicitacion(detalle: LicitacionDetalle): CondicionesLicitacion {
  const items = itemsDeLicitacion(detalle);
  const texto = textoCompletoDe(detalle, items);

  const documentosExigidos = DOCUMENTOS_CONOCIDOS.filter((d) => d.patron.test(texto)).map((d) => d.etiqueta);

  return {
    tope_clp: detalle.MontoEstimado ?? 0,
    moneda_original: detalle.Moneda ?? "CLP",
    tipo_licitacion: detalle.Tipo ?? null,
    plazo_contrato_dias: detalle.PlazosContrato?.Plazo ?? detectarPlazoContratoDias(texto),
    garantia_seriedad_clp: detalle.Garantia?.MontoGarantiaSeriedad ?? null,
    garantia_seriedad_dias: detalle.Garantia?.DiasValidezGarantiaSeriedad ?? null,
    garantia_fiel_cumplimiento_clp: detalle.Garantia?.MontoGarantiaFielCumplimiento ?? null,
    documentos_exigidos: documentosExigidos,
    excluyentes: extraerCoincidencias(texto, PATRONES_EXCLUYENTE),
  };
}
