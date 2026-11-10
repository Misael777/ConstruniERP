<script lang="ts">
	/**
	 * Botón «Mi asistencia» de Inicio (junto a «Actualizar»). A pedido del usuario: solo lo ven quienes tienen su
	 * ficha vinculada y horario libre o mixto, y abre una ventana pequeña (no una pantalla) para iniciar o terminar
	 * la jornada, con las horas de hoy y de la semana.
	 */
	import { onMount, onDestroy } from 'svelte';
	import { Clock, X, Play, Square, Loader2 } from '@lucide/svelte';
	import { hoyLima } from '$lib/modules/personal/services/personal.service';
	import { reloj } from '$lib/modules/asistencia/services/asistencia.service';
	import { jornadaDelDia } from '$lib/modules/asistencia/services/miAsistencia.service';
	import {
		miJornada, cargarMiJornada, marcarMiJornada, jornadaHoy, minutosSemana, duracionCorta, lunesDe, sumarDias, minutoLima
	} from '$lib/stores/miAsistencia.svelte';

	let abierto = $state(false);
	let ahora = $state(Date.now());
	let intervalo: ReturnType<typeof setInterval> | undefined;

	onMount(() => {
		cargarMiJornada();
		intervalo = setInterval(() => (ahora = Date.now()), 1000);
	});
	onDestroy(() => clearInterval(intervalo));

	const jornada = $derived.by(() => {
		void miJornada.marcasSemana;
		return jornadaHoy(Math.floor(ahora / 60_000) * 60_000);
	});
	const totalSemana = $derived.by(() => {
		void miJornada.marcasSemana;
		return minutosSemana(Math.floor(ahora / 60_000) * 60_000);
	});

	const DIAS = ['Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sá', 'Do'];
	const semana = $derived.by(() => {
		void miJornada.marcasSemana;
		const hoy = hoyLima();
		const lunes = lunesDe(hoy);
		const dias = DIAS.map((etiqueta, i) => {
			const fecha = sumarDias(lunes, i);
			const min = fecha > hoy ? 0 : jornadaDelDia(miJornada.marcasSemana, fecha, fecha === hoy ? minutoLima(ahora) : null).minutos;
			return { etiqueta, fecha, min, esHoy: fecha === hoy, futuro: fecha > hoy };
		});
		const max = Math.max(480, ...dias.map((d) => d.min));
		return dias.map((d) => ({ ...d, alto: Math.round((d.min / max) * 100) }));
	});

	const horaActual = $derived(new Date(ahora - 5 * 3_600_000).toISOString().slice(11, 19));
	const fechaLarga = $derived(
		new Date(`${hoyLima()}T12:00:00Z`).toLocaleDateString('es-PE', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })
	);

	function abrir() {
		abierto = true;
		cargarMiJornada();
	}
	function cerrar() {
		if (!miJornada.marcando) abierto = false;
	}
</script>

<svelte:window onkeydown={(e) => abierto && e.key === 'Escape' && cerrar()} />

