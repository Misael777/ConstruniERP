/**
 * Servicio de acceso a datos para "cuentas_pagar" + su detalle "pagos".
 * Recibe el SupabaseClient como parámetro; se invoca client-side con el cliente anon
 * ($lib/supabaseClient) para funcionar igual en web y en Tauri (Windows/Android) sin
 * servidor embebido. AJUSTAR: la BD no tiene RLS real todavía, ver nota en +page.svelte.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { FieldOption, ColumnFilters } from '$lib/shared/fieldConfig';
import { validatePayload, buildWritablePayload, translateSupabaseError, formatCurrency, applyColumnFilters } from '$lib/shared/fieldConfig';
import {
	TABLE_NAME,
	PK_COLUMN,
	SEARCHABLE_COLUMNS,
	DEFAULT_PAGE_SIZE,
	DEFAULT_SORT_FIELD,
	DEFAULT_SORT_DIR,
	FIELDS_CONFIG
} from '../config/cuentaPagar.config';
import {
	TABLE_NAME as PAGO_TABLE,
	PK_COLUMN as PAGO_PK,
	PARENT_FK_COLUMN,
	FIELDS_CONFIG as PAGO_FIELDS
} from '../config/pago.config';
import { construirPayloadTransaccionPorPago, createTransaccion } from '../../transacciones/services/transacciones.service';

export interface CuentaPagar {
	id_cuenta_pagar: number;
	id_proveedor: number;
	id_centro_costo: number | null;
	id_presupuesto: number | null;
	id_partida: number | null;
	tipo_documento: number | null;
	num_documento: string | null;
	monto_comprometido: number;
	monto_pagado: number;
	saldo_pendiente: number;
	fotma_pago: number | null;
	categoria_gasto: number | null;
	condicion_pago: string | null;
	responsable: string | null;
	fecha_emision: string;
	fecha_vencimiento: string | null;
	fecha_pago_programada: string | null;
	monto_imponible: number;
	monto_igv: number;
	detraccion: number | null;
	monto_retencion: number | null;
	estado: string;
	observacion: string | null;
	prioridad: string | null;
	usuario_registro: string | null;
	created_at: string;
	proveedor?: { razon_social: string } | null;
}

export interface Pago {
	id_pago: number;
	id_cuenta_pagar: number;
	monto: number;
	fecha_pago: string;
	medio_pago: string | null;
	num_operacion: string | null;
	usuario_registro: string | null;
	referencia: string | null;
	created_at: string;
	/** 'pagado' = registrado a mano en "Registrar Pago" (default en BD); 'programado' = cuota futura
	 * autogenerada desde "Número de Cuotas"; 'cancelado' = una 'programado' que el usuario canceló
	 * editando su Estado (ver PagoModal.svelte) — ninguna de las dos últimas cuenta para el saldo. */
	estado_pago: 'programado' | 'pagado' | 'cancelado';
	/** Transacción de respaldo (tipo 'egreso') que prueba este pago — ver createPago y
	 * confirmarPagoPagado. Un pago con estado_pago='pagado' SIEMPRE debe tener esto no-nulo. */
	id_transaccion: number | null;
	/** Solo viene poblado desde getPagos (join embebido) — usado en la UI para deshabilitar
	 * editar/eliminar cuando la transacción vinculada ya fue aprobada por un administrador. */
	transaccion?: { aprobado: boolean; aprobado_por: string | null } | null;
}

export interface ListParams {
	page?: number;
	pageSize?: number;
	search?: string;
	sortBy?: string;
	sortDir?: 'asc' | 'desc';
	/** Filtros por columna estilo Excel (ver fieldConfig.ts) — se combinan con AND entre columnas
	 * distintas y con el `search` de arriba (independientes: search es la caja libre, columnFilters
	 * son los filtros por columna). */
	columnFilters?: ColumnFilters;
}

export interface ListResult<T> {
	items: T[];
	total: number;
	page: number;
	pageSize: number;
	totalPages: number;
}

export interface ServiceResult<T = undefined> {
	success: boolean;
	message: string;
	data?: T;
	errors?: Record<string, string>;
	/** Payload sugerido (sin insertar) para prellenar el modal de "Nueva Transacción", cuando una
	 * cuota programada recién pasa a 'pagado' — ver updatePago y transacciones.service.ts. */
	transaccionSugerida?: Record<string, unknown>;
}

const SORTABLE_KEYS = new Set(FIELDS_CONFIG.filter((f) => f.sortable).map((f) => f.key));

const BLOQUEADO_POR_APROBACION =
	'No se puede modificar/eliminar: tiene un comprobante ya aprobado por un administrador. Solo un administrador puede hacerlo.';

