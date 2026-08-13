# 2013-1336-COT26 — Universidad Arturo Prat — inadmisible (tope bajo el costo de 30 asientos)

**30 licencias anuales Claude Team**, uso institucional (administración centralizada, Projects,
seguridad empresarial). Tope: **$6.600.000 CLP** IVA incluido. Cierre: 2026-08-13 15:40.

## Por qué no se cotiza

Con la fórmula del proyecto (precio público Anthropic → CLP → +5% margen → +19% IVA), 30 asientos
Team quedan **por sobre el tope** en cualquiera de los dos tramos publicados:

| Tramo Team | Precio lista | Total 30 lic. (con margen + IVA) | vs tope $6.600.000 |
|---|---|---|---|
| Estándar (USD 20/mes anual) | USD 240/año | **$8.240.702** | sobre el tope |
| Premium (USD 100/mes anual) | USD 1.200/año | $41.203.512 | muy sobre el tope |

El tope equivale a **$220.000 por usuario** (IVA incluido); un asiento Team estándar cuesta
~$274.700 con IVA. Ni siquiera un plan Pro (≈$233.563/usuario) cabría para 30 usuarios
(~$7.006.890). `cotizar.ts` no genera oferta — cotizar sobre el tope es causal de inadmisibilidad.

## Criterios de evaluación (del adjunto)

Oferta económica 40% · Cumplimiento de requisitos 40% · Experiencia de los oferentes 20%.

## Notas

- Otro caso alineado con la hipótesis del informe del nicho: el tope no cubre el costo real de la
  cantidad de licencias pedidas.
- **Aviso técnico:** `cotizar.ts` rechazó esta compra como "ya cerró" por una ambigüedad de zona
  horaria (interpreta `fecha_cierre` sin TZ, como hora del entorno/UTC, cuando el portal la
  expresa en hora de Chile). En esta corrida no cambió el desenlace —es inadmisible de todos
  modos— pero conviene corregir ese parseo para no descartar oportunidades aún abiertas.
