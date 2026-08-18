import type { CompraAgilDetalle } from "./api.js";
import type { Condiciones } from "./condiciones.js";
import { cotizarLinea, mapearPlanAClavePricing, detectarPlanPricingDeTexto, type LineaCotizada } from "./pricing.js";
import type { CompanyConfig } from "./config.js";

export interface LineaPlan {
  clave: string;
  cantidad: number;
  meses: number;
  requiereRevision: boolean;
}

/**
 * Arma las líneas a cotizar. Si la compra itemiza varios tramos en `productos_solicitados`
 * (p.ej. 1 Team Premium + 10 Team Standard, como pide Providencia), genera una línea por tramo
 * detectando el plan de cada producto y agrupando por clave de pricing. Si es un solo producto,
 * o algún producto no mapea a un plan conocido, cae a la detección única de `extraerCondiciones`
 * (comportamiento previo). Devuelve null si no puede determinar plan y cantidad con confianza.
 *
 * Movida tal cual desde `cotizar.ts` (antes privada) para que el calificador de admisibilidad
 * (ver PLAN-VOLUMEN.md) pueda reusar exactamente esta misma lógica sin duplicarla.
 */
export function construirLineasACotizar(
  detalle: CompraAgilDetalle,
  condiciones: Condiciones,
  meses: number,
): LineaPlan[] | null {
  const productos = detalle.productos_solicitados ?? [];
  if (productos.length > 1) {
    const porClave = new Map<string, LineaPlan>();
    for (const p of productos) {
      const det = detectarPlanPricingDeTexto(`${p.nombre} ${p.descripcion}`);
      if (!det || !p.cantidad || p.cantidad < 1) return null; // no confiable → cae a tramo único
      const e = porClave.get(det.clave) ?? { clave: det.clave, cantidad: 0, meses, requiereRevision: false };
      e.cantidad += p.cantidad;
      e.requiereRevision = e.requiereRevision || det.requiereRevision;
      porClave.set(det.clave, e);
    }
    if (porClave.size > 0) return [...porClave.values()];
  }
  const planMapeado = mapearPlanAClavePricing(condiciones.plan_detectado);
  if (!planMapeado || !condiciones.cantidad_usuarios) return null;
  return [{ clave: planMapeado.clave, cantidad: condiciones.cantidad_usuarios, meses, requiereRevision: planMapeado.requiereRevision }];
}

export interface ResultadoCotizacion {
  lineasCotizadas: LineaCotizada[];
  netoClp: number;
  ivaClp: number;
  totalClp: number;
  cantidadTotal: number;
}

/** Cotiza cada línea y suma. Sin efectos secundarios (no genera archivos ni consulta la API). */
export function calcularCotizacion(
  lineasPlan: LineaPlan[],
  company: CompanyConfig,
  fxClpPorUsd: number,
): ResultadoCotizacion {
  const lineasCotizadas = lineasPlan.map((l) => cotizarLinea(l.clave, company, l.cantidad, l.meses, fxClpPorUsd));
  return {
    lineasCotizadas,
    netoClp: lineasCotizadas.reduce((a, l) => a + l.neto_clp_total, 0),
    ivaClp: lineasCotizadas.reduce((a, l) => a + l.iva_clp_total, 0),
    totalClp: lineasCotizadas.reduce((a, l) => a + l.total_clp_total, 0),
    cantidadTotal: lineasCotizadas.reduce((a, l) => a + l.cantidad, 0),
  };
}

export interface EvaluacionTope {
  cabeBajoTope: boolean;
  /** % de margen bajo el tope. Negativo si se pasa. NaN si no hay tope detectable (topeClp <= 0). */
  holguraPct: number;
}

export function evaluarTope(totalClp: number, topeClp: number): EvaluacionTope {
  if (topeClp <= 0) return { cabeBajoTope: false, holguraPct: NaN };
  return { cabeBajoTope: totalClp <= topeClp, holguraPct: ((topeClp - totalClp) / topeClp) * 100 };
}

export interface EstimacionTotal extends ResultadoCotizacion, EvaluacionTope {
  lineasPlan: LineaPlan[];
}

/**
 * Estima el total de una cotización SIN generar PPTX/PDF — para poder decidir "¿cabe bajo el
 * tope?" antes de pagar el costo de renderizar documentos con Chromium. Antes de esta función,
 * ese chequeo ocurría después de generar los archivos en `cotizar.ts`; 3 de los 4 casos que el
 * proyecto detuvo a mano fueron justamente por tope < costo real (ver PLAN-VOLUMEN.md).
 *
 * Devuelve null en el mismo caso que `construirLineasACotizar`: no se pudo determinar plan y
 * cantidad con confianza — nunca adivina.
 */
export function estimarTotal(
  detalle: CompraAgilDetalle,
  condiciones: Condiciones,
  company: CompanyConfig,
  fxClpPorUsd: number,
): EstimacionTotal | null {
  const meses = condiciones.meses_vigencia ?? 12;
  const lineasPlan = construirLineasACotizar(detalle, condiciones, meses);
  if (!lineasPlan) return null;
  const cotizacion = calcularCotizacion(lineasPlan, company, fxClpPorUsd);
  const evaluacion = evaluarTope(cotizacion.totalClp, condiciones.tope_clp);
  return { lineasPlan, ...cotizacion, ...evaluacion };
}
