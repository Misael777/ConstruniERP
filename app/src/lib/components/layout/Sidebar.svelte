<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { supabase } from '$lib/supabaseClient';

	// Navegación anidada
	const navItems = [
		{ path: '/dashboard', label: 'Dashboard', icon: 'fas fa-home' },
		{ path: '/proyectos', label: 'Proyectos', icon: 'fas fa-city' },
		{ path: '/compras', label: 'Compras', icon: 'fas fa-shopping-cart' },
		{ path: '/almacen', label: 'Almacén', icon: 'fas fa-box' },
		{ path: '/ventas', label: 'Ventas', icon: 'fas fa-chart-line' },
		{ 
			path: '/finanzas', 
			label: 'Finanzas', 
			icon: 'fas fa-wallet',
			subItems: [
				{ path: '/finanzas/resumen', label: 'Resumen' },
				{ path: '/finanzas/cuentas-por-cobrar', label: 'Cuentas por Cobrar' },
				{ path: '/finanzas/cuentas-por-pagar', label: 'Cuentas por Pagar' },
				{ path: '/finanzas/pagos', label: 'Pagos' },
				{ path: '/finanzas/egresos', label: 'Egresos' },
				{ path: '/finanzas/reportes', label: 'Reportes' },
			]
		},
		{ path: '/recursos-humanos', label: 'Recursos Humanos', icon: 'fas fa-users' },
		{ path: '/iam', label: 'Control Accesos (IAM)', icon: 'fas fa-users-cog' },
		{ 
			path: '/configuracion', 
			label: 'Configuración', 
			icon: 'fas fa-cog',
			subItems: [
				{ path: '/configuracion/roles-permisos', label: 'Roles y Permisos' }
			]
		},
	];

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
		{#each navItems as item}
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
</aside>
