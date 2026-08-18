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

## Segundo nicho: Licitaciones de Gestión Documental (`licitaciones/`)

Réplica de este mismo radar+cotizador para **Licitaciones públicas** (no Compra Ágil) de gestión
documental, digitalización de procesos u oficina de partes — skills `radar_licitaciones` y
`cotizar_licitaciones`. Es un dominio distinto con su propia API (`api.mercadopublico.cl`, ticket
separado), su propio catálogo de costos (sin precio de lista público como el de Claude) y sus
propios insumos bloqueantes sin resolver. **Leer `licitaciones/PLAN.md` antes de tocar ese
código** — no asumir que los guardrails y hallazgos de arriba aplican tal cual a ese dominio.
