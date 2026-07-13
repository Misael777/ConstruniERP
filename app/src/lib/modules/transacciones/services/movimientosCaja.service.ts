/**
 * Servicio de agregación para "Movimientos de Caja y Financiamiento" — reporte de solo lectura
 * sobre la tabla `transaccion` (no crea/edita nada). Client-side puro (Supabase anon key), igual
 * que el resto del módulo, para funcionar igual en Web/Windows/Android.
 *
 * Solo cuenta las transacciones con estado='activo' (las 'anulado' se excluyen de saldos y KPIs,
 * igual que en el resto del ERP donde 'anulado' significa que el movimiento no ocurrió realmente).
 *
 * AJUSTAR: calcula el saldo acumulado trayendo TODAS las filas del período a memoria y sumando ahí
 * (no hay función SQL en el servidor). Con el volumen actual del ERP esto es instantáneo; si el
 * histórico de transacciones crece mucho, esto debería moverse a una vista o función SQL con
 * SUM() OVER (ORDER BY fecha) en vez de traer todo el período al cliente.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { getCentroCostoOptions } from './transacciones.service';
import type { Transaccion } from './transacciones.service';

export type TipoMovimiento = 'ingreso' | 'egreso' | 'financiamiento';

export interface FilaMovimiento {
	esSaldoInicial: boolean;
	id_transaccion: number | null;
	codigo: string;
	fecha: string;
	tipo: TipoMovimiento | 'saldo_inicial';
	concepto: string;
	centroCostoOrigenLabel: string;
	centroCostoDestinoLabel: string;
	categoria: string | null;
	ingreso: number | null;
	egreso: number | null;
	financiamiento: number | null;
	saldoAcumulado: number;
	aprobado: boolean;
	/** Fila completa de `transaccion` (null para la fila sintética de Saldo Inicial) — se usa para
	 * abrir TransaccionModal en modo edición directo desde la tabla (botón "Ver"), sin refetch. */
	raw: Transaccion | null;
}

export interface MovimientosCajaParams {
	/** Primer día del período, 'YYYY-MM-DD' */
	desde: string;
	/** Último día del período, 'YYYY-MM-DD' */
	hasta: string;
	idCentroCosto?: number | null;
	tipo?: TipoMovimiento | null;
	categoria?: string | null;
	search?: string;
}

export interface MovimientosCajaResult {
	saldoInicial: number;
	saldoActual: number;
	ingresosTotal: number;
	ingresosCount: number;
	egresosTotal: number;
	egresosCount: number;
	financiamientosTotal: number;
	financiamientosCount: number;
	filas: FilaMovimiento[]; // incluye la fila sintética de Saldo Inicial como primera fila
}

/** Ingreso y financiamiento suman al saldo; egreso resta. */
function signoMonto(tipo: string | null, monto: number): number {
	return tipo === 'egreso' ? -monto : monto;
}

/** Código legible por tipo, ej. "ING-0125", "EG-0098", "FIN-0012" — no existe como columna real,
 * se genera al vuelo a partir de tipo + id_transaccion (ver transaccion.config.ts, no hay campo `codigo`). */
export function codigoMovimiento(tipo: string | null, id: number): string {
	const prefijo = tipo === 'ingreso' ? 'ING' : tipo === 'egreso' ? 'EG' : tipo === 'financiamiento' ? 'FIN' : 'MOV';
	return `${prefijo}-${String(id).padStart(4, '0')}`;
}

