/**
 * Lee los ARCHIVOS adjuntos de una licitación que estén en disco y devuelve su texto, para que la
 * ficha de decisión pueda citarlos igual que a la ficha pública.
 *
 * De dónde salen esos archivos: `licitaciones/data/<codigo>/adjuntos/`. Ahí los deja
 * `npm run adjuntos-licitacion` si el gate del portal lo deja pasar (solo desde una máquina con IP
 * residencial), o **una persona con un clic** en el visor. Esa era la pieza que faltaba: el clic
 * humano existía desde antes, pero nada leía los archivos después, así que su contenido —el detalle
 * fino de las bases y las EE.TT.— no entraba en ninguna decisión.
 */
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { LIC_ROOT_DIR } from "./config.js";
import { extraerTexto, type TextoDocumento } from "./documentos-texto.js";

export interface AdjuntoLeido {
  archivo: string;
  formato: TextoDocumento["formato"];
  caracteres: number;
  paginas?: number;
  problema?: string;
  /** Ruta del .txt extraído, relativa al repo. */
  texto?: string;
}

export interface LecturaAdjuntos {
  documentos: AdjuntoLeido[];
  /** Todo el texto concatenado, con el nombre de archivo como encabezado de cada bloque. */
  texto: string;
  directorio: string;
}

export function directorioAdjuntos(codigo: string): string {
  return path.join(LIC_ROOT_DIR, "data", codigo, "adjuntos");
}

/**
 * Extrae el texto de todo lo que haya en `adjuntos/`, dejando cada resultado en `adjuntos/texto/`.
 * Devuelve `documentos: []` si no hay nada: no tener adjuntos es normal, no un error.
 */
export async function leerAdjuntosLocales(codigo: string): Promise<LecturaAdjuntos> {
  const dir = directorioAdjuntos(codigo);
  const vacio: LecturaAdjuntos = { documentos: [], texto: "", directorio: dir };
  if (!existsSync(dir)) return vacio;

  const archivos = readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isFile() && !d.name.startsWith(".") && d.name !== "inventario.json")
    .map((d) => path.join(dir, d.name))
    .filter((p) => statSync(p).size > 0);
  if (archivos.length === 0) return vacio;

  const destino = path.join(dir, "texto");
  mkdirSync(destino, { recursive: true });
  const documentos: AdjuntoLeido[] = [];
  const bloques: string[] = [];
  for (const ruta of archivos) {
    const extraido = await extraerTexto(ruta);
    const leido: AdjuntoLeido = {
      archivo: extraido.archivo,
      formato: extraido.formato,
      caracteres: extraido.texto.length,
      paginas: extraido.paginas,
      problema: extraido.problema,
    };
    if (extraido.texto.trim()) {
      const salida = path.join(destino, `${extraido.archivo}.txt`);
      writeFileSync(salida, extraido.texto, "utf-8");
      leido.texto = path.relative(process.cwd(), salida);
      bloques.push(`===== ${extraido.archivo} =====\n${extraido.texto}`);
    }
    documentos.push(leido);
  }
  return { documentos, texto: bloques.join("\n\n"), directorio: dir };
}
