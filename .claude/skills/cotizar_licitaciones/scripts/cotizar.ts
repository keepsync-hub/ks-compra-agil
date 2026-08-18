import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { LIC_ROOT_DIR, loadCompanyConfig } from "../../../../licitaciones/src/lib/config.js";
import { obtenerDetalleLicitacion, itemsDeLicitacion, type LicitacionDetalle, type ItemLicitacion } from "../../../../licitaciones/src/lib/api.js";
import { extraerCondicionesLicitacion, type CondicionesLicitacion } from "../../../../licitaciones/src/lib/condiciones.js";
import { detectarItemPricingDeTexto, cotizarItem, type LineaCotizada } from "../../../../licitaciones/src/lib/pricing.js";
import { generarCotizacionPptx, type LineaCotizacionDisplay } from "../../../../licitaciones/src/lib/cotizacion-pptx.js";
import { generarCotizacionPdf } from "../../../../licitaciones/src/lib/cotizacion-pdf.js";
import { nombreArchivoCotizacion } from "../../../../licitaciones/src/lib/nombre-archivo.js";
import { cierreYaPaso } from "../../../../licitaciones/src/lib/tiempo.js";

async function cargarDetalle(codigo: string): Promise<LicitacionDetalle> {
  const cachePath = path.join(LIC_ROOT_DIR, "data", codigo, "detalle.json");
  if (existsSync(cachePath)) {
    console.log(`Usando detalle en caché de licitaciones/data/${codigo}/detalle.json (correr \`npm run radar-licitaciones\` para refrescar).`);
    return JSON.parse(readFileSync(cachePath, "utf-8")) as LicitacionDetalle;
  }
  console.log(`Sin caché local, consultando la API...`);
  return obtenerDetalleLicitacion(codigo);
}

interface LineaACotizar {
  clave: string;
  cantidad: number;
  requiereRevision: boolean;
  origenDescripcion: string;
}

/**
 * Mapea los ítems solicitados de la licitación al catálogo de costos de KeepSync. Devuelve null
 * si no puede mapear con confianza — el agente no adivina qué está ofertando ni a qué cantidad.
 */
function construirLineasACotizar(items: ItemLicitacion[]): LineaACotizar[] | null {
  if (items.length === 0) return null;
  const lineas: LineaACotizar[] = [];
  for (const item of items) {
    const texto = `${item.NombreProducto ?? ""} ${item.Descripcion ?? ""}`;
    const det = detectarItemPricingDeTexto(texto);
    const cantidad = item.Cantidad;
    if (!det || !cantidad || cantidad < 1) return null;
    lineas.push({ clave: det.clave, cantidad, requiereRevision: det.requiereRevision, origenDescripcion: texto.trim() });
  }
  return lineas;
}

