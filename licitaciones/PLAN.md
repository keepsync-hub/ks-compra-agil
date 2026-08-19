# Agente de Licitaciones — Gestión Documental, digitalización de procesos, Oficina de Partes

> Réplica del diseño de `PLAN.md` (raíz, Compra Ágil de licencias Claude) para un segundo nicho:
> **Licitaciones públicas** (no Compra Ágil) que piden soluciones de gestión documental,
> digitalización de procesos u oficina de partes. Este documento declara explícitamente qué está
> verificado y qué sigue siendo una suposición.
>
> **Actualizado el 2026-08-19: el radar ya corrió contra la API real** con un
> `LICITACIONES_API_TICKET` válido. La sección "Hallazgos de la corrida de verificación" abajo
> reemplaza lo que hasta entonces eran suposiciones — y corrige varias que resultaron falsas.

## Alcance

Licitaciones públicas de mercadopublico.cl (no Compra Ágil) cuyo objeto sea gestión documental,
digitalización de procesos u oficina de partes — el mismo tipo de necesidad de transformación
digital que Compra Ágil de Claude, pero en el instrumento de compra "Licitación" (montos más
altos, procesos más formales: garantías, bases administrativas y técnicas, evaluación por
comisión) y con un producto/servicio completamente distinto (no hay un precio de lista público
como el de Anthropic).

## Insumos bloqueantes

1. ~~**`LICITACIONES_API_TICKET`**~~ — **resuelto el 2026-08-19**. El ticket existe y el radar corrió
   contra `api.mercadopublico.cl` en producción. Ver "Hallazgos de la corrida de verificación".
   Queda una restricción operativa derivada: **la cuota diaria es muy escasa** — se agotó (429) en la
   segunda corrida del mismo día, a mitad de las llamadas de ficha. Eso condiciona la frecuencia del
   radar. Por eso se decidió gastar **toda** la cuota en licitaciones activas: ver "Decisión: solo
   licitaciones activas" abajo.
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
| Los adjuntos vienen en `Adjuntos[].URL` de la ficha | **Falso.** No existe ningún campo `Adjuntos` en la ficha. Este dominio **no tiene** el equivalente al servicio de adjuntos sin login de Compra Ágil: las bases hay que leerlas en el portal |
| Las garantías vienen en `Garantia.*` | **Falso.** Tampoco existen en la ficha. La exigencia de boleta de garantía solo aparece en las bases administrativas, fuera de la API |
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
| Búsqueda por texto | `q` (matching laxo del servidor) | **no existe** — solo `fecha` (día de publicación), `codigo` (ficha) o `estado`. El filtrado por palabra clave (`config/keywords.json`) es LOCAL y es el mecanismo primario de descubrimiento, no un filtro de ruido secundario como en Compra Ágil |
| Envelope de error | HTTP 429/5xx + `{success, payload, errors}` | HTTP 200 incluso en error, con `{Codigo, Mensaje}` en vez del listado esperado (verificado: así respondió con el ticket de prueba) |
| Adjuntos | servicio público sin login, ya probado end-to-end | **la API no los expone** (verificado): no hay campo `Adjuntos` en la ficha. Solo se llega a las bases por el portal |
| Tope | `presupuesto.monto_disponible_clp` (número exacto verificado) | `MontoEstimado` (verificado en runtime; solo en la ficha, no en el listado) |
| Garantías | no aplica en Compra Ágil | Licitaciones sí suelen exigirlas (seriedad de la oferta, fiel cumplimiento), pero **la API no las expone** (verificado): hay que leer las bases en el portal antes de decidir si conviene ofertar |
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

**Lo que se pierde, dicho explícitamente**: de este nicho no hay ni habrá cifras históricas —
cuántas licitaciones de gestión documental se declaran desiertas, quién se las adjudica y a qué
precio. El nicho Claude sí las tiene (`output/informe-nicho-claude.md`, 47 casos, 79% de fracaso) y
son las que condicionaron varias decisiones de diseño allá. Acá se opera sin ese contexto: el radar
dice qué está abierto, no si vale la pena el mercado. Si esas cifras se necesitan, hay que
presupuestar la cuota primero y recién entonces reponer el barrido.

## Arquitectura

Espejo de la de Compra Ágil (raíz), adaptada:

```
licitaciones/
  PLAN.md                    - este documento
  docs/                       - documentación oficial de referencia (diccionario de datos de la API)
  src/lib/
    api.ts                   - cliente de api.mercadopublico.cl (SIN VERIFICAR, ver arriba)
    keywords.ts               - variantes de búsqueda + verificación local (acá es descubrimiento primario)
    condiciones.ts            - tope, garantías, plazo, documentos exigidos, excluyentes
    config.ts, historial.ts, tiempo.ts, nombre-archivo.ts
    pricing.ts                - cotiza por catálogo de costos propio (no hay precio de lista externo)
    cotizacion-pptx.ts / cotizacion-html.ts / cotizacion-pdf.ts - misma plantilla visual de KeepSync
  config/
    keywords.json             - variantes de búsqueda de gestión documental/digitalización/oficina de partes
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
