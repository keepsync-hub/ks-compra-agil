# Agente de Compra Ágil — Plan v6: foco exclusivo en compras que piden "Claude"

> Este documento es la referencia de diseño para este repo. Si estás retomando este proyecto
> desde otra sesión, léelo completo antes de escribir código — está basado en mediciones reales
> contra la API de producción de MercadoPúblico, no en supuestos. Ver también `CLAUDE.md` para
> el resumen operativo y el estado de los insumos pendientes.

## Contexto

Alcance acotado por decisión del usuario: **solo Compras Ágiles que mencionen literalmente
Claude/Anthropic**, dejando para después los proyectos de IA en general. KeepSync **sí es
Empresa de Menor Tamaño (EMT)**, por lo tanto puede ofertar en primer llamado — que es donde
está prácticamente todo este nicho.

## Medición real del nicho (con el ticket, sobre datos de producción)

**El nicho existe y está creciendo.** 55 Compras Ágiles mencionan "Claude" desde marzo 2026:

| Mes | 2026-03 | 2026-04 | 2026-05 | 2026-06 | 2026-07 | 2026-08 |
|---|---|---|---|---|---|---|
| Publicadas | 2 | 5 | 10 | 8 | 15 | 10 (en 11 días) |

Ritmo actual ≈ **una cada 2 días**. Monto mediano **$2.500.000 CLP**; rango $220.000 –
$7.164.900; los 50 casos analizados suman **$144,9 millones CLP**.

### El dato central: el 80% de estos procesos fracasa

| Desenlace | Casos | % |
|---|---|---|
| **desierta** (sin ofertas válidas) | 26 | **52%** |
| **cancelada** | 14 | **28%** |
| cerrada | 7 | 14% |
| publicada (vigentes) | 3 | 6% |

Y no es por falta de interés: esos procesos recibían **entre 2 y 11 cotizaciones cada uno** y
aun así se declararon desiertos. Es decir, **hay demanda y hay oferentes, pero las ofertas no
sirven**.

### Los compradores reintentan una y otra vez

- **Universidad de Chile — 9 procesos** (abr–ago), varios cancelados/desiertos.
- **AGCID — 4 procesos en 10 días** ($7,08M → $3,54M → $3,54M → $4,34M), todos fallidos.
- **Subsecretaría de Economía y Empresas de Menor Tamaño — 3 veces el mismo monto
  ($7.150.600) en 8 días**, las tres desiertas.
- **Subsecretaría de las Culturas — 3 intentos** ($3,3M): canceló, desierta, y **al tercero
  cerró con éxito**.
- **Municipalidad de Coronel**: 2759-437 desierta el 31-07 → **republicó 2759-474 el 10-08, hoy
  abierta, mismo monto**.

Los compradores insisten porque necesitan las licencias. **La escasez está del lado de la
oferta, no de la demanda.**

### Hay 3 oportunidades abiertas ahora mismo, las tres en primer llamado (EMT)

(datos capturados el 2026-08-11; para una corrida real, volver a consultar la API — estas
ventanas cierran en horas/días)

| Código | Comprador | Qué pide | Monto | Cierre | Ofertas |
|---|---|---|---|---|---|
| `1614-47-COT26` | Superintendencia de Electricidad y Combustibles | Claude Pro 12m, 4 usuarios | $1.300.000 | 11-08 15:00 | 5 |
| `5769-102-COT26` | Universidad de Chile | Claude Max 5x anual, 1 usuario | $1.093.896 | 12-08 10:00 | 1 |
| `2759-474-COT26` | Municipalidad de Coronel | 8 licencias "tipo Claude Pro" 12m | $2.200.000 | 12-08 15:00 | 3 |

## La pregunta que decide si vale la pena construir esto

Con 80% de fracaso pese a haber oferentes, la causa más probable es de **fulfillment**: revender
suscripciones de Anthropic requiere poder facturarlas y entregarlas legítimamente, y las ofertas
que llegan no logran acreditarlo (o superan el tope presupuestario, que las vuelve
inadmisibles). **Si KeepSync tiene una vía real para proveer licencias Claude, este nicho está
lleno de procesos huérfanos y compradores que reintentan.** Si no la tiene, el agente producirá
cotizaciones que perderán igual que las demás. Es el insumo #1 antes de codear — ver estado en
`CLAUDE.md`.

