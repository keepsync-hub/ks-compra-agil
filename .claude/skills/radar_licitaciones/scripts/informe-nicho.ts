import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { LIC_ROOT_DIR, loadKeywordsConfig } from "../../../../licitaciones/src/lib/config.js";
import { buscarLicitaciones, type LicitacionListItem, type EstadoLicitacion } from "../../../../licitaciones/src/lib/api.js";
import { itemMencionaKeyword } from "../../../../licitaciones/src/lib/keywords.js";

// A diferencia de Compra Ágil (8 queries de marca × 4 estados = ~32 llamadas acotadas), acá no
// hay `q`: cada estado devuelve TODAS las licitaciones de Chile en ese estado, sin filtro de
// texto en el servidor. Barrer varios estados históricos puede ser un volumen enorme y no se ha
// probado contra la API real (ver PLAN.md, "Insumos bloqueantes"). Se acota a los estados
// terminales más relevantes y se declara con honestidad si algo falla o se ve sospechosamente
// grande — no se inventa un resultado si la llamada no es viable en la práctica.
const ESTADOS: EstadoLicitacion[] = ["cerrada", "desierta", "adjudicada"];
const AVISO_VOLUMEN_SOSPECHOSO = 5000; // si un solo estado trae más que esto, probablemente no se puede filtrar así

function clp(n: number): string {
  return "$" + Math.round(n).toLocaleString("es-CL");
}

async function main() {
  const keywords = loadKeywordsConfig();
  const encontrados = new Map<string, LicitacionListItem>();
  const fallos: { estado: string; error: string }[] = [];

  console.log(
    `Barriendo histórico de licitaciones (${ESTADOS.join(", ")}), filtrando localmente por: ` +
      `${keywords.variantes.join(", ")}.\n` +
      `⚠ Sin verificar contra la API real en esta sesión — ver licitaciones/PLAN.md.\n`,
  );

  for (const estado of ESTADOS) {
    try {
      const items = await buscarLicitaciones({ estado });
      if (items.length > AVISO_VOLUMEN_SOSPECHOSO) {
        console.warn(
          `  estado=${estado}: ${items.length} licitaciones — volumen muy alto para filtrar solo localmente. ` +
            `Esto sugiere que hace falta acotar por fecha además de estado (ver PLAN.md). Se continúa igual.`,
        );
      }
      for (const item of items) {
        if (itemMencionaKeyword(item) && !encontrados.has(item.CodigoExterno)) {
          encontrados.set(item.CodigoExterno, item);
        }
      }
      console.log(`  estado=${estado}: ${items.length} traídas, ${encontrados.size} acumuladas con mención de keyword hasta ahora.`);
    } catch (err) {
      const mensaje = (err as Error).message;
      console.warn(`  estado=${estado}: falló, se continúa sin él — ${mensaje}`);
      fallos.push({ estado, error: mensaje });
    }
  }

  if (fallos.length === ESTADOS.length) {
    console.error(
      `\nLos ${ESTADOS.length} estados consultados fallaron — no se pudo traer ningún dato de la API. ` +
        `No se escribe el informe (evita dejar un "0 casos" engañoso). Ver los errores arriba.`,
    );
    process.exitCode = 1;
    return;
  }

  const casos = [...encontrados.values()];
  console.log(`\n${casos.length} casos históricos con mención local de la palabra clave.`);

  const porEstado = new Map<string, LicitacionListItem[]>();
  for (const c of casos) {
    const clave = c.Estado ?? String(c.CodigoEstado ?? "desconocido");
    const lista = porEstado.get(clave) ?? [];
    lista.push(c);
    porEstado.set(clave, lista);
  }

  const montos = casos.map((c) => c.MontoEstimado ?? 0).filter((m) => m > 0);
  const montoTotal = montos.reduce((a, b) => a + b, 0);
  const montoMediano = montos.length
    ? [...montos].sort((a, b) => a - b)[Math.floor(montos.length / 2)]!
    : 0;

  const organismos = new Map<string, { nombre: string; procesos: LicitacionListItem[] }>();
  for (const c of casos) {
    const rut = c.Comprador?.RutUnidad ?? c.Comprador?.NombreOrganismo ?? "desconocido";
    const entry = organismos.get(rut) ?? { nombre: c.Comprador?.NombreOrganismo ?? "desconocido", procesos: [] };
    entry.procesos.push(c);
    organismos.set(rut, entry);
  }
  const recompradores = [...organismos.values()]
    .filter((o) => o.procesos.length > 1)
    .sort((a, b) => b.procesos.length - a.procesos.length);

  const md = `# Informe del nicho: Licitaciones de Gestión Documental / Digitalización de Procesos / Oficina de Partes

Generado: ${new Date().toISOString()}.

> ⚠ **Sin verificar contra la API real de producción.** No se dispuso de un
> \`LICITACIONES_API_TICKET\` válido durante la generación de este código (ver
> \`licitaciones/PLAN.md\`, sección "Insumos bloqueantes"). Los nombres de campo, los estados
> consultados (\`${ESTADOS.join(", ")}\`) y el volumen esperado son suposiciones basadas en
> documentación pública histórica de \`api.mercadopublico.cl\`, no en una medición real como sí lo
> es el informe equivalente de Compra Ágil (\`output/informe-nicho-claude.md\` en la raíz). Volver
> a correr \`npm run informe-licitaciones\` con un ticket real y revisar este informe con
> escepticismo antes de tomar decisiones sobre él.

## Tamaño (medición local, sin verificar)

- **${casos.length} casos** detectados con mención local de gestión documental / digitalización de
  procesos / oficina de partes, en los estados ${ESTADOS.join(", ")}.
- Monto mediano: **${clp(montoMediano)} CLP**; suma total de los ${montos.length} casos con monto
  informado: **${clp(montoTotal)} CLP**.

## Por estado

| Estado | Casos |
|---|---|
${[...porEstado.entries()].map(([estado, items]) => `| ${estado} | ${items.length} |`).join("\n") || "| _sin datos_ | 0 |"}

## Organismos que reintentan (recompradores)

${
  recompradores.length > 0
    ? recompradores
        .map(
          (o) =>
            `### ${o.nombre} — ${o.procesos.length} procesos\n` +
            o.procesos
              .map((p) => `- \`${p.CodigoExterno}\` — ${p.Estado ?? p.CodigoEstado ?? "?"} — ${clp(p.MontoEstimado ?? 0)}`)
              .join("\n"),
        )
        .join("\n\n")
    : "_Sin organismos con más de un proceso detectado._"
}

