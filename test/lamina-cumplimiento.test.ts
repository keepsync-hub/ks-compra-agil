import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validarLaminaCumplimiento, type LaminaCumplimiento } from "../src/lib/cotizacion-suscripcion-usd.js";

/**
 * La lámina afirma cumplimiento ante el organismo comprador: una fila sin el artículo que la
 * respalda no debe llegar al PDF. Se prueba contra la lámina real de Alto Hospicio 3447-431-COT26.
 */
const real = JSON.parse(
  readFileSync(new URL("../output/3447-431-COT26/lamina-cumplimiento-chatgpt-business.json", import.meta.url), "utf-8"),
) as LaminaCumplimiento;

test("la lámina versionada de Alto Hospicio es válida", () => {
  assert.doesNotThrow(() => validarLaminaCumplimiento(real));
});

test("una fila sin referencia al TDR corta", () => {
  const mala = structuredClone(real);
  mala.filas[0]!.referencia = " ";
  assert.throws(() => validarLaminaCumplimiento(mala), /fila 1/);
});

test("sin filas o sin pasos corta", () => {
  assert.throws(() => validarLaminaCumplimiento({ ...real, filas: [] }), /sin filas/);
  assert.throws(() => validarLaminaCumplimiento({ ...real, pasos: [] }), /sin pasos/);
});
