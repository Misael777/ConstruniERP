<script lang="ts">
	/**
	 * Snoopy saltando la cuerda (ticket #9) — solo la animación + el mensaje, sin posicionamiento propio,
	 * para poder usarse tanto suelto a pantalla completa (arranque de la app, login) como dentro de
	 * LoadingOverlay.svelte (la tarjeta flotante sobre el resto de la pantalla).
	 */
	let { mensaje = 'Cargando…' }: { mensaje?: string } = $props();
</script>

<div class="flex flex-col items-center gap-3">
	<img src="/snoopy-loading.webp" alt="" width="164" height="320" class="h-28 w-auto select-none" draggable="false" />
	<p class="text-sm font-semibold text-[#0f3b5e] text-center">{mensaje}</p>
</div>
