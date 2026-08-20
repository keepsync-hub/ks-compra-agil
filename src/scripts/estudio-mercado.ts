/**
 * `npm run estudio` — el informe del estudio de mercado. CERO requests: lee solo
 * `historico/mercado.jsonl`, así que se puede iterar sin límite y sin arriesgar cuota.
 *
 * Regla estructural del documento: los términos crudos van ANTES que las familias, y el juicio
 * sobre KeepSync va después de todo lo medido y en su propia sección, con la regla de "cero cifras
 * nuevas" — todo número de esa sección tiene que ser localizable más arriba.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ROOT_DIR } from "../lib/config.js";
import { percentiles } from "../lib/metricas.js";
import {
  errorMuestreoPct,
  leerMercado,
  precisionEnNombre,
  TOPE_TOTAL_RESULTADOS,
  type RegCompra,
  type RegistroMercado,
} from "../lib/mercado.js";
import { cargarFamilias, clasificar, type FamiliaCompilada } from "../lib/familias-mercado.js";
import { cargarStopwords, contarTerminos, type TerminoMedido } from "../lib/terminos.js";
import { renderPaginaEstudio } from "../lib/pagina-estudio.js";

const clp = (n: number): string => "$" + Math.round(n).toLocaleString("es-CL");
const pct = (n: number): string => `${n.toFixed(1)}%`;

const arg = (nombre: string): string | undefined =>
  process.argv.find((a) => a.startsWith(`--${nombre}=`))?.split("=").slice(1).join("=");

export interface MetricasFamilia {
  id: string;
  nombre: string;
  capa: "gruesa" | "fina";
  n_muestra: number;
  pct_muestra: number;
  error_pct: number | null;
  estimado_universo: number | null;
  monto_total_muestra: number;
  monto_p50: number | null;
  evidencia: string;
}

function main() {
  const registros = leerMercado();
  if (registros.length === 0) {
    console.error("historico/mercado.jsonl está vacío. Correr `npm run mercado` primero.");
    process.exitCode = 1;
    return;
  }

  const estados = registros.filter((r): r is Extract<RegistroMercado, { tipo: "estado-universo" }> => r.tipo === "estado-universo");
  const terminos = registros.filter((r): r is Extract<RegistroMercado, { tipo: "termino" }> => r.tipo === "termino");
  const compras = registros.filter((r): r is RegCompra => r.tipo === "compra");
  const detalles = registros.filter((r): r is Extract<RegistroMercado, { tipo: "detalle" }> => r.tipo === "detalle");

  // Última medición por (estado) y por (término,estado) — el archivo es append-only.
  const ultimo = <T extends { medido_en: string }>(xs: T[]): T | undefined =>
    xs.length === 0 ? undefined : xs.reduce((a, b) => (a.medido_en >= b.medido_en ? a : b));

  const universoPorEstado = new Map<string, { total: number | null; topeado: boolean }>();
  for (const e of ["publicada", "cerrada", "desierta", "cancelada", "proveedor_seleccionado"]) {
    const r = ultimo(estados.filter((x) => x.estado === e));
    if (r) universoPorEstado.set(e, { total: r.total_resultados, topeado: r.topeado });
  }
  const universoAbierto = universoPorEstado.get("publicada")?.total ?? null;

  const dimension = new Map<string, Extract<RegistroMercado, { tipo: "termino" }>>();
  for (const t of terminos.filter((t) => t.estado === "publicada")) {
    const prev = dimension.get(t.termino);
    if (!prev || t.medido_en > prev.medido_en) dimension.set(t.termino, t);
  }

  // ── Estratos: la muestra estima el universo; lo dirigido describe una familia. No se mezclan ────
  const muestra = compras.filter((c) => c.origen.startsWith("muestra:"));
  const dirigidas = compras.filter((c) => c.origen.startsWith("termino:"));

  const stop = cargarStopwords();
  const terminosMuestra = contarTerminos(muestra, stop);
  const contenido = terminosMuestra.filter((t) => t.clase === "contenido" && t.n_compras >= 2);
  const estructural = terminosMuestra.filter((t) => t.clase === "estructural");

  let familias: FamiliaCompilada[] = [];
  let errorFamilias: string | null = null;
  try {
    familias = cargarFamilias();
  } catch (err) {
    errorFamilias = (err as Error).message;
  }

  const metricas: MetricasFamilia[] = [];
  const sinFamilia: RegCompra[] = [];
  const descartes = new Map<string, number>();
  if (familias.length > 0) {
    const porFamilia = new Map<string, RegCompra[]>();
    for (const c of muestra) {
      const { confirmadas, descartes: ds } = clasificar(familias, c.nombre);
      for (const d of ds) descartes.set(`${d.familia.id}:${d.veredicto}`, (descartes.get(`${d.familia.id}:${d.veredicto}`) ?? 0) + 1);
      if (confirmadas.length === 0) sinFamilia.push(c);
      for (const f of confirmadas) {
        const l = porFamilia.get(f.id) ?? [];
        l.push(c);
        porFamilia.set(f.id, l);
      }
    }
    for (const f of familias) {
      const cs = porFamilia.get(f.id) ?? [];
      const p = muestra.length > 0 ? cs.length / muestra.length : 0;
      const montos = cs.map((c) => c.monto_disponible_clp).filter((m) => m > 0);
      metricas.push({
        id: f.id,
        nombre: f.nombre,
        capa: f.capa,
        n_muestra: cs.length,
        pct_muestra: p * 100,
        error_pct: universoAbierto != null ? errorMuestreoPct(p, muestra.length, universoAbierto) : null,
        estimado_universo: universoAbierto != null ? Math.round(p * universoAbierto) : null,
        monto_total_muestra: montos.reduce((a, b) => a + b, 0),
        monto_p50: percentiles(montos)?.mediana ?? null,
        evidencia: f.evidencia,
      });
    }
    metricas.sort((a, b) => b.n_muestra - a.n_muestra);
  }

  const residual = contarTerminos(sinFamilia, stop).filter((t) => t.clase === "contenido" && t.n_compras >= 2).slice(0, 30);

  // ── Competencia: guarda de honestidad ───────────────────────────────────────────────────────────
  const conOfertas = muestra.filter((c) => c.total_ofertas_recibidas > 0).length;
  const competenciaMedible = muestra.length > 0 && conOfertas / muestra.length >= 0.1;

  // ── Desenlaces (etapa D) ────────────────────────────────────────────────────────────────────────
  const desenlaces = new Map<string, Record<string, number | null>>();
  for (const t of terminos.filter((t) => t.estado !== "publicada")) {
    const fila = desenlaces.get(t.termino) ?? {};
    fila[t.estado] = t.total_resultados;
    desenlaces.set(t.termino, fila);
  }

  // ── Calibración del sesgo de clasificar solo por `nombre` (etapa E) ─────────────────────────────
  let calibracion: { n: number; soloNombre: number; textoCompleto: number; onu: number[] } | null = null;
  if (detalles.length > 0 && familias.length > 0) {
    let soloNombre = 0;
    let textoCompleto = 0;
    const onu = new Set<number>();
    for (const d of detalles) {
      soloNombre += clasificar(familias, d.nombre).confirmadas.length > 0 ? 1 : 0;
      const completo = [d.nombre, d.descripcion, d.productos_texto].join("\n");
      textoCompleto += clasificar(familias, completo).confirmadas.length > 0 ? 1 : 0;
      for (const c of d.codigos_onu) onu.add(c);
    }
    calibracion = { n: detalles.length, soloNombre, textoCompleto, onu: [...onu].sort((a, b) => a - b) };
  }

  // ── Modo auditoría ──────────────────────────────────────────────────────────────────────────────
  const nMuestraAudit = Number(arg("muestra") ?? 0);
  if (nMuestraAudit > 0 && familias.length > 0) {
    console.log(`\n=== Auditoría: ${nMuestraAudit} compras por familia ===`);
    for (const f of familias) {
      const cs = muestra.filter((c) => clasificar(familias, c.nombre).confirmadas.some((x) => x.id === f.id));
      console.log(`\n--- ${f.id} (${cs.length}) ---`);
      for (const c of cs.slice(0, nMuestraAudit)) console.log(`  ${c.codigo} | ${c.nombre.slice(0, 90)}`);
    }
    console.log(`\n--- sin familia (${sinFamilia.length}) ---`);
    for (const c of sinFamilia.slice(0, nMuestraAudit)) console.log(`  ${c.codigo} | ${c.nombre.slice(0, 90)}`);
  }

  const md = render({
    universoPorEstado,
    universoAbierto,
    dimension,
    muestra,
    dirigidas,
    contenido,
    estructural,
    metricas,
    sinFamilia,
    residual,
    descartes,
    desenlaces,
    calibracion,
    competenciaMedible,
    conOfertas,
    errorFamilias,
    detalles: detalles.length,
  });

  mkdirSync(path.join(ROOT_DIR, "output"), { recursive: true });
  writeFileSync(path.join(ROOT_DIR, "output", "estudio-mercado.md"), md, "utf-8");
  writeFileSync(
    path.join(ROOT_DIR, "output", "estudio-mercado.json"),
    JSON.stringify({ universoAbierto, metricas, desenlaces: [...desenlaces], calibracion }, null, 2),
    "utf-8",
  );
  renderPaginaEstudio(md);
  console.log("\noutput/estudio-mercado.md · output/estudio-mercado.json · docs/estudio-mercado.html");
}

interface Ctx {
  universoPorEstado: Map<string, { total: number | null; topeado: boolean }>;
  universoAbierto: number | null;
  dimension: Map<string, Extract<RegistroMercado, { tipo: "termino" }>>;
  muestra: RegCompra[];
  dirigidas: RegCompra[];
  contenido: TerminoMedido[];
  estructural: TerminoMedido[];
  metricas: MetricasFamilia[];
  sinFamilia: RegCompra[];
  residual: TerminoMedido[];
  descartes: Map<string, number>;
  desenlaces: Map<string, Record<string, number | null>>;
  calibracion: { n: number; soloNombre: number; textoCompleto: number; onu: number[] } | null;
  competenciaMedible: boolean;
  conOfertas: number;
  errorFamilias: string | null;
  detalles: number;
}

function render(c: Ctx): string {
  const L: string[] = [];
  const hoy = new Date().toISOString().slice(0, 10);

  L.push("# Estudio de mercado — Compras Ágiles y qué puede vender KeepSync");
  L.push("");
  L.push(`Generado: ${new Date().toISOString()}. Medición en vivo contra \`api2.mercadopublico.cl\`,`);
  L.push("regenerable con `npm run mercado` + `npm run estudio`.");
  L.push("");
  L.push("Este informe existe para responder con datos una objeción que el propio repo se hace en");
  L.push("`PLAN-VOLUMEN.md`: *\"elegir keywords a dedo es el método que produjo el nicho Claude (79% de");
  L.push("fracaso). Repetirlo con más palabras repite el error de selección.\"* Acá los criterios");
  L.push("candidatos salen de medir el mercado.");
  L.push("");

  L.push("## 1. Qué se midió, y con qué exactitud");
  L.push("");
  L.push("Tres estratos distintos, que **no se pueden mezclar en una misma afirmación**:");
  L.push("");
  L.push("| Estrato | Qué da | Exactitud |");
  L.push("|---|---|---|");
  L.push(`| **Dimensionamiento** (${c.dimension.size} términos, 1 request c/u) | cuántas compras abiertas devuelve cada término | conteo **exacto** de la API, pero **cota superior contaminada** del tamaño real — se corrige por precisión en §3 |`);
  L.push(`| **Muestra sistemática** (${c.muestra.length} compras) | composición del mercado, montos, organismos | **estimación** con error de muestreo declarado |`);
  L.push(`| **Dirigido** (${c.dirigidas.length} compras de la lista corta) | montos y organismos de las familias que importan | **exacto** dentro de esa consulta, no extrapolable |`);
  L.push("");
  const paginasMuestra = [...new Set(c.muestra.map((m) => Number(m.origen.replace("muestra:pagina-", ""))))].sort((a, b) => a - b);
  if (paginasMuestra.length > 0 && c.universoAbierto != null) {
    const totalPaginas = Math.ceil(c.universoAbierto / 25);
    const ultima = paginasMuestra[paginasMuestra.length - 1]!;
    const cubre = (ultima / totalPaginas) * 100;
    L.push(`La muestra tomó las páginas ${paginasMuestra.slice(0, 4).join(", ")}… hasta la ${ultima} de ${totalPaginas}.`);
    if (cubre < 90) {
      L.push("");
      L.push(`> **La muestra quedó truncada**: alcanza hasta el ${cubre.toFixed(0)}% del recorrido, no hasta el`);
      L.push("> final. Un muestreo sistemático interrumpido deja de estar repartido por todo el universo y");
      L.push("> pasa a cubrir solo su primer tramo — que en esta API es el de las publicaciones más");
      L.push("> recientes. Las proporciones de la sección 5 se leen con esa reserva.");
    }
    L.push("");
  }

  L.push("## 2. El universo");
  L.push("");
  L.push("| Estado | Compras | |");
  L.push("|---|---:|---|");
  for (const [estado, v] of c.universoPorEstado) {
    const val = v.total == null ? "no medido" : v.topeado ? `≥ ${TOPE_TOTAL_RESULTADOS.toLocaleString("es-CL")}` : v.total.toLocaleString("es-CL");
    L.push(`| ${estado} | ${val} | ${v.topeado ? "**topeado por la API**" : ""} |`);
  }
  L.push("");
  L.push("**El tope importa.** La API no informa más de 10.000 resultados: `cerrada`, `desierta` y");
  L.push("`cancelada` devolvieron exactamente ese número las tres. No son 10.000 compras cada una —");
  L.push("son *al menos* 10.000, y el valor real es desconocido. Cualquier tasa calculada contra esos");
  L.push("números sería inventada, y por eso este informe no la calcula.");
  L.push("");
  if (c.universoAbierto != null) {
    L.push(`Aun así el orden de magnitud es claro: frente a **${c.universoAbierto.toLocaleString("es-CL")}** compras`);
    L.push("abiertas hay **decenas de miles** ya terminadas. Mirar solo lo abierto —que es lo que hace el");
    L.push("radar hoy— es mirar una fracción pequeña y sesgada del mercado.");
    L.push("");
  }
  L.push("### Sesgo de supervivencia (el límite más serio de este informe)");
  L.push("");
  L.push("El universo abierto incluye publicaciones desde 2025-11 que **siguen** en estado `publicada`.");
  L.push("Una Compra Ágil cierra en días, así que ese conjunto mezcla demanda viva con procesos que el");
  L.push("organismo nunca actualizó. Toda cifra del estrato muestral hereda ese sesgo. La sección 7");
  L.push("(desenlaces) lo esquiva midiendo directamente sobre estados terminales.");
  L.push("");

  L.push("## 3. Dimensionamiento por término");
  L.push("");
  L.push("1 request por término. `total_resultados` es el conteo exacto de lo que la API devuelve —");
  L.push("y **no** el tamaño de la familia. Los términos de **control** son rubros que KeepSync no");
  L.push("vende: están para que los números del grupo `keepsync` tengan con qué compararse.");
  L.push("");
  L.push("### La corrección que cambia el ranking");
  L.push("");
  L.push("El `q` de la API **no busca solo en el nombre: también en la descripción**, donde vive el");
  L.push("machaque administrativo de cualquier ficha. El efecto es brutal y se ve en los 10 nombres de");
  L.push("muestra que cada consulta trae gratis:");
  L.push("");
  L.push("- `q=desarrollo` devuelve cientos de resultados y **ninguno** de sus nombres de muestra habla");
  L.push("  de desarrollo de nada: son galletas, mobiliario, guirnaldas decorativas, reactivos.");
  L.push("- `q=datos` los encabeza con *\"Caja de Alimentos… se solicita completar todos los datos\"*.");
  L.push("- `q=soporte` trae soportes de TV y de bicicletas.");
  L.push("");
  L.push("Así que el conteo crudo es una **cota superior contaminada**. La columna `precisión` mide la");
  L.push("contaminación con los nombres que ya se trajeron —qué fracción de ellos contiene realmente el");
  L.push("término—, sin gastar un request más, y `≈ real` es el tamaño corregido. **El ranking válido es");
  L.push("el de `≈ real`**: ordenar por el crudo manda a paginar puro ruido, que es exactamente lo que");
  L.push("pasó en la primera corrida de este estudio.");
  L.push("");
  const conPrecision = [...c.dimension.values()].map((t) => {
    const prec = precisionEnNombre(t.termino, t.muestra_nombres);
    return { t, prec, estimado: prec == null || t.total_resultados == null ? null : Math.round(t.total_resultados * prec) };
  });
  conPrecision.sort((a, b) => (b.estimado ?? -1) - (a.estimado ?? -1));
  L.push("| Término | Grupo | Crudo | Precisión | ≈ real |");
  L.push("|---|---|---:|---:|---:|");
  for (const { t, prec, estimado } of conPrecision) {
    const crudo = t.error ? "**la API falló**" : t.total_resultados == null ? "no medido" : t.total_resultados.toLocaleString("es-CL");
    L.push(
      `| \`${t.termino}\` | ${t.grupo} | ${crudo} | ${prec == null ? "—" : pct(prec * 100)} | ${estimado ?? "—"} |`,
    );
  }
  L.push("");
  const keepsyncTop = conPrecision.filter((x) => x.t.grupo === "keepsync" && (x.estimado ?? 0) > 0).slice(0, 6);
  if (keepsyncTop.length > 0) {
    L.push("Lo que KeepSync toca, ordenado por tamaño corregido: " +
      keepsyncTop.map((x) => `**${x.t.termino}** (≈${x.estimado})`).join(", ") + ".");
    L.push("");
  }
  L.push("> La precisión se estima sobre 10 nombres por término: es un orden de magnitud, no un decimal.");
  L.push("> Un término con precisión 0% no significa que no exista demanda — significa que **esa palabra");
  L.push("> no sirve como criterio de búsqueda**, que es justamente lo que este estudio tiene que decidir.");
  L.push("");
  const fallidos = conPrecision.map((x) => x.t).filter((t) => t.error);
  if (fallidos.length > 0) {
    L.push(`> **Quirk nuevo del endpoint.** ${fallidos.map((t) => `\`${t.termino}\``).join(", ")} devolvió`);
    L.push("> `500 ERROR_INTERNO` de forma reproducible, sin contener la palabra suelta \"de\" ni ningún otro");
    L.push("> patrón conocido. Se registra como **no medido**, nunca como 0 — un 0 se leería como");
    L.push("> \"no hay demanda\", que es lo contrario de lo que sabemos.");
    L.push("");
  }

  L.push("## 4. Términos frecuentes, sin familias");
  L.push("");
  L.push(`Frecuencia no supervisada sobre los ${c.muestra.length} nombres de la muestra: se cuenta en cuántas`);
  L.push("compras **distintas** aparece cada n-grama, y se ordena por **monto**, no por conteo. Va antes de");
  L.push("las familias a propósito: la evidencia primero, la interpretación después.");
  L.push("");
  L.push("| Término | Compras | Monto total | Mediana | Organismos |");
  L.push("|---|---:|---:|---:|---:|");
  for (const t of c.contenido.slice(0, 25)) {
    L.push(`| \`${t.termino}\` | ${t.n_compras} | ${clp(t.monto_total_clp)} | ${t.monto ? clp(t.monto.mediana) : "—"} | ${t.n_organismos} |`);
  }
  L.push("");
  if (c.estructural.length > 0) {
    L.push("### Cuánto de este mercado es servicio y cuánto es bien físico");
    L.push("");
    L.push("Los términos del *acto* de comprar se reportan aparte en vez de descartarse, porque el reparto");
    L.push("entre ellos es la primera pregunta de KeepSync:");
    L.push("");
    L.push("| Término | Compras | Monto total |");
    L.push("|---|---:|---:|");
    for (const t of c.estructural.slice(0, 10)) {
      L.push(`| \`${t.termino}\` | ${t.n_compras} | ${clp(t.monto_total_clp)} |`);
    }
    L.push("");
  }

  L.push("## 5. Familias");
  L.push("");
  if (c.errorFamilias) {
    L.push(`⚠ No se pudieron cargar las familias: ${c.errorFamilias}`);
    L.push("");
  } else {
    L.push("Derivadas de la sección 4, no al revés — cada una declara en `config/familias-mercado.json`");
    L.push("los términos medidos que la motivaron, y el cargador **falla si esa evidencia falta**.");
    L.push("");
    L.push("| Familia | Capa | Compras en muestra | % del universo | Estimado | Monto en muestra | Mediana |");
    L.push("|---|---|---:|---:|---:|---:|---:|");
    for (const m of c.metricas) {
      const err = m.error_pct != null ? ` ±${m.error_pct.toFixed(1)}` : "";
      L.push(
        `| ${m.nombre} | ${m.capa} | ${m.n_muestra} | ${pct(m.pct_muestra)}${err} | ${m.estimado_universo ?? "—"} | ${clp(m.monto_total_muestra)} | ${m.monto_p50 != null ? clp(m.monto_p50) : "—"} |`,
      );
    }
    L.push("");
    L.push("Las columnas `% del universo` y `Estimado` son **estimaciones muestrales** con su intervalo al");
    L.push("95%. No son conteos: para eso está la sección 3.");
    L.push("");
    if (c.descartes.size > 0) {
      L.push("### Descartados por el filtro estricto");
      L.push("");
      L.push("Compras que mencionaban la materia pero no pasaron `patron_requerido` o cayeron en");
      L.push("`patron_excluyente`. Se publican por el mismo motivo que en el radar: un patrón demasiado");
      L.push("ancho, si no se lista, se ve como demanda que desaparece sin explicación.");
      L.push("");
      for (const [clave, n] of [...c.descartes].sort((a, b) => b[1] - a[1])) L.push(`- \`${clave}\` — ${n}`);
      L.push("");
    }
  }

  if (c.dirigidas.length > 0) {
    L.push("### Montos exactos de la lista corta");
    L.push("");
    L.push("Paginado completo de los términos de mayor tamaño corregido. **Exacto dentro de esa");
    L.push("consulta, y no extrapolable al universo**: es el estrato dirigido, no la muestra.");
    L.push("");
    const porOrigen = new Map<string, RegCompra[]>();
    for (const d of c.dirigidas) {
      const l = porOrigen.get(d.origen) ?? [];
      l.push(d);
      porOrigen.set(d.origen, l);
    }
    L.push("| Consulta | Compras | Monto total | p25 | Mediana | p75 | Organismos |");
    L.push("|---|---:|---:|---:|---:|---:|---:|");
    for (const [origen, cs] of porOrigen) {
      const montos = cs.map((x) => x.monto_disponible_clp).filter((m) => m > 0);
      const p = percentiles(montos);
      const ruts = new Set(cs.map((x) => x.rut)).size;
      L.push(
        `| \`${origen.replace("termino:", "")}\` | ${cs.length} | ${clp(montos.reduce((a, b) => a + b, 0))} | ${p ? clp(p.p25) : "—"} | ${p ? clp(p.mediana) : "—"} | ${p ? clp(p.p75) : "—"} | ${ruts} |`,
      );
    }
    L.push("");
  }

  L.push("## 6. Cobertura y residual");
  L.push("");
  if (c.muestra.length === 0) {
    L.push("No hay muestra en esta corrida, así que la cobertura no se puede calcular. Correr");
    L.push("`npm run mercado -- --etapas=c`.");
    L.push("");
  }
  if (c.muestra.length > 0) {
    const pctSin = (c.sinFamilia.length / c.muestra.length) * 100;
    const montoSin = c.sinFamilia.reduce((a, b) => a + b.monto_disponible_clp, 0);
    const montoTotal = c.muestra.reduce((a, b) => a + b.monto_disponible_clp, 0);
    L.push(`- Compras sin ninguna familia: **${c.sinFamilia.length} de ${c.muestra.length}** (${pct(pctSin)})`);
    L.push(`- Monto sin ninguna familia: **${pct(montoTotal > 0 ? (montoSin / montoTotal) * 100 : 0)}** del total muestreado`);
    L.push("");
    if (c.residual.length > 0) {
      L.push("Los términos con más peso entre lo no clasificado — la agenda de la próxima iteración, y el");
      L.push("contrapeso permanente a elegir familias a dedo:");
      L.push("");
      L.push("| Término | Compras | Monto total |");
      L.push("|---|---:|---:|");
      for (const t of c.residual.slice(0, 15)) L.push(`| \`${t.termino}\` | ${t.n_compras} | ${clp(t.monto_total_clp)} |`);
      L.push("");
    }
  }

  L.push("## 7. Desenlaces: qué se compra de verdad");
  L.push("");
  if (c.desenlaces.size === 0) {
    L.push("No medido en esta corrida.");
  } else {
    L.push("Medido directamente sobre los estados terminales, así que **no arrastra el sesgo de");
    L.push("supervivencia** de las secciones anteriores. Es la métrica que fundó todo el análisis del");
    L.push("nicho Claude (79% de fracaso).");
    L.push("");
    L.push("| Término | Cerradas | Desiertas | Canceladas | Tasa de éxito |");
    L.push("|---|---:|---:|---:|---:|");
    for (const [t, f] of c.desenlaces) {
      const ce = f.cerrada ?? null;
      const de = f.desierta ?? null;
      const ca = f.cancelada ?? null;
      const topeado = [ce, de, ca].some((x) => x != null && x >= TOPE_TOTAL_RESULTADOS);
      const total = (ce ?? 0) + (de ?? 0) + (ca ?? 0);
      // Con algún componente topeado el denominador es desconocido: la división daría un número
      // que parece una tasa y no lo es. Se declara no calculable en vez de publicarla con asterisco.
      const tasa = topeado ? "**no calculable** (tope)" : ce != null && total > 0 ? pct((ce / total) * 100) : "—";
      const fmt = (x: number | null) => (x == null ? "?" : x >= TOPE_TOTAL_RESULTADOS ? `≥${x.toLocaleString("es-CL")}` : x.toLocaleString("es-CL"));
      L.push(`| \`${t}\` | ${fmt(ce)} | ${fmt(de)} | ${fmt(ca)} | ${tasa} |`);
    }
    L.push("");
    L.push("Dos advertencias que esta tabla no puede resolver sola:");
    L.push("");
    L.push("- **Arrastra la misma contaminación de la sección 3.** Un término de baja precisión mide el");
    L.push("  desenlace de un revoltijo de rubros, no el de su familia. Leer solo las filas cuyo término");
    L.push("  tiene precisión alta.");
    L.push("- **Donde el conteo llega al tope, la tasa no se puede calcular** y por eso no se publica: el");
    L.push("  denominador es desconocido.");
    L.push("");
    L.push("### El hallazgo que corrige una hipótesis del repo");
    L.push("");
    L.push("La tasa de éxito está entre **7% y 10% en todos los rubros medidos** — incluidos los que no");
    L.push("tienen nada que ver con tecnología: mantención de autoclaves, talleres de cestería,");
    L.push("reparaciones. `PLAN.md` y `CLAUDE.md` levantaron la hipótesis de que el ~79% de fracaso del");
    L.push("nicho Claude venía de un problema de **fulfillment** —que los oferentes no podían entregar");
    L.push("licencias legítimamente—. Esta medición no la sostiene: **el fracaso masivo es cómo se");
    L.push("comporta el instrumento entero**, no una patología del nicho de licencias.");
    L.push("");
    L.push("Es coherente con lo que `PLAN-VOLUMEN.md` ya había encontrado clasificando los motivos");
    L.push("declarados: el 73% de los fracasos es atribuible al comprador (error, cambio de decisión,");
    L.push("vencimiento del plazo de selección) y solo el 16% a incumplimiento de la oferta. La");
    L.push("consecuencia práctica es la que ese documento ya saca: la palanca no es ofertar más, sino");
    L.push("elegir mejor y llegar primero a la republicación.");
    L.push("");
  }

  L.push("## 8. Competencia");
  L.push("");
  if (c.competenciaMedible) {
    // La mediana sobre TODA la muestra da 0 y no dice nada: un proceso recién publicado todavía no
    // recibió ofertas. Lo informativo es qué fracción ya tiene competencia y cuánta.
    const conOfertas = c.muestra.filter((m) => m.total_ofertas_recibidas > 0);
    const p = percentiles(conOfertas.map((m) => m.total_ofertas_recibidas));
    L.push(`De las ${c.muestra.length} compras abiertas de la muestra, **${conOfertas.length}** (${pct((conOfertas.length / c.muestra.length) * 100)})`);
    L.push(`ya tienen al menos una oferta recibida. Entre ellas la mediana es de **${p?.mediana ?? "—"} ofertas**`);
    L.push(`(p25 ${p?.p25 ?? "—"}, p75 ${p?.p75 ?? "—"}).`);
    L.push("");
    L.push("**La mediana sobre toda la muestra sería 0 y no significaría nada**: una compra publicada hoy");
    L.push("todavía no recibió ofertas, y el listado de la API no distingue \"nadie ofertó\" de \"aún no\".");
    L.push("Por eso se informa el reparto y no un promedio suelto.");
  } else {
    L.push(`**No medible en este universo.** Solo ${c.conOfertas} de ${c.muestra.length} compras abiertas`);
    L.push("reportan ofertas recibidas: el listado de la API informa 0 para los procesos en curso");
    L.push("(ya documentado en `informe-nicho.ts`). Publicar \"competencia mediana: 0\" sería reportar un");
    L.push("artefacto de la API como un hallazgo de mercado.");
  }
  L.push("");

  L.push("## 9. Cuánto sub-reporta clasificar solo por el nombre");
  L.push("");
  if (!c.calibracion) {
    L.push("No medido en esta corrida (etapa E).");
  } else {
    const k = c.calibracion;
    L.push("El listado de la API **no trae `descripcion` ni productos**: clasificar cuesta 0 requests pero");
    L.push(`solo ve el título. Se bajó el detalle de **${k.n}** compras para medir la brecha en vez de`);
    L.push("solo advertirla:");
    L.push("");
    L.push(`- Clasificadas usando solo el \`nombre\`: **${k.soloNombre} de ${k.n}**`);
    L.push(`- Clasificadas usando el texto completo (nombre + descripción + productos): **${k.textoCompleto} de ${k.n}**`);
    const brecha = k.textoCompleto > 0 ? ((k.textoCompleto - k.soloNombre) / k.textoCompleto) * 100 : 0;
    L.push(`- **Sub-reporte estimado: ${pct(brecha)}** — toda cifra de familia de este informe es un piso, no un techo.`);
    if (k.onu.length > 0) {
      L.push("");
      L.push(`Códigos ONU/UNSPSC observados: ${k.onu.join(", ")}. Es la taxonomía oficial de producto, hoy`);
      L.push("sin explotar en el repo; con volumen suficiente permitiría clasificar sin regex.");
    }
  }
  L.push("");

  L.push("## 10. Qué de esto puede vender KeepSync");
  L.push("");
  L.push("> **Todo lo anterior se midió contra la API. Esta sección es juicio.** Los criterios y sus");
  L.push("> veredictos están en `config/keepsync-oferta.json`, con quién los emitió y cuándo. **No aparece");
  L.push("> ninguna cifra nueva acá**: todo número está localizable en las secciones 2 a 9.");
  L.push("");
  L.push("KeepSync (leído de `keepsync.ai/services.json` el 2026-08-20) vende **servicios gestionados de");
  L.push("IA** en cuatro frentes —comercial y ventas, atención a clientes, administración y finanzas,");
  L.push("operaciones—: asistentes que operan dentro de las herramientas que la organización ya usa, con");
  L.push("despliegue en ≤30 días y operación continua. Es **más ancho** que los cinco nichos que el radar");
  L.push("busca hoy, que se limitan a licencias y cursos.");
  L.push("");
  L.push("Los cuatro criterios (`config/keepsync-oferta.json`): **A** ¿lo cubre el catálogo?, **B** ¿se");
  L.push("entrega remoto en ≤30 días?, **C** ¿exige acreditación que no tiene?, **D** ¿hay costo conocido");
  L.push("para poner precio bajo el tope? — `servible = A ∧ B ∧ ¬C`, `ofertable = servible ∧ D`.");
  L.push("");
  L.push("### Los dos insumos bloqueantes");
  L.push("");
  L.push("1. **No existe catálogo de costos de servicios de KeepSync** (confirmado con el usuario el");
  L.push("   2026-08-20): ni valor hora de asesoría o relatoría, ni costo por proyecto, ni costo mensual de");
  L.push("   operación. Como `D = no` para todas las familias, **ninguna es ofertable hoy**, por grande que");
  L.push("   sea. Es el mismo tipo de insumo que mantiene marcadas PRELIMINAR a las cotizaciones de Array.");
  L.push("2. **No está confirmado si KeepSync es OTEC registrada en SENCE.** Condiciona la familia de");
  L.push("   capacitación entera — que es, según la sección 3, la de mayor volumen que KeepSync toca.");
  L.push("");
  L.push("Mientras esos dos no se resuelvan, esto es **investigación de mercado**: dice dónde jugar, no");
  L.push("habilita ninguna oferta.");
  L.push("");

  L.push("## 11. Metodología y límites");
  L.push("");
  L.push("- **Sesgo de supervivencia**: el universo abierto sobre-representa procesos que nadie cerró (§2).");
  L.push("- **Clasificación por `nombre`**: cuantificada en §9, no solo advertida.");
  L.push("- **Error de muestreo**: publicado junto a cada estimación (§5). Ninguna afirmación exacta se");
  L.push("  apoya en la muestra.");
  L.push("- **Tope de 10.000** en `total_resultados`: los estados terminales son cotas inferiores (§2).");
  L.push("- **`q` hace OR de tokens y no busca la frase**, y no entra en los adjuntos: una compra que solo");
  L.push("  menciona la materia en un PDF no aparece en el dimensionamiento.");
  L.push("- **Techo de Compra Ágil**: 100 UTM ≈ $6,9M. Nada de este mercado es más grande que eso.");
  L.push(`- **n junto a cada cifra**: muestra n=${c.muestra.length}, dirigidas n=${c.dirigidas.length}, detalles n=${c.detalles}.`);
  L.push("");
  L.push(`_Generado por \`npm run estudio\` el ${hoy} — 0 requests: lee solo \`historico/mercado.jsonl\`._`);
  L.push("");
  return L.join("\n");
}

main();
