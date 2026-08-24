/**
 * Barrido HISTÓRICO de Compras Ágiles de los nichos del radar —en todos los estados, no solo las
 * abiertas— para extraer los contactos (nombre, correo, cargo) de quienes las publicaron, y
 * publicarlos como listado de leads en `docs/leads.html`.
 *
 * Se diferencia del radar (`npm run radar`) en tres cosas, y por eso es un script aparte:
 *
 *  1. **Mira los cinco estados**, incluidas `cerrada`, `desierta`, `cancelada` y
 *     `proveedor_seleccionado`. Al radar esas no le sirven —ya no se puede ofertar—; acá son
 *     justamente las mejores: son organismos que ya demostraron que compran esto.
 *  2. **No toca `docs/index.html`.** Escribe una página nueva y nada más.
 *  3. **El dato que busca no está en la API.** `/v2/compra-agil` no expone contacto alguno (ver
 *     cabecera de `src/lib/leads.ts`), así que el trabajo real lo hace bajando los ADJUNTOS por el
 *     servicio público, que no gasta cuota del ticket.
 *
 * Cuota: solo la gastan los listados (y `--con-detalle`, que es opcional). El barrido de adjuntos
 * es gratis, así que el tope de compras a revisar se mide en tiempo, no en cuota.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ROOT_DIR } from "../lib/config.js";
import {
  cargarCategorias,
  categoriasActivas,
  itemConfirmaCategoria,
  detalleConfirmaCategoria,
  confirmarCategoriaEnTexto,
  variantesDeBusqueda,
  type CategoriaCompilada,
} from "../lib/categorias.js";
import {
  buscarCompraAgil,
  obtenerDetalleCompraAgil,
  CuotaApiAgotadaError,
  type CompraAgilListItem,
  type EstadoCompraAgil,
} from "../lib/api.js";
import { listarAdjuntos, descargarAdjunto } from "../lib/adjuntos.js";
import { extraerTexto } from "../../licitaciones/src/lib/documentos-texto.js";
import { configurarCuota, CuotaLocalAgotadaError, ledgerHoy } from "../lib/cuota.js";
import {
  extraerContactos,
  anexarLead,
  anexarRevision,
  hashesConocidos,
  revisionesPorCodigo,
  leerLeads,
  consolidar,
  aCsv,
  type Lead,
} from "../lib/leads.js";
import { escribirPaginaLeads, escribirInformeLeads, type ResumenCorridaLeads } from "../lib/pagina-leads.js";

const ESTADOS_TODOS: EstadoCompraAgil[] = ["publicada", "proveedor_seleccionado", "cerrada", "desierta", "cancelada"];

const ARGS = process.argv.slice(2);

function opcion(nombre: string): string | undefined {
  const pre = `--${nombre}=`;
  return ARGS.find((a) => a.startsWith(pre))?.slice(pre.length);
}
const bandera = (n: string) => ARGS.includes(`--${n}`);
const numero = (n: string, def: number) => {
  const v = opcion(n);
  const parsed = v == null ? NaN : Number(v);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : def;
};

const SOLO_INDICE = bandera("solo-indice");
const RE_REVISAR = bandera("rerevisar");
const CON_DETALLE = bandera("con-detalle");
const MAX_PAGINAS = numero("max-paginas", 3);
const PRESUPUESTO = numero("presupuesto", 120);
const MAX_COMPRAS = numero("max-compras", 400);
const MAX_POR_VERIFICAR = numero("max-por-verificar", 60);
const CONCURRENCIA = numero("concurrencia", 4);

function estadosPedidos(): EstadoCompraAgil[] {
  const crudo = opcion("estados");
  if (!crudo) return ESTADOS_TODOS;
  const pedidos = crudo.split(",").map((s) => s.trim()).filter(Boolean);
  const invalidos = pedidos.filter((e) => !ESTADOS_TODOS.includes(e as EstadoCompraAgil));
  if (invalidos.length > 0) {
    throw new Error(`Estado(s) desconocido(s): ${invalidos.join(", ")}. Válidos: ${ESTADOS_TODOS.join(", ")}.`);
  }
  return pedidos as EstadoCompraAgil[];
}

function categoriasPedidas(): CategoriaCompilada[] {
  const crudo = opcion("categorias");
  const base = bandera("todas-categorias") ? cargarCategorias() : categoriasActivas();
  if (!crudo) return base;
  const ids = crudo.split(",").map((s) => s.trim()).filter(Boolean);
  const todas = cargarCategorias();
  return ids.map((id) => {
    const cat = todas.find((c) => c.id === id);
    if (!cat) throw new Error(`Categoría "${id}" no existe en config/categorias.json.`);
    return cat;
  });
}

/** Una compra candidata: lo que se sabe de ella antes de mirar sus adjuntos. */
interface Candidata {
  codigo: string;
  nombre: string;
  estado: string;
  organismo: string;
  rut_organismo: string;
  unidad_compra: string;
  region: number;
  nombre_region: string;
  fecha_publicacion: string;
  monto_disponible_clp: number;
  /** Categorías ya confirmadas por el nombre de la compra. */
  confirmadas: Set<string>;
  /** Categorías que la compra menciona pero a las que les falta el `patron_requerido`. */
  porVerificar: Set<string>;
}

