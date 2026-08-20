---
name: compra-agil-radar-claude
description: Monitorea Compras Ágiles en mercadopublico.cl de cinco nichos — licencias Claude/Anthropic, asesoría y adopción de inteligencia artificial, y cursos de IA, de Power BI/Tableau y de automatización no-code (n8n, Make, Zapier, Power Automate). Usar cuando el usuario pida revisar oportunidades nuevas, correr el radar, o preguntar qué Compras Ágiles de estos temas están abiertas ahora mismo.
---

# Radar de Compra Ágil — IA, datos y automatización

Busca Compras Ágiles publicadas de las categorías activas de `config/categorias.json` contra la
API real `api2.mercadopublico.cl`, extrae condiciones (tope, plan, usuarios, plazo, documentos
exigidos, excluyentes) y detecta organismos que reintentan (recompradores). No requiere
credenciales del portal — solo el ticket de la API.

Hoy hay cinco categorías activas: `claude` (licencias Claude/Anthropic, incluidas variantes con
errores de tipeo), `bi-capacitacion` (cursos de Power BI/Tableau y visualización de datos),
`automatizacion-capacitacion` (cursos de n8n, Make, Zapier, Power Automate),
`ia-capacitacion` (cursos y capacitación en IA) e `ia-asesoria` (asesoría, adopción e
implementación de IA). El nombre del directorio dice "claude" por historia; lo que busca lo manda
la config.

No envía nada ni requiere aprobación humana: es de solo lectura.

## Cuándo usar

- El usuario pide "correr el radar", "revisar oportunidades nuevas", "qué hay abierto de Claude",
  "qué cursos de IA / Power BI / automatización hay publicados".
- Antes de armar una cotización con `compra-agil-ofertar`, para tener el detalle y las
  condiciones ya descargadas en `data/<codigo>/`.

## Requisitos

- `COMPRA_AGIL_API_TICKET` en `.env` (ver `.env.example` en la raíz del repo).

## Cómo correrlo

```bash
npm run radar                                  # todas las categorías activas
npm run radar -- --solo=claude,ia-capacitacion # solo esas (las demás se arrastran del índice)
npm run radar -- --sondeo                      # dry-run: 1 request por consulta, no escribe docs/
npm run radar -- --sondeo --q="asesoría de IA" # sondear una consulta suelta
```

`--sondeo` es lo que hay que correr **antes** de activar una categoría o agregar una variante: por
1 request por consulta imprime cuántos resultados trae y el veredicto del filtro sobre cada uno
(`confirmada` / `falta-requerido` / `excluida` / ruido), sin pagar un solo detalle. Deja el
registro en `output/sondeo-variantes.md`, incluyendo qué quedó sin probar si se acaba la cuota.

## Qué hace

1. Consulta **la unión de las variantes de todas las categorías activas** —no una vuelta por
   categoría— contra `/v2/compra-agil` con `estado=publicada`, deduplicando por `codigo`. Las
   categorías comparten consultas (`inteligencia artificial` la usan dos), y así se paga una sola
   vez. Otras categorías (gestión documental, reventa de otras licencias, desarrollo a medida)
   están definidas pero apagadas.
2. Descarta el ruido de `q` con **tres puertas** (`src/lib/categorias.ts`,
   `confirmarCategoriaEnTexto`):
   - `verificacion_regex` — que mencione la materia;
   - `patron_requerido` — que además hable del **servicio** que se busca (un *curso* de Power BI,
     no una *licencia* de Power BI);
   - `patron_excluyente` — que no sea otro rubro que usa las mismas palabras.

   Las dos últimas se evalúan sobre el texto **concatenado** (nombre + descripción + productos), no
   campo por campo: la co-ocurrencia que interesa vive en campos distintos —el nombre dice "Curso
   de capacitación" y el producto dice "Power BI"—, así que ninguna regex sobre un campo suelto
   puede expresarla. Lo que estas dos puertas descartan se publica en el reporte
   (`## Descartados por el filtro estricto`): un patrón demasiado ancho, si no se lista, se ve como
   oportunidades que desaparecen sin explicación. (`src/lib/marca.ts` es un wrapper delgado sobre
   la categoría `claude`, se mantiene por compatibilidad.)