export async function getMovimientosCaja(client: SupabaseClient, params: MovimientosCajaParams): Promise<MovimientosCajaResult> {
	const centroCostoOptions = await getCentroCostoOptions(client);
	const centroCostoMap = new Map(centroCostoOptions.map((o) => [o.value, o.label]));

	// 1. Saldo inicial: neto de todo lo anterior a `desde` (mismos filtros de centro de costo, para
	// que el saldo tenga sentido cuando se filtra por un centro específico).
	let queryAntes = client.from('transaccion').select('tipo, monto_total').eq('estado', 'activo').lt('fecha', params.desde);
	if (params.idCentroCosto) {
		queryAntes = queryAntes.or(`id_centro_costo_origen.eq.${params.idCentroCosto},id_centro_costo_destino.eq.${params.idCentroCosto}`);
	}
	const { data: previos, error: errorPrevios } = await queryAntes;
	if (errorPrevios) throw errorPrevios;
	const saldoInicial = (previos ?? []).reduce((sum: number, t: any) => sum + signoMonto(t.tipo, Number(t.monto_total)), 0);

	// 2. Movimientos del período, con el resto de los filtros (tipo/categoría/búsqueda).
	let query = client
		.from('transaccion')
		.select('*')
		.eq('estado', 'activo')
		.gte('fecha', params.desde)
		.lte('fecha', params.hasta)
		.order('fecha', { ascending: true })
		.order('id_transaccion', { ascending: true });
	if (params.idCentroCosto) {
		query = query.or(`id_centro_costo_origen.eq.${params.idCentroCosto},id_centro_costo_destino.eq.${params.idCentroCosto}`);
	}
	if (params.tipo) query = query.eq('tipo', params.tipo);
	if (params.categoria) query = query.eq('categoria', params.categoria);
	const search = params.search?.trim();
	if (search) {
		const escaped = search.replace(/[%_]/g, (m) => `\\${m}`);
		query = query.or(`descripcion.ilike.%${escaped}%,num_documento.ilike.%${escaped}%`);
	}

	const { data: rows, error } = await query;
	if (error) throw error;

	let acumulado = saldoInicial;
	let ingresosTotal = 0;
	let ingresosCount = 0;
	let egresosTotal = 0;
	let egresosCount = 0;
	let financiamientosTotal = 0;
	let financiamientosCount = 0;

	const filas: FilaMovimiento[] = [
		{
			esSaldoInicial: true,
			id_transaccion: null,
			codigo: 'SCI-0001',
			fecha: params.desde,
			tipo: 'saldo_inicial',
			concepto: 'Saldo inicial del período',
			centroCostoOrigenLabel: '—',
			centroCostoDestinoLabel: '—',
			categoria: null,
			ingreso: null,
			egreso: null,
			financiamiento: null,
			saldoAcumulado: saldoInicial,
			aprobado: true,
			raw: null
		}
	];

	for (const t of (rows ?? []) as any[]) {
		const monto = Number(t.monto_total);
		acumulado += signoMonto(t.tipo, monto);

		if (t.tipo === 'ingreso') {
			ingresosTotal += monto;
			ingresosCount++;
		} else if (t.tipo === 'egreso') {
			egresosTotal += monto;
			egresosCount++;
		} else if (t.tipo === 'financiamiento') {
			financiamientosTotal += monto;
			financiamientosCount++;
		}

		filas.push({
			esSaldoInicial: false,
			id_transaccion: t.id_transaccion,
			codigo: codigoMovimiento(t.tipo, t.id_transaccion),
			fecha: t.fecha,
			tipo: t.tipo,
			concepto: t.descripcion || t.num_documento || `Transacción #${t.id_transaccion}`,
			centroCostoOrigenLabel: centroCostoMap.get(String(t.id_centro_costo_origen)) ?? `#${t.id_centro_costo_origen}`,
			centroCostoDestinoLabel: centroCostoMap.get(String(t.id_centro_costo_destino)) ?? `#${t.id_centro_costo_destino}`,
			categoria: t.categoria,
			ingreso: t.tipo === 'ingreso' ? monto : null,
			egreso: t.tipo === 'egreso' ? monto : null,
			financiamiento: t.tipo === 'financiamiento' ? monto : null,
			saldoAcumulado: acumulado,
			aprobado: !!t.aprobado,
			raw: t as Transaccion
		});
	}

	return {
		saldoInicial,
		saldoActual: acumulado,
		ingresosTotal,
		ingresosCount,
		egresosTotal,
		egresosCount,
		financiamientosTotal,
		financiamientosCount,
		filas
	};
}
