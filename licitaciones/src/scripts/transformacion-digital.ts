/**
 * `npm run transformacion-digital` — barrido del nicho de Transformación Digital / Ley 21.180.
 *
 * Fase 1 de tres: buscar las licitaciones, publicarlas ordenadas y dejar el manifiesto con acceso a
 * sus documentos. La Fase 2 (bajar los archivos) la corre Claude Cowork en la máquina del usuario,
 * porque el visor de adjuntos del portal está tras un reCAPTCHA por score que este repo no rodea.
 *
 * Dos decisiones de diseño que abaratan la corrida y conviene entender antes de tocarla:
 *
 * 1. **Rotar `idOrden` en vez de ventanear por fecha.** El buscador topa la descarga en 1.000 filas
 *    y con estas consultas ese tope se alcanza casi siempre. Medido el 2026-08-25: tres criterios
 *    de orden distintos sobre la misma consulta comparten solo 162 de sus 1.000 filas y su unión da
 *    2.545 códigos únicos. Las ventanas de fecha también funcionan, pero filtran una fecha distinta
 *    según el estado, devuelven cero en `publicadas` (cuyo cierre es futuro) y ante un formato
 *    inválido el portal contesta "sin coincidencias" en vez de un error — o sea, una corrida entera
 *    vacía sin que nada lo delate. La rotación no tiene ninguno de esos tres problemas.
 * 2. **La página se publica sin enriquecer ninguna ficha.** El CSV del buscador ya trae nombre y
 *    descripción COMPLETOS: alcanza para el embudo, para el orden y para un primer pase de
 *    requerimientos. Bajar la ficha de cada licitación (~3 requests y ~250 KB) es el costo real, y
 *    es incremental por naturaleza: va detrás de `--fichas=N`.
 *
 * Cero cuota de la API con ticket: todo sale del buscador público y de las fichas públicas.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import {
  ESTADOS_BUSCADOR,
  ORDENES_BUSCADOR,
  TOPE_FILAS_DESCARGA,
  buscarEnPortal,
  type NombreEstadoBuscador,
  type ResultadoBusquedaPortal,
} from "../lib/buscador-portal.js";
import { procesarAntecedentes } from "../lib/antecedentes-pipeline.js";
import { leerAdjuntosLocales } from "../lib/adjuntos-locales.js";
import { LIC_ROOT_DIR } from "../lib/config.js";
import {
  anexar,
  configTd,
  consultasDeDescubrimiento,
  evaluar,
  extraerRequerimientos,
  leerIndice,
  ordenar,
  registroDesdeFila,
  ultimaPorCodigo,
  type Procedencia,
  type RegistroIndice,
  type RegistroTd,
  type Veredicto,
} from "../lib/transformacion-digital.js";
import {
  escribirTransformacionDigital,
  rehidratar,
  type CombinacionTruncada,
  type ResumenCorridaTd,
} from "../lib/pagina-transformacion-digital.js";

const DATA_DIR = path.join(LIC_ROOT_DIR, "data");
const CRUDO_PATH = path.join(DATA_DIR, "_td-busqueda.json");
const DESCARTADOS_PATH = path.join(DATA_DIR, "_td-descartados.json");

/** Estados barridos. Todos: la pregunta de este nicho se responde sobre todo con las pasadas. */
const ESTADOS_POR_DEFECTO: NombreEstadoBuscador[] = [
  "publicadas",
  "cerradas",
  "desiertas",
  "adjudicadas",
  "revocadas",
];

/**
 * Órdenes de rescate para las combinaciones que toparon. Se rota de a uno y se corta apenas una
 * pasada no aporte códigos nuevos: no tiene sentido pagar los ocho órdenes si el tercero ya no
 * descubre nada.
 */
const ORDENES_ROTACION = [ORDENES_BUSCADOR.mayorMonto, ORDENES_BUSCADOR.adjudicadas, ORDENES_BUSCADOR.publicadas];

