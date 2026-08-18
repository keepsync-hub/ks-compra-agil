# Diagnóstico de API — 2026-08-18T19:20:05.680Z

Corresponde a PLAN-VOLUMEN.md, Fase 0. Cada hallazgo es evidencia directa de la API, no una
suposición — pero es una medición de un solo momento; si la API cambia, repetir el diagnóstico.

## ✔ ¿`q` es opcional en /v2/compra-agil?

SÍ — HTTP 200, devolvió 10 ítem(s) sin `q`. Un barrido completo sin keywords es viable.

<details><summary>respuesta cruda</summary>

```json
{
  "success": "OK",
  "trace": null,
  "payload": {
    "items": [
      {
        "codigo": "3703-330-COT26",
        "nombre": "Servicio de Gasfitería",
        "estado": {
          "id_estado": 2,
          "codigo": "publicada",
          "glosa": "Publicada"
        },
        "convocatoria": {
          "estado_convocatoria": 1,
          "descripcion": "Primer llamado"
        },
        "documentos": [
          {
            "id": 1793159,
            "nombre": "ESPECIFICACIONES TÉCNICAS GASFITERIA.pdf"
          }
        ],
        "fechas": {
          "fecha_publicacion": "2026-08-18 15:14",
          "fecha_cierre": "2026-08-19 16:30",
          "fecha_ultimo_cambio": "2026-08-18T15:15:00.733Z",
          "fecha_cierre_primer_llamado": "2026-08-19T16:30:00Z",
          "fecha_cierre_segundo_llamado": "2026-08-20T17:45:39.253Z"
        },
        "montos": {
          "moneda": "CLP",
          "monto_disponible": 650000,
          "monto_disponible_clp": 650000
        },
        "institucion": {
          "organismo_comprador": "I MUNICIPALIDAD DE HUASCO",
          "rut": "69.030.700-6",
          "unidad_compra": "Finanzas",
          "region": 3,
          "nombre_region": "Región de Atacama "
        },
        "resumen": {
          "total_ofertas_recibidas": 0
        },
        "motivos": {
          "motivo_cancelacion": null,
          "motivo_desierta": null,
          "motivo_seleccion": null
        },
        "links": {
          "detalle": "/v2/
… (truncado, 16515 chars totales)
```

</details>

## ✔ ¿El payload del listado trae total/paginación?

SÍ — payload.paginacion = {"total_paginas":1,"numero_pagina":1,"tamano_pagina":4,"total_resultados":4}. Se puede leer el total exacto en 1 sola llamada, sin el request extra que hoy hace falta para confirmar la última página.

<details><summary>respuesta cruda</summary>

```json
{
  "success": "OK",
  "trace": null,
  "payload": {
    "items": [
      {
        "codigo": "1233595-38-COT26",
        "nombre": "Licencia Anthropic Claude Pro Mensual",
        "estado": {
          "id_estado": 2,
          "codigo": "publicada",
          "glosa": "Publicada"
        },
        "convocatoria": {
          "estado_convocatoria": 1,
          "descripcion": "Primer llamado"
        },
        "documentos": [
          {
            "id": 1793002,
            "nombre": "Requerimiento compra _Claude_CompraAgil.docx"
          }
        ],
        "fechas": {
          "fecha_publicacion": "2026-08-18 14:59",
          "fecha_cierre": "2026-08-19 15:30",
          "fecha_ultimo_cambio": "2026-08-18T15:00:00.260Z",
          "fecha_cierre_primer_llamado": "2026-08-19T15:30:00Z",
          "fecha_cierre_segundo_llamado": "2026-08-20T16:00:53.423Z"
        },
        "montos": {
          "moneda": "CLP",
          "monto_disponible": 1700000,
          "monto_disponible_clp": 1700000
        },
        "institucion": {
          "organismo_comprador": "CORPORACION MUNICIPAL DE DESARROLLO ECONOMICO CULTURA Y DEPORTES DE RE",
          "rut": "65.185.822-4",
          "unidad_compra": "Corporación  Municipal de Desarrollo Económico Cultural y Deportes de Renca",
          "region": 13,
          "nombre_region": "Región Metropolitana de Santiago"
        },
        "resumen": {
          "total_ofertas_recibidas": 0
        },
        "motivos": {
          "mot
… (truncado, 6546 chars totales)
```

</details>

## ✘ ¿La API acepta algún filtro de fecha?

Ninguno confirmado — `fecha_desde`: HTTP 400; `fecha_publicacion_desde`: HTTP 400; `fecha`: HTTP 400

## ✘ ¿El ticket clásico funciona contra licitaciones.json?

Falló: Falta LICITACIONES_API_TICKET en el entorno. Ponlo en .env (ver .env.example). Es un ticket DISTINTO de COMPRA_AGIL_API_TICKET: la API clásica de Licitaciones (api.mercadopublico.cl) usa su propio sistema de tickets, que se solicita en https://www.mercadopublico.cl/Home/Api (no sirve el ticket de Compra Ágil, que es para api2.mercadopublico.cl). Nunca lo hardcodees.

## ✘ ¿ordenescompra.json es alcanzable con el ticket clásico?

Falló: Falta LICITACIONES_API_TICKET en el entorno. Ponlo en .env (ver .env.example). Es un ticket DISTINTO de COMPRA_AGIL_API_TICKET: la API clásica de Licitaciones (api.mercadopublico.cl) usa su propio sistema de tickets, que se solicita en https://www.mercadopublico.cl/Home/Api (no sirve el ticket de Compra Ágil, que es para api2.mercadopublico.cl). Nunca lo hardcodees.

## ✘ Tamaño del universo de Compras Ágiles abiertas (sin filtro)

Falló sin completarse: The operation was aborted due to timeout
