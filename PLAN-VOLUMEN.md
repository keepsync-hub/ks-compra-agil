# Plan de volumen: explotar al máximo la API de Mercado Público

> Tercer documento de diseño del repo, junto a `PLAN.md` (Compra Ágil de licencias Claude, el
> diseño verificado contra producción) y `licitaciones/PLAN.md` (segundo nicho, sin verificar).
> Este responde una pregunta distinta a la de ambos: **dado el acceso y la API que ya tenemos
> validados, ¿qué más se puede hacer para aumentar el volumen de venta a Mercado Público?**

## Progreso de ejecución

**Fase 0 — implementada y validada contra producción** (18-08-2026, con `COMPRA_AGIL_API_TICKET`
real disponible en el entorno):

- `src/lib/lineas.ts`: `construirLineasACotizar` extraída de `cotizar.ts` + `estimarTotal` /
  `calcularCotizacion` / `evaluarTope` nuevas, reusadas sin cambiar el resultado numérico
  (`cotizar.ts` ahora importa desde ahí).
- `src/lib/cuota.ts`: ledger diario (`data/cuota/<hoy>.json`) + rollup versionado
  (`historico/cuota.jsonl`, se crea recién al primer 429) + circuit breaker local
  (`configurarCuota`/`contarRequest`). Instrumentado en `apiGet` (`src/lib/api.ts`). **Corrida
  real**: 58 requests acumuladas en el día entre radar/informe/diagnóstico, 0 códigos 429 — primer
  dato real hacia la cota inferior del límite diario (ver `npm run cuota`; el rollup histórico
  todavía no tiene ninguna fila porque no se llegó a un 429 en esta sesión).
- Ahorro `proveedor_seleccionado`: 8→1 variante. **Confirmado en producción**: la corrida real
  encontró 0 casos, igual que antes, a un octavo del costo (ver `output/radar-ultima-corrida.md`).
- `informe-nicho.ts` ahora rechaza correr sin `--forzar` si el radar no corrió hoy (reserva
  prioritaria de cuota) — confirmado que el guard lee el ledger correctamente.
- `npm run diagnostico-api` (`src/scripts/diagnostico-api.ts`) y `npm run cuota`
  (`src/scripts/cuota.ts`) creados. El diagnóstico corrió contra producción; resultados abajo.
- **Radar corrido en limpio contra producción**: 3 oportunidades reales abiertas ahora mismo
  (`1233595-38-COT26`, `607-180-COT26`, `2069-2272-COT26`) — ver `output/radar-ultima-corrida.md`
  para el detalle (tope, plan, usuarios, competencia). La API mostró inestabilidad real durante la
  corrida (un 504 "Endpoint request timed out" en la variante "Claude Pro" de `publicada`, y un
  500 "Servicio no disponible" en `informe-nicho.ts` sobre `estado=desierta`) — no es un defecto
  del código, es la API el día de esta corrida; el manejo de errores existente lo absorbió sin
  romper el resto de la corrida.
- Pendiente dentro de Fase 0: el chequeo de golden files de `cotizar.ts` contra los
  `cotizacion-resumen.json` versionados no se pudo correr — sigue faltando `config/company.json`
  real (costos de KeepSync) en este entorno, igual que antes. No bloquea el resto del plan.

### Hallazgos reales de `npm run diagnostico-api` (ver `output/diagnostico-api.md` para el detalle)

| Pregunta | Respuesta medida |
|---|---|
| ¿`q` es opcional en `/v2/compra-agil`? | **Sí** — HTTP 200 sin `q`. Un barrido completo sin keywords es técnicamente viable. |
| ¿El payload trae total/paginación? | **Sí, y es mejor de lo esperado**: `payload.paginacion.{total_paginas, total_resultados}` da el total exacto en 1 sola llamada. **Ya aplicado** en `buscarCompraAgil` (`src/lib/api.ts`): corta apenas `numero_pagina >= total_paginas`, con fallback al heurístico anterior (página corta) si la API no informa `paginacion`. Elimina el request extra que hacía falta cuando el conteo real era un múltiplo exacto de `tamanoPagina`. |
| ¿Algún filtro de fecha? | **No** — los 3 candidatos probados (`fecha_desde`, `fecha_publicacion_desde`, `fecha`) devolvieron HTTP 400. El barrido histórico sigue necesitando el cruce variante × estado, no puede volverse incremental por fecha. |
| ¿Ticket clásico / Órdenes de Compra? | **Sin confirmar** — `LICITACIONES_API_TICKET` no estaba disponible en el entorno durante esta corrida. Repetir el diagnóstico cuando esté configurado; ese hallazgo condiciona toda la Fase 5. |

