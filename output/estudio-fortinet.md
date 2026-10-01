# Estudio: equipos Fortinet en Compra Ágil (2025–2026)

Generado el 2026-10-01 por `npm run estudio-fortinet` sobre la API de Compra Ágil (barrido del 2026-10-01). Pregunta: ¿conviene ofrecer por Compra Ágil el stock Fortinet del mayorista (FortiGate 40F→200G, FortiSwitch, FortiAP, transceptores FN-TRAN, FortiCare)?

**Cómo leer las cifras.** "Exitosa" = estado `cerrada` (la API nunca devuelve `proveedor_seleccionado`; mismo criterio que el radar de Kompu). La tasa se calcula sobre compras ya resueltas (sin contar las publicadas). El monto es el **tope** declarado, no lo adjudicado: la API no expone ganador ni precio. Ventana: compras publicadas desde el 2025-01-01; la API no devuelve nada anterior a fines de enero de 2025.

<!-- CONCLUSIONES:INICIO -->
## Conclusiones (escritas a mano el 2026-10-01; se conservan al regenerar)

**Veredicto: por Compra Ágil, Fortinet no es un negocio de volumen.** Vale como nicho oportunista
de bajo costo, con alerta en el radar, y no justifica comprar stock.

1. **La demanda es chica.** Hay 35 compras que nombran Fortinet o un SKU en 21 meses, unas 1,7 al
   mes, y 2026 viene más lento que 2025 (12 contra 23). La suma de topes es ~$144M, pero **solo 2
   terminaron cerradas**: tasa de éxito de 6%, bajo el 7–10% del instrumento y el 10–15% del
   hardware de Kompu. Lo que efectivamente se compró en el período suma ~$8M de tope.
2. **Casi no se compran equipos, se compran licencias y servicios.** De las 35, 15 son licencias o
   renovaciones (FortiCare/UTP, FortiToken, FortiAnalyzer) y 12 son servicios (migración,
   configuración, cursos). Del stock del mayorista solo aparecen el FG-40F (1 vez, con su licencia
   FC-10-0040F; cancelada), el FG-90G (1 vez, licencia UTP + equipo; cancelada por error de
   especificación) y transceptores SFP+ SR (3 veces). El FG-50G, 60F, 70G, 80F, 120G, 200G, los
   FortiSwitch 124F/124G/148F/1024E y los FortiAP 231K/441K **no aparecen nunca**.
3. **El tope de 100 UTM (~$7M) es la restricción que más pesa.** Varias compras se van al tope
   ($6,9M–$7,15M) y fracasan por eso: Segpres (`1051173-20-COT26`) se declaró desierta porque las
   cotizaciones superaban las 100 UTM, y Limache (FortiSwitch) dos veces por «superan presupuesto
   disponible». El FG-120G y el FG-200G con licencia difícilmente caben. Con su licencia anual, solo
   el rango 40F–90G cabe con holgura.
4. **La competencia es bajísima** (1,7 ofertas por compra) y los fracasos son mayoritariamente del
   comprador: cancelación automática por vencer el plazo de selección (5), error de especificación o
   duplicidad (5), y ofertas inadmisibles técnicamente (DIRECTEMAR tres veces seguidas). O sea, quien
   oferta correcto y dentro del tope tiene buenas chances. El problema es que hay muy pocas
   compras, no que haya mucha competencia.
5. **El mercado vecino es más grande pero no es Fortinet.** Por nombre, en 2025–2026 hay 150 compras
   de switch (~$303M de topes, mediana $1M), 72 de access point/WiFi y 29 de firewall sin marca
   Fortinet. Switch y WiFi tienen éxito de 6% y 3%, y son en su mayoría compras pequeñas y genéricas
   (switch de 8 puertos, AP para una escuela) donde un FortiSwitch o un FortiAP compite por precio
   contra TP-Link o Ubiquiti. El **firewall genérico** es el único segmento sano (21% de éxito: 6
   cerradas, 4 en septiembre de 2026), aunque varias de esas son *servicio* de firewall administrado,
   no venta de equipo. Ahí cabe un FG-40F/60F/80F + FortiCare como respuesta a «firewall o similar».

