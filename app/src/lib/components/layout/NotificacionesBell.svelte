<script lang="ts">
	// Campanita de notificaciones — antes un botón 100% decorativo (punto rojo hardcodeado, sin
	// backend). Ahora muestra las solicitudes de aprobación pendientes (ver
	// aprobaciones.service.ts) para que un administrador las apruebe/rechace. Solo tiene contenido
	// real para administradores — a un no-admin no le sirve de nada ver solicitudes ajenas, así que
	// se muestra sin badge ni panel.
	import { onMount, onDestroy } from 'svelte';
	import { supabase } from '$lib/supabaseClient';
	import { isAdmin, permisosState } from '$lib/stores/permisos.svelte';
	import {
		getSolicitudesPendientes,
		aprobarSolicitud,
		rechazarSolicitud,
		type SolicitudAprobacion
	} from '$lib/modules/aprobaciones/services/aprobaciones.service';

	// No hay infraestructura realtime en este ERP (sin websockets/Supabase Realtime) — a pedido del
	// usuario, en vez de depender solo de "hago clic en la campanita para revisar", se hace polling
	// en segundo plano cada POLL_INTERVAL_MS mientras el layout está montado (persiste entre
	// navegaciones dentro de (app), se limpia recién al desmontar el layout completo).
	const POLL_INTERVAL_MS = 30000;

	let solicitudes = $state<SolicitudAprobacion[]>([]);
	let isLoading = $state(false);
	let isOpen = $state(false);
	let processingId = $state<number | null>(null);
	let errorMsg = $state('');

	let seenIds = new Set<number>();
	let firstLoad = true;
	let audioCtx: AudioContext | null = null;
	let pollIntervalId: ReturnType<typeof setInterval> | null = null;

	/** Chime corto de dos tonos generado con Web Audio (sin archivo externo — funciona igual en la
	 * app web y empaquetada en Tauri). Los navegadores suspenden el AudioContext hasta que hay algún
	 * gesto del usuario en la página; en un ERP donde el admin está navegando/haciendo clic
	 * constantemente esto no es un problema real, así que no se agrega un flujo de fallback. */
	function playChime() {
		try {
			audioCtx ??= new (window.AudioContext || (window as any).webkitAudioContext)();
			if (audioCtx.state === 'suspended') audioCtx.resume();
			const ctx = audioCtx;
			const now = ctx.currentTime;
			[880, 1320].forEach((freq, i) => {
				const osc = ctx.createOscillator();
				const gain = ctx.createGain();
				osc.type = 'sine';
				osc.frequency.value = freq;
				const start = now + i * 0.12;
				gain.gain.setValueAtTime(0, start);
				gain.gain.linearRampToValueAtTime(0.2, start + 0.02);
				gain.gain.exponentialRampToValueAtTime(0.001, start + 0.25);
				osc.connect(gain);
				gain.connect(ctx.destination);
				osc.start(start);
				osc.stop(start + 0.3);
			});
		} catch (err) {
			console.warn('[NotificacionesBell] No se pudo reproducir el sonido de notificación:', err);
		}
	}

	async function cargar() {
		if (!isAdmin()) return;
		isLoading = true;
		try {
			const nuevas = await getSolicitudesPendientes(supabase);
			// Suena solo por solicitudes NUEVAS desde la última revisión — nunca en la primera carga
			// (no queremos un "ding" solo por tener solicitudes viejas ya pendientes al abrir la app).
			if (!firstLoad && nuevas.some((s) => !seenIds.has(s.id_solicitud))) {
				playChime();
			}
			seenIds = new Set(nuevas.map((s) => s.id_solicitud));
			firstLoad = false;
			solicitudes = nuevas;
		} catch (err) {
			console.error('[NotificacionesBell] Error cargando solicitudes:', err);
		} finally {
			isLoading = false;
		}
	}

	onMount(() => {
		cargar();
		pollIntervalId = setInterval(cargar, POLL_INTERVAL_MS);
	});

	onDestroy(() => {
		if (pollIntervalId) clearInterval(pollIntervalId);
	});

	function toggle() {
		if (!isAdmin()) return;
		isOpen = !isOpen;
		if (isOpen) cargar();
	}

	function etiquetaAccion(tipo: SolicitudAprobacion['tipo_accion']) {
		if (tipo === 'eliminar') return 'Eliminar';
		if (tipo === 'cerrar_venta') return 'Cerrar venta';
		return 'Editar';
	}

	function etiquetaEntidad(tipo: SolicitudAprobacion['tipo_entidad']) {
		return tipo === 'cliente' ? 'Cliente' : 'Venta';
	}

	function fmtFecha(value: string) {
		const date = new Date(value);
		if (Number.isNaN(date.getTime())) return '—';
		return date.toLocaleDateString('es-PE', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
	}

	async function handleAprobar(s: SolicitudAprobacion) {
		processingId = s.id_solicitud;
		errorMsg = '';
		try {
			const result = await aprobarSolicitud(supabase, s.id_solicitud, permisosState.userName || null);
			if (!result.success) {
				errorMsg = result.message || 'No se pudo aprobar la solicitud.';
				return;
			}
			await cargar();
		} finally {
			processingId = null;
		}
	}

	async function handleRechazar(s: SolicitudAprobacion) {
		if (!confirm('¿Rechazar esta solicitud? El registro original no se modifica.')) return;
		processingId = s.id_solicitud;
		errorMsg = '';
		try {
			const result = await rechazarSolicitud(supabase, s.id_solicitud, permisosState.userName || null);
			if (!result.success) {
				errorMsg = result.message || 'No se pudo rechazar la solicitud.';
				return;
			}
			await cargar();
		} finally {
			processingId = null;
		}
	}
</script>

<div class="relative">
	<button
		type="button"
		onclick={toggle}
		class="text-slate-400 hover:text-brand-orange relative"
		aria-label="Notificaciones"
	>
		<i class="fas fa-bell"></i>
		{#if isAdmin() && solicitudes.length > 0}
			<span class="absolute -top-1 -right-1 min-w-[14px] h-3.5 px-0.5 bg-red-500 rounded-full border-2 border-white text-[8px] leading-none text-white font-bold flex items-center justify-center">
				{solicitudes.length > 9 ? '9+' : solicitudes.length}
			</span>
		{/if}
	</button>

	{#if isOpen && isAdmin()}
		<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
		<div class="fixed inset-0 z-30" onclick={() => (isOpen = false)}></div>
		<div class="absolute right-0 mt-2 w-96 max-h-[70vh] overflow-y-auto bg-white rounded-2xl shadow-2xl border border-slate-100 z-40">
			<div class="p-4 border-b border-slate-100 sticky top-0 bg-white rounded-t-2xl">
				<h3 class="text-sm font-bold text-slate-800">Solicitudes de aprobación</h3>
				<p class="text-xs text-slate-400 mt-0.5">Ediciones/eliminaciones pedidas por usuarios sin rango de administrador.</p>
			</div>

			{#if errorMsg}
				<div class="mx-4 mt-3 p-2.5 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-700">{errorMsg}</div>
			{/if}

			{#if isLoading}
				<div class="p-8 text-center text-slate-400 text-sm">
					<i class="fas fa-spinner fa-spin"></i> Cargando...
				</div>
			{:else if solicitudes.length === 0}
				<div class="p-8 text-center text-slate-400 text-sm">
					<i class="fas fa-check-circle text-2xl mb-2 block"></i>
					No hay solicitudes pendientes.
				</div>
			{:else}
				<div class="divide-y divide-slate-100">
					{#each solicitudes as s (s.id_solicitud)}
						<div class="p-4">
							<div class="flex items-start justify-between gap-2 mb-1.5">
								<div class="min-w-0">
									<span class="inline-block px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide bg-slate-100 text-slate-600 border border-slate-200 mr-1.5">
										{etiquetaEntidad(s.tipo_entidad)}
									</span>
									<span class="inline-block px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide bg-amber-50 text-amber-700 border border-amber-200">
										{etiquetaAccion(s.tipo_accion)}
									</span>
									<p class="text-sm font-semibold text-slate-800 truncate mt-1">{s.descripcion_entidad || `#${s.id_entidad}`}</p>
								</div>
							</div>
							<p class="text-[11px] text-slate-400 mb-2">
								Pedido por <span class="font-medium text-slate-500">{s.solicitado_por || 'Usuario'}</span> · {fmtFecha(s.created_at)}
							</p>

							{#if s.payload_cambios && Object.keys(s.payload_cambios).length > 0}
								<div class="mb-2 p-2 bg-slate-50 rounded-lg border border-slate-100 space-y-0.5 max-h-28 overflow-y-auto">
									{#each Object.entries(s.payload_cambios) as [campo, valor]}
										<div class="flex items-start gap-2 text-[11px]">
											<span class="text-slate-400 shrink-0">{campo}:</span>
											<span class="text-slate-700 truncate">{typeof valor === 'object' ? JSON.stringify(valor) : String(valor)}</span>
										</div>
									{/each}
								</div>
							{/if}

							<div class="flex gap-2">
								<button
									type="button"
									onclick={() => handleAprobar(s)}
									disabled={processingId === s.id_solicitud}
									class="flex-1 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5"
								>
									{#if processingId === s.id_solicitud}
										<i class="fas fa-spinner fa-spin"></i>
									{:else}
										<i class="fas fa-check"></i> Aprobar
									{/if}
								</button>
								<button
									type="button"
									onclick={() => handleRechazar(s)}
									disabled={processingId === s.id_solicitud}
									class="flex-1 px-3 py-1.5 bg-white border border-slate-200 hover:border-rose-300 hover:text-rose-600 text-slate-500 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50"
								>
									Rechazar
								</button>
							</div>
						</div>
					{/each}
				</div>
			{/if}
		</div>
	{/if}
</div>
