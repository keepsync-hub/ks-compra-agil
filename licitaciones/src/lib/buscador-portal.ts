/**
 * Descubrimiento de licitaciones por el **buscador público del portal**
 * (`mercadopublico.cl/BuscarLicitacion`), sin ticket, sin cuota y sin login.
 *
 * Por qué esta vía existe y por qué es la primaria (medido el 2026-08-19):
 *
 * - La API con ticket **no tiene búsqueda por texto**: obliga a traerse el listado nacional
 *   completo (4.508 licitaciones activas) y filtrar localmente, y ese listado trae el `Nombre`
 *   **truncado a ~50 caracteres** y **sin `Descripcion`**. Es decir: la llamada más cara es
 *   también la que peor texto entrega para descubrir.
 * - Este buscador, en cambio, filtra por texto **en el servidor** y devuelve el **nombre y la
 *   descripción completos**. Descubre licitaciones que el nombre truncado escondía.
 *
 * Cómo funciona (es el mismo flujo que ejecuta el botón "Descargar resultados" del sitio, con los
 * mismos parámetros que arma su propio JS — nada falsificado, nada por detrás de un control):
 *
 *   1. `POST /BuscarLicitacion/Home/GenerarArchivo` con los filtros → `{FileGuid, nombreArchivo}`
 *   2. `GET  /BuscarLicitacion//Home/Descargar?fileGuid=…` → CSV de hasta 1.000 resultados
 *
 * El archivo queda asociado a la sesión que lo generó: sin la cookie del paso previo, la descarga
 * responde 200 con cuerpo vacío (verificado). Por eso se conserva el cookie jar entre llamadas.
 *
 * Límite conocido: 1.000 resultados por descarga (`TOPE_FILAS_DESCARGA`). Con consultas por
 * categoría sobre licitaciones publicadas queda holgado; una consulta vacía —las ~4.500 publicadas
 * del país— se truncaría, y por eso no se hace. Sobre el histórico, en cambio, el tope se alcanza
 * casi siempre, y la salida medida es rotar `idOrden` (ver `ORDENES_BUSCADOR`), no ventanear por
 * fecha.
 */

const BASE = "https://www.mercadopublico.cl/BuscarLicitacion";
const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

/**
 * Estados del buscador. Salen de la constante `config.estados` de su propio `busqueda.js`, que se
 * bajó y se leyó el 2026-08-25 (los mismos valores aparecen en `busqueda.filtros.js`). No son
 * inferidos: `publicadas` es el único que el repo usaba, y los otros cuatro son los que abren el
 * histórico — cerradas, desiertas, adjudicadas y revocadas— sin gastar un solo request de la API.
 */
export const ESTADO_TODOS = "-1";
export const ESTADO_PUBLICADAS = "5";
export const ESTADO_CERRADAS = "6";
export const ESTADO_DESIERTAS = "7";
export const ESTADO_ADJUDICADAS = "8";
export const ESTADO_REVOCADAS = "15";

/** Nombre legible -> id, para que un CLI acepte `--estados=adjudicadas,cerradas`. */
export const ESTADOS_BUSCADOR = {
  todos: ESTADO_TODOS,
  publicadas: ESTADO_PUBLICADAS,
  cerradas: ESTADO_CERRADAS,
  desiertas: ESTADO_DESIERTAS,
  adjudicadas: ESTADO_ADJUDICADAS,
  revocadas: ESTADO_REVOCADAS,
} as const;

export type NombreEstadoBuscador = keyof typeof ESTADOS_BUSCADOR;

/**
 * Criterios de orden (`config.ordenCodigo` del mismo `busqueda.js`).
 *
 * No son cosmética: el buscador topa la descarga en `TOPE_FILAS_DESCARGA` filas, así que el orden
 * decide CUÁLES 1.000 devuelve. Medido el 2026-08-25 con `q="gestion documental"` sobre
 * adjudicadas: relevancia y "últimas adjudicadas" comparten solo **162** de sus 1.000 filas, y la
 * unión de tres órdenes distintos da **2.545 códigos únicos**. Rotar el orden es, por lejos, la
 * forma más barata de ver más allá del tope — más que las ventanas de fecha, que además filtran una
 * fecha distinta según el estado y devuelven cero en `publicadas` (su cierre es futuro).
 */
