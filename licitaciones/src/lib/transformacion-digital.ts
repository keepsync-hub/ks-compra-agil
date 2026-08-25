/**
 * El nicho de **Transformación Digital / Ley 21.180**: embudo de descubrimiento, detección de
 * requerimientos funcionales e índice histórico versionado.
 *
 * Por qué existe aparte del nicho `ged` de `keywords.json`, que se solapa en las palabras: son dos
 * preguntas distintas. `ged` responde *"¿ofertamos en esta?"* y por eso barre **solo licitaciones
 * activas**; esto responde *"¿qué le está pidiendo el Estado a un sistema como el nuestro?"*, y ahí
 * las que más enseñan son las **pasadas** —cerradas y adjudicadas—, que ya tienen bases completas y
 * foro de preguntas respondido. Mezclarlas habría acoplado dos scripts con cadencias distintas y
 * habría roto el criterio editorial de `docs/licitaciones.html` (si un párrafo no ayuda a decidir
 * si participar en una compra concreta, no va ahí).
 *
 * Un solo módulo para embudo + requerimientos + índice, siguiendo el precedente de
 * `src/lib/leads.ts`, que hace extracción, consolidación, CSV y jsonl en un archivo. El repo ya
 * arrastra `escapeHtml` duplicado seis veces; partir esto en cinco libs habría empeorado eso.
 */
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { LIC_ROOT_DIR } from "./config.js";
import { montoDeTexto, type ResultadoBusquedaPortal } from "./buscador-portal.js";

/** `licitaciones/` -> raíz del repo: `historico/` y `docs/` viven arriba. */
export const REPO_ROOT = path.resolve(LIC_ROOT_DIR, "..");

const CONFIG_PATH = path.join(LIC_ROOT_DIR, "config", "transformacion-digital.json");
const INDICE_PATH = path.join(REPO_ROOT, "historico", "transformacion-digital.jsonl");

// Mismo límite y misma razón que `src/lib/indice.ts`: `appendFileSync` sobre un fd O_APPEND es
// atómico solo por debajo de PIPE_BUF (4096 bytes en Linux), y este índice lo escriben tanto la
// máquina local como GitHub Actions. Sin el tope, dos escrituras de líneas largas podrían
// intercalarse y corromper el JSONL.
const MAX_BYTES_LINEA = 4000;

// ─────────────────────────────────────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────────────────────────────────────

export interface CategoriaTd {
  id: string;
  nombre: string;
  descripcion?: string;
  patron_mencion: string;
  consultas_portal?: string[];
}

export interface PatronRequerimiento {
  requisito: string;
  patron: string;
}

export interface EjeRequerimiento {
  id: string;
  nombre: string;
  patrones: PatronRequerimiento[];
}

export interface ConfigTd {
  /** Exige que la compra sea del SERVICIO buscado y no solo que mencione la materia. */
  patron_requerido: string;
  /** Se evalúa sobre `nombre + descripcion`. */
  patron_excluyente: string;
  /** Se evalúa SOLO sobre el nombre. Ver `_por_que_dos_campos_de_exclusion` en el JSON. */
  patron_excluyente_nombre: string;
  categorias: CategoriaTd[];
  ejes_requerimientos: EjeRequerimiento[];
}

interface ConfigCompilada {
  cruda: ConfigTd;
  requerido: RegExp;
  excluyente: RegExp;
  excluyenteNombre: RegExp;
  categorias: { id: string; nombre: string; descripcion?: string; mencion: RegExp }[];
  ejes: { id: string; nombre: string; patrones: { requisito: string; patron: RegExp }[] }[];
}

let cache: ConfigCompilada | null = null;

/**
 * Carga y compila la config. Falla ruidosamente ante una regex mala: una config rota que degradara
 * en silencio publicaría una página vacía que se leería como "no hay licitaciones de esto".
 */
export function configTd(): ConfigCompilada {
  if (cache) return cache;
  const cruda = JSON.parse(readFileSync(CONFIG_PATH, "utf-8")) as ConfigTd;
  const compilar = (patron: string, donde: string): RegExp => {
    try {
      return new RegExp(patron, "i");
    } catch (err) {
      throw new Error(`Regex inválida en ${donde} de config/transformacion-digital.json: ${String(err)}`);
    }
  };
  cache = {
    cruda,
    requerido: compilar(cruda.patron_requerido, "patron_requerido"),
    excluyente: compilar(cruda.patron_excluyente, "patron_excluyente"),
    excluyenteNombre: compilar(cruda.patron_excluyente_nombre, "patron_excluyente_nombre"),
    categorias: cruda.categorias.map((c) => ({
      id: c.id,
      nombre: c.nombre,
      descripcion: c.descripcion,
      mencion: compilar(c.patron_mencion, `categoria ${c.id}`),
    })),
    ejes: cruda.ejes_requerimientos.map((e) => ({
      id: e.id,
      nombre: e.nombre,
      patrones: e.patrones.map((p) => ({ requisito: p.requisito, patron: compilar(p.patron, `eje ${e.id}`) })),
    })),
  };
  return cache;
}

