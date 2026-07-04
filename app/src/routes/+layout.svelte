<script lang="ts">
	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';
	import { setupConsoleLogger } from '$lib/loggerHook';
	import { onMount } from 'svelte';

	let { children } = $props();

	onMount(() => {
		setupConsoleLogger();
		console.log('[App] Console logger initialized');
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

{@render children()}
