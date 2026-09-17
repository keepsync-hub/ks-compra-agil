const ASSETS = "https://keepsync-hub.github.io/ks-compra-agil/panel";

const fila = $("Buscar la solicitud").first().json;
const carpetas = $("Armar la consulta").first().json.carpetas || [];
const archivos = $input.all().map(i => i.json).filter(a => a && a.id);

let documentos = [];
try { documentos = JSON.parse(fila.documentosJson || "[]"); } catch (e) { documentos = []; }

// Los entregables terminados viven en _ENTREGABLES y se emparejan con su carpeta por el prefijo
// NN, no por el nombre completo: así nadie tiene que reescribir a mano el nombre largo del
// documento para que el sistema lo reconozca.
//
// Pero "listo" no significa lo mismo para las tres naturalezas de documento. Un `acopio` —título,
// CV, certificado, orden de compra— lo emite un tercero y nadie lo va a generar nunca: el archivo
// que la persona sube a su carpeta ES el documento. Exigirle un entregable en _ENTREGABLES era
// exigir algo que por diseño no puede existir, y como la mitad de los documentos que piden estas
// compras son de acopio, el KPI "X de N listos" estaba topeado por construcción.
const entregablesFolder = carpetas.find(c => c.name === "_ENTREGABLES");
const idPorNombre = {};
for (const c of carpetas) idPorNombre[c.name] = c.id;

const porCarpeta = {};
for (const a of archivos) {
  const padre = (a.parents && a.parents[0]) || a.parentId || null;
  if (!padre) continue;
  if (!porCarpeta[padre]) porCarpeta[padre] = [];
  // `modifiedTime` viaja porque entregableDe() desempata con él. El nodo pide fields '*', así que
  // llega; si no llegara, el desempate cae en el orden de la consulta y no se rompe nada.
  porCarpeta[padre].push({ id: a.id, name: a.name, modifiedTime: a.modifiedTime, createdTime: a.createdTime });
}
const enEntregables = entregablesFolder ? (porCarpeta[entregablesFolder.id] || []) : [];

/** El más reciente de los que matchean el prefijo. Drive `file:upload` no es upsert: generar dos
 *  veces deja dos "NN - …" en _ENTREGABLES, y un `.find()` devolvería el viejo. */
function entregableDe(prefijo) {
  const candidatos = enEntregables.filter(f => String(f.name).indexOf(prefijo + " - ") === 0);
  if (candidatos.length === 0) return null;
  let mejor = candidatos[0];
  for (const c of candidatos) {
    const t = Date.parse(c.modifiedTime || c.createdTime || "");
    const tMejor = Date.parse(mejor.modifiedTime || mejor.createdTime || "");
    if (!isNaN(t) && (isNaN(tMejor) || t > tMejor)) mejor = c;
  }
  return mejor;
}

const docs = documentos.map(d => {
  const folderId = idPorNombre[d.carpeta] || null;
  const insumos = folderId ? (porCarpeta[folderId] || []) : [];
  const entregable = entregableDe(d.prefijo);

  // Mismo criterio con que generar-documento.ts decide `bloqueado`: un `formulario` sin plantilla
  // declarada en config/capacitaciones.json no se puede rellenar, y el generador no improvisa un
  // documento propio. La página lo necesita para no prometer que "Generar" lo produce.
  const puedeGenerarse = d.tipo === "generable" || (d.tipo === "formulario" && Boolean(d.plantilla));

  return {
    prefijo: d.prefijo, documento: d.documento, tipo: d.tipo, carpeta: d.carpeta,
    folderId, archivos: insumos, entregable, puedeGenerarse,
    listo: Boolean(entregable) || (d.tipo === "acopio" && insumos.length > 0),
  };
});

const datos = Buffer.from(JSON.stringify({
  codigo: fila.codigo, nombre: fila.nombre, organismo: fila.organismo,
  topeClp: fila.topeClp, totalClp: fila.totalClp, fechaCierre: fila.fechaCierre,
  driveFolderUrl: fila.driveFolderUrl,
  // La bandeja de revisión, para que la página pueda ofrecer subir ahí lo que no se puede generar.
  entregablesId: entregablesFolder ? entregablesFolder.id : null,
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
    KeepSync <b>no</b> es OTEC registrada en SENCE, lo que deja sin sustento la exención de IVA
    del art. 13 N°4 donde el organismo presupuesta exento. Mientras siga así, el expediente no
    está completo por más que todos los documentos aparezcan listos.
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
