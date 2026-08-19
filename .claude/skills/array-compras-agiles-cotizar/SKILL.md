---
name: array-compras-agiles-cotizar
description: Busca Compras Ágiles publicadas relacionadas con los servicios de Array (array.cl), descarga la documentación (adjuntos) de cada una, y genera una cotización preliminar en PDF con formato KeepSync para cada oportunidad — precio = 80% del presupuesto disponible. Regenera docs/array-compras-agiles.html con los resultados y las cotizaciones. Usar cuando el usuario pida generar cotizaciones para las oportunidades de Array, no solo revisarlas (para eso, array-compras-agiles-radar).
---

# Cotizador Compra Ágil — servicios tipo Array

Extiende `array-compras-agiles-radar` (búsqueda de solo lectura) con descarga de adjuntos y una
cotización PDF automática por oportunidad encontrada. **El precio no viene de un costo real de
Array** — no existe hoy un catálogo de costos para estos servicios (a diferencia de licencias
Claude, que sí tiene precio de lista público de Anthropic). Es una estimación de exploración de
mercado: **80% del presupuesto disponible** que la propia API informa para cada compra, tal como
pidió el usuario. Por eso cada PDF se marca **PRELIMINAR** y la página generada lleva un aviso
explícito — ver "Guardrails" abajo.

## Cuándo usar

- El usuario pide "cotizar las oportunidades de Array", "generar las cotizaciones para Array", o
  refrescar `docs/array-compras-agiles.html` con precios y no solo con la lista.
- Para solo revisar oportunidades sin generar PDFs, usar `array-compras-agiles-radar` en su lugar
  (más barato en cuota de API, no depende de `config/company.json`).

## Requisitos

- `COMPRA_AGIL_API_TICKET` en el entorno (igual que el resto de los skills de Compra Ágil).
- `config/company.json` con la identidad real de KeepSync — **el mismo archivo que usa
  `compra-agil-ofertar`** para las licencias Claude (raíz del repo, gitignored). El oferente que
  figura en el PDF es KeepSync, no Array: así lo confirmó el usuario. Si el archivo no existe o
  tiene placeholders `"COMPLETAR"`, el loader lo rechaza — no se inventan precios ni identidad.

## Cómo correrlo

```bash
npm run array-cotizar
```

## Qué hace (`scripts/cotizar-array.ts`)

1. Corre exactamente la misma búsqueda que `array-compras-agiles-radar`
   (`src/lib/array-servicios.ts` → `buscarHallazgosArray`), para que ambas páginas vean siempre
   las mismas oportunidades.
2. Para cada oportunidad encontrada con `documentos` declarados, descarga los adjuntos sin login
   vía el servicio público `adjunto.mercadopublico.cl` (`src/lib/adjuntos.ts`, ya usado por
   `compra-agil-radar-claude`) a `output/array/<codigo>/adjuntos/`.
3. Calcula el precio: `total = presupuesto_disponible_clp × 0.8` (siempre bajo el tope por
   construcción — nunca se genera una cotización inadmisible). Se descompone en
   neto/IVA (19%) solo para mostrarlo desglosado en el PDF; el total nunca cambia.
4. Genera un PDF de una página de "cotización formal" con el resto del formato de propuesta
   comercial de KeepSync (`src/lib/array-cotizacion.ts`, misma plantilla visual que
   `src/lib/cotizacion-html.ts` y `licitaciones/src/lib/cotizacion-html.ts`, renderizado con
   Chromium/Playwright) en `output/array/<codigo>/Q-AAAAMMDD-NombreCliente.pdf`, y guarda
   `output/array/<codigo>/cotizacion-resumen.json`.
5. Copia el PDF y los adjuntos descargados a `docs/array-cotizaciones/<codigo>/` — `docs/` es lo
   único que GitHub Pages publica (`.github/workflows/pages.yml`), así que solo lo que vive ahí
   es enlazable desde la página pública. `output/array/` queda como respaldo versionado, igual
   criterio que `output/` en la raíz.
6. Regenera `docs/array-compras-agiles.html` (misma página que `array-compras-agiles-radar`, vía
   `src/lib/array-pagina.ts`) agregando el precio, el enlace al PDF y el conteo de adjuntos por
   tarjeta, más un aviso fijo explicando que el precio es preliminar.

## Guardrails (no negociables — igual criterio que el resto del repo)

1. **Nunca se envía nada automáticamente** — el PDF queda en `output/`/`docs/` para revisión
   humana, como toda cotización de este repo.
2. **Nunca se cotiza por sobre el tope**: por construcción, 80% del tope siempre queda bajo el
   tope (salvo redondeo, que el PDF señala explícitamente si ocurriera).
3. **El precio es una heurística de mercado, no un costo real** — el PDF y la página lo marcan
   como PRELIMINAR en todo momento. No usar como oferta final sin antes: (a) confirmar con el
   usuario si KeepSync tiene una vía real de fulfillment/facturación para servicios tipo Array
   (hoy sin resolver, distinto del insumo bloqueante de licencias Claude descrito en `CLAUDE.md`),
   y (b) reemplazar el precio por uno basado en costos reales si esa vía existe.
4. **La identidad del oferente es KeepSync**, tomada de `config/company.json` — nunca se inventan
   datos de Array como oferente formal.
5. El servicio de adjuntos no es API documentada oficialmente (ver `PLAN.md`) — si cambia y
   empieza a fallar, el script sigue sin adjuntos para ese código en vez de abortar toda la
   corrida.
