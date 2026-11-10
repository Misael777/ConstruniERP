/**
 * Motor de chequeos de Consistencia — Control Financiero (ver control_financiero_migration.sql).
 * Cada chequeo es independiente y extensible por diseño: `CHEQUEOS` es un array de
 * `{id, label, run}` — agregar uno nuevo es una entrada más en el array, nada más cambia.
 * `ejecutarRevision()` corre todos (cada uno con su propio try/catch — si el chequeo mismo falla,
 * cuenta como 'error' en vez de tumbar toda la revisión) y persiste el resultado en
 * `revision_financiera`; el tab Dashboard lee esa última fila (getUltimaRevision) en vez de
 * recomputar los 6 chequeos en cada visita — solo "Ejecutar revisión"/"Ejecutar ahora" los corre de
 * verdad. 100% client-side (Supabase anon key), igual que el resto del ERP: no hay agregación SQL
 * arbitraria disponible (PostgREST), así que cada chequeo trae lo necesario en pocas queries y
 * evalúa en JS — mismo criterio que dashboardFinanzas.service.ts.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { getSaldosDetalleCentrosCosto, getSaldosDetalleCuentasBancarias } from './conciliacion.service';

export type EstadoCheck = 'ok' | 'alerta' | 'error';

export interface ResultadoCheck {
	estado: EstadoCheck;
	mensaje: string;
	detalle?: unknown;
}

export interface ResultadoChequeoConId extends ResultadoCheck {
	id: string;
	label: string;
}

export interface ChequeoConsistencia {
	id: string;
	label: string;
	run: (client: SupabaseClient) => Promise<ResultadoCheck>;
}

const TIPOS_VALIDOS = new Set(['ingreso', 'egreso', 'financiamiento', 'transferencia']);

async function checkIntegridadTransacciones(client: SupabaseClient): Promise<ResultadoCheck> {
	const { data, error } = await client
		.from('transaccion')
		.select('id_transaccion, monto_total, tipo, id_centro_costo_origen, id_centro_costo_destino')
		.eq('estado', 'activo');
	if (error) throw error;

	const evaluadas = data ?? [];
	const rotas = evaluadas.filter(
		(t: any) =>
			!(Number(t.monto_total) > 0) ||
			!TIPOS_VALIDOS.has(t.tipo) ||
			(t.id_centro_costo_origen !== null && t.id_centro_costo_origen === t.id_centro_costo_destino)
	);
	const detalle = { total_evaluadas: evaluadas.length, filas: rotas };
	if (rotas.length === 0) return { estado: 'ok', mensaje: 'Todas las transacciones activas tienen monto, tipo y centros de costo válidos.', detalle };
	return {
		estado: 'error',
		mensaje: `${rotas.length} transacción(es) con monto ≤ 0, tipo inválido, o mismo centro de costo como origen y destino.`,
		detalle
	};
}

async function checkIntegridadMovimientos(client: SupabaseClient): Promise<ResultadoCheck> {
	const [{ data: pagos, error: errPagos }, { data: cobros, error: errCobros }] = await Promise.all([
		client.from('pagos').select('id_pago, id_transaccion, transaccion:id_transaccion(estado)').not('id_transaccion', 'is', null).eq('estado_pago', 'pagado'),
		client.from('cobros').select('id_cobro, id_transaccion, transaccion:id_transaccion(estado)').not('id_transaccion', 'is', null).eq('estado_cobro', 'cobrado')
	]);
	if (errPagos) throw errPagos;
	if (errCobros) throw errCobros;

	const pagosHuerfanos = (pagos ?? []).filter((p: any) => !p.transaccion || p.transaccion.estado !== 'activo');
	const cobrosHuerfanos = (cobros ?? []).filter((c: any) => !c.transaccion || c.transaccion.estado !== 'activo');
	const total = pagosHuerfanos.length + cobrosHuerfanos.length;
	const detalle = {
		total_pagos_confirmados: (pagos ?? []).length,
		total_cobros_confirmados: (cobros ?? []).length,
		pagos_huerfanos: pagosHuerfanos.map((p: any) => p.id_pago),
		cobros_huerfanos: cobrosHuerfanos.map((c: any) => c.id_cobro)
	};
	if (total === 0) return { estado: 'ok', mensaje: 'Todo pago/cobro confirmado tiene una transacción de respaldo activa.', detalle };
	return {
		estado: 'error',
		mensaje: `${pagosHuerfanos.length} pago(s) y ${cobrosHuerfanos.length} cobro(s) confirmados sin una transacción de respaldo activa (huérfana o anulada).`,
		detalle
	};
}

/** Saldo guardado vs saldo calculado por la base con la MISMA fórmula que lo mantiene (última Apertura + transacciones
 * activas posteriores; sin Apertura, saldo inicial + todas) — fn_verificar_saldos_bancarios, migración
 * 20261107120000_saldo_bancario_blindado.sql. También avisa si falta el trigger que recalcula el saldo al crear, borrar
 * o cambiar transacciones (su ausencia en Producción causó el reclamo del 07/11/2026: transacciones eliminadas cuyo
 * dinero seguía en Caja Fuerte). Si esa función todavía no existe, usa el cálculo anterior (sin aperturas). */
