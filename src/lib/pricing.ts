import type { CompanyConfig } from "./config.js";
import type { PlanClaude } from "./condiciones.js";

/**
 * Mapeo del plan detectado en el texto de la compra a la clave de `company.pricing.planes`.
 * "Team" no distingue asiento estándar/premium en el texto de estas compras — se usa el
 * estándar por defecto y se deja registrado para revisión humana. "Code" no es un plan de
 * suscripción separado (viene incluido en Pro/Max/Team) y "Enterprise" es precio custom: ambos
 * requieren revisión manual, no fórmula automática.
 */
export function mapearPlanAClavePricing(plan: PlanClaude): { clave: string; requiereRevision: boolean } | null {
  switch (plan) {
    case "Pro":
      return { clave: "pro", requiereRevision: false };
    case "Max 5x":
      return { clave: "max5x", requiereRevision: false };
    case "Max 20x":
      return { clave: "max20x", requiereRevision: false };
    case "Team":
      return { clave: "team_standard", requiereRevision: true };
    case "Code":
    case "Enterprise":
    case "no identificado":
      return null;
  }
}

/**
 * Detecta la clave de pricing directamente desde un texto libre (p.ej. la descripción de un
 * `producto_solicitado`), distinguiendo el tramo de Team (premium vs estándar) que
 * `mapearPlanAClavePricing` no resuelve. Devuelve null si no reconoce un plan con confianza.
 * `requiereRevision` marca "Team" sin tramo explícito (se asume estándar).
 */
export function detectarPlanPricingDeTexto(texto: string): { clave: string; requiereRevision: boolean } | null {
  const t = texto.toLowerCase();
  if (/\bteam\b/.test(t)) {
    if (/premium/.test(t)) return { clave: "team_premium", requiereRevision: false };
    if (/standard|est[aá]ndar/.test(t)) return { clave: "team_standard", requiereRevision: false };
    return { clave: "team_standard", requiereRevision: true };
  }
  if (/max\s*20\s*x/.test(t)) return { clave: "max20x", requiereRevision: false };
  if (/max\s*5\s*x/.test(t) || /\bmax\b/.test(t)) return { clave: "max5x", requiereRevision: false };
  if (/\bpro\b/.test(t)) return { clave: "pro", requiereRevision: false };
  return null;
}

/**
 * Tipo de cambio USD/CLP: se consulta en vivo al "dólar observado" (Banco Central de Chile,
 * vía mindicador.cl, API pública sin auth) para no dejar un número fijo desactualizándose con
 * el tiempo. `fx_fallback_clp_por_usd` en company.json es el respaldo si el servicio falla.
 */
export async function obtenerTipoCambioUsdClp(fallback: number): Promise<{ valor: number; fuente: string }> {
  try {
    const res = await fetch("https://mindicador.cl/api/dolar", { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as { serie: { fecha: string; valor: number }[] };
    const ultimo = json.serie?.[0];
    if (!ultimo || typeof ultimo.valor !== "number") throw new Error("respuesta sin serie de valores");
    return { valor: ultimo.valor, fuente: `mindicador.cl (dólar observado, ${ultimo.fecha.slice(0, 10)})` };
  } catch (err) {
    return { valor: fallback, fuente: `fallback fijo en company.json (fx en vivo falló: ${(err as Error).message})` };
  }
}

export interface LineaCotizada {
  plan: string;
  cantidad: number;
  precio_lista_usd_mes: number;
  meses: number;
  markup_pct: number;
  costo_usd_total: number;
  lista_clp_total: number; // precio de lista en CLP (neto, antes de IVA)
  costo_clp_total: number; // costo real = lista + IVA de compra (lo que paga KeepSync)
  neto_clp_unitario: number; // base imponible de la venta = costo + markup
  neto_clp_total: number;
  iva_clp_total: number; // IVA de la venta (sobre el neto de venta)
  total_clp_unitario: number;
  total_clp_total: number;
}

/**
 * Fórmula de precio (definida por el usuario):
 *   1. base = precio de lista publicado por Anthropic (USD × meses) → CLP con el dólar observado.
 *   2. costo = base + IVA (el precio incluye IVA porque KeepSync paga IVA al adquirir la licencia).
 *   3. neto de venta = costo + markup (markup_pct sobre el costo con IVA).
 *   4. oferta final (total) = neto de venta + IVA (el IVA que se factura al organismo).
 * Es decir, total = base × (1+iva) × (1+markup) × (1+iva). El IVA aparece dos veces a propósito:
 * una como parte del costo de adquisición y otra como el IVA de la venta que se declara en la
 * factura. En la cotización se muestra "Neto" (base imponible de la venta) + "IVA" = "Total".
 */
export function cotizarLinea(
  planKey: string,
  company: CompanyConfig,
  cantidad: number,
  meses: number,
  fxClpPorUsd: number,
): LineaCotizada {
  const plan = company.pricing.planes[planKey];
  if (!plan) {
    throw new Error(
      `Plan "${planKey}" no está en company.json (pricing.planes). Planes disponibles: ${Object.keys(company.pricing.planes).join(", ")}`,
    );
  }
  const iva = company.pricing.iva_pct / 100;
  const markup = company.pricing.markup_pct / 100;

  const costoUsdUnitario = plan.precio_lista_usd_mes * meses;
  const listaClpUnitario = costoUsdUnitario * fxClpPorUsd; // base: precio de lista en CLP (neto)
  const costoClpUnitario = listaClpUnitario * (1 + iva); // costo = lista + IVA de compra
  const netoClpUnitario = costoClpUnitario * (1 + markup); // neto de venta = costo + markup
  const totalClpUnitario = netoClpUnitario * (1 + iva); // total = neto de venta + IVA de venta

  const netoClpTotal = netoClpUnitario * cantidad;
  const totalClpTotal = totalClpUnitario * cantidad;

  return {
    plan: plan.nombre,
    cantidad,
    precio_lista_usd_mes: plan.precio_lista_usd_mes,
    meses,
    markup_pct: company.pricing.markup_pct,
    costo_usd_total: round2(costoUsdUnitario * cantidad),
    lista_clp_total: round0(listaClpUnitario * cantidad),
    costo_clp_total: round0(costoClpUnitario * cantidad),
    neto_clp_unitario: round0(netoClpUnitario),
    neto_clp_total: round0(netoClpTotal),
    iva_clp_total: round0(totalClpTotal - netoClpTotal),
    total_clp_unitario: round0(totalClpUnitario),
    total_clp_total: round0(totalClpTotal),
  };
}

function round0(n: number): number {
  return Math.round(n);
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
