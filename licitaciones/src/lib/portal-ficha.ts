/**
 * Acceso a los ANTECEDENTES de una licitación por la ficha PÚBLICA del portal de Mercado Público,
 * sin ticket, sin cuota y sin login.
 *
 * Por qué existe este módulo: `api.ts` (api.mercadopublico.cl) **no expone** los documentos de la
 * licitación ni las garantías exigidas — verificado el 2026-08-19, ver `licitaciones/PLAN.md`. Hasta
 * ahora la conclusión escrita era "las bases hay que leerlas en el portal", es decir, con una
 * persona. Esa conclusión era demasiado pesimista: el portal renderiza **el contenido completo de
 * las bases en el HTML de la ficha**, servido a cualquier visitante sin autenticación, y ahí viven
 * las garantías, los anexos exigidos y los criterios de evaluación.
 *
 * VERIFICADO CONTRA PRODUCCIÓN el 2026-08-19 sobre licitaciones reales abiertas (4174-29-LE26,
 * 5038-3-LE26, 1191449-18-LE26):
 *
 * - `DetailsAcquisition.aspx?idlicitacion=<codigo>` responde 302 hacia la misma ficha con un `qs`
 *   cifrado, y ese `qs` se puede seguir sin cookies ni sesión: HTTP 200 con ~240 KB de HTML.
 *   Es decir, **el código público de la licitación basta**; no hace falta descubrir el `qs`.
 * - Ese HTML trae las 9 secciones de las bases en `<div id="Ficha1">` … `<div id="Ficha9">`, con sus
 *   títulos en `lblTitulo1..9`. La sección 4 ("Antecedentes para incluir en la oferta") lista los
 *   anexos administrativos/técnicos/económicos exigidos y la 8 ("Garantías requeridas") trae la
 *   garantía, beneficiario y vencimiento — los dos datos que el PLAN daba por inalcanzables.
 * - El foro público de preguntas y respuestas (`/Foros/Modules/FNormal/PopUps/PublicView.aspx?qs=`)
 *   también responde sin login ni CAPTCHA, y sus aclaraciones modifican las bases.
 *
 * LÍMITE CONOCIDO, deliberadamente no rodeado: los ARCHIVOS adjuntos (los PDF/DOCX de las bases y
 * los formatos de anexo) cuelgan de `Attachment/ViewAttachment.aspx?enc=…`, que está detrás de un
 * reCAPTCHA Enterprise por score, **verificado como exigido del lado del servidor** (un cliente
 * HTTP plano recibe 302 a `/Procurement/403.html`). Este módulo NO intenta falsificar ni resolver
 * ese control: expone la URL del visor en `enlaces.visorAdjuntos` para que la abra un navegador
 * real o una persona, conforme al guardrail de `CLAUDE.md` ("ante CAPTCHA o bloqueo del portal:
 * detenerse y pedir intervención humana, no reintentar a ciegas").
 *
 * No es una API documentada: es el HTML público del portal. Puede cambiar sin aviso, y por eso el
 * parseo es defensivo — una sección que no aparezca se omite en vez de romper la corrida.
 */

const PORTAL = "https://www.mercadopublico.cl";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

/** Cantidad de secciones ("pasos") de las bases que renderiza la ficha. */
const MAX_SECCIONES = 9;

export interface SeccionFicha {
  numero: number;
  titulo: string;
  texto: string;
}

export interface EnlacesFicha {
  /** URL canónica de la ficha (con el `qs` cifrado que devolvió el portal). */
  ficha: string;
  /** Visor de archivos adjuntos. Tras reCAPTCHA: para navegador real o persona, no para fetch. */
  visorAdjuntos?: string;
  /** Foro público de preguntas y respuestas (sin CAPTCHA). */
  foroPreguntas?: string;
}

export interface AntecedentesLicitacion {
  codigo: string;
  /** ISO de la descarga: las bases se modifican con aclaraciones, así que la fecha importa. */
  obtenidoEn: string;
  enlaces: EnlacesFicha;
  secciones: SeccionFicha[];
  /** Texto del foro de preguntas y respuestas, si la ficha lo enlaza y respondió. */
  foro?: string;
  /** HTML crudo de la ficha, por si un consumidor quiere reparsear sin volver a pedirla. */
  html: string;
}

