import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import type { IdentidadOferente, RequisitosCapacitacion } from "./capacitaciones.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOGO_PATH = path.join(__dirname, "assets", "logo-keepsync-blanco.png");

const CHROMIUM_PATH =
  process.env.CHROMIUM_EXECUTABLE_PATH ||
  (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);

/**
 * Documentos que KeepSync produce por su cuenta para acompañar la oferta: propuesta técnica y
 * oferta económica.
 *
 * A diferencia de la cotización —cinco láminas apaisadas y oscuras, pensadas para leerse en
 * pantalla— esto es un documento que el organismo imprime y archiva junto al resto del expediente.
 * Va en A4 vertical, fondo blanco y tipografía de lectura corrida. Es el mismo criterio que ya
 * aplica el repo cuando distingue una lámina de un informe.
 *
 * Todo el contenido sale de `config/capacitaciones.json` (transcrito del TDR con su cita) y de
 * `config/company.json`. Este módulo no redacta: ordena y presenta lo que ya fue verificado
 * contra el documento oficial.
 */
export type TipoGenerable = "propuesta_tecnica" | "oferta_economica";

export interface DatosDocumento {
  codigo: string;
  organismo: string;
  tituloDocumento: string;
  requisitos: RequisitosCapacitacion;
  oferente: IdentidadOferente;
  totalClp: number;
  topeClp: number;
  descuentoPct: number;
  fecha: Date;
}

const COLOR = {
  tinta: "#16151F",
  suave: "#5B5F70",
  linea: "#D8DAE4",
  acento: "#5B4FE0",
  acentoSuave: "#EEECFD",
  alerta: "#B4341F",
  alertaFondo: "#FDF0ED",
};

const MESES_ES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function clp(n: number): string {
  return "$" + Math.round(n).toLocaleString("es-CL");
}

function fechaLarga(d: Date): string {
  return `${d.getDate()} de ${MESES_ES[d.getMonth()]} de ${d.getFullYear()}`;
}

function logoDataUri(): string {
  if (!existsSync(LOGO_PATH)) return "";
  return `data:image/png;base64,${readFileSync(LOGO_PATH).toString("base64")}`;
}

const ESTILOS = `
  @page { size: A4 portrait; margin: 20mm 18mm 18mm; }
  * { box-sizing: border-box; }
  body {
    margin: 0; color: ${COLOR.tinta}; background: #FFFFFF;
    font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
    font-size: 10.5pt; line-height: 1.5;
  }
  h1 { font-size: 17pt; margin: 0 0 2pt; line-height: 1.25; }
  h2 {
    font-size: 12pt; margin: 20pt 0 6pt; padding-bottom: 3pt;
    border-bottom: 1.5pt solid ${COLOR.acento}; break-after: avoid;
  }
  h3 { font-size: 10.5pt; margin: 12pt 0 3pt; break-after: avoid; }
  p { margin: 0 0 7pt; }
  ul { margin: 0 0 7pt; padding-left: 16pt; }
  li { margin-bottom: 3pt; }
  .cabecera {
    display: flex; justify-content: space-between; align-items: flex-start;
    border-bottom: 1pt solid ${COLOR.linea}; padding-bottom: 10pt; margin-bottom: 14pt;
  }
  .cabecera img { height: 26pt; filter: invert(1) brightness(0.15); }
  .eyebrow {
    font-size: 8pt; letter-spacing: 1.1px; text-transform: uppercase;
    color: ${COLOR.acento}; font-weight: bold; margin-bottom: 4pt;
  }
  .sub { color: ${COLOR.suave}; font-size: 9.5pt; }
  .ficha { width: 100%; border-collapse: collapse; margin: 10pt 0; }
  .ficha td { padding: 4pt 6pt; border-bottom: 1pt solid ${COLOR.linea}; vertical-align: top; }
  .ficha td:first-child { width: 34%; color: ${COLOR.suave}; }
  table.datos { width: 100%; border-collapse: collapse; margin: 8pt 0; font-size: 10pt; }
  table.datos th {
    text-align: left; padding: 5pt 6pt; background: ${COLOR.acentoSuave};
    border-bottom: 1pt solid ${COLOR.linea}; font-size: 9pt;
  }
  table.datos td { padding: 5pt 6pt; border-bottom: 1pt solid ${COLOR.linea}; vertical-align: top; }
  table.datos td.num { text-align: right; white-space: nowrap; }
  .modulo { break-inside: avoid; margin-bottom: 8pt; }
  .modulo .hrs { color: ${COLOR.acento}; font-weight: bold; font-size: 9.5pt; }
  .aviso {
    background: ${COLOR.alertaFondo}; border-left: 3pt solid ${COLOR.alerta};
    padding: 8pt 10pt; margin: 10pt 0; font-size: 9.5pt; break-inside: avoid;
  }
  .aviso strong { color: ${COLOR.alerta}; }
  .cita { color: ${COLOR.suave}; font-size: 9pt; font-style: italic; }
  .total td { font-weight: bold; font-size: 11.5pt; border-top: 1.5pt solid ${COLOR.tinta}; }
  .pie {
    margin-top: 18pt; padding-top: 8pt; border-top: 1pt solid ${COLOR.linea};
    color: ${COLOR.suave}; font-size: 8.5pt;
  }
`;

