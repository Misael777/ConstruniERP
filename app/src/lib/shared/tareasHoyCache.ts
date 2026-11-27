/**
 * Ticket #112 (rechazo): la pantalla de ingreso muestra arriba a la derecha "Tareas de hoy" con el número de pendientes,
 * antes de iniciar sesión. Ese número no se puede pedir al servidor sin sesión, así que el ERP guarda en este equipo el
 * último conteo del usuario (ver AlertasTareas.svelte) y la pantalla de ingreso lo muestra solo si es del mismo correo y
 * de hoy. Solo es un número (sin detalle de las tareas).
 */
const CLAVE = 'construni_tareas_hoy';

interface ConteoGuardado {
	email: string;
	fecha: string;
	n: number;
}

export function guardarConteoTareasHoy(email: string, fecha: string, n: number): void {
	if (!email) return;
	try {
		localStorage.setItem(CLAVE, JSON.stringify({ email: email.trim().toLowerCase(), fecha, n } satisfies ConteoGuardado));
	} catch {
		/* sin almacenamiento: no se muestra el número */
	}
}

export function leerConteoTareasHoy(email: string | null | undefined, fecha: string): number | null {
	if (!email) return null;
	try {
		const v = JSON.parse(localStorage.getItem(CLAVE) ?? 'null') as ConteoGuardado | null;
		if (!v || v.email !== email.trim().toLowerCase() || v.fecha !== fecha) return null;
		return typeof v.n === 'number' ? v.n : null;
	} catch {
		return null;
	}
}
