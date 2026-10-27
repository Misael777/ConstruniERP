/**
 * Flujo de cierre de venta (a pedido del usuario): al cerrar una venta se muestran, en orden, las transacciones del
 * cierre (adelanto/armadas y sus detracciones), el comprobante (si en una de ellas se eligió "Generar Comprobante" =
 * Sí; uno solo con todas, monto + detracción) y la Cuenta por Cobrar de la venta. Todo ya quedó grabado al cerrar;
 * de Gestión de Comprobantes se sigue a la Cuenta por Cobrar por sessionStorage (CLAVE_FLUJO_CIERRE_VENTA).
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export const CLAVE_FLUJO_CIERRE_VENTA = 'flujoCierreVenta';

export interface FlujoCierreVenta {
	/** Transacciones por revisar, en orden (cada cuota cobrada seguida de su detracción). */
	pasos: number[];
	/** Todas las transacciones del cierre (las mismas de pasos, sin consumir): van juntas en el comprobante. */
	todas: number[];
	idCuentaCobrar: number | null;
	clienteNombre: string;
	proyectoCodigo: string;
}

/**
 * Cuenta por Cobrar de la venta y sus transacciones en el orden del cronograma (por id_cobro: las cuotas se crean
 * como [cuota, su detracción, cuota, su detracción…]). Sin cuenta, solo la transacción que devolvió el cierre.
 */
export async function transaccionesDelCierre(
	client: SupabaseClient,
	idProyecto: number | null,
	idTransaccionCierre: number | null
): Promise<{ pasos: number[]; idCuentaCobrar: number | null }> {
	let idCuentaCobrar: number | null = null;
	let pasos: number[] = [];
	if (idProyecto) {
		const { data: cuenta } = await client
			.from('cuentas_cobrar')
			.select('id_cuenta_cobrar')
			.eq('id_proyecto', idProyecto)
			.eq('activo', true)
			.order('id_cuenta_cobrar', { ascending: false })
			.limit(1)
			.maybeSingle();
		idCuentaCobrar = cuenta?.id_cuenta_cobrar ?? null;
		if (idCuentaCobrar) {
			const { data: cobros } = await client
				.from('cobros')
				.select('id_cobro, id_transaccion')
				.eq('id_cuenta_cobrar', idCuentaCobrar)
				.not('id_transaccion', 'is', null)
				.order('id_cobro', { ascending: true });
			pasos = [...new Set((cobros ?? []).map((c) => Number(c.id_transaccion)))];
		}
	}
	if (!pasos.length && idTransaccionCierre) pasos = [idTransaccionCierre];
	return { pasos, idCuentaCobrar };
}

/**
 * Con "Generar Comprobante" = Sí, todas las transacciones del cierre toman el tipo de comprobante elegido
 * (transaccion.tipo_documento), para que Gestión de Comprobantes las liste juntas en esa pestaña. Solo las que aún no
 * tienen comprobante emitido.
 */
export async function asignarTipoComprobante(client: SupabaseClient, ids: number[], tipoDocumento: string | null | undefined): Promise<void> {
	if (!ids.length || !tipoDocumento) return;
	const { error } = await client.from('transaccion').update({ tipo_documento: tipoDocumento }).in('id_transaccion', ids).is('id_factura', null);
	if (error) console.error('[flujoCierreVenta] No se pudo asignar el tipo de comprobante a las transacciones:', error);
}
