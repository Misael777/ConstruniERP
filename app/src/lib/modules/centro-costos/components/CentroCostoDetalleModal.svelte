<script lang="ts">
	import { X, Link, Loader2 } from '@lucide/svelte';
	import { supabase } from '$lib/supabaseClient';
	import { getOptionLabel, formatCurrency, FIELDS_CONFIG } from '$lib/modules/centro-costos/config/centroCostos.config';
	import { resolveEntidadVinculada } from '$lib/modules/centro-costos/services/centroCostos.service';
	import type { CentroCosto, EntidadVinculada } from '$lib/modules/centro-costos/services/centroCostos.service';

	let {
		open = false,
		centro = null,
		onClose
	}: {
		open?: boolean;
		centro: CentroCosto | null;
		onClose: () => void;
	} = $props();

	let linkedEntity = $state<EntidadVinculada | null>(null);
	let loadingLink = $state(false);
	const tipoField = FIELDS_CONFIG.find((f) => f.key === 'tipo')!;

	function fmtDate(value: string | null | undefined) {
		if (!value) return '—';
		const date = new Date(value);
		if (Number.isNaN(date.getTime())) return '—';
		// timeZone: 'UTC' evita el corrimiento de un día que 'new Date("YYYY-MM-DD")' produce en husos
		// horarios detrás de UTC (Perú, UTC-5) al leerse de vuelta en hora local.
		return date.toLocaleDateString('es-PE', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'UTC' });
	}

	// Recarga la entidad vinculada cada vez que se abre el panel para un centro distinto.
	$effect(() => {
		if (open && centro) {
			loadingLink = true;
			resolveEntidadVinculada(supabase, centro)
				.then((res) => (linkedEntity = res))
				.finally(() => (loadingLink = false));
		} else {
			linkedEntity = null;
		}
	});
</script>

{#if open && centro}
	<div class="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
		<div class="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
			<div class="sticky top-0 flex items-center justify-between bg-white px-6 py-4 border-b border-slate-200 z-10">
				<h2 class="text-lg font-semibold text-[#0f3b5e]">Detalle del Centro de Costo</h2>
				<button
					type="button"
					onclick={onClose}
					class="p-1 hover:bg-slate-100 rounded-full text-slate-500"
					aria-label="Cerrar"
				>
					<X size={20} />
				</button>
			</div>

			<div class="p-6 space-y-4">
				<div>
					<p class="text-xl font-bold text-[#0f3b5e]">{centro.nombre}</p>
					<p class="text-sm text-slate-400">{centro.codigo}</p>
				</div>

				<dl class="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
					<div>
						<dt class="text-slate-400 text-xs uppercase tracking-wide">Tipo</dt>
						<dd class="text-slate-700 font-medium">{getOptionLabel(tipoField, centro.tipo)}</dd>
					</div>
					<div>
						<dt class="text-slate-400 text-xs uppercase tracking-wide">Monto Actual</dt>
						<dd class="text-slate-700 font-medium">{formatCurrency(centro.monto_actual)}</dd>
					</div>
					<div class="col-span-2">
						<dt class="text-slate-400 text-xs uppercase tracking-wide">Creado</dt>
						<dd class="text-slate-700 font-medium">{fmtDate(centro.created_at)}</dd>
					</div>
				</dl>

				<div>
					<p class="text-slate-400 text-xs uppercase tracking-wide mb-1">Descripción</p>
					{#if centro.descripcion}
						<p class="text-sm text-slate-700 whitespace-pre-wrap">{centro.descripcion}</p>
					{:else}
						<p class="text-sm text-slate-400 italic">Sin descripción.</p>
					{/if}
				</div>

				<div>
					<p class="text-slate-400 text-xs uppercase tracking-wide mb-1">Entidad vinculada</p>
					{#if loadingLink}
						<div class="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-400">
							<Loader2 size={14} class="animate-spin" /> Buscando entidad vinculada...
						</div>
					{:else if linkedEntity}
						<div class="flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-800">
							<Link size={16} class="shrink-0" />
							<span
								>{linkedEntity.tipo}: <strong>{linkedEntity.nombre}</strong>
								<span class="text-blue-500">(#{linkedEntity.id})</span></span
							>
						</div>
					{:else}
						<div class="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-500">
							Centro de costo manual — no está vinculado a ningún proyecto, cliente, proveedor ni empleado.
						</div>
					{/if}
				</div>
			</div>

			<div class="sticky bottom-0 flex justify-end bg-white px-6 py-4 border-t border-slate-200">
				<button
					type="button"
					onclick={onClose}
					class="px-4 py-2 text-sm font-medium rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50"
				>
					Cerrar
				</button>
			</div>
		</div>
	</div>
{/if}
