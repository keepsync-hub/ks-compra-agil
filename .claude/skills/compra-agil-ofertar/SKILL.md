---
name: compra-agil-ofertar
description: Prepara una oferta (cotización + formulario) para una Compra Ágil de licencias Claude ya detectada por el radar. Usar cuando el usuario pida cotizar o preparar una oferta para un código de Compra Ágil específico. Nunca envía la oferta — se detiene en revisión humana.
---

# Ofertar en Compra Ágil — Claude

Genera la cotización de licencias (respetando el tope presupuestario) y deja el formulario del
portal completo con la cotización adjunta, **sin enviarlo nunca**. El envío final es un acto
público y vinculante ante el organismo comprador — lo confirma un humano.

## Cuándo usar

- El usuario pide cotizar o preparar una oferta para un código de Compra Ágil (ej.
  `1614-47-COT26`), normalmente uno que ya salió en `compra-agil-radar-claude`.

## Requisitos

- `config/company.json` con datos reales de la empresa y pricing (copiar y completar
  `config/company.json.example` — **nunca** usarlo con placeholders "COMPLETAR" sin llenar; el
  loader lo rechaza a propósito).
- `.env`: `COMPRA_AGIL_API_TICKET` (cotización) y `CLAVE_UNICA_RUN`/`CLAVE_UNICA_CLAVE` (login,
  solo si se va a completar el formulario en el portal).

## Paso 1 — Cotización

```bash
npm run cotizar -- <codigo>
```

Qué hace (`scripts/cotizar.ts`):
1. Usa `data/<codigo>/detalle.json` si el radar ya lo descargó; si no, consulta la API directo.
2. Verifica que la compra siga `publicada` y no haya cerrado (cierre evaluado en hora de Chile,
   `src/lib/tiempo.ts`).
3. Detecta el plan (Pro/Max 5x/Max 20x/Team) y la cantidad de usuarios desde el texto. Si no
   puede determinarlos con confianza, **se detiene y pide revisión manual** — no adivina.
4. Cotiza con `src/lib/pricing.ts`: precio público de Anthropic (USD) → CLP con el dólar
   observado en vivo (mindicador.cl, con fallback fijo en `company.json`) → +19% IVA (costo) →
   +10% markup → +19% IVA (venta). Es decir, total = lista × (1+IVA) × (1+markup) × (1+IVA) —
   la fórmula exacta la definió el usuario, no está inventada. La oferta incluye siempre, sin
   costo adicional, un taller de buenas prácticas de 3 horas y acceso a la comunidad de usuarios
   de Claude en Chile.
5. **Si el total supera el tope presupuestario de la compra, no genera ninguna oferta** — lo
   reporta como inadmisible y se detiene. Esto no es negociable (ver `CLAUDE.md`).
6. Si cabe bajo el tope, genera dos archivos en `output/<codigo>/`:
   - `Q-AAAAMMDD-NombreCliente.pptx` — la propuesta comercial de 4 láminas (portada, solución,
     marco normativo Ley 21.180, cotización formal con tabla de precios), fuente editable.
   - `Q-AAAAMMDD-NombreCliente.pdf` — **el artefacto final a publicar/enviar** (`archivo_publicable`
     en `cotizacion-resumen.json`). Se genera renderizando HTML con Chromium/Playwright
     (`src/lib/cotizacion-html.ts` + `cotizacion-pdf.ts`), no convirtiendo el `.pptx` con
     LibreOffice: `soffice` no funciona en el sandbox donde se escribió este skill (falla incluso
     con un `.txt` vacío, diagnosticado con `strace`) — si se corre en un entorno con LibreOffice
     sano, se podría volver a esa vía, pero la de Chromium es robusta y no depende de eso.
   También guarda `cotizacion-resumen.json` con los números para el paso de formulario.

## Paso 1-bis — Cotización de capacitaciones (otro nicho, otra regla de precio)

```bash
npm run cotizar-capacitacion                 # todas las de config/capacitaciones.json
npm run cotizar-capacitacion -- 1618-69-COT26  # solo esa
```

Las Compras Ágiles de **cursos** (Power BI, IA, automatización) no se cotizan con la fórmula de
licencias Claude: no hay precio de lista del que partir ni catálogo de costos de servicios de
KeepSync (ver `config/keepsync-oferta.json`, insumo bloqueante `sin-catalogo-de-costos-de-servicios`).
El usuario fijó el 2026-08-22 la regla: **precio = tope × 0,9** (10% bajo el presupuesto publicado).
Es la misma clase de heurística de exploración que el 80% del cotizador de Array, así que cada PDF
sale marcado **PRELIMINAR**, y **BORRADOR** mientras `config/company.json` no tenga la identidad real.

Qué genera (`scripts/cotizar-capacitacion.ts` + `src/lib/capacitacion-cotizacion.ts`): un PDF de
**exactamente 5 láminas** por oportunidad en `output/capacitaciones/<codigo>/`, más
`cotizacion-resumen.json`. Las láminas son portada, programa modular, metodología/relatoría/
entregables, cuadro de cumplimiento, y oferta económica con los pendientes.

