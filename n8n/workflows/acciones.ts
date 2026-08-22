import { workflow, node, trigger, ifElse, expr } from '@n8n/workflow-sdk';

/**
 * Las acciones de escritura del panel: correr el radar, cotizar, generar, decidir y subir
 * archivos. Todas van detrás del login de n8n (`n8nOAuth2`), porque disparan trabajo real —
 * gastan cuota de la API de Mercado Público y escriben en el Drive del usuario.
 *
 * El cómputo pesado no vive acá: estas rutas disparan `.github/workflows/mp.yml`, que corre el
 * radar, el cotizador y el generador reales del repo. n8n orquesta y recuerda; el repo calcula.
 */

const TABLA = { __rl: true, mode: 'id', value: 'hZ7iJZTkt01XfRUc', cachedResultName: 'mp_solicitudes' };
const CRED_DRIVE = { googleDriveOAuth2Api: { id: 'sQ66G2AxFhuzw3sF', name: 'Google Drive OAuth2 API' } };
const CRED_GITHUB = { githubOAuth2Api: { id: 'RpMUyc4ecL1CPsy3', name: 'GitHub OAuth2 API' } };

const REPO_OWNER = { __rl: true, mode: 'name', value: 'keepsync-hub' };
const REPO_NOMBRE = { __rl: true, mode: 'name', value: 'ks-compra-agil' };
const WORKFLOW_MP = { __rl: true, mode: 'filename', value: 'mp.yml' };
const RAMA = { __rl: true, mode: 'name', value: 'claude/n8n-radar-cotizaciones-08vr00' };

// Todas las rutas de escritura llevan el mismo par: responder por nodo y exigir el login de n8n.
// Va repetido en cada webhook porque el SDK no admite Object.assign ni spread — el builder es un
// subconjunto muy acotado de TypeScript.

// ── POST /mp/radar ─────────────────────────────────────────────────────────────
const webRadar = trigger({
  type: 'n8n-nodes-base.webhook',
  version: 2.1,
  config: {
    name: 'POST /mp/radar',
    parameters: {
      httpMethod: 'POST',
      path: 'mp/radar',
      responseMode: 'responseNode',
      authentication: 'n8nOAuth2',
      requireExecuteAccess: true,
      options: {},
    },
  },
  output: [{ body: {} }],
});

const leerParaCooldown = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Leer la última corrida',
    alwaysOutputData: true,
    parameters: { resource: 'row', operation: 'get', dataTableId: TABLA, returnAll: true, options: {} },
  },
  output: [{ codigo: '1618-67-COT26', corridaId: 'abc', actualizado: '2026-08-22T00:00:00Z' }],
});

const calcularCooldown = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Freno de cuota',
    parameters: { mode: 'runOnceForAllItems', jsCode: __CHUNK:cooldown.js__ },
  },
  output: [{ disparar: true, espera: '' }],
});

const puedeCorrer = ifElse({
  version: 2.2,
  config: {
    name: '¿Se puede correr?',
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'loose' },
        conditions: [{ leftValue: expr('{{ $json.disparar }}'), operator: { type: 'boolean', operation: 'true', singleValue: true } }],
        combinator: 'and',
      },
    },
  },
});

const dispararRadar = node({
  type: 'n8n-nodes-base.github',
  version: 1.1,
  config: {
    name: 'Disparar el radar',
    parameters: {
      resource: 'workflow',
      operation: 'dispatch',
      // Explícito: el nodo GitHub asume 'accessToken' por defecto y entonces exige una credencial
      // githubApi que no tenemos. La que existe es OAuth2.
      authentication: 'oAuth2',
      owner: REPO_OWNER,
      repository: REPO_NOMBRE,
      workflowId: WORKFLOW_MP,
      ref: RAMA,
      inputs: expr('{{ JSON.stringify({ accion: "radar", corrida_id: $execution.id }) }}'),
    },
    credentials: CRED_GITHUB,
  },
  output: [{ ok: true }],
});

const responderRadar = node({
  type: 'n8n-nodes-base.respondToWebhook',
  version: 1.5,
  config: {
    name: 'Confirmar el radar',
    parameters: { respondWith: 'json', responseBody: '={{ { "ok": true, "accion": "radar" } }}', options: {} },
  },
});

