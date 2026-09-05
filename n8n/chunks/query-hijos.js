// Una sola consulta a Drive para todos los archivos del expediente: la API no busca en
// profundidad, pero sí acepta varios `in parents` unidos por `or`. Con ~13 carpetas eso es un
// request en vez de trece.
const carpetas = $input.all()
  .map(i => ({ id: i.json.id, name: String(i.json.name || "").trim() }))
  .filter(c => c.id);

if (carpetas.length === 0) {
  return [{ json: { query: "'sin-carpetas' in parents", carpetas: [] } }];
}

// Los paréntesis no son decorativos: en el lenguaje de consulta de Drive `and` liga más fuerte
// que `or`, así que "A or B and trashed = false" se lee "A or (B and trashed = false)" y los
// archivos en la papelera de todas las carpetas menos la última volverían como insumos.
const query = "(" + carpetas.map(c => "'" + c.id + "' in parents").join(" or ") + ")" +
  " and trashed = false";

return [{ json: { query, carpetas } }];
