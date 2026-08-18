import path from "node:path";
import { fileURLToPath } from "node:url";
import PptxGenJS from "pptxgenjs";
import type { CompanyConfigLicitaciones } from "./config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// licitaciones/src/lib -> repo root -> src/assets (mismo logo que usa Compra Ágil, sin duplicar el binario).
const LOGO_PATH = path.join(__dirname, "..", "..", "..", "src", "assets", "logo-keepsync-blanco.png");

// Misma paleta/layout que la plantilla de Compra Ágil, para que ambas líneas de negocio de
// KeepSync compartan identidad visual.
const COLOR = {
  bg: "0E0E17",
  bgAlt: "09090B",
  card: "161527",
  cardAlt: "24243A",
  accent: "786CF0",
  accentLight: "B4AAFA",
  white: "FFFFFF",
  gray: "8A8F98",
};
const FONT = "Arial";
const SLIDE_W = 11.69;
const SLIDE_H = 8.27;
const COLOR_WARN = "FF4D4D";

function formatoClp(n: number): string {
  return "$" + Math.round(n).toLocaleString("es-CL");
}

export interface LineaCotizacionDisplay {
  descripcion: string;
  cantidad: number;
  unidad: string; // "usuario/mes", "hora", "documento", "proyecto", "mes", "GB"
  valorUnitClp: number | null;
  subtotalNetoClp: number | null; // null si está incluido sin costo
}

export interface CotizacionLicitacionData {
  codigo: string;
  nombreCompra: string;
  organismoComprador: string;
  direccionEntrega?: string;
  resumenSolucion: string; // ej. "Plataforma de gestión documental + digitalización de 4.000 documentos"
  lineas: LineaCotizacionDisplay[];
  netoClp: number;
  ivaClp: number;
  totalClp: number;
  topeClp: number;
  plazoContratoDias: number | null;
  garantiaSeriedadClp: number | null;
  documentosExigidos: string[];
  condicionesComerciales: string[];
  fecha: Date;
  company: CompanyConfigLicitaciones;
}

const MESES_ES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

export async function generarCotizacionPptx(data: CotizacionLicitacionData, outputPath: string): Promise<void> {
  const pres = new PptxGenJS();
  pres.defineLayout({ name: "COTIZACION", width: SLIDE_W, height: SLIDE_H });
  pres.layout = "COTIZACION";

  slidePortada(pres, data);
  slideSolucion(pres, data);
  slideMarcoNormativo(pres, data);
  slideCotizacion(pres, data);

  await pres.writeFile({ fileName: outputPath });
}

function agregarBadgeBorrador(slide: PptxGenJS.Slide): void {
  slide.addShape("roundRect", {
    x: SLIDE_W - 3.3, y: 0.35, w: 2.9, h: 0.5,
    fill: { color: COLOR_WARN }, line: { type: "none" }, rectRadius: 0.06,
  });
  slide.addText("BORRADOR — identidad KeepSync sin confirmar", {
    x: SLIDE_W - 3.3, y: 0.35, w: 2.9, h: 0.5,
    align: "center", valign: "middle", fontFace: FONT, fontSize: 9, bold: true, color: COLOR.white,
  });
}

function slidePortada(pres: PptxGenJS, data: CotizacionLicitacionData): void {
  const slide = pres.addSlide();
  slide.background = { color: COLOR.bg };
  if (!data.company.identidad_confirmada) agregarBadgeBorrador(slide);

  slide.addImage({ path: LOGO_PATH, x: 0.7, y: 0.6, w: 1.0, h: 0.98 });
  slide.addText("KeepSync", {
    x: 1.78, y: 0.78, w: 4.0, h: 0.6,
    fontFace: FONT, fontSize: 24, bold: true, color: COLOR.white, valign: "middle",
  });

  slide.addText("PROPUESTA COMERCIAL", {
    x: 0.7, y: 3.0, w: 10.3, h: 0.6,
    fontFace: FONT, fontSize: 32, bold: true, color: COLOR.white,
  });
  slide.addText(`Gestión documental y digitalización de procesos para ${data.organismoComprador}`, {
    x: 0.7, y: 3.5, w: 10.3, h: 1.0,
    fontFace: FONT, fontSize: 20, color: COLOR.accentLight,
  });
  slide.addText(`Respuesta a licitación pública — ${data.codigo}`, {
    x: 0.7, y: 5.05, w: 10.3, h: 0.5,
    fontFace: FONT, fontSize: 14, color: COLOR.gray,
  });

  slide.addShape("roundRect", {
    x: 0.7, y: 5.75, w: 10.3, h: 1.55,
    fill: { color: COLOR.card }, line: { type: "none" }, rectRadius: 0.08,
  });
  const filaInfo = (label: string, valor: string, y: number) => {
    slide.addText(label, { x: 1.0, y, w: 2.3, h: 0.4, fontFace: FONT, fontSize: 11, bold: true, color: COLOR.gray, valign: "middle" });
    slide.addText(valor, { x: 3.3, y, w: 7.5, h: 0.4, fontFace: FONT, fontSize: 13, color: COLOR.white, valign: "middle" });
  };
  filaInfo("CLIENTE", data.organismoComprador, 5.9);
  filaInfo("PROYECTO", data.nombreCompra, 6.3);
  filaInfo("DIRIGIDO A", data.direccionEntrega || "Unidad de compras", 6.7);

  const mesAno = `${MESES_ES[data.fecha.getMonth()]} de ${data.fecha.getFullYear()}`;
  slide.addText(`Presentado por KeepSync  —  ${mesAno}`, {
    x: 0.7, y: 7.65, w: 10.3, h: 0.35,
    fontFace: FONT, fontSize: 11, color: COLOR.gray,
  });
}