## Cobertura

${
  fallos.length > 0
    ? `⚠ ${fallos.length} de ${ESTADOS.length} estados fallaron y se omitieron:\n` +
      fallos.map((f) => `- \`${f.estado}\`: ${f.error}`).join("\n")
    : `Los ${ESTADOS.length} estados consultados respondieron correctamente.`
}

## Metodología y limitaciones

- Esta API no soporta búsqueda por texto (a diferencia de Compra Ágil): se trajo el listado
  completo de cada estado y se filtró localmente por las variantes de \`config/keywords.json\`
  (${keywords.variantes.map((v) => `\`${v}\``).join(", ")}) sobre \`Nombre\`/\`Descripcion\`.
- Solo se consultaron los estados ${ESTADOS.join(", ")} — no se incluyó \`revocada\` ni
  \`suspendida\` para acotar el volumen de la corrida. \`activas\` (oportunidades abiertas) se
  cubre en \`npm run radar-licitaciones\`, no acá.
- Sin acotar por fecha, un estado con volumen país completo puede ser demasiado grande para barrer
  de forma confiable en una sola corrida — ver la advertencia de volumen en la consola si aplica.
`;

  const outputDir = path.join(LIC_ROOT_DIR, "output");
  mkdirSync(outputDir, { recursive: true });
  const outPath = path.join(outputDir, "informe-nicho-gestion-documental.md");
  writeFileSync(outPath, md, "utf-8");
  console.log(`\nInforme escrito en ${outPath}`);
}

main().catch((err) => {
  console.error("Informe de licitaciones falló:", err);
  process.exitCode = 1;
});
