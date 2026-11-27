/** Áreas y prioridades de "Tareas de hoy" (lista y calendario). */
import type { ModuloAlerta, PrioridadAlerta } from './services/alertas.service';

export const AREAS_TAREA: { modulo: ModuloAlerta; titulo: string; icono: string; chip: string }[] = [
	{ modulo: 'rrhh', titulo: 'Recursos Humanos', icono: 'fa-users', chip: 'bg-blue-50 text-blue-700 border-blue-200' },
	{ modulo: 'proyectos', titulo: 'Proyectos', icono: 'fa-layer-group', chip: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
	{ modulo: 'finanzas', titulo: 'Finanzas', icono: 'fa-coins', chip: 'bg-violet-50 text-violet-700 border-violet-200' }
];

export const areaTarea = (m: ModuloAlerta) => AREAS_TAREA.find((x) => x.modulo === m)!;

export const PRIORIDAD_TAREA: Record<PrioridadAlerta, { texto: string; clase: string; punto: string; orden: number }> = {
	alta: { texto: 'Alta', clase: 'bg-rose-50 text-rose-600 border-rose-200', punto: 'bg-rose-500', orden: 0 },
	media: { texto: 'Media', clase: 'bg-amber-50 text-amber-700 border-amber-200', punto: 'bg-amber-400', orden: 1 },
	baja: { texto: 'Baja', clase: 'bg-emerald-50 text-emerald-700 border-emerald-200', punto: 'bg-emerald-500', orden: 2 }
};

export const fechaCorta = (f: string) => new Date(`${f}T12:00:00Z`).toLocaleDateString('es-PE', { day: 'numeric', month: 'short', timeZone: 'UTC' });

export const sumarDiasTarea = (f: string, d: number) => new Date(Date.parse(`${f}T12:00:00Z`) + d * 86400000).toISOString().slice(0, 10);

/** Texto sin tildes y en minúsculas, para buscar. */
export const normalizarBusqueda = (t: string) =>
	t
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '')
		.toLowerCase();
