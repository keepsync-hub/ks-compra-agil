---
name: cotizar_licitaciones
description: Prepara una cotización (respetando el tope presupuestario) para una Licitación pública de gestión documental, digitalización de procesos u oficina de partes ya detectada por radar_licitaciones. Usar cuando el usuario pida cotizar un código de licitación de este tipo. Solo genera el PDF/PPTX de cotización — no completa formulario ni envía nada.
---

# Cotizar Licitaciones — Gestión Documental / Digitalización de Procesos / Oficina de Partes

Réplica del Paso 1 de `compra-agil-ofertar` (raíz) para el nicho de Licitaciones de gestión
documental: genera la cotización (respetando el tope presupuestario) como PDF/PPTX, **sin tocar
el portal**. A diferencia de `compra-agil-ofertar`, este skill **no incluye** el paso de login ni
llenado de formulario — no se ha diseñado ni verificado para licitaciones (que en el portal real
suelen requerir boletas de garantía y firma electrónica, un flujo más complejo que Compra Ágil).
Ver `licitaciones/PLAN.md` para el detalle.

## Cuándo usar

- El usuario pide cotizar una licitación de gestión documental/digitalización/oficina de partes
  (ej. un código detectado por `radar_licitaciones`).

## ⚠️ Requisito bloqueante: catálogo de costos reales

`licitaciones/config/company.json` debe existir y estar completo (copiar y completar
`licitaciones/config/company.json.example` — el loader rechaza el archivo mientras tenga
placeholders `"COMPLETAR"`). A diferencia de licencias Claude, **acá no hay un precio de lista
público que copiar**: el catálogo (`pricing.items`) tiene que reflejar lo que KeepSync realmente
puede ofrecer (qué plataforma de gestión documental revende o implementa, a qué costo real por
usuario/hora/documento). Sin eso, el agente no cotiza — no inventa precios.

También requiere `LICITACIONES_API_TICKET` en `.env` (mismo ticket que usa `radar_licitaciones`).

## Cómo correrlo

```bash
npm run cotizar-licitaciones -- <codigo>
```

## Qué hace (`scripts/cotizar.ts`)

1. Usa `licitaciones/data/<codigo>/detalle.json` si `radar_licitaciones` ya lo descargó; si no,
   consulta la API directo.
2. Verifica que la licitación no haya cerrado (cierre evaluado en hora de Chile).
3. Mapea cada ítem solicitado en la ficha a una clave del catálogo de costos
   (`licitaciones/src/lib/pricing.ts`, heurística de texto: licencia/usuario, migración de
   documentos, implementación, capacitación, soporte, integración). **Si no puede mapear algún
   ítem con confianza, o falta la cantidad, se detiene y pide revisión manual — no adivina.**
4. Cotiza cada línea: `costo_clp × (1+markup) × (1+iva)` (fórmula por defecto, distinta de la
   doble-IVA de licencias Claude — ver la nota `_formula_nota` en `company.json.example`).
5. **Si el total supera el tope presupuestario (`MontoEstimado`), no genera ninguna oferta** — lo
   reporta como inadmisible y se detiene. Si la ficha no trae tope detectable, avisa y sigue (no
   puede validar automáticamente, hay que confirmar manualmente).
6. Si cabe bajo el tope, genera en `licitaciones/output/<codigo>/`:
   - `Q-AAAAMMDD-NombreCliente.pptx` — propuesta comercial de 4 láminas (portada, solución, marco
     normativo Ley 21.180 — Transformación Digital del Estado, cotización formal), fuente editable.
   - `Q-AAAAMMDD-NombreCliente.pdf` — el artefacto final a publicar/enviar, renderizado con
     Chromium/Playwright (mismo enfoque que Compra Ágil: LibreOffice no funciona en este sandbox).
   - `cotizacion-resumen.json` con el detalle numérico.

## Lo que esta cotización NO puede decirte

La API de Licitaciones **no expone los adjuntos ni las garantías** de la licitación (verificado
contra producción el 2026-08-19 — ver `licitaciones/PLAN.md`). En consecuencia:

- Que la cotización generada no mencione una boleta de garantía **no significa que el organismo no
  la exija**: la exigencia vive en las bases administrativas.
- Los "documentos exigidos" que aparecen salen de buscar frases en el texto de la ficha de la API,
  no de un campo estructurado. Son una pista, no la lista oficial.

**Corré `npm run antecedentes-licitacion -- <codigo>` antes de cotizar.** Baja de la ficha pública
del portal —sin ticket, sin cuota y sin login— el contenido completo de las bases a
`licitaciones/data/<codigo>/antecedentes.md`: garantías exigidas (sección 8), anexos que hay que
presentar (sección 4) y criterios de evaluación (sección 6). Eso es lo que decide si conviene
ofertar, y ya no requiere que una persona abra el portal.

Lo que sí sigue requiriendo a una persona: los ARCHIVOS adjuntos (los PDF/DOCX de bases y los
formatos de anexo en blanco). El portal los protege con un CAPTCHA de imagen y el agente no lo
rodea — `antecedentes.md` deja anotada la URL del visor para abrirla en un navegador.

## Guardrails (no negociables, iguales en espíritu a `compra-agil-ofertar`)

1. Nunca se envía nada automáticamente — este skill ni siquiera llega al paso de formulario.
2. Nunca se cotiza por sobre el tope presupuestario.
3. No se inventan precios: sin `licitaciones/config/company.json` real, no hay cotización.
4. Si un ítem no mapea con confianza al catálogo, o la cantidad no es clara, se detiene y pide
   revisión humana.
