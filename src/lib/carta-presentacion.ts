import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import type { IdentidadOferente, RelatorPropuesto } from "./capacitaciones.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOGO_PATH = path.join(__dirname, "..", "assets", "logo-keepsync-negro.png");
const CHROMIUM_PATH = "/opt/pw-browsers/chromium";

const MESES_ES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Carta de presentación que encabeza la oferta. La prosa vive en `config/capacitaciones.json`
 * (`carta.parrafos`) y **la identidad no**: el membrete, la fecha y el bloque del oferente se
 * arman desde `relator` y `config/company.json`, los mismos datos que alimentan la propuesta.
 *
 * Esa separación es el punto. La carta que venía de fuera del repo traía la razón social, el RUT
 * y el representante legal como marcadores a rellenar a mano —«Oferente: [Razón social] · RUT N°
 * [__.___.___-_]»— y quedó desactualizada respecto de la propuesta apenas hubo datos reales.
 * Acá los dos documentos leen de la misma fuente: cuando cambia la identidad, cambian ambos.
 */
export interface CartaPresentacion {
  /** A quién se dirige, línea por línea, sin el "Señores" (lo pone la plantilla). */
  destinatario: string[];
  /** El "Ref.:" de la carta. */
  referencia: string;
  saludo: string;
  parrafos: string[];
  despedida: string;
}

export interface CartaPresentacionData {
  carta: CartaPresentacion;
  relator: RelatorPropuesto;
  oferente: IdentidadOferente;
  fecha: Date;
  /** Ciudad desde donde se firma. */
  ciudad: string;
}

function bloqueOferente(o: IdentidadOferente): string {
  const sellos = [
    o.es_emt ? "Empresa de Menor Tamaño (EMT)" : null,
    o.estado_habilidad,
    o.acreditado_hasta ? `Acreditado en el Registro de Proveedores hasta el ${o.acreditado_hasta}` : null,
  ].filter(Boolean) as string[];

  // El representante legal se imprime como línea de firma y no como marcador entre corchetes.
  // Es el único dato de la identidad que sigue sin confirmarse, y una línea sobre la que se firma
  // es lo que un documento de oferta lleva de todas formas: se completa al firmar, no antes.
  const repLegal = o.representante_legal
    ? `<div class="dato"><span class="lbl">Representante legal:</span> ${esc(o.representante_legal)}</div>`
    : `<div class="dato firma-linea">
         <span class="lbl">Representante legal:</span>
         <span class="linea"></span><span class="lbl">RUN N°</span><span class="linea corta"></span>
       </div>
       <div class="nota">Nombre, RUN y firma del representante legal se completan al suscribir la oferta.</div>`;

  return `<div class="oferente">
    <div class="oferente-t">Oferente</div>
    <div class="dato"><span class="lbl">Razón social:</span> <strong>${esc(o.razon_social)}</strong>${
      o.nombre_fantasia ? ` (${esc(o.nombre_fantasia)})` : ""
    } &nbsp;·&nbsp; <span class="lbl">RUT N°</span> <strong>${esc(o.rut)}</strong></div>
    ${o.direccion ? `<div class="dato"><span class="lbl">Domicilio:</span> ${esc(o.direccion)}</div>` : ""}
    ${repLegal}
    ${sellos.length > 0 ? `<div class="sellos">${sellos.map((s) => `<span>${esc(s)}</span>`).join("")}</div>` : ""}
  </div>`;
}