**Dónde está la oportunidad real, si se quiere tomar:**

- **Renovaciones de licencia (FortiCare/UTP, FortiToken, FortiAnalyzer)** de organismos que ya tienen
  Fortinet: se repiten cada año y el mismo organismo republica tras un fracaso (Subsecretaría del
  Deporte 3 veces, Limache, Tarapacá, San Esteban, DIRECTEMAR). El SKU `FC-10-0080F-950-02-12`
  de la lista es exactamente este producto. Abierta hoy: SENAMA `1300-182-COT26` (FortiToken Mobile
  100 usuarios, tope $6M).
- **Transceptores FN-TRAN**: es la única familia que cerró una compra en 2026 (MINVU
  `587-172-COT26`, 12 unidades SFP+ SR, $4M, 3 ofertas).
- **Firewall «o similar»** con FG-40F a 90G más licencia, por debajo de ~$6M.

**Lo que este estudio no mide y que decide el caso:** el Estado probablemente compra el grueso de
su hardware Fortinet por **Convenio Marco o licitación**, no por Compra Ágil (los montos de un
FortiGate mediano con licencia de 3 años superan las 100 UTM). Eso no está verificado acá. El paso
siguiente barato es correr las mismas palabras en el radar de licitaciones (`licitaciones/`, que no
gasta cuota). Tampoco se sabe a qué precio se adjudicó: la API no expone ganador ni monto.
<!-- CONCLUSIONES:FIN -->

## Resumen por segmento

| Segmento | Compras | 2025 | 2026 | Abiertas hoy | Cerradas (éxito) | Desiertas | Canceladas | Tasa éxito | Tope mediano | Suma de topes | Ofertas prom. |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| **Fortinet (marca o SKU)** | 35 | 23 | 12 | 2 | 2 | 13 | 18 | 6% | $4.000.000 | $143.921.648 | 1.7 |
| Firewall, otras marcas / sin marca | 29 | 16 | 13 | 0 | 6 | 13 | 10 | 21% | $2.244.340 | $100.317.627 | 1.2 |
| Switch de red | 150 | 93 | 57 | 5 | 8 | 61 | 76 | 6% | $1.015.000 | $302.947.435 | 2.3 |
| Access point / WiFi | 72 | 36 | 36 | 3 | 2 | 37 | 30 | 3% | $820.000 | $129.514.373 | 1.9 |
| Transceptores SFP | 15 | 10 | 5 | 0 | 0 | 7 | 8 | 0% | $700.000 | $33.344.258 | 2.5 |

Referencia: la tasa de éxito de Compra Ágil en todos los rubros medidos es 7–10% (`output/estudio-mercado.md`) y 10–15% en hardware TI de Kompu.

Switch, access point y transceptores se cuentan **por nombre** de la compra (con exclusión de ruido: consolas Nintendo, televisores, cámaras…), así que son el mercado de esos equipos de **cualquier** marca: es contra lo que compite un FortiSwitch o un FortiAP.

## Fortinet: las 35 compras