/** Invalida la caché tras editar el JSON (lo usa `--refiltrar`). */
export function recargarConfigTd(): void {
  cache = null;
}

/** Todas las consultas que se le mandan al buscador, deduplicadas y en orden estable. */
export function consultasDeDescubrimiento(): string[] {
  const vistas = new Set<string>();
  for (const c of configTd().cruda.categorias) for (const q of c.consultas_portal ?? []) vistas.add(q);
  return [...vistas];
}

// ─────────────────────────────────────────────────────────────────────────────
// Embudo local
// ─────────────────────────────────────────────────────────────────────────────

export interface Evidencia {
  categoria: string;
  /** La frase literal que hizo match. Nada se afirma sin ella. */
  cita: string;
}

export type Veredicto =
  | { pasa: true; categorias: string[]; evidencia: Evidencia[] }
  | { pasa: false; motivo: "no-requerido" | "excluyente" | "excluyente-nombre" | "sin-categoria"; patron?: string };

/**
 * El embudo, sobre `nombre` y `descripcion` — que el CSV del buscador entrega COMPLETOS, a
 * diferencia del listado de la API, que trunca el nombre a ~50 caracteres.
 *
 * `nombre` y `descripcion` se reciben por separado y no concatenados a propósito: el excluyente de
 * nombre se evalúa solo contra el primero. La alternativa —anclar la regex con `^` sobre el texto
 * unido— obligaría a recordar para siempre en qué forma exacta viene ese texto, y aplicada a la
 * ficha completa (9 secciones) el anclaje significaría otra cosa y el filtro se volvería aleatorio.
 */
export function evaluar(nombre: string, descripcion: string): Veredicto {
  const cfg = configTd();
  const texto = `${nombre}\n${descripcion}`;

  if (!cfg.requerido.test(texto)) return { pasa: false, motivo: "no-requerido" };

  const excluido = texto.match(cfg.excluyente);
  if (excluido) return { pasa: false, motivo: "excluyente", patron: excluido[0].trim().slice(0, 40) };

  const excluidoNombre = nombre.match(cfg.excluyenteNombre);
  if (excluidoNombre) return { pasa: false, motivo: "excluyente-nombre", patron: excluidoNombre[0].trim().slice(0, 40) };

  const categorias: string[] = [];
  const evidencia: Evidencia[] = [];
  for (const c of cfg.categorias) {
    const m = texto.match(c.mencion);
    if (!m) continue;
    categorias.push(c.id);
    evidencia.push({ categoria: c.id, cita: ventana(texto, m.index ?? 0, m[0].length) });
  }
  if (categorias.length === 0) return { pasa: false, motivo: "sin-categoria" };
  return { pasa: true, categorias, evidencia };
}

