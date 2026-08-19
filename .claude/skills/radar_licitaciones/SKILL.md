---
name: radar_licitaciones
description: Monitorea Licitaciones públicas en mercadopublico.cl que piden servicios del catálogo de Array (array.cl) — oficina de partes electrónica, seguimiento de trámites, gestión documental y firma electrónica, RPA, business intelligence y plataformas de gestión de proyectos. Usar cuando el usuario pida revisar licitaciones nuevas de este tipo, correr el radar de licitaciones, o preguntar qué licitaciones de estos servicios están abiertas ahora mismo.
---

# Radar de Licitaciones — servicios de Array (array.cl)

Réplica de `compra-agil-radar-claude` (raíz) para un segundo nicho: **Licitaciones públicas** (no
Compra Ágil) contra la API clásica `api.mercadopublico.cl`, buscando el **catálogo de servicios de
[Array](http://www.array.cl/)** — el mismo nicho que `array-compras-agiles-radar` cubre en Compra
Ágil: oficina de partes electrónica, seguimiento de trámites, gestión documental y firma
electrónica, automatización de procesos (RPA), business intelligence y plataformas de gestión de
proyectos. No requiere credenciales del portal — solo el ticket de la API. No envía nada ni
requiere aprobación humana: es de solo lectura.

Las categorías, con su `patron_mencion` y su `patron_excluyente`, viven en
`licitaciones/config/keywords.json` (mismo contrato que `config/array-servicios.json`). Editar ese
archivo cambia lo que el radar busca: los patrones se compilan desde ahí, no están en el código.

## Estado: verificado contra producción, y sin gastar cuota (2026-08-19)

Este skill corrió contra fuentes reales y **ya no necesita la API con ticket para operar**. Se
reordenó después de medir que la cuota se agotaba antes de la primera ficha:

| Qué | De dónde sale hoy | Cuota |
|---|---|---|
| Descubrimiento (qué está abierto y menciona lo que buscamos) | buscador público del portal (`buscador-portal.ts`) | ninguna |
| Nombre y **descripción completos** | el CSV de ese buscador | ninguna |
| Organismo, tope, tipo, moneda, plazo de contrato, fechas | ficha pública de la licitación (`portal-ficha.ts` → `detalle-portal.ts`) | ninguna |
| Bases, garantías, criterios de evaluación, anexos exigidos, cláusulas excluyentes | las 9 secciones de esa misma ficha (`decision.ts`) | ninguna |
| Foro de preguntas + Excel oficial de preguntas y respuestas | portal | ninguna |
| Tramo de monto cuando el organismo no publica la cifra, y **cómo paga el comprador** (reclamos por pago no oportuno / compras de 12 meses) | buscador, consultado por código | ninguna |
| `CantidadReclamos` (total de reclamos al organismo, sin causa) | API con ticket, `--con-api` | 1 llamada por licitación |

Es decir: **la única razón que queda para gastar cuota es un dato que el portal ya entrega mejor
desglosado**. `--con-api` existe para contrastar, no para operar.

Lo demás que hay que saber para operarlo:

- El buscador del portal **sí filtra por texto en el servidor** (la API no puede) y devuelve la
  descripción completa. Su matching es laxo —"gestion documental" trajo 743 de 4.511 publicadas—,
  así que las consultas de `config/keywords.json` son el barrido grueso y la precisión la ponen
  `patron_mencion` / `patron_excluyente` localmente, sobre el texto completo.
- Los ARCHIVOS adjuntos siguen tras reCAPTCHA, y eso no bloquea: se entrega su URL, que es acceso
  suficiente (bajarlos con `npm run adjuntos-licitacion` es opcional y hay que correrlo desde la
  máquina del usuario) — ver "El objetivo estaba mal planteado" en `licitaciones/PLAN.md`.
- Al reportar oportunidades, citar la ficha de decisión (`licitaciones/data/<codigo>/decision.md`),
  no impresiones.
- La cuota del ticket sigue siendo escasa (se agota en la segunda corrida del día). Por eso el
  camino normal ya no la toca.

## Cuándo usar

- El usuario pide "correr el radar de licitaciones", "qué hay abierto de gestión documental /
  oficina de partes / RPA / BI / gestión de proyectos", o "licitaciones para los servicios de Array".
- Antes de armar una cotización con `cotizar_licitaciones`, para tener la ficha de decisión y las
  bases ya descargadas en `licitaciones/data/<codigo>/`.

## Requisitos

- **Ninguno para el camino normal**: no necesita ticket ni credenciales del portal.
- `LICITACIONES_API_TICKET` en `.env` **solo** si se va a usar `--con-api` (ver la tabla de arriba
  para saber qué agrega). Es un ticket distinto del `COMPRA_AGIL_API_TICKET`; se solicita en
  https://www.mercadopublico.cl/Home/Api.

## Cómo correrlo

```bash
npm run radar-licitaciones                    # corrida completa, cero cuota de API
npm run radar-licitaciones -- --max=20        # baja (o sube) el cap de licitaciones a procesar
npm run radar-licitaciones -- --con-api       # agrega la ficha de la API (gasta 1 llamada c/u)
npm run radar-licitaciones -- --desde-cache   # re-render de lo ya descargado, sin pedir nada
```

## Qué hace (`scripts/radar.ts`)

1. **Descubre por el buscador público del portal.** Una consulta por cada término de
   `consultas_portal` en `licitaciones/config/keywords.json` (14 en total). Cada consulta son dos
   requests: `Home/GenerarArchivo` y `Home/Descargar`, el mismo flujo del botón "Descargar
   resultados" del sitio, que entrega un CSV de hasta 1.000 filas con `IDLicitacion`,
   `NombreLicitacion`, `Tipo`, `Estado`, `FechaPublicacion`, `Descripcion`, `Moneda`,
   `TipoPresupuesto`, `TipoMonto`, `MontoLicitacion` y `Organismo`.

   Por qué esto reemplazó a la API: su listado nacional traía el `Nombre` **truncado a ~50
   caracteres** y **sin `Descripcion`**, y costaba cuota. El buscador entrega el texto completo,
   filtra en el servidor y no cuesta nada. El barrido crudo queda en
   `licitaciones/data/_busqueda-portal.json` para poder probar patrones nuevos sin volver a pedirlo.
2. **Confirma localmente** cada resultado con `patron_mencion` / `patron_excluyente` sobre nombre +
   descripción. Como el texto ya viene completo, **no hace falta pedir ninguna ficha para descartar
   un falso positivo** (con el listado de la API sí hacía falta, y cada descarte costaba cuota).
3. Por cada confirmada, **baja sus antecedentes del portal** (`antecedentes-pipeline.ts`, el mismo
   que usa `npm run antecedentes-licitacion`): las 9 secciones de las bases, el foro, el Excel
   oficial de preguntas y respuestas, el índice de documentos y la **ficha de decisión**
   (`decision.md` / `decision.json`: banderas con su cita, plazos, garantías, criterios de
   evaluación con su ponderación, anexos exigidos, cláusulas excluyentes).
4. Consulta el buscador **por el código** de cada una para dos datos que solo están ahí: el tramo
   de monto cuando el organismo no publica la cifra ("Entre 100 y 1000 UTM") y el comportamiento de
   pago del comprador (reclamos por pago no oportuno sobre compras de los últimos 12 meses).
   Queda en `licitaciones/data/<codigo>/buscador.json`.
5. Arma la ficha equivalente a la de la API con `detalle-portal.ts` y extrae condiciones con
   `condiciones.ts` (tope, tipo, plazo de contrato, documentos exigidos, frases excluyentes).
   Con `--con-api`, además pide la ficha a la API; si la cuota está agotada **no falla**: sigue con
   la del portal y lo declara en el reporte.
6. Actualiza `licitaciones/data/state.json` (códigos nuevos, organismos recompradores). La
   agrupación es por el `Comprador` de la ficha; si no hay identificador, no se afirma nada sobre
   recompra en vez de agrupar a ciegas.
7. Escribe `licitaciones/output/radar-ultima-corrida.md` y lo imprime en consola.
8. Refresca la grilla de `docs/licitaciones.html`.

   Solo se reemplaza el bloque entre los marcadores
   `<!-- OPORTUNIDADES:INICIO ... -->` y `<!-- OPORTUNIDADES:FIN -->`; fuera de ellos quedan la
   cabecera y el pie. Esa página **ya no lleva secciones de estado del proyecto** (insumos
   bloqueantes, diferencias con Compra Ágil, qué falta para operar): se eliminaron a pedido del
   usuario para que la página solo contenga lo que sirve para evaluar una licitación. Si los
   marcadores no están, el script avisa y deja la página intacta en vez de reescribirla. El
   generador vive en `licitaciones/src/lib/pagina.ts`.

   Cada tarjeta trae: código, organismo y unidad, la **descripción completa** del objeto licitado
   (el `Nombre` llega truncado en ambas fuentes), tope o tramo de monto, cierre con los días que
   faltan, tipo L1/LE/LP/…, plazo de contrato, garantía exigida, cierre de la ventana de preguntas,
   adjudicación estimada, cómo paga el organismo, región, **a qué servicio de Array corresponde**,
   las banderas de la ficha de decisión con su cita, los **criterios de evaluación con su
   ponderación** y los documentos publicados por el organismo. Se ordenan por cierre: primero lo
   que vence antes.

   Cada tarjeta omite las filas que la ficha no informa, en vez de imprimir "—": las licitaciones
   chicas traen pocos campos y la tarjeta no debe sugerir que el organismo declaró algo que no
   declaró. Cuando no hay tope publicado lo dice explícitamente en vez de mostrar `$0`.

   Una **corrida incompleta no publica**: si falla alguna consulta del buscador, alguna licitación
   se queda sin ficha o se alcanza el cap, el reporte se escribe igual pero la página se deja
   intacta. Publicar una grilla parcial borraría de la página oportunidades que siguen abiertas.

## Solo licitaciones abiertas

Este radar mira **solo lo que está publicado y recibiendo ofertas** (`idEstado=5` en el buscador).
El buscador acepta además cerradas, desiertas, adjudicadas y revocadas, así que reponer un informe
histórico del nicho **ya no depende de la cuota** —esa era la razón por la que se eliminó
`informe-nicho.ts`—, sino de decidir que vale la pena procesar ese volumen. Hoy no se hace.

Consecuencia a tener presente: de este nicho **no hay cifras históricas** (cuántas licitaciones de
estos servicios se declaran desiertas, quién se las adjudica, a qué precio). Lo que el radar
entrega es qué está abierto ahora, no una lectura del mercado. Si en algún momento esas cifras se
necesitan, primero hay que presupuestar la cuota — ver `buscarLicitacionesActivas` en
`licitaciones/src/lib/api.ts`.

## Notas

- Con `--con-api`, ante un 429 el script deja de consultar la API (no reintenta a ciegas) y sigue
  con la ficha pública: la corrida no se pierde. La API **no informa `Retry-After`** y cuánto rinde
  su cuota diaria sigue sin medirse — pero ya no condiciona el radar.
- El buscador del portal se consulta como lo hace su propia página, con sus mismos parámetros: no
  se falsifica nada ni se rodea ningún control. Los archivos adjuntos, que sí están tras un
  CAPTCHA, se siguen sin tocar.
- Este skill es de solo lectura. Para preparar una cotización usar `cotizar_licitaciones`, que sí
  requiere `licitaciones/config/company.json` con costos reales.
