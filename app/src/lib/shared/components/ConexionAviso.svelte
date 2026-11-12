<script lang="ts">
	/**
	 * Aviso "Sin conexión" en toda la app (va en el layout, por encima de los modales). Al volver la conexión muestra
	 * "Conexión restablecida" unos segundos. Ver $lib/stores/conexion.svelte.ts.
	 */
	import { fly } from 'svelte/transition';
	import { conexion } from '$lib/stores/conexion.svelte';

	let restablecida = $state(false);
	let anterior = conexion.enLinea;
	let timer: ReturnType<typeof setTimeout> | undefined;

	$effect(() => {
		const ahora = conexion.enLinea;
		if (ahora && !anterior) {
			restablecida = true;
			clearTimeout(timer);
			timer = setTimeout(() => (restablecida = false), 4000);
		}
		if (!ahora) restablecida = false;
		anterior = ahora;
		return () => clearTimeout(timer);
	});
</script>

{#if !conexion.enLinea}
	<div role="alert" class="fixed bottom-4 left-1/2 -translate-x-1/2 z-[300] max-w-[calc(100vw-2rem)] flex items-center gap-2 px-4 py-2.5 rounded-full bg-rose-600 text-white text-sm font-semibold shadow-lg" transition:fly={{ y: 20, duration: 200 }}>
		<i class="fas fa-wifi"></i>
		<span>Sin conexión a internet. No guardes cambios hasta que vuelva.</span>
	</div>
{:else if restablecida}
	<div role="status" class="fixed bottom-4 left-1/2 -translate-x-1/2 z-[300] max-w-[calc(100vw-2rem)] flex items-center gap-2 px-4 py-2.5 rounded-full bg-emerald-600 text-white text-sm font-semibold shadow-lg" transition:fly={{ y: 20, duration: 200 }}>
		<i class="fas fa-check"></i>
		<span>Conexión restablecida.</span>
	</div>
{/if}