## Cómo cambia el diseño respecto al plan anterior (v5, exploración amplia de IA)

Lo medido invalida varias decisiones del plan anterior, que estaba pensado para proyectos de
solución en vez de reventa de licencias:

1. **El barrido completo de ~6.200 compras abiertas ya no se justifica.** El universo objetivo
   se cubre con ~8 consultas `q` por corrida. El radar pasa de ~125 requests a menos de 10 — se
   puede correr varias veces al día.
2. **`q` deja de ser un problema y pasa a ser una ventaja.** Su matching laxo capturó
   `LICENCIAS CLOUDE` (escrito con falta de ortografía) y `TIPO CLAUDE VERSION PRO`. Para un
   término de marca, la difusión ayuda. Se consultarán variantes: `Claude`, `Anthropic`,
   `Cloude`, `Clude`, `Claude Pro`, `Claude Max`, `Claude Code`, `Claude Team`.
3. **La cotización NO es una propuesta técnica.** Son compras de licencias: cantidad de
   usuarios × plan × 12 meses. El entregable es un **precio dentro del tope**, no un documento
   de 20 páginas con arquitectura. La "matriz de cumplimiento" se reduce a responder las
   condiciones declaradas (plan y versión exacta, nº de usuarios, plazo de entrega, vigencia,
   documentos exigidos).
4. **Los adjuntos suelen no existir.** 2 de las 3 abiertas tienen `documentos: []` y el
   requerimiento completo está en `descripcion`. La descarga pasa a ser **condicional**, no un
   paso obligatorio del pipeline.
5. **Los excluyentes viven en el texto de `descripcion`**, no en un PDF. Ejemplos reales:
   *"DEBE SUBIR PATENTE MUNICIPAL AL DIA, DE LO CONTRARIO SU OFERTA QUEDARA INADMISIBLE"* y
   *"no serán consideradas ofertas sobre el presupuesto disponible de $1.300.000"*.
6. **Feature nueva y de alto valor: seguimiento de recompradores.** Los organismos que
   reintentan son los objetivos de mayor probabilidad y avisan con antelación. El radar debe
   mantener un historial por organismo y alertar cuando uno de la lista republica.
7. **Feature nueva: aprender de los fracasos.** Capturar `motivos.motivo_desierta` y
   `motivos.motivo_cancelacion` de los 40 procesos fallidos para entender **por qué** se cayeron
   y no repetir el error. Esto convierte el pedido original de "reportar qué nos impide
   participar" en evidencia real, no en especulación.

## Hallazgos técnicos verificados contra la API real (útiles para cualquier implementación)

- **Base URL real**: `https://api2.mercadopublico.cl` (no `api.mercadopublico.cl`, que es la
  API vieja de licitaciones/OC). Autenticación: header `ticket`.
- Dos endpoints: `GET /v2/compra-agil` (listado/búsqueda) y `GET /v2/compra-agil/{codigo}`
  (detalle).
- Cuota diaria por ticket, por día calendario; 429 con `Retry-After` al agotarse.
- `tamano_pagina` tiene **mínimo 10** (no documentado), máximo 50.
- `documentos[].id` en la API v2 es **entero**, no UUID, y **no sirve para descargar** — la API
  v2 no expone URL de descarga de adjuntos.
- **Los adjuntos SÍ se pueden descargar sin login**, pero por un servicio distinto (el backend
  del buscador público, no documentado como API oficial):
  ```
  BASE=https://adjunto.mercadopublico.cl/adjunto-compra-agil
  GET $BASE/v1/adjuntos-compra-agil/listar/{codigo}     -> [{id: UUID, nombreArchivo}]
  GET $BASE/v1/adjuntos-compra-agil/descargar/{UUID}    -> el archivo
  ```
  Requiere header `user_key: 41186b85826e80d1a0d445a6ce67d1a3` (clave pública embebida en el
  bundle JS del buscador, la misma que usa cualquier visitante del sitio) + un `User-Agent` de
  navegador. Probado end-to-end: descarga real de un PDF de 591 KB / 6 páginas. Como no es API
  documentada, puede cambiar sin aviso — aislar en un módulo propio (`adjuntos.ts`) con
  fallback a navegador si deja de funcionar.
