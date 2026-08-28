---
name: keepsync-pdf
description: Construye un PDF de cotización con el look and feel oficial de KeepSync (paleta oscura, logo, tipografía, láminas apaisadas) a partir de un módulo compartido, para que cualquier nicho nuevo salga con el mismo formato que /cotizar. Usar cuando el usuario pida generar, diseñar o ajustar el PDF/la propuesta comercial de una cotización — sobre todo una de un nicho sin cotizador propio todavía — o pregunte cómo se ve o de dónde sale el estilo visual de las cotizaciones de KeepSync.
---

# Estilo KeepSync para PDF de cotización

Este repo genera PDF de cotización para cuatro nichos (licencias Claude, cursos de capacitación,
Array, licitaciones de gestión documental) y los cuatro usan la misma identidad visual: paleta
oscura, logo de KeepSync, láminas de 11.69×8.27in (A4 apaisado) renderizadas con Chromium/Playwright
a partir de HTML — nunca convirtiendo un `.pptx` con LibreOffice, que no funciona en este entorno
(`soffice` falla incluso con un `.txt` vacío, diagnosticado con `strace`).

Hasta esta skill esos nueve colores, el logo y el arranque de Chromium estaban **copiados en cuatro
archivos** (`src/lib/cotizacion-html.ts`, `src/lib/array-cotizacion.ts`,
`src/lib/capacitacion-cotizacion.ts`, `licitaciones/src/lib/cotizacion-html.ts`), y ya se habían
desalineado — el color `ok` (verde) solo existía en la copia de cursos. Ahora la fuente única es
**`src/lib/estilo-keepsync.ts`**, y los cuatro archivos importan de ahí. Cualquier PDF de cotización
nuevo — de un nicho que todavía no tiene su propio cotizador — debe construirse igual: importando
de ese módulo, no copiando uno de los cuatro archivos existentes.

## Qué exporta `src/lib/estilo-keepsync.ts`

- **`PALETA_KEEPSYNC`** — los diez colores de marca: `bg` #0E0E17 (fondo), `card`/`cardAlt`
  (tarjetas), `border`, `accent` #786CF0 / `accentLight` #B4AAFA (violeta KeepSync), `white`,
  `gray` (texto secundario), `warn` #FB7185 (rojo — sellos BORRADOR/PRELIMINAR y advertencias de
  tope), `ok` #34D399 (verde — checks y estados resueltos).
- **`logoKeepsyncBase64()`** — lee `src/assets/logo-keepsync-blanco.png` y lo entrega como base64
  para incrustar con `<img src="data:image/png;base64,...">` (un PDF standalone no puede referenciar
  un archivo externo).
- **`formatoClp(n)`** — `"$" + n.toLocaleString("es-CL")`, el único formato de moneda que debe
  aparecer en un PDF de cotización.
- **`escaparHtml(s)`** — escapa `&`/`<`/`>`. **Todo texto que venga de una fuente externa (bases del
  organismo, `config/*.json`) tiene que pasar por acá antes de interpolarse en el HTML** — el nombre
  de una compra o el texto de un adjunto puede traer `&` o `<` sin que nadie lo haya sanitizado.
- **`MESES_ES`** / **`mesAnoEs(fecha)`** — nombres de mes en español para el pie de la carátula
  ("agosto de 2026").
- **`cssLaminasKeepsync(paleta?)`** — el CSS completo del layout de **4 láminas** (carátula,
  solución, marco normativo, cotización formal): tamaño de página, `.slide`, `.card`, `.badge`,
  tabla, `.info-row`, `.totales`, `.footer`. Es el que usan licencias Claude, Array y licitaciones
  tal cual, más una regla extra propia si hace falta (ver `array-cotizacion.ts`, que le agrega
  `.badge.prelim`/`.badge.borrador` para superponer dos sellos).
- **`conPaginaHtml(html, prefijoTmp, fn)`** — abre `html` en Chromium headless (escribe un archivo
  temporal porque Playwright necesita navegar a una URL, no acepta un string) y entrega la `Page` a
  `fn` para que haga lo que necesite; cierra el navegador y borra el temporal pase lo que pase.
  Primitiva de bajo nivel — úsala directo solo si necesitas algo más que imprimir el PDF (la
  cotización de cursos la usa para medir si alguna lámina desbordó antes de dar el PDF por bueno,
  ver más abajo).
- **`renderizarPdfDesdeHtml(html, outputPdfPath, prefijoTmp?)`** — el caso común: imprime el HTML a
  PDF con las mismas opciones de página en los cuatro cotizadores (sin márgenes, tamaño exacto de la
  lámina, fondo incluido). Es lo que llama la mayoría de los cotizadores.

