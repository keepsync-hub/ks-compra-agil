import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ROOT_DIR } from "../lib/config.js";
import { cargarIdentidadOferente } from "../lib/capacitaciones.js";
import { obtenerTipoCambioUsdClp } from "../lib/pricing.js";
import {
  cotizarSuscripcionUsd,
  generarCotizacionSuscripcionPdf,
  type LineaSuscripcion,
} from "../lib/cotizacion-suscripcion-usd.js";

/**
 * Cotización comercial directa de una o varias suscripciones SaaS con precio de lista en USD por
 * usuario y por mes (Perplexity Pro, ChatGPT Plus, Claude Max…). No es una oferta a un proceso de
 * compra pública: no hay código de Compra Ágil ni tope presupuestario que respetar, y por eso vive
 * acá y no en `.claude/skills/compra-agil-ofertar/`.
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
 *     --linea="Claude Max 20x|200|1|12|Precio publicado por Anthropic: USD 200/mes" \
 *     [--tc=925.25] [--tc-fuente="dólar observado, mindicador.cl, 28-08-2026"] \
 *     [--slug=ClaudeMax] [--salida=output/cotizaciones-standalone]
 *
 * `--linea` se repite una vez por producto y lleva cinco campos separados por `|`:
 * producto, USD por usuario/mes, usuarios, meses, fuente del precio de lista.
 *
 * Cuando el proveedor publica precio **en pesos** —OpenAI cobra CLP 108.000/mes por asiento Premium
 * de ChatGPT Business en Chile— va `--linea-clp`, con los mismos cinco campos pero el segundo en
 * CLP. Esas líneas no se convierten, así que no necesitan `--tc`: si todas las líneas son CLP, el
 * script no consulta ningún tipo de cambio. Convertir un precio de lista en dólares existiendo
 * precio local infla el costo (11% en el caso de SEC, medido el 2026-09-16).
 *
 * `--sin-recargo` saca el 5,5% de las líneas CLP. En esta variante ese porcentaje no cubre riesgo
 * cambiario —no hay conversión— sino que el proveedor reajuste su precio local durante la vigencia,
 * así que corresponde con facturación mensual y no con facturación anual, donde el precio queda
 * bloqueado por el año.
 */
interface Args {
  simples: Map<string, string>;
  banderas: Set<string>;
  lineas: string[];
  lineasClp: string[];
}

function args(): Args {
  const simples = new Map<string, string>();
  const banderas = new Set<string>();
  const lineas: string[] = [];
  const lineasClp: string[] = [];
  for (const a of process.argv.slice(2)) {
    if (!a.startsWith("--")) continue;
    const eq = a.indexOf("=");
    if (eq === -1) {
      banderas.add(a.slice(2));
      continue;
    }
    const clave = a.slice(2, eq);
    const valor = a.slice(eq + 1);
    if (clave === "linea") lineas.push(valor);
    else if (clave === "linea-clp") lineasClp.push(valor);
    else simples.set(clave, valor);
  }
  return { simples, banderas, lineas, lineasClp };
}

function requerido(m: Map<string, string>, clave: string): string {
  const v = m.get(clave);
  if (!v || !v.trim()) {
    console.error(`Falta --${clave}=... (obligatorio).`);
    process.exit(1);
  }
  return v.trim();
}

/**
 * Cada `--linea` son cinco campos separados por `|`. Se exige exactamente cinco: si el texto de la
 * fuente trae un `|`, el parseo tiene que fallar en voz alta y no repartir mal los campos —
 * cotizar con el número equivocado en silencio es el peor desenlace posible acá.
 */
