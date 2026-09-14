import test from "node:test";
import assert from "node:assert/strict";
import {
  cotizarSuscripcionSaaS,
  parsearLineaSuscripcion,
  type LineaSuscripcionSaaS,
} from "../src/lib/cotizacion-suscripcion-saas.js";
import { calcularCotizacionMonedaExtranjera, calcularCotizacionUsd } from "../src/lib/pricing-usd.js";
import type { IdentidadOferente } from "../src/lib/capacitaciones.js";

/**
 * Lo que se protege acá es que una línea en euros se convierta con el **euro** observado. Una
 * cotización que aplique el dólar a un precio en euros sale ~16% barata y nada en el PDF lo
 * delata: los tres documentos (carátula, alcance, cotización) van enteros en pesos.
 */

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

const TC = {
  USD: { valor: 940.91, fuente: "mindicador.cl (dólar observado, 2026-09-14)" },
  EUR: { valor: 1091.29, fuente: "mindicador.cl (euro observado, 2026-09-14)" },
};

function linea(p: Partial<LineaSuscripcionSaaS> = {}): LineaSuscripcionSaaS {
  return {
    producto: "Claude Max 5x",
    moneda: "USD",
    precioListaMonedaMes: 100,
    usuarios: 1,
    meses: 1,
    fuentePrecioLista: "Precio publicado por Anthropic",
    ...p,
  };
}

test("cada línea se convierte con el valor observado de SU moneda", () => {
  const { resumen } = cotizarSuscripcionSaaS({
    id: "Q-TEST",
    titulo: "Claude Max 5x y n8n",
    cliente: "Kompu",
    lineas: [linea(), linea({ producto: "n8n", moneda: "EUR", precioListaMonedaMes: 20 })],
    tiposCambio: TC,
    oferente: OFERENTE,
    fecha: new Date("2026-09-14T12:00:00Z"),
  });

  const [claude, n8n] = resumen.lineas;
  assert.equal(claude!.calculo.tipo_cambio_observado, TC.USD.valor);
  assert.equal(n8n!.calculo.tipo_cambio_observado, TC.EUR.valor);
  assert.equal(n8n!.neto_clp, calcularCotizacionMonedaExtranjera(20, TC.EUR.valor, "EUR").precio_cotizacion_clp);
  // Convertir los 20 euros con el dólar daría bastante menos: el test existe por eso.
  assert.notEqual(n8n!.neto_clp, calcularCotizacionUsd(20, TC.USD.valor).precio_cotizacion_clp);
});

test("los costos de lista se agrupan por moneda, no se suman entre sí", () => {
  const { resumen } = cotizarSuscripcionSaaS({
    id: "Q-TEST",
    titulo: "Mixta",
    cliente: "Kompu",
    lineas: [linea(), linea({ producto: "n8n", moneda: "EUR", precioListaMonedaMes: 20 })],
    tiposCambio: TC,
    oferente: OFERENTE,
    fecha: new Date("2026-09-14T12:00:00Z"),
  });
  assert.deepEqual(resumen.montos_por_moneda, { USD: 100, EUR: 20 });
  assert.equal(resumen.total_clp, resumen.neto_clp + resumen.iva_clp);
});

test("falta el tipo de cambio de una moneda usada: falla en vez de convertir con la otra", () => {
  assert.throws(
    () =>
      cotizarSuscripcionSaaS({
        id: "Q-TEST",
        titulo: "Sin euro",
        cliente: "Kompu",
        lineas: [linea({ moneda: "EUR" })],
        tiposCambio: { USD: TC.USD },
        oferente: OFERENTE,
        fecha: new Date("2026-09-14T12:00:00Z"),
      }),
    /Falta el tipo de cambio observado de EUR/,
  );
});

test("parsearLineaSuscripcion: el prefijo de moneda es opcional y USD es el default", () => {
  assert.equal(parsearLineaSuscripcion("Claude Max 5x|100|1|12|Anthropic").moneda, "USD");
  assert.equal(parsearLineaSuscripcion("n8n|EUR 20|1|12|usuario").moneda, "EUR");
  assert.equal(parsearLineaSuscripcion("n8n|€20|1|12|usuario").moneda, "EUR");
  assert.equal(parsearLineaSuscripcion("n8n|eur20|1|12|usuario").precioListaMonedaMes, 20);
});

test("parsearLineaSuscripcion: lo ambiguo lanza en vez de repartir mal los campos", () => {
  // Un `|` de más en la fuente correría los campos y cotizaría con el número equivocado.
  assert.throws(() => parsearLineaSuscripcion("n8n|20|1|12|fuente|con pipe"), /5 campos/);
  assert.throws(() => parsearLineaSuscripcion("n8n|CLP 20|1|12|fuente"), /precio inválido/);
  assert.throws(() => parsearLineaSuscripcion("n8n|20|1|12|"), /fuente del precio de lista/);
  assert.throws(() => parsearLineaSuscripcion("n8n|20|1|1.5|fuente"), /meses debe ser un entero/);
});
