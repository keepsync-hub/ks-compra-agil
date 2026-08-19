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
| `npm run keywords [-- agregar <categoria> "<frase>" \| quitar "<frase>"]` | Muestra o edita las palabras que busca el radar de Compra Ágil. Las frases van a `config/categorias-extra.json` y la corrida siguiente las usa como variante `q` y como verificación local, sin tocar las regex de `categorias.json`. Equivalente por consola del formulario de `docs/index.html`. Cada frase en una categoría activa suma un request por corrida. |
| `npm run radar` | Busca Compras Ágiles "Claude" abiertas, extrae condiciones, detecta recompradores, baja los adjuntos y **publica `docs/index.html`** (oportunidades + palabras clave). Si la cuota diaria se agota a mitad, sigue con la ficha reducida del listado en vez de abortar. Solo lectura. |
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

## Estado y pendientes

- **Radar e informe del nicho: funcionando de punta a punta contra la API real** — encuentra las
  oportunidades abiertas reales y reproduce la tasa de fracaso medida en `PLAN.md` (~79-80%).
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
