/**
 * Detracción en Cuentas por Cobrar (ver $lib/shared/detraccion.ts y la migración detraccion_venta). Cada cuota de una
 * venta con detracción tiene una cuota hija `es_detraccion` (id_cobro_origen = la cuota) por monto × %, que vence
 * 5 días hábiles después. Aquí: leer el % de la venta, crear/actualizar la cuota de detracción y, para los editores
 * de cuotas (Cronograma de Cobranza), ver cada cuota con su monto BRUTO (cuota + su detracción).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { partirDetraccion, porcentajeDetraccion, referenciaDetraccion, sumarDiasHabiles, esReferenciaDetraccion, nombreDetraccion } from '$lib/shared/detraccion';
import { getCuentasBancoNacionOptions } from '$lib/modules/cuentas-bancarias/services/cuentaBanco.service';

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

/** % de detracción de la venta dueña de la cuenta (null = sin detracción o cuenta sin proyecto). */
export async function getPorcentajeDetraccionCuenta(client: SupabaseClient, idCuentaCobrar: number): Promise<number | null> {
	const { data } = await client.from('cuentas_cobrar').select('proyecto(detraccion_porcentaje)').eq('id_cuenta_cobrar', idCuentaCobrar).maybeSingle();
	return porcentajeDetraccion((data as any)?.proyecto?.detraccion_porcentaje);
}

/** Crea la cuota de detracción (pendiente) de una cuota ya creada. */
export async function crearCuotaDetraccion(
	client: SupabaseClient,
	p: { idCuentaCobrar: number; idCobroOrigen: number; idGrupo?: number | null; monto: number; fechaOrigen: string; nombreOrigen?: string | null; usuario?: string | null }
): Promise<{ idCobro: number } | { error: string }> {
	if (!(p.monto > 0)) return { error: 'La detracción debe ser mayor a 0.' };
	const { data, error } = await client
		.from('cobros')
		.insert({
			id_cuenta_cobrar: p.idCuentaCobrar,
			id_grupo: p.idGrupo ?? null,
			monto: r2(p.monto),
			fecha_cobro: sumarDiasHabiles(p.fechaOrigen),
			estado_cobro: 'programado',
			es_detraccion: true,
			id_cobro_origen: p.idCobroOrigen,
			referencia: referenciaDetraccion(p.nombreOrigen),
			usuario_registro: p.usuario ?? null
		})
		.select('id_cobro')
		.single();
	if (error || !data) return { error: error?.message ?? 'No se pudo crear la cuota de detracción.' };
	return { idCobro: data.id_cobro };
}

/** Actualiza monto y vencimiento de la detracción de una cuota programada al editarla (o la crea/borra si hace falta). */
export async function actualizarDetraccionDe(
	client: SupabaseClient,
	p: { idCuentaCobrar: number; idCobroOrigen: number; idGrupo?: number | null; monto: number; fechaOrigen: string; nombreOrigen?: string | null }
): Promise<string | null> {
	const { data: hija } = await client.from('cobros').select('id_cobro, estado_cobro').eq('id_cobro_origen', p.idCobroOrigen).eq('es_detraccion', true).maybeSingle();
	if (hija && hija.estado_cobro !== 'programado') return null; // ya cobrada: no se toca
	if (!(p.monto > 0)) {
		if (hija) await client.from('cobros').delete().eq('id_cobro', hija.id_cobro);
		return null;
	}
	if (hija) {
		const { error } = await client.from('cobros').update({ monto: r2(p.monto), fecha_cobro: sumarDiasHabiles(p.fechaOrigen) }).eq('id_cobro', hija.id_cobro);
		return error?.message ?? null;
	}
	const r = await crearCuotaDetraccion(client, p);
	return 'error' in r ? r.error : null;
}

/**
 * Tras insertar de una vez cuotas en el orden [cuota, su detracción, cuota, su detracción…] (Nueva venta de
 * Consultoría: createCuentaCobrar con fracciones), marca cada fila cuya referencia empieza por "Detracción" como
 * detracción de la fila anterior (por id_cobro).
 */
export async function vincularDetraccionesPorOrden(client: SupabaseClient, idCuentaCobrar: number): Promise<string | null> {
	const { data, error } = await client.from('cobros').select('id_cobro, referencia, es_detraccion').eq('id_cuenta_cobrar', idCuentaCobrar).order('id_cobro', { ascending: true });
	if (error) return error.message;
	const filas = data ?? [];
	for (let i = 1; i < filas.length; i++) {
		const f = filas[i] as any;
		if (f.es_detraccion || !esReferenciaDetraccion(f.referencia)) continue;
		const { error: e } = await client.from('cobros').update({ es_detraccion: true, id_cobro_origen: (filas[i - 1] as any).id_cobro }).eq('id_cobro', f.id_cobro);
		if (e) return e.message;
	}
	return null;
}

/** Campos de la transacción de la armada que la detracción hereda (el resto se completa aquí). */
const CAMPOS_HEREDADOS = [
	'id_centro_costo_origen', 'id_centro_costo_destino', 'fecha', 'id_nombre', 'tipo_documento', 'num_documento', 'tipo_transaccion',
	'forma_pago', 'tipo', 'medio_pago', 'usuario_registro', 'comprobante_url', 'tipo_alcance', 'categoria', 'tipo_moneda'
] as const;

/**
 * "Ya depositada": la detracción de una armada se cobra en el acto, con su PROPIA transacción pero RELACIONADA a la
 * de la armada (transaccion.id_transaccion_origen): mismos centros de costo, fecha, categoría, comprobante y N.° de
 * cuota que la armada; monto = la detracción; destino = la cuenta de detracciones del Banco de la Nación (si hay una
 * registrada); descripción "Detracción – <armada> (de la transacción #N)". Devuelve un error en texto o null.
 */
