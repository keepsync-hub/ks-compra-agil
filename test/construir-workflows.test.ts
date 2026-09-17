import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

/**
 * `n8n/construir.mjs` inyecta cada chunk donde el workflow dice `__CHUNK:archivo.js__`. Nada lo
 * ejecutaba: los workflows no son TypeScript válido —llevan esos marcadores— así que el typecheck
 * no los ve, y un chunk renombrado o un marcador con un typo se descubría al publicar en n8n.
 *
 * `readFileSync` ya falla fuerte ante un marcador roto (`construir.mjs:40`). Sólo faltaba correrlo.
 */

const RAIZ = path.resolve(import.meta.dirname, "..");

/** Los chunks que cada workflow tiene que terminar incrustando, según su fuente. */
const ESPERADOS: Record<string, readonly string[]> = {
  panel: ["render-panel.js", "query-hijos.js", "render-expediente.js", "ingesta.js"],
  acciones: ["cooldown.js", "decision.js", "pedido-drive.js"],
  "carpetas-drive": ["faltantes.js", "resumen-drive.js"],
};

function construir(nombre: string): string {
  return execFileSync("node", ["n8n/construir.mjs", nombre], { cwd: RAIZ, encoding: "utf-8" });
}

for (const [nombre, chunks] of Object.entries(ESPERADOS)) {
  test(`construir: ${nombre} resuelve todos sus chunks`, () => {
    const salida = construir(nombre);
    for (const chunk of chunks) {
      assert.match(salida, new RegExp(`chunk: ${chunk.replace(".", "\\.")}`), `falta ${chunk}`);
    }

    // Ningún marcador puede sobrevivir a la construcción: uno que quede es código que n8n
    // recibiría como el literal "__CHUNK:algo__" en vez del cuerpo del nodo.
    const construido = readFileSync(path.join(RAIZ, "n8n", "build", `${nombre}.ts`), "utf-8");
    assert.doesNotMatch(construido, /__CHUNK:/, "quedó un marcador sin resolver");
  });
}

test("construir: todo chunk en disco lo usa algún workflow", () => {
  // Un chunk que nadie incrusta es código muerto que igual pasa los tests de `chunks.test.ts`:
  // se sigue ejecutando ahí y nunca llega a n8n. Este assert lo delata.
  const usados = new Set(
    Object.keys(ESPERADOS).flatMap((n) => [...construir(n).matchAll(/chunk: (\S+)/g)].map((m) => m[1]!)),
  );
  const enDisco = readdirSync(path.join(RAIZ, "n8n", "chunks")).filter((f) => f.endsWith(".js"));

  assert.deepEqual(
    enDisco.filter((f) => !usados.has(f)),
    [],
    "hay chunks en n8n/chunks/ que ningún workflow incrusta",
  );
});
