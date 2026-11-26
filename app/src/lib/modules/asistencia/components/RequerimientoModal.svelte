<script lang="ts">
	/** Agregar o editar un requerimiento de personal de la obra (ticket #118, 26/11/2026): cargo, cuántos, aptitudes
	 * requeridas y una tarifa diaria de referencia para estimar el costo de las vacantes. */
	import { fade, scale } from 'svelte/transition';
	import { CARGOS_POR_AREA } from '$lib/modules/personal/services/personal.service';
	import AptitudesInput from './AptitudesInput.svelte';
	import InputConLista from '$lib/shared/components/InputConLista.svelte';
	const OPCIONES_CARGO = CARGOS_POR_AREA.flatMap((a) => a.grupos.flatMap((g) => g.cargos.map((c) => ({ value: c, grupo: `${a.area} · ${g.grupo}` }))));
	import type { RequerimientoTareo } from '../services/tareo.service';

	let {
		open,
		inicial,
		sugerencias,
		guardando = false,
		onguardar,
		oncerrar
	}: {
		open: boolean;
		inicial: RequerimientoTareo | null;
		sugerencias: string[];
		guardando?: boolean;
		onguardar: (r: RequerimientoTareo) => void;
		oncerrar: () => void;
	} = $props();

	let cargo = $state('');
	let cantidad = $state('1');
	let aptitudes = $state<string[]>([]);
	let tarifa = $state('');
	let error = $state('');

	$effect(() => {
		if (!open || !inicial) return;
		cargo = inicial.cargo;
		cantidad = String(inicial.cantidad || 1);
		aptitudes = [...inicial.aptitudes];
		tarifa = inicial.tarifa_dia ? String(inicial.tarifa_dia) : '';
		error = '';
	});

	function guardar() {
		const n = Number(cantidad);
		const t = tarifa.trim() ? Number(tarifa.replace(',', '.')) : null;
		if (!cargo.trim()) return void (error = 'Elige o escribe el cargo requerido.');
		if (!Number.isInteger(n) || n < 1 || n > 999) return void (error = 'La cantidad debe ser un número entero entre 1 y 999.');
		if (t != null && (!Number.isFinite(t) || t < 0)) return void (error = 'La tarifa diaria no es válida.');
		onguardar({ ...inicial!, cargo: cargo.trim(), cantidad: n, aptitudes, tarifa_dia: t });
	}
</script>

{#if open && inicial}
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" transition:fade={{ duration: 120 }}>
		<div class="w-full max-w-lg bg-white rounded-2xl shadow-xl flex flex-col max-h-[90vh]" transition:scale={{ duration: 150, start: 0.97 }} role="dialog" aria-modal="true" aria-labelledby="req-titulo">
			<div class="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
				<h3 id="req-titulo" class="font-bold text-slate-800">{inicial.id_requerimiento ? 'Editar requerimiento' : 'Agregar requerimiento'}</h3>
				<button type="button" onclick={oncerrar} class="w-8 h-8 rounded-full text-slate-400 hover:bg-slate-100" aria-label="Cerrar"><i class="fas fa-xmark"></i></button>
			</div>
			<div class="px-5 py-4 flex flex-col gap-4 overflow-y-auto">
				<label class="flex flex-col gap-1 text-sm font-medium text-slate-700">
					Cargo requerido
					<InputConLista bind:value={cargo} opciones={OPCIONES_CARGO} maxlength={100} placeholder="Ej. Operario albañil" class="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm font-normal" />
					<span class="text-xs font-normal text-slate-400">Los trabajadores con este cargo en su ficha de Personal cuentan como asignados.</span>
				</label>
				<div class="grid grid-cols-2 gap-3">
					<label class="flex flex-col gap-1 text-sm font-medium text-slate-700">
						Requeridos
						<input type="number" min="1" max="999" step="1" bind:value={cantidad} class="px-3 py-2 border border-slate-200 rounded-lg text-sm font-normal" />
					</label>
					<label class="flex flex-col gap-1 text-sm font-medium text-slate-700">
						Tarifa diaria de referencia S/
						<input type="text" inputmode="decimal" bind:value={tarifa} placeholder="Opcional" class="px-3 py-2 border border-slate-200 rounded-lg text-sm font-normal text-right" />
					</label>
				</div>
				<div class="flex flex-col gap-1 text-sm font-medium text-slate-700">
					<label for="req-aptitudes">Aptitudes requeridas</label>
					<AptitudesInput id="req-aptitudes" bind:value={aptitudes} {sugerencias} />
					<span class="text-xs font-normal text-slate-400">El tareo muestra si cada trabajador las cumple (según las aptitudes de su ficha de Personal).</span>
				</div>
				<p class="text-xs text-slate-500">La tarifa de referencia solo sirve para estimar el costo de los puestos aún sin cubrir; si la dejas vacía se usa el promedio de los asignados.</p>
				{#if error}<span class="text-sm text-rose-600">{error}</span>{/if}
			</div>
			<div class="px-5 py-3 border-t border-slate-100 flex justify-end gap-2">
				<button type="button" onclick={oncerrar} disabled={guardando} class="px-4 py-2 rounded-xl border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50">Cancelar</button>
				<button type="button" onclick={guardar} disabled={guardando} class="px-4 py-2 rounded-xl bg-orange-500 text-white text-sm font-bold hover:bg-orange-600 disabled:opacity-50">{guardando ? 'Guardando…' : 'Guardar'}</button>
			</div>
		</div>
	</div>
{/if}