| Mes | Código | Compra | Organismo | Estado | Tope | Ofertas | Familia | Modelos citados |
|---|---|---|---|---|---:|---:|---|---|
| 2026-10 | `1300-182-COT26` | Adquisición e instalación de licencia FortiToken | SERVICIO NACIONAL DEL ADULTO MAYOR | publicada | $6.000.000 | 1 | licencia_soporte | — |
| 2026-09 | `587-178-COT26` | SELICO 459 CONFIGURACIÓN Y HABILITACIÓN MFA | SUBSECRETARIA DEL MINISTERIO DE LA VIVIENDA Y | publicada | $7.150.970 | 1 | servicio | — |
| 2026-09 | `587-172-COT26` | ADQUISICIÓN DE CONECTORES DE FIBRA ÓPTICA (SFP) DE 10GB SR PARA EQUIPOS DE NETWO | SUBSECRETARIA DEL MINISTERIO DE LA VIVIENDA Y | cerrada | $4.012.554 | 3 | transceptor | FN-TRAN-SFP+SR |
| 2026-08 | `3661-378-COT26` | SOLICITUD DE FIREWALL MARCA FORTINET | I MUNICIPALIDAD DE SAN ESTEBAN | cancelada | $7.000.000 | 4 | firewall | — |
| 2026-08 | `3661-350-COT26` | REQUERIMIENTO PROGRAMA FIREWALL | I MUNICIPALIDAD DE SAN ESTEBAN | cancelada | $7.000.000 | 1 | firewall | FG-100E |
| 2026-08 | `1480972-360-COT26` | LICENCIAS FIREWALL PARA EL ESTABLECIMIENTO EDUCACIONAL LICEO DE LIMACHE RBD 1464 | SLEP MARGA MARGA | cancelada | $3.681.000 | 1 | licencia_soporte | FG-90G |
| 2026-06 | `623663-60-COT26` | Renovación licencia FORTIGATE 2026-2027 | AGENCIA CHILENA DE EFICIENCIA ENERGETICA | desierta | $1.700.000 | 4 | licencia_soporte | — |
| 2026-03 | `2020-39-COT26` | ADQUISICIÓN DE LICENCIAS ANUALES PARA FIREWALL/IPS | Biblioteca del Congreso Nacional | desierta | $6.900.000 | 1 | licencia_soporte | FG-200F |
| 2026-03 | `3134-18-COT26` | MIGRACIÓN PLATSAFORMA EQUIPOS FORTINET | DIRECCION GENERAL DEL TERRITORIO MARITIMO Y M | desierta | $2.500.000 | 3 | servicio | — |
| 2026-03 | `3134-14-COT26` | MIGRACIÓN PLATAFORMA EQUIPOS FORTINET | DIRECCION GENERAL DEL TERRITORIO MARITIMO Y M | desierta | $2.500.000 | 1 | servicio | — |
| 2026-03 | `1051173-20-COT26` | RENOVACIÓN DE 2 LICENCIAS DE SOFTWARE FIREWALLS FORTIGATE FG200F | MINISTERIO SECRETARIA GENERAL DE LA PRESIDENC | desierta | $6.862.287 | 2 | licencia_soporte | FG-200F |
| 2026-02 | `3134-8-COT26` | MIGRACIÓN PLATAFORMA EQUIPOS FORTINET | DIRECCION GENERAL DEL TERRITORIO MARITIMO Y M | desierta | $2.500.000 | 2 | servicio | — |
| 2025-12 | `630-249-COT25` | 3 MÓDULOS FN-TRAN-SFP+SP | SUBSECRETARIA DEL TRABAJO | cancelada | $1.700.000 | 0 | transceptor | FN-TRAN-SFP+SP, FN-TRAN-SFP+SR, FG-600E |
| 2025-12 | `1450519-20-COT25` | BID - Adquisición de licencia FortiAnalyzer VM con soporte Forticare para la Sub | SUBSECRETARÍA DE SEGURIDAD PÚBLICA | cancelada | $6.600.000 | 3 | licencia_soporte | — |
| 2025-12 | `1447930-328-COT25` | SSP - Adquisición de licencia FortiAnalyzer VM con soporte Forticare para la Sub | SUBSECRETARIA DE SEGURIDAD PUBLICA | cancelada | $6.600.000 | 2 | licencia_soporte | — |
| 2025-11 | `1053139-155-COT25` | RENOVACIÓN DE LICENCIAS FORTINET PARA EL DITEC EN IQUIQUE | UNIVERSIDAD DE TARAPACA | desierta | $1.425.721 | 3 | licencia_soporte | — |
| 2025-11 | `1053139-160-COT25` | HARDWARE DE DISPOSITIVO DE SEGURIDAD CORTAFUEGOS Y LICENCIA FORTINET PARA EL DIT | UNIVERSIDAD DE TARAPACA | cancelada | $4.051.416 | 0 | licencia_soporte | — |
| 2025-11 | `4099-186-COT25` | Adquisición licencias UTP para equipo Fortigate 50E (serie E) con vigencia de 12 | I MUNICIPALIDAD DE MARIA PINTO | desierta | $450.000 | 1 | licencia_soporte | FG-50E |
| 2025-11 | `799595-152-COT25` | LA ADQUISICIÓN DE FORTITOKEN MOBILE PARA LA SUBSECRETARÍA DEL DEPORTE | SUBSECRETARIA DEL DEPORTE | desierta | $6.954.200 | 0 | licencia_soporte | — |
| 2025-11 | `799595-137-COT25` | ADQUISICIÓN DE FORTITOKEN MOBILE PARA LA SUBSECRETARÍA DEL DEPORTE | SUBSECRETARIA DEL DEPORTE | desierta | $4.200.000 | 5 | licencia_soporte | — |
| 2025-11 | `799595-155-COT25` | LA ADQUISICIÓN DE FORTITOKEN MOBILE PARA LA SUBSECRETARÍA DEL DEPORTE | SUBSECRETARIA DEL DEPORTE | cancelada | $6.954.200 | 1 | licencia_soporte | — |
| 2025-09 | `688-44-COT25` | Servicio especializado de assessment y remediación de su infraestructura perimet | OFICINA DE ESTUDIOS Y POLITICAS AGRARIAS | desierta | $6.920.000 | 1 | servicio | FG-600E |
| 2025-08 | `654478-180-COT25` | Curso Cerrado  Online Fortimanager para 3 personas | SUBSECRETARIA DE PREVENCION DEL DELITO | cancelada | $2.532.350 | 1 | servicio | — |
| 2025-08 | `2211-1154-COT25` | FORTISWITCH SOL 019 INFORMATICA | I MUNICIPALIDAD DE LIMACHE | desierta | $3.400.000 | 3 | switch | FS-424E-FIBER, FS-424E, FS-424W |
| 2025-08 | `4368-95-COT25` | Renovación Licencias Firewall Liceo de Limache/Escuela Mixta 88 | I MUNICIPALIDAD DE LIMACHE | cancelada | $4.000.000 | 0 | licencia_soporte | FG-100E |
| 2025-07 | `2211-1122-COT25` | FORTISWITCH SOL 019 INFORMATICA | I MUNICIPALIDAD DE LIMACHE | desierta | $2.300.000 | 3 | switch | FS-424E, FS-424W, FS-424E-FIBER |
| 2025-07 | `1592-47-COT25` | LICENCIAS: CISCO ENTERPRISE MERAKI, FORTICARE FORTINALYZER y PROJECT PLAN 3 | SUBSECRETARIA DE PREVISION SOCIAL | cancelada | $6.301.016 | 2 | licencia_soporte | — |
| 2025-05 | `728-33-COT25` | Servicio de Firewall | INSTITUTO NACIONAL DE HIDRAULICA | cancelada | $825.934 | 0 | servicio | FG-40F |
| 2025-04 | `1057541-247-COT25` | EL SST REQUIERE LA CONTRATACION DE SERVICIOS DE CAPACITACION PARA LA REALIZACION | DIRECCION SERVICIO DE SALUD TALCAHUANO | cancelada | $1.600.000 | 0 | servicio | — |
| 2025-03 | `1057541-213-COT25` | EL SST REQUIERE LA CONTRATACION DE SERVICIOS DE CAPACITACION PARA LA REALIZACION | DIRECCION SERVICIO DE SALUD TALCAHUANO | cancelada | $1.600.000 | 0 | servicio | — |
| 2025-03 | `4562-39-COT25` | SERVICIO DE INTERNET Y SERVICIO FIREWAL FORTINET | I MUNICIPALIDAD DE GRANEROS | cancelada | $3.100.000 | 0 | servicio | — |
| 2025-03 | `1155493-5-COT25` | BID- Adquisición de transceivers 10GBase-SR SFP+ compatibles con Fortinet | SUBSECRETARIA DEL INTERIOR | cancelada | $600.000 | 1 | transceptor | FN-TRAN-SFP+SR |
| 2025-03 | `1260-30-COT25` | ACCESS POINT, Fortinet FortiAP Access Points FAP-221E | GOBIERNO REGIONAL REGION METROPOLITANA | cancelada | $6.000.000 | 0 | access_point | FAP-221E |
| 2025-02 | `3594-104-COT25` | RENOVACIÓN PLAN DE SERVICIO STARLINK Y LICENCIAMIENTO FORTINET FORTIGATE 100F | I MUNICIPALIDAD DE PORTEZUELO | cerrada | $4.000.000 | 4 | servicio | FG-100F |
| 2025-02 | `3594-72-COT25` | RENOVACIÓN PLAN DE SERVICIO STARLINK Y LICENCIAMIENTO FORTINET FORTIGATE 100F | I MUNICIPALIDAD DE PORTEZUELO | cancelada | $4.000.000 | 5 | servicio | FG-100F |

