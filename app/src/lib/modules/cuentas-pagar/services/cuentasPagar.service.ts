/**
 * Servicio de acceso a datos para "cuentas_pagar" + su detalle "pagos".
 * Recibe el SupabaseClient como parámetro; se invoca client-side con el cliente anon
 * ($lib/supabaseClient) para funcionar igual en web y en Tauri (Windows/Android) sin
 * servidor embebido. AJUSTAR: la BD no tiene RLS real todavía, ver nota en +page.svelte.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { FieldOption } from '$lib/shared/fieldConfig';
import { validatePayload, buildWritablePayload, translateSupabaseError, formatCurrency } from '$lib/shared/fieldConfig';
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
import { registrarTransaccionPorPago, construirPayloadTransaccionPorPago } from '../../transacciones/services/transacciones.service';

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
	 * cuota programada recién pasa a 'pagado' — ver updatePago y transacciones.service.ts. */
	transaccionSugerida?: Record<string, unknown>;
}

const SORTABLE_KEYS = new Set(FIELDS_CONFIG.filter((f) => f.sortable).map((f) => f.key));

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
	usuarioRegistro: string | null
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

	await resincronizarCuotasProgramadas(client, data.id_cuenta_pagar, saldoInicial, Number(insertData.condicion_pago), data.fecha_emision, data.fecha_vencimiento);

	return { success: true, message: 'Cuenta por pagar creada correctamente', data: data as CuentaPagar };
}

/**
 * Borra las cuotas 'programado' que ya existan para la cuenta (nunca toca las 'pagado', esas son
 * reales) y las vuelve a generar según el Número de Cuotas / monto / fechas ACTUALES. Se llama tanto
 * al crear como al actualizar la cuenta, para que un cambio en "Número de Cuotas" (o en el monto o
 * las fechas, que afectan el reparto) siempre deje las cuotas programadas al día — de más (genera
 * las que falten) o de menos (anula las que ya no correspondan). Si numCuotas <= 1 simplemente no
 * regenera nada (quedan borradas): un pago de 1 sola cuota no necesita programación aparte.
 */
async function resincronizarCuotasProgramadas(
	client: SupabaseClient,
	idCuentaPagar: number,
	montoComprometido: number,
	numCuotas: number,
	fechaEmision: string,
	fechaVencimiento: string | null
): Promise<void> {
	// No se revienta la creación/edición de la cuenta si esto falla — pero SÍ se deja constancia en
	// consola: antes fallaba en silencio y la cuenta se guardaba "bien" sin que aparecieran las cuotas.
	const { error: deleteError } = await client.from(PAGO_TABLE).delete().eq(PARENT_FK_COLUMN, idCuentaPagar).eq('estado_pago', 'programado');
	if (deleteError) {
		console.error('No se pudieron limpiar las cuotas programadas anteriores:', deleteError);
		return;
	}

	if (Number.isFinite(numCuotas) && numCuotas > 1) {
		const { error: insertError } = await generarCuotasProgramadas(client, idCuentaPagar, montoComprometido, numCuotas, fechaEmision, fechaVencimiento);
		if (insertError) {
			console.error('No se pudieron generar las cuotas programadas:', insertError);
		}
	}
}

/** Suma meses a una fecha sin el bug clásico de "31 de enero + 1 mes = 3 de marzo" (fija el día al último válido del mes destino). */
function addMonths(date: Date, months: number): Date {
	const d = new Date(date);
	const day = d.getDate();
	d.setDate(1);
	d.setMonth(d.getMonth() + months);
	const diasEnMesDestino = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
	d.setDate(Math.min(day, diasEnMesDestino));
	return d;
}

function toISODate(d: Date): string {
	return d.toISOString().slice(0, 10);
}

/**
 * Genera N cuotas programadas (tabla pagos, estado_pago='programado') — NO se cuentan como pagos
 * reales todavía (recalcularCuentaPagar las ignora), es solo para ver cómo quedarían programados
 * los pagos futuros. Una cuota por mes desde fecha_emision, topada a fecha_vencimiento (si varias
 * cuotas caen después del vencimiento, todas esas comparten esa misma fecha tope). Monto =
 * monto_comprometido ÷ N, la última cuota absorbe el redondeo de centavos para que la suma cuadre
 * exacto. Reutiliza la columna `fecha_pago` de "pagos" como fecha programada (no existe una columna
 * de fecha aparte para cuotas futuras).
 * AJUSTAR: no hay una acción de "marcar como pagada" una cuota programada todavía — hoy solo se
 * puede eliminar (mismo botón que un pago real) o registrar el pago real aparte cuando llegue la fecha.
 */