async function checkConsistenciaSaldos(client: SupabaseClient): Promise<ResultadoCheck> {
	const { data: verif, error: errVerif } = await client.rpc('fn_verificar_saldos_bancarios');
	if (!errVerif && verif) {
		const filas = ((verif.cuentas ?? []) as any[]).map((c) => ({
			numero_cuenta: c.numero_cuenta,
			saldo_actual: Number(c.saldo_actual),
			saldo_calculado: Number(c.saldo_calculado),
			diferencia: Number(c.diferencia),
			apertura: c.apertura ? `${Number(c.apertura.monto).toFixed(2)} al ${c.apertura.fecha_corte}` : '—',
			saldo_inicial: Number(c.saldo_inicial)
		}));
		const conDiferencia = filas.filter((c) => Math.abs(c.diferencia) > 0.01);
		const detalle = { filas };
		if (!verif.triggers_ok) {
			return {
				estado: 'error',
				mensaje: 'Falta el recálculo automático de saldos bancarios en la base de datos: al eliminar o cambiar transacciones los saldos pueden quedar desactualizados. Aplica la migración 20261107120000_saldo_bancario_blindado.sql.',
				detalle
			};
		}
		if (conDiferencia.length === 0) return { estado: 'ok', mensaje: 'El saldo de todas las cuentas bancarias activas coincide con sus transacciones y aperturas.', detalle };
		return {
			estado: 'error',
			mensaje: `${conDiferencia.length} cuenta(s) bancaria(s) con saldo distinto al calculado con sus transacciones y aperturas.`,
			detalle
		};
	}

	const [{ data: cuentas, error: errCuentas }, { data: movimientos, error: errMov }] = await Promise.all([
		client.from('cuenta_banco').select('id_cuenta_banco, numero_cuenta, saldo_inicial, saldo_actual').eq('activo', true),
		client.from('transaccion').select('cuente_origen, cuente_destino, monto_total').eq('estado', 'activo')
	]);
	if (errCuentas) throw errCuentas;
	if (errMov) throw errMov;

	const neto = new Map<string, number>();
	for (const m of (movimientos ?? []) as any[]) {
		const monto = Number(m.monto_total);
		if (m.cuente_origen) neto.set(m.cuente_origen, (neto.get(m.cuente_origen) ?? 0) - monto);
		if (m.cuente_destino) neto.set(m.cuente_destino, (neto.get(m.cuente_destino) ?? 0) + monto);
	}

	const comparacion = (cuentas ?? []).map((c: any) => {
		const recomputado = Number(c.saldo_inicial) + (neto.get(c.numero_cuenta) ?? 0);
		const drift = Number((Number(c.saldo_actual) - recomputado).toFixed(2));
		return { numero_cuenta: c.numero_cuenta, saldo_inicial: Number(c.saldo_inicial), saldo_actual: Number(c.saldo_actual), recomputado, drift };
	});
	const conDrift = comparacion.filter((c) => Math.abs(c.drift) > 0.01);
	const detalle = { filas: comparacion };

	if (conDrift.length === 0) return { estado: 'ok', mensaje: 'saldo_actual de todas las cuentas bancarias activas coincide con el recálculo en vivo.', detalle };
	return {
		estado: 'error',
		mensaje: `${conDrift.length} cuenta(s) bancaria(s) con saldo_actual desactualizado frente al recálculo en vivo — posible drift histórico previo a los RPC atómicos.`,
		detalle
	};
}

async function checkPosiblesDuplicados(client: SupabaseClient): Promise<ResultadoCheck> {
	const { data, error } = await client
		.from('transaccion')
		.select('id_transaccion, fecha, monto_total, id_centro_costo_origen, id_centro_costo_destino, tipo')
		.eq('estado', 'activo');
	if (error) throw error;

	const grupos = new Map<string, number[]>();
	for (const t of (data ?? []) as any[]) {
		const clave = `${t.fecha}|${t.monto_total}|${t.id_centro_costo_origen}|${t.id_centro_costo_destino}|${t.tipo}`;
		const lista = grupos.get(clave) ?? [];
		lista.push(t.id_transaccion);
		grupos.set(clave, lista);
	}
	const duplicados = [...grupos.values()].filter((ids) => ids.length > 1);
	const detalle = { total_evaluadas: (data ?? []).length, grupos_duplicados: duplicados };
	if (duplicados.length === 0) return { estado: 'ok', mensaje: 'Sin transacciones con la misma fecha/monto/centros de costo/tipo repetidos.', detalle };
	return {
		estado: 'alerta',
		mensaje: `${duplicados.length} grupo(s) de transacciones potencialmente duplicadas (mismo día, monto, centros de costo y tipo) — revisar, no necesariamente un error.`,
		detalle
	};
}