function slideSolucion(pres: PptxGenJS, data: CotizacionLicitacionData): void {
  const slide = pres.addSlide();
  slide.background = { color: COLOR.bg };

  slide.addText("Solución propuesta", { x: 0.7, y: 0.5, w: 10.3, h: 0.5, fontFace: FONT, fontSize: 28, bold: true, color: COLOR.white });
  slide.addText(data.resumenSolucion, {
    x: 0.7, y: 1.05, w: 10.3, h: 0.55, fontFace: FONT, fontSize: 14, color: COLOR.gray,
  });

  const columnas = [
    { titulo: "Gestión documental", cuerpo: "Repositorio centralizado, control de versiones y trazabilidad de toda la documentación institucional." },
    { titulo: "Oficina de partes digital", cuerpo: "Recepción, derivación y seguimiento electrónico de correspondencia y expedientes, sin papel." },
    { titulo: "Digitalización de procesos", cuerpo: "Flujos de trabajo, firma electrónica y expediente electrónico alineados a la tramitación digital del Estado." },
  ];
  const colW = 3.2;
  const gap = 0.25;
  columnas.forEach((col, i) => {
    const x = 0.7 + i * (colW + gap);
    slide.addShape("roundRect", { x, y: 1.85, w: colW, h: 1.9, fill: { color: COLOR.card }, line: { type: "none" }, rectRadius: 0.06 });
    slide.addShape("ellipse", { x: x + 0.25, y: 2.1, w: 0.4, h: 0.4, fill: { color: COLOR.accent }, line: { type: "none" } });
    slide.addText(String(i + 1), { x: x + 0.25, y: 2.1, w: 0.4, h: 0.4, align: "center", valign: "middle", fontFace: FONT, fontSize: 14, bold: true, color: COLOR.white });
    slide.addText(col.titulo, { x: x + 0.25, y: 2.65, w: colW - 0.5, h: 0.4, fontFace: FONT, fontSize: 13, bold: true, color: COLOR.white });
    slide.addText(col.cuerpo, { x: x + 0.25, y: 3.05, w: colW - 0.5, h: 0.6, fontFace: FONT, fontSize: 10, color: COLOR.gray });
  });

  slide.addText("Cumplimiento del requerimiento", { x: 0.7, y: 4.05, w: 10.3, h: 0.4, fontFace: FONT, fontSize: 16, bold: true, color: COLOR.white });

  const filas: string[] = [`Producto/servicio — ${data.resumenSolucion}`];
  if (data.plazoContratoDias != null) filas.push(`Plazo de contrato — ${data.plazoContratoDias} día(s)`);
  if (data.garantiaSeriedadClp != null) filas.push(`Garantía de seriedad de la oferta — ${formatoClp(data.garantiaSeriedadClp)}`);
  for (const doc of data.documentosExigidos) filas.push(`Documento exigido — ${doc}`);

  let y = 4.55;
  for (const fila of filas) {
    slide.addShape("ellipse", { x: 0.7, y: y + 0.02, w: 0.28, h: 0.28, fill: { color: COLOR.accent }, line: { type: "none" } });
    slide.addText("OK", { x: 0.7, y: y + 0.02, w: 0.28, h: 0.28, align: "center", valign: "middle", fontFace: FONT, fontSize: 8, bold: true, color: COLOR.white });
    slide.addText(fila, { x: 1.1, y, w: 9.8, h: 0.35, fontFace: FONT, fontSize: 12, color: COLOR.white, valign: "middle" });
    y += 0.42;
  }

  slide.addText(
    `Proveedor hábil en el Sistema de Información (Mercado Público) — Cotización formal adjunta con el detalle de lo ofertado.`,
    { x: 0.7, y: 7.55, w: 10.3, h: 0.5, fontFace: FONT, fontSize: 10, italic: true, color: COLOR.gray },
  );
}