export const ORDENES_BUSCADOR = {
  relevantes: "1",
  porCerrarse: "2",
  publicadas: "3",
  cerradas: "4",
  adjudicadas: "5",
  revocadas: "6",
  mayorMonto: "7",
  menorMonto: "8",
} as const;

/**
 * Tope duro de filas por descarga. Una consulta que devuelve exactamente este número está
 * truncada: hay cola que no se vio, y quien la llame debe decirlo en vez de callarlo.
 */
export const TOPE_FILAS_DESCARGA = 1000;

/** Una fila del CSV que entrega el buscador. Columnas verificadas contra la descarga real. */
export interface ResultadoBusquedaPortal {
  codigo: string;
  nombre: string;
  tipo: string;
  estado: string;
  fechaPublicacion: string;
  descripcion: string;
  moneda: string;
  tipoPresupuesto: string;
  tipoMonto: string;
  /** Tal como lo entrega el portal ("10.000.000"); vacío cuando el organismo no lo publica. */
  montoTexto: string;
  organismo: string;
}

interface Cookies {
  jar: Map<string, string>;
}

function guardarCookies(res: Response, cookies: Cookies): void {
  // `getSetCookie` existe en el fetch de Node 22; el fallback cubre runtimes que solo dan `get`.
  const crudas =
    typeof res.headers.getSetCookie === "function"
      ? res.headers.getSetCookie()
      : [res.headers.get("set-cookie")].filter((c): c is string => Boolean(c));
  for (const cruda of crudas) {
    const par = cruda.split(";")[0];
    const i = par?.indexOf("=") ?? -1;
    if (par && i > 0) cookies.jar.set(par.slice(0, i), par.slice(i + 1));
  }
}

function cabeceraCookie(cookies: Cookies): string {
  return [...cookies.jar].map(([k, v]) => `${k}=${v}`).join("; ");
}

function cabeceras(cookies: Cookies, extra: Record<string, string> = {}): Record<string, string> {
  const base: Record<string, string> = {
    "User-Agent": UA,
    Referer: `${BASE}`,
    ...extra,
  };
  const cookie = cabeceraCookie(cookies);
  if (cookie) base["Cookie"] = cookie;
  return base;
}

/**
 * Filtros del buscador. Los valores son los que arma su propio JS al buscar desde la página
 * (capturados del request real): cambiarlos por variantes "más razonables" —`codigoRegion: ""` en
 * vez de `"-1"`, por ejemplo— hace que el servidor responda "sin coincidencias".
 */
function cuerpoBusqueda(texto: string, estado: string, pagina: number, orden: string = ORDENES_BUSCADOR.relevantes): string {
  return JSON.stringify({
    textoBusqueda: texto,
    idEstado: estado,
    codigoRegion: "-1",
    idTipoLicitacion: "-1",
    fechaInicio: null,
    fechaFin: null,
    registrosPorPagina: "10",
    idTipoFecha: [],
    idOrden: orden,
    compradores: [],
    garantias: null,
    rubros: [],
    proveedores: [],
    montoEstimadoTipo: [0],
    esPublicoMontoEstimado: null,
    pagina,
  });
}

const TIEMPO_LIMITE_MS = 120_000;

async function pedir(url: string, init: RequestInit): Promise<Response> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIEMPO_LIMITE_MS) });
  if (!res.ok) throw new Error(`Buscador del portal respondió ${res.status} en ${url}`);
  return res;
}

