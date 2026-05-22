<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	
	onMount(() => {
		goto('/login');
	});
</script>

<div class="min-h-screen flex items-center justify-center bg-brand-gray text-brand-marine">
	Cargando Construni ERP...
</div>
