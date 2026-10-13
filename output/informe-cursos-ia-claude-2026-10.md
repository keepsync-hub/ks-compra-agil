# Cursos de IA y Claude en Compra Ágil — análisis de los últimos 3 meses

**Ventana:** 2026-07-13 → 2026-10-13 · **Generado:** 2026-10-13 · **Dataset:** `output/cursos-ia-adjudicaciones-2026-07-13_2026-10-13.csv`

## Resumen

1. **Se adjudicaron 59 cursos de IA en Compra Ágil en 3 meses, por $129,9 millones** (mediana $1,44M por
   curso). La demanda va en aumento: 26 órdenes en septiembre y 14 en los primeros 13 días de octubre.
2. **Cursos específicamente de Claude son pocos: 3 de 59.** Dos lo tienen como tema central:
   Carabineros (Análisis Criminal) con *«uso del asistente de IA generativa Claude aplicado al análisis
   de datos»*, adjudicado a Capacitación Easylit en $720.000, y MOP Planeamiento con *«IA Generativa,
   uso Claude y transformación digital»*, adjudicado a RIGROUP Academy en $2.000.000. El tercero es
   CONAF Coquimbo, donde Claude aparece en el temario. La mayoría de las compras piden «IA generativa»
   sin nombrar herramienta, y cuando la nombran suele ser Copilot o ChatGPT.
3. **El mercado está atomizado: 39 proveedores distintos en 59 órdenes**, y ninguno gana más de 4. Ganan
   OTEC y capacitadoras (22), consultoras (19), universidades (9) y fundaciones (9).
4. **El ganador típico cobra el 67% del tope** (mediana de 19 casos en que se conoce el tope; rango
   23%–100%). **En 16 de esos 19, el ganador cotizó bajo el 90% del tope.** Ese 90% es la regla que hoy
   usa `cotizar-capacitacion`, así que con ella KeepSync habría quedado más caro que el ganador en casi
   todas.
5. **Lo que más decide es la admisibilidad documental, no el temario.** En los 20 TDR de cursos de IA
   que tiene `config/capacitaciones.json`, 16 exigen el título del relator/a y unos 17 piden acreditar
   con documentos los cursos ya dictados (órdenes de compra, certificados o cartas). Cuando la pauta
   premia credenciales o se exige ser una institución, gana una universidad: la PUC se llevó los tres
   cursos de Cochilco y el de Carabineros.

## De dónde salen los datos

- **Quién ganó y a qué precio:** API pública de Órdenes de Compra de mercadopublico.cl (ticket
  clásico). Se bajaron 94 listados diarios con **236.169 OC únicas de Compra Ágil** (sufijo `AG26`). Se
  filtraron las que nombran curso o capacitación junto con IA o Claude, más las de nombre genérico cuyo
  código COT ya estaba en el índice del repo. Para las **134 candidatas** se bajó el detalle completo
  (proveedor, RUT, monto, ítems). La lista se depuró a mano: quedaron fuera falsos positivos como coffee
  breaks para seminarios de IA, ganadería «regenerativa», «Unidad I.A.T.» de Carabineros, la herramienta
  Cursor y un curso de Power BI del MOP.
- **Requisitos:** los 20 TDR de cursos de IA ya leídos y fichados en `config/capacitaciones.json`
  (tanda 2026-08-22 a 2026-09-28).
- **Topes y N° de ofertas:** índice local (`historico/observaciones.jsonl` y
  `docs/capacitaciones-cotizaciones/index.json`).

**Límites que hay que tener presentes:**

- **Es un piso, no un conteo exacto.** El 23% de las OC de Compra Ágil se llama solo «Orden de Compra
  generada por invitación a compra ágil: XXX-COT26», sin decir qué compra. Esas solo se recuperaron
  cuando el código COT ya estaba en el índice local. El total real de cursos de IA probablemente
  supera los 59.
- **No se ven ni las compras desiertas ni las ofertas perdedoras.** La API de Compra Ágil respondió 504
  a todos los detalles y listados de estados cerrados durante el día de la medición. Por eso esta vez
  no se pudo calcular la tasa de éxito del nicho ni el precio de los que perdieron.
- **El N° de ofertas es un mínimo.** Es el que se observó mientras la compra estaba abierta, no el que
  tenía al cerrar.
- Cuatro compras fichadas no tienen OC al 13-10 (Poder Judicial `425-339`, INAPI `519302-71`, SECTRA
  `619284-46`, Subtrans Fiscalización `3755-113`). Pueden haber quedado desiertas o seguir pendientes.

