---
name: radar_licitaciones
description: Monitorea Licitaciones públicas en mercadopublico.cl que piden servicios del catálogo de Array (array.cl) — oficina de partes electrónica, seguimiento de trámites, gestión documental y firma electrónica, RPA, business intelligence y plataformas de gestión de proyectos. Usar cuando el usuario pida revisar licitaciones nuevas de este tipo, correr el radar de licitaciones, o preguntar qué licitaciones de estos servicios están abiertas ahora mismo.
---

# Radar de Licitaciones — servicios de Array (array.cl)

Réplica de `compra-agil-radar-claude` (raíz) para un segundo nicho: **Licitaciones públicas** (no
Compra Ágil) contra la API clásica `api.mercadopublico.cl`, buscando el **catálogo de servicios de
[Array](http://www.array.cl/)** — el mismo nicho que `array-compras-agiles-radar` cubre en Compra
Ágil: oficina de partes electrónica, seguimiento de trámites, gestión documental y firma
electrónica, automatización de procesos (RPA), business intelligence y plataformas de gestión de
proyectos. No requiere credenciales del portal — solo el ticket de la API. No envía nada ni
requiere aprobación humana: es de solo lectura.

Las categorías, con su `patron_mencion` y su `patron_excluyente`, viven en
`licitaciones/config/keywords.json` (mismo contrato que `config/array-servicios.json`). Editar ese
archivo cambia lo que el radar busca: los patrones se compilan desde ahí, no están en el código.

## Estado: verificado contra producción (2026-08-19)

Este skill ya corrió contra la API real con un ticket válido. Esa corrida corrigió varias
suposiciones del código — ver "Hallazgos de la corrida de verificación" en `licitaciones/PLAN.md`.
Lo esencial para operarlo:

- El ítem del **listado** es mucho más pobre que la ficha (no trae `Comprador`, `Tipo`,
  `MontoEstimado` ni `Estado`). Cualquier consumidor de esos datos debe usar el `detalle`.
- La API **no expone adjuntos ni garantías** de la licitación: no existe el equivalente al servicio
  de adjuntos sin login de Compra Ágil. Pero eso ya no obliga a que una persona lea las bases: la
  ficha pública del portal trae su texto completo y se baja con
  `npm run antecedentes-licitacion` (sin ticket ni cuota), que además publica el **índice de
  documentos** de cada licitación en su tarjeta de `docs/licitaciones.html`. Los ARCHIVOS adjuntos
  siguen tras reCAPTCHA, pero eso ya no bloquea: se entrega su URL, que es acceso suficiente
  (bajarlos con `npm run adjuntos-licitacion` es opcional y hay que correrlo desde la máquina del
  usuario) — ver "El objetivo estaba mal planteado" en `licitaciones/PLAN.md`.
- Después de correr el radar, **correr también `npm run antecedentes-licitacion`**: es gratis (no
  gasta cuota), genera la **ficha de decisión** de cada oportunidad (`decision.md`: banderas, plazos,
  garantías, criterios, anexos, cláusulas excluyentes) y deja la página con esos datos y los enlaces
  a los documentos. Al reportar oportunidades, citar la ficha de decisión, no impresiones.
- **La cuota del ticket es escasa**: se agotó (429) en la segunda corrida del mismo día. Correr el
  radar contra la API una vez al día y usar `--desde-cache` para republicar sin gastar cuota.

## Cuándo usar

- El usuario pide "correr el radar de licitaciones", "qué hay abierto de gestión documental /
  oficina de partes / RPA / BI / gestión de proyectos", o "licitaciones para los servicios de Array".
- Antes de armar una cotización con `cotizar_licitaciones`, para tener el detalle ya descargado en
  `licitaciones/data/<codigo>/`.

## Requisitos

- `LICITACIONES_API_TICKET` en `.env` (ver `.env.example` en la raíz del repo) — **distinto** del
  `COMPRA_AGIL_API_TICKET` que ya usa el otro radar. Se solicita en
  https://www.mercadopublico.cl/Home/Api.

## Cómo correrlo

```bash
npm run radar-licitaciones                    # corrida real contra la API (gasta cuota)
npm run radar-licitaciones -- --max=20        # baja (o sube) el cap de fichas de esta corrida
npm run radar-licitaciones -- --desde-cache   # re-render desde las fichas ya guardadas, sin API
```

`--desde-cache` no detecta nada nuevo: vuelve a publicar el reporte y la página a partir de lo que
haya en `licitaciones/data/<codigo>/` — la ficha de la API (`detalle.json`) si existe y, si no, la
ficha pública del portal (`antecedentes.json`, ver el punto 5 más abajo). Lo declara así en la
salida. Sirve cuando la cuota está agotada o cuando cambió el formato del reporte/página. No toca
`state.json`.

## Qué hace (`scripts/radar.ts`)

1. Consulta `estado=activas` en la API clásica de Licitaciones. **Esta API no soporta búsqueda por
   texto** (a diferencia de `q` en Compra Ágil): el filtrado por las categorías de
   `licitaciones/config/keywords.json` es **local**, sobre el `Nombre` del listado — es el
   mecanismo de descubrimiento primario, no un filtro de ruido secundario. Dos cosas que se
   verificaron el 2026-08-19 y condicionan los patrones: el ítem del listado **no trae
   `Descripcion`** (solo `CodigoExterno`, `Nombre`, `CodigoEstado` y `FechaCierre`), y el `Nombre`
   viene **truncado a ~50 caracteres** ("CONTRATACIÓN DE SERVICIO DE DIGITALIZACIÓN DOCUMEN"). Por
   eso los patrones matchean prefijos: exigir la palabra completa pierde licitaciones reales.
   El listado nacional completo queda guardado en `licitaciones/data/_listado-activas.json`, así
   que se pueden probar patrones nuevos contra la última corrida **sin gastar cuota**.
2. Trae el detalle (ficha) de cada candidato — con un cap de 60 por corrida para no agotar la
   cuota diaria del ticket ante un listado `activas` potencialmente muy grande — y confirma
   localmente que el detalle también menciona la palabra clave (descarta falsos positivos).
3. Extrae condiciones con `licitaciones/src/lib/condiciones.ts`: tope (`MontoEstimado`), tipo de
   licitación, plazo de contrato, garantías de seriedad/fiel cumplimiento, documentos exigidos y
   frases excluyentes.
4. Extrae el plazo de contrato de `TiempoDuracionContrato` + `UnidadTiempoDuracionContrato` y lo
   reporta en la unidad que declaró el organismo ("16 meses"). **No hay adjuntos ni garantías que
   listar en la respuesta de la API**: no los expone (verificado). Para tener garantías, anexos
   exigidos y criterios de evaluación de verdad, correr después
   `npm run antecedentes-licitacion` (sin argumentos toma las licitaciones ya detectadas en caché):
   los baja de la ficha pública del portal sin gastar cuota.
5. Guarda todo en `licitaciones/data/<codigo>/{detalle.json, condiciones.json}`.

   **Si la cuota se agota antes de las fichas, la página igual se puede armar**: corriendo
   `npm run antecedentes-licitacion -- <codigo>` (gratis) queda `antecedentes.json`, y
   `licitaciones/src/lib/detalle-portal.ts` reconstruye desde ahí una ficha equivalente —
   organismo, tope, tipo, moneda, plazo de contrato y fechas salen de las secciones 1, 2, 3 y 7 de
   la ficha pública. Lo único que no se puede reconstruir es `CantidadReclamos` (solo existe en la
   API) y se omite en vez de inventarse. Así la única llamada indispensable a la API es la del
   listado. Ocurrió en la corrida del 2026-08-19: la cuota se agotó justo después del listado y
   las 5 licitaciones se publicaron íntegras por esta vía.
6. Actualiza `licitaciones/data/state.json`: marca qué códigos son nuevos y qué organismos ya
   tenían procesos previos (recompradores). La agrupación es por el `Comprador` de la **ficha**;
   si una ficha no trae identificador de comprador, no se afirma nada sobre recompra en vez de
   agrupar a ciegas.
7. Escribe `licitaciones/output/radar-ultima-corrida.md` y lo imprime en consola.
8. Refresca la grilla de tarjetas de **oportunidades detectadas** en `docs/licitaciones.html`
   (misma vista que la de Compra Ágil en `docs/index.html`: código, organismo, tope, cierre con
   aviso de "cierra hoy/mañana", tipo L1/LE/LP/…, garantías y plazo de contrato).

   Solo se reemplaza el bloque entre los marcadores
   `<!-- OPORTUNIDADES:INICIO ... -->` y `<!-- OPORTUNIDADES:FIN -->`; fuera de ellos quedan la
   cabecera y el pie. Esa página **ya no lleva secciones de estado del proyecto** (insumos
   bloqueantes, diferencias con Compra Ágil, qué falta para operar): se eliminaron a pedido del
   usuario para que la página solo contenga lo que sirve para evaluar una licitación. Si los
   marcadores no están, el script avisa y deja la página intacta en vez de reescribirla. El
   generador vive en `licitaciones/src/lib/pagina.ts`.

   Cada tarjeta trae: código, organismo y unidad, la **descripción completa** del objeto licitado
   (el `Nombre` llega truncado en ambas fuentes), tope, cierre con los días que faltan, tipo
   L1/LE/LP/…, plazo de contrato, garantía exigida, cierre de la ventana de preguntas,
   adjudicación estimada, región, **a qué servicio de Array corresponde**, las banderas de la
   ficha de decisión con su cita, los **criterios de evaluación con su ponderación** y los
   documentos publicados por el organismo. Se ordenan por cierre: primero lo que vence antes.

   Cada tarjeta omite las filas que la ficha no informa, en vez de imprimir "—": las licitaciones
   chicas traen pocos campos y la tarjeta no debe sugerir que el organismo declaró algo que no
   declaró. Cuando no hay tope publicado lo dice explícitamente en vez de mostrar `$0`.

   **Sin `LICITACIONES_API_TICKET` la grilla queda en su estado vacío**, que explica por qué está
   vacía. No se inventan licitaciones para llenarla.

   Una **corrida incompleta no publica**: si se agota la cuota, falla alguna ficha o se alcanza el
   cap de fichas, el reporte se escribe igual pero la página se deja intacta. Publicar una grilla
   parcial borraría de la página oportunidades que siguen abiertas. Para publicar igual, primero
   completar las fichas que falten con `npm run antecedentes-licitacion -- <codigo>` y después
   `npm run radar-licitaciones -- --desde-cache`.

## Toda la cuota va a las licitaciones activas

Este dominio consulta **un solo listado**: `estado=activas`. La API acepta otros estados
(`cerrada`, `desierta`, `adjudicada`) y un parámetro `fecha`, pero acá no se usan: sin `q`, cada
estado extra obliga a traerse un listado nacional completo, y la cuota de este ticket no da para
eso. Hubo un `informe-nicho.ts` que hacía ese barrido histórico —el equivalente al informe del
nicho de Compra Ágil— y **se eliminó a propósito**: consumía la cuota que necesita el radar sin
haber llegado nunca a producir cifras.

Consecuencia a tener presente: de este nicho **no hay cifras históricas** (cuántas licitaciones de
estos servicios se declaran desiertas, quién se las adjudica, a qué precio). Lo que el radar
entrega es qué está abierto ahora, no una lectura del mercado. Si en algún momento esas cifras se
necesitan, primero hay que presupuestar la cuota — ver `buscarLicitacionesActivas` en
`licitaciones/src/lib/api.ts`.

## Notas

- La cuota se agota rápido y la API **no informa `Retry-After`**. Ante un 429 el script deja de
  consultar (no reintenta a ciegas), rescata desde caché las fichas que puede, marca la corrida como
  incompleta y no toca la página. Cuánto rinde exactamente la cuota diaria sigue sin medirse.
- Este skill es de solo lectura. Para preparar una cotización usar `cotizar_licitaciones`, que sí
  requiere `licitaciones/config/company.json` con costos reales.
