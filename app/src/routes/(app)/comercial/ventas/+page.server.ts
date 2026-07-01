import { supabase } from '$lib/server/supabase';
import type { PageServerLoad } from './$types';

const MONTH_NAMES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

function formatDate(value: string | Date | null | undefined) {
	if (!value) return '';
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return '';
	const day = String(date.getDate()).padStart(2, '0');
	const month = String(date.getMonth() + 1).padStart(2, '0');
	const year = date.getFullYear();
	return `${day}/${month}/${year}`;
}

function getInitials(name: string) {
	return name
		.split(' ')
		.filter(Boolean)
		.slice(0, 2)
		.map(part => part[0]?.toUpperCase() || '')
		.join('')
		|| 'NA';
}

function mapProjectType(code: string) {
	switch (code) {
		case 'O': return 'Proyecto de Obra';
		case 'M': return 'Mantenimiento';
		case 'A': return 'Ampliación';
		case 'N': return 'Nuevo';
		case 'U': return 'Viv. Unifamiliar';
		case 'C': return 'Comercial';
		default: return code || 'Otros';
	}
}

export const load: PageServerLoad = async () => {
	try {
		const { data, error } = await supabase
			.from('proyecto')
			.select('id_proyecto,nombre_proyecto,precio_venta,tip_proyecto,tipo_edifica,fecha_inicio_plan,created_at,comision_asesor,responsable')
			.order('fecha_inicio_plan', { ascending: false })
			.limit(100);

		if (error) throw error;

		const proyectos = data || [];

		const tipoCounts: Record<string, number> = {};
		const asesorMap = new Map<string, { ventas: number; count: number }>();
		const ventasPorMes = Array(12).fill(0);
		const comisionesPorMes = Array(12).fill(0);
		const ventas = proyectos.map((project: any) => {
			const valor = Number(project.precio_venta) || 0;
			const comisionPct = Number(project.comision_asesor) || 10;
			const tipoRaw = String(project.tip_proyecto || project.tipo_edifica || 'Otros');
			const tipo = mapProjectType(tipoRaw);
			const fechaRaw = project.fecha_inicio_plan || project.created_at;
			const fecha = formatDate(fechaRaw);
			const date = fechaRaw ? new Date(fechaRaw) : null;

			if (date && !Number.isNaN(date.getTime())) {
				ventasPorMes[date.getMonth()] += valor;
				comisionesPorMes[date.getMonth()] += valor * (comisionPct / 100);
			}

			tipoCounts[tipo] = (tipoCounts[tipo] || 0) + 1;

			const asesor = String((project.asesor_comercial_id ?? project.responsable) || 'Sin asignar');
			const asesorData = asesorMap.get(asesor) || { ventas: 0, count: 0 };
			asesorData.ventas += valor;
			asesorData.count += 1;
			asesorMap.set(asesor, asesorData);

			return {
				id: project.id_proyecto,
				proyecto: project.nombre_proyecto || 'Proyecto sin nombre',
				valor,
				tipo,
				fecha,
				asesor,
				asesorInitials: getInitials(asesor),
				comisionPct,
				comision: Math.round(valor * (comisionPct / 100))
			};
		});

		const ventasCerradas = ventas.length;
		const valorTotal = ventas.reduce((sum, row) => sum + row.valor, 0);
		const comisionTotal = ventas.reduce((sum, row) => sum + row.comision, 0);
		const ticketPromedio = ventasCerradas ? Math.round(valorTotal / ventasCerradas) : 0;
		const tasaCierre = 0;

		const sortedAsesores = Array.from(asesorMap.entries())
			.sort(([, a], [, b]) => b.ventas - a.ventas)
			.slice(0, 5)
			.map(([nombre, stats]) => ({
				nombre,
				ventas: stats.ventas,
				max: stats.ventas,
				color: 'bg-blue-500'
			}));

		const tipoLabels = Object.keys(tipoCounts);
		const tipoData = Object.values(tipoCounts);

		return {
			ventas,
			kpis: {
				ventasCerradas,
				valorTotal,
				comisionTotal,
				ticketPromedio,
				tasaCierre
			},
			summary: {
				tipoLabels,
				tipoData,
				topAsesores: sortedAsesores,
				asesorCount: asesorMap.size
			},
			charts: {
				labels: MONTH_NAMES,
				ventasPorMes,
				propuestasPorMes: ventasPorMes.map((value) => Math.round(value * 1.25)),
				comisionesPorMes
			}
		};
	} catch (err) {
		console.warn('[Ventas] No se pudo cargar la información de la base de datos:', err);
		return {
			ventas: [],
			kpis: {
				ventasCerradas: 0,
				valorTotal: 0,
				comisionTotal: 0,
				ticketPromedio: 0,
				tasaCierre: 0
			},
			summary: {
				tipoLabels: [],
				tipoData: [],
				topAsesores: [],
				asesorCount: 0
			},
			charts: {
				labels: MONTH_NAMES,
				ventasPorMes: Array(12).fill(0),
				propuestasPorMes: Array(12).fill(0),
				comisionesPorMes: Array(12).fill(0)
			}
		};
	}
};
