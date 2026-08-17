# Agente de Licitaciones — Gestión Documental, digitalización de procesos, Oficina de Partes

> Réplica del diseño de `PLAN.md` (raíz, Compra Ágil de licencias Claude) para un segundo nicho:
> **Licitaciones públicas** (no Compra Ágil) que piden soluciones de gestión documental,
> digitalización de procesos u oficina de partes. A diferencia del documento raíz — que está
> verificado contra la API real de producción de Compra Ágil — este documento declara
> explícitamente qué está verificado y qué es todavía una suposición basada en la documentación
> pública histórica de la API clásica de Licitaciones, porque **no se dispuso de un ticket válido
> de esa API durante la sesión en que se escribió este código**.

## Alcance

Licitaciones públicas de mercadopublico.cl (no Compra Ágil) cuyo objeto sea gestión documental,
digitalización de procesos u oficina de partes — el mismo tipo de necesidad de transformación
digital que Compra Ágil de Claude, pero en el instrumento de compra "Licitación" (montos más
altos, procesos más formales: garantías, bases administrativas y técnicas, evaluación por
comisión) y con un producto/servicio completamente distinto (no hay un precio de lista público
como el de Anthropic).

## Insumos bloqueantes (ninguno resuelto en esta sesión)

1. **`LICITACIONES_API_TICKET`**: la API clásica de Licitaciones (`api.mercadopublico.cl`) usa un
   sistema de tickets **distinto** al de Compra Ágil (`api2.mercadopublico.cl`, ya resuelto — ver
   `CLAUDE.md` de la raíz). Se solicita en https://www.mercadopublico.cl/Home/Api. Sin él, `radar.ts`
   y `cotizar.ts` de este dominio no pueden correr contra datos reales — se probó únicamente que el
   host responde (con un ticket de prueba público desactualizado, que devolvió `{"Codigo":203,
   "Mensaje":"Ticket no válido."}`, HTTP 200), lo que confirma que el endpoint es alcanzable pero no
   verifica la forma real del payload.
2. **Catálogo de costos reales de KeepSync para gestión documental/digitalización**: a diferencia
   de licencias Claude (precio de lista público de Anthropic, ya cargado en `config/company.json`
   de la raíz), acá no existe un precio externo que copiar. `licitaciones/config/company.json` debe
   completarse con lo que KeepSync efectivamente puede ofrecer (¿qué plataforma revende o
   implementa? ¿con qué costo real por usuario, por hora de implementación, por documento
   digitalizado?) antes de que `cotizar_licitaciones` pueda generar una oferta real. Ver
   `config/company.json.example` para la estructura propuesta — sigue siendo una plantilla, no una
   decisión de negocio ya tomada.

Sin estos dos insumos, `radar_licitaciones` puede escribirse y revisarse pero no correrse contra
datos reales, y `cotizar_licitaciones` no puede generar una oferta real (aunque sí puede rechazar
correctamente por falta de configuración, que es el comportamiento esperado — ver guardrails).

## Diferencias estructurales verificadas/asumidas respecto a Compra Ágil (importante)

| | Compra Ágil (raíz, verificado) | Licitaciones (este documento, sin verificar) |
|---|---|---|
| Host | `api2.mercadopublico.cl` | `api.mercadopublico.cl` (API "clásica", distinta y más antigua) |
| Auth | header `ticket` | query param `ticket` (asumido — confirmar) |
| Búsqueda por texto | `q` (matching laxo del servidor) | **no existe** — solo `fecha` (día de publicación), `codigo` (ficha) o `estado`. El filtrado por palabra clave (`config/keywords.json`) es LOCAL y es el mecanismo primario de descubrimiento, no un filtro de ruido secundario como en Compra Ágil |
| Envelope de error | HTTP 429/5xx + `{success, payload, errors}` | HTTP 200 incluso en error, con `{Codigo, Mensaje}` en vez del listado esperado (verificado: así respondió con el ticket de prueba) |
| Adjuntos | servicio público sin login, ya probado end-to-end | `Adjuntos[].URL` de la propia ficha — las licitaciones públicas normalmente permiten descarga directa sin login, pero esto no se probó en esta sesión |
| Tope | `presupuesto.monto_disponible_clp` (número exacto verificado) | `MontoEstimado` (nombre de campo asumido de la documentación pública histórica, sin confirmar) |
| Garantías | no aplica en Compra Ágil | Licitaciones sí suelen exigir garantía de seriedad de la oferta y de fiel cumplimiento — campos `Garantia.*` asumidos, sin confirmar |
| Elegibilidad EMT | `convocatoria.estado_convocatoria` (1=primer llamado solo EMT) — filtro determinista verificado | No hay un campo equivalente confirmado; el tipo de licitación (`Tipo`: L1/LE/LP/LQ/LR/LS, según el monto en UTM) y la reserva MIPYME (Art. 20 Ley de Compras) son políticas a verificar, no un flag booleano simple como en Compra Ágil |

