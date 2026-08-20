---
name: array-compras-agiles-radar
description: Busca Compras Ágiles publicadas en mercadopublico.cl asociadas a los servicios que ofrece Array (array.cl) — oficina de partes electrónica, gestión documental/firma electrónica, RPA/automatización, business intelligence y gestión de proyectos — y genera la página docs/array-compras-agiles.html. Usar cuando el usuario pida revisar oportunidades para Array o refrescar esa página.
---

# Radar de Compra Ágil — servicios tipo Array

Exploración de mercado, independiente del radar de licencias Claude de este mismo repo. Busca
Compras Ágiles publicadas que mencionen las líneas de negocio de Array (array.cl) contra la API
real `api2.mercadopublico.cl`, filtra localmente el ruido de la búsqueda laxa de la API, y
publica el resultado como página HTML en `docs/`. No requiere credenciales del portal, solo el
ticket de la API. Es de solo lectura — no cotiza ni ofrece nada.

## Cuándo usar

- El usuario pide "revisar compras ágiles para Array", "qué hay abierto de gestión documental /
  RPA / BI", o pide refrescar `docs/array-compras-agiles.html`.

## Requisitos

- `COMPRA_AGIL_API_TICKET` en el entorno (ver `.env.example` en la raíz del repo).

## Cómo correrlo

```bash
npm run array-radar
```

## Qué hace

1. Consulta `/v2/compra-agil` con `estado=publicada` para cada variante de búsqueda de cada
   categoría en `config/array-servicios.json` (oficina de partes, seguimiento de trámites,
   gestión documental/firma electrónica, RPA/automatización, business intelligence, gestión de
   proyectos), deduplicando por `codigo`.
2. Descarta ruido de `q` verificando localmente, con el `patron_mencion` de cada categoría, que
   `nombre` (lista) y luego `descripcion`/`productos_solicitados` (detalle) mencionen la
   categoría de verdad — mismo patrón que `src/lib/marca.ts` usa para Claude, generalizado en
   `src/lib/array-servicios.ts`.
3. Trae el detalle de cada código sobreviviente (`/v2/compra-agil/{codigo}`) para tope real
   (`presupuesto.monto_disponible_clp`), plazo de entrega, organismo y estado de convocatoria.
4. Guarda el resultado crudo en `data/array/compras-agiles.json` y un resumen en
   `output/array-compras-agiles.md`.
5. Genera `docs/array-compras-agiles.html` (mismo tema visual que `docs/index.html`) con las
   oportunidades abiertas agrupadas por categoría de servicio.

## Notas

- Esto es investigación de mercado para una empresa distinta (Array), no para KeepSync — no
  toca `config/company.json`, no cotiza y no está sujeto a los guardrails de oferta de
  `compra-agil-ofertar` (no hay oferta que enviar).
- La cuota de la API es diaria por ticket, compartida con el radar de Claude — si responde 429,
  el script se detiene y muestra el `Retry-After`.
- **Nota cruzada con el radar principal**: desde el 2026-08-20, `npm run radar` (nicho propio de
  KeepSync) **sí busca cursos y capacitaciones** — tiene categorías dedicadas a eso. Este radar los
  sigue excluyendo a propósito (`patron_excluyente` de `pmo`), porque acá lo que se busca es una
  *plataforma* de Array, no formación sobre ella. Los dos excluyentes dicen cosas opuestas y ambos
  están bien: son nichos distintos. No "corregir" uno para que se parezca al otro.
- Los patrones de categoría son intencionalmente específicos (nombres de sistema/plataforma tal
  como Array los describe en array.cl) para evitar ruido de términos genéricos como
  "automatización" o "gestión" solos.
- **Quirk verificado del endpoint `/v2/compra-agil`**: cualquier `q` que incluya la palabra
  suelta "de" (p.ej. "gestión de proyectos", "oficina de partes") responde consistentemente
  `500 ERROR_INTERNO` — reproducido en corridas repetidas, no es un fallo transitorio de
  gateway. Por eso `config/array-servicios.json` usa variantes sin "de" ("gestión proyectos",
  "oficina partes"): el buscador de la API es lo bastante laxo para encontrar igual los
  resultados relevantes sin esa palabra. Si se agregan variantes nuevas, evitar "de" suelto.
