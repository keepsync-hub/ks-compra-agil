---
name: compra-agil-radar-claude
description: Monitorea Compras Ágiles en mercadopublico.cl que mencionan Claude/Anthropic. Usar cuando el usuario pida revisar oportunidades nuevas, correr el radar, o preguntar qué Compras Ágiles de licencias Claude están abiertas ahora mismo.
---

# Radar de Compra Ágil — Claude

Busca Compras Ágiles publicadas que mencionen Claude/Anthropic (o variantes con errores de
tipeo comunes) contra la API real `api2.mercadopublico.cl`, extrae condiciones (tope, plan,
usuarios, plazo, documentos exigidos, excluyentes) y detecta organismos que reintentan
(recompradores). No requiere credenciales del portal — solo el ticket de la API.

No envía nada ni requiere aprobación humana: es de solo lectura.

## Cuándo usar

- El usuario pide "correr el radar", "revisar oportunidades nuevas", "qué hay abierto de Claude".
- Antes de armar una cotización con `compra-agil-ofertar`, para tener el detalle y las
  condiciones ya descargadas en `data/<codigo>/`.

## Requisitos

- `COMPRA_AGIL_API_TICKET` en `.env` (ver `.env.example` en la raíz del repo).

## Cómo correrlo

```bash
npm run radar
```

## Qué hace

1. Corre una vez por cada **categoría activa** en `config/categorias.json` (ver
   PLAN-VOLUMEN.md, Fase 1). Hoy solo `claude` está activa (`Claude`, `Anthropic`, `Cloude`,
   `Clude`, `Claude Pro`, `Claude Max`, `Claude Code`, `Claude Team`); otras categorías
   (gestión documental, reventa de otras licencias, desarrollo a medida) están definidas pero
   apagadas hasta tener una cota confiable de la cuota diaria. Para cada variante consulta
   `/v2/compra-agil` con `estado=publicada`, deduplicando por `codigo`.
2. Descarta ruido de `q` verificando localmente que `nombre`/`descripcion` mencionen la
   categoría de verdad (`src/lib/categorias.ts`; `src/lib/marca.ts` es un wrapper delgado sobre
   la categoría `claude`, se mantiene por compatibilidad).
3. Trae el detalle de cada código (`/v2/compra-agil/{codigo}`) para tener
   `total_ofertas_recibidas` real y `productos_solicitados`.
4. Extrae condiciones con `src/lib/condiciones.ts`: tope presupuestario (siempre desde
   `presupuesto.monto_disponible_clp`, nunca parseado del texto), plan/versión detectado,
   cantidad de usuarios, plazo de entrega, documentos exigidos y frases excluyentes.
5. Descarga adjuntos solo si `documentos[]` no viene vacío (la mayoría de estas compras no
   traen adjuntos), vía el servicio público sin login (`src/lib/adjuntos.ts`).
6. Guarda todo en `data/<codigo>/{detalle.json, condiciones.json, attachments/}` y anexa una
   observación al índice histórico versionado (`historico/observaciones.jsonl`,
   `src/lib/indice.ts`) — con cero requests extra, el detalle ya se pagó. Es lo que le permite a
   una corrida en la nube (checkout limpio, sin `data/state.json`) sembrar el historial real al
   arrancar (`sembrarDesdeIndice`, paso 8) en vez de reportar todo como nuevo — ver
   PLAN-VOLUMEN.md, Fase 2. El backfill de estados que este radar no cubre (`desierta`,
   `cancelada`, `cerrada`) es el skill `compra-agil-indice` (`npm run indexar`).
7. Repite el barrido con `estado=proveedor_seleccionado` (compras adjudicadas), pero con **una
   sola variante ancha** en vez de las 8 — medido en 0 casos en cada corrida hasta ahora, gastar
   8 requests para confirmar 8 veces el mismo cero no se justifica (ver PLAN-VOLUMEN.md, Fase 0).
   Extrae la adjudicación con `extraerAdjudicacion` (`src/lib/api.ts`). Nota verificada: la API v2
   hoy no puebla el proveedor ganador ni el monto (campos vacíos); ese dato vive en la Orden de
   Compra del portal. Guarda `data/<codigo>/adjudicacion.json` y lo declara con honestidad.
8. Al arrancar, siembra `data/state.json` desde el índice histórico (`sembrarDesdeIndice`) antes
   de barrer nada, y lo actualiza a medida que avanza: marca qué códigos son nuevos y qué
   organismos ya tenían procesos previos (recompradores) — señal de alta probabilidad, avisan con
   antelación. Confirmado en producción: con `data/state.json` borrado a propósito (simulando un
   checkout limpio de la nube), el estado se repuebla correctamente desde el índice.
9. Escribe `output/radar-ultima-corrida.md` (con la sección de adjudicaciones) y lo imprime en
   consola. Las fechas de cierre se evalúan en hora de Chile (`src/lib/tiempo.ts`).

## Notas

- La cuota de la API es diaria por ticket; si responde 429, el script se detiene y muestra el
  `Retry-After` — no reintentar a ciegas. Cada request se cuenta contra `data/cuota/<hoy>.json` y
  `historico/cuota.jsonl` (`src/lib/cuota.ts`, `npm run cuota` para verlo) — es la medición pasiva
  del límite diario, que nunca se había medido. El radar tiene reserva prioritaria: su presupuesto
  por corrida es la suma de `presupuesto_requests_por_corrida` de las categorías activas (40 hoy,
  con solo `claude` activa). `npm run informe` y los scripts futuros de índice/métricas rechazan
  correr si el radar no corrió hoy, salvo `--forzar` (ver PLAN-VOLUMEN.md).
- Activar una categoría nueva (`config/categorias.json` → `activa: true`) multiplica el costo por
  corrida: sumar su `presupuesto_requests_por_corrida` al total antes de activarla, y revisar
  `npm run cuota` para confirmar que hay margen bajo la cota inferior medida.
- El servicio de adjuntos no es API documentada oficialmente; si empieza a fallar de forma
  consistente, revisar `src/lib/adjuntos.ts` (aislado a propósito) antes de asumir que el radar
  está roto.
- Este skill es de solo lectura. Para preparar una oferta usar `compra-agil-ofertar`, que sí
  requiere `config/company.json` con costos reales.
