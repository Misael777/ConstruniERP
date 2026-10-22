<script lang="ts">
	/**
	 * Proyectos > Consultoría / Obra (a pedido del usuario): lista de los proyectos (ventas) de ese tipo, con
	 * buscador y Exportar a Excel (exportarXlsx.ts). Los dados de baja no se listan. Solo lectura por ahora.
	 */
	import { onMount } from 'svelte';
	import { supabase } from '$lib/supabaseClient';
	import { toast } from '$lib/stores/toast';
	import { describeError } from '$lib/shared/describeError';
	import { generarCodigoProyecto } from '$lib/shared/codigoProyecto';
	import { exportarTablaXlsx } from '$lib/shared/exportarXlsx';
	import ResponsiveDataView from '$lib/shared/components/ResponsiveDataView.svelte';
	import { Search, X, Download, Loader2 } from '@lucide/svelte';

	let { tipoVenta, titulo, descripcion }: { tipoVenta: 'consultoria' | 'obra'; titulo: string; descripcion: string } = $props();

	interface FilaProyecto {
		id: number;
		codigo: string;
		cliente: string;
		estado: string;
		valor: number;
		fecha: string;
		asesor: string;
	}

	let filas = $state<FilaProyecto[]>([]);
	let cargando = $state(true);
	let busqueda = $state('');
	let exportando = $state(false);

	const columnas = [
		{ label: 'Código de proyecto' },
		{ label: 'Cliente' },
		{ label: 'Estado' },
		{ label: 'Valor venta', align: 'right' as const },
		{ label: 'Fecha de venta' },
		{ label: 'Asesor' }
	];

	function etiquetaEstado(estado: string | null): string {
		return estado === 'venta_cerrada' ? 'Venta Cerrada' : 'En borrador';
	}
	function formatoFecha(iso: string | null): string {
		return iso ? iso.slice(0, 10).split('-').reverse().join('/') : '';
	}
	const soles = (n: number) => `S/ ${n.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

	onMount(async () => {
		try {
			const { data, error } = await supabase
				.from('proyecto')
				.select('*, cliente:id_cliente(nombre)')
				.eq('tipo_venta', tipoVenta)
				.neq('estado_proyecto', 'baja')
				.order('fecha_inicio_plan', { ascending: false });
			if (error) throw error;
			filas = (data ?? []).map((p: any) => ({
				id: p.id_proyecto,
				codigo: generarCodigoProyecto(p) || p.nombre_proyecto || '',
				cliente: p.cliente?.nombre ?? '',
				estado: etiquetaEstado(p.estado_proyecto),
				valor: Number(p.precio_venta) || 0,
				fecha: p.fecha_inicio_plan ?? p.created_at ?? '',
				asesor: p.responsable ?? ''
			}));
		} catch (err) {
			toast.error(`No se pudieron cargar los proyectos. ${describeError(err)}`);
		} finally {
			cargando = false;
		}
	});

	const filtradas = $derived.by(() => {
		const q = busqueda.trim().toLowerCase();
		if (!q) return filas;
		return filas.filter((f) => [f.codigo, f.cliente, f.estado, f.asesor].some((v) => v.toLowerCase().includes(q)));
	});

	async function exportar() {
		exportando = true;
		try {
			await exportarTablaXlsx({
				nombreArchivo: `Proyectos_${titulo.replace(/\s+/g, '_')}`,
				hoja: titulo,
				columnas: [
					{ titulo: 'Código de proyecto', ancho: 42 },
					{ titulo: 'Cliente', ancho: 32 },
					{ titulo: 'Estado', ancho: 16 },
					{ titulo: 'Valor venta', ancho: 16, formato: 'moneda' },
					{ titulo: 'Fecha de venta', ancho: 14 },
					{ titulo: 'Asesor', ancho: 26 }
				],
				filas: filtradas.map((f) => [f.codigo, f.cliente, f.estado, f.valor, formatoFecha(f.fecha), f.asesor])
			});
		} catch (err) {
			toast.error(`No se pudo exportar. ${describeError(err)}`);
		} finally {
			exportando = false;
		}
	}
</script>

<div class="w-full">
	<div class="flex flex-wrap items-start justify-between gap-3 mb-5">
		<div>
			<h1 class="text-xl font-bold text-[#0f3b5e]">{titulo}</h1>
			<p class="text-sm text-slate-500">{descripcion}</p>
		</div>
		<button
			type="button"
			onclick={exportar}
			disabled={exportando || filtradas.length === 0}
			class="flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-300 bg-white text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
		>
			{#if exportando}<Loader2 size={16} class="animate-spin" />{:else}<Download size={16} />{/if} Exportar
		</button>
	</div>

	<div class="mb-4 flex flex-wrap items-center gap-2">
		<div class="relative w-full sm:w-80">
			<Search size={16} class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
			<input
				type="text"
				bind:value={busqueda}
				placeholder="Buscar por código, cliente, estado o asesor..."
				class="w-full pl-9 pr-8 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
			/>
			{#if busqueda}
				<button type="button" onclick={() => (busqueda = '')} class="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600" aria-label="Limpiar búsqueda">
					<X size={14} />
				</button>
			{/if}
		</div>
		<span class="text-xs text-slate-400">{filtradas.length} proyecto{filtradas.length === 1 ? '' : 's'}</span>
	</div>

	<div class="bg-white rounded-xl border border-slate-200 overflow-hidden">
		{#if cargando}
			<div class="flex items-center justify-center gap-2 py-12 text-sm text-slate-400"><Loader2 size={18} class="animate-spin" /> Cargando proyectos…</div>
		{:else}
			<div class="overflow-x-auto">
				<ResponsiveDataView items={filtradas} keyField="id" columns={columnas} emptyMessage="No hay proyectos que coincidan.">
					{#snippet row(f)}
						<td class="px-5 py-3 font-medium text-slate-800"><div class="max-w-[320px] break-words">{f.codigo}</div></td>
						<td class="px-5 py-3 text-slate-600">{f.cliente || '—'}</td>
						<td class="px-5 py-3">
							<span class={`text-[10px] font-bold px-2.5 py-1 rounded-md border whitespace-nowrap ${f.estado === 'Venta Cerrada' ? 'bg-emerald-50 text-emerald-600 border-emerald-200' : 'bg-amber-50 text-amber-600 border-amber-200'}`}>{f.estado}</span>
						</td>
						<td class="px-5 py-3 text-right font-semibold text-slate-700 whitespace-nowrap">{soles(f.valor)}</td>
						<td class="px-5 py-3 text-slate-600 whitespace-nowrap">{formatoFecha(f.fecha)}</td>
						<td class="px-5 py-3 text-slate-600">{f.asesor || '—'}</td>
					{/snippet}
					{#snippet card(f)}
						<div class="font-semibold text-slate-800 break-words">{f.codigo}</div>
						<div class="text-xs text-slate-500 mt-0.5">{f.cliente || '—'}</div>
						<div class="mt-2 flex items-center justify-between gap-2">
							<span class={`text-[10px] font-bold px-2.5 py-1 rounded-md border ${f.estado === 'Venta Cerrada' ? 'bg-emerald-50 text-emerald-600 border-emerald-200' : 'bg-amber-50 text-amber-600 border-amber-200'}`}>{f.estado}</span>
							<span class="font-bold text-slate-800">{soles(f.valor)}</span>
						</div>
						<div class="mt-1 flex items-center justify-between text-[11px] text-slate-400">
							<span>{formatoFecha(f.fecha)}</span><span>{f.asesor}</span>
						</div>
					{/snippet}
				</ResponsiveDataView>
			</div>
		{/if}
	</div>
</div>
