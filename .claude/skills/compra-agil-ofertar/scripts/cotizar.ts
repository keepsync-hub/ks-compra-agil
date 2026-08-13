import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ROOT_DIR, loadCompanyConfig } from "../../../../src/lib/config.js";
import { obtenerDetalleCompraAgil, type CompraAgilDetalle } from "../../../../src/lib/api.js";
import { extraerCondiciones } from "../../../../src/lib/condiciones.js";
import { obtenerTipoCambioUsdClp, cotizarLinea, mapearPlanAClavePricing } from "../../../../src/lib/pricing.js";
import { generarCotizacionPptx, type LineaCotizacionDisplay } from "../../../../src/lib/cotizacion-pptx.js";
import { generarCotizacionPdf } from "../../../../src/lib/cotizacion-pdf.js";
import { nombreArchivoCotizacion } from "../../../../src/lib/nombre-archivo.js";
import { cierreYaPaso } from "../../../../src/lib/tiempo.js";

async function cargarDetalle(codigo: string): Promise<CompraAgilDetalle> {
  const cachePath = path.join(ROOT_DIR, "data", codigo, "detalle.json");
  if (existsSync(cachePath)) {
    console.log(`Usando detalle en caché de data/${codigo}/detalle.json (correr \`npm run radar\` para refrescar).`);
    return JSON.parse(readFileSync(cachePath, "utf-8")) as CompraAgilDetalle;
  }
  console.log(`Sin caché local, consultando la API...`);
  return obtenerDetalleCompraAgil(codigo);
}

