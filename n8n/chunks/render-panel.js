// El shell lo sirve n8n (con su login delante); el CSS y el JS los sirve GitHub Pages desde
// docs/panel/, versionados y revisables en el diff. <link> y <script src> no pasan por CORS, y
// los datos nunca salen de n8n: van incrustados acá en base64.
const ASSETS = "https://keepsync-hub.github.io/ks-compra-agil/panel";

const filas = $input.all().map(i => i.json).filter(f => f && f.codigo);

// Lo que cierra antes, primero: es el orden en que hay que decidir.
filas.sort((a, b) => String(a.fechaCierre || "").localeCompare(String(b.fechaCierre || "")));

const datos = Buffer.from(JSON.stringify(filas), "utf-8").toString("base64");

const html = `<!doctype html>
<html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Panel de Compras Ágiles — KeepSync</title>
<link rel="stylesheet" href="${ASSETS}/panel.css">
<style>body{background:#0E0E17;color:#fff;font-family:Helvetica,Arial,sans-serif;margin:0}</style>
</head><body>
<header><div class="wrap">
  <h1>Compras Ágiles — panel operativo</h1>
  <p class="sub">Lo que el radar encontró, con su estado de trabajo. Nada de lo que hay acá se
    envía a mercadopublico.cl: el envío final lo hace una persona.</p>
  <div class="barra">
    <button class="btn" id="btn-radar">Correr el radar ahora</button>
    <a class="btn sec" href="https://keepsync-hub.github.io/ks-compra-agil/">Página pública</a>
    <span class="sub" id="estado-corrida"></span>
  </div>
</div></header>
<main class="wrap">
  <div class="aviso">
    <b>Dos cosas bloquean cualquier expediente de capacitación, y este panel no las resuelve.</b><br>
    (1) Ninguna oferta designa relator/a, y los seis TDR exigen título, CV y certificados
    verificables. (2) Sigue sin confirmarse si KeepSync es OTEC registrada en SENCE, de lo que
    dependen puntaje directo en Subtransportes y la exención de IVA con que Dipres presupuesta.
  </div>
  <div class="grid" id="grid">Cargando…</div>
</main>
<footer class="wrap">Estado del flujo en la tabla <code>mp_solicitudes</code> de n8n.
  El código vive en <a href="https://github.com/keepsync-hub/ks-compra-agil">keepsync-hub/ks-compra-agil</a>.</footer>
<div id="msg"></div>
<script id="__data" type="application/json">${datos}</script>
<script src="${ASSETS}/panel.js"></script>
</body></html>`;

return [{ json: { html } }];
