# 1056854-51-COT26 — I. Municipalidad de Providencia — cotización mixta (requiere generación manual)

**Suscripción Claude AI Team Seat, 12 meses. Tope: $5.200.000 CLP.** Cierre: 2026-08-17 13:00.

## Qué pide realmente (del detalle de productos)

El radar detectó "Team, 1 usuario", pero los ítems solicitados son una **combinación de tramos**:

| Ítem | Tramo | Cantidad |
|---|---|---|
| Equipo 1 | Team **Premium** Seat | 1 |
| Equipo 1 | Team **Standard** Seat | 6 |
| Equipo 2 | Team **Standard** Seat | 4 |
| **Total** | | **11 asientos** (1 premium + 10 estándar) |

## Cotización (fórmula del proyecto, fx $913,2 CLP/USD)

| Concepto | Total |
|---|---|
| 1 × Team Premium (USD 100/mes × 12) | $1.707.001 |
| 10 × Team Standard (USD 20/mes × 12) | $3.414.002 |
| **Neto** | **$4.303.364** |
| **IVA 19%** | **$817.639** |
| **TOTAL** | **$5.121.003** |

**Cabe bajo el tope de $5.200.000 — holgura de solo $78.997 (~1,5%).**

## Por qué no la generó el cotizador automático

- `cotizar.ts` maneja **un solo tramo por oferta**; aquí hay premium + estándar mezclados y no
  puede armar la tabla de dos líneas automáticamente.
- Además detectó mal la cantidad (1 en vez de 11), porque la tomó del texto "EQUIPO 1".
- **Acción:** generar la cotización a mano con dos líneas (1 premium + 10 estándar), revisar el
  `Solicitud Cotización.docx` adjunto (define el formato exigido) y confirmar el split de tramos
  antes de ofertar.

## Admisibilidad

- **Adjuntar el formato de cotización es requisito de admisibilidad**: "no adjuntarlo, dicha
  oferta será declarada INADMISIBLE".
- Incluir el taller de 3 h y el acceso a la comunidad de usuarios (valor agregado estándar de
  KeepSync, sin costo).

## Lectura

Oportunidad viable pero de margen ajustado: cabe por ~$79k. Cualquier alza del dólar sobre
~$927 CLP/USD la deja sobre el tope. Confirmar el tipo de cambio del día antes de enviar.