function cabecera(d: DatosDocumento): string {
  const logo = logoDataUri();
  return `<div class="cabecera">
    <div>
      <div class="eyebrow">${esc(d.tituloDocumento)}</div>
      <h1>${esc(d.requisitos.curso)}</h1>
      <div class="sub">${esc(d.organismo)} · Compra Ágil ${esc(d.codigo)}</div>
    </div>
    ${logo ? `<img src="${logo}" alt="KeepSync">` : ""}
  </div>`;
}

/**
 * El aviso del relator/a va en el documento mismo, no en una nota interna. Los seis TDR exigen
 * título, CV y certificados verificables de una persona concreta, y hoy ninguna oferta la nombra:
 * presentar la propuesta sin ese dato es presentarla incompleta. Decirlo en el borrador es lo que
 * evita que alguien lo suba al portal creyendo que está listo.
 */
function avisoRelator(r: RequisitosCapacitacion): string {
  return `<div class="aviso">
    <strong>Por completar antes de presentar:</strong> este borrador no designa relator/a.
    El organismo exige:
    <ul>
      <li>${esc(r.relator_exigido.formacion)}</li>
      <li>${esc(r.relator_exigido.experiencia_laboral)}</li>
      <li>${esc(r.relator_exigido.experiencia_relatoria)}</li>
    </ul>
    Sin esos antecedentes adjuntos, la oferta se descarta en admisibilidad.
  </div>`;
}

