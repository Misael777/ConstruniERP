/**
 * "Resumen de venta" — a pedido del usuario: el ícono ⓘ de cada fila en Comercial > Ventas abre un resumen de
 * solo lectura de la venta (en borrador o cerrada): sus datos y el cronograma de sus cobros (abonos) con su
 * estado. Se muestra con ResumenCuentaModal.
 *
 * De dónde salen los abonos (antes solo se buscaban Cuentas por Cobrar con id_proyecto, que únicamente llenan
 * las ventas creadas con "Forma de cobranza" — las registradas a mano en Finanzas > Cuentas por Cobrar se veían
 * "Sin cuotas"):
 *   1. Cuentas por Cobrar del proyecto: por id_proyecto, por el Centro de Costo del proyecto, o — sin proyecto
 *      asignado — del mismo cliente cuando este tiene UNA sola venta (así no se atribuyen cobros de otra venta).
 *   2. Ingresos que entraron directo al Centro de Costo del proyecto y no están ya en una cuota cobrada (ej. el
 *      adelanto de una venta anterior a la Forma de cobranza): se muestran como cobrados.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { CuotaResumen } from '$lib/shared/components/ResumenCuentaModal.svelte';
import { getFechaLocalHoy } from '$lib/shared/dateUtils';

export interface ResumenVenta {
	proyecto: Record<string, any> | null;
	cuotas: CuotaResumen[];
	cobrado: number;
	porCobrar: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export async function getResumenVenta(client: SupabaseClient, idProyecto: number): Promise<ResumenVenta> {
	const [{ data: proyecto, error: errProyecto }, { data: centros, error: errCentros }] = await Promise.all([
		client.from('proyecto').select('*, cliente:id_cliente(nombre)').eq('id_proyecto', idProyecto).maybeSingle(),
		client.from('centro_costo').select('id_centro_costo').eq('id_proyecto', idProyecto)
	]);
	if (errProyecto) throw errProyecto;
	if (errCentros) throw errCentros;
	const idsCentros = (centros ?? []).map((c: any) => c.id_centro_costo as number);
	// También el centro al que entró el adelanto de la venta ("Adelanto inicial - ... (proyecto #id)"): si el
	// centro de costo del proyecto fue borrado (pasó con varias obras, ver la migración
	// restaurar_centros_costo_borrados), sus cuentas y abonos siguen apuntando a ese id y así se encuentran igual.
	const { data: adelantos } = await client
		.from('transaccion')
		.select('id_centro_costo_destino')
		.eq('tipo', 'ingreso')
		.ilike('descripcion', `%(proyecto #${idProyecto})%`);
	for (const t of adelantos ?? []) {
		if (t.id_centro_costo_destino && !idsCentros.includes(t.id_centro_costo_destino)) idsCentros.push(t.id_centro_costo_destino);
	}

	// 1. Cuentas por Cobrar de esta venta.
	const filtros = [`id_proyecto.eq.${idProyecto}`];
	if (idsCentros.length) filtros.push(`id_centro_costo.in.(${idsCentros.join(',')})`);
	const { data: cuentas, error: errCuentas } = await client.from('cuentas_cobrar').select('id_cuenta_cobrar, activo').or(filtros.join(','));
	if (errCuentas) throw errCuentas;
	let idsCuentas = (cuentas ?? []).filter((c: any) => c.activo !== false).map((c: any) => c.id_cuenta_cobrar as number);

	if (idsCuentas.length === 0 && proyecto?.id_cliente) {
		const { count } = await client
			.from('proyecto')
			.select('id_proyecto', { count: 'exact', head: true })
			.eq('id_cliente', proyecto.id_cliente)
			.neq('estado_proyecto', 'baja');
		if (count === 1) {
			const { data: delCliente } = await client.from('cuentas_cobrar').select('id_cuenta_cobrar, activo').eq('id_cliente', proyecto.id_cliente).is('id_proyecto', null);
			idsCuentas = (delCliente ?? []).filter((c: any) => c.activo !== false).map((c: any) => c.id_cuenta_cobrar as number);
		}
	}

	const hoy = getFechaLocalHoy();
	const cuotas: CuotaResumen[] = [];
	const txEnCuotas = new Set<number>();
	if (idsCuentas.length > 0) {
		const { data: cobros, error } = await client
			.from('cobros')
			.select('*')
			.in('id_cuenta_cobrar', idsCuentas);
		if (error) throw error;
		for (const c of cobros ?? []) {
			if (c.id_transaccion) txEnCuotas.add(c.id_transaccion);
			cuotas.push({
				id: c.id_cobro,
				monto: Number(c.monto) || 0,
				fecha: c.fecha_cobro,
				concepto: c.referencia ?? null,
				estado: c.estado_cobro === 'cobrado' ? 'pagado' : c.estado_cobro === 'cancelado' ? 'anulado' : c.fecha_cobro && c.fecha_cobro < hoy ? 'vencido' : 'pendiente',
				editable: false,
				detraccionDe: c.es_detraccion ? (c.id_cobro_origen ?? null) : null
			});
		}
	}

	// 2. Ingresos directos al centro de costo del proyecto que no están en ninguna cuota.
	if (idsCentros.length > 0) {
		const { data: ingresos, error } = await client
			.from('transaccion')
			.select('id_transaccion, fecha, monto_total, monto_convertido, tipo_moneda, estado')
			.in('id_centro_costo_destino', idsCentros)
			.eq('tipo', 'ingreso');
		if (error) throw error;
		for (const t of ingresos ?? []) {
			if (txEnCuotas.has(t.id_transaccion) || t.estado === 'anulado') continue;
			const monto = t.tipo_moneda === 'dolares' && t.monto_convertido != null ? Number(t.monto_convertido) : Number(t.monto_total);
			// id negativo: no choca con los id_cobro de las cuotas reales.
			cuotas.push({ id: -t.id_transaccion, monto: monto || 0, fecha: t.fecha, estado: 'pagado', editable: false });
		}
	}

	const cobrado = cuotas.filter((c) => c.estado === 'pagado').reduce((s, c) => s + c.monto, 0);
	const porCobrar = cuotas.filter((c) => c.estado === 'pendiente' || c.estado === 'vencido').reduce((s, c) => s + c.monto, 0);
	return { proyecto: proyecto ?? null, cuotas, cobrado: r2(cobrado), porCobrar: r2(porCobrar) };
}