{#if miJornada.disponible}
	<button
		type="button"
		onclick={abrir}
		title="Registrar mi ingreso o salida"
		class="flex items-center gap-1.5 px-3 py-2 rounded-lg border text-sm font-semibold transition-colors {jornada.enJornada
			? 'border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100'
			: 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'}"
	>
		{#if jornada.enJornada}
			<span class="relative flex h-2.5 w-2.5">
				<span class="absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75 animate-ping"></span>
				<span class="relative inline-flex h-2.5 w-2.5 rounded-full bg-rose-500"></span>
			</span>
			Mi asistencia
			<span class="font-mono tabular-nums text-xs text-rose-600">{duracionCorta(jornada.minutos)}</span>
		{:else}
			<Clock size={15} /> Mi asistencia
		{/if}
	</button>
{/if}

{#if abierto}
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
	<div class="fixed inset-0 bg-black/50 backdrop-blur-sm z-[150] flex items-center justify-center p-4" onclick={(e) => e.target === e.currentTarget && cerrar()}>
		<div class="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
			<!-- Cabecera -->
			<div class="relative bg-gradient-to-br from-[#0f3b5e] to-[#1e6091] px-5 pt-4 pb-5 text-white">
				<button type="button" onclick={cerrar} aria-label="Cerrar" class="absolute right-3 top-3 w-8 h-8 flex items-center justify-center rounded-lg text-white/70 hover:bg-white/10 hover:text-white">
					<X size={18} />
				</button>
				<p class="text-xs text-white/70 capitalize">{fechaLarga}</p>
				<p class="font-bold truncate pr-8">{miJornada.nombre}</p>
				{#if miJornada.horario}<p class="text-[11px] text-white/60">{miJornada.horario}</p>{/if}
				<p class="mt-3 text-4xl font-black font-mono tabular-nums tracking-tight">{horaActual}</p>
				<p class="mt-1 text-xs flex items-center gap-1.5 {jornada.enJornada ? 'text-rose-200' : 'text-white/70'}">
					<span class="inline-block w-2 h-2 rounded-full {jornada.enJornada ? 'bg-rose-400' : 'bg-white/40'}"></span>
					{#if jornada.enJornada}
						En jornada desde las {reloj(jornada.tramos.at(-1)?.inicio ?? null)}
					{:else}
						Fuera de jornada
					{/if}
				</p>
			</div>

			<div class="p-5 space-y-4">
				<!-- Botón principal -->
				<button
					type="button"
					onclick={() => marcarMiJornada()}
					disabled={miJornada.marcando}
					class="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-white font-bold shadow-sm transition-colors disabled:opacity-60 {jornada.enJornada
						? 'bg-rose-600 hover:bg-rose-700'
						: 'bg-emerald-600 hover:bg-emerald-700'}"
				>
					{#if miJornada.marcando}
						<Loader2 size={18} class="animate-spin" /> Registrando…
					{:else if jornada.enJornada}
						<Square size={16} fill="currentColor" /> Terminar jornada
					{:else}
						<Play size={16} fill="currentColor" /> Iniciar jornada
					{/if}
				</button>

				<!-- Hoy -->
				<div>
					<div class="flex items-baseline justify-between mb-1.5">
						<span class="text-xs font-semibold text-slate-500 uppercase tracking-wide">Hoy</span>
						<span class="text-sm font-bold text-slate-800 tabular-nums">{duracionCorta(jornada.minutos)}</span>
					</div>
					{#if jornada.tramos.length}
						<ul class="space-y-1">
							{#each jornada.tramos as t}
								<li class="flex items-center justify-between text-sm bg-slate-50 rounded-lg px-3 py-1.5">
									<span class="font-mono tabular-nums text-slate-700">
										{reloj(t.inicio)} – {t.fin == null ? '…' : reloj(t.fin)}
									</span>
									<span class="text-xs {t.fin == null ? 'text-rose-600 font-semibold' : 'text-slate-500'}">
										{t.fin == null ? 'en curso' : duracionCorta(t.fin - t.inicio)}
									</span>
								</li>
							{/each}
						</ul>
					{:else}
						<p class="text-sm text-slate-400">Aún no registras tu ingreso.</p>
					{/if}
				</div>

				<!-- Semana -->
				<div>
					<div class="flex items-baseline justify-between mb-2">
						<span class="text-xs font-semibold text-slate-500 uppercase tracking-wide">Esta semana</span>
						<span class="text-sm font-bold text-slate-800 tabular-nums">{duracionCorta(totalSemana)}</span>
					</div>
					<div class="grid grid-cols-7 gap-1.5 items-end h-20">
						{#each semana as d}
							<div class="flex flex-col items-center justify-end h-full gap-1" title={d.futuro ? '' : `${d.fecha}: ${duracionCorta(d.min)}`}>
								<div class="w-full flex-1 flex items-end rounded-md bg-slate-100 overflow-hidden">
									<div class="w-full rounded-md {d.esHoy ? 'bg-emerald-500' : 'bg-[#1e6091]'}" style="height: {d.alto}%"></div>
								</div>
								<span class="text-[10px] {d.esHoy ? 'font-bold text-emerald-700' : 'text-slate-400'}">{d.etiqueta}</span>
							</div>
						{/each}
					</div>
				</div>
			</div>
		</div>
	</div>
{/if}
