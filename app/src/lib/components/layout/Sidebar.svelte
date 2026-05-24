<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { supabase } from '$lib/supabaseClient';
	import { MODULE_REGISTRY } from '$lib/config/modules';
	import { hasPermiso, permisosState } from '$lib/stores/permisos.svelte';

	// Filter modules based on permissions with verbose logging
	let visibleModules = $derived.by(() => {
		console.log('[Sidebar] --- Calculating visibleModules ---');
		console.log('[Sidebar] MODULE_REGISTRY length:', MODULE_REGISTRY.length);
		console.log('[Sidebar] permisosState status:', { loaded: permisosState.loaded, rolNombre: permisosState.rolNombre, user: permisosState.userName, perms: permisosState.permisos });
		
		const filtered = MODULE_REGISTRY.filter(mod => {
			const allowed = hasPermiso(mod.permiso);
			console.log(`[Sidebar]   - Module "${mod.label}" (${mod.path}) | Requires: "${mod.permiso}" | Allowed: ${allowed}`);
			return allowed;
		});
		
		console.log('[Sidebar] Finished filtering. Visible modules count:', filtered.length, 'Modules:', filtered.map(m => m.label));
		console.log('[Sidebar] ----------------------------------');
		return filtered;
	});

	// Estado para abrir/cerrar menús anidados
	let openMenus = $state<Record<string, boolean>>({ '/finanzas': true });

	function toggleMenu(path: string, hasSubItems: boolean) {
		if (hasSubItems) {
			openMenus[path] = !openMenus[path];
		} else {
			goto(path);
		}
	}

	async function logout() {
		await supabase.auth.signOut();
		goto('/login');
	}
</script>

<aside class="w-[280px] bg-[#1a233a] text-slate-300 fixed top-0 left-0 bottom-0 z-10 hidden md:flex flex-col">
	<!-- Logo -->
	<div class="p-6 border-b border-white/5 mb-4 flex items-center gap-3 bg-white flex-shrink-0">
		<div class="text-blue-600 text-2xl">
			<i class="fas fa-cubes"></i>
		</div>
		<div class="flex flex-col text-brand-marine">
			<h1 class="font-bold text-xl leading-tight">CONSTRUNI</h1>
			<span class="text-[10px] font-bold text-orange-500 uppercase tracking-widest">ERP</span>
		</div>
	</div>

	<!-- Menu (scrollable) -->
	<ul class="list-none px-3 m-0 pb-6 overflow-y-auto flex-1">
		{#each visibleModules as item}
			{@const active = page.url.pathname.startsWith(item.path)}
			<li class="mb-1">
				<button 
					onclick={() => toggleMenu(item.path, !!item.subItems)}
					class={`w-full flex items-center justify-between px-4 py-3 rounded-xl font-medium transition-colors text-sm ${
						active && !item.subItems
							? 'bg-blue-600 text-white shadow-md' 
							: active && item.subItems 
								? 'bg-blue-600 text-white'
								: 'hover:bg-white/5 hover:text-white'
					}`}
				>
					<div class="flex items-center gap-3">
						<i class={`w-5 text-center ${item.icon}`}></i>
						{item.label}
					</div>
					{#if item.subItems}
						<i class={`fas fa-chevron-${openMenus[item.path] ? 'up' : 'down'} text-xs opacity-50`}></i>
					{/if}
				</button>

				<!-- Submenu -->
				{#if item.subItems && openMenus[item.path]}
					<ul class="mt-1 mb-2 relative before:content-[''] before:absolute before:left-6 before:top-0 before:bottom-0 before:w-px before:bg-white/10">
						{#each item.subItems as sub}
							{@const subActive = page.url.pathname === sub.path}
							<li class="relative">
								<a 
									href={sub.path} 
									class={`block pl-11 pr-4 py-2.5 text-xs transition-colors rounded-r-xl ${
										subActive 
											? 'text-white font-semibold relative before:content-[""] before:absolute before:left-6 before:top-1/2 before:-translate-y-1/2 before:w-1.5 before:h-1.5 before:rounded-full before:bg-blue-500' 
											: 'text-slate-400 hover:text-white'
									}`}
								>
									{sub.label}
								</a>
							</li>
						{/each}
					</ul>
				{/if}
			</li>
		{/each}

		<!-- Separador -->
		<li class="my-3 mx-1 border-t border-white/10"></li>

		<!-- Cerrar Sesión -->
		<li class="mb-1">
			<button
				onclick={logout}
				class="w-full flex items-center gap-3 px-4 py-3 rounded-xl font-medium transition-all text-sm text-slate-400 hover:bg-red-500/10 hover:text-red-400 group"
			>
				<i class="fas fa-sign-out-alt w-5 text-center group-hover:scale-110 transition-transform"></i>
				Cerrar Sesión
			</button>
		</li>
	</ul>

	<!-- User info at bottom -->
	{#if permisosState.loaded}
		<div class="px-4 py-4 border-t border-white/10 flex items-center gap-3 flex-shrink-0">
			<div class="w-9 h-9 rounded-full bg-blue-600 text-white flex items-center justify-center text-sm font-bold flex-shrink-0">
				{permisosState.userInitial}
			</div>
			<div class="min-w-0 flex-1">
				<p class="text-sm font-semibold text-white truncate leading-tight">{permisosState.userName}</p>
				<p class="text-[10px] text-orange-400 capitalize font-semibold leading-tight mt-0.5">{permisosState.rolNombre}</p>
			</div>
		</div>
	{/if}
</aside>
