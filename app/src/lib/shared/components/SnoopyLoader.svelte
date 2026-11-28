<script lang="ts">
	/**
	 * Animación de carga — Snoopy saltando la cuerda + logo con anillo de carga (tickets #9, #58 y #85).
	 *
	 * Ticket #58 (rediseño según la imagen de referencia del cliente): fondo azul oscuro (lo pone quien
	 * contiene a este componente — ver FONDO_CARGA), Snoopy nítido y blanco (sin la mancha gris bajo los
	 * pies), y debajo el isotipo dentro de un anillo blanco delgado que gira, "como el del BCP". Antes era
	 * un solo webp de 164×320 escalado (borroso) con el anillo azul y la sombra incrustados en la imagen.
	 *   - /snoopy-salto.webp: un cuadro limpio de la animación original (463×577, transparente).
	 *   - /logo-isotipo.png: el logo de /logo.png sin su cuadro azul.
	 * El salto y el giro del anillo son CSS.
	 *
	 * Ticket #85 (que los pies se muevan como si saltara de verdad): el webp es UN solo cuadro, así que las dos
	 * piernas se recortan de la MISMA imagen con clip-path (capas encima del cuerpo, que a su vez tiene esa zona
	 * recortada) y se animan aparte, ALTERNADAS como si corriera: una pierna apoyada mientras la otra sube con la
	 * rodilla doblada y el pie con la punta hacia abajo (gira desde el tobillo); a cada rebote cambian. Solo CSS, igual en navegador,
	 * Tauri Windows y Android.
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
	<div class={`snoopy-salto relative select-none ${size === 'lg' ? 'h-60 sm:h-72' : 'h-[134px]'}`} aria-hidden="true">
		<!-- Piernas: la misma imagen recortada (pierna y pie por separado), animada aparte. El pie va dentro de su
		     pierna para heredar su movimiento y sumarle el giro del tobillo. -->
		{#each ["izq", "der"] as lado (lado)}
			<div class={`snoopy-pierna snoopy-pierna-${lado} absolute inset-0`}>
				<img src="/snoopy-salto.webp" alt="" width="463" height="577" class={`snoopy-parte snoopy-muslo-${lado} absolute inset-0 h-full w-auto`} draggable="false" />
				<img src="/snoopy-salto.webp" alt="" width="463" height="577" class={`snoopy-parte snoopy-pie-${lado} absolute inset-0 h-full w-auto`} draggable="false" />
			</div>
		{/each}
		<!-- Cuerpo + cuerda, sin las piernas: va ENCIMA de ellas (relative + después en el DOM), así al encogerse
		     se meten bajo el chaleco en vez de mostrar cortes. Es el que da el tamaño al contenedor. -->
		<img src="/snoopy-sin-cuerda.webp" alt="" width="463" height="577" class="snoopy-cuerpo relative h-full w-auto" draggable="false" />
		<!-- Ticket #85 (27/11/2026: "la cuerda también debe estar en movimiento"): la cuerda va en su propia capa
		     (/snoopy-cuerda.webp, recortada de la misma imagen) y gira desde las manijas: pasa por delante y bajo los
		     pies justo cuando Snoopy está en lo alto del salto. -->
		<img src="/snoopy-cuerda.webp" alt="" width="463" height="577" class="snoopy-cuerda absolute inset-0 h-full w-auto" draggable="false" />
	</div>

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

	/* Recortes, medidos píxel a píxel sobre la imagen (463×577) ampliada con cuadrícula. Las piernas se unen en la
	   cadera (fila 488 = 84.6%) y desde ahí las separa la línea negra del dibujo, que baja en zigzag:
	   (217,490) → (197,521) → (227,577). Los recortes siguen esa línea (cada pierna se queda con el trazo negro,
	   así ninguna pierde su contorno). Pies: el izquierdo apunta hacia abajo (se corta en horizontal a la altura
	   del tobillo, fila 545); el derecho apunta a la derecha (se corta en vertical, columna 248). Cada parte se
	   solapa con su vecina de arriba (la pierna sigue por debajo de su pie, 4–6%): al girar el pie, lo que queda
	   a la vista detrás es la propia pierna y no un hueco; el cuerpo deja libre la zona de las
	   piernas desde el 85.5% (la cola, que llega a la fila 480, queda en el cuerpo), salvo un "diente" fijo en la
	   entrepierna (a la izquierda de la línea, entre 85.5% y 88%) que no deja ver un hueco cuando una pierna se encoge. El cuerpo se dibuja
	   ENCIMA de las piernas. La línea entre los dos pies (de la fila 536 hacia abajo) es del pie izquierdo. */
	.snoopy-cuerpo {
		clip-path: polygon(0 0, 100% 0, 100% 100%, 75% 100%, 75% 85.5%, 47.2% 85.5%, 46.6% 86.7%, 46% 88%, 43% 88%, 43% 85.5%, 15% 85.5%, 15% 100%, 0 100%);
	}
	.snoopy-pierna,
	.snoopy-parte {
		will-change: transform;
		/* Un ciclo de carrera = dos saltos (1.4 s): un paso con cada pierna. */
		animation-duration: 1.4s;
		animation-iteration-count: infinite;
		animation-timing-function: ease-in-out;
	}
	.snoopy-pierna-izq {
		transform-origin: 36% 85%; /* cadera izquierda */
		animation-name: pierna-izq;
	}
	.snoopy-pierna-der {
		transform-origin: 56% 85%; /* cadera derecha */
		animation-name: pierna-der;
	}
	.snoopy-muslo-izq {
		clip-path: polygon(15% 84%, 47.2% 84%, 47.2% 86.7%, 46.3% 88%, 44.6% 89.3%, 42.9% 90.3%, 44.4% 91.7%, 46.5% 92.9%, 47.6% 94.5%, 48.5% 96.2%, 48.9% 97.9%, 49% 98.5%, 15% 98.5%);
	}
	.snoopy-pie-izq {
		clip-path: polygon(15% 94.4%, 47.8% 94.4%, 48.5% 96.2%, 48.9% 97.9%, 49.3% 100%, 15% 100%);
		transform-origin: 42% 94.6%; /* tobillo izquierdo */
		animation-name: pie-izq;
	}
	.snoopy-muslo-der {
		clip-path: polygon(46.5% 84%, 75% 84%, 75% 89%, 60% 89%, 60% 100%, 49.2% 100%, 48.8% 97.9%, 48.4% 96.2%, 47.7% 94.5%, 46.6% 92.9%, 43.8% 91.7%, 42.3% 90.3%, 44% 89.3%, 45.8% 88%, 46.4% 86.7%);
	}
	.snoopy-pie-der {
		clip-path: polygon(53.5% 89%, 75% 89%, 75% 100%, 53.5% 100%);
		transform-origin: 54% 93.2%; /* tobillo derecho */
		animation-name: pie-der;
	}
	/* Carrera (a pedido del usuario: "que tenga movimiento como si corriera"): las piernas van ALTERNADAS. Mientras
	   una está apoyada (estirada, empujando), la otra sube con la rodilla doblada (se acorta desde la cadera y se
	   abre un poco hacia afuera: hacia adentro destapaba la entrepierna) y baja a apoyarse; a la mitad del ciclo cambian. Cada pisada cae
	   con un rebote del cuerpo (0% y 50%, que es cuando .snoopy-salto toca el suelo). La derecha es la izquierda
	   espejada y corrida medio ciclo. */
	@keyframes pierna-izq {
		0%,
		100% {
			transform: rotate(1deg) scaleY(1);
		}
		25% {
			transform: rotate(3deg) scaleY(1.02);
		}
		40% {
			transform: rotate(4deg) scaleY(0.75);
		}
		55% {
			transform: rotate(6deg) scaleY(0.62);
		}
		75% {
			transform: rotate(3deg) scaleY(0.85);
		}
		90% {
			transform: rotate(1deg) scaleY(1);
		}
	}
	@keyframes pierna-der {
		0%,
		100% {
			transform: rotate(-5.3deg) scaleY(0.66);
		}
		5% {
			transform: rotate(-6deg) scaleY(0.62);
		}
		25% {
			transform: rotate(-3deg) scaleY(0.85);
		}
		40% {
			transform: rotate(-1deg) scaleY(1);
		}
		50% {
			transform: rotate(-1deg) scaleY(1);
		}
		75% {
			transform: rotate(-3deg) scaleY(1.02);
		}
		90% {
			transform: rotate(-4deg) scaleY(0.75);
		}
	}
	/* Pies (desde el tobillo): planos mientras su pierna está apoyada; al despegar empujan con la punta y en el
	   aire la punta queda apuntando hacia abajo; se aplanan justo antes de pisar. La punta del izquierdo mira a la
	   izquierda (gira en negativo para bajar) y la del derecho a la derecha (en positivo). */
	@keyframes pie-izq {
		0%,
		25%,
		90%,
		100% {
			transform: rotate(0deg);
		}
		35% {
			transform: rotate(-7deg);
		}
		55% {
			transform: rotate(-14deg);
		}
		75% {
			transform: rotate(-6deg);
		}
	}
	@keyframes pie-der {
		0%,
		100% {
			transform: rotate(10deg);
		}
		5% {
			transform: rotate(12deg);
		}
		25% {
			transform: rotate(5deg);
		}
		40%,
		75% {
			transform: rotate(0deg);
		}
		85% {
			transform: rotate(6deg);
		}
	}

	/* La cuerda gira desde las manijas (fila 352 de 577 = 61%). Mismo ciclo que el salto (0.7 s): arriba de la cabeza
	   al caer (0%) y bajo los pies en lo alto del salto (50%). scaleY negativo = la cuerda volteada hacia abajo; -0.66
	   la deja justo bajo los pies. Pasos tipo coseno para que el giro se vea parejo. */
	.snoopy-cuerda {
		transform-origin: 50% 61%;
		will-change: transform;
		animation: cuerda-giro 0.7s linear infinite;
	}
	@keyframes cuerda-giro {
		0%,
		100% {
			transform: scaleY(1);
		}
		12.5% {
			transform: scaleY(0.7);
		}
		25% {
			transform: scaleY(0.02);
		}
		37.5% {
			transform: scaleY(-0.47);
		}
		50% {
			transform: scaleY(-0.66);
		}
		62.5% {
			transform: scaleY(-0.47);
		}
		75% {
			transform: scaleY(0.02);
		}
		87.5% {
			transform: scaleY(0.7);
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
