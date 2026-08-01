<script lang="ts">
	// Campanita de notificaciones — antes un botón 100% decorativo (punto rojo hardcodeado, sin
	// backend). Ahora tiene dos modos:
	//  - Admin: ve TODAS las solicitudes de aprobación pendientes (ver aprobaciones.service.ts) y
	//    puede aprobarlas/rechazarlas.
	//  - No-admin (solicitante): ve SUS PROPIAS solicitudes (cualquier estado) para saber si siguen
	//    pendientes o si un admin ya las aprobó/rechazó — sin botones de acción, es solo informativo.
	import { onMount, onDestroy } from 'svelte';
	import { supabase } from '$lib/supabaseClient';
	import { isAdmin, permisosState } from '$lib/stores/permisos.svelte';
	import {
		getSolicitudesPendientes,
		getMisSolicitudes,
		marcarSolicitudesVistas,
		aprobarSolicitud,
		rechazarSolicitud,
		type SolicitudAprobacion,
		type EstadoSolicitud
	} from '$lib/modules/aprobaciones/services/aprobaciones.service';
	import { sendNotificacionNativa, ensureNotificacionPermission } from '$lib/modules/aprobaciones/services/notificacionNativa';

	// No hay infraestructura realtime en este ERP (sin websockets/Supabase Realtime) — a pedido del
	// usuario, en vez de depender solo de "hago clic en la campanita para revisar", se hace polling
	// en segundo plano cada POLL_INTERVAL_MS mientras el layout está montado (persiste entre
	// navegaciones dentro de (app), se limpia recién al desmontar el layout completo).
	const POLL_INTERVAL_MS = 30000;

	let solicitudesAdmin = $state<SolicitudAprobacion[]>([]);
	let misSolicitudes = $state<SolicitudAprobacion[]>([]);

	let isLoading = $state(false);
	let isOpen = $state(false);
	let processingId = $state<number | null>(null);
	let errorMsg = $state('');

	let seenPendingIds = new Set<number>();
	let lastEstados = new Map<number, EstadoSolicitud>();
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

	function etiquetaAccion(tipo: SolicitudAprobacion['tipo_accion']) {
		if (tipo === 'eliminar') return 'Eliminar';
		if (tipo === 'cerrar_venta') return 'Cerrar venta';
		return 'Editar';
	}

	function etiquetaEntidad(tipo: SolicitudAprobacion['tipo_entidad']) {
		return tipo === 'cliente' ? 'Cliente' : 'Venta';
	}

	function etiquetaEstado(estado: EstadoSolicitud) {
		if (estado === 'aprobado') return 'Aprobado';
		if (estado === 'rechazado') return 'Rechazado';
		return 'Pendiente';
	}

	function claseEstado(estado: EstadoSolicitud) {
		if (estado === 'aprobado') return 'bg-emerald-50 text-emerald-700 border-emerald-200';
		if (estado === 'rechazado') return 'bg-rose-50 text-rose-700 border-rose-200';
		return 'bg-amber-50 text-amber-700 border-amber-200';
	}

	function fmtFecha(value: string) {
		const date = new Date(value);
		if (Number.isNaN(date.getTime())) return '—';
		return date.toLocaleDateString('es-PE', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
	}

	/** Texto del sonido/toast nativo — distinto según a quién le llega el aviso. */
	function descripcionNotificacion(s: SolicitudAprobacion, paraAdmin: boolean): string {
		const entidad = etiquetaEntidad(s.tipo_entidad).toLowerCase();
		const accion = etiquetaAccion(s.tipo_accion).toLowerCase();
		const nombre = s.descripcion_entidad || `#${s.id_entidad}`;
		if (paraAdmin) return `Nueva solicitud: ${accion} ${entidad} "${nombre}".`;
		const resultado = s.estado === 'aprobado' ? 'aprobada' : 'rechazada';
		return `Tu solicitud para ${accion} ${entidad} "${nombre}" fue ${resultado}.`;
	}

	async function cargarAdmin() {
		isLoading = true;
		try {
			const nuevas = await getSolicitudesPendientes(supabase);
			// Suena/notifica solo por solicitudes NUEVAS desde la última revisión — nunca en la primera
			// carga (no queremos un aviso solo por tener solicitudes viejas ya pendientes al abrir la app).
			if (!firstLoad) {
				const nuevasNoVistas = nuevas.filter((s) => !seenPendingIds.has(s.id_solicitud));
				if (nuevasNoVistas.length > 0) {
					playChime();
					for (const s of nuevasNoVistas) sendNotificacionNativa('Construni ERP', descripcionNotificacion(s, true));
				}
			}
			seenPendingIds = new Set(nuevas.map((s) => s.id_solicitud));
			firstLoad = false;
			solicitudesAdmin = nuevas;
		} catch (err) {
			console.error('[NotificacionesBell] Error cargando solicitudes pendientes:', err);
		} finally {
			isLoading = false;
		}
	}

	async function cargarMias() {
		isLoading = true;
		try {
			const nuevas = await getMisSolicitudes(supabase);
			// "Nueva" para el solicitante = una solicitud que ANTES estaba pendiente (o que no
			// conocíamos todavía en esta sesión) y AHORA ya tiene resolución — nunca en la primera carga.
			if (!firstLoad) {
				const resueltasNuevas = nuevas.filter((s) => {
					const anterior = lastEstados.get(s.id_solicitud);
					return s.estado !== 'pendiente' && (anterior === undefined || anterior === 'pendiente');
				});
				if (resueltasNuevas.length > 0) {
					playChime();
					for (const s of resueltasNuevas) sendNotificacionNativa('Construni ERP', descripcionNotificacion(s, false));
				}
			}
			lastEstados = new Map(nuevas.map((s) => [s.id_solicitud, s.estado]));
			firstLoad = false;
			misSolicitudes = nuevas;
		} catch (err) {
			console.error('[NotificacionesBell] Error cargando mis solicitudes:', err);
		} finally {
			isLoading = false;
		}
	}

	async function cargar() {
		if (isAdmin()) await cargarAdmin();
		else await cargarMias();
	}

	onMount(() => {
		// Se pide el permiso de notificaciones del SO apenas carga la app (no en medio de un poll en
		// segundo plano) — en Android 13+ esto dispara el diálogo del sistema mientras el usuario ya
		// está mirando la pantalla.
		ensureNotificacionPermission();
		cargar();
		pollIntervalId = setInterval(cargar, POLL_INTERVAL_MS);
	});

	onDestroy(() => {
		if (pollIntervalId) clearInterval(pollIntervalId);
	});

	// Admin: el badge es la cuenta de pendientes (todas necesitan acción). Solicitante: el badge es
	// solo lo YA resuelto que todavía no vio — lo "pendiente" se lista pero no cuenta como nuevo.
	let badgeCount = $derived(
		isAdmin()
			? solicitudesAdmin.length
			: misSolicitudes.filter((s) => s.estado !== 'pendiente' && !s.visto_por_solicitante).length
	);

	async function toggle() {
		isOpen = !isOpen;
		if (!isOpen) return;
		await cargar();
		if (!isAdmin()) {
			const noVistas = misSolicitudes.filter((s) => s.estado !== 'pendiente' && !s.visto_por_solicitante).map((s) => s.id_solicitud);
			if (noVistas.length > 0) {
				const result = await marcarSolicitudesVistas(supabase, noVistas);
				if (result.success) {
					misSolicitudes = misSolicitudes.map((s) =>
						noVistas.includes(s.id_solicitud) ? { ...s, visto_por_solicitante: true } : s
					);
				} else {
					console.error('[NotificacionesBell] No se pudo marcar como vistas:', result.message);
				}
			}
		}
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
			await cargarAdmin();
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
			await cargarAdmin();
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
		{#if badgeCount > 0}
			<span class="absolute -top-1 -right-1 min-w-[14px] h-3.5 px-0.5 bg-red-500 rounded-full border-2 border-white text-[8px] leading-none text-white font-bold flex items-center justify-center">
				{badgeCount > 9 ? '9+' : badgeCount}
			</span>
		{/if}
	</button>

	{#if isOpen}
		<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
		<div class="fixed inset-0 z-30" onclick={() => (isOpen = false)}></div>
		<!-- Responsive: en pantallas angostas (celular) se ancla al viewport completo (fixed + left/right
		     con margen) en vez de al botón de la campanita — con `w-96` fijo y `absolute right-0`, el
		     panel se salía por la izquierda de la pantalla en un teléfono porque la campanita no está
		     pegada al borde derecho real del header (hay avatar/nombre/logout después de ella). Desde
		     `sm:` para arriba vuelve al comportamiento de dropdown anclado al botón. -->
		<div class="fixed left-3 right-3 top-16 sm:absolute sm:left-auto sm:right-0 sm:top-auto sm:mt-2 sm:w-96 max-h-[70vh] overflow-y-auto bg-white rounded-2xl shadow-2xl border border-slate-100 z-40">
			<div class="p-4 border-b border-slate-100 sticky top-0 bg-white rounded-t-2xl">
				<h3 class="text-sm font-bold text-slate-800">{isAdmin() ? 'Solicitudes de aprobación' : 'Mis solicitudes'}</h3>
				<p class="text-xs text-slate-400 mt-0.5">
					{isAdmin()
						? 'Ediciones/eliminaciones pedidas por usuarios sin rango de administrador.'
						: 'Estado de tus solicitudes enviadas para aprobación de un administrador.'}
				</p>
			</div>

			{#if errorMsg}
				<div class="mx-4 mt-3 p-2.5 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-700">{errorMsg}</div>
			{/if}

			{#if isLoading}
				<div class="p-8 text-center text-slate-400 text-sm">
					<i class="fas fa-spinner fa-spin"></i> Cargando...
				</div>
			{:else if isAdmin()}
				{#if solicitudesAdmin.length === 0}
					<div class="p-8 text-center text-slate-400 text-sm">
						<i class="fas fa-check-circle text-2xl mb-2 block"></i>
						No hay solicitudes pendientes.
					</div>
				{:else}
					<div class="divide-y divide-slate-100">
						{#each solicitudesAdmin as s (s.id_solicitud)}
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
			{:else if misSolicitudes.length === 0}
				<div class="p-8 text-center text-slate-400 text-sm">
					<i class="fas fa-inbox text-2xl mb-2 block"></i>
					No tienes solicitudes enviadas.
				</div>
			{:else}
				<div class="divide-y divide-slate-100">
					{#each misSolicitudes as s (s.id_solicitud)}
						<div class="p-4">
							<div class="flex items-start justify-between gap-2 mb-1.5">
								<div class="min-w-0">
									<span class="inline-block px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide bg-slate-100 text-slate-600 border border-slate-200 mr-1.5">
										{etiquetaEntidad(s.tipo_entidad)}
									</span>
									<span class="inline-block px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide bg-slate-100 text-slate-600 border border-slate-200 mr-1.5">
										{etiquetaAccion(s.tipo_accion)}
									</span>
									<span class="inline-block px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide border {claseEstado(s.estado)}">
										{etiquetaEstado(s.estado)}
									</span>
									<p class="text-sm font-semibold text-slate-800 truncate mt-1">{s.descripcion_entidad || `#${s.id_entidad}`}</p>
								</div>
							</div>
							<p class="text-[11px] text-slate-400">
								{fmtFecha(s.created_at)}
								{#if s.estado !== 'pendiente' && s.resuelto_por}
									· Resuelto por <span class="font-medium text-slate-500">{s.resuelto_por}</span>
								{/if}
							</p>
						</div>
					{/each}
				</div>
			{/if}
		</div>
	{/if}
</div>
