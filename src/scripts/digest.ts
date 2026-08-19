/**
 * Digest priorizado (ver PLAN-VOLUMEN.md, Fase 4): "Ofertar hoy" / "Revisar" / "Descartado" +
 * ventanas de republicación de los próximos 3 días + cuota del día. Cero requests propios — opera
 * sobre `data/<codigo>/detalle.json` ya en caché (lo deja el radar) y el índice histórico
 * versionado. Si una oportunidad del índice todavía no tiene caché, se declara así en el reporte
 * (no se pierde silenciosamente): correr `npm run radar` primero la trae.
 *
 * Es la respuesta directa a lo que un feed de alertas como el de Licify/LicitaIA prioriza por ti:
 * acá la prioridad sale de datos que ya se pagaron (el índice), nunca de "probabilidad de ganar"
 * — el score es honestamente "orden de revisión sugerido" (ver `calificador.ts`).
 */
import { existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ROOT_DIR, loadCompanyConfig } from "../lib/config.js";
import { categoriasActivas } from "../lib/categorias.js";
import { leer, ultimaPorCodigo, type Observacion } from "../lib/indice.js";
import { extraerCondiciones } from "../lib/condiciones.js";
import { calificarOportunidad, anexarCalificacion, type Calificacion } from "../lib/calificador.js";
import { calcularMetricas, ventanaRepublicacionEstimada, perfilesOrganismosRecompradores } from "../lib/metricas.js";
import { ledgerHoy } from "../lib/cuota.js";
import { clasificarMotivo } from "../lib/motivos.js";
import { fechaChileAUtc, formatearEnChile } from "../lib/tiempo.js";
import type { CompraAgilDetalle } from "../lib/api.js";

const ESTADOS_FRACASO = new Set(["desierta", "cancelada"]);

function cargarDetalleDeCache(codigo: string): CompraAgilDetalle | null {
  const p = path.join(ROOT_DIR, "data", codigo, "detalle.json");
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf-8")) as CompraAgilDetalle;
  } catch {
    return null;
  }
}

interface ItemDigest {
  observacion: Observacion;
  calificacion: Calificacion | null; // null si no hay caché de detalle todavía
}

function fmtSenales(c: Calificacion): string {
  return c.senales
    .filter((s) => s.peso > 0 || s.contribucion !== 0 || s.nota.includes("no evaluado") || s.nota.includes("no se pudo"))
    .map((s) => `${s.nombre}=${s.valor} (${s.nota})`)
    .join("; ");
}