/** true si ALGUNO de los pagos de la cuenta tiene una transacción con aprobado=true. */
async function cuentaTieneTransaccionAprobada(client: SupabaseClient, idCuentaPagar: number): Promise<boolean> {
	const { data } = await client
		.from(PAGO_TABLE)
		.select('transaccion:id_transaccion(aprobado)')
		.eq(PARENT_FK_COLUMN, idCuentaPagar);
	return (data ?? []).some((row: any) => row.transaccion?.aprobado === true);
}

/** true si el pago puntual tiene una transacción con aprobado=true. */
async function pagoTieneTransaccionAprobada(client: SupabaseClient, idPago: number): Promise<boolean> {
	const { data } = await client
		.from(PAGO_TABLE)
		.select('transaccion:id_transaccion(aprobado)')
		.eq(PAGO_PK, idPago)
		.maybeSingle();
	return (data as any)?.transaccion?.aprobado === true;
}

/**
 * Regla de negocio de `estado`: pagado si el saldo ya llegó a 0; vencido si hoy pasó la fecha de
 * vencimiento o la fecha de pago programada (lo que ocurra primero); si no, pendiente. Ya no es una
 * marca manual — se recalcula en cada create/update de la cuenta y en cada alta/baja de un pago.
 */
function computeEstadoCuentaPagar(saldoPendiente: number, fechaVencimiento: string | null, fechaPagoProgramada: string | null): string {
	if (saldoPendiente <= 0) return 'pagado';

	const hoy = new Date();
	hoy.setHours(0, 0, 0, 0);
	const yaVencio = (fecha: string | null) => {
		if (!fecha) return false;
		const d = new Date(fecha);
		return !Number.isNaN(d.getTime()) && d.getTime() < hoy.getTime();
	};

	if (yaVencio(fechaVencimiento) || yaVencio(fechaPagoProgramada)) return 'vencido';
	return 'pendiente';
}

export async function getCuentasPagar(client: SupabaseClient, params: ListParams = {}): Promise<ListResult<CuentaPagar>> {
	const page = Math.max(1, Math.floor(params.page ?? 1));
	const pageSize = Math.max(1, Math.floor(params.pageSize ?? DEFAULT_PAGE_SIZE));
	const sortField = params.sortBy && SORTABLE_KEYS.has(params.sortBy) ? params.sortBy : DEFAULT_SORT_FIELD;
	const sortDir: 'asc' | 'desc' = params.sortDir === 'asc' || params.sortDir === 'desc' ? params.sortDir : DEFAULT_SORT_DIR;

	const from = (page - 1) * pageSize;
	const to = from + pageSize - 1;

	let query = client
		.from(TABLE_NAME)
		.select('*, proveedor(razon_social)', { count: 'exact' })
		.order(sortField, { ascending: sortDir === 'asc' })
		.range(from, to);

	const search = params.search?.trim();
	if (search) {
		const escaped = search.replace(/[%_]/g, (m) => `\\${m}`);
		const orFilter = SEARCHABLE_COLUMNS.map((col) => `${col}.ilike.%${escaped}%`).join(',');
		query = query.or(orFilter);
	}
	if (params.columnFilters) query = applyColumnFilters(query, FIELDS_CONFIG, params.columnFilters);

	const { data, error, count } = await query;
	if (error) throw error;

	const items = await autoCorregirVencidos(client, (data ?? []) as CuentaPagar[]);

	const total = count ?? 0;
	return {
		items,
		total,
		page,
		pageSize,
		totalPages: Math.max(1, Math.ceil(total / pageSize))
	};
}

/** Primer campo 'currency' visible en tabla — la columna que representa "el monto" de esta lista
 * (para cuentas_pagar: monto_comprometido). Genérico a propósito: evita hardcodear el nombre de
 * columna aquí, se deriva de FIELDS_CONFIG igual que el resto del motor. */
const CAMPO_MONTO = FIELDS_CONFIG.find((f) => f.tipo === 'currency' && f.showInTable)!.key;

/**
 * Suma `monto_comprometido` de TODAS las cuentas que matchean el buscador + filtros de columna
 * actuales (no solo la página visible) — para el KPI "Total de Filtrado" del listado. Reutiliza
 * exactamente los mismos filtros que arma la tabla (search + columnFilters), así que el número
 * siempre refleja lo que el usuario está viendo filtrado en ese momento.
 */
