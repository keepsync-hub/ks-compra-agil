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
2. Verifica que la compra siga `publicada` y no haya cerrado.
3. Detecta el plan (Pro/Max 5x/Max 20x/Team) y la cantidad de usuarios desde el texto. Si no
   puede determinarlos con confianza, **se detiene y pide revisión manual** — no adivina.
4. Cotiza con `src/lib/pricing.ts`: precio público de Anthropic (USD) → CLP con el dólar
   observado en vivo (mindicador.cl, con fallback fijo en `company.json`) → +5% margen → +19%
   IVA (la fórmula exacta la definió el usuario, no está inventada).
5. **Si el total supera el tope presupuestario de la compra, no genera ninguna oferta** — lo
   reporta como inadmisible y se detiene. Esto no es negociable (ver `CLAUDE.md`).
6. Si cabe bajo el tope, genera `output/<codigo>/Q-AAAAMMDD-NombreCliente.pptx` — una
   propuesta comercial de 4 láminas (portada, solución, marco normativo Ley 21.180, cotización
   formal con la tabla de precios) siguiendo el formato de referencia del usuario. También
   guarda `cotizacion-resumen.json` con los números para el paso de formulario.

## Paso 2 — Login (una vez, reutilizable)

`scripts/login.ts` hace login a mercadopublico.cl vía ClaveÚnica + 2FA (el código lo lee el
agente desde Gmail vía `mcp__Gmail__*`) y guarda `data/storageState.json` para no repetir login
en cada corrida.

**Estado conocido**: en el entorno donde se escribió este skill, tanto `claveunica.gob.cl` como
`mercadopublico.cl` devolvieron `ERR_CONNECTION_RESET` a Chromium headless (mientras que `curl`
con el mismo User-Agent sí conectó) — parece un bloqueo de fingerprint/WAF del portal, no un bug
del script. Antes de usarlo: `npx tsx .claude/skills/compra-agil-ofertar/scripts/login.ts
--diagnostico` para confirmar que el portal es alcanzable desde el entorno actual. Si sigue
bloqueado, es un caso de "bloqueo del portal" → **detenerse y pedir intervención humana** (no
reintentar a ciegas), y considerar correr este skill desde un entorno con navegador real en vez
de este sandbox.

Los selectores de ClaveÚnica y del formulario de oferta (`login.ts`, `form-fill.ts`) están
marcados `TODO(verificar en vivo)` donde no se pudieron confirmar contra el DOM real por el
mismo bloqueo — revisarlos la primera vez con `page.pause()` en modo no-headless antes de
confiar en una corrida desatendida.

## Paso 3 — Formulario (sin enviar)

```bash
npx tsx .claude/skills/compra-agil-ofertar/scripts/form-fill.ts <codigo>
```

Completa el formulario de oferta con los datos de `cotizacion-resumen.json` y adjunta el
`.pptx` generado en el paso 1. Guarda `output/<codigo>/formulario-listo.png`. **Nunca busca ni
hace click en un botón de enviar/confirmar** — ese es el punto de entrega a un humano.

## Guardrails (no negociables)

1. Nunca se envía nada automáticamente.
2. Nunca se cotiza por sobre el tope presupuestario.
3. No se inventan precios: sin `config/company.json` real, no hay cotización.
4. CAPTCHA o bloqueo del portal → detenerse, avisar, no reintentar a ciegas.
