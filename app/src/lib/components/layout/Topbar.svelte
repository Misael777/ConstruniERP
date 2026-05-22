<script lang="ts">
	let { pageTitle = 'Panel de Control', pageSubtitle = 'Gestión en tiempo real' } = $props();
</script>

<div class="flex justify-between items-center mb-7 flex-wrap gap-4">
	<div>
		<h2 class="text-2xl font-semibold text-brand-marine">{pageTitle}</h2>
		<p class="text-sm text-slate-500 mt-1">{pageSubtitle}</p>
	</div>
	
	<div class="flex items-center gap-5 bg-white px-5 py-2 rounded-full shadow-sm">
		<button class="text-slate-500 hover:text-brand-marine transition-colors">
			<i class="fas fa-bell"></i>
		</button>
		<button class="text-slate-500 hover:text-brand-marine transition-colors">
			<i class="fas fa-cog"></i>
		</button>
		<div class="bg-brand-orange w-10 h-10 rounded-full flex items-center justify-center text-white font-bold cursor-pointer">
			WS
		</div>
	</div>
</div>
