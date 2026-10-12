/**
 * Servicio de Conciliación — Control Financiero (ver control_financiero_migration.sql). Dos
 * comparaciones INDEPENDIENTES, nunca colapsadas en una sola cifra:
 *   (a) Cruce interno: Σ saldos de Centro de Costo vs Σ saldos de Cuenta Bancaria.
 *   (b) Conciliación bancaria manual: saldo ERP (consolidado o de una cuenta puntual) vs el monto que
 *       el usuario ingresa a mano del estado de cuenta real (sin integración bancaria).
 * Regla dura: una diferencia real (> tolerancia) en Conciliación siempre abre una Incidencia en vez
 * de corregir nada en silencio (ver incidencia.service.ts para el flujo de resolución).
 *
 * APERTURA FINANCIERA — mismo criterio SIMÉTRICO en ambos lados desde
 * cuenta_banco_saldo_fecha_corte_migration.sql (antes NO lo era — ver esa migración para el bug real
 * de doble conteo que corrigió, encontrado investigando el ticket "SALDO NEGATIVO"):
 *   - Cuenta bancaria: el monto declarado queda SOLO en `apertura_financiera` (ya NO pisa
 *     `cuenta_banco.saldo_inicial`, que vuelve a ser el valor de una sola vez al crear la cuenta).
 *     `fn_recalcular_saldo_cuenta_banco` (Postgres) ya sabe buscar sola la apertura MÁS RECIENTE de
 *     esa cuenta y usarla como base + fecha de corte — si no hay ninguna, cae al saldo_inicial +
 *     historial completo de siempre. La propia pantalla de Cuentas Bancarias queda actualizada
 *     (saldo_actual recalculado), no solo Control Financiero.
 *   - Centro de costo (sin una columna propia donde guardar un saldo inicial, y a propósito SIN crear
 *     una transacción sintética que ensuciaría su historial real): el monto declarado queda SOLO en
 *     `apertura_financiera`, y `getSaldoTotalCentrosCosto` calcula el saldo "vigente" de cada centro
 *     como (monto de su ÚLTIMA apertura, si tiene una) + Σ(transacciones activas con fecha POSTERIOR
 *     a esa fecha_corte) — mismo criterio tipo-gated que usa getSaldosPorCentroCosto
 *     (centroCostos.service.ts), replicado acá porque esa función no acepta un filtro de fecha y no
 *     se toca (es de otro módulo). Sin apertura, cae al historial completo de siempre (baseline 0).
 *     CONSECUENCIA ACEPTADA por el usuario: la pantalla propia de "Centro de Costos y Cuentas
 *     Internas" (su columna "Monto Actual") NO refleja este número — esa pantalla no tiene noción de
 *     fecha de corte, siempre suma todo el historial. El saldo "vigente" es una cifra que solo vive
 *     dentro de Control Financiero (Dashboard/Conciliación/Consistencia). Cuenta Bancaria es la
 *     EXCEPCIÓN: ahí sí se refleja en la propia pantalla de Cuentas Bancarias, porque saldo_actual es
 *     una columna real que toda la app ya lee (no hay una "vista" separada como en Centro de Costo).
 *
 * IMPORTANTE: "Centro de Costo" acá SIEMPRE significa fondos propios (obra/consultoría/bolsa
 * general/otro/proyectos con venta cerrada) — la misma población que la pestaña "Centros de Costos"
 * del submódulo "Centro de Costos y Cuentas Internas". NUNCA incluye "Cuentas Internas" (centros
 * vinculados a cliente/proveedor/empleado), porque esos son ledgers de lo que se le debe a/nos deben
 * terceros, no dinero que la empresa tenga. Se reutiliza el filtro EXACTO que ya usa esa pestaña, vía
 * getCentroCostoOptionsSoloCentros (transacciones.service.ts) — no se duplica la lógica.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { getSaldosCuentaBanco, recalcularSaldoCuentaBanco } from '$lib/modules/cuentas-bancarias/services/cuentaBanco.service';
import { getCentroCostoOptionsSoloCentros } from '$lib/modules/transacciones/services/transacciones.service';
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

/** Mapa id_centro_costo -> su apertura MÁS RECIENTE (por fecha_corte, empate por created_at) — base
 * del saldo "vigente" de centro de costo, ver nota al inicio del archivo. */
export interface AperturaVigente {
	monto: number;
	fecha_corte: string;
}

