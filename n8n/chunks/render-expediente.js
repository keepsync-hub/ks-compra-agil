const ASSETS = "https://keepsync-hub.github.io/ks-compra-agil/panel";

const fila = $("Buscar la solicitud").first().json;
const carpetas = $("Armar la consulta").first().json.carpetas || [];
const archivos = $input.all().map(i => i.json).filter(a => a && a.id);

let documentos = [];
try { documentos = JSON.parse(fila.documentosJson || "[]"); } catch (e) { documentos = []; }

// Los entregables terminados viven en _ENTREGABLES y se emparejan con su carpeta por el prefijo
// NN, no por el nombre completo: así nadie tiene que reescribir a mano el nombre largo del
// documento para que el sistema lo reconozca.
const entregablesFolder = carpetas.find(c => c.name === "_ENTREGABLES");
const idPorNombre = {};
for (const c of carpetas) idPorNombre[c.name] = c.id;

const porCarpeta = {};
for (const a of archivos) {
  const padre = (a.parents && a.parents[0]) || a.parentId || null;
  if (!padre) continue;
  if (!porCarpeta[padre]) porCarpeta[padre] = [];
  porCarpeta[padre].push({ id: a.id, name: a.name });
}
const enEntregables = entregablesFolder ? (porCarpeta[entregablesFolder.id] || []) : [];

const docs = documentos.map(d => {
  const folderId = idPorNombre[d.carpeta] || null;
  const insumos = folderId ? (porCarpeta[folderId] || []) : [];
  const entregable = enEntregables.find(f => String(f.name).indexOf(d.prefijo + " - ") === 0) || null;
  return {
    prefijo: d.prefijo, documento: d.documento, tipo: d.tipo, carpeta: d.carpeta,
    folderId, archivos: insumos, entregable, listo: Boolean(entregable),
  };
});

const datos = Buffer.from(JSON.stringify({
  codigo: fila.codigo, nombre: fila.nombre, organismo: fila.organismo,
  topeClp: fila.topeClp, totalClp: fila.totalClp, fechaCierre: fila.fechaCierre,
  driveFolderUrl: fila.driveFolderUrl,
  catalogoProvisional: Boolean(fila.catalogoProvisional),
  documentos: docs,
}), "utf-8").toString("base64");

const html = `<!doctype html>
<html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Expediente ${fila.codigo} — KeepSync</title>
<link rel="stylesheet" href="${ASSETS}/panel.css">
<style>body{background:#0E0E17;color:#fff;font-family:Helvetica,Arial,sans-serif;margin:0}
.wrap{max-width:900px}</style>
</head><body>
<header><div class="wrap"><a class="back" href="panel">← Volver al panel</a><div id="cab"></div></div></header>
<main class="wrap">
  <div class="aviso">
    <b>Antes de presentar, dos cosas que este expediente no puede resolver.</b><br>
    Ninguna oferta designa relator/a —y el TDR exige título, CV y certificados verificables— y
    sigue sin confirmarse si KeepSync es OTEC registrada en SENCE. Mientras sigan abiertas, el
    expediente no está completo por más que todos los documentos aparezcan listos.
  </div>
  <div id="docs">Cargando…</div>
  <div class="pie-acciones">
    <button class="btn grande" id="btn-generar">Generar los documentos</button>
    <div class="nota" id="nota-generar"></div>
  </div>
</main>
<div id="msg"></div>
<script id="__data" type="application/json">${datos}</script>
<script src="${ASSETS}/expediente.js"></script>
</body></html>`;

return [{ json: { html } }];
