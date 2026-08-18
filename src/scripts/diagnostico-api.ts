/**
 * Diagnóstico único de las incógnitas baratas que gobiernan la arquitectura de PLAN-VOLUMEN.md
 * (Fase 0): responde varias preguntas en ~8 requests en vez de gatillar decisiones a ciegas.
 *
 * 1. ¿`q` es opcional en `/v2/compra-agil`? (define si un barrido completo sin keywords es viable)
 * 2. ¿El payload del listado trae un campo de total/paginación? (hoy toda query de exactamente
 *    50 ítems gasta un request extra para confirmar que no hay página siguiente)
 * 3. ¿La API acepta algún filtro de fecha? (haría incremental el barrido histórico)
 * 4. ¿El ticket clásico (LICITACIONES_API_TICKET, api.mercadopublico.cl) funciona, y hay algo
 *    reconocible para cruzar un código de Compra Ágil con su Orden de Compra?
 *
 * Deliberadamente NO construye clientes tipados definitivos (eso es Fase 1/5 si el hallazgo lo
 * justifica) — hace fetches exploratorios, cuenta cada uno contra el ledger de cuota, y vuelca lo
 * que responda la API tal cual para revisión humana. Requiere COMPRA_AGIL_API_TICKET real en .env
 * para las preguntas 1-3; las preguntas de la API clásica (4) requieren además
 * LICITACIONES_API_TICKET — si falta cualquiera de los dos, esos hallazgos individuales fallan con
 * un mensaje claro, pero el resto del reporte se escribe igual (ver `protegido`/`escribirReporte`).
 *
 * Corrido contra producción el 18-08-2026 (ver output/diagnostico-api.md): `q` SÍ es opcional,
 * `payload.paginacion.total_resultados` da el total exacto en 1 sola llamada, ningún filtro de
 * fecha candidato funcionó (HTTP 400 en los tres probados), y la parte de API clásica quedó
 * pendiente por falta de `LICITACIONES_API_TICKET` en ese momento.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ROOT_DIR, getApiTicket as getTicketCompraAgil } from "../lib/config.js";
import { getApiTicket as getTicketClasico } from "../../licitaciones/src/lib/config.js";
import { configurarCuota, contarRequest, registrar429 } from "../lib/cuota.js";

const BASE_V2 = "https://api2.mercadopublico.cl";
const BASE_CLASICA = "https://api.mercadopublico.cl";

interface Hallazgo {
  titulo: string;
  ok: boolean;
  detalle: string;
  raw?: string;
}

// Este script hace fetches manuales, sin la lógica de reintentos/backoff de apiGet (src/lib/api.ts)
// — es exploratorio y de una sola pasada. Sin timeout, un endpoint lento (ya se observó un 504 real
// en esta misma sesión) dejaría el diagnóstico colgado indefinidamente en vez de reportar el fallo.
const TIMEOUT_MS = 20_000;

async function fetchV2(pathAndQuery: string): Promise<{ status: number; json: unknown }> {
  // Ticket ANTES de contar (mismo orden que apiGet en src/lib/api.ts): si falta el ticket, nunca
  // llega a salir un request, así que no debe sumar al ledger de cuota.
  const ticket = getTicketCompraAgil();
  contarRequest();
  const res = await fetch(`${BASE_V2}${pathAndQuery}`, { headers: { ticket }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (res.status === 429) registrar429(res.headers.get("Retry-After"));
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

async function fetchClasica(pathAndQuery: string): Promise<{ status: number; json: unknown }> {
  const ticket = getTicketClasico();
  contarRequest();
  const sep = pathAndQuery.includes("?") ? "&" : "?";
  const res = await fetch(`${BASE_CLASICA}${pathAndQuery}${sep}ticket=${encodeURIComponent(ticket)}`, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (res.status === 429) registrar429(res.headers.get("Retry-After"));
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

function truncar(x: unknown, max = 1500): string {
  const s = JSON.stringify(x, null, 2) ?? "null";
  return s.length > max ? s.slice(0, max) + `\n… (truncado, ${s.length} chars totales)` : s;
}

async function diagnosticoQOpcional(): Promise<Hallazgo> {
  try {
    const { status, json } = await fetchV2("/v2/compra-agil?estado=publicada&tamano_pagina=10&numero_pagina=1");
    const payload = (json as { payload?: { items?: unknown[] } })?.payload;
    const ok = status === 200 && Array.isArray(payload?.items);
    return {
      titulo: "¿`q` es opcional en /v2/compra-agil?",
      ok,
      detalle: ok
        ? `SÍ — HTTP ${status}, devolvió ${payload!.items!.length} ítem(s) sin \`q\`. Un barrido completo sin keywords es viable.`
        : `NO (o inconcluso) — HTTP ${status}. \`q\` sigue siendo obligatorio; mantener el barrido por variantes.`,
      raw: truncar(json),
    };
  } catch (err) {
    return { titulo: "¿`q` es opcional en /v2/compra-agil?", ok: false, detalle: `Falló: ${(err as Error).message}` };
  }
}

async function diagnosticoFormaPayload(): Promise<Hallazgo> {
  try {
    const { status, json } = await fetchV2("/v2/compra-agil?q=Claude&estado=publicada&tamano_pagina=50&numero_pagina=1");
    const envelope = json as Record<string, unknown> | null;
    const payload = envelope?.payload as Record<string, unknown> | undefined;
    const claves = payload ? Object.keys(payload) : [];
    // No basta con mirar las claves de primer nivel: un campo como `paginacion` puede ser un
    // objeto anidado que sí trae el total. Se buscan claves de total/cantidad en TODO el árbol
    // del payload (2 niveles), no solo en el nivel superior.
    const clavesAnidadas: string[] = [];
    for (const [k, v] of Object.entries(payload ?? {})) {
      if (v && typeof v === "object" && !Array.isArray(v)) {
        for (const kk of Object.keys(v as Record<string, unknown>)) clavesAnidadas.push(`${k}.${kk}`);
      }
    }
    const todasLasClaves = [...claves, ...clavesAnidadas];
    const tieneTotal = todasLasClaves.some((k) => /total|cantidad|count/i.test(k));
    const paginacion = payload?.paginacion as Record<string, unknown> | undefined;
    return {
      titulo: "¿El payload del listado trae total/paginación?",
      ok: tieneTotal,
      detalle: tieneTotal
        ? `SÍ — payload.paginacion = ${JSON.stringify(paginacion)}. Se puede leer el total exacto en 1 sola llamada, sin el request extra que hoy hace falta para confirmar la última página.`
        : `NO — claves del payload: ${claves.join(", ") || "(vacío)"}${clavesAnidadas.length ? `; anidadas: ${clavesAnidadas.join(", ")}` : ""}. Sigue haciendo falta 1 request extra por query para confirmar la última página (HTTP ${status}).`,
      // Se trunca el envelope completo (los `items` son grandes y no aportan acá) — el hallazgo
      // relevante ya queda en `detalle` con el valor exacto de `paginacion`.
      raw: truncar(json),
    };
  } catch (err) {
    return { titulo: "¿El payload del listado trae total/paginación?", ok: false, detalle: `Falló: ${(err as Error).message}` };
  }
}

async function diagnosticoFiltroFecha(): Promise<Hallazgo> {
  const candidatos = ["fecha_desde", "fecha_publicacion_desde", "fecha"];
  const resultados: string[] = [];
  let algunoFunciona = false;
  for (const param of candidatos) {
    try {
      const hoy = new Date().toISOString().slice(0, 10);
      const { status, json } = await fetchV2(`/v2/compra-agil?q=Claude&estado=publicada&${param}=${hoy}&tamano_pagina=10&numero_pagina=1`);
      const payload = (json as { payload?: { items?: unknown[] } })?.payload;
      const respondioOk = status === 200 && Array.isArray(payload?.items);
      resultados.push(`\`${param}\`: HTTP ${status}${respondioOk ? `, ${payload!.items!.length} ítem(s)` : ""}`);
      if (respondioOk) algunoFunciona = true;
    } catch (err) {
      resultados.push(`\`${param}\`: error — ${(err as Error).message}`);
    }
  }
  return {
    titulo: "¿La API acepta algún filtro de fecha?",
    ok: algunoFunciona,
    detalle: (algunoFunciona ? "Al menos un candidato respondió sin error — " : "Ninguno confirmado — ") + resultados.join("; "),
  };
}

async function diagnosticoTicketClasico(): Promise<Hallazgo> {
  try {
    const { status, json } = await fetchClasica("/servicios/v1/publico/licitaciones.json?estado=activas");
    const esError = json && typeof json === "object" && "Codigo" in (json as object) && !("Listado" in (json as object));
    const ok = status === 200 && !esError;
    return {
      titulo: "¿El ticket clásico (LICITACIONES_API_TICKET) funciona contra licitaciones.json?",
      ok,
      detalle: ok
        ? `SÍ — HTTP ${status}, respuesta con \`Listado\`.`
        : `NO — HTTP ${status}${esError ? `, error de la API: ${(json as { Mensaje?: string }).Mensaje}` : ""}.`,
      raw: truncar(json),
    };
  } catch (err) {
    return { titulo: "¿El ticket clásico funciona contra licitaciones.json?", ok: false, detalle: `Falló: ${(err as Error).message}` };
  }
}

async function diagnosticoOrdenesCompra(): Promise<Hallazgo> {
  try {
    // Exploratorio: no se conoce el esquema real de parámetros de ordenescompra.json — se prueba
    // con el candidato más probable (codigo) sin asumir que exista cruce directo con un código de
    // Compra Ágil. El objetivo es solo confirmar reachability y volcar la forma real del payload.
    const { status, json } = await fetchClasica("/servicios/v1/publico/ordenescompra.json?estado=Aceptada");
    const esError = json && typeof json === "object" && "Codigo" in (json as object) && !("Listado" in (json as object));
    const ok = status === 200 && !esError;
    return {
      titulo: "¿ordenescompra.json es alcanzable con el ticket clásico?",
      ok,
      detalle: ok
        ? `SÍ — HTTP ${status}. Revisar el \`raw\` para decidir si hay campo para cruzar con el código de Compra Ágil (Fase 5, condicional).`
        : `NO — HTTP ${status}${esError ? `, error de la API: ${(json as { Mensaje?: string }).Mensaje}` : ""}. Fase 5 queda descartada hasta resolver esto.`,
      raw: truncar(json),
    };
  } catch (err) {
    return { titulo: "¿ordenescompra.json es alcanzable con el ticket clásico?", ok: false, detalle: `Falló: ${(err as Error).message}` };
  }
}

/** Envuelve cualquier chequeo (incluido `medirUniverso`, que no tiene su propio try/catch) para
 * que un fallo — ya se vio un timeout real en esta sesión — nunca le impida al script escribir
 * el reporte con lo que sí se alcanzó a medir. Un diagnóstico parcial declarado es mejor que uno
 * completo que nunca se escribe. */