async function generarCuotasProgramadas(
	client: SupabaseClient,
	idCuentaPagar: number,
	montoComprometido: number,
	numCuotas: number,
	fechaEmision: string,
	fechaVencimiento: string | null
): Promise<{ error: unknown | null }> {
	const inicio = new Date(fechaEmision);
	if (Number.isNaN(inicio.getTime())) return { error: null };
	const limite = fechaVencimiento ? new Date(fechaVencimiento) : null;

	const montoBase = Math.floor((montoComprometido / numCuotas) * 100) / 100;
	const filas: Record<string, unknown>[] = [];
	let acumulado = 0;

	for (let i = 1; i <= numCuotas; i++) {
		let fecha = addMonths(inicio, i);
		if (limite && !Number.isNaN(limite.getTime()) && fecha.getTime() > limite.getTime()) {
			fecha = limite;
		}
		const esUltima = i === numCuotas;
		const monto = esUltima ? Number((montoComprometido - acumulado).toFixed(2)) : montoBase;
		acumulado += monto;
		filas.push({ [PARENT_FK_COLUMN]: idCuentaPagar, monto, fecha_pago: toISODate(fecha), estado_pago: 'programado' });
	}

	const { error } = await client.from(PAGO_TABLE).insert(filas);
	return { error };
}

