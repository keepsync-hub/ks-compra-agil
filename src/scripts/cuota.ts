/** Imprime el consumo de cuota de hoy y la convergencia pasiva del límite diario. Cero requests. */
import { ledgerHoy, resumenCuota } from "../lib/cuota.js";

function main(): void {
  const hoy = ledgerHoy();
  console.log(`Cuota — ${hoy.fecha}`);
  console.log(`  Total requests hoy: ${hoy.total_requests}`);
  if (Object.keys(hoy.por_script).length > 0) {
    for (const [script, n] of Object.entries(hoy.por_script)) console.log(`    ${script}: ${n}`);
  }
  console.log(`  429 hoy: ${hoy.hubo_429 ? `sí, a las ${hoy.requests_hasta_429} requests (Retry-After: ${hoy.retry_after ?? "no informado"})` : "no"}`);

  const resumen = resumenCuota();
  console.log(`\nConvergencia histórica (${resumen.dias_observados} día(s) cerrado(s) en historico/cuota.jsonl):`);
  console.log(`  Cota inferior del límite diario: ${resumen.cota_inferior ?? "sin datos aún (ningún día sin 429 registrado)"}`);
  console.log(`  Cota superior del límite diario: ${resumen.cota_superior ?? "sin datos aún (ningún 429 registrado)"}`);
  if (resumen.cota_inferior != null && resumen.cota_superior != null) {
    console.log(`  → el límite real está entre ${resumen.cota_inferior} y ${resumen.cota_superior}.`);
  }
}

main();
