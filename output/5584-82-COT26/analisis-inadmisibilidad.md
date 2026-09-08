# 5584-82-COT26 — Universidad de Chile · «Suscripción anual Licencias Claude AI»

**No se generó cotización: ningún plan de Claude cabe bajo el tope.** No es una limitación del
cotizador ni del markup — el tope del comprador no alcanza ni para el costo de las licencias.

- Comprador: Universidad de Chile, UCHILE Programa de Bachillerato (RUT 60.910.000-1)
- Objeto: «6 licencias suscripción anual Agente Claude AI» — el texto **no nombra el plan**
- Tope: $1.200.000 CLP · Cierre: 2026-09-09 12:00 · Primer llamado · 3 ofertas ya recibidas
- Sin adjuntos (`documentos: []`), así que no hay dónde leer el plan
- Analizado el 2026-09-08 con el dólar observado de ese día, **933,82** (mindicador.cl / Banco
  Central, consultado con `curl` porque el `fetch` de Node no atraviesa el proxy de la nube)

## La regla de precio aplicada a cada plan

Regla `cotizar-usd` (`src/lib/pricing-usd.ts`, fijada por el usuario el 2026-08-28):
`valor_final = USD × tc_observado × 1,055 × 1,19 × 1,15 × 1,19`.

| Plan | Lista | USD anuales (6 lic. × 12 meses) | Valor final | vs. tope |
|---|---|---|---|---|
| Claude Pro (anual) | USD 17/mes | 1.224 | $1.963.762 | **164%** |
| Claude Team estándar | USD 20/mes | 1.440 | $2.310.308 | 193% |
| Claude Max 5x | USD 100/mes | 7.200 | $11.551.540 | 963% |
| Claude Team premium | USD 100/mes | 7.200 | $11.551.540 | 963% |
| Claude Max 20x | USD 200/mes | 14.400 | $23.103.080 | 1925% |

Por eso **la ambigüedad del plan no importa acá**: la compra es inadmisible cualquiera sea el plan
que la Universidad haya tenido en mente. El guardrail de `construirLineasACotizar` («el agente no
adivina») se disparó primero, pero aunque se hubiera forzado el plan más barato, el de más abajo
habría cortado igual.

## Lo que hace decisivo el caso: no es el markup

Desglose de Claude Pro, el más barato, paso a paso:

| Paso | Valor |
|---|---|
| 1. Tipo de cambio ajustado (933,82 + 5,5%) | 985,18 |
| 2. Costo (USD 1.224 × tc ajustado) | $1.205.860 |
| 3. + 19% de impuesto no recuperable | **$1.434.974** |
| 4. + 15% de markup → precio de cotización | $1.650.220 |
| 5. + 19% de IVA de venta → valor final | $1.963.762 |

**En el paso 3 ya se superó el tope**, con markup cero. El costo de las licencias para KeepSync
($1.434.974) es 120% del presupuesto disponible ($1.200.000). No hay descuento, margen recortado ni
plan alternativo que arregle eso.

## El hallazgo que vale más que la cotización

$1.200.000 ÷ 6 = **$200.000 por licencia al año**. El precio de lista de Claude Pro anual son
USD 204/año, que al dólar observado de hoy son **$190.499**. O sea: **la Universidad presupuestó
apenas un 5% por sobre el precio de lista de Anthropic**, sin espacio para el IVA (que solo él
serían $226.694 por licencia), el recargo de tipo de cambio, el impuesto no recuperable ni margen
alguno.

Un presupuesto así **solo lo puede cumplir quien compre directo a Anthropic**. Ningún intermediario
chileno puede: el IVA de venta por sí solo lo revienta.

Esto es una **hipótesis medida, no una teoría**, y apunta a la pregunta abierta del nicho —el 79% de
las Compras Ágiles de Claude terminan desiertas o canceladas *pese a recibir varias cotizaciones*
(`PLAN.md`, `output/informe-nicho-claude.md`)—. `CLAUDE.md` atribuye ese fracaso a un problema de
*fulfillment*: no poder entregar ni facturar. Este caso sugiere algo más simple y más barato de
verificar: **los organismos presupuestan al precio de lista que ven en la web de Anthropic**, y
después ninguna oferta cabe. Si eso se repite, la compra nace desierta.

Cómo confirmarlo, sin gastar cuota extra: tomar las 47 compras del índice histórico
(`historico/observaciones.jsonl`), dividir su tope por la cantidad de licencias pedidas y comparar
contra el precio de lista del plan que nombran. Si la mediana queda cerca de 1,0× lista, la
hipótesis de fulfillment queda desplazada por una de presupuesto.

## Qué haría cotizable esta compra

1. Que el organismo suba el tope a un valor que cubra lista + IVA (≈ $1.964.000 para 6 Pro), o
2. que baje la cantidad de licencias (con este tope caben **3** licencias Pro: $981.881), o
3. una vía de abastecimiento con precio bajo el de lista —descuento de partner o revendedor
   autorizado—, que es exactamente el insumo bloqueante del nicho y sigue sin resolverse.

Nada de eso lo decide el agente.
