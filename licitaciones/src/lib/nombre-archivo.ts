const DIACRITICOS_COMBINANTES = /[̀-ͯ]/g;

/** Nombre de archivo de cotización: Q-AAAAMMDD-NombreCliente (mismo formato que Compra Ágil). */
export function nombreArchivoCotizacion(fecha: Date, organismoComprador: string): string {
  const aaaa = fecha.getFullYear();
  const mm = String(fecha.getMonth() + 1).padStart(2, "0");
  const dd = String(fecha.getDate()).padStart(2, "0");

  const nombreCliente = organismoComprador
    .normalize("NFD")
    .replace(DIACRITICOS_COMBINANTES, "")
    .replace(/[^a-zA-Z0-9\s]/g, " ")
    .trim()
    .split(/\s+/)
    .map((palabra) => palabra.charAt(0).toUpperCase() + palabra.slice(1).toLowerCase())
    .join("")
    .slice(0, 50);

  return `Q-${aaaa}${mm}${dd}-${nombreCliente}`;
}
