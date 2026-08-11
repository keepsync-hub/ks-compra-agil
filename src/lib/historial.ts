import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { ROOT_DIR } from "./config.js";
import type { CompraAgilListItem } from "./api.js";

const STATE_PATH = path.join(ROOT_DIR, "data", "state.json");

export interface ProcesoHistorico {
  codigo: string;
  nombre: string;
  fecha_publicacion: string;
  estado: string;
  monto_disponible_clp: number;
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

/**
 * Registra un hallazgo del radar en el estado y devuelve si es nuevo (no visto antes) y si el
 * organismo comprador ya tenía procesos previos en el historial (señal de recomprador).
 * Muta `state` in-place; el caller decide cuándo persistir con guardarState().
 */
export function registrarHallazgo(state: RadarState, item: CompraAgilListItem, ahoraIso: string): RegistroResultado {
  const esNuevo = !(item.codigo in state.codigos_vistos);
  state.codigos_vistos[item.codigo] = { primera_vez: state.codigos_vistos[item.codigo]?.primera_vez ?? ahoraIso, ultimo_estado: item.estado.codigo };

  const rut = item.institucion.rut;
  const organismo = state.organismos[rut] ?? { rut, nombre: item.institucion.organismo_comprador, procesos: [] };
  const procesosPreviosDelOrganismo = organismo.procesos.filter((p) => p.codigo !== item.codigo);
  const esReintentoDeOrganismo = esNuevo && procesosPreviosDelOrganismo.length > 0;

  if (!organismo.procesos.some((p) => p.codigo === item.codigo)) {
    organismo.procesos.push({
      codigo: item.codigo,
      nombre: item.nombre,
      fecha_publicacion: item.fechas.fecha_publicacion,
      estado: item.estado.codigo,
      monto_disponible_clp: item.montos.monto_disponible_clp,
    });
  } else {
    const p = organismo.procesos.find((p) => p.codigo === item.codigo)!;
    p.estado = item.estado.codigo;
  }
  state.organismos[rut] = organismo;

  return { esNuevo, esReintentoDeOrganismo, procesosPreviosDelOrganismo };
}