**Hallazgo no anticipado por el plan**: la API mostró inestabilidad real y repetida durante toda
la sesión — un 504 en la variante "Claude Pro" del radar, un 500 en `informe-nicho.ts`, y **dos
timeouts de 20s consecutivos** en la propia medición del universo (`estado=publicada` sin `q`,
la query más "pesada" al no tener filtro). Esto matiza el hallazgo de "`q` es opcional": es
posible técnicamente, pero una query sin filtro puede ser más lenta/inestable en la práctica que
una filtrada — antes de apostar la arquitectura de Fase 1 a un barrido completo sin keywords, hay
que repetirlo en un día con la API más estable y medir la latencia, no solo la viabilidad.

**Conclusión para Fase 1**: no cambiar la arquitectura de "8 variantes × estado" a un barrido sin
`q` todavía — la ganancia de eficiencia (`paginacion.total_resultados`, evita 1 request de
confirmación por query) sí conviene aplicarla ahora, es una mejora sin riesgo nuevo.

**Fase 1 — implementada y validada contra producción** (18-08-2026, misma sesión):

- `config/categorias.json` (nuevo): 4 categorías definidas — `claude` (**activa**, las 8 variantes
  de siempre), `gestion-documental` (variantes copiadas de `licitaciones/config/keywords.json`),
  `licencias-software` (Canva/Cursor/Microsoft/Adobe) y `desarrollo-integracion` — las 3 últimas
  con `activa: false` a propósito: activarlas suma su `presupuesto_requests_por_corrida` al costo
  de cada corrida, y la cuota diaria todavía no tiene una cota inferior confiable (Fase 0 solo
  llegó a "≥70 requests/día sin 429", no a un límite real).
- `src/lib/categorias.ts` (nuevo): carga y compila las categorías, con dos guardas que no estaban
  en el diseño original: rechaza flags de regex `g`/`y` (con `g`, `RegExp.test()` arrastra
  `lastIndex` entre llamadas y produce falsos negativos intermitentes — un bug silencioso si se
  hubiera colado) y valida que `id` cumpla `/^[a-z0-9-]+$/` (se usa como componente de ruta).
- `src/lib/marca.ts`: reescrito como wrapper delgado sobre `categoriaPorId("claude")` — mismas 3
  firmas exportadas, mismo comportamiento (confirmado con `mencionaCategoria` reproduciendo
  exactamente la regex anterior). `informe-nicho.ts` sigue importándolo sin cambios.
- `config/marcas.json` **eliminado** — absorbido por la categoría `claude` de `categorias.json`.
  `loadMarcasConfig()` (`src/lib/config.ts`) ahora lee ese archivo directo (sin pasar por
  `categorias.ts`, a propósito: evita un import circular config↔categorias).
- `radar.ts` reescrito para iterar sobre `categoriasActivas()` en vez de tener "marca" hardcodeada:
  reporte con una sección de oportunidades por categoría, presupuesto de cuota = suma de los
  presupuestos de las categorías activas. **Smoke test contra producción con cero regresión**: con
  solo `claude` activa, encontró los mismos 3 códigos que la corrida de Fase 0
  (`1233595-38-COT26`, `607-180-COT26`, `2069-2272-COT26`), con las mismas condiciones extraídas
  (la competencia varió porque son datos en vivo, esperado). 70 requests acumuladas en el día,
  0 códigos 429 — la cota inferior de la cuota sigue creciendo sin haberse agotado.
