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
import { getOrCrearCentroCostoParaEntidad, getOrCrearCentroCostoCompartido, actualizarSaldoCentroCostoProyecto, darDeBajaCentroCostoDeEntidad } from '$lib/modules/centro-costos/services/centroCostos.service';
import { createTransaccion, darDeBajaTransaccionesDeCentro, type Transaccion } from '$lib/modules/transacciones/services/transacciones.service';
import { generarVentasXLSX } from '$lib/modules/ventas/services/ventasExport.service';
import { generarClientesXLSX } from '$lib/modules/clientes/services/clientesExport.service';

// 'exportacion' (tipo_entidad) / 'exportar' (tipo_accion): a diferencia de editar/eliminar/cerrar_venta,
// una exportación no apunta a una fila puntual — id_entidad queda null para este caso (ver migración
// solicitud_aprobacion_exportar_aviso_migration.sql, que también vuelve la columna nullable).
export type TipoEntidadSolicitud = 'cliente' | 'proyecto' | 'exportacion';
export type TipoAccionSolicitud = 'editar' | 'eliminar' | 'cerrar_venta' | 'exportar';
export type EstadoSolicitud = 'pendiente' | 'aprobado' | 'rechazado';

export interface SolicitudAprobacion {
	id_solicitud: number;
	tipo_entidad: TipoEntidadSolicitud;
	id_entidad: number | null;
	tipo_accion: TipoAccionSolicitud;
	descripcion_entidad: string | null;
	payload_cambios: Record<string, unknown> | null;
	/** Solo para tipo_accion 'editar': valor de cada campo de payload_cambios ANTES de este pedido —
	 * mismas claves que payload_cambios. Permite resaltar en la campanita cuáles campos son un cambio
	 * real (ver descripcionCampoCambiado en NotificacionesBell.svelte). Null en solicitudes creadas
	 * antes de esta columna, o en cualquier tipo_accion que no sea 'editar'. */
	payload_anterior: Record<string, unknown> | null;
	solicitado_por: string | null;
	solicitado_por_id: string | null;
	estado: EstadoSolicitud;
	resuelto_por: string | null;
	resuelto_en: string | null;
	created_at: string;
	visto_por_solicitante: boolean;
	/** Igual que visto_por_solicitante pero del lado admin — solo se usa para los AVISOS informativos
	 * de cierre de venta (ver getAvisosInformativos), no para las solicitudes pendientes normales. */
	visto_por_admin: boolean;
}

export interface ServiceResult {
	success: boolean;
	message?: string;
}

const TABLE_NAME = 'solicitud_aprobacion';

/** Crea una solicitud — resuelve "quién la pide" internamente (permisosState.userName +
 * auth.getUser().id) para que cada llamador no tenga que repetirlo. */