/** Los estados terminales no cambian nunca más: una ficha bajada de una adjudicada no caduca. */
const ESTADOS_TERMINALES = new Set(["6", "7", "8", "15"]);
const CADUCIDAD_ABIERTAS_MS = 24 * 60 * 60 * 1000;

const PAUSA_MS = 400;

interface Opciones {
  fichas: number;
  soloIndice: boolean;
  refiltrar: boolean;
  consultas?: string[];
  estados: NombreEstadoBuscador[];
}

function parsearArgs(argv: string[]): Opciones {
  const o: Opciones = { fichas: 0, soloIndice: false, refiltrar: false, estados: ESTADOS_POR_DEFECTO };
  for (const a of argv) {
    if (a === "--solo-indice") o.soloIndice = true;
    else if (a === "--refiltrar") o.refiltrar = true;
    else if (a.startsWith("--fichas=")) o.fichas = Math.max(0, Number(a.slice(9)) || 0);
    else if (a.startsWith("--consultas=")) o.consultas = a.slice(12).split(",").map((s) => s.trim()).filter(Boolean);
    else if (a.startsWith("--estados=")) {
      const pedidos = a.slice(10).split(",").map((s) => s.trim()).filter(Boolean);
      const validos = pedidos.filter((p): p is NombreEstadoBuscador => p in ESTADOS_BUSCADOR);
      const invalidos = pedidos.filter((p) => !(p in ESTADOS_BUSCADOR));
      if (invalidos.length > 0) {
        console.error(`⚠ Estado(s) desconocido(s): ${invalidos.join(", ")}. Válidos: ${Object.keys(ESTADOS_BUSCADOR).join(", ")}`);
      }
      if (validos.length > 0) o.estados = validos;
    }
  }
  return o;
}

const esperar = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

interface FilaConProcedencia {
  fila: ResultadoBusquedaPortal;
  procedencia: Procedencia;
}

interface Barrido {
  filas: Map<string, FilaConProcedencia>;
  combinaciones: number;
  truncadas: CombinacionTruncada[];
  rotaciones: number;
  filasBrutas: number;
  requests: number;
  fallidas: { consulta: string; estado: string; error: string }[];
}

function registrar(mapa: Map<string, FilaConProcedencia>, fila: ResultadoBusquedaPortal, consulta: string, estado: string, orden: string): boolean {
  const previa = mapa.get(fila.codigo);
  if (previa) {
    previa.procedencia.consultas.add(consulta);
    previa.procedencia.estados.add(estado);
    previa.procedencia.ordenes.add(orden);
    return false;
  }
  mapa.set(fila.codigo, {
    fila,
    procedencia: { consultas: new Set([consulta]), estados: new Set([estado]), ordenes: new Set([orden]) },
  });
  return true;
}

