import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { ROOT_DIR } from "../lib/config.js";
import { ultimaPorCodigo, type Observacion } from "../lib/indice.js";
import { leerIndiceCotizaciones } from "../lib/pagina-cotizaciones-capacitacion.js";
import { loadCapacitacionesConfig } from "../lib/capacitaciones.js";
import { catalogoDeOportunidad, nombreCarpeta } from "../lib/documentos-oferta.js";
import { cierreYaPaso } from "../lib/tiempo.js";

/**
 * Puente entre lo que produce el repo y la tabla de estado en n8n.
 *
 *   npm run postear-n8n -- radar [--dry-run]
 *   npm run postear-n8n -- cotizacion <codigo> [--dry-run]
 *   npm run postear-n8n -- expediente <codigo> [--dry-run]
 *   npm run postear-n8n -- error <codigo…> --motivo "…" --run <url>
 *
 * No se le pide a `radar.ts` que emita un JSON nuevo para esto: el índice versionado
 * (`historico/observaciones.jsonl`) ya es la proyección de cada oportunidad, y `ultimaPorCodigo()`
 * —la misma función con que el radar siembra su state— ya lo indexa. Un artefacto más sería otra
 * cosa que mantener sincronizada con la que ya existe.
 *
 * El destino se configura con dos variables de entorno; sin ellas solo funciona `--dry-run`:
 *   N8N_BASE_URL   p.ej. https://keepsync-hub.app.n8n.cloud/webhook
 *   N8N_CLAVE      el valor de la cabecera X-KS-Clave (credencial "KS Ingesta MP" en n8n)
 */

const CABECERA_CLAVE = "X-KS-Clave";

interface FilaSolicitud {
  codigo: string;
  nombre: string;
  organismo: string;
  rut: string;
  categorias: string;
  topeClp: number;
  fechaCierre: string;
  urlPortal: string;
}

function urlPortal(codigo: string): string {
  return `https://www.mercadopublico.cl/Portal/CompraAgil/DetalleCompra?codigo=${encodeURIComponent(codigo)}`;
}

/** Las oportunidades que siguen vivas según el índice: publicadas y con el cierre por delante. */
function oportunidadesAbiertas(): FilaSolicitud[] {
  const observaciones = leerTodasLasObservaciones();
  const porCodigo = ultimaPorCodigo(observaciones);
  const filas: FilaSolicitud[] = [];

  // Una compra puede haber sido capturada por más de una categoría, y cada captura es una línea
  // distinta del índice. La fila de la tabla es una sola, así que se juntan todas sus categorías.
  const porCategorias = new Map<string, Set<string>>();
  for (const o of observaciones) {
    if (!porCategorias.has(o.codigo)) porCategorias.set(o.codigo, new Set());
    porCategorias.get(o.codigo)!.add(o.categoria);
  }

  for (const o of porCodigo.values()) {
    if (o.estado !== "publicada") continue;
    if (o.fecha_cierre && cierreYaPaso(o.fecha_cierre)) continue;
    filas.push({
      codigo: o.codigo,
      nombre: o.nombre,
      organismo: o.organismo,
      rut: o.rut,
      categorias: [...(porCategorias.get(o.codigo) ?? [])].sort().join(", "),
      topeClp: o.monto_disponible_clp,
      fechaCierre: o.fecha_cierre,
      urlPortal: urlPortal(o.codigo),
    });
  }
  return filas.sort((a, b) => a.fechaCierre.localeCompare(b.fechaCierre));
}

function leerTodasLasObservaciones(): Observacion[] {
  const p = path.join(ROOT_DIR, "historico", "observaciones.jsonl");
  if (!existsSync(p)) return [];
  return readFileSync(p, "utf-8")
    .split("\n")
    .filter((l) => l.trim())
    .flatMap((l) => {
      try {
        return [JSON.parse(l) as Observacion];
      } catch {
        return [];
      }
    });
}

/** El catálogo de documentos tal como lo necesita el sub-workflow que crea las carpetas. */
function documentosParaDrive(codigo: string) {
  const cfg = existsSync(path.join(ROOT_DIR, "config", "capacitaciones.json"))
    ? loadCapacitacionesConfig()
    : { cotizaciones: {} as Record<string, never> };
  const cat = catalogoDeOportunidad(codigo, cfg.cotizaciones[codigo]);
  return {
    fuente: cat.fuente,
    provisional: cat.provisional,
    documentos: cat.documentos.map((d) => ({
      n: d.n,
      prefijo: d.prefijo,
      documento: d.documento,
      carpeta: nombreCarpeta(d),
      tipo: d.tipo,
      provisional: d.provisional,
    })),
  };
}