### Qué se compra de Fortinet

| Familia | Compras | Cerradas | Tope mediano |
|---|---:|---:|---:|
| licencia_soporte | 15 | 0 | $6.000.000 |
| servicio | 12 | 1 | $2.516.175 |
| transceptor | 3 | 1 | $1.700.000 |
| firewall | 2 | 0 | $7.000.000 |
| switch | 2 | 0 | $2.850.000 |
| access_point | 1 | 0 | $6.000.000 |

### Por qué fracasaron (texto del organismo)

- `3661-378-COT26` (cancelada): contiene un error en la especificación del equipo solicitado 
- `3661-350-COT26` (cancelada): DUPLICIDAD DE COMPRA
- `1480972-360-COT26` (cancelada): Error en la especificación
- `623663-60-COT26` (desierta): Estimados proveedores. Se volverá a subir la compra. Saludos.
- `2020-39-COT26` (desierta): Se requiere la compra de las 2 licencias la empresa por monto solo oferto por 1.
- `3134-18-COT26` (desierta): SEGÚN INFORME TÉCNICO DEL DEPARTAMENTO DE TECNOLOGÍAS MARÍTIMAS N° 10000/31/2026, DECLARA OFERTAS INADMISIBLES, POR NO CUMPLIR CON LO SOLICITADO TÉCNICAMENTE.
- `3134-14-COT26` (desierta): Según informe Técnico del Departamento de Tecnologías Marítimas N° 10000/700/7/2026, de fecha 10 marzo de 2026, indica que oferente NO cumple con las especificaciones técnicas requeridas en el Anexo técnico levantado en 
- `1051173-20-COT26` (desierta): Considerando lo indicado por los proveedores en cuanto a que los valores ofertas corresponden a los señalados en las cotizaciones adjuntas a sus ofertas, y estos superan las 100 UTM.
- `3134-8-COT26` (desierta): De acuerdo a Informe Técnico del Departamento de Tecnologías Marítimas N° 10.000/700/14/2026, se declaran inadmisibles las ofertas recepcionadas.
- `630-249-COT25` (cancelada): Cambio en el requerimiento y monto 
- `1450519-20-COT25` (cancelada): Cancelada automáticamente por vencimiento del plazo de selección
- `1447930-328-COT25` (cancelada): Cancelada automáticamente por vencimiento del plazo de selección
- `1053139-155-COT25` (desierta): Se modificaran las especificaciones técnicas, por un incremento en el presupuesto y se emitirá una nueva solicitud de cotización
- `1053139-160-COT25` (cancelada): Se modificara el listado de productos y se emitirá una nueva solicitud.
- `4099-186-COT25` (desierta):  excede nuestro presupuesto establecido para dicha adquisición.
- `799595-152-COT25` (desierta): No se presentaron ofertas
- `799595-137-COT25` (desierta): Las ofertas no cumplen con lo requerido o superan el monto máximo establecido para la compra
- `799595-155-COT25` (cancelada): Cancelada automáticamente por vencimiento del plazo de selección
- `688-44-COT25` (desierta): El producto o servicio ofertado no cumple con las especificaciones solicitadas.
- `654478-180-COT25` (cancelada): Cancelada automáticamente por vencimiento del plazo de selección
- `2211-1154-COT25` (desierta): superan presupuesto disponible
- `4368-95-COT25` (cancelada): error en serial de firewalls, se volvera a subir
- `2211-1122-COT25` (desierta): SUPERAN PRESUPUESTO DISPONIBLE
- `1592-47-COT25` (cancelada): Cancelada automáticamente por vencimiento del plazo de selección
- `728-33-COT25` (cancelada): Error en requerimiento.
- `1057541-247-COT25` (cancelada): No se recibieron cotizaciones para esta Compra Ágil.
- `1057541-213-COT25` (cancelada): No se recibieron cotizaciones para esta Compra Ágil.
- `4562-39-COT25` (cancelada): SIN OFERENTES
- `1155493-5-COT25` (cancelada): Poveedor no cumple con la cotizacion solicitada, ni el monto disponible. Se subira un nuevo proceso de compra. 
- `1260-30-COT25` (cancelada): No se ingreso los proveedores 
- `3594-72-COT25` (cancelada): PROVEEDORES QUE INGRESAN OFERTA NO CUMPLEN CON EL GIRO DEL SERVICIO REQUERIDO O RELACIONADO. 