**Y lo publica.** Copia cada PDF a `docs/capacitaciones-cotizaciones/<codigo>/` y reescribe el
bloque `COTIZACIONES:INICIO/FIN` de `docs/index.html` con una tarjeta por borrador: monto ofertado
contra el tope, régimen tributario, cómo adjudica el organismo, y las **observaciones** desplegables
—lo que impide presentar esa oferta— más de qué documentos salieron los requisitos. Arriba del
grid va la nota con lo que bloquea al nicho entero (relator, OTEC/SENCE, menor precio).

Ese bloque es un **tercer par de marcadores** en la misma página que refresca el radar, y por eso
`reemplazarBloque` se exporta desde `src/lib/pagina-compra-agil.ts`: `npm run radar` reescribe
oportunidades y palabras clave sin tocar las cotizaciones, y este script reescribe las cotizaciones
sin tocar lo del radar (verificado). El índice versionado
`docs/capacitaciones-cotizaciones/index.json` es lo que permite además correr
`npm run cotizar-capacitacion -- <codigo>` para una sola compra sin borrar de la página las otras
cinco.

Lo que el documento responde sale de `config/capacitaciones.json`, que guarda **lo que pide cada
organismo en sus adjuntos** (TDR, bases técnicas, memos, anexos), con `fuente_documentos` y la cita
textual del régimen tributario. Ese archivo se llena leyendo los adjuntos que ya bajó el radar a
`data/<codigo>/attachments/`; el cotizador **no inventa el contenido de un curso**: si falta el
código en la config, se detiene y lo dice.

Tres cosas que este cotizador hace a propósito y conviene no "arreglar":

1. **No nombra relator/a ni inventa credenciales.** Los seis TDR exigen título, CV y certificados
   verificables (Dipres pide 7 cursos de Power BI en 3 años; Subtrans premia >7 años de docencia),
   y una oferta sin eso se descarta en admisibilidad. Esas filas del cuadro salen marcadas
   *Por confirmar* y encabezan los pendientes. Es el gate humano del nicho, igual que el de
   fulfillment en licencias.
2. **Respeta el régimen tributario que declara cada organismo.** Los tres TDR de Dipres presupuestan
   **exento** citando el art. 13 N°4 de la Ley de IVA (exención por giro educacional), Subtrans dice
   "impuestos incluidos", y Concepción y el Hospital no lo declaran — ahí el valor se presenta como
   TOTAL y el pendiente es consultarlo. No se agrega un 19% donde el organismo presupuestó exento.
3. **Verifica que nada se recorte.** Las láminas tienen alto fijo y `overflow:hidden` (es lo que
   garantiza las 5 páginas), así que el modo de falla natural es que un requisito largo se corte
   *en silencio*. `generarCotizacionCapacitacionPdf` mide `scrollHeight` vs `clientHeight` en el
   mismo Chromium que imprime y devuelve las láminas desbordadas; el script trata eso como error y
   no da por buena la cotización. Al ajustar la plantilla, correr y mirar esa salida — no la vista.

**Tensión registrada, no resuelta:** las tres compras de Dipres seleccionan por **menor precio
total** entre las que cumplen todo. Cotizar al 90% del tope es por construcción una posición débil
frente a quien cotice más abajo. La regla la fijó el usuario; el PDF y el resumen lo dicen en vez
de corregirlo en silencio.

## Paso 2 — Login y formulario (diferido a sesión local)

`scripts/login.ts` (login a mercadopublico.cl vía ClaveÚnica + 2FA, el código se lee de Gmail
vía `mcp__Gmail__*`, guarda `data/storageState.json`) y `scripts/form-fill.ts` (completa el
formulario y adjunta el `.pdf` de `archivo_publicable`, **nunca hace click en enviar**) tienen
toda la lógica de negocio escrita, pero **no se ejecutan desde un sandbox en la nube**:
`claveunica.gob.cl` y `mercadopublico.cl` devuelven `ERR_CONNECTION_RESET` a Chromium headless
ahí (confirmado repetidas veces con `npx tsx .claude/skills/compra-agil-ofertar/scripts/login.ts
--diagnostico`; `curl` con el mismo User-Agent sí conecta — es un bloqueo de fingerprint/WAF del
portal, no un bug del script). Por decisión del usuario, este paso se hace en otra sesión con
**Claude Cowork en una máquina local** (navegador real, red del usuario), usando los PDF de
`output/` como insumo. No reintentar el login desde un sandbox — correr el diagnóstico primero.

Los selectores de ClaveÚnica y del formulario de oferta están marcados
`TODO(verificar en vivo)` donde no se pudieron confirmar contra el DOM real por el mismo
bloqueo — revisarlos la primera vez con `page.pause()` en modo no-headless en la sesión local
antes de confiar en una corrida desatendida. `form-fill.ts` **nunca busca ni hace click en un
botón de enviar/confirmar** — ese es el punto de entrega a un humano.

## Guardrails (no negociables)

1. Nunca se envía nada automáticamente.
2. Nunca se cotiza por sobre el tope presupuestario.
3. No se inventan precios: sin `config/company.json` real, no hay cotización.
4. CAPTCHA o bloqueo del portal → detenerse, avisar, no reintentar a ciegas.
