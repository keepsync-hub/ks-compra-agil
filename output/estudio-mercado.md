# Estudio de mercado — Compras Ágiles y qué puede vender KeepSync

Generado: 2026-08-20T16:51:53.417Z. Medición en vivo contra `api2.mercadopublico.cl`,
regenerable con `npm run mercado` + `npm run estudio`.

Este informe existe para responder con datos una objeción que el propio repo se hace en
`PLAN-VOLUMEN.md`: *"elegir keywords a dedo es el método que produjo el nicho Claude (79% de
fracaso). Repetirlo con más palabras repite el error de selección."* Acá los criterios
candidatos salen de medir el mercado.

## 1. Qué se midió, y con qué exactitud

Tres estratos distintos, que **no se pueden mezclar en una misma afirmación**:

| Estrato | Qué da | Exactitud |
|---|---|---|
| **Dimensionamiento** (40 términos, 1 request c/u) | cuántas compras abiertas devuelve cada término | conteo **exacto** de la API, pero **cota superior contaminada** del tamaño real — se corrige por precisión en §3 |
| **Muestra sistemática** (625 compras) | composición del mercado, montos, organismos | **estimación** con error de muestreo declarado |
| **Dirigido** (272 compras de la lista corta) | montos y organismos de las familias que importan | **exacto** dentro de esa consulta, no extrapolable |

La muestra tomó las páginas 1, 15, 29, 44… hasta la 346 de 360.

## 2. El universo

| Estado | Compras | |
|---|---:|---|
| publicada | 8.980 |  |
| cerrada | ≥ 10.000 | **topeado por la API** |
| desierta | ≥ 10.000 | **topeado por la API** |
| cancelada | ≥ 10.000 | **topeado por la API** |
| proveedor_seleccionado | 0 |  |

**El tope importa.** La API no informa más de 10.000 resultados: `cerrada`, `desierta` y
`cancelada` devolvieron exactamente ese número las tres. No son 10.000 compras cada una —
son *al menos* 10.000, y el valor real es desconocido. Cualquier tasa calculada contra esos
números sería inventada, y por eso este informe no la calcula.

Aun así el orden de magnitud es claro: frente a **8.980** compras
abiertas hay **decenas de miles** ya terminadas. Mirar solo lo abierto —que es lo que hace el
radar hoy— es mirar una fracción pequeña y sesgada del mercado.

### Sesgo de supervivencia (el límite más serio de este informe)

El universo abierto incluye publicaciones desde 2025-11 que **siguen** en estado `publicada`.
Una Compra Ágil cierra en días, así que ese conjunto mezcla demanda viva con procesos que el
organismo nunca actualizó. Toda cifra del estrato muestral hereda ese sesgo. La sección 7
(desenlaces) lo esquiva midiendo directamente sobre estados terminales.

## 3. Dimensionamiento por término

1 request por término. `total_resultados` es el conteo exacto de lo que la API devuelve —
y **no** el tamaño de la familia. Los términos de **control** son rubros que KeepSync no
vende: están para que los números del grupo `keepsync` tengan con qué compararse.

### La corrección que cambia el ranking

El `q` de la API **no busca solo en el nombre: también en la descripción**, donde vive el
machaque administrativo de cualquier ficha. El efecto es brutal y se ve en los 10 nombres de
muestra que cada consulta trae gratis:

- `q=desarrollo` devuelve cientos de resultados y **ninguno** de sus nombres de muestra habla
  de desarrollo de nada: son galletas, mobiliario, guirnaldas decorativas, reactivos.
- `q=datos` los encabeza con *"Caja de Alimentos… se solicita completar todos los datos"*.
- `q=soporte` trae soportes de TV y de bicicletas.

Así que el conteo crudo es una **cota superior contaminada**. La columna `precisión` mide la
contaminación con los nombres que ya se trajeron —qué fracción de ellos contiene realmente el
término—, sin gastar un request más, y `≈ real` es el tamaño corregido. **El ranking válido es
el de `≈ real`**: ordenar por el crudo manda a paginar puro ruido, que es exactamente lo que
pasó en la primera corrida de este estudio.