const responderEspera = node({
  type: 'n8n-nodes-base.respondToWebhook',
  version: 1.5,
  config: {
    name: 'Responder que espere',
    parameters: { respondWith: 'json', responseBody: expr('{{ { "ok": false, "espera": $json.espera } }}'), options: {} },
  },
});

// ── POST /mp/cotizar ───────────────────────────────────────────────────────────
const webCotizar = trigger({
  type: 'n8n-nodes-base.webhook',
  version: 2.1,
  config: {
    name: 'POST /mp/cotizar',
    parameters: {
      httpMethod: 'POST',
      path: 'mp/cotizar',
      responseMode: 'responseNode',
      authentication: 'n8nOAuth2',
      requireExecuteAccess: true,
      options: {},
    },
  },
  output: [{ body: { codigo: '1618-67-COT26' } }],
});

const marcarCotizando = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Marcar cotizando',
    parameters: {
      resource: 'row',
      operation: 'update',
      dataTableId: TABLA,
      matchType: 'allConditions',
      filters: { conditions: [{ keyName: 'codigo', condition: 'eq', keyValue: expr('{{ $json.body.codigo }}') }] },
      columns: {
        mappingMode: 'defineBelow',
        matchingColumns: ['codigo'],
        value: { estado: 'cotizando', ultimoError: '', actualizado: expr('{{ $now.toISO() }}') },
        schema: [],
      },
      options: {},
    },
  },
  output: [{ id: 1 }],
});

const dispararCotizar = node({
  type: 'n8n-nodes-base.github',
  version: 1.1,
  config: {
    name: 'Disparar la cotización',
    parameters: {
      resource: 'workflow',
      operation: 'dispatch',
      // Explícito: el nodo GitHub asume 'accessToken' por defecto y entonces exige una credencial
      // githubApi que no tenemos. La que existe es OAuth2.
      authentication: 'oAuth2',
      owner: REPO_OWNER,
      repository: REPO_NOMBRE,
      workflowId: WORKFLOW_MP,
      ref: RAMA,
      // "ambos": el cotizador necesita data/<codigo>/detalle.json, que es efímero y lo repuebla
      // el radar en el mismo job.
      inputs: expr('{{ JSON.stringify({ accion: "ambos", codigos: $(\'POST /mp/cotizar\').first().json.body.codigo, corrida_id: $execution.id }) }}'),
    },
    credentials: CRED_GITHUB,
  },
  output: [{ ok: true }],
});

const responderCotizar = node({
  type: 'n8n-nodes-base.respondToWebhook',
  version: 1.5,
  config: {
    name: 'Confirmar la cotización',
    parameters: { respondWith: 'json', responseBody: '={{ { "ok": true, "accion": "cotizar" } }}', options: {} },
  },
});

// ── POST /mp/generar ───────────────────────────────────────────────────────────
const webGenerar = trigger({
  type: 'n8n-nodes-base.webhook',
  version: 2.1,
  config: {
    name: 'POST /mp/generar',
    parameters: {
      httpMethod: 'POST',
      path: 'mp/generar',
      responseMode: 'responseNode',
      authentication: 'n8nOAuth2',
      requireExecuteAccess: true,
      options: {},
    },
  },
  output: [{ body: { codigo: '1618-67-COT26' } }],
});

const marcarGenerando = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Marcar generando',
    parameters: {
      resource: 'row',
      operation: 'update',
      dataTableId: TABLA,
      matchType: 'allConditions',
      filters: { conditions: [{ keyName: 'codigo', condition: 'eq', keyValue: expr('{{ $json.body.codigo }}') }] },
      columns: {
        mappingMode: 'defineBelow',
        matchingColumns: ['codigo'],
        value: { estado: 'generando', ultimoError: '', actualizado: expr('{{ $now.toISO() }}') },
        schema: [],
      },
      options: {},
    },
  },
  output: [{ id: 1 }],
});

