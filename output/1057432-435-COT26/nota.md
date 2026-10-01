# 1057432-435-COT26 — Servicio de Salud Concepción — sin cotización posible

**Claude Team, 2 asientos premium + 8 estándar, 4 meses.** Tope disponible: $2.398.592 CLP.
Cierre: 2026-10-02 10:40.

La ficha declara un solo producto con `cantidad: 4`, pero esos 4 son **meses**, no usuarios: el
*Informe justificativo de adquisición de IA* adjunto fija «2 Asientos premium y 8 Asientos
estándar», y el Formulario N°1 lleva la columna «CANTIDAD MESES» = 4. `npm run cotizar` sin
banderas cotizaba 4 asientos estándar ($534.724): una oferta que no cubre «el 100% de los
artículos» y que las bases declaran inadmisible. Se descartó.

Con la regla de producción (lista × TC × 1,055 × 1,19 × 1,15 × 1,19; TC observado 2026-10-01
$972,6):

| Tarifa | USD por 4 meses | Total CLP | vs. tope |
|---|---|---|---|
| Mensual (USD 125 premium / USD 25 estándar), la única que corresponde a 4 meses | 1.800 | $3.007.814 | +$609.222 |
| Anual prorrateada (USD 100 / USD 20), que Anthropic no vende por 4 meses | 1.440 | $2.406.254 | +$7.662 |

Ninguna cabe bajo el tope: no se genera oferta (causal de inadmisibilidad, ver `CLAUDE.md`).

Lo que dice el propio informe del organismo explica el desajuste: presupuesta USD 535,50/mes
(precio de lista con IVA, sin costo de intermediación) y compara contra la facturación anual
—«USD 5.140,8 totales»— aunque la compra publicada es por 4 meses. El tope solo alcanza para
comprar directo a Anthropic.

Comando para reproducir:
`npm run cotizar -- 1057432-435-COT26 --linea=team_premium:2 --linea=team_standard:8 --meses=4`
(con la tarifa anual de `company.json` da $2.406.254 y el script se detiene por tope).
