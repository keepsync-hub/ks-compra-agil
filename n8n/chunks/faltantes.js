const pedido = $("Recibir pedido").first().json;
const carpetaId = $("Id de la carpeta del código").first().json.carpetaId;
const existentes = new Set($input.all().map(i => (i.json.name || "").trim()).filter(Boolean));

// _ENTREGABLES primero: es la bandeja de revisión donde va el documento terminado, y el
// emparejamiento con la carpeta de cada documento es por el prefijo NN del nombre.
const quiero = ["_ENTREGABLES"];
for (const d of (pedido.documentos || [])) quiero.push(d.carpeta);

// Drive admite dos carpetas con el mismo nombre en el mismo padre: sin este diff, cada clic en
// "Avanzar" crearía un árbol duplicado en silencio.
const faltan = quiero.filter(n => n && !existentes.has(n));
if (faltan.length === 0) return [{ json: { __vacio: true, carpetaId } }];
return faltan.map(nombre => ({ json: { nombre, carpetaId } }));