export async function getMontoFiltrado(client: SupabaseClient, search: string, columnFilters: ColumnFilters): Promise<number> {
	let query = client.from(TABLE_NAME).select(CAMPO_MONTO);

	const trimmed = search.trim();
	if (trimmed) {
		const escaped = trimmed.replace(/[%_]/g, (m) => `\\${m}`);
		const orFilter = SEARCHABLE_COLUMNS.map((col) => `${col}.ilike.%${escaped}%`).join(',');
		query = query.or(orFilter);
	}
	query = applyColumnFilters(query, FIELDS_CONFIG, columnFilters);

	const { data, error } = await query;
	if (error) throw error;
	return (data ?? []).reduce((sum: number, r: any) => sum + Number(r[CAMPO_MONTO] ?? 0), 0);
}

/**
 * "Vencido" depende de la fecha de hoy, no de ningún evento (crear/editar/pagar) — sin un cron en
 * el servidor (esta app es client-side puro), el único momento en que se puede detectar que una
 * cuenta acaba de vencer es cuando se vuelve a listar. Corrige en BD las filas de ESTA página cuyo
 * estado calculado ya no coincide con el guardado, y devuelve la lista ya corregida.
 * AJUSTAR: solo sana lo que se está viendo en pantalla, no la tabla completa — si se necesita un
 * barrido global real, hace falta un cron/trigger en Supabase (Edge Function programada, por ejemplo).
 */
async function autoCorregirVencidos(client: SupabaseClient, items: CuentaPagar[]): Promise<CuentaPagar[]> {
	const desincronizados = items.filter((item) => {
		if (item.estado === 'pagado') return false; // pagado no se re-evalúa por fecha
		const esperado = computeEstadoCuentaPagar(item.saldo_pendiente, item.fecha_vencimiento, item.fecha_pago_programada);
		return esperado !== item.estado;
	});
	if (desincronizados.length === 0) return items;

	await Promise.all(
		desincronizados.map((item) => {
			const esperado = computeEstadoCuentaPagar(item.saldo_pendiente, item.fecha_vencimiento, item.fecha_pago_programada);
			return client.from(TABLE_NAME).update({ estado: esperado }).eq(PK_COLUMN, item.id_cuenta_pagar);
		})
	);

	const corregidos = new Set(desincronizados.map((i) => i.id_cuenta_pagar));
	return items.map((item) =>
		corregidos.has(item.id_cuenta_pagar)
			? { ...item, estado: computeEstadoCuentaPagar(item.saldo_pendiente, item.fecha_vencimiento, item.fecha_pago_programada) }
			: item
	);
}

export async function createCuentaPagar(
	client: SupabaseClient,
	payload: Record<string, unknown>,
	usuarioRegistro: string | null,
	fraccionesPersonalizadas: { fecha: string; monto: number }[] = []
): Promise<ServiceResult<CuentaPagar>> {
	const errors = validatePayload(FIELDS_CONFIG, payload);
	if (Object.keys(errors).length > 0) {
		return { success: false, message: 'Revisa los campos marcados', errors };
	}

	const saldoInicial = Number(payload.monto_comprometido);
	const insertData: Record<string, unknown> = {
		...buildWritablePayload(FIELDS_CONFIG, payload),
		monto_pagado: 0,
		saldo_pendiente: saldoInicial,
		estado: computeEstadoCuentaPagar(saldoInicial, (payload.fecha_vencimiento as string) || null, (payload.fecha_pago_programada as string) || null),
		usuario_registro: usuarioRegistro
	};

	const { data, error } = await client.from(TABLE_NAME).insert(insertData).select('*, proveedor(razon_social)').single();
	if (error) return { success: false, message: `No se pudo crear la cuenta por pagar: ${translateSupabaseError(error, FIELDS_CONFIG)}` };

	await sincronizarCuotasProgramadas(client, data.id_cuenta_pagar, fraccionesPersonalizadas);

	return { success: true, message: 'Cuenta por pagar creada correctamente', data: data as CuentaPagar };
}

/**
 * Sustituye el calendario de cuotas 'programado' de la cuenta por EXACTAMENTE las fracciones que el
 * usuario configuró en la ventana "Fraccionar este pago" (fecha + monto libres, ver
 * FraccionamientoModal.svelte) — ya no se autogeneran por partes iguales acá: esa validación (que la
 * suma cuadre con monto_comprometido) se hizo del lado del cliente antes de llegar a este punto. Nunca
 * toca las cuotas 'pagado' (esas son reales). Si `fracciones` viene vacío (Forma de Pago = Contado, o
 * el usuario eliminó el fraccionamiento), simplemente deja la cuenta sin cuotas programadas.
 *
 * Exportada (no solo interna a create/updateCuentaPagar) para que el popup de cuotas también se
 * pueda abrir y guardar directo desde /finanzas/cuentas-pagar/panoramas.
 *
 * Devuelve {success,message} en vez de fallar en silencio: create/updateCuentaPagar (donde esto es
 * un efecto SECUNDARIO del guardado principal) siguen ignorando el resultado a propósito para no
 * revertir el guardado de la cuenta por esto — pero el popup de cuotas standalone (donde esto es la
 * ÚNICA acción) SÍ necesita saber si falló para no decirle al usuario "guardado" cuando no se guardó.
 */
