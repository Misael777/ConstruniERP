<script lang="ts">
	// Botón flotante de "+" para la acción principal de alta (Nuevo Cliente/Nueva Transacción/etc.) en
	// pantallas angostas — a pedido del usuario: en el celular, un botón grande dentro del header hacía
	// que todo se viera amontonado junto con los filtros. Mismo patrón visual/posición que el botón
	// flotante del menú móvil en (app)/+layout.svelte (fixed, circular, sombra), pero en la esquina
	// opuesta (bottom-right en vez de bottom-left) para no superponerse — solo visible en md:hidden,
	// el botón normal del header sigue siendo la vía de alta en escritorio (ver `hidden md:flex`/
	// `md:inline-flex` que cada página le agrega a su botón original al adoptar este componente).
	import { Plus } from '@lucide/svelte';

	let { onclick, label = 'Nuevo' }: { onclick: () => void; label?: string } = $props();
</script>

<button
	type="button"
	{onclick}
	class="md:hidden fixed bottom-5 right-5 z-30 w-14 h-14 rounded-full bg-[#0f3b5e] text-white shadow-lg shadow-black/20 flex items-center justify-center active:scale-95 transition-transform"
	aria-label={label}
	title={label}
>
	<Plus size={26} />
</button>
