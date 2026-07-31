<script lang="ts">
	import type { Snippet } from 'svelte';

	type Column = { label: string; class?: string; align?: 'left' | 'center' | 'right' };

	let {
		items,
		keyField,
		columns = [],
		header,
		colspan,
		row,
		card,
		emptyMessage = 'No hay datos para mostrar.',
		onRowDblClick,
		onRowClick
	}: {
		items: any[];
		keyField: string;
		columns?: Column[];
		header?: Snippet<[]>;
		colspan?: number;
		row: Snippet<[item: any]>;
		card: Snippet<[item: any]>;
		emptyMessage?: string;
		/** Opcional — doble clic en una fila (tabla) o tarjeta (móvil). Nada si no se pasa. */
		onRowDblClick?: (item: any) => void;
		/** Opcional — un solo clic en una fila (tabla) o tarjeta (móvil). Nada si no se pasa. */
		onRowClick?: (item: any) => void;
	} = $props();

	function alignClass(align?: Column['align']) {
		if (align === 'center') return 'text-center';
		if (align === 'right') return 'text-right';
		return 'text-left';
	}

	let effectiveColspan = $derived(colspan ?? columns.length);
</script>

<!-- Desktop: tabla normal -->
<table class="hidden md:table w-full text-left text-sm whitespace-nowrap">
	<thead class="text-xs text-slate-500 bg-slate-50/50 font-semibold border-b border-slate-100">
		<tr>
			{#if header}
				{@render header()}
			{:else}
				{#each columns as col}
					<th class={`px-5 py-4 ${alignClass(col.align)} ${col.class ?? ''}`}>{col.label}</th>
				{/each}
			{/if}
		</tr>
	</thead>
	<tbody class="divide-y divide-slate-100">
		{#if items.length === 0}
			<tr>
				<td colspan={effectiveColspan} class="px-5 py-10 text-center text-slate-500">{emptyMessage}</td>
			</tr>
		{:else}
			{#each items as item (item[keyField])}
				<tr
					class={`hover:bg-slate-50/80 transition-colors group ${onRowClick ? 'cursor-pointer' : ''}`}
					onclick={() => onRowClick?.(item)}
					ondblclick={() => onRowDblClick?.(item)}
				>
					{@render row(item)}
				</tr>
			{/each}
		{/if}
	</tbody>
</table>

<!-- Mobile: tarjetas apiladas -->
<div class="md:hidden space-y-3 p-3">
	{#if items.length === 0}
		<div class="rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">{emptyMessage}</div>
	{:else}
		{#each items as item (item[keyField])}
			{#if onRowDblClick || onRowClick}
				<div
					class={`rounded-xl border border-slate-200 bg-white p-4 shadow-sm ${onRowClick ? 'cursor-pointer active:bg-slate-50' : ''}`}
					onclick={() => onRowClick?.(item)}
					ondblclick={() => onRowDblClick?.(item)}
					role="button"
					tabindex="0"
					onkeydown={(e) => { if (e.key === 'Enter') (onRowClick ?? onRowDblClick)?.(item); }}
				>
					{@render card(item)}
				</div>
			{:else}
				<div class="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
					{@render card(item)}
				</div>
			{/if}
		{/each}
	{/if}
</div>
