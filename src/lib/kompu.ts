/**
 * Radar de hardware TI para Kompu.cl — tóner e insumos de impresión, impresoras y
 * multifuncionales, notebooks, UPS y CCTV. Publica `docs/kompu.html`.
 *
 * Tres cosas lo separan del radar de los cinco nichos y del de Array, y explican casi todo el
 * diseño de este archivo:
 *
 *  1. **No pide el detalle de ninguna compra.** `obtenerDetalleCompraAgil` no se llama nunca.
 *     `CompraAgilListItem` ya trae monto, estado, organismo, región, ofertas recibidas y motivo
 *     de fracaso — que es todo lo que necesita un estudio de mercado. El precio es que el embudo
 *     evalúa solo `nombre`; la página lo declara.
 *  2. **Para medir el mercado no se pagina: se cuenta.** `buscarCompraAgilPagina` devuelve
 *     `paginacion.total_resultados` en la PRIMERA página, así que un request por
 *     `(variante × estado)` entrega el tamaño de la familia más 25 filas de muestra. Paginar
 *     `cerrada`/`desierta`/`cancelada` a fondo gastaría ~100 requests para refinar un número que
 *     ya se tenía con uno. Solo `publicada` se pagina, porque es el único estado donde se puede
 *     ofertar.
 *  3. **Las variantes `q` se miden antes de comprarlas** (`--sondeo`), en vez de elegirlas a
 *     dedo — que es el método que PLAN-VOLUMEN.md:271-272 culpa del 79% de fracaso del nicho
 *     Claude.
 */
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ROOT_DIR } from "./config.js";
import { compilarPatrones, confirmarCategoriaEnTexto, type ResultadoConfirmacion } from "./categorias.js";
import { esTopeado, precisionEnNombre } from "./mercado.js";
import {
  buscarCompraAgilPagina,
  CuotaApiAgotadaError,
  type CompraAgilListItem,
  type EstadoCompraAgil,
} from "./api.js";
import { CuotaLocalAgotadaError } from "./cuota.js";

export const RUBROS_PATH_REL = "config/kompu-rubros.json";
export const KOMPU_PATH = path.join(ROOT_DIR, "historico", "kompu.jsonl");
/**
 * El censo de la última corrida, versionado junto al índice. Va acá y no en `data/` —que es
 * efímero y gitignored— porque es la evidencia de la que salen el volumen y la tasa de la página:
 * sin él, `--solo-indice` republicaría la grilla pero con la sección "¿hay mercado?" vacía. Mismo
 * reparto que en transformación digital, donde el jsonl guarda la observación y un JSON aparte
 * guarda el contenido, y `rehidratar()` los junta al republicar.
 */
export const KOMPU_CENSO_PATH = path.join(ROOT_DIR, "historico", "kompu-censo.json");

/**
 * `publicada` PRIMERO a propósito: si la cuota se agota a mitad de corrida, lo primero que ya se
 * tiene es la grilla accionable. Los otros cuatro sirven para medir el mercado, no para ofertar.
 */
export const ESTADOS_KOMPU: EstadoCompraAgil[] = [
  "publicada",
  "proveedor_seleccionado",
  "cerrada",
  "desierta",
  "cancelada",
];

/** Medido: `tamano_pagina=50` devuelve HTTP 504 tres de cada cuatro veces; 25 es el punto dulce. */
export const TAMANO_PAGINA_KOMPU = 25;

export type Naturaleza = "producto" | "servicio" | "arriendo";

interface RubroCrudo {
  id: string;
  nombre: string;
  nombre_corto?: string;
  activo: boolean;
  variantes_q: string[];
  verificacion_regex: string;
  verificacion_flags?: string;
  patron_requerido?: string;
  patron_excluyente?: string;
}

export interface RubroKompu {
  id: string;
  nombre: string;
  nombreCorto: string;
  activo: boolean;
  variantes: string[];
  /** Las tres puertas ya compiladas: `regex`, `requerido`, `excluyente`. */
  regex: RegExp;
  requerido: RegExp | null;
  excluyente: RegExp | null;
}

interface ConfigNaturaleza {
  arriendo: string;
  servicio: string;
  guard_producto: string;
}