## Los dos layouts ya construidos, como referencia

No hay un generador genérico de láminas — cada nicho arma su propio HTML con las piezas de arriba,
porque el contenido de una cotización de licencias no es el de un curso. Hay dos patrones ya
probados en producción; para un nicho nuevo, parte del que más se parezca a lo que hay que mostrar:

1. **4 láminas, `cssLaminasKeepsync()` sin tocar** — carátula → solución propuesta → marco normativo
   (Ley 21.180) → cotización formal con tabla de líneas y totales. Ejemplos:
   `src/lib/cotizacion-html.ts` (licencias Claude), `src/lib/array-cotizacion.ts` (Array),
   `licitaciones/src/lib/cotizacion-html.ts` (licitaciones). Sirve cuando la oferta es un
   producto/servicio simple y el diferenciador es el marco normativo.
2. **5 láminas, CSS propio más denso** — carátula con ficha del oferente → programa/temario →
   metodología y relatoría → cuadro de cumplimiento → oferta económica. Ejemplo:
   `src/lib/capacitacion-cotizacion.ts` (cursos). Sirve cuando hay que responder punto por punto una
   lista de exigencias del organismo (relator/a, módulos, criterios de evaluación) y una tabla de
   cumplimiento es más honesta que un párrafo de marketing. Este archivo también muestra el patrón
   de **chequeo de desborde**: cada `.slide` tiene alto fijo y `overflow:hidden` para garantizar el
   número exacto de láminas, lo que significa que un texto largo se recorta **en silencio** — por
   eso `generarCotizacionCapacitacionPdf` usa `conPaginaHtml` directo (no `renderizarPdfDesdeHtml`)
   para medir `scrollHeight` contra `clientHeight` en el mismo Chromium que imprime, y devuelve qué
   láminas desbordaron. Cualquier layout de alto fijo nuevo debería copiar ese chequeo, no confiar
   en la vista.

Para un nicho nuevo sin cotizador propio: escribe un `generarCotizacionXxxHtml(data): string` que
arme el `<!doctype html>` con `<style>${cssLaminasKeepsync()}</style>` (o tu propio CSS si el
layout no cabe en 4 láminas genéricas) y las `<div class="slide">`, y una función
`generarCotizacionXxxPdf` que le pase ese HTML a `renderizarPdfDesdeHtml`. No dupliques la paleta,
el logo ni el arranque de Chromium: son exactamente los mismos en todos los nichos, y ya están acá.

## No negociable en cualquier PDF que use este estilo

Estos guardrails vienen de `CLAUDE.md` y ya están aplicados en los cuatro cotizadores existentes —
un nicho nuevo los hereda, no los reinventa:

- **Nunca inventar un precio.** El oferente sale de `config/company.json` (o su equivalente por
  nicho); sin datos reales de la empresa no hay cotización.
- **Nunca cotizar por sobre el tope presupuestario** de la oportunidad — causal de inadmisibilidad.
  Los layouts existentes muestran el tope junto al total y marcan en `warn` cuando se supera (ver
  `bajoTope` en `cotizacion-html.ts` / `array-cotizacion.ts`).
- **Marcar el documento cuando el precio o la identidad son provisorios.** El `.badge` en `warn`
  ("BORRADOR — identidad KeepSync sin confirmar", "PRELIMINAR — exploración de mercado") es el
  mecanismo: un PDF que se ve terminado pero cotiza con una heurística (como el 80%/90% del tope de
  Array y cursos) tiene que decirlo en la propia lámina, no solo en un mensaje de consola.
- **El PDF renderizado con Chromium es el artefacto final**, no el `.pptx`/`.docx` que pueda existir
  como fuente editable — es lo que se adjunta al formulario del portal.

## Relación con los cotizadores existentes

Esta skill no reemplaza a `compra-agil-ofertar`, `array-compras-agiles-cotizar` ni
`cotizar_licitaciones` — esos siguen siendo los que saben *qué* cotizar en cada nicho (pricing,
reglas de negocio, qué datos pedir). Esta skill es la capa de *cómo se ve* el PDF que producen, y
ahora es literalmente el mismo código para los cuatro en vez de cuatro copias que podían
desalinearse. Si el usuario pide una cotización de un nicho que ya tiene skill propia, usa esa
skill; si pide un PDF nuevo para un nicho sin cotizador, o pide cambiar cómo se ve cualquier
cotización, es acá donde se edita.
