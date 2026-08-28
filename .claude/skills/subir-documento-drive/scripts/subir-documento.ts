import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import "dotenv/config";

/**
 * Sube archivos locales a la carpeta de Drive de un documento del expediente, llamando por HTTP a
 * los mismos dos flujos de n8n que ya usa el panel operativo (`docs/panel/expediente.js`):
 *
 *   GET  /mp/expediente?codigo=<codigo>          — para resolver el folderId de un documento por su
 *                                                   prefijo NN (decodifica el <script id="__data">
 *                                                   que arma n8n/chunks/render-expediente.js)
 *   POST /mp/subir?folderId=<id>&nombre=<nombre>  — sube el archivo (multipart, campo "data0")
 *
 * Este script nunca habla con la API de Drive ni guarda una credencial de Drive: n8n sigue siendo
 * el único que habla con Drive (ver "Panel operativo y expediente de oferta" en CLAUDE.md). Tampoco
 * crea carpetas — si el documento pedido no tiene folderId todavía, hay que "Avanzar" la solicitud
 * en el panel primero (dispara MP · Carpetas Drive, n8n/workflows/carpetas-drive.ts).
 *
 *   npm run subir-documento -- <codigo> --prefijo=<NN> <archivo...>
 *   npm run subir-documento -- <codigo> --folder-id=<id> <archivo...>
 *
 * Requiere en el entorno (ver .env.example y el skill subir-documento-drive):
 *   N8N_BASE_URL      igual que en src/scripts/postear-n8n.ts
 *   N8N_PANEL_COOKIE  cookie de una sesión del panel ya iniciada a mano — este script la reutiliza,
 *                     no inicia sesión por sí mismo ni rodea el login (mismo guardrail que el resto
 *                     del panel: cada acción con efecto real la autoriza un humano).
 */

interface DocumentoExpediente {
  prefijo: string;
  documento: string;
  tipo: string;
  folderId: string | null;
}

function baseUrl(): string {
  const base = process.env.N8N_BASE_URL;
  if (!base) throw new Error("Falta N8N_BASE_URL en el entorno (ver .env.example).");
  return base.replace(/\/$/, "");
}

function cookie(): string {
  const c = process.env.N8N_PANEL_COOKIE;
  if (!c) {
    throw new Error(
      "Falta N8N_PANEL_COOKIE en el entorno. Este script reutiliza tu sesión del panel, no la crea: " +
        "inicia sesión una vez en el panel operativo, copiá la cabecera Cookie de cualquier request a " +
        "/webhook/mp/… (herramientas de desarrollador → Red) y pegala en .env — ver el skill " +
        "subir-documento-drive para el detalle.",
    );
  }
  return c;
}

async function buscarFolderId(codigo: string, prefijo: string): Promise<string> {
  const url = `${baseUrl()}/mp/expediente?codigo=${encodeURIComponent(codigo)}`;
  const res = await fetch(url, { headers: { Cookie: cookie() } });
  if (!res.ok) {
    throw new Error(`GET ${url} respondió ${res.status}. ¿La cookie sigue vigente? Volvé a copiarla del navegador.`);
  }
  const html = await res.text();
  const match = /<script id="__data" type="application\/json">([^<]*)<\/script>/.exec(html);
  if (!match?.[1]) {
    throw new Error(`No se encontró el bloque de datos del expediente de ${codigo}. ¿Esa solicitud existe en el panel?`);
  }
  const datos = JSON.parse(Buffer.from(match[1], "base64").toString("utf-8")) as {
    documentos: DocumentoExpediente[];
  };
  const doc = datos.documentos.find((d) => d.prefijo === prefijo);
  if (!doc) {
    const listados = datos.documentos.map((d) => `  ${d.prefijo} - ${d.documento}`).join("\n");
    throw new Error(`${codigo} no tiene un documento con prefijo "${prefijo}". Documentos del expediente:\n${listados}`);
  }
  if (!doc.folderId) {
    throw new Error(
      `"${doc.documento}" (${prefijo}) todavía no tiene carpeta en Drive. En el panel, usá "Avanzar" ` +
        `sobre ${codigo} para crear el árbol de carpetas antes de subir nada.`,
    );
  }
  return doc.folderId;
}

async function subirArchivo(folderId: string, rutaLocal: string): Promise<void> {
  if (!existsSync(rutaLocal)) throw new Error(`No existe el archivo: ${rutaLocal}`);
  const nombre = path.basename(rutaLocal);
  const bytes = readFileSync(rutaLocal);
  const form = new FormData();
  form.append("data0", new Blob([bytes]), nombre);
  const url = `${baseUrl()}/mp/subir?folderId=${encodeURIComponent(folderId)}&nombre=${encodeURIComponent(nombre)}`;
  const res = await fetch(url, { method: "POST", headers: { Cookie: cookie() }, body: form });
  if (!res.ok) {
    throw new Error(`POST ${url} respondió ${res.status}: ${(await res.text()).slice(0, 400)}`);
  }
  console.log(`  ✓ ${nombre} → carpeta ${folderId}`);
}

function valorDe(bandera: string): string | undefined {
  const arg = process.argv.find((a) => a.startsWith(`--${bandera}=`));
  return arg ? arg.slice(bandera.length + 3) : undefined;
}

function sinCookie(mensaje: string): string {
  const c = process.env.N8N_PANEL_COOKIE;
  return c ? mensaje.split(c).join("«cookie oculta»") : mensaje;
}

async function main(): Promise<void> {
  const posicionales = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const [codigo, ...archivos] = posicionales;
  const prefijo = valorDe("prefijo");
  const folderIdDirecto = valorDe("folder-id");

  if (!codigo || archivos.length === 0 || (!prefijo && !folderIdDirecto)) {
    console.error(
      "Uso: npm run subir-documento -- <codigo> --prefijo=<NN> <archivo...>\n" +
        "  o: npm run subir-documento -- <codigo> --folder-id=<id> <archivo...>",
    );
    process.exitCode = 1;
    return;
  }

  const folderId = folderIdDirecto ?? (await buscarFolderId(codigo, prefijo!));
  console.log(`Subiendo ${archivos.length} archivo(s) a la carpeta ${folderId} de ${codigo}…`);
  for (const archivo of archivos) {
    await subirArchivo(folderId, archivo);
  }
}

main().catch((err) => {
  console.error(sinCookie(err instanceof Error ? err.message : String(err)));
  process.exitCode = 1;
});
