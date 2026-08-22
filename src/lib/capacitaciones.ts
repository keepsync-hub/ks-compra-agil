import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { ROOT_DIR } from "./config.js";
import type { FilaCumplimiento } from "./capacitacion-cotizacion.js";
import { GLOSA_TIPO, type CriterioDireccionador } from "./scoring-capacitacion.js";
import { TIPOS_DOCUMENTO, type EntradaDocumento, type TipoDocumento } from "./documentos-oferta.js";

const CONFIG_PATH = path.join(ROOT_DIR, "config", "capacitaciones.json");
const COMPANY_CONFIG_PATH = path.join(ROOT_DIR, "config", "company.json");

export interface ModuloCapacitacion {
  titulo: string;
  horas: number;
  temas: string[];
}

export interface RequisitosCapacitacion {
  curso: string;
  organismo_corto: string;
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
  requisitos_metodologicos?: string[];
  exigencias_adicionales?: string[];
  relator_exigido: {
    formacion: string;
    experiencia_laboral: string;
    experiencia_relatoria: string;
  };
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
 * abortar, se emite el documento con la identidad marcada como NO confirmada, que es lo que hace
 * que cada lámina salga estampada "BORRADOR": el precio y la propuesta técnica siguen siendo
 * útiles para revisar, y la identidad la completa una persona antes de presentar.
 */
export interface IdentidadOferente {
  razon_social: string;
  rut: string;
  contacto_email: string;
  identidad_confirmada: boolean;
}

export function cargarIdentidadOferente(): IdentidadOferente {
  if (!existsSync(COMPANY_CONFIG_PATH)) {
    return {
      razon_social: "KeepSync (razón social por confirmar)",
      rut: "por confirmar",
      contacto_email: "por confirmar",
      identidad_confirmada: false,
    };
  }
  const raw = readFileSync(COMPANY_CONFIG_PATH, "utf-8");
  if (/COMPLETAR/.test(raw)) {
    return {
      razon_social: "KeepSync (razón social por confirmar)",
      rut: "por confirmar",
      contacto_email: "por confirmar",
      identidad_confirmada: false,
    };
  }
  const c = JSON.parse(raw) as {
    razon_social: string;
    rut: string;
    identidad_confirmada: boolean;
    contacto: { email: string };
  };
  return {
    razon_social: c.razon_social,
    rut: c.rut,
    contacto_email: c.contacto.email,
    identidad_confirmada: c.identidad_confirmada === true,
  };
}

/**
 * Arma el cuadro de cumplimiento que el organismo revisa en admisibilidad (en Dipres es
 * literalmente el Anexo N°1). La regla de fondo: lo que esta propuesta resuelve por sí sola
 * —programa, horas, cupos, modalidad, fechas, entregables, coordinación— se declara `cumple`;
 * todo lo que depende de una persona real con credenciales verificables se declara
 * `por-confirmar`. El agente no inventa un relator ni sus certificados.
 */
export function derivarCumplimiento(r: RequisitosCapacitacion): FilaCumplimiento[] {
  const totalHoras = r.modulos.reduce((s, m) => s + m.horas, 0);
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
      requisito: "Contenidos de la capacitación, considerando los contenidos sugeridos",
      estado: "cumple",
      respuesta: `${r.modulos.length} módulos que cubren uno a uno los contenidos sugeridos, en el mismo orden (lámina 2).`,
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
      respuesta: r.modalidad_observacion
        ? "Las bases se contradicen entre modalidad e-learning y ejecución presencial; la propuesta cubre ambas lecturas y se consulta formalmente (ver lámina 5)."
        : `${r.modalidad.tipo}. ${r.modalidad.plataforma}`,
    },
    {
      requisito: "Fecha estimada de realización",
      estado: "cumple",
      respuesta: r.fechas_ejecucion,
    },
    {
      requisito: "Formación profesional/técnica del relator/a",
      estado: "por-confirmar",
      respuesta: "Requiere designar a la persona y adjuntar su título o certificado de título.",
    },
    {
      requisito: "Experiencia laboral del relator/a",
      estado: "por-confirmar",
      respuesta: "Requiere adjuntar el currículum de la persona designada.",
    },
    {
      requisito: "Experiencia en relatoría en el tema a capacitar",
      estado: "por-confirmar",
      respuesta: "Requiere adjuntar los certificados, órdenes de compra o diplomas que la acrediten.",
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

  p.push(
    "Designar al relator/a y adjuntar título, currículum y certificados de los cursos dictados. " +
      "Sin esos antecedentes la oferta se descarta en admisibilidad, cualquiera sea el precio.",
  );

  if (!oferente.identidad_confirmada) {
    p.push(
      "Confirmar la identidad del oferente (razón social, RUT, representante legal y contacto) para " +
        "completar la carátula y los anexos firmados.",
    );
  }

  const textoOtec = JSON.stringify(r).toLowerCase();
  if (textoOtec.includes("otec") || textoOtec.includes("sence")) {
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
    p.push(`Aclarar la contradicción de modalidad en las bases mediante consulta formal. ${r.modalidad_observacion}`);
  }

  return p;
}
