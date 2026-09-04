import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { ROOT_DIR } from "./config.js";
import type { FilaCumplimiento } from "./capacitacion-cotizacion.js";
import { GLOSA_TIPO, type CriterioDireccionador } from "./scoring-capacitacion.js";
import type { CartaPresentacion } from "./carta-presentacion.js";
import { TIPOS_DOCUMENTO, type EntradaDocumento, type TipoDocumento } from "./documentos-oferta.js";

const CONFIG_PATH = path.join(ROOT_DIR, "config", "capacitaciones.json");
const COMPANY_CONFIG_PATH = path.join(ROOT_DIR, "config", "company.json");

export interface ModuloCapacitacion {
  titulo: string;
  horas: number;
  temas: string[];
}

/**
 * Relator/a designado/a para la actividad, con la evidencia documental que acredita cada
 * requisito que el organismo exige. Es opcional a propósito: mientras una oportunidad no lo
 * declare, la propuesta sale diciendo "relator/a por designar" —el agente no inventa una persona
 * ni sus credenciales— y los criterios de relatoría siguen descontando score.
 *
 * `acredita` responde uno a uno a `relator_exigido`; `documentos` es lo que ya existe y se puede
 * adjuntar hoy, y `documentos_faltantes` lo que el organismo exige y todavía no está. Esa última
 * lista es la que impide dar por cerrada la admisibilidad: un antecedente declarado en el CV pero
 * sin su certificado adjunto no es un antecedente acreditado.
 */
export interface RelatorPropuesto {
  nombre: string;
  titulo: string;
  cargo: string;
  contacto: string;
  acredita: {
    formacion: string;
    experiencia_laboral: string;
    experiencia_relatoria: string;
  };
  /**
   * La misma acreditación en una línea por requisito. No es duplicación ociosa: el cuadro de
   * admisibilidad (el Anexo N°1) es una declaración de cumplimiento en una celda de tabla, no el
   * lugar del argumento — los párrafos de `acredita` puestos ahí desbordan la lámina y se recortan
   * en silencio, y un requisito recortado es un requisito no declarado.
   */
  acredita_breve: {
    formacion: string;
    experiencia_laboral: string;
    experiencia_relatoria: string;
  };
  documentos: string[];
  documentos_faltantes: string[];
  /** De dónde salieron los antecedentes. Mismo criterio que `fuente_documentos`: nada sin origen. */
  fuente: string;
}

