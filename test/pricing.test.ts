import assert from "node:assert/strict";
import { test } from "node:test";
import { calcularCotizacionClp, calcularCotizacionUsd } from "../src/lib/pricing-usd.js";
import { cotizarSuscripcionUsd, type LineaSuscripcion } from "../src/lib/cotizacion-suscripcion-usd.js";
import type { IdentidadOferente } from "../src/lib/capacitaciones.js";

const OFERENTE: IdentidadOferente = {
  razon_social: "KEEPSYNC SPA",
  nombre_fantasia: null,
  rut: "78.441.121-4",
  direccion: null,
  giro: null,
  representante_legal: null,
  es_emt: true,
  estado_habilidad: null,
  acreditado_hasta: null,
  contacto_nombre: null,
  contacto_email: "cristian.molina@keepsync.ai",
  contacto_telefono: null,
  campos_por_confirmar: [],
  campos_por_confirmar_corto: [],
  identidad_confirmada: false,
};

function cotizar(lineas: LineaSuscripcion[], tipoCambioObservado?: number) {
  return cotizarSuscripcionUsd({
    id: "Q-TEST",
    titulo: "Prueba",
    cliente: "Cliente de prueba",
    lineas,
    tipoCambioObservado,
    fuenteTipoCambio: tipoCambioObservado ? "test" : null,
    oferente: OFERENTE,
    fecha: new Date("2026-09-16T12:00:00Z"),
  });
}

const LINEA_CLP: LineaSuscripcion = {
  moneda: "CLP",
  producto: "ChatGPT Business – Premium Seat",
  precioListaClpMes: 108_000,
  usuarios: 3,
  meses: 12,
  fuentePrecioLista: "checkout de OpenAI",
  aplicarRecargo: true,
};

// La cadena USD no cambió al factorizar los pasos 3-5: este es el valor de la cotización a SEC del
// 16-09-2026 calculada desde el precio de lista en dólares.
test("la regla en USD mantiene sus cinco pasos y su resultado", () => {
  const r = calcularCotizacionUsd(4500, 957.53);
  assert.equal(r.tipo_cambio_ajustado, 1010.19);
  assert.equal(r.costo_clp, 4_545_874);
  assert.equal(r.precio_cotizacion_clp, 6_221_028);
  assert.equal(r.valor_final_clp, 7_403_023);
  assert.deepEqual(
    r.pasos.map((p) => p.paso.slice(0, 2)),
    ["1.", "2.", "3.", "4.", "5."],
  );
});

test("la regla en CLP no convierte y aplica el colchón de reajuste", () => {
  const r = calcularCotizacionClp(108_000 * 3 * 12, { aplicarRecargo: true });
  assert.equal(r.monto_lista_clp, 3_888_000);
  assert.equal(r.costo_clp, 4_101_840); // +5,5%
  assert.equal(r.precio_cotizacion_clp, 5_613_368);
  assert.equal(r.valor_final_clp, 6_679_908);
  assert.equal(r.pasos.length, 5);
});

// Sin colchón el paso desaparece y los que siguen se renumeran: un "3." que no existe en el
// documento haría ilegible el desglose del .json que acompaña al PDF.
test("sin colchón la regla en CLP tiene cuatro pasos numerados de corrido", () => {
  const r = calcularCotizacionClp(108_000 * 3 * 12, { aplicarRecargo: false });
  assert.equal(r.recargo_reajuste_pct, 0);
  assert.equal(r.costo_clp, 3_888_000);
  assert.equal(r.valor_final_clp, 6_331_666);
  assert.deepEqual(
    r.pasos.map((p) => p.paso.slice(0, 2)),
    ["1.", "2.", "3.", "4."],
  );
});

test("una cotización de puras líneas CLP no necesita tipo de cambio", () => {
  const { resumen } = cotizar([LINEA_CLP]);
  assert.equal(resumen.tipo_cambio_observado, null);
  assert.equal(resumen.monto_usd_total, null);
  assert.equal(resumen.monto_lista_clp_total, 3_888_000);
  assert.equal(resumen.total_clp, 6_679_908);
  assert.equal(resumen.lineas[0]?.neto_unitario_mensual_clp, Math.round(5_613_368 / 36));
});

// Sin tipo de cambio una línea en USD se cotizaría contra `undefined`. Tiene que fallar en voz
// alta: cotizar con el número equivocado en silencio es el peor desenlace de este script.
test("una línea en USD sin tipo de cambio falla en voz alta", () => {
  assert.throws(
    () =>
      cotizar([
        {
          moneda: "USD",
          producto: "Claude Max 20x",
          precioListaUsdMes: 200,
          usuarios: 1,
          meses: 12,
          fuentePrecioLista: "anthropic.com",
        },
      ]),
    /tipo de cambio/i,
  );
});

// La salvedad de tipo de cambio en las condiciones comerciales contradice el precio cerrado en
// pesos, y en una cotización sin conversión además es falsa.
test("el PDF en pesos no promete reajuste por tipo de cambio", () => {
  const { html } = cotizar([LINEA_CLP]);
  assert.ok(!/tipo de cambio/i.test(html));
  assert.ok(/precio cerrado por todo el período cotizado/i.test(html));
});
