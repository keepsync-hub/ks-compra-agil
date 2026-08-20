/**
 * Medición del mercado de Compra Ágil — el universo entero, no los nichos que el radar ya busca.
 *
 * Existe para responder con datos una objeción que el propio repo se hace en PLAN-VOLUMEN.md:
 * "elegir keywords a dedo es el método que produjo el nicho Claude (79% de fracaso)". Acá los
 * criterios candidatos salen de medir el mercado, no de la intuición.
 *
 * Tres estratos, deliberadamente distintos, porque miden cosas distintas a costos distintos:
 *   A/B. Dimensionamiento por término — `paginacion.total_resultados` de una `q` de un token da el
 *        tamaño EXACTO de una familia en 1 request. Verificado contra producción el 2026-08-20:
 *        `q=capacitacion` → 51, `q=software` → 26.
 *   C.   Muestra sistemática del universo sin `q` — es el estrato ANTI-SESGO: lo único que puede
 *        mostrar una familia que nadie puso en la lista de términos. Es una estimación, con su
 *        error declarado; nunca se presenta como conteo exacto.
 *   D/E. Desenlaces y profundidad sobre la lista corta — tasa de éxito por familia y montos
 *        exactos, que es lo que decide dónde jugar.
 *
 * Todo va a `historico/mercado.jsonl`, versionado y append-only, con un `tipo` que discrimina el
 * estrato. Deliberadamente SEPARADO de `historico/observaciones.jsonl`: ese índice es una
 * proyección del DETALLE, lleva `categoria` y `codigos_onu`, y está 100% pre-filtrado por las
 * keywords de los nichos. Mezclarlos rompería `calcularMetricas()` y `oportunidadesArrastradas()`,
 * que asumen que cada línea pasó las tres puertas de una categoría.
 */
import { existsSync, readFileSync, appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { ROOT_DIR } from "./config.js";
import type { CompraAgilDetalle, CompraAgilListItem, EstadoCompraAgil, EstadoConvocatoria } from "./api.js";

export const MERCADO_PATH = path.join(ROOT_DIR, "historico", "mercado.jsonl");
export const TERMINOS_PATH_REL = "config/terminos-mercado.json";

// Mismo límite y mismo motivo que `historico/observaciones.jsonl` (src/lib/indice.ts): appendFileSync
// sobre un fd O_APPEND es atómico solo por debajo de PIPE_BUF (4096 bytes en Linux), y este archivo
// lo pueden escribir tanto la máquina local como el agente en la nube.
const MAX_BYTES_LINEA = 4000;
const MAX_CHARS_NOMBRE = 500;
const MAX_CHARS_DESCRIPCION = 2000;

export interface TerminoMercado {
  termino: string;
  grupo: "keepsync" | "control";
  nota?: string;
}

export interface ConfigTerminos {
  terminos: TerminoMercado[];
  lista_corta_estados: number;
  profundidad_terminos: number;
  profundidad_max_paginas: number;
  calibracion_detalles: number;
}

/**
 * Mismo guardrail que `config/categorias.json`: un `q` con la palabra suelta "de" responde
 * 500 ERROR_INTERNO de forma reproducible. Se valida al cargar y no al consultar, para que el error
 * salte antes de gastar cuota.
 */
const DE_SUELTO = /(^|\s)de(\s|$)/i;

export function cargarConfigTerminos(): ConfigTerminos {
  const p = path.join(ROOT_DIR, "config", "terminos-mercado.json");
  if (!existsSync(p)) throw new Error(`Falta ${TERMINOS_PATH_REL}.`);
  const raw = JSON.parse(readFileSync(p, "utf-8")) as ConfigTerminos;
  if (!Array.isArray(raw.terminos) || raw.terminos.length === 0) {
    throw new Error(`${TERMINOS_PATH_REL}: "terminos" vacío o ausente.`);
  }
  const vistos = new Set<string>();
  for (const t of raw.terminos) {
    if (!t.termino || t.termino.trim().length < 3) {
      throw new Error(`${TERMINOS_PATH_REL}: término "${t.termino}" es demasiado corto (mínimo 3 caracteres).`);
    }
    if (DE_SUELTO.test(t.termino)) {
      throw new Error(
        `${TERMINOS_PATH_REL}: el término "${t.termino}" contiene la palabra suelta "de" — el endpoint ` +
          `/v2/compra-agil responde 500 ERROR_INTERNO a cualquier \`q\` que la incluya (quirk verificado).`,
      );
    }
    const clave = t.termino.trim().toLowerCase();
    if (vistos.has(clave)) throw new Error(`${TERMINOS_PATH_REL}: término duplicado "${t.termino}".`);
    vistos.add(clave);
  }
  return raw;
}

// ── Registros ────────────────────────────────────────────────────────────────────────────────────

interface RegistroBase {
  corrida_id: string;
  medido_en: string;
}

/** Etapa A: tamaño del universo en cada estado, sin `q`. Dimensiona el sesgo de supervivencia. */
export interface RegEstadoUniverso extends RegistroBase {
  tipo: "estado-universo";
  estado: EstadoCompraAgil;
  total_resultados: number | null; // null = no se alcanzó a medir (cuota), NUNCA 0
  /**
   * La API TOPEA `total_resultados` en 10.000. Medido el 2026-08-20: `cerrada`, `desierta` y
   * `cancelada` devolvieron exactamente 10000 las tres, mientras `publicada` daba 8.980 y
   * `proveedor_seleccionado` 0. Un valor topeado es una cota inferior, no un conteo: reportarlo
   * como "10.000 compras cerradas" sería inventar precisión que la API no entrega.
   */
  topeado: boolean;
}

/** Etapas B y D: tamaño exacto de un término, en un estado. */
export interface RegTermino extends RegistroBase {
  tipo: "termino";
  termino: string;
  grupo: "keepsync" | "control";
  estado: EstadoCompraAgil;
  total_resultados: number | null;
  /** Ver `RegEstadoUniverso.topeado`: 10.000 es el techo que informa la API, no un conteo. */
  topeado: boolean;
  muestra_nombres: string[];
  /**
   * El endpoint responde 500 ERROR_INTERNO a algunos términos perfectamente válidos: medido el
   * 2026-08-20 con `q=aseo`, que no contiene la palabra "de" ni ningún otro quirk conocido. Un
   * término que falla se registra con `total_resultados: null` y su error — nunca con 0, que se
   * leería como "no hay demanda de aseo".
   */
  error?: string;
}

/** Etapas C y E: una compra vista, proyectada desde el LISTADO (nunca hay detalle acá). */
export interface RegCompra extends RegistroBase {
  tipo: "compra";
  /** "muestra:pagina-N" (estrato C, insesgado) o "termino:<t>" (estrato E, dirigido). El análisis
   * NO puede mezclarlos: uno estima el universo, el otro describe una familia. */
  origen: string;
  codigo: string;
  nombre: string;
  estado: string;
  estado_convocatoria: EstadoConvocatoria;
  fecha_publicacion: string;
  fecha_cierre: string;
  moneda: string;
  monto_disponible_clp: number;
  rut: string;
  organismo: string;
  unidad_compra: string;
  region: number;
  nombre_region: string;
  total_ofertas_recibidas: number;
  n_documentos: number;
}

/**
 * Etapa E: el material para calibrar cuánto sub-reporta clasificar solo por `nombre`. Guarda el
 * texto, no el veredicto: las familias todavía no existen cuando esto se mide, y ése es justamente
 * el orden que corta el sesgo circular.
 */
export interface RegDetalle extends RegistroBase {
  tipo: "detalle";
  codigo: string;
  nombre: string;
  descripcion: string;
  productos_texto: string;
  codigos_onu: number[];
}

export type RegistroMercado = RegEstadoUniverso | RegTermino | RegCompra | RegDetalle;

// ── Lectura y escritura ──────────────────────────────────────────────────────────────────────────

export function leerMercado(): RegistroMercado[] {
  if (!existsSync(MERCADO_PATH)) return [];
  return readFileSync(MERCADO_PATH, "utf-8")
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => JSON.parse(l) as RegistroMercado);
}