export interface RequisitosCapacitacion {
  curso: string;
  organismo_corto: string;
  /**
   * Nombre oficial completo del organismo, cuando el que entrega la API viene mal.
   * `institucion.organismo_comprador` de la ficha llega **truncado** —el de esta compra es
   * "DIRECCION DE PRESUPUESTOS MINISTERIO DE", cortado justo antes del ministerio— y ese string
   * es el que encabeza la carátula y da nombre al archivo. Cuando está, manda este; si no,
   * se usa el de la ficha. Declararlo obliga a mirar `institucion.unidad_compra`, que es donde
   * el portal sí trae el organismo completo.
   */
  organismo_nombre?: string;
  fuente_documentos: string[];
  tributacion: {
    regimen: "exento" | "impuestos_incluidos" | "no_declarado";
    cita: string;
  };
  objetivo: string;
  participantes: { maximo: number; glosa: string };
  duracion: {
    horas_cronologicas: number;
    sesiones: number | null;
    horas_por_sesion: number | null;
    glosa: string;
  };
  modalidad: { tipo: string; plataforma: string; horario: string };
  modalidad_observacion?: string;
  fechas_ejecucion: string;
  modulos: ModuloCapacitacion[];
  modulos_nota: string;
  /**
   * Si el organismo listó los contenidos del curso o solo su estructura. Por defecto `true`: casi
   * todas estas bases traen un temario sugerido y el cuadro de cumplimiento declara que la
   * propuesta lo cubre "uno a uno, en el mismo orden". Cuando el TDR fija la estructura y no las
   * materias —1393495-768-COT26: dos niveles, seis módulos por curso, 90 minutos, y ni un
   * contenido— esa declaración le atribuye al organismo un temario que nunca escribió, dentro del
   * documento que se le presenta. Declararlo `false` cambia la fila por lo que de verdad pasa: los
   * módulos son propuesta de KeepSync sobre la estructura exigida.
   */
  contenidos_sugeridos_por_el_organismo?: boolean;
  requisitos_metodologicos?: string[];
  exigencias_adicionales?: string[];
  relator_exigido: {
    formacion: string;
    experiencia_laboral: string;
    experiencia_relatoria: string;
  };
  /** Relator/a designado/a, si ya lo hay. Ausente = la propuesta sale sin nombrar a nadie. */
  relator?: RelatorPropuesto;
  /**
   * Prosa de la carta de presentación. Solo el texto: la identidad del oferente y del relator la
   * arma `src/lib/carta-presentacion.ts` desde `relator` y `config/company.json`, para que la
   * carta no pueda quedar desactualizada respecto de la propuesta. Requiere `relator`: una carta
   * de presentación la firma una persona.
   */
  carta?: CartaPresentacion & { ciudad: string };
  entregables: string[];
  logistica: string;
  /**
   * Los documentos que exige el organismo, cada uno con su `tipo` (ver `documentos-oferta.ts`):
   * qué se rellena desde una plantilla, qué genera KeepSync y qué solo puede subirse porque lo
   * emite un tercero. Se acepta el `string` suelto histórico, que entra como `acopio`.
   */
  documentos_obligatorios_oferta: EntradaDocumento[];
  evaluacion: { tipo: "menor_precio" | "puntaje" | "no_declarado"; detalle: string[] };
  multas: string;
  pago: string;
  /**
   * Filtros de las bases que dirigen la adjudicación hacia un perfil de proveedor concreto, más
   * lo que hay que revisar y hoy no se sabe. Alimenta el score de apertura (ver
   * `src/lib/scoring-capacitacion.ts`). Cada uno lleva su cita: no se penaliza sin evidencia.
   */
  criterios_direccionadores: CriterioDireccionador[];
}

interface CapacitacionesConfig {
  cotizaciones: Record<string, RequisitosCapacitacion>;
}