function parsearCsv(csv: string): ResultadoBusquedaPortal[] {
  // El portal emite el CSV sin comillas y con `;` como separador; cada registro en una línea
  // (verificado: 744 líneas para 743 resultados, todas con 11 columnas exactas). Si alguna fila
  // no tiene 11 columnas se descarta en vez de desalinear los campos.
  const lineas = csv.replace(/^\ufeff/, "").split(/\r?\n/).filter((l) => l.trim().length > 0);
  const filas = lineas.slice(1).map((l) => l.split(";"));
  return filas
    .filter((c) => c.length === 11)
    .map((c) => ({
      codigo: (c[0] ?? "").trim(),
      nombre: (c[1] ?? "").trim(),
      tipo: (c[2] ?? "").trim(),
      estado: (c[3] ?? "").trim(),
      fechaPublicacion: (c[4] ?? "").trim(),
      descripcion: (c[5] ?? "").trim(),
      moneda: (c[6] ?? "").trim(),
      tipoPresupuesto: (c[7] ?? "").trim(),
      tipoMonto: (c[8] ?? "").trim(),
      montoTexto: (c[9] ?? "").trim(),
      organismo: (c[10] ?? "").trim(),
    }))
    // El sufijo del código es el TIPO seguido del año: "LE26", pero también "L126" (tipo L1),
    // "B226" (B2), "I226" (I2), "CI226" (CI2)… El patrón anterior era `[A-Z]{1,2}\d{2}`, que exigía
    // exactamente dos dígitos y por eso descartaba EN SILENCIO todos los tipos que llevan un dígito
    // en su sigla: medido el 2026-08-25, 22 de cada 1.000 filas — entre ellas todas las L1
    // (licitación pública menor a 100 UTM) y las privadas B2/H2/I2. El `\d?` opcional los recupera
    // sin dejar pasar basura: la cabecera del CSV y las líneas partidas siguen fuera.
    .filter((r) => /^[\w-]+-[A-Z]{1,2}\d?\d{2}$/.test(r.codigo));
}

/**
 * Busca por texto en el portal y devuelve los resultados ya parseados. Una consulta = dos
 * requests HTTP y cero cuota de API.
 */
export interface OpcionesBusquedaPortal {
  /** Uno de `ORDENES_BUSCADOR`. Por defecto, relevancia — el mismo que usaba el repo. */
  orden?: string;
}

export async function buscarEnPortal(
  texto: string,
  estado: string = ESTADO_PUBLICADAS,
  opciones: OpcionesBusquedaPortal = {},
): Promise<ResultadoBusquedaPortal[]> {
  const cookies: Cookies = { jar: new Map() };

  // 1. Abrir el buscador para tomar la cookie de sesión que después autoriza la descarga.
  guardarCookies(await pedir(BASE, { headers: cabeceras(cookies) }), cookies);

  // 2. Pedir el archivo con los resultados de la búsqueda.
  const generar = await pedir(`${BASE}/Home/GenerarArchivo`, {
    method: "POST",
    headers: cabeceras(cookies, {
      "Content-Type": "application/json; charset=utf-8",
      "X-Requested-With": "XMLHttpRequest",
    }),
    // `pagina: 1` es lo que manda el botón del sitio: significa "los primeros 1.000 resultados",
    // no la segunda página (así está comentado en su propio código).
    body: cuerpoBusqueda(texto, estado, 1, opciones.orden ?? ORDENES_BUSCADOR.relevantes),
  });
  guardarCookies(generar, cookies);
  const meta = (await generar.json()) as { FileGuid?: string; nombreArchivo?: string; estado?: boolean };
  if (!meta.estado || !meta.FileGuid) {
    throw new Error(`El buscador no generó el archivo para "${texto}" (respuesta: ${JSON.stringify(meta)})`);
  }

  // 3. Descargarlo con la misma sesión (sin la cookie devuelve 200 con cuerpo vacío).
  const archivo = await pedir(
    `${BASE}//Home/Descargar?fileGuid=${encodeURIComponent(meta.FileGuid)}&nombreArchivo=${encodeURIComponent(
      meta.nombreArchivo ?? "ListaLicitaciones.csv",
    )}`,
    { headers: cabeceras(cookies) },
  );
  return parsearCsv(await archivo.text());
}

