<script lang="ts">
	/**
	 * Snoopy saltando la cuerda (ticket #9) — solo la animación + el mensaje, sin posicionamiento propio,
	 * para poder usarse tanto suelto a pantalla completa (arranque de la app, login) como dentro de
	 * LoadingOverlay.svelte (la tarjeta flotante sobre el resto de la pantalla).
	 *
	 * `size` (ticket #9, rechazo): a pedido del cliente, el Snoopy de las pantallas COMPLETAS (login,
	 * arranque de la app) debe verse grande, proporcional a la referencia que adjuntó — 'lg' lo triplica
	 * (h-28 -> h-80). La tarjeta flotante de LoadingOverlay.svelte sigue en 'sm' (el tamaño de siempre):
	 * ahí sí se ve varias veces por sesión en esperas cortas, y agrandarla se sentiría como un salto brusco
	 * en medio de la pantalla en vez de una espera discreta.
	 */
	let { mensaje = 'Cargando…', size = 'sm' }: { mensaje?: string; size?: 'sm' | 'lg' } = $props();
</script>

<div class="flex flex-col items-center gap-3">
	<img
		src="/snoopy-loading.webp"
		alt=""
		width="164"
		height="320"
		class={`w-auto select-none ${size === 'lg' ? 'h-80' : 'h-28'}`}
		draggable="false"
	/>
	<p class="text-sm font-semibold text-[#0f3b5e] text-center">{mensaje}</p>
</div>
