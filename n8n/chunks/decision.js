// Normaliza la decisión humana y arma, de una vez, el pedido para el sub-workflow de Drive.
const cuerpo = $json.body || $json;
const codigo = cuerpo.codigo;
const decision = cuerpo.decision === "avanzar" ? "avanzar" : "rechazado";

if (!codigo) throw new Error("Falta 'codigo' en el cuerpo del pedido.");

return [{ json: {
  codigo,
  decision,
  avanza: decision === "avanzar",
  motivoDecision: String(cuerpo.motivo || ""),
  actualizado: new Date().toISOString(),
} }];
