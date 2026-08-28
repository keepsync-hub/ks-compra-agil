# ks-compra-agil

Agente que monitorea Compras Ágiles en mercadopublico.cl de cinco nichos —licencias
Claude/Anthropic, asesoría y adopción de inteligencia artificial, y cursos de IA, de Power
BI/Tableau y de automatización no-code (n8n, Make, Zapier, Power Automate)—, prepara una cotización
dentro del tope presupuestario, y deja lista una oferta (formulario + PDF) para revisión y envío
manual de un humano.

El nicho de licencias sigue frenado por el insumo bloqueante de más abajo; los cuatro nichos de
servicios (asesoría y cursos) se agregaron el 2026-08-20 justamente porque no dependen de él:
capacitar y asesorar es algo que KeepSync puede facturar por sí mismo.

**Antes de escribir código, lee `PLAN.md` completo.** Contiene el diseño validado contra la API
real de producción (no supuestos): estructura de datos verificada, endpoints reales, un
servicio no documentado para descargar adjuntos sin login, y una medición del nicho (47 casos
históricos, 79% de fracaso, patrón de recompradores — cifras vivas en
`output/informe-nicho-claude.md`, regenerables con `npm run informe`) que condiciona varias
decisiones de diseño.

## Las páginas publicadas (`docs/`)

`docs/index.html` (Compras Ágiles de los cinco nichos: licencias Claude, asesoría/adopción de IA, y
cursos de IA, de Power BI/Tableau y de automatización) y `docs/licitaciones.html` (licitaciones de
los servicios de Array) son **páginas de resultados, no de estado del proyecto**: cada corrida del
radar respectivo refresca sus dos bloques entre marcadores (oportunidades y palabras clave) y todo
lo demás se eliminó a pedido del usuario. En `docs/index.html` hay además un **tercer bloque**
entre marcadores, "Borradores de cotización" (`COTIZACIONES:INICIO/FIN`), que escribe
`npm run cotizar-capacitacion` — no el radar; cada script reescribe solo los suyos — el estado del agente se lee en este archivo, `PLAN.md`,
`PLAN-VOLUMEN.md` y `README.md`. Al tocar esas páginas, mantener el criterio: si un párrafo no ayuda
a decidir si participar en una compra concreta, no va ahí.

Las dos publican también **qué palabras busca el radar**, con un formulario para agregar. En la de
Compra Ágil, cada categoría publica además su `patron_requerido` y su `patron_excluyente` cuando los
tiene: varias exigen que la compra sea del **servicio** buscado y no solo que mencione la materia
—un *curso* de Power BI, no una *licencia* de Power BI—, y una palabra agregada a mano amplía la
búsqueda pero **no salta esos dos filtros**. Como son
estáticas (GitHub Pages) no pueden escribir en el repo: lo agregado queda en el navegador marcado
como pendiente, y se persiste pegando el JSON en `config/categorias-extra.json` (Compra Ágil) o
`licitaciones/config/keywords-extra.json` (licitaciones), o con `npm run keywords` /
`npm run keywords-licitaciones`. Esos dos archivos son de **frases literales**, no de regex.