/** Mismo quirk verificado que en `config/categorias.json`: un `q` con "de" suelto → 500. */
const DE_SUELTO = /(^|\s)de(\s|$)/i;

let cacheRubros: RubroKompu[] | null = null;
let cacheNaturaleza: { arriendo: RegExp; servicio: RegExp; guard: RegExp } | null = null;

function leerConfig(): { rubros: RubroCrudo[]; naturaleza: ConfigNaturaleza } {
  const p = path.join(ROOT_DIR, RUBROS_PATH_REL);
  if (!existsSync(p)) throw new Error(`Falta ${RUBROS_PATH_REL}.`);
  return JSON.parse(readFileSync(p, "utf-8")) as { rubros: RubroCrudo[]; naturaleza: ConfigNaturaleza };
}

/**
 * Carga y compila `config/kompu-rubros.json`. Reusa `compilarPatrones` de `categorias.ts`, que ya
 * está extraída justo para que un segundo archivo de config herede las mismas validaciones —la
 * prohibición de los flags "g"/"y" sobre todo, que con `.test()` en un bucle produce falsos
 * negativos intermitentes—. Es lo mismo que hizo `config/familias-mercado.json`.
 */
export function cargarRubrosKompu(): RubroKompu[] {
  if (cacheRubros) return cacheRubros;
  const { rubros } = leerConfig();
  cacheRubros = rubros.map((r) => {
    if (!/^[a-z0-9-]+$/.test(r.id)) {
      throw new Error(`${RUBROS_PATH_REL}: id inválido "${r.id}" — debe cumplir /^[a-z0-9-]+$/.`);
    }
    for (const v of r.variantes_q) {
      if (DE_SUELTO.test(v)) {
        throw new Error(
          `${RUBROS_PATH_REL}: la variante "${v}" del rubro "${r.id}" contiene la palabra suelta "de". ` +
            `Quirk verificado de /v2/compra-agil: responde 500 ERROR_INTERNO. El buscador hace OR de los ` +
            `tokens, así que quitarla encuentra lo mismo.`,
        );
      }
    }
    const patrones = compilarPatrones(r.id, r, RUBROS_PATH_REL);
    return {
      id: r.id,
      nombre: r.nombre,
      nombreCorto: r.nombre_corto ?? r.nombre,
      activo: r.activo,
      variantes: [...new Set(r.variantes_q)],
      ...patrones,
    };
  });
  return cacheRubros;
}

export function rubrosActivos(): RubroKompu[] {
  return cargarRubrosKompu().filter((r) => r.activo);
}

/**
 * Kompu vende PRODUCTO; mantención, reparación y arriendo del mismo equipo son otro negocio.
 * Se rotula en vez de excluir: excluir borra filas en silencio, y de paso responde cuánto del
 * mercado es venta y cuánto servicio.
 */
export function clasificarNaturaleza(texto: string): Naturaleza {
  if (!cacheNaturaleza) {
    const n = leerConfig().naturaleza;
    cacheNaturaleza = {
      arriendo: new RegExp(n.arriendo, "i"),
      servicio: new RegExp(n.servicio, "i"),
      guard: new RegExp(n.guard_producto, "i"),
    };
  }
  const { arriendo, servicio, guard } = cacheNaturaleza;
  if (arriendo.test(texto)) return "arriendo";
  // "COMPRA DE TONER Y KIT DE MANTENCION EQUIPOS TECNOLOGICOS" es producto: un kit de mantención
  // es un repuesto consumible, no un servicio. Sin este guard, "MANTENCION" lo rotulaba mal.
  if (guard.test(texto) && !/servicios?\s+de\s+/i.test(texto)) return "producto";
  if (servicio.test(texto)) return "servicio";
  return "producto";
}

/** Nivel único del embudo: el `nombre` del listado, que es lo que hay sin pagar el detalle. */
export function clasificarItem(rubro: RubroKompu, nombre: string): ResultadoConfirmacion {
  return confirmarCategoriaEnTexto(rubro, nombre ?? "");
}

/** Las consultas de la corrida, deduplicadas: una `q` compartida se paga una sola vez. */
export function consultasDeLaCorrida(rubros: RubroKompu[]): Map<string, RubroKompu[]> {
  const m = new Map<string, RubroKompu[]>();
  for (const r of rubros) {
    for (const v of r.variantes) {
      const lista = m.get(v) ?? [];
      if (!lista.includes(r)) lista.push(r);
      m.set(v, lista);
    }
  }
  return m;
}

