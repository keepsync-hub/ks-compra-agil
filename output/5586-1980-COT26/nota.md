# 5586-1980-COT26 — Universidad de La Frontera — NO cotizable automáticamente (bundle multi-fabricante)

**Decisión humana / Cowork requerida antes de ofertar.**

## Qué pide realmente la compra

El título en la API dice solo "Claude AI Pro Individual", pero el adjunto vinculante
(`data/5586-1980-COT26/attachments/ET 3240.pdf`) especifica un **bundle de 13 suscripciones de
tres fabricantes distintos**, por 12 meses:

| Producto | Cantidad |
|---|---|
| Canva Business | 3 |
| Cursor Individual Pro | 5 |
| **Claude AI Pro Individual** | **5** |

- **Tope:** $3.500.000 CLP IVA incluido.
- **Activación:** en cuentas `@ufrontera.cl`, titularidad y control administrativo quedan en la
  Universidad, sin dependencia posterior del proveedor. Plazo 5 días hábiles.
- **Admisibilidad:** contribuyente de 1ª categoría; la cotización debe adjuntar el detalle de lo
  ofertado **cumpliendo las especificaciones técnicas**; despacho incluido.
- **Recepción conforme:** se emite solo tras verificar "la activación de **la totalidad** de las
  licencias" (las 13) en las plataformas oficiales.
- **Criterio de selección:** "prevalecerá la oferta más económica y conveniente **que cumpla con
  lo requerido**".

## Por qué el radar/cotizador no la resuelve solo

1. El extractor de condiciones leyó "1 usuario" del título; el adjunto dice **5 Claude** (+ 8 de
   otros fabricantes). El cotizador automático habría emitido una cifra equivocada.
2. `config/company.json` solo tiene pricing de planes **Claude/Anthropic**. Canva Business y
   Cursor Individual Pro **no** están en la configuración: el agente no puede (ni debe) inventar
   esos precios.
3. La recepción conforme exige **las 13 licencias activas**. Una oferta solo-Claude (5 de 13)
   probablemente **no "cumple con lo requerido"** → riesgo de inadmisibilidad si se oferta parcial.

## Números de referencia (solo la porción Claude, misma fórmula del resto de cotizaciones)

- 5 × Claude Pro, 12 meses, fx $916,3 CLP/USD, +5% margen, +19% IVA.
- Neto: **$981.355** · IVA 19%: **$186.457** · **Total ≈ $1.167.815 CLP**.
- Deja ≈ **$2.332.185** del tope para 3 Canva Business + 5 Cursor Individual Pro.

## Qué decidir en Cowork

- **¿KeepSync puede proveer/facturar también Canva Business y Cursor Individual Pro** (canal
  oficial o distribuidor autorizado, como exige el punto 4 de las condiciones)? Solo si sí, se
  arma una oferta por el bundle completo (13 licencias) dentro del tope. Añadir esos dos planes a
  `config/company.json` con costos reales y volver a cotizar el total.
- Si KeepSync **solo** puede Claude, evaluar si vale la pena ofertar parcial (alto riesgo de
  inadmisibilidad por no cubrir la totalidad) o **descartar** esta oportunidad.

_Esta decisión conecta con el insumo bloqueante del proyecto (fulfillment: poder proveer y
facturar legítimamente), ahora ampliado a más de un fabricante._
