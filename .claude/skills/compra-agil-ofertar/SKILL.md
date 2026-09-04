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
4. Cotiza con `src/lib/pricing.ts` (`cotizarLinea`, que delega en `calcularCotizacionUsd` de
   `src/lib/pricing-usd.ts` — ver también el skill `cotizar-usd`): precio público de Anthropic
   (USD) → CLP con el dólar observado en vivo (mindicador.cl, con fallback fijo en
   `company.json`) **+5,5% de recargo de tipo de cambio** → +19% de impuesto no recuperable
   (costo) → **+15% de markup** → +19% de IVA (venta). Es decir,
   total = lista × 1,055 × 1,19 × 1,15 × 1,19 — la fórmula exacta la definió el usuario, no está
   inventada, y desde el 2026-08-28 es la misma regla para cualquier costo en USD (recargo de
   tipo de cambio y markup ya no se configuran por empresa en `company.json`, son fijos). La
   oferta incluye siempre, sin costo adicional, un taller de buenas prácticas de 3 horas y acceso
   a la comunidad de usuarios de Claude en Chile.
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
   La que desborda primero es la **lámina 4**, el cuadro de cumplimiento, porque crece con las filas
   que agreguen las bases (una por bloque de exigencias adicionales): por eso su tabla lleva la
   clase `cumpl`, un punto más compacta que el resto. La de la oferta económica tiene una sola fila
   y no necesita apretarse. Cuando aun así desborda, lo que hay que acortar son los tres campos
   variables que alimentan ese cuadro —`participantes.glosa`, `duracion.glosa` y
   `fechas_ejecucion`—, no el criterio ni su cita.
4. **No afirma nada de la compra desde el código.** `modalidad_observacion` es texto libre por
   oportunidad, y durante un tiempo la fila "Modalidad" del cuadro de cumplimiento respondía con una
   frase fija —"las bases se contradicen entre modalidad e-learning y ejecución presencial"— escrita
   para 2672-18-COT26. Era falsa en las otras tres que declaran esa observación: la de Lo Barnechea
   justifica una modalidad asincrónica y la de Puerto Montt fija fechas inamovibles, ninguna se
   contradice. Ahora la fila dice que hay una observación y remite a la lámina 5, donde va el texto
   literal. Regla general: la plantilla nunca describe el contenido de un campo de config.

### Score de apertura (0–100%)

Cada tarjeta encabeza con un porcentaje que ordena el foco. La regla, fijada por el usuario el
2026-08-22: **100%** es una compra que no exige ninguna característica, capacidad o certificación
particular que dirija la adjudicación hacia un proveedor determinado, y se descuenta **5% por cada
criterio que haya que revisar y del que hoy no se tenga información**.

Los criterios viven en `criterios_direccionadores` de `config/capacitaciones.json`, uno por
exigencia, cada uno con su **cita** al documento del organismo. `src/lib/scoring-capacitacion.ts`
solo cuenta: `score = 100 − 5 × (criterios en estado "sin_informacion")`, con piso en 0.

De las dieciocho fichadas hasta hoy, el rango va de 85% a 45%. El orden no es casual — el Hospital
Padre Hurtado (45%) exige las **últimas 12 órdenes de compra del mismo curso** en Mercado Público,
que excluye a cualquiera que no lo haya vendido ya varias veces; Cochilco (50%) reparte 55% del
puntaje entre experiencia del relator, satisfacción acreditada por terceros y 6 o más servicios
similares del oferente, y deja el precio en 10%; Puerto Montt (55%) exige que el relator/a sea
Ingeniero en Informática o en Información y Control de Gestión **con** postítulo en IA; Concepción
(60%) da 35 de 100 puntos por un magíster; Subtrans (65%) reserva 10% del puntaje a ser OTEC. En el
otro extremo, Dipres (85% y 75%) y el MOP (70%) solo piden credenciales del relator/a, que es un
dato averiguable.

Una tercera forma, del SLEP Santa Corina (65%): **la demo como causal de inadmisibilidad**. «Será
inadmisible la oferta que no acompañe cotización y demo de la plataforma de aprendizaje» — y esa
frase no está en el TDR sino en la descripción de la compra, así que solo aparece si se lee el
`detalle.json` además de los adjuntos. Es de las exigencias más excluyentes que se han visto en el
nicho: no hay demo que mostrar de una plataforma que se construiría después de adjudicar.

Dos formas recurrentes de criterio que aparecieron en la tanda del 2026-09-03 y conviene reconocer:
**la contradicción interna de las bases** —CONASET pondera 80/20 en el texto y 70/30 en la fórmula,
la Defensoría exige 20 y 24 horas en dos párrafos distintos, Puerto Montt pide 12 horas en tres
jornadas que dan 9— y **la pauta de evaluación que no existe**: los dos TDR de DICREP no publican
ninguna, y el del MOP la anuncia («A continuación, se detallan los criterios de evaluación») y a
continuación solo informa presupuesto, plazo y contacto. Ambas se registran como criterio con su
cita, en vez de resolverse a dedo: no saber cuánto pesa el precio es exactamente admisibilidad sin
resolver.

Qué **no** es: una probabilidad de adjudicación. No pondera monto, competencia ni precio. Es cuánto
de la admisibilidad está sin resolver hoy.

El score **sube solo, sin tocar código**, cuando alguien confirma un criterio: se cambia su
`estado` a `"cubierto"` y se escribe `resuelto_por` con la evidencia. El cargador valida esto en
serio, porque el número se publica y se lee como dato duro: **corta la corrida** si un criterio no
tiene cita, si un `"cubierto"` viene sin `resuelto_por`, si hay ids duplicados (contarían dos
veces), si el tipo es desconocido o si la lista viene vacía (declarar cero criterios es afirmar
score 100%). Los seis guardas están verificados en negativo.

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
