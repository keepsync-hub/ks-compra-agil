/**
 * Ficha de decisión: convierte los antecedentes en texto de una licitación en los datos concretos
 * con que se responde "¿vale la pena presentarse?", sin que nadie tenga que leer las bases.
 *
 * Todo lo que sale de acá está **citado**: cada dato lleva la sección de la ficha pública de donde
 * se leyó (`fuente`), y lo que no aparece queda `undefined` en vez de inventarse. Las banderas son
 * reglas explícitas sobre esos datos —no una opinión del agente— y por eso cada una dice su motivo.
 *
 * Las secciones que alimentan esto (verificadas contra 3 licitaciones reales el 2026-08-19):
 *   1 Características · 3 Etapas y plazos · 4 Antecedentes a incluir · 6 Criterios de evaluación
 *   7 Montos y duración · 8 Garantías requeridas · 9 Requerimientos técnicos y otras cláusulas
 */
import type { AntecedentesLicitacion, SeccionFicha } from "./portal-ficha.js";
import type { LicitacionDetalle } from "./api.js";
import type { AdjuntoLeido } from "./adjuntos-locales.js";

export type NivelBandera = "bloqueante" | "atencion" | "favorable";

export interface Bandera {
  nivel: NivelBandera;
  titulo: string;
  /** Por qué se levanta, con el dato concreto que la origina. */
  motivo: string;
  /** Sección de la ficha (o "API") de donde salió el dato. */
  fuente: string;
}

export interface CriterioEvaluacion {
  nombre: string;
  ponderacion: number;
  observaciones?: string;
}

export interface GarantiaExigida {
  exigida: boolean;
  tipo?: string;
  monto?: string;
  beneficiario?: string;
  vencimiento?: string;
  glosa?: string;
}

export interface FechasClave {
  publicacion?: string;
  inicioPreguntas?: string;
  finPreguntas?: string;
  publicacionRespuestas?: string;
  cierre?: string;
  aperturaTecnica?: string;
  adjudicacion?: string;
  /** Días corridos entre ahora y el cierre (negativo si ya cerró). */
  diasHastaCierre?: number;
  /** `true` mientras se puedan hacer preguntas al organismo. */
  ventanaPreguntasAbierta?: boolean;
}

export interface CondicionesComerciales {
  montoEstimado?: number;
  moneda?: string;
  fuenteFinanciamiento?: string;
  duracionContrato?: string;
  renovacion?: string;
  plazoPago?: string;
  subcontratacion?: string;
}

export interface AnexosExigidos {
  total: number;
  porCategoria: { categoria: string; documentos: string[] }[];
}

export interface FichaDecision {
  codigo: string;
  nombre?: string;
  organismo?: string;
  generadaEn: string;
  /** ISO de cuándo se leyó la ficha pública: las bases cambian con aclaraciones. */
  antecedentesDe: string;
  estado?: string;
  tipo?: string;
  fechas: FechasClave;
  comerciales: CondicionesComerciales;
  garantia: GarantiaExigida;
  criterios: CriterioEvaluacion[];
  /** Cuánto pesa el precio en la evaluación, si se pudo identificar el criterio. */
  pesoPrecio?: number;
  /** Suma de las ponderaciones: si no da 100, el parseo se quedó corto o las bases no cuadran. */
  sumaPonderaciones?: number;
  anexos: AnexosExigidos;
  /** Exigencias detectadas por patrón en el texto de las bases, cada una con su cita. */
  exigencias: { requisito: string; evidencia: string; fuente: string }[];
  preguntas: { ingresadas?: number; ventana?: string };
  /** Adjuntos leídos desde disco, si alguien los bajó. Sin ellos la ficha lo dice explícitamente. */
  adjuntos: { leidos: AdjuntoLeido[]; caracteres: number; faltan: boolean };
  /** Cláusulas de las bases que dejan una oferta fuera. Es lo primero que hay que mirar. */
  clausulasExcluyentes: { texto: string; fuente: string }[];
  reclamosOrganismo?: number;
  banderas: Bandera[];
}

const MESES_MS = 24 * 60 * 60 * 1000;

function seccion(a: AntecedentesLicitacion, numero: number): SeccionFicha | undefined {
  return a.secciones.find((s) => s.numero === numero);
}