### Organismos que repiten (Fortinet + firewall)

- I MUNICIPALIDAD DE SAN ESTEBAN: 4 compras
- Academia Politécnica Naval: 4 compras
- DIRECCION GENERAL DEL TERRITORIO MARITIMO Y M.M.: 3 compras
- SUBSECRETARIA DEL DEPORTE: 3 compras
- I MUNICIPALIDAD DE LIMACHE: 3 compras
- INSTITUTO DE FOMENTO PESQUERO: 3 compras
- I MUNICIPALIDAD DE CHIGUAYANTE: 3 compras
- SUBSECRETARIA DEL MINISTERIO DE LA VIVIENDA Y URBANISMO: 2 compras
- UNIVERSIDAD DE TARAPACA: 2 compras
- DIRECCION SERVICIO DE SALUD TALCAHUANO: 2 compras
- I MUNICIPALIDAD DE PORTEZUELO: 2 compras
- SERVICIO DE SALUD BIO BIO: 2 compras
- I MUNICIPALIDAD DE LA GRANJA: 2 compras
- DIRECCION GENERAL DE AERONAUTICA CIVIL: 2 compras

## Qué marca pide el Estado cuando compra un firewall

Sobre 62 compras de firewall/Fortinet con detalle leído (nombre + descripción + productos). Una compra puede nombrar varias marcas; 31 no nombran ninguna.

