# Radar Licitaciones — Servicios de Array (array.cl)

Re-render desde caché: 2026-08-19T17:18:56.241Z

> Este radar corre contra la API real de Licitaciones (`api.mercadopublico.cl`), verificada en producción desde el 2026-08-19. Es de solo lectura: detectar no es cotizar, y ninguna oferta se envía sin que una persona la revise.
>
>
> El nicho buscado es el catálogo de servicios de **Array** (array.cl): oficina de partes electrónica, seguimiento de trámites, gestión documental y firma electrónica, RPA, business intelligence y plataformas de gestión de proyectos. Los patrones viven en `licitaciones/config/keywords.json`.
>
> Esta API **no expone los adjuntos ni las garantías** de la licitación (a diferencia de Compra Ágil): eso sale de la ficha pública del portal con `npm run antecedentes-licitacion`, que no gasta cuota y deja la ficha de decisión de cada oportunidad.
>
> ⚠ Esta salida se regeneró desde las fichas ya guardadas en `licitaciones/data/`, **sin consultar la API** (`--desde-cache`). No hay detección nueva: puede haber licitaciones publicadas después de la última corrida real que no aparecen acá, y alguna de las listadas puede haber cerrado.

## Oportunidades detectadas (5)

### 1191449-18-LE26 — ARCHIVO NACIONAL
- SERVICIO DE DIGITALIZACIÓN DE DOCUMENTOS DEL GRUPO
- Servicio Array: Gestión Documental y Firma Electrónica
- Cierre: 2026-08-28T20:00:00
- Tipo: LE
- Tope: $10.743.000 CLP (moneda: CLP)
- Plazo de contrato: 4 meses

### 2713-159-LE26 — I MUNICIPALIDAD DE AYSEN
- DAF-informatica sevicio plataforma documental
- Servicio Array: Gestión Documental y Firma Electrónica
- Cierre: 2026-09-01T14:30:00
- Tipo: LE
- Tope: no publicado por el organismo
- Plazo de contrato: 48 meses

### 4174-29-LE26 — I MUNICIPALIDAD DE QUIRIHUE
- SISTEMA DE GESTIÓN DOCUMENTAL Y COMPLEMENTOS
- Servicio Array: Gestión Documental y Firma Electrónica
- Cierre: 2026-08-21T15:00:00
- Tipo: LE
- Tope: $10.000.000 CLP (moneda: CLP)
- Plazo de contrato: 16 meses

### 5038-3-LE26 — I MUNICIPALIDAD RIO IBANEZ
- CONTRATACIÓN DE SERVICIO DE SISTEMA DE GESTIÓN DOCUMENTAL ATENCIÓN CIUDADANA FIRMA ELECTRÓNICA
- Servicio Array: Gestión Documental y Firma Electrónica
- Cierre: 2026-08-26T11:00:00
- Tipo: LE
- Tope: $20.000.000 CLP (moneda: CLP)
- Plazo de contrato: 12 meses

### 722-5-LE26 — GOBIERNO REGIONAL DE LA ARAUCANIA
- CONTRATACIÓN DE SERVICIO DE DIGITALIZACIÓN DOCUMEN
- Servicio Array: Gestión Documental y Firma Electrónica
- Cierre: 2026-08-21T15:00:00
- Tipo: LE
- Tope: no publicado por el organismo

## Cobertura

Re-render de 5 ficha(s) en caché con cierre vigente. Para cobertura real correr `npm run radar-licitaciones` sin `--desde-cache` (requiere cuota disponible del ticket).