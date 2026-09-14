import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ROOT_DIR } from "../lib/config.js";
import { cargarIdentidadOferente } from "../lib/capacitaciones.js";
import { obtenerTipoCambioObservado } from "../lib/pricing.js";
import type { MonedaExtranjera } from "../lib/pricing-usd.js";
import {
  cotizarSuscripcionSaaS,
  generarCotizacionSuscripcionPdf,
  parsearLineaSuscripcion,
  type LineaSuscripcionSaaS,
  type TipoCambioObservado,
} from "../lib/cotizacion-suscripcion-saas.js";

/**
 * Cotización comercial directa de una o varias suscripciones SaaS con precio de lista en moneda
 * extranjera por usuario y por mes (Perplexity Pro, ChatGPT Plus, Claude Max, n8n…). No es una
 * oferta a un proceso de compra pública: no hay código de Compra Ágil ni tope presupuestario que
 * respetar, y por eso vive acá y no en `.claude/skills/compra-agil-ofertar/`.
 *
 * Las líneas pueden mezclar monedas (USD y EUR): cada una se convierte con el **valor observado**
 * de la suya y todo el documento sale en pesos chilenos.
 *
 * El precio sale entero de la regla `cotizar-usd` (src/lib/pricing-usd.ts) y el PDF del estilo
 * único de KeepSync (src/lib/estilo-keepsync.ts). El precio de lista es un dato del proveedor y
 * hay que pasarlo a mano con su fuente: este script no lo adivina ni lo consulta.
 *
 * Uso:
 *   npm run cotizar-suscripcion -- \
 *     --id=Q-20260828-INIA --titulo="Claude Max 5x y Max 20x" \
 *     --cliente="Instituto de Investigaciones Agropecuarias (INIA)" \
 *     --linea="Claude Max 5x|100|1|12|Precio publicado por Anthropic: USD 100/mes" \
 *     --linea="n8n Starter|EUR 20|1|12|Precio indicado por el usuario: EUR 20/mes" \
 *     [--tc=925.25] [--tc-fuente="dólar observado, mindicador.cl, 28-08-2026"] \
 *     [--tc-eur=1091.29] [--tc-eur-fuente="euro observado, mindicador.cl, 14-09-2026"] \
 *     [--slug=ClaudeMax] [--salida=output/cotizaciones-standalone]
 *
 * `--linea` se repite una vez por producto y lleva cinco campos separados por `|`: producto,
 * precio por usuario/mes (con prefijo de moneda opcional — USD si no se dice), usuarios, meses,
 * fuente del precio de lista.
 */
interface Args {
  simples: Map<string, string>;
  lineas: string[];
}

function args(): Args {
  const simples = new Map<string, string>();
  const lineas: string[] = [];
  for (const a of process.argv.slice(2)) {
    const eq = a.indexOf("=");
    if (!a.startsWith("--") || eq === -1) continue;
    const clave = a.slice(2, eq);
    const valor = a.slice(eq + 1);
    if (clave === "linea") lineas.push(valor);
    else simples.set(clave, valor);
  }
  return { simples, lineas };
}

function requerido(m: Map<string, string>, clave: string): string {
  const v = m.get(clave);
  if (!v || !v.trim()) {
    console.error(`Falta --${clave}=... (obligatorio).`);
    process.exit(1);
  }
  return v.trim();
}

