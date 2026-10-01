// =============================================================
// Lista compartida de clientes — Svelte 5 Runes
// A pedido del usuario: TODA lista de clientes del ERP (Nueva Venta, Cuentas por Cobrar, Panoramas,
// Facturación, Repositorio de comprobantes) debe ser la MISMA que el Directorio de Clientes (solo los
// activos: los dados de baja no aparecen) y actualizarse sola cuando esa lista cambia (alta, edición, baja
// o restauración de un cliente, desde esta ventana o desde otro usuario).
//
// Una sola consulta y un solo canal de tiempo real para toda la app: cada pantalla que muestra clientes llama
// a `suscribirClientes()` al montarse (y la función que devuelve al desmontarse). Además de Realtime
// (supabase_realtime, ver ventas_clientes_realtime_migration.sql) se recarga al volver a enfocar la ventana,
// por si algún cambio no llegó por el canal. APIs estándar: igual en navegador, Tauri Windows y Android.
// =============================================================
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '$lib/supabaseClient';

export interface ClienteBasico {
	id_cliente: number;
	nombre: string;
	tipo_doc: string | null;
	num_documento: string | null;
	direccion: string | null;
	estado: string | null;
}

/** `todos` incluye los dados de baja SOLO para poder mostrar el nombre de uno ya guardado en un registro
 * viejo (ver opcionesClientes); las listas para elegir usan clientesActivos(). */
export const clientesState = $state<{ todos: ClienteBasico[]; cargado: boolean }>({ todos: [], cargado: false });

let canal: RealtimeChannel | null = null;
let suscriptores = 0;
let cargaEnCurso: Promise<void> | null = null;

async function recargar(): Promise<void> {
	const { data, error } = await supabase
		.from('cliente')
		.select('id_cliente, nombre, tipo_doc, num_documento, direccion, estado')
		.order('nombre', { ascending: true });
	if (error) {
		console.warn('[clientes] No se pudo cargar la lista de clientes:', error.message);
		return;
	}
	clientesState.todos = (data ?? []) as ClienteBasico[];
	clientesState.cargado = true;
}

/** Carga (o recarga) la lista. Llamadas simultáneas comparten la misma consulta. */
export function cargarClientes(): Promise<void> {
	cargaEnCurso ??= recargar().finally(() => (cargaEnCurso = null));
	return cargaEnCurso;
}

function alEnfocar() {
	void cargarClientes();
}

/** Mantiene la lista al día mientras haya alguna pantalla que la use. Devuelve la función de limpieza
 * (pasarla a onDestroy). */
export function suscribirClientes(): () => void {
	suscriptores += 1;
	void cargarClientes();
	if (!canal && typeof window !== 'undefined') {
		canal = supabase
			.channel('clientes_lista_compartida')
			.on('postgres_changes', { event: '*', schema: 'public', table: 'cliente' }, () => void cargarClientes())
			.subscribe();
		window.addEventListener('focus', alEnfocar);
	}
	let liberado = false;
	return () => {
		if (liberado) return;
		liberado = true;
		suscriptores -= 1;
		if (suscriptores <= 0 && canal) {
			supabase.removeChannel(canal);
			canal = null;
			suscriptores = 0;
			window.removeEventListener('focus', alEnfocar);
		}
	};
}

/** Clientes activos — la misma lista que muestra el Directorio de Clientes. */
export function clientesActivos(): ClienteBasico[] {
	return clientesState.todos.filter((c) => c.estado !== 'baja');
}

/** Opciones {value,label} para un desplegable de clientes: los activos, más los ids indicados en
 * `incluirIds` aunque estén dados de baja (ej. el cliente ya guardado de una venta vieja al editarla), para
 * que ese campo no se vea vacío — marcados "(dado de baja)". */
export function opcionesClientes(incluirIds: (string | number | null | undefined)[] = []): { value: string; label: string }[] {
	const opciones = clientesActivos().map((c) => ({ value: String(c.id_cliente), label: c.nombre.toUpperCase() }));
	for (const id of incluirIds) {
		if (id === null || id === undefined || id === '') continue;
		const valor = String(id);
		if (opciones.some((o) => o.value === valor)) continue;
		const cliente = clientesState.todos.find((c) => String(c.id_cliente) === valor);
		if (cliente) opciones.push({ value: valor, label: `${cliente.nombre.toUpperCase()} (dado de baja)` });
	}
	return opciones;
}
