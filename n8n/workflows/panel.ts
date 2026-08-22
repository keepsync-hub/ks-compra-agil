import { workflow, node, trigger, expr, newCredential } from '@n8n/workflow-sdk';

/**
 * Las páginas del panel operativo y la ingesta de resultados.
 *
 * Las páginas se sirven desde n8n en vez de incrustarse en GitHub Pages: así quedan detrás del
 * login real de n8n, sin una clave escondida en una página pública, sin CORS y sin JS a mano
 * dentro de docs/index.html. En la página pública queda un botón que apunta acá.
 */

const TABLA = { __rl: true, mode: 'id', value: 'hZ7iJZTkt01XfRUc', cachedResultName: 'mp_solicitudes' };
const CRED_DRIVE = { googleDriveOAuth2Api: { id: 'sQ66G2AxFhuzw3sF', name: 'Google Drive OAuth2 API' } };

// ── Ruta 1: la página del panel ────────────────────────────────────────────────
const webPanel = trigger({
  type: 'n8n-nodes-base.webhook',
  version: 2.1,
  config: {
    name: 'GET /mp/panel',
    parameters: {
      httpMethod: 'GET',
      path: 'mp/panel',
      responseMode: 'responseNode',
      authentication: 'n8nOAuth2',
      requireExecuteAccess: true,
      options: {},
    },
  },
  output: [{ query: { accion: '' } }],
});

const leerSolicitudes = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Leer todas las solicitudes',
    alwaysOutputData: true,
    parameters: { resource: 'row', operation: 'get', dataTableId: TABLA, returnAll: true, options: {} },
  },
  output: [{ codigo: '1618-67-COT26', estado: 'nuevo', fechaCierre: '2026-08-25 11:00' }],
});

const armarPanel = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Armar la página del panel',
    parameters: { mode: 'runOnceForAllItems', jsCode: __CHUNK:render-panel.js__ },
  },
  output: [{ html: '<!doctype html>…' }],
});

const responderPanel = node({
  type: 'n8n-nodes-base.respondToWebhook',
  version: 1.5,
  config: {
    name: 'Responder el panel',
    parameters: {
      respondWith: 'text',
      responseBody: expr('{{ $json.html }}'),
      options: { responseHeaders: { entries: [{ name: 'Content-Type', value: 'text/html; charset=utf-8' }] } },
    },
  },
});

// ── Ruta 2: la página de expediente ────────────────────────────────────────────
const webExpediente = trigger({
  type: 'n8n-nodes-base.webhook',
  version: 2.1,
  config: {
    name: 'GET /mp/expediente',
    parameters: {
      httpMethod: 'GET',
      path: 'mp/expediente',
      responseMode: 'responseNode',
      authentication: 'n8nOAuth2',
      requireExecuteAccess: true,
      options: {},
    },
  },
  output: [{ query: { codigo: '1618-67-COT26' } }],
});

const buscarSolicitud = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Buscar la solicitud',
    alwaysOutputData: true,
    parameters: {
      resource: 'row',
      operation: 'get',
      dataTableId: TABLA,
      returnAll: true,
      filters: {
        conditions: [{ keyName: 'codigo', condition: 'eq', keyValue: expr('{{ $json.query.codigo }}') }],
      },
      options: {},
    },
  },
  output: [{ codigo: '1618-67-COT26', driveFolderId: 'carpeta-id', documentosJson: '[]' }],
});

const listarCarpetas = node({
  type: 'n8n-nodes-base.googleDrive',
  version: 3,
  config: {
    name: 'Listar carpetas del expediente',
    alwaysOutputData: true,
    parameters: {
      resource: 'fileFolder',
      operation: 'search',
      searchMethod: 'query',
      queryString: expr(
        '{{ "\'" + ($json.driveFolderId || "sin-carpeta") + "\' in parents and mimeType = \'application/vnd.google-apps.folder\' and trashed = false" }}',
      ),
      returnAll: true,
      filter: {},
      options: { fields: ['id', 'name'] },
    },
    credentials: CRED_DRIVE,
  },
  output: [{ id: 'sub-id', name: '01 - Anexo N°1' }],
});

