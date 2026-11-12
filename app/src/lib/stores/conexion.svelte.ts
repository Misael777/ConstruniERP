/**
 * Estado de la conexión a internet (a pedido del usuario, 12/11/2026: transacciones que quedaban incompletas al
 * quedarse sin datos a mitad del guardado). Refuerzo que NO cambia ningún proceso: solo avisa y deja consultar.
 *
 * - `conexion.enLinea`: lo que dice el equipo (eventos online/offline del navegador; igual en navegador, Tauri
 *   Windows y Tauri Android). Puede decir "en línea" con Wi-Fi sin internet, por eso existe verificarConexion.
 * - `verificarConexion(client)`: consulta mínima a la base con tiempo límite, justo antes de un guardado.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export const conexion = $state({ enLinea: typeof navigator === 'undefined' ? true : navigator.onLine });

if (typeof window !== 'undefined') {
	window.addEventListener('online', () => (conexion.enLinea = true));
	window.addEventListener('offline', () => (conexion.enLinea = false));
}

/** true si la base responde en menos de `ms`. Un error de la base (permisos, etc.) también cuenta como conexión:
 * solo importa que la respuesta llegó. Falla de red o tiempo agotado = sin conexión. */
export async function verificarConexion(client: SupabaseClient, ms = 8000): Promise<boolean> {
	if (typeof navigator !== 'undefined' && !navigator.onLine) {
		conexion.enLinea = false;
		return false;
	}
	const ctrl = new AbortController();
	const timer = setTimeout(() => ctrl.abort(), ms);
	try {
		const { error } = await client.from('cuenta_banco').select('numero_cuenta', { head: true }).limit(1).abortSignal(ctrl.signal);
		const ok = !error || !!error.code; // sin `code` = la petición no llegó (red caída o tiempo agotado)
		conexion.enLinea = ok;
		return ok;
	} catch {
		conexion.enLinea = false;
		return false;
	} finally {
		clearTimeout(timer);
	}
}
