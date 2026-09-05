/**
 * Repone `data/<codigo>/detalle.json` para uno o más códigos, con un request por código.
 *
 * Existe por una razón de costo. `data/` es efímero y gitignored, así que el cotizador y el
 * generador necesitan que alguien reponga ese archivo antes de correr. Hasta ahora ese alguien era
 * el radar completo: el botón "Cotizar" del panel despachaba `accion: "ambos"` y barría las 12
 * variantes `q` de las 5 categorías activas —más un detalle por acierto— para obtener UN archivo
 * que la API entrega en un solo request. Con un 429 documentado a las 9 requests
 * (`historico/cuota.jsonl`), eso no era un detalle.
 *
 * No trae lógica propia: delega en `obtenerDetalleConCache()`, que ya sabe pedir el detalle,
 * escribirlo en la ruta que leen `cotizar-capacitacion.ts` y `generar-documento.ts`, y no volver a
 * pedirlo si lo que hay en caché sigue vigente.
 */
import { obtenerDetalleConCache } from "../lib/indice.js";

async function main(): Promise<void> {
  const codigos = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  if (codigos.length === 0) {
    console.error("Uso: npm run traer-detalle -- <codigo> [<codigo>…]");
    process.exitCode = 1;
    return;
  }

  let fallaron = 0;
  for (const codigo of codigos) {
    try {
      const { detalle, desdeCache } = await obtenerDetalleConCache(codigo);
      const origen = desdeCache ? "caché vigente, 0 requests" : "1 request";
      console.log(`${codigo}: ${detalle.nombre} — ${detalle.estado.codigo} (${origen})`);
    } catch (e) {
      // No corta el bucle: con varios códigos, que uno no exista no debe impedir traer los otros.
      fallaron++;
      console.error(`${codigo}: no se pudo traer el detalle — ${(e as Error).message}`);
    }
  }

  if (fallaron > 0) process.exitCode = 1;
}

void main();
