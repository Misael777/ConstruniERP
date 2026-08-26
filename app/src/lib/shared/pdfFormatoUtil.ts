/**
 * Formateadores de fecha/monto compartidos por los comprobantes/recibos autogenerados en PDF
 * (comprobanteTransferenciaInterna.ts, reciboPagoEfectivo.ts) — mismo criterio de fecha larga en
 * español y monto en soles en ambos documentos.
 */

export function formatearFechaLarga(fechaIso: string): string {
	const [anio, mes, dia] = fechaIso.split('-');
	const meses = [
		'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
		'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'
	];
	const mesTexto = meses[Number(mes) - 1] ?? mes;
	return `${Number(dia)} de ${mesTexto} de ${anio}`;
}

export function formatearFechaCorta(fechaIso: string): string {
	const [anio, mes, dia] = fechaIso.split('-');
	return `${dia}/${mes}/${anio}`;
}

export function formatearMonto(monto: number): string {
	return `S/ ${monto.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