3. Trae el detalle de cada código **una sola vez** (`/v2/compra-agil/{codigo}`) para tener
   `total_ofertas_recibidas` real y `productos_solicitados`, y con él clasifica la compra contra
   **todas** las categorías: como el detalle ya está pagado, recuperar acá una categoría que el
   nombre no alcanzaba a confirmar no cuesta una request más. Una compra puede caer en varias, y
   la tarjeta las muestra todas; al índice histórico entra con la primera (la de mayor prioridad
   según el orden de `config/categorias.json`). Si el detalle falla (504 transitorio), esa compra
   se publica con la ficha reducida del listado en vez de abortar la corrida.
4. Extrae condiciones con `src/lib/condiciones.ts`: tope presupuestario (siempre desde
   `presupuesto.monto_disponible_clp`, nunca parseado del texto), plan/versión detectado,
   cantidad de usuarios, plazo de entrega, documentos exigidos y frases excluyentes.
5. Descarga adjuntos solo si `documentos[]` no viene vacío (la mayoría de estas compras no
   traen adjuntos), vía el servicio público sin login (`src/lib/adjuntos.ts`).
6. Guarda todo en `data/<codigo>/{detalle.json, condiciones.json, attachments/}` y anexa una
   observación al índice histórico versionado (`historico/observaciones.jsonl`,
   `src/lib/indice.ts`) — con cero requests extra, el detalle ya se pagó. Es lo que le permite a
   una corrida en la nube (checkout limpio, sin `data/state.json`) sembrar el historial real al
   arrancar (`sembrarDesdeIndice`, paso 8) en vez de reportar todo como nuevo — ver
   PLAN-VOLUMEN.md, Fase 2. El backfill de estados que este radar no cubre (`desierta`,
   `cancelada`, `cerrada`) es el skill `compra-agil-indice` (`npm run indexar`).
7. Repite el barrido con `estado=proveedor_seleccionado` (compras adjudicadas), pero con **una
   sola variante ancha** por categoría, y solo en las que declaran `barrer_adjudicaciones: true`
   — medido en 0 casos en cada corrida hasta ahora, gastar una request por categoría para
   confirmar el mismo cero no se justifica (ver PLAN-VOLUMEN.md, Fase 0).
   Extrae la adjudicación con `extraerAdjudicacion` (`src/lib/api.ts`). Nota verificada: la API v2
   hoy no puebla el proveedor ganador ni el monto (campos vacíos); ese dato vive en la Orden de
   Compra del portal. Guarda `data/<codigo>/adjudicacion.json` y lo declara con honestidad.
8. Al arrancar, siembra `data/state.json` desde el índice histórico (`sembrarDesdeIndice`) antes
   de barrer nada, y lo actualiza a medida que avanza: marca qué códigos son nuevos y qué
   organismos ya tenían procesos previos (recompradores) — señal de alta probabilidad, avisan con
   antelación. Confirmado en producción: con `data/state.json` borrado a propósito (simulando un
   checkout limpio de la nube), el estado se repuebla correctamente desde el índice.
9. Escribe `output/radar-ultima-corrida.md` (con la sección de adjudicaciones) y lo imprime en
   consola. Las fechas de cierre se evalúan en hora de Chile (`src/lib/tiempo.ts`).

## Notas

- La cuota de la API es diaria por ticket. Cada request se cuenta contra `data/cuota/<hoy>.json` y
  `historico/cuota.jsonl` (`src/lib/cuota.ts`, `npm run cuota` para verlo). El radar tiene reserva
  prioritaria: su presupuesto por corrida es la suma de `presupuesto_requests_por_corrida` de las
  categorías activas (44 con las cinco de hoy). `npm run informe` y los scripts de índice/métricas
  rechazan correr si el radar no corrió hoy, salvo `--forzar` (ver PLAN-VOLUMEN.md).
