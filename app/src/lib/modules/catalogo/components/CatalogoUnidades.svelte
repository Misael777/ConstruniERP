<script lang="ts">
	/**
	 * Catálogo → Unidades: unidades de medida que usan los recursos (bol, kg, m3, hh...). Alta, edición de la
	 * descripción y activar/desactivar (una unidad desactivada deja de ofrecerse al crear recursos, pero los
	 * recursos que ya la usan la conservan). Sin borrado: se desactiva.
	 */
	import { onMount } from 'svelte';
	import { supabase } from '$lib/supabaseClient';
	import { toast } from '$lib/stores/toast';
	import { describeError } from '$lib/shared/describeError';
	import { exportarTablaXlsx } from '$lib/shared/exportarXlsx';
	import { getUnidades, guardarUnidad, cambiarEstadoUnidad, type UnidadMedida } from '$lib/modules/catalogo/services/catalogo.service';
	import { Plus, Download, Loader2, Pencil, Check, X, Power } from '@lucide/svelte';

	let unidades = $state<UnidadMedida[]>([]);
	let cargando = $state(true);
	let exportando = $state(false);
	let nueva = $state({ codigo: '', descripcion: '' });
	let editando = $state<string | null>(null);
	let descripcionEditada = $state('');

	async function cargar() {
		cargando = true;
		try {
			unidades = await getUnidades(supabase, true);
		} catch (err) {
			toast.error(describeError(err));
		} finally {
			cargando = false;
		}
	}
	onMount(cargar);

	async function agregar() {
		const r = await guardarUnidad(supabase, nueva, true);
		if (!r.success) return toast.error(r.message);
		toast.success(r.message);
		nueva = { codigo: '', descripcion: '' };
		await cargar();
	}
	async function guardarEdicion(u: UnidadMedida) {
		const r = await guardarUnidad(supabase, { codigo: u.codigo, descripcion: descripcionEditada }, false);
		if (!r.success) return toast.error(r.message);
		editando = null;
		await cargar();
	}
	async function alternar(u: UnidadMedida) {
		const r = await cambiarEstadoUnidad(supabase, u.codigo, !u.activo);
		if (!r.success) return toast.error(r.message);
		toast.success(r.message);
		await cargar();
	}
	async function exportar() {
		exportando = true;
		try {
			await exportarTablaXlsx({ nombreArchivo: 'Catalogo_unidades', hoja: 'Unidades', columnas: [{ titulo: 'Código', ancho: 10 }, { titulo: 'Descripción', ancho: 30 }, { titulo: 'Estado', ancho: 12 }], filas: unidades.map((u) => [u.codigo, u.descripcion, u.activo ? 'Activa' : 'Inactiva']) });
		} catch (err) {
			toast.error(`No se pudo exportar. ${describeError(err)}`);
		} finally {
			exportando = false;
		}
	}
</script>

<div class="flex flex-wrap items-start justify-between gap-3 mb-4">
	<div>
		<h1 class="text-xl font-bold text-[#0f3b5e]">Unidades de medida</h1>
		<p class="text-sm text-slate-500">Unidades disponibles para los recursos del catálogo.</p>
	</div>
	<button type="button" onclick={exportar} disabled={exportando || unidades.length === 0} class="flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
		{#if exportando}<Loader2 size={16} class="animate-spin" />{:else}<Download size={16} />{/if} Exportar
	</button>
</div>

<div class="max-w-2xl rounded-xl border border-slate-200 bg-white">
	<div class="flex flex-wrap items-end gap-2 border-b border-slate-100 p-3">
		<div class="w-28">
			<label for="um-codigo" class="block text-xs font-medium text-slate-600 mb-1">Código</label>
			<input id="um-codigo" type="text" maxlength="10" bind:value={nueva.codigo} placeholder="Ej. bol" class="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm lowercase focus:outline-none focus:ring-2 focus:ring-blue-200" />
		</div>
		<div class="min-w-0 flex-1">
			<label for="um-desc" class="block text-xs font-medium text-slate-600 mb-1">Descripción</label>
			<input id="um-desc" type="text" maxlength="60" bind:value={nueva.descripcion} placeholder="Ej. Bolsa" onkeydown={(e) => e.key === 'Enter' && agregar()} class="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200" />
		</div>
		<button type="button" onclick={agregar} class="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-700"><Plus size={15} /> Agregar</button>
	</div>
	{#if cargando}
		<div class="flex items-center justify-center gap-2 py-10 text-sm text-slate-400"><Loader2 size={18} class="animate-spin" /> Cargando unidades…</div>
	{:else}
		<table class="w-full text-sm">
			<thead>
				<tr class="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
					<th class="text-left px-3 py-2.5 w-24">Código</th>
					<th class="text-left px-3 py-2.5">Descripción</th>
					<th class="text-left px-3 py-2.5 w-24">Estado</th>
					<th class="text-center px-3 py-2.5 w-24">Acciones</th>
				</tr>
			</thead>
			<tbody class="divide-y divide-slate-100">
				{#each unidades as u (u.codigo)}
					<tr class={u.activo ? '' : 'opacity-60'}>
						<td class="px-3 py-2 font-medium text-slate-700">{u.codigo}</td>
						<td class="px-3 py-2 text-slate-600">
							{#if editando === u.codigo}
								<input type="text" maxlength="60" bind:value={descripcionEditada} onkeydown={(e) => e.key === 'Enter' && guardarEdicion(u)} class="w-full rounded border border-slate-300 px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-300" />
							{:else}{u.descripcion}{/if}
						</td>
						<td class="px-3 py-2"><span class={`rounded-full px-2 py-0.5 text-[11px] font-medium ${u.activo ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'}`}>{u.activo ? 'Activa' : 'Inactiva'}</span></td>
						<td class="px-3 py-2">
							<div class="flex items-center justify-center gap-1">
								{#if editando === u.codigo}
									<button type="button" onclick={() => guardarEdicion(u)} class="rounded p-1.5 text-emerald-600 hover:bg-emerald-50" aria-label="Guardar"><Check size={15} /></button>
									<button type="button" onclick={() => (editando = null)} class="rounded p-1.5 text-slate-400 hover:bg-slate-100" aria-label="Cancelar"><X size={15} /></button>
								{:else}
									<button type="button" onclick={() => { editando = u.codigo; descripcionEditada = u.descripcion; }} class="rounded p-1.5 text-slate-500 hover:bg-blue-50 hover:text-blue-600" title="Editar descripción" aria-label="Editar"><Pencil size={15} /></button>
									<button type="button" onclick={() => alternar(u)} class="rounded p-1.5 text-slate-500 hover:bg-slate-100" title={u.activo ? 'Desactivar' : 'Activar'} aria-label={u.activo ? 'Desactivar' : 'Activar'}><Power size={15} /></button>
								{/if}
							</div>
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	{/if}
</div>