- Pendiente: activar `gestion-documental`/`licencias-software`/`desarrollo-integracion` requiere
  (a) una cota de cuota más confiable y (b) probar sus regex de verificación contra casos reales —
  ninguna se ha corrido todavía contra producción, a diferencia de `claude`.

**Fase 2 — implementada y validada con la prueba que importa: un checkout limpio simulado**
(18-08-2026, misma sesión):

- `src/lib/indice.ts` (nuevo): `historico/observaciones.jsonl` versionado, append-only.
  `proyectar()` reduce un `CompraAgilDetalle` a ~25 campos (no el payload crudo); `anexar()` solo
  escribe si el hash cambió respecto de la última observación de ese código (idempotente); asserta
  `byteLength < 4000` por línea antes de escribir (atomicidad real de `appendFileSync` bajo
  `PIPE_BUF`, ver comentario en el archivo); `obtenerDetalleConCache()` usa inmutabilidad de
  estados terminales + `fecha_ultimo_cambio` del listado (ya pagado) para no re-pedir detalles.
- `sembrarDesdeIndice()` (aditivo en `historial.ts`): puebla `state` desde el índice antes de la
  corrida, sin pisar nada de lo que ya esté ahí.
- **`radar.ts` ahora se auto-indexa**: cada ítem que procesa (oportunidad o adjudicación) se anexa
  al índice con `anexar(proyectar(...))`, **con cero requests extra** — el detalle ya se pagó. Esto
  es lo que hace que el índice se mantenga fresco solo con el uso normal, sin depender de que
  alguien recuerde correr `indexar.ts` aparte.
- `.claude/skills/compra-agil-indice/scripts/indexar.ts` (nuevo, `npm run indexar`): backfill de
  `desierta`/`cancelada`/`cerrada` (que `radar.ts` no cubre), con `--solo-cache` (reindexa desde
  `data/*/detalle.json`, 0 requests) y `--forzar` (salta el chequeo de prioridad de cuota).
- **Prueba real, no solo típecheck**: `npm run indexar -- --solo-cache` sobre los 3 códigos ya
  cacheados → 3 observaciones nuevas, confirmado idempotente en una segunda corrida (0 nuevas, 3
  sin cambios). Después, **se borró `data/state.json` a propósito** — simula exactamente el bug
  descrito (checkout limpio en la nube) — y se corrió `npm run radar` contra producción de nuevo:
  el `state.json` regenerado quedó con `primera_vez: "2026-08-18T20:04:04Z"` en los 3 códigos, que
  es el timestamp del indexado anterior, **no** el de esta corrida (20:04:53Z). Es la prueba
  directa de que `sembrarDesdeIndice` restaura el historial real en vez de tratar todo como NUEVO.
  76 requests acumuladas en el día, 0 códigos 429.
- Los `codigos_onu` capturados en el índice ya tienen datos reales para cuando llegue la Fase 3:
  `43231512` (licencias Claude Pro/Team), `43232407`/`43232804` (Claude Max) — primera evidencia
  real hacia resolver si es UNSPSC de 8 dígitos íntegro (pendiente `--diagnostico-onu`, Fase 3).

## Contexto

El repo usa la API validada de Compra Ágil (`api2.mercadopublico.cl`) para un solo fin: buscar 8
variantes de "Claude" y cotizarlas. Resultado medido: 47 casos, 79% de fracaso, **cero ofertas
enviadas**.

Insumos confirmados con el usuario que gobiernan este plan:

- KeepSync puede facturar **las cuatro líneas**: servicios propios (gestión documental,
  digitalización, consultoría), reventa Claude, reventa de otras licencias, y desarrollo a medida.
  → La restricción real ya no es la capacidad de entrega, sino la **selección y calificación**.
- **El ticket de la API clásica está disponible** → se reabre la vía de Órdenes de Compra.
- Prioridad declarada: **maximizar cobertura de oportunidades**.

---

## Hallazgos que gobiernan el diseño

### 1. Hay un bug vigente: en la nube el radar es ciego a recompradores