## Quiénes se adjudican estos cursos

| Proveedor | RUT | Cursos | Monto total | Compradores |
|---|---|---:|---:|---|
| Pontificia Universidad Católica de Chile (Educación Continua) | 81.698.900-0 | 4 | $5.665.000 | Cochilco ×3, Carabineros |
| Innova Hub SpA | 77.902.878-K | 3 | $6.210.000 | Registro Civil, Subsec. Salud Pública, SS Sur Hosp. |
| Capacitación Easylit Ltda. | 77.443.695-2 | 3 | $5.518.000 | SLEP Santa Corina, Min. Mujer, Carabineros (curso Claude) |
| Fundación CADESEM | 65.203.611-2 | 3 | $4.880.000 | Municipalidades de Penco y Osorno (DAEM), SLEP |
| Capacitaciones Atrévete SpA | 77.703.816-8 | 3 | $4.190.000 | Dipres, FONASA, SS Metropolitano Norte |
| Bialostocki & Abbott Consultores SpA | 78.254.972-3 | 3 | $1.455.000 | U. de Atacama, GORE Tarapacá, SEREMI Minvu |
| Fundación Santillana Educación | 65.142.303-1 | 2 | $12.500.000 | Municipalidades de Chaitén y Nogales (docentes) |
| RIGROUP Academy SpA | 77.087.675-3 | 2 | $7.500.000 | MOP (curso Claude), Subsec. Vivienda |
| Advance Capacitaciones Ltda. | 76.593.297-1 | 2 | $7.390.001 | Subsec. Defensa, SS Sur Unidad Hosp. |
| Universidad de Chile | 60.910.000-1 | 2 | $5.290.000 | Carabineros (diplomado), UTEM |
| Sinmatec Chile SpA | 77.637.351-6 | 2 | $2.990.000 | Municipalidades de Combarbalá y Conchalí (una OC cancelada) |
| Vremia Capacitación Ltda. | 76.033.205-4 | 2 | $2.300.000 | Subsec. Derechos Humanos ×2 |
| Universidad Adolfo Ibáñez | 71.543.200-5 | 2 | $1.768.000 | Consejo Nacional de Educación, U. de Chile |

Hay 26 proveedores más con un curso cada uno: Corporación Mejor Educación, Fundación Cruzando, Origo
Lab, Fundación Integrados, Deeplearn OTEC, Chilenergía, U. de los Andes, Passus, Compañía de
Capacitación Integra, entre otros (el detalle está en el CSV).

**Patrones:**

- **Las universidades ganan cuando la compra pide credenciales y no un precio bajo.** La PUC se llevó
  los tres cursos de Cochilco, cuya pauta da 90% a lo técnico y la evidencia y solo 10% al precio, y el
  de Carabineros, que exigía una universidad acreditada CNA del CRUCH. Lo mismo pasa con los diplomados
  de Carabineros y del Ejército (U. de Chile y U. de los Andes).
- **Las compras para docentes son otro mercado.** Municipios, DAEM y SLEP le compran a fundaciones
  educativas (Santillana, CADESEM, FAASE, Mejor Educación, Cruzando), con tickets altos de $2,8M a
  $6,6M. Osorno, por ejemplo, exigía el Registro ATE del Mineduc.
- **Hay recompradores fieles.** Cochilco le compró 3 cursos a la PUC, Derechos Humanos 2 a Vremia y
  Atrévete repitió en el sector salud y Hacienda. Una vez que un organismo queda conforme, vuelve.
- **38 de los 59 ganadores son de la Región Metropolitana.** Casi todo se dicta online, así que la
  región del proveedor no pesa mucho, salvo en los cursos presenciales para docentes en regiones.

## Cuánto cobra el que gana

