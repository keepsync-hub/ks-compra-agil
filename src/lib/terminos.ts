/**
 * Frecuencia de términos sobre los nombres de las compras medidas — el paso NO SUPERVISADO del
 * estudio de mercado.
 *
 * Corre ANTES de que existan las familias (`config/familias-mercado.json`) y no las lee. Ése es el
 * corte contra el sesgo circular: si las familias se escribieran primero, el ranking solo reflejaría
 * lo que alguien ya decidió mirar, que es exactamente el método que PLAN-VOLUMEN.md:271-272 señala
 * como el origen del nicho Claude.
 *
 * Dos decisiones medidas, no supuestas (PoC sobre 120 nombres reales, 2026-08-20):
 *   1. **Document frequency, no term frequency.** Se cuenta en cuántas compras DISTINTAS aparece el
 *      n-grama, no cuántas veces. Un nombre largo y repetitivo no puede inflar el ranking.
 *   2. **Se ordena por monto, no por frecuencia.** El conteo bruto devolvía "adquisicion, insumos,
 *      sep, liceo, adq" — el acto de comprar y la cola larga escolar. 300 compras de $200.000 valen
 *      menos que 40 de $8.000.000, y es el monto el que dice dónde hay negocio.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { ROOT_DIR } from "./config.js";
import { normalizarTexto } from "./categorias.js";
import { percentiles, type Percentiles } from "./metricas.js";

export interface Stopwords {
  vacias: Set<string>;
  estructurales: Set<string>;
}

export function cargarStopwords(): Stopwords {
  const p = path.join(ROOT_DIR, "config", "stopwords-es.json");
  if (!existsSync(p)) return { vacias: new Set(), estructurales: new Set() };
  const raw = JSON.parse(readFileSync(p, "utf-8")) as { vacias?: string[]; estructurales?: string[] };
  return {
    vacias: new Set((raw.vacias ?? []).map(normalizarTexto)),
    estructurales: new Set((raw.estructurales ?? []).map(normalizarTexto)),
  };
}

/**
 * Los segmentos del nombre, cortados por puntuación ANTES de armar n-gramas: sin esto, un bigrama
 * puede ser el cruce de dos ítems de una enumeración ("resmas, tóner" → "resmas toner"), que no es
 * una frase que nadie escribió.
 */
export function segmentos(nombre: string): string[][] {
  return normalizarTexto(nombre)
    .split(/[,;:.()\[\]/\-–—"'+|]+/)
    .map((seg) =>
      seg
        .split(/\s+/)
        .map((t) => t.replace(/[^a-z0-9ñ]/g, ""))
        .filter((t) => t.length >= 2),
    )
    .filter((toks) => toks.length > 0);
}

const esNumeroSuelto = (t: string): boolean => /^\d+$/.test(t);

export interface CompraParaTerminos {
  codigo: string;
  nombre: string;
  monto_disponible_clp: number;
}

export interface TerminoMedido {
  termino: string;
  tokens: number;
  n_compras: number;
  pct: number;
  monto_total_clp: number;
  monto: Percentiles | null;
  n_organismos: number;
  clase: "contenido" | "estructural";
}

/**
 * n-gramas de 1..maxN tokens por compra, deduplicados dentro de la compra (document frequency).
 * Un n-grama se clasifica como `estructural` si TODOS sus tokens lo son — así "servicio" queda
 * aparte pero "servicio capacitacion" sigue siendo contenido.
 */
export function contarTerminos(
  compras: (CompraParaTerminos & { rut?: string })[],
  stop: Stopwords,
  maxN = 3,
): TerminoMedido[] {
  const porTermino = new Map<string, { compras: Set<string>; montos: number[]; ruts: Set<string>; tokens: number }>();

  for (const c of compras) {
    const vistosEnEstaCompra = new Set<string>();
    for (const toks of segmentos(c.nombre)) {
      const utiles = toks.filter((t) => !stop.vacias.has(t) && !esNumeroSuelto(t));
      for (let n = 1; n <= maxN; n++) {
        for (let i = 0; i + n <= utiles.length; i++) {
          const gram = utiles.slice(i, i + n);
          const clave = gram.join(" ");
          if (vistosEnEstaCompra.has(clave)) continue;
          vistosEnEstaCompra.add(clave);
          let e = porTermino.get(clave);
          if (!e) {
            e = { compras: new Set(), montos: [], ruts: new Set(), tokens: n };
            porTermino.set(clave, e);
          }
          e.compras.add(c.codigo);
          if (c.monto_disponible_clp > 0) e.montos.push(c.monto_disponible_clp);
          if (c.rut) e.ruts.add(c.rut);
        }
      }
    }
  }

  const total = compras.length || 1;
  const out: TerminoMedido[] = [];
  for (const [termino, e] of porTermino) {
    const tokens = termino.split(" ");
    out.push({
      termino,
      tokens: e.tokens,
      n_compras: e.compras.size,
      pct: (e.compras.size / total) * 100,
      monto_total_clp: e.montos.reduce((a, b) => a + b, 0),
      monto: percentiles(e.montos),
      n_organismos: e.ruts.size,
      clase: tokens.every((t) => stop.estructurales.has(t)) ? "estructural" : "contenido",
    });
  }
  return out.sort((a, b) => b.monto_total_clp - a.monto_total_clp);
}