// ── Índice histórico versionado ──────────────────────────────────────────────────────────────

export interface ObservacionKompu {
  codigo: string;
  rubros: string[];
  naturaleza: Naturaleza;
  nombre: string;
  estado: string;
  estado_convocatoria: number;
  organismo: string;
  rut: string;
  region: number;
  nombre_region: string;
  fecha_publicacion: string;
  fecha_cierre: string;
  monto_disponible_clp: number;
  total_ofertas_recibidas: number;
  motivo_cancelacion: string | null;
  motivo_desierta: string | null;
  /** `por_verificar`: el nombre menciona la materia pero no confirma el rubro (`falta-requerido`). */
  por_verificar: string[];
  observado_en: string;
}

export function proyectarObservacion(
  item: CompraAgilListItem,
  rubros: string[],
  porVerificar: string[],
  ahoraIso: string,
): ObservacionKompu {
  const nombre = item.nombre ?? "";
  return {
    codigo: item.codigo,
    rubros,
    naturaleza: clasificarNaturaleza(nombre),
    nombre,
    estado: item.estado?.codigo ?? "",
    estado_convocatoria: item.convocatoria?.estado_convocatoria ?? 0,
    organismo: item.institucion?.organismo_comprador ?? "",
    rut: item.institucion?.rut ?? "",
    region: item.institucion?.region ?? 0,
    nombre_region: item.institucion?.nombre_region ?? "",
    fecha_publicacion: item.fechas?.fecha_publicacion ?? "",
    fecha_cierre: item.fechas?.fecha_cierre ?? "",
    monto_disponible_clp: item.montos?.monto_disponible_clp ?? 0,
    total_ofertas_recibidas: item.resumen?.total_ofertas_recibidas ?? 0,
    motivo_cancelacion: item.motivos?.motivo_cancelacion ?? null,
    motivo_desierta: item.motivos?.motivo_desierta ?? null,
    por_verificar: porVerificar,
    observado_en: ahoraIso,
  };
}

export function leerIndiceKompu(): ObservacionKompu[] {
  if (!existsSync(KOMPU_PATH)) return [];
  const out: ObservacionKompu[] = [];
  for (const linea of readFileSync(KOMPU_PATH, "utf-8").split("\n")) {
    const t = linea.trim();
    if (!t) continue;
    try {
      out.push(JSON.parse(t) as ObservacionKompu);
    } catch {
      // Una línea corrupta no puede tumbar la corrida: el índice es acumulativo y se sigue.
    }
  }
  return out;
}

/**
 * Última observación de cada código. El desempate es `>=` y NO `>` a propósito: `ultimaPorCodigo`
 * de `src/lib/indice.ts` usa `>` estricto y por eso una línea reescrita que conservara su
 * `observado_en` original empataba con la vieja y perdía — el bug silencioso ya documentado en
 * CLAUDE.md. Acá, además, cada republicación resella `observado_en`.
 */
export function ultimaPorCodigoKompu(obs = leerIndiceKompu()): Map<string, ObservacionKompu> {
  const m = new Map<string, ObservacionKompu>();
  for (const o of obs) {
    const previa = m.get(o.codigo);
    if (!previa || o.observado_en >= previa.observado_en) m.set(o.codigo, o);
  }
  return m;
}

export interface CensoGuardado {
  corrida: string;
  estados: string[];
  celdas: CeldaCenso[];
  /**
   * Los descartes por contexto viajan con el censo y no con el índice: son un hecho de la CORRIDA
   * (qué mató cada excluyente), no de la compra. Sin persistirlos, republicar con `--solo-indice`
   * dejaba la lista vacía y la página afirmaba "ninguna descartada", que es justo el silencio que
   * esa sección existe para romper.
   */
  descartados: { codigo: string; nombre: string; rubros: string[] }[];
}

export function guardarCenso(c: CensoGuardado): void {
  writeFileSync(KOMPU_CENSO_PATH, JSON.stringify(c, null, 2), "utf-8");
}

