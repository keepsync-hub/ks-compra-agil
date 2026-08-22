// La fila ya trae el catálogo de documentos que dejó el radar o la cotización. Acá solo se
// desempaqueta para el sub-workflow, que es quien habla con Drive.
const fila = $input.first().json;
const decision = $("Registrar la decisión").first().json;

let documentos = [];
try { documentos = JSON.parse(fila.documentosJson || "[]"); } catch (e) { documentos = []; }

// Una lista vacía crearía una carpeta de código sin nada adentro, que se lee como "no falta nada".
// Mejor decirlo: el catálogo no llegó.
if (documentos.length === 0) {
  throw new Error(
    "La solicitud " + decision.codigo + " no tiene catálogo de documentos. Correr el radar o " +
    "cotizarla antes de avanzar: sin catálogo no se sabe qué carpetas crear."
  );
}

return [{ json: {
  codigo: decision.codigo,
  organismo: fila.organismo || "",
  documentos,
} }];
