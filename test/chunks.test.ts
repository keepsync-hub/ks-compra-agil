import test from "node:test";
import assert from "node:assert/strict";
import { correrChunk, datosIncrustados } from "./ayuda-chunks.js";

/**
 * Los chunks de `n8n/chunks/` son el cuerpo de los nodos Code del panel. Este archivo los ejercita
 * fuera de n8n. Cada caso de acá corresponde a algo que el panel hace de verdad; los dos primeros
 * de `render-expediente.js` son la regresión del bug que dejaba el expediente en "Sin insumos".
 */

// ── ingesta.js: el único punto de entrada de GitHub Actions ────────────────────

test("ingesta radar: mapea la oportunidad y NO toca el estado", () => {
  const [fila] = correrChunk("ingesta.js", {
    json: {
      body: {
        tipo: "radar",
        corrida_id: "42",
        solicitudes: [
          {
            codigo: "1618-67-COT26",
            nombre: "Curso de Power BI",
            organismo: "DIPRES",
            topeClp: 1500000,
            documentos: [{ prefijo: "01", documento: "Anexo N°1", tipo: "formulario" }],
            provisional: false,
          },
        ],
      },
    },
  });

  assert.equal(fila!.json.codigo, "1618-67-COT26");
  assert.equal(fila!.json.organismo, "DIPRES");
  assert.equal(fila!.json.corridaId, "42");
  assert.equal(fila!.json.catalogoProvisional, false);
  assert.deepEqual(JSON.parse(String(fila!.json.documentosJson)), [
    { prefijo: "01", documento: "Anexo N°1", tipo: "formulario" },
  ]);
  // La decisión humana (avanzar/rechazado) es de la fila, no de la API: un refresco del radar
  // que la pisara borraría el trabajo.
  assert.ok(!("estado" in fila!.json), "el radar no debe escribir `estado`");
});

test("ingesta radar: sin solicitudes no escribe ninguna fila", () => {
  assert.deepEqual(correrChunk("ingesta.js", { json: { body: { tipo: "radar", solicitudes: [] } } }), []);
});

test("ingesta cotizacion: deja el precio, el score y el PDF", () => {
  const [fila] = correrChunk("ingesta.js", {
    json: {
      body: {
        tipo: "cotizacion",
        codigo: "2672-18-COT26",
        totalClp: 5418000,
        topeClp: 6020000,
        descuentoPct: 10,
        scoreApertura: 60,
        pdfUrl: "capacitaciones/2672-18-COT26/cotizacion.pdf",
        observaciones: { pendientes: ["relator"] },
      },
    },
  });

  assert.equal(fila!.json.estado, "cotizado");
  assert.equal(fila!.json.totalClp, 5418000);
  assert.equal(fila!.json.ultimoError, "");
  assert.deepEqual(JSON.parse(String(fila!.json.observacionesJson)), { pendientes: ["relator"] });
});

test("ingesta cotizacion sin_ficha: guarda el motivo y no inventa un precio", () => {
  const [fila] = correrChunk("ingesta.js", {
    json: {
      body: { tipo: "cotizacion", codigo: "X-1-COT26", estado: "sin_ficha", motivo: "falta su ficha" },
    },
  });

  assert.equal(fila!.json.estado, "sin_ficha");
  assert.equal(fila!.json.ultimoError, "falta su ficha");
  assert.ok(!("totalClp" in fila!.json), "sin ficha no hay precio que guardar");
});

test("ingesta expediente: resume los documentos bloqueados", () => {
  const [fila] = correrChunk("ingesta.js", {
    json: {
      body: {
        tipo: "expediente",
        codigo: "1618-67-COT26",
        documentos: [
          { prefijo: "01", estado: "bloqueado", motivo: "falta la plantilla .docx" },
          { prefijo: "03", estado: "generado" },
        ],
      },
    },
  });

  assert.equal(fila!.json.estado, "avanzar");
  assert.match(String(fila!.json.ultimoError), /1 documento\(s\) no se pudieron generar/);
  assert.match(String(fila!.json.ultimoError), /falta la plantilla/);
});

