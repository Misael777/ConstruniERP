/**
 * Servicio de acceso a datos para "cuentas_cobrar" + su detalle "cobros".
 * Recibe el SupabaseClient como parámetro; se invoca client-side con el cliente anon
 * ($lib/supabaseClient) para funcionar igual en web y en Tauri (Windows/Android) sin
 * servidor embebido. AJUSTAR: la BD no tiene RLS real todavía, ver nota en +page.svelte.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { FieldOption } from '$lib/shared/fieldConfig';
import { validatePayload, buildWritablePayload, translateSupabaseError, formatCurrency } from '$lib/shared/fieldConfig';
import { TABLE_NAME, PK_COLUMN, SEARCHABLE_COLUMNS, DEFAULT_PAGE_SIZE, DEFAULT_SORT_FIELD, DEFAULT_SORT_DIR, FIELDS_CONFIG } from '../config/cuentaCobrar.config';
import {
	TABLE_NAME as COBRO_TABLE,
	PK_COLUMN as COBRO_PK,
	PARENT_FK_COLUMN,
	FIELDS_CONFIG as COBRO_FIELDS
} from '../config/cobro.config';
import { construirPayloadTransaccionPorCobro, createTransaccion } from '../../transacciones/services/transacciones.service';

export interface CuentaCobrar {
	id_cuenta_cobrar: number;
	id_cliente: number;
	id_centro_costo: number | null;
	id_proyecto: number | null;
	tipo_documento: number | null;
	num_documento: string | null;
	monto: number;
	monto_cobrado: number;
	saldo_pendiente: number;
	forma_pago: number | null;
	condición_pago: number | null;
	responsable: string | null;
	fecha_emision: string;
	fecha_vencimiento: string | null;
	moneda: string | null;
	monto_dolares: number | null;
	tipo_cambio: number | null;
	observaciones: string | null;
	estado: string;
	usuario_registro: string | null;
	created_at: string;
	cliente?: { nombre: string } | null;
	proyecto?: { nombre_proyecto: string } | null;
}

export interface Cobro {
	id_cobro: number;
	id_cuenta_cobrar: number;
	monto: number;
	fecha_cobro: string;
	medio_cobro: number | null;
	num_operacion: string | null;
	cuenta_banco: number | null;
	usuario_registro: string | null;
	referencia: string | null;
	created_at: string;
	/** 'cobrado' = registrado a mano en "Registrar Cobro" (default); 'programado' = cuota futura
	 * autogenerada desde "Número de Cuotas" (condición_pago); 'cancelado' = una 'programado' que el
	 * usuario canceló editando su Estado — ninguna de las dos últimas cuenta para el saldo. */
	estado_cobro: 'programado' | 'cobrado' | 'cancelado';
	/** Transacción de respaldo (tipo 'ingreso') que prueba este cobro — ver createCobro y
	 * confirmarCobroCobrado. Un cobro con estado_cobro='cobrado' SIEMPRE debe tener esto no-nulo. */
	id_transaccion: number | null;
	/** Solo viene poblado desde getCobros (join embebido) — usado en la UI para deshabilitar
	 * editar/eliminar cuando la transacción vinculada ya fue aprobada por un administrador. */
	transaccion?: { aprobado: boolean; aprobado_por: string | null } | null;
}

export interface ListParams {
	page?: number;
	pageSize?: number;
	search?: string;
	sortBy?: string;
	sortDir?: 'asc' | 'desc';
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
	 * cuota programada recién pasa a 'cobrado' — ver updateCobro y transacciones.service.ts. */
	transaccionSugerida?: Record<string, unknown>;
}

const SORTABLE_KEYS = new Set(FIELDS_CONFIG.filter((f) => f.sortable).map((f) => f.key));

const BLOQUEADO_POR_APROBACION =
	'No se puede modificar/eliminar: tiene un comprobante ya aprobado por un administrador. Solo un administrador puede hacerlo.';

