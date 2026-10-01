/**
 * `npm run estudio-fortinet` — ¿hay negocio vendiendo equipos Fortinet por Compra Ágil?
 *
 * Nació de una lista de stock de un mayorista (Adistec, 2026-10-01): FortiGate 40F→200G,
 * FortiSwitch 124F/124G/148F/1024E, FortiAP 231K/441K, transceptores FN-TRAN y un contrato FortiCare.
 * La pregunta es si el Estado compra eso por Compra Ágil, cuánto, a qué tope y con qué desenlace,
 * en 2025 y 2026.
 *
 * La API no filtra por fecha (`output/diagnostico-api.md`: `fecha_desde` → 400), así que se pagina
 * entero cada `q` y el corte 2025–2026 se hace local con `fecha_publicacion`.
 *
 *   Fase 1  listado   todas las páginas de cada (término × estado). Se guarda en
 *                     `historico/fortinet-listado.json` porque `data/` es efímero.
 *   Fase 2  detalle   1 request por compra relevante (Fortinet primero, después firewall genérico):
 *                     el listado no trae descripción ni productos, y el modelo vive ahí.
 *   Fase 3  informe   `output/estudio-fortinet.md`, 0 requests. `--solo-informe` corre solo esta.
 *
 * Éxito = estado `cerrada`. `proveedor_seleccionado` devuelve 0 siempre en esta API, para cualquier
 * `q` y también sin `q` (medido de nuevo el 2026-10-01; ver `PLAN-VOLUMEN.md` §4), así que es el
 * mismo criterio que usa `src/lib/kompu.ts`.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ROOT_DIR } from "../lib/config.js";
import {
  buscarCompraAgilPagina,
  obtenerDetalleCompraAgil,
  CuotaApiAgotadaError,
  type CompraAgilDetalle,
  type CompraAgilListItem,
  type EstadoCompraAgil,
} from "../lib/api.js";
import { configurarCuota, CuotaLocalAgotadaError, ledgerHoy } from "../lib/cuota.js";

const LISTADO_PATH = path.join(ROOT_DIR, "historico", "fortinet-listado.json");
const DETALLES_PATH = path.join(ROOT_DIR, "historico", "fortinet-detalles.json");
const INFORME_PATH = path.join(ROOT_DIR, "output", "estudio-fortinet.md");

const ARGS = process.argv.slice(2);
const SOLO_INFORME = ARGS.includes("--solo-informe");
const opcion = (n: string) => ARGS.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const PRESUPUESTO = Number(opcion("presupuesto") ?? 200);
const MAX_DETALLES = Number(opcion("max-detalles") ?? 90);

/**
 * Términos de búsqueda. Todos de un solo token: el `q` OR-ea tokens (medido en Kompu).
 * `utm` quedó fuera a propósito: medido 4.900+ resultados porque «UTM» es la unidad tributaria que
 * todo TDR menciona para multas y topes, no el firewall.
 */
const TERMINOS = [
  "fortinet", "fortigate", "fortiswitch", "fortiap", "forticare", "fortianalyzer", "fortitoken",
  "firewall", "cortafuego", "sfp", "switch", "wifi",
];
const ESTADOS: EstadoCompraAgil[] = ["publicada", "cerrada", "desierta", "cancelada"];
const TAMANO = 25;

// ── Clasificación ────────────────────────────────────────────────────────────────────────────────

/** Mención de la marca o de un SKU de la lista (FG-60F, FS-124F, FAP-231K, FN-TRAN…). */
const RE_FORTINET =
  /\bforti(?:net|gate|switch|ap|care|analyzer|token|client|manager|wifi|guard|edr|mail|web|sandbox)\b|\bf(?:g|gt|s|ap|n)-?\d{2,4}[a-z]\b|\bfn-tran/i;

export type Familia = "firewall" | "switch" | "access_point" | "transceptor" | "licencia_soporte" | "otro";

