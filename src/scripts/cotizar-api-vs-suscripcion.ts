import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ROOT_DIR } from "../lib/config.js";
import { cargarIdentidadOferente } from "../lib/capacitaciones.js";
import { obtenerTipoCambioUsdClp } from "../lib/pricing.js";
import {
  cotizarApiVsSuscripcion,
  generarApiVsSuscripcionPdf,
  type ModeloApi,
  type SuscripcionComparada,
} from "../lib/cotizacion-api-vs-suscripcion.js";

/**
 * Propuesta para una Compra Ágil de licencias Claude cuyo tope no alcanza para la suscripción:
 * compara la suscripción (regla `cotizar-usd`) contra créditos de la API de Anthropic a un valor
 * final de tope × factor (0,9 por defecto), y genera un PDF de 4 láminas más su resumen JSON en
 * `output/<codigo>/`. Ver el encabezado de `src/lib/cotizacion-api-vs-suscripcion.ts`.
 *
 * Tope, organismo, nombre y plazo de entrega salen de `data/<codigo>/detalle.json` (lo baja el
 * radar o `npm run traer-detalle`). Los precios de lista —de la suscripción y de cada modelo— se
 * pasan a mano con su fuente, como en `cotizar-suscripcion`: este script no los adivina.
 *
 * Uso:
 *   npm run cotizar-api-vs-suscripcion -- --codigo=5178-4851-COT26 \
 *     --suscripcion="Claude Pro|17|12|12|Precio publicado por Anthropic, facturación anual" \
 *     --modelo="Claude Sonnet 5.5|2|10|USD 2 entrada / USD 10 salida por millón" \
 *     --modelo="Claude Haiku 4.5|1|5|USD 1 entrada / USD 5 salida por millón" \
 *     [--usuarios-api=12] [--factor-tope=0.9] [--tokens-entrada=2000] [--tokens-salida=1000] \
 *     [--tc=964.1 --tc-fuente="dólar observado, mindicador.cl, 28-09-2026"]
 *
 * Nunca cotiza sobre el tope (el factor se valida en (0, 1]) y nunca envía nada.
 */

function args(): { simples: Map<string, string>; modelos: string[] } {
  const simples = new Map<string, string>();
  const modelos: string[] = [];
  for (const a of process.argv.slice(2)) {
    const eq = a.indexOf("=");
    if (!a.startsWith("--") || eq === -1) continue;
    const clave = a.slice(2, eq);
    const valor = a.slice(eq + 1);
    if (clave === "modelo") modelos.push(valor);
    else simples.set(clave, valor);
  }
  return { simples, modelos };
}

function fallar(msg: string): never {
  console.error(msg);
  process.exit(1);
}

function numero(v: string | undefined, nombre: string, def?: number): number {
  if (v === undefined) {
    if (def === undefined) fallar(`Falta --${nombre}=... (obligatorio).`);
    return def;
  }
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) fallar(`--${nombre} debe ser un número mayor que 0 (recibí "${v}").`);
  return n;
}

/** Campos separados por `|`, exactamente `n`: si no calzan se falla en voz alta en vez de repartirlos mal. */
function campos(v: string, n: number, flag: string): string[] {
  const c = v.split("|").map((x) => x.trim());
  if (c.length !== n) fallar(`--${flag} debe tener ${n} campos separados por "|" (recibí ${c.length}): "${v}"`);
  if (!c[c.length - 1]) fallar(`--${flag}: falta la fuente del precio. Acá no se inventan precios.`);
  return c;
}

