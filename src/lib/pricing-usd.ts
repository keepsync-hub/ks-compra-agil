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
 *
 * **Cuando el proveedor publica el precio en pesos** (OpenAI cobra CLP 108.000/mes por asiento
 * Premium de ChatGPT Business en Chile, medido en el checkout el 2026-09-16) no hay conversión que
 * hacer y los pasos 1 y 2 no aplican: el costo ya está en CLP. Para eso está
 * `calcularCotizacionClp`, que entra directo al paso 3. Convertir el precio de lista en USD cuando
 * existe precio local no es equivalente: al dólar observado del 15-09-2026 daba $119.691 contra los
 * $108.000 reales, 11% de sobrecosto inventado.
 *
 * El recargo de 5,5% sí se mantiene en la variante CLP, pero por otro motivo y con otro nombre: ahí
 * no cubre riesgo cambiario sino que el proveedor reajuste su precio local durante la vigencia
 * (decisión del usuario el 2026-09-16, para cotizaciones a precio cerrado con facturación mensual).
 * Con facturación anual el precio queda bloqueado y el colchón no tiene sustento: ese caso se
 * cotiza con `aplicarRecargo: false`.
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
  const { costoConImpuestoClp, precioCotizacionClp, valorFinalClp, pasos } = cierreDesdeCosto(costoClp, 3);

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
      ...pasos,
    ],
  };
}

/**
 * Los tres últimos pasos de la regla —impuesto no recuperable, markup, IVA de venta— son los
 * mismos parta de un costo en dólares o de uno ya en pesos. Viven acá para que las dos variantes
 * no tengan cada una su copia de la cadena: que se desalineen es exactamente cómo se rompen las
 * fórmulas duplicadas de este repo.
 *
 * `numeroPrimerPaso` es sólo la numeración visible: 3 cuando vienen después de convertir desde
 * USD, 2 o 3 en la variante CLP según se aplique o no el colchón de reajuste.
 */
function cierreDesdeCosto(costoClp: number, numeroPrimerPaso: number) {
  const costoConImpuestoClp = costoClp * (1 + IMPUESTO_NO_RECUPERABLE_PCT / 100);
  const precioCotizacionClp = costoConImpuestoClp * (1 + MARKUP_USD_PCT / 100);
  const valorFinalClp = precioCotizacionClp * (1 + IVA_VENTA_PCT / 100);
  const n = numeroPrimerPaso;
  return {
    costoConImpuestoClp,
    precioCotizacionClp,
    valorFinalClp,
    pasos: [
      {
        paso: `${n}. Costo con impuesto no recuperable`,
        descripcion: `Costo + ${IMPUESTO_NO_RECUPERABLE_PCT}% (impuesto que KeepSync no puede recuperar, se trata como costo)`,
        valor_clp: round0(costoConImpuestoClp),
      },
      {
        paso: `${n + 1}. Precio de cotización (neto)`,
        descripcion: `Costo con impuesto + ${MARKUP_USD_PCT}% de markup — este es el precio a utilizar en la cotización`,
        valor_clp: round0(precioCotizacionClp),
      },
      {
        paso: `${n + 2}. Valor final (con IVA de venta)`,
        descripcion: `Precio de cotización + ${IVA_VENTA_PCT}% de IVA — valor final a presentar`,
        valor_clp: round0(valorFinalClp),
      },
    ],
  };
}

export interface CotizacionClpResultado {
  /** Precio de lista publicado por el proveedor, en pesos, por el período completo de la línea. */
  monto_lista_clp: number;
  /** 5,5% de colchón por reajuste del precio local, o 0 si el precio está bloqueado (plan anual). */
  recargo_reajuste_pct: number;
  costo_clp: number;
  impuesto_no_recuperable_pct: number;
  costo_con_impuesto_clp: number;
  markup_pct: number;
  /** Precio neto a utilizar en la cotización (antes del IVA de venta). */
  precio_cotizacion_clp: number;
  iva_venta_pct: number;
  /** Valor final a presentar al cliente (precio de cotización + IVA de venta). */
  valor_final_clp: number;
  pasos: CotizacionUsdPaso[];
}

/**
 * Variante de la regla para cuando el proveedor publica el precio **en pesos** y no hay conversión
 * que hacer: se entra directo al impuesto no recuperable, con el colchón de reajuste opcional
 * adelante. Ver el encabezado de este archivo para por qué el 5,5% cambia de significado acá.
 */
export function calcularCotizacionClp(
  montoListaClp: number,
  opciones: { aplicarRecargo: boolean },
): CotizacionClpResultado {
  if (!(montoListaClp > 0)) {
    throw new Error(`monto_lista_clp debe ser mayor que 0 (recibido: ${montoListaClp})`);
  }

  const recargoPct = opciones.aplicarRecargo ? RECARGO_TIPO_CAMBIO_PCT : 0;
  const costoClp = montoListaClp * (1 + recargoPct / 100);
  const pasosPrevios: CotizacionUsdPaso[] = [
    {
      paso: "1. Costo de lista",
      descripcion: "Precio publicado por el proveedor en pesos, por el período completo",
      valor_clp: round0(montoListaClp),
    },
  ];
  if (opciones.aplicarRecargo) {
    pasosPrevios.push({
      paso: `2. Costo con colchón de reajuste`,
      descripcion: `Costo de lista + ${RECARGO_TIPO_CAMBIO_PCT}% (el proveedor puede reajustar su precio local durante la vigencia; la cotización es a precio cerrado)`,
      valor_clp: round0(costoClp),
    });
  }
  const { costoConImpuestoClp, precioCotizacionClp, valorFinalClp, pasos } = cierreDesdeCosto(
    costoClp,
    pasosPrevios.length + 1,
  );

  return {
    monto_lista_clp: round0(montoListaClp),
    recargo_reajuste_pct: recargoPct,
    costo_clp: round0(costoClp),
    impuesto_no_recuperable_pct: IMPUESTO_NO_RECUPERABLE_PCT,
    costo_con_impuesto_clp: round0(costoConImpuestoClp),
    markup_pct: MARKUP_USD_PCT,
    precio_cotizacion_clp: round0(precioCotizacionClp),
    iva_venta_pct: IVA_VENTA_PCT,
    valor_final_clp: round0(valorFinalClp),
    pasos: [...pasosPrevios, ...pasos],
  };
}

function round0(n: number): number {
  return Math.round(n);
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