`data/state.json` está gitignored y los agentes de Copilot (`.github/agents/`, `README.md:58-72`)
corren sobre checkout limpio. Cada corrida en la nube ve `estadoVacio()` → marca **todo** como
NUEVO y **nunca** detecta un recomprador. Como el 66% del mercado son recompradores, hoy se pierde
la señal más valiosa justo en el único modo de ejecución desatendido.

### 2. El 73% de los fracasos los causa el comprador — pero el precio está sub-reportado

Clasificación de los 37 fracasos declarados (`output/informe-nicho-claude.md:42-81`):

| Causa | Casos | % |
|---|---|---|
| Error o cambio del comprador | 18 | 49% |
| Vencimiento del plazo de selección | 9 | 24% |
| Incumplimiento de la oferta | 6 | 16% |
| Precio sobre presupuesto | 3 | 8% |
| Sin oferentes | 1 | 3% |

Esto matiza la hipótesis de `CLAUDE.md` ("el cuello de botella es de fulfillment"): solo 16% de los
fracasos se declara por incumplimiento de la oferta.

Pero de los 10 casos que el proyecto trabajó concretamente, 4 se detuvieron y **3 por tope < costo
real**. Un comprador escribe "se modificará el requerimiento" cuando en realidad nadie cupo bajo el
tope. **Nunca fusionar ambas señales en una "causa real"** — el reporting lleva dos columnas
separadas: *motivo declarado* y *nuestro precio cabía (sí/no/n.d.)*.

### 3. Mercado de recompradores, con ventana corta y medible

66% de los 47 casos vienen de organismos que reintentan. 20 intervalos de republicación
reconstruidos: **mediana ≈8 días**, 11 de 20 ≤10 días. Culturas ganó al 3er intento, 14 días
después del 2do. Un proceso que se cae no es una oportunidad perdida: es el aviso de una que vuelve
en ~8 días.

### 4. La API v2 no dice quién gana ni a qué precio

`estado=proveedor_seleccionado` devuelve 0 casos; `id_orden_compra` null y `proveedores_cotizando`
vacío (`docs/index.html:253-259`). El ticket clásico podría resolverlo vía Órdenes de Compra, pero
el cruce Compra Ágil → OC **no está verificado** → es un spike barato, no una fase comprometida.

---

## La propuesta obvia, y por qué no alcanza

**Propuesta 1:** generalizar el radar a N categorías de keywords y acelerar la cotización → más
ofertas → más ventas.

1. **Escala un embudo con conversión nunca observada.** Cero ofertas enviadas: la conversión no es
   baja, es indefinida.
2. **Más ofertas no arregla un mercado que se cae por causas del comprador** (73%). La palanca no
   es ofertar más, es llegar primero a la republicación.
3. **El cuello es humano.** El envío final es siempre un clic de persona (`docs/flujo.html`).
   Cotizar ×10 no envía ×10 — y sin filtro previo, solo inunda a la persona de casos inviables.
4. **Compra Ágil tiene techo de 100 UTM** (~$6,9M; máximo observado $7.150.600, consistente).
5. **Elegir keywords a dedo es el método que produjo el nicho Claude** (79% de fracaso, topes bajo
   costo). Repetirlo con más palabras repite el error de selección.

**Mejor alternativa:** el provecho no está en *encontrar más cosas para cotizar*, sino en **(a)
saber dónde jugar, (b) saber a qué precio se gana, (c) llegar primero a las republicaciones, y (d)
que solo lo viable llegue a la persona**. Optimización central: **~80% de esa capacidad se
construye leyendo un índice local, con cero consumo de cuota.**

---

## Qué se descartó, y por qué