async function protegido(titulo: string, fn: () => Promise<Hallazgo>): Promise<Hallazgo> {
  try {
    return await fn();
  } catch (err) {
    return { titulo, ok: false, detalle: `Falló sin completarse: ${(err as Error).message}` };
  }
}

function escribirReporte(hallazgos: Hallazgo[]): void {
  const md = [
    `# Diagnóstico de API — ${new Date().toISOString()}`,
    ``,
    `Corresponde a PLAN-VOLUMEN.md, Fase 0. Cada hallazgo es evidencia directa de la API, no una`,
    `suposición — pero es una medición de un solo momento; si la API cambia, repetir el diagnóstico.`,
    ``,
    ...hallazgos.map(
      (h) => `## ${h.ok ? "✔" : "✘"} ${h.titulo}\n\n${h.detalle}\n${h.raw ? `\n<details><summary>respuesta cruda</summary>\n\n\`\`\`json\n${h.raw}\n\`\`\`\n\n</details>\n` : ""}`,
    ),
  ].join("\n");

  const outputDir = path.join(ROOT_DIR, "output");
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(path.join(outputDir, "diagnostico-api.md"), md, "utf-8");
  console.log(`\nEscrito en output/diagnostico-api.md (${hallazgos.length} hallazgo(s)).`);
}

async function main() {
  configurarCuota({ script: "diagnostico-api", maxRequests: 10 }); // 1+1+3+1+1+1 = 8 requests en el caso normal

  console.log("Diagnóstico único de API — ver PLAN-VOLUMEN.md, Fase 0.\n");

  const hallazgos: Hallazgo[] = [];
  try {
    for (const fn of [diagnosticoQOpcional, diagnosticoFormaPayload, diagnosticoFiltroFecha, diagnosticoTicketClasico, diagnosticoOrdenesCompra]) {
      const h = await protegido(fn.name, fn);
      hallazgos.push(h);
      console.log(`${h.ok ? "✔" : "✘"} ${h.titulo}\n  ${h.detalle}\n`);
    }

    if (hallazgos[0]!.ok) {
      const universo = await protegido("Tamaño del universo de Compras Ágiles abiertas (sin filtro)", medirUniverso);
      hallazgos.push(universo);
      console.log(`${universo.ok ? "✔" : "✘"} ${universo.titulo}\n  ${universo.detalle}\n`);
    }
  } finally {
    // Se escribe pase lo que pase: un reporte parcial con 4 de 6 hallazgos es información real;
    // no escribir nada porque el 5º tardó demasiado sería tirar a la basura lo que sí se midió.
    escribirReporte(hallazgos);
  }
}

async function medirUniverso(): Promise<Hallazgo> {
  // Solo se corre si `q` resultó opcional. NO pagina para contar: diagnosticoFormaPayload ya
  // confirmó que `payload.paginacion.total_resultados` da el total exacto en 1 sola llamada —
  // un crawl de N páginas para "contar" sería desperdiciar exactamente la cuota que este
  // diagnóstico existe para cuidar. (Versión anterior paginaba con un cap y se cortaba por
  // timeout real de la API en dos corridas seguidas; esta versión es más barata Y más confiable.)
  const { status, json } = await fetchV2("/v2/compra-agil?estado=publicada&tamano_pagina=50&numero_pagina=1");
  const paginacion = (json as { payload?: { paginacion?: { total_resultados?: number; total_paginas?: number } } })?.payload?.paginacion;
  const ok = status === 200 && typeof paginacion?.total_resultados === "number";
  return {
    titulo: "Tamaño del universo de Compras Ágiles abiertas (sin filtro)",
    ok,
    detalle: ok
      ? `${paginacion!.total_resultados} ítem(s) en ${paginacion!.total_paginas ?? "?"} página(s) — leído de \`payload.paginacion\` en 1 sola request.`
      : `No se pudo leer \`payload.paginacion.total_resultados\` (HTTP ${status}).`,
  };
}

main().catch((err) => {
  console.error("Diagnóstico falló:", err);
  process.exitCode = 1;
});
