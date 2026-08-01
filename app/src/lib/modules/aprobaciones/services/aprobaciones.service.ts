/**
 * Solicitudes de aprobación (campanita de notificaciones) — a pedido del usuario: un usuario SIN
 * rango de administrador ya no puede eliminar/editar un cliente o cerrar/editar una venta
 * directamente. En su lugar se crea una fila acá, visible para todos los administradores; cualquiera
 * puede aprobarla (aplica el cambio real, reusando la MISMA lógica que un admin usa al actuar
 * directo) o rechazarla (no toca el registro original). Ver solicitud_aprobacion_migration.sql.
 *
 * Recibe el SupabaseClient como parámetro — mismo criterio que el resto de los servicios del ERP,
 * para funcionar igual en web y en Tauri (sin servidor embebido).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { permisosState } from '$lib/stores/permisos.svelte';
import { getOrCrearCentroCostoParaEntidad, getOrCrearCentroCostoCompartido } from '$lib/modules/centro-costos/services/centroCostos.service';
import { createTransaccion } from '$lib/modules/transacciones/services/transacciones.service';

export type TipoEntidadSolicitud = 'cliente' | 'proyecto';
export type TipoAccionSolicitud = 'editar' | 'eliminar' | 'cerrar_venta';
export type EstadoSolicitud = 'pendiente' | 'aprobado' | 'rechazado';

export interface SolicitudAprobacion {
	id_solicitud: number;
	tipo_entidad: TipoEntidadSolicitud;
	id_entidad: number;
	tipo_accion: TipoAccionSolicitud;
	descripcion_entidad: string | null;
	payload_cambios: Record<string, unknown> | null;
	solicitado_por: string | null;
	solicitado_por_id: string | null;
	estado: EstadoSolicitud;
	resuelto_por: string | null;
	resuelto_en: string | null;
	created_at: string;
}

export interface ServiceResult {
	success: boolean;
	message?: string;
}

const TABLE_NAME = 'solicitud_aprobacion';

/** Crea una solicitud pendiente — resuelve "quién la pide" internamente (permisosState.userName +
 * auth.getUser().id) para que cada llamador no tenga que repetirlo. */
export async function crearSolicitud(
	client: SupabaseClient,
	params: {
		tipoEntidad: TipoEntidadSolicitud;
		idEntidad: number;
		tipoAccion: TipoAccionSolicitud;
		descripcionEntidad?: string | null;
		payloadCambios?: Record<string, unknown> | null;
	}
): Promise<ServiceResult> {
	try {
		const { data: userData } = await client.auth.getUser();
		const { error } = await client.from(TABLE_NAME).insert({
			tipo_entidad: params.tipoEntidad,
			id_entidad: params.idEntidad,
			tipo_accion: params.tipoAccion,
			descripcion_entidad: params.descripcionEntidad ?? null,
			payload_cambios: params.payloadCambios ?? null,
			solicitado_por: permisosState.userName || null,
			solicitado_por_id: userData?.user?.id ?? null,
			estado: 'pendiente'
		});
		if (error) return { success: false, message: error.message };
		return { success: true };
	} catch (err: any) {
		return { success: false, message: err?.message || String(err) };
	}
}

export async function getSolicitudesPendientes(client: SupabaseClient): Promise<SolicitudAprobacion[]> {
	const { data, error } = await client
		.from(TABLE_NAME)
		.select('*')
		.eq('estado', 'pendiente')
		.order('created_at', { ascending: false });
	if (error) throw error;
	return (data ?? []) as SolicitudAprobacion[];
}

/** Borra una venta (proyecto) y todo lo que cuelga de ella sin ON DELETE CASCADE — mismo cuerpo que
 * el viejo `performDelete` de comercial/ventas/+page.svelte, ahora reusable tanto por un admin que
 * elimina directo como por la aprobación de una solicitud de un no-admin. */
export async function eliminarVentaCascade(client: SupabaseClient, idProyecto: number): Promise<ServiceResult> {
	let step = 'inicio';
	try {
		step = 'borrar presupuesto';
		let { error } = await client.from('presupuesto').delete().eq('id_proyecto', idProyecto);
		if (error) throw error;

		step = 'borrar adelanto';
		({ error } = await client.from('adelanto').delete().eq('id_proyecto', idProyecto));
		if (error) throw error;

		step = 'borrar contrato_proyecto';
		({ error } = await client.from('contrato_proyecto').delete().eq('id_proyecto', idProyecto));
		if (error) throw error;

		// cuentas_cobrar tiene FK nullable — se desvincula para conservar el historial de cobros
		step = 'desvincular cuentas_cobrar';
		({ error } = await client.from('cuentas_cobrar').update({ id_proyecto: null }).eq('id_proyecto', idProyecto));
		if (error) throw error;

		// El resto de las referencias tienen ON DELETE CASCADE y se borran solas
		step = 'borrar proyecto';
		({ error } = await client.from('proyecto').delete().eq('id_proyecto', idProyecto));
		if (error) throw error;

		return { success: true };
	} catch (err: any) {
		return { success: false, message: `Paso: ${step}. ${err?.message || String(err)}` };
	}
}

