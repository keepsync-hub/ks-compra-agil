/**
 * `npm run mercado` — mide el mercado de Compra Ágil en cinco etapas ordenadas por valor
 * DECRECIENTE, para que un corte por cuota se lleve siempre lo menos importante.
 *
 *   A (4 req)   Tamaño del universo en cada estado terminal → dimensiona el sesgo de supervivencia
 *               de mirar solo lo `publicada`, que es el riesgo analítico dominante del estudio.
 *   B (~40 req) Dimensionamiento exacto de cada término, 1 request por término.
 *   C (~25 req) Muestra sistemática del universo SIN `q` → el estrato anti-sesgo.
 *   D (~18 req) Desenlaces de la lista corta (cerrada/desierta/cancelada) → tasa de éxito por
 *               familia, la métrica que fundó todo el análisis del nicho Claude.
 *   E (~15 req) Profundidad (montos exactos) y calibración del sesgo de clasificar por `nombre`.
 *
 * Cada etapa escribe apenas termina: un 429 degrada el informe en vez de perderlo. Lo que no se
 * alcanzó a medir se registra como `null` — NUNCA como 0, que se leería como "no hay demanda".
 */
import { CuotaApiAgotadaError, buscarCompraAgilPagina, obtenerDetalleCompraAgil, type EstadoCompraAgil } from "../lib/api.js";
import { CuotaLocalAgotadaError, configurarCuota, radarYaCorrioHoy } from "../lib/cuota.js";
import {
  anexarMercado,
  cargarConfigTerminos,
  codigosYaVistos,
  esTopeado,
  precisionEnNombre,
  leerMercado,
  paginasDeMuestra,
  proyectarCompra,
  proyectarDetalle,
  type RegCompra,
  type RegistroMercado,
} from "../lib/mercado.js";

const ESTADOS_TERMINALES: EstadoCompraAgil[] = ["cerrada", "desierta", "cancelada", "proveedor_seleccionado"];
const ESTADOS_DESENLACE: EstadoCompraAgil[] = ["cerrada", "desierta", "cancelada"];

// Medido el 2026-08-20 contra producción: con `tamano_pagina=50` el endpoint devolvió HTTP 504 en 3
// de 4 intentos (~30s cada uno); con 25 respondió 200 en ~17s. Y cada 504 GASTA cuota igual, porque
// `contarRequest()` corre antes de cada intento, reintentos incluidos. 25 es el punto dulce medido.
const TAMANO_PAGINA = 25;
const TAMANO_PAGINA_SONDEO = 10; // para dimensionar solo hace falta `total_resultados` + una muestra

const arg = (nombre: string): string | undefined =>
  process.argv.find((a) => a.startsWith(`--${nombre}=`))?.split("=").slice(1).join("=");

/** Se detuvo por cuota: no es un fallo, es el modo de operación normal de este script. */
class CorteCuota extends Error {
  constructor(readonly causa: string) {
    super(causa);
  }
}

const esCorte = (e: unknown): boolean => e instanceof CuotaApiAgotadaError || e instanceof CuotaLocalAgotadaError;

/**
 * Dimensiona un término tolerando que la API falle en él. Un 500 sobre `q=aseo` no puede tirar
 * abajo una corrida de 120 requests: el término se marca como no medido, con su error, y se sigue.
 * Los errores de cuota SÍ se propagan — ésos sí deben cortar.
 */
async function medirTermino(
  q: string,
  estado: EstadoCompraAgil,
): Promise<{ total: number | null; nombres: string[]; error?: string }> {
  try {
    const pagina = await buscarCompraAgilPagina({ q, estado, tamanoPagina: TAMANO_PAGINA_SONDEO, numeroPagina: 1 });
    return { total: pagina.paginacion?.total_resultados ?? null, nombres: pagina.items.map((i) => i.nombre).slice(0, 10) };
  } catch (err) {
    if (esCorte(err)) throw err;
    return { total: null, nombres: [], error: (err as Error).message.slice(0, 300) };
  }
}

