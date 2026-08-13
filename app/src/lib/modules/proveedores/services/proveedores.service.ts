/**
 * Servicio de acceso a datos para `proveedor` — extraído de comercial/proveedores/+page.svelte (antes
 * todo el CRUD vivía inline ahí) para poder agregar el patrón "dado de baja oculto + Eliminados
 * solo-admin + borrado permanente con contraseña" (ver skill dar-de-baja-pattern), mismo criterio ya
 * aplicado en Clientes (aprobaciones.service.ts).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { darDeBajaCentroCostoDeEntidad, restaurarCentroCostoDeEntidad } from '$lib/modules/centro-costos/services/centroCostos.service';
import { describeError } from '$lib/shared/describeError';

export interface ServiceResult {
	success: boolean;
	message?: string;
}

/** `soloEliminados`: false (default) trae solo proveedores activos (estado != 'baja'); true trae solo
 * los dados de baja, para la sección "Eliminados" (solo-admin). */
export async function getProveedores(client: SupabaseClient, soloEliminados = false): Promise<any[]> {
	let query = client.from('proveedor').select('*').order('id_proveedor', { ascending: false });
	query = soloEliminados ? query.eq('estado', 'baja') : query.neq('estado', 'baja');
	const { data, error } = await query;
	if (error) throw error;
	return data || [];
}

/** Da de baja un proveedor (reemplaza al borrado real) — mismo patrón que darDeBajaCliente: marca
 * `proveedor.estado = 'baja'` y da de baja el centro de costo que se generó para él. */
export async function darDeBajaProveedor(client: SupabaseClient, idProveedor: number): Promise<ServiceResult> {
	const { error } = await client.from('proveedor').update({ estado: 'baja' }).eq('id_proveedor', idProveedor);
	if (error) return { success: false, message: describeError(error) };

	const centroResult = await darDeBajaCentroCostoDeEntidad(client, 'proveedor', idProveedor);
	if (!centroResult.success) {
		console.warn(`[proveedores.service] El proveedor #${idProveedor} se dio de baja, pero no se pudo dar de baja su centro de costo: ${centroResult.message}`);
	}

	return { success: true, message: 'Proveedor dado de baja correctamente' };
}

/** Restaura un proveedor dado de baja — se usa desde "Eliminados" (solo-admin), sin contraseña. */
export async function restaurarProveedor(client: SupabaseClient, idProveedor: number): Promise<ServiceResult> {
	const { error } = await client.from('proveedor').update({ estado: 'activo' }).eq('id_proveedor', idProveedor);
	if (error) return { success: false, message: describeError(error) };

	const centroResult = await restaurarCentroCostoDeEntidad(client, 'proveedor', idProveedor);
	if (!centroResult.success) {
		console.warn(`[proveedores.service] El proveedor #${idProveedor} se restauró, pero no se pudo restaurar su centro de costo: ${centroResult.message}`);
	}

	return { success: true, message: 'Proveedor restaurado correctamente' };
}

export interface ProveedorDependencias {
	tieneConflictos: boolean;
	cuentasPagar: number;
	transacciones: number;
	detalle: string;
}

/** Revisa qué le impide a un proveedor ser eliminado PERMANENTEMENTE — mismo criterio que
 * getClienteDependencias en aprobaciones.service.ts: `cuentas_pagar.id_proveedor` ya está protegida
 * por FK real (RESTRICT), pero `transaccion.id_centro_costo_origen/destino` no tiene FK real hacia
 * `centro_costo`, así que sin este chequeo el borrado dejaría transacciones huérfanas en silencio. */
export async function getProveedorDependencias(client: SupabaseClient, idProveedor: number): Promise<ProveedorDependencias> {
	const { count: cuentasPagar } = await client
		.from('cuentas_pagar')
		.select('id_cuenta_pagar', { count: 'exact', head: true })
		.eq('id_proveedor', idProveedor);

	let transacciones = 0;
	const { data: centro } = await client
		.from('centro_costo')
		.select('id_centro_costo')
		.eq('id_proveedor', idProveedor)
		.maybeSingle();
	if (centro?.id_centro_costo) {
		const { count } = await client
			.from('transaccion')
			.select('id_transaccion', { count: 'exact', head: true })
			.or(`id_centro_costo_origen.eq.${centro.id_centro_costo},id_centro_costo_destino.eq.${centro.id_centro_costo}`);
		transacciones = count ?? 0;
	}

	const partes: string[] = [];
	if (cuentasPagar) partes.push(`${cuentasPagar} cuenta(s) por pagar`);
	if (transacciones) partes.push(`${transacciones} transacción(es)`);

	return {
		tieneConflictos: partes.length > 0,
		cuentasPagar: cuentasPagar ?? 0,
		transacciones,
		detalle:
			partes.length > 0
				? `No se puede eliminar: tiene ${partes.join(', ')} vinculada(s). Elimina o desvincula esas referencias primero.`
				: ''
	};
}

/** Borra un proveedor permanentemente — primero verifica dependencias para devolver un mensaje
 * legible en vez de un error crudo de FK. Se usa SIEMPRE detrás de un AdminConfirmModal (contraseña),
 * nunca directo. */
export async function deleteProveedorCascade(client: SupabaseClient, idProveedor: number): Promise<ServiceResult> {
	const dependencias = await getProveedorDependencias(client, idProveedor);
	if (dependencias.tieneConflictos) return { success: false, message: dependencias.detalle };

	const { error } = await client.from('proveedor').delete().eq('id_proveedor', idProveedor);
	if (error) return { success: false, message: `Es posible que esté referenciado en otras tablas. ${describeError(error)}` };
	return { success: true };
}