export async function sincronizarCuotasProgramadas(
	client: SupabaseClient,
	idCuentaPagar: number,
	fracciones: { fecha: string; monto: number }[]
): Promise<{ success: boolean; message: string }> {
	const { error: deleteError } = await client.from(PAGO_TABLE).delete().eq(PARENT_FK_COLUMN, idCuentaPagar).eq('estado_pago', 'programado');
	if (deleteError) {
		console.error('No se pudieron limpiar las cuotas programadas anteriores:', deleteError);
		return { success: false, message: `No se pudieron guardar las cuotas: ${deleteError.message}` };
	}
	if (fracciones.length === 0) return { success: true, message: 'Cuotas eliminadas' };

	const filas = fracciones.map((f) => ({ [PARENT_FK_COLUMN]: idCuentaPagar, monto: f.monto, fecha_pago: f.fecha, estado_pago: 'programado' }));
	const { error: insertError } = await client.from(PAGO_TABLE).insert(filas);
	if (insertError) {
		console.error('No se pudieron guardar las cuotas programadas:', insertError);
		return { success: false, message: `No se pudieron guardar las cuotas: ${insertError.message}` };
	}
	return { success: true, message: 'Cuotas guardadas' };
}

export async function updateCuentaPagar(
	client: SupabaseClient,
	id: number,
	payload: Record<string, unknown>,
	esAdmin: boolean = false,
	fraccionesPersonalizadas: { fecha: string; monto: number }[] = []
): Promise<ServiceResult<CuentaPagar>> {
	const errors = validatePayload(FIELDS_CONFIG, payload);
	if (Object.keys(errors).length > 0) {
		return { success: false, message: 'Revisa los campos marcados', errors };
	}
	if (!esAdmin && (await cuentaTieneTransaccionAprobada(client, id))) {
		return { success: false, message: BLOQUEADO_POR_APROBACION };
	}

	const updateData = buildWritablePayload(FIELDS_CONFIG, payload);
	const { data: current } = await client.from(TABLE_NAME).select('monto_pagado, monto_comprometido, condicion_pago').eq(PK_COLUMN, id).single();
	const pagado = Number(current?.monto_pagado ?? 0);
	const comprometido = typeof updateData.monto_comprometido === 'number' ? updateData.monto_comprometido : Number(current?.monto_comprometido ?? 0);
	const saldo = Math.max(comprometido - pagado, 0);
	updateData.saldo_pendiente = saldo;
	updateData.estado = computeEstadoCuentaPagar(saldo, (updateData.fecha_vencimiento as string) || null, (updateData.fecha_pago_programada as string) || null);

	const { data, error } = await client
		.from(TABLE_NAME)
		.update(updateData)
		.eq(PK_COLUMN, id)
		.select('*, proveedor(razon_social)')
		.single();
	if (error) return { success: false, message: `No se pudo actualizar la cuenta por pagar: ${translateSupabaseError(error, FIELDS_CONFIG)}` };

	// El calendario de cuotas se sustituye siempre por lo que traiga `fraccionesPersonalizadas` — el
	// modal hidrata ese arreglo desde las cuotas 'programado' actuales cuando el usuario no tocó nada
	// (ver CuentaPagarModal.svelte), así que esto es efectivamente un no-op si no hubo cambios reales.
	await sincronizarCuotasProgramadas(client, id, fraccionesPersonalizadas);

	return { success: true, message: 'Cuenta por pagar actualizada correctamente', data: data as CuentaPagar };
}

/**
 * Elimina la cuenta y, en cadena, sus pagos (ON DELETE CASCADE) Y las transacciones de respaldo
 * vinculadas a esos pagos — `transaccion` no tiene FK hacia `pagos`, así que ese borrado en cadena no
 * lo hace la BD sola y hay que hacerlo aquí explícitamente. Bloqueada para no-admins si algún pago
 * tiene una transacción ya aprobada (ver BLOQUEADO_POR_APROBACION).
 */
