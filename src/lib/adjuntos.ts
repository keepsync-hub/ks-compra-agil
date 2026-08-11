/**
 * Descarga de adjuntos de Compra Ágil sin login, vía el backend del buscador público
 * (no es API documentada oficialmente — puede cambiar sin aviso). Usa la misma clave
 * pública y User-Agent que cualquier visitante del sitio; no elude autenticación ni
 * controles de acceso, solo replica lo que hace el buscador público.
 *
 * Verificado end-to-end: descarga real de un PDF de 591 KB / 6 páginas (ver PLAN.md).
 */

const BASE_URL = "https://adjunto.mercadopublico.cl/adjunto-compra-agil";
const USER_KEY = "41186b85826e80d1a0d445a6ce67d1a3";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

export interface AdjuntoListado {
  id: string; // UUID
  nombreArchivo: string;
}

function headers() {
  return { user_key: USER_KEY, "User-Agent": USER_AGENT };
}

interface ListarAdjuntosEnvelope {
  success: string;
  payload: { files: AdjuntoListado[] };
  errores: unknown;
}

export async function listarAdjuntos(codigo: string): Promise<AdjuntoListado[]> {
  const res = await fetch(`${BASE_URL}/v1/adjuntos-compra-agil/listar/${encodeURIComponent(codigo)}`, {
    headers: headers(),
  });
  if (!res.ok) {
    throw new Error(
      `No se pudo listar adjuntos de ${codigo} (HTTP ${res.status}). El servicio no es API oficial: ` +
        `si esto persiste, revisar si cambió y usar navegador como fallback.`,
    );
  }
  // Envuelto en {success, payload: {files: [...]}, errores} — no es un array plano.
  const json = (await res.json()) as ListarAdjuntosEnvelope;
  return json.payload?.files ?? [];
}

export async function descargarAdjunto(id: string): Promise<Buffer> {
  const res = await fetch(`${BASE_URL}/v1/adjuntos-compra-agil/descargar/${encodeURIComponent(id)}`, {
    headers: headers(),
  });
  if (!res.ok) {
    throw new Error(`No se pudo descargar el adjunto ${id} (HTTP ${res.status}).`);
  }
  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/** Descarga condicional: solo si la compra declara documentos (muchas de estas compras no traen adjuntos). */
export async function descargarAdjuntosSiExisten(
  codigo: string,
  tieneDocumentosDeclarados: boolean,
): Promise<{ nombreArchivo: string; contenido: Buffer }[]> {
  if (!tieneDocumentosDeclarados) return [];
  const listado = await listarAdjuntos(codigo);
  const resultados: { nombreArchivo: string; contenido: Buffer }[] = [];
  for (const adjunto of listado) {
    const contenido = await descargarAdjunto(adjunto.id);
    resultados.push({ nombreArchivo: adjunto.nombreArchivo, contenido });
  }
  return resultados;
}
