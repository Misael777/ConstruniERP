<script lang="ts">
	// Ícono de "actualización disponible" en el header — visible para CUALQUIER usuario de la app
	// instalada (Windows/Android vía Tauri), sin depender de que su ticket puntual haya quedado
	// incluido en ese release (a diferencia del banner "Incluido en la vX.Y.Z" dentro de un ticket,
	// ver TicketDetalleModal.svelte). Compara la versión instalada (tauri.conf.json, leída vía
	// @tauri-apps/api/app) contra el último release publicado (app_release, ver releases.service.ts)
	// — si hay una más nueva, muestra un punto y el panel reusa BotonActualizar (mismo componente que
	// ya sabe actualizar en Windows vs Android). Fuera de Tauri (navegador/`npm run dev`) no se
	// renderiza nada — no hay "versión instalada" que comparar.
	//
	// A pedido explícito del usuario: antes solo revisaba una vez al abrir la app (onMount) — si
	// publicabas una versión nueva mientras alguien ya tenía la app abierta, no se enteraba hasta
	// reiniciarla. Ahora, mismo mecanismo que NotificacionesBell.svelte: Realtime (websocket,
	// suscrito a INSERT en app_release, ver app_release_realtime_migration.sql — hay que correrla)
	// como mecanismo PRINCIPAL, más un polling de respaldo por si el socket se cae. Al detectar una
	// versión genuinamente nueva (que todavía no se había avisado), también dispara una notificación
	// nativa del SO (sendNotificacionNativa) — no solo el punto verde del ícono, que se puede pasar
	// por alto si el usuario no mira el header.
	import { onMount, onDestroy } from 'svelte';
	import type { RealtimeChannel } from '@supabase/supabase-js';
	import { Download } from '@lucide/svelte';
	import { supabase } from '$lib/supabaseClient';
	import { isRunningInTauri } from '$lib/driveUploadClient';
	import { getUltimoRelease, type AppRelease } from '$lib/modules/tickets/services/releases.service';
	import { sendNotificacionNativa } from '$lib/modules/aprobaciones/services/notificacionNativa';
	import BotonActualizar from '$lib/shared/components/BotonActualizar.svelte';
	import { esVersionMasNueva } from '$lib/shared/appVersion';

	// Respaldo del Realtime — las versiones nuevas son poco frecuentes (a diferencia de
	// solicitud_aprobacion/ticket), así que este intervalo puede ser largo sin que se sienta lento.
	const POLL_INTERVAL_MS = 5 * 60 * 1000;

	let release = $state<AppRelease | null>(null);
	let isOpen = $state(false);
	let versionInstalada = '';
	/** Ticket #26 (sonido de notificación repetido sin motivo aparente): esto vivía solo en memoria
	 * (una variable de módulo), a diferencia del mecanismo equivalente de NotificacionesBell.svelte, que
	 * persiste "ya notificado" en la base de datos — sobrevive un remount, esto no. En un WebView de
	 * Android, el sistema recrea la Activity/WebView bastante seguido (rotar la pantalla, la app pasa a
	 * segundo plano y Android le libera memoria, etc.), lo que remonta este componente: `onMount` vuelve
	 * a correr con `versionYaNotificada = null`, y como YA existe una versión más nueva sin instalar (el
	 * caso normal mientras el usuario no actualiza), `verificarActualizacion()` la trata como "nunca
	 * avisada" y dispara sendNotificacionNativa() de nuevo — de ahí el sonido "constante" sin que pase
	 * nada nuevo en la base de datos. Persistir en localStorage (sobrevive un remount, no un reinstall)
	 * cierra ese hueco. Se guarda por versión INSTALADA (no solo la remota) para que, apenas se
	 * actualice de verdad, el próximo release SÍ vuelva a avisar. */
	const LS_KEY_ULTIMA_NOTIFICADA = 'construnierp_version_ya_notificada';
	function leerVersionYaNotificada(): string | null {
		try {
			return localStorage.getItem(LS_KEY_ULTIMA_NOTIFICADA);
		} catch {
			return null;
		}
	}
	function guardarVersionYaNotificada(version: string) {
		try {
			localStorage.setItem(LS_KEY_ULTIMA_NOTIFICADA, version);
		} catch {
			// Best-effort — si localStorage no está disponible (privado/bloqueado), se degrada al
			// comportamiento anterior (solo en memoria) sin romper nada.
		}
	}
	let versionYaNotificada: string | null = null;
	let channel: RealtimeChannel | null = null;
	let pollIntervalId: ReturnType<typeof setInterval> | null = null;

	async function verificarActualizacion() {
		try {
			const ultimo = await getUltimoRelease(supabase);
			if (!ultimo || !esVersionMasNueva(ultimo.version, versionInstalada)) {
				release = null;
				return;
			}
			release = ultimo;
			if (versionYaNotificada !== ultimo.version) {
				versionYaNotificada = ultimo.version;
				guardarVersionYaNotificada(ultimo.version);
				await sendNotificacionNativa('Construni ERP', `Nueva versión disponible: v${ultimo.version}. Toca el ícono de descarga para actualizar.`);
			}
		} catch (err) {
			console.warn('[ActualizacionBell] No se pudo verificar la versión instalada:', err);
		}
	}

	onMount(async () => {
		if (!isRunningInTauri()) return;
		versionYaNotificada = leerVersionYaNotificada();
		try {
			const { getVersion } = await import('@tauri-apps/api/app');
			versionInstalada = await getVersion();
		} catch (err) {
			console.warn('[ActualizacionBell] No se pudo leer la versión instalada:', err);
			return;
		}

		await verificarActualizacion();

		// Mecanismo principal: Realtime (websocket) — apenas se publica un release nuevo (INSERT en
		// app_release, ver el script de deploy), este callback dispara una revisión inmediata. Requiere
		// app_release_realtime_migration.sql corrida en Supabase — si no, este canal simplemente no
		// recibe eventos y el polling de respaldo de abajo sigue cubriendo, más lento.
		channel = supabase
			.channel('app_release_changes')
			.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'app_release' }, () => verificarActualizacion())
			.subscribe();

		// Respaldo: si el websocket se corta, esto igual termina avisando, aunque con más demora.
		pollIntervalId = setInterval(verificarActualizacion, POLL_INTERVAL_MS);
	});

	onDestroy(() => {
		if (pollIntervalId) clearInterval(pollIntervalId);
		if (channel) supabase.removeChannel(channel);
	});
</script>

{#if release}
	<div class="relative">
		<button
			type="button"
			onclick={() => (isOpen = !isOpen)}
			class="text-slate-400 hover:text-emerald-600 relative"
			aria-label="Actualización disponible"
			title="Hay una actualización disponible"
		>
			<Download size={18} />
			<span class="absolute -top-1 -right-1 w-2.5 h-2.5 bg-emerald-500 rounded-full border-2 border-white"></span>
		</button>

		{#if isOpen}
			<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
			<div class="fixed inset-0 z-30" onclick={() => (isOpen = false)}></div>
			<div class="fixed left-3 right-3 top-16 sm:absolute sm:left-auto sm:right-0 sm:top-auto sm:mt-2 sm:w-72 bg-white rounded-2xl shadow-2xl border border-slate-100 z-40 p-4">
				<p class="text-sm font-bold text-slate-800">Nueva versión disponible</p>
				<p class="text-xs text-slate-500 mt-0.5 mb-3">v{release.version} ya está lista para instalar.</p>
				<BotonActualizar {release} />
			</div>
		{/if}
	</div>
{/if}
