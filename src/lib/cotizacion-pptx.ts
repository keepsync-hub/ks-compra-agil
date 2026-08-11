import path from "node:path";
import { fileURLToPath } from "node:url";
import PptxGenJS from "pptxgenjs";
import type { CompanyConfig } from "./config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOGO_PATH = path.join(__dirname, "..", "assets", "logo-keepsync-blanco.png");

// Paleta y layout tomados de la plantilla de referencia del usuario (propuesta.pptx):
// fondo casi negro, acentos morados, tarjetas redondeadas. Tamaño de slide replicado 1:1
// (11.69" x 8.27", no es el 16:9 estándar de pptxgenjs).
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

function formatoClp(n: number): string {
  return "$" + Math.round(n).toLocaleString("es-CL");
}

export interface LineaCotizacionDisplay {
  descripcion: string;
  cantidad: number;
  meses: number | null; // null para ítems sin duración (ej. sesión de capacitación incluida)
  valorUnitMensualClp: number | null; // null si está incluido sin costo
  subtotalNetoClp: number | null; // null si está incluido sin costo
}

export interface CotizacionPptxData {
  codigo: string;
  nombreCompra: string;
  organismoComprador: string;
  direccionEntrega?: string;
  planPrincipal: string;
  cantidadUsuarios: number;
  mesesVigencia: number;
  lineas: LineaCotizacionDisplay[];
  netoClp: number;
  ivaClp: number;
  totalClp: number;
  topeClp: number;
  plazoEntregaDias: number | null;
  documentosExigidos: string[];
  condicionesComerciales: string[];
  fecha: Date;
  company: CompanyConfig;
}

const MESES_ES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

export async function generarCotizacionPptx(data: CotizacionPptxData, outputPath: string): Promise<void> {
  const pres = new PptxGenJS();
  pres.defineLayout({ name: "COTIZACION", width: SLIDE_W, height: SLIDE_H });
  pres.layout = "COTIZACION";

  slidePortada(pres, data);
  slideSolucion(pres, data);
  slideMarcoNormativo(pres, data);
  slideCotizacion(pres, data);

  await pres.writeFile({ fileName: outputPath });
}

const COLOR_WARN = "FF4D4D";

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