/** true si ALGUNO de los cobros de la cuenta tiene una transacción con aprobado=true. */
async function cuentaTieneTransaccionAprobada(client: SupabaseClient, idCuentaCobrar: number): Promise<boolean> {
	const { data } = await client
		.from(COBRO_TABLE)
		.select('transaccion:id_transaccion(aprobado)')
		.eq(PARENT_FK_COLUMN, idCuentaCobrar);
	return (data ?? []).some((row: any) => row.transaccion?.aprobado === true);
}

/** true si el cobro puntual tiene una transacción con aprobado=true. */
async function cobroTieneTransaccionAprobada(client: SupabaseClient, idCobro: number): Promise<boolean> {
	const { data } = await client
		.from(COBRO_TABLE)
		.select('transaccion:id_transaccion(aprobado)')
		.eq(COBRO_PK, idCobro)
		.maybeSingle();
	return (data as any)?.transaccion?.aprobado === true;
}

export async function getCuentasCobrar(client: SupabaseClient, params: ListParams = {}): Promise<ListResult<CuentaCobrar>> {
	const page = Math.max(1, Math.floor(params.page ?? 1));
	const pageSize = Math.max(1, Math.floor(params.pageSize ?? DEFAULT_PAGE_SIZE));
	const sortField = params.sortBy && SORTABLE_KEYS.has(params.sortBy) ? params.sortBy : DEFAULT_SORT_FIELD;
	const sortDir: 'asc' | 'desc' = params.sortDir === 'asc' || params.sortDir === 'desc' ? params.sortDir : DEFAULT_SORT_DIR;

	const from = (page - 1) * pageSize;
	const to = from + pageSize - 1;

	let query = client
		.from(TABLE_NAME)
		.select('*, cliente(nombre), proyecto(nombre_proyecto)', { count: 'exact' })
		.order(sortField, { ascending: sortDir === 'asc' })
		.range(from, to);

	const search = params.search?.trim();
	if (search) {
		const escaped = search.replace(/[%_]/g, (m) => `\\${m}`);
		const orFilter = SEARCHABLE_COLUMNS.map((col) => `${col}.ilike.%${escaped}%`).join(',');
		query = query.or(orFilter);
	}

	const { data, error, count } = await query;
	if (error) throw error;

	const total = count ?? 0;
	return {
		items: (data ?? []) as CuentaCobrar[],
		total,
		page,
		pageSize,
		totalPages: Math.max(1, Math.ceil(total / pageSize))
	};
}

export async function createCuentaCobrar(
	client: SupabaseClient,
	payload: Record<string, unknown>,
	usuarioRegistro: string | null,
	fraccionesPersonalizadas: { fecha: string; monto: number }[] = []
): Promise<ServiceResult<CuentaCobrar>> {
	const errors = validatePayload(FIELDS_CONFIG, payload);
	if (Object.keys(errors).length > 0) {
		return { success: false, message: 'Revisa los campos marcados', errors };
	}

	const saldoInicial = Number(payload.monto);
	const insertData: Record<string, unknown> = {
		...buildWritablePayload(FIELDS_CONFIG, payload),
		monto_cobrado: 0,
		saldo_pendiente: saldoInicial,
		usuario_registro: usuarioRegistro
	};

	const { data, error } = await client.from(TABLE_NAME).insert(insertData).select('*, cliente(nombre), proyecto(nombre_proyecto)').single();
	if (error) return { success: false, message: `No se pudo crear la cuenta por cobrar: ${translateSupabaseError(error, FIELDS_CONFIG)}` };

	await sincronizarCuotasProgramadas(client, data.id_cuenta_cobrar, fraccionesPersonalizadas);

	return { success: true, message: 'Cuenta por cobrar creada correctamente', data: data as CuentaCobrar };
}

