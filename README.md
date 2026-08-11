# ks-compra-agil

Agente que monitorea Compras Ágiles en mercadopublico.cl que piden licencias Claude/Anthropic,
prepara una cotización dentro del tope presupuestario, y deja lista una oferta (formulario +
adjunto) para revisión y envío manual de un humano.

Diseño completo y hallazgos verificados contra la API real: ver `PLAN.md`. Estado del insumo
bloqueante (fulfillment) y guardrails: ver `CLAUDE.md`.

## Setup

```bash
npm install
cp .env.example .env   # completar COMPRA_AGIL_API_TICKET (y CLAVE_UNICA_* si vas a ofertar)
cp config/company.json.example config/company.json   # completar RUT, razón social, contacto
```

`config/company.json` es secreto (gitignored) y el agente rechaza usarlo mientras tenga
placeholders `"COMPLETAR"` sin llenar. La sección `pricing` ya viene con la fórmula real
(precio público de Anthropic en USD → CLP con dólar observado en vivo → +5% margen → +19% IVA)
— solo faltan los datos de identidad de la empresa.

## Comandos

| Comando | Qué hace |
|---|---|
| `npm run radar` | Busca Compras Ágiles "Claude" abiertas, extrae condiciones, detecta recompradores. Solo lectura. |
| `npm run informe` | Regenera `output/informe-nicho-claude.md` con el barrido histórico completo (tasa de fracaso, motivos, recompradores). |
| `npm run cotizar -- <codigo>` | Genera la cotización (`.pptx`) para una compra específica, validando el tope. No envía nada. |
| `npx tsx .claude/skills/compra-agil-ofertar/scripts/login.ts --diagnostico` | Verifica si el portal es alcanzable desde el navegador headless antes de intentar login real. |
| `npm run form-fill -- <codigo>` | Completa el formulario de oferta en el portal y adjunta la cotización, sin enviar. Requiere login previo. |
| `npm run typecheck` | `tsc --noEmit`. |

## Estado y pendientes

- **Radar e informe del nicho: funcionando de punta a punta contra la API real** (probado en
  esta sesión: encuentra las oportunidades abiertas reales y reproduce la tasa de fracaso
  medida en `PLAN.md`, ~79-80%).
- **Cotización (`cotizar.ts`): funcionando de punta a punta**, probado generando un `.pptx` real
  y validado con el validador de esquema del skill `pptx`. Falta que `config/company.json`
  tenga los datos reales de identidad de KeepSync (RUT, razón social, dirección, representante
  legal, contacto) para poder cotizar en serio — hoy solo existe `company.json.example`.
- **Login + formulario (`login.ts`, `form-fill.ts`): sin verificar contra el DOM real.** En el
  entorno donde se escribió este código, tanto `claveunica.gob.cl` como `mercadopublico.cl`
  rechazaron la conexión de Chromium headless (`ERR_CONNECTION_RESET`) aunque `curl` sí
  conectaba — parece un bloqueo de fingerprint/WAF del portal. Los selectores están escritos
  con la mejor información disponible pero marcados `TODO(verificar en vivo)` donde no se
  pudieron confirmar. Correr el diagnóstico (`--diagnostico`) antes de depender de este flujo
  para una oferta real, y probar desde un entorno con navegador real si el bloqueo persiste.