test("ingesta error: saca la fila de 'cotizando' en vez de dejarla colgada", () => {
  const filas = correrChunk("ingesta.js", {
    json: { body: { tipo: "error", codigos: ["A-1-COT26", "-"], motivo: "Falló", run: "http://run" } },
  });

  assert.equal(filas.length, 1, "el marcador '-' no es un código");
  assert.equal(filas[0]!.json.estado, "error");
  assert.match(String(filas[0]!.json.ultimoError), /Falló — http:\/\/run/);
});

// ── render-expediente.js: la regresión del "Sin insumos" eterno ────────────────

const FILA_EXPEDIENTE = {
  codigo: "1618-67-COT26",
  nombre: "Curso de Power BI",
  organismo: "DIPRES",
  topeClp: 1500000,
  totalClp: 1350000,
  driveFolderUrl: "https://drive.google.com/drive/folders/carpeta",
  catalogoProvisional: false,
  documentosJson: JSON.stringify([
    { prefijo: "01", documento: "Anexo N°1", tipo: "formulario", carpeta: "01 - Anexo N°1" },
    { prefijo: "02", documento: "CV del relator", tipo: "acopio", carpeta: "02 - CV del relator" },
  ]),
};

const CARPETAS = [
  { id: "f-entregables", name: "_ENTREGABLES" },
  { id: "f-01", name: "01 - Anexo N°1" },
  { id: "f-02", name: "02 - CV del relator" },
];

function expediente(archivos: readonly Record<string, unknown>[]) {
  const [salida] = correrChunk("render-expediente.js", {
    entrada: archivos,
    nodos: {
      "Buscar la solicitud": [FILA_EXPEDIENTE],
      "Armar la consulta": [{ carpetas: CARPETAS }],
    },
  });
  return datosIncrustados(String(salida!.json.html)) as {
    documentos: Array<{ prefijo: string; archivos: unknown[]; entregable: unknown; listo: boolean }>;
  };
}

test("render-expediente: agrupa los archivos por su carpeta padre", () => {
  const datos = expediente([
    { id: "a1", name: "cv-firmado.pdf", parents: ["f-02"] },
    { id: "a2", name: "anexo-borrador.docx", parents: ["f-01"] },
  ]);

  assert.deepEqual(datos.documentos.map((d) => d.archivos.length), [1, 1]);
  assert.equal(datos.documentos[1]!.archivos.length, 1, "el CV va en la carpeta 02");
});

test("render-expediente: sin `parents` no puede agrupar nada — por eso el nodo pide fields '*'", () => {
  // Este es el bug que tenía el panel: el nodo "Listar los archivos" pedía fields ['id','name'],
  // así que Drive nunca devolvía `parents` y TODOS los archivos se descartaban acá en silencio.
  const datos = expediente([{ id: "a1", name: "cv-firmado.pdf" }]);
  assert.deepEqual(datos.documentos.map((d) => d.archivos.length), [0, 0]);
});

test("render-expediente: empareja el entregable por el prefijo NN, no por el nombre largo", () => {
  const datos = expediente([
    { id: "e1", name: "01 - Anexo N°1 relleno.docx", parents: ["f-entregables"] },
  ]);

  assert.equal(datos.documentos[0]!.listo, true);
  assert.equal(datos.documentos[1]!.listo, false, "el 02 es acopio y nadie lo generó");
});

// ── cooldown.js: el freno de cuota ─────────────────────────────────────────────

test("cooldown: sin ninguna corrida previa, deja correr el radar", () => {
  const [r] = correrChunk("cooldown.js", { entrada: [{ codigo: "A", estado: "nuevo" }] });
  assert.equal(r!.json.disparar, true);
});