const FAMILIAS: [Familia, RegExp][] = [
  ["licencia_soporte", /\blicencia|forticare|renovaci[oó]n|suscripci[oó]n|soporte\b|\butp\b|\butm bundle/i],
  ["firewall", /firewall|cortafuego|fortigate|\bfgt?-?\d|seguridad perimetral|\bngfw\b/i],
  ["switch", /\bswitch(?:es)?\b|fortiswitch|\bfs-?\d|conmutador/i],
  ["access_point", /access ?point|punto(?:s)? de acceso|fortiap|\bfap-?\d|\bap\b|antena wi-?fi/i],
  ["transceptor", /\bsfp|transceiver|transceptor|gbic|qsfp|fn-tran|m[oó]dulo [oó]ptico/i],
];

/**
 * Ruido medido en los nombres: «switch» trae consolas Nintendo y switches de transferencia
 * eléctrica, «wifi» trae televisores, cámaras y hornos con conectividad. Se excluye por nombre y
 * cada término cita un caso visto en el listado.
 */
const RE_RUIDO =
  /nintendo|consola|joy-?con|transferencia autom|televisor|smart ?tv|\btv\b|c[aá]mara|parlante|impresora|proyector|tablet|notebook|celular|smartphone|reloj|horno|refrigerador|aspiradora|robot|enchufe|ampolleta|kvm|hdmi/i;

function familiaDe(texto: string): Familia {
  for (const [f, re] of FAMILIAS) if (re.test(texto)) return f;
  return "otro";
}

const MARCAS: [string, RegExp][] = [
  ["Fortinet", /forti(?:net|gate|switch|ap|care|analyzer)/i],
  ["Cisco / Meraki", /\bcisco\b|meraki/i],
  ["Sophos", /sophos/i],
  ["Palo Alto", /palo ?alto/i],
  ["Check Point", /check ?point/i],
  ["SonicWall", /sonic ?wall/i],
  ["WatchGuard", /watch ?guard/i],
  ["Ubiquiti / UniFi", /ubiquiti|unifi/i],
  ["MikroTik", /mikrotik/i],
  ["TP-Link / Omada", /tp-?link|omada/i],
  ["Aruba / HPE", /\baruba\b|\bhpe\b/i],
  ["Huawei", /huawei/i],
  ["Ruckus", /ruckus/i],
  ["D-Link", /d-?link/i],
];

// ── Fase 1 y 2 ───────────────────────────────────────────────────────────────────────────────────

interface Listado {
  medido_en: string;
  /** `${termino}|${estado}` → total_resultados de la API (sin corte de fecha). */
  totales: Record<string, number | null>;
  /** código → ítem (último visto) + términos que lo trajeron. */
  items: Record<string, { item: CompraAgilListItem; terminos: string[] }>;
  incompleto: string[];
}

const leerJson = <T>(p: string, def: T): T => (existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as T) : def);
const guardarJson = (p: string, v: unknown) => {
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(v, null, 1) + "\n");
};

async function barrer(): Promise<Listado> {
  const l: Listado = { medido_en: new Date().toISOString(), totales: {}, items: {}, incompleto: [] };
  let cortado = false;
  for (const q of TERMINOS) {
    for (const estado of ESTADOS) {
      const clave = `${q}|${estado}`;
      if (cortado) { l.incompleto.push(clave); continue; }
      try {
        for (let pagina = 1; ; pagina++) {
          const p = await buscarCompraAgilPagina({ q, estado, tamanoPagina: TAMANO, numeroPagina: pagina });
          if (pagina === 1) l.totales[clave] = p.paginacion?.total_resultados ?? null;
          for (const it of p.items) {
            const prev = l.items[it.codigo];
            l.items[it.codigo] = { item: it, terminos: [...new Set([...(prev?.terminos ?? []), q])] };
          }
          const total = p.paginacion?.total_paginas ?? 0;
          if (pagina >= total || p.items.length === 0) break;
        }
        console.log(`  ${clave}: ${l.totales[clave]}`);
      } catch (e) {
        if (e instanceof CuotaApiAgotadaError || e instanceof CuotaLocalAgotadaError) cortado = true;
        console.warn(`  ${clave}: ${(e as Error).message.slice(0, 140)}`);
        l.incompleto.push(clave);
      }
    }
  }
  return l;
}

