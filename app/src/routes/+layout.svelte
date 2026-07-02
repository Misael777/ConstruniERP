<script lang="ts">
	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';
	import { setupConsoleLogger } from '$lib/loggerHook';
	import { onMount } from 'svelte';
	import { supabase } from '$lib/supabaseClient';
	import { syncAuthCookies } from '$lib/authCookie';

	let { children } = $props();

	onMount(() => {
		setupConsoleLogger();
		console.log('[App] Console logger initialized');

		// Mantiene la cookie de sesión sincronizada con Supabase (login, refresh, logout)
		// para que +page.server.ts / +server.ts puedan verificar quién hace la petición.
		supabase.auth.getSession().then(({ data: { session } }) => syncAuthCookies(session));
		const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
			syncAuthCookies(session);
		});

		return () => authListener.subscription.unsubscribe();
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

{@render children()}