function slidePortada(pres: PptxGenJS, data: CotizacionPptxData): void {
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
  slide.addText(`Licencias ${data.planPrincipal} para ${data.organismoComprador}`, {
    x: 0.7, y: 3.5, w: 10.3, h: 1.0,
    fontFace: FONT, fontSize: 22, color: COLOR.accentLight,
  });
  slide.addText(`Respuesta a solicitud de Compra Ágil — ${data.codigo}`, {
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

function slideSolucion(pres: PptxGenJS, data: CotizacionPptxData): void {
  const slide = pres.addSlide();
  slide.background = { color: COLOR.bg };

  slide.addText("Solución propuesta", { x: 0.7, y: 0.5, w: 10.3, h: 0.5, fontFace: FONT, fontSize: 28, bold: true, color: COLOR.white });
  slide.addText(
    `${data.cantidadUsuarios} cuenta${data.cantidadUsuarios === 1 ? "" : "s"} ${data.planPrincipal} por ${data.mesesVigencia} meses, con acceso al asistente de IA de Anthropic para el equipo de ${data.organismoComprador}.`,
    { x: 0.7, y: 1.05, w: 10.3, h: 0.55, fontFace: FONT, fontSize: 14, color: COLOR.gray },
  );

  const columnas = [
    { titulo: "Capacidad ampliada", cuerpo: "Uso significativamente mayor que el plan gratuito, con acceso prioritario en horas de alta demanda." },
    { titulo: "Modelos avanzados", cuerpo: "Acceso a los modelos más capaces de Claude para redacción, análisis de documentos, código y automatización." },
    { titulo: "Herramientas de trabajo", cuerpo: "Proyectos, carga de archivos y funciones de investigación y razonamiento extendido para tareas complejas." },
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

  const filas: string[] = [
    `Producto/servicio — ${data.cantidadUsuarios} licencia${data.cantidadUsuarios === 1 ? "" : "s"} ${data.planPrincipal} — ${data.mesesVigencia} meses`,
  ];
  if (data.plazoEntregaDias != null) filas.push(`Plazo de entrega — activación en ${data.plazoEntregaDias} día${data.plazoEntregaDias === 1 ? "" : "s"} hábil(es)`);
  for (const doc of data.documentosExigidos) filas.push(`Documento exigido — ${doc}`);
  filas.push("Despacho digital — incluido en el valor total");

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

function slideMarcoNormativo(pres: PptxGenJS, data: CotizacionPptxData): void {
  const slide = pres.addSlide();
  slide.background = { color: COLOR.bg };

  slide.addText("MARCO NORMATIVO", { x: 0.62, y: 0.55, w: 9.0, h: 0.3, fontFace: FONT, fontSize: 12, bold: true, color: COLOR.accentLight, charSpacing: 2 });
  slide.addText("Alineación con la Ley 21.180", { x: 0.62, y: 0.86, w: 10.4, h: 0.9, fontFace: FONT, fontSize: 26, bold: true, color: COLOR.white });
  slide.addText(
    `Ley de Transformación Digital del Estado (Art. 16 bis). Las licencias ${data.planPrincipal} potencian al equipo de ${data.organismoComprador} para operar bajo los principios que la ley establece en la tramitación electrónica de los procedimientos administrativos.`,
    { x: 0.62, y: 1.86, w: 10.45, h: 0.85, fontFace: FONT, fontSize: 13, color: COLOR.gray },
  );

  const puntos = [
    { titulo: "Actualización", cuerpo: `${data.planPrincipal} es tecnología de IA vigente y con soporte activo: evita el uso de plataformas obsoletas y mantiene al equipo con herramientas de última generación.` },
    { titulo: "Escrituración electrónica", cuerpo: "Acelera la redacción, revisión y estandarización de actos y documentos administrativos expresados por medios electrónicos." },
    { titulo: "Fidelidad del expediente", cuerpo: "Apoya el análisis, resumen y ordenamiento de la documentación, ayudando a mantener registros íntegros y trazables." },
    { titulo: "Eficiencia y cooperación", cuerpo: "Automatiza tareas repetitivas y facilita el trabajo colaborativo entre equipos, liberando tiempo para modernizar los servicios." },
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
    `${data.planPrincipal} es una herramienta de apoyo a la gestión; el cumplimiento normativo depende de los procesos, firmas y plataformas oficiales de ${data.organismoComprador}. Ley 21.180 — modifica la Ley 19.880.`,
    { x: 0.62, y: 7.5, w: 10.45, h: 0.5, fontFace: FONT, fontSize: 9, italic: true, color: COLOR.gray },
  );
}

function slideCotizacion(pres: PptxGenJS, data: CotizacionPptxData): void {
  const slide = pres.addSlide();
  slide.background = { color: COLOR.bg };
  if (!data.company.identidad_confirmada) agregarBadgeBorrador(slide);

  slide.addText("Cotización formal", { x: 0.7, y: 0.55, w: 10.3, h: 0.7, fontFace: FONT, fontSize: 30, bold: true, color: COLOR.white });
  slide.addText(
    `Valores en pesos chilenos (CLP), impuestos incluidos. Licencias ${data.planPrincipal} por ${data.mesesVigencia} meses, gestión y soporte de KeepSync.`,
    { x: 0.7, y: 1.28, w: 10.3, h: 0.5, fontFace: FONT, fontSize: 13, color: COLOR.gray },
  );

  const headerRow = [
    { text: "Descripción", options: { bold: true, color: COLOR.white, fill: { color: COLOR.cardAlt } } },
    { text: "Cant.", options: { bold: true, color: COLOR.white, fill: { color: COLOR.cardAlt }, align: "center" as const } },
    { text: "Meses", options: { bold: true, color: COLOR.white, fill: { color: COLOR.cardAlt }, align: "center" as const } },
    { text: "Valor unit. mensual", options: { bold: true, color: COLOR.white, fill: { color: COLOR.cardAlt }, align: "right" as const } },
    { text: "Subtotal neto", options: { bold: true, color: COLOR.white, fill: { color: COLOR.cardAlt }, align: "right" as const } },
  ];
  const bodyRows = data.lineas.map((linea) => [
    { text: linea.descripcion, options: { color: COLOR.white } },
    { text: String(linea.cantidad), options: { color: COLOR.white, align: "center" as const } },
    { text: linea.meses != null ? String(linea.meses) : "—", options: { color: COLOR.white, align: "center" as const } },
    { text: linea.valorUnitMensualClp != null ? formatoClp(linea.valorUnitMensualClp) : "—", options: { color: COLOR.white, align: "right" as const } },
    { text: linea.subtotalNetoClp != null ? formatoClp(linea.subtotalNetoClp) : "Incluida", options: { color: COLOR.white, align: "right" as const } },
  ]);

  slide.addTable([headerRow, ...bodyRows], {
    x: 0.7, y: 2.0, w: 10.3,
    fontFace: FONT, fontSize: 11,
    border: { type: "solid", color: COLOR.bg, pt: 2 },
    fill: { color: COLOR.card },
    autoPage: false,
    colW: [4.2, 0.9, 0.9, 2.15, 2.15],
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