function propuestaTecnica(d: DatosDocumento): string {
  const r = d.requisitos;
  return `${cabecera(d)}

  <h2>1. Objetivo de la actividad</h2>
  <p>${esc(r.objetivo)}</p>

  <h2>2. Ficha de la actividad</h2>
  <table class="ficha">
    <tr><td>Modalidad</td><td>${esc(r.modalidad.tipo)}${
      r.modalidad.plataforma ? ` — ${esc(r.modalidad.plataforma)}` : ""
    }</td></tr>
    <tr><td>Duración</td><td>${esc(r.duracion.glosa)}</td></tr>
    <tr><td>Participantes</td><td>${esc(r.participantes.glosa)}</td></tr>
    <tr><td>Horario</td><td>${esc(r.modalidad.horario)}</td></tr>
    <tr><td>Fechas de ejecución</td><td>${esc(r.fechas_ejecucion)}</td></tr>
  </table>
  ${r.modalidad_observacion ? `<p class="cita">${esc(r.modalidad_observacion)}</p>` : ""}

  <h2>3. Programa por módulos</h2>
  <p class="cita">${esc(r.modulos_nota)}</p>
  ${r.modulos
    .map(
      (m, i) => `<div class="modulo">
    <h3>Módulo ${i + 1}. ${esc(m.titulo)} <span class="hrs">${m.horas} h</span></h3>
    <ul>${m.temas.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>
  </div>`,
    )
    .join("")}
  <table class="datos">
    <tr class="total"><td>Total de horas cronológicas</td><td class="num">${
      r.duracion.horas_cronologicas
    } h</td></tr>
  </table>

  ${
    r.requisitos_metodologicos?.length
      ? `<h2>4. Metodología</h2><ul>${r.requisitos_metodologicos
          .map((m) => `<li>${esc(m)}</li>`)
          .join("")}</ul>`
      : ""
  }

  <h2>${r.requisitos_metodologicos?.length ? 5 : 4}. Relator/a</h2>
  ${avisoRelator(r)}

  <h2>${r.requisitos_metodologicos?.length ? 6 : 5}. Entregables</h2>
  <ul>${r.entregables.map((e) => `<li>${esc(e)}</li>`).join("")}</ul>

  <h2>${r.requisitos_metodologicos?.length ? 7 : 6}. Coordinación y logística</h2>
  <p>${esc(r.logistica)}</p>
  ${
    r.exigencias_adicionales?.length
      ? `<ul>${r.exigencias_adicionales.map((e) => `<li>${esc(e)}</li>`).join("")}</ul>`
      : ""
  }`;
}

function ofertaEconomica(d: DatosDocumento): string {
  const r = d.requisitos;
  const glosaRegimen: Record<string, string> = {
    exento: "Valor exento de IVA",
    impuestos_incluidos: "Valor con impuestos incluidos",
    no_declarado: "Régimen tributario no declarado en las bases",
  };
  return `${cabecera(d)}

  <h2>1. Identificación del oferente</h2>
  <table class="ficha">
    <tr><td>Razón social</td><td>${esc(d.oferente.razon_social)}</td></tr>
    <tr><td>RUT</td><td>${esc(d.oferente.rut)}</td></tr>
    <tr><td>Contacto</td><td>${esc(d.oferente.contacto_email)}</td></tr>
  </table>
  ${
    d.oferente.identidad_confirmada
      ? ""
      : `<div class="aviso"><strong>Por completar antes de presentar:</strong> la identidad del
         oferente no está confirmada en <code>config/company.json</code>. Los datos de arriba son
         marcadores, no la razón social real.</div>`
  }

  <h2>2. Valor ofertado</h2>
  <table class="datos">
    <tr><th>Concepto</th><th style="text-align:right">Monto</th></tr>
    <tr>
      <td>${esc(r.curso)}<br><span class="cita">${
        r.duracion.horas_cronologicas
      } horas cronológicas · hasta ${r.participantes.maximo} participantes</span></td>
      <td class="num">${clp(d.totalClp)}</td>
    </tr>
    <tr class="total"><td>Total ofertado</td><td class="num">${clp(d.totalClp)}</td></tr>
  </table>
  <p>${esc(glosaRegimen[r.tributacion.regimen] ?? glosaRegimen.no_declarado!)}.</p>
  <p class="cita">Fundamento tributario declarado por el organismo: ${esc(r.tributacion.cita)}</p>

  <h2>3. Cómo se formó este precio</h2>
  <p>
    El presupuesto disponible del organismo es de <strong>${clp(d.topeClp)}</strong>. La oferta se
    presenta un <strong>${d.descuentoPct}% bajo ese tope</strong>. Ofertar por sobre el presupuesto
    disponible es causal de inadmisibilidad, de modo que el tope opera como techo, no como
    referencia.
  </p>

  <h2>4. Condiciones de pago y multas</h2>
  <p>${esc(r.pago)}</p>
  <p>${esc(r.multas)}</p>`;
}

export function generarDocumentoHtml(tipo: TipoGenerable, d: DatosDocumento): string {
  const cuerpo = tipo === "propuesta_tecnica" ? propuestaTecnica(d) : ofertaEconomica(d);
  return `<!doctype html><html lang="es"><head><meta charset="utf-8">
<title>${esc(d.tituloDocumento)} — ${esc(d.codigo)}</title>
<style>${ESTILOS}</style></head><body>
${cuerpo}
<div class="pie">
  ${esc(d.oferente.razon_social)} · Compra Ágil ${esc(d.codigo)} · ${esc(d.organismo)} ·
  ${fechaLarga(d.fecha)}<br>
  Documento preparado para revisión humana antes de su presentación en mercadopublico.cl.
</div>
</body></html>`;
}

export async function generarDocumentoPdf(
  tipo: TipoGenerable,
  d: DatosDocumento,
  rutaSalida: string,
): Promise<void> {
  const html = generarDocumentoHtml(tipo, d);
  const tmpDir = mkdtempSync(path.join(tmpdir(), "documento-"));
  const tmpHtml = path.join(tmpDir, "documento.html");
  writeFileSync(tmpHtml, html, "utf-8");

  const browser = await chromium.launch({ headless: true, executablePath: CHROMIUM_PATH });
  try {
    const page = await browser.newPage();
    await page.goto(`file://${tmpHtml}`, { waitUntil: "networkidle" });
    await page.pdf({
      path: rutaSalida,
      format: "A4",
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: "<div></div>",
      footerTemplate:
        `<div style="width:100%;font-size:7pt;color:${COLOR.suave};padding:0 18mm;text-align:right;">` +
        `<span class="pageNumber"></span> / <span class="totalPages"></span></div>`,
      margin: { top: "18mm", bottom: "14mm", left: "18mm", right: "18mm" },
    });
  } finally {
    await browser.close();
    rmSync(tmpDir, { recursive: true, force: true });
  }
}
