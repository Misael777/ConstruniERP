/**
 * Overlay global de carga (animación de Snoopy, ticket #9) — se activa/desactiva SOLO desde los puntos
 * centrales de espera larga (subir a Google Drive, generar un PDF/comprobante, reconocer un comprobante
 * con OCR, llamar a la Edge Function de Empleados, iniciar sesión, buscar/descargar una actualización).
 * A propósito NO se usa en guardados rápidos de formularios (esos conservan su spinner en el botón).
 *
 * Contador con array (no un simple booleano): varias esperas pueden solaparse (ej. subir 3 proformas en
 * un `for`, o el tramo entre "iniciar sesión" y el arranque de `(app)/+layout.svelte`) — el overlay debe
 * seguir visible mientras QUEDE al menos una, y mostrar el mensaje de la más reciente.
 *
 * `visible` se retrasa ~180ms al aparecer para no destellar en operaciones que terminan casi al instante
 * (ej. una subida muy rápida en buena conexión) — desaparece al instante, sin retraso.
 */

interface Operacion {
	id: number;
	mensaje: string;
}

let operaciones = $state<Operacion[]>([]);
let visible = $state(false);
let temporizador: ReturnType<typeof setTimeout> | null = null;
let contador = 0;

const RETRASO_APARICION_MS = 180;

function sincronizarVisibilidad() {
	if (operaciones.length > 0) {
		if (!visible && temporizador === null) {
			temporizador = setTimeout(() => {
				temporizador = null;
				visible = operaciones.length > 0;
			}, RETRASO_APARICION_MS);
		}
	} else {
		if (temporizador !== null) {
			clearTimeout(temporizador);
			temporizador = null;
		}
		visible = false;
	}
}

export const loadingState = {
	get visible() {
		return visible;
	},
	get mensaje() {
		return operaciones.at(-1)?.mensaje ?? 'Cargando…';
	}
};

export interface CargaEnCurso {
	/** Cambia el mensaje de ESTA espera sin cerrarla (ej. "Buscando actualización…" -> "Descargando v0.2.25…"). */
	actualizar: (mensaje: string) => void;
	/** Cierra esta espera — llamar SIEMPRE en un `finally` (o usar `conCarga`, más abajo) para que una
	 * excepción no deje el overlay pegado para siempre. Ignora llamadas repetidas. */
	cerrar: () => void;
}

/** Registra el inicio de una espera larga. */
export function iniciarCarga(mensaje: string): CargaEnCurso {
	const id = ++contador;
	operaciones = [...operaciones, { id, mensaje }];
	sincronizarVisibilidad();
	let cerrado = false;
	return {
		actualizar(nuevoMensaje: string) {
			if (cerrado) return;
			operaciones = operaciones.map((o) => (o.id === id ? { ...o, mensaje: nuevoMensaje } : o));
		},
		cerrar() {
			if (cerrado) return;
			cerrado = true;
			operaciones = operaciones.filter((o) => o.id !== id);
			sincronizarVisibilidad();
		}
	};
}

/** Envuelve una operación async: inicia la carga, la corre, y la cierra SIEMPRE al terminar (éxito o
 * error) — la forma preferida de usar este store en vez de manejar el `finally` a mano. */
export async function conCarga<T>(mensaje: string, fn: () => Promise<T>): Promise<T> {
	const carga = iniciarCarga(mensaje);
	try {
		return await fn();
	} finally {
		carga.cerrar();
	}
}