export interface ClienteDependencias {
	tieneConflictos: boolean;
	proyectos: number;
	cuentasCobrar: number;
	transacciones: number;
	/** Mensaje legible listo para mostrar (vacío si no hay conflictos). */
	detalle: string;
}

/** Revisa qué le impide a un cliente ser eliminado: ventas (`proyecto`) y `cuentas_cobrar` ya están
 * protegidas por FK en la BD (RESTRICT), pero `transaccion.id_centro_costo_origen/destino` NO tiene
 * FK real hacia `centro_costo` (confirmado contra el schema) — sin este chequeo, el
 * ON DELETE CASCADE de cliente -> centro_costo borraría el centro de costo del cliente y dejaría esas
 * transacciones huérfanas en silencio. Se usa ANTES de intentar el DELETE tanto si actúa un admin
 * directo como si se está aprobando la solicitud de un no-admin (ver deleteClienteCascade). */
export async function getClienteDependencias(client: SupabaseClient, idCliente: number): Promise<ClienteDependencias> {
	const { count: proyectos } = await client
		.from('proyecto')
		.select('id_proyecto', { count: 'exact', head: true })
		.eq('id_cliente', idCliente);

	const { count: cuentasCobrar } = await client
		.from('cuentas_cobrar')
		.select('id_cuenta_cobrar', { count: 'exact', head: true })
		.eq('id_cliente', idCliente);

	let transacciones = 0;
	const { data: centro } = await client
		.from('centro_costo')
		.select('id_centro_costo')
		.eq('id_cliente', idCliente)
		.maybeSingle();
	if (centro?.id_centro_costo) {
		const { count } = await client
			.from('transaccion')
			.select('id_transaccion', { count: 'exact', head: true })
			.or(`id_centro_costo_origen.eq.${centro.id_centro_costo},id_centro_costo_destino.eq.${centro.id_centro_costo}`);
		transacciones = count ?? 0;
	}

	const partes: string[] = [];
	if (proyectos) partes.push(`${proyectos} venta(s)/proyecto(s)`);
	if (cuentasCobrar) partes.push(`${cuentasCobrar} cuenta(s) por cobrar`);
	if (transacciones) partes.push(`${transacciones} transacción(es)`);

	return {
		tieneConflictos: partes.length > 0,
		proyectos: proyectos ?? 0,
		cuentasCobrar: cuentasCobrar ?? 0,
		transacciones,
		detalle:
			partes.length > 0
				? `No se puede eliminar: tiene ${partes.join(', ')} vinculada(s). Elimina o desvincula esas referencias primero.`
				: ''
	};
}

/** Borra un cliente — primero verifica dependencias (ver getClienteDependencias) para devolver un
 * mensaje legible en vez de un error crudo de FK, o de dejar transacciones huérfanas. Si no hay
 * ninguna referencia, el DELETE se propaga solo a su centro de costo (ON DELETE CASCADE en la BD). */
export async function deleteClienteCascade(client: SupabaseClient, idCliente: number): Promise<ServiceResult> {
	const dependencias = await getClienteDependencias(client, idCliente);
	if (dependencias.tieneConflictos) return { success: false, message: dependencias.detalle };

	const { error } = await client.from('cliente').delete().eq('id_cliente', idCliente);
	if (error) return { success: false, message: `Es posible que esté referenciado en otras tablas. ${error.message}` };
	return { success: true };
}

export interface CerrarVentaParams {
	idProyecto: number;
	proyectoNombre: string;
	tipoVenta: 'consultoria' | 'obra';
	idCliente: number;
	clienteNombre: string;
	selectedFinalId: number;
	montoFinalVenta: number;
	/** true = el adelanto ya se registró antes (al crear la venta u otra vez) — no hace falta crear
	 * la transacción de nuevo, solo fijar la proforma final y cerrar. */
	adelantoYaRegistrado: boolean;
	/** Requeridos solo si !adelantoYaRegistrado. `comprobanteUrl` ya debe estar subido — este
	 * servicio NO sube archivos, solo registra la transacción con la URL que le pasen (el upload lo
	 * hace el llamador, admin directo o solicitante, antes de invocar esto). */
	adelantoMonto?: number;
	adelantoFecha?: string;
	comprobanteUrl?: string;
}

/** Cierra una venta: crea la transacción del adelanto si hace falta, fija la proforma final y pasa
 * el proyecto a 'venta_cerrada' — mismo cuerpo que el viejo `handleCerrarVenta` de
 * NuevaVentaModal.svelte, ahora reusable tanto por un admin que cierra directo como por la
 * aprobación de una solicitud 'cerrar_venta' de un no-admin (con el payload que ese solicitante ya
 * armó, incluyendo el comprobante ya subido). */