async function main() {
  const codigo = process.argv[2];
  if (!codigo) {
    console.error("Uso: npm run cotizar -- <codigo>  (ej. npm run cotizar -- 1614-47-COT26)");
    process.exitCode = 1;
    return;
  }

  const company = loadCompanyConfig();
  const detalle = await cargarDetalle(codigo);

  if (detalle.estado.codigo !== "publicada") {
    console.error(`${codigo} no está publicada (estado actual: ${detalle.estado.glosa}). No se cotiza.`);
    process.exitCode = 1;
    return;
  }
  // El cierre viene en hora de Chile sin zona horaria; se evalúa como America/Santiago (no como
  // hora del proceso, que en la nube es UTC) para no descartar oportunidades aún abiertas.
  if (cierreYaPaso(detalle.fechas.fecha_cierre)) {
    console.error(`${codigo} ya cerró (${detalle.fechas.fecha_cierre}, hora de Chile). No se cotiza.`);
    process.exitCode = 1;
    return;
  }

  const condiciones = extraerCondiciones(detalle);

  const planMapeado = mapearPlanAClavePricing(condiciones.plan_detectado);
  if (!planMapeado) {
    console.error(
      `No se pudo determinar automáticamente el plan a cotizar (detectado: "${condiciones.plan_detectado}"). ` +
        `Revisar manualmente la descripción de ${codigo} y, si corresponde, cotizar a mano — el agente no adivina el plan.`,
    );
    process.exitCode = 1;
    return;
  }
  if (planMapeado.requiereRevision) {
    console.warn(
      `Aviso: plan "Team" detectado sin distinguir asiento estándar/premium en el texto — se está usando ` +
        `"${company.pricing.planes[planMapeado.clave]?.nombre}" por defecto. Confirmar manualmente antes de enviar.`,
    );
  }

  if (!condiciones.cantidad_usuarios) {
    console.error(`No se pudo determinar la cantidad de usuarios/licencias solicitadas en ${codigo}. Revisar manualmente.`);
    process.exitCode = 1;
    return;
  }
  const meses = condiciones.meses_vigencia ?? 12;
  if (!condiciones.meses_vigencia) {
    console.warn(`No se detectó la duración explícita en el texto — asumiendo 12 meses. Confirmar manualmente.`);
  }

  const fx = await obtenerTipoCambioUsdClp(company.pricing.fx_fallback_clp_por_usd);
  console.log(`Tipo de cambio usado: $${fx.valor} CLP/USD (${fx.fuente})`);

  const linea = cotizarLinea(planMapeado.clave, company, condiciones.cantidad_usuarios, meses, fx.valor);

  if (linea.total_clp_total > condiciones.tope_clp) {
    console.error(
      `\nINADMISIBLE: la cotización (${linea.total_clp_total.toLocaleString("es-CL")} CLP) supera el tope ` +
        `presupuestario de ${codigo} (${condiciones.tope_clp.toLocaleString("es-CL")} CLP). ` +
        `No se genera oferta — cotizar por sobre el tope es causal de inadmisibilidad. No enviar.`,
    );
    process.exitCode = 1;
    return;
  }

  const lineasDisplay: LineaCotizacionDisplay[] = [
    {
      descripcion: `Licencia cuenta ${linea.plan}`,
      cantidad: linea.cantidad,
      meses: linea.meses,
      valorUnitMensualClp: linea.neto_clp_unitario / linea.meses,
      subtotalNetoClp: linea.neto_clp_total,
    },
  ];

  const condicionesComerciales = [
    `Plazo de entrega / activación: ${condiciones.plazo_entrega_dias ?? "a confirmar"} día(s) hábil(es) desde la adjudicación.`,
    "Valor de despacho / entrega digital incluido en el monto total.",
    "Proveedor con habilidad vigente en el Sistema de Información (Mercado Público).",
    ...condiciones.documentos_exigidos.map((d) => `Documento exigido: ${d} — adjuntar junto con la oferta.`),
  ];
  if (condiciones.excluyentes.length > 0) {
    condicionesComerciales.push(`Condiciones excluyentes detectadas en las bases: ${condiciones.excluyentes.join(" | ")}`);
  }

  const fecha = new Date();
  const dirSalida = path.join(ROOT_DIR, "output", codigo);
  mkdirSync(dirSalida, { recursive: true });
  const nombreBase = nombreArchivoCotizacion(fecha, detalle.institucion.organismo_comprador);
  const nombreArchivoPptx = `${nombreBase}.pptx`;
  const nombreArchivoPdf = `${nombreBase}.pdf`;
  const rutaPptx = path.join(dirSalida, nombreArchivoPptx);
  const rutaPdf = path.join(dirSalida, nombreArchivoPdf);

  const datosCotizacion = {
    codigo,
    nombreCompra: detalle.nombre,
    organismoComprador: detalle.institucion.organismo_comprador,
    direccionEntrega: detalle.entrega?.direccion_entrega,
    planPrincipal: linea.plan,
    cantidadUsuarios: condiciones.cantidad_usuarios,
    mesesVigencia: meses,
    lineas: lineasDisplay,
    netoClp: linea.neto_clp_total,
    ivaClp: linea.iva_clp_total,
    totalClp: linea.total_clp_total,
    topeClp: condiciones.tope_clp,
    plazoEntregaDias: condiciones.plazo_entrega_dias,
    documentosExigidos: condiciones.documentos_exigidos,
    condicionesComerciales,
    fecha,
    company,
  };

  // El .pptx es la fuente editable; el .pdf (renderizado con Chromium, no con LibreOffice —
  // ver notas en src/lib/cotizacion-pdf.ts) es el artefacto final que se publica y se sube al
  // portal.
  await generarCotizacionPptx(datosCotizacion, rutaPptx);
  await generarCotizacionPdf(datosCotizacion, rutaPdf);

  const resumenPath = path.join(dirSalida, "cotizacion-resumen.json");
  writeFileSync(
    resumenPath,
    JSON.stringify(
      {
        codigo,
        fx: fx.valor,
        ...linea,
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
  console.log(`Total: $${linea.total_clp_total.toLocaleString("es-CL")} CLP (tope: $${condiciones.tope_clp.toLocaleString("es-CL")} CLP) — dentro del tope.`);
  console.log(`\nEsto NO envía nada. Revisar el archivo y luego usar el flujo de formulario (login + form-fill) para dejar la oferta lista; el envío final lo confirma un humano.`);
}

main().catch((err) => {
  console.error("Cotización falló:", err);
  process.exitCode = 1;
});
