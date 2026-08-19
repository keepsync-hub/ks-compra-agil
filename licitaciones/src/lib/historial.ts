import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { LIC_ROOT_DIR } from "./config.js";
import type { LicitacionDetalle } from "./api.js";

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

/**
 * Registra un hallazgo en el state y decide si el organismo ya había publicado procesos antes.
 *
 * Recibe la FICHA (`detalle`), no el ítem del listado, y eso no es un detalle de estilo: la
 * corrida de verificación del 2026-08-19 contra producción mostró que los ítems que devuelve
 * `estado=activas` vienen sin `Comprador`, sin `Estado`, sin `FechaPublicacion` y sin
 * `MontoEstimado` — solo la ficha (`?codigo=`) los trae. Alimentar esta función con el ítem del
 * listado hacía que todos los hallazgos cayeran bajo la clave "desconocido" y que cada uno
 * después del primero se reportara como RECOMPRADOR de un organismo que no era el suyo.
 */
export function registrarHallazgo(state: RadarState, detalle: LicitacionDetalle, ahoraIso: string): RegistroResultado {
  const codigo = detalle.CodigoExterno;
  const estado = detalle.Estado ?? String(detalle.CodigoEstado ?? "desconocido");
  const esNuevo = !(codigo in state.codigos_vistos);
  state.codigos_vistos[codigo] = {
    primera_vez: state.codigos_vistos[codigo]?.primera_vez ?? ahoraIso,
    ultimo_estado: estado,
  };

  // `RutUnidad` es el RUT de la UNIDAD DE COMPRA, no del organismo (confirmado en el diccionario
  // oficial). Si un organismo opera varias unidades con RUT distinto, esto lo fragmenta y se
  // subcuentan recompradores; por eso se cae a `CodigoOrganismo`, que sí identifica al organismo,
  // antes que al nombre. Se prefiere RutUnidad igualmente porque es el identificador estable que
  // usa el resto del ecosistema de Mercado Público.
  const clave = detalle.Comprador?.RutUnidad || detalle.Comprador?.CodigoOrganismo || detalle.Comprador?.NombreOrganismo;
  if (!clave) {
    // Sin identificador de comprador no se puede afirmar nada sobre recompra: antes esto caía en
    // un bucket compartido "desconocido" y producía alertas falsas. Se registra el código (para
    // que "NUEVO" siga funcionando) y se devuelve sin historial de organismo.
    return { esNuevo, esReintentoDeOrganismo: false, procesosPreviosDelOrganismo: [] };
  }

  const organismo = state.organismos[clave] ?? {
    rut: detalle.Comprador?.RutUnidad ?? "sin rut",
    nombre: detalle.Comprador?.NombreOrganismo ?? "organismo desconocido",
    procesos: [],
  };
  organismo.nombre = detalle.Comprador?.NombreOrganismo ?? organismo.nombre;
  const procesosPreviosDelOrganismo = organismo.procesos.filter((p) => p.codigo !== codigo);
  const esReintentoDeOrganismo = esNuevo && procesosPreviosDelOrganismo.length > 0;

  const existente = organismo.procesos.find((p) => p.codigo === codigo);
  if (!existente) {
    organismo.procesos.push({
      codigo,
      nombre: detalle.Nombre,
      fecha_publicacion: detalle.Fechas?.FechaPublicacion ?? detalle.FechaPublicacion ?? "",
      estado,
      monto_estimado_clp: detalle.MontoEstimado ?? 0,
    });
  } else {
    existente.estado = estado;
  }
  state.organismos[clave] = organismo;

  return { esNuevo, esReintentoDeOrganismo, procesosPreviosDelOrganismo };
}
