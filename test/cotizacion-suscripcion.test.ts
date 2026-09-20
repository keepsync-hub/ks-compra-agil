import test from "node:test";
import assert from "node:assert/strict";
import { cotizarSuscripcionUsd, type LineaSuscripcionUsd } from "../src/lib/cotizacion-suscripcion-usd.js";
import type { IdentidadOferente } from "../src/lib/capacitaciones.js";

/**
 * Lo que se cuida acá es la prosa del PDF, no la aritmética (esa es de `pricing-usd.ts`): el
 * documento va a un cliente final y las tres fallas de abajo salieron todas en la misma cotización
 * de tres servicios por un mes (Kompu, 2026-09-20), donde el módulo solo había visto cotizaciones
 * de una o dos líneas por 12 o 24 meses.
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

const linea = (producto: string, usd: number, meses = 1): LineaSuscripcionUsd => ({
  producto,
  precioListaUsdMes: usd,
  usuarios: 1,
  meses,
  fuentePrecioLista: `cargo real en la tarjeta: USD ${usd}`,
});

function html(lineas: LineaSuscripcionUsd[], unidad?: "usuario" | "servicio"): string {
  return cotizarSuscripcionUsd({
    id: "Q-TEST",
    titulo: "Prueba",
    cliente: "Cliente de prueba",
    lineas,
    tipoCambioObservado: 954.85,
    fuenteTipoCambio: "fijo para el test",
    oferente: OFERENTE,
    fecha: new Date("2026-09-20T12:00:00Z"),
    unidad,
  }).html;
}

test("una cotización de un solo mes dice «1 mes», no «1 meses»", () => {
  const h = html([linea("Hostinger", 13.08)]);
  assert.ok(!h.includes("1 meses"), "quedó el plural fijo en alguna lámina");
  assert.ok(h.includes("1 mes,"), "falta la glosa singular en el subtítulo");
  assert.ok(h.includes("1 mes corrido desde la activación"), "la condición quedó en plural");
});

test("tres líneas se enumeran «A, B y C», no «A y B y C»", () => {
  const h = html([linea("Anthropic", 5.95), linea("Hostinger", 13.08), linea("GitHub", 4)]);
  assert.ok(!/suscripción Anthropic y 1 suscripción/.test(h), "sigue uniendo todo con «y»");
  assert.ok(h.includes("1 suscripción Anthropic, 1 suscripción Hostinger y 1 suscripción GitHub"));
});

test("unidad=servicio no cuenta usuarios ni promete asientos nominativos", () => {
  const h = html([linea("Anthropic", 5.95), linea("Hostinger", 13.08), linea("GitHub", 4)], "servicio");
  assert.ok(h.includes("3 servicios"), "el subtítulo debería contar servicios");
  assert.ok(!h.includes("3 usuarios"));
  assert.ok(!h.includes("un usuario por suscripción"));
  assert.ok(!h.includes("asiento"), "«asiento nominativo» describe mal una cuenta por servicio");
});

test("el default sigue siendo por usuario: las cotizaciones ya emitidas no cambian de texto", () => {
  const h = html([linea("Claude Max 5x", 100, 12)]);
  assert.ok(h.includes("1 usuario, 12 meses"));
  assert.ok(h.includes("un usuario por suscripción"));
  assert.ok(h.includes("Un asiento nominativo por usuario"));
});

test("impuesto no recuperable incluido: el paso 3 no suma y el resultado lo declara", () => {
  // El caso de cotizar sobre el cargo real de la tarjeta (Kompu, 2026-09-20): el impuesto ya está
  // adentro del monto en USD y sumarlo otra vez lo cobraría dos veces.
  const base = {
    id: "Q-TEST",
    titulo: "Prueba",
    cliente: "Cliente de prueba",
    lineas: [linea("Hostinger", 13.08)],
    tipoCambioObservado: 954.85,
    fuenteTipoCambio: "fijo para el test",
    oferente: OFERENTE,
    fecha: new Date("2026-09-20T12:00:00Z"),
  };
  const conRegla = cotizarSuscripcionUsd(base).resumen;
  const conImpuestoDentro = cotizarSuscripcionUsd({ ...base, impuestoNoRecuperableIncluido: true }).resumen;

  const calc = conImpuestoDentro.lineas[0]!.calculo;
  assert.equal(calc.costo_con_impuesto_clp, calc.costo_clp, "el paso 3 no debería multiplicar");
  assert.equal(calc.impuesto_no_recuperable_pct, 0);
  assert.equal(calc.impuesto_no_recuperable_incluido_en_costo, true);
  assert.equal(conImpuestoDentro.impuesto_no_recuperable_incluido_en_costo, true);
  assert.match(calc.pasos[2]!.descripcion, /ya viene con el 19% adentro/);

  // Sacar un 19% del costo deja el neto en 1/1,19 del de la regla completa, salvo redondeo al peso.
  assert.ok(Math.abs(conImpuestoDentro.neto_clp - conRegla.neto_clp / 1.19) <= 1);
  assert.equal(conRegla.impuesto_no_recuperable_incluido_en_costo, false);
  assert.equal(conRegla.lineas[0]!.calculo.impuesto_no_recuperable_pct, 19);
});