export function generarCartaPresentacionHtml(data: CartaPresentacionData): string {
  const { carta, relator, oferente, fecha } = data;
  const logoBase64 = readFileSync(LOGO_PATH).toString("base64");
  const fechaLarga = `${fecha.getDate()} de ${MESES_ES[fecha.getMonth()]} de ${fecha.getFullYear()}`;

  return `<!doctype html>
<html lang="es-CL">
<head>
<meta charset="utf-8">
<title>Carta de presentación</title>
<style>
  /* Carta en papel, no lámina: se pagina sola. La propuesta técnica es la que tiene alto fijo. */
  @page { size: A4; margin: 20mm 22mm 18mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: Georgia, "Times New Roman", serif; font-size: 10.5pt;
    line-height: 1.5; color: #14141F; background: #FFFFFF; text-align: justify; }
  .membrete { display: flex; align-items: flex-start; gap: 12pt; border-bottom: 1.5pt solid #14141F;
    padding-bottom: 8pt; margin-bottom: 16pt; }
  .membrete img { width: 34pt; height: 34pt; flex: none; }
  .membrete .quien { flex: 1; text-align: left; }
  .nombre { font-family: Arial, sans-serif; font-size: 13pt; font-weight: bold; letter-spacing: .6px; }
  .rol, .contacto { font-family: Arial, sans-serif; font-size: 8pt; color: #4A4A5C; margin-top: 2pt; }
  .fecha { text-align: left; margin-bottom: 14pt; }
  .dest { margin-bottom: 14pt; line-height: 1.35; text-align: left; }
  .dest strong { font-weight: bold; }
  .ref { margin-bottom: 14pt; text-align: left; }
  p { margin: 0 0 9pt; }
  .cierre { margin-top: 16pt; text-align: left; }
  .firma { margin-top: 30pt; text-align: left; }
  .firma .n { font-family: Arial, sans-serif; font-weight: bold; font-size: 11pt; }
  .firma .r { font-family: Arial, sans-serif; font-size: 8.5pt; color: #4A4A5C; }
  .oferente { margin-top: 16pt; border: 0.8pt solid #9A9AAB; border-radius: 4pt; padding: 9pt 12pt;
    font-family: Arial, sans-serif; font-size: 8.5pt; text-align: left; line-height: 1.45;
    page-break-inside: avoid; }
  .oferente-t { font-weight: bold; font-size: 8pt; letter-spacing: 1px; text-transform: uppercase;
    color: #4A4A5C; margin-bottom: 4pt; }
  .dato { margin-bottom: 1.5pt; }
  .lbl { color: #4A4A5C; }
  .firma-linea { display: flex; align-items: flex-end; gap: 5pt; margin-top: 5pt; }
  .firma-linea .linea { flex: 1; border-bottom: 0.8pt solid #14141F; height: 11pt; }
  .firma-linea .linea.corta { flex: 0 0 90pt; }
  .nota { font-size: 7.5pt; color: #6A6A7C; font-style: italic; margin-top: 3pt; }
  .sellos { margin-top: 6pt; }
  .sellos span { display: inline-block; font-size: 7.5pt; border: 0.7pt solid #2E7D5B; color: #1F6B4A;
    border-radius: 10pt; padding: 1.5pt 7pt; margin: 2pt 4pt 0 0; }
</style>
</head>
<body>

<div class="membrete">
  <img src="data:image/png;base64,${logoBase64}">
  <div class="quien">
    <div class="nombre">${esc(relator.nombre.toUpperCase())}</div>
    <div class="rol">${esc(relator.cargo)}</div>
    <div class="contacto">${esc(relator.contacto)}</div>
  </div>
</div>

<div class="fecha">${esc(data.ciudad)}, ${fechaLarga}</div>

<div class="dest">
  Señores<br>
  ${carta.destinatario.map((l, i) => (i === 0 ? `<strong>${esc(l)}</strong>` : esc(l))).join("<br>")}<br>
  Presente
</div>

<div class="ref"><strong>Ref.:</strong> ${esc(carta.referencia)}</div>

<p>${esc(carta.saludo)}</p>

${carta.parrafos.map((p) => `<p>${esc(p)}</p>`).join("\n")}

<div class="cierre">${esc(carta.despedida)}</div>

<div class="firma">
  <div class="n">${esc(relator.nombre)}</div>
  <div class="r">Relator propuesto · ${esc(relator.cargo)}</div>
</div>

${bloqueOferente(oferente)}

</body>
</html>`;
}

/** Renderiza la carta. Devuelve cuántas páginas ocupó, que es lo que hay que mirar al editarla. */
export async function generarCartaPresentacionPdf(
  data: CartaPresentacionData,
  outputPdfPath: string,
): Promise<void> {
  const html = generarCartaPresentacionHtml(data);
  const tmpDir = mkdtempSync(path.join(tmpdir(), "carta-presentacion-"));
  const tmpHtmlPath = path.join(tmpDir, "carta.html");
  writeFileSync(tmpHtmlPath, html, "utf-8");

  const browser = await chromium.launch({ headless: true, executablePath: CHROMIUM_PATH });
  try {
    const page = await browser.newPage();
    await page.goto(`file://${tmpHtmlPath}`, { waitUntil: "networkidle" });
    await page.pdf({ path: outputPdfPath, format: "A4", printBackground: true });
  } finally {
    await browser.close();
    rmSync(tmpDir, { recursive: true, force: true });
  }
}
