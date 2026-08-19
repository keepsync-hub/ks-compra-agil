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
   `compra-agil-radar-claude`) a `output/array/<codigo>/adjuntos/`. Esa carpeta está gitignored a
   propósito: son documentos del organismo comprador, re-descargables, no un entregable nuestro.
   Los nombres de archivo se pasan por `path.basename` antes de escribirlos — vienen de un
   servicio que no es API documentada, así que se tratan como entrada no confiable.
3. Calcula el precio: `total = presupuesto_disponible_clp × 0.8` (siempre bajo el tope por
   construcción — nunca se genera una cotización inadmisible). Se descompone en neto/IVA
   (`pricing.iva_pct` de `config/company.json`) derivando el neto DESDE el total, para que el
   redondeo nunca altere el total. Si la ficha no informa presupuesto (`tope_clp` 0 o ausente),
   **no se cotiza** esa oportunidad: sin tope no hay precio que derivar.
4. Genera un PDF de una página de "cotización formal" con el resto del formato de propuesta
   comercial de KeepSync (`src/lib/array-cotizacion.ts`, misma plantilla visual que
   `src/lib/cotizacion-html.ts` y `licitaciones/src/lib/cotizacion-html.ts`, renderizado con
   Chromium/Playwright) en `output/array/<codigo>/Q-AAAAMMDD-NombreCliente.pdf`, y guarda
   `output/array/<codigo>/cotizacion-resumen.json`.
5. Copia **solo nuestro PDF** a `docs/array-cotizaciones/<codigo>/` — `docs/` es lo único que
   GitHub Pages publica (`.github/workflows/pages.yml`). Los adjuntos del organismo NO se
   republican ahí: son documentos ajenos, ya disponibles en el portal (al que enlaza cada
   tarjeta); publicarlos bajo nuestro sitio atribuiría procedencia ajena y llenaría el repo de
   binarios de terceros. La página los lista por nombre para saber qué hay que leer.
6. Escribe `docs/array-cotizaciones/index.json` (versionado, fusionando sobre lo ya indexado) y
   regenera `docs/array-compras-agiles.html` (misma página que `array-compras-agiles-radar`, vía
   `src/lib/array-pagina.ts`) con el precio, la fecha de generación, el enlace al PDF y la lista
   de adjuntos por tarjeta, más un aviso fijo explicando que el precio es preliminar.

## Interacción con `array-compras-agiles-radar`

Ambos skills escriben el mismo `docs/array-compras-agiles.html`. Para que correr el radar (que
puede estar programado, ver README.md) no borre silenciosamente las cotizaciones, el cotizador
deja `docs/array-cotizaciones/index.json` y el radar lo relee y vuelve a renderizar las
cotizaciones que sigan correspondiendo a una oportunidad abierta. El índice vive en `docs/`
(versionado) y no en `data/` (gitignored) justamente para sobrevivir a un checkout limpio en la
nube — el mismo bug que `PLAN-VOLUMEN.md` documenta para `data/state.json`.

Los códigos que ya cerraron quedan como entradas huérfanas en el índice y como carpetas huérfanas
en `docs/array-cotizaciones/`: no se renderizan (la página solo dibuja códigos de la corrida
actual), pero tampoco se limpian solos. Purgarlos a mano de vez en cuando.

## Falsos positivos: por qué el cotizador filtra más que el radar

El radar de solo lectura podía tolerar ruido — era una lista para que un humano descartara a ojo.
El cotizador no: convierte cada hallazgo en una **propuesta comercial firmada como KeepSync**
dirigida a un organismo real. Dos casos reales de la primera corrida lo dejaron claro:

- `3703-332-COT26` "Implementos **Dron RPA** DOM" (Municipalidad de Huasco): acá `RPA` es
  *Remotely Piloted Aircraft*, no Robotic Process Automation. Se habría ofertado automatización
  robótica de procesos por $640.000 a alguien que pedía repuestos de dron.
- `2020-153-COT26` "**Curso** Gestión de proyectos ágiles" (BCN): una capacitación, no una
  plataforma PMO.

Por eso cada categoría de `config/array-servicios.json` puede declarar `patron_excluyente`: un
contexto en el que la palabra acierta pero el rubro no. Se evalúa sobre el texto completo de la
ficha y descarta la categoría. Los descartes **se reportan** (consola y una sección de la página):
un patrón demasiado amplio se vería si no como oportunidades que desaparecen sin explicación. Si
alguna descartada sí correspondía, ajustar el patrón — el `_patron_excluyente_nota` de cada
categoría documenta qué caso lo motivó.

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
   corrida. Sus nombres de archivo se sanitizan (`path.basename`) antes de tocar el disco.
6. **Cuota**: como todos los scripts que pegan a la API, declara su presupuesto con
   `configurarCuota()` (`presupuestoRequestsArray()` en `src/lib/array-servicios.ts`:
   variantes × páginas + margen de detalles ≈ 111). Es el script más caro del repo — sin ese
   circuit breaker podría comerse la cuota diaria que comparte con el radar de licencias Claude.
   Además **se niega a correr si `npm run radar` no corrió hoy** (`radarYaCorrioHoy()`, igual que
   `informe` e `indexar`): ese radar tiene reserva prioritaria con presupuesto 40, y este barrido
   es exploración de otro nicho. `--forzar` lo salta si es intencional.
7. **Nunca sobre el tope**: además del "por construcción" (80% siempre cabe), hay un chequeo
   explícito `totalClp > tope_clp` antes de escribir el PDF — un argumento no es una verificación,
   y si alguien cambia la fórmula el guardrail tiene que seguir cortando.