| Descartado | Razón |
|---|---|
| Generalizar el **cotizador** a todas las categorías | `pricing.ts` depende de `planes` en USD que existen solo porque Anthropic publica lista. Sin catálogo de costos real para gestión documental, generalizarlo viola "no inventar precios". Una categoría sin pricing se califica en todo menos precio, y su veredicto tope es `revisar`. |
| Apostar la arquitectura a "¿`q` es opcional?" | Aunque lo fuera: ~125 requests × 3 corridas/día contra una cuota sin medir. Pasa a ser un dato del diagnóstico, no el eje del diseño. |
| Multi-categoría como primera fase | Es lo más caro en cuota. Va **después** del guard de presupuesto, no antes. |
| `yaObservado(codigo, horas)` como ahorro de cuota | Vago. Se reemplaza por inmutabilidad de estados terminales + `fecha_ultimo_cambio`, que ya viene en el listado (50 por request, ya pagados). |
| SQLite para el índice | Corpus diminuto (47 casos). JSONL da diffs limpios y append sin conflicto — requisito real, porque lo escriben la máquina local **y** el agente de la nube. Escape hatch: SQLite *derivado* y gitignored si el corpus crece. |
| Mantener `config/marcas.json` junto a `categorias.json` | Dos fuentes de verdad = deriva silenciosa. Se elimina, absorbido. |

---

## Plan por fases

### Fase 0 — Diagnóstico único + refactors sin cambio de comportamiento (~8 requests)

Un solo `npm run diagnostico-api` responde **todas** las incógnitas baratas de una vez: ¿`q` es
opcional? ¿el payload del listado trae `total` (hoy toda query que devuelve exactamente 50 gasta un
request extra)? ¿acepta filtros de fecha (haría incremental el barrido histórico)? ¿el ticket
clásico funciona y **el código de Compra Ágil cruza con su Orden de Compra**?

Refactors mecánicos, verificables contra artefactos existentes:

- **`src/lib/lineas.ts`** (nuevo): mover `construirLineasACotizar` (hoy privada en `cotizar.ts`) y
  añadir `estimarTotal(...)` → `{totalClp, cabeBajoTope, holguraPct}` **sin generar documentos**.
  Hoy el tope se verifica *después* de renderizar PPTX+PDF con Chromium, y 3 de 4 casos detenidos
  fueron exactamente por tope.
- **`src/lib/cuota.ts`** (nuevo) + instrumentar `apiGet`: ledger por día y
  `configurarCuota({script, maxRequests})` como circuit breaker local. Presupuestos: `radar` 40
  (reserva prioritaria), `informe` 60, `indexar` 100. Los scripts no-radar rechazan correr si el
  radar no corrió hoy.
- **Ahorro inmediato**: `radar.ts:110-118` gasta 8 requests barriendo `proveedor_seleccionado`,
  medido en 0 casos → usar 1 variante ancha. **8→1 por corrida**, sin perder la señal de cuándo la
  API empiece a poblar el campo. Se declara en el reporte de cobertura, no es un recorte silencioso.
- **Clamp** de `tamanoPagina` a `Math.min(…, 50)` (hoy solo hay `Math.max` contra el mínimo).

**Verificación**: `npm run typecheck`; `npm run cotizar` sobre `1056854-51-COT26` y `1614-47-COT26`
contra los `cotizacion-resumen.json` versionados — **son golden files reales** (ignorar `fx`, que
se consulta en vivo).

### Fase 1 — Cobertura multi-categoría (la prioridad declarada, ya segura)

Llega inmediatamente después del guard, que es lo que la vuelve segura.

- **`config/categorias.json`** (nuevo): por categoría `id`, `variantes_q[]`, `verificacion_regex`,
  `pricing.modo` (`planes_usd` | `manual`), `presupuesto_requests_por_corrida`,
  `acreditaciones_conocidas_faltantes[]`.
- **`src/lib/categorias.ts`** (nuevo). Endurecimiento del cargador: **rechazar flags `g`/`y`** —
  con `g`, `RegExp.test` conserva `lastIndex` y devuelve `false` en llamadas alternas: bug
  silencioso e intermitente. Validar `id` contra `/^[a-z0-9-]+$/` (se usa como componente de ruta).
- **`src/lib/marca.ts`**: mismas tres firmas, reimplementadas sobre `categoriaPorId("claude")` →
  `radar.ts` e `informe-nicho.ts` compilan sin tocarse. **Eliminar `config/marcas.json`.**