/**
 * Sustituye el calendario de cuotas 'programado' de la cuenta por EXACTAMENTE las fracciones que el
 * usuario configuró en la ventana "Fraccionar este pago" (fecha + monto libres, ver
 * FraccionamientoModal.svelte) — ya no se autogeneran por partes iguales acá: esa validación (que la
 * suma cuadre con el monto total) se hizo del lado del cliente antes de llegar a este punto. Nunca
 * toca las cuotas 'cobrado' (esas son reales). Si `fracciones` viene vacío (Forma de Pago = Contado,
 * o el usuario eliminó el fraccionamiento), simplemente deja la cuenta sin cuotas programadas.
 */
async function sincronizarCuotasProgramadas(
	client: SupabaseClient,
	idCuentaCobrar: number,
	fracciones: { fecha: string; monto: number }[]
): Promise<void> {
	// No se revienta la creación/edición de la cuenta si esto falla (ej. falta la migración de
	// estado_cobro en la BD) — pero SÍ se deja constancia en consola.
	const { error: deleteError } = await client.from(COBRO_TABLE).delete().eq(PARENT_FK_COLUMN, idCuentaCobrar).eq('estado_cobro', 'programado');
	if (deleteError) {
		console.error('No se pudieron limpiar las cuotas programadas anteriores (¿falta la migración de cobros.estado_cobro?):', deleteError);
		return;
	}
	if (fracciones.length === 0) return;

	const filas = fracciones.map((f) => ({ [PARENT_FK_COLUMN]: idCuentaCobrar, monto: f.monto, fecha_cobro: f.fecha, estado_cobro: 'programado' }));
	const { error: insertError } = await client.from(COBRO_TABLE).insert(filas);
	if (insertError) {
		console.error('No se pudieron guardar las cuotas programadas (¿falta la migración de cobros.estado_cobro?):', insertError);
	}
}

export async function updateCuentaCobrar(
	client: SupabaseClient,
	id: number,
	payload: Record<string, unknown>,
	esAdmin: boolean = false,
	fraccionesPersonalizadas: { fecha: string; monto: number }[] = []
): Promise<ServiceResult<CuentaCobrar>> {
	const errors = validatePayload(FIELDS_CONFIG, payload);
	if (Object.keys(errors).length > 0) {
		return { success: false, message: 'Revisa los campos marcados', errors };
	}
	if (!esAdmin && (await cuentaTieneTransaccionAprobada(client, id))) {
		return { success: false, message: BLOQUEADO_POR_APROBACION };
	}

	// monto_cobrado / saldo_pendiente no se tocan aquí (showInForm:false los excluye de buildWritablePayload);
	// si cambia "monto", el saldo se recalcula para reflejar lo ya cobrado hasta ahora.
	const updateData = buildWritablePayload(FIELDS_CONFIG, payload);
	// select('*') en vez de listar columnas: el parser de tipos de supabase-js no soporta el
	// carácter acentuado de "condición_pago" en un select explícito (falla solo a nivel de tipos).
	const { data: current } = await client.from(TABLE_NAME).select('*').eq(PK_COLUMN, id).single();
	const cobrado = Number(current?.monto_cobrado ?? 0);
	if (typeof updateData.monto === 'number') {
		updateData.saldo_pendiente = Math.max(updateData.monto - cobrado, 0);
	}

	const { data, error } = await client
		.from(TABLE_NAME)
		.update(updateData)
		.eq(PK_COLUMN, id)
		.select('*, cliente(nombre), proyecto(nombre_proyecto)')
		.single();
	if (error) return { success: false, message: `No se pudo actualizar la cuenta por cobrar: ${translateSupabaseError(error, FIELDS_CONFIG)}` };

	// El calendario de cuotas se sustituye siempre por lo que traiga `fraccionesPersonalizadas` — el
	// modal hidrata ese arreglo desde las cuotas 'programado' actuales cuando el usuario no tocó nada
	// (ver CuentaCobrarModal.svelte), así que esto es efectivamente un no-op si no hubo cambios reales.
	await sincronizarCuotasProgramadas(client, id, fraccionesPersonalizadas);

	return { success: true, message: 'Cuenta por cobrar actualizada correctamente', data: data as CuentaCobrar };
}