const en2025o2026 = (it: CompraAgilListItem) => /^202[56]-/.test(it.fechas.fecha_publicacion);

/** Fortinet primero; después firewall/cortafuego genérico, el sustituto directo de un FortiGate. */
function prioridadDetalle(l: Listado): string[] {
  const vivos = Object.values(l.items).filter((x) => en2025o2026(x.item));
  const forti = vivos.filter((x) => x.terminos.some((t) => t.startsWith("forti")) || RE_FORTINET.test(x.item.nombre));
  const fw = vivos.filter((x) => !forti.includes(x) && x.terminos.some((t) => t === "firewall" || t === "cortafuego"));
  return [...forti, ...fw].map((x) => x.item.codigo);
}

async function traerDetalles(codigos: string[], previos: Record<string, CompraAgilDetalle>) {
  let pedidos = 0;
  for (const c of codigos) {
    if (previos[c] || pedidos >= MAX_DETALLES) continue;
    try {
      previos[c] = await obtenerDetalleCompraAgil(c);
      pedidos++;
    } catch (e) {
      if (e instanceof CuotaApiAgotadaError || e instanceof CuotaLocalAgotadaError) {
        console.warn(`  cuota: se detiene en ${pedidos} detalles`);
        break;
      }
      console.warn(`  detalle ${c}: ${(e as Error).message.slice(0, 120)}`);
    }
  }
  return pedidos;
}

// ── Fase 3: informe ──────────────────────────────────────────────────────────────────────────────

interface Fila {
  codigo: string;
  nombre: string;
  texto: string;
  con_detalle: boolean;
  anio: string;
  mes: string;
  estado: string;
  tope: number;
  ofertas: number;
  organismo: string;
  region: string;
  primer_llamado: boolean;
  fortinet: boolean;
  familia: Familia;
  segmento: "fortinet" | "firewall" | "switch" | "access_point" | "transceptor" | "fuera";
  motivo: string | null;
  modelos: string[];
  marcas: string[];
}

function construirFilas(l: Listado, det: Record<string, CompraAgilDetalle>): Fila[] {
  const filas: Fila[] = [];
  for (const { item, terminos } of Object.values(l.items)) {
    if (!en2025o2026(item)) continue;
    const d = det[item.codigo];
    const productos = d?.productos_solicitados?.map((p) => `${p.nombre} ${p.descripcion}`).join(" \n ") ?? "";
    const texto = `${item.nombre} \n ${d?.descripcion ?? ""} \n ${productos}`;
    const fortinet = RE_FORTINET.test(texto);
    const familia = familiaDe(fortinet ? texto : item.nombre);
    // Fuera de Fortinet solo se mira el NOMBRE: el `q` también busca en la descripción, donde
    // «switch» o «wifi» aparecen como accesorio de cualquier cosa (ver `precisionEnNombre`).
    let segmento: Fila["segmento"] = "fuera";
    if (fortinet) segmento = "fortinet";
    else if (!RE_RUIDO.test(item.nombre)) {
      const fn = familiaDe(item.nombre);
      if (fn === "firewall" || (fn === "licencia_soporte" && /firewall|cortafuego/i.test(item.nombre))) segmento = "firewall";
      else if (fn === "switch" || fn === "access_point" || fn === "transceptor") segmento = fn;
      else if (/wi-?fi|inal[aá]mbric/i.test(item.nombre) && /red|router|antena|cobertura|conectividad/i.test(item.nombre)) segmento = "access_point";
    }
    const modelos = [
      ...new Set(
        (texto.match(/\b(?:fg|fgt|fortigate|fs|fortiswitch|fap|fortiap)[- ]?\d{2,4}[a-z](?:-[a-z]+)?\b|\bfn-tran-[a-z0-9+]+/gi) ?? []).map((m) =>
          m.toUpperCase().replace(/\s+/g, "-").replace(/^FORTIGATE-?/, "FG-").replace(/^FGT-?/, "FG-").replace(/^FORTISWITCH-?/, "FS-").replace(/^FORTIAP-?/, "FAP-").replace(/^(FG|FS|FAP)(\d)/, "$1-$2"),
        ),
      ),
    ];
    const marcas = MARCAS.filter(([, re]) => re.test(texto)).map(([m]) => m);
    filas.push({
      codigo: item.codigo,
      nombre: item.nombre.trim(),
      texto,
      con_detalle: !!d,
      anio: item.fechas.fecha_publicacion.slice(0, 4),
      mes: item.fechas.fecha_publicacion.slice(0, 7),
      estado: item.estado.codigo,
      tope: item.montos.monto_disponible_clp ?? 0,
      ofertas: d?.resumen.total_ofertas_recibidas ?? item.resumen.total_ofertas_recibidas ?? 0,
      organismo: item.institucion.organismo_comprador,
      region: item.institucion.nombre_region,
      primer_llamado: item.convocatoria.estado_convocatoria === 1,
      fortinet,
      familia,
      segmento,
      motivo: item.motivos.motivo_desierta ?? item.motivos.motivo_cancelacion ?? null,
      modelos,
      marcas,
    });
    void terminos;
  }
  return filas.sort((a, b) => b.mes.localeCompare(a.mes));
}