- Categorías: `claude` (activa, regex literal de `marca.ts:8`), `gestion-documental` (variantes
  copiadas de `licitaciones/config/keywords.json` — se **copian**, no se importan: son APIs
  distintas y allá la regex es descubrimiento primario, acá filtro de ruido de `q`),
  `licencias-software`, `desarrollo-integracion`.

**Verificación de cero regresión**: correr el radar antes/después contra el mismo caché y hacer
`diff` de los códigos clasificados → conjunto vacío.

### Fase 2 — Índice histórico versionado (arregla el bug de la nube)

- **`historico/observaciones.jsonl`** (versionado, append-only): una línea por *cambio observado*,
  no por corrida. Proyección de ~40 campos, no el payload crudo (`data/` sigue siendo caché
  efímero y regenerable).
- **Atomicidad real**: `appendFileSync` sobre `O_APPEND` es atómico solo bajo `PIPE_BUF` (4096 B).
  Como escriben local y nube, los `motivo_*` se truncan a 1000 chars y `anexar` **asserta
  `byteLength < 4000`** antes de escribir. El texto íntegro queda en el `detalle.json` crudo.
- **Caché-first, el ahorro concreto**: los estados terminales son inmutables → nunca se refetchean;
  para `publicada` se usa `fecha_ultimo_cambio` **del listado** (ya pagado, 50 por request) como
  clave de invalidación. Un barrido histórico pasa de N detalles a ~0 tras la primera pasada.
- **`sembrarDesdeIndice(state, obs)`** en `historial.ts` (aditivo): `radar.ts` la llama tras
  `cargarState()` → **la nube deja de reportar todo como NUEVO**.
- Backfill `npm run indexar`, con `--solo-cache` (0 requests).

### Fase 3 — Inteligencia sobre el índice (**cero requests**)

- **`src/lib/motivos.ts`**: `clasificarMotivo` con reglas ordenadas, primera que calza gana. El
  orden importa: "error en el monto publicado" clasifica `comprador`, no `precio` — republicará
  corregido, y es la oportunidad más limpia que existe. Fixture
  `historico/motivos-esperados.json` con los 37 casos ya clasificados a mano +
  `npm run verificar-motivos` con matriz de confusión.
- **`src/lib/metricas.ts`**: por categoría y por `codigo_producto` (taxonomía ONU — hoy declarado
  en `api.ts:34` con **cero usos** en todo el repo): volumen, monto p25/mediana/p75, tasas,
  competencia mediana, recompradores. **Heurística de republicación**: mismo RUT, anterior
  `desierta`/`cancelada`, intervalo ≤60 días, y evidencia de mismo requerimiento — monto ±25%
  **o** intersección no vacía de `codigos_onu`. Eso es exactamente para lo que sirve
  `codigo_producto`.
- `ventana_republicacion_estimada` = último fracaso + p25..p75 de intervalos, con fallback a la
  mediana de la categoría (≈8 días). Convierte la mediana medida en algo accionable.
- `--diagnostico-onu` (0 requests): resuelve si es UNSPSC de 8 dígitos o un derivado propio.

### Fase 4 — Calificador y digest (**cero requests** propios)

- **`src/lib/calificador.ts`**. Bloqueantes duros → `descartar`: `cerrado`, `no_publicada`,
  `sobre_tope` (**reusa `estimarTotal`**, sin generar PDF), `acreditacion_faltante`.
- **`condiciones.ts`** (aditivo): `PATRONES_ACREDITACION` — "distribuidor autorizado", "canal
  oficial", "carta del fabricante", etc. Es el gate que un comprador declaró textualmente
  (`output/informe-nicho-claude.md:55`). No toda acreditación bloquea: bloquea solo si está en
  `acreditaciones_conocidas_faltantes` de la categoría — así deja de bloquear el día que se
  resuelva el insumo de fulfillment, sin tocar código.
