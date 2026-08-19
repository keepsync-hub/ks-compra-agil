import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { LIC_ROOT_DIR } from "./config.js";
import type { LicitacionListItem } from "./api.js";

const STATE_PATH = path.join(LIC_ROOT_DIR, "data", "state.json");

export interface ProcesoHistorico {
  codigo: string;
  nombre: string;
  fecha_publicacion: string;
  estado: string;
  monto_estimado_clp: number;
}

export interface OrganismoHistorial {
  rut: string;
  nombre: string;
  procesos: ProcesoHistorico[];
}

export interface RadarState {
  ultima_corrida: string | null;
  codigos_vistos: Record<string, { primera_vez: string; ultimo_estado: string }>;
  organismos: Record<string, OrganismoHistorial>;
}

function estadoVacio(): RadarState {
  return { ultima_corrida: null, codigos_vistos: {}, organismos: {} };
}

export function cargarState(): RadarState {
  if (!existsSync(STATE_PATH)) return estadoVacio();
  try {
    return JSON.parse(readFileSync(STATE_PATH, "utf-8")) as RadarState;
  } catch {
    return estadoVacio();
  }
}

export function guardarState(state: RadarState): void {
  mkdirSync(path.dirname(STATE_PATH), { recursive: true });
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2), "utf-8");
}

export interface RegistroResultado {
  esNuevo: boolean;
  esReintentoDeOrganismo: boolean;
  procesosPreviosDelOrganismo: ProcesoHistorico[];
}

export function registrarHallazgo(state: RadarState, item: LicitacionListItem, ahoraIso: string): RegistroResultado {
  const codigo = item.CodigoExterno;
  const esNuevo = !(codigo in state.codigos_vistos);
  state.codigos_vistos[codigo] = {
    primera_vez: state.codigos_vistos[codigo]?.primera_vez ?? ahoraIso,
    ultimo_estado: item.Estado ?? String(item.CodigoEstado ?? "desconocido"),
  };

  // OJO (dos salvedades, ninguna bloqueante hoy porque licitaciones/data/ está gitignored y este
  // radar nunca corrió contra la API real):
  // 1. Cambiar la clave de agrupación invalida cualquier state.json local previo: las entradas
  //    viejas quedaron bajo el fallback NombreOrganismo y no se migran, así que un organismo ya
  //    registrado se vería como nuevo y se perdería una detección de recomprador.
  // 2. `RutUnidad` es el RUT de la UNIDAD DE COMPRA, no del organismo. Si un organismo opera
  //    varias unidades con RUT distinto, esto lo fragmenta. El diccionario oficial confirma el
  //    nombre del campo, no que sea el identificador correcto para agrupar por organismo —
  //    verificar con datos reales antes de confiar en el conteo de recompradores.
  const rut = item.Comprador?.RutUnidad ?? item.Comprador?.NombreOrganismo ?? "desconocido";
  const organismo = state.organismos[rut] ?? { rut, nombre: item.Comprador?.NombreOrganismo ?? "desconocido", procesos: [] };
  const procesosPreviosDelOrganismo = organismo.procesos.filter((p) => p.codigo !== codigo);
  const esReintentoDeOrganismo = esNuevo && procesosPreviosDelOrganismo.length > 0;

  const existente = organismo.procesos.find((p) => p.codigo === codigo);
  if (!existente) {
    organismo.procesos.push({
      codigo,
      nombre: item.Nombre,
      fecha_publicacion: item.FechaPublicacion ?? "",
      estado: item.Estado ?? String(item.CodigoEstado ?? "desconocido"),
      monto_estimado_clp: item.MontoEstimado ?? 0,
    });
  } else {
    existente.estado = item.Estado ?? String(item.CodigoEstado ?? "desconocido");
  }
  state.organismos[rut] = organismo;

  return { esNuevo, esReintentoDeOrganismo, procesosPreviosDelOrganismo };
}