function main(): void {
  const ahora = new Date();
  let company: ReturnType<typeof loadCompanyConfig> | null = null;
  try {
    company = loadCompanyConfig();
  } catch {
    company = null; // el digest sigue funcionando sin precio real — ver nota en cada oportunidad
  }
  const fxClpPorUsd = company?.pricing.fx_fallback_clp_por_usd ?? null;

  const lineas: string[] = [];
  lineas.push(`# Digest priorizado — ${formatearEnChile(ahora)}`);
  lineas.push("");
  if (!company) {
    lineas.push(
      "> **Sin `config/company.json` en este entorno**: las señales de precio (`holgura_precio`, tope) no se evaluaron. " +
        "El resto del digest (recompradores, motivos, competencia, plazos) sigue siendo válido.",
    );
    lineas.push("");
  } else {
    lineas.push(
      `> Precio evaluado con el tipo de cambio de respaldo de \`config/company.json\` (${fxClpPorUsd} CLP/USD) — no una consulta en vivo. Confirmar el FX real antes de cotizar de verdad (\`npm run cotizar\`).`,
    );
    lineas.push("");
  }

  const ofertar: ItemDigest[] = [];
  const revisar: ItemDigest[] = [];
  const descartar: ItemDigest[] = [];
  const sinCache: Observacion[] = [];

  for (const categoria of categoriasActivas()) {
    const observaciones = [...ultimaPorCodigo(leer({ categoria: categoria.id })).values()].filter(
      (o) => o.estado === "publicada" && (fechaChileAUtc(o.fecha_cierre)?.getTime() ?? 0) >= ahora.getTime(),
    );

    for (const obs of observaciones) {
      const detalle = cargarDetalleDeCache(obs.codigo);
      if (!detalle) {
        sinCache.push(obs);
        continue;
      }
      const condiciones = extraerCondiciones(detalle);
      const calificacion = calificarOportunidad({ detalle, condiciones, categoria, company, fxClpPorUsd });
      anexarCalificacion(calificacion);
      const item: ItemDigest = { observacion: obs, calificacion };
      if (calificacion.veredicto === "ofertar") ofertar.push(item);
      else if (calificacion.veredicto === "revisar") revisar.push(item);
      else descartar.push(item);
    }
  }

  ofertar.sort((a, b) => (b.calificacion!.score ?? 0) - (a.calificacion!.score ?? 0));
  revisar.sort((a, b) => (b.calificacion!.score ?? 0) - (a.calificacion!.score ?? 0));

  lineas.push("## Ofertar hoy");
  lineas.push("");
  if (ofertar.length === 0) lineas.push("_Ninguna oportunidad cruzó el umbral hoy._");
  for (const { observacion: o, calificacion: c } of ofertar) {
    lineas.push(
      `- **${o.codigo}** — ${o.nombre} — ${o.organismo} — $${o.monto_disponible_clp.toLocaleString("es-CL")} — score ${c!.score!.toFixed(1)}`,
    );
    lineas.push(`  - Comando: \`npm run cotizar -- ${o.codigo}\``);
    lineas.push(`  - Señales: ${fmtSenales(c!)}`);
  }
  lineas.push("");

  lineas.push("## Revisar");
  lineas.push("");
  if (revisar.length === 0) lineas.push("_Nada pendiente de revisión hoy._");
  for (const { observacion: o, calificacion: c } of revisar) {
    lineas.push(`- **${o.codigo}** — ${o.nombre} — ${o.organismo} — score ${c!.score!.toFixed(1)}`);
    lineas.push(`  - Pregunta a resolver: ${fmtSenales(c!)}`);
  }
  lineas.push("");

  lineas.push("## Descartado");
  lineas.push("");
  if (descartar.length === 0 && sinCache.length === 0) lineas.push("_Ninguno descartado hoy._");
  for (const { observacion: o, calificacion: c } of descartar) {
    lineas.push(`- ${o.codigo} — ${o.nombre} — bloqueante: **${c!.motivo_descarte}**`);
  }
  for (const o of sinCache) lineas.push(`- ${o.codigo} — ${o.nombre} — sin caché de detalle (correr \`npm run radar\` primero)`);
  lineas.push("");

  lineas.push("## Ventanas de republicación (próximos 3 días)");
  lineas.push("");
  const ventanas = ventanasProximas(ahora);
  if (ventanas.length === 0) {
    lineas.push("_Sin ventanas estimadas cayendo en los próximos 3 días (o aún sin suficientes intervalos medidos)._");
  }
  for (const v of ventanas) lineas.push(`- **${v.organismo}** — último fracaso ${v.fechaFracaso} (${v.codigo}) — ventana estimada: ${v.detalle}`);
  lineas.push("");

  lineas.push("## Métricas por categoría (índice histórico, cero requests)");
  lineas.push("");
  for (const categoria of categoriasActivas()) {
    const m = calcularMetricas(categoria.id);
    if (m.n_observados === 0) continue;
    lineas.push(`### ${categoria.nombre} (n=${m.n_observados})`);
    lineas.push(
      `- Con desenlace: ${m.n_con_desenlace} — tasa de fracaso: ${m.tasa_fracaso_pct !== null ? m.tasa_fracaso_pct.toFixed(0) + "%" : "n.d."}`,
    );
    if (m.monto) lineas.push(`- Monto (n=${m.monto_n}): p25 $${Math.round(m.monto.p25).toLocaleString("es-CL")} · mediana $${Math.round(m.monto.mediana).toLocaleString("es-CL")} · p75 $${Math.round(m.monto.p75).toLocaleString("es-CL")}`);
    if (m.competencia_mediana !== null) lineas.push(`- Competencia mediana: ${m.competencia_mediana} oferta(s)`);
    lineas.push(`- Organismos recompradores en el índice: ${m.organismos_recompradores}`);
    lineas.push(`- Motivos de fracaso clasificados: comprador=${m.motivos.comprador} · precio=${m.motivos.precio} · técnico=${m.motivos.tecnico} · administrativo=${m.motivos.administrativo} · sin_info=${m.motivos.sin_info}`);
    lineas.push("");
  }

  lineas.push("## Organismos con historial (recompradores)");
  lineas.push("");
  const perfiles = categoriasActivas().flatMap((cat) => perfilesOrganismosRecompradores(cat.id));
  if (perfiles.length === 0) {
    lineas.push("_Ningún organismo con 2+ procesos en el índice todavía._");
  } else {
    for (const p of perfiles) {
      lineas.push(
        `- **${p.organismo}** — ${p.n_procesos} proceso(s) en el índice` +
          (p.tasa_fracaso_pct !== null ? `, ${p.tasa_fracaso_pct.toFixed(0)}% de fracaso (n=${p.n_con_desenlace})` : "") +
          (p.monto ? `, monto mediano $${Math.round(p.monto.mediana).toLocaleString("es-CL")}` : ""),
      );
      if (p.ultimo_fracaso) {
        const cl = clasificarMotivo(p.ultimo_fracaso.estado === "desierta" ? p.ultimo_fracaso.motivo_desierta : p.ultimo_fracaso.motivo_cancelacion);
        lineas.push(`  - Último fracaso (${p.ultimo_fracaso.codigo}, ${p.ultimo_fracaso.fecha_publicacion}): clasificado "${cl.categoria}" — ${cl.regla}`);
      }
    }
  }
  lineas.push("");

  const cuota = ledgerHoy();
  lineas.push("## Cuota");
  lineas.push("");
  lineas.push(`- Requests hoy: ${cuota.total_requests}${cuota.hubo_429 ? ` — **429 recibido a las ${cuota.requests_hasta_429}**` : ""}`);
  lineas.push("");
  lineas.push(
    `_Muestra pequeña: estas métricas se calculan sobre lo que hay hoy en \`historico/observaciones.jsonl\`, que crece con cada corrida del radar. Con pocos casos, tratar los porcentajes como orientativos, no concluyentes._`,
  );

  const outPath = path.join(ROOT_DIR, "output", "digest-ultimo.md");
  mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileSync(outPath, lineas.join("\n") + "\n", "utf-8");
  console.log(`Digest escrito en ${outPath} — ofertar=${ofertar.length} revisar=${revisar.length} descartar=${descartar.length} sin_cache=${sinCache.length}`);
}

