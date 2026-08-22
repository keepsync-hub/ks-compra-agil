import { workflow, node, trigger, ifElse, expr } from '@n8n/workflow-sdk';

const RAIZ = 'KeepSync - Mercado Público - Panchito';
const CRED_DRIVE = { googleDriveOAuth2Api: { id: 'sQ66G2AxFhuzw3sF', name: 'Google Drive OAuth2 API' } };

const recibirPedido = trigger({
  type: 'n8n-nodes-base.executeWorkflowTrigger',
  version: 1.2,
  config: { name: 'Recibir pedido', parameters: { inputSource: 'passthrough' } },
  output: [{ codigo: '1618-67-COT26', organismo: 'Dipres', documentos: [] }],
});

const buscarRaiz = node({
  type: 'n8n-nodes-base.googleDrive',
  version: 3,
  config: {
    name: 'Buscar carpeta raíz',
    alwaysOutputData: true,
    parameters: {
      resource: 'fileFolder',
      operation: 'search',
      searchMethod: 'name',
      queryString: RAIZ,
      returnAll: true,
      filter: { whatToSearch: 'folders', folderId: { __rl: true, mode: 'list', value: 'root' } },
    },
    credentials: CRED_DRIVE,
  },
  output: [{ id: '', name: '' }],
});

const hayRaiz = ifElse({
  version: 2.2,
  config: {
    name: '¿Ya existe la raíz?',
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'loose' },
        conditions: [{ leftValue: expr('{{ $json.id }}'), operator: { type: 'string', operation: 'notEmpty' } }],
        combinator: 'and',
      },
    },
  },
});

const crearRaiz = node({
  type: 'n8n-nodes-base.googleDrive',
  version: 3,
  config: {
    name: 'Crear carpeta raíz',
    parameters: {
      resource: 'folder',
      operation: 'create',
      name: RAIZ,
      folderId: { __rl: true, mode: 'list', value: 'root' },
      options: {},
    },
    credentials: CRED_DRIVE,
  },
  output: [{ id: 'raiz-id', name: RAIZ }],
});

const idRaiz = node({
  type: 'n8n-nodes-base.set',
  version: 3.4,
  config: {
    name: 'Id de la raíz',
    parameters: {
      mode: 'manual',
      assignments: {
        assignments: [{ id: 'raiz', name: 'raizId', value: expr('{{ $json.id }}'), type: 'string' }],
      },
    },
  },
  output: [{ raizId: 'raiz-id' }],
});

const buscarCarpetaCodigo = node({
  type: 'n8n-nodes-base.googleDrive',
  version: 3,
  config: {
    name: 'Buscar carpeta del código',
    alwaysOutputData: true,
    parameters: {
      resource: 'fileFolder',
      operation: 'search',
      searchMethod: 'query',
      queryString: expr(
        '{{ "name = \'" + $(\'Recibir pedido\').first().json.codigo + " — " + $(\'Recibir pedido\').first().json.organismo + "\' and \'" + $json.raizId + "\' in parents and mimeType = \'application/vnd.google-apps.folder\' and trashed = false" }}',
      ),
      returnAll: true,
      filter: {},
    },
    credentials: CRED_DRIVE,
  },
  output: [{ id: '', name: '' }],
});

const hayCarpetaCodigo = ifElse({
  version: 2.2,
  config: {
    name: '¿Ya existe la del código?',
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'loose' },
        conditions: [{ leftValue: expr('{{ $json.id }}'), operator: { type: 'string', operation: 'notEmpty' } }],
        combinator: 'and',
      },
    },
  },
});

const crearCarpetaCodigo = node({
  type: 'n8n-nodes-base.googleDrive',
  version: 3,
  config: {
    name: 'Crear carpeta del código',
    parameters: {
      resource: 'folder',
      operation: 'create',
      name: expr('{{ $(\'Recibir pedido\').first().json.codigo }} — {{ $(\'Recibir pedido\').first().json.organismo }}'),
      folderId: { __rl: true, mode: 'id', value: expr('{{ $(\'Id de la raíz\').first().json.raizId }}') },
      options: {},
    },
    credentials: CRED_DRIVE,
  },
  output: [{ id: 'codigo-id', name: '1618-67-COT26 — Dipres' }],
});

const idCarpeta = node({
  type: 'n8n-nodes-base.set',
  version: 3.4,
  config: {
    name: 'Id de la carpeta del código',
    parameters: {
      mode: 'manual',
      assignments: {
        assignments: [{ id: 'carpeta', name: 'carpetaId', value: expr('{{ $json.id }}'), type: 'string' }],
      },
    },
  },
  output: [{ carpetaId: 'codigo-id' }],
});

const listarHijos = node({
  type: 'n8n-nodes-base.googleDrive',
  version: 3,
  config: {
    name: 'Listar lo que ya hay',
    alwaysOutputData: true,
    parameters: {
      resource: 'fileFolder',
      operation: 'search',
      searchMethod: 'query',
      queryString: expr(
        '{{ "\'" + $json.carpetaId + "\' in parents and mimeType = \'application/vnd.google-apps.folder\' and trashed = false" }}',
      ),
      returnAll: true,
      filter: {},
    },
    credentials: CRED_DRIVE,
  },
  output: [{ id: '', name: '' }],
});

const calcularFaltantes = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Qué falta crear',
    parameters: {
      mode: 'runOnceForAllItems',
      jsCode: __CHUNK:faltantes.js__,
    },
  },
  output: [{ nombre: '_ENTREGABLES', carpetaId: 'codigo-id', __vacio: false }],
});

const hayFaltantes = ifElse({
  version: 2.2,
  config: {
    name: '¿Falta alguna?',
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'loose' },
        conditions: [{ leftValue: expr('{{ $json.__vacio }}'), operator: { type: 'boolean', operation: 'true', singleValue: true } }],
        combinator: 'and',
      },
    },
  },
});

const crearFaltantes = node({
  type: 'n8n-nodes-base.googleDrive',
  version: 3,
  config: {
    name: 'Crear las que faltan',
    parameters: {
      resource: 'folder',
      operation: 'create',
      name: expr('{{ $json.nombre }}'),
      folderId: { __rl: true, mode: 'id', value: expr('{{ $json.carpetaId }}') },
      options: {},
    },
    credentials: CRED_DRIVE,
  },
  output: [{ id: 'sub-id', name: '_ENTREGABLES' }],
});

const armarResumen = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Resumen del árbol',
    parameters: {
      mode: 'runOnceForAllItems',
      jsCode: __CHUNK:resumen-drive.js__,
    },
  },
  output: [{ codigo: '1618-67-COT26', driveFolderId: 'codigo-id', carpetas: [] }],
});

export default workflow('mp-carpetas-drive', 'MP · Carpetas Drive')
  .add(recibirPedido)
  .to(buscarRaiz)
  .to(hayRaiz.onTrue(idRaiz).onFalse(crearRaiz.to(idRaiz)))
  .add(idRaiz)
  .to(buscarCarpetaCodigo)
  .to(hayCarpetaCodigo.onTrue(idCarpeta).onFalse(crearCarpetaCodigo.to(idCarpeta)))
  .add(idCarpeta)
  .to(listarHijos)
  .to(calcularFaltantes)
  .to(hayFaltantes.onTrue(armarResumen).onFalse(crearFaltantes.to(armarResumen)));