export async function deleteCuentaPagar(client: SupabaseClient, id: number, esAdmin: boolean = false): Promise<ServiceResult> {
	if (!esAdmin && (await cuentaTieneTransaccionAprobada(client, id))) {
		return { success: false, message: BLOQUEADO_POR_APROBACION };
	}

	const { data: pagos } = await client.from(PAGO_TABLE).select('id_transaccion').eq(PARENT_FK_COLUMN, id);
	const idsTransaccion = (pagos ?? []).map((p: any) => p.id_transaccion).filter((v: unknown): v is number => v !== null);

	// ON DELETE CASCADE en pagos.id_cuenta_pagar se encarga de borrar sus pagos asociados.
	const { error } = await client.from(TABLE_NAME).delete().eq(PK_COLUMN, id);
	if (error) return { success: false, message: `No se pudo eliminar la cuenta por pagar: ${translateSupabaseError(error, FIELDS_CONFIG)}` };

	if (idsTransaccion.length > 0) {
		await client.from('transaccion').delete().in('id_transaccion', idsTransaccion);
	}

	return { success: true, message: 'Cuenta por pagar eliminada correctamente' };
}

export async function getPagos(client: SupabaseClient, idCuentaPagar: number): Promise<Pago[]> {
	const { data, error } = await client
		.from(PAGO_TABLE)
		.select('*, transaccion:id_transaccion(aprobado, aprobado_por)')
		.eq(PARENT_FK_COLUMN, idCuentaPagar)
		.order('fecha_pago', { ascending: false });
	if (error) throw error;
	return (data ?? []) as Pago[];
}

/**
 * "Registrar Pago" ya NO confirma solo — funciona exactamente igual que pasar una cuota programada a
 * 'pagado' (ver updatePago): se inserta como 'programado' y se devuelve `transaccionSugerida` para
 * que la UI abra el modal de "Nueva Transacción" de forma obligatoria (ver PagoModal.svelte, que ya
 * reenvía esto sea alta o edición). El pago solo pasa a 'pagado' cuando el usuario confirma esa
 * transacción (confirmarPagoPagado) — si cancela, el pago se queda como 'programado' (visible y
 * editable/eliminable en la lista, no se pierde lo que ya escribió).
 */
export async function createPago(
	client: SupabaseClient,
	idCuentaPagar: number,
	payload: Record<string, unknown>,
	usuarioRegistro: string | null
): Promise<ServiceResult<Pago>> {
	const errors = validatePayload(PAGO_FIELDS, payload);
	if (Object.keys(errors).length > 0) {
		return { success: false, message: 'Revisa los campos marcados', errors };
	}

	const { data: cuenta } = await client
		.from(TABLE_NAME)
		.select('id_cuenta_pagar, id_centro_costo, id_proveedor, tipo_documento, num_documento, fotma_pago, proveedor:id_proveedor(razon_social)')
		.eq(PK_COLUMN, idCuentaPagar)
		.single();
	if (!cuenta?.id_centro_costo) {
		return {
			success: false,
			message:
				'No se puede registrar el pago: la cuenta no tiene un Centro de Costo asignado (es necesario para generar la transacción de respaldo). Edita la cuenta y asígnale uno primero.'
		};
	}

	const insertData = {
		...buildWritablePayload(PAGO_FIELDS, payload),
		[PARENT_FK_COLUMN]: idCuentaPagar,
		usuario_registro: usuarioRegistro,
		estado_pago: 'programado' // queda así hasta confirmar la transacción — ver confirmarPagoPagado
	};

	const { data, error } = await client.from(PAGO_TABLE).insert(insertData).select('*').single();
	if (error) return { success: false, message: `No se pudo registrar el pago: ${translateSupabaseError(error, PAGO_FIELDS)}` };

	const transaccionSugerida = await construirPayloadTransaccionPorPago(client, { ...cuenta, proveedorNombre: (cuenta as any).proveedor?.razon_social }, {
		id_pago: data.id_pago,
		monto: Number(data.monto),
		fecha_pago: data.fecha_pago,
		medio_pago: data.medio_pago,
		referencia: data.referencia
	});

	return {
		success: true,
		message: 'Pago guardado. Completa la transacción de respaldo para confirmarlo como Pagado.',
		data: data as Pago,
		transaccionSugerida: transaccionSugerida ?? undefined
	};
}

/**
 * Edita una cuota (pensado para las 'programado': ajustar monto/fecha/estado). `estadoPago` es
 * opcional y va aparte de `payload` porque no vive en PAGO_FIELDS (el formulario de "Registrar
 * Pago" no debe mostrarlo — un pago nuevo registrado a mano siempre es 'pagado'). Se usa para que
 * el usuario pueda pasar una cuota a 'pagado' (se pagó antes o después de lo programado) o
 * 'cancelado' (ya no se hará), directo desde el modal de edición.
 */