interface VentanaProxima {
  organismo: string;
  codigo: string;
  fechaFracaso: string;
  detalle: string;
}

function ventanasProximas(ahora: Date): VentanaProxima[] {
  const resultado: VentanaProxima[] = [];
  for (const categoria of categoriasActivas()) {
    const ventana = ventanaRepublicacionEstimada(categoria.id);
    if (!ventana) continue;
    const ultimaObs = ultimaPorCodigo(leer({ categoria: categoria.id }));
    const porOrganismo = new Map<string, Observacion>();
    for (const o of ultimaObs.values()) {
      const actual = porOrganismo.get(o.rut);
      if (!actual || o.fecha_publicacion > actual.fecha_publicacion) porOrganismo.set(o.rut, o);
    }
    for (const o of porOrganismo.values()) {
      if (!ESTADOS_FRACASO.has(o.estado)) continue; // ya republicó (o sigue vigente) — no hay ventana pendiente
      const fechaFracaso = fechaChileAUtc(o.fecha_publicacion);
      if (!fechaFracaso) continue;
      const inicioVentana = fechaFracaso.getTime() + ventana.p25 * 86_400_000;
      const finVentana = fechaFracaso.getTime() + ventana.p75 * 86_400_000;
      const en3Dias = ahora.getTime() + 3 * 86_400_000;
      if (inicioVentana <= en3Dias && finVentana >= ahora.getTime()) {
        resultado.push({
          organismo: o.organismo,
          codigo: o.codigo,
          fechaFracaso: o.fecha_publicacion,
          detalle: `${ventana.p25.toFixed(0)}–${ventana.p75.toFixed(0)} días desde el fracaso (mediana ${ventana.mediana.toFixed(0)})`,
        });
      }
    }
  }
  return resultado;
}

main();
