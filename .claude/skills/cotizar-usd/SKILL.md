---
name: cotizar-usd
description: Calcula el precio en CLP a partir de un costo en USD aplicando la regla fijada por el usuario el 2026-08-28 (tipo de cambio observado + 5,5%, +19% impuesto no recuperable, +15% markup, +19% IVA final). Usar cuando el usuario pida calcular o verificar el valor de una cotización cuyo costo base está en dólares.
---

# Regla de cálculo para cotizaciones en USD

Fórmula fijada por el usuario el 2026-08-28 para convertir un costo en USD al precio final en CLP
de una cotización. Implementada en `src/lib/pricing-usd.ts` (`calcularCotizacionUsd`), con un CLI
de apoyo en `scripts/calcular.ts` que solo imprime el desglose — no genera ni publica ningún
documento.

## La regla, en orden

1. **Tipo de cambio ajustado** = tipo de cambio observado × (1 + 5,5%).
2. **Costo (CLP)** = monto en USD × tipo de cambio ajustado.
3. **Costo con impuesto** = costo × (1 + 19%) — un impuesto que **no se puede recuperar** y que
   por eso se trata como mayor costo para KeepSync, no como el IVA de la venta.
4. **Precio de cotización (neto)** = costo con impuesto × (1 + 15%) de markup. **Este es el valor
   a utilizar en la cotización** (la base imponible que se presenta como "Neto").
5. **Valor final** = precio de cotización × (1 + 19%) de IVA de venta — el monto total a presentar
   al organismo comprador ("Total").

Es decir:

```
valor_final = monto_usd × tipo_cambio_observado × 1,055 × 1,19 × 1,15 × 1,19
```

El 19% aparece dos veces a propósito y con roles distintos: el del paso 3 es un impuesto de costo
(no recuperable, sobre el tipo de cambio ya ajustado), el del paso 5 es el IVA de venta que se
declara en la factura al organismo. No son el mismo concepto aunque compartan la tasa.

## Cuándo usar

- El usuario pide calcular o verificar el precio CLP de algo cotizado en USD siguiendo esta regla.
- Como referencia al armar o revisar manualmente una cotización con costo base en dólares.

```bash
npm run cotizar-usd -- <monto_usd>                 # tipo de cambio en vivo (mindicador.cl)
npm run cotizar-usd -- <monto_usd> <tipo_cambio>    # tipo de cambio manual
```

El tipo de cambio en vivo se obtiene con `obtenerTipoCambioUsdClp` (`src/lib/pricing.ts`, dólar
observado vía mindicador.cl, con fallback fijo si el servicio falla) — la misma función que ya usa
el cotizador de licencias Claude, para no duplicar la fuente del tipo de cambio.

## Relación con `cotizarLinea` (licencias Claude, `src/lib/pricing.ts`)

Desde el 2026-08-28, esta regla **es** la fórmula de producción para licencias Claude: el usuario
confirmó la unificación y `cotizarLinea` (`npm run cotizar`, `.claude/skills/compra-agil-ofertar/`)
delega directamente en `calcularCotizacionUsd` en vez de duplicar la lógica. `markup_pct` e
`iva_pct` dejaron de leerse de `company.json` para este cálculo — son parte fija de la regla, no un
parámetro por empresa (antes `markup_pct` era configurable, con 10% como valor de ejemplo; ahora es
15% fijo, igual que el resto de los porcentajes).

Si aparece un costo en USD de otro nicho (fuera de licencias Claude), esta misma función sirve sin
tocar nada: se llama con el monto en USD de ese nicho y el tipo de cambio observado.