- **Qué se sabe realmente de la cuota** (medido el 2026-08-20): 83 requests en un día sin un solo
  429. El único 429 registrado llegó a las 9 requests el 19-08 y no se ha vuelto a reproducir —
  era un episodio, no el límite. Hasta ese día el rollup solo anotaba días *con* 429
  (`anexarRollup` se llamaba solo desde `registrar429`), así que la cota inferior era `null`
  estructuralmente; ahora `cerrarDiasPendientes()` cierra también los días sin 429 y la medición
  puede converger.
- Que se acabe la cuota **ya no congela la página**: los errores de cuota no cuentan como variante
  rota, y las categorías que quedaron sin barrer se arrastran desde `historico/observaciones.jsonl`
  marcadas *sin re-verificar hoy*. La grilla solo se deja intacta si ninguna consulta llegó a la
  API. Lo mismo vale para `--solo`: las categorías activas que deja fuera se arrastran en vez de
  desaparecer de la grilla.

## Activar una categoría o agregar una variante

1. `npm run radar -- --sondeo --solo=<categoria>` — mide volumen y precisión por 1 request por
   consulta, sin tocar `docs/`.
2. Revisar `output/sondeo-variantes.md`: una consulta con 0 resultados no existe todavía en este
   mercado (anotarlo en su `_variantes_nota` antes de sacarla, para que nadie la re-agregue en seis
   meses); una con mucho volumen y casi todo ruido necesita una `verificacion_regex` más dura o
   `max_paginas_por_variante: 1`.
3. `activa: true` + `npm run radar -- --solo=claude,<categoria>`, y después `npm run cuota`.
4. Revisar `## Descartados por el filtro estricto` del reporte: si algo real cayó ahí, el
   `patron_requerido`/`patron_excluyente` está demasiado duro, y se afina **con el código concreto
   citado en la nota** — nunca con un falso positivo imaginado.

## El quirk del "de"

Cualquier `q` con la palabra suelta "de" responde `500 ERROR_INTERNO` de forma reproducible. El
guardrail vive en `compilar()` (`src/lib/categorias.ts`) y valida **todas** las categorías al
cargar, activas o no, así que el error salta al escribir la config y no a mitad de una corrida que
ya gastó cuota. `npm run keywords` y el formulario de `docs/index.html` rechazan lo mismo.

Medido el 2026-08-20 y relacionado: el `q` **no busca la frase, hace OR de los tokens**. `"Claude
Pro"` devolvía 34 resultados dominados por "Pro" (CANVA PRO, DRONE DJI MINI 5 PRO, PRO-RETENCION).
Por eso las variantes multi-palabra de `claude` se eliminaron: cuestan una request cada una y solo
agregan ruido, porque todo lo que menciona un plan de Claude ya cae bajo `Claude`.
- El servicio de adjuntos no es API documentada oficialmente; si empieza a fallar de forma
  consistente, revisar `src/lib/adjuntos.ts` (aislado a propósito) antes de asumir que el radar
  está roto.
- Este skill es de solo lectura. Para preparar una oferta usar `compra-agil-ofertar`, que sí
  requiere `config/company.json` con costos reales.

## Qué publica en `docs/index.html`

Cada corrida refresca dos bloques entre marcadores (`OPORTUNIDADES:*` y `KEYWORDS:*`); el resto de
la página es cabecera y pie.

Esa página era un informe del estado del proyecto escrito a mano, con las oportunidades pegadas
también a mano —y por lo tanto siempre desactualizadas—. A pedido del usuario quedó enfocada en una
sola pregunta: **¿conviene participar en esta Compra Ágil?**. Lo que no aporta a esa decisión
(estado de cada componente, pendientes del agente, comparaciones entre nichos) se eliminó: eso se
lee en el repositorio.