export function loadCapacitacionesConfig(): CapacitacionesConfig {
  const raw = JSON.parse(readFileSync(CONFIG_PATH, "utf-8")) as CapacitacionesConfig;
  for (const [codigo, r] of Object.entries(raw.cotizaciones)) {
    // La suma de horas de los módulos es lo único que puede desalinearse en silencio al editar la
    // config a mano, y desalineada rompe justo el requisito que el organismo revisa primero
    // (la duración declarada). Se valida al cargar, no al renderizar.
    const suma = r.modulos.reduce((s, m) => s + m.horas, 0);
    if (suma !== r.duracion.horas_cronologicas) {
      throw new Error(
        `config/capacitaciones.json — ${codigo}: los módulos suman ${suma} horas pero la actividad ` +
          `declara ${r.duracion.horas_cronologicas} horas cronológicas. Corregir antes de cotizar: el ` +
          `organismo descarta las ofertas que no cumplen la duración exigida.`,
      );
    }

    // El score se publica como un porcentaje y la gente lo va a leer como un dato duro, así que
    // los criterios que lo producen se validan al cargar: sin cita no hay penalización defendible,
    // y un "cubierto" sin evidencia sube el score sin que nadie pueda auditar por qué.
    const criterios = r.criterios_direccionadores ?? [];
    if (criterios.length === 0) {
      throw new Error(
        `config/capacitaciones.json — ${codigo}: no declara 'criterios_direccionadores'. Si de verdad ` +
          `no tiene ninguno, declarar la lista vacía es una afirmación fuerte (score 100%): revisar los ` +
          `adjuntos antes de dejarlo así.`,
      );
    }
    const vistos = new Set<string>();
    for (const c of criterios) {
      if (vistos.has(c.id)) {
        throw new Error(`config/capacitaciones.json — ${codigo}: criterio duplicado "${c.id}"; contaría dos veces en el score.`);
      }
      vistos.add(c.id);
      if (!c.cita?.trim()) {
        throw new Error(`config/capacitaciones.json — ${codigo}/${c.id}: falta 'cita'. No se penaliza sin evidencia en los adjuntos.`);
      }
      if (!(c.tipo in GLOSA_TIPO)) {
        throw new Error(`config/capacitaciones.json — ${codigo}/${c.id}: tipo desconocido "${c.tipo}".`);
      }
      if (c.estado !== "sin_informacion" && c.estado !== "cubierto") {
        throw new Error(`config/capacitaciones.json — ${codigo}/${c.id}: estado inválido "${c.estado}".`);
      }
      if (c.estado === "cubierto" && !c.resuelto_por?.trim()) {
        throw new Error(
          `config/capacitaciones.json — ${codigo}/${c.id}: está marcado "cubierto" sin 'resuelto_por'. ` +
            `Dar por resuelto un criterio sube el score: tiene que decir con qué evidencia.`,
        );
      }
    }

    // El relator es el dato que el organismo revisa primero y el único del documento que nombra a
    // una persona real. Se valida al cargar por la misma razón que los criterios: nombrar a
    // alguien sin decir de qué documento salió su acreditación convierte la propuesta en una
    // afirmación no auditable.
    if (r.relator) {
      const faltantes = (["nombre", "titulo", "cargo", "contacto", "fuente"] as const).filter(
        (k) => !r.relator![k]?.trim(),
      );
      if (faltantes.length > 0) {
        throw new Error(
          `config/capacitaciones.json — ${codigo}/relator: falta ${faltantes.join(", ")}. ` +
            `Un relator/a designado/a va con nombre, título, cargo, contacto y el origen de sus antecedentes.`,
        );
      }
      for (const k of ["formacion", "experiencia_laboral", "experiencia_relatoria"] as const) {
        for (const campo of ["acredita", "acredita_breve"] as const) {
          if (!r.relator[campo]?.[k]?.trim()) {
            throw new Error(
              `config/capacitaciones.json — ${codigo}/relator: '${campo}.${k}' vacío. Cada exigencia de ` +
                `'relator_exigido' necesita su respuesta: el organismo las revisa una a una en admisibilidad.`,
            );
          }
        }
      }
      if (!Array.isArray(r.relator.documentos) || r.relator.documentos.length === 0) {
        throw new Error(
          `config/capacitaciones.json — ${codigo}/relator: 'documentos' vacío. Designar relator/a sin ` +
            `ningún antecedente adjuntable no cambia nada en admisibilidad.`,
        );
      }
      if (!Array.isArray(r.relator.documentos_faltantes)) {
        throw new Error(
          `config/capacitaciones.json — ${codigo}/relator: falta 'documentos_faltantes' (lista, vacía si ` +
            `no falta ninguno). Que esté vacía es una afirmación fuerte: dice que la carpeta de ` +
            `antecedentes está completa.`,
        );
      }
    }

    if (r.carta && !r.relator) {
      throw new Error(
        `config/capacitaciones.json — ${codigo}: declara 'carta' sin 'relator'. La carta de presentación ` +
          `la firma una persona: sin relator/a designado/a no hay membrete ni firma que poner.`,
      );
    }
    // El `tipo` de cada documento decide si el expediente puede generarlo o solo acopiarlo. Un tipo
    // mal escrito caería silenciosamente en `acopio` y el documento nunca se generaría, así que se
    // valida acá; y una plantilla declarada en algo que no es `formulario` no se usaría jamás.
    for (const doc of r.documentos_obligatorios_oferta ?? []) {
      if (typeof doc === "string") continue;
      if (!doc.documento?.trim()) {
        throw new Error(`config/capacitaciones.json — ${codigo}: un documento obligatorio no tiene nombre.`);
      }
      if (doc.tipo && !TIPOS_DOCUMENTO.includes(doc.tipo as TipoDocumento)) {
        throw new Error(
          `config/capacitaciones.json — ${codigo}: tipo de documento desconocido "${doc.tipo}" en ` +
            `"${doc.documento}". Válidos: ${TIPOS_DOCUMENTO.join(", ")}.`,
        );
      }
      if (doc.plantilla && doc.tipo !== "formulario") {
        throw new Error(
          `config/capacitaciones.json — ${codigo}: "${doc.documento}" declara plantilla pero su tipo es ` +
            `"${doc.tipo ?? "acopio"}". Solo los 'formulario' se rellenan desde una plantilla.`,
        );
      }
    }
  }
  return raw;
}