/** Traduce el error del parser del módulo a un mensaje de consola con el número de línea. */
function parsearLinea(crudo: string, i: number): LineaSuscripcionSaaS {
  try {
    return parsearLineaSuscripcion(crudo);
  } catch (err) {
    console.error(`--linea #${i + 1}: ${(err as Error).message}`);
    process.exit(1);
  }
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
  const { simples: m, lineas: lineasCrudas } = args();
  const id = requerido(m, "id");
  const titulo = requerido(m, "titulo");
  const cliente = requerido(m, "cliente");
  if (!lineasCrudas.length) {
    console.error(
      'Falta al menos un --linea="producto|usd_mes|usuarios|meses|fuente del precio de lista".',
    );
    process.exit(1);
  }
  const lineas = lineasCrudas.map(parsearLinea);

  // Tipo de cambio: el valor observado de cada moneda usada, en vivo (mindicador.cl) salvo que se
  // fije a mano para reproducir una cotización ya emitida. El recargo de 5,5% lo aplica la regla,
  // no este script. Si el servicio no responde y no hay valor a mano, esto **falla**: cotizar con
  // un tipo de cambio de respaldo sin que nadie lo note cambia el precio en silencio.
  const BANDERAS: Record<MonedaExtranjera, { valor: string; fuente: string }> = {
    USD: { valor: "tc", fuente: "tc-fuente" },
    EUR: { valor: "tc-eur", fuente: "tc-eur-fuente" },
  };
  const monedasUsadas = [...new Set(lineas.map((l) => l.moneda))];
  const tiposCambio: Partial<Record<MonedaExtranjera, TipoCambioObservado>> = {};
  for (const moneda of monedasUsadas) {
    const banderas = BANDERAS[moneda];
    const manual = m.get(banderas.valor);
    if (manual) {
      const valor = Number(manual);
      if (!Number.isFinite(valor) || valor <= 0) {
        console.error(`--${banderas.valor} inválido: "${manual}"`);
        process.exit(1);
      }
      // `--tc-fuente` existe porque "manual" a secas borra la procedencia del número, y este repo no
      // afirma nada sin cita. Se usa cuando el fetch en vivo no está disponible (acá el proxy del
      // entorno tumba el fetch de Node aunque curl sí llegue a mindicador.cl) pero el valor
      // observado del día sí se verificó por otra vía.
      tiposCambio[moneda] = {
        valor,
        fuente: m.get(banderas.fuente)?.trim() || `manual (argumento --${banderas.valor})`,
      };
      continue;
    }
    const observado = await obtenerTipoCambioObservado(moneda);
    if (observado.valor === null) {
      console.error(
        `No se pudo obtener el valor observado de ${moneda} (${observado.motivo}). ` +
          `Verificarlo y pasarlo con --${banderas.valor}=<valor> --${banderas.fuente}="<de dónde salió>".`,
      );
      process.exit(1);
    }
    tiposCambio[moneda] = observado;
  }

  const oferente = cargarIdentidadOferente();
  const fecha = new Date();

  const { resumen, html } = cotizarSuscripcionSaaS({
    id,
    titulo,
    cliente,
    lineas,
    tiposCambio,
    oferente,
    fecha,
  });

  const dirSalida = path.resolve(ROOT_DIR, m.get("salida") ?? "output/cotizaciones-standalone");
  mkdirSync(dirSalida, { recursive: true });
  const slug = m.get("slug") ?? slugify(titulo);
  const pdfPath = path.join(dirSalida, `${id}-${slug}.pdf`);
  const jsonPath = path.join(dirSalida, `${id}-${slug}.json`);

  await generarCotizacionSuscripcionPdf(html, pdfPath);
  writeFileSync(jsonPath, JSON.stringify(resumen, null, 2) + "\n", "utf-8");

  const clp = (n: number) => "$" + n.toLocaleString("es-CL");
  console.log(`${id} — ${titulo} — ${cliente}`);
  for (const moneda of monedasUsadas) {
    const tc = tiposCambio[moneda];
    if (tc) console.log(`Valor observado ${moneda}: ${clp(tc.valor)} (${tc.fuente})`);
  }
  console.log("");
  for (const l of resumen.lineas) {
    console.log(
      `${l.producto}: ${l.moneda} ${l.precio_lista_moneda_mes}/usuario/mes × ${l.usuarios} × ${l.meses} = ` +
        `${l.moneda} ${l.monto_moneda} → neto ${clp(l.neto_clp)} (unitario mensual ${clp(l.neto_unitario_mensual_clp)})`,
    );
    for (const p of l.calculo.pasos) console.log(`   ${p.paso}: ${clp(p.valor_clp)}`);
  }
  console.log("");
  for (const [moneda, monto] of Object.entries(resumen.montos_por_moneda)) {
    console.log(`Costo de lista ${moneda}: ${moneda} ${monto}`);
  }
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
