<script lang="ts">
	/**
	 * Campo de texto con lista de sugerencias (reemplaza a <datalist>). Ticket #136 (21/11/2026, app): con <datalist>,
	 * después de elegir una opción, al volver a abrir la lista solo aparecía esa misma (el navegador filtra por lo ya
	 * escrito). Aquí, al entrar al campo se ve SIEMPRE la lista completa; solo se filtra cuando se escribe algo nuevo.
	 * Se puede escribir un valor que no esté en la lista.
	 */
	import { tick } from 'svelte';

	type Opcion = string | { value: string; label?: string; grupo?: string };
	let {
		value = $bindable(''),
		opciones,
		id,
		placeholder = '',
		maxlength,
		disabled = false,
		ariaLabel,
		class: clase = 'w-full px-2.5 py-1.5 border border-slate-200 rounded-lg text-sm',
		onelegir,
		onkeydown,
		onblur
	}: {
		value?: string;
		opciones: Opcion[];
		id?: string;
		placeholder?: string;
		maxlength?: number;
		disabled?: boolean;
		ariaLabel?: string;
		class?: string;
		/** Se llama al elegir una opción de la lista. */
		onelegir?: (v: string) => void;
		onkeydown?: (e: KeyboardEvent) => void;
		onblur?: () => void;
	} = $props();

	let abierto = $state(false);
	let filtrar = $state(false);
	let activo = $state(-1);
	let inputEl = $state<HTMLInputElement | null>(null);
	let panelStyle = $state('');
	const idLista = `lista-${Math.random().toString(36).slice(2, 9)}`;

	const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
	const lista = $derived(opciones.map((o) => (typeof o === 'string' ? { value: o, label: o, grupo: undefined } : { value: o.value, label: o.label ?? o.value, grupo: o.grupo })));
	const visibles = $derived.by(() => {
		const q = filtrar ? norm(value ?? '') : '';
		return q ? lista.filter((o) => norm(o.label).includes(q) || norm(o.grupo ?? '').includes(q)) : lista;
	});

	function posicionar() {
		if (!inputEl) return;
		const r = inputEl.getBoundingClientRect();
		const abajo = window.innerHeight - r.bottom;
		const arriba = r.top;
		const haciaArriba = abajo < 200 && arriba > abajo;
		const alto = Math.max(120, Math.min(280, (haciaArriba ? arriba : abajo) - 12));
		panelStyle = `position:fixed;left:${r.left}px;width:${Math.max(r.width, 200)}px;max-height:${alto}px;${haciaArriba ? `bottom:${window.innerHeight - r.top + 4}px` : `top:${r.bottom + 4}px`}`;
	}
	async function abrir() {
		if (disabled) return;
		filtrar = false;
		activo = -1;
		abierto = true;
		await tick();
		posicionar();
	}
	function elegir(v: string) {
		value = v;
		abierto = false;
		filtrar = false;
		onelegir?.(v);
	}
	function teclas(e: KeyboardEvent) {
		if (abierto && visibles.length && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
			e.preventDefault();
			activo = (activo + (e.key === 'ArrowDown' ? 1 : -1) + visibles.length) % visibles.length;
			return;
		}
		if (abierto && e.key === 'Enter' && activo >= 0 && visibles[activo]) {
			e.preventDefault();
			elegir(visibles[activo].value);
			return;
		}
		if (e.key === 'Escape') abierto = false;
		onkeydown?.(e);
	}
	function portal(node: HTMLElement) {
		document.body.appendChild(node);
		return { destroy: () => node.remove() };
	}
	$effect(() => {
		if (!abierto) return;
		const cerrar = (e: Event) => {
			if (e.target instanceof Node && (inputEl?.contains(e.target) || (e.target as HTMLElement).closest?.('[data-input-con-lista]'))) return;
			abierto = false;
		};
		const reubicar = () => posicionar();
		window.addEventListener('resize', reubicar);
		window.addEventListener('scroll', reubicar, true);
		document.addEventListener('pointerdown', cerrar, true);
		return () => {
			window.removeEventListener('resize', reubicar);
			window.removeEventListener('scroll', reubicar, true);
			document.removeEventListener('pointerdown', cerrar, true);
		};
	});
</script>

<input
	bind:this={inputEl}
	{id}
	bind:value
	{placeholder}
	{maxlength}
	{disabled}
	aria-label={ariaLabel}
	autocomplete="off"
	role="combobox"
	aria-expanded={abierto}
	aria-autocomplete="list"
	aria-controls={idLista}
	onfocus={abrir}
	onclick={() => !abierto && abrir()}
	oninput={() => {
		filtrar = true;
		activo = -1;
		if (!abierto) abrir().then(() => (filtrar = true));
	}}
	onkeydown={teclas}
	onblur={() => setTimeout(() => {
		if (document.activeElement !== inputEl) abierto = false;
		onblur?.();
	}, 120)}
	class={clase}
/>

{#if abierto && visibles.length}
	<div use:portal id={idLista} data-input-con-lista style={panelStyle} class="z-[1000] overflow-y-auto rounded-xl border border-slate-200 bg-white py-1 shadow-xl" role="listbox">
		{#each visibles as o, i (o.value + i)}
			{#if o.grupo && o.grupo !== visibles[i - 1]?.grupo}
				<div class="px-3 pt-2 pb-1 text-[10px] font-bold uppercase tracking-wide text-slate-400">{o.grupo}</div>
			{/if}
			<button
				type="button"
				role="option"
				aria-selected={o.value === value}
				onpointerdown={(e) => e.preventDefault()}
				onclick={() => elegir(o.value)}
				class={`block w-full text-left px-3 py-1.5 text-sm ${i === activo ? 'bg-blue-50' : o.value === value ? 'bg-orange-50 text-orange-700 font-semibold' : 'text-slate-700 hover:bg-slate-50'}`}
			>
				{o.label}
			</button>
		{/each}
	</div>
{/if}
