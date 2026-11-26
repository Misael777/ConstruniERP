<script lang="ts">
	/** Registrar un cambio de remuneración o editar un tramo del historial (ticket #144, 26/11/2026). */
	import { fade, scale } from 'svelte/transition';
	import { PERIODICIDADES_PAGO, type RemuneracionHistorial } from '../services/personal.service';

	let {
		open,
		inicial,
		soloLectura = false,
		onguardar,
		oncerrar
	}: {
		open: boolean;
		inicial: RemuneracionHistorial | null;
		soloLectura?: boolean;
		onguardar: (r: RemuneracionHistorial) => void;
		oncerrar: () => void;
	} = $props();

	let desde = $state('');
	let hasta = $state('');
	let periodicidad = $state<RemuneracionHistorial['periodicidad']>('semanal');
	let monto = $state('');
	let observacion = $state('');
	let error = $state('');

	$effect(() => {
		if (!open || !inicial) return;
		desde = inicial.fecha_inicio;
		hasta = inicial.fecha_fin ?? '';
		periodicidad = inicial.periodicidad;
		monto = inicial.monto ? String(inicial.monto) : '';
		observacion = inicial.observacion ?? '';
		error = '';
	});

	function guardar() {
		const m = Number(monto.replace(',', '.'));
		if (!desde) return void (error = 'Indica desde cuándo rige.');
		if (hasta && hasta < desde) return void (error = '"Hasta" no puede ser anterior a "Desde".');
		if (!Number.isFinite(m) || m < 0 || monto.trim() === '') return void (error = 'Escribe el monto base.');
		onguardar({ ...inicial!, fecha_inicio: desde, fecha_fin: hasta || null, periodicidad, monto: Math.round(m * 100) / 100, observacion: observacion.trim() || null });
	}
</script>

{#if open && inicial}
	<div class="fixed inset-0 z-[110] flex items-center justify-center bg-slate-900/40 p-3" transition:fade={{ duration: 120 }}>
		<div class="w-full max-w-md bg-white rounded-2xl shadow-xl flex flex-col" transition:scale={{ duration: 150, start: 0.97 }} role="dialog" aria-modal="true" aria-labelledby="remu-titulo">
			<div class="px-5 py-4 border-b border-slate-100 flex items-start justify-between gap-3">
				<h3 id="remu-titulo" class="text-lg font-bold text-slate-800">{soloLectura ? 'Remuneración' : inicial.id_remuneracion ? 'Editar remuneración' : 'Registrar cambio de remuneración'}</h3>
				<button type="button" onclick={oncerrar} class="w-8 h-8 rounded-full text-slate-400 hover:bg-slate-100" aria-label="Cerrar"><i class="fas fa-xmark"></i></button>
			</div>
			<fieldset disabled={soloLectura} class="px-5 py-4 grid grid-cols-2 gap-3">
				<label class="flex flex-col gap-1 text-sm font-semibold text-slate-700">Desde<input type="date" bind:value={desde} class="px-3 py-2 border border-slate-200 rounded-lg text-sm font-normal" /></label>
				<label class="flex flex-col gap-1 text-sm font-semibold text-slate-700">Hasta <span class="sr-only">(opcional)</span><input type="date" bind:value={hasta} class="px-3 py-2 border border-slate-200 rounded-lg text-sm font-normal" /></label>
				<label class="flex flex-col gap-1 text-sm font-semibold text-slate-700">Periodicidad
					<select bind:value={periodicidad} class="px-3 py-2 border border-slate-200 rounded-lg text-sm font-normal bg-white">
						{#each PERIODICIDADES_PAGO as p (p.value)}<option value={p.value}>{p.label}</option>{/each}
					</select>
				</label>
				<label class="flex flex-col gap-1 text-sm font-semibold text-slate-700">Monto base (S/)<input type="text" inputmode="decimal" bind:value={monto} placeholder="0.00" class="px-3 py-2 border border-slate-200 rounded-lg text-sm font-normal text-right" /></label>
				<label class="col-span-2 flex flex-col gap-1 text-sm font-semibold text-slate-700">Observación <span class="sr-only">(opcional)</span><input bind:value={observacion} maxlength="200" placeholder="Opcional (ej. aumento por desempeño)" class="px-3 py-2 border border-slate-200 rounded-lg text-sm font-normal" /></label>
				{#if !inicial.id_remuneracion && !soloLectura}<p class="col-span-2 text-xs text-slate-500">La remuneración vigente anterior se cierra el día antes de esta fecha.</p>{/if}
				{#if error}<span class="col-span-2 text-sm text-rose-600">{error}</span>{/if}
			</fieldset>
			<div class="px-5 py-3 border-t border-slate-100 flex justify-end gap-2">
				<button type="button" onclick={oncerrar} class="px-5 py-2 rounded-xl border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50">{soloLectura ? 'Cerrar' : 'Cancelar'}</button>
				{#if !soloLectura}<button type="button" onclick={guardar} class="px-5 py-2 rounded-xl bg-orange-500 text-white text-sm font-bold hover:bg-orange-600">Guardar</button>{/if}
			</div>
		</div>
	</div>
{/if}