/**
 * Identidad del oferente que va en el PDF. `config/company.json` es un secreto gitignored y puede
 * no existir en el entorno donde corre esto (checkout limpio en la nube, por ejemplo). En vez de
 * abortar, se emite el documento con lo que haya y con la lista de lo que falta.
 *
 * La lectura es **campo por campo, no todo o nada**, y eso es lo que cambia el documento: antes
 * un solo dato pendiente hacía que la carátula dijera "KeepSync (razón social por confirmar)" y
 * escondiera el RUT real que sí estaba confirmado. Ahora el PDF publica lo confirmado —razón
 * social, RUT, domicilio, condición EMT, estado en el Registro de Proveedores— y nombra aparte lo
 * que sigue pendiente. `identidad_confirmada` se **deriva**: es cierto solo cuando no falta nada
 * y el archivo además lo afirma. Un booleano puesto a mano no puede subir por su cuenta.
 */
export interface IdentidadOferente {
  razon_social: string;
  nombre_fantasia: string | null;
  rut: string;
  direccion: string | null;
  giro: string | null;
  representante_legal: string | null;
  es_emt: boolean;
  estado_habilidad: string | null;
  /** AAAA-MM-DD hasta cuando está acreditada en el Registro de Proveedores. */
  acreditado_hasta: string | null;
  contacto_nombre: string | null;
  contacto_email: string;
  contacto_telefono: string | null;
  /** Qué falta para poder firmar y presentar, en glosa larga. Vacía = identidad completa. */
  campos_por_confirmar: string[];
  /** Los mismos campos en dos palabras, para el sello de la lámina, donde no cabe la glosa larga. */
  campos_por_confirmar_corto: string[];
  identidad_confirmada: boolean;
}

/** Los campos sin los cuales no se puede completar la carátula ni firmar los anexos. */
const CAMPOS_IDENTIDAD_EXIGIDOS: { campo: keyof IdentidadOferente; glosa: string; corta: string }[] = [
  { campo: "razon_social", glosa: "razón social", corta: "razón social" },
  { campo: "rut", glosa: "RUT", corta: "RUT" },
  { campo: "direccion", glosa: "domicilio legal", corta: "domicilio" },
  { campo: "representante_legal", glosa: "representante legal (nombre completo y RUN)", corta: "representante legal" },
  { campo: "giro", glosa: "giro declarado ante el SII", corta: "giro SII" },
];

const IDENTIDAD_DESCONOCIDA: IdentidadOferente = {
  razon_social: "KeepSync (razón social por confirmar)",
  nombre_fantasia: null,
  rut: "por confirmar",
  direccion: null,
  giro: null,
  representante_legal: null,
  es_emt: false,
  estado_habilidad: null,
  acreditado_hasta: null,
  contacto_nombre: null,
  contacto_email: "por confirmar",
  contacto_telefono: null,
  campos_por_confirmar: CAMPOS_IDENTIDAD_EXIGIDOS.map((c) => c.glosa),
  campos_por_confirmar_corto: CAMPOS_IDENTIDAD_EXIGIDOS.map((c) => c.corta),
  identidad_confirmada: false,
};

/** Trata "", null, y los placeholders del archivo de ejemplo como ausencia de dato. */
function valorODefault(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!t || /COMPLETAR/.test(t)) return null;
  return t;
}