/**
 * Anexa en lote, con UNA escritura por llamada.
 *
 * A propósito NO se copia `anexar()` de src/lib/indice.ts: esa función llama a `ultimaPorCodigo()`,
 * que relee el archivo entero en cada invocación. Con 14 líneas no se nota; con cientos o miles es
 * O(n²) y cuelga la corrida. El dedupe acá lo hace el llamador en memoria, con el set que devuelve
 * `codigosYaVistos()`. (El patrón latente de `indice.ts` no se toca: a su tamaño actual no duele, y
 * el repo prefiere una nota explícita a un refactor especulativo.)
 */
export function anexarMercado(registros: RegistroMercado[]): number {
  if (registros.length === 0) return 0;
  const lineas: string[] = [];
  for (const r of registros) {
    const linea = JSON.stringify(r);
    const bytes = Buffer.byteLength(linea, "utf-8");
    if (bytes >= MAX_BYTES_LINEA) {
      // Mejor perder un registro que corromper el JSONL compartido para todos.
      throw new Error(
        `Registro ${r.tipo} pesa ${bytes} bytes (>${MAX_BYTES_LINEA}) — supera el límite de escritura atómica ` +
          `de historico/mercado.jsonl. Revisar truncamiento antes de anexar.`,
      );
    }
    lineas.push(linea);
  }
  mkdirSync(path.dirname(MERCADO_PATH), { recursive: true });
  appendFileSync(MERCADO_PATH, lineas.join("\n") + "\n", "utf-8");
  return lineas.length;
}

/** Los códigos ya registrados como `compra`, para deduplicar en memoria durante la corrida. */
export function codigosYaVistos(registros: RegistroMercado[]): Set<string> {
  const s = new Set<string>();
  for (const r of registros) if (r.tipo === "compra") s.add(r.codigo);
  return s;
}

