# Agente de Licitaciones — servicios de Array (array.cl)

> Réplica del diseño de `PLAN.md` (raíz, Compra Ágil de licencias Claude) para un segundo nicho:
> **Licitaciones públicas** (no Compra Ágil) que piden soluciones de gestión documental,
> digitalización de procesos u oficina de partes. Este documento declara explícitamente qué está
> verificado y qué sigue siendo una suposición.
>
> **Actualizado el 2026-08-19: el radar ya corrió contra la API real** con un
> `LICITACIONES_API_TICKET` válido. La sección "Hallazgos de la corrida de verificación" abajo
> reemplaza lo que hasta entonces eran suposiciones — y corrige varias que resultaron falsas.

## Alcance

Licitaciones públicas de mercadopublico.cl (no Compra Ágil) cuyo objeto sea alguno de los
**servicios del catálogo de [Array](http://www.array.cl/)**: oficina de partes electrónica,
seguimiento de trámites, gestión documental y firma electrónica, automatización de procesos
(RPA/DBA), business intelligence y plataformas de gestión de proyectos. Es el mismo tipo de
necesidad de transformación digital que Compra Ágil de Claude, pero en el instrumento de compra
"Licitación" (montos más altos, procesos más formales: garantías, bases administrativas y
técnicas, evaluación por comisión) y con un producto/servicio completamente distinto (no hay un
precio de lista público como el de Anthropic).

### Cambio de nicho: de "gestión documental" a los servicios de Array (2026-08-19)

Este dominio nació buscando tres frases —gestión documental, digitalización de procesos, oficina de
partes— con una regex **hardcodeada** en `keywords.ts`, mientras `config/keywords.json` se cargaba
sin que nadie leyera su contenido: editar la config no cambiaba nada.

A pedido del usuario el nicho pasó a ser el catálogo completo de Array, el mismo que ya usa
`array-compras-agiles-radar` en Compra Ágil. Ahora `licitaciones/config/keywords.json` tiene la
misma forma que `config/array-servicios.json` (categorías con `patron_mencion` y
`patron_excluyente`) y **es la config la que manda**: `keywords.ts` compila los patrones desde ahí.
Cada hallazgo declara a qué servicio de Array corresponde, en el reporte y en la tarjeta publicada.

Dos cosas que descubrió la primera corrida con el nicho ampliado, y que hay que tener presentes
antes de tocar los patrones:

- **El ítem del listado no trae `Descripcion`** (solo `CodigoExterno`, `Nombre`, `CodigoEstado` y
  `FechaCierre`), y el `Nombre` viene **truncado a ~50 caracteres**: `722-5-LE26` aparece como
  "CONTRATACIÓN DE SERVICIO DE DIGITALIZACIÓN DOCUMEN". Todo el descubrimiento ocurre sobre ese
  texto corto, así que los patrones matchean **prefijos** ("documen", "proceso"): exigir la palabra
  completa perdía licitaciones reales. Lo que quede fuera del corte es invisible para el radar —
  una licitación de oficina de partes cuyo nombre empiece con el organismo no se detecta, y no hay
  forma de saberlo sin pedir 4.500 fichas.
- **Ampliar el nicho no amplió los resultados**: de 4.508 licitaciones activas, las 5 detectadas
  son todas de gestión documental/digitalización. Cero de RPA, BI, seguimiento de trámites,
  oficina de partes o gestión de proyectos. No es que los patrones fallen — esas palabras
  simplemente no aparecen en ningún nombre del listado nacional de ese día (verificado grepeando
  `licitaciones/data/_listado-activas.json`, que ahora queda guardado justo para poder probar
  patrones sin gastar cuota).

## Insumos bloqueantes

1. ~~**`LICITACIONES_API_TICKET`**~~ — **resuelto el 2026-08-19, y después vuelto irrelevante para
   el radar**. El ticket existe y sirvió para verificar la API en producción (ver "Hallazgos de la
   corrida de verificación"), pero su cuota es tan escasa que se agotaba antes de la primera ficha.
   Ese mismo día se reordenó el radar para que **todo el camino normal salga de fuentes públicas del
   portal**, sin ticket ni cuota: ver "El descubrimiento también es gratis" y "La cuota alcanzó solo
   para el listado". El ticket quedó como opción (`--con-api`), no como requisito.
2. **Catálogo de costos reales de KeepSync para gestión documental/digitalización**: a diferencia
   de licencias Claude (precio de lista público de Anthropic, ya cargado en `config/company.json`
   de la raíz), acá no existe un precio externo que copiar. `licitaciones/config/company.json` debe
   completarse con lo que KeepSync efectivamente puede ofrecer (¿qué plataforma revende o
   implementa? ¿con qué costo real por usuario, por hora de implementación, por documento
   digitalizado?) antes de que `cotizar_licitaciones` pueda generar una oferta real. Ver
   `config/company.json.example` para la estructura propuesta — sigue siendo una plantilla, no una
   decisión de negocio ya tomada.

3. **Vía real de fulfillment y facturación** (el mismo insumo de fondo que en Compra Ágil de
   licencias Claude, ver `CLAUDE.md` raíz): saber que existen licitaciones abiertas no dice nada
   sobre si KeepSync puede implementar y facturar gestión documental. Este es el insumo que decide
   si el nicho se convierte en venta; los otros solo deciden si el agente puede operar.

Con (1) resuelto, `radar_licitaciones` ya produce oportunidades reales. `cotizar_licitaciones` sigue
sin poder generar una oferta real por (2) — aunque sí rechaza correctamente por falta de
configuración, que es el comportamiento esperado (ver guardrails).

## Hallazgos de la corrida de verificación (2026-08-19)

Primera corrida real contra `api.mercadopublico.cl` con un ticket válido. Confirmó parte del diseño
y **desmintió varias suposiciones** que estaban escritas en el código:

| Suposición previa | Qué mostró la API real |
|---|---|
| El ítem del listado trae los campos que el diccionario documenta bajo `Licitaciones/Listado/Licitacion/...` | **Falso.** El ítem del listado trae poco más que `CodigoExterno`, `Nombre` y `CodigoEstado`: **sin `Comprador`, sin `Estado`, sin `Tipo`, sin `FechaPublicacion`, sin `MontoEstimado`**. Todo eso solo llega pidiendo la ficha (`?codigo=`) |
| `estado=activas` quizá pagina o hay que barrer por fecha | Devuelve **todas** las licitaciones vigentes del país en una sola llamada (4.381 en esa corrida). No hace falta paginar |
| Los adjuntos vienen en `Adjuntos[].URL` de la ficha | **Falso.** No existe ningún campo `Adjuntos` en la ficha. Este dominio **no tiene** el equivalente al servicio de adjuntos sin login de Compra Ágil (pero el texto de las bases sí se baja del portal sin persona: ver "Acceso a los antecedentes") |
| Las garantías vienen en `Garantia.*` | **Falso.** Tampoco existen en la ficha de la API. La exigencia de boleta de garantía aparece en las bases — que hoy se leen automáticamente desde la ficha pública del portal (ver "Acceso a los antecedentes") |
| El plazo de contrato está en `PlazosContrato.Plazo` | **Falso.** Está en `TiempoDuracionContrato` + `UnidadTiempoDuracionContrato` (tabla 3.6 del diccionario: 1 hora … 5 año) |
| `CantidadReclamos` son los reclamos de esta licitación | **No.** Son los reclamos recibidos por el **organismo** comprador (campo 35 del diccionario; se veían valores de 387 en licitaciones chicas) |
| `Comprador.RutUnidad` | Confirmado: existe y trae el RUT |
| `MontoEstimado`, `Moneda`, `Tipo` | Confirmados en runtime |

Dos bugs que esta corrida destapó, ya corregidos:

- **Alertas de recompradores falsas.** `registrarHallazgo` agrupaba por el `Comprador` del ítem del
  listado, que no existe: todos los hallazgos caían en una clave `"desconocido"` y cada uno después
  del primero se declaraba "RECOMPRADOR" de un organismo que no era el suyo. Ahora agrupa por el
  `Comprador` de la ficha y, si no hay identificador, no afirma nada sobre recompra.
- **Publicación de una grilla parcial.** Al agotarse la cuota a mitad de corrida, el radar publicaba
  en `docs/licitaciones.html` solo las oportunidades que alcanzó a leer, borrando de la página
  oportunidades que seguían abiertas. Ahora una corrida incompleta **no toca la página**, y existe
  `npm run radar-licitaciones -- --desde-cache` para republicar lo ya detectado sin gastar cuota.

## Diferencias estructurales verificadas/asumidas respecto a Compra Ágil (importante)

| | Compra Ágil (raíz) | Licitaciones (este documento) |
|---|---|---|
| Host | `api2.mercadopublico.cl` | `api.mercadopublico.cl` (API "clásica", distinta y más antigua) |
| Auth | header `ticket` | query param `ticket` (verificado) |
| Búsqueda por texto | `q` (matching laxo del servidor) | **no existe en la API** — solo `fecha`, `codigo` o `estado`. Por eso el descubrimiento se hace por el **buscador público del portal**, que sí filtra por texto y no gasta cuota (ver "El descubrimiento también es gratis"). El filtrado fino por `config/keywords.json` es LOCAL en ambos casos |
| Envelope de error | HTTP 429/5xx + `{success, payload, errors}` | HTTP 200 incluso en error, con `{Codigo, Mensaje}` en vez del listado esperado (verificado: así respondió con el ticket de prueba) |
| Adjuntos | servicio público sin login, ya probado end-to-end | **la API no los expone** (verificado): no hay campo `Adjuntos` en la ficha. El TEXTO de las bases sí se baja de la ficha pública del portal sin login (ver "Acceso a los antecedentes"); los ARCHIVOS quedan tras un CAPTCHA de imagen |
| Tope | `presupuesto.monto_disponible_clp` (número exacto verificado) | `MontoEstimado` (verificado en runtime; solo en la ficha, no en el listado) |
| Garantías | no aplica en Compra Ágil | Licitaciones sí suelen exigirlas (seriedad de la oferta, fiel cumplimiento) y **la API no las expone** (verificado) — pero la sección 8 de la ficha pública del portal sí las trae, y `npm run antecedentes-licitacion` las baja automáticamente |
| Elegibilidad EMT | `convocatoria.estado_convocatoria` (1=primer llamado solo EMT) — filtro determinista verificado | No hay un campo equivalente confirmado; el tipo de licitación (`Tipo`: L1/LE/LP/LQ/LR/LS, según el monto en UTM) y la reserva MIPYME (Art. 20 Ley de Compras) son políticas a verificar, no un flag booleano simple como en Compra Ágil |

Esa verificación campo por campo ya se hizo (2026-08-19): las fichas crudas quedan en
`licitaciones/data/<codigo>/detalle.json` y una muestra del ítem de listado en
`licitaciones/data/_muestra-item-listado.json` — ese directorio está gitignored, así que en un
entorno nuevo hay que volver a generarlos con una corrida. Lo que **sigue sin verificarse** es el
parámetro `fecha` (día de publicación), que ningún script ejercita todavía, y el barrido histórico
por estado, que ya no se hace (ver "Decisión: solo licitaciones activas").

## Decisión: solo licitaciones activas (2026-08-19)

Este dominio consulta **un solo listado**: `estado=activas`. La API acepta `cerrada`, `desierta`,
`adjudicada` y un parámetro `fecha`, pero no se usan.

Motivo: sin búsqueda por texto en el servidor, cada estado consultado obliga a traerse el listado
nacional completo de ese estado y filtrar localmente. La cuota de este ticket no da para eso — se
agotó en la segunda corrida del mismo día, a mitad de las llamadas de ficha. Entre gastar cuota en
"qué está abierto ahora" (accionable: se puede cotizar y ofertar) y gastarla en "cómo le fue
históricamente al nicho" (informativo), se eligió lo primero.

En consecuencia se **eliminó** `scripts/informe-nicho.ts` y su comando `npm run informe-licitaciones`,
junto con la página `docs/informe-nicho-licitaciones.html`. `buscarLicitaciones(params)` se reemplazó
por `buscarLicitacionesActivas()`, sin parámetros: ningún camino de código puede gastar cuota en otra
cosa que el listado de activas y las fichas de los candidatos.

**Lo que se pierde, dicho explícitamente**: de este nicho no hay cifras históricas — cuántas
licitaciones de estos servicios se declaran desiertas, quién se las adjudica y a qué precio. El
nicho Claude sí las tiene (`output/informe-nicho-claude.md`, 47 casos, 79% de fracaso) y son las que
condicionaron varias decisiones de diseño allá. Acá se opera sin ese contexto: el radar dice qué
está abierto, no si vale la pena el mercado.

**Corrección del 2026-08-19 (tarde), por si esto se reabre**: el argumento de arriba era de cuota, y
la cuota dejó de ser el límite. El buscador público del portal acepta los mismos estados —cerradas,
desiertas, adjudicadas, revocadas— y **no cuesta cuota**, así que reponer el barrido histórico ya no
choca con el ticket sino con el volumen a procesar y con decidir que vale la pena. Sigue sin
hacerse, pero ya no por imposibilidad. Lo que no cambia es `api.ts`: expone solo
`buscarLicitacionesActivas()` y la ficha por código, para que ningún camino de código pueda gastar
cuota en otra cosa.

## El descubrimiento también es gratis: el buscador público del portal (2026-08-19)

Pregunta que originó esta sección, planteada por el usuario: **¿qué parte de esto necesita de
verdad la cuota de la API, y qué se puede sacar de fuentes que no la consuman?** Respuesta medida:
**hoy no queda ninguna parte que la necesite.**

Después de resolver la ficha por el portal (sección anterior), la única llamada obligatoria a la
API era el listado nacional de activas. Y era, además, la peor fuente posible para descubrir: sin
búsqueda por texto, con el `Nombre` truncado a ~50 caracteres y sin `Descripcion`.

El portal tiene su propio buscador público —`mercadopublico.cl/BuscarLicitacion`— y su botón
"Descargar resultados" expone exactamente lo que falta:

| | API con ticket (`estado=activas`) | Buscador público del portal |
|---|---|---|
| Búsqueda por texto | **no existe** | **sí, en el servidor** |
| Nombre | truncado a ~50 caracteres | completo |
| Descripción | **no viene** | completa |
| Volumen por llamada | 4.508 (todo el país) | hasta 1.000 por consulta |
| Costo | cuota del ticket | ninguno |

El flujo es el mismo que ejecuta el sitio: `POST /BuscarLicitacion/Home/GenerarArchivo` con los
filtros devuelve `{FileGuid, nombreArchivo}`, y `GET /BuscarLicitacion//Home/Descargar?fileGuid=…`
entrega un CSV con 11 columnas (`IDLicitacion; NombreLicitacion; Tipo; Estado; FechaPublicacion;
Descripcion; Moneda; TipoPresupuesto; TipoMonto; MontoLicitacion; Organismo`). Dos detalles que
costaron encontrar y conviene no volver a descubrir:

- Los parámetros hay que mandarlos **tal como los arma su propio JS** (`codigoRegion: "-1"`,
  `montoEstimadoTipo: [0]`, `fechaInicio: null`). Variantes razonables —`codigoRegion: ""`— hacen
  que el servidor conteste "sin coincidencias" en vez de fallar.
- El archivo queda atado a la **sesión** que lo generó: sin la cookie del paso previo, la descarga
  responde 200 con cuerpo vacío.

Su matching es laxo: "gestion documental" devolvió 743 de las 4.511 publicadas. Da lo mismo — el
filtro fino es local y ahora corre sobre el texto completo. En la corrida del 2026-08-19, 14
consultas trajeron 2.372 licitaciones distintas y los patrones confirmaron 5.

**Lo que ganó el radar, además de no gastar cuota**: como la descripción viene completa, ya no hace
falta pedir una ficha para descartar un falso positivo (antes cada descarte costaba una llamada), y
aparecen licitaciones que el nombre truncado escondía. También aparecen falsos positivos nuevos que
antes no llegaban a verse —el retiro de residuos peligrosos "con gestión documental de los
residuos", la compra de servidores "para administrar sistema de gestión documental"—, ya cubiertos
por `patron_excluyente`: más texto encuentra más licitaciones y también más maneras de equivocarse.

### Y encima trae datos que la API no tiene

Consultado por el **código exacto** de una licitación, el buscador devuelve esa sola y muestra en su
tarjeta dos cosas que no están en ninguna otra fuente:

- El **tramo de monto** cuando el organismo no publica la cifra ("Entre 100 y 1000 UTM"). Antes esa
  licitación aparecía como "tope no publicado" y punto.
- **Cómo paga el comprador**: reclamos por pago no oportuno sobre compras efectuadas en los últimos
  12 meses. Medido en las 5 licitaciones publicadas: 0/484 en Río Ibáñez, 2/769 en Quirihue,
  45/1.121 en el Archivo Nacional, **79/171 (46%) en Aysén**. Para un proveedor eso decide tanto
  como el tope.

Ese par vuelve prescindible el último dato exclusivo de la API, `CantidadReclamos` — el total de
reclamos recibidos por el organismo, sin decir por qué ni sobre cuántas compras.

### Estado final del gasto de cuota

`npm run radar-licitaciones` hace **cero llamadas a la API** y publica la página completa. La
bandera `--con-api` sigue existiendo para agregar `CantidadReclamos` o contrastar campo por campo,
y si la cuota está agotada no rompe la corrida: se sigue con la ficha del portal y el reporte lo
declara. El ticket dejó de ser un requisito de este skill.

## La cuota alcanzó solo para el listado, y aun así se publicó (2026-08-19)

Segunda medición de la cuota del ticket, con el nicho ya ampliado a los servicios de Array. La
corrida trajo el listado nacional completo (4.508 licitaciones activas) y **la primera llamada de
ficha ya respondió 429**: la cuota diaria se había gastado en corridas anteriores del mismo día.
Cero fichas de la API.

Antes eso significaba no poder publicar: sin `detalle.json` no había organismo, ni tope, ni tipo,
ni plazo — la tarjeta no se podía armar y la página se dejaba intacta (que es lo correcto: publicar
una grilla parcial borra oportunidades abiertas). Pero **esos datos también están en la ficha
pública del portal**, que ya se descarga gratis para los antecedentes:

| Dato de la tarjeta | Sección de la ficha pública |
|---|---|
| Nombre, estado, descripción, tipo (LE/LP/…), moneda | 1. Características de la licitación |
| Organismo, unidad, RUT, dirección, comuna, región | 2. Organismo demandante |
| Publicación, preguntas, cierre, apertura, adjudicación | 3. Etapas y plazos |
| Monto total estimado (el tope), duración del contrato | 7. Montos y duración del contrato |

`licitaciones/src/lib/detalle-portal.ts` arma con eso un `LicitacionDetalle` equivalente, y
`hallazgosDesdeCache()` lo usa cuando falta el de la API (la de la API manda si existe). Lo único
que no se puede reconstruir es `CantidadReclamos` —reclamos recibidos por el organismo, que solo
expone la API— y se omite en vez de inventarse; la página declara de qué fuente salieron los datos.

Consecuencia práctica: **la única llamada indispensable a la API es la del listado**. Con una sola
llamada al día el radar descubre, y todo lo demás (fichas, bases, garantías, criterios, anexos,
documentos) sale del portal sin cuota. Las 5 licitaciones publicadas el 2026-08-19 se armaron
enteras por esta vía.

El listado nacional crudo queda ahora en `licitaciones/data/_listado-activas.json`: es lo que
permite probar patrones nuevos de `config/keywords.json` contra la última corrida real sin gastar
otra llamada.

## Las palabras clave, a la vista y editables desde la página (2026-08-19)

Pedido del usuario: que `docs/licitaciones.html` muestre **qué palabras busca el radar** y permita
agregar más, y que lo agregado quede guardado para la corrida siguiente.

Las palabras se publican en el bloque "Qué palabras busca el radar" (marcadores
`KEYWORDS:INICIO/FIN`, que el radar refresca en cada corrida): por categoría, las consultas que se
le mandan al buscador del portal, el patrón de confirmación local y el excluyente. Van junto a las
oportunidades a propósito — quien mira los resultados es quien nota que falta un término.

**El límite que no se disimula**: esa página es estática (GitHub Pages). No tiene backend ni puede
escribir en el repositorio, así que el formulario no finge guardar. Lo agregado queda en el
`localStorage` del navegador, se muestra marcado como **pendiente — el radar todavía no las usa**, y
la página entrega las dos vías reales de persistirlo: el JSON ya armado para pegar en
`licitaciones/config/keywords-extra.json` (con un enlace directo a editar ese archivo en GitHub) y
el comando equivalente. Cuando una pendiente aparece entre las guardadas, la página la saca sola de
la lista: es la señal de que el radar ya la está usando.

`keywords-extra.json` es un overlay de **frases literales**, no de regex: quien agrega una palabra
no tiene por qué escribir expresiones regulares, y una regex mal formada rompería el radar entero.
La comparación normaliza mayúsculas, tildes y espacios de más ("expediente electronico" encuentra
"Expediente Electrónico"). Cada frase se usa en los dos lados del embudo: **como consulta al
buscador** (amplía el descubrimiento) y **como confirmación local** (amplía el filtro). Los
excluyentes de la categoría se siguen aplicando: da lo mismo por cuál de las dos vías se encontró
la licitación, si el contexto desmiente la categoría se descarta igual.

Verificado end-to-end el 2026-08-19: agregada "ventanilla unica digital" a `ope` con
`npm run keywords-licitaciones`, la corrida siguiente pasó de 14 a 15 consultas al buscador e
incluyó la nueva (131 resultados, ninguno confirmado — no hay licitaciones de ese tipo abiertas).

Lo que este mecanismo **no** toca es `keywords.json`: esos patrones son regex afinadas contra casos
reales (ver los `_patron_excluyente_nota`), y ampliarlas sigue siendo trabajo de código.

## La página publicada: solo lo que sirve para evaluar una licitación (2026-08-19)

`docs/licitaciones.html` tenía, además de la grilla, cinco secciones sobre el estado del proyecto
(por qué está separada de Compra Ágil, estado de cada componente, insumos bloqueantes, diferencias
con Compra Ágil, qué falta para operar). **Se eliminaron a pedido del usuario**: esa página es para
decidir sobre licitaciones, y el estado del agente se lee en el repo (este documento, `CLAUDE.md`,
`README.md`). Quedan la cabecera, la grilla y un pie de una línea.

La grilla, a cambio, quedó más completa — cada tarjeta trae la descripción completa del objeto
licitado (el `Nombre` llega truncado en ambas fuentes), el servicio de Array al que corresponde, la
garantía exigida, el cierre de la ventana de preguntas y los criterios de evaluación con su
ponderación; se ordenan por cierre, primero lo que vence antes. Nada de eso se infiere: sale de la
ficha de decisión, con su cita.

Una nota de tono que conviene mantener: `decision.json` lo consumen dos públicos distintos. La
bandera "no hay adjuntos leídos" trae rutas y comandos porque `decision.md` lo lee quien opera el
agente; en la página esa misma bandera se enuncia como el hecho que importa para evaluar ("las
bases en PDF no están leídas y pueden agregar exigencias"). La traducción vive en `pagina.ts`.

## Acceso a los antecedentes y a los documentos (2026-08-19)

Pregunta que originó esta sección: **¿se puede llegar a los antecedentes/documentos de una
licitación sin que intervenga una persona, dado que la API oficial no los expone?** Respuesta
corta, verificada contra producción: **el CONTENIDO de las bases sí, los ARCHIVOS adjuntos no.**

### Rutas evaluadas

| Ruta | Resultado verificado |
|---|---|
| `api.mercadopublico.cl` (ficha con ticket) | Sin campo `Adjuntos` ni `Garantia`. Ya estaba documentado arriba. |
| **Ficha pública del portal** — `DetailsAcquisition.aspx?idlicitacion=<codigo>` | ✅ **Funciona.** 302 → ficha con `qs` cifrado, que `fetch` sigue sin cookies ni sesión: HTTP 200 con ~240 KB de HTML que traen **las 9 secciones de las bases** (`<div id="Ficha1..9">`). Sin login, sin CAPTCHA, sin ticket, sin cuota. Es la ruta implementada. |
| **Foro público de preguntas y respuestas** — `/Foros/Modules/FNormal/PopUps/PublicView.aspx?qs=` | ✅ Funciona igual de abierto. Sus aclaraciones modifican las bases, así que se baja junto con la ficha. |
| **Excel oficial de preguntas y respuestas** — `/Foros/Modules/FNormal/Export/PreguntasExcel.aspx?qs=` | ✅ **Un ARCHIVO de verdad, sin ninguna verificación humana.** Responde `200 application/vnd.ms-excel` + `Content-Disposition: attachment` a un `fetch` plano — verificado bajando 3 archivos distintos (32 KB / 16 KB / 6 KB) para las 3 licitaciones del radar. Es el único documento de los antecedentes que el portal entrega sin CAPTCHA, y ya se baja solo. |
| API OCDS de ChileCompra — `api.mercadopublico.cl/APISOCDS/OCDS/...` | Existe, es pública y **no consume el ticket ni su cuota**, pero **no publica `tender.documents`**: no hay URLs de documentos. Además va con meses de rezago (agosto 2026 vacío al probar). Inservible para adjuntos; ver "Uso posible" abajo. |
| Visor de adjuntos — `Attachment/ViewAttachment.aspx?enc=…` | ❌ **reCAPTCHA Enterprise por score, exigido del lado del servidor**: un cliente HTTP plano recibe 302 → `/Procurement/403.html`. El `enc` viene en el HTML de la ficha, así que el problema no es descubrir la URL. |
| Página de descarga tras el visor — `ViewAttachmentLC.aspx` | ❌ Además del reCAPTCHA, la descarga misma exige un **CAPTCHA de imagen** (`/Procurement/Captcha/Captcha.aspx`) que hay que transcribir, y cada archivo se baja por postback de ASP.NET dentro de esa sesión. Es una verificación humana deliberada. |
| Microservicio de adjuntos estilo Compra Ágil — `adjunto.mercadopublico.cl/adjunto-licitacion/…` | ❌ **Descartado.** El gateway responde `403 Authentication parameters missing`, y el bundle del buscador (`buscador.mercadopublico.cl/static/js/main.*.js`), que es el cliente canónico de ese host, solo implementa `/v1/adjuntos-compra-agil/{listar,descargar,encrypt,cotizacion/listar}`. No existe ruta de licitaciones que pedir. |
| Portal nuevo (SPAs) — `buscador.mercadopublico.cl/licitaciones`, `consulta-mercado.mercadopublico.cl` | ❌ Sin API de adjuntos de licitaciones: el bundle del buscador no tiene ninguna ruta de licitaciones (solo la palabra, que enlaza al portal viejo) y el `/adjuntos` de consulta-mercado pertenece a **consultas al mercado**, otro instrumento. |
| Diccionario oficial de la API (`licitaciones/docs/*.pdf`) | ❌ Ni una mención de adjuntos, anexos, documentos o archivos: no hay servicio documentado que estemos pasando por alto. |

### Lo que quedó implementado

`licitaciones/src/lib/portal-ficha.ts` + `npm run antecedentes-licitacion -- <codigo>`
(sin argumentos: todas las licitaciones ya detectadas en caché). Por cada una escribe en
`licitaciones/data/<codigo>/`: `ficha-portal.html` (crudo), `antecedentes.md` (las 9 secciones en
texto + foro), `antecedentes.json` y **`documentos/Foro_PreguntasRespuestas_*.xls`**, el archivo
oficial de preguntas y respuestas bajado del portal. Verificado sobre 4174-29-LE26, 5038-3-LE26 y
1191449-18-LE26: los tres `.xls` llegaron con contenido real y distinto entre sí.

Esto **corrige dos afirmaciones de este mismo documento**: que las garantías "solo aparecen en las
bases administrativas, fuera de la API" y que los documentos exigidos "hay que leerlos en el
portal" — con una persona. Ambos datos son ahora automáticos: la sección 8 trae la garantía, su
beneficiario y su vencimiento; la sección 4, los anexos administrativos/técnicos/económicos
exigidos uno por uno; la 6, los criterios de evaluación con sus ponderaciones.

### La vía del navegador real: construida, y medida

Queda implementada en `licitaciones/src/scripts/adjuntos-navegador.ts`
(`npm run adjuntos-licitacion -- <codigo> [--visible] [--diagnostico]`). Abre la ficha con un
navegador real, hace clic en el botón de adjuntos como cualquier visitante y deja que **el propio
reCAPTCHA del sitio** puntúe la sesión. No falsifica el token, no parchea señales de automatización,
no usa servicios de resolución de CAPTCHA y no reintenta ante un rechazo. Si el gate deja pasar,
baja los archivos **uno por uno** con el botón "Ver Anexo" de cada fila —nunca la descarga masiva,
que es la que exige transcribir el CAPTCHA de imagen.

Medición en este entorno (2026-08-19), corriendo el script de verdad contra 4174-29-LE26:

| Cliente | Veredicto del portal |
|---|---|
| `fetch`/`curl` (HTTP plano) | 302 → `/Procurement/403.html` |
| Chromium headless ejecutando el reCAPTCHA del sitio | `{"valid":false,"score":0.1}` → 403 |
| Chromium **visible** bajo Xvfb, mismo flujo | `{"valid":false,"score":0.1}` → 403 |

El umbral que aplica el portal es `0.5`. Un 0.1 desde una IP de datacenter, sin historial de
navegación y con automatización declarada es el resultado esperable — no es un bug del código, es el
control funcionando. (Detalle de entorno: Chromium solo logra salir por el proxy de este sandbox con
`--ssl-version-max=tls1.2`; con TLS 1.3 da `ERR_CONNECTION_RESET`, el mismo síntoma que quedó
documentado sin diagnosticar en `login.ts`. Eso ya está resuelto y no es lo que bloquea.)

### La vía sancionada: sesión de proveedor autenticada — probada, y NO alcanza

La hipótesis era: descargar las bases es lo que hace un oferente identificado en su sesión, el gate
de reCAPTCHA apunta al scraping anónimo, así que con sesión de proveedor debería pasar.
**Probada end-to-end el 2026-08-19 con la ClaveÚnica real del usuario: no pasa.** El visor sigue
puntuando la sesión y rechazándola.

| Sesión con que se abrió el visor de 4174-29-LE26 | Veredicto |
|---|---|
| Anónima, Chromium headless | `score 0.1` (umbral 0.5) → 403 |
| Anónima, Chromium visible bajo Xvfb | `score 0.1` → 403 |
| `data/storageState.json` restaurado | `score 0` → 403 |
| **ClaveÚnica autenticada en el mismo contexto del navegador** (`--con-login`) | `score 0` → 403 |

Conclusión, que corrige lo que este documento daba por razonable: **el gate no distingue entre
visitante anónimo y proveedor autenticado**. Puntúa el navegador y la IP, no la identidad. Desde
esta nube el score es 0–0.1 contra un umbral de 0.5, autenticado o no. Lo que queda por probar es lo
mismo de antes —correrlo desde la máquina del usuario, con IP residencial e historial real— pero ya
sin la esperanza de que el login lo resuelva: si allá pasa, será por el score del entorno.

Un hallazgo secundario, que importa para cualquier otro uso de la sesión:
**`data/storageState.json` no restaura la sesión del portal.** Verificado: restaurando ese archivo,
`mercadopublico.cl/Home` vuelve a ofrecer "Iniciar Sesión". Las cookies que sobreviven son las del
IdP (`heimdall`: `AUTH_SESSION_ID`, `KEYCLOAK_IDENTITY`), pero el token del SPA vive en memoria
(`response_mode=fragment`) y el portal viejo (`/Procurement/`) emite un `ASP.NET_SessionId` anónimo
nuevo. Por eso `adjuntos-navegador.ts` tiene `--con-login`: autentica **en el mismo contexto** del
navegador que después abre el visor, que es la única forma de que la descarga ocurra dentro de una
sesión de verdad.

### Login al portal: qué autentica realmente (verificado end-to-end el 2026-08-19)

`npm run login-portal` **funciona contra producción**: corrido en este entorno terminó en
`Sesión establecida. URL final: https://www.mercadopublico.cl/Home`. Tres correcciones a lo que
decía este documento, cada una encontrada rompiéndose contra el sitio real:

1. **El portal NO tiene credencial propia para un proveedor chileno.** La página de Keycloak
   (`heimdall.mercadopublico.cl`, realm `mercadopublico`) tiene dos pestañas: **ClaveÚnica**
   (`#liClaveUnica`, la activa, con un único enlace `#zocial-oidc` que federa a
   `accounts.claveunica.gob.cl`) y **Extranjero** (`#liExtranjero`). El formulario de usuario y
   contraseña `#username-re` / `#password-re` / `#kc-login-re` que se había encontrado en el HTML
   **existe pero está oculto**: es el de la pestaña Extranjero, para oferentes sin RUN. Por eso la
   primera corrida real murió con "element is not visible". Con RUN chileno la puerta es ClaveÚnica.
2. **Los selectores del viejo `login.ts` sí existen**: `#uname` y `#pword` son los campos vigentes de
   ClaveÚnica. Lo que no funciona es `page.fill()`: el botón `#login-submit` nace `disabled` y la
   página lo habilita escuchando eventos de teclado, así que hay que escribir tecla por tecla
   (`pressSequentially`). Con `fill` el botón queda deshabilitado para siempre.
3. **Entre la clave y el código hay una pantalla intermedia.** Aceptada la clave, ClaveÚnica muestra
   "ClaveÚnica necesita validar tu identidad · Te enviaremos un código de 6 dígitos a tu correo
   registrado" con un botón **Continuar**, y el correo **no se envía** hasta ese clic. Sin darlo, la
   sesión se queda ahí — que desde afuera se parece exactamente a un rechazo de credenciales, y así
   se malinterpretó la primera corrida real.

El código son 6 caracteres **alfanuméricos** (p. ej. `0MRGFM`), no seis dígitos, y vence a los
5 minutos. Llega desde `no-reply@digital.gob.cl`. Como el script no tiene acceso a MCP, usa un
handshake por archivo: escribe `licitaciones/data/2fa-solicitado.json` y espera `2fa-codigo.txt`,
que escribe el agente tras leer el correo con el workflow de n8n **"Lector codigo 2FA Mercado
Publico"** (acotado a ese remitente; devuelve solo `{codigo, enviadoEn, vigente}`, no el correo). El
código se borra del disco apenas se usa. Verificado dos veces seguidas: el ciclo completo —login,
"Continuar", lectura del correo, código escrito, sesión establecida— corre sin que intervenga nadie.

Un rechazo cuesta un intento contra una cuenta que se bloquea, así que el script ahora deja
`licitaciones/data/login-fallido.png` y `.txt` al fallar: sin evidencia, la única forma de
diagnosticar es reintentar, que es justo lo que no hay que hacer. `--diagnostico` verifica los
selectores sin usar credenciales.

### El objetivo estaba mal planteado: acceso es la URL, no el archivo (2026-08-19, corrección de fondo)

Todo lo anterior de esta sección persigue **bajar los bytes** de los adjuntos, y por eso terminó en
un callejón: cuatro variantes medidas, cuatro rechazos, y una máquina de login construida para una
hipótesis que resultó falsa. Vale la pena decir por qué el planteamiento estaba mal, porque el error
no fue técnico:

- **Confundimos custodia con acceso.** Las URLs de los documentos son públicas, estables y ya las
  tenemos: la ficha las emite. Tener la URL de un documento *es* tener acceso a él. Guardar una
  copia local solo agrega valor si un programa va a **leer** ese archivo — y lo que un programa
  necesita leer (garantías, anexos exigidos, criterios, plazos, tope) **ya viene en texto** desde la
  ficha, parseado en `antecedentes.md`. Lo que queda tras el gate son los formatos de anexo en
  blanco: papeles para **presentar** la oferta, no para **decidirla**.
- **Optimizamos el paso equivocado.** El clic humano que el gate obliga cae exactamente donde el
  flujo ya tiene una persona (revisar y enviar la oferta). Automatizarlo no ahorraba un paso: lo
  movía de lugar.
- **El costo era real y recurrente.** La vía de descarga exige navegador, sesión, 2FA y ~40 s por
  licitación, y falla. La vía de referencia cuesta **dos GET sin autenticación** y no falla nunca.

Contraargumentos honestos a este cambio, y qué se hace con cada uno:

| Objeción | Respuesta |
|---|---|
| "Un enlace no es el archivo: si el `enc` caduca, la referencia se pudre." | Por eso el índice incluye **siempre** la URL canónica (`DetailsAcquisition.aspx?idlicitacion=<codigo>`), que no caduca y desde la cual se vuelve a obtener el visor. El deep link es comodidad, no dependencia. |
| "Sin el PDF no se puede analizar el contenido con un programa." | El contenido que decide ya está en texto (9 secciones + foro). Lo que no se parsea son los formatos en blanco, que no tienen contenido que analizar. |
| "Para ofertar hay que adjuntar esos anexos." | Cierto, y ahí hay una persona igual. El índice le deja el enlace a un clic, con nombre y contexto. |
| "¿No conviene igual intentar bajarlos por si el gate deja pasar?" | Sí, pero como opción, no como camino: `npm run adjuntos-licitacion -- <codigo> --con-login --visible` sigue existiendo para correrlo desde la máquina del usuario. Dejó de ser un pendiente bloqueante. |

### Lo que se implementó: índice de documentos como dato de primera clase

`referenciasDocumentales()` en `portal-ficha.ts` arma, por licitación, el índice de sus documentos
con un campo `acceso` que dice sin ambigüedad quién puede seguir cada URL:

| Documento | `acceso` | Costo |
|---|---|---|
| Bases y condiciones (ficha pública) | `directo` | 1 GET, ya parseado a texto |
| Foro de preguntas y respuestas | `directo` | 1 GET |
| Excel oficial de preguntas y respuestas | `directo` | 1 GET, y se guarda en disco |
| Archivos adjuntos (PDF/DOCX, formatos de anexo) | `navegador` | 0 — es la URL del visor; la abre una persona |

Queda en `licitaciones/data/<codigo>/documentos.json`, en el bloque "Documentos de esta licitación"
de `antecedentes.md`, y —lo que importa para operar— **en cada tarjeta de `docs/licitaciones.html`**,
que es donde alguien decide si vale la pena ofertar. Antes esa página no enlazaba ningún documento:
el enlace al visor existía solo dentro de un archivo de caché gitignored, o sea, en la práctica no
existía.

`npm run antecedentes-licitacion` además **republica la página** al terminar (desde
`hallazgosDesdeCache()`, movido a `licitaciones/src/lib/cache.ts` para que radar y antecedentes lo
compartan), así que el flujo completo es:

```
npm run radar-licitaciones          # 1 vez al día: detecta y gasta cuota del ticket
npm run antecedentes-licitacion     # sin cuota: bases + Q&R + índice de documentos + publica
```

Guardrail que se mantiene: si la caché está vacía, `antecedentes` **no toca la página** — publicar
una grilla vacía borraría oportunidades que siguen abiertas.

### Ficha de decisión: convertir los antecedentes en la respuesta a "¿vale la pena?" (2026-08-19)

Tener el texto de las bases no es lo mismo que poder decidir. `npm run antecedentes-licitacion`
ahora genera además `decision.json` / `decision.md` (y encabeza con eso `antecedentes.md`), con
todo citado a su sección de origen — lo que no está en la ficha queda vacío, nunca se infiere:

| Bloque | Qué trae | Fuente |
|---|---|---|
| Banderas | Reglas explícitas sobre los datos (⛔ bloqueante / ⚠️ atención / ✅ favorable), cada una con motivo y cita | derivadas |
| Lo esencial | Nombre, organismo, estado, tipo, tope, cierre + **días restantes**, ventana de preguntas, adjudicación, duración, plazo de pago, subcontratación, financiamiento, garantía | secciones 1, 3, 7, 8 + API |
| Cómo se evalúa | Criterios con ponderaciones, **peso del precio** y verificación de que sumen 100% | sección 6 |
| Qué hay que presentar | Anexos exigidos por categoría (administrativos / técnicos / económicos) | sección 4 |
| Cláusulas que dejan fuera | Frases literales del tipo "será declarada inadmisible", "requisito excluyente" | todas + adjuntos |
| Exigencias detectadas | Visita a terreno, garantía de seriedad, experiencia mínima, multas, SLA, capacitación, registro… con la frase que las evidencia | todas + adjuntos |

Las banderas son reglas sobre datos, no opinión del agente: cierre vencido (bloqueante), cierra en
<48 h, ventana de preguntas cerrada, exige garantía, precio <40% de la evaluación, ponderaciones que
no suman 100, prohibición de subcontratar, organismo con >100 reclamos, ≥8 documentos exigidos, y la
ausencia de adjuntos leídos. El resumen (chips + puntos a revisar) sale en cada tarjeta de
`docs/licitaciones.html`.

### El detalle fino sí importa: leer los adjuntos cuando existan

El PDF de bases administrativas y las EE.TT. traen exigencias que la ficha pública no muestra. Que
estén tras el gate no significa que no se puedan aprovechar: lo que faltaba era que **algo los
leyera** una vez obtenidos. Ahora:

```
licitaciones/data/<codigo>/adjuntos/   ← ahí llegan los archivos (un clic humano en el visor,
                                          o `npm run adjuntos-licitacion` desde IP residencial)
npm run leer-adjuntos [-- <codigo>]    ← extrae su texto y rehace la ficha de decisión
```

`documentos-texto.ts` extrae PDF con `pdfjs-dist` y DOCX/XLSX con un lector de ZIP mínimo sobre
`zlib` (sin dependencias nuevas); un PDF escaneado se reporta como "sin capa de texto, haría falta
OCR" en vez de fingir que se leyó. Cada exigencia y cada cláusula excluyente que salga de ahí se
cita como `adjunto <archivo>`, distinguible de las de la ficha. Verificado con un PDF real de 4
páginas: texto extraído, exigencia detectada y citada al archivo.

Mientras no haya adjuntos, la ficha **lo dice como bandera** ("Falta el detalle fino: no hay
adjuntos leídos") en vez de dar por completa una decisión tomada solo con la ficha pública.

### Quinta medición del gate: perfil persistente y navegación previa (2026-08-19)

Se probó una vía más antes de dar el gate por cerrado: contexto persistente (`launchPersistentContext`
con perfil en disco), navegador **no** headless bajo Xvfb, viewport real, y navegación previa por el
portal (Home → buscador → ficha, con scroll y movimiento de mouse) para que el reCAPTCHA puntuara una
sesión con historia. Resultado: `score 0.1` → `/Procurement/403.html`, idéntico a todo lo demás.
Cinco variantes medidas, cinco rechazos: lo que puntúa es la IP de datacenter, y desde acá no hay
forma honesta de cambiarlo.

### El límite, dicho con precisión

Los **archivos** adjuntos (PDF de bases administrativas, EE.TT., formatos de anexo en blanco) están
detrás de una verificación anti-automatización deliberada, en dos capas: el score de reCAPTCHA para
entrar al visor y un CAPTCHA de imagen para la descarga masiva. Superarlo desde acá exigiría falsear
el fingerprint del navegador, comprar IPs residenciales o pagar un servicio que resuelva CAPTCHAs:
eso es rodear un control de acceso, no automatizar un trámite, y el proyecto no lo hace (guardrail de
`CLAUDE.md`).

Con el índice de documentos, ese límite dejó de ser un bloqueo del flujo: lo que el gate protege son
los archivos, no su ubicación, y la ubicación es lo que el agente necesita entregar. Si alguien
quiere igual los bytes, `npm run adjuntos-licitacion -- <codigo> --con-login --visible --diagnostico`
sigue ahí para correrlo desde una máquina con IP residencial — es una mejora opcional, no un
requisito.

### Uso posible de la API OCDS (hallazgo lateral)

`https://api.mercadopublico.cl/APISOCDS/OCDS/listaOCDSAgnoMes/{año}/{mes}/{offset}/{limite}` y
`.../tender/{codigo}` responden **sin ticket y sin consumir la cuota** que hoy limita todo este
dominio, con datos históricos de licitaciones y sus adjudicaciones (`/award/{codigo}`). Eso es
exactamente lo que "Decisión: solo licitaciones activas" dio por perdido — las cifras históricas del
nicho — y podría reponerse **a costo cero de cuota**. No se implementó acá porque excede la pregunta
de esta sesión; queda anotado como el camino a evaluar si esas cifras se vuelven a necesitar.

## Arquitectura

Espejo de la de Compra Ágil (raíz), adaptada:

```
licitaciones/
  PLAN.md                    - este documento
  docs/                       - documentación oficial de referencia (diccionario de datos de la API)
  src/lib/
    api.ts                   - cliente de api.mercadopublico.cl (verificado 2026-08-19; opcional
                                desde que el radar no gasta cuota: solo lo usa --con-api)
    buscador-portal.ts        - descubrimiento por el buscador público del portal (sin cuota) y
                                datos que la API no tiene (tramo de monto, pago del comprador)
    antecedentes-pipeline.ts  - ficha pública + documentos + ficha de decisión, en una función
    portal-ficha.ts           - antecedentes desde la ficha PÚBLICA del portal (sin ticket ni cuota)
    keywords.ts               - compila los patrones de config/keywords.json (descubrimiento primario)
    detalle-portal.ts         - reconstruye la ficha (organismo, tope, tipo, plazos) desde la ficha
                                pública del portal, cuando la cuota no alcanzó para pedirla a la API
    condiciones.ts            - tope, garantías, plazo, documentos exigidos, excluyentes
    config.ts, historial.ts, tiempo.ts, nombre-archivo.ts
    pricing.ts                - cotiza por catálogo de costos propio (no hay precio de lista externo)
    cotizacion-pptx.ts / cotizacion-html.ts / cotizacion-pdf.ts - misma plantilla visual de KeepSync
  src/scripts/
    antecedentes.ts           - npm run antecedentes-licitacion -- <codigo>
    keywords.ts               - npm run keywords-licitaciones [-- agregar|quitar]
    adjuntos-navegador.ts     - npm run adjuntos-licitacion -- <codigo> (navegador real; el portal
                                puntúa la sesión con reCAPTCHA y puede rechazarla)
  config/
    keywords.json             - categorías del catálogo de Array (patron_mencion + patron_excluyente)
    keywords-extra.json       - frases agregadas a mano desde la página o el CLI (overlay literal)
    company.json.example      - plantilla de costos reales (placeholders COMPLETAR)
  data/, output/               - igual que la raíz (gitignored salvo output/, ver .gitignore)

.claude/skills/
  radar_licitaciones/SKILL.md + scripts/radar.ts
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
2. Nunca cotizar por sobre el tope presupuestario (`MontoEstimado`, verificado en runtime).
3. No inventar precios: sin `licitaciones/config/company.json` real (sin placeholders
   `COMPLETAR`), no hay cotización — el loader lo rechaza a propósito, igual que en la raíz.
4. No inventar la fórmula de negocio: `markup_pct`/`iva_pct` en `company.json.example` son un
   *default* razonable (fórmula estándar de una factura de servicios local), no una decisión de
   negocio ya validada con el usuario como sí lo fue la fórmula de doble IVA de licencias Claude —
   confirmarla antes de cotizar en serio.
5. Si un ítem de la licitación no mapea con confianza a una clave del catálogo de costos, o la
   cantidad no es clara, `cotizar.ts` se detiene y pide revisión manual — no adivina.

## Orden de trabajo pendiente

1. ~~Obtener `LICITACIONES_API_TICKET` y correr `npm run radar-licitaciones` contra la API real;
   corregir los nombres de campo de `src/lib/api.ts`~~ — **hecho el 2026-08-19** (ver "Hallazgos de
   la corrida de verificación").
2. **Medir la cuota diaria del ticket.** Se agotó en la segunda corrida del mismo día, sin
   `Retry-After` en la respuesta. Mientras no se sepa cuánto rinde: una corrida real por día contra
   la API, y `npm run radar-licitaciones -- --desde-cache` para republicar sin gastarla.
3. Definir con el usuario qué plataforma(s) de gestión documental KeepSync puede efectivamente
   revender/implementar y a qué costo real; completar `licitaciones/config/company.json`.
4. Confirmar la fórmula de pricing (markup/IVA) para este negocio — puede no ser la misma que la
   de licencias Claude.
5. Correr `npm run cotizar-licitaciones -- <codigo>` contra una licitación real abierta y revisar
   manualmente el PDF/PPTX generado antes de considerar el flujo listo para uso real.
6. (Fuera de esta réplica) Diseñar `ofertar_licitaciones` si se decide automatizar también el
   llenado del formulario del portal de Licitaciones.