function candidataDesdeItem(item: CompraAgilListItem): Candidata {
  return {
    codigo: item.codigo,
    nombre: item.nombre ?? "",
    estado: item.estado?.codigo ?? "",
    organismo: item.institucion?.organismo_comprador ?? "",
    rut_organismo: item.institucion?.rut ?? "",
    unidad_compra: item.institucion?.unidad_compra ?? "",
    region: item.institucion?.region ?? 0,
    nombre_region: item.institucion?.nombre_region ?? "",
    fecha_publicacion: item.fechas?.fecha_publicacion ?? "",
    monto_disponible_clp: item.montos?.monto_disponible_clp ?? 0,
    confirmadas: new Set(),
    porVerificar: new Set(),
  };
}

function nombreArchivoSeguro(nombre: string): string {
  return (
    nombre
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^A-Za-z0-9._-]/g, "_")
      .slice(-120) || "adjunto.bin"
  );
}

/** Corre `tarea` sobre `items` con como mucho `limite` en vuelo. Sin dependencias nuevas. */
async function enParalelo<T>(items: T[], limite: number, tarea: (item: T, i: number) => Promise<void>): Promise<void> {
  let siguiente = 0;
  const trabajadores = Array.from({ length: Math.max(1, Math.min(limite, items.length)) }, async () => {
    for (;;) {
      const i = siguiente++;
      if (i >= items.length) return;
      await tarea(items[i]!, i);
    }
  });
  await Promise.all(trabajadores);
}