/**
 * Elimina la cuenta y, en cadena, sus cobros (ON DELETE CASCADE) Y las transacciones de respaldo
 * vinculadas a esos cobros — `transaccion` no tiene FK hacia `cobros`, así que ese borrado en cadena
 * no lo hace la BD sola y hay que hacerlo aquí explícitamente. Bloqueada para no-admins si algún
 * cobro tiene una transacción ya aprobada (ver BLOQUEADO_POR_APROBACION).
 */
export async function deleteCuentaCobrar(client: SupabaseClient, id: number, esAdmin: boolean = false): Promise<ServiceResult> {
	if (!esAdmin && (await cuentaTieneTransaccionAprobada(client, id))) {
		return { success: false, message: BLOQUEADO_POR_APROBACION };
	}

	const { data: cobros } = await client.from(COBRO_TABLE).select('id_transaccion').eq(PARENT_FK_COLUMN, id);
	const idsTransaccion = (cobros ?? []).map((c: any) => c.id_transaccion).filter((v: unknown): v is number => v !== null);

	// ON DELETE CASCADE en cobros.id_cuenta_cobrar se encarga de borrar sus cobros asociados.
	const { error } = await client.from(TABLE_NAME).delete().eq(PK_COLUMN, id);
	if (error) return { success: false, message: `No se pudo eliminar la cuenta por cobrar: ${translateSupabaseError(error, FIELDS_CONFIG)}` };

	if (idsTransaccion.length > 0) {
		await client.from('transaccion').delete().in('id_transaccion', idsTransaccion);
	}

	return { success: true, message: 'Cuenta por cobrar eliminada correctamente' };
}

export async function getCobros(client: SupabaseClient, idCuentaCobrar: number): Promise<Cobro[]> {
	const { data, error } = await client
		.from(COBRO_TABLE)
		.select('*, transaccion:id_transaccion(aprobado, aprobado_por)')
		.eq(PARENT_FK_COLUMN, idCuentaCobrar)
		.order('fecha_cobro', { ascending: false });
	if (error) throw error;
	return (data ?? []) as Cobro[];
}

/**
 * "Registrar Cobro" ya NO confirma solo — funciona exactamente igual que pasar una cuota programada
 * a 'cobrado' (ver updateCobro): se inserta como 'programado' y se devuelve `transaccionSugerida`
 * para que la UI abra el modal de "Nueva Transacción" de forma obligatoria (ver CobroModal.svelte,
 * que ya reenvía esto sea alta o edición). El cobro solo pasa a 'cobrado' cuando el usuario confirma
 * esa transacción (confirmarCobroCobrado) — si cancela, el cobro se queda como 'programado' (visible
 * y editable/eliminable en la lista, no se pierde lo que ya escribió).
 */
export async function createCobro(
	client: SupabaseClient,
	idCuentaCobrar: number,
	payload: Record<string, unknown>,
	usuarioRegistro: string | null
): Promise<ServiceResult<Cobro>> {
	const errors = validatePayload(COBRO_FIELDS, payload);
	if (Object.keys(errors).length > 0) {
		return { success: false, message: 'Revisa los campos marcados', errors };
	}

	const { data: cuenta } = await client
		.from(TABLE_NAME)
		.select('id_cuenta_cobrar, id_centro_costo, id_cliente, tipo_documento, num_documento, forma_pago, cliente:id_cliente(nombre)')
		.eq(PK_COLUMN, idCuentaCobrar)
		.single();
	if (!cuenta?.id_centro_costo) {
		return {
			success: false,
			message:
				'No se puede registrar el cobro: la cuenta no tiene un Centro de Costo asignado (es necesario para generar la transacción de respaldo). Edita la cuenta y asígnale uno primero.'
		};
	}

	const insertData = {
		...buildWritablePayload(COBRO_FIELDS, payload),
		[PARENT_FK_COLUMN]: idCuentaCobrar,
		usuario_registro: usuarioRegistro,
		estado_cobro: 'programado' // queda así hasta confirmar la transacción — ver confirmarCobroCobrado
	};

	const { data, error } = await client.from(COBRO_TABLE).insert(insertData).select('*').single();
	if (error) return { success: false, message: `No se pudo registrar el cobro: ${translateSupabaseError(error, COBRO_FIELDS)}` };

	const transaccionSugerida = await construirPayloadTransaccionPorCobro(client, { ...cuenta, clienteNombre: (cuenta as any).cliente?.nombre }, {
		id_cobro: data.id_cobro,
		monto: Number(data.monto),
		fecha_cobro: data.fecha_cobro,
		medio_cobro: data.medio_cobro,
		cuenta_banco: data.cuenta_banco,
		referencia: data.referencia
	});

	return {
		success: true,
		message: 'Cobro guardado. Completa la transacción de respaldo para confirmarlo como Cobrado.',
		data: data as Cobro,
		transaccionSugerida: transaccionSugerida ?? undefined
	};
}

