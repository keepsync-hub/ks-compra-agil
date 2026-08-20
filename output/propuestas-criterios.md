# Propuestas de criterios de búsqueda

Generado por `npm run criterios` el 2026-08-20, sobre la medición de
`historico/mercado.jsonl`. **Ninguna está activa**: viven en `config/categorias-propuestas.json`,
que ningún script del radar carga.

Regla de admisión: Familia de capa "fina" + veredicto servible o por-definir + tamaño corregido ≥ 5 compras abiertas + al menos una variante con precisión medida ≥50%.

| Propuesta | Variantes `q` | Costo/corrida | Veredicto KeepSync |
|---|---|---:|---|
| Datos, analítica e inteligencia artificial | `inteligencia` | +2 | servible (A=si, B=si, C=no) · ofertable: NO — falta catálogo de costos de servicios |
| Capacitación en TI, datos e IA | `curso`, `capacitacion`, `inteligencia` | +6 | por-definir (A=parcial, B=si, C=no-se-sabe) · ofertable: NO — falta catálogo de costos de servicios |
| Asesoría y consultoría profesional | `asesoria`, `consultoria` | +4 | servible (A=si, B=si, C=no) · ofertable: NO — falta catálogo de costos de servicios |

Encenderlas todas sumaría **12 requests por corrida** al presupuesto actual de 42.

El costo es el **marginal**: el radar consulta la unión deduplicada de las variantes de todas
las categorías activas, así que una variante que ya se está pidiendo no suma nada. Cada
propuesta detalla en su `_costo_real` cuáles de las suyas ya estaban cubiertas.

## Familias que NO pasaron, y por qué

Se listan a propósito: una familia descartada en silencio se ve igual que una que nadie miró.

- `automatizacion-documental` — tamaño corregido ≈1 < umbral 5

## Antes de promover cualquiera

1. Revisar sus `variantes_q` y su `verificacion_regex` a mano — salieron de una medición, no de
   una revisión de casos reales uno por uno.
2. Copiarla a `config/categorias.json` con `activa: false`.
3. `npm run radar -- --sondeo --solo=<id>` y revisar `output/sondeo-variantes.md`.
4. Recién entonces `activa: true`, y después `npm run cuota`.

Ninguna de estas propuestas habilita una oferta: falta el catálogo de costos de servicios.