export async function crearSolicitud(
	client: SupabaseClient,
	params: {
		tipoEntidad: TipoEntidadSolicitud;
		idEntidad: number | null;
		tipoAccion: TipoAccionSolicitud;
		descripcionEntidad?: string | null;
		payloadCambios?: Record<string, unknown> | null;
		/** Solo tiene sentido junto a tipoAccion: 'editar' — snapshot del valor de cada campo de
		 * payloadCambios ANTES de este pedido (mismas claves), para que la campanita pueda resaltar
		 * cuáles campos realmente cambian (ver payload_anterior en el tipo SolicitudAprobacion). */
		payloadAnterior?: Record<string, unknown> | null;
		/** true = la acción YA se aplicó directo (ej. un asesor cerrando su propia venta libremente,
		 * sin pasar por aprobación) — la fila se inserta ya 'aprobado'/auto-resuelta, como un AVISO
		 * informativo para los admins (ver getAvisosInformativos), no como algo pendiente de su acción. */
		autoResuelto?: boolean;
	}
): Promise<ServiceResult> {
	try {
		const { data: userData } = await client.auth.getUser();
		const solicitanteNombre = permisosState.userName || null;
		const { error } = await client.from(TABLE_NAME).insert({
			tipo_entidad: params.tipoEntidad,
			id_entidad: params.idEntidad,
			tipo_accion: params.tipoAccion,
			descripcion_entidad: params.descripcionEntidad ?? null,
			payload_cambios: params.payloadCambios ?? null,
			payload_anterior: params.payloadAnterior ?? null,
			solicitado_por: solicitanteNombre,
			solicitado_por_id: userData?.user?.id ?? null,
			estado: params.autoResuelto ? 'aprobado' : 'pendiente',
			resuelto_por: params.autoResuelto ? solicitanteNombre : null,
			resuelto_en: params.autoResuelto ? new Date().toISOString() : null
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

/** Solicitudes YA resueltas (aprobadas o rechazadas) por CUALQUIER admin — a pedido del usuario: una
 * vez que un admin aprueba/rechaza, el resto debe poder ver el resultado (y quién lo resolvió), no
 * solo dejar de ver la solicitud sin explicación. De solo lectura — sin Aprobar/Rechazar, esos botones
 * son exclusivos de las pendientes (getSolicitudesPendientes). Excluye los avisos informativos
 * (cerrar_venta auto-resueltos por el propio solicitante) — esos ya se muestran aparte, ver
 * getAvisosInformativos, para no duplicarlos en las dos secciones. */
export async function getSolicitudesResueltas(client: SupabaseClient): Promise<SolicitudAprobacion[]> {
	const { data, error } = await client
		.from(TABLE_NAME)
		.select('*')
		.neq('estado', 'pendiente')
		.order('resuelto_en', { ascending: false })
		.limit(30);
	if (error) throw error;
	return ((data ?? []) as SolicitudAprobacion[]).filter(
		(s) => !(s.tipo_accion === 'cerrar_venta' && s.resuelto_por === s.solicitado_por)
	);
}

/** Solicitudes del USUARIO ACTUAL (cualquier estado) — para que el propio solicitante vea en su
 * campanita si sigue pendiente, o si ya fue aprobada/rechazada. */
export async function getMisSolicitudes(client: SupabaseClient): Promise<SolicitudAprobacion[]> {
	const { data: userData } = await client.auth.getUser();
	if (!userData?.user?.id) return [];
	const { data, error } = await client
		.from(TABLE_NAME)
		.select('*')
		.eq('solicitado_por_id', userData.user.id)
		.order('created_at', { ascending: false });
	if (error) throw error;
	return (data ?? []) as SolicitudAprobacion[];
}

/** Marca como vistas (por el solicitante) las solicitudes ya resueltas que le pertenecen — se llama
 * cuando abre el panel de su campanita, para que el badge de "no leídas" baje a 0. */
export async function marcarSolicitudesVistas(client: SupabaseClient, ids: number[]): Promise<ServiceResult> {
	if (ids.length === 0) return { success: true };
	const { error } = await client.from(TABLE_NAME).update({ visto_por_solicitante: true }).in('id_solicitud', ids);
	if (error) return { success: false, message: error.message };
	return { success: true };
}

/** Avisos informativos para los admins: ventas cerradas DIRECTO por su propio asesor, sin pasar por
 * aprobación (a pedido del usuario: cerrar una venta ya no requiere aprobación, pero los admins deben
 * enterarse igual). Son filas 'cerrar_venta' + estado='aprobado' donde resuelto_por === solicitado_por
 * (se auto-resolvieron solas, ver crearSolicitud con autoResuelto) — un cierre aprobado de verdad por
 * un admin nunca pasa por esta tabla (cerrarVentaAprobada se llama directo, sin crear solicitud), así
 * que esa condición alcanza para no mezclar avisos con aprobaciones reales pasadas. Son de solo
 * lectura — no tienen Aprobar/Rechazar, solo se marcan como vistas (ver marcarAvisosVistos). */
export async function getAvisosInformativos(client: SupabaseClient): Promise<SolicitudAprobacion[]> {
	const { data, error } = await client
		.from(TABLE_NAME)
		.select('*')
		.eq('tipo_accion', 'cerrar_venta')
		.eq('estado', 'aprobado')
		.order('created_at', { ascending: false })
		.limit(30);
	if (error) throw error;
	return ((data ?? []) as SolicitudAprobacion[]).filter((s) => s.resuelto_por && s.resuelto_por === s.solicitado_por);
}

/** Marca como vistos (por algún admin) los avisos informativos indicados — el estado de "visto" es
 * compartido entre todos los admins (una vez que alguno lo vio, se considera atendido), a diferencia
 * de visto_por_solicitante que es individual por definición (cada solicitud tiene un único dueño). */
export async function marcarAvisosVistos(client: SupabaseClient, ids: number[]): Promise<ServiceResult> {
	if (ids.length === 0) return { success: true };
	const { error } = await client.from(TABLE_NAME).update({ visto_por_admin: true }).in('id_solicitud', ids);
	if (error) return { success: false, message: error.message };
	return { success: true };
}

const NOTIFICACION_TABLE = 'solicitud_notificacion';

/** Trae, para el USUARIO ACTUAL, el último estado de cada solicitud por el que YA fue notificado
 * (sonido + toast nativo) — null si nunca se le notificó nada de esa solicitud todavía. Es una fila
 * por (solicitud, usuario): a diferencia de un booleano compartido en la propia solicitud, cada admin
 * (o el solicitante) lleva su PROPIO registro — así una solicitud vista por un admin no "silencia" a
 * los demás. Se usa para detectar el flanco: si el estado ACTUAL de la solicitud es distinto a esto,
 * corresponde notificar de nuevo (ver marcarNotificaciones). */
export async function getEstadosNotificados(client: SupabaseClient, idsSolicitud: number[]): Promise<Map<number, string | null>> {
	if (idsSolicitud.length === 0) return new Map();
	const { data: userData } = await client.auth.getUser();
	if (!userData?.user?.id) return new Map();
	const { data, error } = await client
		.from(NOTIFICACION_TABLE)
		.select('id_solicitud, estado_anterior')
		.eq('usuario_id', userData.user.id)
		.in('id_solicitud', idsSolicitud);
	if (error) throw error;
	return new Map((data ?? []).map((r: any) => [r.id_solicitud, r.estado_anterior as string | null]));
}

/** Registra, para el usuario actual, que ya fue notificado del estado ACTUAL de estas solicitudes —
 * upsert (una fila por usuario+solicitud) para que el próximo poll no vuelva a sonar mientras el
 * estado no cambie de nuevo (y si cambia — ej. pendiente -> aprobado — sí vuelva a sonar, porque el
 * estado_anterior guardado ya no coincide con el estado nuevo). */
export async function marcarNotificaciones(client: SupabaseClient, items: { idSolicitud: number; estado: string }[]): Promise<ServiceResult> {
	if (items.length === 0) return { success: true };
	const { data: userData } = await client.auth.getUser();
	if (!userData?.user?.id) return { success: false, message: 'No se pudo resolver el usuario actual.' };
	const filas = items.map((i) => ({
		id_solicitud: i.idSolicitud,
		usuario_id: userData.user!.id,
		estado_anterior: i.estado,
		notificado_en: new Date().toISOString()
	}));
	const { error } = await client.from(NOTIFICACION_TABLE).upsert(filas, { onConflict: 'id_solicitud,usuario_id' });
	if (error) return { success: false, message: error.message };
	return { success: true };
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

/** Da de baja una venta ya cerrada (estado_proyecto: 'venta_cerrada' -> 'baja') — a diferencia de
 * eliminarVentaCascade, no borra ningún dato: solo marca el proyecto como inactivo, reemplazando al
 * botón de Eliminar en la tabla/modal una vez que la venta está cerrada. `estado_proyecto` es VARCHAR
 * libre (sin CHECK en BD), así que no hace falta migración para agregar este valor.
 *
 * A pedido del usuario: el centro de costo que se generó para este proyecto (getOrCrearCentroCostoParaEntidad,
 * tipo 'proyecto' — solo existe para ventas de Obra, no las de Consultoría, que comparten uno entre
 * varias) se da de baja junto con el proyecto (ver darDeBajaCentroCostoDeEntidad en
 * centroCostos.service.ts). Es secundario al cambio de estado del proyecto: si falla, se loguea pero
 * no tumba una baja que ya se aplicó correctamente — mismo criterio que actualizarSaldoCentroCostoProyecto
 * en cerrarVentaAprobada. */
export async function darDeBajaVenta(client: SupabaseClient, idProyecto: number): Promise<ServiceResult> {
	const { error } = await client
		.from('proyecto')
		.update({ estado_proyecto: 'baja' })
		.eq('id_proyecto', idProyecto);
	if (error) return { success: false, message: error.message };

	const centroResult = await darDeBajaCentroCostoDeEntidad(client, 'proyecto', idProyecto);
	if (!centroResult.success) {
		console.warn(`[aprobaciones.service] La venta #${idProyecto} se dio de baja, pero no se pudo dar de baja su centro de costo: ${centroResult.message}`);
	}

	// A pedido del usuario: dar de baja una venta también da de baja TODAS sus transacciones (para que
	// dejen de tomarse en los cálculos de saldo/monto y se muestren como "Dado de baja" en el listado
	// de Transacciones, ver darDeBajaTransaccionesDeCentro) — el centro de costo del proyecto ya quedó
	// 'baja' arriba, pero eso solo afecta al CENTRO, no a sus transacciones ya registradas.
	const { data: centros } = await client.from('centro_costo').select('id_centro_costo').eq('id_proyecto', idProyecto);
	const idsCentro = (centros ?? []).map((c: any) => c.id_centro_costo);
	if (idsCentro.length > 0) {
		await darDeBajaTransaccionesDeCentro(client, idsCentro);
	}

	return { success: true };
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

/** Da de baja un cliente (reemplaza al borrado real, ver ClientesTable.svelte/comercial/clientes/
 * +page.svelte) — mismo patrón que darDeBajaVenta: marca `cliente.estado = 'baja'` y da de baja el
 * centro de costo que se generó para él (ver darDeBajaCentroCostoDeEntidad en centroCostos.service.ts).
 * Es secundario al cambio de estado del cliente: si falla, se loguea pero no tumba una baja que ya se
 * aplicó correctamente. */
export async function darDeBajaCliente(client: SupabaseClient, idCliente: number): Promise<ServiceResult> {
	const { error } = await client.from('cliente').update({ estado: 'baja' }).eq('id_cliente', idCliente);
	if (error) return { success: false, message: error.message };

	const centroResult = await darDeBajaCentroCostoDeEntidad(client, 'cliente', idCliente);
	if (!centroResult.success) {
		console.warn(`[aprobaciones.service] El cliente #${idCliente} se dio de baja, pero no se pudo dar de baja su centro de costo: ${centroResult.message}`);
	}

	return { success: true, message: 'Cliente dado de baja correctamente' };
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
	/** Resto de "Información general" + "Características del proyecto" a persistir junto con el cierre
	 * (ver handleCerrarVenta en NuevaVentaModal.svelte) — mismas columnas que actualiza "Guardar
	 * cambios", MENOS precio_venta/costo_estima/estado_proyecto, que este servicio ya fija a partir de
	 * montoFinalVenta. Opcional por compatibilidad con llamadores viejos (aprobarSolicitud, para
	 * 'cerrar_venta' históricas sin payload_cambios). */
	datosProyecto?: Record<string, unknown>;
}

/** Cierra una venta: crea la transacción del adelanto si hace falta, fija la proforma final y pasa
 * el proyecto a 'venta_cerrada' — mismo cuerpo que el viejo `handleCerrarVenta` de
 * NuevaVentaModal.svelte, ahora reusable tanto por un admin que cierra directo como por la
 * aprobación de una solicitud 'cerrar_venta' de un no-admin (con el payload que ese solicitante ya
 * armó, incluyendo el comprobante ya subido).
 *
 * `data` viene con la transacción del adelanto SOLO cuando esta llamada la creó recién (!
 * adelantoYaRegistrado) — a pedido del usuario, el llamador (NuevaVentaModal.svelte) la usa para
 * abrir el popup de Transacciones ya prellenado, así el usuario completa ahí los datos que el cierre
 * de venta no pide (tipo de documento, N° de documento, forma/medio de pago, categoría). Si el
 * adelanto ya estaba registrado de antes, no hay nada nuevo que abrir y `data` queda undefined. */
export async function cerrarVentaAprobada(
	client: SupabaseClient,
	params: CerrarVentaParams,
	usuarioEmail: string | null,
	usuarioNombre: string | null
): Promise<ServiceResult & { data?: Transaccion }> {
	try {
		// A pedido del usuario: cerrar una venta SIEMPRE asegura el centro de costo del proyecto —
		// antes solo se creaba de pasada al registrar la transacción del adelanto (y solo si
		// !adelantoYaRegistrado), así que una venta cuyo adelanto ya estaba registrado podía cerrarse
		// sin que su centro de costo llegara a existir nunca. Mismo criterio que al crear la venta
		// (crearVentaYSubirDocumentos): Consultoría comparte UN centro de costo entre todas sus ventas,
		// Obra tiene uno propio por proyecto.
		const idCentroProyecto = params.tipoVenta === 'consultoria'
			? await getOrCrearCentroCostoCompartido(client, 'consultoria', params.idProyecto, params.proyectoNombre)
			: await getOrCrearCentroCostoParaEntidad(client, 'proyecto', params.idProyecto, params.proyectoNombre);
		if (!idCentroProyecto) {
			console.warn(`[aprobaciones.service] No se pudo asegurar el centro de costo del proyecto #${params.idProyecto} al cerrar la venta.`);
		}

		let transaccionAdelanto: Transaccion | undefined;
		if (!params.adelantoYaRegistrado) {
			if (!params.comprobanteUrl || !params.adelantoMonto) {
				return { success: false, message: 'Falta el comprobante o el monto del adelanto.' };
			}
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
			transaccionAdelanto = transResult.data;
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

		// A pedido del usuario: cerrar la venta también graba todos los datos de "Información general" y
		// "Características del proyecto" recopilados en el formulario (antes solo se guardaban al
		// presionar "Guardar cambios" — si se cerraba directo sin pasar por ahí, se perdían). Las claves
		// explícitas van DESPUÉS del spread para que ganen sobre cualquier valor que datosProyecto
		// pudiera traer por error — costo_estima se mantiene igual a precio_venta, mismo criterio que en
		// creación/edición.
		const { error: closeError } = await client
			.from('proyecto')
			.update({
				...(params.datosProyecto ?? {}),
				estado_proyecto: 'venta_cerrada',
				precio_venta: Number(params.montoFinalVenta),
				costo_estima: Number(params.montoFinalVenta)
			})
			.eq('id_proyecto', params.idProyecto);
		if (closeError) return { success: false, message: closeError.message };

		// A pedido del usuario: al cerrar la venta, el saldo del centro de costo del proyecto debe
		// reflejar el monto total de la venta MENOS el adelanto ya cobrado (ver
		// actualizarSaldoCentroCostoProyecto) — corre DESPUÉS del UPDATE de arriba para que el monto
		// total que lee ya incluya el precio_venta final de esta venta. Secundario al cierre: si falla,
		// no debe tumbar un cierre que ya se aplicó correctamente (se loguea, nunca lanza).
		if (idCentroProyecto) {
			await actualizarSaldoCentroCostoProyecto(client, idCentroProyecto);
		}

		return { success: true, data: transaccionAdelanto };
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
	// Solo la rama 'exportar' completa esto — el archivo generado se guarda en payload_cambios de la
	// MISMA solicitud (junto con el UPDATE de estado más abajo) para que el solicitante lo descargue
	// desde su propia campanita (ver descargarArchivoSolicitud en NotificacionesBell.svelte). Genérico
	// a propósito: cualquier módulo futuro con su propio botón "Exportar" que siga este mismo patrón
	// (guardar archivoContenido/archivoNombre/archivoMime acá) queda soportado sin tocar la campanita.
	let payloadCambiosExtra: Record<string, unknown> | null = null;

	if (solicitud.tipo_accion === 'eliminar') {
		result = solicitud.tipo_entidad === 'cliente'
			? await deleteClienteCascade(client, solicitud.id_entidad)
			: await eliminarVentaCascade(client, solicitud.id_entidad);
	} else if (solicitud.tipo_accion === 'cerrar_venta') {
		const { data: userData } = await client.auth.getUser();
		result = await cerrarVentaAprobada(client, solicitud.payload_cambios as unknown as CerrarVentaParams, userData?.user?.email ?? null, resueltoPor);
	} else if (solicitud.tipo_accion === 'exportar') {
		// "Aprobar" acá significa: el admin genera el export EN NOMBRE de quien lo pidió
		// (solicitado_por_id filtra a las ventas de esa persona, no todo el portafolio) — a pedido del
		// usuario, ya NO se descarga en el navegador del admin; el archivo queda guardado en la propia
		// solicitud para que el solicitante lo descargue desde su campanita. `modulo` en payload_cambios
		// (fijado al crear la solicitud, ver comercial/ventas|clientes/+page.svelte) distingue de cuál
		// módulo es el pedido — ambos comparten el mismo tipo_accion 'exportar'. Solicitudes viejas sin
		// `modulo` (creadas antes de agregar Exportar a Clientes) caen a Ventas por compatibilidad.
		const modulo = (solicitud.payload_cambios as any)?.modulo === 'clientes' ? 'clientes' : 'ventas';
		const generado = modulo === 'clientes'
			? await generarClientesXLSX(client)
			: await generarVentasXLSX(client, solicitud.solicitado_por_id);
		if (generado.success) {
			payloadCambiosExtra = {
				archivoContenido: generado.archivo.contenido,
				archivoNombre: generado.archivo.nombre,
				archivoMime: generado.archivo.mime
			};
			result = { success: true };
		} else {
			result = { success: false, message: generado.message };
		}
	} else {
		const table = solicitud.tipo_entidad === 'cliente' ? 'cliente' : 'proyecto';
		const pk = solicitud.tipo_entidad === 'cliente' ? 'id_cliente' : 'id_proyecto';
		const { error } = await client.from(table).update(solicitud.payload_cambios ?? {}).eq(pk, solicitud.id_entidad);
		result = error ? { success: false, message: error.message } : { success: true };
	}

	if (!result.success) return result;

	// El cambio de estado por sí solo ya es lo que hace que el próximo poll del solicitante vuelva a
	// notificar (ver getEstadosNotificados/marcarNotificaciones — comparan contra este `estado` nuevo,
	// que no va a coincidir con lo último que ese usuario tenía registrado).
	const { error: updateError } = await client
		.from(TABLE_NAME)
		.update({
			estado: 'aprobado',
			resuelto_por: resueltoPor,
			resuelto_en: new Date().toISOString(),
			...(payloadCambiosExtra ? { payload_cambios: payloadCambiosExtra } : {})
		})
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
