import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ROOT_DIR, loadCompanyConfig } from "../../../../src/lib/config.js";
import { obtenerDetalleCompraAgil, type CompraAgilDetalle } from "../../../../src/lib/api.js";
import { extraerCondiciones } from "../../../../src/lib/condiciones.js";
import { obtenerTipoCambioUsdClp } from "../../../../src/lib/pricing.js";
import { construirLineasACotizar, calcularCotizacion } from "../../../../src/lib/lineas.js";
import { generarCotizacionPptx, type LineaCotizacionDisplay } from "../../../../src/lib/cotizacion-pptx.js";
import { generarCotizacionPdf } from "../../../../src/lib/cotizacion-pdf.js";
import { nombreArchivoCotizacion } from "../../../../src/lib/nombre-archivo.js";
import { cierreYaPaso } from "../../../../src/lib/tiempo.js";
import { configurarCuota } from "../../../../src/lib/cuota.js";

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
  configurarCuota({ script: "cotizar", maxRequests: 5 }); // normalmente 0-1 (cache hit vs. miss)

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

  const meses = condiciones.meses_vigencia ?? 12;
  if (!condiciones.meses_vigencia) {
    console.warn(`No se detectó la duración explícita en el texto — asumiendo 12 meses. Confirmar manualmente.`);
  }

  const lineasPlan = construirLineasACotizar(detalle, condiciones, meses);
  if (!lineasPlan) {
    console.error(
      `No se pudo determinar automáticamente el plan y la cantidad a cotizar en ${codigo} ` +
        `(plan detectado: "${condiciones.plan_detectado}", cantidad: ${condiciones.cantidad_usuarios ?? "?"}). ` +
        `Revisar manualmente — el agente no adivina.`,
    );
    process.exitCode = 1;
    return;
  }
  if (lineasPlan.some((l) => l.requiereRevision)) {
    console.warn(
      `Aviso: uno o más tramos "Team" se detectaron sin distinguir estándar/premium en el texto — se usó ` +
        `estándar por defecto. Confirmar manualmente antes de enviar.`,
    );
  }
  if (lineasPlan.length > 1) {
    console.log(`Cotización multi-tramo: ${lineasPlan.map((l) => `${l.cantidad}×${l.clave}`).join(", ")}.`);
  }

  const fx = await obtenerTipoCambioUsdClp(company.pricing.fx_fallback_clp_por_usd);
  console.log(`Tipo de cambio usado: $${fx.valor} CLP/USD (${fx.fuente})`);

  const { lineasCotizadas, netoClp: netoClpTotal, ivaClp: ivaClpTotal, totalClp: totalClpTotal, cantidadTotal } = calcularCotizacion(
    lineasPlan,
    company,
    fx.valor,
  );

  if (totalClpTotal > condiciones.tope_clp) {
    console.error(
      `\nINADMISIBLE: la cotización (${totalClpTotal.toLocaleString("es-CL")} CLP) supera el tope ` +
        `presupuestario de ${codigo} (${condiciones.tope_clp.toLocaleString("es-CL")} CLP). ` +
        `No se genera oferta — cotizar por sobre el tope es causal de inadmisibilidad. No enviar.`,
    );
    process.exitCode = 1;
    return;
  }

  // Etiqueta del plan para títulos: un solo nombre si hay un tramo; "Claude Team" si todos son
  // Team; si no, los nombres distintos unidos.
  const nombresDistintos = [...new Set(lineasCotizadas.map((l) => l.plan))];
  const planPrincipal =
    nombresDistintos.length === 1
      ? nombresDistintos[0]!
      : lineasPlan.every((l) => l.clave.startsWith("team"))
        ? "Claude Team"
        : nombresDistintos.join(" + ");

  const lineasDisplay: LineaCotizacionDisplay[] = [
    ...lineasCotizadas.map((l) => ({
      descripcion: `Licencia cuenta ${l.plan}`,
      cantidad: l.cantidad,
      meses: l.meses,
      valorUnitMensualClp: l.neto_clp_unitario / l.meses,
      subtotalNetoClp: l.neto_clp_total,
    })),
    // Valor agregado incluido siempre, sin costo adicional (subtotal null → "Incluida").
    {
      descripcion: "Taller de buenas prácticas (3 horas) para aprovechar al máximo la plataforma",
      cantidad: 1,
      meses: null,
      valorUnitMensualClp: null,
      subtotalNetoClp: null,
    },
    {
      descripcion: "Acceso a la comunidad de usuarios de Claude en Chile",
      cantidad: 1,
      meses: null,
      valorUnitMensualClp: null,
      subtotalNetoClp: null,
    },
  ];

  const condicionesComerciales = [
    `Plazo de entrega / activación: ${condiciones.plazo_entrega_dias ?? "a confirmar"} día(s) hábil(es) desde la adjudicación.`,
    "Incluye, sin costo adicional, un taller de buenas prácticas de 3 horas para aprovechar al máximo la plataforma.",
    "Incluye, sin costo adicional, acceso a la comunidad de usuarios de Claude en Chile.",
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
    planPrincipal,
    cantidadUsuarios: cantidadTotal,
    mesesVigencia: meses,
    lineas: lineasDisplay,
    netoClp: netoClpTotal,
    ivaClp: ivaClpTotal,
    totalClp: totalClpTotal,
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
        plan: planPrincipal,
        cantidad: cantidadTotal,
        meses,
        // Agregados top-level (los consume form-fill.ts): compatibles con el formato de un solo tramo.
        neto_clp_total: netoClpTotal,
        iva_clp_total: ivaClpTotal,
        total_clp_total: totalClpTotal,
        // Detalle por tramo (una entrada por plan cotizado).
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
  console.log(`Total: $${totalClpTotal.toLocaleString("es-CL")} CLP (tope: $${condiciones.tope_clp.toLocaleString("es-CL")} CLP) — dentro del tope.`);
  console.log(`\nEsto NO envía nada. Revisar el archivo y luego usar el flujo de formulario (login + form-fill) para dejar la oferta lista; el envío final lo confirma un humano.`);
}

main().catch((err) => {
  console.error("Cotización falló:", err);
  process.exitCode = 1;
});