export async function updatePago(
	client: SupabaseClient,
	idPago: number,
	payload: Record<string, unknown>,
	estadoPago?: 'programado' | 'pagado' | 'cancelado',
	esAdmin: boolean = false
): Promise<ServiceResult<Pago>> {
	const errors = validatePayload(PAGO_FIELDS, payload);
	if (Object.keys(errors).length > 0) {
		return { success: false, message: 'Revisa los campos marcados', errors };
	}
	if (!esAdmin && (await pagoTieneTransaccionAprobada(client, idPago))) {
		return { success: false, message: BLOQUEADO_POR_APROBACION };
	}

	const { data: pagoActual } = await client.from(PAGO_TABLE).select('id_cuenta_pagar, estado_pago').eq(PAGO_PK, idPago).single();
	if (!pagoActual) return { success: false, message: 'Pago no encontrado' };
	const estadoAnterior = pagoActual.estado_pago as 'programado' | 'pagado' | 'cancelado';

	// Al pasar a 'Cancelado' ya NO se reajusta sola la última cuota (a diferencia de un simple cambio
	// de monto): se BLOQUEA la anulación si el resto de los pagos no cuadra con monto_comprometido,
	// para que el usuario ajuste los montos a mano ANTES de anular. Solo aplica a esta transición
	// (no al botón de eliminar/papelera, que es una acción aparte).
	if (estadoPago === 'cancelado' && estadoAnterior !== 'cancelado') {
		const chequeo = await verificarSumaTrasCancelar(client, pagoActual.id_cuenta_pagar, idPago);
		if (!chequeo.cuadra) {
			return {
				success: false,
				message: `No se puede anular: el resto de los pagos sumaría ${formatCurrency(chequeo.sumaResultante)} y el Monto Comprometido es ${formatCurrency(chequeo.montoComprometido)}. Ajusta los montos de las demás cuotas antes de anular esta.`
			};
		}
	}

	// La transición a 'pagado' NUNCA se persiste directamente aquí — exige una transacción de respaldo
	// creada en el mismo paso (ver confirmarPagoPagado, más abajo). El resto de los campos (monto,
	// fecha, etc.) y cualquier otra transición de estado (a 'programado' o 'cancelado') sí se guardan
	// normalmente en este mismo update.
	const pasandoAPagado = estadoPago === 'pagado' && estadoAnterior !== 'pagado';
	const updateData: Record<string, unknown> = buildWritablePayload(PAGO_FIELDS, payload);
	if (estadoPago && !pasandoAPagado) updateData.estado_pago = estadoPago;

	const { data, error } = await client.from(PAGO_TABLE).update(updateData).eq(PAGO_PK, idPago).select('*').single();
	if (error) return { success: false, message: `No se pudo editar el pago: ${translateSupabaseError(error, PAGO_FIELDS)}` };

	// El reajuste automático solo aplica cuando NO se está cancelando (ver verificarSumaTrasCancelar
	// arriba, que ahora bloquea en vez de reajustar para el caso específico de anular una cuota).
	if (estadoPago !== 'cancelado') {
		await rebalancearUltimaCuota(client, data.id_cuenta_pagar, idPago);
	}
	await recalcularCuentaPagar(client, data.id_cuenta_pagar);

	if (!pasandoAPagado) {
		return { success: true, message: 'Pago actualizado correctamente', data: data as Pago };
	}

	// Arma (sin insertar) el payload sugerido de la transacción de respaldo: la UI DEBE abrir el modal
	// de "Nueva Transacción" con esto y el usuario tiene que confirmarlo (ver confirmarPagoPagado) —
	// si cancela ese paso, este pago se queda tal como estaba (todavía NO 'pagado', ver arriba).
	const { data: cuenta } = await client
		.from(TABLE_NAME)
		.select('id_cuenta_pagar, id_centro_costo, id_proveedor, tipo_documento, num_documento, fotma_pago, proveedor:id_proveedor(razon_social)')
		.eq(PK_COLUMN, data.id_cuenta_pagar)
		.single();

	if (!cuenta?.id_centro_costo) {
		return {
			success: true,
			message:
				'Cambios guardados, pero no se pudo pasar a "Pagado": la cuenta no tiene un Centro de Costo asignado (necesario para la transacción de respaldo). Asígnale uno editando la cuenta y vuelve a intentarlo.',
			data: data as Pago
		};
	}

	const transaccionSugerida = await construirPayloadTransaccionPorPago(client, { ...cuenta, proveedorNombre: (cuenta as any).proveedor?.razon_social }, {
		id_pago: data.id_pago,
		monto: Number(data.monto),
		fecha_pago: data.fecha_pago,
		medio_pago: data.medio_pago,
		referencia: data.referencia
	});

	return {
		success: true,
		message: 'Cambios guardados. Completa la transacción de respaldo para confirmar el pago.',
		data: data as Pago,
		transaccionSugerida: transaccionSugerida ?? undefined
	};
}

