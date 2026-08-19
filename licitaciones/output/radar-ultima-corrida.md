# Radar Licitaciones — Gestión Documental / Digitalización de Procesos / Oficina de Partes

Re-render desde caché: 2026-08-19T16:52:43.727Z

> Este radar corre contra la API real de Licitaciones (`api.mercadopublico.cl`), verificada en producción desde el 2026-08-19. Es de solo lectura: detectar no es cotizar, y ninguna oferta se envía sin que una persona la revise.
>
> Esta API **no expone los adjuntos ni las garantías** de la licitación (a diferencia de Compra Ágil): las bases administrativas —donde vive la exigencia de boleta de garantía— hay que leerlas en el portal antes de decidir si conviene ofertar.
>
> ⚠ Esta salida se regeneró desde las fichas ya guardadas en `licitaciones/data/`, **sin consultar la API** (`--desde-cache`). No hay detección nueva: puede haber licitaciones publicadas después de la última corrida real que no aparecen acá, y alguna de las listadas puede haber cerrado.

## Oportunidades detectadas (3)

### 1191449-18-LE26 — SERVICIO NACIONAL DEL PATRIMONIO CULTURAL
- SERVICIO DE DIGITALIZACIÓN DE DOCUMENTOS DEL GRUPO
- Cierre: 2026-08-28T20:00:00
- Tipo: LE
- Tope: $10.743.000 CLP (moneda: CLP)
- Plazo de contrato: 4 meses

### 4174-29-LE26 — Ilustre Municipalidad de Quirihue
- SISTEMA DE GESTIÓN DOCUMENTAL Y COMPLEMENTOS
- Cierre: 2026-08-21T15:00:00
- Tipo: LE
- Tope: $10.000.000 CLP (moneda: CLP)
- Plazo de contrato: 16 meses

### 5038-3-LE26 — I MUNICIPALIDAD RIO IBANEZ
- CONTRATACIÓN DE SERVICIO DE SISTEMA DE GESTIÓN DOCUMENTAL ATENCIÓN CIUDADANA FIRMA ELECTRÓNICA 
- Cierre: 2026-08-26T11:00:00
- Tipo: LE
- Tope: $20.000.000 CLP (moneda: CLP)
- Plazo de contrato: 12 meses

## Cobertura

Re-render de 3 ficha(s) en caché con cierre vigente. Para cobertura real correr `npm run radar-licitaciones` sin `--desde-cache` (requiere cuota disponible del ticket).