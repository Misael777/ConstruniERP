/**
 * Servicio de Conciliación — Control Financiero (ver control_financiero_migration.sql). Dos
 * comparaciones INDEPENDIENTES, nunca colapsadas en una sola cifra:
 *   (a) Cruce interno: Σ saldos de Centro de Costo vs Σ saldos de Cuenta Bancaria — ambos ya
 *       calculados por getSaldosPorCentroCosto/getSaldosCuentaBanco (centroCostos.service.ts /
 *       cuentaBanco.service.ts), reutilizados tal cual y solo sumados client-side.
 *   (b) Conciliación bancaria manual: saldo ERP (cuenta_banco.saldo_actual, consolidado o de una
 *       cuenta puntual) vs el monto que el usuario ingresa a mano del estado de cuenta real (sin
 *       integración bancaria — a pedido explícito del usuario).
 * Regla dura: NINGUNA función de este archivo escribe en cuenta_banco.saldo_actual ni en nada
 * derivado de centro_costo — una diferencia real (> tolerancia) solo abre una Incidencia, nunca
 * ajusta un saldo en silencio (ver incidencia.service.ts para el flujo de resolución).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { getSaldosPorCentroCosto } from '$lib/modules/centro-costos/services/centroCostos.service';
import { getSaldosCuentaBanco } from '$lib/modules/cuentas-bancarias/services/cuentaBanco.service';
import { crearIncidencia, type Severidad } from './incidencia.service';

/** Solo redondeo — cualquier diferencia mayor se trata como real (confirmado con el usuario, sin
 * margen de tolerancia de negocio inventado). */
export const TOLERANCIA_CONCILIACION = 0.01;

export interface ServiceResult<T = undefined> {
	success: boolean;
	message: string;
	data?: T;
}

export type TipoConciliacion = 'interna' | 'banco_manual';
export type EstadoConciliacion = 'cuadrada' | 'con_diferencia';

export interface ConciliacionFinanciera {
	id_conciliacion: number;
	fecha: string;
	tipo: TipoConciliacion;
	saldo_a: number;
	saldo_b: number;
	diferencia: number;
	estado: EstadoConciliacion;
	id_incidencia: number | null;
	usuario_registro: string | null;
	observaciones: string | null;
	created_at: string;
}

const TABLE_NAME = 'conciliacion_financiera';

/** Σ saldos de TODOS los centros de costo activos — mismo criterio "sumar el mapa por-id" que ya
 * usa el resto del ERP, no hay agregación nueva de por medio. */
export async function getSaldoTotalCentrosCosto(client: SupabaseClient): Promise<number> {
	const { data, error } = await client.from('centro_costo').select('id_centro_costo').eq('estado', 'activo');
	if (error) throw error;
	const ids = (data ?? []).map((c: any) => c.id_centro_costo as number);
	if (ids.length === 0) return 0;
	const saldos = await getSaldosPorCentroCosto(client, ids);
	return Object.values(saldos).reduce((sum, v) => sum + v, 0);
}

/** Σ saldo_actual de TODAS las cuentas bancarias activas. */
export async function getSaldoTotalCuentasBancarias(client: SupabaseClient): Promise<number> {
	const saldos = await getSaldosCuentaBanco(client);
	return Object.values(saldos).reduce((sum, v) => sum + v, 0);
}

/** Σ saldo_inicial de TODAS las cuentas bancarias activas — el dinero que YA estaba en esas cuentas
 * antes de que el ERP empezara a llevarlas (ver cuenta_banco_saldo_migration.sql). Necesario para
 * comparar contra Centro de Costo correctamente: centro_costo siempre arranca en 0 (no tiene un
 * "saldo_inicial" propio, ver getSaldosPorCentroCosto), mientras que cuenta_banco.saldo_actual =
 * saldo_inicial + neto de movimientos — sin restar este total, CUALQUIER cuenta con saldo inicial
 * real produciría una "diferencia" permanente que no es un error, solo el punto de partida. */
export async function getSaldoInicialTotalCuentasBancarias(client: SupabaseClient): Promise<number> {
	const { data, error } = await client.from('cuenta_banco').select('saldo_inicial').eq('activo', true);
	if (error) throw error;
	return (data ?? []).reduce((sum: number, r: any) => sum + Number(r.saldo_inicial ?? 0), 0);
}

function severidadPorDiferencia(diferencia: number): Severidad {
	const abs = Math.abs(diferencia);
	if (abs >= 10000) return 'critica';
	if (abs >= 1000) return 'alta';
	if (abs >= 100) return 'media';
	return 'baja';
}