- `convocatoria.estado_convocatoria`: **1 = primer llamado (solo EMT), 2 = segundo llamado
  (todos)** — filtro determinista de elegibilidad, sin gastar razonamiento de LLM.
- `resumen.total_ofertas_recibidas` en el **listado** reporta 0 para procesos abiertos; el
  **detalle** (`/v2/compra-agil/{codigo}`) sí da el número real. Usar siempre el detalle para
  medir competencia.
- La guía oficial (v3.0, mayo 2026) documenta varios campos como "no confirmados en la
  respuesta real" — programar el parseo de forma defensiva, no confiar ciegamente en la tabla
  de campos del PDF de documentación.

## Arquitectura

### Skill `compra-agil-radar-claude` — sin credenciales del portal

`SKILL.md` + `scripts/radar.ts`:
- ~8 consultas `q` (variantes de marca) contra `/v2/compra-agil`, `estado=publicada`,
  deduplicando por `codigo`.
- **Verificación local** de que la mención de marca es real (regex sobre `nombre`,
  `descripcion` y `productos_solicitados[].descripcion`), para descartar el ruido propio de `q`.
- Descarga condicional de adjuntos (solo si `documentos[]` no viene vacío) vía el servicio
  público `adjunto.mercadopublico.cl` — sin login, ya probado end-to-end (ver hallazgos arriba).
- Extracción de condiciones y excluyentes desde el texto: tope presupuestario, documentos
  exigidos (patente municipal, etc.), plan/versión pedida, nº de usuarios, plazo de entrega.
- Usa el endpoint de **detalle** para `total_ofertas_recibidas` real (ver hallazgos arriba).
- Estado en `data/state.json`: watermark, códigos ya vistos, e **historial por organismo** para
  detectar reintentos.
- Reporta: oportunidades abiertas con cierre, tope, competencia y condiciones; más alertas de
  recompradores.
- Sin credenciales → **seguro de programar en un Routine varias veces al día** (las ventanas son
  de 3 a 5 días).

### Skill `compra-agil-ofertar` — con navegador, humano en el loop

`SKILL.md` + `scripts/{login.ts, form-fill.ts}`:
1. Precheck: convocatoria vigente admite EMT (siempre sí, KeepSync es EMT), cierre no vencido,
   y **el precio cabe bajo el tope** (si no cabe, no se oferta: sería inadmisible).
2. **Cotización de licencias**: una línea por `productos_solicitados[]` con cantidad, plan
   exacto solicitado, precio unitario y total, **verificando el tope**. Precios desde
   `config/company.json` (costo de licencia + margen); el agente **no inventa precios**. Se
   adjunta la lista de condiciones cumplidas y los documentos exigidos. PDF vía el skill `pdf`
   ya existente en el entorno de Claude Code (no escribir un renderer propio).
3. **Login ClaveÚnica + 2FA**: `login.ts` llega a la pantalla del código, el agente lo lee en
   Gmail (`mcp__Gmail__*`) y lo devuelve al script. `storageState.json` reutiliza sesión entre
   corridas. Ante CAPTCHA: **detenerse y pedir intervención humana**, nunca reintentar a ciegas.
4. **Formulario**: completa la oferta y adjunta el PDF, **sin hacer click en enviar**; guarda
   `output/<codigo>/formulario-listo.png`. El envío final lo hace un humano — es un acto público
   y vinculante ante el organismo comprador.

## Estructura de archivos propuesta

