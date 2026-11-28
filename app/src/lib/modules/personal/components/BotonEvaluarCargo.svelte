<script lang="ts">
	/**
	 * Ticket #152: "Evaluar cargo" para el jefe inmediato desde el Tareo (el residente no abre la ficha completa del
	 * trabajador: solo ve su cargo y la evaluación). Evalúa el cargo principal vigente del historial de cargos.
	 */
	import { supabase } from '$lib/supabaseClient';
	import { toast } from '$lib/stores/toast';
	import { cargoAbierto, getCargosHistorial, hoyLima, type CargoHistorial } from '../services/personal.service';
	import EvaluarCargoModal from './EvaluarCargoModal.svelte';

	let { idPersonal, nombre, esObra = false }: { idPersonal: number; nombre: string; esObra?: boolean } = $props();

	let tramo = $state<CargoHistorial | null>(null);
	let cargando = $state(false);

	async function abrir() {
		cargando = true;
		try {
			const hoy = hoyLima();
			const tramos = (await getCargosHistorial(supabase, idPersonal)).filter((t) => t.id_cargo_historial);
			const vigentes = tramos.filter((t) => cargoAbierto(t, hoy) && t.fecha_inicio <= hoy);
			tramo = vigentes.find((t) => (t.clasificacion ?? 'principal') === 'principal') ?? vigentes[0] ?? tramos[0] ?? null;
			if (!tramo) toast.info(`${nombre} no tiene un cargo registrado. Pide a un administrador que lo registre en su ficha de Personal.`);
		} catch {
			toast.error('No se pudo cargar el cargo del trabajador.');
		} finally {
			cargando = false;
		}
	}
</script>

<button type="button" onclick={abrir} disabled={cargando} class="text-[11px] text-violet-700 hover:underline disabled:opacity-50">
	<i class="fas fa-clipboard-check"></i> {cargando ? 'Cargando…' : 'Evaluar cargo'}
</button>

{#if tramo}
	<EvaluarCargoModal {idPersonal} {nombre} {tramo} {esObra} onClose={() => (tramo = null)} />
{/if}
