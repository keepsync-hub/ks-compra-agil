/**
 * Extracción de contactos (nombre, correo, cargo, teléfono) desde el texto de una Compra Ágil y
 * de sus adjuntos, y su índice histórico versionado.
 *
 * Por qué existe: la API `/v2/compra-agil` **no expone ningún dato de contacto** — se verificó
 * pidiendo el detalle completo de una compra cerrada (`607-180-COT26`) y su payload no trae
 * comprador, requirente ni correo; lo único identificatorio es el organismo y su unidad de compra.
 * El nombre y el correo de la persona que pidió la compra viven en los ADJUNTOS (las EE.TT., la
 * "solicitud de cotización", el formulario de requerimiento), donde aparecen casi siempre como
 * "el proveedor deberá tomar contacto con … al correo electrónico X" o en el bloque de firma.
 *
 * Esos adjuntos se bajan por el servicio público `adjunto.mercadopublico.cl` (ver `adjuntos.ts`),
 * que **no gasta cuota del ticket de la API**: el barrido histórico de leads puede leer cientos de
 * documentos pagando cuota solo por los listados.
 *
 * Qué NO hace, a propósito:
 *
 * - **No inventa nombres.** Si el documento trae el correo pero no la persona, el lead queda con
 *   `nombre: null` y se publica igual — un buzón de adquisiciones es un lead válido. Cuando el
 *   nombre se dedujo del propio correo (`juan.perez@…`), se declara con confianza baja y se dice
 *   de dónde salió.
 * - **No afirma sin cita.** Cada contacto guarda la ventana de texto de donde se extrajo y el
 *   archivo, para que una persona pueda verificar en un vistazo antes de escribirle a nadie.
 * - **No clasifica a la persona como "interesada".** El interés se infiere de la compra a la que
 *   está asociada, que se publica al lado.
 */