export async function updateCuentaPagar(
	client: SupabaseClient,
	id: number,
	payload: Record<string, unknown>
): Promise<ServiceResult<CuentaPagar>> {
	const errors = validatePayload(FIELDS_CONFIG, payload);
	if (Object.keys(errors).length > 0) {
		return { success: false, message: 'Revisa los campos marcados', errors };
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

	// Solo regenera el calendario de cuotas si el Número de Cuotas realmente cambió — si no, un
	// pago que el usuario ya haya editado o cancelado a mano se conserva tal cual, sin que un
	// cambio en otro campo cualquiera (ej. "responsable") lo borre y lo vuelva a armar desde cero.
	const numCuotasAnterior = Number(current?.condicion_pago ?? 0);
	const numCuotasNueva = Number(data.condicion_pago);
	if (numCuotasNueva !== numCuotasAnterior) {
		await resincronizarCuotasProgramadas(client, id, comprometido, numCuotasNueva, data.fecha_emision, data.fecha_vencimiento);
	}

	return { success: true, message: 'Cuenta por pagar actualizada correctamente', data: data as CuentaPagar };
}

export async function deleteCuentaPagar(client: SupabaseClient, id: number): Promise<ServiceResult> {
	// ON DELETE CASCADE en pagos.id_cuenta_pagar se encarga de borrar sus pagos asociados.
	const { error } = await client.from(TABLE_NAME).delete().eq(PK_COLUMN, id);
	if (error) return { success: false, message: `No se pudo eliminar la cuenta por pagar: ${translateSupabaseError(error, FIELDS_CONFIG)}` };
	return { success: true, message: 'Cuenta por pagar eliminada correctamente' };
}

export async function getPagos(client: SupabaseClient, idCuentaPagar: number): Promise<Pago[]> {
	const { data, error } = await client
		.from(PAGO_TABLE)
		.select('*')
		.eq(PARENT_FK_COLUMN, idCuentaPagar)
		.order('fecha_pago', { ascending: false });
	if (error) throw error;
	return (data ?? []) as Pago[];
}

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

	const insertData = {
		...buildWritablePayload(PAGO_FIELDS, payload),
		[PARENT_FK_COLUMN]: idCuentaPagar,
		usuario_registro: usuarioRegistro,
		estado_pago: 'pagado' // registrado a mano acá = pago real, a diferencia de las cuotas autogeneradas
	};

	const { data, error } = await client.from(PAGO_TABLE).insert(insertData).select('*').single();
	if (error) return { success: false, message: `No se pudo registrar el pago: ${translateSupabaseError(error, PAGO_FIELDS)}` };

	// Un pago nuevo registrado a mano (no viene de editar una cuota programada) también debe restarse
	// de lo que queda por pagar: si no se ajustara, las cuotas 'programado' seguirían sumando el monto
	// completo y el total quedaría descuadrado (pagado + programado > monto_comprometido).
	await rebalancearUltimaCuota(client, idCuentaPagar, data.id_pago);
	await recalcularCuentaPagar(client, idCuentaPagar);

	// Genera la transacción (tipo 'egreso') asociada, solo al registrar un pago nuevo (no cuando una
	// cuota programada pasa a 'pagado' después, ver updatePago). Si falla, no revierte el pago — ya
	// se registró correctamente; esto es un registro contable secundario.
	try {
		const { data: cuenta } = await client
			.from(TABLE_NAME)
			.select('id_cuenta_pagar, id_centro_costo, tipo_documento, num_documento, fotma_pago')
			.eq(PK_COLUMN, idCuentaPagar)
			.single();
		if (cuenta) {
			await registrarTransaccionPorPago(
				client,
				cuenta,
				{ id_pago: data.id_pago, monto: Number(data.monto), fecha_pago: data.fecha_pago, medio_pago: data.medio_pago, referencia: data.referencia },
				usuarioRegistro
			);
		}
	} catch (err) {
		console.error('No se pudo generar la transacción automática del pago:', err);
	}

	return { success: true, message: 'Pago registrado correctamente', data: data as Pago };
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
	estadoPago?: 'programado' | 'pagado' | 'cancelado'
): Promise<ServiceResult<Pago>> {
	const errors = validatePayload(PAGO_FIELDS, payload);
	if (Object.keys(errors).length > 0) {
		return { success: false, message: 'Revisa los campos marcados', errors };
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

	const updateData: Record<string, unknown> = buildWritablePayload(PAGO_FIELDS, payload);
	if (estadoPago) updateData.estado_pago = estadoPago;

	const { data, error } = await client.from(PAGO_TABLE).update(updateData).eq(PAGO_PK, idPago).select('*').single();
	if (error) return { success: false, message: `No se pudo editar el pago: ${translateSupabaseError(error, PAGO_FIELDS)}` };

	// El reajuste automático solo aplica cuando NO se está cancelando (ver verificarSumaTrasCancelar
	// arriba, que ahora bloquea en vez de reajustar para el caso específico de anular una cuota).
	if (estadoPago !== 'cancelado') {
		await rebalancearUltimaCuota(client, data.id_cuenta_pagar, idPago);
	}
	await recalcularCuentaPagar(client, data.id_cuenta_pagar);

	// Una cuota que RECIÉN se vuelve 'pagado' (venía de 'programado') es dinero que recién salió de
	// verdad: en vez de insertar la transacción sola, se arma el payload sugerido y se devuelve para
	// que la UI abra el modal de "Nueva Transacción" ya prellenado y el usuario la complete/confirme
	// (ver PagoModal.svelte). Si ya estaba 'pagado' antes (ej. solo se editó el monto o la referencia),
	// no se sugiere nada de nuevo.
	let transaccionSugerida: Record<string, unknown> | undefined;
	if (estadoPago === 'pagado' && estadoAnterior !== 'pagado') {
		try {
			const { data: cuenta } = await client
				.from(TABLE_NAME)
				.select('id_cuenta_pagar, id_centro_costo, tipo_documento, num_documento, fotma_pago')
				.eq(PK_COLUMN, data.id_cuenta_pagar)
				.single();
			if (cuenta) {
				const payload = await construirPayloadTransaccionPorPago(client, cuenta, {
					id_pago: data.id_pago,
					monto: Number(data.monto),
					fecha_pago: data.fecha_pago,
					medio_pago: data.medio_pago,
					referencia: data.referencia
				});
				if (payload) transaccionSugerida = payload;
			}
		} catch (err) {
			console.error('No se pudo preparar la transacción sugerida del pago:', err);
		}
	}

	return { success: true, message: 'Pago actualizado correctamente', data: data as Pago, transaccionSugerida };
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

export async function deletePago(client: SupabaseClient, idPago: number): Promise<ServiceResult> {
	const { data: pago, error: fetchError } = await client.from(PAGO_TABLE).select(PARENT_FK_COLUMN).eq(PAGO_PK, idPago).single();
	if (fetchError || !pago) return { success: false, message: 'Pago no encontrado' };

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
async function recalcularCuentaPagar(client: SupabaseClient, idCuentaPagar: number): Promise<void> {
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