/**
 * Edita una cuota (pensado para las 'programado': ajustar monto/fecha/estado). `estadoCobro` es
 * opcional y va aparte de `payload` porque no vive en COBRO_FIELDS (el formulario de "Registrar
 * Cobro" no debe mostrarlo — un cobro nuevo registrado a mano siempre es 'cobrado'). Se usa para que
 * el usuario pueda pasar una cuota a 'cobrado' (se cobró antes o después de lo programado) o
 * 'cancelado' (ya no se hará), directo desde el modal de edición. Mismo comportamiento que
 * updatePago en cuentasPagar.service.ts.
 */
export async function updateCobro(
	client: SupabaseClient,
	idCobro: number,
	payload: Record<string, unknown>,
	estadoCobro?: 'programado' | 'cobrado' | 'cancelado',
	esAdmin: boolean = false
): Promise<ServiceResult<Cobro>> {
	const errors = validatePayload(COBRO_FIELDS, payload);
	if (Object.keys(errors).length > 0) {
		return { success: false, message: 'Revisa los campos marcados', errors };
	}
	if (!esAdmin && (await cobroTieneTransaccionAprobada(client, idCobro))) {
		return { success: false, message: BLOQUEADO_POR_APROBACION };
	}

	const { data: cobroActual } = await client.from(COBRO_TABLE).select('id_cuenta_cobrar, estado_cobro').eq(COBRO_PK, idCobro).single();
	if (!cobroActual) return { success: false, message: 'Cobro no encontrado' };
	const estadoAnterior = cobroActual.estado_cobro as 'programado' | 'cobrado' | 'cancelado';

	// Al pasar a 'Cancelado' ya NO se reajusta sola la última cuota (a diferencia de un simple cambio
	// de monto): se BLOQUEA la anulación si el resto de los cobros no cuadra con el monto de la cuenta,
	// para que el usuario ajuste los montos a mano ANTES de anular. Solo aplica a esta transición
	// (no al botón de eliminar/papelera, que es una acción aparte).
	if (estadoCobro === 'cancelado' && estadoAnterior !== 'cancelado') {
		const chequeo = await verificarSumaTrasCancelar(client, cobroActual.id_cuenta_cobrar, idCobro);
		if (!chequeo.cuadra) {
			return {
				success: false,
				message: `No se puede anular: el resto de los cobros sumaría ${formatCurrency(chequeo.sumaResultante)} y el Monto es ${formatCurrency(chequeo.monto)}. Ajusta los montos de las demás cuotas antes de anular esta.`
			};
		}
	}

	// La transición a 'cobrado' NUNCA se persiste directamente aquí — exige una transacción de
	// respaldo creada en el mismo paso (ver confirmarCobroCobrado, más abajo). El resto de los campos
	// (monto, fecha, etc.) y cualquier otra transición de estado (a 'programado' o 'cancelado') sí se
	// guardan normalmente en este mismo update.
	const pasandoACobrado = estadoCobro === 'cobrado' && estadoAnterior !== 'cobrado';
	const updateData: Record<string, unknown> = buildWritablePayload(COBRO_FIELDS, payload);
	if (estadoCobro && !pasandoACobrado) updateData.estado_cobro = estadoCobro;

	const { data, error } = await client.from(COBRO_TABLE).update(updateData).eq(COBRO_PK, idCobro).select('*').single();
	if (error) return { success: false, message: `No se pudo editar el cobro: ${translateSupabaseError(error, COBRO_FIELDS)}` };

	// El reajuste automático solo aplica cuando NO se está cancelando (ver verificarSumaTrasCancelar
	// arriba, que ahora bloquea en vez de reajustar para el caso específico de anular una cuota).
	if (estadoCobro !== 'cancelado') {
		await rebalancearUltimaCuota(client, data.id_cuenta_cobrar, idCobro);
	}
	await recalcularCuentaCobrar(client, data.id_cuenta_cobrar);

	if (!pasandoACobrado) {
		return { success: true, message: 'Cobro actualizado correctamente', data: data as Cobro };
	}

	// Arma (sin insertar) el payload sugerido de la transacción de respaldo: la UI DEBE abrir el modal
	// de "Nueva Transacción" con esto y el usuario tiene que confirmarlo (ver confirmarCobroCobrado) —
	// si cancela ese paso, este cobro se queda tal como estaba (todavía NO 'cobrado', ver arriba).
	const { data: cuenta } = await client
		.from(TABLE_NAME)
		.select('id_cuenta_cobrar, id_centro_costo, id_cliente, tipo_documento, num_documento, forma_pago, cliente:id_cliente(nombre)')
		.eq(PK_COLUMN, data.id_cuenta_cobrar)
		.single();

	if (!cuenta?.id_centro_costo) {
		return {
			success: true,
			message:
				'Cambios guardados, pero no se pudo pasar a "Cobrado": la cuenta no tiene un Centro de Costo asignado (necesario para la transacción de respaldo). Asígnale uno editando la cuenta y vuelve a intentarlo.',
			data: data as Cobro
		};
	}

	const transaccionSugerida = await construirPayloadTransaccionPorCobro(client, { ...cuenta, clienteNombre: (cuenta as any).cliente?.nombre }, {
		id_cobro: data.id_cobro,
		monto: Number(data.monto),
		fecha_cobro: data.fecha_cobro,
		medio_cobro: data.medio_cobro,
		cuenta_banco: data.cuenta_banco,
		referencia: data.referencia
	});

	return {
		success: true,
		message: 'Cambios guardados. Completa la transacción de respaldo para confirmar el cobro.',
		data: data as Cobro,
		transaccionSugerida: transaccionSugerida ?? undefined
	};
}