| Marca | Compras que la nombran |
|---|---:|
| Fortinet | 31 |
| Ubiquiti / UniFi | 3 |
| Cisco / Meraki | 1 |

## Firewall sin Fortinet: las 29 compras

| Mes | Código | Compra | Estado | Tope | Ofertas | Marcas |
|---|---|---|---|---:|---:|---|
| 2026-09 | `3811-326-COT26` | SERVICIO DE CIBERSEGURIDAD, ADMINISTRACIÓN DE FIREWALL Y  PROTECCIÓN DEL SITIO W | cerrada | $6.100.000 | 8 | — |
| 2026-09 | `758004-79-COT26` | Adquisición de firewall | cerrada | $5.400.000 | 1 | — |
| 2026-09 | `1049-1635-COT26` | Administración y soporte Seguridad Perimetral del Firewall Central - IFOP VALPAR | cerrada | $1.200.000 | 2 | — |
| 2026-09 | `2771-535-COT26` | URGENTE SOPI N°637, SERVICIO POR 12 MESES SERVICIO DE FIREWALL Y SEGURIDAD PERIM | cerrada | $6.750.000 | 1 | — |
| 2026-09 | `2771-502-COT26` | SOPI N°637, SERVICIO POR 12 MESES SERVICIO DE FIREWALL Y SEGURIDAD PERIMETRAL, R | cerrada | $6.750.000 | 1 | — |
| 2026-09 | `1049-1633-COT26` | Administración y soporte Seguridad Perimetral del Firewall Central - IFOP VALPAR | cancelada | $1.200.000 | 0 | — |
| 2026-09 | `1049-1601-COT26` | Administración y soporte Seguridad Perimetral del Firewall Central - IFOP VALPAR | cancelada | $1.200.000 | 0 | — |
| 2026-08 | `3661-346-COT26` | SE REQUIERE FIREWALL SEGUN ESPECIFICACIONS ADJUNTAS AL MEMORANDUM | desierta | $7.000.000 | 3 | — |
| 2026-08 | `2771-478-COT26` | SOPI N°637, SERVICIO POR 15 MESES SERVICIO DE FIREWALL Y SEGURIDAD PERIMETRAL, R | cancelada | $6.750.000 | 1 | — |
| 2026-08 | `2580-87-COT26` | RENOVACIÓN DE SUSCRIPCIONES DE WEB APPLICATION FIREWALL (WAF) BITNINJA PARA SERV | cancelada | $550.000 | 0 | — |
| 2026-07 | `3661-334-COT26` | SE REQUIERE FIREWALL SEGUN ESPECIFICACIONS ADJUNTAS AL MEMORANDUM | desierta | $500.000 | 0 | — |
| 2026-04 | `3515-177-COT26` | COMPRA DE EQUIPO FIREWALL | desierta | $6.500.000 | 1 | — |
| 2026-04 | `3166-71-COT26` | ARTICULOS PARA UPS REDWAN Y FIREWALL (LAM CASMA) | cancelada | $790.517 | 2 | — |
| 2025-11 | `1057804-89-COT25` | “ADQUISICIÓN DE FIREWALL PARA COSAM” | desierta | $3.000.000 | 3 | — |
| 2025-11 | `1057804-72-COT25` | “ADQUISICIÓN DE FIREWALL PARA COSAM” | desierta | $1.100.000 | 0 | — |
| 2025-10 | `1057973-15-COT25` | Adquisición de Licencias para los Firewall Oficina inspecciones de obra del Proy | cancelada | $1.600.000 | 0 | — |
| 2025-09 | `5215-849-COT25` | SEGURIDAD FIREWALL | desierta | $1.800.000 | 1 | — |
| 2025-09 | `1602-118-COT25` | CONTRATACION DEL SERVICIO DE CONFIGURACIÓN DE FIREWALL DE APLICACIONES WEB / WAF | desierta | $6.890.100 | 1 | — |
| 2025-09 | `1602-117-COT25` | CONTRATACION DEL SERVICIO DE CONFIGURACIÓN DE FIREWALL DE APLICACIONES WEB / WAF | desierta | $6.890.100 | 0 | — |
| 2025-08 | `3047-312-COT25` | RENOVACIÓN DE LICENCIAS PARA INFORMATICA (FIREWALL) | desierta | $2.244.340 | 0 | — |
| 2025-08 | `3047-297-COT25` | RENOVACIÓN DE LICENCIAS PARA INFORMATICA (FIREWALL) | cancelada | $2.244.340 | 1 | — |
| 2025-07 | `3047-271-COT25` | RENOVACIÓN DE LICENCIA INFORMATICA (FIREWALL) | desierta | $2.244.340 | 1 | — |
| 2025-07 | `3047-264-COT25` | RENOVACIÓN DE LICENCIA INFORMATICAS (FIREWALL) | desierta | $2.244.340 | 0 | — |
| 2025-07 | `5215-687-COT25` | SEGURIDAD FIREWALL | cancelada | $1.800.000 | 1 | — |
| 2025-06 | `519302-46-COT25` | SOPORTE PARCIAL PARA 2 LICENCIAS FIREWALL Y 1 SOPORTE PARA LICENCIA ANALYZER | desierta | $5.581.500 | 2 | — |
| 2025-06 | `730566-25-COT25` | Análisis y Optimización Firewall | desierta | $4.000.000 | 0 | — |
| 2025-03 | `889473-355-COT25` | SC 3934 - Firewall perimetral | cerrada | $1.898.050 | 1 | — |
| 2025-03 | `1202333-3-COT25` | FIREWALL DE SEGURIDAD - ADMINISTRACION.. | cancelada | $2.560.000 | 0 | — |
| 2025-02 | `1233613-123-COT25` | ADQUISICIÓN DE ROUTER/FIREWALL EE PORVENIR | cancelada | $3.530.000 | 4 | — |

