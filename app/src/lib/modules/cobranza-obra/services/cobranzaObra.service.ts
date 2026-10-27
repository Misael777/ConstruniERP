/**
 * Cobranza de Obras (Documentacion/PlanFinanzasObras.md). Una venta de Obra tiene UNA Cuenta por Cobrar; sus cuotas
 * (`cobros`) se agrupan en `cobro_grupo`:
 *   - Adelanto 1, 2, …: cada cuota del grupo es una ARMADA (depósito), siempre cobrada, con su transacción.
 *   - Valorización 1, 2, …: monto planificado + N PAGOS (cuotas programadas que se cobran desde el Resumen de cobro).
 * El dinero sigue pasando por fn_confirmar_cobro (crea la transacción y marca la cuota), así que Control Financiero,
 * centros de costo, cuentas bancarias, panoramas y recibos siguen funcionando sin cambios. Solo Obra: Consultoría
 * mantiene su Forma de cobranza.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { construirInsertDataTransaccion } from '$lib/modules/transacciones/services/transacciones.service';
import { translateRpcError } from '$lib/shared/fieldConfig';
import { partirDetraccion } from '$lib/shared/detraccion';
import { crearCuotaDetraccion, actualizarDetraccionDe, getPorcentajeDetraccionCuenta, cobrarDetraccionConSuArmada } from '$lib/modules/cuentas-cobrar/services/detraccion.service';

export type TipoGrupo = 'adelanto' | 'valorizacion';
export type EstadoPago = 'cobrado' | 'pendiente' | 'vencido';

export interface PagoObra {
	id_cobro: number;
	/** Armada: 1, 2… dentro de su adelanto. Pago de valorización: correlativo de TODA la obra (Pago 1…15). */
	numero: number;
	monto: number;
	fecha: string;
	estado: EstadoPago;
	partida: string | null;
	observacion: string | null;
	id_transaccion: number | null;
	comprobante_url: string | null;
	/** Detracción de esta cuota (venta con detracción): su propia cuota, que vence 5 días hábiles después. */
	detraccion?: PagoObra | null;
}

/** Lo cobrado de un pago: la cuota y/o su detracción, cada una si ya está cobrada. */
const cobradoDe = (p: PagoObra) => (p.estado === 'cobrado' ? p.monto : 0) + (p.detraccion?.estado === 'cobrado' ? p.detraccion.monto : 0);

/** Monto bruto de un pago (cuota + su detracción). */
export const montoBruto = (p: PagoObra) => r2(p.monto + (p.detraccion?.monto ?? 0));

export interface GrupoObra {
	id_grupo: number;
	tipo: TipoGrupo;
	numero: number;
	monto_planificado: number | null;
	observaciones: string | null;
	id_documento: number | null;
	pagos: PagoObra[];
	/** Adelanto: suma de armadas. Valorización: su monto planificado. */
	total: number;
	programado: number;
	cobrado: number;
	/** cobrado ÷ total (0–100). */
	avance: number;
	estado: 'pendiente' | 'en_proceso' | 'completada';
}