| Término | Grupo | Crudo | Precisión | ≈ real |
|---|---|---:|---:|---:|
| `materiales` | control | 640 | 80.0% | 512 |
| `insumos` | control | 1.142 | 40.0% | 457 |
| `aseo` | control | 199 | 70.0% | 139 |
| `mantencion` | keepsync | 147 | 90.0% | 132 |
| `arriendo` | control | 122 | 100.0% | 122 |
| `taller` | keepsync | 147 | 70.0% | 103 |
| `curso` | keepsync | 126 | 80.0% | 101 |
| `reparacion` | control | 102 | 90.0% | 92 |
| `equipamiento` | control | 146 | 60.0% | 88 |
| `vestuario` | control | 78 | 100.0% | 78 |
| `mobiliario` | control | 81 | 90.0% | 73 |
| `transporte` | control | 182 | 40.0% | 73 |
| `medicamentos` | control | 189 | 30.0% | 57 |
| `datos` | keepsync | 562 | 10.0% | 56 |
| `sistema` | keepsync | 224 | 20.0% | 45 |
| `alimentacion` | control | 50 | 90.0% | 45 |
| `seguridad` | control | 225 | 20.0% | 45 |
| `capacitacion` | keepsync | 53 | 80.0% | 42 |
| `desarrollo` | keepsync | 356 | 10.0% | 36 |
| `ferreteria` | control | 30 | 100.0% | 30 |
| `licencias` | keepsync | 36 | 80.0% | 29 |
| `soporte` | keepsync | 57 | 50.0% | 29 |
| `plataforma` | keepsync | 64 | 40.0% | 26 |
| `software` | keepsync | 29 | 80.0% | 23 |
| `construccion` | control | 25 | 90.0% | 23 |
| `impresion` | control | 27 | 60.0% | 16 |
| `combustible` | control | 25 | 60.0% | 15 |
| `informatica` | keepsync | 15 | 80.0% | 12 |
| `diplomado` | keepsync | 10 | 90.0% | 9 |
| `asesoria` | keepsync | 6 | 100.0% | 6 |
| `inteligencia` | keepsync | 9 | 66.7% | 6 |
| `consultoria` | keepsync | 2 | 100.0% | 2 |
| `relatoria` | keepsync | 2 | 50.0% | 1 |
| `automatizacion` | keepsync | 1 | 100.0% | 1 |
| `ciberseguridad` | keepsync | 2 | 50.0% | 1 |
| `integracion` | keepsync | 1 | 100.0% | 1 |
| `digitalizacion` | keepsync | 1 | 0.0% | 0 |
| `analitica` | keepsync | 1 | 0.0% | 0 |
| `documental` | keepsync | **la API falló** | — | — |
| `chatbot` | keepsync | 0 | — | — |

Lo que KeepSync toca, ordenado por tamaño corregido: **mantencion** (≈132), **taller** (≈103), **curso** (≈101), **datos** (≈56), **sistema** (≈45), **capacitacion** (≈42).

> La precisión se estima sobre 10 nombres por término: es un orden de magnitud, no un decimal.
> Un término con precisión 0% no significa que no exista demanda — significa que **esa palabra
> no sirve como criterio de búsqueda**, que es justamente lo que este estudio tiene que decidir.

> **Quirk nuevo del endpoint.** `documental` devolvió
> `500 ERROR_INTERNO` de forma reproducible, sin contener la palabra suelta "de" ni ningún otro
> patrón conocido. Se registra como **no medido**, nunca como 0 — un 0 se leería como
> "no hay demanda", que es lo contrario de lo que sabemos.

## 4. Términos frecuentes, sin familias

Frecuencia no supervisada sobre los 625 nombres de la muestra: se cuenta en cuántas
compras **distintas** aparece cada n-grama, y se ordena por **monto**, no por conteo. Va antes de
las familias a propósito: la evidencia primero, la interpretación después.

| Término | Compras | Monto total | Mediana | Organismos |
|---|---:|---:|---:|---:|
| `insumos` | 43 | $77.424.979 | $1.031.000 | 37 |
| `materiales` | 43 | $52.511.946 | $690.000 | 41 |
| `escuela` | 29 | $47.577.202 | $1.000.000 | 25 |
| `mantencion` | 29 | $47.546.146 | $1.000.000 | 27 |
| `municipal` | 14 | $46.743.852 | $2.450.000 | 14 |
| `salud` | 20 | $39.863.600 | $1.114.000 | 19 |
| `mg` | 11 | $39.708.252 | $4.428.852 | 8 |
| `kit` | 14 | $37.128.000 | $730.000 | 12 |
| `instalacion` | 13 | $35.160.000 | $1.614.000 | 13 |
| `desarrollo` | 9 | $32.314.900 | $2.000.000 | 9 |
| `programa` | 27 | $31.877.391 | $500.000 | 23 |
| `regional` | 11 | $31.822.000 | $1.600.000 | 9 |
| `oficina` | 23 | $31.785.541 | $500.000 | 21 |
| `produccion` | 10 | $29.914.900 | $2.000.000 | 10 |
| `hospital` | 11 | $29.493.238 | $1.000.000 | 8 |
| `equipo` | 12 | $28.965.064 | $1.430.000 | 10 |
| `ml` | 6 | $27.764.900 | $6.000.000 | 5 |
| `capacitacion` | 13 | $27.118.040 | $1.880.000 | 12 |
| `proyecto` | 10 | $25.329.340 | $1.464.000 | 10 |
| `carabineros` | 6 | $24.449.049 | $4.367.825 | 6 |
| `reparacion` | 16 | $23.902.664 | $782.347 | 16 |
| `gestion` | 7 | $23.790.000 | $2.600.000 | 7 |
| `herramientas` | 8 | $22.549.340 | $1.650.000 | 8 |
| `dos` | 4 | $22.271.538 | $6.385.769 | 4 |
| `vehiculos` | 7 | $22.015.694 | $1.800.000 | 7 |