test("cooldown: una corrida reciente frena la siguiente", () => {
  const haceCinco = new Date(Date.now() - 5 * 60000).toISOString();
  const [r] = correrChunk("cooldown.js", {
    entrada: [{ codigo: "A", corridaId: "1", actualizado: haceCinco }],
  });
  assert.equal(r!.json.disparar, false);
  assert.match(String(r!.json.espera), /Esperá 10 min más/);
});

test("cooldown: pasados los 15 minutos vuelve a dejar correr", () => {
  const haceVeinte = new Date(Date.now() - 20 * 60000).toISOString();
  const [r] = correrChunk("cooldown.js", {
    entrada: [{ codigo: "A", corridaId: "1", actualizado: haceVeinte }],
  });
  assert.equal(r!.json.disparar, true);
});

test("cooldown: una fila sin corridaId no cuenta como corrida del radar", () => {
  const [r] = correrChunk("cooldown.js", {
    entrada: [{ codigo: "A", actualizado: new Date().toISOString() }],
  });
  assert.equal(r!.json.disparar, true);
});

// ── query-hijos.js / faltantes.js / pedido-drive.js / decision.js ──────────────

test("query-hijos: une todas las carpetas en una sola consulta a Drive", () => {
  const [r] = correrChunk("query-hijos.js", {
    entrada: [{ id: "f-01", name: "01 - Anexo" }, { id: "f-02", name: "02 - CV" }],
  });
  assert.equal(r!.json.query, "('f-01' in parents or 'f-02' in parents) and trashed = false");
  assert.equal((r!.json.carpetas as unknown[]).length, 2);
});

test("query-hijos: sin carpetas devuelve una consulta que no matchea nada", () => {
  const [r] = correrChunk("query-hijos.js", { entrada: [] });
  assert.match(String(r!.json.query), /sin-carpetas/);
  assert.deepEqual(r!.json.carpetas, []);
});

const PEDIDO = {
  codigo: "1618-67-COT26",
  organismo: "DIPRES",
  documentos: [
    { prefijo: "01", documento: "Anexo N°1", tipo: "formulario", carpeta: "01 - Anexo N°1" },
  ],
};

test("faltantes: pide _ENTREGABLES primero y solo lo que no existe", () => {
  const r = correrChunk("faltantes.js", {
    entrada: [{ id: "f-01", name: "01 - Anexo N°1" }],
    nodos: { "Recibir pedido": [PEDIDO], "Id de la carpeta del código": [{ carpetaId: "c1" }] },
  });
  assert.deepEqual(r.map((i) => i.json.nombre), ["_ENTREGABLES"]);
});

test("faltantes: con el árbol completo no crea nada — Drive admite nombres duplicados", () => {
  const r = correrChunk("faltantes.js", {
    entrada: [{ id: "f-e", name: "_ENTREGABLES" }, { id: "f-01", name: "01 - Anexo N°1" }],
    nodos: { "Recibir pedido": [PEDIDO], "Id de la carpeta del código": [{ carpetaId: "c1" }] },
  });
  assert.equal(r.length, 1);
  assert.equal(r[0]!.json.__vacio, true);
});

test("pedido-drive: un catálogo vacío falla en voz alta en vez de crear una carpeta hueca", () => {
  assert.throws(
    () =>
      correrChunk("pedido-drive.js", {
        entrada: [{ documentosJson: "[]", organismo: "DIPRES" }],
        nodos: { "Registrar la decisión": [{ codigo: "1618-67-COT26" }] },
      }),
    /no tiene catálogo de documentos/,
  );
});

test("decision: cualquier cosa que no sea 'avanzar' es un rechazo", () => {
  const [r] = correrChunk("decision.js", {
    json: { body: { codigo: "A-1-COT26", decision: "meh", motivo: "fuera de nicho" } },
  });
  assert.equal(r!.json.decision, "rechazado");
  assert.equal(r!.json.avanza, false);
  assert.equal(r!.json.motivoDecision, "fuera de nicho");
});

test("decision: sin código no se puede decidir nada", () => {
  assert.throws(() => correrChunk("decision.js", { json: { body: { decision: "avanzar" } } }), /Falta 'codigo'/);
});