/** El censo de la última corrida, o `null` si nunca se corrió uno. */
export function leerCenso(): CensoGuardado | null {
  if (!existsSync(KOMPU_CENSO_PATH)) return null;
  try {
    return JSON.parse(readFileSync(KOMPU_CENSO_PATH, "utf-8")) as CensoGuardado;
  } catch {
    return null;
  }
}

export function anexarObservaciones(obs: ObservacionKompu[]): number {
  if (obs.length === 0) return 0;
  // Una línea por `appendFileSync` para conservar la atomicidad que da el tope de 4.000 bytes.
  const lineas = obs.map((o) => JSON.stringify(o)).join("\n") + "\n";
  appendFileSync(KOMPU_PATH, lineas, "utf-8");
  return obs.length;
}

// ── Censo: una request por (variante × estado) ────────────────────────────────────────────────

export interface CeldaCenso {
  variante: string;
  estado: EstadoCompraAgil;
  /** Cota SUPERIOR contaminada: el `q` busca también en la descripción. Nunca es un conteo. */
  total_resultados: number;
  /** true si `total_resultados` llegó al tope de 10.000 de la API: cota inferior, no conteo. */
  topeado: boolean;
  /** Fracción de la muestra cuyo NOMBRE contiene la raíz del término. Corrige la contaminación. */
  precision: number | null;
  filas_muestra: number;
  paginas_leidas: number;
  /** true si quedaron páginas sin leer (solo puede pasar en `publicada`, la única que se pagina). */
  truncado: boolean;
  error?: string;
}

export interface ResultadoCenso {
  celdas: CeldaCenso[];
  /** Última observación por código, ya clasificada. */
  items: Map<string, { item: CompraAgilListItem; rubros: Set<string>; porVerificar: Set<string> }>;
  descartados: { codigo: string; nombre: string; rubros: string[] }[];
  requests: number;
  cuotaAgotada: boolean;
}

export interface OpcionesCenso {
  rubros: RubroKompu[];
  estados: EstadoCompraAgil[];
  /** Páginas a leer de `publicada`. El resto de los estados siempre lee 1 (censo por conteo). */
  maxPaginasPublicada: number;
  sinCuota: () => boolean;
}

/**
 * El barrido completo. Ante cuota agotada NO reintenta a ciegas: corta y devuelve lo ya
 * descubierto, que es el guardrail del repo y lo que hace que la página se publique igual.
 */
