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
	/** 'soles' (default) o 'dolares' — ver transaccion.tipo_moneda. `ingreso`/`egreso`/`financiamiento`
	 * y `saldoAcumulado` de esta fila están en ESTA moneda (el saldo acumulado corre por separado para
	 * cada moneda, nunca se suman entre sí — ver getMovimientosCaja). */
	moneda: 'soles' | 'dolares';
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
	/** Lista de ids de centro de costo (ej. todos los de tipo 'obra') — a diferencia de idCentroCosto
	 * (un centro puntual, elegido a mano en el filtro "Proyecto/Servicio"), esto es para los botones
	 * "Consultoría"/"Obra"/"Corporativo"/"Otros" (mismo patrón que idsCentroCosto en
	 * cuentasPagar.service.ts/cuentasCobrar.service.ts) — filtra por el TIPO real del centro de costo,
	 * en cualquiera de los dos lados (origen o destino). Ambos filtros (idCentroCosto/idsCentroCosto)
	 * se pueden combinar; si ambos vienen, se combinan con AND (mismo criterio que el resto de filtros).
	 */
	idsCentroCosto?: number[] | null;
	/** N° de cuenta bancaria (cuenta_banco.numero_cuenta) — filtra movimientos donde esa cuenta sea
	 * origen O destino (misma idea que idCentroCosto: acota "de qué cuenta real es este dinero", así
	 * que también se aplica al saldo inicial, no solo al listado del período, ver getMovimientosCaja). */
	numeroCuentaBanco?: string | null;
	tipo?: TipoMovimiento | null;
	categoria?: string | null;
	/** Filtra por `transaccion.aprobado` — a diferencia de idCentroCosto/numeroCuentaBanco, es un
	 * filtro de presentación (el estado de aprobación no cambia si el dinero es "de" esta cuenta/centro),
	 * así que NO se aplica al saldo inicial, igual que tipo/categoria/search. */
	soloAprobado?: boolean | null;
	/** Filtra por `transaccion.documento_pendiente` — mismo criterio de "presentación" que soloAprobado
	 * de arriba (no se aplica al saldo inicial). */
	documentoPendiente?: 'si' | 'no' | null;
	search?: string;
}

