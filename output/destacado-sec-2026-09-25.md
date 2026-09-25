# Destacado: Superintendencia de Electricidad y Combustibles (SEC) — 2026-09-25

Pedido del usuario al correr el radar: destacar cualquier cosa de la SEC. El radar de los cinco
nichos **no la encontró**: ninguna de las 9 oportunidades abiertas es de la SEC, y ninguno de sus
adjuntos la menciona. Como el radar solo busca en los nichos, se hizo además un barrido aparte de
compras publicadas que nombran a la SEC (`q` = SEC / Superintendencia / Electricidad / Combustibles,
4 consultas). La SEC (RUT 60.510.000-7, organismo 1614) tiene **dos Compras Ágiles abiertas**.

## ⭐ `1614-58-COT26` — Compra de créditos Google AI Studio, para apoyar procesos de análisis documental

- **Tope:** $7.170.000 CLP, «Presupuesto a Asignar $ 7.170.000 Iva Incluido» (SC-219 CA.pdf).
- **Cierre:** 2026-09-29 10:00 (primer llamado: pueden ofertar las EMT, y KeepSync lo es). Si queda desierta, el segundo llamado cierra el 2026-10-03 09:04.
- **Competencia:** 0 ofertas recibidas al momento de la consulta.
- **Plazo de entrega:** 3 días. Dirección: Av. Libertador Bernardo O'Higgins N° 1449, piso 13, Torre 1.
- **Área requirente:** Informática; contacto Francisco Balcázar, anexo 610. Solicitud a
  adquisiciones@sec.cl.
- **Justificación (cita):** «Se requiere créditos Google AI Studio para apoyar procesos de análisis
  documental de la Sec.»
- **Producto ONU:** 43231512 «Software de gestión de licencias», cantidad 1 GL.

**Por qué importa:** la SEC ya compra IA por Compra Ágil y lo repite. Está en el informe del nicho
Claude: `1614-21-COT26` (2026-03-09, $5.800.000, **desierta**) y `1614-47-COT26` («SC-182
Suscripción de Claude Pro por 12 meses», 4 usuarios, $1.300.000, 5 ofertas). Ahora pasa a créditos
de API de Google para análisis documental, que es justamente el tipo de uso que KeepSync vende.

**Cotización:** no se generó una oferta. Estos créditos no son del nicho de capacitación, así que no
aplica la regla tope × 0,9. Tampoco son licencias Claude, y el cotizador de licencias
(`npm run cotizar`) necesita `config/company.json`, que no está en el repo. Además tiene el mismo
insumo bloqueante que los créditos de API del INIA (`1107279-199-COT26`, en `_no_cotizadas`): hay que
confirmar si KeepSync tiene una vía real para comprar y facturar créditos de Google Cloud/AI Studio
a un tercero. Como referencia, esto es lo que cabe bajo el tope con la regla USD del repo
(`npm run cotizar-usd`, dólar observado $965,71 del 2026-09-25, mindicador.cl):

| USD de créditos | Precio neto | Valor final c/IVA |
|---:|---:|---:|
| 1.000 | $1.394.261 | $1.659.170 |
| **4.321** (máximo bajo el tope) | $6.024.601 | **$7.169.275** |

Es decir, **hasta ~USD 4.321 en créditos** caben bajo el tope de $7.170.000. Esta tabla no es una
oferta: sirve para decidir si vale la pena resolver el fulfillment antes del 29-09.

## `1614-57-COT26` — SC-216 Compra de estos insumos Computacionales

- **Tope:** $650.000 CLP · **Cierre:** 2026-09-26 18:00 (primer llamado).
- El detalle respondió **504 dos veces**, así que no se tiene la descripción ni los productos. Su
  único adjunto (`SC-216-1 Imagenes Referenciales.pdf`) son imágenes sin capa de texto.
- No es de ningún nicho de KeepSync. Por el nombre podría ser del rubro de **Kompu** (insumos TI),
  pero no está verificado: hay que abrir las imágenes a mano.

## Falsos positivos del barrido (no son la SEC)

La búsqueda `q=SEC` también trajo compras de Carabineros («SECCIÓN COMPRAS XI ZONA»), una de
«red de gas **norma SEC**» (`3365-209-COT26`) y un «**sello verde SEC**» del Hospital de Puerto
Cisnes (`2151-69-COT26`). Nombran la norma o el sello de la SEC, pero no las compra la SEC.
