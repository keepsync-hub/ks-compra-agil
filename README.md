# ks-compra-agil

Agente que monitorea Compras Ágiles en mercadopublico.cl que piden licencias Claude/Anthropic,
prepara una cotización dentro del tope presupuestario, y deja lista una oferta (PDF + formulario)
para revisión y envío manual de un humano.

Diseño completo y hallazgos verificados contra la API real: ver `PLAN.md`. Estado del insumo
bloqueante (fulfillment) y guardrails: ver `CLAUDE.md`. Plan de crecimiento (índice histórico,
radar multi-categoría, calificador de admisibilidad) en ejecución: ver `PLAN-VOLUMEN.md`.

**Página de estado (GitHub Pages)**: `docs/index.html` (+ `docs/informe-nicho.html`) resume qué
está funcionando, las oportunidades abiertas con sus cotizaciones, y los pendientes. `docs/flujo.html`
es el diagrama del flujo completo paso a paso — qué hace cada skill y en qué puntos exactos se
detiene para que una persona actúe (incluida la sesión de Claude Cowork local para login +
formulario). `docs/array-compras-agiles.html` es una página aparte, de exploración de mercado
para [Array](http://www.array.cl/) (no para el nicho Claude de KeepSync) — ver
`npm run array-radar` (solo lectura) y `npm run array-cotizar` (agrega cotización PDF preliminar
por oportunidad, oferente KeepSync) más abajo. Se publica vía `.github/workflows/pages.yml`.

**Ojo con la publicación**: el entorno `github-pages` del repo solo acepta despliegues desde
`claude/mercadopublico-agente-compras-pgyedf`. Agregar otra rama al `on.push.branches` del
workflow hace que la corrida *arranque*, pero el deploy falla en ~1 segundo por la regla de
protección del entorno (así fallaron las corridas de `claude/array-agile-purchases-page-det2d4` y
`claude/revisar-contexto-plan-ttaumn`). Para que un cambio en `docs/` llegue al sitio público hay
que mergearlo a esa rama, o habilitar la rama nueva en Settings → Environments → `github-pages`.

## Setup

```bash
npm install
cp .env.example .env   # completar COMPRA_AGIL_API_TICKET (y CLAVE_UNICA_* si vas a ofertar desde una máquina local)
```

`config/company.json` (gitignored) ya tiene la identidad real de KeepSync (RUT 78.441.121-4,
confirmada con la ficha del proveedor de Mercado Público) y el pricing real (precio público de
Anthropic en USD → CLP con dólar observado en vivo → +19% IVA de costo → +10% markup → +19% IVA
de venta; incluye siempre taller de 3 h y comunidad de usuarios sin costo). Si se pierde o hay
que recrearlo, copiar `config/company.json.example` y completar los campos — el agente rechaza
el archivo (lanza error y no cotiza) mientras tenga placeholders `"COMPLETAR"` sin llenar. Si en
cambio el archivo está completo pero `identidad_confirmada` queda en `false`, sí se usa para
cotizar, pero cada PDF/PPTX generado queda marcado BORRADOR hasta que se confirme.

## Comandos

| Comando | Qué hace |
|---|---|
| `npm run keywords [-- agregar <categoria> "<frase>" \| quitar "<frase>"]` | Muestra o edita las palabras que busca el radar de Compra Ágil. Las frases van a `config/categorias-extra.json` y la corrida siguiente las usa como variante `q` y como verificación local, sin tocar las regex de `categorias.json`. Equivalente por consola del formulario de `docs/index.html`. Cada frase en una categoría activa suma al menos un request por corrida. Rechaza frases con la palabra suelta "de" (la API responde 500 a cualquier `q` que la incluya). Una frase agregada amplía el descubrimiento y la mención, pero **no** exime del `patron_requerido` ni del `patron_excluyente` de su categoría. |
| `npm run radar [-- --solo=<ids> \| --sondeo \| --q="<frase>"]` | Busca las Compras Ágiles abiertas de las **cinco categorías activas** (licencias Claude/Anthropic; asesoría y adopción de IA; cursos de IA; cursos de Power BI/Tableau; cursos de automatización n8n/Make/Zapier/Power Automate), extrae condiciones, detecta recompradores, baja los adjuntos y **publica `docs/index.html`** (oportunidades + palabras clave). Consulta la **unión** de las variantes de todas las categorías —no una vuelta por categoría— y pide **un solo detalle por código**, con el que clasifica la compra contra todas. Si la cuota se agota, sigue con la ficha reducida del listado, y lo que no alcanzó a barrer lo **arrastra del índice** marcado *sin re-verificar hoy* en vez de dejar la página congelada. `--solo` limita las categorías (las demás se arrastran igual); `--sondeo` es un dry-run de 1 request por consulta que imprime volumen y precisión sin pedir detalles ni escribir en `docs/`, y deja `output/sondeo-variantes.md`. Solo lectura. |
| `npm run leads [-- --estados=<lista> --categorias=<ids> --max-paginas=N --presupuesto=N --max-compras=N --solo-indice --rerevisar --con-detalle]` | Barrido **histórico** de las mismas categorías del radar pero en los **cinco estados** (`publicada`, `proveedor_seleccionado`, `cerrada`, `desierta`, `cancelada`), para extraer los contactos —nombre, correo, cargo, institución— de quienes publicaron esas compras, y publicar `docs/leads.html`. **No toca `docs/index.html`.** El dato de contacto no está en la API (`/v2/compra-agil` no expone ninguno): sale del texto de los ADJUNTOS, que se bajan por el servicio público y **no gastan cuota** — la cuota la gastan solo los listados. Acumula en `historico/leads.jsonl` y `historico/leads-revisiones.jsonl` (versionados), así que cada corrida continúa la anterior sin volver a bajar lo ya leído; `--rerevisar` fuerza lo contrario. `--solo-indice` corre con **0 requests** sobre lo ya conocido, y `--solo-conocidas --rerevisar` vuelve a pasar el extractor sobre los adjuntos **ya cacheados en disco** de todas las compras que alguna vez dieron un correo — también 0 requests: es como se itera el extractor sin re-pagar el descubrimiento. `--con-detalle` paga un request por compra para las que el `q` trajo pero ni el nombre ni los adjuntos confirman. Deja además `output/leads.md` y `output/leads.csv`. |
| `npm run informe` | Regenera `output/informe-nicho-claude.md` con el barrido histórico completo (tasa de fracaso, motivos, recompradores). |
| `npm run digest` | **Cero requests.** Prioriza las oportunidades del índice ya en caché (`data/<codigo>/detalle.json`, dejado por el radar): clasifica cada una en *Ofertar hoy* / *Revisar* / *Descartado*, calcula ventanas de republicación de los próximos 3 días, métricas de mercado por categoría (monto p25/mediana/p75, competencia, recompradores, motivos de fracaso) y **perfil por organismo comprador** (procesos, tasa de fracaso, monto mediano, último fracaso clasificado) para los que ya aparecen 2+ veces en el índice — el equivalente, con datos propios, a los "perfiles de comprador" que venden plataformas como Licify. Escribe `output/digest-ultimo.md` y anexa cada calificación a `historico/calificaciones.jsonl`. El score es un **orden de revisión sugerido**, nunca una probabilidad de ganar (cero ofertas enviadas todavía) — ver `src/lib/calificador.ts` y PLAN-VOLUMEN.md, Fase 4. |
| `npm run cotizar -- <codigo>` | Genera la cotización (`.pptx` fuente + `.pdf` publicable) para una compra específica, validando el tope. No envía nada. |
| `npx tsx .claude/skills/compra-agil-ofertar/scripts/login.ts --diagnostico` | Verifica si el portal es alcanzable desde el navegador antes de intentar login real. |
| `npm run form-fill -- <codigo>` | Completa el formulario de oferta en el portal y adjunta el PDF, sin enviar. Requiere login previo. |
| `npm run diagnostico-api` | Diagnóstico único de la API (¿`q` es opcional?, forma del payload, filtros de fecha, ticket clásico) — ver `PLAN-VOLUMEN.md`, Fase 0. Escribe `output/diagnostico-api.md`. |
| `npm run cuota` | Muestra el consumo de cuota de hoy y la convergencia pasiva del límite diario medido (`historico/cuota.jsonl`). Cero requests. |
| `npm run array-radar` | Busca Compras Ágiles publicadas relacionadas con los servicios de [Array](http://www.array.cl/) (oficina de partes, gestión documental/firma electrónica, RPA, BI, gestión de proyectos) y regenera `docs/array-compras-agiles.html`. Exploración de mercado independiente del nicho Claude — solo lectura. |
| `npm run array-cotizar` | Igual búsqueda que `array-radar`, más descarga de adjuntos y una cotización PDF preliminar por oportunidad (oferente KeepSync, precio = 80% del presupuesto disponible — no un costo real de Array, ver `.claude/skills/array-compras-agiles-cotizar/SKILL.md`). Regenera `docs/array-compras-agiles.html` con precio y PDF enlazado por tarjeta, y deja `docs/array-cotizaciones/index.json` para que `array-radar` no borre las cotizaciones al refrescar. |
| `npm run generar-documento -- <codigo> [NN…]` | Genera los documentos de una oferta: rellena los anexos `.docx` del organismo desde su plantilla marcada (`config/anexos/`) y arma la propuesta técnica / oferta económica en PDF desde `config/capacitaciones.json`. **No genera los documentos `acopio`** —título del relator/a, CV, certificados, órdenes de compra— porque los emite un tercero y producirlos sería falsificarlos: esos se suben desde la página de expediente. Sin plantilla no improvisa un documento propio: deja el documento en `bloqueado` y dice qué falta. Escribe `output/expedientes/<codigo>/`. |
| `npm run postear-n8n -- radar \| cotizacion <codigo> \| expediente <codigo> [--dry-run]` | Arma y postea a n8n el estado del repo. Para `radar` reutiliza `ultimaPorCodigo()` sobre `historico/observaciones.jsonl` — no hace falta un artefacto nuevo. `--dry-run` imprime el payload sin enviarlo, que es como se prueba sin `N8N_BASE_URL` / `N8N_CLAVE`. Lo llama `.github/workflows/mp.yml`. |
| `node n8n/construir.mjs <workflow>` | Arma el código SDK final de un workflow de n8n reemplazando los marcadores `__CHUNK:archivo__` por el contenido de `n8n/chunks/`, ya escapado. Necesario porque el builder del SDK no admite `import`, `require` ni `.join()`. Deja el resultado en `n8n/build/`. |
| `npm run transformacion-digital [-- --fichas=N --solo-indice --refiltrar --consultas=<lista> --estados=<lista>]` | Barre licitaciones de **Transformación Digital / Ley 21.180** —gestión documental web, procesos documentales, firma electrónica, DocDigital, FirmaGob, Exedoc—, **activas y pasadas** (los cinco estados del buscador), y publica `docs/transformacion-digital.html` + `docs/transformacion-digital-documentos.json`, el manifiesto que consume Claude Cowork en la Fase 2. **Cero cuota de API**: todo sale del buscador público y de las fichas públicas. Cuando una consulta topa en las 1.000 filas del portal, **rota el criterio de orden** para ver otro corte (medido: tres órdenes distintos comparten 162 de 1.000 filas y su unión da 2.545 códigos únicos) — no ventanea por fecha, y `licitaciones/PLAN.md` explica por qué. Por defecto **no baja ninguna ficha**: la página sale del CSV, que ya trae nombre y descripción completos; `--fichas=N` indexa las N primeras y es el costo real (~3 requests c/u). `--solo-indice` no consulta el portal pero sí puede seguir indexando fichas; `--refiltrar` recalibra las regex sobre el barrido ya descargado con **0 requests**, y `licitaciones/data/_td-descartados.json` dice qué patrón mató cada fila. |
| `npm run typecheck` | `tsc --noEmit`. |

## Agentes de GitHub Copilot (cloud agent)

Además de los skills de Claude Code, el repo expone la misma lógica como **custom agents de
GitHub Copilot** (`.github/agents/*.agent.md`) para poder correrla desde la nube sin una sesión
manual:

| Agente | Cubre | Qué NO hace |
|---|---|---|
| `compra-agil-radar` | El skill `compra-agil-radar-claude` completo (`npm run radar` + `npm run informe`). Solo lectura. | No cotiza ni toca `config/company.json`. |
| `compra-agil-cotizar` | Solo el Paso 1 del skill `compra-agil-ofertar` (`npm run cotizar -- <codigo>`). | Nunca corre `login.ts`/`form-fill.ts` (diferido a Cowork local) ni envía nada. |

Para usarlos: pestaña **Agents** del repo en GitHub → elegir el agente → indicar la rama y (para
`compra-agil-cotizar`) el código de la Compra Ágil. Cada corrida entrega un PR, nunca hace push
directo ni envía una oferta.

Para que `compra-agil-radar` corra solo (ej. diario), configurar una **automation** desde la
pestaña Agents (Settings → Copilot → Agents → Automations) apuntando a este agente con un
trigger "on a schedule" — esa programación se guarda del lado de GitHub, no como archivo en el
repo, así que hay que activarla manualmente una vez. Antes de activarla, cargar
`COMPRA_AGIL_API_TICKET` como *repository secret* (no en `.env`, que es solo para uso local).

## Segundo nicho: Licitaciones públicas para los servicios de Array

Réplica del radar y el cotizador, pero para **Licitaciones públicas** (no Compra Ágil) que piden los
servicios del catálogo de [Array](http://www.array.cl/) — oficina de partes electrónica, seguimiento
de trámites, gestión documental y firma electrónica, RPA, business intelligence y plataformas de
gestión de proyectos. Vive en `licitaciones/` (librería, config y datos propios) + los skills
`radar_licitaciones` y `cotizar_licitaciones` en `.claude/skills/`. Diseño completo, diferencias
respecto a Compra Ágil e insumos bloqueantes: ver `licitaciones/PLAN.md`.

**El radar corre entero sin gastar cuota de API** (reordenado el 2026-08-19). Las oportunidades que
publica en `docs/licitaciones.html` son reales y salen de fuentes públicas del portal:

- **Descubrimiento**: el buscador público de mercadopublico.cl, que **sí filtra por texto en el
  servidor** —la API con ticket no puede— y devuelve el **nombre y la descripción completos**. El
  listado de la API, además de costar cuota, traía el nombre truncado a ~50 caracteres y sin
  descripción. Como el texto llega completo, descartar un falso positivo ya no cuesta una llamada.
- **Ficha de cada licitación**: la ficha pública del portal, de donde salen organismo, tope, tipo,
  plazos, garantías, criterios de evaluación con su ponderación, anexos exigidos y documentos.
- **Datos que la API no tiene**: el tramo de monto cuando el organismo no publica la cifra ("Entre
  100 y 1000 UTM") y **cómo paga el comprador** — reclamos por pago no oportuno sobre las compras de
  los últimos 12 meses (medido: 0/484 en una municipalidad, 79/171 en otra).
- **El `LICITACIONES_API_TICKET` quedó opcional** (`--con-api`): su cuota se agotaba antes de la
  primera ficha, y lo único exclusivo que aporta (`CantidadReclamos`, total de reclamos al organismo
  sin causa) el portal ya lo entrega mejor desglosado. Con la cuota agotada la corrida no se pierde:
  sigue con la ficha pública y lo declara en el reporte.

Lo que sigue pendiente:

- **La API no expone adjuntos ni garantías**, pero la ficha PÚBLICA del portal sí trae el texto
  completo de las bases — y eso ya se lee automáticamente con `npm run antecedentes-licitacion --
  <codigo>` (sin ticket, sin cuota y sin login; verificado el 2026-08-19). Ahí están las garantías
  exigidas, los anexos que hay que presentar y los criterios de evaluación. Lo único que sigue
  necesitando a una persona son los ARCHIVOS adjuntos (PDF/DOCX): el portal los protege con
  reCAPTCHA por score. **Eso dejó de bloquear el flujo**: tener la URL de un documento es tener
  acceso a él, así que cada licitación publica su índice de documentos (ficha, foro, Excel de
  preguntas y respuestas, visor de adjuntos) con un campo que dice cuáles baja un script y cuál
  abre una persona. Los enlaces salen en cada tarjeta de `docs/licitaciones.html`.
- **El login al portal ya corre solo, y aun así no abre los adjuntos** (verificado end-to-end el
  2026-08-19). `npm run login-portal` autentica con ClaveÚnica y el agente lee el código de doble
  factor del correo, sin que intervenga nadie. Pero abrir el visor **con esa sesión autenticada**
  (`--con-login`) da el mismo rechazo que anónimo (score 0 vs 0.1, umbral 0.5): el gate puntúa el
  navegador y la IP, no la identidad. Desde una máquina con IP residencial puede pasar; es lo único
  que queda por medir. Ver "Acceso a los antecedentes" en `licitaciones/PLAN.md`.
- **No hay catálogo de costos reales** de KeepSync para gestión documental — a diferencia de
  licencias Claude, acá no existe un precio de lista público que copiar. `cotizar_licitaciones`
  sigue bloqueado por esto.

| Comando | Qué hace |
|---|---|
| `npm run keywords-licitaciones [-- agregar <categoria> "<frase>" \| quitar "<frase>"]` | Muestra o edita las palabras que busca el radar. Las frases agregadas van a `licitaciones/config/keywords-extra.json` y la corrida siguiente las usa como consulta al buscador y como confirmación local — sin tocar las regex de `keywords.json`. Es el equivalente por consola del formulario de `docs/licitaciones.html`. |
| `npm run radar-licitaciones` | Busca licitaciones abiertas de los servicios de Array por el buscador público del portal, baja sus bases y ficha de decisión, y publica `docs/licitaciones.html`. **Cero llamadas a la API**; `--con-api` agrega la ficha del ticket, `--max=N` cambia el cap, `--desde-cache` republica sin pedir nada. Solo lectura. |
| `npm run leer-adjuntos -- [<codigo>]` | Extrae el texto de los archivos que haya en `licitaciones/data/<codigo>/adjuntos/` (PDF con `pdfjs`, DOCX/XLSX con un lector de ZIP propio) y **rehace la ficha de decisión** incorporándolos, citando cada exigencia al archivo. Es el paso siguiente al clic humano en el visor del portal. |
| `npm run antecedentes-licitacion -- [<codigo> ...]` | Baja de la ficha **pública** del portal el contenido completo de las bases (garantías, anexos exigidos, criterios de evaluación) + el foro de preguntas, a `licitaciones/data/<codigo>/antecedentes.md`, **y el archivo Excel oficial de preguntas y respuestas** a `documentos/`. Escribe el **índice de documentos** (`documentos.json`) y **republica `docs/licitaciones.html`** con esos enlaces en cada tarjeta. Sin ticket, sin cuota, sin login y sin CAPTCHA. Sin argumentos, procesa todas las licitaciones en caché. |
| `npm run login-portal [-- --diagnostico] [--visible]` | Inicia sesión en el portal vía **ClaveÚnica** (`MP_USUARIO`/`MP_CLAVE` del entorno) y guarda `data/storageState.json`. El código de doble factor lo escribe el agente en `licitaciones/data/2fa-codigo.txt` tras leerlo del correo. `--diagnostico` verifica los selectores **sin usar credenciales**. Verificado contra producción el 2026-08-19. |
| `npm run adjuntos-licitacion -- <codigo> [--con-login] [--visible] [--diagnostico] [--sin-sesion]` | Baja los ARCHIVOS adjuntos abriendo el visor del portal con un navegador real. `--con-login` autentica en el mismo contexto antes de abrir el visor (`storageState.json` por sí solo **no** restaura la sesión del portal). Medido en la nube: score 0–0.1 contra umbral 0.5, autenticado o no → rechaza. `--diagnostico` responde si el gate deja pasar sin bajar nada. No rodea el control: si lo rechazan, se detiene. |
| `npm run cotizar-licitaciones -- <codigo>` | Genera la cotización (`.pptx` + `.pdf`) para una licitación específica, validando el tope. No envía nada. |

### Ficha de decisión

`antecedentes-licitacion` no deja solo el texto de las bases: genera `decision.json` / `decision.md`
con lo que responde **si vale la pena presentarse**, todo citado a la sección de la que salió —
banderas (⛔/⚠️/✅), plazos y días restantes, ventana de preguntas, tope, garantías, criterios de
evaluación con el peso del precio, anexos exigidos, cláusulas que dejan la oferta fuera y exigencias
detectadas en el texto. El resumen sale en cada tarjeta de `docs/licitaciones.html`.

Si los adjuntos (bases administrativas, EE.TT.) no se han leído, la ficha lo dice como bandera en
vez de dar la decisión por completa. Puestos esos archivos en `licitaciones/data/<codigo>/adjuntos/`,
`npm run leer-adjuntos` los incorpora.

Página de estado equivalente: `docs/licitaciones.html`, encabezada por las licitaciones abiertas
detectadas en la última corrida.

## Estudio de mercado del universo completo

Tres comandos, y solo el primero gasta cuota:

```bash
npm run mercado -- --forzar        # mide (5 etapas por valor decreciente, ~110 requests)
npm run estudio                    # analiza y publica (0 requests)
npm run criterios                  # propone criterios nuevos (0 requests)
```

`npm run mercado` mide en cinco etapas ordenadas de mayor a menor valor, para que un corte por cuota
se lleve siempre lo menos importante: **A** tamaño del universo por estado, **B** dimensionamiento de
~40 términos (1 request c/u), **C** muestra sistemática del universo sin `q` (el estrato anti-sesgo),
**D** desenlaces de la lista corta (tasa de éxito real, sobre estados terminales), **E** profundidad
y calibración. Cada etapa escribe apenas termina, así que un 429 degrada el informe en vez de
perderlo, y lo no medido se registra como `null` — nunca como 0. Flags: `--etapas=bcde`,
`--max-requests=N`, `--muestra=N`.

`npm run estudio` produce `output/estudio-mercado.md`, `output/estudio-mercado.json` y
`docs/estudio-mercado.html`. `npm run estudio -- --muestra=20` imprime compras concretas por familia
para auditar las regex a mano, que es la única forma real de ver falsos negativos sin fixtures.

Tres correcciones metodológicas que salieron de medir y que conviene no re-descubrir: `tamano_pagina`
va en **25** (con 50 la API da 504 tres de cada cuatro veces); `total_resultados` de una `q` es una
**cota superior contaminada** porque el buscador entra en la descripción, y hay que corregirla por la
precisión medida sobre los 10 nombres de muestra; y la API **topea** ese total en 10.000, así que los
estados terminales son cotas inferiores. Todo está anotado en `CLAUDE.md`.

## Panel operativo (n8n)

`docs/index.html` publica **resultados**; decidir y preparar una oferta se hace en el **panel
operativo**, que sirve n8n detrás de su login (esta página es pública y no puede guardar un secreto
ni el estado del trabajo). El botón «Abrir el panel operativo» está arriba de la grilla.

El panel lista las solicitudes con su estado y, por tarjeta: **Cotizar**, **Avanzar**, **Rechazar** y
—cuando avanza— **Expediente**. Avanzar crea en Drive
`KeepSync - Mercado Público - Panchito / <codigo> — <organismo> /` con `_ENTREGABLES` y una carpeta
por documento exigido. La página de expediente es donde se **cargan los antecedentes** de cada
documento y donde un botón **Generar** produce los que KeepSync puede producir; muestra además, por
documento, `sin insumos` / `con insumos (N)` / `listo`.

El reparto: n8n orquesta, guarda estado y habla con Drive; `.github/workflows/mp.yml` corre el radar,
el cotizador y el generador **reales del repo**. Los tres workflows están versionados en
`n8n/workflows/`. **Nada de esto envía una oferta**: el envío al portal lo hace siempre una persona,
y `_ENTREGABLES` es bandeja de revisión, no de salida.

Para que funcione hacen falta tres cosas que no puede hacer el agente: los secretos del repo
(`COMPRA_AGIL_TICKET`, `N8N_BASE_URL`, `N8N_CLAVE`), una credencial `httpHeaderAuth` en n8n con la
cabecera `X-KS-Clave` apuntada al webhook de ingesta, y habilitar esta rama en
Settings → Environments → github-pages (si no, `docs/panel/*.css|js` no se sirve y el panel se ve sin
estilo).

## Listado de leads: quién compra esto (`npm run leads` → `docs/leads.html`)

El radar responde "¿conviene participar en esta compra?". Este barrido responde otra pregunta, y por
eso es un script y una página aparte: **"¿a quién le escribo?"**. Mira las mismas cinco categorías,
pero en los **cinco estados** —incluidas `cerrada`, `proveedor_seleccionado`, `desierta` y
`cancelada`—, porque para vender un organismo que ya compró vale más que uno que todavía no.

Tres cosas hay que saber antes de tocar este código:

1. **La API no expone ningún dato de contacto.** Se verificó pidiendo el detalle completo de una
   compra cerrada (`607-180-COT26`): el payload trae organismo, RUT y unidad de compra, y nada más
   —ni comprador, ni requirente, ni correo—. El nombre y el correo viven en los **adjuntos** (EE.TT.,
   "solicitud de cotización", formulario de requerimiento), en frases del tipo *"el proveedor deberá
   tomar contacto con el encargado … al correo electrónico X"* o en el bloque de firma.
2. **Los adjuntos no gastan cuota.** Se bajan por `adjunto.mercadopublico.cl` (el mismo servicio
   público que ya usa el radar), así que el barrido puede leer cientos de documentos pagando cuota
   solo por los listados. El tope de compras por corrida (`--max-compras`) se mide en **tiempo**, no
   en cuota.
3. **El rendimiento del método es bajo por diseño del instrumento, y la página lo publica.** Muchas
   Compras Ágiles no traen ningún adjunto, y varias de las que traen son PDF escaneados sin capa de
   texto. La tabla "Qué mide y qué no alcanza a ver esta corrida" dice cuántas compras se revisaron,
   cuántas dejaron contacto y cuántas se perdieron por cada motivo, en vez de publicar solo los
   aciertos.

**Nada se afirma sin cita.** Cada contacto guarda el archivo del que salió y la ventana de texto que
lo rodea, y la tarjeta las muestra: los nombres se leen de PDF maquetados por el propio organismo, y
un PDF con tablas puede pegar dos campos distintos. Cuando el nombre no está en el documento y solo
se pudo **deducir del correo** (`juan.perez@…`), se publica marcado como deducción con confianza
baja. Cuando no hay nombre de ninguna forma, el lead se publica igual sin inventarlo: un
`adquisiciones@` es un contacto perfectamente útil, y va rotulado como buzón de área.

**Lo medido en el primer barrido completo (2026-08-24), que es lo que hay que saber antes de tocar
esto:** 65 combinaciones de consulta × estado costaron **93 requests** y descubrieron 258 compras;
sus adjuntos —gratis— dieron **62 contactos útiles para vender en 41 instituciones**, 29 de ellos con
nombre de persona. El rendimiento real es **97 de 258 compras (38%)**: 34 no traen ningún adjunto y
varias traen PDF escaneados sin capa de texto. Y hubo que separar una categoría entera que en la
primera pasada copó el listado: los **buzones de cuentas por pagar** (`facturas@`, los DTE de
`custodium.com`/`febos.cl`, un RUT como buzón), que se repiten en cada compra del mismo organismo
porque van en la cláusula administrativa de facturación. Son contactos reales, pero de un área que no
decide nada: quedan clasificados aparte y no se cuentan como leads.

El índice se acumula en `historico/leads.jsonl` (los contactos) y `historico/leads-revisiones.jsonl`
(qué compras ya se miraron, con contacto o sin él). Los dos van a `historico/` y no a `data/` por la
misma razón que `observaciones.jsonl`: `data/` es efímero y gitignored, y sin persistencia versionada
cada corrida volvería a bajar los mismos cientos de adjuntos. La página se regenera **entera** desde
ese índice, así que se puede correr `--solo-indice` (0 requests) para republicarla sin tocar la API.

Sobre los datos: son puntos de contacto **funcionales, publicados por el propio Estado** dentro de un
procedimiento de compra —el correo está ahí justamente para que un proveedor escriba—. Aun así la
página se publica con `noindex`, y dice de frente que un primer contacto en frío debería mencionar la
compra concreta de la que salió el dato y ofrecer una salida clara.

## Transformación Digital y Ley 21.180: qué le pide el Estado a un sistema documental

`npm run transformacion-digital` → **`docs/transformacion-digital.html`** +
**`docs/transformacion-digital-documentos.json`**

Es la **Fase 1 de tres**, y conviene tener claro dónde termina:

| Fase | Qué | Dónde corre |
|---|---|---|
| **1 — buscar** | Encontrar las licitaciones del nicho, activas y pasadas, y publicar el acceso ordenado a sus documentos. | Este repo. **Hecho.** |
| **2 — bajar** | Descargar cada documento a una carpeta local para leer los requerimientos completos. | Claude Cowork, en la máquina del usuario: los adjuntos están tras el reCAPTCHA del visor del portal. |
| **3 — comparar** | Cruzar esos requerimientos contra la documentación del sistema actual e identificar brechas. | **Sin baseline todavía**: esa documentación no existe en el repo y no se inventa. |

Lo que la primera corrida completa dejó (2026-08-25): **72 licitaciones**, 59 organismos distintos,
**288 documentos indexados** (216 descargables por script, 72 tras el reCAPTCHA) y **156
requerimientos funcionales detectados**, cada uno con su cita literal y la sección de las bases de
donde salió. 19 de las 72 citan la Ley 21.180 o la transformación digital del Estado explícitamente.

**El manifiesto es el entregable de la Fase 2.** `docs/transformacion-digital-documentos.json` trae,
por licitación, su orden, la carpeta destino sugerida y cada documento con su URL y su campo
`acceso`: `directo` (un `fetch` lo trae sin autenticación — ficha, foro, Excel de preguntas) o
`navegador` (el visor de adjuntos, que abre una persona). El campo `esquema` está versionado para que
la Fase 2 falle ruidosamente si cambia, en vez de adivinar. Y el estado de las descargas **no** se
escribe ahí: la Fase 2 lleva el suyo, para que el manifiesto siga siendo reproducible desde el
índice.

**El orden de la página no es cronológico**, y está explicado en la propia página: existe para
decidir de qué licitación bajar los documentos primero, y para eso una adjudicada del año pasado vale
más que una publicada ayer — ya tiene el foro respondido, las bases definitivas y el acta de
adjudicación.

**Lo que la página declara de sí misma**, porque una lista sin su margen de error se lee como si
fuera completa: cuántas de las 50 combinaciones consulta × estado toparon en las 1.000 filas del
portal (15) y en cuáles se rotó el orden (42 pasadas); que el buscador matchea tokens sueltos —
`ley 21.180` sobre cerradas devuelve 1.000 filas encabezadas por *"ADQUISICIÓN DE MATERIAL
DEPORTIVO"*—; cuántas filas descartó cada excluyente; y que los requerimientos son un detector por
patrón sobre el texto disponible, no una lectura del pliego.

Los patrones viven en `licitaciones/config/transformacion-digital.json`, con el caso real citado en
cada excluyente. Se recalibran editando el JSON y corriendo `--refiltrar`, que no gasta requests.
Detalle del diseño y de lo medido: la sección "Cuarto frente" de `CLAUDE.md`.

## Estado y pendientes

- **Inteligencia de mercado y digest priorizado (`npm run digest`): implementados** — Fases 3 y 4
  de `PLAN-VOLUMEN.md`. `src/lib/motivos.ts` clasifica el texto declarado de cada fracaso
  (`comprador`/`precio`/`tecnico`/`administrativo`), validado a mano contra las 29 frases no
  repetidas de `output/informe-nicho-claude.md` (0 sin clasificar) — **falta todavía** el fixture
  formal de 37 casos + `npm run verificar-motivos` con matriz de confusión que pide el plan.
  `src/lib/metricas.ts` calcula percentiles de monto, tasa de fracaso, competencia mediana y
  ventana de republicación **directamente del índice**, cero requests. `src/lib/calificador.ts`
  aplica los bloqueantes duros (cerrado, acreditación faltante, sobre tope) y señala blandas con
  pesos declarados en `config/calificador.json` — etiquetado siempre como "orden de revisión
  sugerido", nunca "probabilidad de ganar", porque los pesos son juicio inicial (cero ofertas
  enviadas). Con `historico/observaciones.jsonl` todavía chico (9 observaciones en este entorno,
  sin `COMPRA_AGIL_API_TICKET` para hacer `npm run indexar --solo-cache` con el histórico completo
  de 47 casos), tratar las métricas como orientativas — el digest lo dice explícitamente.
- **Radar e informe del nicho: funcionando de punta a punta contra la API real** — encuentra las
  oportunidades abiertas reales y reproduce la tasa de fracaso medida en `PLAN.md` (~79-80%).
- **Radar multi-nicho, verificado en producción el 2026-08-20**: con las cinco categorías activas,
  11 consultas únicas trajeron 21 códigos, de los que 5 pasaron el filtro (3 licencias Claude, 1
  curso de Power BI, 1 capacitación en IA). Lo medido ese día, que condicionó el diseño: el `q` de
  la API **hace OR de los tokens, no busca la frase** (`"Claude Pro"` devolvía 34 resultados
  dominados por "Pro": CANVA PRO, DRONE DJI MINI 5 PRO, PRO-RETENCION), así que las variantes
  multi-palabra se eliminaron; `n8n`, `Zapier` y `Make.com` devuelven 0 resultados hoy (ese mercado
  todavía no existe en Compra Ágil, pero cuestan 1 request y son la única puerta si aparece); y el
  `patron_requerido` de `ia-asesoria` se afinó con un falso positivo real —una compra de licencias
  Claude entraba como "asesoría" porque el catálogo del plan dice "habilitación anticipada de
  nuevas funcionalidades"—. 83 requests ese día, 0 códigos 429.
- **Cotización (`cotizar.ts`): funcionando de punta a punta**, con la identidad real de KeepSync
  ya cargada. Genera `.pptx` (fuente editable) y `.pdf` (artefacto final a publicar/enviar,
  `archivo_publicable` en `cotizacion-resumen.json`). El PDF se renderiza con Chromium/Playwright
  a partir de HTML (`src/lib/cotizacion-html.ts`), no convirtiendo el `.pptx` con LibreOffice:
  `soffice` no funciona en el entorno donde se escribió este código (falla incluso con un `.txt`
  vacío — diagnosticado con `strace`, no es un problema de los archivos).
- **Login + formulario (`login.ts`, `form-fill.ts`): la lógica está escrita; el login ya no está
  bloqueado, el formulario sí sigue sin verificarse.** Dos cosas que este archivo daba por ciertas
  resultaron falsas, y quedó demostrado el 2026-08-19 haciendo un login real desde la nube con
  `npm run login-portal` (el equivalente del dominio de licitaciones):
  1. El `ERR_CONNECTION_RESET` de Chromium **no era un bloqueo de fingerprint/WAF**: era TLS 1.3
     contra el proxy del sandbox. Con `CHROMIUM_EXTRA_ARGS=--ssl-version-max=tls1.2` navega normal.
  2. Los selectores `#uname`/`#pword` **sí existen** en ClaveÚnica. Lo que no sirve es `page.fill()`:
     el botón nace deshabilitado y la página lo habilita escuchando el teclado (hay que escribir con
     `pressSequentially`), y entre la clave y el código hay una pantalla "Continuar" que es la que
     dispara el envío del correo.
  El código de doble factor lo lee el agente del Gmail del usuario, así que el login completo corre
  sin que intervenga nadie. Lo que sigue diferido a **Claude Cowork en una máquina local** es el
  llenado y envío del formulario de oferta (`form-fill.ts`), cuyos selectores nunca se vieron contra
  el DOM real — están marcados `TODO(verificar en vivo)`; revisarlos con `page.pause()` en esa
  sesión. Ver `docs/flujo.html` para el diagrama de dónde exactamente entra la persona.
- **`output/` se versiona en el repo a propósito** (cotizaciones `.pptx`/`.pdf`, resúmenes,
  notas, informes) — es el respaldo completo para la sesión local de Cowork y para cualquiera
  que necesite revisar el trabajo sin correr nada.