/**
 * Segundo paso, obligatorio, para pasar una cuota programada a 'cobrado': crea la transacción de
 * respaldo (a partir del payload que la UI arma con construirPayloadTransaccionPorCobro / lo que el
 * usuario haya ajustado en el modal) y SOLO si se crea con éxito, confirma el cobro como 'cobrado'
 * enlazado a ella. Si la transacción falla, el cobro NO se toca — sigue en su estado anterior (ver
 * updateCobro, que deliberadamente no cambia estado_cobro hasta que esto se llama y funciona).
 */
export async function confirmarCobroCobrado(
	client: SupabaseClient,
	idCobro: number,
	transaccionPayload: Record<string, unknown>,
	usuarioRegistro: string | null,
	usuarioNombre: string | null = null
): Promise<ServiceResult<Cobro>> {
	const { data: cobroActual } = await client.from(COBRO_TABLE).select('id_cuenta_cobrar').eq(COBRO_PK, idCobro).single();
	if (!cobroActual) return { success: false, message: 'Cobro no encontrado' };

	const transResult = await createTransaccion(client, transaccionPayload, usuarioRegistro, usuarioNombre);
	if (!transResult.success || !transResult.data) {
		return { success: false, message: transResult.message, errors: transResult.errors };
	}

	const { data, error } = await client
		.from(COBRO_TABLE)
		.update({ estado_cobro: 'cobrado', id_transaccion: transResult.data.id_transaccion })
		.eq(COBRO_PK, idCobro)
		.select('*')
		.single();
	if (error) return { success: false, message: `La transacción se creó, pero no se pudo confirmar el cobro: ${translateSupabaseError(error, COBRO_FIELDS)}` };

	await rebalancearUltimaCuota(client, data.id_cuenta_cobrar, idCobro);
	await recalcularCuentaCobrar(client, data.id_cuenta_cobrar);

	return { success: true, message: 'Cobro confirmado como Cobrado', data: data as Cobro };
}