function slideMarcoNormativo(pres: PptxGenJS, data: CotizacionLicitacionData): void {
  const slide = pres.addSlide();
  slide.background = { color: COLOR.bg };

  slide.addText("MARCO NORMATIVO", { x: 0.62, y: 0.55, w: 9.0, h: 0.3, fontFace: FONT, fontSize: 12, bold: true, color: COLOR.accentLight, charSpacing: 2 });
  slide.addText("Alineación con la Ley 21.180", { x: 0.62, y: 0.86, w: 10.4, h: 0.9, fontFace: FONT, fontSize: 26, bold: true, color: COLOR.white });
  slide.addText(
    `Ley de Transformación Digital del Estado (modifica la Ley 19.880, Art. 16 bis y siguientes). La solución de gestión documental propuesta apoya directamente a ${data.organismoComprador} en el cumplimiento de la tramitación digital de los procedimientos administrativos que la ley exige.`,
    { x: 0.62, y: 1.86, w: 10.45, h: 0.85, fontFace: FONT, fontSize: 13, color: COLOR.gray },
  );

  const puntos = [
    { titulo: "Expediente electrónico", cuerpo: "Constituye y ordena el expediente electrónico exigido por la ley, con trazabilidad completa de cada actuación." },
    { titulo: "Interoperabilidad", cuerpo: "Facilita el intercambio de documentos entre órganos de la administración, uno de los principios centrales de la ley." },
    { titulo: "Firma y notificación electrónica", cuerpo: "Soporta la escrituración y notificación de actos administrativos por medios electrónicos." },
    { titulo: "Reducción de papel y trazabilidad", cuerpo: "Elimina flujos en papel, reduce tiempos de tramitación y deja registro íntegro y auditable de cada documento." },
  ];
  const cardW = 5.06;
  const cardH = 1.95;
  const gapX = 0.25;
  const gapY = 0.2;
  puntos.forEach((punto, i) => {
    const col = i % 2;
    const fila = Math.floor(i / 2);
    const x = 0.62 + col * (cardW + gapX);
    const y = 2.72 + fila * (cardH + gapY);
    slide.addShape("roundRect", { x, y, w: cardW, h: cardH, fill: { color: COLOR.card }, line: { type: "none" }, rectRadius: 0.06 });
    slide.addShape("ellipse", { x: x + 0.32, y: y + 0.3, w: 0.44, h: 0.44, fill: { color: COLOR.accent }, line: { type: "none" } });
    slide.addText("✓", { x: x + 0.32, y: y + 0.3, w: 0.44, h: 0.44, align: "center", valign: "middle", fontFace: FONT, fontSize: 16, bold: true, color: COLOR.white });
    slide.addText(punto.titulo, { x: x + 0.32, y: y + 0.86, w: cardW - 0.6, h: 0.4, fontFace: FONT, fontSize: 13, bold: true, color: COLOR.white });
    slide.addText(punto.cuerpo, { x: x + 0.32, y: y + 1.24, w: cardW - 0.6, h: 0.6, fontFace: FONT, fontSize: 10, color: COLOR.gray });
  });

  slide.addText(
    `La solución es una herramienta de apoyo a la gestión; el cumplimiento normativo final depende de los procesos y plataformas oficiales de ${data.organismoComprador}. Ley 21.180 — modifica la Ley 19.880.`,
    { x: 0.62, y: 7.5, w: 10.45, h: 0.5, fontFace: FONT, fontSize: 9, italic: true, color: COLOR.gray },
  );
}

