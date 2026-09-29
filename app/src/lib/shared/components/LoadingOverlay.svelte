<script lang="ts">
	/**
	 * Overlay global de espera larga (ticket #9) — se monta UNA sola vez en el `+layout.svelte` raíz, y se
	 * activa/desactiva solo desde `$lib/stores/loading.svelte.ts` (nunca a mano desde acá). Cubre subidas a
	 * Drive, generación de PDF/comprobantes, OCR, la Edge Function de Empleados y la actualización de la app
	 * — ver ese archivo para la lista completa de puntos que lo disparan.
	 *
	 * z-[150]: por encima de cualquier modal de la app (el más alto hoy es z-[120]) y por debajo del Toast
	 * (z-[200], para que un error siga siendo visible aunque quede una carga colgada).
	 */
	import { loadingState } from '$lib/stores/loading.svelte';
	import SnoopyLoader from './SnoopyLoader.svelte';
</script>

{#if loadingState.visible}
	<div class="fixed inset-0 z-[150] flex items-center justify-center bg-slate-900/40 backdrop-blur-[1px]" role="status" aria-live="polite">
		<div class="rounded-2xl bg-white px-10 py-8 shadow-2xl">
			<SnoopyLoader mensaje={loadingState.mensaje} />
		</div>
	</div>
{/if}