### Cuánto de este mercado es servicio y cuánto es bien físico

Los términos del *acto* de comprar se reportan aparte en vez de descartarse, porque el reparto
entre ellos es la primera pregunta de KeepSync:

| Término | Compras | Monto total |
|---|---:|---:|
| `adquisicion` | 152 | $270.915.618 |
| `servicio` | 76 | $198.249.770 |
| `compra` | 44 | $76.332.847 |
| `adq` | 15 | $28.321.763 |
| `suministro` | 6 | $28.164.900 |
| `contratacion` | 6 | $23.286.438 |
| `contratacion servicio` | 5 | $22.386.438 |
| `servicio suministro` | 2 | $13.800.000 |
| `arriendo` | 5 | $13.710.000 |
| `servicios` | 6 | $12.567.640 |

## 5. Familias

Derivadas de la sección 4, no al revés — cada una declara en `config/familias-mercado.json`
los términos medidos que la motivaron, y el cargador **falla si esa evidencia falta**.

| Familia | Capa | Compras en muestra | % del universo | Estimado | Monto en muestra | Mediana |
|---|---|---:|---:|---:|---:|---:|
| Insumos y materiales | gruesa | 119 | 19.0% ±3.0 | 1710 | $205.082.649 | $1.001.861 |
| Mantención y reparación | gruesa | 50 | 8.0% ±2.1 | 718 | $92.860.195 | $1.000.000 |
| Vestuario, mobiliario y equipamiento | gruesa | 37 | 5.9% ±1.8 | 532 | $47.200.130 | $750.000 |
| Aseo, higiene y seguridad | gruesa | 32 | 5.1% ±1.7 | 460 | $45.569.659 | $897.500 |
| Insumos clínicos y medicamentos | gruesa | 30 | 4.8% ±1.6 | 431 | $74.505.993 | $1.400.000 |
| Alimentación y catering | gruesa | 25 | 4.0% ±1.5 | 359 | $27.012.416 | $505.750 |
| Capacitación y formación | gruesa | 24 | 3.8% ±1.5 | 345 | $62.458.778 | $2.222.520 |
| Obras, transporte y combustible | gruesa | 21 | 3.4% ±1.4 | 302 | $38.924.567 | $900.000 |
| Eventos, difusión e impresión | gruesa | 9 | 1.4% ±0.9 | 129 | $27.220.000 | $2.000.000 |
| Licencias y software | gruesa | 4 | 0.6% ±0.6 | 57 | $14.159.000 | $3.565.000 |
| Datos, analítica e inteligencia artificial | fina | 3 | 0.5% ±0.5 | 43 | $14.669.000 | $6.020.000 |
| Capacitación en TI, datos e IA | fina | 2 | 0.3% ±0.4 | 29 | $7.820.000 | $3.910.000 |
| Servicios TI: desarrollo, integración, soporte y plataformas | gruesa | 1 | 0.2% ±0.3 | 14 | $100.000 | $100.000 |
| Asesoría y consultoría profesional | fina | 0 | 0.0% ±0.0 | 0 | $0 | — |
| Automatización de procesos y gestión documental | fina | 0 | 0.0% ±0.0 | 0 | $0 | — |

Las columnas `% del universo` y `Estimado` son **estimaciones muestrales** con su intervalo al
95%. No son conteos: para eso está la sección 3.

### Descartados por el filtro estricto

Compras que mencionaban la materia pero no pasaron `patron_requerido` o cayeron en
`patron_excluyente`. Se publican por el mismo motivo que en el radar: un patrón demasiado
ancho, si no se lista, se ve como demanda que desaparece sin explicación.