/**
 * Comprueba si, al anular la cuota `idCobroAAnular`, el resto de los cobros (cobrado + programado,
 * excluyendo esa cuota ya que al cancelarse deja de contar) seguiría sumando exactamente el monto de
 * la cuenta. No modifica nada — solo informa si cuadra o no, para que updateCobro decida si bloquea
 * la anulación.
 */
async function verificarSumaTrasCancelar(
	client: SupabaseClient,
	idCuentaCobrar: number,
	idCobroAAnular: number
): Promise<{ cuadra: boolean; sumaResultante: number; monto: number }> {
	const { data: cuenta } = await client.from(TABLE_NAME).select('monto').eq(PK_COLUMN, idCuentaCobrar).single();
	const monto = Number(cuenta?.monto ?? 0);

	const { data: cobros } = await client
		.from(COBRO_TABLE)
		.select('id_cobro, monto, estado_cobro')
		.eq(PARENT_FK_COLUMN, idCuentaCobrar);

	const sumaResultante = (cobros ?? [])
		.filter((c: any) => c.id_cobro !== idCobroAAnular && (c.estado_cobro === 'cobrado' || c.estado_cobro === 'programado'))
		.reduce((sum: number, c: any) => sum + Number(c.monto), 0);

	return {
		cuadra: Number(sumaResultante.toFixed(2)) === Number(monto.toFixed(2)),
		sumaResultante: Number(sumaResultante.toFixed(2)),
		monto
	};
}

/**
 * El monto total de la cuenta SIEMPRE debe ser igual a la suma de sus cuotas. Si el usuario edita el
 * monto de una cuota a mano, o cancela una (con lo que su monto deja de estar cubierto por el
 * calendario), esta función ajusta la ÚLTIMA cuota 'programado' que quede (excluyendo la que se acaba
 * de editar, para no deshacer justo ese cambio) sumándole/restándole la diferencia — el mismo
 * "colchón de redondeo" que ya se usa al generar el calendario inicial (generarCobrosProgramados). Si
 * no queda ninguna otra cuota 'programado' para absorber la diferencia, no se toca nada.
 */
async function rebalancearUltimaCuota(client: SupabaseClient, idCuentaCobrar: number, idCobroEditado: number): Promise<void> {
	const { data: cuenta } = await client.from(TABLE_NAME).select('monto').eq(PK_COLUMN, idCuentaCobrar).single();
	if (!cuenta) return;

	const { data: cobros } = await client
		.from(COBRO_TABLE)
		.select('id_cobro, monto, estado_cobro, fecha_cobro')
		.eq(PARENT_FK_COLUMN, idCuentaCobrar);
	if (!cobros) return;

	const fijos = cobros.filter((c: any) => c.estado_cobro === 'cobrado').reduce((sum: number, c: any) => sum + Number(c.monto), 0);
	const programado = cobros
		.filter((c: any) => c.estado_cobro === 'programado')
		.sort((a: any, b: any) => new Date(a.fecha_cobro).getTime() - new Date(b.fecha_cobro).getTime());

	const restante = Number(cuenta.monto) - fijos;
	const sumaProgramado = programado.reduce((sum: number, c: any) => sum + Number(c.monto), 0);
	const diferencia = Number((restante - sumaProgramado).toFixed(2));
	if (diferencia === 0) return; // ya cuadra, nada que ajustar

	const candidatas = programado.filter((c: any) => c.id_cobro !== idCobroEditado);
	if (candidatas.length === 0) return; // no hay otra cuota programada que absorba la diferencia

	const candidata = candidatas[candidatas.length - 1];
	const nuevoMonto = Number((Number(candidata.monto) + diferencia).toFixed(2));
	await client.from(COBRO_TABLE).update({ monto: nuevoMonto }).eq(COBRO_PK, candidata.id_cobro);
}