function slideCotizacion(pres: PptxGenJS, data: CotizacionLicitacionData): void {
  const slide = pres.addSlide();
  slide.background = { color: COLOR.bg };
  if (!data.company.identidad_confirmada) agregarBadgeBorrador(slide);

  slide.addText("Cotización formal", { x: 0.7, y: 0.55, w: 10.3, h: 0.7, fontFace: FONT, fontSize: 30, bold: true, color: COLOR.white });
  slide.addText(
    `Valores en pesos chilenos (CLP), impuestos incluidos. Servicios de gestión documental y digitalización de procesos, gestión y soporte de KeepSync.`,
    { x: 0.7, y: 1.28, w: 10.3, h: 0.5, fontFace: FONT, fontSize: 13, color: COLOR.gray },
  );

  const headerRow = [
    { text: "Descripción", options: { bold: true, color: COLOR.white, fill: { color: COLOR.cardAlt } } },
    { text: "Cant.", options: { bold: true, color: COLOR.white, fill: { color: COLOR.cardAlt }, align: "center" as const } },
    { text: "Unidad", options: { bold: true, color: COLOR.white, fill: { color: COLOR.cardAlt }, align: "center" as const } },
    { text: "Valor unitario", options: { bold: true, color: COLOR.white, fill: { color: COLOR.cardAlt }, align: "right" as const } },
    { text: "Subtotal neto", options: { bold: true, color: COLOR.white, fill: { color: COLOR.cardAlt }, align: "right" as const } },
  ];
  const bodyRows = data.lineas.map((linea) => [
    { text: linea.descripcion, options: { color: COLOR.white } },
    { text: String(linea.cantidad), options: { color: COLOR.white, align: "center" as const } },
    { text: linea.unidad, options: { color: COLOR.white, align: "center" as const } },
    { text: linea.valorUnitClp != null ? formatoClp(linea.valorUnitClp) : "—", options: { color: COLOR.white, align: "right" as const } },
    { text: linea.subtotalNetoClp != null ? formatoClp(linea.subtotalNetoClp) : "Incluida", options: { color: COLOR.white, align: "right" as const } },
  ]);

  slide.addTable([headerRow, ...bodyRows], {
    x: 0.7, y: 2.0, w: 10.3,
    fontFace: FONT, fontSize: 11,
    border: { type: "solid", color: COLOR.bg, pt: 2 },
    fill: { color: COLOR.card },
    autoPage: false,
    colW: [4.0, 0.8, 1.4, 2.05, 2.05],
    rowH: 0.5,
  });

  const totalsY = 2.05 + (bodyRows.length + 1) * 0.5 + 0.35;
  const filaTotal = (label: string, valor: string, y: number, destacado = false) => {
    slide.addText(label, { x: 6.7, y, w: 2.3, h: 0.4, fontFace: FONT, fontSize: destacado ? 15 : 12, bold: destacado, color: destacado ? COLOR.white : COLOR.gray, valign: "middle" });
    slide.addText(valor, { x: 9.0, y, w: 2.0, h: 0.4, fontFace: FONT, fontSize: destacado ? 15 : 12, bold: destacado, color: COLOR.white, align: "right", valign: "middle" });
  };
  filaTotal("Neto", formatoClp(data.netoClp), totalsY);
  filaTotal("IVA 19%", formatoClp(data.ivaClp), totalsY + 0.42);

  slide.addShape("roundRect", { x: 6.7, y: totalsY + 0.9, w: 4.3, h: 0.6, fill: { color: COLOR.accent }, line: { type: "none" }, rectRadius: 0.06 });
  filaTotal("TOTAL", formatoClp(data.totalClp), totalsY + 0.9 + 0.1, true);

  const bajoTope = data.totalClp <= data.topeClp;
  slide.addText(
    bajoTope
      ? `Oferta bajo el presupuesto disponible de ${formatoClp(data.topeClp)}`
      : `⚠ ADVERTENCIA: esta oferta (${formatoClp(data.totalClp)}) supera el presupuesto disponible de ${formatoClp(data.topeClp)} — sería inadmisible. No enviar.`,
    { x: 0.7, y: totalsY, w: 5.7, h: 0.4, fontFace: FONT, fontSize: 11, color: bajoTope ? COLOR.accentLight : "FF4D4D", bold: !bajoTope },
  );

  const condicionesY = totalsY + 1.75;
  slide.addText("Condiciones comerciales", { x: 0.7, y: condicionesY, w: 10.3, h: 0.35, fontFace: FONT, fontSize: 14, bold: true, color: COLOR.white });
  slide.addText(
    data.condicionesComerciales.map((c) => `•  ${c}`).join("\n"),
    { x: 0.7, y: condicionesY + 0.4, w: 10.3, h: 1.3, fontFace: FONT, fontSize: 11, color: COLOR.gray, lineSpacingMultiple: 1.3 },
  );

  const footer = data.company.identidad_confirmada
    ? `KeepSync   —   ${data.company.contacto.email}   —   Válido por 30 días`
    : `KeepSync   —   ${data.company.contacto.email}   —   BORRADOR: RUT y razón social pendientes de confirmar antes de enviar`;
  slide.addText(footer, {
    x: 0.7, y: 7.75, w: 10.3, h: 0.35, fontFace: FONT, fontSize: 10,
    color: data.company.identidad_confirmada ? COLOR.gray : COLOR_WARN, bold: !data.company.identidad_confirmada,
  });
}
