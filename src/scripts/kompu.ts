/**
 * `npm run kompu` — radar de hardware TI para Kompu.cl (tóner, impresoras, multifuncionales,
 * notebooks, UPS, CCTV). Publica `docs/kompu.html`, una página nueva y separada: no toca
 * `docs/index.html` ni ninguno de sus tres pares de marcadores.
 *
 * Tres fases, cada una con su costo:
 *
 *   Fase 1  `--sondeo`   ~1 request por variante. Mide cada `q` ANTES de comprarla.
 *   Fase 2  censo         1 request por (variante × estado). El `total_resultados` de la primera
 *                         página ya responde la pregunta de mercado; paginar los estados cerrados
 *                         gastaría ~100 requests para refinar un número que ya se tenía con uno.
 *   Fase 3  grilla        solo `publicada` se pagina, porque es el único estado donde se puede
 *                         ofertar. Reusa la página 1 que ya trajo la Fase 2.
 *
 * `--solo-indice` republica desde `historico/kompu.jsonl` con 0 requests.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ROOT_DIR } from "../lib/config.js";
import { buscarCompraAgilPagina, CuotaApiAgotadaError, type EstadoCompraAgil } from "../lib/api.js";
import { configurarCuota, CuotaLocalAgotadaError, ledgerHoy, registrar429 } from "../lib/cuota.js";
import {
  ESTADOS_KOMPU,
  anexarObservaciones,
  cargarRubrosKompu,
  censar,
  guardarCenso,
  leerCenso,
  clasificarItem,
  consultasDeLaCorrida,
  proyectarObservacion,
  resumirRubro,
  rubrosActivos,
  ultimaPorCodigoKompu,
  type ObservacionKompu,
  type RubroKompu,
} from "../lib/kompu.js";
import { escribirPaginaKompu, type ResumenCorridaKompu } from "../lib/pagina-kompu.js";

/**
 * Tasa de compras efectivas de Compra Ágil en TODOS los rubros medidos, tecnológicos o no
 * (`output/estudio-mercado.md`, medición del 2026-08-20). Es la vara contra la que se compara cada
 * rubro: sin ella, un 8% se lee como fracaso cuando es exactamente lo que rinde el instrumento.
 */
const REFERENCIA_EXITO: [number, number] = [0.07, 0.1];

const ARGS = process.argv.slice(2);
const opcion = (n: string): string | undefined => {
  const pre = `--${n}=`;
  return ARGS.find((a) => a.startsWith(pre))?.slice(pre.length);
};
const bandera = (n: string) => ARGS.includes(`--${n}`);
const numero = (n: string, def: number) => {
  const v = opcion(n);
  const p = v == null ? NaN : Number(v);
  return Number.isFinite(p) && p > 0 ? Math.floor(p) : def;
};

const SONDEO = bandera("sondeo");
const SOLO_INDICE = bandera("solo-indice");
const MAX_PAGINAS = numero("max-paginas", 3);
const PRESUPUESTO = numero("presupuesto", 110);

function rubrosPedidos(): RubroKompu[] {
  const crudo = opcion("rubros");
  if (!crudo) return rubrosActivos();
  const ids = crudo.split(",").map((s) => s.trim()).filter(Boolean);
  const todos = cargarRubrosKompu();
  return ids.map((id) => {
    const r = todos.find((x) => x.id === id);
    if (!r) throw new Error(`Rubro "${id}" no existe en config/kompu-rubros.json.`);
    return r;
  });
}

function estadosPedidos(): EstadoCompraAgil[] {
  const crudo = opcion("estados");
  if (!crudo) return ESTADOS_KOMPU;
  const pedidos = crudo.split(",").map((s) => s.trim()).filter(Boolean);
  const malos = pedidos.filter((e) => !ESTADOS_KOMPU.includes(e as EstadoCompraAgil));
  if (malos.length) {
    throw new Error(`Estado(s) desconocido(s): ${malos.join(", ")}. Válidos: ${ESTADOS_KOMPU.join(", ")}.`);
  }
  return pedidos as EstadoCompraAgil[];
}

/**
 * Fase 1. Una request por variante, sin paginar ni pedir detalles. Responde las tres preguntas que
 * deciden si una `q` sirve: ¿la acepta el endpoint (el quirk del "de" suelto responde 500)?,
 * ¿cuántos resultados trae?, y ¿qué precisión tiene contra el filtro real?
 */
