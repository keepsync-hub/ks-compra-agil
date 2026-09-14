import test from "node:test";
import assert from "node:assert/strict";
import { detectarPlanPricingDeTexto, esProductoDeOtroProveedor } from "../src/lib/pricing.js";
import { construirLineasACotizar, productosDeOtroProveedor } from "../src/lib/lineas.js";
import type { CompraAgilDetalle } from "../src/lib/api.js";
import type { Condiciones } from "../src/lib/condiciones.js";

/**
 * El caso real que originó esta guarda: la Compra Ágil 2730-289-COT26 (I. Municipalidad de Castro,
 * 2026-09-14) pide dos licencias en el mismo proceso —«Suscripción Claude Max 20X» y «Suscripción
 * ChatGPT Pro 20X»— y el detector de planes cotizaba la segunda como Claude Pro a USD 17/mes. El
 * PDF salía ofreciendo un producto que no es el pedido, al precio de otro.
 */

/** Producto itemizado como los que trae `productos_solicitados` de la API. */
function producto(descripcion: string, cantidad = 1) {
  return { codigo_producto: 43232000, nombre: "Software de gestión de licencias", descripcion, cantidad, unidad_medida: "GL" };
}

function detalleCastro(): CompraAgilDetalle {
  return {
    productos_solicitados: [
      producto("licencias / Suscripción Claude Max 20X por 12 meses para usuario individual"),
      producto("licencias / Suscripción ChatGPT Pro 20X por 12 meses para usuario individual"),
    ],
  } as unknown as CompraAgilDetalle;
}

const CONDICIONES: Condiciones = {
  plan_detectado: "Max 20x",
  cantidad_usuarios: 2,
} as unknown as Condiciones;

test("esProductoDeOtroProveedor: ChatGPT Pro no es un plan de Anthropic", () => {
  assert.equal(esProductoDeOtroProveedor("Suscripción ChatGPT Pro 20X por 12 meses"), true);
  assert.equal(esProductoDeOtroProveedor("Suscripción Claude Max 20X por 12 meses"), false);
});

test("esProductoDeOtroProveedor: una comparación que nombra a Claude sigue siendo de Claude", () => {
  // Una descripción comparativa no puede desactivar la cotización: si el pedido nombra a Claude,
  // el producto es de Claude aunque mencione a la competencia.
  assert.equal(esProductoDeOtroProveedor("Claude Team, equivalente a ChatGPT Business"), false);
});

test("detectarPlanPricingDeTexto: 'ChatGPT Pro' ya no se cotiza como Claude Pro", () => {
  assert.equal(detectarPlanPricingDeTexto("Suscripción ChatGPT Pro 20X por 12 meses"), null);
  assert.deepEqual(detectarPlanPricingDeTexto("Suscripción anual Claude Pro"), {
    clave: "pro",
    requiereRevision: false,
  });
});

test("construirLineasACotizar: un pedido con una licencia ajena no produce líneas", () => {
  // Devolver null detiene la corrida. Es lo correcto: una Compra Ágil se adjudica por la totalidad
  // de lo pedido, así que una oferta que cubra solo la licencia Claude tampoco sería admisible.
  assert.equal(construirLineasACotizar(detalleCastro(), CONDICIONES, 12), null);
});

test("productosDeOtroProveedor: nombra exactamente qué producto detuvo la cotización", () => {
  const ajenos = productosDeOtroProveedor(detalleCastro());
  assert.equal(ajenos.length, 1);
  assert.match(ajenos[0]!, /ChatGPT Pro 20X/);
});
