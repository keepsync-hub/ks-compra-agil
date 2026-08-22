// Normaliza lo que postea GitHub Actions a filas de la tabla. Un solo punto de entrada con un
// `tipo` adentro, en vez de cuatro webhooks: el Action ya sabe qué está informando.
const cuerpo = $json.body || $json;
const tipo = cuerpo.tipo || "";
const ahora = new Date().toISOString();

function fila(base) {
  return { json: Object.assign({ actualizado: ahora }, base) };
}

if (tipo === "radar") {
  const solicitudes = cuerpo.solicitudes || [];
  if (solicitudes.length === 0) return [];
  return solicitudes.map(s => fila({
    codigo: s.codigo,
    nombre: s.nombre || "",
    organismo: s.organismo || "",
    rut: s.rut || "",
    categorias: s.categorias || "",
    topeClp: s.topeClp || 0,
    fechaCierre: s.fechaCierre || "",
    urlPortal: s.urlPortal || "",
    documentosJson: JSON.stringify(s.documentos || []),
    catalogoProvisional: Boolean(s.provisional),
    corridaId: cuerpo.corrida_id || "",
    // Ojo: `estado` NO va acá. Una corrida del radar refresca los datos de la API, pero la
    // decisión humana (avanzar / rechazado) es de la fila, no de la API, y pisarla borraría el
    // trabajo. Las altas se resuelven aparte, con estado "nuevo".
  }));
}

if (tipo === "cotizacion") {
  const base = {
    codigo: cuerpo.codigo,
    estado: cuerpo.estado || "cotizado",
    documentosJson: JSON.stringify(cuerpo.documentos || []),
    catalogoProvisional: Boolean(cuerpo.provisional),
    ultimoError: "",
  };
  if (cuerpo.estado === "sin_ficha") {
    base.ultimoError = cuerpo.motivo || "";
    return [fila(base)];
  }
  base.totalClp = cuerpo.totalClp || 0;
  base.topeClp = cuerpo.topeClp || 0;
  base.descuentoPct = cuerpo.descuentoPct || 0;
  base.scoreApertura = cuerpo.scoreApertura || 0;
  base.pdfUrl = cuerpo.pdfUrl || "";
  base.fechaCierre = cuerpo.fechaCierre || "";
  base.observacionesJson = JSON.stringify(cuerpo.observaciones || {});
  return [fila(base)];
}

if (tipo === "expediente") {
  const docs = cuerpo.documentos || [];
  const bloqueados = docs.filter(d => d.estado === "bloqueado");
  return [fila({
    codigo: cuerpo.codigo,
    estado: "avanzar",
    ultimoError: bloqueados.length
      ? bloqueados.length + " documento(s) no se pudieron generar: " +
        bloqueados.map(d => d.prefijo + " " + (d.motivo || "")).join(" | ")
      : "",
  })];
}

if (tipo === "error") {
  // Sin esto la fila se queda en "cotizando" para siempre y el panel muestra un trabajo en curso
  // que ya nadie está haciendo.
  const codigos = (cuerpo.codigos || []).filter(c => c && c !== "-");
  if (codigos.length === 0) return [];
  return codigos.map(c => fila({
    codigo: c,
    estado: "error",
    ultimoError: (cuerpo.motivo || "Falló la corrida") + " — " + (cuerpo.run || ""),
  }));
}

return [];
