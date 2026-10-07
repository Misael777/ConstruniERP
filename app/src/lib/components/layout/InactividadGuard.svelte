<script lang="ts">
	/**
	 * Cierre de sesión por inactividad — a pedido del usuario: la información del ERP es confidencial y no debe
	 * quedar expuesta si el usuario se aleja del equipo. Tras 10 minutos sin actividad (mouse, teclado, toque,
	 * rueda o scroll) aparece un aviso con cuenta regresiva para confirmar que sigue ahí; si no responde, se
	 * cierra la sesión (registrada en Auditoría como 'sesion_expirada' por inactividad) y vuelve al login.
	 *
	 * Multiplataforma: solo eventos del DOM y relojes de JS. Los relojes se basan en la HORA REAL (Date.now),
	 * no en contar ticks: si el sistema suspende la app (Android en segundo plano, laptop dormida), al volver
	 * se compara el tiempo transcurrido y, si ya pasó el plazo, se cierra la sesión de inmediato.
	 */
	import { onMount, onDestroy } from 'svelte';
	import { goto } from '$app/navigation';
	import { cerrarSesionPorInactividad } from '$lib/shared/auditoria';

	const LIMITE_INACTIVIDAD_MS = 10 * 60 * 1000;
	const CUENTA_REGRESIVA_MS = 60 * 1000;
	const EVENTOS_ACTIVIDAD = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart', 'scroll'] as const;

	let ultimaActividad = Date.now();
	let avisoVisible = $state(false);
	let finAviso = 0;
	let segundosRestantes = $state(Math.round(CUENTA_REGRESIVA_MS / 1000));
	let cerrando = false;
	let intervalo: ReturnType<typeof setInterval> | undefined;
	let botonContinuar: HTMLButtonElement | undefined = $state();

	function registrarActividad() {
		// Con el aviso abierto, moverse o tocar la pantalla NO cuenta: hay que confirmar con el botón.
		if (!avisoVisible) ultimaActividad = Date.now();
	}

	async function cerrarPorInactividad() {
		if (cerrando) return;
		cerrando = true;
		avisoVisible = false;
		try {
			await cerrarSesionPorInactividad();
		} finally {
			goto('/login?inactividad=1');
		}
	}

	function revisar() {
		if (cerrando) return;
		const ahora = Date.now();
		if (!avisoVisible) {
			if (ahora - ultimaActividad < LIMITE_INACTIVIDAD_MS) return;
			finAviso = ultimaActividad + LIMITE_INACTIVIDAD_MS + CUENTA_REGRESIVA_MS;
			avisoVisible = true;
		}
		const restante = finAviso - ahora;
		segundosRestantes = Math.max(0, Math.ceil(restante / 1000));
		if (restante <= 0) void cerrarPorInactividad();
	}

	function continuar() {
		avisoVisible = false;
		ultimaActividad = Date.now();
		segundosRestantes = Math.round(CUENTA_REGRESIVA_MS / 1000);
	}

	function alVolverAVerse() {
		if (document.visibilityState === 'visible') revisar();
	}

	onMount(() => {
		for (const ev of EVENTOS_ACTIVIDAD) window.addEventListener(ev, registrarActividad, { passive: true, capture: true });
		document.addEventListener('visibilitychange', alVolverAVerse);
		intervalo = setInterval(revisar, 1000);
	});

	onDestroy(() => {
		if (typeof window === 'undefined') return;
		for (const ev of EVENTOS_ACTIVIDAD) window.removeEventListener(ev, registrarActividad, { capture: true });
		document.removeEventListener('visibilitychange', alVolverAVerse);
		if (intervalo) clearInterval(intervalo);
	});

	// Al abrir el aviso, el foco va a "Continuar" (Enter o Espacio confirman).
	$effect(() => {
		if (avisoVisible && botonContinuar) botonContinuar.focus();
	});

	const progreso = $derived((segundosRestantes / (CUENTA_REGRESIVA_MS / 1000)) * 100);
</script>

{#if avisoVisible}
	<div class="fixed inset-0 z-[300] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
		<div
			role="alertdialog"
			aria-modal="true"
			aria-labelledby="inactividad-titulo"
			aria-describedby="inactividad-detalle"
			class="w-full max-w-sm rounded-2xl bg-white shadow-2xl overflow-hidden"
		>
			<div class="px-6 pt-6 pb-4 text-center">
				<div class="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-amber-100 text-amber-600">
					<i class="fas fa-user-clock text-2xl"></i>
				</div>
				<h2 id="inactividad-titulo" class="text-lg font-bold text-[#0f3b5e]">¿Sigues ahí?</h2>
				<p id="inactividad-detalle" class="mt-1 text-sm text-slate-500">
					Por seguridad, tu sesión se cerrará por inactividad en
				</p>
				<p class="mt-2 text-4xl font-bold tabular-nums text-amber-600" aria-live="polite">{segundosRestantes}<span class="text-base font-semibold text-slate-400"> s</span></p>
				<div class="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
					<div class="h-full rounded-full bg-amber-500 transition-[width] duration-1000 ease-linear" style={`width:${progreso}%`}></div>
				</div>
			</div>
			<div class="flex flex-col-reverse gap-2 border-t border-slate-100 bg-slate-50 px-6 py-4 sm:flex-row sm:justify-end">
				<button
					type="button"
					onclick={cerrarPorInactividad}
					class="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
				>
					Cerrar sesión
				</button>
				<button
					type="button"
					bind:this={botonContinuar}
					onclick={continuar}
					class="rounded-lg bg-[#0f3b5e] px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-[#0c3150] focus:outline-none focus:ring-2 focus:ring-blue-300"
				>
					Continuar en la plataforma
				</button>
			</div>
		</div>
	</div>
{/if}