const dispararGenerar = node({
  type: 'n8n-nodes-base.github',
  version: 1.1,
  config: {
    name: 'Disparar la generación',
    parameters: {
      resource: 'workflow',
      operation: 'dispatch',
      // Explícito: el nodo GitHub asume 'accessToken' por defecto y entonces exige una credencial
      // githubApi que no tenemos. La que existe es OAuth2.
      authentication: 'oAuth2',
      owner: REPO_OWNER,
      repository: REPO_NOMBRE,
      workflowId: WORKFLOW_MP,
      ref: RAMA,
      inputs: expr('{{ JSON.stringify({ accion: "generar", codigos: $(\'POST /mp/generar\').first().json.body.codigo, corrida_id: $execution.id }) }}'),
    },
    credentials: CRED_GITHUB,
  },
  output: [{ ok: true }],
});

const responderGenerar = node({
  type: 'n8n-nodes-base.respondToWebhook',
  version: 1.5,
  config: {
    name: 'Confirmar la generación',
    parameters: { respondWith: 'json', responseBody: '={{ { "ok": true, "accion": "generar" } }}', options: {} },
  },
});

// ── POST /mp/decision ──────────────────────────────────────────────────────────
const webDecision = trigger({
  type: 'n8n-nodes-base.webhook',
  version: 2.1,
  config: {
    name: 'POST /mp/decision',
    parameters: {
      httpMethod: 'POST',
      path: 'mp/decision',
      responseMode: 'responseNode',
      authentication: 'n8nOAuth2',
      requireExecuteAccess: true,
      options: {},
    },
  },
  output: [{ body: { codigo: '1618-67-COT26', decision: 'avanzar', motivo: '' } }],
});

const registrarDecision = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Registrar la decisión',
    parameters: { mode: 'runOnceForAllItems', jsCode: __CHUNK:decision.js__ },
  },
  output: [{ codigo: '1618-67-COT26', decision: 'avanzar', avanza: true, motivoDecision: '', actualizado: '2026-08-22T00:00:00Z' }],
});

const guardarDecision = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Guardar la decisión',
    parameters: {
      resource: 'row',
      operation: 'update',
      dataTableId: TABLA,
      matchType: 'allConditions',
      filters: { conditions: [{ keyName: 'codigo', condition: 'eq', keyValue: expr('{{ $json.codigo }}') }] },
      columns: {
        mappingMode: 'defineBelow',
        matchingColumns: ['codigo'],
        value: {
          estado: expr('{{ $json.decision }}'),
          motivoDecision: expr('{{ $json.motivoDecision }}'),
          actualizado: expr('{{ $json.actualizado }}'),
        },
        schema: [],
      },
      options: {},
    },
  },
  output: [{ id: 1 }],
});

const avanza = ifElse({
  version: 2.2,
  config: {
    name: '¿Avanza?',
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'loose' },
        conditions: [{ leftValue: expr('{{ $(\'Registrar la decisión\').first().json.avanza }}'), operator: { type: 'boolean', operation: 'true', singleValue: true } }],
        combinator: 'and',
      },
    },
  },
});

const buscarFilaDecision = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Leer el catálogo de documentos',
    parameters: {
      resource: 'row',
      operation: 'get',
      dataTableId: TABLA,
      returnAll: true,
      filters: { conditions: [{ keyName: 'codigo', condition: 'eq', keyValue: expr('{{ $(\'Registrar la decisión\').first().json.codigo }}') }] },
      options: {},
    },
  },
  output: [{ codigo: '1618-67-COT26', organismo: 'Dipres', documentosJson: '[]' }],
});

const armarPedidoDrive = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Armar el pedido a Drive',
    parameters: { mode: 'runOnceForAllItems', jsCode: __CHUNK:pedido-drive.js__ },
  },
  output: [{ codigo: '1618-67-COT26', organismo: 'Dipres', documentos: [] }],
});

const crearCarpetas = node({
  type: 'n8n-nodes-base.executeWorkflow',
  version: 1.3,
  config: {
    name: 'Crear el árbol en Drive',
    parameters: {
      mode: 'once',
      workflowId: { __rl: true, mode: 'id', value: 'do3woax6AGPYxEAN', cachedResultName: 'MP · Carpetas Drive' },
      workflowInputs: { mappingMode: 'autoMapInputData', value: null, schema: [] },
      options: { waitForSubWorkflow: true },
    },
  },
  output: [{ codigo: '1618-67-COT26', driveFolderId: 'x', driveFolderUrl: 'https://drive.google.com/…' }],
});