async function sondear(rubros: RubroKompu[]): Promise<void> {
  const consultas = [...consultasDeLaCorrida(rubros).keys()];
  configurarCuota({ script: "kompu-sondeo", maxRequests: consultas.length });
  console.log(`Sondeo de ${consultas.length} variante(s) — 1 request c/u, sin paginar ni escribir en docs/.\n`);

  const lineas = [`# Sondeo de variantes — rubros Kompu`, ``, `Corrida: ${new Date().toISOString()}`, ``];
  for (const [i, q] of consultas.entries()) {
    try {
      const p = await buscarCompraAgilPagina({ q, estado: "publicada", tamanoPagina: 10, numeroPagina: 1 });
      const total = p.paginacion?.total_resultados ?? p.items.length;
      const veredictos = p.items.map((item) => {
        const vs = rubros
          .map((r) => [r.id, clasificarItem(r, item.nombre ?? "")] as const)
          .filter(([, v]) => v !== "no-menciona")
          .map(([id, v]) => `${id}:${v}`);
        return { nombre: (item.nombre ?? "").slice(0, 80), codigo: item.codigo, resumen: vs.join("  ") };
      });
      const aciertos = veredictos.filter((v) => v.resumen.includes(":confirmada")).length;
      console.log(`[${i + 1}/${consultas.length}] "${q}" → ${total} resultado(s); ${aciertos}/${p.items.length} de la muestra confirman un rubro`);
      lineas.push(`## \`${q}\` — ${total} resultado(s), ${aciertos}/${p.items.length} confirmados en la muestra`, ``);
      for (const v of veredictos) {
        console.log(`    ${v.codigo}  ${v.nombre}`);
        console.log(`      → ${v.resumen || "ningún rubro lo confirma (ruido de `q`)"}`);
        lineas.push(`- \`${v.codigo}\` ${v.nombre} — ${v.resumen || "ruido de `q`"}`);
      }
      lineas.push(``);
    } catch (err) {
      const msg = (err as Error).message;
      if (err instanceof CuotaApiAgotadaError || err instanceof CuotaLocalAgotadaError) {
        console.warn(`\n⚠ ${msg}\n  Quedaron ${consultas.length - i} variante(s) sin sondear. Retomar mañana.`);
        lineas.push(`## Sin sondear`, ``, `${consultas.length - i} variante(s) quedaron sin medir por falta de cuota.`, ``);
        break;
      }
      const pista = /500|ERROR_INTERNO/.test(msg)
        ? ' — 500: revisar si la consulta trae la palabra suelta "de" (quirk verificado del endpoint)'
        : "";
      console.warn(`[${i + 1}/${consultas.length}] "${q}" → FALLÓ: ${msg}${pista}`);
      lineas.push(`## \`${q}\` — falló`, ``, `${msg}${pista}`, ``);
    }
  }
  const out = path.join(ROOT_DIR, "output");
  mkdirSync(out, { recursive: true });
  writeFileSync(path.join(out, "kompu-sondeo.md"), lineas.join("\n"), "utf-8");
  console.log(`\nSondeo escrito en output/kompu-sondeo.md — recortar config/kompu-rubros.json con esto antes de barrer.`);
}