/** "10.000.000" -> 10000000. Vacío o sin dígitos -> null (el organismo no publicó el monto). */
export function montoDeTexto(montoTexto: string): number | null {
  const digitos = montoTexto.replace(/[^\d]/g, "");
  if (!digitos) return null;
  const n = Number(digitos);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Lo que el buscador sabe del COMPRADOR y que ninguna otra fuente pública entrega: cuántas compras
 * hizo en los últimos 12 meses y cuántos reclamos recibió **por pago no oportuno**. Para un
 * proveedor esa razón es dato duro de decisión —si paga tarde, el contrato cuesta más—, y llega
 * gratis: una consulta por código devuelve exactamente esa licitación.
 *
 * Es también lo que vuelve prescindible la última llamada a la API: su `CantidadReclamos` es el
 * total de reclamos recibidos por el organismo, sin decir por qué; este par dice por qué y sobre
 * cuántas compras.
 */
export interface FichaBuscador {
  codigo: string;
  organismo?: string;
  unidad?: string;
  /** Texto del monto tal como lo muestra el buscador: "10.000.000" o "Entre 100 y 1000 UTM". */
  montoTexto?: string;
  /** true cuando el organismo publicó el monto exacto ("Monto disponible") y no solo un rango. */
  montoEsDisponible: boolean;
  comprasEfectuadas?: number;
  reclamosPagoNoOportuno?: number;
  /** Glosa del portal: "(En 2 días)". */
  glosaCierre?: string;
}

function texto(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "\u0001")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ");
}

function numeroTras(t: string, etiqueta: RegExp): number | undefined {
  const m = t.match(etiqueta);
  if (!m) return undefined;
  const resto = t.slice((m.index ?? 0) + m[0].length, (m.index ?? 0) + m[0].length + 200);
  const n = resto.match(/[\u0001\s]*([\d.]+)/);
  const limpio = n?.[1]?.replace(/\./g, "");
  return limpio ? Number(limpio) : undefined;
}

/**
 * Consulta el buscador por el código exacto de una licitación (devuelve esa sola) y extrae los
 * datos que solo están en esa vista. Una llamada HTTP, cero cuota.
 */
export async function fichaEnBuscador(codigo: string): Promise<FichaBuscador | null> {
  const cookies: Cookies = { jar: new Map() };
  guardarCookies(await pedir(BASE, { headers: cabeceras(cookies) }), cookies);
  const res = await pedir(`${BASE}/Home/Buscar`, {
    method: "POST",
    headers: cabeceras(cookies, {
      "Content-Type": "application/json; charset=utf-8",
      "X-Requested-With": "XMLHttpRequest",
    }),
    body: cuerpoBusqueda(codigo, ESTADO_PUBLICADAS, 0),
  });
  const html = await res.text();
  if (!html.includes(codigo)) return null;

  const t = texto(html);
  const montoDisponible = /Monto disponible/.test(t);
  const montoMatch = t.match(/Monto(?: disponible)?[\u0001\s]*(?:\$[\u0001\s]*)?([^\u0001]+)/);
  const cierre = t.match(/\(En ([^)]+)\)/);
  const organismoMatch = html.match(/<div class="col-md-4"><strong>([^<]+)<\/strong><br \/><p>\s*([^<]*)<\/p>/);

  return {
    codigo,
    organismo: organismoMatch?.[2]?.trim() || organismoMatch?.[1]?.trim(),
    unidad: organismoMatch?.[1]?.trim(),
    montoTexto: montoMatch?.[1]?.trim(),
    montoEsDisponible: montoDisponible,
    comprasEfectuadas: numeroTras(t, /Cantidad de compras\s*efectuadas\*/),
    reclamosPagoNoOportuno: numeroTras(t, /Cantidad de reclamos\s*por pago no oportuno\*/),
    glosaCierre: cierre ? `En ${cierre[1]?.trim()}` : undefined,
  };
}