export async function cerrarVentaAprobada(
	client: SupabaseClient,
	params: CerrarVentaParams,
	usuarioEmail: string | null,
	usuarioNombre: string | null
): Promise<ServiceResult> {
	try {
		if (!params.adelantoYaRegistrado) {
			if (!params.comprobanteUrl || !params.adelantoMonto) {
				return { success: false, message: 'Falta el comprobante o el monto del adelanto.' };
			}

			const idCentroProyecto = params.tipoVenta === 'consultoria'
				? await getOrCrearCentroCostoCompartido(client, 'consultoria')
				: await getOrCrearCentroCostoParaEntidad(client, 'proyecto', params.idProyecto, params.proyectoNombre);
			if (!idCentroProyecto) return { success: false, message: 'No se pudo obtener el centro de costo del proyecto.' };

			const idCentroCliente = await getOrCrearCentroCostoParaEntidad(client, 'cliente', params.idCliente, params.clienteNombre);
			if (!idCentroCliente) return { success: false, message: 'No se pudo obtener el centro de costo del cliente.' };

			const transResult = await createTransaccion(
				client,
				{
					tipo_alcance: 'externa',
					id_centro_costo_origen: idCentroCliente,
					id_centro_costo_destino: idCentroProyecto,
					fecha: params.adelantoFecha,
					monto_total: Number(params.adelantoMonto),
					tipo: 'ingreso',
					estado: 'activo',
					comprobante_url: params.comprobanteUrl,
					descripcion: `Adelanto inicial - ${params.proyectoNombre} (proyecto #${params.idProyecto})`
				},
				usuarioEmail,
				usuarioNombre
			);
			if (!transResult.success) return { success: false, message: transResult.message || 'No se pudo registrar la transacción del adelanto.' };
		}

		const { error: clearError } = await client
			.from('documento_proyecto')
			.update({ es_proforma_final: false })
			.eq('id_proyecto', params.idProyecto)
			.eq('es_proforma_final', true);
		if (clearError) return { success: false, message: clearError.message };

		const { error: setError } = await client
			.from('documento_proyecto')
			.update({ es_proforma_final: true })
			.eq('id_documento', params.selectedFinalId);
		if (setError) return { success: false, message: setError.message };

		const { error: closeError } = await client
			.from('proyecto')
			.update({ estado_proyecto: 'venta_cerrada', precio_venta: Number(params.montoFinalVenta) })
			.eq('id_proyecto', params.idProyecto);
		if (closeError) return { success: false, message: closeError.message };

		return { success: true };
	} catch (err: any) {
		return { success: false, message: err?.message || String(err) };
	}
}

/** Aprueba una solicitud: aplica el cambio real (según tipo_accion) y, solo si tiene éxito, marca
 * la solicitud como 'aprobado'. Si la aplicación falla, la solicitud queda 'pendiente' — no se
 * pierde por un error transitorio (el admin puede reintentar). */
export async function aprobarSolicitud(client: SupabaseClient, idSolicitud: number, resueltoPor: string | null): Promise<ServiceResult> {
	const { data: solicitud, error: fetchError } = await client
		.from(TABLE_NAME)
		.select('*')
		.eq('id_solicitud', idSolicitud)
		.single();
	if (fetchError || !solicitud) return { success: false, message: fetchError?.message || 'Solicitud no encontrada.' };

	let result: ServiceResult;

	if (solicitud.tipo_accion === 'eliminar') {
		result = solicitud.tipo_entidad === 'cliente'
			? await deleteClienteCascade(client, solicitud.id_entidad)
			: await eliminarVentaCascade(client, solicitud.id_entidad);
	} else if (solicitud.tipo_accion === 'cerrar_venta') {
		const { data: userData } = await client.auth.getUser();
		result = await cerrarVentaAprobada(client, solicitud.payload_cambios as unknown as CerrarVentaParams, userData?.user?.email ?? null, resueltoPor);
	} else {
		const table = solicitud.tipo_entidad === 'cliente' ? 'cliente' : 'proyecto';
		const pk = solicitud.tipo_entidad === 'cliente' ? 'id_cliente' : 'id_proyecto';
		const { error } = await client.from(table).update(solicitud.payload_cambios ?? {}).eq(pk, solicitud.id_entidad);
		result = error ? { success: false, message: error.message } : { success: true };
	}

	if (!result.success) return result;

	const { error: updateError } = await client
		.from(TABLE_NAME)
		.update({ estado: 'aprobado', resuelto_por: resueltoPor, resuelto_en: new Date().toISOString() })
		.eq('id_solicitud', idSolicitud);
	if (updateError) return { success: false, message: updateError.message };

	return { success: true };
}

export async function rechazarSolicitud(client: SupabaseClient, idSolicitud: number, resueltoPor: string | null): Promise<ServiceResult> {
	const { error } = await client
		.from(TABLE_NAME)
		.update({ estado: 'rechazado', resuelto_por: resueltoPor, resuelto_en: new Date().toISOString() })
		.eq('id_solicitud', idSolicitud);
	if (error) return { success: false, message: error.message };
	return { success: true };
}