async function barrer(o: Opciones): Promise<Barrido> {
  const consultas = o.consultas ?? consultasDeDescubrimiento();
  const b: Barrido = { filas: new Map(), combinaciones: 0, truncadas: [], rotaciones: 0, filasBrutas: 0, requests: 0, fallidas: [] };

  for (const consulta of consultas) {
    for (const nombreEstado of o.estados) {
      const estado = ESTADOS_BUSCADOR[nombreEstado];
      b.combinaciones += 1;
      let filas: ResultadoBusquedaPortal[];
      try {
        filas = await buscarEnPortal(consulta, estado);
        b.requests += 2; // GET del buscador + POST/GET del archivo
      } catch (err) {
        // Una consulta caída no aborta el barrido: se declara en la página y el resto sigue.
        b.fallidas.push({ consulta, estado: nombreEstado, error: String(err).slice(0, 200) });
        console.error(`  ⚠ "${consulta}" · ${nombreEstado}: ${String(err).slice(0, 120)}`);
        await esperar(PAUSA_MS);
        continue;
      }
      b.filasBrutas += filas.length;
      let nuevas = 0;
      for (const f of filas) if (registrar(b.filas, f, consulta, estado, ORDENES_BUSCADOR.relevantes)) nuevas += 1;
      const topo = filas.length >= TOPE_FILAS_DESCARGA;
      console.log(`  ${consulta} · ${nombreEstado}: ${filas.length} filas${topo ? " (TOPE)" : ""}, ${nuevas} códigos nuevos`);
      await esperar(PAUSA_MS);

      if (!topo) continue;
      b.truncadas.push({ consulta, estado: nombreEstado });

      // Rotación de orden: cada criterio devuelve OTRO corte de 1.000. Se corta apenas una pasada
      // no aporte nada nuevo — pagar los ocho órdenes cuando el tercero ya no descubre es gasto.
      for (const orden of ORDENES_ROTACION) {
        let extra: ResultadoBusquedaPortal[];
        try {
          extra = await buscarEnPortal(consulta, estado, { orden });
          b.requests += 2;
          b.rotaciones += 1;
        } catch (err) {
          b.fallidas.push({ consulta, estado: `${nombreEstado} (orden ${orden})`, error: String(err).slice(0, 200) });
          break;
        }
        b.filasBrutas += extra.length;
        let nuevasRot = 0;
        for (const f of extra) if (registrar(b.filas, f, consulta, estado, orden)) nuevasRot += 1;
        console.log(`    ↻ orden ${orden}: ${extra.length} filas, ${nuevasRot} códigos nuevos`);
        await esperar(PAUSA_MS);
        if (nuevasRot === 0) break;
      }
    }
  }
  return b;
}

interface CrudoEnDisco {
  guardado_en: string;
  filas: { fila: ResultadoBusquedaPortal; consultas: string[]; estados: string[]; ordenes: string[] }[];
  combinaciones: number;
  truncadas: CombinacionTruncada[];
  rotaciones: number;
  filas_brutas: number;
  requests: number;
  fallidas: { consulta: string; estado: string; error: string }[];
}

function guardarCrudo(b: Barrido): void {
  const datos: CrudoEnDisco = {
    guardado_en: new Date().toISOString(),
    filas: [...b.filas.values()].map((f) => ({
      fila: f.fila,
      consultas: [...f.procedencia.consultas],
      estados: [...f.procedencia.estados],
      ordenes: [...f.procedencia.ordenes],
    })),
    combinaciones: b.combinaciones,
    truncadas: b.truncadas,
    rotaciones: b.rotaciones,
    filas_brutas: b.filasBrutas,
    requests: b.requests,
    fallidas: b.fallidas,
  };
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(CRUDO_PATH, JSON.stringify(datos, null, 2), "utf-8");
}

/**
 * El volcado crudo es lo que hace que `--refiltrar` cueste 0 requests, y eso es lo que hace
 * corregible el único riesgo serio del diseño: un excluyente que mata un acierto real.
 */
function cargarCrudo(): Barrido | null {
  if (!existsSync(CRUDO_PATH)) return null;
  try {
    const d = JSON.parse(readFileSync(CRUDO_PATH, "utf-8")) as CrudoEnDisco;
    const filas = new Map<string, FilaConProcedencia>();
    for (const f of d.filas) {
      filas.set(f.fila.codigo, {
        fila: f.fila,
        procedencia: { consultas: new Set(f.consultas), estados: new Set(f.estados), ordenes: new Set(f.ordenes) },
      });
    }
    return {
      filas,
      combinaciones: d.combinaciones,
      truncadas: d.truncadas ?? [],
      rotaciones: d.rotaciones ?? 0,
      filasBrutas: d.filas_brutas ?? 0,
      requests: 0,
      fallidas: d.fallidas ?? [],
    };
  } catch {
    return null;
  }
}

interface Embudo {
  confirmados: { fila: ResultadoBusquedaPortal; procedencia: Procedencia; veredicto: Extract<Veredicto, { pasa: true }> }[];
  descartes: { motivo: string; patron?: string; filas: number }[];
}

