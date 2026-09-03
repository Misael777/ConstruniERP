<script lang="ts">
	/**
	 * <select> a medida (no el nativo del navegador) para los dropdowns que necesitan mostrar un saldo/
	 * monto pegado al lado DERECHO de cada opción — a pedido explícito del usuario, con imagen de
	 * referencia. Un `<option>` nativo es texto plano puro, sin ningún control de layout (no se puede
	 * alinear nada a la derecha dentro de él), así que estos dropdowns puntuales (Cuenta Origen/Destino y
	 * Centro de Costo Origen/Destino en TransaccionModal.svelte) reemplazan el `<select>` nativo por este
	 * botón + panel propio, mismo aspecto visual (borde, radio, foco) que el resto del formulario. El
	 * saldo/monto SOLO se muestra en las opciones de la lista desplegada — a pedido explícito del
	 * usuario, el campo ya cerrado (con una opción elegida) muestra nomás la etiqueta, sin el saldo al
	 * costado, para no romper la simetría del resto de los campos del formulario (ninguno de los demás
	 * campos del formulario repite un dato calculado junto a su propio valor ya elegido).
	 *
	 * El panel se posiciona con `position:fixed` calculado a mano (coordenadas reales del botón en
	 * pantalla, ver posicionarPanel) en vez de `position:absolute` normal — a pedido explícito del
	 * usuario: debe poder ser MÁS ANCHO que el propio campo (para no truncar etiquetas largas + su
	 * saldo) y "sobresalir" del popup de Nueva/Editar Transacción si hace falta. El modal tiene
	 * `overflow-y-auto`, y por la spec de CSS un contenedor con overflow en un solo eje recorta el OTRO
	 * eje también — cualquier hijo `absolute` más ancho que su columna se cortaría contra el borde del
	 * popup. `fixed` escapa ese recorte por completo (mientras ningún ancestro tenga transform/filter/
	 * will-change, que no es el caso acá), quedando "flotando" libre sobre toda la pantalla.
	 *
	 * A pedido explícito del usuario: trae un buscador arriba de la lista (se enfoca solo al abrir) para
	 * escribir la inicial o algunas letras y filtrar rápido cuando la lista es larga — sin distinguir
	 * mayúsculas ni tildes. 100% DOM/eventos estándar — funciona igual en navegador, Tauri Windows y
	 * Tauri Android/iOS.
	 */
	import { ChevronDown, Search } from '@lucide/svelte';
	import { formatCurrency } from '$lib/shared/fieldConfig';

	export interface OptionConSaldo {
		value: string;
		label: string;
		/** undefined = sin saldo conocido para esa opción (todavía cargando, o no aplica) — no se muestra
		 * nada al costado, en vez de un "S/ 0.00" engañoso. */
		saldo?: number;
	}

	let {
		id,
		value = '',
		options,
		disabled = false,
		placeholder = 'Selecciona una opción',
		hasError = false,
		onchange
	}: {
		id?: string;
		value?: string;
		options: OptionConSaldo[];
		disabled?: boolean;
		placeholder?: string;
		hasError?: boolean;
		onchange: (value: string) => void;
	} = $props();

	let open = $state(false);
	let buttonEl: HTMLButtonElement | undefined = $state();
	let panelEl: HTMLDivElement | undefined = $state();
	let buscadorEl: HTMLInputElement | undefined = $state();
	let panelStyle = $state('');
	let busqueda = $state('');

	const selected = $derived(options.find((o) => o.value === value) ?? null);

	/** Sin tildes ni mayúsculas, para que "peru" encuentre "Perú" — mismo criterio que sinTildes en
	 * ocrComprobante.ts. */
	function normalizar(texto: string): string {
		return texto
			.normalize('NFD')
			.replace(/[̀-ͯ]/g, '')
			.toLowerCase();
	}
	const opcionesFiltradas = $derived.by(() => {
		const q = normalizar(busqueda.trim());
		if (!q) return options;
		return options.filter((o) => normalizar(o.label).includes(q));
	});

	// Más ancho que el propio botón (a pedido explícito del usuario) — ANCHO_MIN fijo, salvo que el
	// botón ya sea más ancho que eso (columnas anchas en desktop), y siempre acotado al viewport (con
	// margen) para no salirse de la pantalla en un celular angosto.
	const ANCHO_MIN_PANEL = 340;
	function posicionarPanel() {
		if (!buttonEl) return;
		const rect = buttonEl.getBoundingClientRect();
		const anchoDisponible = window.innerWidth - 16;
		const ancho = Math.min(Math.max(rect.width, ANCHO_MIN_PANEL), anchoDisponible);
		let left = rect.left;
		if (left + ancho > window.innerWidth - 8) left = Math.max(8, window.innerWidth - ancho - 8);
		const alturaMax = Math.max(160, Math.min(360, window.innerHeight - rect.bottom - 16));
		panelStyle = `position:fixed; top:${rect.bottom + 4}px; left:${left}px; width:${ancho}px; max-height:${alturaMax}px;`;
	}

	function toggle() {
		if (disabled) return;
		if (!open) {
			busqueda = '';
			posicionarPanel();
		}
		open = !open;
	}
	function choose(opt: OptionConSaldo) {
		onchange(opt.value);
		open = false;
	}
	function handleClickFuera(e: MouseEvent) {
		if (!open) return;
		const target = e.target as Node;
		if (buttonEl?.contains(target) || panelEl?.contains(target)) return;
		open = false;
	}
	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') open = false;
	}
	function handleBuscadorKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && opcionesFiltradas.length > 0) {
			e.preventDefault();
			choose(opcionesFiltradas[0]);
		}
	}

	// Enfoca el buscador apenas se abre el panel, para poder escribir de inmediato.
	$effect(() => {
		if (open && buscadorEl) buscadorEl.focus();
	});

	// Cierra al hacer scroll de CUALQUIER ancestro FUERA del propio panel (ej. el popup de Transacción
	// desplazándose por detrás) — capture:true es necesario porque los eventos "scroll" de un elemento
	// normal no burbujean hasta window, solo se pueden interceptar en la fase de captura. OJO: un scroll
	// que ocurre DENTRO del panel (la propia lista de opciones, con su barra lateral) NO debe cerrarlo —
	// sin este chequeo, la barra lateral del panel "no funcionaba": el primer intento de desplazar la
	// lista disparaba este mismo listener y cerraba el dropdown antes de que se viera nada.
	$effect(() => {
		if (!open) return;
		const cerrar = (e: Event) => {
			if (panelEl && e.target instanceof Node && panelEl.contains(e.target)) return;
			open = false;
		};
		window.addEventListener('scroll', cerrar, true);
		window.addEventListener('resize', cerrar);
		return () => {
			window.removeEventListener('scroll', cerrar, true);
			window.removeEventListener('resize', cerrar);
		};
	});
