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

	// Respaldo del Realtime — las versiones nuevas son poco frecuentes (a diferencia de
	// solicitud_aprobacion/ticket), así que este intervalo puede ser largo sin que se sienta lento.
	const POLL_INTERVAL_MS = 5 * 60 * 1000;

	let release = $state<AppRelease | null>(null);
	let isOpen = $state(false);
	let versionInstalada = '';
	/** Última versión por la que YA se mandó la notificación nativa — evita re-notificar en cada poll/
	 * evento Realtime mientras siga siendo la misma release ya avisada. */
	let versionYaNotificada: string | null = null;
	let channel: RealtimeChannel | null = null;
	let pollIntervalId: ReturnType<typeof setInterval> | null = null;

	/** Compara "1.2.10" > "1.2.9" por segmento numérico — un simple > de strings falla ahí (compara
	 * caracter por caracter). */
	function esMasNueva(remota: string, instalada: string): boolean {
		const a = remota.split('.').map(Number);
		const b = instalada.split('.').map(Number);
		for (let i = 0; i < Math.max(a.length, b.length); i++) {
			const x = a[i] ?? 0;
			const y = b[i] ?? 0;
			if (x !== y) return x > y;
		}
		return false;
	}

	async function verificarActualizacion() {
		try {
			const ultimo = await getUltimoRelease(supabase);
			if (!ultimo || !esMasNueva(ultimo.version, versionInstalada)) {
				release = null;
				return;
			}
			release = ultimo;
			if (versionYaNotificada !== ultimo.version) {
				versionYaNotificada = ultimo.version;
				await sendNotificacionNativa('Construni ERP', `Nueva versión disponible: v${ultimo.version}. Toca el ícono de descarga para actualizar.`);
			}
		} catch (err) {
			console.warn('[ActualizacionBell] No se pudo verificar la versión instalada:', err);
		}
	}

	onMount(async () => {
		if (!isRunningInTauri()) return;
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