// Mismo criterio que `api.ts` y `src/lib/adjuntos.ts`: 502/503/504 son fallos transitorios del
// gateway del portal, no "la licitación no existe".
const TRANSIENT_STATUS = new Set([502, 503, 504]);
const MAX_INTENTOS = 3;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchPortal(url: string, descripcion: string): Promise<Response> {
  let ultimoError: Error | undefined;
  for (let intento = 1; intento <= MAX_INTENTOS; intento++) {
    let res: Response;
    try {
      res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
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

const ENTIDADES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ntilde: "ñ",
  Ntilde: "Ñ",
  aacute: "á",
  eacute: "é",
  iacute: "í",
  oacute: "ó",
  uacute: "ú",
  Aacute: "Á",
  Eacute: "É",
  Iacute: "Í",
  Oacute: "Ó",
  Uacute: "Ú",
  uuml: "ü",
  Uuml: "Ü",
  ordm: "º",
  deg: "°",
  hellip: "…",
  mdash: "—",
  ndash: "–",
  laquo: "«",
  raquo: "»",
};

function decodificarEntidades(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&([a-z]+);/gi, (todo, nombre) => ENTIDADES[nombre] ?? todo);
}

/**
 * HTML → texto legible. No usa un parser DOM a propósito: el proyecto no tiene esa dependencia y
 * acá alcanza con conservar los saltos de línea que dan estructura (filas de tabla, párrafos, li).
 */
export function htmlATexto(html: string): string {
  const texto = html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6]|table)>/gi, "\n")
    .replace(/<\/t[dh]>/gi, "\t")
    .replace(/<[^>]+>/g, "");
  // Se conserva el tab como separador de celdas (queda "Beneficiario:\tI. Municipalidad de X"),
  // pero se descartan las líneas que solo traen relleno: la ficha emite decenas de celdas vacías
  // por sección y sin esto el texto sale con más blancos que contenido.
  return decodificarEntidades(texto)
    .split("\n")
    .map((linea) => linea.replace(/[ \u00a0]+/g, " ").replace(/\t+/g, "\t").trim())
    .filter((linea) => linea !== "" && linea !== "\t")
    .join("\n")
    .trim();
}

/**
 * Índice del `<` que abre el `<div id="FichaN">`, o -1 si esa sección no está en la página.
 * Se retrocede hasta el `<` a propósito: cortar en el atributo `id=` parte el tag por la mitad y
 * deja un `<div` huérfano que ningún filtro de tags puede limpiar (se vio en producción).
 */
function indiceSeccion(html: string, numero: number): number {
  const idx = html.indexOf(`id="Ficha${numero}"`);
  if (idx < 0) return -1;
  const aperturaTag = html.lastIndexOf("<", idx);
  return aperturaTag >= 0 ? aperturaTag : idx;
}

function tituloSeccion(html: string, numero: number): string | null {
  const m = html.match(new RegExp(`id="lblTitulo${numero}"[^>]*>([^<]*)<`));
  return m ? decodificarEntidades(m[1]).trim() : null;
}

/**
 * Corta el HTML de la ficha en las secciones de las bases. Cada sección va desde su propio
 * `id="FichaN"` hasta el siguiente marcador presente — el portal las emite en orden.
 */
export function parsearSecciones(html: string): SeccionFicha[] {
  const marcadores: { numero: number; inicio: number }[] = [];
  for (let n = 1; n <= MAX_SECCIONES + 2; n++) {
    const idx = indiceSeccion(html, n);
    if (idx >= 0) marcadores.push({ numero: n, inicio: idx });
  }
  marcadores.sort((a, b) => a.inicio - b.inicio);

  const secciones: SeccionFicha[] = [];
  for (let i = 0; i < marcadores.length; i++) {
    const { numero, inicio } = marcadores[i];
    if (numero > MAX_SECCIONES) continue; // marcador posterior: solo sirve como corte
    const fin = marcadores[i + 1]?.inicio ?? html.length;
    const titulo = tituloSeccion(html, numero) ?? `Sección ${numero}`;
    const texto = htmlATexto(html.slice(inicio, fin))
      .split("\n")
      // "Subir" es el ancla de navegación al pie de cada sección, y el encabezado repite el
      // título que ya va como tal — ninguno de los dos es contenido de las bases.
      .filter((linea) => linea !== "Subir" && linea !== `${numero}. ${titulo}` && linea !== titulo)
      .join("\n")
      .trim();
    if (!texto) continue;
    secciones.push({ numero, titulo, texto });
  }
  return secciones;
}

