import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ROOT_DIR } from "../lib/config.js";
import { cargarIdentidadOferente } from "../lib/capacitaciones.js";
import { obtenerTipoCambioUsdClp } from "../lib/pricing.js";
import {
  cotizarSuscripcionUsd,
  generarCotizacionSuscripcionPdf,
} from "../lib/cotizacion-suscripcion-usd.js";

/**
 * Cotización comercial directa de una suscripción SaaS con precio de lista en USD por usuario y
 * por mes (Perplexity Pro, y cualquier otra con la misma estructura de precio). No es una oferta a
 * un proceso de compra pública: no hay código de Compra Ágil ni tope presupuestario que respetar,
 * y por eso vive acá y no en `.claude/skills/compra-agil-ofertar/`.
 *
 * El precio sale entero de la regla `cotizar-usd` (src/lib/pricing-usd.ts) y el PDF del estilo
 * único de KeepSync (src/lib/estilo-keepsync.ts). El precio de lista es un dato del proveedor y
 * hay que pasarlo a mano con su fuente: este script no lo adivina ni lo consulta.
 *
 * Uso:
 *   npm run cotizar-suscripcion -- \
 *     --id=Q-20260828-INIA --producto="Perplexity Pro" --usd-mes=20 --usuarios=2 --meses=12 \
 *     --cliente="Instituto de Investigaciones Agropecuarias (INIA)" \
 *     --fuente-precio="Precio público del plan Pro publicado por Perplexity: USD 20/usuario/mes" \
 *     [--tc=925.25] [--slug=PerplexityPro] [--salida=output/cotizaciones-standalone]
 */
function args(): Map<string, string> {
  const m = new Map<string, string>();
  for (const a of process.argv.slice(2)) {
    const eq = a.indexOf("=");
    if (!a.startsWith("--") || eq === -1) continue;
    m.set(a.slice(2, eq), a.slice(eq + 1));
  }
  return m;
}

function requerido(m: Map<string, string>, clave: string): string {
  const v = m.get(clave);
  if (!v || !v.trim()) {
    console.error(`Falta --${clave}=... (obligatorio).`);
    process.exit(1);
  }
  return v.trim();
}

function numero(m: Map<string, string>, clave: string): number {
  const v = Number(requerido(m, clave));
  if (!Number.isFinite(v) || v <= 0) {
    console.error(`--${clave} debe ser un número mayor que 0 (recibido: "${m.get(clave)}").`);
    process.exit(1);
  }
  return v;
}

/** Nombre de archivo sin espacios ni tildes, mismo criterio que el resto de output/. */
function slugify(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join("");
}

async function main() {
  const m = args();
  const id = requerido(m, "id");
  const producto = requerido(m, "producto");
  const cliente = requerido(m, "cliente");
  const fuentePrecioLista = requerido(m, "fuente-precio");
  const precioListaUsdMes = numero(m, "usd-mes");
  const usuarios = numero(m, "usuarios");
  const meses = numero(m, "meses");

  // Tipo de cambio: en vivo (dólar observado, mindicador.cl) salvo que se fije a mano para
  // reproducir una cotización ya emitida. El recargo de 5,5% lo aplica la regla, no este script.
  const tcManual = m.get("tc");
  let tipoCambioObservado: number;
  let fuenteTipoCambio: string;
  if (tcManual) {
    tipoCambioObservado = Number(tcManual);
    if (!Number.isFinite(tipoCambioObservado) || tipoCambioObservado <= 0) {
      console.error(`--tc inválido: "${tcManual}"`);
      process.exit(1);
    }
    fuenteTipoCambio = "manual (argumento --tc)";
  } else {
    const fx = await obtenerTipoCambioUsdClp(916);
    tipoCambioObservado = fx.valor;
    fuenteTipoCambio = fx.fuente;
  }

  const oferente = cargarIdentidadOferente();
  const fecha = new Date();

  const { resumen, html } = cotizarSuscripcionUsd({
    id,
    producto,
    cliente,
    precioListaUsdMes,
    usuarios,
    meses,
    tipoCambioObservado,
    fuenteTipoCambio,
    fuentePrecioLista,
    oferente,
    fecha,
  });

  const dirSalida = path.resolve(ROOT_DIR, m.get("salida") ?? "output/cotizaciones-standalone");
  mkdirSync(dirSalida, { recursive: true });
  const slug = m.get("slug") ?? slugify(producto);
  const pdfPath = path.join(dirSalida, `${id}-${slug}.pdf`);
  const jsonPath = path.join(dirSalida, `${id}-${slug}.json`);

  await generarCotizacionSuscripcionPdf(html, pdfPath);
  writeFileSync(jsonPath, JSON.stringify(resumen, null, 2) + "\n", "utf-8");

  const clp = (n: number) => "$" + n.toLocaleString("es-CL");
  console.log(`${id} — ${producto} — ${cliente}`);
  console.log(`Monto USD anual: USD ${resumen.monto_usd_anual} (USD ${precioListaUsdMes}/usuario/mes × ${usuarios} × ${meses})`);
  console.log(`Tipo de cambio observado: ${clp(tipoCambioObservado)} (${fuenteTipoCambio})`);
  for (const p of resumen.calculo.pasos) console.log(`  ${p.paso}: ${clp(p.valor_clp)}`);
  console.log("");
  console.log(`Neto ${clp(resumen.neto_clp)} + IVA ${clp(resumen.iva_clp)} = TOTAL ${clp(resumen.total_clp)}`);
  if (resumen.oferente.campos_por_confirmar.length) {
    console.log(`\nIdentidad del oferente pendiente (no aparece en este PDF): ${resumen.oferente.campos_por_confirmar.join(", ")}.`);
  }
  console.log(`\nPDF:  ${path.relative(ROOT_DIR, pdfPath)}`);
  console.log(`JSON: ${path.relative(ROOT_DIR, jsonPath)}`);
  console.log("\nEl envío al cliente lo hace una persona: este script no manda nada.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