async function registrarConciliacion(
	client: SupabaseClient,
	tipo: TipoConciliacion,
	saldoA: number,
	saldoB: number,
	usuarioRegistro: string | null,
	descripcionIncidencia: (diferencia: number) => string,
	observaciones?: string | null
): Promise<ServiceResult<ConciliacionFinanciera>> {
	const diferencia = Number((saldoA - saldoB).toFixed(2));
	const estado: EstadoConciliacion = Math.abs(diferencia) <= TOLERANCIA_CONCILIACION ? 'cuadrada' : 'con_diferencia';

	const { data, error } = await client
		.from(TABLE_NAME)
		.insert({ tipo, saldo_a: saldoA, saldo_b: saldoB, diferencia, estado, usuario_registro: usuarioRegistro, observaciones: observaciones ?? null })
		.select('*')
		.single();
	if (error) return { success: false, message: `No se pudo registrar la conciliación: ${error.message}` };

	if (estado === 'con_diferencia') {
		const incidenciaResult = await crearIncidencia(
			client,
			{
				severidad: severidadPorDiferencia(diferencia),
				tipo_entidad: 'conciliacion',
				id_entidad: data.id_conciliacion,
				origen_check: `conciliacion_${tipo}`,
				descripcion: descripcionIncidencia(diferencia),
				monto_diferencia: diferencia
			},
			usuarioRegistro
		);
		if (incidenciaResult.success && incidenciaResult.data) {
			await client.from(TABLE_NAME).update({ id_incidencia: incidenciaResult.data.id_incidencia }).eq('id_conciliacion', data.id_conciliacion);
			data.id_incidencia = incidenciaResult.data.id_incidencia;
		}
	}

	return { success: true, message: estado === 'cuadrada' ? 'Conciliación cuadrada' : 'Diferencia detectada — se generó una incidencia', data: data as ConciliacionFinanciera };
}

/** (a) Cruce interno — automático, sin input manual. Compara Centro de Costo (siempre arranca en 0)
 * contra Cuenta Bancaria YA AJUSTADA por su saldo_inicial (ver getSaldoInicialTotalCuentasBancarias) —
 * sin ese ajuste, cualquier cuenta con saldo inicial real mostraría una "diferencia" permanente que
 * no es un error real, solo el punto de partida antes de que el ERP empezara a llevar la cuenta. */
export async function registrarConciliacionInterna(client: SupabaseClient, usuarioRegistro: string | null): Promise<ServiceResult<ConciliacionFinanciera>> {
	const [saldoCentros, saldoCuentas, saldoInicial] = await Promise.all([
		getSaldoTotalCentrosCosto(client),
		getSaldoTotalCuentasBancarias(client),
		getSaldoInicialTotalCuentasBancarias(client)
	]);
	const saldoCuentasAjustado = saldoCuentas - saldoInicial;
	return registrarConciliacion(
		client,
		'interna',
		saldoCentros,
		saldoCuentasAjustado,
		usuarioRegistro,
		(diferencia) =>
			`Cruce interno con diferencia: Centros de Costo ${saldoCentros.toFixed(2)} vs Cuentas Bancarias ${saldoCuentas.toFixed(2)} ajustado por saldo inicial ${saldoInicial.toFixed(2)} = ${saldoCuentasAjustado.toFixed(2)} (diferencia ${diferencia.toFixed(2)}).`
	);
}

/** (b) Conciliación bancaria manual — `montoBancoManual` es el monto que el usuario copia del
 * estado de cuenta real (sin integración bancaria). `numeroCuenta` null = consolidado (todas las
 * cuentas activas); con valor = solo esa cuenta. */
export async function registrarConciliacionBancoManual(
	client: SupabaseClient,
	montoBancoManual: number,
	numeroCuenta: string | null,
	usuarioRegistro: string | null,
	observaciones?: string | null
): Promise<ServiceResult<ConciliacionFinanciera>> {
	let saldoErp: number;
	let etiquetaCuenta: string;
	if (numeroCuenta) {
		const saldos = await getSaldosCuentaBanco(client);
		saldoErp = saldos[numeroCuenta] ?? 0;
		etiquetaCuenta = `la cuenta ${numeroCuenta}`;
	} else {
		saldoErp = await getSaldoTotalCuentasBancarias(client);
		etiquetaCuenta = 'el consolidado de cuentas bancarias';
	}

	return registrarConciliacion(
		client,
		'banco_manual',
		saldoErp,
		montoBancoManual,
		usuarioRegistro,
		(diferencia) => `Diferencia bancaria en ${etiquetaCuenta}: ERP ${saldoErp.toFixed(2)} vs Banco ${montoBancoManual.toFixed(2)} (diferencia ${diferencia.toFixed(2)}).`,
		observaciones
	);
}

export async function getConciliaciones(client: SupabaseClient, limit = 30): Promise<ConciliacionFinanciera[]> {
	const { data, error } = await client.from(TABLE_NAME).select('*').order('created_at', { ascending: false }).limit(limit);
	if (error) throw error;
	return (data ?? []) as ConciliacionFinanciera[];
}

/** Conteo de conciliaciones con diferencia todavía sin incidencia resuelta — para el KPI del
 * Dashboard ("conciliaciones pendientes"). */
export async function getConciliacionesPendientesCount(client: SupabaseClient): Promise<number> {
	const { data, error } = await client
		.from(TABLE_NAME)
		.select('id_conciliacion, incidencia:id_incidencia(estado)')
		.eq('estado', 'con_diferencia');
	if (error) throw error;
	return (data ?? []).filter((row: any) => {
		const estadoIncidencia = row.incidencia?.estado;
		return estadoIncidencia !== 'RESOLVED' && estadoIncidencia !== 'CLOSED';
	}).length;
}