Hay una tercera página generada entera desde cero, `docs/transformacion-digital.html` (ver "Cuarto
frente" más abajo), que no usa marcadores y no toca a las otras dos. Su formulario de palabras clave
es **de solo lectura** a propósito: las dos páginas viejas comparten la llave de `localStorage`
`ks-lic-kw-pendientes` en el mismo origen y sus pendientes se mezclan; no repetir ese patrón.

## Estado del proyecto

Implementado y probado contra la API real: scaffolding, el skill `compra-agil-radar-claude`
(radar multi-nicho + informe del nicho Claude) y el skill `compra-agil-ofertar` (cotizador con PDF
publicable),
más la página de estado en GitHub Pages (`docs/`). El login a ClaveÚnica y el llenado del
formulario del portal (`login.ts` / `form-fill.ts`) tienen toda la lógica escrita pero están
diferidos a una sesión con **Claude Cowork en una máquina local** — ver `docs/flujo.html` para
el flujo completo (con foco en dónde entra la persona) y la sección "Estado y pendientes" de
`README.md` para el detalle componente por componente.

## Cotizar capacitaciones: otra regla de precio, mismo gate humano

`npm run cotizar-capacitacion` cubre el nicho de **cursos** (los cuatro de servicios), que no puede
usar la fórmula de licencias Claude porque no hay precio de lista ni catálogo de costos. Regla fijada
por el usuario el 2026-08-22: **precio = tope × 0,9**. Genera un PDF de exactamente 5 láminas por
oportunidad en `output/capacitaciones/<codigo>/`, respondiendo punto por punto lo que exigen los
adjuntos del organismo (extraídos a `config/capacitaciones.json`, con cita del régimen tributario),
y lo **publica en `docs/index.html`** con sus observaciones: un tercer bloque entre marcadores
(`COTIZACIONES:INICIO/FIN`) que convive con los dos que refresca el radar sin pisarse.

Cada tarjeta encabeza con un **score de apertura (0–100%)** que ordena el foco: 100% es una compra
que no exige ninguna característica, capacidad o certificación particular que dirija la
adjudicación, y baja 5% por cada criterio que falte revisar (`criterios_direccionadores` en
`config/capacitaciones.json`, cada uno con su cita; el cálculo, en `src/lib/scoring-capacitacion.ts`).
Hoy hay **diez borradores**, seis de la tanda del 2026-08-22 (Dipres 85% y 75% dos, Subtrans 65%,
Concepción 60%, Hospital Padre Hurtado 45% — este último exige las últimas 12 órdenes de compra del
mismo curso, el filtro más direccionador de todas) y cuatro del 2026-08-27: Poder Judicial (Power BI)
70%, Lo Barnechea (emprendimiento + IA) 65%, Combarbalá (IA en salud) 60% y DAEM Osorno (IA para
docentes) 55%. **No es una probabilidad de adjudicación**: es cuánto de la admisibilidad está sin
resolver.

Las seis primeras ya cerraron y siguen publicadas —el índice de cotizaciones se acumula y no borra,
para que una corrida de un solo código no haga desaparecer a las demás—, así que la tarjeta las marca
*Cerrada* y las manda al final de la grilla. Publicar un borrador de una compra en la que ya no se
puede ofertar, sin decirlo, es el mismo defecto que la grilla de oportunidades corrigió.

Dos cosas que condicionan todo el nicho y no las resuelve el cotizador: **ninguna oferta nombra
relator/a** (los TDR exigen título, CV y certificados verificables, y sin eso la oferta se
descarta en admisibilidad), y **sigue sin confirmarse si KeepSync es OTEC registrada en SENCE** —
de eso dependen tanto puntaje directo en algunas bases como la exención de IVA del art. 13 N°4 con
que Dipres presupuesta. Ver el detalle en `.claude/skills/compra-agil-ofertar/SKILL.md`.

Dos de las seis compras del barrido del 2026-08-27 quedaron **sin cotizar, y el archivo dice por
qué** (`_no_cotizadas` en `config/capacitaciones.json`): la de Penco trae su único adjunto como PDF
escaneado sin capa de texto —llenar la ficha exigiría OCR o inventar el curso—, y la del INIA no es
capacitación sino créditos de API de Claude y ChatGPT, que van por `npm run cotizar` y siguen
frenadas por el insumo bloqueante del nicho de licencias.

## Regla de cálculo para cotizaciones en USD (`cotizar-usd`)

`npm run cotizar-usd -- <monto_usd> [tipo_cambio]` implementa una regla de precio para costos en
USD fijada por el usuario el 2026-08-28, documentada en `.claude/skills/cotizar-usd/SKILL.md` e
implementada en `src/lib/pricing-usd.ts` (`calcularCotizacionUsd`): (1) tipo de cambio observado +
5,5% de recargo, (2) costo en CLP con ese tipo de cambio ajustado, (3) +19% de impuesto no
recuperable (costo para KeepSync, no el IVA de venta), (4) +15% de markup sobre ese costo —el
resultado es el precio a utilizar en la cotización—, (5) +19% de IVA de venta para el valor final
a presentar. Es decir `valor_final = monto_usd × tc_observado × 1,055 × 1,19 × 1,15 × 1,19`.

**No reemplaza (todavía) la fórmula ya en producción** de `cotizarLinea` (`src/lib/pricing.ts`,
`npm run cotizar`, licencias Claude): esa usa el tipo de cambio observado sin recargo y
`markup_pct` de `company.json` (hoy 10%, no 15%). Son lo bastante distintas como para no asumir
que una reemplaza a la otra sin que el usuario lo confirme explícitamente — ver la tabla
comparativa en el SKILL.md del skill.

## Listado de leads: el único dato que la API no tiene

`npm run leads` barre las **mismas cinco categorías del radar en los cinco estados** —incluidas
`cerrada`, `proveedor_seleccionado`, `desierta` y `cancelada`, que al radar no le sirven porque ya no
se puede ofertar, pero que acá son las mejores: son organismos que ya demostraron que compran esto— y
publica `docs/leads.html`, una página **nueva y separada**. No toca `docs/index.html` ni sus tres
pares de marcadores.

Lo que hay que saber antes de tocar esto:

- **`/v2/compra-agil` no expone contacto alguno.** Verificado pidiendo el detalle de `607-180-COT26`:
  organismo, RUT y unidad de compra, y nada más. El nombre y el correo están en los **adjuntos**, y
  esos se bajan por el servicio público de `adjuntos.ts`, que **no gasta cuota**. La cuota la gastan
  solo los listados: el tope de compras por corrida se mide en tiempo, no en requests.
- **El embudo de categoría se cierra con el texto de los adjuntos, gratis.** Una compra cuyo nombre
  dice "Power BI" pero no dice si es un *curso* queda "por verificar" y la resuelve el texto de sus
  bases, sin pagar el detalle. Lo que ni el nombre ni los adjuntos confirman se descarta y **se
  reporta**; solo `--con-detalle` (apagado por defecto) paga un request por compra para recuperarlo.
- **Nada se afirma sin cita.** Cada contacto guarda archivo + ventana de texto, y la tarjeta las
  muestra. Un nombre que solo se pudo deducir del correo (`juan.perez@…`) se publica **marcado como
  deducción**, con confianza baja; si no hay nombre, el lead se publica igual sin inventarlo y
  rotulado como buzón de área (`adquisiciones@` es un contacto útil, no un defecto).
- **El rendimiento del método es bajo y la página lo dice.** Muchas Compras Ágiles no traen adjuntos
  y varias traen PDF escaneados sin capa de texto. La tabla de cierre publica cuántas compras se
  revisaron, cuántas dejaron contacto y qué se perdió por cada motivo.

**Lo medido en el primer barrido completo (2026-08-24), que es lo que hay que saber antes de tocar
esto:** 65 combinaciones de consulta × estado costaron **93 requests** y descubrieron 258 compras;
sus adjuntos —gratis— dieron **62 contactos útiles para vender en 41 instituciones**, 29 de ellos con
nombre de persona. El rendimiento real es **97 de 258 compras (38%)**: 34 no traen ningún adjunto y
varias traen PDF escaneados sin capa de texto. Y hubo que separar una categoría entera que en la
primera pasada copó el listado: los **buzones de cuentas por pagar** (`facturas@`, los DTE de
`custodium.com`/`febos.cl`, un RUT como buzón), que se repiten en cada compra del mismo organismo
porque van en la cláusula administrativa de facturación. Son contactos reales, pero de un área que no
decide nada: quedan clasificados aparte y no se cuentan como leads.

El índice se acumula en `historico/leads.jsonl` y `historico/leads-revisiones.jsonl` (versionados,
como `observaciones.jsonl`, porque `data/` es efímero): cada corrida continúa la anterior sin volver a
bajar lo ya leído, y `--solo-indice` republica la página con **0 requests**. La página se publica con
`noindex` y declara el origen de los datos —puntos de contacto funcionales que el propio Estado
publica dentro del procedimiento de compra— además de recomendar que el primer correo cite la compra
de la que salió el dato.

## Panel operativo y expediente de oferta (n8n + GitHub Actions)

Entre «esta compra me sirve» y «tengo la oferta lista» no había nada, y los seis TDR de capacitación
exigen entre 3 y 12 documentos cada uno. Eso lo cubre ahora un **panel operativo servido por n8n**,
al que se entra con un botón desde `docs/index.html` (fuera de los tres pares de marcadores, para que
ni el radar ni el cotizador lo pisen).

**El reparto de trabajo, que es lo que hay que entender antes de tocar esto:**

- **n8n** sirve las páginas, autentica (su propio login: la página pública no puede guardar un
  secreto), guarda el estado en la Data Table `mp_solicitudes`, y **es el único que habla con Drive**.
- **GitHub Actions** (`.github/workflows/mp.yml`) corre el radar, el cotizador y el generador
  **reales del repo**. n8n no reimplementa nada del negocio.
- `radar.ts` y `cotizar-capacitacion.ts` **no se tocaron**: el puente
  (`src/scripts/postear-n8n.ts`) lee `historico/observaciones.jsonl` con `ultimaPorCodigo()` y
  `data/<codigo>/condiciones.json`, que esos scripts ya producen.

**Un solo workflow de Actions, con `concurrency: mp-repo`**, porque dos workflows empujando a la
misma rama hacían fallar el segundo y el tercer clic seguidos con non-fast-forward. Y correr radar +
cotizador + generador en el mismo job resuelve gratis que `data/` sea efímero y gitignored: el
cotizador encuentra su `detalle.json` y el generador encuentra los anexos en blanco de
`data/<codigo>/attachments/`.

Piezas en n8n: `MP · Panel` (`6TTvRQZrzmrW3Oa6`), `MP · Acciones` (`wJbA7Fq4pHtUAwjz`),
`MP · Carpetas Drive` (`do3woax6AGPYxEAN`), tabla `mp_solicitudes` (`hZ7iJZTkt01XfRUc`). La fuente
está versionada en `n8n/workflows/*.ts`; `n8n/construir.mjs` inyecta los chunks de `n8n/chunks/`
ya escapados, porque el SDK del builder es un subconjunto muy acotado de TypeScript (sin `import`,
sin `Object.assign`, sin `.join()`). El CSS y el JS de las páginas viven en **`docs/panel/`** y los
sirve Pages: así quedan revisables en el diff en vez de enterrados en un literal del workflow.

**Freno de cuota de 15 minutos** en `/mp/radar`: cada corrida barre todas las categorías activas y el
repo tiene un 429 documentado a las 9 requests.

## Generar documentos: tres naturalezas, no una

`npm run generar-documento -- <codigo> [NN…]` produce los documentos de una oferta. La distinción que
ordena todo —y que hace honesto el botón «Generar»— está en `src/lib/documentos-oferta.ts`:

| tipo | Qué es | Qué hace «Generar» |
|---|---|---|
| `formulario` | El anexo .docx del propio organismo. | Rellena su plantilla oficial (`config/anexos/<slug>.docx` + `.json`), conservando el diseño. |
| `generable` | Propuesta técnica, oferta económica. | La arma desde `config/capacitaciones.json` y `config/company.json` y la renderiza a PDF. |
| `acopio` | Título del relator/a, CV, certificados, órdenes de compra. | **Nada: no se puede.** Lo emite un tercero; producirlo sería falsificar evidencia. Se sube al expediente. |

De los 30 documentos exigidos por las seis compras fichadas, **15 son `acopio`** — la mitad. En
Dipres, tres de seis. La página lo dice de frente en vez de dejar creer que «Generar» completa el
expediente.

**Rellenar un .docx no es automático** y conviene saberlo antes de tocar `src/lib/anexo-docx.ts`: el
anexo en blanco no trae marcadores y Word parte el texto en `<w:r>` arbitrarios, así que un
buscar-y-reemplazar sobre el XML falla **en silencio** dejando el anexo a medio llenar — causal de
inadmisibilidad. Se marca el anexo con `{campo}` **una vez por anexo** (ver `config/anexos/README.md`)
y de ahí el relleno es determinista y reutilizable: los tres códigos de Dipres comparten sus anexos.
Sin plantilla, el generador **no improvisa un documento propio**: deja el documento en `bloqueado` y
dice qué falta.

En Drive queda `KeepSync - Mercado Público - Panchito / <codigo> — <organismo> /` con `_ENTREGABLES`
y una carpeta numerada por documento. El entregable terminado se empareja con su carpeta **por el
prefijo `NN`**, no por el nombre completo. Todo nivel se crea con find-or-create: Drive admite dos
carpetas con el mismo nombre en el mismo padre, así que sin el diff cada clic en «Avanzar» duplicaría
el árbol en silencio.

**Guardrails que este flujo no relaja:** nada escribe en mercadopublico.cl, `_ENTREGABLES` es bandeja
de **revisión** y no de salida, y los dos bloqueos de admisibilidad del nicho —ninguna oferta nombra
relator/a, y sigue sin confirmarse si KeepSync es OTEC en SENCE— aparecen ahora en el panel, en el
expediente y **dentro del PDF generado**. Hacerlos visibles no es resolverlos.

## Insumo bloqueante (sigue condicionando el envío real de una oferta)

**¿KeepSync tiene una vía real para proveer y facturar licencias Claude/Anthropic, y a qué
costo?** El 79% de las Compras Ágiles que piden Claude históricamente terminan desiertas o
canceladas *pese a recibir varias cotizaciones* — la hipótesis de trabajo es que el cuello de
botella es de fulfillment (poder entregar/facturar legítimamente), no de encontrar
oportunidades. El skill de cotización ya está construido (genera PDF/PPTX reales dentro del
tope, con la identidad de KeepSync confirmada como proveedor hábil), pero eso **no** resuelve
por sí solo esta pregunta de fondo: confirmarla con el usuario sigue siendo el gate antes de
que una oferta real llegue a enviarse a un organismo comprador — el envío final lo hace un
humano y nunca el agente (ver guardrails abajo). El radar y el informe del nicho
(`output/informe-nicho-claude.md`) sí tienen valor aunque esta pregunta quede sin resolver.

## Datos ya confirmados

- KeepSync **es Empresa de Menor Tamaño (EMT)** → puede ofertar en primer llamado.
- El usuario ya obtuvo un **ticket de la API de Compra Ágil** (`api2.mercadopublico.cl`) y lo
  probó en sesión — funciona. **El ticket es un secreto**: va en `.env` (gitignored) cuando se
  arranque el scaffolding, nunca en código ni en commits. Pedirlo de nuevo al usuario si no
  está disponible en el entorno actual.
- El correo Gmail de la cuenta del usuario recibe el código de doble factor de ClaveÚnica y es
  accesible vía MCP (`mcp__Gmail__*`) — necesario para el skill de login.

## Guardrails no negociables (ver `PLAN.md` para el detalle completo)

- El agente **nunca envía una oferta automáticamente** — completa formulario + adjunta PDF y
  se detiene ahí; el envío final lo confirma un humano.
- **Nunca cotizar por sobre el tope presupuestario** de la oportunidad (causal de
  inadmisibilidad).
- **No inventar precios** — requieren `config/company.json` con costos reales del usuario.
- Ante CAPTCHA o bloqueo del portal: detenerse y pedir intervención humana, no reintentar a
  ciegas.

## Lo que se sabe de la cuota de la API (medido, no supuesto)

`historico/cuota.jsonl` registraba **solo los días con 429** (`anexarRollup()` se llamaba únicamente
desde `registrar429()`), así que su única línea —429 a las 9 requests el 19-08-2026— parecía decir
que el límite diario era ridículamente bajo, y no había ninguna cota inferior con la cual
contrastarla: era `null` estructuralmente. El 20-08-2026 se midió de nuevo: **83 requests en un día,
0 códigos 429**. El 429 del 19-08 fue un episodio, no el límite. `cerrarDiasPendientes()`
(`src/lib/cuota.ts`) ahora cierra también los días sin 429, así que `npm run cuota` puede converger.

Aun así, la corrida ya no depende de que la cuota alcance: los errores de cuota no se confunden con
una variante rota, y **las categorías que no se alcanzaron a barrer se arrastran del índice** hacia
la página, marcadas *sin re-verificar hoy*. `docs/index.html` se publica siempre, salvo que ninguna
consulta haya llegado a la API. La regla anterior era todo-o-nada, y su efecto real era una página
congelada con oportunidades ya cerradas y sin ningún aviso.

## Estudio de mercado del universo completo (`output/estudio-mercado.md`)

`npm run mercado` (mide, gasta cuota) + `npm run estudio` (analiza, 0 requests) + `npm run criterios`
(propone) responden con datos la objeción que el propio repo se hace en `PLAN-VOLUMEN.md:271-272`:
*"elegir keywords a dedo es el método que produjo el nicho Claude (79% de fracaso)"*. En vez de
agregar palabras por intuición, se mide el universo entero y el ranking sale de ahí.

Lo medido el 2026-08-20, que hay que saber antes de tocar este código:

- **`/v2/compra-agil` funciona sin `q`**: el universo abierto son ~8.900 compras. `tamano_pagina=50`
  devuelve **HTTP 504** tres de cada cuatro veces; **25 es el punto dulce** (200 en ~17s). Y cada 504
  gasta cuota igual, porque `contarRequest()` corre antes de cada intento.
- **`total_resultados` de una `q` NO es el tamaño de la familia.** El `q` busca también en la
  descripción, donde vive el machaque administrativo: `q=desarrollo` devuelve ~360 resultados y
  ninguno de sus 10 nombres de muestra habla de desarrollo de nada; `q=datos` los encabeza con *"Caja
  de Alimentos… complete todos los datos"*; `q=soporte` trae soportes de TV y de bicicleta. Es una
  **cota superior contaminada**. `precisionEnNombre()` (`src/lib/mercado.ts`) mide la contaminación
  con los nombres que ya vinieron, sin gastar un request más, y **el ranking válido es el corregido**.
- **La API topea `total_resultados` en 10.000**: `cerrada`, `desierta` y `cancelada` devolvieron
  exactamente ese número las tres. Son cotas inferiores, no conteos — no calcular tasas contra ellos.
- **El endpoint responde 500 a términos válidos** (`q=aseo`, `q=documental` en distintas corridas),
  sin la palabra suelta "de" ni ningún otro patrón conocido. Se registran como **no medidos**, nunca
  como 0. Y las páginas profundas tardan minutos: el barrido de 25 páginas de muestra tomó ~2 horas.
- **234 requests en un día con 0 códigos 429** — la cota inferior conocida de la cuota diaria pasó de
  83 a 234. El 429 a las 9 requests del 19-08 queda confirmado como un episodio, no como el límite.

Los archivos: `config/terminos-mercado.json` (qué se dimensiona), `config/familias-mercado.json`
(familias derivadas de la medición; el cargador **falla** si una familia no declara `_derivada_de` y
`_evidencia`), `config/stopwords-es.json`, `config/keepsync-oferta.json` (el catálogo público de
keepsync.ai y el **juicio**, separado de lo medido) y `config/categorias-propuestas.json`, que es
**inerte**: ningún script del radar lo carga. Promover una propuesta es copiarla a mano a
`config/categorias.json` con `activa: false` — no se escribe ahí automáticamente porque
`cargarCategorias()` compila todas (una regex mala tira abajo el radar entero) y
`renderKeywordsCompraAgil` publica todas en `docs/index.html`, activas o no.

**Qué dijo la medición** (625 compras muestreadas del universo abierto, 40 términos dimensionados,
18 consultas de desenlace):

1. La familia más grande que KeepSync toca es **capacitación** (≈5% del universo, ~445 compras
   estimadas), y la que es el corazón de lo que vende —automatización de procesos y gestión
   documental— **no aparece ni una vez en la muestra**.
2. **La tasa de éxito es 7-10% en TODOS los rubros medidos**, incluidos los que nada tienen que ver
   con tecnología. Eso no sostiene la hipótesis de `PLAN.md`/`CLAUDE.md` de que el ~79% de fracaso
   del nicho Claude venga de un problema de *fulfillment*: el fracaso masivo es cómo se comporta el
   instrumento entero. Coincide con la clasificación de motivos de `PLAN-VOLUMEN.md` (73% atribuible
   al comprador). Y ninguna familia es *ofertable* hoy: no existe catálogo de costos
de servicios de KeepSync (confirmado con el usuario el 2026-08-20), así que no se puede fijar precio
bajo el tope. Mientras eso no se resuelva, esto es investigación de mercado, no un habilitador de
ofertas.

## Plan de crecimiento (`PLAN-VOLUMEN.md`)

Diseño para explotar al máximo la API **ya validada** y aumentar el volumen de venta: índice
histórico versionado, radar multi-categoría, clasificador de motivos de fracaso, calificador de
admisibilidad y digest priorizado. Contiene dos correcciones a lo que dice este archivo más
arriba: (1) solo el 16% de los fracasos se declara por incumplimiento de la oferta — el 73% es
atribuible al comprador, lo que matiza la hipótesis de fulfillment; y (2) hay un **bug vigente**:
como `data/state.json` está gitignored, el radar corriendo en la nube nunca detecta recompradores.
Leerlo antes de trabajar en cobertura, cuota o priorización.

## Tercer nicho: exploración de mercado para Array (`config/array-servicios.json`)

`array-compras-agiles-radar` (solo lectura) y `array-compras-agiles-cotizar` buscan Compras
Ágiles relacionadas con los servicios de [Array](http://www.array.cl/) — oficina de partes,
gestión documental, RPA, BI, gestión de proyectos —, publicando `docs/array-compras-agiles.html`.
El segundo skill además descarga los adjuntos de cada oportunidad y genera una cotización PDF
**preliminar** por cada una, con **KeepSync** (no Array) como oferente (mismo
`config/company.json` que licencias Claude) y precio = **80% del presupuesto disponible** — una
heurística de exploración de mercado pedida explícitamente por el usuario, no un cálculo desde
costos reales de Array (ese catálogo no existe hoy). Por eso cada PDF y la página quedan
marcados PRELIMINAR: antes de que cualquiera de estas cotizaciones sirva para una oferta real
hace falta resolver el mismo tipo de insumo bloqueante que el nicho Claude (¿vía real de
fulfillment/facturación para Array, y a qué costo?) — sin resolverlo, esto es solo investigación
de mercado, igual que el radar de solo lectura.

## Cuarto frente: qué le pide el Estado a un sistema documental (`docs/transformacion-digital.html`)

`npm run transformacion-digital` barre licitaciones de **Transformación Digital / Ley 21.180**
—sistema de gestión documental web, procesos documentales, firma electrónica, DocDigital, FirmaGob,
Exedoc—, **activas y pasadas**, y publica una página nueva más un **manifiesto JSON** con acceso
ordenado a los documentos de cada una. Es la Fase 1 de tres: la Fase 2 (bajar los archivos) la corre
Claude Cowork en la máquina del usuario, y la Fase 3 (comparar contra la documentación del sistema
actual) **no tiene baseline todavía** — esa documentación no existe en el repo y no se inventa.

Se solapa en las palabras con el nicho `ged` de `licitaciones/config/keywords.json` y aun así es
config y página **aparte**, a propósito: `ged` responde *"¿ofertamos en esta?"* y por eso barre solo
activas; esto responde *"¿qué le está pidiendo el Estado a un sistema como el nuestro?"*, y ahí las
que enseñan son las **pasadas** —ya tienen bases completas y foro respondido—. No toca
`docs/licitaciones.html` ni `docs/index.html` ni ninguno de sus marcadores.

Lo medido en la primera corrida completa (2026-08-25), que es lo que hay que saber antes de tocarlo:

- **Rotar `idOrden` bate a ventanear por fecha.** El buscador topa en 1.000 filas y con estas
  consultas ese tope se alcanza siempre. Tres criterios de orden distintos sobre la misma consulta
  comparten solo **162** de sus 1.000 filas y su unión da **2.545 códigos únicos**. Las ventanas de
  fecha también funcionan, pero filtran una fecha distinta según el estado, devuelven cero en
  `publicadas` (cuyo cierre es futuro) y ante un formato inválido el portal contesta *"sin
  coincidencias"* en vez de un error — una corrida entera vacía sin que nada lo delate. Por eso
  `buscador-portal.ts` expone `ORDENES_BUSCADOR` y **no** implementa ventanas.
- **50 combinaciones consulta × estado, 15 truncadas, 42 rotaciones: 66.390 filas, 24.302 códigos
  únicos, 72 del nicho.** 100 requests HTTP para descubrir y ~216 más para indexar las 72 fichas,
  con **cero cuota de la API con ticket**.
- **El embudo local es todo.** El buscador OR-ea tokens: `ley 21.180` sobre cerradas devuelve 1.000
  filas encabezadas por *"ADQUISICIÓN DE MATERIAL DEPORTIVO"* y *"Construcción Multicancha"*, porque
  matcheó «ley». La precisión la pone `patron_requerido` (exige que la compra sea del **servicio** y
  no solo que mencione la materia) más dos excluyentes, cada uno con su caso real citado.
- **Dos campos de exclusión, no uno.** `patron_excluyente` mira nombre + descripción;
  `patron_excluyente_nombre` mira solo el nombre. Hace falta porque `capacitación` a secas mataría
  casi todos los aciertos —toda licitación documental incluye capacitación a usuarios como
  entregable, y `decision.ts` la lista como *exigencia*, o sea como señal de acierto—, pero en el
  nombre *"Curso de Transformación Digital"* sí hay que descartarlo.
- **Ojo con los excluyentes en castellano.** `\bsobres?\b` (para descartar la compra de sobres)
  matchea la **preposición** «sobre» y estaba descartando `4371-26-LE26`, cuya descripción dice *"en
  conformidad con la Ley N° 21.180 **sobre** Transformación Digital del Estado"* — o sea, mataba
  justo el mejor tipo de acierto. Va en plural por eso.
- **Los requerimientos funcionales necesitan su propio detector.** Los 15 `PATRONES_EXIGENCIA` de
  `decision.ts` son administrativos (garantía de seriedad, declaración jurada, patente municipal);
  no responden *"qué tiene que hacer el software"*. `transformacion-digital.ts` trae 28 patrones en
  7 ejes, con la misma disciplina: patrón → **cita literal** → sección de origen. `decision.ts` no
  se tocó (es compartido con `ged`).
- **El índice y el manifiesto se reparten el peso.** Una línea de jsonl tiene que caber en 4.000
  bytes (atomicidad de `appendFileSync`) y un registro completo pesa 3.600–4.000: las URLs del visor
  llevan un `enc=` de ~400 caracteres. El jsonl guarda la **observación**;
  `docs/transformacion-digital-documentos.json` guarda el **contenido**, y `rehidratar()` los junta
  al republicar. No son dos fuentes de verdad: salen del mismo array en la misma corrida.
- **`observado_en` se resella al republicar.** `ultimaPorCodigo()` desempata con un `>` estricto, así
  que una línea enriquecida que conservara el timestamp original empataba con la vieja y perdía. El
  síntoma era silencioso: la ficha se bajaba, se escribía, y la corrida siguiente la leía como si
  nunca se hubiera indexado.

Banderas: `--fichas=N` (0 por defecto — la página se publica sin bajar ninguna ficha, porque el CSV
ya trae nombre y descripción completos), `--solo-indice` (no barre el portal; sí puede seguir
indexando fichas), `--refiltrar` (recalibra las regex sobre el barrido ya descargado, **0 requests**;
`licitaciones/data/_td-descartados.json` guarda cada fila descartada junto al patrón que la mató),
`--consultas=`, `--estados=`.

Dos bugs preexistentes del repo salieron acá y se arreglaron en libs compartidas, así que el radar de
Array también los hereda: `parsearCsv` descartaba **en silencio** todo código cuyo tipo lleva un
dígito (L1, B2, E2, I2, CI2…) porque el regex exigía exactamente dos dígitos finales —22 de cada
1.000 filas—; y `descargarFichaPublica` exigía `id="Ficha1"`, cuando las L1 renderizan una ficha
corta que puede empezar en `Ficha3`.

**Guardrails que este flujo no relaja:** los archivos adjuntos **no se bajan** — el visor está tras
un reCAPTCHA por score que este repo ya midió cinco veces, y lo que se publica es la URL marcada
`acceso: "navegador"`; abrirla es la Fase 2, con una persona. Nada se afirma sin su cita.

## Segundo nicho: Licitaciones públicas para los servicios de Array (`licitaciones/`)

Réplica de este mismo radar+cotizador para **Licitaciones públicas** (no Compra Ágil) que piden los
servicios del catálogo de [Array](http://www.array.cl/) — oficina de partes electrónica, seguimiento
de trámites, gestión documental y firma electrónica, RPA, business intelligence y plataformas de
gestión de proyectos —, skills `radar_licitaciones` y `cotizar_licitaciones`. Es el mismo nicho que
`array-compras-agiles-radar` cubre en Compra Ágil, en otro instrumento de compra, con su propia API
y su propio catálogo de costos (sin precio de lista público como el de Claude).
**Leer `licitaciones/PLAN.md` antes de tocar ese código** — no asumir que los guardrails y hallazgos
de arriba aplican tal cual a ese dominio. Lo que hay que saber para operarlo:

- **El radar no gasta cuota de API.** Corre entero sobre fuentes públicas del portal: descubre por el
  buscador público (`npm run radar-licitaciones`), que **sí filtra por texto** —la API no puede— y
  entrega nombre y descripción completos; y arma cada ficha desde la ficha pública de la licitación.
  El `LICITACIONES_API_TICKET` quedó como opción (`--con-api`), no como requisito: su cuota es tan
  escasa que se agotaba antes de la primera ficha, y lo único exclusivo que aporta
  (`CantidadReclamos`) el portal ya lo entrega mejor desglosado (reclamos **por pago no oportuno**
  sobre compras de 12 meses). Ver "El descubrimiento también es gratis" en `licitaciones/PLAN.md`.
- Los patrones del nicho viven en `licitaciones/config/keywords.json` (mismo contrato que
  `config/array-servicios.json`) y la config manda de verdad: editar ese archivo cambia qué busca el
  radar. Ojo con los excluyentes — más texto encuentra más licitaciones y también más falsos
  positivos (residuos "con gestión documental", servidores "para administrar un gestor documental").
- Para ampliar el nicho **sin escribir regex** está `licitaciones/config/keywords-extra.json`:
  frases literales que el radar usa como consulta al buscador y como confirmación local. Se agregan
  con `npm run keywords-licitaciones -- agregar <categoria> "<frase>"` o desde el formulario de
  `docs/licitaciones.html`, que además publica las palabras vigentes. La página es estática: lo que
  se agrega ahí queda pendiente hasta pegarlo en ese archivo — el radar solo lee el repo.
- El radar publica `docs/licitaciones.html`, que **solo contiene lo que sirve para evaluar una
  licitación** (tope o tramo de monto, plazos, garantías, criterios con su ponderación, anexos,
  banderas con su cita, cómo paga el organismo, documentos). Las secciones de estado del proyecto se
  eliminaron a propósito: eso se lee en el repo.
- Esa API **no expone adjuntos ni garantías** de la licitación — no existe acá el servicio de
  adjuntos sin login que sí tiene Compra Ágil. Pero eso **ya no obliga a que una persona lea las
  bases**: la ficha pública del portal (`DetailsAcquisition.aspx?idlicitacion=<codigo>`) sirve su
  texto completo sin login ni CAPTCHA, y `npm run antecedentes-licitacion -- <codigo>` lo baja y
  parsea (garantías, anexos exigidos, criterios de evaluación, foro de preguntas) sin gastar cuota
  del ticket, y además baja **un archivo real**: el Excel oficial de preguntas y respuestas
  (`Export/PreguntasExcel.aspx`), el único documento de los antecedentes que el portal entrega sin
  verificación humana.
- **La decisión se lee de `decision.json`, no de las bases crudas.** Cada corrida de
  `antecedentes-licitacion` genera la ficha de decisión (banderas ⛔/⚠️/✅ con motivo y cita, plazos y
  días restantes, ventana de preguntas, tope, garantías, criterios con el peso del precio, anexos
  exigidos, cláusulas excluyentes y exigencias detectadas). Consultarla antes de cotizar; todo lo que
  afirme debe salir de ahí, con su cita — nada se infiere.
- **Los adjuntos, cuando existan, se leen.** `npm run leer-adjuntos` extrae el texto de lo que haya
  en `licitaciones/data/<codigo>/adjuntos/` (PDF/DOCX) y lo incorpora a la ficha citando el archivo.
  Mientras no haya, la ficha levanta la bandera "Falta el detalle fino": no dar por completa una
  decisión tomada solo con la ficha pública.
- **Acceso a los documentos = su URL, no una copia local.** Cada corrida de
  `antecedentes-licitacion` deja el índice de documentos de la licitación (`documentos.json`, el
  bloque "Documentos" de `antecedentes.md` y los enlaces en cada tarjeta de `docs/licitaciones.html`)
  con un campo `acceso`: `directo` (un `fetch` lo trae: ficha, foro, Excel de preguntas) o
  `navegador` (la URL del visor de adjuntos, que abre una persona). Bajar los bytes de los adjuntos
  **no es un pendiente del flujo**: lo que decide si conviene ofertar ya viene en texto, y los
  formatos de anexo en blanco se necesitan al presentar la oferta, donde ya hay una persona. Ver "El
  objetivo estaba mal planteado" en `licitaciones/PLAN.md`.
- Los ARCHIVOS adjuntos están tras reCAPTCHA por score + un CAPTCHA de imagen:
  `npm run adjuntos-licitacion -- <codigo> [--con-login]` intenta la única vía honesta (navegador
  real que el sitio puntúa con su propio reCAPTCHA, sin falsificar nada) y se detiene si lo
  rechazan. Es opcional, para correr desde la máquina del usuario. Nunca rodear ese control.
- **El login al portal ya funciona sin intervención humana, y aun así no abre los adjuntos**
  (verificado end-to-end el 2026-08-19). `npm run login-portal` autentica con **ClaveÚnica** —el
  portal no tiene credencial propia para un RUN chileno; el formulario usuario/contraseña de
  Keycloak es la pestaña "Extranjero"— usando `MP_USUARIO`/`MP_CLAVE` del entorno, y el código de
  6 caracteres lo lee el agente del Gmail del usuario con el workflow de n8n "Lector codigo 2FA
  Mercado Publico" (handshake por archivo: el script pide, el agente escribe `2fa-codigo.txt`).
  Pero el gate del visor de adjuntos **puntúa el navegador y la IP, no la identidad**: medido con
  sesión ClaveÚnica autenticada en el mismo contexto (`npm run adjuntos-licitacion -- <codigo>
  --con-login`) da score 0 contra umbral 0.5, igual que anónimo. Correrlo desde la máquina del
  usuario es lo único que queda por probar. Ver "Acceso a los antecedentes" en
  `licitaciones/PLAN.md`. El cotizador sigue bloqueado por falta de catálogo de costos reales.