/**
 * Segundo paso, obligatorio, para pasar una cuota programada a 'pagado': crea la transacción de
 * respaldo (a partir del payload que la UI arma con construirPayloadTransaccionPorPago / lo que el
 * usuario haya ajustado en el modal) y SOLO si se crea con éxito, confirma el pago como 'pagado'
 * enlazado a ella. Si la transacción falla, el pago NO se toca — sigue en su estado anterior (ver
 * updatePago, que deliberadamente no cambia estado_pago hasta que esto se llama y funciona).
 */
export async function confirmarPagoPagado(
	client: SupabaseClient,
	idPago: number,
	transaccionPayload: Record<string, unknown>,
	usuarioRegistro: string | null,
	usuarioNombre: string | null = null
): Promise<ServiceResult<Pago>> {
	const { data: pagoActual } = await client.from(PAGO_TABLE).select('id_cuenta_pagar').eq(PAGO_PK, idPago).single();
	if (!pagoActual) return { success: false, message: 'Pago no encontrado' };

	const transResult = await createTransaccion(client, transaccionPayload, usuarioRegistro, usuarioNombre);
	if (!transResult.success || !transResult.data) {
		return { success: false, message: transResult.message, errors: transResult.errors };
	}

	const { data, error } = await client
		.from(PAGO_TABLE)
		.update({ estado_pago: 'pagado', id_transaccion: transResult.data.id_transaccion })
		.eq(PAGO_PK, idPago)
		.select('*')
		.single();
	if (error) return { success: false, message: `La transacción se creó, pero no se pudo confirmar el pago: ${translateSupabaseError(error, PAGO_FIELDS)}` };

	await rebalancearUltimaCuota(client, data.id_cuenta_pagar, idPago);
	await recalcularCuentaPagar(client, data.id_cuenta_pagar);

	return { success: true, message: 'Pago confirmado como Pagado', data: data as Pago };
}

/**
 * Comprueba si, al anular la cuota `idPagoAAnular`, el resto de los pagos (pagado + programado,
 * excluyendo esa cuota ya que al cancelarse deja de contar) seguiría sumando exactamente
 * monto_comprometido. No modifica nada — solo informa si cuadra o no, para que updatePago decida
 * si bloquea la anulación.
 */
async function verificarSumaTrasCancelar(
	client: SupabaseClient,
	idCuentaPagar: number,
	idPagoAAnular: number
): Promise<{ cuadra: boolean; sumaResultante: number; montoComprometido: number }> {
	const { data: cuenta } = await client.from(TABLE_NAME).select('monto_comprometido').eq(PK_COLUMN, idCuentaPagar).single();
	const montoComprometido = Number(cuenta?.monto_comprometido ?? 0);

	const { data: pagos } = await client
		.from(PAGO_TABLE)
		.select('id_pago, monto, estado_pago')
		.eq(PARENT_FK_COLUMN, idCuentaPagar);

	const sumaResultante = (pagos ?? [])
		.filter((p: any) => p.id_pago !== idPagoAAnular && (p.estado_pago === 'pagado' || p.estado_pago === 'programado'))
		.reduce((sum: number, p: any) => sum + Number(p.monto), 0);

	return {
		cuadra: Number(sumaResultante.toFixed(2)) === Number(montoComprometido.toFixed(2)),
		sumaResultante: Number(sumaResultante.toFixed(2)),
		montoComprometido
	};
}

/**
 * El monto total de la cuenta SIEMPRE debe ser igual a la suma de sus cuotas. Si el usuario edita
 * el monto de una cuota a mano, o cancela una (con lo que su monto deja de estar cubierto por el
 * calendario), esta función ajusta la ÚLTIMA cuota 'programado' que quede (excluyendo la que se
 * acaba de editar, para no deshacer justo ese cambio) sumándole/restándole la diferencia — el mismo
 * "colchón de redondeo" que ya se usa al generar el calendario inicial (generarCuotasProgramadas).
 * Si no queda ninguna otra cuota 'programado' para absorber la diferencia, no se toca nada: el
 * descuadre queda visible (la suma ya no cuadrará con monto_comprometido) para que el usuario lo
 * revise a mano, en vez de que el sistema invente un ajuste donde no hay dónde ponerlo.
 */
