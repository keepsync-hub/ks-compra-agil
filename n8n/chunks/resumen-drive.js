const pedido = $("Recibir pedido").first().json;
const carpetaId = $("Id de la carpeta del código").first().json.carpetaId;
const yaEstaban = $("Listar lo que ya hay").all().map(i => ({ id: i.json.id, name: i.json.name }));

let creadas = [];
try {
  creadas = $("Crear las que faltan").all().map(i => ({ id: i.json.id, name: i.json.name }));
} catch (e) {
  creadas = [];   // no se creó ninguna: el árbol ya estaba completo
}

const porNombre = {};
for (const c of yaEstaban.concat(creadas)) {
  if (c && c.name) porNombre[String(c.name).trim()] = c.id;
}

const carpetas = (pedido.documentos || []).map(d => ({
  prefijo: d.prefijo,
  documento: d.documento,
  tipo: d.tipo,
  carpeta: d.carpeta,
  folderId: porNombre[d.carpeta] || null,
  url: porNombre[d.carpeta] ? "https://drive.google.com/drive/folders/" + porNombre[d.carpeta] : null,
}));

return [{ json: {
  codigo: pedido.codigo,
  driveFolderId: carpetaId,
  driveFolderUrl: "https://drive.google.com/drive/folders/" + carpetaId,
  entregablesId: porNombre["_ENTREGABLES"] || null,
  carpetas,
  creadas: creadas.length,
} }];