function payloadRadar() {
  const filas = oportunidadesAbiertas();
  return {
    tipo: "radar" as const,
    corrida_id: process.env.CORRIDA_ID ?? "",
    generado: new Date().toISOString(),
    solicitudes: filas.map((f) => ({ ...f, ...documentosParaDrive(f.codigo) })),
  };
}

function payloadCotizacion(codigo: string) {
  const c = leerIndiceCotizaciones().get(codigo);
  if (!c) {
    // No es un error del script: es el caso real de una oportunidad sin ficha del curso, y la
    // tarjeta tiene que decirlo en vez de quedarse pegada en "cotizando".
    return {
      tipo: "cotizacion" as const,
      codigo,
      estado: "sin_ficha" as const,
      motivo:
        `No hay cotización publicada para ${codigo}. Suele ser porque falta su ficha en ` +
        `config/capacitaciones.json (contenido del curso, citas del TDR y criterios ` +
        `direccionadores); este cotizador no inventa ese contenido.`,
      ...documentosParaDrive(codigo),
    };
  }
  return {
    tipo: "cotizacion" as const,
    codigo,
    estado: "cotizado" as const,
    curso: c.curso,
    organismo: c.organismo,
    topeClp: c.topeClp,
    totalClp: c.totalClp,
    descuentoPct: c.descuentoPct,
    scoreApertura: c.score.score,
    fechaCierre: c.fechaCierre,
    pdfUrl: c.archivoPdfRelativo,
    observaciones: { pendientes: c.pendientes, criterios: c.criterios, score: c.score },
    ...documentosParaDrive(codigo),
  };
}

function payloadExpediente(codigo: string) {
  const p = path.join(ROOT_DIR, "output", "expedientes", codigo, "expediente-resumen.json");
  if (!existsSync(p)) {
    throw new Error(`No hay ${path.relative(ROOT_DIR, p)}. Correr 'npm run generar-documento -- ${codigo}' antes.`);
  }
  return { tipo: "expediente" as const, ...JSON.parse(readFileSync(p, "utf-8")) };
}

function payloadError(codigos: string[], motivo: string, run: string) {
  return { tipo: "error" as const, codigos, motivo, run, generado: new Date().toISOString() };
}

async function enviar(payload: unknown, dryRun: boolean): Promise<void> {
  const texto = JSON.stringify(payload, null, dryRun ? 2 : 0);
  if (dryRun) {
    console.log(texto);
    return;
  }
  const base = process.env.N8N_BASE_URL;
  const clave = process.env.N8N_CLAVE;
  if (!base || !clave) {
    throw new Error(
      "Faltan N8N_BASE_URL y/o N8N_CLAVE en el entorno. En CI son secretos del repo; en local, " +
        "usar --dry-run para ver el payload sin enviarlo.",
    );
  }
  const url = `${base.replace(/\/$/, "")}/mp/ingesta`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", [CABECERA_CLAVE]: clave },
    body: texto,
  });
  if (!res.ok) {
    throw new Error(`POST ${url} respondió ${res.status}: ${(await res.text()).slice(0, 400)}`);
  }
  console.log(`Posteado a n8n: ${res.status}`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const positional = args.filter((a) => !a.startsWith("--"));
  const modo = positional[0];

  const valorDe = (bandera: string): string => {
    const i = args.indexOf(bandera);
    return i >= 0 ? (args[i + 1] ?? "") : "";
  };

  let payload: unknown;
  switch (modo) {
    case "radar":
      payload = payloadRadar();
      break;
    case "cotizacion":
      if (!positional[1]) throw new Error("Falta el código: postear-n8n -- cotizacion <codigo>");
      payload = payloadCotizacion(positional[1]);
      break;
    case "expediente":
      if (!positional[1]) throw new Error("Falta el código: postear-n8n -- expediente <codigo>");
      payload = payloadExpediente(positional[1]);
      break;
    case "error":
      payload = payloadError(positional.slice(1), valorDe("--motivo"), valorDe("--run"));
      break;
    default:
      throw new Error("Modo desconocido. Usar: radar | cotizacion <codigo> | expediente <codigo> | error <codigo…>");
  }

  await enviar(payload, dryRun);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