async function checkConsistenciaCentrosCosto(client: SupabaseClient): Promise<ResultadoCheck> {
	const [{ data: centros, error: errCentros }, { data: transacciones, error: errTrans }] = await Promise.all([
		client.from('centro_costo').select('id_centro_costo, estado'),
		client.from('transaccion').select('id_transaccion, id_centro_costo_origen, id_centro_costo_destino').eq('estado', 'activo')
	]);
	if (errCentros) throw errCentros;
	if (errTrans) throw errTrans;

	const idsExistentes = new Set((centros ?? []).map((c: any) => c.id_centro_costo));
	const idsBaja = new Set((centros ?? []).filter((c: any) => c.estado === 'baja').map((c: any) => c.id_centro_costo));

	const rotas: number[] = [];
	const conCentroBaja: number[] = [];
	for (const t of (transacciones ?? []) as any[]) {
		const origenExiste = t.id_centro_costo_origen === null || idsExistentes.has(t.id_centro_costo_origen);
		const destinoExiste = t.id_centro_costo_destino === null || idsExistentes.has(t.id_centro_costo_destino);
		if (!origenExiste || !destinoExiste) rotas.push(t.id_transaccion);
		else if (idsBaja.has(t.id_centro_costo_origen) || idsBaja.has(t.id_centro_costo_destino)) conCentroBaja.push(t.id_transaccion);
	}

	const detalle = { total_centros: idsExistentes.size, total_transacciones_evaluadas: (transacciones ?? []).length, rotas, con_centro_baja: conCentroBaja };
	if (rotas.length > 0) {
		return { estado: 'error', mensaje: `${rotas.length} transacción(es) apuntan a un centro de costo que ya no existe.`, detalle };
	}
	if (conCentroBaja.length > 0) {
		return { estado: 'alerta', mensaje: `${conCentroBaja.length} transacción(es) activa(s) usan un centro de costo dado de baja.`, detalle };
	}
	return { estado: 'ok', mensaje: 'Toda transacción activa referencia un centro de costo existente y activo.', detalle };
}

async function checkConsistenciaCuentasBancarias(client: SupabaseClient): Promise<ResultadoCheck> {
	const [{ data: cuentas, error: errCuentas }, { data: transacciones, error: errTrans }] = await Promise.all([
		client.from('cuenta_banco').select('numero_cuenta, estado, activo'),
		client.from('transaccion').select('id_transaccion, cuente_origen, cuente_destino').eq('estado', 'activo')
	]);
	if (errCuentas) throw errCuentas;
	if (errTrans) throw errTrans;

	const inactivas = new Set((cuentas ?? []).filter((c: any) => c.estado !== 'activa' || !c.activo).map((c: any) => c.numero_cuenta));
	const usandoInactiva = (transacciones ?? [])
		.filter((t: any) => (t.cuente_origen && inactivas.has(t.cuente_origen)) || (t.cuente_destino && inactivas.has(t.cuente_destino)))
		.map((t: any) => t.id_transaccion);

	const detalle = { total_cuentas: (cuentas ?? []).length, total_transacciones_evaluadas: (transacciones ?? []).length, usando_inactiva: usandoInactiva };
	if (usandoInactiva.length === 0) return { estado: 'ok', mensaje: 'Ninguna transacción activa usa una cuenta bancaria inactiva/no autorizada/dada de baja.', detalle };
	return {
		estado: 'alerta',
		mensaje: `${usandoInactiva.length} transacción(es) activa(s) usan una cuenta bancaria que hoy está inactiva/no autorizada/dada de baja.`,
		detalle
	};
}

/**
 * Saldos consistentes: Σ Centro de Costo (getSaldosDetalleCentrosCosto en conciliacion.service.ts —
 * SOLO fondos propios: obra/consultoría/bolsa general/otro/proyectos con venta cerrada, NUNCA
 * Cuentas Internas cliente/proveedor/empleado, que son ledgers de contraparte y no dinero de la
 * empresa; ya incluye el saldo "vigente" de cada centro — última Apertura Financiera + transacciones
 * posteriores a su fecha de corte, ver esa función) debe ser igual a Σ Cuenta Bancaria (ya incluye
 * `saldo_inicial`, que Apertura Financiera escribe de verdad). Se trae el DESGLOSE por entidad (no
 * solo el total) para que el detalle expandible de la tarjeta muestre exactamente qué centro/cuenta
 * está aportando cuánto — a pedido explícito del usuario, para poder verificar la suma a mano. Una
 * diferencia real acá señala una transacción cuya cuenta_banco o centro_costo referenciado no existe
 * o no está registrado en el lado que se esperaba — el mismo chequeo que "Cruce Interno" en
 * Conciliación, pero corrido automáticamente como parte de la revisión general.
 */