const armarConsulta = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Armar la consulta',
    parameters: { mode: 'runOnceForAllItems', jsCode: __CHUNK:query-hijos.js__ },
  },
  output: [{ query: "'x' in parents and trashed = false", carpetas: [] }],
});

const listarArchivos = node({
  type: 'n8n-nodes-base.googleDrive',
  version: 3,
  config: {
    name: 'Listar los archivos',
    alwaysOutputData: true,
    parameters: {
      resource: 'fileFolder',
      operation: 'search',
      searchMethod: 'query',
      queryString: expr('{{ $json.query }}'),
      returnAll: true,
      filter: {},
      options: { fields: ['id', 'name'] },
    },
    credentials: CRED_DRIVE,
  },
  output: [{ id: 'archivo-id', name: 'titulo.pdf', parents: ['sub-id'] }],
});

const armarExpediente = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Armar la página del expediente',
    parameters: { mode: 'runOnceForAllItems', jsCode: __CHUNK:render-expediente.js__ },
  },
  output: [{ html: '<!doctype html>…' }],
});

const responderExpediente = node({
  type: 'n8n-nodes-base.respondToWebhook',
  version: 1.5,
  config: {
    name: 'Responder el expediente',
    parameters: {
      respondWith: 'text',
      responseBody: expr('{{ $json.html }}'),
      options: { responseHeaders: { entries: [{ name: 'Content-Type', value: 'text/html; charset=utf-8' }] } },
    },
  },
});

// ── Ruta 3: ingesta desde GitHub Actions ───────────────────────────────────────
const webIngesta = trigger({
  type: 'n8n-nodes-base.webhook',
  version: 2.1,
  config: {
    name: 'POST /mp/ingesta',
    parameters: {
      httpMethod: 'POST',
      path: 'mp/ingesta',
      responseMode: 'responseNode',
      authentication: 'headerAuth',
      options: {},
    },
    // Credencial propia, no una prestada: n8n la crea vacía y el usuario le pone la cabecera
    // X-KS-Clave con el mismo valor que el secreto N8N_CLAVE del repo.
    credentials: { httpHeaderAuth: newCredential('KS Ingesta MP') },
  },
  output: [{ body: { tipo: 'radar', solicitudes: [] } }],
});

const normalizarIngesta = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Normalizar el payload',
    parameters: { mode: 'runOnceForAllItems', jsCode: __CHUNK:ingesta.js__ },
  },
  output: [{ codigo: '1618-67-COT26', actualizado: '2026-08-22T00:00:00Z' }],
});

const guardarFilas = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Guardar en mp_solicitudes',
    parameters: {
      resource: 'row',
      operation: 'upsert',
      dataTableId: TABLA,
      matchType: 'allConditions',
      filters: {
        conditions: [{ keyName: 'codigo', condition: 'eq', keyValue: expr('{{ $json.codigo }}') }],
      },
      columns: { mappingMode: 'autoMapInputData', value: null, matchingColumns: ['codigo'], schema: [] },
      options: {},
    },
  },
  output: [{ id: 1 }],
});

const responderIngesta = node({
  type: 'n8n-nodes-base.respondToWebhook',
  version: 1.5,
  config: {
    name: 'Confirmar la ingesta',
    parameters: { respondWith: 'json', responseBody: '={{ { "ok": true } }}', options: {} },
  },
});

export default workflow('mp-panel', 'MP · Panel')
  .add(webPanel)
  .to(leerSolicitudes)
  .to(armarPanel)
  .to(responderPanel)
  .add(webExpediente)
  .to(buscarSolicitud)
  .to(listarCarpetas)
  .to(armarConsulta)
  .to(listarArchivos)
  .to(armarExpediente)
  .to(responderExpediente)
  .add(webIngesta)
  .to(normalizarIngesta)
  .to(guardarFilas)
  .to(responderIngesta);