- `capacitacion:excluida` — 8
- `capacitacion-ti-datos:falta-requerido` — 6
- `automatizacion-documental:excluida` — 1
- `ti-licencias-software:excluida` — 1

### Montos exactos de la lista corta

Paginado completo de los términos de mayor tamaño corregido. **Exacto dentro de esa
consulta, y no extrapolable al universo**: es el estrato dirigido, no la muestra.

| Consulta | Compras | Monto total | p25 | Mediana | p75 | Organismos |
|---|---:|---:|---:|---:|---:|---:|
| `mantencion` | 93 | $227.997.717 | $600.000 | $1.503.803 | $3.736.600 | 65 |
| `taller` | 89 | $101.259.309 | $380.000 | $670.000 | $1.251.166 | 72 |
| `curso` | 90 | $149.402.344 | $600.000 | $1.100.000 | $2.075.000 | 69 |

## 6. Cobertura y residual

- Compras sin ninguna familia: **325 de 625** (52.0%)
- Monto sin ninguna familia: **54.3%** del total muestreado

Los términos con más peso entre lo no clasificado — la agenda de la próxima iteración, y el
contrapeso permanente a elegir familias a dedo:

| Término | Compras | Monto total |
|---|---:|---:|
| `kit` | 12 | $36.018.000 |
| `mg` | 10 | $35.279.400 |
| `escuela` | 20 | $31.762.091 |
| `instalacion` | 9 | $29.310.000 |
| `ml` | 6 | $27.764.900 |
| `respiratorio` | 3 | $21.000.000 |
| `panel` | 3 | $21.000.000 |
| `kit respiratorio` | 3 | $21.000.000 |
| `respiratorio panel` | 3 | $21.000.000 |
| `kit respiratorio panel` | 3 | $21.000.000 |
| `equipo` | 7 | $20.960.000 |
| `salud` | 11 | $20.096.700 |
| `desarrollo` | 4 | $19.214.900 |
| `municipal` | 6 | $18.830.000 |
| `implementacion` | 5 | $17.914.900 |

## 7. Desenlaces: qué se compra de verdad

Medido directamente sobre los estados terminales, así que **no arrastra el sesgo de
supervivencia** de las secciones anteriores. Es la métrica que fundó todo el análisis del
nicho Claude (79% de fracaso).

| Término | Cerradas | Desiertas | Canceladas | Tasa de éxito |
|---|---:|---:|---:|---:|
| `datos` | 3.840 | ≥10.000 | ≥10.000 | **no calculable** (tope) |
| `desarrollo` | 1.542 | 8.186 | 9.036 | 8.2% |
| `sistema` | 1.039 | 4.284 | 4.775 | 10.3% |
| `taller` | 532 | 3.893 | 3.150 | 7.0% |
| `mantencion` | 672 | 2.697 | 3.442 | 9.9% |
| `curso` | 389 | 2.225 | 2.526 | 7.6% |
| `capacitacion` | 166 | 1.015 | 1.075 | 7.4% |

Dos advertencias que esta tabla no puede resolver sola:

- **Arrastra la misma contaminación de la sección 3.** Un término de baja precisión mide el
  desenlace de un revoltijo de rubros, no el de su familia. Leer solo las filas cuyo término
  tiene precisión alta.
- **Donde el conteo llega al tope, la tasa no se puede calcular** y por eso no se publica: el
  denominador es desconocido.

### El hallazgo que corrige una hipótesis del repo

La tasa de éxito está entre **7% y 10% en todos los rubros medidos** — incluidos los que no
tienen nada que ver con tecnología: mantención de autoclaves, talleres de cestería,
reparaciones. `PLAN.md` y `CLAUDE.md` levantaron la hipótesis de que el ~79% de fracaso del
nicho Claude venía de un problema de **fulfillment** —que los oferentes no podían entregar
licencias legítimamente—. Esta medición no la sostiene: **el fracaso masivo es cómo se
comporta el instrumento entero**, no una patología del nicho de licencias.

Es coherente con lo que `PLAN-VOLUMEN.md` ya había encontrado clasificando los motivos
declarados: el 73% de los fracasos es atribuible al comprador (error, cambio de decisión,
vencimiento del plazo de selección) y solo el 16% a incumplimiento de la oferta. La
consecuencia práctica es la que ese documento ya saca: la palanca no es ofertar más, sino
elegir mejor y llegar primero a la republicación.

## 8. Competencia