async function main() {
  // El radar tiene reserva prioritaria de cuota (PLAN-VOLUMEN.md, Fase 0/6): este barrido es el más
  // caro del repo y no debe arriesgar la corrida diaria.
  const forzar = process.argv.includes("--forzar");
  if (!forzar && !radarYaCorrioHoy()) {
    console.error(
      "El radar (`npm run radar`) todavía no corrió hoy. Esta medición es la más cara del repo y tiene " +
        "prioridad menor — correr el radar primero, o pasar --forzar si es intencional.",
    );
    process.exitCode = 1;
    return;
  }

  const maxRequests = Number(arg("max-requests") ?? 120);
  const etapasPedidas = (arg("etapas") ?? "abcde").toLowerCase();
  const quiere = (e: string) => etapasPedidas.includes(e);
  configurarCuota({ script: "mercado", maxRequests });

  const cfg = cargarConfigTerminos();
  const corridaId = new Date().toISOString();
  const ahora = () => new Date().toISOString();
  const previos = leerMercado();
  const vistos = codigosYaVistos(previos);

  const escribir = (rs: RegistroMercado[]) => {
    const n = anexarMercado(rs);
    if (n > 0) console.log(`  → ${n} registro(s) anexado(s) a historico/mercado.jsonl`);
  };

  let corte: string | null = null;
  const guard = async (etiqueta: string, fn: () => Promise<void>) => {
    if (corte) return;
    try {
      await fn();
    } catch (err) {
      if (esCorte(err)) {
        corte = `${etiqueta}: ${(err as Error).message}`;
        console.warn(`\n⚠ Cuota agotada en ${etiqueta}. Se detiene acá y se conserva todo lo medido.`);
        return;
      }
      throw err;
    }
  };

  // ── Etapa A ────────────────────────────────────────────────────────────────────────────────────
  let universoAbierto: number | null = null;
  if (quiere("a") && !corte) {
    console.log("\n[A] Tamaño del universo por estado (sin `q`)");
    const registros: RegistroMercado[] = [];
    await guard("etapa A", async () => {
      for (const estado of ["publicada", ...ESTADOS_TERMINALES] as EstadoCompraAgil[]) {
        const pagina = await buscarCompraAgilPagina({ estado, tamanoPagina: TAMANO_PAGINA_SONDEO, numeroPagina: 1 });
        const total = pagina.paginacion?.total_resultados ?? null;
        if (estado === "publicada") universoAbierto = total;
        console.log(`  ${estado.padEnd(24)} ${total ?? "no medido"}${esTopeado(total) ? "  (topeado por la API)" : ""}`);
        registros.push({
          tipo: "estado-universo",
          corrida_id: corridaId,
          medido_en: ahora(),
          estado,
          total_resultados: total,
          topeado: esTopeado(total),
        });
      }
    });
    escribir(registros);
  }

  // ── Etapa B ────────────────────────────────────────────────────────────────────────────────────
  const tamanoPorTermino = new Map<string, number>();
  // Tamaño CORREGIDO por precisión: `total_resultados` es una cota superior contaminada, porque el
  // `q` de la API también busca en la descripción (medido: `q=desarrollo` → 365 resultados, 0 de
  // cuyos 10 nombres de muestra menciona desarrollo de nada). Ordenar la lista corta por el conteo
  // crudo mandaba la etapa E a paginar puro ruido — pasó en la corrida del 2026-08-20.
  const tamanoCorregido = new Map<string, number>();
  if (quiere("b") && !corte) {
    console.log(`\n[B] Dimensionamiento de ${cfg.terminos.length} términos (1 request c/u, estado=publicada)`);
    const registros: RegistroMercado[] = [];
    await guard("etapa B", async () => {
      for (const t of cfg.terminos) {
        const { total, nombres, error } = await medirTermino(t.termino, "publicada");
        if (total != null) {
          tamanoPorTermino.set(t.termino, total);
          const prec = precisionEnNombre(t.termino, nombres);
          tamanoCorregido.set(t.termino, prec == null ? 0 : Math.round(total * prec));
        }
        const prec = precisionEnNombre(t.termino, nombres);
        console.log(
          `  ${t.termino.padEnd(18)} ${String(total ?? "ERROR").padStart(5)}` +
            `  prec ${prec == null ? " —" : `${Math.round(prec * 100)}%`.padStart(4)}` +
            `  ≈${String(tamanoCorregido.get(t.termino) ?? "?").padStart(5)}  (${t.grupo})` +
            `${error ? " ← la API falló en este término" : ""}`,
        );
        registros.push({
          tipo: "termino",
          corrida_id: corridaId,
          medido_en: ahora(),
          termino: t.termino,
          grupo: t.grupo,
          estado: "publicada",
          total_resultados: total,
          topeado: esTopeado(total),
          muestra_nombres: nombres,
          ...(error ? { error } : {}),
        });
      }
    });
    escribir(registros);
  }

  // ── Etapa C ────────────────────────────────────────────────────────────────────────────────────
  if (quiere("c") && !corte) {
    // Si la etapa A no corrió en ESTA corrida (`--etapas=bcde`), el tamaño del universo se toma de
    // la última medición registrada. Sin este fallback la muestra salía de 0 páginas en silencio,
    // que es peor que fallar: parecía una etapa ejecutada y vacía.
    const ultimoUniverso = [...previos]
      .reverse()
      .find((r): r is Extract<RegistroMercado, { tipo: "estado-universo" }> =>
        r.tipo === "estado-universo" && r.estado === "publicada" && r.total_resultados != null);
    const universo = universoAbierto ?? ultimoUniverso?.total_resultados ?? null;
    if (universo == null) {
      console.warn("\n[C] Omitida: no hay medición del tamaño del universo. Correr antes con --etapas=a.");
    }
    const totalPaginas = universo != null ? Math.ceil(universo / TAMANO_PAGINA) : 0;
    const cuantas = Number(arg("muestra") ?? 25);
    const paginas = paginasDeMuestra(totalPaginas, cuantas);
    console.log(`\n[C] Muestra sistemática: ${paginas.length} de ${totalPaginas} páginas (~${paginas.length * TAMANO_PAGINA} compras)`);
    const registros: RegCompra[] = [];
    await guard("etapa C", async () => {
      for (const p of paginas) {
        const pagina = await buscarCompraAgilPagina({ estado: "publicada", tamanoPagina: TAMANO_PAGINA, numeroPagina: p });
        for (const item of pagina.items) {
          if (vistos.has(item.codigo)) continue;
          vistos.add(item.codigo);
          registros.push(proyectarCompra(item, `muestra:pagina-${p}`, corridaId, ahora()));
        }
        process.stdout.write(`  p${p} (${registros.length} acumuladas)\r`);
      }
      console.log("");
    });
    escribir(registros);
  }

  // ── Etapa D ────────────────────────────────────────────────────────────────────────────────────
  // Ordenada por tamaño CORREGIDO, nunca por el crudo: si no, la etapa E pagina el ruido.
  const listaCorta = cfg.terminos
    .filter((t) => t.grupo === "keepsync" && (tamanoCorregido.get(t.termino) ?? 0) > 0)
    .sort((a, b) => (tamanoCorregido.get(b.termino) ?? 0) - (tamanoCorregido.get(a.termino) ?? 0))
    .slice(0, cfg.lista_corta_estados);

  if (quiere("d") && !corte && listaCorta.length > 0) {
    console.log(`\n[D] Desenlaces de la lista corta (${listaCorta.map((t) => t.termino).join(", ")})`);
    const registros: RegistroMercado[] = [];
    await guard("etapa D", async () => {
      for (const t of listaCorta) {
        for (const estado of ESTADOS_DESENLACE) {
          const { total, nombres, error } = await medirTermino(t.termino, estado);
          console.log(
            `  ${t.termino.padEnd(18)} ${estado.padEnd(12)} ${total ?? "ERROR"}${esTopeado(total) ? " (topeado)" : ""}`,
          );
          registros.push({
            tipo: "termino",
            corrida_id: corridaId,
            medido_en: ahora(),
            termino: t.termino,
            grupo: t.grupo,
            estado,
            total_resultados: total,
            topeado: esTopeado(total),
            muestra_nombres: nombres,
            ...(error ? { error } : {}),
          });
        }
      }
    });
    escribir(registros);
  }

  // ── Etapa E ────────────────────────────────────────────────────────────────────────────────────
  if (quiere("e") && !corte && listaCorta.length > 0) {
    const profundos = listaCorta.slice(0, cfg.profundidad_terminos);
    console.log(`\n[E] Profundidad de ${profundos.map((t) => t.termino).join(", ")} + calibración por detalle`);
    const registros: RegCompra[] = [];
    const paraDetalle: string[] = [];
    await guard("etapa E", async () => {
      for (const t of profundos) {
        const total = tamanoCorregido.get(t.termino) ?? 0;
        const paginas = Math.min(cfg.profundidad_max_paginas, Math.ceil(total / TAMANO_PAGINA));
        for (let p = 1; p <= paginas; p++) {
          const pagina = await buscarCompraAgilPagina({
            q: t.termino,
            estado: "publicada",
            tamanoPagina: TAMANO_PAGINA,
            numeroPagina: p,
          });
          for (const item of pagina.items) {
            if (paraDetalle.length < cfg.calibracion_detalles) paraDetalle.push(item.codigo);
            if (vistos.has(item.codigo)) continue;
            vistos.add(item.codigo);
            registros.push(proyectarCompra(item, `termino:${t.termino}`, corridaId, ahora()));
          }
          if (pagina.paginacion?.total_paginas != null && p >= pagina.paginacion.total_paginas) break;
        }
        console.log(`  ${t.termino}: ${registros.length} compras acumuladas`);
      }
    });
    escribir(registros);

    const detalles: RegistroMercado[] = [];
    await guard("etapa E (calibración)", async () => {
      for (const codigo of paraDetalle) {
        const d = await obtenerDetalleCompraAgil(codigo);
        detalles.push(proyectarDetalle(d, corridaId, ahora()));
        process.stdout.write(`  detalle ${detalles.length}/${paraDetalle.length}\r`);
      }
      console.log("");
    });
    escribir(detalles);
  }

  console.log(
    corte
      ? `\nMedición PARCIAL — se cortó en ${corte}\nEl informe (\`npm run estudio\`) declarará qué etapa quedó sin medir.`
      : "\nMedición completa. Siguiente paso: `npm run estudio`.",
  );
}

main().catch((err) => {
  console.error(err instanceof CorteCuota ? err.causa : err);
  process.exitCode = 1;
});