export function cargarIdentidadOferente(): IdentidadOferente {
  if (!existsSync(COMPANY_CONFIG_PATH)) return IDENTIDAD_DESCONOCIDA;

  let c: Record<string, unknown>;
  try {
    c = JSON.parse(readFileSync(COMPANY_CONFIG_PATH, "utf-8")) as Record<string, unknown>;
  } catch {
    return IDENTIDAD_DESCONOCIDA;
  }

  const contacto = (c.contacto ?? {}) as Record<string, unknown>;
  const parcial: IdentidadOferente = {
    razon_social: valorODefault(c.razon_social) ?? IDENTIDAD_DESCONOCIDA.razon_social,
    nombre_fantasia: valorODefault(c.nombre_fantasia),
    rut: valorODefault(c.rut) ?? IDENTIDAD_DESCONOCIDA.rut,
    direccion: valorODefault(c.direccion),
    giro: valorODefault(c.giro),
    representante_legal: valorODefault(c.representante_legal),
    es_emt: c.es_emt === true,
    estado_habilidad: valorODefault(c.estado_habilidad),
    acreditado_hasta: valorODefault(c.acreditado_hasta),
    contacto_nombre: valorODefault(contacto.nombre),
    contacto_email: valorODefault(contacto.email) ?? IDENTIDAD_DESCONOCIDA.contacto_email,
    contacto_telefono: valorODefault(contacto.telefono),
    campos_por_confirmar: [],
    campos_por_confirmar_corto: [],
    identidad_confirmada: false,
  };

  const faltantes = CAMPOS_IDENTIDAD_EXIGIDOS.filter(({ campo }) => {
    const v = parcial[campo];
    return v === null || v === IDENTIDAD_DESCONOCIDA.razon_social || v === IDENTIDAD_DESCONOCIDA.rut;
  });
  parcial.campos_por_confirmar = faltantes.map((c2) => c2.glosa);
  parcial.campos_por_confirmar_corto = faltantes.map((c2) => c2.corta);

  // Doble llave: el archivo tiene que afirmarlo Y no puede faltar ningún campo. Que una persona
  // marque `identidad_confirmada: true` no alcanza si el representante legal sigue vacío, y tener
  // todos los campos tampoco alcanza si nadie los revisó contra el Registro de Proveedores.
  parcial.identidad_confirmada = c.identidad_confirmada === true && parcial.campos_por_confirmar.length === 0;
  return parcial;
}

/**
 * Arma el cuadro de cumplimiento que el organismo revisa en admisibilidad (en Dipres es
 * literalmente el Anexo N°1). La regla de fondo: lo que esta propuesta resuelve por sí sola
 * —programa, horas, cupos, modalidad, fechas, entregables, coordinación— se declara `cumple`;
 * todo lo que depende de una persona real con credenciales verificables se declara
 * `por-confirmar`. El agente no inventa un relator ni sus certificados.
 *
 * Cuando la config sí designa relator/a (`r.relator`), las tres filas de relatoría pasan a
 * `cumple` **con el antecedente que las respalda escrito en la respuesta** — salvo la que quede
 * cubierta por un documento que todavía no existe: un CV que declara veinte cursos dictados no
 * reemplaza los certificados que el organismo exige adjuntar, y esa fila sigue `por-confirmar`.
 */