export async function cobrarDetraccionConSuArmada(
	client: SupabaseClient,
	p: { idCuentaCobrar: number; idCobroDetraccion: number; idTransaccionArmada: number; monto: number; concepto: string }
): Promise<string | null> {
	const [{ data: armada, error: errArmada }, cuentasBN] = await Promise.all([
		client.from('transaccion').select('*').eq('id_transaccion', p.idTransaccionArmada).single(),
		getCuentasBancoNacionOptions(client).catch(() => [])
	]);
	if (errArmada || !armada) return 'no se encontró la transacción de la armada';
	const payload: Record<string, unknown> = Object.fromEntries(CAMPOS_HEREDADOS.map((k) => [k, (armada as any)[k] ?? null]));
	Object.assign(payload, {
		monto_total: r2(p.monto),
		categoria: 'Detracción',
		estado: 'activo',
		cuente_destino: cuentasBN[0]?.value ?? (armada as any).cuente_destino ?? null,
		descripcion: `${nombreDetraccion(p.concepto)} (de la transacción #${p.idTransaccionArmada})`.slice(0, 250)
	});
	const { data, error } = await client.rpc('fn_confirmar_cobro', {
		p_id_cuenta_cobrar: p.idCuentaCobrar,
		p_transaccion_payload: payload,
		p_id_cobro: p.idCobroDetraccion,
		p_idempotency_key: null
	});
	if (error) return error.message;
	const idTx = (data as any)?.id_transaccion;
	if (idTx) {
		const { error: errVinculo } = await client.from('transaccion').update({ id_transaccion_origen: p.idTransaccionArmada }).eq('id_transaccion', idTx);
		if (errVinculo) return `se registró, pero no quedó relacionada a la armada: ${errVinculo.message}`;
	}
	await client.rpc('fn_recalcular_cuenta_cobrar', { p_id_cuenta_cobrar: p.idCuentaCobrar });
	return null;
}

/**
 * Tras confirmar el cobro de una cuota: si su detracción está marcada "junto con la cuota" y sigue pendiente, se
 * registra cobrada ahora mismo, relacionada a la transacción de la cuota. null = nada que hacer o todo bien.
 */
export async function cobrarDetraccionJuntoSiCorresponde(client: SupabaseClient, idCuentaCobrar: number, idCobroCuota: number, idTransaccionCuota: number | null | undefined): Promise<string | null> {
	if (!idTransaccionCuota) return null;
	const { data: hija } = await client.from('cobros').select('*').eq('id_cobro_origen', idCobroCuota).eq('es_detraccion', true).maybeSingle();
	if (!hija || !(hija as any).detraccion_junto || (hija as any).estado_cobro !== 'programado') return null;
	const concepto = String((hija as any).referencia ?? '').replace(/^detracci[oó]n\s*[–-]\s*/i, '') || 'Cuota';
	return cobrarDetraccionConSuArmada(client, { idCuentaCobrar, idCobroDetraccion: (hija as any).id_cobro, idTransaccionArmada: idTransaccionCuota, monto: Number((hija as any).monto), concepto });
}

/** Fracción de un cronograma (FraccionamientoModal): fecha, monto, concepto. */
export interface FraccionBruta {
	fecha: string;
	monto: number;
	referencia?: string | null;
	/** Su detracción se cobra junto con la cuota (casilla bajo el N.° en la Forma de cobranza). */
	detraccionJunto?: boolean;
}

/**
 * Para los editores de cuotas (Cronograma de Cobranza): las cuotas programadas con su monto BRUTO (cuota + su
 * detracción, que no se muestra aparte) y lo `reservado`: detracciones pendientes de cuotas YA cobradas, que no se
 * pueden reprogramar desde ahí y por eso se descuentan del monto a repartir.
 */
export function cuotasEditables(cobros: any[]): { fracciones: FraccionBruta[]; reservado: number } {
	const porId = new Map(cobros.map((c) => [c.id_cobro, c]));
	const detraccionDe = new Map<number, number>();
	const juntoDe = new Map<number, boolean>();
	let reservado = 0;
	for (const c of cobros) {
		if (!c.es_detraccion || c.estado_cobro !== 'programado') continue;
		const origen = porId.get(c.id_cobro_origen);
		if (origen && origen.estado_cobro === 'programado') {
			detraccionDe.set(origen.id_cobro, Number(c.monto));
			if (c.detraccion_junto) juntoDe.set(origen.id_cobro, true);
		}
		else reservado += Number(c.monto);
	}
	const fracciones = cobros
		.filter((c) => c.estado_cobro === 'programado' && !c.es_detraccion)
		.map((c) => ({
			fecha: c.fecha_cobro,
			monto: r2(Number(c.monto) + (detraccionDe.get(c.id_cobro) ?? 0)),
			referencia: c.referencia ?? null,
			...(juntoDe.get(c.id_cobro) ? { detraccionJunto: true } : {})
		}))
		.sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0));
	return { fracciones, reservado: r2(reservado) };
}

/** Cuotas netas + sus detracciones a partir de fracciones brutas, en el orden [cuota, detracción, …]. */
export function fraccionesConDetraccion(fracciones: FraccionBruta[], porcentaje: number | null, nombre: (f: FraccionBruta, i: number) => string): FraccionBruta[] {
	if (!porcentaje) return fracciones;
	return fracciones.flatMap((f, i) => {
		const { neto, detraccion } = partirDetraccion(f.monto, porcentaje);
		return detraccion > 0
			? [{ ...f, monto: neto, detraccionJunto: false }, { fecha: sumarDiasHabiles(f.fecha), monto: detraccion, referencia: referenciaDetraccion(nombre(f, i)), detraccionJunto: !!f.detraccionJunto }]
			: [f];
	});
}