/** Ventana de texto alrededor del match, para que la cita se lea como frase y no como fragmento. */
function ventana(texto: string, indice: number, largo: number): string {
  const desde = Math.max(0, indice - 60);
  const hasta = Math.min(texto.length, indice + largo + 60);
  const recorte = texto.slice(desde, hasta).replace(/\s+/g, " ").trim();
  return `${desde > 0 ? "…" : ""}${recorte}${hasta < texto.length ? "…" : ""}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Requerimientos funcionales
// ─────────────────────────────────────────────────────────────────────────────

export interface Requerimiento {
  eje: string;
  requisito: string;
  /** Cita literal, recortada. */
  evidencia: string;
  /** De dónde salió: "listado del buscador" o "sección N (título)". */
  fuente: string;
}

/** Cuánto texto alcanzó a ver el detector. Se publica SIEMPRE, sobre todo cuando encontró mucho. */
export type Completitud = "solo-listado" | "solo-ficha-publica" | "con-adjuntos";

/**
 * Detecta requerimientos funcionales por patrón, con la misma disciplina de `decision.ts`: patrón
 * → cita literal → fuente. Nada se afirma sin la frase que lo respalda.
 *
 * Estos patrones NO viven en `decision.ts` a propósito: sus 15 `PATRONES_EXIGENCIA` son
 * administrativos y contractuales (garantía de seriedad, declaración jurada, patente municipal,
 * multas, visita a terreno) y sirven para decidir si una oferta es admisible, que es para lo que se
 * escribieron. No responden "qué tiene que hacer el software", que es lo que compara la Fase 3. Y
 * `decision.ts` es compartido con el nicho `ged`: ampliarlo ahí habría cambiado el comportamiento
 * de un radar que no tiene nada que ver con esto.
 *
 * Corre en dos momentos con el mismo código: sobre `nombre + descripcion` en el pase barato, y
 * sobre las secciones de la ficha cuando la licitación se enriquece (0 requests extra: ya está en
 * memoria).
 */
export function extraerRequerimientos(fuentes: { texto: string; fuente: string }[]): Requerimiento[] {
  const encontrados: Requerimiento[] = [];
  const vistos = new Set<string>();
  for (const eje of configTd().ejes) {
    for (const p of eje.patrones) {
      if (vistos.has(p.requisito)) continue;
      for (const f of fuentes) {
        const m = f.texto.match(p.patron);
        if (!m) continue;
        vistos.add(p.requisito);
        // Con el contexto previo, no solo desde donde empieza el patrón: una cita que arranca en
        // "FIRMAGOB Y CLAVE ÚNICA" pierde justo la frase que dice qué se exige de FirmaGob.
        const inicio = Math.max(0, (m.index ?? 0) - 70);
        const crudo = f.texto.slice(inicio, (m.index ?? 0) + m[0].length);
        encontrados.push({
          eje: eje.id,
          requisito: p.requisito,
          evidencia: `${inicio > 0 ? "…" : ""}${crudo.replace(/\s+/g, " ").trim()}`.slice(0, 240),
          fuente: f.fuente,
        });
        break;
      }
    }
  }
  return encontrados;
}

// ─────────────────────────────────────────────────────────────────────────────
// Índice versionado
// ─────────────────────────────────────────────────────────────────────────────

export interface DocumentoTd {
  clave: string;
  titulo: string;
  url: string;
  /** `directo` = un `fetch` lo trae · `navegador` = lo abre una persona (reCAPTCHA del portal). */
  acceso: "directo" | "navegador";
  nota?: string;
}

export interface FichaTd {
  cierre?: string;
  adjudicacion?: string;
  monto_estimado?: number;
  duracion_contrato?: string;
  peso_precio?: number;
  anexos_total?: number;
  garantia_exigida?: boolean;
  clausulas_excluyentes?: number;
  banderas_criticas?: number;
}

/**
 * Una línea del índice. Es una PROYECCIÓN, no el payload crudo: `decision.json` y
 * `antecedentes.json` completos siguen en `licitaciones/data/<codigo>/`, que es efímero y
 * regenerable. Lo que sobrevive al cambio de máquina —y a una corrida en Actions sobre un checkout
 * limpio— es esto y el manifiesto de `docs/`.
 */
export interface RegistroTd {
  codigo: string;
  observado_en: string;
  hash: string;

  nombre: string;
  descripcion: string;
  organismo: string;
  estado: string;
  /** `idEstado` del buscador con que se descubrió: 5/6/7/8/15. */
  estado_buscador: string;
  tipo: string;
  fecha_publicacion: string;
  moneda: string;
  monto_texto: string;
  monto_clp: number | null;

  /** Trazabilidad del método: por qué esta licitación está en la lista. */
  consultas: string[];
  ordenes: string[];
  categorias: string[];
  evidencia: Evidencia[];

  completitud: Completitud;
  requerimientos: Requerimiento[];

  /** Presentes solo cuando se enriqueció la ficha. */
  enriquecido_en?: string;
  ficha?: FichaTd;
  documentos?: DocumentoTd[];
  exigencias_administrativas?: { requisito: string; evidencia: string; fuente: string }[];
}

export function hashRegistro(r: RegistroIndice): string {
  const { observado_en: _o, hash: _h, ...resto } = r;
  return createHash("sha256").update(JSON.stringify(resto)).digest("hex").slice(0, 16);
}

export function leerIndice(): RegistroIndice[] {
  if (!existsSync(INDICE_PATH)) return [];
  const registros: RegistroIndice[] = [];
  for (const linea of readFileSync(INDICE_PATH, "utf-8").split("\n")) {
    if (!linea.trim()) continue;
    try {
      registros.push(JSON.parse(linea) as RegistroIndice);
    } catch {
      // Una línea corrupta no puede tirar abajo la corrida: se salta y el resto del índice sirve.
    }
  }
  return registros;
}

export function ultimaPorCodigo(registros?: RegistroIndice[]): Map<string, RegistroIndice> {
  const mapa = new Map<string, RegistroIndice>();
  for (const r of registros ?? leerIndice()) {
    const actual = mapa.get(r.codigo);
    if (!actual || r.observado_en > actual.observado_en) mapa.set(r.codigo, r);
  }
  return mapa;
}

/**
 * Campos que NO van al índice, y por qué.
 *
 * El jsonl es append-only y cada línea tiene que caber en `MAX_BYTES_LINEA`. Los tres campos
 * pesados del enriquecimiento no caben: medido en la primera corrida real, un registro completo
 * pesa 3.600–4.000 bytes y varios quedaban fuera —o degradados— en silencio. Las URLs del visor de
 * adjuntos por sí solas llevan un `enc=` de ~400 caracteres, y hay una por licitación.
 *
 * La solución no es subir el límite (existe por la atomicidad de `appendFileSync` y lo escriben dos
 * máquinas distintas) sino guardar el payload donde sí cabe y donde igual tiene que estar:
 * `docs/transformacion-digital-documentos.json`, que está versionado, lo publica Pages y se
 * regenera en cada corrida desde el mismo array. El índice guarda la OBSERVACIÓN —qué se vio,
 * cuándo, con qué consulta y con qué cita— y un contador de lo que quedó afuera; el manifiesto
 * guarda el CONTENIDO. Al republicar, `rehidratar()` los vuelve a juntar.
 */
export interface ConteosPayload {
  documentos: number;
  requerimientos: number;
  exigencias: number;
}

/** La proyección que se escribe en el jsonl: sin los tres campos pesados, con sus conteos. */
export type RegistroIndice = Omit<RegistroTd, "documentos" | "requerimientos" | "exigencias_administrativas"> & {
  conteos?: ConteosPayload;
};

export function proyectarParaIndice(r: RegistroTd): RegistroIndice {
  const { documentos, requerimientos, exigencias_administrativas, ...resto } = r;
  const proyectado: RegistroIndice = { ...resto };
  if (r.enriquecido_en) {
    proyectado.conteos = {
      documentos: documentos?.length ?? 0,
      requerimientos: requerimientos.length,
      exigencias: exigencias_administrativas?.length ?? 0,
    };
  }
  return proyectado;
}

/**
 * Última red de seguridad: recorta lo poco que queda si aun así no cabe. Se degrada de menos a más
 * doloroso, y nunca se escribe una línea larga — corromper el índice compartido cuesta más que
 * perder una cita.
 */
function ajustarATope(r: RegistroIndice): RegistroIndice {
  const cabe = (x: RegistroIndice) => Buffer.byteLength(JSON.stringify(x), "utf-8") < MAX_BYTES_LINEA;
  if (cabe(r)) return r;

  let a: RegistroIndice = { ...r, descripcion: r.descripcion.slice(0, 600) };
  if (cabe(a)) return a;

  a = { ...a, evidencia: a.evidencia.map((e) => ({ ...e, cita: e.cita.slice(0, 120) })) };
  if (cabe(a)) return a;

  a = { ...a, evidencia: a.evidencia.slice(0, 1) };
  if (cabe(a)) return a;

  return { ...a, descripcion: a.descripcion.slice(0, 200), nombre: a.nombre.slice(0, 200) };
}

export interface ResultadoAnexar {
  escrita: boolean;
  motivo: "nueva" | "cambio" | "sin-cambios" | "no-cabe";
}

/**
 * Anexa solo si algo cambió respecto de la última línea de ese código (comparando hash). Correr el
 * barrido dos veces el mismo día sin novedades no infla el archivo.
 */
export function anexar(registro: Omit<RegistroTd, "hash">, ultimas?: Map<string, RegistroIndice>): ResultadoAnexar {
  const completo = ajustarATope(proyectarParaIndice({ ...registro, hash: "" } as RegistroTd));
  completo.hash = hashRegistro(completo);

  const previa = (ultimas ?? ultimaPorCodigo()).get(completo.codigo);
  if (previa && previa.hash === completo.hash) return { escrita: false, motivo: "sin-cambios" };

  const linea = JSON.stringify(completo);
  if (Buffer.byteLength(linea, "utf-8") >= MAX_BYTES_LINEA) return { escrita: false, motivo: "no-cabe" };

  mkdirSync(path.dirname(INDICE_PATH), { recursive: true });
  appendFileSync(INDICE_PATH, `${linea}\n`, "utf-8");
  return { escrita: true, motivo: previa ? "cambio" : "nueva" };
}

// ─────────────────────────────────────────────────────────────────────────────
// De una fila del buscador a un registro
// ─────────────────────────────────────────────────────────────────────────────

export interface Procedencia {
  consultas: Set<string>;
  ordenes: Set<string>;
  estados: Set<string>;
}

/**
 * Proyecta una fila del CSV más su procedencia a un registro sin enriquecer. Los requerimientos de
 * este pase salen del propio listado —que ya trae la descripción completa—, y por eso la
 * completitud queda declarada como `solo-listado`.
 */
export function registroDesdeFila(
  fila: ResultadoBusquedaPortal,
  procedencia: Procedencia,
  veredicto: Extract<Veredicto, { pasa: true }>,
  ahoraIso: string,
): Omit<RegistroTd, "hash"> {
  const requerimientos = extraerRequerimientos([
    { texto: `${fila.nombre}\n${fila.descripcion}`, fuente: "listado del buscador público" },
  ]);
  return {
    codigo: fila.codigo,
    observado_en: ahoraIso,
    nombre: fila.nombre,
    descripcion: fila.descripcion,
    organismo: fila.organismo,
    estado: fila.estado,
    estado_buscador: [...procedencia.estados].sort().join(","),
    tipo: fila.tipo,
    fecha_publicacion: fila.fechaPublicacion,
    moneda: fila.moneda,
    monto_texto: fila.montoTexto,
    monto_clp: montoDeTexto(fila.montoTexto),
    consultas: [...procedencia.consultas].sort(),
    ordenes: [...procedencia.ordenes].sort(),
    categorias: veredicto.categorias,
    evidencia: veredicto.evidencia,
    completitud: "solo-listado",
    requerimientos,
  };
}

/**
 * El orden de la página y del manifiesto, que es lo que se pidió: esta lista existe para decidir de
 * qué licitación bajar los documentos primero (Fase 2), así que ordena por **cuánto material hay
 * para leer**, no por fecha.
 *
 * Es deliberadamente un criterio observable y no un puntaje con pesos a dedo: el repo ya se critica
 * a sí mismo por eso en `PLAN-VOLUMEN.md` ("elegir keywords a dedo es el método que produjo el
 * nicho Claude"). Acá solo se cuenta lo que existe.
 */
export function ordenar(registros: RegistroTd[]): RegistroTd[] {
  const rango = (r: RegistroTd): number => {
    if (!r.enriquecido_en) return 2; // sin ficha: no se sabe qué documentos tiene
    return (r.documentos?.length ?? 0) > 0 ? 0 : 1;
  };
  return [...registros].sort((a, b) => {
    const ra = rango(a);
    const rb = rango(b);
    if (ra !== rb) return ra - rb;
    const da = (a.documentos?.length ?? 0) + a.requerimientos.length;
    const db = (b.documentos?.length ?? 0) + b.requerimientos.length;
    if (da !== db) return db - da;
    return fechaOrdenable(b.fecha_publicacion).localeCompare(fechaOrdenable(a.fecha_publicacion));
  });
}

/** "16/06/2026 11:36:34" -> "2026-06-16 11:36:34", para poder comparar como string. */
export function fechaOrdenable(fecha: string): string {
  const m = fecha.match(/^(\d{2})[/-](\d{2})[/-](\d{4})(.*)$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}${m[4] ?? ""}` : fecha;
}

/** Frase corta que explica el lugar en la lista. Se publica junto al número de orden. */
export function motivoOrden(r: RegistroTd): string {
  if (!r.enriquecido_en) return "ficha sin indexar todavía";
  const docs = r.documentos ?? [];
  if (docs.length === 0) return "ficha indexada, el organismo no publicó documentos";
  const navegador = docs.filter((d) => d.acceso === "navegador").length;
  const partes = [`${docs.length} documento(s) indexado(s)`];
  if (navegador > 0) partes.push(`${navegador} tras el reCAPTCHA del portal`);
  if (r.requerimientos.length > 0) partes.push(`${r.requerimientos.length} requerimiento(s) detectado(s)`);
  return partes.join(" · ");
}