export function derivarCumplimiento(r: RequisitosCapacitacion): FilaCumplimiento[] {
  const totalHoras = r.modulos.reduce((s, m) => s + m.horas, 0);
  const rel = r.relator;
  const sugiereContenidos = r.contenidos_sugeridos_por_el_organismo !== false;
  // Las respuestas son deliberadamente breves: el detalle completo ya está en las láminas de
  // programa y metodología, y esta tabla existe para la declaración cumple / no cumple que el
  // organismo revisa en admisibilidad. Repetir ahí los párrafos largos desbordaba la lámina.
  const filas: FilaCumplimiento[] = [
    {
      requisito: "Objetivos de aprendizaje de la actividad",
      estado: "cumple",
      respuesta: "El programa se estructura sobre el objetivo de aprendizaje declarado por el organismo (lámina 2).",
    },
    {
      requisito: sugiereContenidos
        ? "Contenidos de la capacitación, considerando los contenidos sugeridos"
        : "Contenidos de la capacitación",
      estado: "cumple",
      respuesta: sugiereContenidos
        ? `${r.modulos.length} módulos que cubren uno a uno los contenidos sugeridos, en el mismo orden (lámina 2).`
        : `${r.modulos.length} módulos propuestos por KeepSync sobre la estructura que fijan las bases, que no listan contenidos (lámina 2).`,
    },
    {
      requisito: "Cantidad de participantes solicitada",
      estado: "cumple",
      respuesta: r.participantes.glosa,
    },
    {
      requisito: "Duración de la actividad",
      estado: "cumple",
      respuesta: `${totalHoras} horas cronológicas distribuidas en el programa. ${r.duracion.glosa}`,
    },
    {
      requisito: "Modalidad y sede de la actividad",
      estado: r.modalidad_observacion ? "por-confirmar" : "cumple",
      // No se afirma *qué* dice la observación: no siempre es una contradicción de las bases
      // (a veces es una restricción, como fechas fijas o una modalidad justificada), y el texto
      // literal ya va íntegro en los pendientes de la lámina 5 y en la propuesta técnica.
      respuesta: r.modalidad_observacion
        ? `${r.modalidad.tipo}. Hay una observación sobre la modalidad que la propuesta recoge y consulta formalmente (ver lámina 5).`
        : `${r.modalidad.tipo}. ${r.modalidad.plataforma}`,
    },
    {
      requisito: "Fecha estimada de realización",
      estado: "cumple",
      respuesta: r.fechas_ejecucion,
    },
    {
      requisito: "Formación profesional/técnica del relator/a",
      estado: rel ? "cumple" : "por-confirmar",
      respuesta: rel
        ? `${rel.nombre} — ${rel.acredita_breve.formacion}`
        : "Requiere designar a la persona y adjuntar su título o certificado de título.",
    },
    {
      requisito: "Experiencia laboral del relator/a",
      estado: rel ? "cumple" : "por-confirmar",
      respuesta: rel
        ? rel.acredita_breve.experiencia_laboral
        : "Requiere adjuntar el currículum de la persona designada.",
    },
    {
      // La única de las tres que no se cierra con designar a la persona: el organismo pide el
      // respaldo documental de cada actividad, no su enumeración en el CV.
      requisito: "Experiencia en relatoría en el tema a capacitar",
      estado: rel && rel.documentos_faltantes.length === 0 ? "cumple" : "por-confirmar",
      respuesta: rel
        ? `${rel.acredita_breve.experiencia_relatoria}${
            rel.documentos_faltantes.length > 0
              ? ` Falta el respaldo documental que las acredita (${rel.documentos_faltantes.length} antecedente(s), detallados en la lámina 3).`
              : ""
          }`
        : "Requiere adjuntar los certificados, órdenes de compra o diplomas que la acrediten.",
    },
    {
      requisito: "Reuniones de coordinación previas al desarrollo",
      estado: "cumple",
      respuesta: "Consideradas: reunión de inicio con la contraparte técnica antes de programar las sesiones.",
    },
    {
      requisito: "Entregables de la actividad de capacitación",
      estado: "cumple",
      respuesta: `Los ${r.entregables.length} entregables exigidos están comprometidos (lámina 3).`,
    },
  ];

  if (r.exigencias_adicionales && r.exigencias_adicionales.length > 0) {
    filas.push({
      requisito: "Exigencias adicionales (equipamiento, licencias, material, evaluaciones)",
      estado: "por-confirmar",
      respuesta: `${r.exigencias_adicionales.length} exigencias con costo e infraestructura propios, detalladas en la lámina 3. Requieren confirmar capacidad de provisión antes de comprometer el precio.`,
    });
  }

  return filas;
}

