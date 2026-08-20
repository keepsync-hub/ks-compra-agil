/**
 * Publica `output/estudio-mercado.md` como `docs/estudio-mercado.html`.
 *
 * Página propia y no un bloque de `docs/index.html`: `reemplazarBloque` de
 * `src/lib/pagina-compra-agil.ts` es privada y tiene su ruta fija a `index.html`, y el repo mantiene
 * las páginas de `docs/` deliberadamente sin acoplar. El HTML se genera del MISMO markdown que ya se
 * escribió, para no tener dos plantillas que se puedan desincronizar.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { ROOT_DIR } from "./config.js";

const PAGINA_PATH = path.join(ROOT_DIR, "docs", "estudio-mercado.html");
const INDEX_PATH = path.join(ROOT_DIR, "docs", "index.html");

const escapar = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Markdown mínimo: encabezados, tablas, listas, blockquotes, `código`, **negrita**, _cursiva_. */
function mdAHtml(md: string): string {
  const enLinea = (t: string): string =>
    escapar(t)
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[\s(])_([^_]+)_/g, "$1<em>$2</em>")
      .replace(/\*([^*]+)\*/g, "<em>$1</em>");

  const out: string[] = [];
  const lineas = md.split("\n");
  let i = 0;
  let enLista = false;
  const cerrarLista = () => {
    if (enLista) {
      out.push("</ul>");
      enLista = false;
    }
  };

  while (i < lineas.length) {
    const l = lineas[i]!;

    // Tabla: encabezado + separador + filas
    if (l.startsWith("|") && lineas[i + 1]?.match(/^\|[\s:|-]+\|$/)) {
      cerrarLista();
      const celdas = (fila: string) =>
        fila.split("|").slice(1, -1).map((c) => c.trim());
      // La alineación sale del separador del propio markdown (`---:` = derecha), no de la posición
      // de la columna: hay tablas cuya tercera columna es prosa y alinearla a la derecha se ve mal.
      const alineacion = celdas(lineas[i + 1]!).map((sep) => (sep.endsWith(":") ? " class=\"num\"" : ""));
      out.push('<div class="tabla"><table><thead><tr>');
      celdas(l).forEach((c, k) => out.push(`<th${alineacion[k] ?? ""}>${enLinea(c)}</th>`));
      out.push("</tr></thead><tbody>");
      i += 2;
      while (i < lineas.length && lineas[i]!.startsWith("|")) {
        out.push("<tr>");
        celdas(lineas[i]!).forEach((c, k) => out.push(`<td${alineacion[k] ?? ""}>${enLinea(c)}</td>`));
        out.push("</tr>");
        i++;
      }
      out.push("</tbody></table></div>");
      continue;
    }

    const h = l.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      cerrarLista();
      const n = h[1]!.length;
      out.push(`<h${n}>${enLinea(h[2]!)}</h${n}>`);
      i++;
      continue;
    }
    if (l.startsWith("> ")) {
      cerrarLista();
      const bloque: string[] = [];
      while (i < lineas.length && lineas[i]!.startsWith(">")) {
        bloque.push(lineas[i]!.replace(/^>\s?/, ""));
        i++;
      }
      out.push(`<blockquote>${enLinea(bloque.join(" "))}</blockquote>`);
      continue;
    }
    if (l.match(/^[-*]\s+/)) {
      if (!enLista) {
        out.push("<ul>");
        enLista = true;
      }
      out.push(`<li>${enLinea(l.replace(/^[-*]\s+/, ""))}</li>`);
      i++;
      continue;
    }
    if (l.trim() === "") {
      cerrarLista();
      i++;
      continue;
    }
    // Párrafo: junta líneas contiguas (el markdown va con saltos duros a 100 columnas).
    cerrarLista();
    const parrafo: string[] = [];
    while (i < lineas.length && lineas[i]!.trim() !== "" && !lineas[i]!.match(/^(#{1,4}\s|[-*]\s|\||>)/)) {
      parrafo.push(lineas[i]!);
      i++;
    }
    out.push(`<p>${enLinea(parrafo.join(" "))}</p>`);
  }
  cerrarLista();
  return out.join("\n");
}

const PLANTILLA = (cuerpo: string): string => `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Estudio de mercado — Compras Ágiles | KeepSync</title>
<style>
  :root { color-scheme: light dark; --fg:#16181d; --bg:#fff; --muted:#5b6270; --linea:#e3e6ec; --acento:#1f5fd8; --code:#f3f5f9; }
  @media (prefers-color-scheme: dark) {
    :root { --fg:#e8eaf0; --bg:#12141a; --muted:#9aa2b4; --linea:#2a2f3a; --acento:#7aa5ff; --code:#1b1f28; }
  }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--fg); font:16px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif; }
  main { max-width: 62rem; margin:0 auto; padding: 2.5rem 1.25rem 5rem; }
  h1 { font-size:1.9rem; line-height:1.25; margin:0 0 .5rem; letter-spacing:-.01em; }
  h2 { font-size:1.3rem; margin:2.5rem 0 .75rem; padding-top:1.25rem; border-top:1px solid var(--linea); letter-spacing:-.01em; }
  h3 { font-size:1.05rem; margin:1.75rem 0 .5rem; }
  p, li { color:var(--fg); }
  blockquote { margin:1.25rem 0; padding:.85rem 1.1rem; border-left:3px solid var(--acento); background:var(--code); border-radius:0 6px 6px 0; }
  code { background:var(--code); padding:.12em .35em; border-radius:4px; font-size:.88em; }
  .tabla { overflow-x:auto; margin:1rem 0; }
  table { border-collapse:collapse; width:100%; font-size:.92rem; }
  th, td { text-align:left; padding:.5rem .7rem; border-bottom:1px solid var(--linea); white-space:nowrap; }
  th { color:var(--muted); font-weight:600; font-size:.82rem; text-transform:uppercase; letter-spacing:.04em; }
  th.num, td.num { text-align:right; font-variant-numeric: tabular-nums; }
  td:first-child { white-space:normal; }
  .volver { display:inline-block; margin-bottom:1.5rem; color:var(--acento); text-decoration:none; font-size:.92rem; }
  .volver:hover { text-decoration:underline; }
  footer { margin-top:3rem; padding-top:1.25rem; border-top:1px solid var(--linea); color:var(--muted); font-size:.85rem; }
</style>
</head>
<body>
<main>
<a class="volver" href="index.html">← Compras Ágiles abiertas</a>
${cuerpo}
<footer>Generado por <code>npm run estudio</code> desde <code>historico/mercado.jsonl</code>. Código y datos: <a href="https://github.com/keepsync-hub/ks-compra-agil">keepsync-hub/ks-compra-agil</a>.</footer>
</main>
</body>
</html>
`;

const ENLACE = '      <a href="estudio-mercado.html">Estudio de mercado: qué se demanda en Compra Ágil</a>\n';

export function renderPaginaEstudio(md: string): void {
  writeFileSync(PAGINA_PATH, PLANTILLA(mdAHtml(md)), "utf-8");

  // Enlace desde la página principal, junto a los que ya están. Idempotente.
  if (!existsSync(INDEX_PATH)) return;
  const html = readFileSync(INDEX_PATH, "utf-8");
  if (html.includes("estudio-mercado.html")) return;
  const ancla = '      <a href="informe-nicho.html">';
  const i = html.indexOf(ancla);
  if (i === -1) return;
  writeFileSync(INDEX_PATH, html.slice(0, i) + ENLACE + html.slice(i), "utf-8");
}
