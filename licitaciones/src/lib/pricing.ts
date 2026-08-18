import type { CompanyConfigLicitaciones, ItemPricingLicitaciones } from "./config.js";

/**
 * A diferencia de licencias Claude (precio de lista público de Anthropic en USD, con una fórmula
 * de doble IVA porque es una compra en el extranjero que luego se revende), acá KeepSync es quien
 * define directamente su costo real en CLP por cada ítem de su catálogo de gestión documental —
 * no hay conversión de moneda ni "precio de lista" de un tercero que copiar. La fórmula es la
 * estándar de una factura de servicios local: total = costo × (1+markup) × (1+iva).
 *
 * Heurística de mapeo de texto libre (descripción de un ítem de la licitación) a una clave del
 * catálogo `company.pricing.items`. Ninguno de estos nombres de clave está fijado por una fuente
 * externa — se definen en `config/company.json.example` y el usuario los ajusta a lo que
 * realmente ofrece KeepSync.
 */
export function detectarItemPricingDeTexto(texto: string): { clave: string; requiereRevision: boolean } | null {
  const t = texto.toLowerCase();
  if (/licencia|usuario|seat|puesto/.test(t) && /(gesti[oó]n documental|documental|oficina de partes|sgd)/.test(t)) {
    return { clave: "licencia_sgd_usuario_mes", requiereRevision: false };
  }
  if (/migra|digitaliza/.test(t) && /documento|archivo|expediente/.test(t)) {
    return { clave: "migracion_documento", requiereRevision: false };
  }
  if (/implementaci[oó]n|puesta en marcha|instalaci[oó]n/.test(t)) {
    return { clave: "implementacion_proyecto", requiereRevision: false };
  }
  if (/capacitaci[oó]n|entrenamiento|inducci[oó]n/.test(t)) {
    return { clave: "capacitacion_hora", requiereRevision: true }; // cantidad de horas rara vez es explícita
  }
  if (/soporte|mantenci[oó]n|mesa de ayuda/.test(t)) {
    return { clave: "soporte_mensual", requiereRevision: false };
  }
  if (/integraci[oó]n|interoperabilidad/.test(t)) {
    return { clave: "integracion_hora", requiereRevision: true };
  }
  return null;
}

export interface LineaCotizada {
  descripcion: string;
  cantidad: number;
  unidad: ItemPricingLicitaciones["unidad"];
  costo_clp_unitario: number;
  markup_pct: number;
  neto_clp_unitario: number;
  neto_clp_total: number;
  iva_clp_total: number;
  total_clp_unitario: number;
  total_clp_total: number;
}

export function cotizarItem(itemKey: string, company: CompanyConfigLicitaciones, cantidad: number): LineaCotizada {
  const item = company.pricing.items[itemKey];
  if (!item) {
    throw new Error(
      `Ítem "${itemKey}" no está en config/company.json (pricing.items). Ítems disponibles: ${Object.keys(company.pricing.items).join(", ")}`,
    );
  }
  const iva = company.pricing.iva_pct / 100;
  const markup = company.pricing.markup_pct / 100;

  const netoClpUnitario = item.costo_clp * (1 + markup);
  const totalClpUnitario = netoClpUnitario * (1 + iva);
  const netoClpTotal = netoClpUnitario * cantidad;
  const totalClpTotal = totalClpUnitario * cantidad;

  return {
    descripcion: item.nombre,
    cantidad,
    unidad: item.unidad,
    costo_clp_unitario: item.costo_clp,
    markup_pct: company.pricing.markup_pct,
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
