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
  costo_usd_total: number;
  costo_clp_total: number;
  neto_clp_unitario: number;
  neto_clp_total: number;
  iva_clp_total: number;
  total_clp_unitario: number;
  total_clp_total: number;
}

/**
 * Precio de venta = costo publicado por Anthropic (USD, convertido a CLP con el dólar
 * observado) + margen_pct + iva_pct, aplicados en cascada (neto = costo*(1+margen),
 * total = neto*(1+iva)) — igual que se factura en Chile: neto + IVA = total.
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
  const costoUsdUnitario = plan.precio_lista_usd_mes * meses;
  const costoUsdTotal = costoUsdUnitario * cantidad;
  const costoClpUnitario = costoUsdUnitario * fxClpPorUsd;
  const netoClpUnitario = costoClpUnitario * (1 + company.pricing.margen_pct / 100);
  const totalClpUnitario = netoClpUnitario * (1 + company.pricing.iva_pct / 100);

  const netoClpTotal = netoClpUnitario * cantidad;
  const totalClpTotal = totalClpUnitario * cantidad;

  return {
    plan: plan.nombre,
    cantidad,
    precio_lista_usd_mes: plan.precio_lista_usd_mes,
    meses,
    costo_usd_total: round2(costoUsdTotal),
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