```
ks-compra-agil/
  package.json, tsconfig.json, .gitignore, .env.example, README.md, CLAUDE.md, PLAN.md
  .claude/skills/
    compra-agil-radar-claude/SKILL.md + scripts/radar.ts
    compra-agil-ofertar/SKILL.md      + scripts/{login.ts, form-fill.ts}
  src/lib/
    api.ts        - cliente API v2 (ticket, paginacion, 429, parseo defensivo)
    adjuntos.ts   - listar/descargar adjuntos (servicio publico, sin login)
    marca.ts      - variantes de busqueda + verificacion local de mencion real
    condiciones.ts- extraccion de tope, excluyentes, plan, usuarios, plazo
    historial.ts  - seguimiento de organismos que reintentan
    config.ts, browser.ts
  config/
    marcas.json           - variantes: Claude, Anthropic, Cloude, Claude Pro/Max/Code/Team
    company.json.example  - RUT, razon social, es_emt=true, costos de licencia y margen
  data/  state.json, <codigo>/{detalle.json, condiciones.json, attachments/}
  output/ <codigo>/{cotizacion.pdf, formulario-listo.png}, informe-nicho-claude.md
```

## Guardrails

1. **Sin envío automático**: el clic final lo hace un humano.
2. **Secretos fuera del repo**: ticket de API y credenciales ClaveÚnica en `.env` gitignored;
   nunca hardcodeados ni commiteados (la propia guía de ChileCompra lo advierte explícitamente).
3. **Nunca ofertar por sobre el tope**: es causal de inadmisibilidad declarada.
4. **No inventar precios**: sin `config/company.json` con costos reales, no hay cotización.
5. **CAPTCHA/bloqueo → detener y avisar**, nunca reintentar a ciegas.
6. Las llamadas al servicio de adjuntos son **las mismas que hace el sitio público**, con su
   clave pública; sin elusión de autenticación ni de controles de acceso.

## Orden de trabajo

1. **Insumo bloqueante**: confirmar si KeepSync puede efectivamente proveer/facturar licencias
   Claude, y con qué costo. Sin eso, todo lo demás es teórico. Ver estado en `CLAUDE.md`.
2. Scaffolding + `src/lib/{api,adjuntos,marca,condiciones}.ts`.
3. Skill `compra-agil-radar-claude`, y correrlo contra las oportunidades abiertas del momento.
4. **Informe del nicho** (`output/informe-nicho-claude.md`): los casos históricos con sus
   motivos de fracaso y la lista de recompradores — entrega valor aunque no se oferte nunca.
5. `config/company.json` con costos reales (insumo del usuario).
6. Skill `compra-agil-ofertar`: cotización de licencias + validación de tope.
7. `login.ts` con handshake Playwright↔Gmail; `form-fill.ts` sin enviar.
8. Routine del radar 2–3 veces al día.

## Riesgos abiertos

- **Fulfillment**: el 80% de fracaso histórico sugiere que el cuello de botella es poder
  entregar las licencias, no encontrar las oportunidades. Riesgo de construir un radar
  excelente para un negocio que no se puede cerrar — ver la pregunta bloqueante arriba.
- **Competencia real**: 5, 3 y 1 ofertas en las abiertas medidas; hasta 11 en las históricas.
- El servicio de adjuntos y su `user_key` no son API documentada: aislado en `adjuntos.ts`,
  con fallback a navegador si cambia.
- La API v2 es Beta con inexactitudes verificadas respecto a su propia documentación → parseo
  defensivo, no confiar en la tabla de campos del PDF.
- `q` no busca dentro de los adjuntos: una compra que solo mencione Claude en un PDF adjunto
  se escaparía del radar. Mitigación futura: barrido más amplio + revisión de adjuntos de
  candidatas de IA en general (alcance descartado por ahora, ver Contexto).

## Verificación

1. `tsc --noEmit` limpio.
2. El radar encuentra las oportunidades "Claude" abiertas del momento y extrae correctamente
   tope, plan, nº de usuarios y excluyentes (p. ej. exigencia de patente municipal al día).
3. El radar no repite hallazgos ya vistos en una segunda corrida y alerta reintentos de
   organismos que ya aparecieron antes (recompradores).
4. El informe del nicho reproduce cifras consistentes con una medición fresca contra la API
   (tasa de desierta/cancelada, monto mediano, ritmo de publicación).
5. Cotización de prueba: respeta el tope, cotiza cada línea solicitada, lista las condiciones
   cumplidas y los documentos exigidos.
6. `formulario-listo.png` muestra el formulario completo **sin enviar**; revisión humana
   obligatoria antes de cualquier envío real.