async function checkSaldosConsistentes(client: SupabaseClient): Promise<ResultadoCheck> {
	const [centros, cuentas] = await Promise.all([getSaldosDetalleCentrosCosto(client), getSaldosDetalleCuentasBancarias(client)]);
	const saldoCentros = Number(centros.reduce((sum, c) => sum + c.monto, 0).toFixed(2));
	const saldoBancos = Number(cuentas.reduce((sum, c) => sum + c.monto, 0).toFixed(2));
	const diferencia = Number((saldoCentros - saldoBancos).toFixed(2));
	const detalle = {
		diferencia,
		saldo_centros_costo: saldoCentros,
		saldo_cuentas_bancarias: saldoBancos,
		centros_de_costo: centros.map((c) => ({ centro: c.label, monto: c.monto })),
		cuentas_bancarias: cuentas.map((c) => ({ cuenta: c.label, monto: c.monto }))
	};

	if (Math.abs(diferencia) <= 0.01) {
		return { estado: 'ok', mensaje: 'Σ Centros de Costo cuadra con Σ Cuentas Bancarias.', detalle };
	}
	return {
		estado: 'error',
		mensaje: `Diferencia de ${diferencia.toFixed(2)} entre Σ Centros de Costo (${saldoCentros.toFixed(2)}) y Σ Cuentas Bancarias (${saldoBancos.toFixed(2)}) — revisa Conciliación.`,
		detalle
	};
}

export const CHEQUEOS: ChequeoConsistencia[] = [
	{ id: 'integridad_transacciones', label: 'Integridad de transacciones', run: checkIntegridadTransacciones },
	{ id: 'integridad_movimientos', label: 'Integridad de movimientos (pagos/cobros)', run: checkIntegridadMovimientos },
	{ id: 'consistencia_saldos', label: 'Consistencia de saldos bancarios', run: checkConsistenciaSaldos },
	{ id: 'saldos_consistentes', label: 'Saldos consistentes (Centros de Costo vs Cuentas Bancarias)', run: checkSaldosConsistentes },
	{ id: 'posibles_duplicados', label: 'Posibles duplicados', run: checkPosiblesDuplicados },
	{ id: 'consistencia_centros_costo', label: 'Consistencia de centros de costo', run: checkConsistenciaCentrosCosto },
	{ id: 'consistencia_cuentas_bancarias', label: 'Consistencia de cuentas bancarias', run: checkConsistenciaCuentasBancarias }
];

export interface RevisionFinanciera {
	id_revision: number;
	fecha: string;
	resultado: ResultadoChequeoConId[];
	controles_ok: number;
	controles_alerta: number;
	controles_error: number;
	usuario_registro: string | null;
	created_at: string;
}

const TABLE_NAME = 'revision_financiera';

/** Corre los 6+ chequeos y persiste el resultado agregado — llamado solo por el botón "Ejecutar
 * revisión"/"Ejecutar ahora", nunca en cada carga de página. */
export async function ejecutarRevision(client: SupabaseClient, usuarioRegistro: string | null): Promise<RevisionFinanciera> {
	const resultado: ResultadoChequeoConId[] = await Promise.all(
		CHEQUEOS.map(async (chequeo) => {
			try {
				const r = await chequeo.run(client);
				return { id: chequeo.id, label: chequeo.label, ...r };
			} catch (err: any) {
				return { id: chequeo.id, label: chequeo.label, estado: 'error' as const, mensaje: err?.message ?? 'No se pudo ejecutar el chequeo' };
			}
		})
	);

	const controles_ok = resultado.filter((r) => r.estado === 'ok').length;
	const controles_alerta = resultado.filter((r) => r.estado === 'alerta').length;
	const controles_error = resultado.filter((r) => r.estado === 'error').length;

	const { data, error } = await client
		.from(TABLE_NAME)
		.insert({ resultado, controles_ok, controles_alerta, controles_error, usuario_registro: usuarioRegistro })
		.select('*')
		.single();
	if (error) throw error;
	return data as RevisionFinanciera;
}

export async function getUltimaRevision(client: SupabaseClient): Promise<RevisionFinanciera | null> {
	const { data, error } = await client.from(TABLE_NAME).select('*').order('fecha', { ascending: false }).limit(1).maybeSingle();
	if (error) throw error;
	return (data as RevisionFinanciera) ?? null;
}