/**
 * Lo que impide presentar esta oferta hoy. Se deriva de la config, no se escribe a mano por
 * oportunidad: si mañana KeepSync confirma su condición de OTEC o define un catálogo de costos,
 * el pendiente desaparece de los seis PDF a la vez.
 */
export function derivarPendientes(
  r: RequisitosCapacitacion,
  oferente: IdentidadOferente,
  descuentoPct: number,
): string[] {
  const p: string[] = [];

  if (!r.relator) {
    p.push(
      "Designar al relator/a y adjuntar título, currículum y certificados de los cursos dictados. " +
        "Sin esos antecedentes la oferta se descarta en admisibilidad, cualquiera sea el precio.",
    );
  } else if (r.relator.documentos_faltantes.length > 0) {
    // Designar al relator/a resuelve la mayor parte del bloqueo, pero no todo: lo que decide la
    // admisibilidad es lo que se adjunta, no lo que se declara. El pendiente pasa a nombrar
    // exactamente qué documento falta, que es accionable, en vez de repetir que falta "un relator".
    p.push(
      `Completar la carpeta de antecedentes de ${r.relator.nombre}: ${r.relator.documentos_faltantes.join("; ")}. ` +
        "El organismo exige el respaldo documental de cada actividad, no su enumeración en el currículum.",
    );
  }

  if (oferente.campos_por_confirmar.length > 0) {
    // Nombra los campos que faltan en vez de la categoría entera: con la razón social y el RUT ya
    // confirmados contra el Registro de Proveedores, decir "confirmar la identidad del oferente"
    // manda a buscar de nuevo datos que ya están.
    p.push(
      `Completar la identidad del oferente para la carátula y los anexos firmados: ` +
        `${oferente.campos_por_confirmar.join(", ")}. Ya confirmados contra el Registro de Proveedores: ` +
        `${oferente.razon_social}, RUT ${oferente.rut}.`,
    );
  }

  // Con `includes("otec")` esto se disparaba con **protección** —pr-otec-ción—, que aparece en
  // cualquier base que hable de datos personales: cinco de las dieciocho oportunidades llevaban el
  // pendiente afirmando que «estas bases lo puntúan o lo exigen» sin que sus bases nombraran nunca
  // a SENCE. Es la peor clase de defecto de este repo: una afirmación sobre las bases del organismo
  // que las bases no hacen, dentro de un PDF que se le presenta a ese organismo.
  const textoOtec = JSON.stringify(r).toLowerCase();
  if (/\botec\b|\bsence\b/.test(textoOtec)) {
    p.push(
      "Confirmar si KeepSync está registrada como OTEC en SENCE: estas bases lo puntúan o lo exigen, " +
        "y de ello depende además la exención de IVA del artículo 13 N°4.",
    );
  } else if (r.tributacion.regimen === "exento") {
    p.push(
      "Confirmar que KeepSync puede facturar exento por giro educacional (artículo 13 N°4 de la Ley " +
        "sobre Impuesto a las Ventas y Servicios). El organismo presupuestó el servicio como exento.",
    );
  }

  p.push(
    `Validar el precio: se ofertó un ${descuentoPct}% bajo el tope por regla del usuario, no desde un costo real. ` +
      (r.evaluacion.tipo === "menor_precio"
        ? "Este organismo selecciona por MENOR PRECIO TOTAL, así que el margen sobre el tope define directamente si se gana."
        : "Verificar que el valor cubra los costos de ejecución antes de comprometerlo."),
  );

  if (r.tributacion.regimen === "no_declarado") {
    p.push(
      "Consultar al organismo si el presupuesto informado es neto, con impuestos incluidos o exento: " +
        "sus bases no lo declaran y eso cambia el valor a ingresar en el portal.",
    );
  }

  if (r.modalidad_observacion) {
    p.push(`Confirmar la modalidad con el organismo mediante consulta formal. ${r.modalidad_observacion}`);
  }

  return p;
}
