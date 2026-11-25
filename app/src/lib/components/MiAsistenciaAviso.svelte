<script lang="ts">
	/**
	 * Ticket #117 (rechazo 21/11/2026: "no me aparece ninguna ventana emergente, siendo yo de horario libre").
	 * Ventana emergente al entrar al ERP para quien marca desde el ERP (ficha vinculada a su usuario y horario libre o
	 * mixto, ver miAsistencia.svelte.ts). Solo si hoy todavía no registró su ingreso:
	 *  - Horario libre: primero "¿Vas a laborar hoy?". "Hoy no laboro" no vuelve a preguntar hasta mañana.
	 *  - Luego (o directo en horario mixto): "¿Estás comenzando tu jornada a las HH:MM?". "Sí" registra el ingreso
	 *    (la hora la pone el servidor); "Todavía no" vuelve a preguntar en 15 minutos.
	 * La decisión del día se guarda en este equipo (localStorage); si no se puede guardar, solo vuelve a preguntar.
	 *
	 * Cambio pedido por la clienta (25/11/2026): con HORARIO LIBRE solo se pregunta "¿Vas a laborar hoy?" — "Sí" registra
	 * el día como jornada completa y "No", como no laborado (fn_mi_asistencia_declarar, se guarda en la base; no se pide
	 * hora de ingreso). Ya no aparece "¿Estás comenzando tu jornada?" para horario libre; sí para los demás.
	 */
	import { onMount, onDestroy } from 'svelte';
	import { Clock, Play, Loader2 } from '@lucide/svelte';
	import { hoyLima } from '$lib/modules/personal/services/personal.service';
	import { miJornada, cargarMiJornada, marcarMiJornada, declararHoy, jornadaHoy, minutoLima } from '$lib/stores/miAsistencia.svelte';
	import { reloj } from '$lib/modules/asistencia/services/asistencia.service';

	const REPETIR_MIN = 15;
	const CLAVE = 'construni_mi_asistencia_aviso';

	let paso = $state<'cerrado' | 'laboras' | 'comienzas'>('cerrado');
	let ahora = $state(Date.now());
	let timer: ReturnType<typeof setInterval> | undefined;

	type Decision = { fecha: string; noLaboro?: boolean; laboro?: boolean; posponerHasta?: number };
	function leer(): Decision | null {
		try {
			const d = JSON.parse(localStorage.getItem(CLAVE) ?? 'null') as Decision | null;
			return d && d.fecha === hoyLima() ? d : null;
		} catch {
			return null;
		}
	}
	function guardar(d: Omit<Decision, 'fecha'>) {
		try {
			localStorage.setItem(CLAVE, JSON.stringify({ ...(leer() ?? {}), ...d, fecha: hoyLima() }));
		} catch {
			/* sin almacenamiento: solo vuelve a preguntar */
		}
	}

	const esLibre = $derived(/libre/i.test(miJornada.horario) || miJornada.tipoHorario === 'libre');

	function revisar() {
		ahora = Date.now();
		if (paso !== 'cerrado' || !miJornada.cargado || !miJornada.disponible || miJornada.marcando) return;
		// Horario libre: una sola pregunta al día, guardada en la base.
		if (esLibre) {
			if (miJornada.hoyLabora === null) paso = 'laboras';
			return;
		}
		// Ya registró algo hoy (ingreso o ingreso y salida): no se pregunta.
		if (jornadaHoy().tramos.length > 0) return;
		const d = leer();
		if (d?.noLaboro) return;
		if (d?.posponerHasta && Date.now() < d.posponerHasta) return;
		paso = esLibre && !d?.laboro ? 'laboras' : 'comienzas';
	}

	async function noLaboro() {
		if (await declararHoy(false)) paso = 'cerrado';
	}
	async function siLaboro() {
		if (await declararHoy(true)) paso = 'cerrado';
	}
	function todaviaNo() {
		guardar({ posponerHasta: Date.now() + REPETIR_MIN * 60_000 });
		paso = 'cerrado';
	}
	async function comenzar() {
		const ok = await marcarMiJornada();
		if (ok) paso = 'cerrado';
	}

	onMount(async () => {
		await cargarMiJornada();
		revisar();
		timer = setInterval(revisar, 60_000);
	});
	onDestroy(() => clearInterval(timer));
</script>

{#if paso !== 'cerrado'}
	<div class="fixed inset-0 bg-black/50 backdrop-blur-sm z-[150] flex items-center justify-center p-4" role="presentation">
		<div class="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden" role="dialog" aria-modal="true" aria-labelledby="mi-asistencia-aviso-titulo">
			<div class="bg-gradient-to-br from-[#0f3b5e] to-[#1e6091] px-5 py-4 text-white">
				<p class="text-xs text-white/70 flex items-center gap-1.5"><Clock size={13} /> Mi asistencia</p>
				<p class="font-bold truncate">{miJornada.nombre}</p>
				{#if miJornada.horario}<p class="text-[11px] text-white/60">{miJornada.horario}</p>{/if}
			</div>
			<div class="p-5">
				{#if paso === 'laboras'}
					<h2 id="mi-asistencia-aviso-titulo" class="text-lg font-bold text-slate-800">¿Vas a laborar hoy?</h2>
					<p class="mt-1 text-sm text-slate-500">Tu horario es libre: si hoy trabajas, el día cuenta como jornada completa. No necesitas marcar hora de ingreso.</p>
					<div class="mt-5 flex flex-col gap-2">
						<button type="button" onclick={siLaboro} disabled={miJornada.marcando} class="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold disabled:opacity-60">{miJornada.marcando ? 'Registrando…' : 'Sí, hoy laboro'}</button>
						<button type="button" onclick={noLaboro} disabled={miJornada.marcando} class="w-full py-2.5 rounded-xl border border-slate-200 text-slate-600 font-semibold hover:bg-slate-50 disabled:opacity-60">Hoy no laboro</button>
					</div>
				{:else}
					<h2 id="mi-asistencia-aviso-titulo" class="text-lg font-bold text-slate-800">
						¿Estás comenzando tu jornada a las {reloj(minutoLima(ahora))}?
					</h2>
					<p class="mt-1 text-sm text-slate-500">Si dices que sí, se registra tu ingreso con la hora de ahora. Si todavía no, te volvemos a preguntar en {REPETIR_MIN} minutos.</p>
					<div class="mt-5 flex flex-col gap-2">
						<button type="button" onclick={comenzar} disabled={miJornada.marcando} class="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold flex items-center justify-center gap-2 disabled:opacity-60">
							{#if miJornada.marcando}<Loader2 size={16} class="animate-spin" /> Registrando…{:else}<Play size={15} fill="currentColor" /> Sí, iniciar mi jornada{/if}
						</button>
						<button type="button" onclick={todaviaNo} disabled={miJornada.marcando} class="w-full py-2.5 rounded-xl border border-slate-200 text-slate-600 font-semibold hover:bg-slate-50 disabled:opacity-60">Todavía no</button>
					</div>
				{/if}
			</div>
		</div>
	</div>
{/if}