async function main() {
  const { simples: m, modelos: modelosCrudos } = args();
  const codigo = m.get("codigo")?.trim() || fallar("Falta --codigo=<codigo de Compra Ágil>.");

  const detallePath = path.join(ROOT_DIR, "data", codigo, "detalle.json");
  if (!existsSync(detallePath)) fallar(`No existe ${path.relative(ROOT_DIR, detallePath)}: correr antes npm run traer-detalle -- ${codigo}`);
  const d = JSON.parse(readFileSync(detallePath, "utf-8"));
  const tope = Number(d?.presupuesto?.monto_disponible_clp);
  if (!(tope > 0)) fallar(`${codigo}: detalle.json no trae presupuesto.monto_disponible_clp.`);
  if (d?.estado?.codigo !== "publicada") fallar(`${codigo} no está publicada (estado: ${d?.estado?.codigo}). No se cotiza.`);

  const sRaw = m.get("suscripcion") || fallar('Falta --suscripcion="producto|usd_mes|usuarios|meses|fuente".');
  const [producto, usdMes, usuarios, meses, fuenteSus] = campos(sRaw, 5, "suscripcion") as [string, string, string, string, string];
  const suscripcion: SuscripcionComparada = {
    producto,
    precioListaUsdMes: numero(usdMes, "suscripcion (usd_mes)"),
    usuarios: numero(usuarios, "suscripcion (usuarios)"),
    meses: numero(meses, "suscripcion (meses)"),
    fuentePrecioLista: fuenteSus,
  };

  if (!modelosCrudos.length) fallar('Falta al menos un --modelo="nombre|usd_millon_entrada|usd_millon_salida|fuente".');
  const modelos: ModeloApi[] = modelosCrudos.map((raw) => {
    const [nombre, ent, sal, fuente] = campos(raw, 4, "modelo") as [string, string, string, string];
    return { nombre, usdPorMillonEntrada: numero(ent, "modelo (entrada)"), usdPorMillonSalida: numero(sal, "modelo (salida)"), fuente };
  });

  let tipoCambioObservado: number;
  let fuenteTipoCambio: string;
  if (m.get("tc")) {
    tipoCambioObservado = numero(m.get("tc"), "tc");
    fuenteTipoCambio = m.get("tc-fuente")?.trim() || "manual (argumento --tc)";
  } else {
    const fx = await obtenerTipoCambioUsdClp(916);
    tipoCambioObservado = fx.valor;
    fuenteTipoCambio = fx.fuente;
  }

  const fecha = new Date();
  const ymd = fecha.toISOString().slice(0, 10).replace(/-/g, "");
  const id = m.get("id") ?? `Q-${ymd}-${codigo}`;

  const { resumen, html } = cotizarApiVsSuscripcion({
    id,
    codigo,
    nombreCompra: String(d.nombre ?? "").trim(),
    cliente: String(d?.institucion?.organismo_comprador ?? "").trim() || "Organismo comprador",
    topeClp: tope,
    factorTope: numero(m.get("factor-tope"), "factor-tope", 0.9),
    plazoEntregaDiasHabiles: Number(d?.entrega?.plazo_entrega_dias) > 0 ? Number(d.entrega.plazo_entrega_dias) : null,
    suscripcion,
    usuariosApi: m.get("usuarios-api") ? numero(m.get("usuarios-api"), "usuarios-api") : undefined,
    modelos,
    perfil: {
      tokensEntrada: numero(m.get("tokens-entrada"), "tokens-entrada", 2000),
      tokensSalida: numero(m.get("tokens-salida"), "tokens-salida", 1000),
    },
    tipoCambioObservado,
    fuenteTipoCambio,
    oferente: cargarIdentidadOferente(),
    fecha,
  });

  const dir = path.join(ROOT_DIR, "output", codigo);
  mkdirSync(dir, { recursive: true });
  const pdfPath = path.join(dir, `${id}-ClaudeViaApi.pdf`);
  const jsonPath = path.join(dir, "propuesta-api-vs-suscripcion.json");
  await generarApiVsSuscripcionPdf(html, pdfPath);
  writeFileSync(jsonPath, JSON.stringify(resumen, null, 2) + "\n", "utf-8");

  const clp = (n: number) => "$" + n.toLocaleString("es-CL");
  const s = resumen.suscripcion;
  const a = resumen.api;
  console.log(`${codigo} — ${resumen.cliente} — tope ${clp(tope)}`);
  console.log(`Tipo de cambio observado: ${tipoCambioObservado} (${fuenteTipoCambio})\n`);
  console.log(`Suscripción ${s.producto}: USD ${s.monto_usd} → neto ${clp(s.neto_clp)} + IVA = ${clp(s.total_clp)} (${s.veces_el_tope}× el tope)`);
  console.log(`API: ${clp(a.total_clp)} (neto ${clp(a.neto_clp)} + IVA ${clp(a.iva_clp)}) → USD ${a.creditos_usd} en créditos para ${a.usuarios} usuario(s) (USD ${a.creditos_usd_por_usuario_mes}/usuario/mes)`);
  for (const u of a.uso_estimado) {
    console.log(`   ${u.modelo}: USD ${u.usd_por_consulta}/consulta → ${u.consultas_totales} consultas, ${u.consultas_por_usuario_mes}/usuario/mes`);
  }
  if (resumen.oferente.campos_por_confirmar.length) {
    console.log(`\nIdentidad del oferente pendiente: ${resumen.oferente.campos_por_confirmar.join(", ")}.`);
  }
  console.log(`\nPDF:  ${path.relative(ROOT_DIR, pdfPath)}\nJSON: ${path.relative(ROOT_DIR, jsonPath)}`);
  console.log("\nNada se envía: la oferta la revisa y la presenta una persona.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
