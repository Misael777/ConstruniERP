<script lang="ts">
	import { onMount } from 'svelte';
	import { supabase } from '$lib/supabaseClient';
	import { toast } from '$lib/stores/toast';
	import { permisosState } from '$lib/stores/permisos.svelte';
	import { ejecutarRevision, getUltimaRevision, type RevisionFinanciera } from '../services/controlFinanciero.service';
	import { RefreshCw, CheckCircle2, AlertTriangle, XCircle, ListChecks, ChevronDown } from '@lucide/svelte';

	let loading = $state(true);
	let ejecutando = $state(false);
	let revision = $state<RevisionFinanciera | null>(null);
	// Qué tarjetas están desplegadas — a pedido explícito del usuario: click en una tarjeta muestra el
	// detalle crudo que ese chequeo evaluó, para poder validar que el chequeo es correcto (no solo
	// confiar en el mensaje resumido). Cada check en controlFinanciero.service.ts ahora siempre adjunta
	// `detalle` (incluso en 'ok'), con las filas/números reales que revisó.
	let expandido = $state<Record<string, boolean>>({});

	function toggleExpandido(id: string) {
		expandido = { ...expandido, [id]: !expandido[id] };
	}

	/** Formato genérico para una hoja del detalle (no un array/objeto) — números con 2 decimales, el
	 * resto tal cual. */
	function formatValor(v: unknown): string {
		if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(2);
		if (v === null || v === undefined) return '—';
		return String(v);
	}

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
	<p class="text-xs text-slate-400 mb-4">Última ejecución: {formatFecha(revision.fecha)} · {revision.controles_ok} OK · {revision.controles_alerta} alerta(s) · {revision.controles_error} error(es) · haz clic en una tarjeta para ver el detalle evaluado</p>
	<div class="flex flex-col gap-3">
		{#each revision.resultado as chequeo (chequeo.id)}
			{@const Icono = ICONOS[chequeo.estado]}
			{@const abierto = !!expandido[chequeo.id]}
			<div class={`rounded-2xl border shadow-sm bg-white overflow-hidden ${chequeo.estado === 'error' ? 'border-red-100' : chequeo.estado === 'alerta' ? 'border-amber-100' : 'border-slate-100'}`}>
				<button type="button" onclick={() => toggleExpandido(chequeo.id)} class="w-full flex items-start gap-3 p-4 text-left hover:bg-slate-50/60">
					<span class={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center border ${COLORES[chequeo.estado]}`}>
						<Icono size={16} />
					</span>
					<div class="flex-1 min-w-0">
						<div class="font-bold text-slate-700 text-sm">{chequeo.label}</div>
						<p class="text-xs text-slate-500 mt-0.5">{chequeo.mensaje}</p>
					</div>
					<ChevronDown size={16} class={`shrink-0 text-slate-400 mt-1.5 transition-transform ${abierto ? 'rotate-180' : ''}`} />
				</button>
				{#if abierto}
					<div class="px-4 pb-4 pt-1 border-t border-slate-100 bg-slate-50/40">
						{#if chequeo.detalle === undefined || chequeo.detalle === null}
							<p class="text-xs text-slate-400">Sin detalle adicional para este chequeo.</p>
						{:else}
							{@render renderDetalle(chequeo.detalle)}
						{/if}
					</div>
				{/if}
			</div>
		{/each}
	</div>
{/if}

{#snippet renderDetalle(valor: unknown)}
	{#if Array.isArray(valor)}
		{#if valor.length === 0}
			<p class="text-xs text-slate-400 italic mt-2">Vacío — ningún registro.</p>
		{:else if typeof valor[0] === 'object' && valor[0] !== null}
			{@const columnas = Object.keys(valor[0] as object)}
			<div class="overflow-x-auto mt-2">
				<table class="w-full text-[11px] text-left whitespace-nowrap">
					<thead class="text-slate-400 uppercase text-[9px] tracking-wide">
						<tr>{#each columnas as col}<th class="px-2 py-1">{col.replace(/_/g, ' ')}</th>{/each}</tr>
					</thead>
					<tbody class="divide-y divide-slate-200">
						{#each valor as fila}
							<tr>{#each columnas as col}<td class="px-2 py-1 text-slate-600">{formatValor((fila as any)[col])}</td>{/each}</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{:else}
			<div class="flex flex-wrap gap-1 mt-2">
				{#each valor as v}<span class="px-1.5 py-0.5 bg-white border border-slate-200 rounded text-[10px] text-slate-600">{formatValor(v)}</span>{/each}
			</div>
		{/if}
	{:else if typeof valor === 'object'}
		<div class="flex flex-col gap-2 mt-2">
			{#each Object.entries(valor as Record<string, unknown>) as [clave, v]}
				<div>
					<div class="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{clave.replace(/_/g, ' ')}</div>
					{#if Array.isArray(v) || (typeof v === 'object' && v !== null)}
						{@render renderDetalle(v)}
					{:else}
						<div class="text-xs text-slate-600">{formatValor(v)}</div>
					{/if}
				</div>
			{/each}
		</div>
	{:else}
		<p class="text-xs text-slate-600 mt-2">{formatValor(valor)}</p>
	{/if}
{/snippet}
