<script lang="ts">
	import type { Snippet } from 'svelte';

	let { 
		title = '', 
		icon = '', 
		iconColor = 'text-brand-orange', 
		className = '',
		children 
	}: { 
		title?: string, 
		icon?: string, 
		iconColor?: string, 
		className?: string,
		children: Snippet 
	} = $props();
</script>

<div class={`bg-white rounded-3xl p-5 border border-slate-100 shadow-sm ${className}`}>
	{#if title}
		<div class="flex justify-between items-center mb-4 pb-3 border-b border-slate-100">
			<h3 class="text-brand-marine font-semibold text-lg flex items-center gap-2">
				{#if icon}
					<i class={`${icon} ${iconColor}`}></i>
				{/if}
				{title}
			</h3>
		</div>
	{/if}
	{@render children()}
</div>
