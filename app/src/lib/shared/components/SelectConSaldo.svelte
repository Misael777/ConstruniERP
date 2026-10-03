<script lang="ts">
	/**
	 * <select> a medida (no el nativo del navegador) para los dropdowns que necesitan mostrar un saldo/
	 * monto pegado al lado DERECHO de cada opción — a pedido explícito del usuario, con imagen de
	 * referencia. Un `<option>` nativo es texto plano puro, sin ningún control de layout (no se puede
	 * alinear nada a la derecha dentro de él), así que estos dropdowns puntuales (Cuenta Origen/Destino y
	 * Centro de Costo Origen/Destino en TransaccionModal.svelte) reemplazan el `<select>` nativo por este
	 * botón + panel propio, mismo aspecto visual (borde, radio, foco) que el resto del formulario. El
	 * saldo/monto SOLO se muestra en las opciones de la lista desplegada — a pedido explícito del
	 * usuario, este componente ya cerrado (con una opción elegida) sigue mostrando nomás la etiqueta,
	 * sin el saldo al costado del botón — quien lo usa (ver saldoSeleccionado en TransaccionModal.svelte)
	 * sí muestra el saldo de la opción YA ELEGIDA en una línea aparte DEBAJO del botón, una vez cerrado;
	 * no es responsabilidad de este componente en sí, que se mantiene agnóstico de eso.
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
		/** Encabezado de grupo (ej. "Obra", "Consultoría") — a pedido explícito del usuario, para "Proyecto"
		 * cuando Categoría=Préstamo en TransaccionModal.svelte (ver esPrestamoCorporativoIngreso), que
		 * necesita mostrar TODOS los centros de costo agrupados por tipo. Como este no es un `<select>`
		 * nativo, no hay `<optgroup>` real — se imita con un encabezado antes de la primera opción de cada
		 * grupo. Requiere que `options` ya venga ORDENADO por grupo (esta lista no reordena nada, solo
		 * detecta cuándo cambia el grupo entre una opción y la anterior). undefined = sin agrupar (el resto
		 * de los usos de este componente, comportamiento sin cambios). */
		grupo?: string;
		/** Símbolo de moneda real de ESTA opción (ej. '$' para una cuenta bancaria en Dólares, 'S/.' en
		 * Soles) — a pedido explícito del usuario: reemplaza a formatCurrency (que siempre formatea en
		 * Soles) cuando viene definido. undefined = usa formatCurrency tal cual (comportamiento normal,
		 * ej. saldos de Centro de Costo, que no tienen una moneda propia distinta). */
		simbolo?: string;
	}

	let {
		id,
		value = '',
		options,
		disabled = false,
		placeholder = 'Selecciona una opción',
		hasError = false,
		encabezadoNombre = 'Nombre',
		onchange
	}: {
		id?: string;
		value?: string;
		options: OptionConSaldo[];
		disabled?: boolean;
		placeholder?: string;
		hasError?: boolean;
		/** Título de la 1.ª columna cuando la lista muestra saldos (ej. "Centro de costo", "Cuenta"). */
		encabezadoNombre?: string;
		onchange: (value: string) => void;
	} = $props();

	let open = $state(false);
	let buttonEl: HTMLButtonElement | undefined = $state();
	let panelEl: HTMLDivElement | undefined = $state();
	let buscadorEl: HTMLInputElement | undefined = $state();
	let panelStyle = $state('');
	let busqueda = $state('');

	const selected = $derived(options.find((o) => o.value === value) ?? null);
	/** A pedido del usuario: si alguna opción trae saldo, la lista se muestra en dos columnas ordenadas
	 * (nombre | saldo actual) con encabezado, letra más chica y el nombre completo (sin cortar). */
	const conSaldo = $derived(options.some((o) => o.saldo !== undefined));
	/** Permite cortar la línea después de cada "_" (códigos de proyecto largos sin espacios). */
	function conCortes(texto: string): string {
		return texto.replace(/_/g, '_\u200B');
	}

	/** A pedido explícito del usuario: si la opción trae un `simbolo` propio (moneda real de una cuenta
	 * bancaria, ej. '$' Dólares/'S/.' Soles), se usa ESE en vez de formatCurrency (que siempre formatea
	 * en Soles) — el número en sí se formatea igual (separador de miles + 2 decimales), solo cambia el
	 * símbolo de moneda. */
	const NUMERO_FORMATTER = new Intl.NumberFormat('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
	function formatSaldoOpcion(opt: OptionConSaldo): string {
		if (opt.saldo === undefined) return '';
		if (opt.simbolo) return `${opt.simbolo} ${NUMERO_FORMATTER.format(opt.saldo)}`;
		return formatCurrency(opt.saldo);
	}

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
	/** Lista con saldos (a pedido del usuario, sin espacio perdido entre columnas): el panel toma el ancho de
	 * su CONTENIDO — el nombre más largo (hasta ANCHO_MAX_NOMBRE; si es más largo pasa a una 2.ª línea) más
	 * el saldo más ancho — en vez de un mínimo fijo que empujaba el saldo lejos del nombre. Se mide con un
	 * canvas (estándar: igual en navegador, Tauri Windows y Tauri Android). */
	const ANCHO_MIN_PANEL_CON_SALDO = 240;
	const ANCHO_MAX_NOMBRE = 230;
	let lienzoMedida: CanvasRenderingContext2D | null = null;
	/** Ancho para listas sin saldo: el nombre más largo (con tope) — nunca menos que el propio botón. */
	function anchoContenidoSinSaldo(): number {
		lienzoMedida ??= document.createElement('canvas').getContext('2d');
		if (!lienzoMedida || !buttonEl) return ANCHO_MIN_PANEL;
		lienzoMedida.font = `500 11px ${getComputedStyle(buttonEl).fontFamily}`;
		let nombre = 0;
		for (const o of options) nombre = Math.max(nombre, lienzoMedida.measureText(o.label).width);
		// padding 24 + barra de scroll 14 + margen 6; mínimo 220 para que el buscador sea cómodo
		return Math.max(220, Math.ceil(Math.min(nombre, ANCHO_MAX_NOMBRE + 80) + 44));
	}
	/** Columnas de la lista con saldos, compartidas por encabezado y filas: nombre (resto) | saldo (fijo). */
	let columnasConSaldo = $state('grid-template-columns: minmax(0,1fr) 7rem;');
	function anchoContenidoConSaldo(): number {
		lienzoMedida ??= document.createElement('canvas').getContext('2d');
		if (!lienzoMedida || !buttonEl) return ANCHO_MIN_PANEL;
		const fuente = getComputedStyle(buttonEl).fontFamily;
		lienzoMedida.font = `500 11px ${fuente}`;
		let nombre = 0;
		for (const o of options) nombre = Math.max(nombre, lienzoMedida.measureText(o.label).width);
		lienzoMedida.font = `600 11px ${fuente}`;
		let saldo = lienzoMedida.measureText('SALDO ACTUAL').width;
		for (const o of options) if (o.saldo !== undefined) saldo = Math.max(saldo, lienzoMedida.measureText(formatSaldoOpcion(o)).width);
		columnasConSaldo = `grid-template-columns: minmax(0,1fr) ${Math.ceil(saldo) + 18}px;`;
		// padding horizontal 24 + separación 8 + relleno de la columna de saldo 18 + barra de scroll 14 + margen 4
		return Math.ceil(Math.min(nombre, ANCHO_MAX_NOMBRE) + saldo + 68);
	}
	/** Ticket #47: antes el panel SIEMPRE se abría hacia abajo con una altura mínima forzada de 160px,
	 * sin importar cuánto espacio real quedaba debajo del campo — un campo como "Prioridad" cerca del
	 * final de un formulario corto (o en celular) quedaba con el panel recortado contra el borde de la
	 * pantalla, con opciones que no se alcanzaban a ver ni elegir. Ahora se mide el espacio real arriba y
	 * abajo del botón: si abajo no entra ni un mínimo cómodo y arriba hay más espacio, el panel se abre
	 * hacia ARRIBA en su lugar; en cualquier caso, la altura máxima nunca excede el espacio real
	 * disponible del lado elegido (con un piso de 80px, scrolleable, para viewports muy chicos). */
	function posicionarPanel() {
		if (!buttonEl) return;
		const rect = buttonEl.getBoundingClientRect();
		const anchoDisponible = window.innerWidth - 16;
		const ancho = Math.min(conSaldo ? Math.max(anchoContenidoConSaldo(), ANCHO_MIN_PANEL_CON_SALDO) : Math.max(rect.width, anchoContenidoSinSaldo()), anchoDisponible);
		let left = rect.left;
		if (left + ancho > window.innerWidth - 8) left = Math.max(8, window.innerWidth - ancho - 8);

		const espacioAbajo = window.innerHeight - rect.bottom - 16;
		const espacioArriba = rect.top - 16;
		const abrirHaciaArriba = espacioAbajo < 160 && espacioArriba > espacioAbajo;
		const alturaMax = Math.max(80, Math.min(360, abrirHaciaArriba ? espacioArriba : espacioAbajo));
		panelStyle = abrirHaciaArriba
			? `position:fixed; bottom:${window.innerHeight - rect.top + 4}px; left:${left}px; width:${ancho}px; max-height:${alturaMax}px;`
			: `position:fixed; top:${rect.bottom + 4}px; left:${left}px; width:${ancho}px; max-height:${alturaMax}px;`;
	}

	/** Bug real reportado por el usuario: en algunos WebView de Android (confirmado en un teléfono con
	 * chip económico, MediaTek Helio G36) el mismo toque que ABRE el panel podía, al seguir burbujeando
	 * hasta `window`, disparar también handleClickFuera y cerrarlo casi al instante — dependía de que
	 * `target` calzara exacto con buttonEl/panelEl, algo que la traducción touch→click de algunos
	 * WebView no garantiza tan preciso como el click de mouse (con el que sí funcionaba bien). Cortar la
	 * propagación acá saca por completo la ambigüedad: este mismo evento nunca llega a handleClickFuera,
	 * sin importar qué `target` reporte el WebView. */
	function toggle(e: MouseEvent) {
		e.stopPropagation();
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
	//
	// Bug real reportado por el usuario (con video, en el mismo teléfono del click-outside de arriba):
	// al tocar el buscador, el teclado en pantalla de Android achica el viewport visual, y el WebView lo
	// reporta como un evento `resize` de `window` — este listener lo tomaba como "la página se movió/
	// cambió" y cerraba el panel de inmediato, antes de poder escribir nada. Se agrega el mismo chequeo
	// de "¿el foco está DENTRO del panel?" (además del de scroll/resize por target) para no cerrar
	// mientras el usuario sigue escribiendo en el buscador — cubre tanto el resize del teclado como un
	// eventual scroll-into-view del navegador al enfocar el input.
	$effect(() => {
		if (!open) return;
		const cerrar = (e: Event) => {
			if (panelEl && e.target instanceof Node && panelEl.contains(e.target)) return;
			if (panelEl && document.activeElement && panelEl.contains(document.activeElement)) return;
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
		<span class="flex-1 min-w-0 truncate text-slate-700" title={selected.label}>{selected.label}</span>
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
		{#if conSaldo}
			<div style={columnasConSaldo} class="grid gap-2 px-3 py-1.5 border-b border-slate-200 bg-slate-50 text-[10px] font-bold uppercase tracking-wider text-slate-500 shrink-0">
				<span>{encabezadoNombre}</span>
				<span class="text-right border-l border-slate-200 pl-2">Saldo actual</span>
			</div>
		{/if}
		<div role="listbox" class={`flex-1 min-h-0 overflow-y-auto ${conSaldo ? '' : 'py-1'}`}>
			<!-- La clave incluye el índice: dos opciones con el MISMO value (ej. dos cajas de efectivo con numero_cuenta 'EFECTIVO', ticket #32) rompían el each con clave duplicada y la lista dejaba de poder elegirse. -->
			{#each opcionesFiltradas as opt, i (`${opt.value}::${i}`)}
				{#if opt.grupo && (i === 0 || opcionesFiltradas[i - 1].grupo !== opt.grupo)}
					<p class={`px-3 pt-2 pb-1 text-[10px] uppercase tracking-widerbg-slate-100 text-slate-900 font-extrabold border-y border-slate-200`}>{opt.grupo}</p>
				{/if}
				{#if conSaldo}
					<button
						type="button"
						role="option"
						aria-selected={opt.value === value}
						onclick={() => choose(opt)}
						style={columnasConSaldo}
						class={`w-full grid items-stretch gap-2 px-3 py-1 text-[11px] text-left border-b border-slate-100 last:border-b-0 hover:bg-slate-50 ${opt.value === value ? 'bg-blue-50 text-blue-700 font-medium' : 'text-slate-700'}`}
					>
						<span class="min-w-0 self-center break-words leading-snug" title={opt.label}>{conCortes(opt.label)}</span>
						{#if opt.saldo !== undefined}
							<span class={`flex items-center justify-end border-l border-slate-100 pl-2 font-semibold tabular-nums whitespace-nowrap ${opt.saldo >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{formatSaldoOpcion(opt)}</span>
						{:else}
							<span class="flex items-center justify-end border-l border-slate-100 pl-2 text-slate-300">—</span>
						{/if}
					</button>
				{:else}
					<button
						type="button"
						role="option"
						aria-selected={opt.value === value}
						onclick={() => choose(opt)}
						class={`w-full flex items-center gap-2 px-3 py-1.5 text-[11px] text-left border-b border-slate-100 last:border-b-0 hover:bg-slate-50 ${opt.value === value ? 'bg-blue-50 text-blue-700 font-medium' : 'text-slate-700'}`}
					>
						<span class="flex-1 min-w-0 break-words leading-snug" title={opt.label}>{conCortes(opt.label)}</span>
					</button>
				{/if}
			{:else}
				<p class="px-3 py-2 text-sm text-slate-400">{busqueda.trim() ? 'Sin resultados para tu búsqueda.' : 'Sin opciones disponibles.'}</p>
			{/each}
		</div>
	</div>
{/if}
