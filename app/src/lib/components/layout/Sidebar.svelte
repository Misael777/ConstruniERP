<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { supabase } from '$lib/supabaseClient';
	import { MODULE_REGISTRY } from '$lib/config/modules';
	import { hasPermiso, permisosState } from '$lib/stores/permisos.svelte';

	let { collapsed = $bindable(false), mobileOpen = $bindable(false) } = $props();

	// El drawer móvil siempre se ve expandido (280px, labels visibles) sin importar `collapsed` —
	// ese estado es solo para la franja fija de desktop, en un overlay temporal no tiene sentido
	// mostrar solo íconos. El resto del template usa esto en vez de `collapsed` directo (salvo el
	// botón de colapsar en sí, que ya está oculto en móvil — ver <aside> más abajo).
	const effectiveCollapsed = $derived(collapsed && !mobileOpen);

	// Filter modules based on permissions with verbose logging
	let visibleModules = $derived.by(() => {
		console.log('[Sidebar] --- Calculating visibleModules ---');
		
		const filtered = MODULE_REGISTRY.map(mod => {
			const allowed = hasPermiso(mod.permiso);
			if (!allowed) return null;

			// Filter subItems if they have granular permissions
			let subItems = mod.subItems;
			if (subItems) {
				subItems = subItems.filter(sub => !sub.permiso || hasPermiso(sub.permiso));
			}

			// Return module with filtered subItems (if any remain)
			return { ...mod, subItems: subItems && subItems.length > 0 ? subItems : undefined };
		}).filter(Boolean) as typeof MODULE_REGISTRY;
		
		console.log('[Sidebar] Finished filtering. Visible modules count:', filtered.length, 'Modules:', filtered.map(m => m.label));
		console.log('[Sidebar] ----------------------------------');
		return filtered;
	});

	// Estado para abrir/cerrar menús anidados
	let openMenus = $state<Record<string, boolean>>({ '/finanzas': true });

	$effect(() => {
		const currentPath = page.url.pathname;
		for (const mod of MODULE_REGISTRY) {
			if (mod.subItems && currentPath.startsWith(mod.path)) {
				openMenus[mod.path] = true;
			}
		}
	});

	function toggleMenu(path: string, hasSubItems: boolean) {
		if (hasSubItems) {
			openMenus[path] = !openMenus[path];
		} else {
			goto(path);
			mobileOpen = false; // cierra el drawer móvil al navegar — ver nota del <aside> más abajo
		}
	}

	async function logout() {
		await supabase.auth.signOut();
		goto('/login');
	}
</script>

