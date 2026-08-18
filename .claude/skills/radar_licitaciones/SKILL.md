---
name: radar_licitaciones
description: Monitorea Licitaciones públicas en mercadopublico.cl sobre gestión documental, digitalización de procesos u oficina de partes. Usar cuando el usuario pida revisar licitaciones nuevas de este tipo, correr el radar de licitaciones, o preguntar qué licitaciones de gestión documental están abiertas ahora mismo.
---

# Radar de Licitaciones — Gestión Documental / Digitalización de Procesos / Oficina de Partes

Réplica de `compra-agil-radar-claude` (raíz) para un segundo nicho: **Licitaciones públicas** (no
Compra Ágil) contra la API clásica `api.mercadopublico.cl`, buscando gestión documental,
digitalización de procesos y oficina de partes. No requiere credenciales del portal — solo el
ticket de la API. No envía nada ni requiere aprobación humana: es de solo lectura.

## ⚠️ Estado: sin verificar contra producción

A diferencia de `compra-agil-radar-claude` (verificado end-to-end contra `api2.mercadopublico.cl`),
este skill **no se ha corrido contra la API real con un ticket válido**. Leer
`licitaciones/PLAN.md` completo antes de confiar en sus resultados — documenta qué está asumido y
qué falta verificar (nombres de campo, si `estado=activas` pagina, formato real de `Adjuntos`,
etc.). La primera corrida real con un ticket válido debe tratarse como una verificación, no como
una ejecución de rutina.

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
npm run radar-licitaciones
```

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
4. Lista los adjuntos declarados en la ficha (no los descarga: la URL de descarga directa no está
   verificada en esta sesión, ver `licitaciones/PLAN.md`).
5. Guarda todo en `licitaciones/data/<codigo>/{detalle.json, condiciones.json}`.
6. Actualiza `licitaciones/data/state.json`: marca qué códigos son nuevos y qué organismos ya
   tenían procesos previos (recompradores).
7. Escribe `licitaciones/output/radar-ultima-corrida.md` y lo imprime en consola.

`scripts/informe-nicho.ts` (`npm run informe-licitaciones`) hace el barrido histórico equivalente
al de Compra Ágil, con la misma limitación: sin `q`, tiene que traer el listado completo de cada
estado consultado (`cerrada`, `desierta`, `adjudicada`) y filtrar localmente — avisa en consola si
el volumen de un estado parece demasiado alto para ser confiable así.

## Notas

- La cuota de la API es probablemente diaria por ticket (asumido por analogía con Compra Ágil, sin
  confirmar); si responde 429, el script se detiene y muestra el `Retry-After`.
- Este skill es de solo lectura. Para preparar una cotización usar `cotizar_licitaciones`, que sí
  requiere `licitaciones/config/company.json` con costos reales.
