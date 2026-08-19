---
name: radar_licitaciones
description: Monitorea Licitaciones públicas en mercadopublico.cl sobre gestión documental, digitalización de procesos u oficina de partes. Usar cuando el usuario pida revisar licitaciones nuevas de este tipo, correr el radar de licitaciones, o preguntar qué licitaciones de gestión documental están abiertas ahora mismo.
---

# Radar de Licitaciones — Gestión Documental / Digitalización de Procesos / Oficina de Partes

Réplica de `compra-agil-radar-claude` (raíz) para un segundo nicho: **Licitaciones públicas** (no
Compra Ágil) contra la API clásica `api.mercadopublico.cl`, buscando gestión documental,
digitalización de procesos y oficina de partes. No requiere credenciales del portal — solo el
ticket de la API. No envía nada ni requiere aprobación humana: es de solo lectura.

## Estado: verificado contra producción (2026-08-19)

Este skill ya corrió contra la API real con un ticket válido. Esa corrida corrigió varias
suposiciones del código — ver "Hallazgos de la corrida de verificación" en `licitaciones/PLAN.md`.
Lo esencial para operarlo:

- El ítem del **listado** es mucho más pobre que la ficha (no trae `Comprador`, `Tipo`,
  `MontoEstimado` ni `Estado`). Cualquier consumidor de esos datos debe usar el `detalle`.
- La API **no expone adjuntos ni garantías** de la licitación: no existe el equivalente al servicio
  de adjuntos sin login de Compra Ágil. Pero eso ya no obliga a que una persona lea las bases: la
  ficha pública del portal trae su texto completo y se baja con
  `npm run antecedentes-licitacion -- <codigo>` (sin ticket ni cuota). Solo los ARCHIVOS adjuntos
  siguen tras un CAPTCHA de imagen — ver "Acceso a los antecedentes" en `licitaciones/PLAN.md`.
- **La cuota del ticket es escasa**: se agotó (429) en la segunda corrida del mismo día. Correr el
  radar contra la API una vez al día y usar `--desde-cache` para republicar sin gastar cuota.

## Cuándo usar

- El usuario pide "correr el radar de licitaciones", "qué hay abierto de gestión documental /
  oficina de partes / digitalización de procesos".
- Antes de armar una cotización con `cotizar_licitaciones`, para tener el detalle ya descargado en
  `licitaciones/data/<codigo>/`.

## Requisitos

- `LICITACIONES_API_TICKET` en `.env` (ver `.env.example` en la raíz del repo) — **distinto** del
  `COMPRA_AGIL_API_TICKET` que ya usa el otro radar. Se solicita en
  https://www.mercadopublico.cl/Home/Api.

## Cómo correrlo

```bash
npm run radar-licitaciones                    # corrida real contra la API (gasta cuota)
npm run radar-licitaciones -- --desde-cache   # re-render desde las fichas ya guardadas, sin API
```

`--desde-cache` no detecta nada nuevo: vuelve a publicar el reporte y la página a partir de
`licitaciones/data/*/detalle.json`, y lo declara así en la salida. Sirve cuando la cuota está
agotada o cuando cambió el formato del reporte/página. No toca `state.json`.

## Qué hace (`scripts/radar.ts`)

1. Consulta `estado=activas` en la API clásica de Licitaciones. **Esta API no soporta búsqueda por
   texto** (a diferencia de `q` en Compra Ágil): el filtrado por las variantes de
   `licitaciones/config/keywords.json` (`Gestión Documental`, `Digitalización de Procesos`,
   `Oficina de Partes`, etc.) es **local**, sobre `Nombre`/`Descripcion` del listado — es el
   mecanismo de descubrimiento primario, no un filtro de ruido secundario.
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
6. Actualiza `licitaciones/data/state.json`: marca qué códigos son nuevos y qué organismos ya
   tenían procesos previos (recompradores). La agrupación es por el `Comprador` de la **ficha**;
   si una ficha no trae identificador de comprador, no se afirma nada sobre recompra en vez de
   agrupar a ciegas.
7. Escribe `licitaciones/output/radar-ultima-corrida.md` y lo imprime en consola.
8. Refresca la grilla de tarjetas de **oportunidades detectadas** en `docs/licitaciones.html`
   (misma vista que la de Compra Ágil en `docs/index.html`: código, organismo, tope, cierre con
   aviso de "cierra hoy/mañana", tipo L1/LE/LP/…, garantías y plazo de contrato).

   Solo se reemplaza el bloque entre los marcadores
   `<!-- OPORTUNIDADES:INICIO ... -->` y `<!-- OPORTUNIDADES:FIN -->`: el resto de esa página es
   análisis escrito a mano (insumos bloqueantes, diferencias con Compra Ágil, qué falta para
   operar) que una corrida del radar **no** debe pisar. Si los marcadores no están, el script
   avisa y deja la página intacta en vez de reescribirla. El generador vive en
   `licitaciones/src/lib/pagina.ts`.

   Cada tarjeta omite las filas que la ficha no informa, en vez de imprimir "—": las licitaciones
   chicas traen pocos campos y la tarjeta no debe sugerir que el organismo declaró algo que no
   declaró. Cuando no hay tope publicado lo dice explícitamente en vez de mostrar `$0`.

   **Sin `LICITACIONES_API_TICKET` la grilla queda en su estado vacío**, que explica por qué está
   vacía. No se inventan licitaciones para llenarla.

   Una **corrida incompleta no publica**: si se agota la cuota, falla alguna ficha o se alcanza el
   cap de 60, el reporte se escribe igual pero la página se deja intacta. Publicar una grilla
   parcial borraría de la página oportunidades que siguen abiertas.

## Toda la cuota va a las licitaciones activas

Este dominio consulta **un solo listado**: `estado=activas`. La API acepta otros estados
(`cerrada`, `desierta`, `adjudicada`) y un parámetro `fecha`, pero acá no se usan: sin `q`, cada
estado extra obliga a traerse un listado nacional completo, y la cuota de este ticket no da para
eso. Hubo un `informe-nicho.ts` que hacía ese barrido histórico —el equivalente al informe del
nicho de Compra Ágil— y **se eliminó a propósito**: consumía la cuota que necesita el radar sin
haber llegado nunca a producir cifras.

Consecuencia a tener presente: de este nicho **no hay cifras históricas** (cuántas licitaciones de
gestión documental se declaran desiertas, quién se las adjudica, a qué precio). Lo que el radar
entrega es qué está abierto ahora, no una lectura del mercado. Si en algún momento esas cifras se
necesitan, primero hay que presupuestar la cuota — ver `buscarLicitacionesActivas` en
`licitaciones/src/lib/api.ts`.

## Notas

- La cuota se agota rápido y la API **no informa `Retry-After`**. Ante un 429 el script deja de
  consultar (no reintenta a ciegas), rescata desde caché las fichas que puede, marca la corrida como
  incompleta y no toca la página. Cuánto rinde exactamente la cuota diaria sigue sin medirse.
- Este skill es de solo lectura. Para preparar una cotización usar `cotizar_licitaciones`, que sí
  requiere `licitaciones/config/company.json` con costos reales.