<!-- Backdrop del drawer móvil — clic afuera cierra el menú. Solo existe en pantallas angostas
     (md:hidden): en desktop el sidebar es una franja fija, no un overlay, no necesita backdrop. -->
{#if mobileOpen}
	<div class="fixed inset-0 bg-black/50 z-30 md:hidden" onclick={() => (mobileOpen = false)}></div>
{/if}

<!-- En md+ el sidebar SIEMPRE se muestra (franja fija, ancho según `collapsed`). Debajo de md
     estaba oculto por completo con `hidden md:flex` y no había ninguna forma de abrirlo — ahora
     se muestra como drawer flotante cuando `mobileOpen` es true (controlado por el botón flotante
     del layout), siempre a ancho completo (280px) sin importar `collapsed`, que en un overlay
     temporal no tiene sentido. -->
<aside
	class={`bg-[#1a233a] text-slate-300 fixed top-0 left-0 bottom-0 z-40 flex-col transition-all duration-200 w-[280px] ${
		mobileOpen ? 'flex' : 'hidden'
	} md:flex ${collapsed ? 'md:w-[76px]' : 'md:w-[280px]'}`}
>
	<!-- Logo -->
	<div class="p-4 border-b border-white/5 mb-4 flex items-center gap-3 bg-white flex-shrink-0">
		<!-- Insignia del logo: halo de color extraído de la propia marca (brand-orange) detrás de un
		     tile redondeado con sombra + anillo — mismo patrón que usan apps pulidas (Linear, Notion,
		     Vercel) para mostrar un logomark con fondo propio junto a un wordmark. -->
		<div class="relative flex-shrink-0">
			<div class="absolute inset-0 bg-brand-orange/25 blur-md rounded-xl"></div>
			<div class="relative w-10 h-10 rounded-xl overflow-hidden shadow-md shadow-brand-marine/30 ring-1 ring-black/5">
				<img src="/logo.png" alt="Construni ERP" class="w-full h-full object-cover" />
			</div>
		</div>
		{#if !collapsed || mobileOpen}
			<div class="flex flex-col text-brand-marine min-w-0">
				<h1 class="font-bold text-xl leading-tight">CONSTRUNI</h1>
				<span class="text-[10px] font-bold text-brand-orange uppercase tracking-widest">ERP</span>
			</div>
		{/if}
		<!-- Colapsar a íconos: solo tiene sentido en la franja fija de desktop -->
		<button
			type="button"
			onclick={() => (collapsed = !collapsed)}
			class="ml-auto hidden md:flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-600 transition hover:bg-slate-100 hover:text-brand-marine"
			title={collapsed ? 'Expandir menú' : 'Colapsar menú'}
			aria-label={collapsed ? 'Expandir menú' : 'Colapsar menú'}
		>
			<i class={`fas fa-chevron-${collapsed ? 'right' : 'left'} text-sm`}></i>
		</button>
		<!-- Cerrar drawer: solo en el overlay móvil -->
		<button
			type="button"
			onclick={() => (mobileOpen = false)}
			class="ml-auto md:hidden flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-600 transition hover:bg-slate-100 hover:text-brand-marine"
			title="Cerrar menú"
			aria-label="Cerrar menú"
		>
			<i class="fas fa-xmark text-sm"></i>
		</button>
	</div>

	<!-- Menu (scrollable) -->
	<ul class="list-none px-3 m-0 pb-6 overflow-y-auto flex-1">
		{#each visibleModules as item}
			{@const active = page.url.pathname.startsWith(item.path)}
			<li class="mb-1">
				<button
					onclick={() => toggleMenu(item.path, !!item.subItems)}
					class={`w-full flex items-center ${effectiveCollapsed ? 'justify-center px-3' : 'justify-between px-4'} py-3 rounded-xl font-medium transition-colors text-sm ${
						active && !item.subItems
							? 'bg-blue-600 text-white shadow-md'
							: active && item.subItems
								? 'bg-blue-600 text-white'
								: 'hover:bg-white/5 hover:text-white'
					}`}
					title={effectiveCollapsed ? item.label : undefined}
				>
					<div class={`flex items-center ${effectiveCollapsed ? 'justify-center' : 'gap-3'}`}>
						<i class={`w-5 text-center ${item.icon}`}></i>
						{#if !effectiveCollapsed}
							<span>{item.label}</span>
						{/if}
					</div>
					{#if item.subItems && !effectiveCollapsed}
						<i class={`fas fa-chevron-${openMenus[item.path] ? 'up' : 'down'} text-xs opacity-50`}></i>
					{/if}
				</button>

				<!-- Submenu -->
				{#if item.subItems && openMenus[item.path] && !effectiveCollapsed}
					<ul class="mt-1 mb-2 relative before:content-[''] before:absolute before:left-6 before:top-0 before:bottom-0 before:w-px before:bg-white/10">
						{#each item.subItems as sub}
							{@const subActive = page.url.pathname === sub.path}
							<li class="relative">
								<a
									href={sub.path}
									onclick={() => (mobileOpen = false)}
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
				class={`w-full flex items-center ${effectiveCollapsed ? 'justify-center px-3' : 'gap-3 px-4'} py-3 rounded-xl font-medium transition-all text-sm text-slate-400 hover:bg-red-500/10 hover:text-red-400 group`}
				title={effectiveCollapsed ? 'Cerrar sesión' : undefined}
			>
				<i class="fas fa-sign-out-alt w-5 text-center group-hover:scale-110 transition-transform"></i>
				{#if !effectiveCollapsed}
					<span>Cerrar Sesión</span>
				{/if}
			</button>
		</li>
	</ul>

	<!-- User info at bottom -->
	{#if permisosState.loaded}
		<div class={`px-4 py-4 border-t border-white/10 flex items-center ${effectiveCollapsed ? 'justify-center' : 'gap-3'} flex-shrink-0`}>
			<div class="w-9 h-9 rounded-full bg-blue-600 text-white flex items-center justify-center text-sm font-bold flex-shrink-0">
				{permisosState.userInitial}
			</div>
			{#if !effectiveCollapsed}
				<div class="min-w-0 flex-1">
					<p class="text-sm font-semibold text-white truncate leading-tight">{permisosState.userName}</p>
					<p class="text-[10px] text-orange-400 capitalize font-semibold leading-tight mt-0.5">{permisosState.rolNombre}</p>
				</div>
			{/if}
		</div>
	{/if}
</aside>