async function rebalancearUltimaCuota(client: SupabaseClient, idCuentaPagar: number, idPagoEditado: number): Promise<void> {
	const { data: cuenta } = await client.from(TABLE_NAME).select('monto_comprometido').eq(PK_COLUMN, idCuentaPagar).single();
	if (!cuenta) return;

	const { data: pagos } = await client
		.from(PAGO_TABLE)
		.select('id_pago, monto, estado_pago, fecha_pago')
		.eq(PARENT_FK_COLUMN, idCuentaPagar);
	if (!pagos) return;

	const fijos = pagos.filter((p: any) => p.estado_pago === 'pagado').reduce((sum: number, p: any) => sum + Number(p.monto), 0);
	const programado = pagos
		.filter((p: any) => p.estado_pago === 'programado')
		.sort((a: any, b: any) => new Date(a.fecha_pago).getTime() - new Date(b.fecha_pago).getTime());

	const restante = Number(cuenta.monto_comprometido) - fijos;
	const sumaProgramado = programado.reduce((sum: number, p: any) => sum + Number(p.monto), 0);
	const diferencia = Number((restante - sumaProgramado).toFixed(2));
	if (diferencia === 0) return; // ya cuadra, nada que ajustar

	const candidatas = programado.filter((p: any) => p.id_pago !== idPagoEditado);
	if (candidatas.length === 0) return; // no hay otra cuota programada que absorba la diferencia

	const candidata = candidatas[candidatas.length - 1];
	const nuevoMonto = Number((Number(candidata.monto) + diferencia).toFixed(2));
	await client.from(PAGO_TABLE).update({ monto: nuevoMonto }).eq(PAGO_PK, candidata.id_pago);
}

export async function deletePago(client: SupabaseClient, idPago: number, esAdmin: boolean = false): Promise<ServiceResult> {
	const { data: pago, error: fetchError } = await client.from(PAGO_TABLE).select(PARENT_FK_COLUMN).eq(PAGO_PK, idPago).single();
	if (fetchError || !pago) return { success: false, message: 'Pago no encontrado' };

	if (!esAdmin && (await pagoTieneTransaccionAprobada(client, idPago))) {
		return { success: false, message: BLOQUEADO_POR_APROBACION };
	}

	const { error } = await client.from(PAGO_TABLE).delete().eq(PAGO_PK, idPago);
	if (error) return { success: false, message: `No se pudo eliminar el pago: ${translateSupabaseError(error, PAGO_FIELDS)}` };

	await recalcularCuentaPagar(client, (pago as any)[PARENT_FK_COLUMN]);
	return { success: true, message: 'Pago eliminado correctamente' };
}

/**
 * Recalcula monto_pagado/saldo_pendiente sumando SOLO los pagos con estado_pago='pagado' (las
 * cuotas 'programado' generadas por generarCuotasProgramadas NO cuentan hasta que se registren
 * como pagos reales), y ajusta estado con computeEstadoCuentaPagar. No es una transacción atómica
 * de BD — ver misma nota en cuentasCobrar.service.ts.
 */
export async function recalcularCuentaPagar(client: SupabaseClient, idCuentaPagar: number): Promise<void> {
	const { data: cuenta } = await client
		.from(TABLE_NAME)
		.select('monto_comprometido, fecha_vencimiento, fecha_pago_programada')
		.eq(PK_COLUMN, idCuentaPagar)
		.single();
	if (!cuenta) return;

	const { data: pagos } = await client.from(PAGO_TABLE).select('monto, estado_pago').eq(PARENT_FK_COLUMN, idCuentaPagar);
	const totalPagado = (pagos ?? [])
		.filter((p: any) => p.estado_pago === 'pagado')
		.reduce((sum: number, p: any) => sum + Number(p.monto), 0);
	const saldoPendiente = Math.max(Number(cuenta.monto_comprometido) - totalPagado, 0);
	const nuevoEstado = computeEstadoCuentaPagar(saldoPendiente, cuenta.fecha_vencimiento, cuenta.fecha_pago_programada);

	await client
		.from(TABLE_NAME)
		.update({ monto_pagado: totalPagado, saldo_pendiente: saldoPendiente, estado: nuevoEstado })
		.eq(PK_COLUMN, idCuentaPagar);
}

export async function getProveedorOptions(client: SupabaseClient): Promise<FieldOption[]> {
	const { data, error } = await client.from('proveedor').select('id_proveedor, razon_social').order('razon_social');
	if (error) throw error;
	return (data ?? []).map((p: any) => ({ value: String(p.id_proveedor), label: p.razon_social }));
}
