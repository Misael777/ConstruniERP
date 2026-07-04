<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { supabase } from '$lib/supabaseClient';

	onMount(async () => {
		console.log('[Root] startup — href:', window.location.href);

		// Hard-navigation fallback: if SvelteKit router doesn't resolve within 4 s,
		// force a full-page reload to /login so the pre-rendered login.html is served.
		const fallback = setTimeout(() => {
			console.warn('[Root] goto() timeout — falling back to window.location');
			window.location.replace('/login');
		}, 4000);

		try {
			const { data: { session } } = await supabase.auth.getSession();
			const target = session ? '/dashboard' : '/login';
			console.log('[Root] session:', session ? 'exists' : 'none', '→ navigating to', target);
			await goto(target, { replaceState: true });
			clearTimeout(fallback);
		} catch (err) {
			clearTimeout(fallback);
			console.error('[Root] goto failed — using window.location:', err);
			window.location.replace('/login');
		}
	});
</script>

<!-- Inline styles so this renders correctly even if CSS hasn't loaded yet -->
<div style="min-height:100vh;display:flex;align-items:center;justify-content:center;background:#1a2338;color:#ffffff;font-family:sans-serif;font-size:1rem;letter-spacing:.05em;">
	Iniciando Construni ERP…
</div>
