/**
 * `npm run criterios` — convierte las familias medidas en propuestas de criterios de búsqueda.
 *
 * Escribe a `config/categorias-propuestas.json`, que es un archivo INERTE: nadie lo carga salvo este
 * script y una persona. NO escribe en `config/categorias.json` ni siquiera con `activa: false`,
 * porque eso no es gratis:
 *   1. `cargarCategorias()` compila TODAS las categorías, activas o no — una regex mal formada tira
 *      abajo el radar entero, incluidas las cinco que sí funcionan.
 *   2. `renderKeywordsCompraAgil` publica TODAS en docs/index.html, con su regex a la vista: una
 *      propuesta sin revisar aparecería como política del radar.
 *   3. `--solo=<id>` e `indexar --categoria=` operan sobre todas y podrían gastar cuota real sin que
 *      nadie haya aprobado nada.
 *   4. `src/scripts/keywords.ts` declara la frontera: tocar `categorias.json` es trabajo de código.
 *
 * Promover una propuesta es un paso humano: copiarla a `config/categorias.json` con `activa: false`.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ROOT_DIR } from "../lib/config.js";
import { leerMercado, precisionEnNombre, type RegistroMercado } from "../lib/mercado.js";
import { cargarFamilias } from "../lib/familias-mercado.js";
import { cargarCategorias, normalizarTexto, variantesDeBusqueda } from "../lib/categorias.js";

interface Veredicto {
  familia_id: string;
  veredicto: "servible" | "no-servible" | "por-definir";
  ofertable: boolean;
  A: string;
  B: string;
  C: string;
  D: string;
  [k: string]: unknown;
}

function main() {
  const registros = leerMercado();
  const familias = cargarFamilias();
  const oferta = JSON.parse(readFileSync(path.join(ROOT_DIR, "config", "keepsync-oferta.json"), "utf-8")) as {
    veredictos: Veredicto[];
    umbral_estimado_minimo: number;
  };
  const umbral = oferta.umbral_estimado_minimo ?? 5;

  // Tamaño corregido por término: crudo × precisión medida sobre sus 10 nombres de muestra.
  const porTermino = new Map<string, { crudo: number; prec: number | null; estimado: number | null }>();
  for (const r of registros) {
    if (r.tipo !== "termino" || r.estado !== "publicada" || r.total_resultados == null) continue;
    const prec = precisionEnNombre(r.termino, r.muestra_nombres);
    porTermino.set(r.termino, {
      crudo: r.total_resultados,
      prec,
      estimado: prec == null ? null : Math.round(r.total_resultados * prec),
    });
  }

  const activas = cargarCategorias().filter((c) => c.activa);
  const presupuestoActual = activas.reduce((a, c) => a + (c.presupuesto_requests_por_corrida ?? 0), 0);
  // El radar consulta la UNIÓN deduplicada de las variantes de todas las categorías activas
  // (`consultasDeLaCorrida` en el skill del radar), así que una variante que ya se está pidiendo no
  // suma ni un request. Sin esta cuenta, el costo declarado de una propuesta estaría inflado.
  const yaSeConsulta = new Set(activas.flatMap((c) => variantesDeBusqueda(c)).map(normalizarTexto));

  const propuestas: Record<string, unknown>[] = [];
  const rechazadas: { id: string; motivo: string }[] = [];

  for (const f of familias.filter((f) => f.capa === "fina")) {
    const v = oferta.veredictos.find((x) => x.familia_id === f.id);
    // El tamaño de la familia se aproxima por el mayor de sus términos derivados: son solapados,
    // así que sumarlos contaría dos veces la misma compra.
    const medidos = f.derivadaDe.map((t) => porTermino.get(t)?.estimado ?? 0);
    const estimado = medidos.length > 0 ? Math.max(...medidos) : 0;

    if (!v) {
      rechazadas.push({ id: f.id, motivo: "sin veredicto en config/keepsync-oferta.json" });
      continue;
    }
    if (v.veredicto === "no-servible") {
      rechazadas.push({ id: f.id, motivo: `veredicto no-servible (C=${v.C})` });
      continue;
    }
    if (estimado < umbral) {
      rechazadas.push({ id: f.id, motivo: `tamaño corregido ≈${estimado} < umbral ${umbral}` });
      continue;
    }

    // Las variantes salen de los términos MEDIDOS de la familia, quedándose con los que demostraron
    // precisión: una palabra con 10% de precisión trae 9 de cada 10 resultados de otro rubro y solo
    // gasta cuota. Es la lección de `_variantes_nota` de la categoría `claude`, aplicada por código.
    const variantes = f.derivadaDe
      .map((t) => ({ t, ...(porTermino.get(t) ?? { crudo: 0, prec: null, estimado: null }) }))
      .filter((x) => (x.prec ?? 0) >= 0.5 && (x.estimado ?? 0) >= 1)
      .sort((a, b) => (b.estimado ?? 0) - (a.estimado ?? 0))
      .map((x) => x.t);

    if (variantes.length === 0) {
      rechazadas.push({ id: f.id, motivo: "ninguno de sus términos superó 50% de precisión medida" });
      continue;
    }

    const nuevas = variantes.filter((v) => !yaSeConsulta.has(normalizarTexto(v)));
    const yaCubiertas = variantes.filter((v) => yaSeConsulta.has(normalizarTexto(v)));
    const costoMarginal = nuevas.length * 2;

    propuestas.push({
      id: f.id,
      nombre: f.nombre,
      nombre_corto: f.nombreCorto,
      activa: false,
      variantes_q: variantes,
      _variantes_nota:
        `Derivadas de la medición del 2026-08-20 y filtradas por precisión ≥50%: ` +
        variantes.map((t) => `${t} (${porTermino.get(t)!.crudo} crudo × ${Math.round((porTermino.get(t)!.prec ?? 0) * 100)}% ≈ ${porTermino.get(t)!.estimado})`).join("; ") +
        `. Los términos de la familia que NO pasaron el filtro se descartaron a propósito: una \`q\` de baja ` +
        `precisión gasta un request por corrida para traer otro rubro.`,
      verificacion_regex: f.regex.source,
      ...(f.requerido ? { patron_requerido: f.requerido.source } : {}),
      ...(f.excluyente ? { patron_excluyente: f.excluyente.source } : {}),
      verificacion_flags: "i",
      pricing: { modo: "manual" },
      max_paginas_por_variante: 2,
      barrer_adjudicaciones: false,
      presupuesto_requests_por_corrida: costoMarginal,
      acreditaciones_conocidas_faltantes: [],
      _evidencia_mercado: `${f.evidencia} · Tamaño corregido de la familia ≈${estimado} compras abiertas.`,
      _veredicto_keepsync: `${v.veredicto} (A=${v.A}, B=${v.B}, C=${v.C}) · ofertable: ${v.ofertable ? "sí" : "NO — falta catálogo de costos de servicios"}`,
      _costo_real:
        `+${costoMarginal} requests por corrida del radar (presupuesto actual de las activas: ${presupuestoActual}). ` +
        (yaCubiertas.length > 0
          ? `${yaCubiertas.map((v) => `\`${v}\``).join(", ")} ya se consulta${yaCubiertas.length > 1 ? "n" : ""} para otra categoría y el radar deduplica la unión de variantes, así que no suma${yaCubiertas.length > 1 ? "n" : ""} nada.`
          : "Ninguna de sus variantes se consulta hoy."),
    });
  }

  const salida = {
    _que_es:
      "Propuestas de criterios de búsqueda derivadas de output/estudio-mercado.md. Archivo INERTE: ningún script del radar lo carga. Promover una propuesta = copiarla a config/categorias.json con activa: false, y recién ahí empieza el ciclo normal (sondeo → activar).",
    _generado_por: "npm run criterios",
    _regla_de_admision:
      `Familia de capa "fina" + veredicto servible o por-definir + tamaño corregido ≥ ${umbral} compras abiertas + al menos una variante con precisión medida ≥50%.`,
    _no_son_ofertables:
      "Ninguna propuesta habilita una oferta: sin catálogo de costos de servicios de KeepSync no se puede poner precio bajo el tope. Ver config/keepsync-oferta.json → insumos_bloqueantes.",
    generado_en: new Date().toISOString(),
    rechazadas,
    propuestas,
  };

  writeFileSync(path.join(ROOT_DIR, "config", "categorias-propuestas.json"), JSON.stringify(salida, null, 2) + "\n", "utf-8");

  const L: string[] = [];
  L.push("# Propuestas de criterios de búsqueda");
  L.push("");
  L.push(`Generado por \`npm run criterios\` el ${new Date().toISOString().slice(0, 10)}, sobre la medición de`);
  L.push("`historico/mercado.jsonl`. **Ninguna está activa**: viven en `config/categorias-propuestas.json`,");
  L.push("que ningún script del radar carga.");
  L.push("");
  L.push(`Regla de admisión: ${salida._regla_de_admision}`);
  L.push("");
  if (propuestas.length === 0) {
    L.push("_Ninguna familia superó la regla de admisión en esta corrida._");
  } else {
    L.push("| Propuesta | Variantes `q` | Costo/corrida | Veredicto KeepSync |");
    L.push("|---|---|---:|---|");
    for (const p of propuestas) {
      L.push(
        `| ${p.nombre} | ${(p.variantes_q as string[]).map((v) => `\`${v}\``).join(", ")} | +${p.presupuesto_requests_por_corrida} | ${p._veredicto_keepsync} |`,
      );
    }
    L.push("");
    const suma = propuestas.reduce((a, p) => a + (p.presupuesto_requests_por_corrida as number), 0);
    L.push(`Encenderlas todas sumaría **${suma} requests por corrida** al presupuesto actual de ${presupuestoActual}.`);
    L.push("");
    L.push("El costo es el **marginal**: el radar consulta la unión deduplicada de las variantes de todas");
    L.push("las categorías activas, así que una variante que ya se está pidiendo no suma nada. Cada");
    L.push("propuesta detalla en su `_costo_real` cuáles de las suyas ya estaban cubiertas.");
  }
  L.push("");
  if (rechazadas.length > 0) {
    L.push("## Familias que NO pasaron, y por qué");
    L.push("");
    L.push("Se listan a propósito: una familia descartada en silencio se ve igual que una que nadie miró.");
    L.push("");
    for (const r of rechazadas) L.push(`- \`${r.id}\` — ${r.motivo}`);
    L.push("");
  }
  L.push("## Antes de promover cualquiera");
  L.push("");
  L.push("1. Revisar sus `variantes_q` y su `verificacion_regex` a mano — salieron de una medición, no de");
  L.push("   una revisión de casos reales uno por uno.");
  L.push("2. Copiarla a `config/categorias.json` con `activa: false`.");
  L.push("3. `npm run radar -- --sondeo --solo=<id>` y revisar `output/sondeo-variantes.md`.");
  L.push("4. Recién entonces `activa: true`, y después `npm run cuota`.");
  L.push("");
  L.push("Ninguna de estas propuestas habilita una oferta: falta el catálogo de costos de servicios.");
  L.push("");

  mkdirSync(path.join(ROOT_DIR, "output"), { recursive: true });
  writeFileSync(path.join(ROOT_DIR, "output", "propuestas-criterios.md"), L.join("\n"), "utf-8");
  console.log(`${propuestas.length} propuesta(s), ${rechazadas.length} rechazada(s).`);
  console.log("config/categorias-propuestas.json · output/propuestas-criterios.md");
}

if (!existsSync(path.join(ROOT_DIR, "config", "familias-mercado.json"))) {
  console.error("Falta config/familias-mercado.json. Correr `npm run estudio` y derivar las familias primero.");
  process.exitCode = 1;
} else {
  main();
}