async function main(): Promise<void> {
  const rubros = rubrosPedidos();
  const estados = estadosPedidos();
  const ahoraIso = new Date().toISOString();

  if (SONDEO) return sondear(rubros);

  configurarCuota({ script: "kompu", maxRequests: SOLO_INDICE ? 0 : PRESUPUESTO });
  // El ledger cuenta el DÍA, no la corrida: sin esta línea base, una segunda corrida del mismo día
  // publicaría el acumulado como si lo hubiera gastado ella sola.
  const requestsAlArrancar = ledgerHoy().por_script["kompu"] ?? 0;

  console.log(`Radar Kompu — ${rubros.length} rubro(s), ${estados.length} estado(s).`);
  console.log(`Rubros: ${rubros.map((r) => r.id).join(", ")}`);

  let censo: Awaited<ReturnType<typeof censar>> = {
    celdas: [],
    items: new Map(),
    descartados: [],
    requests: 0,
    cuotaAgotada: false,
  };

  if (SOLO_INDICE) {
    console.log(`\n— \`--solo-indice\`: no se consulta la API. Se republica desde historico/kompu.jsonl.`);
  } else {
    const consultas = consultasDeLaCorrida(rubros);
    console.log(
      `\n— Censo: ${consultas.size} consulta(s) × ${estados.length} estado(s). Solo \`publicada\` se pagina ` +
        `(hasta ${MAX_PAGINAS}); el resto lee 1 página, porque su \`total_resultados\` ya responde la ` +
        `pregunta de mercado. Presupuesto: ${PRESUPUESTO} requests.`,
    );
    try {
      censo = await censar({
        rubros,
        estados,
        maxPaginasPublicada: MAX_PAGINAS,
        // El circuit breaker de cuota.ts lanza; esto solo evita entrar a una request que ya se sabe
        // que no cabe, para que la celda quede marcada como truncada en vez de reventar la corrida.
        sinCuota: () => (ledgerHoy().por_script["kompu"] ?? 0) - requestsAlArrancar >= PRESUPUESTO,
      });
    } catch (err) {
      if (err instanceof CuotaApiAgotadaError) registrar429(err.retryAfter);
      else if (!(err instanceof CuotaLocalAgotadaError)) throw err;
      console.warn(`\n⚠ ${(err as Error).message}\n  Se publica con lo ya descubierto.`);
      censo.cuotaAgotada = true;
    }
    for (const c of censo.celdas) {
      const avisos = [c.topeado ? "topeado" : "", c.truncado ? "truncado" : "", c.error ? `ERROR: ${c.error.slice(0, 70)}` : ""]
        .filter(Boolean)
        .join(" · ");
      console.log(
        `  ${c.estado}/${c.variante}: ${c.total_resultados} resultado(s), ${c.filas_muestra} fila(s) leída(s)` +
          (c.precision != null ? `, precisión ${(c.precision * 100).toFixed(0)}%` : "") +
          (avisos ? ` [${avisos}]` : ""),
      );
    }
  }

  // ── Índice: se anexa lo recién visto y se relee el acumulado ────────────────────────────────
  const nuevas: ObservacionKompu[] = [...censo.items.values()].map(({ item, rubros: rs, porVerificar }) =>
    proyectarObservacion(item, [...rs], [...porVerificar], ahoraIso),
  );
  if (nuevas.length > 0) {
    anexarObservaciones(nuevas);
    console.log(`\n— ${nuevas.length} observación(es) anexadas a historico/kompu.jsonl.`);
  }

  // `ultimaPorCodigoKompu` desempata con `>=`, y la corrida acaba de resellar `observado_en`: por
  // eso lo recién visto gana sobre lo del índice, que puede traer un estado ya vencido.
  const observaciones = [...ultimaPorCodigoKompu().values()].filter(
    (o) => o.rubros.some((id) => rubros.some((r) => r.id === id)) || o.por_verificar.length > 0,
  );

  // El censo se guarda versionado y se relee al republicar: es la evidencia de la que salen el
  // volumen y la tasa, así que sin esto `--solo-indice` publicaría la grilla con la sección
  // "¿hay mercado?" en blanco. Una corrida parcial (--rubros, --estados) NO pisa el censo completo.
  const corridaParcial = opcion("rubros") != null || opcion("estados") != null;
  if (!SOLO_INDICE && !corridaParcial) {
    guardarCenso({ corrida: ahoraIso, estados, celdas: censo.celdas, descartados: censo.descartados });
  }
  const guardado = leerCenso();
  const celdas = censo.celdas.length > 0 ? censo.celdas : (guardado?.celdas ?? []);
  const descartados = censo.celdas.length > 0 ? censo.descartados : (guardado?.descartados ?? []);
  const censoDe = censo.celdas.length > 0 ? ahoraIso : (guardado?.corrida ?? null);
  const resumenRubros = rubros.map((r) => resumirRubro(r, observaciones, celdas));
  const requests = (ledgerHoy().por_script["kompu"] ?? 0) - requestsAlArrancar;

  const resumen: ResumenCorridaKompu = {
    generado_en: ahoraIso,
    rubros: resumenRubros,
    celdas,
    censo_de: censoDe,
    descartados,
    observaciones,
    requests,
    cuota_agotada: censo.cuotaAgotada,
    solo_indice: SOLO_INDICE,
    estados,
    referencia_exito: REFERENCIA_EXITO,
  };

  const ruta = escribirPaginaKompu(resumen, rubros);
  console.log(`\nPágina generada: ${path.relative(ROOT_DIR, ruta)}`);
  console.log(`  ${observaciones.length} compra(s) en el índice · ${requests} request(s) en esta corrida.`);
  for (const r of resumenRubros) {
    const tasa = r.tasaExito != null ? ` · ${(r.tasaExito * 100).toFixed(0)}% efectivas (~${r.resueltasEstimadas} resueltas)` : "";
    console.log(`  ${r.id}: ${r.total} observada(s), ${r.abiertas} abierta(s)${tasa}`);
  }
  if (descartados.length > 0) {
    console.log(`\n  ${descartados.length} descartada(s) por contexto (publicadas en la página, con su rubro).`);
  }
}

main().catch((err) => {
  console.error("Radar Kompu falló:", err);
  process.exitCode = 1;
});