- Señales blandas con pesos en `config/calificador.json`: `primer_llamado` (EMT — filtro
  determinista que hoy se muestra pero no se usa para priorizar), `holgura_precio`,
  `competencia_baja`, `recomprador`, `fracaso_previo_ganable`, `plazo_holgado`.
- **Honestidad metodológica obligatoria**: cero ofertas enviadas ⇒ los pesos son juicio, no ajuste.
  El score se etiqueta **"orden de revisión sugerido", nunca "probabilidad de ganar"**. Y **toda
  calificación se anexa a `historico/calificaciones.jsonl` con sus señales desglosadas desde el día
  uno**: cuando haya ~10 desenlaces, los pesos se ajustan contra datos. Cuesta ~20 líneas ahora y
  es imposible de reconstruir después.
- **`npm run digest`** → `output/digest-ultimo.md`: *Ofertar hoy* (con el comando listo para
  copiar) · *Revisar* (con la pregunta concreta a resolver) · *Descartado* (una línea con el
  bloqueante, para poder auditar) · **Ventanas de republicación** de los próximos 3 días · *Cuota*.
  Cada ítem cita la frase exacta que disparó cada señal.

### Fase 5 — Precio ganador (condicional al spike de la Fase 0)

Solo si el diagnóstico confirmó el cruce Compra Ágil → Orden de Compra.
`src/lib/ordenes-compra.ts` con el patrón defensivo de `licitaciones/src/lib/api.ts` (esa API
responde HTTP 200 con `{Codigo, Mensaje}` en los errores). Salida: ratio precio-ganador/tope por
categoría. **Impacto directo**: si el ganador típico cobra 70% del tope, cotizar al 95%
(Providencia quedó con 1,5% de holgura) es perder — y hoy eso es imposible de saber.

---

## Por qué este plan es eficiente

- **Cero consumo de cuota en las Fases 3 y 4**, que son las que producen la inteligencia y el
  digest. Se puede iterar analítica todo el día sin tocar la API.
- **Se autofinancia**: el ahorro de 8→1 en `proveedor_seleccionado` y el caché-first liberan
  presupuesto antes de gastar en categorías nuevas.
- **Arregla un bug activo** (ceguera a recompradores en la nube) como efecto lateral de la Fase 2.
- **Un solo diagnóstico** resuelve cinco incógnitas por ~8 requests, en vez de gatillar decisiones
  arquitectónicas a ciegas.
- **Corpus de prueba gratis**: 6 `cotizacion-resumen.json` como golden files, 37 motivos como
  fixture, 47 casos para backtest del calificador.

## Verificación end-to-end

1. `npm run typecheck` limpio en cada fase.
2. Golden files: `cotizar` reproduce los 6 resúmenes versionados (ignorando `fx`).
3. Cero regresión del radar: mismo conjunto de códigos antes/después de multi-categoría.
4. Índice: segunda corrida `--solo-cache` → 0 líneas nuevas, 0 requests (verificable en el ledger);
   `git diff --stat historico/` solo muestra líneas añadidas, nunca modificadas.
5. Reproducir offline desde el índice: 47 casos, 79% de fracaso, ~20 intervalos con mediana ≈8 días.
6. Clasificador de motivos: matriz de confusión contra el fixture (esperado ≈ 18/9/6/3/1).
7. **Backtest del calificador** sobre los 47 casos históricos: los 3 detenidos por tope deben salir
   `descartar/sobre_tope`; Culturas (que cerró con éxito) no debe salir `descartar`. Con n=47 esto
   detecta solo errores groseros — **decirlo en el reporte, no presentarlo como validación**.

## Lo que este plan NO resuelve

- **El envío sigue siendo manual** y fuera del sandbox. Se mejora qué llega a la persona, no su
  capacidad de enviar. Si la cola supera lo que puede enviar por día, ése es el siguiente cuello.
- **La conversión sigue sin medirse** hasta que se envíe la primera oferta. Todo el atractivo
  estimado es de *mercado*, no de *nuestra* tasa de éxito.
- **Guardrails intactos**: nunca cotizar sobre el tope, nunca enviar automáticamente, no inventar
  precios.