| Compra Ágil | Organismo | Tope $ | Adjudicado $ | % del tope | Ofertas (mín.) | Evaluación | Ganador |
|---|---|---:|---:|---:|---:|---|---|
| `1618-69-COT26` | Dipres | 3.000.000 | 690.000 | **23%** | 5 | menor precio | Capacitaciones Atrévete |
| `5956-122-COT26` | U. de Atacama | 2.000.000 | 475.000 | **24%** | 2 | no declarada | Bialostocki & Abbott |
| `957865-157-COT26` | Subsec. DD.HH. | 3.200.000 | 1.200.000 | **38%** | 5 | no declarada | Vremia Capacitación |
| `1121-56-COT26` | Cochilco | 1.000.000 | 510.000 | **51%** | 8 | puntaje · precio 10% | PUC |
| `957865-155-COT26` | Subsec. DD.HH. | 2.000.000 | 1.100.000 | **55%** | 5 | no declarada | Vremia Capacitación |
| `2672-18-COT26` | Mun. Concepción | 6.020.000 | 3.500.000 | **58%** | 12 | puntaje · precio 20% | Cía. de Capacitación Integra |
| `1393495-768-COT26` | SLEP Santa Corina | 7.164.900 | 4.298.000 | **60%** | 1 | puntaje · precio 15% | Capacitación Easylit |
| `1121-57-COT26` | Cochilco | 1.550.000 | 977.500 | **63%** | 2 | puntaje · precio 10% | PUC |
| `2324-885-COT26` | Mun. Puerto Montt | 2.500.000 | 1.620.000 | **65%** | — | no declarada | Instituto Emprender |
| `5701-161-COT26` | Carabineros | 4.800.000 | 3.200.000 | **67%** | 1 | no declarada (exige universidad) | PUC |
| `3616-123-COT26` | DESAM Combarbalá | 1.600.000 | 1.090.000 | **68%** | — | no declarada | Sinmatec Chile |
| `2306-700-COT26` | DAEM Osorno | 4.000.000 | 2.850.000 | **71%** | — | no declarada (exige ATE) | Fundación CADESEM |
| `1561-67-COT26` | DICREP | 2.000.000 | 1.650.000 | **82%** | 2 | no declarada | Imperio Capacitaciones |
| `1751-29-COT26` | CONASET | 240.000 | 202.300 | **84%** | — | puntaje · precio 20–30% | FV Consulting |
| `957865-156-COT26` | Subsec. DD.HH. | 3.200.000 | 2.800.000 | **88%** | 5 | no declarada | Passus Servicios Prof. |
| `577290-82-COT26` | Subtrans | 1.000.000 | 880.000 | **88%** | 2 | puntaje · precio 20% | OTEC Tecnipro |
| `2735-1052-COT26` | Mun. Lo Barnechea | 6.116.000 | 5.775.500 | **94%** | — | no declarada | Origo Lab |
| `918434-252-COT26` | Min. de la Mujer | 500.000 | 500.000 | **100%** | — | no declarada | Capacitación Easylit |
| `165-56-COT26` | Consejo Nac. de Educación | 1.400.000 | 1.400.000 | **100%** | 1 | — | U. Adolfo Ibáñez |

Mediana 67%, promedio 67%. **Donde el precio decide todo, se gana muy abajo del tope.** En Dipres, la
única compra a menor precio puro, el ganador cobró el 23%: $690.000 contra un borrador de KeepSync de
$2.700.000. Incluso en pautas donde el precio pesa solo 10–20%, los ganadores quedaron entre el 51% y
el 63%. Las únicas que se ganaron cerca del tope tenían un solo oferente o un proveedor con nombre
institucional (CNED/UAI).

## Qué piden los organismos (20 TDR de cursos de IA)

| Requisito | Frecuencia | Comentario |
|---|---|---|
| Título profesional del relator/a, con copia | 16 / 20 | Solo U. de Atacama, Cochilco (×2) y SLEP no lo exigen. |
| Experiencia en relatoría acreditada con documentos (OC, certificados de ejecución, cartas) | ~17 / 20 | Desde «≥1 año» (DD.HH.) hasta «≥5 cursos de IA» (Dipres) o «3+ cursos con certificado timbrado» (Poder Judicial). |
| Postgrado o diplomado en IA del relator/a, exigido o premiado | 7 / 20 | DD.HH. ×3 lo exigen; Concepción da 35/100 puntos por magíster; Puerto Montt exige diplomado en IA; INAPI da 30 puntos. |
| Pauta con puntaje publicada | 10 / 20 | El precio pesa 0% (INAPI), 10% (Cochilco), 15% (SLEP), 20% (Concepción, Subtrans, SECTRA, CONASET), 30% (Subtrans Fiscalización) o 40% (Poder Judicial). Mediana: 20%. |
| Menor precio puro | 1 / 20 | Dipres: primero se descarta todo lo que no cumple al 100%; entre lo que queda, gana el más barato. |
| Sin pauta publicada | 9 / 20 | «Se adjudicará la oferta que cumpla de mejor manera». En la práctica, precio + cumplimiento documental. |
| Puntaje técnico mínimo para pasar a la evaluación económica | 4 / 20 | 50 o 60 puntos técnicos. Si no se llega, el precio no se evalúa. |
| Anexos firmados como causal de inadmisibilidad | frecuente | DD.HH. (Anexo 1), Puerto Montt (Anexo 1 firmado), Dipres (Anexos 1 y 2). |
| Requisito institucional | 3 / 20 | Universidad CNA del CRUCH (Carabineros), Registro ATE (Osorno), OTEC SENCE suma 10% (Subtrans). |
| Contenido adicional al temario mínimo para el puntaje máximo de «contenidos» | 3 / 20 | CONASET, SECTRA, Subtrans Fiscalización. |
| Desempate por más horas o más becas | 4 / 20 | Subtrans, CONASET, SECTRA, Subtrans Fiscalización. |