export interface ResumenCobroObra {
	id_cuenta_cobrar: number;
	id_proyecto: number | null;
	id_cliente: number;
	id_centro_costo: number | null;
	valorVenta: number;
	fechaVenta: string | null;
	adelantos: GrupoObra[];
	valorizaciones: GrupoObra[];
	/** Cuotas de la cuenta sin grupo (cuentas viejas o creadas a mano): se muestran aparte para no perderlas. */
	sinGrupo: PagoObra[];
	totalAdelantos: number;
	totalValorizacionesPlan: number;
	/** Adelantos + pagos de valorización ya definidos (los no definidos no cuentan, ver plan §1). */
	programado: number;
	cobrado: number;
	pctProgramado: number;
	pctCobrado: number;
	/** valorVenta − (adelantos + valorizaciones planificadas): 0 = cuadra. */
	diferenciaPlan: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const pct = (parte: number, total: number) => (total > 0 ? r2((parte / total) * 100) : 0);

export function estadoPago(estadoCobro: string, fecha: string, hoy = new Date().toLocaleDateString('en-CA')): EstadoPago {
	if (estadoCobro === 'cobrado') return 'cobrado';
	return fecha < hoy ? 'vencido' : 'pendiente';
}

/** Concepto de una armada (descripción de la transacción = concepto del recibo, pedido del cliente):
 * "Adelanto" si es un solo adelanto de un solo pago; si no, "Adelanto 2 - Armada 1". */
export function conceptoArmada(numeroAdelanto: number, numeroArmada: number, armadasDelAdelanto: number, hayVariosAdelantos: boolean): string {
	if (!hayVariosAdelantos && armadasDelAdelanto <= 1) return 'Adelanto';
	const base = hayVariosAdelantos || numeroAdelanto > 1 ? `Adelanto ${numeroAdelanto}` : 'Adelanto';
	return armadasDelAdelanto > 1 ? `${base} - Armada ${numeroArmada}` : base;
}

export function conceptoPagoValorizacion(numeroValorizacion: number, numeroPago: number, partida?: string | null): string {
	return `Valorización ${numeroValorizacion} - Pago ${numeroPago}${partida?.trim() ? ` (${partida.trim()})` : ''}`;
}

/** true si la cuenta ya se maneja con grupos (Obra). Las pantallas usan esto para elegir el Resumen de Obra. */
export async function cuentaTieneGrupos(client: SupabaseClient, idCuentaCobrar: number): Promise<boolean> {
	const { count } = await client.from('cobro_grupo').select('id_grupo', { count: 'exact', head: true }).eq('id_cuenta_cobrar', idCuentaCobrar);
	return (count ?? 0) > 0;
}

export async function getResumenCobroObra(client: SupabaseClient, idCuentaCobrar: number): Promise<ResumenCobroObra> {
	const { data: cuenta, error: errCuenta } = await client
		.from('cuentas_cobrar')
		.select('id_cuenta_cobrar, id_proyecto, id_cliente, id_centro_costo, monto, proyecto(precio_venta, fecha_inicio_plan)')
		.eq('id_cuenta_cobrar', idCuentaCobrar)
		.single();
	if (errCuenta || !cuenta) throw errCuenta ?? new Error('Cuenta por cobrar no encontrada');
	const [{ data: grupos, error: errGrupos }, { data: cuotas, error: errCuotas }] = await Promise.all([
		client.from('cobro_grupo').select('*').eq('id_cuenta_cobrar', idCuentaCobrar).order('tipo').order('numero'),
		client
			.from('cobros')
			.select('*, transaccion(comprobante_url)')
			.eq('id_cuenta_cobrar', idCuentaCobrar)
			.neq('estado_cobro', 'cancelado')
			.order('fecha_cobro', { ascending: true })
			.order('id_cobro', { ascending: true })
	]);
	if (errGrupos) throw errGrupos;
	if (errCuotas) throw errCuotas;

	const proyecto = (cuenta as any).proyecto ?? null;
	const valorVenta = Number(proyecto?.precio_venta ?? cuenta.monto) || 0;
	const aPago = (c: any, numero: number): PagoObra => ({
		id_cobro: c.id_cobro,
		numero,
		monto: Number(c.monto),
		fecha: c.fecha_cobro,
		estado: estadoPago(c.estado_cobro, c.fecha_cobro),
		partida: c.partida ?? null,
		observacion: c.referencia ?? null,
		id_transaccion: c.id_transaccion ?? null,
		comprobante_url: c.transaccion?.comprobante_url ?? null
	});

	// Las detracciones van colgadas de su cuota (no son una armada ni un pago más).
	const idsCuotas = new Set((cuotas ?? []).map((c: any) => c.id_cobro));
	const esHija = (c: any) => !!c.es_detraccion && idsCuotas.has(c.id_cobro_origen);
	const detraccionDe = new Map<number, any>();
	for (const c of cuotas ?? []) if (esHija(c)) detraccionDe.set((c as any).id_cobro_origen, c);
	const conDetraccion = (p: PagoObra): PagoObra => {
		const d = detraccionDe.get(p.id_cobro);
		return { ...p, detraccion: d ? aPago(d, p.numero) : null };
	};
	const porGrupo = new Map<number, any[]>();
	const sinGrupoCrudo: any[] = [];
	for (const c of (cuotas ?? []).filter((c: any) => !esHija(c))) {
		if (c.id_grupo) porGrupo.set(c.id_grupo, [...(porGrupo.get(c.id_grupo) ?? []), c]);
		else sinGrupoCrudo.push(c);
	}

	let correlativoPago = 0;
	const armar = (g: any): GrupoObra => {
		const crudas = porGrupo.get(g.id_grupo) ?? [];
		const pagos = crudas.map((c, i) => conDetraccion(aPago(c, g.tipo === 'valorizacion' ? 0 : i + 1)));
		// Con detracción, cada pago cuenta por su monto bruto (cuota + detracción) y lo cobrado suma cada parte cobrada.
		const programado = r2(pagos.reduce((s, p) => s + montoBruto(p), 0));
		const cobrado = r2(pagos.reduce((s, p) => s + cobradoDe(p), 0));
		const total = g.tipo === 'adelanto' ? programado : Number(g.monto_planificado ?? programado);
		const avance = pct(cobrado, total);
		return {
			id_grupo: g.id_grupo,
			tipo: g.tipo,
			numero: g.numero,
			monto_planificado: g.monto_planificado != null ? Number(g.monto_planificado) : null,
			observaciones: g.observaciones ?? null,
			id_documento: g.id_documento ?? null,
			pagos,
			total,
			programado,
			cobrado,
			avance,
			estado: total > 0 && cobrado >= total - 0.005 ? 'completada' : cobrado > 0 ? 'en_proceso' : 'pendiente'
		};
	};
	const adelantos = (grupos ?? []).filter((g: any) => g.tipo === 'adelanto').map(armar);
	const valorizaciones = (grupos ?? []).filter((g: any) => g.tipo === 'valorizacion').map(armar);
	// "Pago 1, 2, 3…" correlativo en toda la obra, en orden de valorización y luego de fecha.
	for (const v of valorizaciones) for (const p of v.pagos) p.numero = ++correlativoPago;

	const totalAdelantos = r2(adelantos.reduce((s, g) => s + g.total, 0));
	const totalValorizacionesPlan = r2(valorizaciones.reduce((s, g) => s + g.total, 0));
	const sinGrupo = sinGrupoCrudo.map((c, i) => conDetraccion(aPago(c, i + 1)));
	const programado = r2(totalAdelantos + valorizaciones.reduce((s, g) => s + g.programado, 0) + sinGrupo.reduce((s, p) => s + montoBruto(p), 0));
	const cobrado = r2(adelantos.reduce((s, g) => s + g.cobrado, 0) + valorizaciones.reduce((s, g) => s + g.cobrado, 0) + sinGrupo.reduce((s, p) => s + cobradoDe(p), 0));
	return {
		id_cuenta_cobrar: cuenta.id_cuenta_cobrar,
		id_proyecto: cuenta.id_proyecto,
		id_cliente: cuenta.id_cliente,
		id_centro_costo: cuenta.id_centro_costo,
		valorVenta,
		fechaVenta: proyecto?.fecha_inicio_plan ?? null,
		adelantos,
		valorizaciones,
		sinGrupo,
		totalAdelantos,
		totalValorizacionesPlan,
		programado,
		cobrado,
		pctProgramado: pct(programado, valorVenta),
		pctCobrado: pct(cobrado, valorVenta),
		diferenciaPlan: r2(valorVenta - totalAdelantos - totalValorizacionesPlan)
	};
}

async function siguienteNumero(client: SupabaseClient, idCuentaCobrar: number, tipo: TipoGrupo): Promise<number> {
	const { data } = await client.from('cobro_grupo').select('numero').eq('id_cuenta_cobrar', idCuentaCobrar).eq('tipo', tipo).order('numero', { ascending: false }).limit(1);
	return (data?.[0]?.numero ?? 0) + 1;
}

export async function crearGrupo(
	client: SupabaseClient,
	idCuentaCobrar: number,
	tipo: TipoGrupo,
	extra: { monto_planificado?: number | null; observaciones?: string | null; id_documento?: number | null; usuario?: string | null } = {}
): Promise<{ id_grupo: number; numero: number }> {
	// Reintento si otro usuario tomó el mismo número al mismo tiempo (UNIQUE id_cuenta_cobrar+tipo+numero).
	for (let intento = 0; intento < 3; intento++) {
		const numero = await siguienteNumero(client, idCuentaCobrar, tipo);
		const { data, error } = await client
			.from('cobro_grupo')
			.insert({
				id_cuenta_cobrar: idCuentaCobrar,
				tipo,
				numero,
				monto_planificado: tipo === 'valorizacion' ? r2(Number(extra.monto_planificado ?? 0)) : null,
				observaciones: extra.observaciones?.trim() || null,
				id_documento: extra.id_documento ?? null,
				usuario_registro: extra.usuario ?? null
			})
			.select('id_grupo, numero')
			.single();
		if (!error && data) return data as { id_grupo: number; numero: number };
		if (error?.code !== '23505') throw error;
	}
	throw new Error('No se pudo numerar el grupo de cobro; vuelve a intentarlo.');
}

export interface ArmadaParaRegistrar {
	monto: number;
	fecha: string;
	comprobanteUrl: string;
	observacion?: string | null;
	/** Venta con detracción: true = la detracción de esta armada ya se depositó (se registra cobrada con ella). */
	detraccionCobrada?: boolean;
}

/**
 * Registra armadas de un adelanto: crea el grupo si `idGrupo` no viene (Adelanto N nuevo) y, por cada armada,
 * llama a fn_confirmar_cobro SIN cuota previa — crea la transacción (ingreso, categoría Adelanto) y la cuota
 * cobrada dentro del grupo, en un solo paso. Devuelve las transacciones creadas, en orden.
 */
export async function registrarArmadas(
	client: SupabaseClient,
	p: {
		idCuentaCobrar: number;
		idGrupo?: number | null;
		idDocumento?: number | null;
		idCentroCliente: number;
		idCentroProyecto: number;
		armadas: ArmadaParaRegistrar[];
		usuarioEmail: string | null;
		usuarioNombre: string | null;
		/** % de detracción de la venta (null = sin detracción): cada armada se registra por su neto + su detracción. */
		detraccionPct?: number | null;
	}
): Promise<{ success: true; idGrupo: number; numeroAdelanto: number; transacciones: number[] } | { success: false; message: string }> {
	if (p.armadas.length === 0) return { success: false, message: 'No hay armadas para registrar.' };
	try {
		let idGrupo = p.idGrupo ?? null;
		let numeroAdelanto: number;
		if (idGrupo) {
			const { data: g, error } = await client.from('cobro_grupo').select('numero, tipo').eq('id_grupo', idGrupo).single();
			if (error || !g || g.tipo !== 'adelanto') return { success: false, message: 'El adelanto elegido no existe.' };
			numeroAdelanto = g.numero;
		} else {
			const nuevo = await crearGrupo(client, p.idCuentaCobrar, 'adelanto', { id_documento: p.idDocumento ?? null, usuario: p.usuarioNombre });
			idGrupo = nuevo.id_grupo;
			numeroAdelanto = nuevo.numero;
		}
		const [{ count: previas }, { count: adelantos }] = await Promise.all([
			client.from('cobros').select('id_cobro', { count: 'exact', head: true }).eq('id_grupo', idGrupo),
			client.from('cobro_grupo').select('id_grupo', { count: 'exact', head: true }).eq('id_cuenta_cobrar', p.idCuentaCobrar).eq('tipo', 'adelanto')
		]);
		const totalArmadas = (previas ?? 0) + p.armadas.length;
		const variosAdelantos = (adelantos ?? 1) > 1;

		const transacciones: number[] = [];
		for (const [i, a] of p.armadas.entries()) {
			const numeroArmada = (previas ?? 0) + i + 1;
			const concepto = conceptoArmada(numeroAdelanto, numeroArmada, totalArmadas, variosAdelantos);
			// Detracción: la armada (monto bruto) entra por su neto; la detracción es su propia cuota (ver abajo).
			const { neto, detraccion } = partirDetraccion(a.monto, p.detraccionPct);
			const built = construirInsertDataTransaccion(
				{
					tipo_alcance: 'externa',
					id_centro_costo_origen: p.idCentroCliente,
					id_centro_costo_destino: p.idCentroProyecto,
					fecha: a.fecha,
					monto_total: neto,
					tipo: 'ingreso',
					tipo_moneda: 'soles',
					categoria: 'Adelanto',
					tipo_transaccion: '1', // N° de cuota: el adelanto (ver acuerdoDePago.ts)
					estado: 'activo',
					comprobante_url: a.comprobanteUrl,
					descripcion: `${concepto}${a.observacion?.trim() ? ` - ${a.observacion.trim()}` : ''}`
				},
				p.usuarioEmail,
				p.usuarioNombre
			);
			if ('errors' in built) return { success: false, message: `Revisa la ${numeroArmada}.ª armada: ${Object.values(built.errors).join('; ')}` };
			const { data, error } = await client.rpc('fn_confirmar_cobro', {
				p_id_cuenta_cobrar: p.idCuentaCobrar,
				p_transaccion_payload: built.insertData,
				p_id_cobro: null,
				p_cobro_payload: { monto: neto, fecha_cobro: a.fecha, id_grupo: idGrupo, referencia: a.observacion?.trim()?.slice(0, 100) || null, usuario_registro: p.usuarioNombre },
				p_idempotency_key: null
			});
			if (error) {
				const ya = i > 0 ? ` Ya se registraron ${i} de ${p.armadas.length} armadas.` : '';
				const texto = /MONTO_EXCEDE_COMPROMETIDO/.test(`${error.hint ?? ''} ${error.message}`)
					? 'Lo ya cobrado y programado cubre el valor de la venta: ajusta el valor (adenda) o reduce un pago pendiente de valorización.'
					: translateRpcError(error, []);
				return { success: false, message: `No se pudo registrar la ${numeroArmada}.ª armada: ${texto}${ya}` };
			}
			transacciones.push((data as any).id_transaccion);
			if (detraccion > 0) {
				const errDet = await registrarDetraccionArmada(client, {
					idCuentaCobrar: p.idCuentaCobrar,
					idGrupo: idGrupo!,
					idTransaccionArmada: (data as any).id_transaccion,
					monto: detraccion,
					fecha: a.fecha,
					concepto,
					cobrada: !!a.detraccionCobrada,
					transaccionBase: built.insertData,
					usuarioNombre: p.usuarioNombre
				});
				if (errDet) return { success: false, message: `La ${numeroArmada}.ª armada se registró, pero no su detracción: ${errDet}` };
			}
		}
		return { success: true, idGrupo: idGrupo!, numeroAdelanto, transacciones };
	} catch (err: any) {
		return { success: false, message: err?.message ?? String(err) };
	}
}

/** Cuota de detracción de una armada recién registrada: pendiente (vence 5 días hábiles después) o, si ya se depositó,
 * cobrada en el acto con su propia transacción (mismo comprobante, concepto "Detracción – …"). */
async function registrarDetraccionArmada(
	client: SupabaseClient,
	d: {
		idCuentaCobrar: number;
		idGrupo: number;
		idTransaccionArmada: number;
		monto: number;
		fecha: string;
		concepto: string;
		cobrada: boolean;
		transaccionBase: Record<string, unknown>;
		usuarioNombre: string | null;
	}
): Promise<string | null> {
	const { data: cuota } = await client.from('cobros').select('id_cobro').eq('id_transaccion', d.idTransaccionArmada).maybeSingle();
	if (!cuota) return 'no se encontró la cuota de la armada';
	const creada = await crearCuotaDetraccion(client, {
		idCuentaCobrar: d.idCuentaCobrar,
		idCobroOrigen: cuota.id_cobro,
		idGrupo: d.idGrupo,
		monto: d.monto,
		fechaOrigen: d.fecha,
		nombreOrigen: d.concepto,
		usuario: d.usuarioNombre
	});
	if ('error' in creada) return creada.error;
	if (d.cobrada) {
		const error = await cobrarDetraccionConSuArmada(client, {
			idCuentaCobrar: d.idCuentaCobrar,
			idCobroDetraccion: creada.idCobro,
			idTransaccionArmada: d.idTransaccionArmada,
			monto: d.monto,
			concepto: d.concepto
		});
		if (error) return `quedó pendiente (no se pudo marcar cobrada: ${error})`;
	}
	await client.rpc('fn_recalcular_cuenta_cobrar', { p_id_cuenta_cobrar: d.idCuentaCobrar });
	return null;
}

/** Lo comprometido (cuotas no canceladas) frente al monto de la cuenta — para no programar más que el valor de venta. */
async function disponibleEnCuenta(client: SupabaseClient, idCuentaCobrar: number, excluirCobro?: number): Promise<number> {
	const [{ data: cuenta }, { data: cuotas }] = await Promise.all([
		client.from('cuentas_cobrar').select('monto').eq('id_cuenta_cobrar', idCuentaCobrar).single(),
		client.from('cobros').select('*').eq('id_cuenta_cobrar', idCuentaCobrar).neq('estado_cobro', 'cancelado')
	]);
	const comprometido = (cuotas ?? [])
		.filter((c: any) => excluirCobro == null || (c.id_cobro !== excluirCobro && c.id_cobro_origen !== excluirCobro))
		.reduce((s: number, c: any) => s + Number(c.monto), 0);
	return r2(Number(cuenta?.monto ?? 0) - comprometido);
}

export async function crearValorizacion(client: SupabaseClient, idCuentaCobrar: number, montoPlanificado: number, observaciones: string | null, usuario: string | null) {
	if (!(montoPlanificado > 0)) return { success: false as const, message: 'El monto de la valorización debe ser mayor a 0.' };
	try {
		const g = await crearGrupo(client, idCuentaCobrar, 'valorizacion', { monto_planificado: montoPlanificado, observaciones, usuario });
		return { success: true as const, ...g };
	} catch (err: any) {
		return { success: false as const, message: err?.message ?? String(err) };
	}
}

export async function actualizarValorizacion(client: SupabaseClient, idGrupo: number, montoPlanificado: number, observaciones: string | null) {
	if (!(montoPlanificado > 0)) return { success: false as const, message: 'El monto de la valorización debe ser mayor a 0.' };
	const { data: pagos } = await client.from('cobros').select('monto').eq('id_grupo', idGrupo).neq('estado_cobro', 'cancelado');
	const suma = r2((pagos ?? []).reduce((s: number, c: any) => s + Number(c.monto), 0));
	if (montoPlanificado + 0.005 < suma) return { success: false as const, message: `Sus pagos ya suman S/ ${suma.toFixed(2)}: el monto no puede ser menor.` };
	const { error } = await client.from('cobro_grupo').update({ monto_planificado: r2(montoPlanificado), observaciones: observaciones?.trim() || null }).eq('id_grupo', idGrupo).eq('tipo', 'valorizacion');
	return error ? { success: false as const, message: error.message } : { success: true as const };
}

/** Solo si no tiene pagos cobrados: borra sus pagos pendientes y la valorización. */
export async function eliminarValorizacion(client: SupabaseClient, idGrupo: number) {
	const { data: pagos } = await client.from('cobros').select('id_cobro, estado_cobro').eq('id_grupo', idGrupo);
	if ((pagos ?? []).some((c: any) => c.estado_cobro === 'cobrado')) return { success: false as const, message: 'Tiene pagos cobrados: no se puede eliminar.' };
	const { data: g } = await client.from('cobro_grupo').select('id_cuenta_cobrar, tipo').eq('id_grupo', idGrupo).single();
	if (!g || g.tipo !== 'valorizacion') return { success: false as const, message: 'Valorización no encontrada.' };
	const { error: e1 } = await client.from('cobros').delete().eq('id_grupo', idGrupo).eq('estado_cobro', 'programado');
	if (e1) return { success: false as const, message: e1.message };
	const { error: e2 } = await client.from('cobro_grupo').delete().eq('id_grupo', idGrupo);
	if (e2) return { success: false as const, message: e2.message };
	await client.rpc('fn_recalcular_cuenta_cobrar', { p_id_cuenta_cobrar: g.id_cuenta_cobrar });
	return { success: true as const };
}

async function validarPago(client: SupabaseClient, idGrupo: number, monto: number, excluirCobro?: number) {
	if (!(monto > 0)) return { error: 'El monto del pago debe ser mayor a 0.' };
	const { data: g } = await client.from('cobro_grupo').select('id_cuenta_cobrar, tipo, numero, monto_planificado').eq('id_grupo', idGrupo).single();
	if (!g || g.tipo !== 'valorizacion') return { error: 'Valorización no encontrada.' };
	const { data: pagos } = await client.from('cobros').select('*').eq('id_grupo', idGrupo).neq('estado_cobro', 'cancelado');
	// El pago editado y su detracción no cuentan (el monto nuevo es el bruto: pago + detracción).
	const fuera = (c: any) => excluirCobro != null && (c.id_cobro === excluirCobro || c.id_cobro_origen === excluirCobro);
	const suma = r2((pagos ?? []).filter((c: any) => !fuera(c)).reduce((s: number, c: any) => s + Number(c.monto), 0));
	if (suma + monto - Number(g.monto_planificado ?? 0) > 0.005) {
		return { error: `La Valorización ${g.numero} es de S/ ${Number(g.monto_planificado).toFixed(2)} y sus pagos ya suman S/ ${suma.toFixed(2)}: este pago la supera.` };
	}
	const disponible = await disponibleEnCuenta(client, g.id_cuenta_cobrar, excluirCobro);
	if (monto - disponible > 0.005) return { error: `Lo programado superaría el valor de la venta (disponible S/ ${disponible.toFixed(2)}).` };
	return { grupo: g };
}

export async function agregarPago(client: SupabaseClient, idGrupo: number, p: { monto: number; fecha: string; partida?: string | null }, usuario: string | null) {
	const v = await validarPago(client, idGrupo, p.monto);
	if ('error' in v) return { success: false as const, message: v.error! };
	if (!p.fecha) return { success: false as const, message: 'Indica la fecha estimada del pago.' };
	// Detracción: el monto ingresado es el bruto; el pago queda por su neto y su detracción es otra cuota.
	const pct = await getPorcentajeDetraccionCuenta(client, v.grupo.id_cuenta_cobrar);
	const { neto, detraccion } = partirDetraccion(p.monto, pct);
	const { data: nuevo, error } = await client
		.from('cobros')
		.insert({
			id_cuenta_cobrar: v.grupo.id_cuenta_cobrar,
			id_grupo: idGrupo,
			monto: neto,
			fecha_cobro: p.fecha,
			partida: p.partida?.trim()?.slice(0, 200) || null,
			estado_cobro: 'programado',
			usuario_registro: usuario
		})
		.select('id_cobro')
		.single();
	if (error) return { success: false as const, message: error.message };
	if (detraccion > 0 && nuevo) {
		const d = await crearCuotaDetraccion(client, {
			idCuentaCobrar: v.grupo.id_cuenta_cobrar,
			idCobroOrigen: nuevo.id_cobro,
			idGrupo,
			monto: detraccion,
			fechaOrigen: p.fecha,
			nombreOrigen: `Valorización ${v.grupo.numero}${p.partida?.trim() ? ` (${p.partida.trim()})` : ''}`,
			usuario
		});
		if ('error' in d) return { success: false as const, message: `Se agregó el pago, pero no su detracción: ${d.error}` };
	}
	await client.rpc('fn_recalcular_cuenta_cobrar', { p_id_cuenta_cobrar: v.grupo.id_cuenta_cobrar });
	return { success: true as const };
}

/** Solo pagos pendientes (programados): uno cobrado se corrige desde su transacción. */
export async function editarPago(client: SupabaseClient, idCobro: number, p: { monto: number; fecha: string; partida?: string | null }) {
	const { data: c } = await client.from('cobros').select('id_grupo, estado_cobro, id_cuenta_cobrar').eq('id_cobro', idCobro).single();
	if (!c?.id_grupo) return { success: false as const, message: 'Pago no encontrado.' };
	if (c.estado_cobro !== 'programado') return { success: false as const, message: 'El pago ya está cobrado: corrígelo desde su transacción.' };
	const v = await validarPago(client, c.id_grupo, p.monto, idCobro);
	if ('error' in v) return { success: false as const, message: v.error! };
	const pct = await getPorcentajeDetraccionCuenta(client, c.id_cuenta_cobrar);
	const { neto, detraccion } = partirDetraccion(p.monto, pct);
	const { error } = await client.from('cobros').update({ monto: neto, fecha_cobro: p.fecha, partida: p.partida?.trim()?.slice(0, 200) || null }).eq('id_cobro', idCobro);
	if (error) return { success: false as const, message: error.message };
	const errDet = await actualizarDetraccionDe(client, {
		idCuentaCobrar: c.id_cuenta_cobrar,
		idCobroOrigen: idCobro,
		idGrupo: c.id_grupo,
		monto: detraccion,
		fechaOrigen: p.fecha,
		nombreOrigen: `Valorización ${v.grupo.numero}${p.partida?.trim() ? ` (${p.partida.trim()})` : ''}`
	});
	if (errDet) return { success: false as const, message: `Se actualizó el pago, pero no su detracción: ${errDet}` };
	await client.rpc('fn_recalcular_cuenta_cobrar', { p_id_cuenta_cobrar: c.id_cuenta_cobrar });
	return { success: true as const };
}

export async function eliminarPago(client: SupabaseClient, idCobro: number) {
	const { data: c } = await client.from('cobros').select('estado_cobro, id_cuenta_cobrar, id_grupo').eq('id_cobro', idCobro).single();
	if (!c) return { success: false as const, message: 'Pago no encontrado.' };
	if (c.estado_cobro !== 'programado') return { success: false as const, message: 'El pago ya está cobrado: no se puede eliminar (anula su transacción si fue un error).' };
	const { error } = await client.from('cobros').delete().eq('id_cobro', idCobro);
	if (error) return { success: false as const, message: error.message };
	await client.rpc('fn_recalcular_cuenta_cobrar', { p_id_cuenta_cobrar: c.id_cuenta_cobrar });
	return { success: true as const };
}

/**
 * Cuenta por Cobrar de una venta de Obra (si no existe, la crea por el valor de venta, SIN cuotas: las armadas y los
 * pagos se agregan como grupos). Si ya entraron adelantos al centro de costo del proyecto que no son cuota de nadie
 * (registrados antes del modelo de grupos), quedan como armadas del Adelanto 1.
 */
export async function asegurarCuentaObra(
	client: SupabaseClient,
	v: { idProyecto: number; idCliente: number; idCentroCosto: number; montoVenta: number; fechaVenta: string; responsable: string | null; proyectoNombre: string },
	usuarioRegistro: string | null
): Promise<{ idCuentaCobrar: number } | { error: string }> {
	const { data: existente } = await client.from('cuentas_cobrar').select('id_cuenta_cobrar').eq('id_proyecto', v.idProyecto).eq('activo', true).limit(1).maybeSingle();
	let idCuenta = existente?.id_cuenta_cobrar as number | undefined;
	if (!idCuenta) {
		const { data, error } = await client
			.from('cuentas_cobrar')
			.insert({
				id_cliente: v.idCliente,
				id_proyecto: v.idProyecto,
				id_centro_costo: v.idCentroCosto,
				monto: r2(v.montoVenta),
				monto_cobrado: 0,
				saldo_pendiente: r2(v.montoVenta),
				forma_pago: 3,
				responsable: v.responsable,
				fecha_emision: v.fechaVenta,
				fecha_vencimiento: null,
				moneda: 'PEN',
				observaciones: `Cuenta por cobrar de la venta ${v.proyectoNombre}`.slice(0, 200),
				estado: 'pendiente',
				usuario_registro: usuarioRegistro
			})
			.select('id_cuenta_cobrar')
			.single();
		if (error || !data) return { error: error?.message ?? 'No se pudo crear la Cuenta por Cobrar.' };
		idCuenta = data.id_cuenta_cobrar;
	}

	// Adelantos sueltos (transacciones de categoría Adelanto al centro del proyecto que no son cuota de ninguna cuenta).
	const { data: tx } = await client
		.from('transaccion')
		.select('id_transaccion, fecha, monto_total, monto_convertido, tipo_moneda')
		.eq('id_centro_costo_destino', v.idCentroCosto)
		.eq('tipo', 'ingreso')
		.eq('estado', 'activo')
		.eq('categoria', 'Adelanto')
		.order('fecha', { ascending: true });
	const ids = (tx ?? []).map((t: any) => t.id_transaccion);
	const { data: usados } = ids.length ? await client.from('cobros').select('id_transaccion').in('id_transaccion', ids) : { data: [] as any[] };
	const usadosSet = new Set((usados ?? []).map((c: any) => c.id_transaccion));
	const sueltas = (tx ?? []).filter((t: any) => !usadosSet.has(t.id_transaccion));
	if (sueltas.length > 0) {
		const { data: g1 } = await client.from('cobro_grupo').select('id_grupo').eq('id_cuenta_cobrar', idCuenta).eq('tipo', 'adelanto').eq('numero', 1).maybeSingle();
		const idGrupo = g1?.id_grupo ?? (await crearGrupo(client, idCuenta!, 'adelanto', { usuario: usuarioRegistro })).id_grupo;
		const { error } = await client.from('cobros').insert(
			sueltas.map((t: any) => ({
				id_cuenta_cobrar: idCuenta,
				id_grupo: idGrupo,
				monto: r2(t.tipo_moneda === 'dolares' && t.monto_convertido != null ? Number(t.monto_convertido) : Number(t.monto_total)),
				fecha_cobro: t.fecha,
				estado_cobro: 'cobrado',
				id_transaccion: t.id_transaccion,
				usuario_registro: usuarioRegistro
			}))
		);
		if (error) return { error: error.message };
	}
	await client.rpc('fn_recalcular_cuenta_cobrar', { p_id_cuenta_cobrar: idCuenta });
	return { idCuentaCobrar: idCuenta! };
}
