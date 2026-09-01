<script lang="ts">
	// Botón flotante de "+" para la(s) acción(es) principal(es) de la página en pantallas angostas — a
	// pedido del usuario: en el celular, un botón grande dentro del header hacía que todo se viera
	// amontonado junto con los filtros. Mismo patrón visual/posición que el botón flotante del menú
	// móvil en (app)/+layout.svelte (fixed, circular, sombra), pero en la esquina opuesta (bottom-right
	// en vez de bottom-left) para no superponerse.
	//
	// Con UNA sola acción, tocar el FAB la dispara directo. Con DOS o más (ej. Transacciones: "Nueva
	// Transacción" + "Movimientos de Caja", que antes vivían como botones de header y el segundo
	// terminaba desbordando la pantalla en móvil), tocar el FAB despliega un mini-menú (speed dial) con
	// una pastilla por acción — se cierra tocando afuera, eligiendo una acción, o tocando el FAB de nuevo.
	import { Plus } from '@lucide/svelte';
	import type { MobileFabAction } from '$lib/stores/mobileFab.svelte';

	let { actions }: { actions: MobileFabAction[] } = $props();
	let open = $state(false);

	function handleMainClick() {
		if (actions.length <= 1) {
			actions[0]?.onclick();
			return;
		}
		open = !open;
	}

	function handleActionClick(action: MobileFabAction) {
		open = false;
		action.onclick();
	}

	// El $effect (no un simple `if`) es necesario acá porque `actions` puede cambiar de identidad al
	// navegar entre dos páginas que ambas usan el FAB (ver setMobileFabActions) — sin esto, un menú que
	// quedó abierto en la página anterior se quedaría abierto (con acciones ya no válidas) al llegar a
	// la nueva.
	$effect(() => {
		actions;
		open = false;
	});
</script>

{#if actions.length > 0}
	{#if open}
		<button
			type="button"
			class="md:hidden fixed inset-0 z-20 bg-transparent"
			aria-label="Cerrar menú"
			onclick={() => (open = false)}
		></button>
	{/if}

	<div class="md:hidden fixed bottom-5 right-5 z-30 flex flex-col items-end gap-3">
		{#if open}
			{#each actions as action (action.label)}
				<button
					type="button"
					onclick={() => handleActionClick(action)}
					class="flex items-center gap-2.5 pl-4 pr-1.5 py-1.5 rounded-full bg-white text-[#0f3b5e] shadow-lg border border-slate-200 text-sm font-medium active:scale-95 transition-transform"
				>
					{action.label}
					<span class="w-9 h-9 rounded-full bg-[#0f3b5e] text-white flex items-center justify-center shrink-0">
						<action.icon size={16} />
					</span>
				</button>
			{/each}
		{/if}
		<button
			type="button"
			onclick={handleMainClick}
			class="w-14 h-14 rounded-full bg-[#0f3b5e] text-white shadow-lg shadow-black/20 flex items-center justify-center active:scale-95 transition-transform"
			aria-label={actions.length <= 1 ? actions[0]?.label : open ? 'Cerrar menú de acciones' : 'Más acciones'}
			aria-expanded={actions.length > 1 ? open : undefined}
		>
			<Plus size={26} class={`transition-transform duration-200 ${open ? 'rotate-45' : ''}`} />
		</button>
	</div>
{/if}
