# ks-compra-agil

Agente que monitorea Compras Ágiles en mercadopublico.cl que piden licencias Claude/Anthropic,
prepara una cotización dentro del tope presupuestario, y deja lista una oferta (formulario +
PDF) para revisión y envío manual de un humano.

**Antes de escribir código, lee `PLAN.md` completo.** Contiene el diseño validado contra la API
real de producción (no supuestos): estructura de datos verificada, endpoints reales, un
servicio no documentado para descargar adjuntos sin login, y una medición del nicho (47 casos
históricos, 79% de fracaso, patrón de recompradores — cifras vivas en
`output/informe-nicho-claude.md`, regenerables con `npm run informe`) que condiciona varias
decisiones de diseño.

## Estado del proyecto

Implementado y probado contra la API real: scaffolding, el skill `compra-agil-radar-claude`
(radar + informe del nicho) y el skill `compra-agil-ofertar` (cotizador con PDF publicable),
más la página de estado en GitHub Pages (`docs/`). El login a ClaveÚnica y el llenado del
formulario del portal (`login.ts` / `form-fill.ts`) tienen toda la lógica escrita pero están
diferidos a una sesión con **Claude Cowork en una máquina local** — ver `docs/flujo.html` para
el flujo completo (con foco en dónde entra la persona) y la sección "Estado y pendientes" de
`README.md` para el detalle componente por componente.

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

## Segundo nicho: Licitaciones de Gestión Documental (`licitaciones/`)

Réplica de este mismo radar+cotizador para **Licitaciones públicas** (no Compra Ágil) de gestión
documental, digitalización de procesos u oficina de partes — skills `radar_licitaciones` y
`cotizar_licitaciones`. Es un dominio distinto con su propia API (`api.mercadopublico.cl`, ticket
separado) y su propio catálogo de costos (sin precio de lista público como el de Claude).
**Leer `licitaciones/PLAN.md` antes de tocar ese código** — no asumir que los guardrails y
hallazgos de arriba aplican tal cual a ese dominio. Dos diferencias que muerden:

- El radar **está verificado contra producción desde el 2026-08-19** y publica oportunidades reales
  en `docs/licitaciones.html`, pero **la cuota del ticket es muy escasa** (se agotó en la segunda
  corrida del mismo día): correr contra la API una vez al día y usar
  `npm run radar-licitaciones -- --desde-cache` para republicar sin gastar cuota.
- Por esa cuota, **toda la API se gasta en licitaciones activas**: se eliminaron el barrido
  histórico del nicho y su página, y `api.ts` solo expone `buscarLicitacionesActivas()` + la ficha
  por código. Consecuencia: a diferencia del nicho Claude, acá **no hay cifras históricas** del
  nicho — no asumir que existen ni pedirlas al radar. Ver "Decisión: solo licitaciones activas" en
  `licitaciones/PLAN.md` antes de reponer cualquier barrido.
- Esa API **no expone adjuntos ni garantías** de la licitación — no existe acá el servicio de
  adjuntos sin login que sí tiene Compra Ágil. Pero eso **ya no obliga a que una persona lea las
  bases**: la ficha pública del portal (`DetailsAcquisition.aspx?idlicitacion=<codigo>`) sirve su
  texto completo sin login ni CAPTCHA, y `npm run antecedentes-licitacion -- <codigo>` lo baja y
  parsea (garantías, anexos exigidos, criterios de evaluación, foro de preguntas) sin gastar cuota
  del ticket, y además baja **un archivo real**: el Excel oficial de preguntas y respuestas
  (`Export/PreguntasExcel.aspx`), el único documento de los antecedentes que el portal entrega sin
  verificación humana. Los ARCHIVOS adjuntos están tras reCAPTCHA por score + un CAPTCHA de imagen:
  `npm run adjuntos-licitacion -- <codigo>` intenta la única vía honesta (navegador real que el
  sitio puntúa con su propio reCAPTCHA, sin falsificar nada) y se detiene si lo rechazan — en la
  nube da 0.1 contra un umbral de 0.5; desde la máquina del usuario puede pasar, `--diagnostico` lo
  responde sin bajar nada. Nunca rodear ese control. Ver "Acceso a los
  antecedentes" en `licitaciones/PLAN.md`. El cotizador sigue bloqueado por falta de catálogo de
  costos reales.