import { existsSync, readFileSync, appendFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { ROOT_DIR } from "./config.js";

// ─────────────────────────────────────────────────────────────────────────────
// Tipos
// ─────────────────────────────────────────────────────────────────────────────

export type ConfianzaNombre = "alta" | "media" | "baja";

/** Un contacto tal como se leyó de UN documento, antes de cruzarlo con la compra. */
export interface ContactoExtraido {
  email: string;
  nombre: string | null;
  confianza_nombre: ConfianzaNombre | null;
  /** Cómo se obtuvo el nombre, en una frase corta y legible ("etiqueta «Contacto:»"). */
  origen_nombre: string | null;
  cargo: string | null;
  telefono: string | null;
  dominio: string;
  tipo_dominio: "institucional" | "correo genérico";
  /** `true` cuando el buzón es funcional (adquisiciones@, compras@) y no una persona. */
  buzon_funcional: boolean;
  /** Archivo de donde salió, o "(descripción de la compra)". */
  fuente: string;
  /** Ventana de texto alrededor del correo, para verificación humana. */
  cita: string;
}

/** Un lead: un contacto ya cruzado con la Compra Ágil que lo evidencia. */
export interface Lead extends ContactoExtraido {
  codigo: string;
  nombre_compra: string;
  estado: string;
  categorias: string[];
  organismo: string;
  rut_organismo: string;
  unidad_compra: string;
  region: number;
  nombre_region: string;
  fecha_publicacion: string;
  monto_disponible_clp: number;
  observado_en: string;
  hash: string;
}

/** Una compra ya revisada, se hayan encontrado contactos o no. Evita re-bajar sus adjuntos. */
export interface RevisionCompra {
  codigo: string;
  revisado_en: string;
  estado: string;
  categorias: string[];
  adjuntos_listados: number;
  adjuntos_leidos: number;
  /** Adjuntos que existen pero de los que no se pudo sacar texto (PDF escaneado, formato raro). */
  adjuntos_sin_texto: string[];
  contactos_encontrados: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Extracción
// ─────────────────────────────────────────────────────────────────────────────

const RE_EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;

/**
 * Dominios cuyo correo nunca es un lead: son la mesa de ayuda del propio portal, que aparece
 * copiada al pie de medio formulario de Compra Ágil. Sin este filtro, `mesadeayuda@chilecompra.cl`
 * sería —por lejos— el "lead" más frecuente del listado.
 */
const DOMINIOS_DESCARTADOS = new Set(["mercadopublico.cl", "chilecompra.cl", "example.com", "dominio.cl"]);

/** Buzones automáticos: no los atiende nadie. */
const LOCALES_DESCARTADOS = new Set(["noreply", "no-reply", "notificaciones", "mailerdaemon", "mailer-daemon"]);

/** Correo personal gratuito: sigue siendo un contacto válido, pero no acredita a la institución. */
const DOMINIOS_GENERICOS = new Set([
  "gmail.com",
  "gmail.cl",
  "hotmail.com",
  "hotmail.cl",
  "hotmail.es",
  "outlook.com",
  "outlook.cl",
  "outlook.es",
  "yahoo.com",
  "yahoo.es",
  "live.cl",
  "live.com",
  "icloud.com",
  "me.com",
]);

/**
 * Buzones de área, no de persona. Se conservan porque para este negocio son de los mejores
 * contactos que hay —quien compra licencias y capacitación en el Estado suele hacerlo desde
 * `adquisiciones@`—, pero se marcan para que nadie los salude por su nombre.
 */
const LOCALES_FUNCIONALES =
  /^(contacto|contactos|info|informacion|informaciones|soporte|ayuda|mesadeayuda|adquisicion|adquisiciones|compras|comprasypublicas|abastecimiento|oficinadepartes|partes|secretaria|recepcion|licitaciones|cotizaciones|proveedores|finanzas|administracion)$/;

/**
 * Palabras que aparecen en mayúscula junto a un correo y NO son el nombre de una persona. Sin esta
 * lista, "Especificaciones Técnicas" y "Municipalidad de Renca" se publicarían como leads con
 * nombre y apellido.
 */
const NO_ES_NOMBRE = new Set(
  [
    "direccion", "departamento", "depto", "division", "unidad", "municipalidad", "ilustre", "servicio",
    "servicios", "hospital", "ministerio", "subsecretaria", "gobierno", "regional", "nacional", "corporacion",
    "universidad", "instituto", "centro", "seremi", "delegacion", "presidencial", "provincial", "publico",
    "publica", "publicas", "estado", "chile", "chilena", "chileno", "region", "comuna", "sector",
    "licencia", "licencias", "compra", "compras", "agil", "cotizacion", "cotizaciones", "especificaciones",
    "tecnicas", "tecnico", "tecnica", "anexo", "anexos", "formulario", "requerimiento", "requerimientos",
    "producto", "productos", "proveedor", "proveedores", "oferta", "ofertas", "oferente", "plazo",
    "entrega", "precio", "precios", "total", "neto", "bruto", "iva", "rut", "run", "correo", "electronico",
    "electronica", "telefono", "fono", "contacto", "nombre", "cargo", "fecha", "item", "items", "monto",
    "presupuesto", "orden", "ordenes", "factura", "boleta", "informe", "acta", "resolucion", "decreto",
    "bases", "administrativas", "generales", "objeto", "antecedentes", "condiciones", "garantia",
    "inteligencia", "artificial", "claude", "anthropic", "power", "tableau", "curso", "cursos",
    "capacitacion", "capacitaciones", "taller", "software", "sistema", "sistemas", "plataforma",
    "suscripcion", "suscripciones", "usuario", "usuarios", "digital", "digitales", "datos", "gestion",
    "proyecto", "proyectos", "programa", "programas", "atencion", "consultas", "consulta", "dudas",
    "enviar", "enviarse", "dirigir", "dirigirse", "favor", "mail", "email", "srta", "estimados",
    "estimadas", "saluda", "atentamente", "cordialmente", "adjunto", "adjuntos", "pagina", "www",
  ].map(sinTildes),
);

/** Cargos que valen la pena publicar: dicen si el contacto decide, requiere o solo tramita. */
const RE_CARGO =
  /\b((?:jefe|jefa|jefatura|encargad[oa]|director[a]?|subdirector[a]?|coordinador[a]?|administrador[a]?|analista|profesional|asesor[a]?|supervisor[a]?|inspector[a]?\s+t[eé]cnic[oa]|secretari[oa]|gerente|subgerente|alcalde|alcaldesa)\b[^.,;:\n()]{0,55})/i;

/**
 * Exige etiqueta ("fono:", "celular") o el prefijo país. Sin eso, cualquier monto de ocho dígitos
 * —y estos documentos son una sucesión de montos— se publicaría como el teléfono del contacto.
 */
const RE_TELEFONO =
  /(?:tel[eé]fonos?|fonos?|celular|cel\.?|anexo)\s*:?\s*((?:\+?56[\s.-]?)?(?:\(?\d{1,2}\)?[\s.-]?)?\d{3,4}[\s.-]?\d{4})\b|(\+56[\s.-]?9[\s.-]?\d{4}[\s.-]?\d{4})\b/i;

/** Etiqueta explícita seguida del nombre: la señal más confiable que hay en estos documentos. */
const RE_ETIQUETA_NOMBRE = new RegExp(
  String.raw`\b(?:nombre(?:\s+(?:del?|de\s+la)\s+(?:contraparte|contacto|encargad[oa]|solicitante))?|contacto|contraparte|encargad[oa]|responsable|solicitante|referente|requirente|ITO|ITS)\b` +
    // El separador acepta tabulación además de ":": `xmlATexto` convierte cada celda de una tabla
    // .docx en un `\t`, y en estos formularios el par etiqueta/valor casi siempre son dos celdas
    // contiguas SIN dos puntos ("Nombre del contacto | Juan Pérez").
    String.raw`(?:\s+t[eé]cnic[oa])?(?:[ \t]*[:\-–][ \t]*|[ \t]*\t[ \t]*)([^\n:;\t]{4,70})`,
  "i",
);

/** Tratamiento + nombre ("Sr. Juan Pérez", "Doña María Soto"). */
const RE_TRATAMIENTO = /\b(?:sr\.?a?\.?|sra\.?|srta\.?|don|do[ñn]a)\s+((?:[A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚÑáéíóúñ']+[\s]+){1,3}[A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚÑáéíóúñ']+)/;

function sinTildes(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function normalizarEspacios(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** Título castellano: "JUAN PÉREZ SOTO" y "juan pérez soto" salen los dos como "Juan Pérez Soto". */
function aTitulo(s: string): string {
  const conectores = new Set(["de", "del", "la", "las", "los", "y", "da", "dos"]);
  return normalizarEspacios(s)
    .split(" ")
    .map((w, i) => {
      const bajo = w.toLocaleLowerCase("es-CL");
      if (i > 0 && conectores.has(bajo)) return bajo;
      return bajo.charAt(0).toLocaleUpperCase("es-CL") + bajo.slice(1);
    })
    .join(" ");
}

/**
 * ¿Esta secuencia de palabras puede ser el nombre de una persona? Dos a cuatro palabras, ninguna
 * de la lista negra, sin dígitos y sin palabras de una sola letra (que en estos PDF son casi
 * siempre restos de una tabla partida en columnas).
 */
function pareceNombreDePersona(candidato: string): boolean {
  const limpio = normalizarEspacios(candidato.replace(/[^\wÁÉÍÓÚÑáéíóúñ'\s-]/g, " "));
  if (!limpio) return false;
  const palabras = limpio.split(" ").filter((w) => !new Set(["de", "del", "la", "las", "los", "y"]).has(sinTildes(w)));
  if (palabras.length < 2 || palabras.length > 4) return false;
  return palabras.every((w) => {
    if (w.length < 2 || w.length > 20) return false;
    if (/\d/.test(w)) return false;
    if (NO_ES_NOMBRE.has(sinTildes(w))) return false;
    // Debe empezar en mayúscula: en estos documentos los nombres siempre van capitalizados o en
    // versales, y exigirlo descarta de una los fragmentos de prosa ("tomar contacto con el").
    return /^[A-ZÁÉÍÓÚÑ]/.test(w);
  });
}

/**
 * Del comienzo de un fragmento, el tramo más largo que puede ser un nombre. Existe porque la
 * etiqueta captura hasta el final del renglón —"Contacto: María Soto Correo electrónico"— y exigir
 * que TODO el fragmento sea nombre descartaba nombres buenos por lo que venía pegado detrás.
 */
function nombreAlComienzo(fragmento: string): string | null {
  const palabras = normalizarEspacios(fragmento.replace(/[^\wÁÉÍÓÚÑáéíóúñ'\s-]/g, " ")).split(" ");
  const tomadas: string[] = [];
  for (const w of palabras) {
    const conector = new Set(["de", "del", "la", "las", "los", "y"]).has(sinTildes(w));
    const valida = conector || (/^[A-ZÁÉÍÓÚÑ]/.test(w) && w.length >= 2 && w.length <= 20 && !/\d/.test(w) && !NO_ES_NOMBRE.has(sinTildes(w)));
    if (!valida) break;
    tomadas.push(w);
    if (tomadas.filter((x) => !new Set(["de", "del", "la", "las", "los", "y"]).has(sinTildes(x))).length === 4) break;
  }
  while (tomadas.length && new Set(["de", "del", "la", "las", "los", "y"]).has(sinTildes(tomadas[tomadas.length - 1]!))) tomadas.pop();
  const candidato = tomadas.join(" ");
  return pareceNombreDePersona(candidato) ? aTitulo(candidato) : null;
}

/** Toma las últimas palabras capitalizadas antes de una posición: el patrón de bloque de firma. */
function nombreAntesDe(texto: string, hasta: number): string | null {
  const previo = texto.slice(Math.max(0, hasta - 120), hasta);
  const m = previo.match(/((?:[A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚÑáéíóúñ']+[ \t]+){1,3}[A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚÑáéíóúñ']+)[\s,;:–-]*$/);
  if (!m?.[1]) return null;
  return pareceNombreDePersona(m[1]) ? aTitulo(m[1]) : null;
}

/** Deriva "Juan Pérez" de `juan.perez@…`. Solo cuando el separador lo hace inequívoco. */
function nombreDesdeLocal(local: string): string | null {
  const partes = local.toLowerCase().split(/[._-]/).filter(Boolean);
  if (partes.length < 2 || partes.length > 3) return null;
  if (partes.some((p) => p.length < 3 || /\d/.test(p) || NO_ES_NOMBRE.has(p))) return null;
  return aTitulo(partes.join(" "));
}

interface NombreHallado {
  nombre: string;
  confianza: ConfianzaNombre;
  origen: string;
}

/**
 * Busca a la persona detrás de un correo, en orden de confianza decreciente. Todas las señales se
 * evalúan sobre una ventana alrededor del correo y no sobre el documento entero: en una EE.TT. con
 * cinco correos, el nombre de más arriba pertenece a otra persona.
 */
function buscarNombre(ventanaAntes: string, ventanaDespues: string, local: string): NombreHallado | null {
  // 1. Etiqueta explícita ("Contacto: María Soto"), la última que aparece antes del correo.
  const etiquetas = [...ventanaAntes.matchAll(new RegExp(RE_ETIQUETA_NOMBRE.source, "gi"))];
  for (let i = etiquetas.length - 1; i >= 0; i--) {
    const fragmento = etiquetas[i]?.[1];
    const nombre = fragmento ? nombreAlComienzo(fragmento) : null;
    if (nombre) return { nombre, confianza: "alta", origen: "etiqueta explícita en el documento" };
  }
  // 2. Tratamiento ("Sr. Juan Pérez").
  const trato = ventanaAntes.match(RE_TRATAMIENTO) ?? ventanaDespues.match(RE_TRATAMIENTO);
  const conTrato = trato?.[1] ? nombreAlComienzo(trato[1]) : null;
  if (conTrato) return { nombre: conTrato, confianza: "alta", origen: "tratamiento (Sr./Sra./don/doña)" };
  // 3. Bloque de firma: nombre pegado justo antes del correo.
  const firma = nombreAntesDe(ventanaAntes, ventanaAntes.length);
  if (firma) return { nombre: firma, confianza: "media", origen: "nombre inmediatamente anterior al correo" };
  // 4. Nombre justo después (formato "correo — Juan Pérez").
  const despues = ventanaDespues.match(/^[\s,;:–-]*((?:[A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚÑáéíóúñ']+[ \t]+){1,3}[A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚÑáéíóúñ']+)/);
  if (despues?.[1] && pareceNombreDePersona(despues[1])) {
    return { nombre: aTitulo(despues[1]), confianza: "media", origen: "nombre inmediatamente posterior al correo" };
  }
  // 5. Último recurso: deducirlo del propio correo. Se declara como deducción, nunca como dato.
  const deducido = nombreDesdeLocal(local);
  if (deducido) return { nombre: deducido, confianza: "baja", origen: "deducido del correo, no leído del documento" };
  return null;
}

/**
 * Recorta la cola del cargo. El patrón captura hasta 55 caracteres sin puntuación, y en estos
 * documentos eso suele arrastrar la frase que sigue: "encargado de la recepción de las licencias
 * **al correo electrónico**". Se corta en la preposición que abre esa cola.
 */
function limpiarCargo(bruto: string | null): string | null {
  if (!bruto) return null;
  const cortado = normalizarEspacios(bruto)
    .replace(/\s+(?:al?|a\s+la|por|mediante|v[ií]a|escribiendo|enviando)\s+(?:el\s+|los\s+)?(?:correos?|e-?mails?|mails?|tel[eé]fonos?|fonos?)\b.*$/i, "")
    .replace(/\s+(?:cuyo|quien|quienes|para|con|y)\s*$/i, "")
    .replace(/[\s,;:.-]+$/, "");
  // Un "cargo" de una sola palabra genérica ("encargado") no dice nada que la tarjeta no diga ya.
  return cortado.split(" ").length >= 2 && cortado.length >= 6 ? cortado : null;
}

/** La última coincidencia de `re` en `texto` — la más cercana al correo cuando se mira hacia atrás. */
function ultimaCoincidencia(texto: string, re: RegExp): string | null {
  const todas = [...texto.matchAll(new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g"))];
  const ultima = todas[todas.length - 1];
  return ultima?.[1] ?? null;
}

/**
 * Todos los contactos de un texto. Nunca lanza: un documento raro devuelve `[]`, no rompe el
 * barrido. Deduplica por correo dentro del mismo documento, quedándose con la mejor evidencia.
 */
export function extraerContactos(texto: string, fuente: string): ContactoExtraido[] {
  if (!texto) return [];
  const porEmail = new Map<string, ContactoExtraido>();
  for (const m of texto.matchAll(RE_EMAIL)) {
    const crudo = m[0];
    const inicio = m.index ?? 0;
    // Un punto o guion final es puntuación de la frase, no parte del dominio.
    const email = crudo.replace(/[.\-_]+$/, "").toLowerCase();
    const arroba = email.lastIndexOf("@");
    if (arroba < 1) continue;
    const local = email.slice(0, arroba);
    const dominio = email.slice(arroba + 1);
    if (!dominio.includes(".") || dominio.endsWith(".")) continue;
    if (DOMINIOS_DESCARTADOS.has(dominio)) continue;
    if (LOCALES_DESCARTADOS.has(local.replace(/[._-]/g, ""))) continue;
    // Falsos positivos típicos de PDF: "3.5@2x.png", "v1.0@build".
    if (/\.(png|jpg|jpeg|gif|pdf|docx?|xlsx?)$/.test(dominio)) continue;

    const antes = texto.slice(Math.max(0, inicio - 260), inicio);
    const despues = texto.slice(inicio + crudo.length, inicio + crudo.length + 160);
    const hallado = buscarNombre(antes, despues, local);
    const cargoM = ultimaCoincidencia(antes, RE_CARGO) ?? despues.match(RE_CARGO)?.[1] ?? null;
    const telM = (antes.slice(-160) + " " + despues).match(RE_TELEFONO);
    const telefono = telM ? (telM[1] ?? telM[2] ?? null) : null;

    const contacto: ContactoExtraido = {
      email,
      nombre: hallado?.nombre ?? null,
      confianza_nombre: hallado?.confianza ?? null,
      origen_nombre: hallado?.origen ?? null,
      cargo: limpiarCargo(cargoM),
      telefono: telefono ? normalizarEspacios(telefono) : null,
      dominio,
      tipo_dominio: DOMINIOS_GENERICOS.has(dominio) ? "correo genérico" : "institucional",
      buzon_funcional: LOCALES_FUNCIONALES.test(sinTildes(local).replace(/[._-]/g, "")),
      fuente,
      cita: normalizarEspacios(`…${antes.slice(-150)}${crudo}${despues.slice(0, 90)}…`),
    };

    const previo = porEmail.get(email);
    if (!previo || mejorContacto(contacto, previo)) porEmail.set(email, contacto);
  }
  return [...porEmail.values()];
}

const RANGO_CONFIANZA: Record<ConfianzaNombre, number> = { alta: 3, media: 2, baja: 1 };

/** ¿`a` aporta más que `b` sobre la misma persona? Más nombre, mejor confianza, más cargo. */
export function mejorContacto(a: ContactoExtraido, b: ContactoExtraido): boolean {
  const puntaje = (c: ContactoExtraido) =>
    (c.nombre ? 10 : 0) + (c.confianza_nombre ? RANGO_CONFIANZA[c.confianza_nombre] : 0) + (c.cargo ? 2 : 0) + (c.telefono ? 1 : 0);
  return puntaje(a) > puntaje(b);
}

// ─────────────────────────────────────────────────────────────────────────────
// Índice histórico versionado
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Los dos archivos van a `historico/` (versionado) y no a `data/` (gitignored y efímero) por la
 * misma razón que `observaciones.jsonl`: el barrido histórico se acumula corrida a corrida y tiene
 * que sobrevivir al checkout limpio con el que corre el agente en la nube. Sin eso, cada corrida
 * empezaría de cero y volvería a bajar los mismos cientos de adjuntos.
 */
const LEADS_PATH = path.join(ROOT_DIR, "historico", "leads.jsonl");
const REVISIONES_PATH = path.join(ROOT_DIR, "historico", "leads-revisiones.jsonl");

/** Mismo límite que `indice.ts`: `appendFileSync` solo es atómico bajo PIPE_BUF (4096 en Linux). */
const MAX_BYTES_LINEA = 4000;
const MAX_CHARS_CITA = 400;

function leerJsonl<T>(p: string): T[] {
  if (!existsSync(p)) return [];
  const lineas = readFileSync(p, "utf-8").split("\n");
  const out: T[] = [];
  for (const l of lineas) {
    if (!l.trim()) continue;
    try {
      out.push(JSON.parse(l) as T);
    } catch {
      // Una línea corrupta no puede costar el índice entero.
    }
  }
  return out;
}

export function leerLeads(): Lead[] {
  return leerJsonl<Lead>(LEADS_PATH);
}

export function leerRevisiones(): RevisionCompra[] {
  return leerJsonl<RevisionCompra>(REVISIONES_PATH);
}

/** Última revisión conocida por código: con qué compras ya no hace falta gastar descargas. */
export function revisionesPorCodigo(): Map<string, RevisionCompra> {
  const mapa = new Map<string, RevisionCompra>();
  for (const r of leerRevisiones()) {
    const actual = mapa.get(r.codigo);
    if (!actual || r.revisado_en > actual.revisado_en) mapa.set(r.codigo, r);
  }
  return mapa;
}

function hashLead(l: Omit<Lead, "hash" | "observado_en">): string {
  return createHash("sha256").update(JSON.stringify(l)).digest("hex").slice(0, 16);
}

/** Anexa un lead solo si (código, correo) es nuevo o cambió algo. Idempotente entre corridas. */
export function anexarLead(lead: Omit<Lead, "hash">, yaConocidos: Map<string, string>): boolean {
  const { hash: _h, observado_en: _o, ...comparable } = { ...lead, hash: "" };
  const hash = hashLead(comparable);
  const clave = `${lead.codigo}|${lead.email}`;
  if (yaConocidos.get(clave) === hash) return false;

  const completo: Lead = { ...lead, hash, cita: recortar(lead.cita, MAX_CHARS_CITA) };
  let linea = JSON.stringify(completo);
  if (Buffer.byteLength(linea, "utf-8") >= MAX_BYTES_LINEA) {
    completo.cita = recortar(completo.cita, 120);
    linea = JSON.stringify(completo);
    if (Buffer.byteLength(linea, "utf-8") >= MAX_BYTES_LINEA) return false;
  }
  mkdirSync(path.dirname(LEADS_PATH), { recursive: true });
  appendFileSync(LEADS_PATH, linea + "\n", "utf-8");
  yaConocidos.set(clave, hash);
  return true;
}

export function hashesConocidos(): Map<string, string> {
  const mapa = new Map<string, string>();
  for (const l of leerLeads()) mapa.set(`${l.codigo}|${l.email}`, l.hash);
  return mapa;
}

export function anexarRevision(r: RevisionCompra): void {
  mkdirSync(path.dirname(REVISIONES_PATH), { recursive: true });
  const acotada: RevisionCompra = { ...r, adjuntos_sin_texto: r.adjuntos_sin_texto.slice(0, 10) };
  appendFileSync(REVISIONES_PATH, JSON.stringify(acotada) + "\n", "utf-8");
}

function recortar(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + "…" : s;
}

// ─────────────────────────────────────────────────────────────────────────────
// Consolidación para publicar
// ─────────────────────────────────────────────────────────────────────────────

/** Una persona (o buzón) con todas las compras que la evidencian. Es la unidad de la página. */
export interface LeadConsolidado {
  email: string;
  nombre: string | null;
  confianza_nombre: ConfianzaNombre | null;
  origen_nombre: string | null;
  cargo: string | null;
  telefono: string | null;
  dominio: string;
  tipo_dominio: "institucional" | "correo genérico";
  buzon_funcional: boolean;
  organismo: string;
  unidad_compra: string;
  nombre_region: string;
  categorias: string[];
  compras: {
    codigo: string;
    nombre: string;
    estado: string;
    fecha_publicacion: string;
    monto_disponible_clp: number;
    categorias: string[];
    fuente: string;
    cita: string;
  }[];
  /** La más reciente de sus compras: ordena el listado por "qué tan caliente está el lead". */
  ultima_fecha: string;
}

/**
 * Agrupa el índice por correo. Un mismo correo puede aparecer en varias compras y en varios
 * organismos (un jefe de compras que se cambió de servicio); se conserva el organismo de la compra
 * más reciente y se listan todas las compras abajo.
 */
export function consolidar(leads: Lead[]): LeadConsolidado[] {
  // Una corrida posterior con un extractor mejor vuelve a anexar el mismo (código, correo) con más
  // datos; acá manda la observación MÁS NUEVA de cada par, no la primera que se escribió.
  const ultimaPorPar = new Map<string, Lead>();
  for (const l of leads) {
    const clave = `${l.codigo}|${l.email}`;
    const previa = ultimaPorPar.get(clave);
    if (!previa || l.observado_en >= previa.observado_en) ultimaPorPar.set(clave, l);
  }
  const porEmail = new Map<string, LeadConsolidado>();
  const ordenados = [...ultimaPorPar.values()].sort((a, b) => a.fecha_publicacion.localeCompare(b.fecha_publicacion));
  for (const l of ordenados) {
    let c = porEmail.get(l.email);
    if (!c) {
      c = {
        email: l.email,
        nombre: null,
        confianza_nombre: null,
        origen_nombre: null,
        cargo: null,
        telefono: null,
        dominio: l.dominio,
        tipo_dominio: l.tipo_dominio,
        buzon_funcional: l.buzon_funcional,
        organismo: l.organismo,
        unidad_compra: l.unidad_compra,
        nombre_region: l.nombre_region,
        categorias: [],
        compras: [],
        ultima_fecha: l.fecha_publicacion,
      };
      porEmail.set(l.email, c);
    }
    // Se recorre de la compra más vieja a la más nueva: lo último que se escribe es lo más fresco.
    if (l.nombre) {
      const mejora = !c.nombre || RANGO_CONFIANZA[l.confianza_nombre ?? "baja"] >= RANGO_CONFIANZA[c.confianza_nombre ?? "baja"];
      if (mejora) {
        c.nombre = l.nombre;
        c.confianza_nombre = l.confianza_nombre;
        c.origen_nombre = l.origen_nombre;
      }
    }
    if (l.cargo) c.cargo = l.cargo;
    if (l.telefono) c.telefono = l.telefono;
    c.organismo = l.organismo;
    c.unidad_compra = l.unidad_compra;
    c.nombre_region = l.nombre_region;
    c.ultima_fecha = l.fecha_publicacion;
    for (const cat of l.categorias) if (!c.categorias.includes(cat)) c.categorias.push(cat);
    if (!c.compras.some((x) => x.codigo === l.codigo)) {
      c.compras.push({
        codigo: l.codigo,
        nombre: l.nombre_compra,
        estado: l.estado,
        fecha_publicacion: l.fecha_publicacion,
        monto_disponible_clp: l.monto_disponible_clp,
        categorias: l.categorias,
        fuente: l.fuente,
        cita: l.cita,
      });
    }
  }
  return [...porEmail.values()].sort((a, b) => {
    // Primero quien compró más veces (repetidor = lead más caliente), luego el más reciente.
    if (b.compras.length !== a.compras.length) return b.compras.length - a.compras.length;
    return b.ultima_fecha.localeCompare(a.ultima_fecha);
  });
}

/** CSV con el separador `;`, que es el que Excel en español abre sin pedir nada. */
export function aCsv(consolidados: LeadConsolidado[]): string {
  const esc = (v: string | number | null) => {
    const s = v == null ? "" : String(v);
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const filas = [
    [
      "nombre",
      "confianza_nombre",
      "email",
      "cargo",
      "telefono",
      "organismo",
      "unidad_compra",
      "region",
      "tipo_dominio",
      "buzon_funcional",
      "compras",
      "codigos",
      "categorias",
      "ultima_compra",
    ].join(";"),
  ];
  for (const c of consolidados) {
    filas.push(
      [
        esc(c.nombre),
        esc(c.confianza_nombre),
        esc(c.email),
        esc(c.cargo),
        esc(c.telefono),
        esc(c.organismo),
        esc(c.unidad_compra),
        esc(c.nombre_region),
        esc(c.tipo_dominio),
        esc(c.buzon_funcional ? "sí" : "no"),
        esc(c.compras.length),
        esc(c.compras.map((x) => x.codigo).join(" ")),
        esc(c.categorias.join(" ")),
        esc(c.ultima_fecha),
      ].join(";"),
    );
  }
  return filas.join("\n");
}
