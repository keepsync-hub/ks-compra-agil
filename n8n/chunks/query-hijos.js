// Una sola consulta a Drive para todos los archivos del expediente: la API no busca en
// profundidad, pero sí acepta varios `in parents` unidos por `or`. Con ~13 carpetas eso es un
// request en vez de trece.
const carpetas = $input.all()
  .map(i => ({ id: i.json.id, name: String(i.json.name || "").trim() }))
  .filter(c => c.id);

if (carpetas.length === 0) {
  return [{ json: { query: "'sin-carpetas' in parents", carpetas: [] } }];
}

const query = carpetas.map(c => "'" + c.id + "' in parents").join(" or ") +
  " and trashed = false";

return [{ json: { query, carpetas } }];
