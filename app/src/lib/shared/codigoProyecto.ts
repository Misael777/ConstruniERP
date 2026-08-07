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
 * Arma el código del proyecto según su tipo de venta:
 *  - Obra:        `{OBRA|SUP}-{trámite}({intervención})({edificación}){pisos}_{mesObra}{añoObra}_{distrito}_{cliente}`
 *    (usa el mes/año propios de la pestaña Obra — mes_obra/anio_obra — no los de la fecha de venta)
 *  - Consultoría: `EXP_({tipo})({estadoPredio})({edificación}){pisos}_{mes}{año}_{distrito}_{cliente}`
 *    (mes/año derivados de la fecha de la venta; prefijo "EXP_" — de "Expediente" — a pedido del
 *    usuario, Obra no lo lleva porque ya arranca con su propio prefijo OBRA-/SUP-). `tip_proyecto`,
 *    `estado_predio`, `tipo_edifica` (Consultoría) y `tipo_intervencion`, `tipo_edificacion_obra`
 *    (Obra) admiten VARIAS alternativas a la vez (checkboxes en NuevaVentaModal.svelte): se guardan en
 *    BD como letras unidas por "+" (ej. "L+O") y acá se muestran entre paréntesis, ej.
 *    "(L+O)(A+R)(M+I)" — mismo criterio que codigoGenerado en el modal.
 */
export function generarCodigoProyecto(p: ProyectoCodigoFields): string {
	const cliente = sanitizeFileSegment((p.clienteNombre || p.cliente?.nombre || '').trim() || 'Cliente');
	const distrito = sanitizeFileSegment(p.distrito ?? '');
	const pisos = p.nro_pisos ?? '';

	if (p.tipo_venta === 'obra') {
		const anioObra = p.anio_obra != null ? String(p.anio_obra).slice(-2) : '';
		return `${p.tipo_obra ?? ''}-${p.tipo_tramite ?? ''}(${p.tipo_intervencion ?? ''})(${p.tipo_edificacion_obra ?? ''})${pisos}_${p.mes_obra ?? ''}${anioObra}_${distrito}_${cliente}`;
	}

	const { mes, anio } = mesAnioDeFecha(p.fecha_inicio_plan || p.created_at);
	return `EXP_(${p.tip_proyecto ?? ''})(${p.estado_predio ?? ''})(${p.tipo_edifica ?? ''})${pisos}_${mes}${anio}_${distrito}_${cliente}`;
}
