import test from "node:test";
import assert from "node:assert/strict";
import {
  catalogoDeOportunidad,
  catalogoDesdeCapacitacion,
  nombreCarpeta,
  normalizarDocumentos,
  prefijoDe,
} from "../src/lib/documentos-oferta.js";
import type { RequisitosCapacitacion } from "../src/lib/capacitaciones.js";

/**
 * El catálogo de documentos es el contrato compartido por tres piezas que no se ven entre sí:
 * `postear-n8n.ts` lo escribe en `documentosJson`, `carpetas-drive.ts` crea una carpeta por
 * documento, y `render-expediente.js` vuelve a emparejar carpeta y entregable por el prefijo NN.
 * Si el prefijo o el nombre de carpeta cambian de forma, las tres se desalinean en silencio.
 */

test("normalizarDocumentos: prefijos NN 1-based, con cero a la izquierda", () => {
  const docs = normalizarDocumentos(["A", "B", "C"], true);
  assert.deepEqual(docs.map((d) => d.prefijo), ["01", "02", "03"]);
  assert.deepEqual(docs.map((d) => d.n), [1, 2, 3]);
});

test("normalizarDocumentos: un string suelto entra como acopio, no como generable", () => {
  // Defensivo a propósito: una entrada sin migrar no debe producir un documento inventado.
  const [doc] = normalizarDocumentos(["Certificado de vigencia"], true);
  assert.equal(doc!.tipo, "acopio");
});

test("normalizarDocumentos: conserva tipo y plantilla de la forma nueva", () => {
  const [doc] = normalizarDocumentos(
    [{ documento: "Anexo N°1", tipo: "formulario", plantilla: "dipres-anexo-1" }],
    false,
  );
  assert.equal(doc!.tipo, "formulario");
  assert.equal(doc!.plantilla, "dipres-anexo-1");
  assert.equal(doc!.provisional, false);
});

test("nombreCarpeta: nombre corto va entero, con su prefijo", () => {
  const [doc] = normalizarDocumentos(["Oferta económica"], false);
  assert.equal(nombreCarpeta(doc!), "01 - Oferta económica");
});

test("nombreCarpeta: recorta en el último espacio, nunca a mitad de palabra", () => {
  const largo =
    "Oferta técnica: metodología, contenidos, plataforma e-learning, recursos pedagógicos, " +
    "actividades prácticas y mecanismos de evaluación";
  const [doc] = normalizarDocumentos([largo], false);
  const nombre = nombreCarpeta(doc!);

  assert.ok(nombre.length <= 110, `demasiado largo: ${nombre.length}`);
  assert.ok(nombre.endsWith("…"), "un corte sin marca se lee como el nombre completo");
  assert.ok(!/\s…$/.test(nombre), "no debe quedar un espacio colgando antes de los puntos");
  assert.ok(nombre.startsWith("01 - Oferta técnica"));
});

test("nombreCarpeta: la barra rompe a Drive, así que se sustituye", () => {
  const [doc] = normalizarDocumentos(["Título y/o certificado del relator"], false);
  assert.ok(!nombreCarpeta(doc!).includes("/"));
});

test("prefijoDe: reconoce el entregable por su NN y rechaza lo que no lo trae", () => {
  assert.equal(prefijoDe("03 - Oferta económica.pdf"), "03");
  assert.equal(prefijoDe("  01 -  Anexo"), "01");
  assert.equal(prefijoDe("Oferta económica.pdf"), null);
  assert.equal(prefijoDe("3 - Oferta"), null, "el prefijo son dos dígitos, no uno");
});

test("el nombre de carpeta y el prefijo del entregable son la misma clave", () => {
  // Es el emparejamiento que hace `render-expediente.js`: si estos dos se separan, un documento
  // generado nunca se reconoce como listo.
  const [doc] = normalizarDocumentos(["Propuesta técnica de la actividad de capacitación"], false);
  const carpeta = nombreCarpeta(doc!);
  assert.equal(prefijoDe(carpeta), doc!.prefijo);
  assert.ok(`${doc!.prefijo} - Propuesta técnica.pdf`.startsWith(`${doc!.prefijo} - `));
});

test("catalogoDeOportunidad: la ficha curada gana y no queda provisional", () => {
  const req = {
    documentos_obligatorios_oferta: [
      { documento: "Anexo N°1", tipo: "formulario", plantilla: "dipres-anexo-1" },
      { documento: "Propuesta técnica", tipo: "generable" },
      { documento: "CV del relator", tipo: "acopio" },
    ],
  } as unknown as RequisitosCapacitacion;

  const cat = catalogoDeOportunidad("1618-67-COT26", req);
  assert.equal(cat.fuente, "capacitaciones.json");
  assert.equal(cat.provisional, false);
  assert.deepEqual(cat.documentos.map((d) => d.tipo), ["formulario", "generable", "acopio"]);
  assert.deepEqual(catalogoDesdeCapacitacion("1618-67-COT26", req).documentos, cat.documentos);
});

test("catalogoDeOportunidad: sin ficha ni condiciones cae al set base, marcado provisional", () => {
  const cat = catalogoDeOportunidad("CODIGO-QUE-NO-EXISTE-COT26");
  assert.equal(cat.fuente, "base");
  assert.equal(cat.provisional, true);
  assert.ok(cat.documentos.length > 0, "una lista vacía se leería como 'no falta nada'");
  assert.ok(cat.documentos.every((d) => d.provisional));
});