const guardarDrive = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Guardar la carpeta',
    parameters: {
      resource: 'row',
      operation: 'update',
      dataTableId: TABLA,
      matchType: 'allConditions',
      filters: { conditions: [{ keyName: 'codigo', condition: 'eq', keyValue: expr('{{ $json.codigo }}') }] },
      columns: {
        mappingMode: 'defineBelow',
        matchingColumns: ['codigo'],
        value: {
          driveFolderId: expr('{{ $json.driveFolderId }}'),
          driveFolderUrl: expr('{{ $json.driveFolderUrl }}'),
          actualizado: expr('{{ $now.toISO() }}'),
        },
        schema: [],
      },
      options: {},
    },
  },
  output: [{ id: 1 }],
});

const responderAvanzar = node({
  type: 'n8n-nodes-base.respondToWebhook',
  version: 1.5,
  config: {
    name: 'Confirmar que avanza',
    parameters: {
      respondWith: 'json',
      responseBody: expr('{{ { "ok": true, "decision": "avanzar", "driveFolderUrl": $json.driveFolderUrl } }}'),
      options: {},
    },
  },
});

const responderRechazo = node({
  type: 'n8n-nodes-base.respondToWebhook',
  version: 1.5,
  config: {
    name: 'Confirmar el rechazo',
    parameters: { respondWith: 'json', responseBody: '={{ { "ok": true, "decision": "rechazado" } }}', options: {} },
  },
});

// ── POST /mp/subir ─────────────────────────────────────────────────────────────
// Mismo patrón que el workflow "Ventas · Cargar PDF a Drive", que ya corre en producción.
const webSubir = trigger({
  type: 'n8n-nodes-base.webhook',
  version: 2.1,
  config: {
    name: 'POST /mp/subir',
    parameters: {
      httpMethod: 'POST',
      path: 'mp/subir',
      responseMode: 'responseNode',
      authentication: 'n8nOAuth2',
      requireExecuteAccess: true,
      options: { binaryData: true, binaryPropertyName: 'data' },
    },
  },
  output: [{ query: { folderId: 'x', nombre: 'titulo.pdf' } }],
});

const subirArchivo = node({
  type: 'n8n-nodes-base.googleDrive',
  version: 3,
  config: {
    name: 'Subir a la carpeta del documento',
    parameters: {
      resource: 'file',
      operation: 'upload',
      inputDataFieldName: 'data0',
      name: expr('{{ $json.query.nombre }}'),
      driveId: { __rl: true, mode: 'list', value: 'My Drive' },
      folderId: { __rl: true, mode: 'id', value: expr('{{ $json.query.folderId }}') },
      options: {},
    },
    credentials: CRED_DRIVE,
  },
  output: [{ id: 'archivo-id', name: 'titulo.pdf' }],
});

const responderSubir = node({
  type: 'n8n-nodes-base.respondToWebhook',
  version: 1.5,
  config: {
    name: 'Confirmar la subida',
    parameters: { respondWith: 'json', responseBody: expr('{{ { "ok": true, "id": $json.id } }}'), options: {} },
  },
});

export default workflow('mp-acciones', 'MP · Acciones')
  .add(webRadar)
  .to(leerParaCooldown)
  .to(calcularCooldown)
  .to(puedeCorrer.onTrue(dispararRadar.to(responderRadar)).onFalse(responderEspera))
  .add(webCotizar)
  .to(marcarCotizando)
  .to(dispararCotizar)
  .to(responderCotizar)
  .add(webGenerar)
  .to(marcarGenerando)
  .to(dispararGenerar)
  .to(responderGenerar)
  .add(webDecision)
  .to(registrarDecision)
  .to(guardarDecision)
  .to(avanza
    .onTrue(buscarFilaDecision.to(armarPedidoDrive).to(crearCarpetas).to(guardarDrive).to(responderAvanzar))
    .onFalse(responderRechazo))
  .add(webSubir)
  .to(subirArchivo)
  .to(responderSubir);