function parsearLinea(
  crudo: string,
  i: number,
  moneda: "USD" | "CLP",
  aplicarRecargo: boolean,
): LineaSuscripcion {
  const bandera = moneda === "USD" ? "--linea" : "--linea-clp";
  const campoPrecio = moneda === "USD" ? "usd_mes" : "clp_mes";
  const partes = crudo.split("|").map((p) => p.trim());
  if (partes.length !== 5) {
    console.error(
      `${bandera} #${i + 1} debe tener 5 campos separados por "|" ` +
        `(producto|${campoPrecio}|usuarios|meses|fuente); recibí ${partes.length}: "${crudo}"`,
    );
    process.exit(1);
  }
  // Los `= ""` son para el compilador (noUncheckedIndexedAccess): el largo ya se validó arriba, y
  // si por algo llegaran vacíos las validaciones de más abajo los rechazan igual.
  const [producto = "", precio = "", usuarios = "", meses = "", fuente = ""] = partes;
  const num = (v: string, nombre: string) => {
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) {
      console.error(`${bandera} #${i + 1}: ${nombre} debe ser un número mayor que 0 (recibí "${v}").`);
      process.exit(1);
    }
    return n;
  };
  if (!producto) {
    console.error(`${bandera} #${i + 1}: falta el nombre del producto.`);
    process.exit(1);
  }
  if (!fuente) {
    console.error(`${bandera} #${i + 1}: falta la fuente del precio de lista. Acá no se inventan precios.`);
    process.exit(1);
  }
  const comun = {
    producto,
    usuarios: num(usuarios, "usuarios"),
    meses: num(meses, "meses"),
    fuentePrecioLista: fuente,
  };
  return moneda === "USD"
    ? { moneda, ...comun, precioListaUsdMes: num(precio, campoPrecio) }
    : { moneda, ...comun, precioListaClpMes: num(precio, campoPrecio), aplicarRecargo };
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
  const { simples: m, banderas, lineas: lineasCrudas, lineasClp: lineasClpCrudas } = args();
  const id = requerido(m, "id");
  const titulo = requerido(m, "titulo");
  const cliente = requerido(m, "cliente");
  if (!lineasCrudas.length && !lineasClpCrudas.length) {
    console.error(
      'Falta al menos un --linea="producto|usd_mes|usuarios|meses|fuente del precio de lista" ' +
        "(o --linea-clp, si el proveedor publica precio en pesos).",
    );
    process.exit(1);
  }
  const aplicarRecargo = !banderas.has("sin-recargo");
  const lineas = [
    ...lineasCrudas.map((l, i) => parsearLinea(l, i, "USD", aplicarRecargo)),
    ...lineasClpCrudas.map((l, i) => parsearLinea(l, i, "CLP", aplicarRecargo)),
  ];

  // Tipo de cambio: en vivo (dólar observado, mindicador.cl) salvo que se fije a mano para
  // reproducir una cotización ya emitida. El recargo de 5,5% lo aplica la regla, no este script.
  // Las líneas en pesos no convierten nada: si no hay ninguna línea en USD, no se consulta ni se
  // exige tipo de cambio. Pedirlo igual invitaría a anotar en el resumen un número que no se usó.
  const hayLineasUsd = lineas.some((l) => l.moneda === "USD");
  const tcManual = m.get("tc");
  let tipoCambioObservado: number | null = null;
  let fuenteTipoCambio: string | null = null;
  if (!hayLineasUsd) {
    if (tcManual) {
      console.error("--tc no aplica: todas las líneas tienen precio de lista en pesos.");
      process.exit(1);
    }
  } else if (tcManual) {
    tipoCambioObservado = Number(tcManual);
    if (!Number.isFinite(tipoCambioObservado) || tipoCambioObservado <= 0) {
      console.error(`--tc inválido: "${tcManual}"`);
      process.exit(1);
    }
    // `--tc-fuente` existe porque "manual" a secas borra la procedencia del número, y este repo no
    // afirma nada sin cita. Se usa cuando el fetch en vivo no está disponible (acá el proxy del
    // entorno tumba el fetch de Node aunque curl sí llegue a mindicador.cl) pero el dólar observado
    // del día sí se verificó por otra vía.
    fuenteTipoCambio = m.get("tc-fuente")?.trim() || "manual (argumento --tc)";
  } else {
    const fx = await obtenerTipoCambioUsdClp(916);
    tipoCambioObservado = fx.valor;
    fuenteTipoCambio = fx.fuente;
  }

  const oferente = cargarIdentidadOferente();
  const fecha = new Date();

  const { resumen, html } = cotizarSuscripcionUsd({
    id,
    titulo,
    cliente,
    lineas,
    tipoCambioObservado,
    fuenteTipoCambio,
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
  if (tipoCambioObservado !== null) {
    console.log(`Tipo de cambio observado: ${clp(tipoCambioObservado)} (${fuenteTipoCambio})`);
  } else {
    console.log("Sin tipo de cambio: todas las líneas tienen precio de lista en pesos.");
  }
  console.log("");
  for (const l of resumen.lineas) {
    const lista =
      l.moneda === "USD"
        ? `USD ${l.precio_lista_usd_mes}/usuario/mes × ${l.usuarios} × ${l.meses} = USD ${l.monto_usd}`
        : `${clp(l.precio_lista_clp_mes ?? 0)}/usuario/mes × ${l.usuarios} × ${l.meses} = ${clp(l.monto_lista_clp)}`;
    console.log(
      `${l.producto}: ${lista} → neto ${clp(l.neto_clp)} ` +
        `(unitario mensual ${clp(l.neto_unitario_mensual_clp)})`,
    );
    for (const p of l.calculo.pasos) console.log(`   ${p.paso}: ${clp(p.valor_clp)}`);
  }
  console.log("");
  if (resumen.monto_usd_total !== null) console.log(`USD total: USD ${resumen.monto_usd_total}`);
  console.log(`Lista en pesos: ${clp(resumen.monto_lista_clp_total)}`);
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
