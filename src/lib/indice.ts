/**
 * Índice histórico append-only de observaciones de Compra Ágil (ver PLAN-VOLUMEN.md, Fase 2).
 *
 * Por qué existe: `data/state.json` está gitignored y los agentes de GitHub Copilot corren sobre
 * un checkout limpio — en la nube, `cargarState()` siempre arranca vacío, así que el radar nunca
 * detecta recompradores ahí (66% del mercado son recompradores; es la señal más valiosa que se
 * estaba perdiendo). `historico/observaciones.jsonl` sí se versiona, así que sobrevive al cambio
 * de máquina entre la sesión local y la nube — `sembrarDesdeIndice` (en historial.ts) lo usa para
 * poblar el estado al arrancar.
 *
 * Es una PROYECCIÓN (≈25 campos), no el payload crudo — `data/<codigo>/detalle.json` sigue siendo
 * el caché completo, efímero y regenerable. Una línea por *cambio observado* (hash distinto al de
 * la última observación de ese código), no por corrida — evita que 10 corridas del mismo día sin
 * cambios infle el archivo 10x.
 */
import { existsSync, readFileSync, appendFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { ROOT_DIR } from "./config.js";
import { obtenerDetalleCompraAgil, type CompraAgilDetalle } from "./api.js";
import { cierreYaPaso } from "./tiempo.js";

const INDICE_PATH = path.join(ROOT_DIR, "historico", "observaciones.jsonl");

// `appendFileSync` sobre un fd O_APPEND es atómico solo por debajo de PIPE_BUF (4096 bytes en
// Linux). El índice lo escriben tanto la máquina local como el agente de la nube — sin este
// límite, dos escrituras concurrentes de líneas largas podrían intercalarse y corromper el JSONL.
const MAX_BYTES_LINEA = 4000;
const MAX_CHARS_MOTIVO = 1000;

export interface Observacion {
  codigo: string;
  categoria: string; // id de la categoría que la capturó (config/categorias.json)
  observado_en: string; // ISO
  hash: string; // sha256 de todos los campos de abajo excepto observado_en/hash

  rut: string;
  organismo: string;
  unidad_compra: string;
  region: number;
  nombre_region: string;

  fecha_publicacion: string;
  fecha_cierre: string;
  fecha_ultimo_cambio: string;

  estado: string; // estado.codigo
  estado_convocatoria: 1 | 2;

  moneda: string;
  presupuesto_estimado: number;
  monto_disponible_clp: number;

  total_ofertas_recibidas: number;
  total_demandas: number;
  multa_sancion: number;

  plazo_entrega_dias: number | null;
  codigos_onu: number[]; // productos_solicitados[].codigo_producto, deduplicado
  cantidad_total: number;

  motivo_desierta: string | null; // truncado a MAX_CHARS_MOTIVO — el texto íntegro vive en detalle.json
  motivo_cancelacion: string | null;
  motivo_seleccion: string | null;

  tiene_documentos: boolean;
  nombre: string;
}

function truncarMotivo(m: string | null | undefined): string | null {
  if (!m) return null;
  return m.length > MAX_CHARS_MOTIVO ? m.slice(0, MAX_CHARS_MOTIVO) + "…" : m;
}

/** Proyecta un detalle completo de la API a la forma reducida que se versiona. */
export function proyectar(d: CompraAgilDetalle, categoria: string, ahoraIso: string): Observacion {
  const codigosOnu = [...new Set((d.productos_solicitados ?? []).map((p) => p.codigo_producto).filter((c) => c != null))];
  const cantidadTotal = (d.productos_solicitados ?? []).reduce((acc, p) => acc + (p.cantidad || 0), 0);

  return {
    codigo: d.codigo,
    categoria,
    observado_en: ahoraIso,
    hash: "", // se completa en anexar(), después de construir el resto del objeto
    rut: d.institucion.rut,
    organismo: d.institucion.organismo_comprador,
    unidad_compra: d.institucion.unidad_compra,
    region: d.institucion.region,
    nombre_region: d.institucion.nombre_region,
    fecha_publicacion: d.fechas.fecha_publicacion,
    fecha_cierre: d.fechas.fecha_cierre,
    fecha_ultimo_cambio: d.fechas.fecha_ultimo_cambio,
    estado: d.estado.codigo,
    estado_convocatoria: d.convocatoria.estado_convocatoria,
    moneda: d.presupuesto.moneda,
    presupuesto_estimado: d.presupuesto.presupuesto_estimado,
    monto_disponible_clp: d.presupuesto.monto_disponible_clp,
    total_ofertas_recibidas: d.resumen.total_ofertas_recibidas,
    total_demandas: d.resumen.total_demandas,
    multa_sancion: d.resumen.multa_sancion,
    plazo_entrega_dias: d.entrega?.plazo_entrega_dias ?? null,
    codigos_onu: codigosOnu,
    cantidad_total: cantidadTotal,
    motivo_desierta: truncarMotivo(d.motivos.motivo_desierta),
    motivo_cancelacion: truncarMotivo(d.motivos.motivo_cancelacion),
    motivo_seleccion: truncarMotivo(d.motivos.motivo_seleccion ?? null),
    tiene_documentos: d.documentos.length > 0,
    nombre: d.nombre,
  };
}

/** Hash estable de una observación, excluyendo `observado_en`/`hash` (son las que cambian aunque nada relevante haya cambiado). */
export function hashObservacion(o: Observacion): string {
  const { observado_en: _oe, hash: _h, ...resto } = o;
  return createHash("sha256").update(JSON.stringify(resto)).digest("hex").slice(0, 16);
}

function leerCrudo(): string[] {
  if (!existsSync(INDICE_PATH)) return [];
  return readFileSync(INDICE_PATH, "utf-8")
    .split("\n")
    .filter((l) => l.trim().length > 0);
}

export interface FiltroIndice {
  categoria?: string;
  desde?: string; // ISO, filtra por observado_en >=
  estados?: string[];
}

export function leer(filtro?: FiltroIndice): Observacion[] {
  const obs = leerCrudo().map((l) => JSON.parse(l) as Observacion);
  if (!filtro) return obs;
  return obs.filter(
    (o) =>
      (!filtro.categoria || o.categoria === filtro.categoria) &&
      (!filtro.desde || o.observado_en >= filtro.desde) &&
      (!filtro.estados || filtro.estados.includes(o.estado)),
  );
}

/** Última observación conocida por código (la más reciente por `observado_en`). */
export function ultimaPorCodigo(obs?: Observacion[]): Map<string, Observacion> {
  const lista = obs ?? leer();
  const mapa = new Map<string, Observacion>();
  for (const o of lista) {
    const actual = mapa.get(o.codigo);
    if (!actual || o.observado_en > actual.observado_en) mapa.set(o.codigo, o);
  }
  return mapa;
}

export interface ResultadoAnexar {
  escrita: boolean;
  motivo: "nueva" | "cambio" | "sin_cambios";
}

/**
 * Agrega una observación al índice SOLO si cambió respecto de la última registrada para ese
 * código (comparando hash). Idempotente: correr el radar 10 veces el mismo día sin cambios no
 * infla el archivo.
 */
export function anexar(o: Omit<Observacion, "hash">): ResultadoAnexar {
  const completa: Observacion = { ...o, hash: "" };
  const hash = hashObservacion(completa);
  completa.hash = hash;

  const ultima = ultimaPorCodigo().get(o.codigo);
  if (ultima && ultima.hash === hash) {
    return { escrita: false, motivo: "sin_cambios" };
  }

  const linea = JSON.stringify(completa);
  const bytes = Buffer.byteLength(linea, "utf-8");
  if (bytes >= MAX_BYTES_LINEA) {
    // No debería pasar con los truncamientos de arriba, pero es la garantía real de atomicidad
    // del archivo compartido — mejor perder una observación que corromper el JSONL para todos.
    throw new Error(
      `Observación de ${o.codigo} pesa ${bytes} bytes (>${MAX_BYTES_LINEA}) — supera el límite de escritura ` +
        `atómica de historico/observaciones.jsonl. Revisar truncamiento de motivos/nombre antes de anexar.`,
    );
  }

  mkdirSync(path.dirname(INDICE_PATH), { recursive: true });
  appendFileSync(INDICE_PATH, linea + "\n", "utf-8");
  return { escrita: true, motivo: ultima ? "cambio" : "nueva" };
}

/**
 * Reconstruye una ficha a partir de una observación del índice. Gemela de `detalleDesdeListado`
 * (`src/lib/api.ts`) y con el mismo contrato: lo que la proyección no guarda queda **vacío**, no
 * inventado — `descripcion`, `productos_solicitados` y `documentos`. Quien la consuma debe
 * declarar que es una ficha reducida.
 */
export function detalleDesdeObservacion(o: Observacion): CompraAgilDetalle {
  return {
    codigo: o.codigo,
    nombre: o.nombre,
    descripcion: "",
    // `id_estado` no se proyecta al índice (nadie lo consume) y `glosa` tampoco: se repite el
    // código en vez de inventar una glosa que no se observó.
    estado: { id_estado: 0, codigo: o.estado, glosa: o.estado },
    convocatoria: {
      estado_convocatoria: o.estado_convocatoria,
      descripcion: o.estado_convocatoria === 1 ? "Primer llamado" : "Segundo llamado",
      fecha_cierre_primer_llamado: o.estado_convocatoria === 1 ? o.fecha_cierre : "",
      fecha_cierre_segundo_llamado: o.estado_convocatoria === 2 ? o.fecha_cierre : "",
    },
    fechas: {
      fecha_publicacion: o.fecha_publicacion,
      fecha_cierre: o.fecha_cierre,
      fecha_ultimo_cambio: o.fecha_ultimo_cambio,
    },
    documentos: [],
    presupuesto: {
      tipo_presupuesto: "",
      moneda: o.moneda,
      presupuesto_estimado: o.presupuesto_estimado,
      monto_disponible: o.monto_disponible_clp,
      monto_disponible_clp: o.monto_disponible_clp,
    },
    institucion: {
      rut: o.rut,
      organismo_comprador: o.organismo,
      unidad_compra: o.unidad_compra,
      region: o.region,
      nombre_region: o.nombre_region,
    },
    productos_solicitados: [],
    resumen: {
      multa_sancion: o.multa_sancion,
      total_ofertas_recibidas: o.total_ofertas_recibidas,
      total_demandas: o.total_demandas,
    },
    motivos: {
      motivo_desierta: o.motivo_desierta,
      motivo_cancelacion: o.motivo_cancelacion,
      motivo_seleccion: o.motivo_seleccion,
    },
    entrega: o.plazo_entrega_dias != null ? { plazo_entrega_dias: o.plazo_entrega_dias } : {},
  };
}

export interface OportunidadArrastrada {
  observacion: Observacion;
  detalle: CompraAgilDetalle;
}

/**
 * Oportunidades que una corrida anterior SÍ vio, siguen abiertas y esta corrida no alcanzó a
 * re-verificar (típicamente porque se agotó la cuota antes de llegar a su categoría).
 *
 * Existe para que la grilla de `docs/index.html` deje de ser todo-o-nada. Antes, una corrida
 * incompleta no publicaba nada —para no borrar oportunidades vivas— y la página quedaba congelada
 * indefinidamente. Arrastrando lo que el índice ya sabe, nada desaparece y la página se puede
 * publicar siempre, declarando qué no se pudo re-verificar hoy.
 *
 * La fuente tiene que ser `historico/observaciones.jsonl`, que está versionado: `data/` es
 * gitignored y no existe en el checkout limpio con el que corre el agente en la nube.
 */
export function oportunidadesArrastradas(
  categoriasActivasIds: string[],
  codigosYaVistos: Set<string>,
  ahora: Date = new Date(),
): OportunidadArrastrada[] {
  const activas = new Set(categoriasActivasIds);
  const arrastradas: OportunidadArrastrada[] = [];
  for (const o of ultimaPorCodigo().values()) {
    if (o.estado !== "publicada") continue;
    if (!activas.has(o.categoria)) continue;
    if (codigosYaVistos.has(o.codigo)) continue;
    if (cierreYaPaso(o.fecha_cierre, ahora)) continue;
    arrastradas.push({ observacion: o, detalle: detalleDesdeObservacion(o) });
  }
  return arrastradas;
}

const ESTADOS_TERMINALES = new Set(["desierta", "cancelada", "cerrada", "proveedor_seleccionado"]);

/**
 * Detalle con caché-first: los estados terminales son inmutables (nunca se refetchean); para
 * "publicada", se usa `fecha_ultimo_cambio` DEL LISTADO (ya pagado — 50 códigos por request) como
 * clave de invalidación. Convierte un barrido histórico completo de N requests de detalle a ~0
 * después de la primera pasada. Usado por el backfill (`indexar.ts`), no por el radar del día
 * (que siempre quiere el dato más fresco de sus oportunidades abiertas).
 */
export async function obtenerDetalleConCache(
  codigo: string,
  pistaDelListado?: { fecha_ultimo_cambio: string },
): Promise<{ detalle: CompraAgilDetalle; desdeCache: boolean }> {
  const cachePath = path.join(ROOT_DIR, "data", codigo, "detalle.json");
  if (existsSync(cachePath)) {
    const cached = JSON.parse(readFileSync(cachePath, "utf-8")) as CompraAgilDetalle;
    if (ESTADOS_TERMINALES.has(cached.estado.codigo)) {
      return { detalle: cached, desdeCache: true };
    }
    if (pistaDelListado && cached.fechas.fecha_ultimo_cambio === pistaDelListado.fecha_ultimo_cambio) {
      return { detalle: cached, desdeCache: true };
    }
  }
  const detalle = await obtenerDetalleCompraAgil(codigo);
  mkdirSync(path.dirname(cachePath), { recursive: true });
  writeFileSync(cachePath, JSON.stringify(detalle, null, 2), "utf-8");
  return { detalle, desdeCache: false };
}