async function main(): Promise<void> {
  const categorias = categoriasPedidas();
  const estados = estadosPedidos();
  const ahoraIso = new Date().toISOString();

  configurarCuota({ script: "leads", maxRequests: SOLO_INDICE ? 0 : PRESUPUESTO });

  console.log(`Barrido histórico de leads — ${categorias.length} categoría(s), ${estados.length} estado(s).`);
  console.log(`Categorías: ${categorias.map((c) => c.id).join(", ")}`);
  console.log(`Estados: ${estados.join(", ")}`);

  const candidatas = new Map<string, Candidata>();
  const resumen: ResumenCorridaLeads = {
    generado_en: ahoraIso,
    categorias: categorias.map((c) => ({ id: c.id, nombre: c.nombre })),
    estados,
    consultas_hechas: 0,
    compras_vistas: 0,
    compras_confirmadas: 0,
    compras_revisadas: 0,
    compras_ya_revisadas: 0,
    adjuntos_leidos: 0,
    adjuntos_sin_texto: 0,
    compras_sin_adjuntos: 0,
    compras_con_contacto: 0,
    compras_postergadas: 0,
    leads_nuevos: 0,
    cuota_agotada: false,
    solo_indice: SOLO_INDICE,
    variantes_fallidas: [],
    requests_api: 0,
  };

  // ── 1. Semilla gratis: lo que el índice histórico del radar ya vio ─────────────────────────
  // `historico/observaciones.jsonl` está versionado y no cuesta un request. Da pocas compras (el
  // radar solo indexa lo que encuentra abierto), pero son las de mayor calidad: ya pasaron el
  // embudo completo del radar, con detalle y todo.
  const { leer: leerIndice } = await import("../lib/indice.js");
  for (const o of leerIndice()) {
    if (!categorias.some((c) => c.id === o.categoria)) continue;
    const previa = candidatas.get(o.codigo);
    if (previa) {
      previa.confirmadas.add(o.categoria);
      continue;
    }
    candidatas.set(o.codigo, {
      codigo: o.codigo,
      nombre: o.nombre,
      estado: o.estado,
      organismo: o.organismo,
      rut_organismo: o.rut,
      unidad_compra: o.unidad_compra,
      region: o.region,
      nombre_region: o.nombre_region,
      fecha_publicacion: o.fecha_publicacion,
      monto_disponible_clp: o.monto_disponible_clp,
      confirmadas: new Set([o.categoria]),
      porVerificar: new Set(),
    });
  }
  console.log(`\n— Semilla desde historico/observaciones.jsonl: ${candidatas.size} compra(s), 0 requests.`);

  // ── 2. Barrido de la API: cada variante `q` contra cada estado ─────────────────────────────
  // Las variantes se deduplican entre categorías ("inteligencia artificial" la usan dos): una
  // consulta se paga una vez y se evalúa contra todas las categorías que la comparten.
  const consultas = new Map<string, CategoriaCompilada[]>();
  for (const cat of categorias) {
    for (const v of variantesDeBusqueda(cat)) {
      const lista = consultas.get(v) ?? [];
      if (!lista.includes(cat)) lista.push(cat);
      consultas.set(v, lista);
    }
  }

  if (!SOLO_INDICE) {
    console.log(
      `\n— Barrido de ${consultas.size} consulta(s) × ${estados.length} estado(s) = ${consultas.size * estados.length} ` +
        `combinación(es), tope ${MAX_PAGINAS} página(s) c/u, presupuesto ${PRESUPUESTO} requests.`,
    );
    barrido: for (const estado of estados) {
      for (const [variante, cats] of consultas) {
        let items: CompraAgilListItem[];
        try {
          items = await buscarCompraAgil({ q: variante, estado, maxPaginas: MAX_PAGINAS });
          resumen.consultas_hechas++;
        } catch (err) {
          if (err instanceof CuotaApiAgotadaError || err instanceof CuotaLocalAgotadaError) {
            // Guardrail: ante cuota agotada no se reintenta a ciegas — se sigue con lo que ya hay.
            console.warn(`\n  ⚠ ${(err as Error).message}`);
            console.warn(`  Se continúa con las ${candidatas.size} compra(s) ya descubiertas.`);
            resumen.cuota_agotada = true;
            break barrido;
          }
          resumen.variantes_fallidas.push({ variante, estado, error: (err as Error).message });
          continue;
        }
        resumen.compras_vistas += items.length;
        for (const item of items) {
          // El listado recién traído manda sobre la semilla del índice: una compra que el radar vio
          // "publicada" hace días hoy puede estar cerrada, y publicar el estado viejo haría creer
          // que todavía se puede ofertar.
          const previa = candidatas.get(item.codigo);
          const candidata = candidataDesdeItem(item);
          if (previa) {
            for (const id of previa.confirmadas) candidata.confirmadas.add(id);
            for (const id of previa.porVerificar) candidata.porVerificar.add(id);
          }
          for (const cat of cats) {
            const veredicto = itemConfirmaCategoria(cat, item);
            if (veredicto === "confirmada") candidata.confirmadas.add(cat.id);
            // "falta-requerido": el nombre nombra la materia (Power BI) pero no dice si es un
            // curso. Se resuelve gratis con el texto de los adjuntos, más abajo.
            else if (veredicto === "falta-requerido") candidata.porVerificar.add(cat.id);
          }
          if (candidata.confirmadas.size > 0 || candidata.porVerificar.size > 0) {
            candidatas.set(item.codigo, candidata);
          }
        }
        process.stdout.write(`  ${estado}/${variante}: ${items.length} → ${candidatas.size} candidata(s)\n`);
      }
    }
  } else {
    console.log(`\n— \`--solo-indice\`: no se consulta la API. Se revisan solo las compras ya conocidas.`);
  }

  // ── 3. Selección: qué compras se revisan ───────────────────────────────────────────────────
  const confirmadas = [...candidatas.values()].filter((c) => c.confirmadas.size > 0);
  const porVerificar = [...candidatas.values()]
    .filter((c) => c.confirmadas.size === 0 && c.porVerificar.size > 0)
    .sort((a, b) => b.fecha_publicacion.localeCompare(a.fecha_publicacion))
    .slice(0, MAX_POR_VERIFICAR);
  resumen.compras_confirmadas = confirmadas.length;
  resumen.compras_por_verificar = porVerificar.length;

  const yaRevisadas = revisionesPorCodigo();
  const pendientes = [...confirmadas, ...porVerificar].filter((c) => RE_REVISAR || !yaRevisadas.has(c.codigo));
  resumen.compras_ya_revisadas = confirmadas.length + porVerificar.length - pendientes.length;
  const seleccion = pendientes
    .sort((a, b) => b.fecha_publicacion.localeCompare(a.fecha_publicacion))
    .slice(0, MAX_COMPRAS);
  // Lo que quedó fuera por el tope de la corrida, no por estar ya revisado: la próxima lo toma.
  resumen.compras_postergadas = pendientes.length - seleccion.length;

  console.log(
    `\n— ${confirmadas.length} confirmada(s) + ${porVerificar.length} por verificar; ` +
      `${seleccion.length} a revisar ahora · ${resumen.compras_ya_revisadas} ya revisada(s) antes · ` +
      `${resumen.compras_postergadas} postergada(s) por el tope de ${MAX_COMPRAS}.`,
  );

  // ── 4. Adjuntos → texto → contactos ────────────────────────────────────────────────────────
  const conocidos = hashesConocidos();
  const dirBase = path.join(ROOT_DIR, "data");
  let procesadas = 0;

  await enParalelo(seleccion, CONCURRENCIA, async (c) => {
    let archivos: { nombre: string; texto: string }[] = [];
    let listados = 0;
    const sinTexto: string[] = [];
    try {
      const adjuntos = await listarAdjuntos(c.codigo);
      listados = adjuntos.length;
      const dir = path.join(dirBase, c.codigo, "leads-adjuntos");
      if (adjuntos.length > 0) mkdirSync(dir, { recursive: true });
      for (const a of adjuntos) {
        try {
          const contenido = await descargarAdjunto(a.id);
          const ruta = path.join(dir, nombreArchivoSeguro(a.nombreArchivo));
          writeFileSync(ruta, contenido);
          const extraido = await extraerTexto(ruta);
          if (extraido.texto.trim()) archivos.push({ nombre: a.nombreArchivo, texto: extraido.texto });
          else sinTexto.push(a.nombreArchivo);
        } catch (err) {
          sinTexto.push(`${a.nombreArchivo} (${(err as Error).message.slice(0, 120)})`);
        }
      }
    } catch (err) {
      sinTexto.push(`(listado) ${(err as Error).message.slice(0, 160)}`);
    }

    // Las categorías "por verificar" se resuelven con el texto de los adjuntos, que es gratis: si
    // las bases dicen "curso de Power BI", la compra entra aunque su nombre no lo dijera.
    const textoCompleto = [c.nombre, ...archivos.map((a) => a.texto)].join("\n");
    const categoriasFinales = new Set(c.confirmadas);
    for (const id of c.porVerificar) {
      const cat = categorias.find((x) => x.id === id);
      if (cat && confirmarCategoriaEnTexto(cat, textoCompleto) === "confirmada") categoriasFinales.add(id);
    }

    let contactosDeEstaCompra = 0;
    if (categoriasFinales.size > 0) {
      for (const a of archivos) {
        for (const contacto of extraerContactos(a.texto, a.nombre)) {
          const lead: Omit<Lead, "hash"> = {
            ...contacto,
            codigo: c.codigo,
            nombre_compra: c.nombre,
            estado: c.estado,
            categorias: [...categoriasFinales],
            organismo: c.organismo,
            rut_organismo: c.rut_organismo,
            unidad_compra: c.unidad_compra,
            region: c.region,
            nombre_region: c.nombre_region,
            fecha_publicacion: c.fecha_publicacion,
            monto_disponible_clp: c.monto_disponible_clp,
            observado_en: ahoraIso,
          };
          if (anexarLead(lead, conocidos)) resumen.leads_nuevos++;
          contactosDeEstaCompra++;
        }
      }
    }

    anexarRevision({
      codigo: c.codigo,
      revisado_en: ahoraIso,
      estado: c.estado,
      categorias: [...categoriasFinales],
      adjuntos_listados: listados,
      adjuntos_leidos: archivos.length,
      adjuntos_sin_texto: sinTexto,
      contactos_encontrados: contactosDeEstaCompra,
    });

    resumen.compras_revisadas++;
    if (contactosDeEstaCompra > 0) resumen.compras_con_contacto++;
    resumen.adjuntos_leidos += archivos.length;
    resumen.adjuntos_sin_texto += sinTexto.length;
    if (listados === 0) resumen.compras_sin_adjuntos++;
    procesadas++;
    if (procesadas % 10 === 0 || procesadas === seleccion.length) {
      console.log(`  ${procesadas}/${seleccion.length} compras revisadas · ${resumen.leads_nuevos} lead(s) nuevo(s)`);
    }
    archivos = [];
  });

  // ── 5. Confirmación opcional por detalle (paga cuota) ───────────────────────────────────────
  // Solo para las que ninguna puerta dejó pasar: el `q` las trajo, pero ni el nombre ni los
  // adjuntos confirman. Ver `--con-detalle` en el README: está apagado por defecto porque cuesta
  // un request por compra y el barrido ya gastó cuota en los listados.
  if (CON_DETALLE && !resumen.cuota_agotada) {
    const sinConfirmar = [...candidatas.values()]
      .filter((c) => c.confirmadas.size === 0 && !porVerificar.includes(c))
      .sort((a, b) => b.fecha_publicacion.localeCompare(a.fecha_publicacion))
      .slice(0, numero("max-detalle", 25));
    console.log(`\n— \`--con-detalle\`: pidiendo el detalle de ${sinConfirmar.length} compra(s) sin confirmar.`);
    for (const c of sinConfirmar) {
      try {
        const detalle = await obtenerDetalleCompraAgil(c.codigo);
        for (const cat of categorias) {
          if (detalleConfirmaCategoria(cat, detalle) === "confirmada") c.confirmadas.add(cat.id);
        }
      } catch (err) {
        if (err instanceof CuotaApiAgotadaError || err instanceof CuotaLocalAgotadaError) {
          resumen.cuota_agotada = true;
          console.warn(`  ⚠ ${(err as Error).message}`);
          break;
        }
      }
    }
    console.log(`  (las confirmadas acá se revisan en la próxima corrida, ya sin costo de descubrimiento)`);
  }

  resumen.requests_api = ledgerHoy().por_script["leads"] ?? 0;

  // ── 6. Publicar ────────────────────────────────────────────────────────────────────────────
  const consolidados = consolidar(leerLeads());
  const rutaPagina = escribirPaginaLeads(consolidados, resumen);
  const rutaInforme = escribirInformeLeads(consolidados, resumen);
  const rutaCsv = path.join(ROOT_DIR, "output", "leads.csv");
  mkdirSync(path.dirname(rutaCsv), { recursive: true });
  writeFileSync(rutaCsv, aCsv(consolidados), "utf-8");

  console.log(`\n✔ ${consolidados.length} lead(s) únicos acumulados (${resumen.leads_nuevos} nuevos en esta corrida).`);
  console.log(`  Página:  ${path.relative(ROOT_DIR, rutaPagina)}`);
  console.log(`  Informe: ${path.relative(ROOT_DIR, rutaInforme)}`);
  console.log(`  CSV:     ${path.relative(ROOT_DIR, rutaCsv)}`);
  console.log(`  Requests a la API en esta corrida: ${resumen.requests_api}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