export async function censar(opts: OpcionesCenso): Promise<ResultadoCenso> {
  const consultas = consultasDeLaCorrida(opts.rubros);
  const res: ResultadoCenso = {
    celdas: [],
    items: new Map(),
    descartados: [],
    requests: 0,
    cuotaAgotada: false,
  };
  const yaDescartado = new Set<string>();

  const clasificar = (item: CompraAgilListItem, deLaConsulta: RubroKompu[]): void => {
    const nombre = item.nombre ?? "";
    const previa = res.items.get(item.codigo);
    const rubros = previa?.rubros ?? new Set<string>();
    const porVerificar = previa?.porVerificar ?? new Set<string>();
    const excluidos: string[] = [];
    // Se evalúa contra TODOS los rubros, no solo los que trajeron la consulta: una compra que
    // llegó por `q=impresora` puede ser también de insumos, y esa mención sale gratis.
    for (const r of opts.rubros) {
      const v = clasificarItem(r, nombre);
      if (v === "confirmada") rubros.add(r.id);
      else if (v === "falta-requerido") porVerificar.add(r.id);
      else if (v === "excluida") excluidos.push(r.nombre);
    }
    if (rubros.size > 0 || porVerificar.size > 0) {
      // El listado recién traído manda sobre lo que hubiera antes: una compra que se vio
      // "publicada" hace días hoy puede estar cerrada, y publicar el estado viejo haría creer
      // que todavía se puede ofertar.
      res.items.set(item.codigo, { item, rubros, porVerificar });
      return;
    }
    // Distinguir "no mencionaba nada" (ruido esperable del `q` laxo, silencioso) de "mencionaba
    // pero el contexto la desmiente": lo segundo se REPORTA, porque un excluyente demasiado ancho
    // se ve como oportunidades que desaparecen sin explicación.
    if (excluidos.length > 0 && !yaDescartado.has(item.codigo)) {
      yaDescartado.add(item.codigo);
      res.descartados.push({ codigo: item.codigo, nombre, rubros: excluidos });
    }
    void deLaConsulta;
  };

  barrido: for (const estado of opts.estados) {
    // Solo `publicada` se pagina: es el único estado donde se puede ofertar. En los demás, el
    // `total_resultados` de la primera página ya responde la pregunta de mercado.
    const maxPaginas = estado === "publicada" ? Math.max(1, opts.maxPaginasPublicada) : 1;
    for (const [variante, rubrosDeLaConsulta] of consultas) {
      const celda: CeldaCenso = {
        variante,
        estado,
        total_resultados: 0,
        topeado: false,
        precision: null,
        filas_muestra: 0,
        paginas_leidas: 0,
        truncado: false,
      };
      const nombresMuestra: string[] = [];
      let totalPaginas = 1;

      for (let pagina = 1; pagina <= maxPaginas; pagina++) {
        if (opts.sinCuota()) {
          celda.truncado = pagina <= totalPaginas && celda.paginas_leidas < totalPaginas;
          res.cuotaAgotada = true;
          res.celdas.push(celda);
          break barrido;
        }
        try {
          const p = await buscarCompraAgilPagina({
            q: variante,
            estado,
            tamanoPagina: TAMANO_PAGINA_KOMPU,
            numeroPagina: pagina,
          });
          res.requests++;
          celda.paginas_leidas++;
          if (pagina === 1) {
            celda.total_resultados = p.paginacion?.total_resultados ?? p.items.length;
            celda.topeado = esTopeado(celda.total_resultados);
          }
          totalPaginas = p.paginacion?.total_paginas ?? 1;
          celda.filas_muestra += p.items.length;
          for (const item of p.items) {
            nombresMuestra.push(item.nombre ?? "");
            clasificar(item, rubrosDeLaConsulta);
          }
          if (pagina >= totalPaginas) break;
        } catch (err) {
          if (err instanceof CuotaApiAgotadaError || err instanceof CuotaLocalAgotadaError) {
            res.cuotaAgotada = true;
            celda.error = (err as Error).message;
            res.celdas.push(celda);
            break barrido;
          }
          // El endpoint responde 500 a términos válidos sin patrón conocido: se registra como NO
          // MEDIDO, nunca como 0.
          celda.error = (err as Error).message;
          break;
        }
      }
      // Una celda que falló es NO MEDIDA, no truncada: rotularla de las dos formas sugeriría que
      // se leyó una parte. El endpoint responde 500 a términos válidos sin patrón conocido, y eso
      // nunca se registra como cero (`estimado()` la excluye del volumen en vez de sumarle 0).
      celda.truncado = !celda.error && (celda.truncado || celda.paginas_leidas < totalPaginas);
      celda.precision = precisionEnNombre(variante, nombresMuestra);
      res.celdas.push(celda);
    }
  }
  return res;
}

// ── Agregación: lo que responde "¿hay mercado?" ───────────────────────────────────────────────

export interface VolumenEstado {
  /** Suma de `total_resultados` de las variantes del rubro. Techo: cuenta dos veces los solapes. */
  sumaVariantes: number;
  /** La variante más grande sola. Piso: ninguna compra se cuenta dos veces. */
  mayorVariante: number;
  topeado: boolean;
  truncado: boolean;
}

export interface ResumenRubro {
  id: string;
  nombre: string;
  nombreCorto: string;
  /** Compras del rubro EN LA MUESTRA (índice acumulado). No es el tamaño del mercado. */
  total: number;
  porEstado: Record<string, number>;
  porNaturaleza: Record<Naturaleza, number>;
  montoMedianoClp: number | null;
  ofertasMedianas: number | null;
  /**
   * Tasa de compras efectivas calculada sobre los `total_resultados` del censo, NO sobre la
   * muestra. La distinción no es cosmética: la muestra lee ~25 filas por (variante × estado) sin
   * importar que `cancelada` traiga 2.208 y `publicada` 55, así que su mezcla de estados es un
   * artefacto del muestreo y una tasa sacada de ahí no dice nada del mercado.
   *
   * Los totales sí sirven para una RAZÓN: el solape entre variantes de un mismo rubro infla
   * numerador y denominador por igual y se cancela al dividir. Cada total se corrige antes por
   * `precisionEnNombre`, que descuenta el ruido del `q` laxo.
   */
  tasaExito: number | null;
  /** Compras estimadas ya resueltas sobre las que se calculó `tasaExito`. */
  resueltasEstimadas: number;
  volumen: Record<string, VolumenEstado>;
  recompradores: { organismo: string; compras: number; montoTotalClp: number }[];
  abiertas: number;
  fechaMin: string | null;
  fechaMax: string | null;
}