function lineas(texto: string | undefined): string[] {
  return (texto ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

/**
 * Valor de un campo "Etiqueta:" en el texto de una sección. El portal emite la etiqueta y el valor
 * en líneas separadas, así que se toma la línea siguiente; "No hay información" cuenta como vacío.
 */
function campo(texto: string | undefined, etiqueta: RegExp): string | undefined {
  const ls = lineas(texto);
  const i = ls.findIndex((l) => etiqueta.test(l));
  if (i === -1) return undefined;
  // El valor puede venir tras los dos puntos de la propia etiqueta o en la línea siguiente. No se
  // recorta por regex: "Fecha de cierre de recepción de la oferta:" dejaría "de la oferta:" como si
  // fuera el valor.
  const linea = ls[i] ?? "";
  const dosPuntos = linea.indexOf(":");
  const propio = dosPuntos >= 0 ? linea.slice(dosPuntos + 1).trim() : "";
  const valor = propio || ls[i + 1]?.trim();
  if (!valor || /^no hay informaci/i.test(valor) || /^sin informaci/i.test(valor)) return undefined;
  return valor;
}

function fechaChilena(valor: string | undefined): string | undefined {
  const m = valor?.match(/(\d{2})-(\d{2})-(\d{4})(?:\s+(\d{2}):(\d{2}))?/);
  if (!m) return undefined;
  const [, d, mes, anio, hh = "00", mm = "00"] = m;
  return `${anio}-${mes}-${d}T${hh}:${mm}:00`;
}

function extraerFechas(a: AntecedentesLicitacion, ahora: Date): FechasClave {
  const t = seccion(a, 3)?.texto;
  const fechas: FechasClave = {
    publicacion: fechaChilena(campo(t, /^Fecha de Publicaci[oó]n/i)),
    inicioPreguntas: fechaChilena(campo(t, /^Fecha inicio de preguntas/i)),
    finPreguntas: fechaChilena(campo(t, /^Fecha final de preguntas/i)),
    publicacionRespuestas: fechaChilena(campo(t, /^Fecha de publicaci[oó]n de respuestas/i)),
    cierre: fechaChilena(campo(t, /^Fecha de cierre de recepci[oó]n/i)),
    aperturaTecnica: fechaChilena(campo(t, /^Fecha de acto de apertura t[eé]cnica/i)),
    adjudicacion: fechaChilena(campo(t, /^Fecha de Adjudicaci[oó]n/i)),
  };
  if (fechas.cierre) {
    fechas.diasHastaCierre = Math.round((new Date(fechas.cierre).getTime() - ahora.getTime()) / MESES_MS);
  }
  if (fechas.finPreguntas) fechas.ventanaPreguntasAbierta = new Date(fechas.finPreguntas).getTime() > ahora.getTime();
  return fechas;
}

/**
 * Criterios de evaluación de la sección 6. El portal los emite como filas sueltas: número del ítem,
 * nombre, observaciones (0..n líneas) y la ponderación con `%`. Se recorre en ese orden y se corta
 * en cada `%`, que es el único delimitador confiable.
 */
export function parsearCriterios(texto: string | undefined): CriterioEvaluacion[] {
  const ls = lineas(texto).filter((l) => !/^(Ítem|Item)\s|Ponderaci[oó]n$/i.test(l) || /%$/.test(l));
  const criterios: CriterioEvaluacion[] = [];
  let nombre: string | undefined;
  let observaciones: string[] = [];
  for (const linea of ls) {
    const pct = linea.match(/^(\d{1,3}(?:[.,]\d+)?)\s*%$/);
    if (pct?.[1] && nombre) {
      criterios.push({
        nombre,
        ponderacion: Number(pct[1].replace(",", ".")),
        observaciones: observaciones.join(" ") || undefined,
      });
      nombre = undefined;
      observaciones = [];
      continue;
    }
    if (/^\d{1,2}$/.test(linea)) continue; // número de ítem
    if (!nombre) nombre = linea;
    else observaciones.push(linea);
  }
  return criterios;
}

function extraerGarantia(a: AntecedentesLicitacion): GarantiaExigida {
  const t = seccion(a, 8)?.texto;
  const ls = lineas(t);
  if (ls.length === 0 || ls.some((l) => /^No hay informaci[oó]n de Garant/i.test(l))) return { exigida: false };
  const monto = campo(t, /^Monto/i);
  // El portal parte "5" y "%" en dos líneas cuando la garantía es porcentual.
  const unidad = lineas(t)[lineas(t).findIndex((l) => /^Monto/i.test(l)) + 2];
  return {
    exigida: true,
    tipo: ls[0],
    monto: monto ? (unidad === "%" ? `${monto}%` : monto) : undefined,
    beneficiario: campo(t, /^Beneficiario/i),
    vencimiento: fechaChilena(campo(t, /^Fecha de vencimiento/i)),
    glosa: campo(t, /^Glosa/i),
  };
}

/** Anexos exigidos (sección 4), agrupados por las categorías que usa el portal. */
function extraerAnexos(a: AntecedentesLicitacion): AnexosExigidos {
  const ls = lineas(seccion(a, 4)?.texto);
  const porCategoria: { categoria: string; documentos: string[] }[] = [];
  let actual: { categoria: string; documentos: string[] } | undefined;
  for (const linea of ls) {
    if (/^Documentos\s+(Administrativos|T[eé]cnicos|Econ[oó]micos)/i.test(linea)) {
      actual = { categoria: linea, documentos: [] };
      porCategoria.push(actual);
      continue;
    }
    if (!actual) continue;
    if (/^\d+\.-$/.test(linea)) continue; // numeral suelto que el portal emite solo
    actual.documentos.push(linea.replace(/^[a-z]\)\s*/i, ""));
  }
  return { total: porCategoria.reduce((n, c) => n + c.documentos.length, 0), porCategoria };
}

/**
 * Exigencias que no viven en un campo sino en la prosa de las bases. Se buscan por patrón y se cita
 * la frase encontrada: no se afirma nada que no esté escrito en la ficha.
 */
const PATRONES_EXIGENCIA: { requisito: string; patron: RegExp }[] = [
  { requisito: "Visita a terreno", patron: /visita\s+(a\s+)?terreno[^.]{0,120}/i },
  { requisito: "Garantía de seriedad de la oferta", patron: /garant[ií]a\s+de\s+seriedad[^.]{0,120}/i },
  { requisito: "Experiencia mínima exigida", patron: /(experiencia\s+m[ií]nima|a[nñ]os\s+de\s+experiencia)[^.]{0,120}/i },
  { requisito: "Inscripción en Registro de Proveedores", patron: /registro\s+de\s+proveedores[^.]{0,120}/i },
  { requisito: "Declaración jurada", patron: /declaraci[oó]n\s+jurada[^.]{0,120}/i },
  { requisito: "Patente municipal", patron: /patente\s+municipal[^.]{0,120}/i },
  { requisito: "Certificación exigida", patron: /(certificaci[oó]n\s+ISO|norma\s+ISO)[^.]{0,120}/i },
  { requisito: "Multas por incumplimiento", patron: /multa[s]?\s+(de|por|equivalente)[^.]{0,120}/i },
  { requisito: "Presentación de muestras", patron: /muestra[s]?\s+(f[ií]sica|del\s+producto)[^.]{0,120}/i },
  { requisito: "Plazo de entrega / implementación", patron: /plazo\s+(m[aá]ximo\s+)?(de\s+)?(entrega|implementaci[oó]n|ejecuci[oó]n)[^.]{0,120}/i },
  { requisito: "Nivel de servicio (SLA)", patron: /(nivel(es)?\s+de\s+servicio|SLA|tiempo\s+de\s+respuesta)[^.]{0,120}/i },
  { requisito: "Capacitación a usuarios", patron: /capacitaci[oó]n[^.]{0,120}/i },
  { requisito: "Soporte y mantención", patron: /(soporte\s+t[eé]cnico|mantenci[oó]n)[^.]{0,120}/i },
  { requisito: "Boleta bancaria / vale vista", patron: /(boleta\s+bancaria|vale\s+vista|p[oó]liza\s+de\s+seguro)[^.]{0,120}/i },
  { requisito: "Reajuste o multa por atraso", patron: /(multa\s+diaria|por\s+cada\s+d[ií]a\s+de\s+atraso)[^.]{0,120}/i },
];

/**
 * Frases que dejan una oferta fuera. Se citan literales y con su origen: son la información con más
 * peso para decidir, y ninguna se resume ni se interpreta.
 */
const PATRON_EXCLUYENTE =
  /[^.\n]{0,140}(ser[aá]n?\s+declaradas?\s+inadmisibles?|quedar[aá]\s+fuera\s+de\s+bases|ser[aá]\s+rechazada|no\s+ser[aá]n?\s+evaluadas?|requisito\s+excluyente|car[aá]cter\s+excluyente|causal\s+de\s+inadmisibilidad)[^.\n]{0,140}/gi;

function extraerExcluyentes(fuentes: { texto: string; fuente: string }[]): { texto: string; fuente: string }[] {
  const encontradas: { texto: string; fuente: string }[] = [];
  for (const f of fuentes) {
    for (const m of f.texto.matchAll(PATRON_EXCLUYENTE)) {
      const texto = m[0].replace(/\s+/g, " ").trim();
      if (texto.length < 25) continue;
      if (encontradas.some((e) => e.texto === texto)) continue;
      encontradas.push({ texto, fuente: f.fuente });
      if (encontradas.length >= 12) return encontradas;
    }
  }
  return encontradas;
}

function extraerExigencias(fuentes: { texto: string; fuente: string }[]): FichaDecision["exigencias"] {
  const encontradas: FichaDecision["exigencias"] = [];
  for (const f of fuentes) {
    for (const { requisito, patron } of PATRONES_EXIGENCIA) {
      if (encontradas.some((e) => e.requisito === requisito)) continue;
      const m = f.texto.match(patron);
      if (m) {
        encontradas.push({ requisito, evidencia: m[0].replace(/\s+/g, " ").trim().slice(0, 160), fuente: f.fuente });
      }
    }
  }
  return encontradas;
}

/** Ficha pública y adjuntos, como una sola lista de textos citables. */
function fuentesDeTexto(a: AntecedentesLicitacion, textoAdjuntos: string): { texto: string; fuente: string }[] {
  const fuentes = a.secciones.map((s) => ({ texto: s.texto, fuente: `sección ${s.numero} (${s.titulo})` }));
  // Cada adjunto entra como su propia fuente para poder citar el archivo, no un genérico "adjuntos".
  for (const bloque of textoAdjuntos.split(/^===== (.+) =====$/m).slice(1).reduce<[string, string][]>((acc, valor, i, arr) => {
    if (i % 2 === 0) acc.push([valor, arr[i + 1] ?? ""]);
    return acc;
  }, [])) {
    fuentes.push({ texto: bloque[1], fuente: `adjunto ${bloque[0]}` });
  }
  return fuentes;
}

function extraerPreguntas(a: AntecedentesLicitacion, fechas: FechasClave): FichaDecision["preguntas"] {
  const ls = lineas(a.foro);
  // La tabla del foro trae una fila por pregunta; sin preguntas solo quedan los encabezados.
  const filas = ls.filter((l) => /^\d{1,3}$/.test(l)).length;
  const ventana =
    fechas.ventanaPreguntasAbierta === undefined
      ? undefined
      : fechas.ventanaPreguntasAbierta
        ? `abierta hasta ${fechas.finPreguntas}`
        : `cerrada el ${fechas.finPreguntas}`;
  return { ingresadas: a.foro ? filas : undefined, ventana };
}

function construirBanderas(f: FichaDecision): Bandera[] {
  const banderas: Bandera[] = [];
  const sec = (n: number, t: string) => `sección ${n} (${t})`;

  if (f.fechas.diasHastaCierre !== undefined && f.fechas.diasHastaCierre < 0) {
    banderas.push({
      nivel: "bloqueante",
      titulo: "El plazo ya cerró",
      motivo: `La recepción de ofertas cerró el ${f.fechas.cierre}.`,
      fuente: sec(3, "Etapas y plazos"),
    });
  } else if (f.fechas.diasHastaCierre !== undefined && f.fechas.diasHastaCierre <= 2) {
    banderas.push({
      nivel: "atencion",
      titulo: "Cierra en menos de 48 horas",
      motivo: `Quedan ~${f.fechas.diasHastaCierre} día(s) para presentar la oferta (cierre ${f.fechas.cierre}).`,
      fuente: sec(3, "Etapas y plazos"),
    });
  } else if ((f.fechas.diasHastaCierre ?? 0) >= 7) {
    banderas.push({
      nivel: "favorable",
      titulo: "Hay plazo para preparar la oferta",
      motivo: `Faltan ~${f.fechas.diasHastaCierre} días para el cierre.`,
      fuente: sec(3, "Etapas y plazos"),
    });
  }

  if (f.fechas.ventanaPreguntasAbierta === false) {
    banderas.push({
      nivel: "atencion",
      titulo: "Ya no se pueden hacer preguntas",
      motivo: `La ventana de consultas cerró el ${f.fechas.finPreguntas}: las dudas de las bases no se podrán aclarar.`,
      fuente: sec(3, "Etapas y plazos"),
    });
  } else if (f.fechas.ventanaPreguntasAbierta === true) {
    banderas.push({
      nivel: "favorable",
      titulo: "Se pueden hacer preguntas",
      motivo: `La ventana de consultas sigue abierta hasta ${f.fechas.finPreguntas}.`,
      fuente: sec(3, "Etapas y plazos"),
    });
  }

  if (f.garantia.exigida) {
    banderas.push({
      nivel: "atencion",
      titulo: "Exige garantía",
      motivo: `${f.garantia.tipo ?? "Garantía"}${f.garantia.monto ? ` por ${f.garantia.monto}` : ""}${
        f.garantia.vencimiento ? `, vigente hasta ${f.garantia.vencimiento}` : ""
      }. Hay que poder emitirla (costo financiero y plazo).`,
      fuente: sec(8, "Garantías requeridas"),
    });
  } else {
    banderas.push({
      nivel: "favorable",
      titulo: "Sin garantías exigidas",
      motivo: "La ficha no declara garantía de seriedad ni de fiel cumplimiento.",
      fuente: sec(8, "Garantías requeridas"),
    });
  }

  if (f.pesoPrecio !== undefined) {
    const subjetivo = 100 - f.pesoPrecio;
    banderas.push({
      nivel: f.pesoPrecio >= 40 ? "favorable" : "atencion",
      titulo: `El precio pesa ${f.pesoPrecio}%`,
      motivo: `${subjetivo}% de la evaluación depende de criterios técnicos y administrativos, no del precio.`,
      fuente: sec(6, "Criterios de evaluación"),
    });
  }

  if (f.sumaPonderaciones !== undefined && Math.abs(f.sumaPonderaciones - 100) > 0.5) {
    banderas.push({
      nivel: "atencion",
      titulo: "Las ponderaciones no suman 100%",
      motivo: `Suman ${f.sumaPonderaciones}%: puede faltar un criterio en la ficha, o el parseo se quedó corto. Revisar la sección 6 antes de decidir.`,
      fuente: sec(6, "Criterios de evaluación"),
    });
  }

  if (f.comerciales.subcontratacion && /no permite/i.test(f.comerciales.subcontratacion)) {
    banderas.push({
      nivel: "atencion",
      titulo: "Prohíbe subcontratación",
      motivo: "Todo el servicio debe prestarlo el propio oferente.",
      fuente: sec(7, "Montos y duración del contrato"),
    });
  }

  if (f.reclamosOrganismo !== undefined && f.reclamosOrganismo > 100) {
    banderas.push({
      nivel: "atencion",
      titulo: `El organismo acumula ${f.reclamosOrganismo} reclamos`,
      motivo: "Son reclamos recibidos por el comprador en el sistema, no de esta licitación: señal de trato con proveedores.",
      fuente: "API (CantidadReclamos)",
    });
  }

  if (f.clausulasExcluyentes.length > 0) {
    banderas.push({
      nivel: "atencion",
      titulo: `${f.clausulasExcluyentes.length} cláusula(s) que dejan la oferta fuera`,
      motivo: `La primera: “${f.clausulasExcluyentes[0]?.texto.slice(0, 120)}…”. Verificarlas antes de cotizar.`,
      fuente: f.clausulasExcluyentes[0]?.fuente ?? "bases",
    });
  }

  if (f.adjuntos.faltan) {
    banderas.push({
      nivel: "atencion",
      titulo: "Falta el detalle fino: no hay adjuntos leídos",
      motivo:
        "Esta ficha se armó solo con la ficha pública. Las bases administrativas y las EE.TT. en PDF " +
        "pueden traer exigencias que no aparecen ahí. Bajarlos a licitaciones/data/<codigo>/adjuntos/ " +
        "(un clic en el visor del portal, o `npm run adjuntos-licitacion -- <codigo> --con-login` desde " +
        "una máquina con IP residencial) y correr `npm run leer-adjuntos` para incorporarlos.",
      fuente: "estado local",
    });
  } else {
    const conTexto = f.adjuntos.leidos.filter((d) => d.caracteres > 0).length;
    banderas.push({
      nivel: conTexto === f.adjuntos.leidos.length ? "favorable" : "atencion",
      titulo: `${conTexto} de ${f.adjuntos.leidos.length} adjunto(s) leídos`,
      motivo:
        conTexto === f.adjuntos.leidos.length
          ? `${f.adjuntos.caracteres.toLocaleString("es-CL")} caracteres de bases y anexos incorporados a esta ficha.`
          : `Sin texto: ${f.adjuntos.leidos.filter((d) => !d.caracteres).map((d) => `${d.archivo} (${d.problema ?? "?"})`).join(", ")}.`,
      fuente: "adjuntos en disco",
    });
  }

  if (f.anexos.total > 0) {
    banderas.push({
      nivel: f.anexos.total >= 8 ? "atencion" : "favorable",
      titulo: `${f.anexos.total} documento(s) exigidos en la oferta`,
      motivo: f.anexos.porCategoria.map((c) => `${c.categoria}: ${c.documentos.length}`).join(" · "),
      fuente: sec(4, "Antecedentes para incluir en la oferta"),
    });
  }

  return banderas;
}

export function construirFichaDecision(
  a: AntecedentesLicitacion,
  detalle?: LicitacionDetalle | null,
  adjuntos: { documentos: AdjuntoLeido[]; texto: string } = { documentos: [], texto: "" },
  ahora: Date = new Date(),
): FichaDecision {
  const s1 = seccion(a, 1)?.texto;
  const s7 = seccion(a, 7)?.texto;
  const fechas = extraerFechas(a, ahora);
  const criterios = parsearCriterios(seccion(a, 6)?.texto);
  const precio = criterios.find((c) => /precio|oferta econ[oó]mica/i.test(c.nombre));
  const montoTexto = campo(s7, /^Monto Total Estimado/i);

  const ficha: FichaDecision = {
    codigo: a.codigo,
    nombre: campo(s1, /^Nombre de la licitaci[oó]n/i) ?? detalle?.Nombre,
    organismo: detalle?.Comprador?.NombreOrganismo,
    generadaEn: ahora.toISOString(),
    antecedentesDe: a.obtenidoEn,
    estado: campo(s1, /^Estado/i),
    tipo: campo(s1, /^Tipo de licitaci[oó]n/i) ?? detalle?.Tipo,
    fechas,
    comerciales: {
      montoEstimado: montoTexto ? Number(montoTexto.replace(/[^\d]/g, "")) || undefined : detalle?.MontoEstimado,
      moneda: campo(s1, /^Moneda/i) ?? detalle?.Moneda,
      fuenteFinanciamiento: campo(s7, /^Fuente de financiamiento/i),
      duracionContrato: campo(s7, /^Tiempo del Contrato/i),
      renovacion: campo(s7, /^Contrato con Renovaci[oó]n/i),
      plazoPago: campo(s7, /^Plazos de pago/i),
      subcontratacion: campo(s7, /^Prohibici[oó]n de subcontrataci[oó]n/i),
    },
    garantia: extraerGarantia(a),
    criterios,
    pesoPrecio: precio?.ponderacion,
    sumaPonderaciones: criterios.length ? Number(criterios.reduce((n, c) => n + c.ponderacion, 0).toFixed(2)) : undefined,
    anexos: extraerAnexos(a),
    exigencias: [],
    preguntas: extraerPreguntas(a, fechas),
    reclamosOrganismo: detalle?.CantidadReclamos,
    adjuntos: {
      leidos: adjuntos.documentos,
      caracteres: adjuntos.texto.length,
      faltan: adjuntos.documentos.length === 0,
    },
    clausulasExcluyentes: [],
    banderas: [],
  };
  const fuentes = fuentesDeTexto(a, adjuntos.texto);
  ficha.exigencias = extraerExigencias(fuentes);
  ficha.clausulasExcluyentes = extraerExcluyentes(fuentes);
  ficha.banderas = construirBanderas(ficha);
  return ficha;
}

const ICONO: Record<NivelBandera, string> = { bloqueante: "⛔", atencion: "⚠️", favorable: "✅" };

export function fichaDecisionAMarkdown(f: FichaDecision): string {
  const clp = (n?: number) => (n === undefined ? "no declarado" : `$${n.toLocaleString("es-CL")}`);
  const l: string[] = [
    `# Ficha de decisión — ${f.codigo}`,
    "",
    `> Generada el ${f.generadaEn} a partir de la ficha pública leída el ${f.antecedentesDe}.`,
    `> Cada dato cita su sección: lo que no aparece en la ficha queda vacío, no se completa por inferencia.`,
    "",
    "## ¿Vale la pena? — banderas",
    "",
  ];
  for (const b of f.banderas) l.push(`- ${ICONO[b.nivel]} **${b.titulo}** — ${b.motivo} _(${b.fuente})_`);
  l.push(
    "",
    "## Lo esencial",
    "",
    `| Dato | Valor |`,
    `|---|---|`,
    `| Nombre | ${f.nombre ?? "—"} |`,
    `| Organismo | ${f.organismo ?? "—"} |`,
    `| Estado | ${f.estado ?? "—"} |`,
    `| Tipo | ${f.tipo ?? "—"} |`,
    `| Tope (monto estimado) | ${clp(f.comerciales.montoEstimado)} ${f.comerciales.moneda ?? ""} |`,
    `| Cierre de ofertas | ${f.fechas.cierre ?? "—"} (${f.fechas.diasHastaCierre ?? "?"} días) |`,
    `| Preguntas | ${f.preguntas.ventana ?? "—"}${f.preguntas.ingresadas !== undefined ? ` · ${f.preguntas.ingresadas} ingresada(s)` : ""} |`,
    `| Adjudicación estimada | ${f.fechas.adjudicacion ?? "—"} |`,
    `| Duración del contrato | ${f.comerciales.duracionContrato ?? "—"} |`,
    `| Plazo de pago | ${f.comerciales.plazoPago ?? "—"} |`,
    `| Subcontratación | ${f.comerciales.subcontratacion ?? "—"} |`,
    `| Financiamiento | ${f.comerciales.fuenteFinanciamiento ?? "—"} |`,
    `| Garantía | ${
      f.garantia.exigida
        ? `${f.garantia.tipo ?? "exigida"}${f.garantia.monto ? ` · ${f.garantia.monto}` : ""}${
            f.garantia.vencimiento ? ` · vence ${f.garantia.vencimiento}` : ""
          }`
        : "no exige"
    } |`,
    "",
    "## Cómo se evalúa",
    "",
  );
  if (f.criterios.length === 0) l.push("_La ficha no publica criterios de evaluación parseables._", "");
  else {
    l.push(`| Criterio | Ponderación |`, `|---|---|`);
    for (const c of f.criterios) l.push(`| ${c.nombre} | ${c.ponderacion}% |`);
    l.push(`| **Suma** | **${f.sumaPonderaciones}%** |`, "");
  }
  l.push("## Qué hay que presentar", "");
  if (f.anexos.total === 0) l.push("_La ficha no detalla documentos exigidos._", "");
  else {
    for (const c of f.anexos.porCategoria) {
      l.push(`**${c.categoria}**`, "");
      for (const d of c.documentos) l.push(`- ${d}`);
      l.push("");
    }
  }
  if (f.clausulasExcluyentes.length > 0) {
    l.push("## Cláusulas que dejan la oferta fuera", "");
    for (const c of f.clausulasExcluyentes) l.push(`- “…${c.texto}…” _(${c.fuente})_`);
    l.push("");
  }
  l.push("## Documentos leídos para esta ficha", "");
  if (f.adjuntos.faltan) {
    l.push(
      "- Ficha pública del portal (9 secciones + foro).",
      "- ⚠️ **Sin adjuntos**: las bases administrativas y las EE.TT. en PDF no se leyeron, y suelen traer",
      "  el detalle que decide (multas, SLA, experiencia mínima, causales de inadmisibilidad). Ponerlos en",
      "  `licitaciones/data/<codigo>/adjuntos/` y correr `npm run leer-adjuntos -- <codigo>`.",
      "",
    );
  } else {
    l.push("- Ficha pública del portal (9 secciones + foro).");
    for (const d of f.adjuntos.leidos) {
      l.push(
        `- ${d.archivo} — ${d.formato}${d.paginas ? `, ${d.paginas} pág.` : ""}, ${d.caracteres.toLocaleString("es-CL")} car.` +
          (d.problema ? ` ⚠️ ${d.problema}` : ""),
      );
    }
    l.push("");
  }
  if (f.exigencias.length > 0) {
    l.push("## Exigencias detectadas en el texto de las bases y adjuntos", "");
    for (const e of f.exigencias) l.push(`- **${e.requisito}** — “${e.evidencia}” _(${e.fuente})_`);
    l.push("");
  }
  return l.join("\n");
}
