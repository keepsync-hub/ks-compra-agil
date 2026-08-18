import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { ROOT_DIR } from "../../../../src/lib/config.js";
import {
  categoriasActivas,
  categoriaPorId,
  itemMencionaCategoria,
  detalleCompraAgilMencionaCategoria,
} from "../../../../src/lib/categorias.js";
import { buscarCompraAgil, type CompraAgilListItem, type CompraAgilDetalle, type EstadoCompraAgil } from "../../../../src/lib/api.js";
import { obtenerDetalleConCache, proyectar, anexar } from "../../../../src/lib/indice.js";
import { configurarCuota, radarYaCorrioHoy } from "../../../../src/lib/cuota.js";

// Barrido histórico completo — mismos 5 estados que cubre informe-nicho.ts + proveedor_seleccionado
// (radar.ts solo cubre publicada + proveedor_seleccionado del día; este script es el que llena el
// índice con desierta/cancelada/cerrada, que radar.ts nunca toca).
const ESTADOS: EstadoCompraAgil[] = ["publicada", "desierta", "cancelada", "cerrada", "proveedor_seleccionado"];

function listarCodigosCacheados(): string[] {
  const dataDir = path.join(ROOT_DIR, "data");
  if (!existsSync(dataDir)) return [];
  return readdirSync(dataDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(path.join(dataDir, e.name, "detalle.json")))
    .map((e) => e.name);
}

function leerDetalleCacheado(codigo: string): CompraAgilDetalle | null {
  const p = path.join(ROOT_DIR, "data", codigo, "detalle.json");
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf-8")) as CompraAgilDetalle;
  } catch {
    return null;
  }
}

interface Contador {
  nuevas: number;
  cambios: number;
  sinCambios: number;
}

function registrar(c: Contador, motivo: "nueva" | "cambio" | "sin_cambios"): void {
  if (motivo === "nueva") c.nuevas++;
  else if (motivo === "cambio") c.cambios++;
  else c.sinCambios++;
}

async function main() {
  const args = process.argv.slice(2);
  const forzar = args.includes("--forzar");
  const soloCache = args.includes("--solo-cache");
  const catArg = args.find((a) => a.startsWith("--categoria="));
  const categorias = catArg ? [categoriaPorId(catArg.split("=")[1]!)] : categoriasActivas();

  if (categorias.length === 0) {
    console.error("Ninguna categoría para indexar (activa=0 y sin --categoria=<id> explícito).");
    process.exitCode = 1;
    return;
  }

  // Reserva prioritaria de cuota para el radar del día (ver PLAN-VOLUMEN.md, Fase 0/6): este
  // backfill es más caro (5 estados × variantes, contra 1 estado del radar) y no es urgente.
  if (!soloCache && !forzar && !radarYaCorrioHoy()) {
    console.error(
      "El radar (`npm run radar`) todavía no corrió hoy. Este backfill es más costoso en cuota y " +
        "tiene prioridad menor — correr el radar primero, o pasar --forzar si es intencional.",
    );
    process.exitCode = 1;
    return;
  }

  const ahoraIso = new Date().toISOString();
  const contador: Contador = { nuevas: 0, cambios: 0, sinCambios: 0 };

  if (soloCache) {
    const codigos = listarCodigosCacheados();
    console.log(`--solo-cache: reindexando ${codigos.length} código(s) ya cacheados en data/ — 0 requests a la API.`);
    for (const codigo of codigos) {
      const detalle = leerDetalleCacheado(codigo);
      if (!detalle) continue;
      for (const categoria of categorias) {
        if (!detalleCompraAgilMencionaCategoria(categoria, detalle)) continue;
        registrar(contador, anexar(proyectar(detalle, categoria.id, ahoraIso)).motivo);
      }
    }
  } else {
    configurarCuota({ script: "indexar", maxRequests: 100 });
    for (const categoria of categorias) {
      console.log(`\n— ${categoria.nombre}: ${ESTADOS.length} estados × ${categoria.variantes_q.length} variantes...`);
      const encontrados = new Map<string, CompraAgilListItem>();
      for (const estado of ESTADOS) {
        for (const variante of categoria.variantes_q) {
          try {
            const items = await buscarCompraAgil({ q: variante, estado });
            for (const item of items) if (!encontrados.has(item.codigo)) encontrados.set(item.codigo, item);
          } catch (err) {
            console.warn(`  ${estado}/"${variante}": falló, se continúa sin ella — ${(err as Error).message}`);
          }
        }
      }
      const reales = [...encontrados.values()].filter((item) => itemMencionaCategoria(categoria, item));
      console.log(`  ${encontrados.size} código(s) único(s), ${reales.length} con mención real.`);

      let desdeCacheCount = 0;
      for (const item of reales) {
        try {
          const { detalle, desdeCache } = await obtenerDetalleConCache(item.codigo, {
            fecha_ultimo_cambio: item.fechas.fecha_ultimo_cambio,
          });
          if (desdeCache) desdeCacheCount++;
          if (!detalleCompraAgilMencionaCategoria(categoria, detalle)) continue;
          registrar(contador, anexar(proyectar(detalle, categoria.id, ahoraIso)).motivo);
        } catch (err) {
          console.warn(`  ${item.codigo}: no se pudo obtener el detalle — ${(err as Error).message}`);
        }
      }
      console.log(`  ${desdeCacheCount} de ${reales.length} detalle(s) resueltos desde caché (0 requests para esos).`);
    }
  }

  console.log(
    `\nÍndice actualizado: ${contador.nuevas} observación(es) nueva(s), ${contador.cambios} cambio(s) de estado, ` +
      `${contador.sinCambios} sin cambios (no se anexaron). Ver historico/observaciones.jsonl.`,
  );
}

main().catch((err) => {
  console.error("Indexación falló:", err);
  process.exitCode = 1;
});