async function main() {
  const codigo = process.argv[2];
  if (!codigo) {
    console.error("Uso: npm run cotizar-licitaciones -- <codigo>  (ej. npm run cotizar-licitaciones -- 1234-56-L124)");
    process.exitCode = 1;
    return;
  }

  const company = loadCompanyConfig();
  const detalle = await cargarDetalle(codigo);

  const fechaCierre = detalle.FechaCierre ?? detalle.Fechas?.FechaCierre;
  if (fechaCierre && cierreYaPaso(fechaCierre)) {
    console.error(`${codigo} ya cerró (${fechaCierre}, hora de Chile). No se cotiza.`);
    process.exitCode = 1;
    return;
  }

  const condiciones = extraerCondicionesLicitacion(detalle);
  const items = itemsDeLicitacion(detalle);

  const lineasACotizar = construirLineasACotizar(items);
  if (!lineasACotizar) {
    console.error(
      `No se pudo determinar automáticamente qué ítems del catálogo de KeepSync corresponden a ${codigo} ` +
        `(${items.length} ítem(s) solicitado(s) en la ficha, ninguno mapeó con confianza a ` +
        `licitaciones/config/company.json → pricing.items, o falta la cantidad). Revisar manualmente — ` +
        `el agente no adivina.`,
    );
    process.exitCode = 1;
    return;
  }
  if (lineasACotizar.some((l) => l.requiereRevision)) {
    console.warn(`Aviso: uno o más ítems (capacitación/integración) se cotizaron con una cantidad tomada literal del texto — confirmar manualmente antes de enviar.`);
  }

  const lineasCotizadas: LineaCotizada[] = lineasACotizar.map((l) => cotizarItem(l.clave, company, l.cantidad));
  const netoClpTotal = lineasCotizadas.reduce((a, l) => a + l.neto_clp_total, 0);
  const ivaClpTotal = lineasCotizadas.reduce((a, l) => a + l.iva_clp_total, 0);
  const totalClpTotal = lineasCotizadas.reduce((a, l) => a + l.total_clp_total, 0);

  if (condiciones.tope_clp > 0 && totalClpTotal > condiciones.tope_clp) {
    console.error(
      `\nINADMISIBLE: la cotización (${totalClpTotal.toLocaleString("es-CL")} CLP) supera el tope ` +
        `presupuestario de ${codigo} (${condiciones.tope_clp.toLocaleString("es-CL")} CLP). ` +
        `No se genera oferta — cotizar por sobre el tope es causal de inadmisibilidad. No enviar.`,
    );
    process.exitCode = 1;
    return;
  }
  if (condiciones.tope_clp === 0) {
    console.warn(
      `Aviso: no se detectó un tope presupuestario (MontoEstimado) en la ficha de ${codigo} — no se puede ` +
        `validar automáticamente que la oferta quepa bajo el tope. Confirmar manualmente antes de enviar.`,
    );
  }

  const resumenSolucion = lineasCotizadas.map((l) => `${l.cantidad} ${l.unidad} — ${l.descripcion}`).join(" + ");

  const lineasDisplay: LineaCotizacionDisplay[] = lineasCotizadas.map((l) => ({
    descripcion: l.descripcion,
    cantidad: l.cantidad,
    unidad: l.unidad,
    valorUnitClp: l.neto_clp_unitario,
    subtotalNetoClp: l.neto_clp_total,
  }));

  const condicionesComerciales = [
    condiciones.plazo_contrato_dias != null
      ? `Plazo de contrato: ${condiciones.plazo_contrato_dias} día(s) desde la adjudicación.`
      : "Plazo de contrato a confirmar con el organismo.",
    "Proveedor con habilidad vigente en el Sistema de Información (Mercado Público).",
    ...condiciones.documentos_exigidos.map((d) => `Documento exigido: ${d} — adjuntar junto con la oferta.`),
  ];
  if (condiciones.garantia_seriedad_clp != null) {
    condicionesComerciales.push(
      `Garantía de seriedad de la oferta: $${condiciones.garantia_seriedad_clp.toLocaleString("es-CL")} CLP` +
        (condiciones.garantia_seriedad_dias != null ? `, vigencia ${condiciones.garantia_seriedad_dias} día(s).` : "."),
    );
  }
  if (condiciones.garantia_fiel_cumplimiento_clp != null) {
    condicionesComerciales.push(
      `Garantía de fiel cumplimiento de contrato: $${condiciones.garantia_fiel_cumplimiento_clp.toLocaleString("es-CL")} CLP.`,
    );
  }
  if (condiciones.excluyentes.length > 0) {
    condicionesComerciales.push(`Condiciones excluyentes detectadas en las bases: ${condiciones.excluyentes.join(" | ")}`);
  }

  const fecha = new Date();
  const organismoComprador = detalle.Comprador?.NombreOrganismo ?? "Organismo comprador";
  const dirSalida = path.join(LIC_ROOT_DIR, "output", codigo);
  mkdirSync(dirSalida, { recursive: true });
  const nombreBase = nombreArchivoCotizacion(fecha, organismoComprador);
  const nombreArchivoPptx = `${nombreBase}.pptx`;
  const nombreArchivoPdf = `${nombreBase}.pdf`;
  const rutaPptx = path.join(dirSalida, nombreArchivoPptx);
  const rutaPdf = path.join(dirSalida, nombreArchivoPdf);

  const datosCotizacion = {
    codigo,
    nombreCompra: detalle.Nombre,
    organismoComprador,
    direccionEntrega: undefined,
    resumenSolucion,
    lineas: lineasDisplay,
    netoClp: netoClpTotal,
    ivaClp: ivaClpTotal,
    totalClp: totalClpTotal,
    topeClp: condiciones.tope_clp,
    plazoContratoDias: condiciones.plazo_contrato_dias,
    garantiaSeriedadClp: condiciones.garantia_seriedad_clp,
    documentosExigidos: condiciones.documentos_exigidos,
    condicionesComerciales,
    fecha,
    company,
  };

  await generarCotizacionPptx(datosCotizacion, rutaPptx);
  await generarCotizacionPdf(datosCotizacion, rutaPdf);

  const resumenPath = path.join(dirSalida, "cotizacion-resumen.json");
  writeFileSync(
    resumenPath,
    JSON.stringify(
      {
        codigo,
        resumenSolucion,
        neto_clp_total: netoClpTotal,
        iva_clp_total: ivaClpTotal,
        total_clp_total: totalClpTotal,
        lineas: lineasCotizadas,
        tope_clp: condiciones.tope_clp,
        archivo_pptx: nombreArchivoPptx,
        archivo_pdf: nombreArchivoPdf,
        archivo_publicable: nombreArchivoPdf,
      },
      null,
      2,
    ),
    "utf-8",
  );

  console.log(`\nCotización generada: ${rutaPptx}`);
  console.log(`PDF (artefacto final a publicar): ${rutaPdf}`);
  console.log(
    `Total: $${totalClpTotal.toLocaleString("es-CL")} CLP` +
      (condiciones.tope_clp > 0 ? ` (tope: $${condiciones.tope_clp.toLocaleString("es-CL")} CLP) — dentro del tope.` : " (tope no detectado — confirmar manualmente)."),
  );
  console.log(`\nEsto NO envía nada. Este skill solo cubre la cotización — el login y formulario del portal de Licitaciones no están construidos (ver licitaciones/PLAN.md). Revisión humana obligatoria antes de cualquier envío real.`);
}

main().catch((err) => {
  console.error("Cotización de licitación falló:", err);
  process.exitCode = 1;
});