export async function deleteCobro(client: SupabaseClient, idCobro: number, esAdmin: boolean = false): Promise<ServiceResult> {
	const { data: cobro, error: fetchError } = await client.from(COBRO_TABLE).select(PARENT_FK_COLUMN).eq(COBRO_PK, idCobro).single();
	if (fetchError || !cobro) return { success: false, message: 'Cobro no encontrado' };

	if (!esAdmin && (await cobroTieneTransaccionAprobada(client, idCobro))) {
		return { success: false, message: BLOQUEADO_POR_APROBACION };
	}

	const { error } = await client.from(COBRO_TABLE).delete().eq(COBRO_PK, idCobro);
	if (error) return { success: false, message: `No se pudo eliminar el cobro: ${translateSupabaseError(error, COBRO_FIELDS)}` };

	await recalcularCuentaCobrar(client, (cobro as any)[PARENT_FK_COLUMN]);
	return { success: true, message: 'Cobro eliminado correctamente' };
}

/**
 * Recalcula monto_cobrado/saldo_pendiente sumando SOLO los cobros con estado_cobro='cobrado' (las
 * cuotas 'programado' generadas por generarCobrosProgramados NO cuentan hasta que se registren como
 * cobros reales, igual que en cuentasPagar.service.ts), y ajusta estado a pendiente/pagado. Preserva
 * "vencido" si ya estaba así marcado (es una marca manual, no derivada del saldo). No es una
 * transacción atómica de BD — con el volumen esperado de cobros por cuenta el riesgo de condición de
 * carrera es bajo, pero si el ERP crece a alta concurrencia, esto debería moverse a una función SQL
 * con transacción real.
 */
export async function recalcularCuentaCobrar(client: SupabaseClient, idCuentaCobrar: number): Promise<void> {
	const { data: cuenta } = await client.from(TABLE_NAME).select('monto, estado').eq(PK_COLUMN, idCuentaCobrar).single();
	if (!cuenta) return;

	const { data: cobros } = await client.from(COBRO_TABLE).select('monto, estado_cobro').eq(PARENT_FK_COLUMN, idCuentaCobrar);
	const totalCobrado = (cobros ?? [])
		.filter((c: any) => c.estado_cobro === 'cobrado')
		.reduce((sum: number, c: any) => sum + Number(c.monto), 0);
	const saldoPendiente = Math.max(Number(cuenta.monto) - totalCobrado, 0);

	const nuevoEstado = cuenta.estado === 'vencido' ? 'vencido' : saldoPendiente <= 0 ? 'pagado' : 'pendiente';

	await client
		.from(TABLE_NAME)
		.update({ monto_cobrado: totalCobrado, saldo_pendiente: saldoPendiente, estado: nuevoEstado })
		.eq(PK_COLUMN, idCuentaCobrar);
}

export async function getClienteOptions(client: SupabaseClient): Promise<FieldOption[]> {
	const { data, error } = await client.from('cliente').select('id_cliente, nombre').order('nombre');
	if (error) throw error;
	return (data ?? []).map((c: any) => ({ value: String(c.id_cliente), label: c.nombre }));
}

export async function getProyectoOptions(client: SupabaseClient): Promise<FieldOption[]> {
	const { data, error } = await client.from('proyecto').select('id_proyecto, nombre_proyecto').order('nombre_proyecto');
	if (error) throw error;
	return (data ?? []).map((p: any) => ({ value: String(p.id_proyecto), label: p.nombre_proyecto }));
}
