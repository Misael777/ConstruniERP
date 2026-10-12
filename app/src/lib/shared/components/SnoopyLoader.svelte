<script lang="ts">
	/**
	 * Animación de carga — Snoopy saltando la cuerda + logo con anillo de carga (tickets #9 y #58).
	 *
	 * Ticket #58 (rediseño según la imagen de referencia del cliente): fondo azul oscuro (lo pone quien
	 * contiene a este componente — ver FONDO_CARGA), Snoopy nítido y blanco (sin la mancha gris bajo los
	 * pies), y debajo el isotipo dentro de un anillo blanco delgado que gira, "como el del BCP". Antes era
	 * un solo webp de 164×320 escalado (borroso) con el anillo azul y la sombra incrustados en la imagen.
	 *   - /snoopy-salto.webp: un cuadro limpio de la animación original (463×577, transparente).
	 *   - /logo-isotipo.png: el logo de /logo.png sin su cuadro azul.
	 * El salto y el giro del anillo son CSS.
	 *
	 * `size`: 'lg' para pantallas completas (arranque de la app, login); 'sm' para la tarjeta flotante de
	 * LoadingOverlay.svelte — 20% más grande que antes, a pedido del cliente para la app de escritorio.
	 */
	let { mensaje = 'Cargando…', size = 'sm' }: { mensaje?: string; size?: 'sm' | 'lg' } = $props();
</script>

<script lang="ts" module>
	/** Azul oscuro de fondo de la referencia del cliente (ticket #58) — úsalo en el contenedor. */
	export const FONDO_CARGA = '#0b2d5c';
</script>

<div class="flex flex-col items-center" class:gap-4={size === 'lg'} class:gap-3={size === 'sm'}>
	<img
		src="/snoopy-salto.webp"
		alt=""
		width="463"
		height="577"
		class={`snoopy-salto w-auto select-none ${size === 'lg' ? 'h-60 sm:h-72' : 'h-[134px]'}`}
		draggable="false"
	/>

	<div class={`relative shrink-0 ${size === 'lg' ? 'w-24 h-24 sm:w-28 sm:h-28' : 'w-[77px] h-[77px]'}`} aria-hidden="true">
		<svg viewBox="0 0 100 100" class="absolute inset-0 w-full h-full">
			<circle cx="50" cy="50" r="46" fill="none" stroke="rgba(255,255,255,0.22)" stroke-width="4" />
			<circle class="anillo-carga" cx="50" cy="50" r="46" fill="none" stroke="#ffffff" stroke-width="4" stroke-linecap="round" stroke-dasharray="72 217" />
		</svg>
		<img src="/logo-isotipo.png" alt="" class="absolute inset-0 m-auto h-[46%] w-auto select-none" draggable="false" />
	</div>

	<p class={`font-semibold text-white text-center ${size === 'lg' ? 'text-base' : 'text-sm'}`}>{mensaje}</p>
</div>

<style>
	/* Ticket #58 (rechazo "falta que salte"): el salto era sutil (7%) y además se apagaba con el ajuste
	   "reducir animaciones" del celular/Windows. Ahora es un salto claro, con un leve aplastamiento al caer,
	   y se mantiene siempre: es la propia señal de "cargando". */
	.snoopy-salto {
		animation: snoopy-salto 0.7s cubic-bezier(0.33, 0, 0.67, 1) infinite;
		transform-origin: 50% 100%;
		will-change: transform;
	}
	@keyframes snoopy-salto {
		0% {
			transform: translateY(0) scale(1.04, 0.94);
		}
		12% {
			transform: translateY(0) scale(1, 1);
		}
		50% {
			transform: translateY(-18%) scale(0.98, 1.03);
		}
		88% {
			transform: translateY(0) scale(1, 1);
		}
		100% {
			transform: translateY(0) scale(1.04, 0.94);
		}
	}
	.anillo-carga {
		transform-origin: 50% 50%;
		animation: anillo-giro 1s linear infinite;
	}
	@keyframes anillo-giro {
		to {
			transform: rotate(360deg);
		}
	}
</style>