function pasarEmbudo(b: Barrido): Embudo {
  const confirmados: Embudo["confirmados"] = [];
  const descartados: { codigo: string; nombre: string; motivo: string; patron?: string }[] = [];
  const conteo = new Map<string, { motivo: string; patron?: string; filas: number }>();

  for (const { fila, procedencia } of b.filas.values()) {
    const veredicto = evaluar(fila.nombre, fila.descripcion);
    if (veredicto.pasa) {
      confirmados.push({ fila, procedencia, veredicto });
      continue;
    }
    descartados.push({ codigo: fila.codigo, nombre: fila.nombre, motivo: veredicto.motivo, patron: veredicto.patron });
    // "no-requerido" es el 99% del ruido del buscador y no dice nada; el resto sí, porque un
    // excluyente que dispara mucho es candidato a estar matando aciertos.
    const clave = veredicto.motivo === "no-requerido" ? "no-requerido" : `${veredicto.motivo}|${veredicto.patron ?? ""}`;
    const actual = conteo.get(clave) ?? { motivo: veredicto.motivo, patron: veredicto.patron, filas: 0 };
    actual.filas += 1;
    conteo.set(clave, actual);
  }

  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(DESCARTADOS_PATH, JSON.stringify(descartados, null, 2), "utf-8");

  const descartes = [...conteo.values()]
    .filter((d) => d.motivo !== "no-requerido")
    .sort((a, b2) => b2.filas - a.filas);
  return { confirmados, descartes };
}

/** ¿Hace falta volver a bajar la ficha de esta licitación? Se decide con el índice, no con el payload. */
function necesitaFicha(previo: RegistroIndice | undefined): boolean {
  if (!previo?.enriquecido_en) return true;
  const terminal = previo.estado_buscador.split(",").every((e) => ESTADOS_TERMINALES.has(e));
  if (terminal) return false; // una adjudicada ya no cambia: su ficha es definitiva
  return Date.now() - new Date(previo.enriquecido_en).getTime() > CADUCIDAD_ABIERTAS_MS;
}

/**
 * Enriquece una licitación con su ficha pública. Se llama a `procesarAntecedentes`, que ya baja la
 * ficha, guarda `documentos.json` y escribe la ficha de decisión — llamar a `construirFichaDecision`
 * por separado duplicaría el trabajo y arriesgaría divergencia.
 */
async function enriquecer(registro: Omit<RegistroTd, "hash">): Promise<Omit<RegistroTd, "hash">> {
  const { antecedentes, referencias, decision } = await procesarAntecedentes(registro.codigo);

  const fuentes = antecedentes.secciones.map((s) => ({
    texto: s.texto,
    fuente: `sección ${s.numero} (${s.titulo})`,
  }));
  if (antecedentes.foro) fuentes.push({ texto: antecedentes.foro, fuente: "foro de preguntas y respuestas" });

  // Si alguien ya bajó adjuntos a mano (Fase 2 en la máquina local), su texto entra acá sin código
  // nuevo y la completitud sube a "con-adjuntos".
  const adjuntos = await leerAdjuntosLocales(registro.codigo);
  for (const d of adjuntos.documentos) {
    if (d.texto) fuentes.push({ texto: adjuntos.texto, fuente: `adjunto ${d.archivo}` });
  }

  return {
    ...registro,
    enriquecido_en: new Date().toISOString(),
    completitud: adjuntos.documentos.length > 0 ? "con-adjuntos" : "solo-ficha-publica",
    requerimientos: extraerRequerimientos(fuentes),
    exigencias_administrativas: decision.exigencias,
    documentos: referencias.map((r) => ({
      clave: r.clave,
      titulo: r.titulo,
      url: r.url,
      acceso: r.acceso,
      nota: r.nota,
    })),
    ficha: {
      cierre: decision.fechas.cierre,
      adjudicacion: decision.fechas.adjudicacion,
      monto_estimado: decision.comerciales.montoEstimado,
      duracion_contrato: decision.comerciales.duracionContrato,
      peso_precio: decision.pesoPrecio,
      anexos_total: decision.anexos.total,
      garantia_exigida: decision.garantia.exigida,
      clausulas_excluyentes: decision.clausulasExcluyentes.length,
      banderas_criticas: decision.banderas.filter((b) => b.nivel !== "favorable").length,
    },
  };
}

