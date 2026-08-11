# ks-compra-agil

Agente que monitorea Compras Ágiles en mercadopublico.cl que piden licencias Claude/Anthropic,
prepara una cotización dentro del tope presupuestario, y deja lista una oferta (formulario +
PDF) para revisión y envío manual de un humano.

**Antes de escribir código, lee `PLAN.md` completo.** Contiene el diseño validado contra la API
real de producción (no supuestos): estructura de datos verificada, endpoints reales, un
servicio no documentado para descargar adjuntos sin login, y una medición del nicho (55 casos
históricos, 80% de fracaso, patrón de recompradores) que condiciona varias decisiones de
diseño.

## Estado del proyecto

Repo recién iniciado — sin código aún. Lo único que existe es este documento y `PLAN.md`.

## Insumo bloqueante (sin esto, no tiene sentido implementar el flujo de oferta)

**¿KeepSync tiene una vía real para proveer y facturar licencias Claude/Anthropic, y a qué
costo?** El 80% de las Compras Ágiles que piden Claude históricamente terminan desiertas o
canceladas *pese a recibir varias cotizaciones* — la hipótesis de trabajo es que el cuello de
botella es de fulfillment (poder entregar/facturar legítimamente), no de encontrar
oportunidades. Confirmar esto con el usuario antes de construir el skill de ofertar. El radar
y el informe del nicho (`output/informe-nicho-claude.md`) sí tienen valor aunque esta pregunta
quede sin resolver.

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
