<script lang="ts">
	// Ícono de "actualización disponible" en el header — visible para CUALQUIER usuario de la app
	// instalada (Windows/Android vía Tauri), sin depender de que su ticket puntual haya quedado
	// incluido en ese release (a diferencia del banner "Incluido en la vX.Y.Z" dentro de un ticket,
	// ver TicketDetalleModal.svelte). Compara la versión instalada (tauri.conf.json, leída vía
	// @tauri-apps/api/app) contra el último release publicado (app_release, ver releases.service.ts)
	// — si hay una más nueva, muestra un punto y el panel reusa BotonActualizar (mismo componente que
	// ya sabe actualizar en Windows vs Android). Fuera de Tauri (navegador/`npm run dev`) no se
	// renderiza nada — no hay "versión instalada" que comparar.
	import { onMount } from 'svelte';
	import { Download } from '@lucide/svelte';
	import { supabase } from '$lib/supabaseClient';
	import { isRunningInTauri } from '$lib/driveUploadClient';
	import { getUltimoRelease, type AppRelease } from '$lib/modules/tickets/services/releases.service';
	import BotonActualizar from '$lib/shared/components/BotonActualizar.svelte';

	let release = $state<AppRelease | null>(null);
	let isOpen = $state(false);

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

	onMount(async () => {
		if (!isRunningInTauri()) return;
		try {
			const [ultimo, { getVersion }] = await Promise.all([getUltimoRelease(supabase), import('@tauri-apps/api/app')]);
			const instalada = await getVersion();
			if (ultimo && esMasNueva(ultimo.version, instalada)) {
				release = ultimo;
			}
		} catch (err) {
			console.warn('[ActualizacionBell] No se pudo verificar la versión instalada:', err);
		}
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