// ── Apertura Financiera / Saldo Inicial ────────────────────────────────────────────────────────

export type FuenteApertura = 'estado_de_cuenta_bancario' | 'migracion_inicial' | 'auditoria_externa' | 'otro';

export interface AperturaFinanciera {
	id_apertura: number;
	fecha_corte: string;
	monto: number;
	/** Como mucho UNO de id_cuenta_banco/id_centro_costo no-nulo a la vez (CHECK
	 * chk_apertura_financiera_un_ambito) — ninguno de los dos = ámbito global. */
	id_cuenta_banco: number | null;
	id_centro_costo: number | null;
	fuente: FuenteApertura;
	observaciones: string | null;
	usuario_registro: string | null;
	created_at: string;
}

export interface AperturaFinancieraPayload {
	fecha_corte: string;
	monto: number;
	id_cuenta_banco: number | null;
	id_centro_costo: number | null;
	fuente: FuenteApertura;
	observaciones: string | null;
}

/** Ancla histórica de auditoría — NUNCA participa en un cálculo de saldo en vivo (cuenta_banco.
 * saldo_actual y los totales de arriba no la leen). Solo se inserta, no se edita (si hace falta
 * corregirla, se da de alta una nueva fila — mismo espíritu que "reversal, no borrado físico" ya
 * usado en transacciones). */
export async function crearAperturaFinanciera(client: SupabaseClient, payload: AperturaFinancieraPayload, usuarioRegistro: string | null): Promise<ServiceResult<AperturaFinanciera>> {
	const { data, error } = await client
		.from('apertura_financiera')
		.insert({ ...payload, usuario_registro: usuarioRegistro })
		.select('*')
		.single();
	if (error) return { success: false, message: `No se pudo registrar la apertura financiera: ${error.message}` };
	return { success: true, message: 'Apertura financiera registrada', data: data as AperturaFinanciera };
}

export async function getAperturasFinancieras(client: SupabaseClient): Promise<AperturaFinanciera[]> {
	const { data, error } = await client.from('apertura_financiera').select('*').order('fecha_corte', { ascending: false });
	if (error) throw error;
	return (data ?? []) as AperturaFinanciera[];
}

export interface AperturaLotePayload {
	fecha_corte: string;
	fuente: FuenteApertura;
	observaciones: string | null;
	cuentas: { id_cuenta_banco: number; monto: number }[];
	centros: { id_centro_costo: number; monto: number }[];
}

/**
 * Corte financiero completo — a pedido explícito del usuario: en vez de declarar el saldo inicial de
 * UNA cuenta o UN centro de costo a la vez, revisa TODAS las cuentas bancarias y TODOS los centros de
 * costo activos de un tirón, para la misma fecha_corte. El llamador (ConciliacionTab.svelte) ya
 * validó que Σ montos de cuentas === Σ montos de centros (dentro de tolerancia) ANTES de invocar
 * esto — el gate de "no dejar generar hasta que cuadre" vive en la UI, no acá, porque necesita
 * reaccionar en vivo mientras el usuario edita cada monto. Inserta una fila por cuenta + una fila por
 * centro, todas con la misma fecha_corte/fuente/observaciones (eso es lo que las agrupa como "el
 * mismo corte" en el historial — no hace falta una columna de lote aparte). Sigue sin escribir nada
 * en cuenta_banco.saldo_inicial ni en centro_costo — puro registro de auditoría, igual que
 * crearAperturaFinanciera.
 */
export async function crearAperturaFinancieraLote(client: SupabaseClient, payload: AperturaLotePayload, usuarioRegistro: string | null): Promise<ServiceResult<AperturaFinanciera[]>> {
	const filas = [
		...payload.cuentas.map((c) => ({
			fecha_corte: payload.fecha_corte,
			monto: c.monto,
			id_cuenta_banco: c.id_cuenta_banco,
			id_centro_costo: null,
			fuente: payload.fuente,
			observaciones: payload.observaciones,
			usuario_registro: usuarioRegistro
		})),
		...payload.centros.map((c) => ({
			fecha_corte: payload.fecha_corte,
			monto: c.monto,
			id_cuenta_banco: null,
			id_centro_costo: c.id_centro_costo,
			fuente: payload.fuente,
			observaciones: payload.observaciones,
			usuario_registro: usuarioRegistro
		}))
	];
	if (filas.length === 0) return { success: false, message: 'No hay cuentas bancarias ni centros de costo para registrar.' };

	const { data, error } = await client.from('apertura_financiera').insert(filas).select('*');
	if (error) return { success: false, message: `No se pudo registrar el corte financiero: ${error.message}` };
	return { success: true, message: `Corte financiero registrado — ${filas.length} fila(s) (${payload.cuentas.length} cuenta(s), ${payload.centros.length} centro(s) de costo).`, data: data as AperturaFinanciera[] };
}
