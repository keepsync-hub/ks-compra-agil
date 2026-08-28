import { obtenerTipoCambioUsdClp } from "../lib/pricing.js";
import { calcularCotizacionUsd } from "../lib/pricing-usd.js";

/**
 * CLI de apoyo para aplicar la regla de cotización en USD (ver SKILL.md de este skill y
 * src/lib/pricing-usd.ts). No escribe nada — solo imprime el desglose paso a paso.
 *
 * Uso:
 *   npm run cotizar-usd -- <monto_usd>                  # tipo de cambio en vivo (mindicador.cl)
 *   npm run cotizar-usd -- <monto_usd> <tipo_cambio>     # tipo de cambio manual
 */
async function main() {
  const [montoArg, tcArg] = process.argv.slice(2);
  const montoUsd = Number(montoArg);
  if (!montoArg || Number.isNaN(montoUsd) || montoUsd <= 0) {
    console.error("Uso: npm run cotizar-usd -- <monto_usd> [tipo_cambio_observado]");
    process.exit(1);
  }

  let tipoCambioObservado: number;
  let fuente: string;
  if (tcArg) {
    tipoCambioObservado = Number(tcArg);
    if (Number.isNaN(tipoCambioObservado) || tipoCambioObservado <= 0) {
      console.error(`tipo_cambio_observado inválido: "${tcArg}"`);
      process.exit(1);
    }
    fuente = "manual (argumento de línea de comando)";
  } else {
    const fx = await obtenerTipoCambioUsdClp(900);
    tipoCambioObservado = fx.valor;
    fuente = fx.fuente;
  }

  const resultado = calcularCotizacionUsd(montoUsd, tipoCambioObservado);

  console.log(`Monto USD: ${montoUsd}`);
  console.log(`Tipo de cambio observado: $${tipoCambioObservado} (fuente: ${fuente})`);
  console.log("");
  for (const p of resultado.pasos) {
    console.log(`${p.paso}: $${p.valor_clp.toLocaleString("es-CL")} CLP`);
    console.log(`   ${p.descripcion}`);
  }
  console.log("");
  console.log(`Precio a utilizar en la cotización (neto): $${resultado.precio_cotizacion_clp.toLocaleString("es-CL")} CLP`);
  console.log(`Valor final a presentar (con IVA): $${resultado.valor_final_clp.toLocaleString("es-CL")} CLP`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
