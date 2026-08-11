import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ROOT_DIR, loadMarcasConfig } from "../../../../src/lib/config.js";
import { buscarCompraAgil, obtenerDetalleCompraAgil, type CompraAgilListItem } from "../../../../src/lib/api.js";
import { itemMencionaMarca } from "../../../../src/lib/marca.js";

const ESTADOS = ["publicada", "desierta", "cancelada", "cerrada"] as const;

function mediana(valores: number[]): number {
  if (valores.length === 0) return 0;
  const ordenados = [...valores].sort((a, b) => a - b);
  const mid = Math.floor(ordenados.length / 2);
  return ordenados.length % 2 === 0 ? (ordenados[mid - 1]! + ordenados[mid]!) / 2 : ordenados[mid]!;
}

function clp(n: number): string {
  return "$" + Math.round(n).toLocaleString("es-CL");
}

async function main() {
  const marcas = loadMarcasConfig();
  const encontrados = new Map<string, CompraAgilListItem>();

  console.log(`Barriendo histórico: ${marcas.variantes.length} variantes × ${ESTADOS.length} estados...`);
  for (const estado of ESTADOS) {
    for (const variante of marcas.variantes) {
      const items = await buscarCompraAgil({ q: variante, estado });
      for (const item of items) {
        if (!encontrados.has(item.codigo)) encontrados.set(item.codigo, item);
      }
    }
  }

  const casos = [...encontrados.values()].filter(itemMencionaMarca);
  console.log(`${casos.length} casos históricos con mención real de marca.`);

  const porEstado = new Map<string, CompraAgilListItem[]>();
  for (const c of casos) {
    const lista = porEstado.get(c.estado.codigo) ?? [];
    lista.push(c);
    porEstado.set(c.estado.codigo, lista);
  }

  const montos = casos.map((c) => c.montos.monto_disponible_clp).filter((m) => m > 0);
  const montoMediano = mediana(montos);
  const montoMin = Math.min(...montos);
  const montoMax = Math.max(...montos);
  const montoTotal = montos.reduce((a, b) => a + b, 0);

  const porMes = new Map<string, number>();
  for (const c of casos) {
    const mes = c.fechas.fecha_publicacion.slice(0, 7); // AAAA-MM
    porMes.set(mes, (porMes.get(mes) ?? 0) + 1);
  }
  const mesesOrdenados = [...porMes.keys()].sort();

  const organismos = new Map<string, { nombre: string; procesos: CompraAgilListItem[] }>();
  for (const c of casos) {
    const rut = c.institucion.rut;
    const entry = organismos.get(rut) ?? { nombre: c.institucion.organismo_comprador, procesos: [] };
    entry.procesos.push(c);
    organismos.set(rut, entry);
  }
  const recompradores = [...organismos.values()]
    .filter((o) => o.procesos.length > 1)
    .sort((a, b) => b.procesos.length - a.procesos.length);

  const motivosDesierta = (porEstado.get("desierta") ?? [])
    .map((c) => c.motivos.motivo_desierta)
    .filter((m): m is string => !!m && m.trim().length > 0);
  const motivosCancelacion = (porEstado.get("cancelada") ?? [])
    .map((c) => c.motivos.motivo_cancelacion)
    .filter((m): m is string => !!m && m.trim().length > 0);

  const abiertas = (porEstado.get("publicada") ?? []).sort((a, b) => a.fechas.fecha_cierre.localeCompare(b.fechas.fecha_cierre));
  // El listado siempre reporta 0 ofertas para procesos abiertos (hallazgo verificado en PLAN.md);
  // el detalle sí da el número real. Solo unas pocas oportunidades abiertas a la vez, así que
  // vale la pena el gasto extra de cuota para no subestimar la competencia en el informe.
  const competenciaReal = new Map<string, number>();
  for (const a of abiertas) {
    try {
      const detalle = await obtenerDetalleCompraAgil(a.codigo);
      competenciaReal.set(a.codigo, detalle.resumen.total_ofertas_recibidas);
    } catch {
      // si falla, se deja sin dato y se usa el valor del listado más abajo
    }
  }

  const desiertas = porEstado.get("desierta")?.length ?? 0;
  const canceladas = porEstado.get("cancelada")?.length ?? 0;
  const cerradas = porEstado.get("cerrada")?.length ?? 0;
  const publicadas = porEstado.get("publicada")?.length ?? 0;
  const fracasadas = desiertas + canceladas;
  const pctFracaso = casos.length > 0 ? ((fracasadas / casos.length) * 100).toFixed(0) : "0";

  const md = `# Informe del nicho: Compras Ágiles que piden Claude/Anthropic

Generado: ${new Date().toISOString()}. Medición en vivo contra \`api2.mercadopublico.cl\`, no una
foto fija — volver a correr \`npm run informe\` para refrescar estas cifras.

## Tamaño y ritmo

- **${casos.length} casos** detectados con mención real de marca desde el primer registro
  encontrado (${mesesOrdenados[0] ?? "—"}).
- Monto mediano: **${clp(montoMediano)} CLP**; rango ${clp(montoMin)} – ${clp(montoMax)}; suma total
  de los ${montos.length} casos con monto informado: **${clp(montoTotal)} CLP**.

| Mes | Publicadas |
|---|---|
${mesesOrdenados.map((m) => `| ${m} | ${porMes.get(m)} |`).join("\n")}

## El dato central: tasa de fracaso

| Desenlace | Casos | % |
|---|---|---|
| Desierta | ${desiertas} | ${casos.length ? ((desiertas / casos.length) * 100).toFixed(0) : 0}% |
| Cancelada | ${canceladas} | ${casos.length ? ((canceladas / casos.length) * 100).toFixed(0) : 0}% |
| Cerrada (con éxito) | ${cerradas} | ${casos.length ? ((cerradas / casos.length) * 100).toFixed(0) : 0}% |
| Publicada (vigente) | ${publicadas} | ${casos.length ? ((publicadas / casos.length) * 100).toFixed(0) : 0}% |

**${pctFracaso}% de los procesos con desenlace conocido termina desierto o cancelado.** La
hipótesis de trabajo (ver \`CLAUDE.md\`) es que el cuello de botella es de fulfillment —
poder entregar y facturar licencias legítimamente — no de encontrar oportunidades ni de falta
de interés de oferentes.

## Motivos declarados de fracaso

### Desierta (${motivosDesierta.length} de ${desiertas} con motivo informado)

${motivosDesierta.length > 0 ? motivosDesierta.map((m) => `- ${m.trim()}`).join("\n") : "_Sin motivos informados en los casos detectados._"}

### Cancelada (${motivosCancelacion.length} de ${canceladas} con motivo informado)

${motivosCancelacion.length > 0 ? motivosCancelacion.map((m) => `- ${m.trim()}`).join("\n") : "_Sin motivos informados en los casos detectados._"}

## Organismos que reintentan (recompradores)

${
  recompradores.length > 0
    ? recompradores
        .map(
          (o) =>
            `### ${o.nombre} — ${o.procesos.length} procesos\n` +
            o.procesos
              .sort((a, b) => a.fechas.fecha_publicacion.localeCompare(b.fechas.fecha_publicacion))
              .map((p) => `- \`${p.codigo}\` (${p.fechas.fecha_publicacion}) — ${p.estado.glosa} — ${clp(p.montos.monto_disponible_clp)}`)
              .join("\n"),
        )
        .join("\n\n")
    : "_Sin organismos con más de un proceso detectado._"
}