**Antes de confiar en el radar o el cotizador de licitaciones para una oferta real**, correr
`npm run radar-licitaciones` con un `LICITACIONES_API_TICKET` válido, guardar una ficha de ejemplo
cruda (`data/<codigo>/detalle.json`) y comparar campo por campo contra `licitaciones/src/lib/api.ts`
— exactamente el mismo proceso de verificación que ya se hizo para Compra Ágil (ver PLAN.md raíz,
sección "Hallazgos técnicos verificados").

## Arquitectura

Espejo de la de Compra Ágil (raíz), adaptada:

```
licitaciones/
  PLAN.md                    - este documento
  src/lib/
    api.ts                   - cliente de api.mercadopublico.cl (SIN VERIFICAR, ver arriba)
    keywords.ts               - variantes de búsqueda + verificación local (acá es descubrimiento primario)
    condiciones.ts            - tope, garantías, plazo, documentos exigidos, excluyentes
    config.ts, historial.ts, tiempo.ts, nombre-archivo.ts
    pricing.ts                - cotiza por catálogo de costos propio (no hay precio de lista externo)
    cotizacion-pptx.ts / cotizacion-html.ts / cotizacion-pdf.ts - misma plantilla visual de KeepSync
  config/
    keywords.json             - variantes de búsqueda de gestión documental/digitalización/oficina de partes
    company.json.example      - plantilla de costos reales (placeholders COMPLETAR)
  data/, output/               - igual que la raíz (gitignored salvo output/, ver .gitignore)

.claude/skills/
  radar_licitaciones/SKILL.md + scripts/{radar.ts, informe-nicho.ts}
  cotizar_licitaciones/SKILL.md + scripts/cotizar.ts
```

`cotizar_licitaciones` cubre solo el equivalente al "Paso 1" de `compra-agil-ofertar` (cotización).
El login al portal + llenado de formulario de una licitación (con firma electrónica, boletas de
garantía digitales, etc. — un flujo bastante más complejo que el de Compra Ágil) queda **fuera de
alcance de esta réplica**, no solo diferido: no se ha diseñado ni verificado. Si se necesita, es
un tercer skill futuro (`ofertar_licitaciones`) a diseñar aparte, con su propio reconocimiento del
formulario real del portal.

## Guardrails (idénticos en espíritu a los de Compra Ágil, ver `CLAUDE.md` raíz)

1. Sin envío automático — este dominio ni siquiera incluye el paso de formulario todavía.
2. Nunca cotizar por sobre el tope presupuestario (`MontoEstimado`, una vez verificado).
3. No inventar precios: sin `licitaciones/config/company.json` real (sin placeholders
   `COMPLETAR`), no hay cotización — el loader lo rechaza a propósito, igual que en la raíz.
4. No inventar la fórmula de negocio: `markup_pct`/`iva_pct` en `company.json.example` son un
   *default* razonable (fórmula estándar de una factura de servicios local), no una decisión de
   negocio ya validada con el usuario como sí lo fue la fórmula de doble IVA de licencias Claude —
   confirmarla antes de cotizar en serio.
5. Si un ítem de la licitación no mapea con confianza a una clave del catálogo de costos, o la
   cantidad no es clara, `cotizar.ts` se detiene y pide revisión manual — no adivina.

## Orden de trabajo pendiente

1. Obtener `LICITACIONES_API_TICKET` y correr `npm run radar-licitaciones` contra la API real;
   corregir los nombres de campo de `src/lib/api.ts` según la respuesta real (ver tabla de arriba).
2. Definir con el usuario qué plataforma(s) de gestión documental KeepSync puede efectivamente
   revender/implementar y a qué costo real; completar `licitaciones/config/company.json`.
3. Confirmar la fórmula de pricing (markup/IVA) para este negocio — puede no ser la misma que la
   de licencias Claude.
4. Correr `npm run cotizar-licitaciones -- <codigo>` contra una licitación real abierta y revisar
   manualmente el PDF/PPTX generado antes de considerar el flujo listo para uso real.
5. (Fuera de esta réplica) Diseñar `ofertar_licitaciones` si se decide automatizar también el
   llenado del formulario del portal de Licitaciones.
