/**
 * Regla de cálculo para cotizaciones cuyo costo base está en USD (fijada por el usuario el
 * 2026-08-28). Es una regla de **negocio**, no ligada a un nicho concreto: hoy no reemplaza la
 * fórmula ya en producción de `cotizarLinea` (`src/lib/pricing.ts`, licencias Claude —
 * tipo de cambio observado sin recargo, markup_pct configurable en company.json, hoy 10%). Antes
 * de usarla para reemplazar esa fórmula, confirmar con el usuario si es una actualización de la
 * misma regla o una regla nueva para otro tipo de costo en USD.
 *
 * Los cinco pasos, en orden (cada uno se aplica sobre el resultado del anterior):
 *   1. tipo de cambio ajustado = tipo de cambio observado × (1 + 5,5%).
 *   2. costo CLP = monto USD × tipo de cambio ajustado.
 *   3. costo con impuesto = costo CLP × (1 + 19%) — impuesto no recuperable, costo para KeepSync
 *      (no es el IVA de venta: es un impuesto que KeepSync paga y no puede recuperar, así que se
 *      trata como mayor costo antes de calcular el markup).
 *   4. precio de cotización = costo con impuesto × (1 + 15%) — markup sobre el costo ya con el
 *      impuesto no recuperable adentro. Este es el valor NETO a usar en la cotización.
 *   5. valor final = precio de cotización × (1 + 19%) — IVA de venta, para presentar el total al
 *      organismo comprador.
 *
 * Es decir: valor_final = monto_usd × tc_observado × 1,055 × 1,19 × 1,15 × 1,19.
 */

export const RECARGO_TIPO_CAMBIO_PCT = 5.5;
export const IMPUESTO_NO_RECUPERABLE_PCT = 19;
export const MARKUP_USD_PCT = 15;
export const IVA_VENTA_PCT = 19;

export interface CotizacionUsdPaso {
  paso: string;
  descripcion: string;
  valor_clp: number;
}

export interface CotizacionUsdResultado {
  monto_usd: number;
  tipo_cambio_observado: number;
  recargo_tipo_cambio_pct: number;
  tipo_cambio_ajustado: number;
  costo_clp: number;
  impuesto_no_recuperable_pct: number;
  costo_con_impuesto_clp: number;
  markup_pct: number;
  /** Precio neto a utilizar en la cotización (antes del IVA de venta). */
  precio_cotizacion_clp: number;
  iva_venta_pct: number;
  /** Valor final a presentar al organismo comprador (precio de cotización + IVA de venta). */
  valor_final_clp: number;
  pasos: CotizacionUsdPaso[];
}

/**
 * Aplica la regla de cotización en USD descrita arriba a un monto en dólares, dado el tipo de
 * cambio observado (sin ajustar). No consulta ningún servicio: quien llame decide de dónde sale
 * `tipoCambioObservado` — `obtenerTipoCambioUsdClp` en `src/lib/pricing.ts` ya sabe pedirlo en
 * vivo a mindicador.cl con fallback fijo.
 */
export function calcularCotizacionUsd(montoUsd: number, tipoCambioObservado: number): CotizacionUsdResultado {
  if (!(montoUsd > 0)) {
    throw new Error(`monto_usd debe ser mayor que 0 (recibido: ${montoUsd})`);
  }
  if (!(tipoCambioObservado > 0)) {
    throw new Error(`tipo_cambio_observado debe ser mayor que 0 (recibido: ${tipoCambioObservado})`);
  }

  const tipoCambioAjustado = tipoCambioObservado * (1 + RECARGO_TIPO_CAMBIO_PCT / 100);
  const costoClp = montoUsd * tipoCambioAjustado;
  const costoConImpuestoClp = costoClp * (1 + IMPUESTO_NO_RECUPERABLE_PCT / 100);
  const precioCotizacionClp = costoConImpuestoClp * (1 + MARKUP_USD_PCT / 100);
  const valorFinalClp = precioCotizacionClp * (1 + IVA_VENTA_PCT / 100);

  return {
    monto_usd: montoUsd,
    tipo_cambio_observado: tipoCambioObservado,
    recargo_tipo_cambio_pct: RECARGO_TIPO_CAMBIO_PCT,
    tipo_cambio_ajustado: round2(tipoCambioAjustado),
    costo_clp: round0(costoClp),
    impuesto_no_recuperable_pct: IMPUESTO_NO_RECUPERABLE_PCT,
    costo_con_impuesto_clp: round0(costoConImpuestoClp),
    markup_pct: MARKUP_USD_PCT,
    precio_cotizacion_clp: round0(precioCotizacionClp),
    iva_venta_pct: IVA_VENTA_PCT,
    valor_final_clp: round0(valorFinalClp),
    pasos: [
      {
        paso: "1. Tipo de cambio ajustado",
        descripcion: `Tipo de cambio observado ($${tipoCambioObservado}) + ${RECARGO_TIPO_CAMBIO_PCT}%`,
        valor_clp: round2(tipoCambioAjustado),
      },
      {
        paso: "2. Costo",
        descripcion: `USD ${montoUsd} × tipo de cambio ajustado`,
        valor_clp: round0(costoClp),
      },
      {
        paso: "3. Costo con impuesto no recuperable",
        descripcion: `Costo + ${IMPUESTO_NO_RECUPERABLE_PCT}% (impuesto que KeepSync no puede recuperar, se trata como costo)`,
        valor_clp: round0(costoConImpuestoClp),
      },
      {
        paso: "4. Precio de cotización (neto)",
        descripcion: `Costo con impuesto + ${MARKUP_USD_PCT}% de markup — este es el precio a utilizar en la cotización`,
        valor_clp: round0(precioCotizacionClp),
      },
      {
        paso: "5. Valor final (con IVA de venta)",
        descripcion: `Precio de cotización + ${IVA_VENTA_PCT}% de IVA — valor final a presentar`,
        valor_clp: round0(valorFinalClp),
      },
    ],
  };
}

function round0(n: number): number {
  return Math.round(n);
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