/** Exportada además de usarla internamente — trayectoria.service.ts la reutiliza para saber desde
 * dónde arranca la reconstrucción histórica de cada centro de costo (mismo criterio "última apertura
 * = punto fijo de partida" que getSaldoTotalCentrosCosto de abajo). */
export async function getUltimasAperturasPorCentroCosto(client: SupabaseClient): Promise<Record<number, AperturaVigente>> {
	const { data, error } = await client
		.from('apertura_financiera')
		.select('id_centro_costo, monto, fecha_corte, created_at')
		.not('id_centro_costo', 'is', null)
		.order('fecha_corte', { ascending: false })
		.order('created_at', { ascending: false });
	if (error) throw error;
	const mapa: Record<number, { monto: number; fecha_corte: string }> = {};
	for (const fila of (data ?? []) as any[]) {
		if (!(fila.id_centro_costo in mapa)) mapa[fila.id_centro_costo] = { monto: Number(fila.monto), fecha_corte: fila.fecha_corte };
	}
	return mapa;
}

/** Ticket #90: fecha de corte de la Apertura Financiera vigente (la más reciente) de cada cuenta bancaria,
 * por número de cuenta — fn_recalcular_saldo_cuenta_banco solo suma los movimientos POSTERIORES a esa fecha,
 * así que TransaccionModal avisa cuando una transacción queda en o antes del corte (no cambia el saldo). */
export async function getUltimasAperturasPorCuentaBanco(client: SupabaseClient): Promise<Record<string, { monto: number; fecha_corte: string }>> {
	const [{ data: aperturas, error }, { data: cuentas, error: errorCuentas }] = await Promise.all([
		client.from('apertura_financiera').select('id_cuenta_banco, monto, fecha_corte, created_at').not('id_cuenta_banco', 'is', null).order('fecha_corte', { ascending: false }).order('created_at', { ascending: false }),
		client.from('cuenta_banco').select('id_cuenta_banco, numero_cuenta')
	]);
	if (error) throw error;
	if (errorCuentas) throw errorCuentas;
	const numeroPorId = new Map((cuentas ?? []).map((c: any) => [c.id_cuenta_banco, c.numero_cuenta as string]));
	const mapa: Record<string, { monto: number; fecha_corte: string }> = {};
	for (const fila of (aperturas ?? []) as any[]) {
		const numero = numeroPorId.get(fila.id_cuenta_banco);
		if (numero && !(numero in mapa)) mapa[numero] = { monto: Number(fila.monto), fecha_corte: String(fila.fecha_corte).slice(0, 10) };
	}
	return mapa;
}

export interface SaldoDetalleEntidad {
	id: string;
	label: string;
	monto: number;
}

/** Saldo VIGENTE de CADA centro de costo de FONDOS PROPIOS activo (tab "Centros de Costos" — ver
 * nota arriba, excluye Cuentas Internas): su última apertura (si existe) + solo las transacciones
 * posteriores a esa fecha de corte, con el mismo criterio tipo-gated que getSaldosPorCentroCosto
 * (centroCostos.service.ts) — replicado acá porque esa función no acepta un filtro de fecha y no se
 * toca (es de otro módulo). Sin apertura, cae al historial completo de siempre (baseline 0).
 * Desglosado por entidad — para el total, ver getSaldoTotalCentrosCosto; para mostrar "qué está
 * sumando" en Consistencia/Conciliación, usar esta función directamente. */
export async function getSaldosDetalleCentrosCosto(client: SupabaseClient): Promise<SaldoDetalleEntidad[]> {
	const [opciones, aperturas] = await Promise.all([getCentroCostoOptionsSoloCentros(client), getUltimasAperturasPorCentroCosto(client)]);
	const ids = opciones.map((o) => Number(o.value));
	if (ids.length === 0) return [];
	const idsSet = new Set(ids);

	const { data, error } = await client
		.from('transaccion')
		.select('id_centro_costo_origen, id_centro_costo_destino, tipo, monto_total, fecha')
		.eq('estado', 'activo');
	if (error) throw error;

	const neto: Record<number, number> = {};
	for (const id of ids) neto[id] = 0;
	for (const t of (data ?? []) as any[]) {
		const monto = Number(t.monto_total);
		const origen = t.id_centro_costo_origen;
		const destino = t.id_centro_costo_destino;
		if (origen != null && idsSet.has(origen) && (t.tipo === 'egreso' || t.tipo === 'transferencia')) {
			const corte = aperturas[origen]?.fecha_corte;
			if (!corte || t.fecha > corte) neto[origen] -= monto;
		}
		if (destino != null && idsSet.has(destino) && (t.tipo === 'ingreso' || t.tipo === 'financiamiento' || t.tipo === 'transferencia')) {
			const corte = aperturas[destino]?.fecha_corte;
			if (!corte || t.fecha > corte) neto[destino] += monto;
		}
	}

	return opciones.map((opt) => {
		const id = Number(opt.value);
		return { id: opt.value, label: opt.label, monto: Number(((aperturas[id]?.monto ?? 0) + neto[id]).toFixed(2)) };
	});
}