function absolutizar(ruta: string): string {
  const limpia = decodificarEntidades(ruta).replace(/^\.\.\/\.\.\//, "/Procurement/").replace(/^\.\.\//, "/Procurement/Modules/");
  return limpia.startsWith("http") ? limpia : `${PORTAL}${limpia}`;
}

export function parsearEnlaces(html: string, urlFicha: string): EnlacesFicha {
  const enlaces: EnlacesFicha = { ficha: urlFicha };
  // El botón de adjuntos abre el visor con un `enc` ya emitido dentro del propio HTML público.
  const visor = html.match(/([.\/A-Za-z]*Attachment\/ViewAttachment\.aspx\?enc=[^'"&\s]+)/);
  if (visor) enlaces.visorAdjuntos = absolutizar(visor[1]);
  const foro = html.match(/href="(\/Foros\/[^"]+)"/);
  if (foro) enlaces.foroPreguntas = absolutizar(foro[1]);
  return enlaces;
}

/**
 * Descarga la ficha pública. Solo necesita el código externo de la licitación: el portal resuelve
 * el `qs` cifrado por redirección y `fetch` la sigue.
 */
export async function descargarFichaPublica(codigo: string): Promise<{ url: string; html: string }> {
  const url = `${PORTAL}/Procurement/Modules/RFB/DetailsAcquisition.aspx?idlicitacion=${encodeURIComponent(codigo)}`;
  const res = await fetchPortal(url, `Ficha pública de ${codigo}`);
  if (!res.ok) {
    throw new Error(
      `No se pudo leer la ficha pública de ${codigo} (HTTP ${res.status}). No es una API oficial ` +
        `sino el HTML del portal: si esto persiste, revisar si cambió la ruta DetailsAcquisition.aspx.`,
    );
  }
  const html = await res.text();
  if (!/id="Ficha1"/.test(html)) {
    throw new Error(
      `La ficha de ${codigo} respondió 200 pero sin las secciones esperadas (id="Ficha1"). ` +
        `Puede ser un código inexistente o un cambio de layout del portal.`,
    );
  }
  return { url: res.url || url, html };
}

/**
 * Antecedentes completos de una licitación: contenido de las bases + enlaces + foro de preguntas.
 * Cero consumo de la cuota del ticket de la API — esto no toca `api.mercadopublico.cl`.
 */
export async function obtenerAntecedentes(
  codigo: string,
  opciones: { incluirForo?: boolean } = {},
): Promise<AntecedentesLicitacion> {
  const { url, html } = await descargarFichaPublica(codigo);
  const enlaces = parsearEnlaces(html, url);
  const antecedentes: AntecedentesLicitacion = {
    codigo,
    obtenidoEn: new Date().toISOString(),
    enlaces,
    secciones: parsearSecciones(html),
    html,
  };

  if (opciones.incluirForo !== false && enlaces.foroPreguntas) {
    try {
      const res = await fetchPortal(enlaces.foroPreguntas, `Foro de preguntas de ${codigo}`);
      if (res.ok) antecedentes.foro = htmlATexto(await res.text());
    } catch (err) {
      // El foro es complementario: perderlo no invalida las bases ya descargadas.
      console.warn(`  ${codigo}: no se pudo leer el foro de preguntas — ${(err as Error).message}`);
    }
  }
  return antecedentes;
}

export function antecedentesAMarkdown(a: AntecedentesLicitacion): string {
  const lineas: string[] = [
    `# Antecedentes de la licitación ${a.codigo}`,
    "",
    `> Leído de la ficha pública del portal el ${a.obtenidoEn} — sin ticket, sin cuota y sin login.`,
    `> Es el contenido de las bases tal como lo publica el organismo comprador, no un documento nuestro.`,
    "",
    `- Ficha: ${a.enlaces.ficha}`,
  ];
  if (a.enlaces.foroPreguntas) lineas.push(`- Foro de preguntas y respuestas: ${a.enlaces.foroPreguntas}`);
  if (a.enlaces.visorAdjuntos) {
    lineas.push(
      `- Archivos adjuntos (PDF/DOCX de bases y formatos de anexo): ${a.enlaces.visorAdjuntos}`,
      `  ⚠ Ese visor exige reCAPTCHA del lado del servidor: se abre con un navegador real, no con este agente.`,
    );
  }
  lineas.push("");
  for (const s of a.secciones) {
    lineas.push(`## ${s.numero}. ${s.titulo}`, "", s.texto, "");
  }
  if (a.foro) lineas.push("## Foro de preguntas y respuestas", "", a.foro, "");
  return lineas.join("\n");
}
