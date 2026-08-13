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

1. Consulta `/v2/compra-agil` con `estado=publicada` para cada variante en
   `config/marcas.json` (`Claude`, `Anthropic`, `Cloude`, `Clude`, `Claude Pro`, `Claude Max`,
   `Claude Code`, `Claude Team`), deduplicando por `codigo`.
2. Descarta ruido de `q` verificando localmente que `nombre`/`descripcion` mencionen la marca de
   verdad (`src/lib/marca.ts`).
3. Trae el detalle de cada código (`/v2/compra-agil/{codigo}`) para tener
   `total_ofertas_recibidas` real y `productos_solicitados`.
4. Extrae condiciones con `src/lib/condiciones.ts`: tope presupuestario (siempre desde
   `presupuesto.monto_disponible_clp`, nunca parseado del texto), plan/versión detectado,
   cantidad de usuarios, plazo de entrega, documentos exigidos y frases excluyentes.
5. Descarga adjuntos solo si `documentos[]` no viene vacío (la mayoría de estas compras no
   traen adjuntos), vía el servicio público sin login (`src/lib/adjuntos.ts`).
6. Guarda todo en `data/<codigo>/{detalle.json, condiciones.json, attachments/}`.
7. Repite el barrido con `estado=proveedor_seleccionado` (compras adjudicadas) y extrae la
   adjudicación con `extraerAdjudicacion` (`src/lib/api.ts`). Nota verificada: la API v2 hoy no
   puebla el proveedor ganador ni el monto (campos vacíos); ese dato vive en la Orden de Compra
   del portal. Guarda `data/<codigo>/adjudicacion.json` y lo declara con honestidad en el reporte.
8. Actualiza `data/state.json`: marca qué códigos son nuevos y qué organismos ya tenían
   procesos previos (recompradores) — señal de alta probabilidad, avisan con antelación.
9. Escribe `output/radar-ultima-corrida.md` (con la sección de adjudicaciones) y lo imprime en
   consola. Las fechas de cierre se evalúan en hora de Chile (`src/lib/tiempo.ts`).

## Notas

- La cuota de la API es diaria por ticket; si responde 429, el script se detiene y muestra el
  `Retry-After` — no reintentar a ciegas.
- El servicio de adjuntos no es API documentada oficialmente; si empieza a fallar de forma
  consistente, revisar `src/lib/adjuntos.ts` (aislado a propósito) antes de asumir que el radar
  está roto.
- Este skill es de solo lectura. Para preparar una oferta usar `compra-agil-ofertar`, que sí
  requiere `config/company.json` con costos reales.