/** Techo observado de `paginacion.total_resultados` (medido el 2026-08-20 en tres estados a la vez). */
export const TOPE_TOTAL_RESULTADOS = 10000;

export const esTopeado = (total: number | null): boolean => total != null && total >= TOPE_TOTAL_RESULTADOS;

const truncar = (s: string | null | undefined, n: number): string => (s ?? "").slice(0, n);

export function proyectarCompra(
  item: CompraAgilListItem,
  origen: string,
  corridaId: string,
  medidoEn: string,
): RegCompra {
  return {
    tipo: "compra",
    corrida_id: corridaId,
    medido_en: medidoEn,
    origen,
    codigo: item.codigo,
    nombre: truncar(item.nombre, MAX_CHARS_NOMBRE),
    estado: item.estado?.codigo ?? "",
    estado_convocatoria: item.convocatoria?.estado_convocatoria ?? 1,
    fecha_publicacion: item.fechas?.fecha_publicacion ?? "",
    fecha_cierre: item.fechas?.fecha_cierre ?? "",
    moneda: item.montos?.moneda ?? "CLP",
    monto_disponible_clp: item.montos?.monto_disponible_clp ?? 0,
    rut: item.institucion?.rut ?? "",
    organismo: truncar(item.institucion?.organismo_comprador, 120),
    unidad_compra: truncar(item.institucion?.unidad_compra, 120),
    region: item.institucion?.region ?? 0,
    nombre_region: (item.institucion?.nombre_region ?? "").trim(),
    total_ofertas_recibidas: item.resumen?.total_ofertas_recibidas ?? 0,
    n_documentos: (item.documentos ?? []).length,
  };
}

export function proyectarDetalle(d: CompraAgilDetalle, corridaId: string, medidoEn: string): RegDetalle {
  const productos = d.productos_solicitados ?? [];
  return {
    tipo: "detalle",
    corrida_id: corridaId,
    medido_en: medidoEn,
    codigo: d.codigo,
    nombre: truncar(d.nombre, MAX_CHARS_NOMBRE),
    descripcion: truncar(d.descripcion, MAX_CHARS_DESCRIPCION),
    productos_texto: truncar(productos.flatMap((p) => [p.nombre ?? "", p.descripcion ?? ""]).join(" · "), 1000),
    codigos_onu: [...new Set(productos.map((p) => p.codigo_producto).filter((c) => c != null))],
  };
}

/**
 * Qué fracción de los 10 nombres de muestra de un término contienen realmente ese término.
 *
 * Es la corrección más importante del estudio, y salió de mirar las muestras (2026-08-20): el `q`
 * de la API **no busca solo en el nombre**, también en la descripción, donde vive el machaque
 * administrativo de cualquier ficha. Por eso `q=datos` devuelve 569 resultados encabezados por
 * "Caja de Alimentos… se solicita completar todos los datos", y `q=desarrollo` devuelve 365 en los
 * que ni uno menciona desarrollo de nada.
 *
 * O sea: `total_resultados` es un conteo exacto de lo que la API devuelve, y a la vez una **cota
 * superior contaminada** del tamaño de la familia. Esta función mide la contaminación con los
 * nombres que ya se trajeron, sin gastar un request más. La raíz se recorta dos caracteres porque
 * el buscador tolera variaciones morfológicas (medido: `q=capacitacion` trae "CAPACITACIO").
 */
export function precisionEnNombre(termino: string, muestraNombres: string[]): number | null {
  if (muestraNombres.length === 0) return null;
  const raiz = termino
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .slice(0, Math.max(5, termino.length - 2));
  const hits = muestraNombres.filter((n) =>
    n.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().includes(raiz),
  ).length;
  return hits / muestraNombres.length;
}

/**
 * Páginas a pedir para una muestra sistemática de `cuantas` páginas sobre `totalPaginas`.
 * Sistemática y no aleatoria a propósito: es reproducible (mismo total → mismas páginas), lo que
 * permite verificar la corrida sin volver a gastar cuota.
 */
export function paginasDeMuestra(totalPaginas: number, cuantas: number): number[] {
  if (totalPaginas <= 0) return [];
  if (totalPaginas <= cuantas) return Array.from({ length: totalPaginas }, (_, i) => i + 1);
  const paso = totalPaginas / cuantas;
  const paginas = new Set<number>();
  for (let i = 0; i < cuantas; i++) paginas.add(Math.min(totalPaginas, Math.floor(i * paso) + 1));
  return [...paginas].sort((a, b) => a - b);
}

/**
 * Error de muestreo (95%) de una proporción estimada sobre una muestra de tamaño n, con corrección
 * por población finita. Se publica junto a toda cifra del estrato C — sin él, una estimación se lee
 * como un conteo.
 */
export function errorMuestreoPct(p: number, n: number, poblacion: number): number | null {
  if (n <= 1 || poblacion <= 1) return null;
  const fpc = Math.sqrt(Math.max(0, (poblacion - n) / (poblacion - 1)));
  return 1.96 * Math.sqrt(Math.max(0, p * (1 - p)) / n) * fpc * 100;
}
