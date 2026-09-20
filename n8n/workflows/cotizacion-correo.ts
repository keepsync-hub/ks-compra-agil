import { workflow, node, trigger, expr } from '@n8n/workflow-sdk';

/**
 * Manda por correo una cotización ya generada por el repo, con el PDF adjunto.
 *
 * Por qué pasa por n8n y no por el MCP de Gmail: ese MCP no adjunta archivos. Y por qué el PDF
 * viene de GitHub y no de un webhook: el archivo ya está versionado en el repo (`output/` se
 * versiona a propósito), así que el nodo GitHub lo trae con la credencial que el panel ya usa
 * para disparar `mp.yml` — sin subir el binario a ningún lado ni abrir una ruta pública nueva.
 *
 * Es el ÚNICO workflow de este repo que no es del panel operativo, y por eso se crea nuevo en vez
 * de actualizar uno de los tres (`n8n/README.md`: "jamás create_workflow_from_code" protege las
 * URL de webhook del panel; acá no hay webhook que romper — el disparador es manual).
 *
 * Para reusarlo con otra cotización se edita solo "Datos del envío": destinatario, asunto, cuerpo,
 * la ruta del PDF en el repo y la rama donde está.
 *
 * Guardrail que este flujo no relaja: lo dispara una persona desde n8n (o el agente cuando el
 * usuario lo pide explícitamente, como el 2026-09-20). Nada manda correo solo.
 */

const CRED_GITHUB = { githubOAuth2Api: { id: 'RpMUyc4ecL1CPsy3', name: 'GitHub OAuth2 API' } };
// La misma credencial que ya manda los correos de los webinars y de los leads del sitio.
const CRED_GMAIL = { gmailOAuth2: { id: 'cYhcyiH1LcyrXUWz', name: 'Gmail OAuth2 API' } };

const REPO_OWNER = { __rl: true, mode: 'name', value: 'keepsync-hub' };
const REPO_NOMBRE = { __rl: true, mode: 'name', value: 'ks-compra-agil' };

const CUERPO =
  '<div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#2f2a22;line-height:1.6;max-width:560px">' +
    '<p>Estimado José,</p>' +
    '<p>Junto con saludar, adjunto la cotización <strong>Q-20260920-KOMPU</strong> por los servicios en línea que KeepSync contrata y administra para Kompu, correspondientes a un mes de servicio:</p>' +
    '<table style="border-collapse:collapse;width:100%;font-size:14px">' +
      '<tr><td style="padding:6px 0">Anthropic (Claude)</td><td style="padding:6px 0;text-align:right">$6.893</td></tr>' +
      '<tr><td style="padding:6px 0">Hostinger (hosting web)</td><td style="padding:6px 0;text-align:right">$15.153</td></tr>' +
      '<tr><td style="padding:6px 0">GitHub</td><td style="padding:6px 0;text-align:right">$4.634</td></tr>' +
      '<tr><td style="padding:6px 0;border-top:1px solid #e5ded0;color:#6a6255">Neto</td><td style="padding:6px 0;border-top:1px solid #e5ded0;text-align:right;color:#6a6255">$26.680</td></tr>' +
      '<tr><td style="padding:6px 0;color:#6a6255">IVA 19%</td><td style="padding:6px 0;text-align:right;color:#6a6255">$5.069</td></tr>' +
      '<tr><td style="padding:6px 0"><strong>Total</strong></td><td style="padding:6px 0;text-align:right"><strong>$31.749</strong></td></tr>' +
    '</table>' +
    '<p>Los valores están en pesos chilenos e incluyen el alta de las cuentas, su administración y el soporte de primer nivel. La cotización tiene una validez de 30 días; el valor puede cambiar de acuerdo al tipo de cambio vigente al momento de la facturación.</p>' +
    '<p>Quedo atento a cualquier consulta o ajuste que necesites.</p>' +
    '<p>Saludos cordiales,<br />Cristian Molina<br />KeepSync SpA</p>' +
  '</div>';

const inicio = trigger({
  type: 'n8n-nodes-base.manualTrigger',
  version: 1,
  config: { name: 'Enviar la cotización', position: [0, 0] },
  output: [{}],
});

const datos = node({
  type: 'n8n-nodes-base.set',
  version: 3.5,
  config: {
    name: 'Datos del envío',
    notes: 'Lo único que se edita para mandar otra cotización.',
    position: [220, 0],
    parameters: {
      mode: 'manual',
      includeOtherFields: false,
      assignments: {
        assignments: [
          { id: 'destinatario', name: 'destinatario', value: 'jurrea@kompu.cl', type: 'string' },
          {
            id: 'asunto',
            name: 'asunto',
            value: 'Cotización Q-20260920-KOMPU — Anthropic, Hostinger y GitHub',
            type: 'string',
          },
          {
            id: 'archivo',
            name: 'archivo',
            value: 'output/cotizaciones-standalone/Q-20260920-KOMPU-AnthropicHostingerYGitHub.pdf',
            type: 'string',
          },
          { id: 'rama', name: 'rama', value: 'claude/kind-brown-c7ic8f', type: 'string' },
          { id: 'cuerpo', name: 'cuerpo', value: CUERPO, type: 'string' },
        ],
      },
    },
  },
  output: [{ destinatario: 'jurrea@kompu.cl', archivo: 'output/…pdf', rama: 'claude/kind-brown-c7ic8f' }],
});

const traerPdf = node({
  type: 'n8n-nodes-base.github',
  version: 1.1,
  config: {
    name: 'Traer el PDF del repo',
    position: [440, 0],
    parameters: {
      resource: 'file',
      operation: 'get',
      // Explícito, igual que en acciones.ts: el nodo asume 'accessToken' y entonces pide una
      // credencial githubApi que no existe en esta instancia. La que hay es OAuth2.
      authentication: 'oAuth2',
      owner: REPO_OWNER,
      repository: REPO_NOMBRE,
      filePath: expr('{{ $json.archivo }}'),
      asBinaryProperty: true,
      binaryPropertyName: 'cotizacion',
      additionalParameters: { reference: expr('{{ $json.rama }}') },
    },
    credentials: CRED_GITHUB,
  },
  output: [{}],
});

const enviar = node({
  type: 'n8n-nodes-base.gmail',
  version: 2.2,
  config: {
    name: 'Enviar el correo a Kompu',
    // El nodo GitHub reemplaza el json del item por el del archivo, así que el asunto, el cuerpo y
    // el destinatario se leen del nodo anterior por nombre y no de $json.
    notes: 'appendAttribution: false — el pie de n8n no va en un documento comercial.',
    position: [660, 0],
    parameters: {
      resource: 'message',
      operation: 'send',
      authentication: 'oAuth2',
      sendTo: expr("{{ $('Datos del envío').first().json.destinatario }}"),
      subject: expr("{{ $('Datos del envío').first().json.asunto }}"),
      emailType: 'html',
      message: expr("{{ $('Datos del envío').first().json.cuerpo }}"),
      options: {
        appendAttribution: false,
        senderName: 'KeepSync SpA',
        attachmentsUi: { attachmentsBinary: [{ property: 'cotizacion' }] },
      },
    },
    credentials: CRED_GMAIL,
  },
  output: [{ id: '19c…', threadId: '19c…' }],
});

export default workflow('ks-cotizacion-correo', 'KS · Cotización por correo')
  .add(inicio)
  .to(datos)
  .to(traerPdf)
  .to(enviar);
