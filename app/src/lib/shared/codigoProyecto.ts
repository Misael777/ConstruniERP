/**
 * Código del proyecto — el mismo "Código generado" que muestra Nueva Venta (ver `codigoGenerado` en
 * NuevaVentaModal.svelte). Ahí es solo una vista previa: NUNCA se guarda en una columna propia de
 * `proyecto`, así que cualquier pantalla que necesite mostrarlo tiene que recalcularlo a partir de
 * los campos ya guardados de la venta. Eso es lo que hace este módulo.
 */

import { sanitizeFileSegment } from './fileNaming';

export type ProyectoCodigoFields = {
	tipo_venta?: string | null;
	// Consultoría
	tip_proyecto?: string | null;
	estado_predio?: string | null;
	tipo_edifica?: string | null;
	// Obra
	tipo_obra?: string | null;
	tipo_tramite?: string | null;
	tipo_intervencion?: string | null;
	tipo_edificacion_obra?: string | null;
	mes_obra?: string | null;
	anio_obra?: number | string | null;
	// Comunes
	nro_pisos?: number | string | null;
	distrito?: string | null;
	/** Distrito SIN truncar — a diferencia de `distrito` (columna VARCHAR(4)), esta guarda el nombre
	 * completo y, en Obra, el número consecutivo que distingue proyectos repetidos en el mismo
	 * distrito, PEGADO sin separador (ej. "Breña1", ver resolverNumeroDistrito en
	 * NuevaVentaModal.svelte). Se prefiere sobre `distrito` cuando está presente. */
	ubicacion?: string | null;
	fecha_inicio_plan?: string | null;
	created_at?: string | null;
	cliente?: { nombre?: string | null } | null;
	clienteNombre?: string | null;
};

/** Mes/año (año a 2 dígitos) de la fecha de la venta. Las fechas "solo día" (YYYY-MM-DD, como
 * fecha_inicio_plan) se leen del string en vez de pasar por `new Date()`: esa interpreta el string
 * como medianoche UTC y, releído en hora local (Perú, UTC-5), un día 1 se corría al mes anterior —
 * mismo motivo por el que formatDate del listado de Ventas hace lo propio. */
function mesAnioDeFecha(value: string | null | undefined): { mes: string; anio: string } {
	if (!value) return { mes: '', anio: '' };
	if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
		const [year, month] = value.split('-');
		return { mes: month, anio: year.slice(2) };
	}
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return { mes: '', anio: '' };
	return { mes: String(date.getMonth() + 1).padStart(2, '0'), anio: String(date.getFullYear()).slice(2) };
}

/**
 * Arma el código del proyecto según su tipo de venta — ambos de selección ÚNICA (a pedido del
 * usuario, sin checkboxes ni combinaciones con "+"):
 *  - Obra:        `{Tipo de Servicio}_{Permiso Municipal}{Alcance de Obra}{Tipo de Contratación}{pisos}_{distrito+Nº}_{mesObra}{añoObra}_{cliente}`
 *    (ej. "OBRA_LGC5_Ate1_0525_ClienteSAC" — reestructurado a pedido del usuario según una imagen de
 *    referencia; usa el mes/año propios de la pestaña Obra — mes_obra/anio_obra — no los de la fecha
 *    de venta. Todo separado por "_", sin guion medio).
 *  - Consultoría: `{tipo}{estadoPredio}{edificación}{pisos}_{mes}{año}_{distrito}_{cliente}`
 *    (mes/año derivados de la fecha de la venta; SIN prefijo — a pedido explícito del usuario, ya no
 *    lleva "CONS_" ni ningún otro).
 */
export function generarCodigoProyecto(p: ProyectoCodigoFields): string {
	const cliente = sanitizeFileSegment((p.clienteNombre || p.cliente?.nombre || '').trim() || 'Cliente');
	const distrito = sanitizeFileSegment(p.ubicacion || p.distrito || '');
	const pisos = p.nro_pisos ?? '';

	if (p.tipo_venta === 'obra') {
		const anioObra = p.anio_obra != null ? String(p.anio_obra).slice(-2) : '';
		return `${p.tipo_obra ?? ''}_${p.tipo_tramite ?? ''}${p.tipo_intervencion ?? ''}${p.tipo_edificacion_obra ?? ''}${pisos}_${distrito}_${p.mes_obra ?? ''}${anioObra}_${cliente}`;
	}

	const { mes, anio } = mesAnioDeFecha(p.fecha_inicio_plan || p.created_at);
	return `${p.tip_proyecto ?? ''}${p.estado_predio ?? ''}${p.tipo_edifica ?? ''}${pisos}_${mes}${anio}_${distrito}_${cliente}`;
}