De las 625 compras abiertas de la muestra, **112** (17.9%)
ya tienen al menos una oferta recibida. Entre ellas la mediana es de **2 ofertas**
(p25 1, p75 4).

**La mediana sobre toda la muestra sería 0 y no significaría nada**: una compra publicada hoy
todavía no recibió ofertas, y el listado de la API no distingue "nadie ofertó" de "aún no".
Por eso se informa el reparto y no un promedio suelto.

## 9. Cuánto sub-reporta clasificar solo por el nombre

El listado de la API **no trae `descripcion` ni productos**: clasificar cuesta 0 requests pero
solo ve el título. Se bajó el detalle de **20** compras para medir la brecha en vez de
solo advertirla:

- Clasificadas usando solo el `nombre`: **17 de 20**
- Clasificadas usando el texto completo (nombre + descripción + productos): **18 de 20**
- **Sub-reporte estimado: 5.6%** — toda cifra de familia de este informe es un piso, no un techo.

Códigos ONU/UNSPSC observados: 14111703, 14111704, 15111509, 23171603, 24101601, 27111508, 27111720, 27112802, 31162006, 31211501, 40141702, 40142317, 42251706, 42281508, 42281701, 42292603, 42294944, 43191501, 44103103, 44103116, 46191601, 47121701, 47121812, 47131502, 47131603, 47131803, 47131810, 47131816, 47131824, 49201503, 49221505, 49221508, 50192901, 52161512, 53101802, 53101804, 53121603, 53131608, 56112102, 60105704, 70121901, 72102305, 80141605. Es la taxonomía oficial de producto, hoy
sin explotar en el repo; con volumen suficiente permitiría clasificar sin regex.

## 10. Qué de esto puede vender KeepSync

> **Todo lo anterior se midió contra la API. Esta sección es juicio.** Los criterios y sus
> veredictos están en `config/keepsync-oferta.json`, con quién los emitió y cuándo. **No aparece
> ninguna cifra nueva acá**: todo número está localizable en las secciones 2 a 9.

KeepSync (leído de `keepsync.ai/services.json` el 2026-08-20) vende **servicios gestionados de
IA** en cuatro frentes —comercial y ventas, atención a clientes, administración y finanzas,
operaciones—: asistentes que operan dentro de las herramientas que la organización ya usa, con
despliegue en ≤30 días y operación continua. Es **más ancho** que los cinco nichos que el radar
busca hoy, que se limitan a licencias y cursos.

Los cuatro criterios (`config/keepsync-oferta.json`): **A** ¿lo cubre el catálogo?, **B** ¿se
entrega remoto en ≤30 días?, **C** ¿exige acreditación que no tiene?, **D** ¿hay costo conocido
para poner precio bajo el tope? — `servible = A ∧ B ∧ ¬C`, `ofertable = servible ∧ D`.

### Los dos insumos bloqueantes

1. **No existe catálogo de costos de servicios de KeepSync** (confirmado con el usuario el
   2026-08-20): ni valor hora de asesoría o relatoría, ni costo por proyecto, ni costo mensual de
   operación. Como `D = no` para todas las familias, **ninguna es ofertable hoy**, por grande que
   sea. Es el mismo tipo de insumo que mantiene marcadas PRELIMINAR a las cotizaciones de Array.
2. **No está confirmado si KeepSync es OTEC registrada en SENCE.** Condiciona la familia de
   capacitación entera — que es, según la sección 3, la de mayor volumen que KeepSync toca.

Mientras esos dos no se resuelvan, esto es **investigación de mercado**: dice dónde jugar, no
habilita ninguna oferta.

## 11. Metodología y límites

- **Sesgo de supervivencia**: el universo abierto sobre-representa procesos que nadie cerró (§2).
- **Clasificación por `nombre`**: cuantificada en §9, no solo advertida.
- **Error de muestreo**: publicado junto a cada estimación (§5). Ninguna afirmación exacta se
  apoya en la muestra.
- **Tope de 10.000** en `total_resultados`: los estados terminales son cotas inferiores (§2).
- **`q` hace OR de tokens y no busca la frase**, y no entra en los adjuntos: una compra que solo
  menciona la materia en un PDF no aparece en el dimensionamiento.
- **Techo de Compra Ágil**: 100 UTM ≈ $6,9M. Nada de este mercado es más grande que eso.
- **n junto a cada cifra**: muestra n=625, dirigidas n=272, detalles n=20.

_Generado por `npm run estudio` el 2026-08-20 — 0 requests: lee solo `historico/mercado.jsonl`._