## Oportunidades abiertas ahora mismo (${abiertas.length})

${
  abiertas.length > 0
    ? abiertas
        .map(
          (a) =>
            `- \`${a.codigo}\` — ${a.institucion.organismo_comprador} — ${a.nombre} — ` +
            `cierra ${a.fechas.fecha_cierre} — ${clp(a.montos.monto_disponible_clp)} — ` +
            `${a.convocatoria.descripcion} — ${competenciaReal.get(a.codigo) ?? a.resumen.total_ofertas_recibidas} oferta(s) recibida(s)`,
        )
        .join("\n")
    : "_Ninguna en el momento de esta corrida._"
}

## Metodología y limitaciones

- Búsqueda por las variantes de \`config/marcas.json\` (${marcas.variantes.map((v) => `\`${v}\``).join(", ")})
  contra los 4 estados de Compra Ágil (\`publicada\`, \`desierta\`, \`cancelada\`, \`cerrada\`),
  verificando localmente que \`nombre\` mencione la marca de verdad (descarta ruido de \`q\`).
- \`total_ofertas_recibidas\` en el listado es preliminar; el detalle de cada proceso da el
  número real (ver \`compra-agil-radar-claude\`). Este informe usa el valor del listado para no
  gastar cuota de API en un barrido histórico completo.
- \`q\` no busca dentro de adjuntos: una compra que solo mencione Claude en un PDF adjunto no
  aparece acá.
`;

  const outputDir = path.join(ROOT_DIR, "output");
  mkdirSync(outputDir, { recursive: true });
  const outPath = path.join(outputDir, "informe-nicho-claude.md");
  writeFileSync(outPath, md, "utf-8");
  console.log(`\nInforme escrito en ${outPath}`);
}

main().catch((err) => {
  console.error("Informe falló:", err);
  process.exitCode = 1;
});
