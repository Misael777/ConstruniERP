/**
 * Arma el texto del mensaje "Msje" (antes botón "R2" dentro de Nueva/Editar Transacción) — a pedido
 * explícito del usuario, se sacó del modal y ahora vive junto a cada proyecto en la lista de
 * finanzas/tranzacciones (ver +page.svelte), disponible sin necesidad de abrir la transacción para
 * editarla. Función pura extraída tal cual del modal (mismo formato de mensaje, sin cambios) para que
 * ambos lugares — si en algún momento se necesitara de nuevo desde el modal — arme exactamente el mismo
 * texto.
 */
import { formatCurrency } from './fieldConfig';
import type { DetalleCategoria } from '$lib/modules/transacciones/services/transacciones.service';

export interface DatosMensajeR2 {
	userName: string;
	montoTotal: number;
	/** "Proveedor"/"Subcontratista"/"Empleado"/"Cliente"/"Centro de costo destino" — ver
	 * getClaseCentroCosto en transacciones.service.ts. */
	clase: string;
	nombreDestino: string;
	detalleCategoria: DetalleCategoria[];
}

/** Con la fecha ACTUAL (no la fecha del pago) y, si hay filas en "Detalle", un desglose línea por línea
 * ("S/1000 para planilla de semana 1", etc.) — a pedido explícito del usuario. */
export function armarMensajeR2(datos: DatosMensajeR2): string {
	const fechaHoy = new Date().toLocaleDateString('es-PE', { day: '2-digit', month: 'short', year: 'numeric' });
	let mensaje = `Yo ${datos.userName || 'Usuario'}, he pagado ${formatCurrency(datos.montoTotal)} por el pago de ${datos.clase} al nombre de ${datos.nombreDestino}, con fecha ${fechaHoy}.`;

	// Registro por registro (a pedido explícito del usuario): cada fila de Detalle completa, no
	// resumida — Subcategoría, Descripción (si tiene), Cantidad/Unidad/Precio unitario y Total.
	const filasConDatos = datos.detalleCategoria.filter((f) => f.subcategoria.trim());
	if (filasConDatos.length > 0) {
		const lineas = filasConDatos
			.map((f, i) => {
				const cantidad = Number(f.cantidad) || 0;
				const precioUnitario = Number(f.precio_unitario) || 0;
				const total = cantidad * precioUnitario;
				const descripcion = f.descripcion?.trim() ? ` (${f.descripcion.trim()})` : '';
				return `${i + 1}. ${f.subcategoria}${descripcion}: ${cantidad} ${f.unidad ?? ''} x ${formatCurrency(precioUnitario)} = ${formatCurrency(total)}`;
			})
			.join('\n');
		mensaje += `\n\nDetalladamente se pagó:\n${lineas}`;
	}
	return mensaje;
}
