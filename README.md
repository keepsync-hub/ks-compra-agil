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
| `npm run radar` | Busca Compras Ágiles "Claude" abiertas, extrae condiciones, detecta recompradores. Solo lectura. |
| `npm run informe` | Regenera `output/informe-nicho-claude.md` con el barrido histórico completo (tasa de fracaso, motivos, recompradores). |
| `npm run cotizar -- <codigo>` | Genera la cotización (`.pptx` fuente + `.pdf` publicable) para una compra específica, validando el tope. No envía nada. |
| `npx tsx .claude/skills/compra-agil-ofertar/scripts/login.ts --diagnostico` | Verifica si el portal es alcanzable desde el navegador antes de intentar login real. |
| `npm run form-fill -- <codigo>` | Completa el formulario de oferta en el portal y adjunta el PDF, sin enviar. Requiere login previo. |
| `npm run diagnostico-api` | Diagnóstico único de la API (¿`q` es opcional?, forma del payload, filtros de fecha, ticket clásico) — ver `PLAN-VOLUMEN.md`, Fase 0. Escribe `output/diagnostico-api.md`. |
| `npm run cuota` | Muestra el consumo de cuota de hoy y la convergencia pasiva del límite diario medido (`historico/cuota.jsonl`). Cero requests. |
| `npm run array-radar` | Busca Compras Ágiles publicadas relacionadas con los servicios de [Array](http://www.array.cl/) (oficina de partes, gestión documental/firma electrónica, RPA, BI, gestión de proyectos) y regenera `docs/array-compras-agiles.html`. Exploración de mercado independiente del nicho Claude — solo lectura. |
| `npm run array-cotizar` | Igual búsqueda que `array-radar`, más descarga de adjuntos y una cotización PDF preliminar por oportunidad (oferente KeepSync, precio = 80% del presupuesto disponible — no un costo real de Array, ver `.claude/skills/array-compras-agiles-cotizar/SKILL.md`). Regenera `docs/array-compras-agiles.html` con precio y PDF enlazado por tarjeta, y deja `docs/array-cotizaciones/index.json` para que `array-radar` no borre las cotizaciones al refrescar. |
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

## Segundo nicho: Licitaciones de Gestión Documental / Digitalización de Procesos / Oficina de Partes

Réplica del radar y el cotizador, pero para **Licitaciones públicas** (no Compra Ágil) que piden
gestión documental, digitalización de procesos u oficina de partes. Vive en `licitaciones/`
(librería, config y datos propios) + los skills `radar_licitaciones` y `cotizar_licitaciones` en
`.claude/skills/`. Diseño completo, diferencias respecto a Compra Ágil e insumos bloqueantes:
ver `licitaciones/PLAN.md`.

**Radar verificado contra producción el 2026-08-19**: corrió con un `LICITACIONES_API_TICKET`
válido (distinto del de Compra Ágil, se pide en https://www.mercadopublico.cl/Home/Api) y detectó
oportunidades reales — publicadas en `docs/licitaciones.html`. Esa corrida corrigió varias
suposiciones del código y destapó dos bugs (alertas de recompradores falsas, publicación de una
grilla parcial); el detalle está en "Hallazgos de la corrida de verificación" de
`licitaciones/PLAN.md`. Tres cosas quedan pendientes:

- **La cuota del ticket es muy escasa** — se agotó en la segunda corrida del mismo día. Correr el
  radar contra la API una vez al día; `npm run radar-licitaciones -- --desde-cache` republica lo ya
  detectado sin gastar cuota. Por esto **toda la cuota se gasta en licitaciones activas**: se
  eliminaron el barrido histórico del nicho (`informe-licitaciones`) y su página, y la API solo se
  consulta por `estado=activas` y por ficha. A cambio, de este nicho no hay cifras históricas —
  cuántas se declaran desiertas, quién se las adjudica — como sí las hay del nicho Claude.
  Justificación completa en "Decisión: solo licitaciones activas" de `licitaciones/PLAN.md`.
- **La API no expone adjuntos ni garantías**, pero la ficha PÚBLICA del portal sí trae el texto
  completo de las bases — y eso ya se lee automáticamente con `npm run antecedentes-licitacion --
  <codigo>` (sin ticket, sin cuota y sin login; verificado el 2026-08-19). Ahí están las garantías
  exigidas, los anexos que hay que presentar y los criterios de evaluación. Lo único que sigue
  necesitando a una persona son los ARCHIVOS adjuntos (PDF/DOCX): el portal los protege con un
  CAPTCHA de imagen. `npm run adjuntos-licitacion -- <codigo>` intenta la única vía honesta (un
  navegador real al que el sitio puntúa con su propio reCAPTCHA) y se detiene si lo rechazan: en la
  nube da score 0.1 contra un umbral de 0.5, desde una máquina con IP residencial puede pasar. Ver
  "Acceso a los antecedentes" en `licitaciones/PLAN.md`.
- **No hay catálogo de costos reales** de KeepSync para gestión documental — a diferencia de
  licencias Claude, acá no existe un precio de lista público que copiar. `cotizar_licitaciones`
  sigue bloqueado por esto.

| Comando | Qué hace |
|---|---|
| `npm run radar-licitaciones` | Busca licitaciones activas de gestión documental/digitalización/oficina de partes, extrae condiciones, detecta recompradores. Solo lectura. |
| `npm run antecedentes-licitacion -- <codigo>` | Baja de la ficha **pública** del portal el contenido completo de las bases (garantías, anexos exigidos, criterios de evaluación) + el foro de preguntas, a `licitaciones/data/<codigo>/antecedentes.md`. Sin ticket, sin cuota y sin login. Sin argumentos, procesa todas las licitaciones ya detectadas en caché. |
| `npm run adjuntos-licitacion -- <codigo> [--visible] [--diagnostico]` | Intenta bajar los ARCHIVOS adjuntos abriendo el visor del portal con un navegador real. El portal puntúa la sesión con reCAPTCHA (umbral 0.5): en la nube dio 0.1 y rechaza; desde tu máquina puede pasar — `--diagnostico` lo responde sin bajar nada. No rodea el control: si lo rechazan, se detiene. |
| `npm run cotizar-licitaciones -- <codigo>` | Genera la cotización (`.pptx` + `.pdf`) para una licitación específica, validando el tope. No envía nada. |

Página de estado equivalente: `docs/licitaciones.html`, encabezada por las licitaciones abiertas
detectadas en la última corrida.

## Estado y pendientes

- **Radar e informe del nicho: funcionando de punta a punta contra la API real** — encuentra las
  oportunidades abiertas reales y reproduce la tasa de fracaso medida en `PLAN.md` (~79-80%).
- **Cotización (`cotizar.ts`): funcionando de punta a punta**, con la identidad real de KeepSync
  ya cargada. Genera `.pptx` (fuente editable) y `.pdf` (artefacto final a publicar/enviar,
  `archivo_publicable` en `cotizacion-resumen.json`). El PDF se renderiza con Chromium/Playwright
  a partir de HTML (`src/lib/cotizacion-html.ts`), no convirtiendo el `.pptx` con LibreOffice:
  `soffice` no funciona en el entorno donde se escribió este código (falla incluso con un `.txt`
  vacío — diagnosticado con `strace`, no es un problema de los archivos).
- **Login + formulario (`login.ts`, `form-fill.ts`): con toda la lógica escrita pero diferidos a
  propósito.** `claveunica.gob.cl` y `mercadopublico.cl` devuelven `ERR_CONNECTION_RESET` a
  Chromium headless en un sandbox en la nube (confirmado repetidas veces; `curl` sí conecta con
  el mismo User-Agent — bloqueo de fingerprint/WAF del portal, no un bug del código). Por
  decisión del usuario, este paso no se reintenta desde acá: se completa en otra sesión con
  **Claude Cowork en una máquina local**, usando los PDF de `output/` como insumo. Los
  selectores están marcados `TODO(verificar en vivo)` donde no se pudieron confirmar contra el
  DOM real — revisarlos con `page.pause()` en modo no-headless en esa sesión local. Ver
  `docs/flujo.html` para el diagrama de dónde exactamente entra la persona en todo esto.
- **`output/` se versiona en el repo a propósito** (cotizaciones `.pptx`/`.pdf`, resúmenes,
  notas, informes) — es el respaldo completo para la sesión local de Cowork y para cualquiera
  que necesite revisar el trabajo sin correr nada.
