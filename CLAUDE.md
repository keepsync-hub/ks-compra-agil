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

Dos cosas que condicionan todo el nicho y no las resuelve el cotizador: **ninguna oferta nombra
relator/a** (los seis TDR exigen título, CV y certificados verificables, y sin eso la oferta se
descarta en admisibilidad), y **sigue sin confirmarse si KeepSync es OTEC registrada en SENCE** —
de eso dependen tanto puntaje directo en algunas bases como la exención de IVA del art. 13 N°4 con
que Dipres presupuesta. Ver el detalle en `.claude/skills/compra-agil-ofertar/SKILL.md`.

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