</script>

<svelte:window onclick={handleClickFuera} onkeydown={handleKeydown} />

<button
	type="button"
	{id}
	{disabled}
	bind:this={buttonEl}
	onclick={toggle}
	aria-haspopup="listbox"
	aria-expanded={open}
	class={`w-full flex items-center gap-2 rounded-lg border px-3 py-2 text-sm text-left focus:outline-none focus:ring-2 disabled:opacity-60 disabled:bg-slate-50 ${hasError ? 'border-red-400 focus:ring-red-200' : 'border-slate-300 focus:ring-blue-200'}`}
>
	{#if selected}
		<span class="flex-1 min-w-0 truncate text-slate-700">{selected.label}</span>
	{:else}
		<span class="flex-1 min-w-0 truncate text-slate-400">{placeholder}</span>
	{/if}
	<ChevronDown size={16} class="shrink-0 text-slate-400" />
</button>

{#if open}
	<div bind:this={panelEl} style={panelStyle} class="z-[200] flex flex-col rounded-lg border border-slate-200 bg-white shadow-xl overflow-hidden">
		<div class="relative p-1.5 border-b border-slate-100 shrink-0">
			<Search size={13} class="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
			<input
				bind:this={buscadorEl}
				type="text"
				bind:value={busqueda}
				onkeydown={handleBuscadorKeydown}
				placeholder="Escribe para buscar..."
				class="w-full rounded-md border border-slate-200 pl-7 pr-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-blue-200"
			/>
		</div>
		<div role="listbox" class="flex-1 min-h-0 overflow-y-auto py-1">
			{#each opcionesFiltradas as opt (opt.value)}
				<button
					type="button"
					role="option"
					aria-selected={opt.value === value}
					onclick={() => choose(opt)}
					class={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-slate-50 ${opt.value === value ? 'bg-blue-50 text-blue-700 font-medium' : 'text-slate-700'}`}
				>
					<span class="flex-1 min-w-0 truncate">{opt.label}</span>
					{#if opt.saldo !== undefined}
						<span class={`shrink-0 font-semibold ${opt.saldo >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{formatCurrency(opt.saldo)}</span>
					{/if}
				</button>
			{:else}
				<p class="px-3 py-2 text-sm text-slate-400">{busqueda.trim() ? 'Sin resultados para tu búsqueda.' : 'Sin opciones disponibles.'}</p>
			{/each}
		</div>
	</div>
{/if}
