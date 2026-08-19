/**
 * Calificador de admisibilidad y orden de revisión sugerido (ver PLAN-VOLUMEN.md, Fase 4).
 *
 * Cero requests propios: opera sobre un `CompraAgilDetalle` ya en caché (`data/<codigo>/detalle.json`,
 * escrito por el radar/indexador) + el índice histórico ya versionado. Es la respuesta directa al
 * "score"/"probabilidad de ganar" que venden plataformas como LicitaIA — con una diferencia
 * deliberada: **nunca se etiqueta como probabilidad**, porque cero ofertas enviadas significa que
 * los pesos son juicio, no un ajuste contra datos reales (ver `config/calificador.json`).
 *
 * Bloqueantes duros → `descartar`, sin score (no tiene sentido priorizar algo inviable):
 * - cierre ya pasó o la convocatoria no está abierta.
 * - exige una acreditación (p.ej. "distribuidor autorizado") que la categoría ya declaró como
 *   faltante en `acreditaciones_conocidas_faltantes` — el gate real que un comprador declaró
 *   textualmente en el nicho (ver `condiciones.ts`).
 * - el costo estimado (`estimarTotal`, la misma lógica que usa `cotizar.ts`) supera el tope.
 *
 * Señales blandas con pesos configurables, solo si no hay bloqueante duro. Cada calificación se
 * anexa a `historico/calificaciones.jsonl` con sus señales desglosadas desde el día uno — cuando
 * haya ~10 desenlaces reales, los pesos se pueden ajustar contra datos en vez de a ciegas.
 */