Cada tarjeta trae, todo desde la ficha oficial y sin inferir nada: tope, cierre con los días que
faltan, **quién puede ofertar** (primer llamado = reservado a Empresas de Menor Tamaño, que
KeepSync es), **cuánta competencia ya se presentó**, plan y usuarios detectados, vigencia, plazo y
dirección de entrega, los productos pedidos con sus cantidades, los **documentos exigidos y las
frases que dejan una oferta fuera** citadas tal como las escribió el organismo, los adjuntos
publicados, la región, y **lo que este mismo comprador hizo antes** (compras previas, cuántas
declaró desiertas, cuántas ofertas recibió en promedio) empatado por **RUT exacto** contra
`historico/observaciones.jsonl` — nunca por nombre, que llega truncado y en varias grafías.

Desde el 2026-08-20 cada tarjeta lleva además el **chip del nicho** al que pertenece (y todos, si
cae en varios), y la línea de resumen desglosa cuántas hay por nicho. El orden sigue siendo por
fecha de cierre, no por categoría: lo que decide si todavía se alcanza a ofertar es el plazo, y
agrupar por nicho obligaría a recorrer cinco bloques para saber qué cierra mañana.

El bloque de palabras clave publica las variantes `q`, la regex de verificación, y —cuando existen—
el `patron_requerido` y el `patron_excluyente` de cada categoría, con un formulario para agregar
más. Como la página es estática y no puede escribir en el repo, lo
agregado queda en el navegador marcado como **pendiente** y la página entrega el JSON listo para
`config/categorias-extra.json` (ver "Palabras clave" abajo).

## Palabras clave: dos archivos, dos públicos

- `config/categorias.json` — las categorías y sus regex de verificación. Se validan al compilar
  (id, flags, regex) y están afinadas contra casos reales: ampliarlas es trabajo de código.
- `config/categorias-extra.json` — **frases literales** agregadas a mano, sin regex. Cada una se usa
  como variante `q` contra la API (amplía el descubrimiento) y como verificación local del texto
  (amplía el filtro), comparada sin distinguir mayúsculas, tildes ni espacios de más. Se edita con
  `npm run keywords [-- agregar <categoria> "<frase>" | quitar "<frase>"]` o desde el formulario de
  la página.

**Ojo con la cuota**: cada frase agregada a una categoría activa suma al menos un request `q` por
corrida (más si esa categoría declara `max_paginas_por_variante` > 1).

**Ojo con el filtro estricto**: una frase agregada amplía el descubrimiento y la mención, pero
**no** exime del `patron_requerido` ni del `patron_excluyente` de su categoría. Agregar "Looker"
hace que el radar la busque, no que acepte una compra que no es un curso. Y no puede llevar la
palabra suelta "de" (ver arriba).

## Cuota agotada: la corrida sigue, con ficha reducida

Un 429 a mitad de corrida ya no tira abajo el radar (antes sí: no se publicaba nada, ni siquiera lo
ya encontrado). `CuotaApiAgotadaError` corta las llamadas y la corrida continúa con la **ficha
reducida del ítem del listado**, que en esta API es generoso: trae tope, cierre, comprador, región,
competencia, tipo de llamado y los nombres de los adjuntos. Lo que no trae —descripción, productos
solicitados, plazo de entrega, contadores de multas— queda vacío y la tarjeta lo declara.

Dos cosas que una ficha reducida **no** hace, a propósito: no entra al índice histórico (entraría
con ceros que parecen datos observados) y no puede descartar falsos positivos por el texto completo
— su mención está confirmada solo por el nombre.

Y lo que la corrida no alcanzó a mirar siquiera, se **arrastra del índice**: las categorías que
quedaron sin barrer aportan sus oportunidades conocidas que sigan abiertas, marcadas *sin
re-verificar hoy* y con la fecha de la última vez que sí se vieron. Por eso la grilla se publica
siempre, salvo que ninguna consulta haya llegado a la API. La regla anterior era todo-o-nada —una
variante caída y no se publicaba— y su efecto real era una página congelada con oportunidades ya
cerradas y sin ningún aviso.
