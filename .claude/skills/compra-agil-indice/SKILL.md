---
name: compra-agil-indice
description: Regenera/completa el índice histórico versionado de Compra Ágil (historico/observaciones.jsonl) barriendo estados que el radar diario no cubre (desierta, cancelada, cerrada). Usar cuando el usuario pida "indexar", "actualizar el histórico", o antes de trabajar en analítica de mercado (Fase 3 de PLAN-VOLUMEN.md).
---

# Índice histórico de Compra Ágil

Backfill de `historico/observaciones.jsonl` — el índice append-only versionado que hace que el
radar detecte recompradores incluso en un checkout limpio (ver PLAN-VOLUMEN.md, Fase 2). El radar
diario (`npm run radar`) ya alimenta este índice como efecto lateral de su trabajo normal (con
**cero requests extra**, el detalle ya se paga ahí), pero solo cubre `publicada` +
`proveedor_seleccionado`. Este skill llena lo que falta: `desierta`, `cancelada`, `cerrada`.

## Cuándo usar

- El usuario pide "indexar", "actualizar el histórico", "reconstruir el índice".
- Antes de trabajar en métricas de mercado o el calificador de admisibilidad (Fase 3/4 del plan de
  volumen) — necesitan el índice completo, no solo lo que el radar del día encontró.

## Requisitos

- `COMPRA_AGIL_API_TICKET` en `.env` — salvo con `--solo-cache`.
- El radar (`npm run radar`) debe haber corrido hoy — este backfill tiene **prioridad menor de
  cuota** (barre 5 estados × N variantes, mucho más caro que el radar). Se puede saltar el chequeo
  con `--forzar` si es intencional.

## Cómo correrlo

```bash
npm run indexar                    # todas las categorías activas, 5 estados
npm run indexar -- --categoria=claude
npm run indexar -- --solo-cache    # reindexa lo que ya está en data/*/detalle.json — 0 requests
npm run indexar -- --forzar        # ignora el chequeo de "¿corrió el radar hoy?"
```

## Qué hace (`scripts/indexar.ts`)

1. Por cada categoría (todas las activas, o la de `--categoria=<id>`), barre
   `publicada`/`desierta`/`cancelada`/`cerrada`/`proveedor_seleccionado` con las variantes de esa
   categoría — mismo patrón que `informe-nicho.ts`, pero además cubriendo `proveedor_seleccionado`.
2. **Caché-first** (`obtenerDetalleConCache`, `src/lib/indice.ts`): los estados terminales
   (`desierta`/`cancelada`/`cerrada`/`proveedor_seleccionado`) son inmutables — si ya está en
   `data/<codigo>/detalle.json`, no se refetchea nunca. Para `publicada`, usa
   `fecha_ultimo_cambio` del listado (ya pagado, 50 códigos por request) como clave de
   invalidación. Una segunda corrida del mismo período gasta drásticamente menos requests que la
   primera.
3. `--solo-cache`: se salta la búsqueda contra la API por completo y reindexa únicamente lo que ya
   esté en `data/*/detalle.json` en disco — 0 requests, útil para reconstruir el índice tras
   perderlo sin gastar cuota.
4. Proyecta cada detalle confirmado a una `Observacion` (`src/lib/indice.ts`) y la anexa a
   `historico/observaciones.jsonl` **solo si cambió** respecto de la última observación de ese
   código (comparando hash) — correr esto varias veces seguidas sin novedades no infla el archivo.
5. Reporta cuántas observaciones fueron nuevas, cuántas actualizaron un cambio de estado, y cuántas
   no generaron escritura por no haber cambiado.

## Notas

- `historico/observaciones.jsonl` se versiona a propósito (a diferencia de `data/`, que es caché
  efímero) — sobrevive al cambio de máquina entre la sesión local y los agentes de la nube.
- Los motivos (`motivo_desierta`/`motivo_cancelacion`) se truncan a 1000 caracteres en el índice;
  el texto íntegro sigue disponible en `data/<codigo>/detalle.json`.