export interface MovimientosCajaResult {
	saldoInicial: number;
	saldoActual: number;
	/** Mismo saldo, pero solo de transacciones en Dólares — corre por separado del saldo en Soles de
	 * arriba, nunca mezclados (a pedido explícito del usuario, "un cuadro más para Saldo Actual en
	 * Dólares"). Antes esta función sumaba monto_total de TODAS las transacciones sin mirar la moneda,
	 * mezclando Soles y Dólares en una sola cifra sin sentido — bug real corregido de paso. */
	saldoActualDolares: number;
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

/** Filtro OR "esta lista de ids como origen O como destino" — extraído porque se repite para
 * idCentroCosto (una lista de 1) e idsCentroCosto (una lista de N, ver Consultoría/Obra/Corporativo/
 * Otros en +page.svelte). PostgREST necesita el .in.(...) con paréntesis dentro del propio .or(). */
function filtroOrigenODestino(ids: number[]): string {
	const lista = ids.join(',');
	return `id_centro_costo_origen.in.(${lista}),id_centro_costo_destino.in.(${lista})`;
}

export async function getMovimientosCaja(client: SupabaseClient, params: MovimientosCajaParams): Promise<MovimientosCajaResult> {
	const centroCostoOptions = await getCentroCostoOptions(client);
	const centroCostoMap = new Map(centroCostoOptions.map((o) => [o.value, o.label]));

	// 1. Saldo inicial: neto de todo lo anterior a `desde` (mismos filtros de centro de costo/cuenta,
	// para que el saldo tenga sentido cuando se filtra por uno específico) — separado por moneda (ver
	// FilaMovimiento.moneda): Soles y Dólares nunca se suman entre sí.
	let queryAntes = client.from('transaccion').select('tipo, monto_total, tipo_moneda').eq('estado', 'activo').lt('fecha', params.desde);
	if (params.idCentroCosto) {
		queryAntes = queryAntes.or(`id_centro_costo_origen.eq.${params.idCentroCosto},id_centro_costo_destino.eq.${params.idCentroCosto}`);
	}
	if (params.idsCentroCosto) {
		// Bug real reportado por el usuario (con captura): un tipo de Centro de Costo elegido (ej.
		// "Consultoría") que hoy no tiene NINGÚN centro real de ese tipo (idsCentroCosto llega como []
		// — no es que el filtro no esté activo) hacía que el `if` de abajo (`.length > 0`) se salteara
		// por completo el filtro, mostrando TODOS los movimientos sin filtrar en vez de ninguno. Con
		// lista vacía, se fuerza una condición imposible (id_centro_costo_origen = -1, un id que nunca
		// existe) para que la consulta devuelva CERO filas, que es la respuesta correcta.
		queryAntes = params.idsCentroCosto.length > 0 ? queryAntes.or(filtroOrigenODestino(params.idsCentroCosto)) : queryAntes.eq('id_centro_costo_origen', -1);
	}
	if (params.numeroCuentaBanco) {
		queryAntes = queryAntes.or(`cuente_origen.eq.${params.numeroCuentaBanco},cuente_destino.eq.${params.numeroCuentaBanco}`);
	}
	const { data: previos, error: errorPrevios } = await queryAntes;
	if (errorPrevios) throw errorPrevios;
	let saldoInicial = 0;
	let saldoInicialDolares = 0;
	for (const t of (previos ?? []) as any[]) {
		if (t.tipo_moneda === 'dolares') saldoInicialDolares += signoMonto(t.tipo, Number(t.monto_total));
		else saldoInicial += signoMonto(t.tipo, Number(t.monto_total));
	}

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
	if (params.idsCentroCosto) {
		// Mismo fix que queryAntes de arriba — ver ese comentario para el bug real que corrige.
		query = params.idsCentroCosto.length > 0 ? query.or(filtroOrigenODestino(params.idsCentroCosto)) : query.eq('id_centro_costo_origen', -1);
	}
	if (params.numeroCuentaBanco) {
		query = query.or(`cuente_origen.eq.${params.numeroCuentaBanco},cuente_destino.eq.${params.numeroCuentaBanco}`);
	}
	if (params.tipo) query = query.eq('tipo', params.tipo);
	if (params.categoria) query = query.eq('categoria', params.categoria);
	if (params.soloAprobado === true) query = query.eq('aprobado', true);
	else if (params.soloAprobado === false) query = query.eq('aprobado', false);
	if (params.documentoPendiente) query = query.eq('documento_pendiente', params.documentoPendiente);
	const search = params.search?.trim();
	if (search) {
		const escaped = search.replace(/[%_]/g, (m) => `\\${m}`);
		query = query.or(`descripcion.ilike.%${escaped}%,num_documento.ilike.%${escaped}%`);
	}

	const { data: rows, error } = await query;
	if (error) throw error;

	// Saldo acumulado corre por separado en cada moneda — una transacción en Dólares nunca mueve el
	// acumulado en Soles, y viceversa (ver FilaMovimiento.moneda/saldoActualDolares).
	let acumulado = saldoInicial;
	let acumuladoDolares = saldoInicialDolares;
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
			moneda: 'soles',
			aprobado: true,
			raw: null
		}
	];

	for (const t of (rows ?? []) as any[]) {
		const monto = Number(t.monto_total);
		const esDolares = t.tipo_moneda === 'dolares';
		if (esDolares) acumuladoDolares += signoMonto(t.tipo, monto);
		else acumulado += signoMonto(t.tipo, monto);

		// Los KPIs "Total Ingresos"/"Pagado (Egresos)"/"Total Financiamiento" son SOLO en Soles (a
		// pedido explícito del usuario, ver "Saldo Actual en Dólares" como cuadro aparte) — antes
		// sumaban monto_total de TODAS las transacciones sin mirar la moneda, mezclando Soles y
		// Dólares en una sola cifra sin sentido.
		if (!esDolares) {
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
			saldoAcumulado: esDolares ? acumuladoDolares : acumulado,
			moneda: esDolares ? 'dolares' : 'soles',
			aprobado: !!t.aprobado,
			raw: t as Transaccion
		});
	}

	return {
		saldoInicial,
		saldoActual: acumulado,
		saldoActualDolares: acumuladoDolares,
		ingresosTotal,
		ingresosCount,
		egresosTotal,
		egresosCount,
		financiamientosTotal,
		financiamientosCount,
		filas
	};
}