const ESTADOS_EXITOSOS = ["cerrada", "proveedor_seleccionado"];
const ESTADOS_FALLIDOS = ["desierta", "cancelada"];

function mediana(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : Math.round((s[m - 1]! + s[m]!) / 2);
}

/** `total_resultados` descontando el ruido del `q` laxo con la precisión medida en la muestra. */
function estimado(c: CeldaCenso): number {
  if (c.error) return 0;
  return Math.round(c.total_resultados * (c.precision ?? 1));
}

export function resumirRubro(rubro: RubroKompu, obs: ObservacionKompu[], celdas: CeldaCenso[]): ResumenRubro {
  const mias = obs.filter((o) => o.rubros.includes(rubro.id));
  const porEstado: Record<string, number> = {};
  const porNaturaleza: Record<Naturaleza, number> = { producto: 0, servicio: 0, arriendo: 0 };
  const porOrganismo = new Map<string, { compras: number; montoTotalClp: number }>();
  let fechaMin: string | null = null;
  let fechaMax: string | null = null;

  for (const o of mias) {
    porEstado[o.estado] = (porEstado[o.estado] ?? 0) + 1;
    porNaturaleza[o.naturaleza]++;
    const acc = porOrganismo.get(o.organismo) ?? { compras: 0, montoTotalClp: 0 };
    acc.compras++;
    acc.montoTotalClp += o.monto_disponible_clp;
    porOrganismo.set(o.organismo, acc);
    if (o.fecha_publicacion) {
      if (!fechaMin || o.fecha_publicacion < fechaMin) fechaMin = o.fecha_publicacion;
      if (!fechaMax || o.fecha_publicacion > fechaMax) fechaMax = o.fecha_publicacion;
    }
  }

  // ── Volumen y desenlace, desde los totales del censo ────────────────────────────────────────
  const mis = new Set(rubro.variantes);
  const volumen: Record<string, VolumenEstado> = {};
  for (const c of celdas) {
    if (!mis.has(c.variante) || c.error) continue;
    const v = (volumen[c.estado] ??= { sumaVariantes: 0, mayorVariante: 0, topeado: false, truncado: false });
    const e = estimado(c);
    v.sumaVariantes += e;
    v.mayorVariante = Math.max(v.mayorVariante, e);
    v.topeado ||= c.topeado;
    v.truncado ||= c.truncado;
  }
  const suma = (estados: string[]): number =>
    estados.reduce((a, e) => a + (volumen[e]?.sumaVariantes ?? 0), 0);
  const exitosas = suma(ESTADOS_EXITOSOS);
  const resueltasEstimadas = exitosas + suma(ESTADOS_FALLIDOS);

  return {
    id: rubro.id,
    nombre: rubro.nombre,
    nombreCorto: rubro.nombreCorto,
    total: mias.length,
    porEstado,
    porNaturaleza,
    montoMedianoClp: mediana(mias.map((o) => o.monto_disponible_clp).filter((n) => n > 0)),
    ofertasMedianas: mediana(mias.filter((o) => o.estado !== "publicada").map((o) => o.total_ofertas_recibidas)),
    tasaExito: resueltasEstimadas > 0 ? exitosas / resueltasEstimadas : null,
    resueltasEstimadas,
    volumen,
    recompradores: [...porOrganismo.entries()]
      .filter(([, v]) => v.compras >= 2)
      .map(([organismo, v]) => ({ organismo, ...v }))
      .sort((a, b) => b.compras - a.compras || b.montoTotalClp - a.montoTotalClp),
    abiertas: porEstado["publicada"] ?? 0,
    fechaMin,
    fechaMax,
  };
}
