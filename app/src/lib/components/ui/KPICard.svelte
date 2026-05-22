<script lang="ts">
	let { 
		title, 
		value, 
		trendText = '', 
		trendUp = true, 
		icon = '' 
	}: { 
		title: string, 
		value: string, 
		trendText?: string, 
		trendUp?: boolean, 
		icon?: string 
	} = $props();
</script>

<div class="bg-white rounded-3xl p-5 shadow-sm border border-slate-100 transition-transform hover:-translate-y-1">
	<div class="text-xs uppercase tracking-wide text-slate-500 mb-3 flex justify-between items-center">
		{title}
		{#if icon}
			<i class={`${icon} text-brand-orange`}></i>
		{/if}
	</div>
	<div class="text-3xl font-bold text-brand-marine mb-2">{value}</div>
	{#if trendText}
		<div class={`text-xs ${trendUp ? 'text-brand-success' : 'text-brand-danger'}`}>
			<i class={`fas ${trendUp ? 'fa-arrow-up' : 'fa-arrow-down'}`}></i> {trendText}
		</div>
	{/if}
</div>
