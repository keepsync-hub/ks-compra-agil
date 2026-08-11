/**
 * Completa el formulario de oferta de una Compra Ágil en mercadopublico.cl y adjunta la
 * cotización — SIN hacer click en enviar. Guarda output/<codigo>/formulario-listo.png para que
 * un humano revise y confirme el envío manualmente. Requiere sesión guardada por login.ts
 * (data/storageState.json) y una cotización ya generada por `npm run cotizar -- <codigo>`.
 *
 * ESTADO: igual que login.ts, no se pudo verificar contra el DOM real del formulario en esta
 * sesión porque el portal reseteó la conexión de Chromium headless antes de llegar a esa
 * pantalla (ver login.ts). Los selectores marcados TODO son mejores esfuerzos basados en el
 * flujo estándar de Compra Ágil, no verificados en vivo — confirmarlos interactivamente
 * (por ejemplo con `page.pause()` en modo no-headless) antes de depender de este script para
 * una oferta real.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { ROOT_DIR } from "../../../../src/lib/config.js";
import { tieneSesionGuardada } from "./login.js";

const STORAGE_STATE_PATH = path.join(ROOT_DIR, "data", "storageState.json");

interface CotizacionResumen {
  codigo: string;
  plan: string;
  cantidad: number;
  meses: number;
  total_clp_total: number;
  tope_clp: number;
  archivo_pptx: string;
  archivo_pdf: string;
  archivo_publicable: string;
}

function cargarResumen(codigo: string): CotizacionResumen {
  const dir = path.join(ROOT_DIR, "output", codigo);
  const resumenPath = path.join(dir, "cotizacion-resumen.json");
  if (!existsSync(resumenPath)) {
    throw new Error(`No hay cotización generada para ${codigo}. Correr primero: npm run cotizar -- ${codigo}`);
  }
  return JSON.parse(readFileSync(resumenPath, "utf-8")) as CotizacionResumen;
}

function rutaArchivoCotizacion(codigo: string, resumen: CotizacionResumen): string {
  const dir = path.join(ROOT_DIR, "output", codigo);
  // El PDF es el artefacto final a publicar (pedido explícito del usuario) — el .pptx queda
  // como fuente editable en la misma carpeta si hace falta ajustar algo a mano.
  const ruta = path.join(dir, resumen.archivo_publicable);
  if (!existsSync(ruta)) {
    throw new Error(`No se encontró el archivo de cotización esperado: ${ruta}`);
  }
  return ruta;
}

export async function completarFormulario(codigo: string): Promise<void> {
  if (!tieneSesionGuardada()) {
    throw new Error(`No hay sesión guardada (${STORAGE_STATE_PATH}). Correr login.ts primero.`);
  }
  const resumen = cargarResumen(codigo);
  if (resumen.total_clp_total > resumen.tope_clp) {
    throw new Error(
      `La cotización de ${codigo} supera el tope (${resumen.total_clp_total} > ${resumen.tope_clp}). ` +
        `cotizar.ts no debería haber generado este archivo — no completar el formulario.`,
    );
  }
  const rutaCotizacion = rutaArchivoCotizacion(codigo, resumen);

  const browser = await chromium.launch({ headless: true, executablePath: "/opt/pw-browsers/chromium" });
  try {
    const context = await browser.newContext({ storageState: STORAGE_STATE_PATH });
    const page = await context.newPage();

    // TODO(verificar en vivo): URL real de la pantalla "postular oferta" de una Compra Ágil.
    // Candidatas típicas del portal: .../CompraAgil/Modules/Proveedor/PostularOferta.aspx?qs=<codigo>
    await page.goto(`https://www.mercadopublico.cl/CompraAgil/Ofertar/${encodeURIComponent(codigo)}`, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });

    const html = await page.content();
    if (/captcha/i.test(html)) {
      throw new Error("CAPTCHA detectado en el formulario. DETENERSE — pedir intervención humana.");
    }

    // TODO(verificar en vivo): selectores reales del formulario de oferta. Placeholders
    // razonables según el patrón estándar de estos formularios en mercadopublico.cl.
    const campoMonto = page.locator("input[name*='monto' i], input[id*='monto' i]").first();
    if (await campoMonto.isVisible().catch(() => false)) {
      await campoMonto.fill(String(resumen.total_clp_total));
    } else {
      console.warn("No se encontró el campo de monto con los selectores esperados — completar manualmente.");
    }

    const inputArchivo = page.locator("input[type='file']").first();
    if (await inputArchivo.isVisible().catch(() => false)) {
      await inputArchivo.setInputFiles(rutaCotizacion);
    } else {
      console.warn("No se encontró el input de adjunto con los selectores esperados — adjuntar manualmente.");
    }

    // Punto de no retorno explícito: este script NUNCA busca ni hace click en un botón de
    // envío/confirmación. Se detiene aquí y deja evidencia para revisión humana.
    const dirSalida = path.join(ROOT_DIR, "output", codigo);
    const screenshotPath = path.join(dirSalida, "formulario-listo.png");
    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.log(`\nFormulario completado (sin enviar). Captura: ${screenshotPath}`);
    console.log("Revisión humana obligatoria antes de cualquier envío real — este script no envía nada.");
  } finally {
    await browser.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const codigo = process.argv[2];
  if (!codigo) {
    console.error("Uso: npm run form-fill -- <codigo>");
    process.exitCode = 1;
  } else {
    completarFormulario(codigo).catch((err) => {
      console.error("form-fill falló:", err.message);
      process.exitCode = 1;
    });
  }
}