/** Σ saldo VIGENTE de todos los centros de costo — ver getSaldosDetalleCentrosCosto. */
export async function getSaldoTotalCentrosCosto(client: SupabaseClient): Promise<number> {
	const detalle = await getSaldosDetalleCentrosCosto(client);
	return Number(detalle.reduce((sum, d) => sum + d.monto, 0).toFixed(2));
}

/** Saldo_actual de CADA cuenta bancaria activa, con su etiqueta ("Titular - N° de cuenta") — para
 * mostrar "qué está sumando" en Consistencia/Conciliación. */
export async function getSaldosDetalleCuentasBancarias(client: SupabaseClient): Promise<SaldoDetalleEntidad[]> {
	const [{ data: cuentas, error }, saldos] = await Promise.all([
		client.from('cuenta_banco').select('numero_cuenta, titular_cuenta').eq('activo', true),
		getSaldosCuentaBanco(client)
	]);
	if (error) throw error;
	return (cuentas ?? []).map((c: any) => ({
		id: c.numero_cuenta,
		label: `${c.titular_cuenta} - ${c.numero_cuenta}`,
		monto: Number((saldos[c.numero_cuenta] ?? 0).toFixed(2))
	}));
}

/** Σ saldo_actual de TODAS las cuentas bancarias activas — ver getSaldosDetalleCuentasBancarias. */
export async function getSaldoTotalCuentasBancarias(client: SupabaseClient): Promise<number> {
	const saldos = await getSaldosCuentaBanco(client);
	return Object.values(saldos).reduce((sum, v) => sum + v, 0);
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

/** (a) Cruce interno — automático, sin input manual. */
export async function registrarConciliacionInterna(client: SupabaseClient, usuarioRegistro: string | null): Promise<ServiceResult<ConciliacionFinanciera>> {
	const [saldoCentros, saldoCuentas] = await Promise.all([getSaldoTotalCentrosCosto(client), getSaldoTotalCuentasBancarias(client)]);
	return registrarConciliacion(
		client,
		'interna',
		saldoCentros,
		saldoCuentas,
		usuarioRegistro,
		(diferencia) => `Cruce interno con diferencia: Centros de Costo ${saldoCentros.toFixed(2)} vs Cuentas Bancarias ${saldoCuentas.toFixed(2)} (diferencia ${diferencia.toFixed(2)}).`
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
 * mismo corte" en el historial — no hace falta una columna de lote aparte).
 *
 * Cuenta bancaria y Centro de costo funcionan igual ahora (ver nota "APERTURA FINANCIERA" al inicio
 * del archivo): ninguno de los dos pisa una columna real, ambos quedan SOLO en `apertura_financiera`.
 * Para cuenta bancaria, después de insertar se llama a `recalcularSaldoCuentaBanco` (mismo RPC
 * atómico de siempre, ya sabe leer la apertura sola) para que la propia pantalla de Cuentas Bancarias
 * también quede actualizada. Centro de costo no necesita ese paso — su saldo "vigente" lo calcula
 * getSaldoTotalCentrosCosto arriba, a partir de esta misma fila. Best-effort por cuenta: si el
 * refresco de una cuenta puntual falla, no tumba el registro del corte completo (ya insertado); se
 * loguea y sigue con las demás.
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

	if (payload.cuentas.length > 0) {
		// Ya NO se pisa cuenta_banco.saldo_inicial acá (bug real corregido, ver
		// cuenta_banco_saldo_fecha_corte_migration.sql) — la fila de apertura_financiera recién
		// insertada arriba YA es la fuente de verdad que fn_recalcular_saldo_cuenta_banco usa como base
		// + fecha de corte, mismo criterio que Centro de Costo (que tampoco pisa ninguna columna real).
		// saldo_inicial vuelve a ser lo que dice su nombre: el valor de una sola vez al crear la cuenta.
		const ids = payload.cuentas.map((c) => c.id_cuenta_banco);
		const { data: cuentasBanco } = await client.from('cuenta_banco').select('id_cuenta_banco, numero_cuenta').in('id_cuenta_banco', ids);
		const numeroPorId = new Map((cuentasBanco ?? []).map((c: any) => [c.id_cuenta_banco, c.numero_cuenta as string]));

		await Promise.all(
			payload.cuentas.map(async (c) => {
				try {
					const numeroCuenta = numeroPorId.get(c.id_cuenta_banco);
					if (numeroCuenta) await recalcularSaldoCuentaBanco(client, numeroCuenta);
				} catch (err) {
					console.error('[conciliacion.service] No se pudo recalcular el saldo de la cuenta', c.id_cuenta_banco, err);
				}
			})
		);
	}

	return {
		success: true,
		message: `Corte financiero registrado — ${filas.length} fila(s) (${payload.cuentas.length} cuenta(s), ${payload.centros.length} centro(s) de costo).`,
		data: data as AperturaFinanciera[]
	};
}

// ── Puntos de corte (Apertura Financiera agrupada) ─────────────────────────────────────────────────────
// A pedido del cliente (2026-10-11): "Generar Apertura" AGREGA un corte nuevo; no reemplaza los anteriores.
// Para cada cuenta/centro manda el corte de fecha MÁS RECIENTE (ver fn_recalcular_saldo_cuenta_banco y
// getUltimasAperturasPorCentroCosto), así que generar un corte al 01/01/2025 después de uno al 11/10/2026
// no tenía ningún efecto y el cliente no lo podía ver. Esto agrupa las filas por fecha de corte, marca cuál
// manda y permite cambiar la fecha o eliminar un corte completo (la pantalla pide contraseña de admin).

export interface CorteResumen {
	fecha_corte: string;
	filas: number;
	cuentas: number;
	centros: number;
	totalCuentas: number;
	totalCentros: number;
	/** En cuántas cuentas/centros este corte es el que manda (el de fecha más reciente de cada uno). */
	vigenteEn: number;
	creadoPrimero: string;
	creadoUltimo: string;
	usuarios: string[];
	fuente: FuenteApertura;
	observaciones: string | null;
}

const claveAmbito = (a: AperturaFinanciera) => (a.id_cuenta_banco ? `b:${a.id_cuenta_banco}` : a.id_centro_costo ? `c:${a.id_centro_costo}` : 'global');

/** Para cada cuenta/centro, la fila de apertura que manda (fecha_corte más reciente; empate por created_at). */
export function aperturasVigentes(aperturas: AperturaFinanciera[]): Map<string, AperturaFinanciera> {
	const vigentes = new Map<string, AperturaFinanciera>();
	for (const a of aperturas) {
		const k = claveAmbito(a);
		const actual = vigentes.get(k);
		if (!actual || a.fecha_corte > actual.fecha_corte || (a.fecha_corte === actual.fecha_corte && a.created_at > actual.created_at)) vigentes.set(k, a);
	}
	return vigentes;
}

export function agruparCortes(aperturas: AperturaFinanciera[]): CorteResumen[] {
	const vigentes = new Set([...aperturasVigentes(aperturas).values()].map((a) => a.id_apertura));
	const grupos = new Map<string, CorteResumen>();
	for (const a of aperturas) {
		const fecha = String(a.fecha_corte).slice(0, 10);
		const g = grupos.get(fecha) ?? {
			fecha_corte: fecha, filas: 0, cuentas: 0, centros: 0, totalCuentas: 0, totalCentros: 0, vigenteEn: 0,
			creadoPrimero: a.created_at, creadoUltimo: a.created_at, usuarios: [], fuente: a.fuente, observaciones: a.observaciones
		};
		g.filas++;
		if (a.id_cuenta_banco) { g.cuentas++; g.totalCuentas += Number(a.monto); }
		if (a.id_centro_costo) { g.centros++; g.totalCentros += Number(a.monto); }
		if (vigentes.has(a.id_apertura)) g.vigenteEn++;
		if (a.created_at < g.creadoPrimero) g.creadoPrimero = a.created_at;
		if (a.created_at > g.creadoUltimo) g.creadoUltimo = a.created_at;
		if (a.usuario_registro && !g.usuarios.includes(a.usuario_registro)) g.usuarios.push(a.usuario_registro);
		grupos.set(fecha, g);
	}
	return [...grupos.values()].sort((x, y) => (x.fecha_corte < y.fecha_corte ? 1 : -1));
}

async function recalcularCuentasDeIds(client: SupabaseClient, ids: number[]): Promise<void> {
	if (ids.length === 0) return;
	const { data } = await client.from('cuenta_banco').select('numero_cuenta').in('id_cuenta_banco', ids);
	await Promise.all((data ?? []).map((c: any) => recalcularSaldoCuentaBanco(client, c.numero_cuenta)));
}

/** Elimina TODAS las filas de un corte (misma fecha_corte) y recalcula el saldo de las cuentas afectadas:
 * pasa a mandar el corte anterior de cada una (o, si no queda ninguno, su saldo inicial + todo el historial). */
export async function eliminarCorte(client: SupabaseClient, fechaCorte: string): Promise<ServiceResult<number>> {
	const { data, error } = await client.from('apertura_financiera').delete().eq('fecha_corte', fechaCorte).select('id_cuenta_banco');
	if (error) return { success: false, message: `No se pudo eliminar el corte: ${error.message}` };
	const ids = [...new Set((data ?? []).map((f: any) => f.id_cuenta_banco).filter((v: unknown): v is number => v != null))];
	await recalcularCuentasDeIds(client, ids);
	return { success: true, message: `Corte del ${fechaCorte.split('-').reverse().join('/')} eliminado (${data?.length ?? 0} registros).`, data: data?.length ?? 0 };
}

/** Mueve un corte completo a otra fecha (mismos montos) y recalcula el saldo de las cuentas afectadas. */
export async function cambiarFechaCorte(client: SupabaseClient, fechaActual: string, fechaNueva: string): Promise<ServiceResult<number>> {
	if (!fechaNueva || fechaNueva === fechaActual) return { success: false, message: 'Elige una fecha distinta.' };
	const { data: existentes } = await client.from('apertura_financiera').select('id_apertura').eq('fecha_corte', fechaNueva).limit(1);
	if ((existentes ?? []).length > 0) return { success: false, message: 'Ya existe un corte en esa fecha: elimínalo primero o elige otra fecha.' };
	const { data, error } = await client.from('apertura_financiera').update({ fecha_corte: fechaNueva }).eq('fecha_corte', fechaActual).select('id_cuenta_banco');
	if (error) return { success: false, message: `No se pudo cambiar la fecha del corte: ${error.message}` };
	const ids = [...new Set((data ?? []).map((f: any) => f.id_cuenta_banco).filter((v: unknown): v is number => v != null))];
	await recalcularCuentasDeIds(client, ids);
	return { success: true, message: `Corte movido al ${fechaNueva.split('-').reverse().join('/')}.`, data: data?.length ?? 0 };
}

export interface MovimientoCuenta {
	id_transaccion: number;
	fecha: string;
	/** + entra a la cuenta, − sale. */
	monto: number;
	descripcion: string | null;
}

/** Movimientos activos de una cuenta bancaria (para el gráfico de "Puntos de corte"). */
export async function getMovimientosCuentaBanco(client: SupabaseClient, numeroCuenta: string): Promise<MovimientoCuenta[]> {
	// Dos consultas (origen y destino) en vez de .or(): los números de cuenta tienen espacios ("192 97436464068").
	const columnas = 'id_transaccion, fecha, monto_total, cuente_origen, cuente_destino, descripcion';
	const [salen, entran] = await Promise.all([
		client.from('transaccion').select(columnas).eq('estado', 'activo').eq('cuente_origen', numeroCuenta),
		client.from('transaccion').select(columnas).eq('estado', 'activo').eq('cuente_destino', numeroCuenta)
	]);
	if (salen.error) throw salen.error;
	if (entran.error) throw entran.error;
	const porId = new Map<number, any>();
	for (const t of [...(salen.data ?? []), ...(entran.data ?? [])]) porId.set(t.id_transaccion, t);
	return [...porId.values()]
		.map((t: any) => ({
			id_transaccion: t.id_transaccion,
			fecha: String(t.fecha).slice(0, 10),
			monto: (t.cuente_destino === numeroCuenta ? Number(t.monto_total) : 0) - (t.cuente_origen === numeroCuenta ? Number(t.monto_total) : 0),
			descripcion: t.descripcion ?? null
		}))
		.sort((x, y) => (x.fecha === y.fecha ? x.id_transaccion - y.id_transaccion : x.fecha < y.fecha ? -1 : 1));
}