## Abiertas al momento del barrido

- [fortinet] `1300-182-COT26` — Adquisición e instalación de licencia FortiToken — SERVICIO NACIONAL DEL ADULTO MAYOR — tope $6.000.000
- [switch] `1953-393-COT26` — 501/ADQUISICIÓN E INSTALACIÓN DE RACK, SWITCH Y FIBRA ÓPTICA PARA HABILITAR CON RED DE DATOS EL CENTRO DE TRATAMIENTO Y ADICCIONES (CTA) DEL CP VALPARAÍSO//E1O2RT8 — Dirección Regional de Gendarmeria - Valparaiso — tope $3.500.000
- [switch] `4559-222-COT26` — SWITCH 8 PUERTOS — IMunicipalidad de Los Alamos - Dpto Salud — tope $30.000
- [switch] `3688-285-COT26` — 01 SWITCH -MEMO N°2892 — I MUNICIPALIDAD DE SALAMANCA — tope $500.000
- [switch] `5756-483-COT26` — Switch de comunicación de red - Solicitud 9580 — UNIVERSIDAD DE CHILE — tope $500.000
- [access_point] `3958-119-COT26` — Equipo de conectividad wifi helvetica — I MUNICIPALIDAD DE NAVIDAD — tope $561.000
- [access_point] `3712-489-COT26` — Puntos de Acceso WIFI. — I MUNICIPALIDAD DE LOS VILOS — tope $620.000
- [fortinet] `587-178-COT26` — SELICO 459 CONFIGURACIÓN Y HABILITACIÓN MFA — SUBSECRETARIA DEL MINISTERIO DE LA VIVIENDA Y URBANISMO — tope $7.150.970
- [switch] `3132-309-COT26` — ADQUSICIÓN DE SWITCH ALCATEL LUCENT OS 6360-P24 — DIRECCION DE SEGURIDAD Y OPERACIONES MARITIMAS — tope $1.100.000
- [access_point] `1461054-336-COT26` — Instalación de Enlace Inalámbrico Punto a Punto y Red Interior Wifi Escuela Jerónimo Godoy Villanueva — SERVICIO LOCAL DE EDUCACIÓN PÚBLICA DEL ELQUI — tope $4.000.000

## Totales crudos de la API (sin corte de fecha)

| Término | publicada | cerrada | desierta | cancelada |
|---|---:|---:|---:|---:|
| `fortinet` | 1 | 2 | 6 | 10 |
| `fortigate` | 0 | 1 | 6 | 6 |
| `fortiswitch` | 0 | 0 | 2 | 0 |
| `fortiap` | 0 | 0 | 0 | 1 |
| `forticare` | 0 | 0 | 1 | 3 |
| `fortianalyzer` | 0 | 0 | 0 | 2 |
| `fortitoken` | 1 | 0 | 2 | 1 |
| `firewall` | 0 | 6 | 20 | 21 |
| `cortafuego` | 1 | 0 | 4 | 8 |
| `sfp` | 0 | 1 | 13 | 17 |
| `switch` | 7 | 24 | 124 | 136 |
| `wifi` | 10 | 52 | 239 | 365 |

Los totales de `switch` y `wifi` incluyen ruido de la descripción (el `q` busca también ahí); la tabla de segmentos de arriba ya lo filtra por nombre.