Formas que se repiten y conviene reconocer:

- **Bases que se contradicen.** CONASET pondera 80/20 en el texto y 70/30 en la fórmula; Puerto Montt
  pide 12 horas que su calendario no alcanza a dar.
- **Topes de páginas.** INAPI revisa solo las primeras 16 páginas de la oferta.
- **Exigencias sin pauta.** Seis organismos piden mucho y no dicen cuánto pesa el precio.

## Qué aumenta la probabilidad de adjudicación

Estas recomendaciones salen de cruzar los 59 ganadores con los 20 TDR. **No es un modelo estadístico:**
las ofertas perdedoras no se ven.

1. **Tener la carpeta documental del relator/a lista antes de que salga la compra.** Es lo que más pesa
   y lo que más descarta: título, CV y al menos 5 certificados de ejecución u OC de cursos de IA
   dictados (Dipres pide 5; Cochilco y SECTRA dan el máximo con 4 o más; Poder Judicial, con 3 o más
   certificados timbrados). Un diplomado o postgrado en IA abre 7 de cada 20 compras que, sin él,
   quedan cerradas o con puntaje bajo.
2. **Bajar el precio objetivo del 90% a una franja de 55–70% del tope**, y a 25–40% cuando la compra es
   de menor precio puro o no declara pauta y trae varias ofertas. El ganador mediano cobró el 67%. El
   90% solo habría ganado en 3 de 19 casos, y en uno de ellos (CNED) había un único oferente.
3. **Construir historial de OC en Mercado Público con cursos chicos y baratos.** La experiencia se
   acredita con órdenes de compra, y el Hospital Padre Hurtado pide las últimas 12. Cada curso de
   $400–700 mil ganado barato, como hicieron Bialostocki, Atrévete y Easylit, es un documento que suma
   puntos en la siguiente compra.
4. **Apuntar a compradores que repiten.** Cochilco, Derechos Humanos, Carabineros (4 cursos, uno de
   Claude), Subsec. Vivienda (4), MOP (3) y Dipres compran en serie y le vuelven a comprar al que ya
   quedó conforme.
5. **Responder la pauta punto por punto y agregar contenido.** Tres pautas dan el máximo de
   «contenidos» solo si se incorpora material adicional al temario mínimo, y cuatro desempatan por más
   horas o becas. Ofrecer horas o cupos extra cuesta poco y desempata.
6. **Elegir dónde competir.** Hay que descartar de entrada lo que exige universidad CNA, Registro ATE o
   «12 OC del mismo curso». Hay que priorizar compras online de servicios públicos centrales con tope de
   $1–3M, que es el rango de Atrévete, Easylit, Vremia y Bialostocki.
7. **Usar Claude como diferenciador del temario.** Ya hay dos compradores que lo piden por nombre
   (Carabineros y MOP), y en ambos ganó una capacitadora chica, no una universidad. Es el nicho donde
   KeepSync, que ya revende Claude, tiene un argumento propio.

## Implicancias para KeepSync

- **La regla `precio = tope × 0,9` de `cotizar-capacitacion` deja a KeepSync fuera de precio en casi
  todas las compras medidas.** Conviene que el usuario decida una regla nueva. Por ejemplo, 65% por
  defecto y 35% para menor precio puro, siempre sujeta al costo real del relator/a.
- **El bloqueo de fondo sigue siendo el relator/a.** Sin título, CV y certificados acreditables, ningún
  precio gana. Hoy solo 2 de 25 borradores lo designan.
- **Para comparar: en licencias Claude, en la misma ventana hubo 46 OC por $91,8 millones.** FLEX SSS
  lidera con 12, seguida de IWS Chile, Aetos e Innovalogic con 4 cada una. **KeepSync SpA ganó una**:
  `1614-122-AG26`, Claude Pro por 12 meses, $951.505. Es el único registro del repo de KeepSync como
  adjudicatario.
