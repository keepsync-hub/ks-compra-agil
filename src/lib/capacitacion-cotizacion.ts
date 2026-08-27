import { readFileSync, mkdtempSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import type { IdentidadOferente } from "./capacitaciones.js";
import type { RequisitosCapacitacion } from "./capacitaciones.js";
import { normalizarDocumentos } from "./documentos-oferta.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOGO_PATH = path.join(__dirname, "..", "assets", "logo-keepsync-blanco.png");
// Chromium: el entorno manda. En esta máquina vive en /opt/pw-browsers; en un runner de CI no
// existe esa ruta y hay que dejar que Playwright use el que instaló. Misma convención que
// licitaciones/src/scripts/login-portal.ts.
const CHROMIUM_PATH =
  process.env.CHROMIUM_EXECUTABLE_PATH ||
  (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);

/** Mismo sistema de color que la cotización de Array y la de licencias Claude. */
const COLOR = {
  bg: "#0E0E17",
  card: "#161527",
  cardAlt: "#1D1B33",
  border: "#2A2844",
  accent: "#786CF0",
  accentLight: "#B4AAFA",
  white: "#FFFFFF",
  gray: "#9A9FB0",
  warn: "#FB7185",
  ok: "#34D399",
};

const MESES_ES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

function formatoClp(n: number): string {
  return "$" + Math.round(n).toLocaleString("es-CL");
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Una fila del cuadro de cumplimiento (el que el Anexo N°1 de Dipres pide marcar con "X").
 * `estado` es lo que separa lo que esta propuesta ya resuelve de lo que necesita un dato que
 * el agente no puede inventar (la identidad y las credenciales de un relator real).
 */
export interface FilaCumplimiento {
  requisito: string;
  estado: "cumple" | "por-confirmar";
  respuesta: string;
}

export interface CotizacionCapacitacionData {
  codigo: string;
  nombreCompra: string;
  organismoComprador: string;
  /** Unidad de compra tal como la publica la ficha del portal. Es la fuente auditable del organismo. */
  unidadCompra: string | null;
  requisitos: RequisitosCapacitacion;
  /** Valor total ofertado = tope × 0.9 (regla del usuario). */
  totalClp: number;
  topeClp: number;
  descuentoPct: number;
  fechaCierre: string;
  cumplimiento: FilaCumplimiento[];
  pendientes: string[];
  fecha: Date;
  oferente: IdentidadOferente;
}

function badges(oferente: IdentidadOferente): string {
  const prelim = `<div class="badge prelim">PRELIMINAR — precio derivado del tope, no de costos reales</div>`;
  if (oferente.identidad_confirmada) return prelim;
  // El sello dice QUÉ falta. "Identidad sin confirmar" sobre una carátula que muestra la razón
  // social y el RUT reales se lee como una contradicción, y manda a revisar lo que ya está listo.
  const falta =
    oferente.campos_por_confirmar_corto.length > 0
      ? `falta ${oferente.campos_por_confirmar_corto.join(" y ")}`
      : "identidad del oferente sin revisar";
  return prelim + `<div class="badge borrador">BORRADOR — ${esc(falta)}</div>`;
}

/** Ficha del oferente para la carátula: lo que el organismo transcribe a su carátula y anexos. */
function bloqueOferente(o: IdentidadOferente): string {
  const linea = (lbl: string, valor: string | null, pendiente?: string) =>
    `<div class="info-row"><span class="lbl">${lbl}</span><span>${
      valor ? esc(valor) : `<span class="pend">${esc(pendiente ?? "por confirmar")}</span>`
    }</span></div>`;

  const sellos = [
    o.es_emt ? `<span class="sello ok">Empresa de Menor Tamaño (EMT)</span>` : "",
    o.estado_habilidad ? `<span class="sello ok">${esc(o.estado_habilidad)}</span>` : "",
    o.acreditado_hasta ? `<span class="sello ok">Acreditado hasta ${esc(o.acreditado_hasta)}</span>` : "",
  ]
    .filter(Boolean)
    .join("");

  return `<div class="card ofe" style="margin-top:8pt;">
    <h3 style="margin-bottom:4pt;">Oferente</h3>
    <div style="display:flex;gap:16pt;">
      <div style="flex:1;">
        ${linea("RAZÓN SOCIAL", o.nombre_fantasia ? `${o.razon_social} (${o.nombre_fantasia})` : o.razon_social)}
        ${linea("RUT", o.rut)}
        ${linea("DOMICILIO", o.direccion)}
      </div>
      <div style="flex:1;">
        ${linea("REPRESENTANTE LEGAL", o.representante_legal, "por confirmar antes de firmar los anexos")}
        ${linea("GIRO (SII)", o.giro, "por confirmar — define si se factura exento")}
        ${linea(
          "CONTACTO",
          [o.contacto_nombre, o.contacto_email, o.contacto_telefono].filter(Boolean).join(" · ") || null,
        )}
      </div>
    </div>
    ${sellos ? `<div style="margin-top:6pt;">${sellos}</div>` : ""}
  </div>`;
}

/**
 * La lámina 3 es de alto fijo y sus dos columnas se llenan muy desparejo: la izquierda acumula
 * modalidad + metodología + exigencias + coordinación, y la derecha solo relatoría + entregables.
 * Cuando el organismo declara **las dos** listas (requisitos metodológicos y exigencias
 * adicionales) la izquierda desborda mientras a la derecha le sobran ~200px — medido en
 * 2735-1052-COT26, 2306-700-COT26 y 3616-123-COT26. En ese caso la tarjeta de coordinación pasa a
 * la derecha. La alternativa era recortar el texto de las bases, que es justo lo que esta lámina
 * no debe hacer.
 */
function coordinacionEnLaDerecha(r: RequisitosCapacitacion): boolean {
  return (r.requisitos_metodologicos?.length ?? 0) > 0 && (r.exigencias_adicionales?.length ?? 0) > 0;
}

function tarjetaCoordinacion(r: RequisitosCapacitacion): string {
  return `<div class="card" style="margin-top:9pt;">
        <h3>Coordinación</h3>
        <div style="font-size:9pt;color:${COLOR.gray};line-height:1.4;">${esc(r.logistica)}</div>
      </div>`;
}

function bloqueModulos(r: RequisitosCapacitacion): string {
  return r.modulos
    .map(
      (m, i) => `<div class="mod">
      <div class="mod-h"><span class="mod-n">${i + 1}</span><strong>${esc(m.titulo)}</strong><span class="mod-hrs">${m.horas} h</span></div>
      <ul class="mod-t">${m.temas.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>
    </div>`,
    )
    .join("");
}

/**
 * Tarjeta de relatoría de la lámina 3. Tiene dos formas y la diferencia es sustantiva, no
 * cosmética: sin relator/a designado/a el documento declara abiertamente que la oferta se
 * descartaría en admisibilidad; con relator/a designado/a pasa a responder, exigencia por
 * exigencia del numeral que las bases dedican al perfil, con qué antecedente se acredita cada
 * una — y sigue mostrando en rojo lo que falta adjuntar, si falta algo.
 */
function bloqueRelator(r: RequisitosCapacitacion): string {
  const rel = r.relator;
  if (!rel) {
    return `<div class="card">
        <h3>Perfil de relatoría exigido</h3>
        <div class="info-row"><span class="lbl">FORMACIÓN</span><span style="font-size:9pt;">${esc(r.relator_exigido.formacion)}</span></div>
        <div class="info-row"><span class="lbl">EXP. LABORAL</span><span style="font-size:9pt;">${esc(r.relator_exigido.experiencia_laboral)}</span></div>
        <div class="info-row"><span class="lbl">EXP. RELATORÍA</span><span style="font-size:9pt;">${esc(r.relator_exigido.experiencia_relatoria)}</span></div>
        <div class="aviso" style="margin-top:8pt;">
          <div class="pend" style="font-size:9pt;">Relator/a por designar</div>
          <div style="font-size:8.5pt;color:${COLOR.gray};line-height:1.4;margin-top:3pt;">
            Esta propuesta no nombra relator/a ni adjunta sus credenciales. El organismo exige título, CV y
            certificados verificables, y toda oferta que no los acompañe se descarta en admisibilidad.
            Debe completarlo una persona antes de presentar.
          </div>
        </div>
      </div>`;
  }

  const filas: { lbl: string; txt: string }[] = [
    { lbl: "FORMACIÓN", txt: rel.acredita.formacion },
    { lbl: "EXP. LABORAL", txt: rel.acredita.experiencia_laboral },
    { lbl: "EXP. RELATORÍA", txt: rel.acredita.experiencia_relatoria },
  ];

  return `<div class="card rel">
        <h3 style="margin-bottom:4pt;">Relator/a propuesto/a</h3>
        <div style="font-size:11pt;font-weight:bold;line-height:1.15;">${esc(rel.nombre)}</div>
        <div class="accent" style="font-size:8.5pt;margin-top:1pt;">${esc(rel.titulo)}</div>
        <div class="gray" style="font-size:7.5pt;margin-top:1pt;">${esc(rel.cargo)} · ${esc(rel.contacto)}</div>
        <div style="border-top:1px solid ${COLOR.border};margin:6pt 0 3pt;"></div>
        ${filas
          .map(
            (f) =>
              `<div class="info-row"><span class="lbl">${f.lbl}</span><span>${esc(f.txt)}</span></div>`,
          )
          .join("")}
        <div class="info-row"><span class="lbl">SE ADJUNTA</span><span>${rel.documentos
          .map((d) => esc(d))
          .join(" · ")}</span></div>
        ${
          rel.documentos_faltantes.length > 0
            ? `<div class="aviso" style="margin-top:6pt;padding:5pt 8pt;">
          <div class="pend" style="font-size:8pt;">Antecedentes por completar antes de presentar</div>
          <ul class="tight" style="margin-top:2pt;font-size:7.5pt;">${rel.documentos_faltantes
            .map((d) => `<li>${esc(d)}</li>`)
            .join("")}</ul>
        </div>`
            : `<div style="margin-top:6pt;font-size:8.5pt;" class="ok">Carpeta de antecedentes del relator/a completa.</div>`
        }
      </div>`;
}

export function generarCotizacionCapacitacionHtml(data: CotizacionCapacitacionData): string {
  const logoBase64 = readFileSync(LOGO_PATH).toString("base64");
  const r = data.requisitos;
  const mesAno = `${MESES_ES[data.fecha.getMonth()]} de ${data.fecha.getFullYear()}`;
  const totalHoras = r.modulos.reduce((s, m) => s + m.horas, 0);
  // El nombre del curso lo pone el organismo y va de 30 a 120 caracteres. A 28pt, uno largo se
  // come tres líneas de la portada y empuja el resto fuera de la lámina; el guardrail de recorte
  // lo detecta pero no lo arregla. Se escala acá, que es la única variable que la plantilla controla.
  const tituloPt = r.curso.length > 95 ? 20 : r.curso.length > 65 ? 23 : 28;

  const glosaTributaria =
    r.tributacion.regimen === "exento"
      ? "Valor total exento de impuesto, según lo declara el organismo en sus bases."
      : r.tributacion.regimen === "impuestos_incluidos"
        ? "Valor total con impuestos incluidos, según lo exige el organismo en sus bases."
        : "El organismo no declara el tratamiento tributario del presupuesto: el valor se presenta como TOTAL y el régimen queda por confirmar.";

  return `<!doctype html>
<html lang="es-CL">
<head>
<meta charset="utf-8">
<title>Cotización ${esc(data.codigo)}</title>
<style>
  @page { size: 11.69in 8.27in; margin: 0; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: Arial, "Segoe UI", sans-serif; background: ${COLOR.bg}; color: ${COLOR.white}; }
  .slide { width: 11.69in; height: 8.27in; padding: 0.48in 0.65in; position: relative; page-break-after: always; overflow: hidden; }
  .slide:last-child { page-break-after: auto; }
  .gray { color: ${COLOR.gray}; }
  .accent { color: ${COLOR.accentLight}; }
  h1 { font-size: 28pt; margin: 0 0 8pt; }
  h2 { font-size: 19pt; margin: 0 0 10pt; }
  h3 { font-size: 12pt; margin: 0 0 6pt; color: ${COLOR.accentLight}; }
  .card { background: ${COLOR.card}; border: 1px solid ${COLOR.border}; border-radius: 10px; padding: 10pt 13pt; }
  .badge { position: absolute; top: 0.3in; right: 0.35in; background: ${COLOR.warn}; color: ${COLOR.white};
    font-size: 8pt; font-weight: bold; padding: 5pt 11pt; border-radius: 20px; }
  .badge.borrador { top: 0.72in; }
  .eyebrow { font-size: 9pt; letter-spacing: 1.2px; font-weight: bold; color: ${COLOR.accentLight}; text-transform: uppercase; }
  table { width: 100%; border-collapse: collapse; font-size: 10pt; }
  th, td { text-align: left; padding: 5pt 8pt; vertical-align: top; }
  th { color: ${COLOR.gray}; font-size: 8.5pt; text-transform: uppercase; background: ${COLOR.cardAlt}; }
  tbody tr { border-top: 1px solid ${COLOR.border}; }
  td.c, th.c { text-align: center; }
  td.r, th.r { text-align: right; }
  .info-row { display: flex; gap: 10pt; font-size: 10.5pt; padding: 3pt 0; }
  .info-row .lbl { width: 120pt; color: ${COLOR.gray}; font-weight: bold; font-size: 8.5pt; flex: none; padding-top: 1pt; }
  .portada { display: flex; flex-direction: column; }
  .portada .marca { display: flex; align-items: center; gap: 10pt; flex: none; }
  /* Espaciador elástico: aire cuando el contenido es corto, 0 cuando no cabe. Reemplaza al
     margen fijo, que era la causa de que un título de tres líneas desbordara la lámina. */
  .portada .respiro { flex: 1 1 auto; min-height: 0; max-height: 0.9in; }
  .portada > div { flex: none; }
  .portada .info-row { font-size: 9.5pt; }
  .ofe .info-row { padding: 2pt 0; font-size: 8.5pt; gap: 8pt; }
  .ofe .info-row .lbl { width: 92pt; font-size: 7pt; }
  .sello { display: inline-block; font-size: 7.5pt; font-weight: bold; padding: 2.5pt 8pt; border-radius: 20px;
    margin-right: 5pt; border: 1px solid ${COLOR.ok}; color: ${COLOR.ok}; }
  .rel .info-row { padding: 2pt 0; font-size: 7.8pt; line-height: 1.32; gap: 7pt; }
  .rel .info-row .lbl { width: 62pt; font-size: 7pt; padding-top: 0.5pt; }
  .grid2 { display: grid; grid-template-columns: repeat(2, 1fr); gap: 9pt; }
  .grid3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 9pt; }
  .mod { background: ${COLOR.card}; border: 1px solid ${COLOR.border}; border-radius: 8px; padding: 7pt 9pt; }
  .mod-h { display: flex; align-items: center; gap: 6pt; font-size: 9.5pt; margin-bottom: 3pt; }
  .mod-n { width: 15pt; height: 15pt; border-radius: 50%; background: ${COLOR.accent}; color: #fff;
    font-size: 8pt; font-weight: bold; display: flex; align-items: center; justify-content: center; flex: none; }
  .mod-h strong { flex: 1; line-height: 1.15; }
  .mod-hrs { color: ${COLOR.accentLight}; font-size: 8.5pt; font-weight: bold; flex: none; }
  .mod-t { margin: 0; padding-left: 21pt; font-size: 8pt; color: ${COLOR.gray}; line-height: 1.35; }
  .kpi { background: ${COLOR.cardAlt}; border: 1px solid ${COLOR.border}; border-radius: 8px; padding: 8pt 10pt; }
  .kpi .v { font-size: 17pt; font-weight: bold; color: ${COLOR.accentLight}; }
  .kpi .l { font-size: 8pt; color: ${COLOR.gray}; text-transform: uppercase; letter-spacing: .5px; }
  .ok { color: ${COLOR.ok}; font-weight: bold; }
  .pend { color: ${COLOR.warn}; font-weight: bold; }
  ul.tight { margin: 4pt 0 0; padding-left: 13pt; font-size: 8.5pt; color: ${COLOR.gray}; line-height: 1.35; }
  ul.tight li { margin-bottom: 2.5pt; }
  ul.tight.dos-col { columns: 2; column-gap: 14pt; }
  .totales .fila { display: flex; justify-content: space-between; padding: 4pt 0; font-size: 11pt; }
  .totales .total { background: ${COLOR.accent}; border-radius: 8px; padding: 9pt 14pt; font-size: 15pt; font-weight: bold; margin-top: 5pt; }
  .footer { position: absolute; bottom: 0.26in; left: 0.65in; right: 0.65in; font-size: 8pt; color: ${COLOR.gray}; }
  .cita { font-size: 8pt; color: ${COLOR.gray}; font-style: italic; border-left: 2px solid ${COLOR.border}; padding-left: 7pt; }
  .aviso { background: rgba(251,113,133,.10); border: 1px solid ${COLOR.warn}; border-radius: 8px; padding: 7pt 10pt; }
</style>
</head>
<body>

<!-- 1. PORTADA -->
<div class="slide portada">
  ${badges(data.oferente)}
  <div class="marca">
    <img src="data:image/png;base64,${logoBase64}" style="width:42pt;height:42pt;">
    <span style="font-size:15pt;font-weight:bold;">KeepSync</span>
  </div>
  <div class="respiro"></div>
  <div>
    <div class="eyebrow">Propuesta técnica y económica — Compra Ágil ${esc(data.codigo)}</div>
    <h1 style="margin-top:8pt;font-size:${tituloPt}pt;">${esc(r.curso)}</h1>
    <div class="accent" style="font-size:13pt;">para ${esc(data.organismoComprador)}</div>
  </div>
  <div class="grid3" style="margin-top:16pt;">
    <div class="kpi"><div class="v">${formatoClp(data.totalClp)}</div><div class="l">Valor total ofertado</div></div>
    <div class="kpi"><div class="v">${r.duracion.horas_cronologicas} h</div><div class="l">Horas cronológicas</div></div>
    <div class="kpi"><div class="v">${r.participantes.maximo}</div><div class="l">Participantes</div></div>
  </div>
  <div class="card" style="margin-top:11pt;">
    <div class="info-row"><span class="lbl">ORGANISMO</span><span>${esc(data.organismoComprador)}</span></div>
    ${
      data.unidadCompra
        ? `<div class="info-row"><span class="lbl">UNIDAD DE COMPRA</span><span>${esc(data.unidadCompra)}</span></div>`
        : ""
    }
    <div class="info-row"><span class="lbl">REQUERIMIENTO</span><span>${esc(data.nombreCompra)}</span></div>
    <div class="info-row"><span class="lbl">MODALIDAD</span><span>${esc(r.modalidad.tipo)} — ${esc(r.modalidad.plataforma)}</span></div>
    <div class="info-row"><span class="lbl">EJECUCIÓN</span><span>${esc(r.fechas_ejecucion)}</span></div>
    <div class="info-row"><span class="lbl">CIERRE OFERTAS</span><span>${esc(data.fechaCierre)} (hora de Chile)</span></div>
  </div>
  ${bloqueOferente(data.oferente)}
  <div style="height:0.22in;flex:none;"></div>
  <div class="footer">Presentado por ${esc(data.oferente.razon_social)} — ${mesAno} · Documento elaborado a partir de: ${esc(r.fuente_documentos.join(", "))}</div>
</div>

<!-- 2. PROGRAMA -->
<div class="slide">
  ${badges(data.oferente)}
  <div class="eyebrow">Propuesta técnica</div>
  <h2 style="margin-top:5pt;">Programa de la actividad</h2>
  <div class="card" style="padding:9pt 12pt;margin-bottom:10pt;">
    <h3 style="margin-bottom:3pt;">Objetivo de aprendizaje</h3>
    <div style="font-size:9.5pt;line-height:1.4;">${esc(r.objetivo)}</div>
  </div>
  <!-- Tres columnas cuando el temario es largo: el requerimiento de Lo Barnechea (2735-1052-COT26)
       lista once cursos y en dos columnas desbordaba la lámina, que es de alto fijo. El umbral es 8
       porque los dos TDR de Dipres traen ocho módulos y sí caben en dos columnas: bajarlo les
       cambiaría el diseño sin necesidad. Mismo criterio que el dos-col de las exigencias. -->
  <div class="${r.modulos.length > 8 ? "grid3" : "grid2"}">${bloqueModulos(r)}</div>
  <div class="footer">${esc(r.modulos_nota)} Total: ${totalHoras} horas cronológicas.</div>
</div>

<!-- 3. METODOLOGÍA, RELATOR Y ENTREGABLES -->
<div class="slide">
  ${badges(data.oferente)}
  <div class="eyebrow">Propuesta técnica</div>
  <h2 style="margin-top:5pt;">Metodología, relatoría y entregables</h2>
  <div class="grid2" style="align-items:start;">
    <div>
      <div class="card">
        <h3>Modalidad y logística</h3>
        <div class="info-row"><span class="lbl">FORMATO</span><span style="font-size:9.5pt;">${esc(r.modalidad.tipo)}</span></div>
        <div class="info-row"><span class="lbl">PLATAFORMA</span><span style="font-size:9.5pt;">${esc(r.modalidad.plataforma)}</span></div>
        <div class="info-row"><span class="lbl">HORARIO</span><span style="font-size:9.5pt;">${esc(r.modalidad.horario)}</span></div>
        <div class="info-row"><span class="lbl">DURACIÓN</span><span style="font-size:9.5pt;">${esc(r.duracion.glosa)}</span></div>
        <div class="info-row"><span class="lbl">PARTICIPANTES</span><span style="font-size:9.5pt;">${esc(r.participantes.glosa)}</span></div>
      </div>
      ${
        r.requisitos_metodologicos && r.requisitos_metodologicos.length > 0
          ? `<div class="card" style="margin-top:9pt;"><h3>Requisitos metodológicos exigidos</h3>
             <ul class="tight${r.requisitos_metodologicos.length > 5 ? " dos-col" : ""}" style="${r.requisitos_metodologicos.length > 5 ? "font-size:7.5pt;" : ""}">${r.requisitos_metodologicos.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>`
          : ""
      }
      ${
        r.exigencias_adicionales && r.exigencias_adicionales.length > 0
          ? `<div class="card" style="margin-top:9pt;"><h3>Exigencias adicionales de las bases</h3>
             <ul class="tight${r.exigencias_adicionales.length > 5 ? " dos-col" : ""}" style="font-size:7.5pt;">${r.exigencias_adicionales.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>`
          : ""
      }
      ${coordinacionEnLaDerecha(r) ? "" : tarjetaCoordinacion(r)}
    </div>
    <div>
      ${bloqueRelator(r)}
      <div class="card" style="margin-top:9pt;">
        <h3>Entregables comprometidos</h3>
        <ul class="tight">${r.entregables.map((e) => `<li>${esc(e)}</li>`).join("")}</ul>
      </div>
      ${coordinacionEnLaDerecha(r) ? tarjetaCoordinacion(r) : ""}
    </div>
  </div>
</div>

<!-- 4. CUMPLIMIENTO -->
<div class="slide">
  ${badges(data.oferente)}
  <div class="eyebrow">Admisibilidad</div>
  <h2 style="margin-top:5pt;">Cumplimiento de las especificaciones</h2>
  <table class="card" style="padding:0;overflow:hidden;">
    <thead><tr><th style="width:31%;">Requisito de las bases</th><th style="width:12%;">Estado</th><th>Cómo lo cubre esta propuesta</th></tr></thead>
    <tbody>
      ${data.cumplimiento
        .map(
          (f) => `<tr>
        <td>${esc(f.requisito)}</td>
        <td class="${f.estado === "cumple" ? "ok" : "pend"}">${f.estado === "cumple" ? "Cumple" : "Por confirmar"}</td>
        <td class="gray">${esc(f.respuesta)}</td>
      </tr>`,
        )
        .join("")}
    </tbody>
  </table>
  <div class="card" style="margin-top:9pt;">
    <h3>Documentos obligatorios de la oferta</h3>
    <ul class="tight" style="columns:2;column-gap:18pt;">${normalizarDocumentos(r.documentos_obligatorios_oferta, false)
      .map((d) => `<li>${esc(d.documento)}${d.tipo === "acopio" ? ' <span class="gray">(se adjunta)</span>' : ""}</li>`)
      .join("")}</ul>
  </div>
</div>

<!-- 5. OFERTA ECONÓMICA -->
<div class="slide">
  ${badges(data.oferente)}
  <div class="eyebrow">Oferta económica</div>
  <h2 style="margin-top:5pt;">Cotización</h2>
  <table class="card" style="padding:0;overflow:hidden;">
    <thead><tr><th>Producto / servicio</th><th class="c" style="width:14%;">Participantes</th><th class="r" style="width:22%;">Valor total ofertado</th></tr></thead>
    <tbody><tr>
      <td>Actividad de capacitación “${esc(r.curso)}”, según las especificaciones definidas por el organismo en sus bases.</td>
      <td class="c">${r.participantes.maximo}</td>
      <td class="r" style="font-weight:bold;">${formatoClp(data.totalClp)}</td>
    </tr></tbody>
  </table>
  <div style="display:flex;justify-content:space-between;gap:16pt;margin-top:10pt;align-items:flex-start;">
    <div style="flex:1;">
      <div class="card" style="padding:9pt 12pt;">
        <div style="font-size:9.5pt;color:${COLOR.accentLight};font-weight:bold;">Cómo se formó este precio</div>
        <div style="font-size:9pt;color:${COLOR.gray};line-height:1.45;margin-top:4pt;">
          Presupuesto informado por el organismo: <strong style="color:${COLOR.white};">${formatoClp(data.topeClp)}</strong>.
          Valor ofertado: <strong style="color:${COLOR.white};">${data.descuentoPct}% bajo ese tope</strong>.
          ${esc(glosaTributaria)}
        </div>
        <div class="cita" style="margin-top:7pt;">${esc(r.tributacion.cita)}</div>
      </div>
    </div>
    <div class="totales" style="width:3.2in;flex:none;">
      <div class="fila"><span class="gray">Presupuesto disponible</span><span>${formatoClp(data.topeClp)}</span></div>
      <div class="fila"><span class="gray">Descuento aplicado (${data.descuentoPct}%)</span><span>− ${formatoClp(data.topeClp - data.totalClp)}</span></div>
      <div class="fila total"><span>TOTAL OFERTADO</span><span>${formatoClp(data.totalClp)}</span></div>
    </div>
  </div>
  <div class="grid3" style="margin-top:10pt;align-items:start;">
    <div class="card">
      <h3>Cómo evalúa el organismo</h3>
      <ul class="tight" style="font-size:7.5pt;">${r.evaluacion.detalle.map((d) => `<li>${esc(d)}</li>`).join("")}</ul>
    </div>
    <div class="card">
      <h3>Condiciones</h3>
      <ul class="tight" style="font-size:7.5pt;">
        <li><strong style="color:${COLOR.white};">Multas:</strong> ${esc(r.multas)}</li>
        <li><strong style="color:${COLOR.white};">Pago:</strong> ${esc(r.pago)}</li>
      </ul>
    </div>
    <div class="aviso">
      <div class="pend" style="font-size:9pt;">Pendientes antes de presentar</div>
      <ul class="tight" style="margin-top:3pt;font-size:7pt;line-height:1.3;">${data.pendientes.map((p) => `<li>${esc(p)}</li>`).join("")}</ul>
    </div>
  </div>
  <div class="footer" style="color:${COLOR.warn};font-weight:bold;">
    PRELIMINAR — precio derivado del tope publicado, no de un costo real de KeepSync. No enviar sin resolver los pendientes de arriba.
  </div>
</div>

</body>
</html>`;
}

/**
 * Renderiza el PDF con Chromium/Playwright (no LibreOffice — ver notas en src/lib/cotizacion-pdf.ts).
 *
 * Devuelve las láminas cuyo contenido no cupo. Cada `.slide` tiene alto fijo (8.27in) y
 * `overflow:hidden`, que es lo que garantiza las 5 páginas exactas — pero también significa que
 * un texto largo se recorta **en silencio**, y en un documento que va a un organismo comprador un
 * requisito recortado es un requisito no declarado. Por eso se mide `scrollHeight` contra
 * `clientHeight` en el mismo navegador que imprime, en vez de confiar en la vista.
 */
export async function generarCotizacionCapacitacionPdf(
  data: CotizacionCapacitacionData,
  outputPdfPath: string,
): Promise<{ laminasDesbordadas: { indice: number; excesoPx: number }[] }> {
  const html = generarCotizacionCapacitacionHtml(data);
  const tmpDir = mkdtempSync(path.join(tmpdir(), "cotizacion-capacitacion-"));
  const tmpHtmlPath = path.join(tmpDir, "cotizacion.html");
  writeFileSync(tmpHtmlPath, html, "utf-8");

  const browser = await chromium.launch({ headless: true, executablePath: CHROMIUM_PATH });
  try {
    const page = await browser.newPage();
    await page.goto(`file://${tmpHtmlPath}`, { waitUntil: "networkidle" });

    const laminasDesbordadas = await page.evaluate(() => {
      // `document` se tipea acá y no con "DOM" en tsconfig.lib a propósito: este repo corre en
      // Node y agregar los tipos del navegador al proyecto entero dejaría pasar globales de
      // browser en código que nunca corre en uno.
      const doc = (globalThis as unknown as {
        document: { querySelectorAll(s: string): ArrayLike<{ scrollHeight: number; clientHeight: number }> };
      }).document;
      const out: { indice: number; excesoPx: number }[] = [];
      const laminas = doc.querySelectorAll(".slide");
      for (let i = 0; i < laminas.length; i++) {
        const el = laminas[i]!;
        // 2px de tolerancia: el redondeo subpíxel del layout marca desbordes de 1px que no
        // recortan nada visible.
        const exceso = el.scrollHeight - el.clientHeight;
        if (exceso > 2) out.push({ indice: i + 1, excesoPx: exceso });
      }
      return out;
    });

    await page.pdf({
      path: outputPdfPath,
      width: "11.69in",
      height: "8.27in",
      printBackground: true,
      margin: { top: "0in", bottom: "0in", left: "0in", right: "0in" },
    });

    return { laminasDesbordadas };
  } finally {
    await browser.close();
    rmSync(tmpDir, { recursive: true, force: true });
  }
}