async function main(): Promise<void> {
  const o = parsearArgs(process.argv.slice(2));
  const ahoraIso = new Date().toISOString();
  configTd(); // falla temprano y ruidosamente si una regex de la config está mala

  const previas = ultimaPorCodigo(leerIndice());
  let registros: Omit<RegistroTd, "hash">[];
  let resumen: ResumenCorridaTd;

  if (o.soloIndice) {
    // "Solo índice" significa NO barrer el portal, no "no hacer nada": el enriquecimiento sigue
    // disponible porque lee otra fuente —la ficha pública de cada licitación— y es justo la forma
    // de continuar una corrida que se cortó en el cap de --fichas.
    console.log("Sin barrer el portal: partiendo del índice historico/transformacion-digital.jsonl…");
    // `observado_en` se resella con la hora de ESTA corrida, y no es cosmética: `ultimaPorCodigo`
    // resuelve por ese campo con un `>` estricto, así que una línea enriquecida que conservara el
    // timestamp de la observación original empataría con la línea vieja sin enriquecer y perdería
    // el desempate. El síntoma era silencioso: la ficha se bajaba, se escribía, y la corrida
    // siguiente la leía como si nunca se hubiera indexado.
    registros = rehidratar([...previas.values()]).map(({ hash: _h, ...resto }) => ({
      ...resto,
      observado_en: ahoraIso,
    }));
    const crudo = cargarCrudo();
    resumen = {
      generado_en: ahoraIso,
      estados: o.estados,
      consultas: o.consultas ?? consultasDeDescubrimiento(),
      combinaciones: crudo?.combinaciones ?? 0,
      combinaciones_truncadas: crudo?.truncadas ?? [],
      ordenes_rotados: crudo?.rotaciones ?? 0,
      filas_brutas: crudo?.filasBrutas ?? 0,
      codigos_distintos: crudo?.filas.size ?? registros.length,
      confirmados: registros.length,
      descartes: [],
      enriquecidos_esta_corrida: 0,
      consultas_fallidas: [],
      solo_indice: true,
      refiltrado: false,
      requests: 0,
    };
  } else {
    const barrido = o.refiltrar
      ? cargarCrudo()
      : await (async () => {
          console.log(
            `Barriendo ${(o.consultas ?? consultasDeDescubrimiento()).length} consulta(s) × ${o.estados.length} estado(s)…`,
          );
          const b = await barrer(o);
          guardarCrudo(b);
          return b;
        })();

    if (!barrido) {
      console.error(
        `No hay barrido guardado en ${CRUDO_PATH}. Corre primero \`npm run transformacion-digital\` sin --refiltrar.`,
      );
      process.exitCode = 1;
      return;
    }
    if (o.refiltrar) console.log(`Refiltrando ${barrido.filas.size} código(s) del último barrido (0 requests)…`);

    const { confirmados, descartes } = pasarEmbudo(barrido);
    console.log(`Embudo: ${barrido.filas.size} códigos → ${confirmados.length} del nicho.`);

    // Lo ya enriquecido se conserva: `--refiltrar` recalibra regex, no tira a la basura fichas ya
    // bajadas. El payload pesado vive en el manifiesto, así que se rehidrata desde ahí.
    const rehidratadas = new Map(rehidratar([...previas.values()]).map((r) => [r.codigo, r] as const));
    registros = confirmados.map(({ fila, procedencia, veredicto }) => {
      const base = registroDesdeFila(fila, procedencia, veredicto, ahoraIso);
      const previo = rehidratadas.get(fila.codigo);
      if (!previo?.enriquecido_en) return base;
      return {
        ...base,
        enriquecido_en: previo.enriquecido_en,
        completitud: previo.completitud,
        requerimientos: previo.requerimientos,
        exigencias_administrativas: previo.exigencias_administrativas,
        documentos: previo.documentos,
        ficha: previo.ficha,
      };
    });

    resumen = {
      generado_en: ahoraIso,
      estados: o.estados,
      consultas: o.consultas ?? consultasDeDescubrimiento(),
      combinaciones: barrido.combinaciones,
      combinaciones_truncadas: barrido.truncadas,
      ordenes_rotados: barrido.rotaciones,
      filas_brutas: barrido.filasBrutas,
      codigos_distintos: barrido.filas.size,
      confirmados: confirmados.length,
      descartes,
      enriquecidos_esta_corrida: 0,
      consultas_fallidas: barrido.fallidas,
      solo_indice: false,
      refiltrado: o.refiltrar,
      requests: barrido.requests,
    };
  }

  // Enriquecimiento, común a los dos caminos: es la única parte que baja fichas, y va detrás del
  // cap explícito de --fichas porque es el costo real de la corrida (~3 requests por licitación).
  if (o.fichas > 0) {
    const porCodigo = new Map(registros.map((r) => [r.codigo, r] as const));
    const pendientes = ordenar(registros.map((r) => ({ ...r, hash: "" })))
      .map((r) => porCodigo.get(r.codigo))
      .filter((r): r is Omit<RegistroTd, "hash"> => r !== undefined)
      .filter((r) => necesitaFicha(previas.get(r.codigo)))
      .slice(0, o.fichas);
    console.log(`Indexando la ficha de ${pendientes.length} licitación(es)…`);
    for (const p of pendientes) {
      try {
        Object.assign(p, await enriquecer(p));
        resumen.enriquecidos_esta_corrida += 1;
        console.log(
          `  ✓ ${p.codigo}: ${(p.documentos ?? []).length} documento(s), ${p.requerimientos.length} requerimiento(s)`,
        );
      } catch (err) {
        // Una ficha que no se pudo leer no invalida la corrida: la licitación queda publicada con
        // lo que sí se sabe de ella, y la próxima corrida vuelve a intentarlo.
        console.error(`  ⚠ ${p.codigo}: ${String(err).slice(0, 140)}`);
      }
      await esperar(PAUSA_MS);
    }
    resumen.requests += resumen.enriquecidos_esta_corrida * 3; // ficha + foro + Excel de preguntas
  }

  for (const r of registros) anexar(r, previas);

  const ordenados = ordenar(registros.map((r) => ({ ...r, hash: "" })));
  const salidas = escribirTransformacionDigital(ordenados, resumen);
  const indexadas = ordenados.filter((r) => r.enriquecido_en).length;

  console.log("");
  console.log(`${ordenados.length} licitación(es) publicadas · ${indexadas} con la ficha indexada`);
  console.log(`  página     ${path.relative(process.cwd(), salidas.pagina)}`);
  console.log(`  manifiesto ${path.relative(process.cwd(), salidas.manifiesto)}`);
  console.log(`  informe    ${path.relative(process.cwd(), salidas.informe)}`);
  if (resumen.requests > 0) console.log(`  ${resumen.requests} requests HTTP · 0 de cuota de la API con ticket`);
  const sinFicha = ordenados.length - indexadas;
  if (sinFicha > 0) {
    console.log(
      `  ${sinFicha} sin indexar: \`npm run transformacion-digital -- --solo-indice --fichas=${Math.min(sinFicha, 40)}\``,
    );
  }
  if (resumen.consultas_fallidas.length > 0) {
    console.log(`  ⚠ ${resumen.consultas_fallidas.length} consulta(s) fallaron y se declaran en la página`);
  }
}

main().catch((err) => {
  console.error("El barrido de transformación digital falló:", err);
  process.exitCode = 1;
});
