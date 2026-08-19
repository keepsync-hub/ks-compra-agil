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

// Mismo criterio que src/lib/api.ts: 502/503/504 son fallos transitorios del gateway, no "el
// archivo no existe". Este servicio los devuelve seguido (una corrida completa de `array-cotizar`
// perdió los 5 adjuntos por 504 y quedó sin documentación que leer), así que sin reintento la
// descarga es poco confiable en la práctica.
const TRANSIENT_STATUS = new Set([502, 503, 504]);
const MAX_INTENTOS = 3;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchConReintento(url: string, descripcion: string): Promise<Response> {
  let ultimoError: Error | undefined;
  for (let intento = 1; intento <= MAX_INTENTOS; intento++) {
    let res: Response;
    try {
      res = await fetch(url, { headers: headers() });
    } catch (err) {
      ultimoError = err as Error;
      if (intento < MAX_INTENTOS) {
        await sleep(1000 * 2 ** (intento - 1)); // 1s, 2s
        continue;
      }
      throw new Error(`${descripcion} falló por red tras ${MAX_INTENTOS} intentos: ${ultimoError.message}`);
    }
    if (TRANSIENT_STATUS.has(res.status) && intento < MAX_INTENTOS) {
      await res.body?.cancel().catch(() => {});
      await sleep(1000 * 2 ** (intento - 1));
      continue;
    }
    return res;
  }
  throw ultimoError ?? new Error(`${descripcion}: fallo desconocido`);
}

interface ListarAdjuntosEnvelope {
  success: string;
  payload: { files: AdjuntoListado[] };
  errores: unknown;
}

export async function listarAdjuntos(codigo: string): Promise<AdjuntoListado[]> {
  const res = await fetchConReintento(
    `${BASE_URL}/v1/adjuntos-compra-agil/listar/${encodeURIComponent(codigo)}`,
    `Listado de adjuntos de ${codigo}`,
  );
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
  const res = await fetchConReintento(
    `${BASE_URL}/v1/adjuntos-compra-agil/descargar/${encodeURIComponent(id)}`,
    `Descarga del adjunto ${id}`,
  );
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
  const fallidos: string[] = [];
  for (const adjunto of listado) {
    try {
      const contenido = await descargarAdjunto(adjunto.id);
      resultados.push({ nombreArchivo: adjunto.nombreArchivo, contenido });
    } catch (err) {
      // Un archivo que falla no debe costar los demás de la misma ficha: 9 de 10 bases
      // descargadas es mucho más útil para preparar una oferta que ninguna.
      fallidos.push(`${adjunto.nombreArchivo} (${(err as Error).message})`);
    }
  }
  if (fallidos.length > 0) {
    console.warn(
      `  ${codigo}: ${fallidos.length} de ${listado.length} adjunto(s) no se pudieron descargar — ${fallidos.join("; ")}`,
    );
  }
  return resultados;
}
