<script lang="ts">
	import { onMount } from 'svelte';
	import { supabase } from '$lib/supabaseClient';
	import { toast } from '$lib/stores/toast';
	import { permisosState } from '$lib/stores/permisos.svelte';
	import { ejecutarRevision, getUltimaRevision, type RevisionFinanciera } from '../services/controlFinanciero.service';
	import { RefreshCw, CheckCircle2, AlertTriangle, XCircle, ListChecks } from '@lucide/svelte';

	let loading = $state(true);
	let ejecutando = $state(false);
	let revision = $state<RevisionFinanciera | null>(null);

	async function cargar() {
		loading = true;
		try {
			revision = await getUltimaRevision(supabase);
		} catch (err: any) {
			toast.error(err?.message ?? 'No se pudo cargar la última revisión');
		} finally {
			loading = false;
		}
	}

	async function handleEjecutar() {
		ejecutando = true;
		try {
			revision = await ejecutarRevision(supabase, permisosState.userName || null);
			toast.success('Revisión ejecutada');
		} catch (err: any) {
			toast.error(err?.message ?? 'No se pudo ejecutar la revisión');
		} finally {
			ejecutando = false;
		}
	}

	onMount(cargar);

	function formatFecha(iso: string | undefined | null): string {
		if (!iso) return '—';
		return new Date(iso).toLocaleString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
	}

	const ICONOS = { ok: CheckCircle2, alerta: AlertTriangle, error: XCircle } as const;
	const COLORES = { ok: 'text-emerald-600 bg-emerald-50 border-emerald-100', alerta: 'text-amber-600 bg-amber-50 border-amber-100', error: 'text-red-600 bg-red-50 border-red-100' } as const;
</script>

<div class="flex items-center justify-between mb-6 flex-wrap gap-3">
	<div>
		<h1 class="text-xl font-bold text-brand-marine flex items-center gap-2"><ListChecks size={20} class="text-blue-600" /> Consistencia</h1>
		<p class="text-sm text-slate-500 mt-1">Chequeos independientes sobre la información ya registrada — integridad de transacciones y movimientos, saldos, posibles duplicados, y consistencia de centros de costo/cuentas bancarias.</p>
	</div>
	<button
		type="button"
		onclick={handleEjecutar}
		disabled={ejecutando}
		class="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#0f3b5e] text-white text-sm font-semibold hover:bg-[#154a73] disabled:opacity-50"
	>
		<RefreshCw size={14} class={ejecutando ? 'animate-spin' : ''} /> Ejecutar ahora
	</button>
</div>

{#if loading}
	<div class="flex items-center justify-center py-24 text-slate-400">
		<RefreshCw size={28} class="animate-spin" />
	</div>
{:else if !revision}
	<div class="text-center py-20 text-slate-400 bg-white rounded-2xl border border-slate-100 shadow-sm">
		<ListChecks size={40} class="mx-auto mb-3 text-slate-300" />
		Todavía no se ha ejecutado ninguna revisión.
		<div class="mt-3">
			<button type="button" onclick={handleEjecutar} class="text-sm text-blue-600 font-semibold hover:underline">Ejecutar la primera revisión</button>
		</div>
	</div>
{:else}
	<p class="text-xs text-slate-400 mb-4">Última ejecución: {formatFecha(revision.fecha)} · {revision.controles_ok} OK · {revision.controles_alerta} alerta(s) · {revision.controles_error} error(es)</p>
	<div class="flex flex-col gap-3">
		{#each revision.resultado as chequeo (chequeo.id)}
			{@const Icono = ICONOS[chequeo.estado]}
			<div class={`flex items-start gap-3 p-4 rounded-2xl border shadow-sm bg-white ${chequeo.estado === 'error' ? 'border-red-100' : chequeo.estado === 'alerta' ? 'border-amber-100' : 'border-slate-100'}`}>
				<span class={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center border ${COLORES[chequeo.estado]}`}>
					<Icono size={16} />
				</span>
				<div class="flex-1 min-w-0">
					<div class="font-bold text-slate-700 text-sm">{chequeo.label}</div>
					<p class="text-xs text-slate-500 mt-0.5">{chequeo.mensaje}</p>
				</div>
			</div>
		{/each}
	</div>
{/if}