import { existsSync, readFileSync, appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { ROOT_DIR, type CompanyConfig } from "./config.js";
import type { CompraAgilDetalle } from "./api.js";
import type { Condiciones } from "./condiciones.js";
import type { CategoriaCompilada } from "./categorias.js";
import { estimarTotal } from "./lineas.js";
import { fechaChileAUtc } from "./tiempo.js";
import { fracasoPrevioDelOrganismo } from "./metricas.js";
import { clasificarMotivo } from "./motivos.js";

export type Veredicto = "ofertar" | "revisar" | "descartar";

export type MotivoDescarte = "cerrado" | "acreditacion_faltante" | "sobre_tope";

export interface SenalCalificacion {
  nombre: string;
  valor: number; // 0..1
  peso: number;
  contribucion: number; // valor * peso
  nota: string;
}

export interface Calificacion {
  codigo: string;
  categoria: string;
  evaluado_en: string; // ISO
  veredicto: Veredicto;
  motivo_descarte: MotivoDescarte | null;
  score: number | null; // null si se descartó por bloqueante duro
  senales: SenalCalificacion[];
}

export interface ConfigCalificador {
  pesos: Record<string, number>;
  umbral_ofertar: number;
}

let cacheConfig: ConfigCalificador | null = null;

export function cargarConfigCalificador(): ConfigCalificador {
  if (cacheConfig) return cacheConfig;
  const p = path.join(ROOT_DIR, "config", "calificador.json");
  const raw = JSON.parse(readFileSync(p, "utf-8")) as ConfigCalificador;
  cacheConfig = raw;
  return raw;
}

function diasHastaCierre(fechaCierre: string, ahora: Date): number | null {
  const cierre = fechaChileAUtc(fechaCierre);
  if (!cierre) return null;
  return (cierre.getTime() - ahora.getTime()) / 86_400_000;
}

export interface ParametrosCalificacion {
  detalle: CompraAgilDetalle;
  condiciones: Condiciones;
  categoria: CategoriaCompilada;
  /** null si `config/company.json` no está disponible en este entorno — se salta el chequeo de tope. */
  company: CompanyConfig | null;
  fxClpPorUsd: number | null;
  ahora?: Date;
}

export function calificarOportunidad(params: ParametrosCalificacion): Calificacion {
  const { detalle, condiciones, categoria, company, fxClpPorUsd } = params;
  const ahora = params.ahora ?? new Date();
  const dias = diasHastaCierre(detalle.fechas.fecha_cierre, ahora);
  const senales: SenalCalificacion[] = [];

  const base = (): Omit<Calificacion, "veredicto" | "motivo_descarte" | "score"> => ({
    codigo: detalle.codigo,
    categoria: categoria.id,
    evaluado_en: ahora.toISOString(),
    senales,
  });

  if (dias !== null && dias < 0) {
    return { ...base(), veredicto: "descartar", motivo_descarte: "cerrado", score: null };
  }

  const acreditacionBloqueante = condiciones.acreditaciones_exigidas.find((a) =>
    categoria.acreditaciones_conocidas_faltantes.includes(a),
  );
  if (acreditacionBloqueante) {
    senales.push({
      nombre: "acreditacion_faltante",
      valor: 1,
      peso: 0,
      contribucion: 0,
      nota: `exige "${acreditacionBloqueante}", declarada faltante en config/categorias.json para "${categoria.id}"`,
    });
    return { ...base(), veredicto: "descartar", motivo_descarte: "acreditacion_faltante", score: null };
  }

  let holguraPct: number | null = null;
  if (company && fxClpPorUsd != null) {
    const estimacion = estimarTotal(detalle, condiciones, company, fxClpPorUsd);
    if (estimacion === null) {
      senales.push({
        nombre: "holgura_precio",
        valor: 0,
        peso: 0,
        contribucion: 0,
        nota: "no se pudo estimar el costo (plan/cantidad no identificados con confianza) — revisar a mano",
      });
    } else if (!estimacion.cabeBajoTope) {
      return { ...base(), veredicto: "descartar", motivo_descarte: "sobre_tope", score: null };
    } else {
      holguraPct = estimacion.holguraPct;
    }
  } else {
    senales.push({
      nombre: "holgura_precio",
      valor: 0,
      peso: 0,
      contribucion: 0,
      nota: "no evaluado: falta config/company.json real en este entorno",
    });
  }

  const pesos = cargarConfigCalificador().pesos;
  const agregar = (nombre: string, valor: number, nota: string): void => {
    const peso = pesos[nombre] ?? 0;
    senales.push({ nombre, valor, peso, contribucion: valor * peso, nota });
  };

  agregar(
    "primer_llamado",
    detalle.convocatoria.estado_convocatoria === 1 ? 1 : 0,
    detalle.convocatoria.estado_convocatoria === 1
      ? "primer llamado (solo EMT puede ofertar — KeepSync sí puede)"
      : "segundo llamado (abierto a todos)",
  );

  if (holguraPct !== null) {
    const valor = Math.max(0, Math.min(1, holguraPct / 100));
    agregar("holgura_precio", valor, `${holguraPct.toFixed(1)}% de margen bajo el tope`);
  }

  const ofertas = condiciones.competencia_ofertas;
  const valorCompetencia = ofertas <= 1 ? 1 : ofertas <= 3 ? 0.5 : 0;
  agregar("competencia_baja", valorCompetencia, `${ofertas} oferta(s) ya recibida(s) según la última observación`);

  const previo = fracasoPrevioDelOrganismo(detalle.institucion.rut, detalle.codigo, categoria.id);
  agregar(
    "recomprador",
    previo ? 1 : 0,
    previo ? `el organismo tiene un fracaso previo en el índice (${previo.codigo})` : "sin fracasos previos del organismo en el índice",
  );

  let valorFracasoGanable = 0;
  let notaFracasoGanable = "sin fracaso previo del organismo en el índice";
  if (previo) {
    const texto = previo.estado === "desierta" ? previo.motivo_desierta : previo.motivo_cancelacion;
    const clasificado = clasificarMotivo(texto);
    valorFracasoGanable = clasificado.categoria === "comprador" ? 1 : clasificado.categoria === "administrativo" ? 0.5 : 0;
    notaFracasoGanable = `fracaso previo (${previo.codigo}) clasificado "${clasificado.categoria}": ${clasificado.regla}`;
  }
  agregar("fracaso_previo_ganable", valorFracasoGanable, notaFracasoGanable);

  agregar(
    "plazo_holgado",
    dias !== null && dias >= 2 ? 1 : 0,
    dias !== null ? `${dias.toFixed(1)} día(s) hasta el cierre` : "fecha de cierre no parseable",
  );

  const score = senales.reduce((acc, s) => acc + s.contribucion, 0);
  const veredicto: Veredicto = score >= cargarConfigCalificador().umbral_ofertar ? "ofertar" : "revisar";
  return { ...base(), veredicto, motivo_descarte: null, score };
}

const CALIFICACIONES_PATH = path.join(ROOT_DIR, "historico", "calificaciones.jsonl");

/** Anexa una calificación al histórico versionado. Append-only, una línea por evaluación (no se dedup por diseño: el plan pide poder ver cómo evolucionó holgura/competencia durante el día). */
export function anexarCalificacion(c: Calificacion): void {
  mkdirSync(path.dirname(CALIFICACIONES_PATH), { recursive: true });
  appendFileSync(CALIFICACIONES_PATH, JSON.stringify(c) + "\n", "utf-8");
}

export function leerCalificaciones(): Calificacion[] {
  if (!existsSync(CALIFICACIONES_PATH)) return [];
  return readFileSync(CALIFICACIONES_PATH, "utf-8")
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as Calificacion);
}