const clp = (n: number) => "$" + Math.round(n).toLocaleString("es-CL");
const pct = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)}%` : "—");
const mediana = (xs: number[]) => {
  const s = [...xs].filter((x) => x > 0).sort((a, b) => a - b);
  if (!s.length) return 0;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

function resumen(filas: Fila[]) {
  const resueltas = filas.filter((f) => f.estado !== "publicada");
  const cerradas = filas.filter((f) => f.estado === "cerrada");
  return {
    n: filas.length,
    publicadas: filas.filter((f) => f.estado === "publicada").length,
    cerradas: cerradas.length,
    desiertas: filas.filter((f) => f.estado === "desierta").length,
    canceladas: filas.filter((f) => f.estado === "cancelada").length,
    exito: pct(cerradas.length, resueltas.length),
    monto_total: filas.reduce((s, f) => s + f.tope, 0),
    monto_cerradas: cerradas.reduce((s, f) => s + f.tope, 0),
    mediana_tope: mediana(filas.map((f) => f.tope)),
    ofertas_prom: filas.length ? (filas.reduce((s, f) => s + f.ofertas, 0) / filas.length).toFixed(1) : "—",
    n2025: filas.filter((f) => f.anio === "2025").length,
    n2026: filas.filter((f) => f.anio === "2026").length,
  };
}

function informe(l: Listado, det: Record<string, CompraAgilDetalle>): string {
  const filas = construirFilas(l, det);
  const seg = (s: Fila["segmento"]) => filas.filter((f) => f.segmento === s);
  const forti = seg("fortinet");
  const out: string[] = [];
  const hoy = new Date().toISOString().slice(0, 10);

  out.push(`# Estudio: equipos Fortinet en Compra Ágil (2025–2026)`, "");
  out.push(
    `Generado el ${hoy} por \`npm run estudio-fortinet\` sobre la API de Compra Ágil (barrido del ${l.medido_en.slice(0, 10)}). ` +
      `Pregunta: ¿conviene ofrecer por Compra Ágil el stock Fortinet del mayorista (FortiGate 40F→200G, FortiSwitch, FortiAP, transceptores FN-TRAN, FortiCare)?`,
    "",
  );
  out.push(
    `**Cómo leer las cifras.** "Exitosa" = estado \`cerrada\` (la API nunca devuelve \`proveedor_seleccionado\`; mismo criterio que el radar de Kompu). ` +
      `La tasa se calcula sobre compras ya resueltas (sin contar las publicadas). El monto es el **tope** declarado, no lo adjudicado: la API no expone ganador ni precio. ` +
      `Ventana: compras publicadas desde el 2025-01-01; la API no devuelve nada anterior a fines de enero de 2025.`,
    "",
  );
  if (l.incompleto.length) out.push(`> ⚠️ Consultas que no se completaron (cuota o error): ${l.incompleto.join(", ")}.`, "");

  out.push(`## Resumen por segmento`, "");
  out.push(`| Segmento | Compras | 2025 | 2026 | Abiertas hoy | Cerradas (éxito) | Desiertas | Canceladas | Tasa éxito | Tope mediano | Suma de topes | Ofertas prom. |`);
  out.push(`|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|`);
  const nombres: Record<string, string> = {
    fortinet: "**Fortinet (marca o SKU)**",
    firewall: "Firewall, otras marcas / sin marca",
    switch: "Switch de red",
    access_point: "Access point / WiFi",
    transceptor: "Transceptores SFP",
  };
  for (const s of ["fortinet", "firewall", "switch", "access_point", "transceptor"] as const) {
    const r = resumen(seg(s));
    out.push(`| ${nombres[s]} | ${r.n} | ${r.n2025} | ${r.n2026} | ${r.publicadas} | ${r.cerradas} | ${r.desiertas} | ${r.canceladas} | ${r.exito} | ${clp(r.mediana_tope)} | ${clp(r.monto_total)} | ${r.ofertas_prom} |`);
  }
  out.push("", `Referencia: la tasa de éxito de Compra Ágil en todos los rubros medidos es 7–10% (\`output/estudio-mercado.md\`) y 10–15% en hardware TI de Kompu.`, "");
  out.push(
    `Switch, access point y transceptores se cuentan **por nombre** de la compra (con exclusión de ruido: consolas Nintendo, televisores, cámaras…), así que son el mercado de esos equipos de **cualquier** marca: es contra lo que compite un FortiSwitch o un FortiAP.`,
    "",
  );

  const rf = resumen(forti);
  out.push(`## Fortinet: las ${rf.n} compras`, "");
  out.push(`| Mes | Código | Compra | Organismo | Estado | Tope | Ofertas | Familia | Modelos citados |`);
  out.push(`|---|---|---|---|---|---:|---:|---|---|`);
  for (const f of forti)
    out.push(`| ${f.mes} | \`${f.codigo}\` | ${f.nombre.replace(/\|/g, "/").slice(0, 80)} | ${f.organismo.slice(0, 45)} | ${f.estado} | ${clp(f.tope)} | ${f.ofertas} | ${f.familia} | ${f.modelos.join(", ") || "—"} |`);
  out.push("");

  const porFamilia = new Map<string, Fila[]>();
  forti.forEach((f) => porFamilia.set(f.familia, [...(porFamilia.get(f.familia) ?? []), f]));
  out.push(`### Qué se compra de Fortinet`, "");
  out.push(`| Familia | Compras | Cerradas | Tope mediano |`, `|---|---:|---:|---:|`);
  for (const [fam, fs] of [...porFamilia].sort((a, b) => b[1].length - a[1].length))
    out.push(`| ${fam} | ${fs.length} | ${fs.filter((f) => f.estado === "cerrada").length} | ${clp(mediana(fs.map((f) => f.tope)))} |`);
  out.push("");

  const motivos = forti.filter((f) => f.motivo).map((f) => `- \`${f.codigo}\` (${f.estado}): ${f.motivo!.replace(/\s+/g, " ").slice(0, 220)}`);
  if (motivos.length) out.push(`### Por qué fracasaron (texto del organismo)`, "", ...motivos, "");

  const recomp = new Map<string, number>();
  [...forti, ...seg("firewall")].forEach((f) => recomp.set(f.organismo, (recomp.get(f.organismo) ?? 0) + 1));
  const repetidos = [...recomp].filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1]);
  if (repetidos.length) {
    out.push(`### Organismos que repiten (Fortinet + firewall)`, "");
    repetidos.forEach(([o, n]) => out.push(`- ${o}: ${n} compras`));
    out.push("");
  }

  const fw = [...forti, ...seg("firewall")].filter((f) => f.con_detalle);
  const cuentaMarcas = new Map<string, number>();
  fw.forEach((f) => f.marcas.forEach((m) => cuentaMarcas.set(m, (cuentaMarcas.get(m) ?? 0) + 1)));
  out.push(`## Qué marca pide el Estado cuando compra un firewall`, "");
  out.push(`Sobre ${fw.length} compras de firewall/Fortinet con detalle leído (nombre + descripción + productos). Una compra puede nombrar varias marcas; ${fw.filter((f) => !f.marcas.length).length} no nombran ninguna.`, "");
  out.push(`| Marca | Compras que la nombran |`, `|---|---:|`);
  [...cuentaMarcas].sort((a, b) => b[1] - a[1]).forEach(([m, n]) => out.push(`| ${m} | ${n} |`));
  out.push("");

  const fwOtros = seg("firewall");
  if (fwOtros.length) {
    out.push(`## Firewall sin Fortinet: las ${fwOtros.length} compras`, "");
    out.push(`| Mes | Código | Compra | Estado | Tope | Ofertas | Marcas |`, `|---|---|---|---|---:|---:|---|`);
    for (const f of fwOtros) out.push(`| ${f.mes} | \`${f.codigo}\` | ${f.nombre.replace(/\|/g, "/").slice(0, 80)} | ${f.estado} | ${clp(f.tope)} | ${f.ofertas} | ${f.marcas.join(", ") || "—"} |`);
    out.push("");
  }

  const abiertas = filas.filter((f) => f.estado === "publicada" && f.segmento !== "fuera");
  out.push(`## Abiertas al momento del barrido`, "");
  if (!abiertas.length) out.push(`Ninguna.`);
  for (const f of abiertas) out.push(`- [${f.segmento}] \`${f.codigo}\` — ${f.nombre} — ${f.organismo} — tope ${clp(f.tope)}`);
  out.push("");

  out.push(`## Totales crudos de la API (sin corte de fecha)`, "");
  out.push(`| Término | ${ESTADOS.join(" | ")} |`, `|---|${ESTADOS.map(() => "---:").join("|")}|`);
  for (const q of TERMINOS) out.push(`| \`${q}\` | ${ESTADOS.map((e) => l.totales[`${q}|${e}`] ?? "—").join(" | ")} |`);
  out.push("", `Los totales de \`switch\` y \`wifi\` incluyen ruido de la descripción (el \`q\` busca también ahí); la tabla de segmentos de arriba ya lo filtra por nombre.`, "");
  return out.join("\n");
}

// ── main ─────────────────────────────────────────────────────────────────────────────────────────

async function main() {
  let listado = leerJson<Listado | null>(LISTADO_PATH, null);
  const detalles = leerJson<Record<string, CompraAgilDetalle>>(DETALLES_PATH, {});
  if (!SOLO_INFORME) {
    configurarCuota({ script: "estudio-fortinet", maxRequests: PRESUPUESTO });
    console.log("Fase 1 — listado");
    listado = await barrer();
    guardarJson(LISTADO_PATH, listado);
    console.log("Fase 2 — detalle");
    const n = await traerDetalles(prioridadDetalle(listado), detalles);
    guardarJson(DETALLES_PATH, detalles);
    console.log(`  ${n} detalles nuevos; requests hoy: ${ledgerHoy().total_requests}`);
  }
  if (!listado) throw new Error(`No existe ${LISTADO_PATH}: correr sin --solo-informe primero.`);
  mkdirSync(path.dirname(INFORME_PATH), { recursive: true });
  writeFileSync(INFORME_PATH, informe(listado, detalles));
  console.log(`Informe: ${path.relative(ROOT_DIR, INFORME_PATH)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
