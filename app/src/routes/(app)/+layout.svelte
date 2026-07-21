<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { supabase } from '$lib/supabaseClient';
	import Sidebar from '$lib/components/layout/Sidebar.svelte';
	import Toast from '$lib/components/Toast.svelte';
	import { loadPermisos, permisosState, hasPermiso } from '$lib/stores/permisos.svelte';
	import { getRequiredPermiso } from '$lib/config/modules';
	
	let { children } = $props();
	
	let isLoading = $state(true);
	let userRole = $state<string | null>(null);
	let sidebarCollapsed = $state(false);
	// El sidebar de escritorio (franja fija, hidden md:flex) no se ve en pantallas angostas — en
	// vez de quedar sin forma de navegar, este estado controla el drawer móvil del Sidebar
	// (ver mobileOpen en Sidebar.svelte) que se abre con el botón flotante de abajo.
	let mobileMenuOpen = $state(false);

	onMount(async () => {
		console.log('[Layout] onMount initiated for (app) layout. Path:', page.url.pathname);
		try {
			// 1. Verificar Sesión
			console.log('[Layout] Fetching supabase session...');
			const { data: { session }, error: sessionError } = await supabase.auth.getSession();
			
			if (sessionError || !session) {
				console.warn('[Layout] No active session found or session error occurred:', sessionError);
				// No autenticado -> mandar a login
				goto('/login');
				return;
			}
			
			console.log('[Layout] Session verified. User:', session.user.id, session.user.email);
			
			// Load permission store variables
			console.log('[Layout] Triggering loadPermisos store loading...');
			await loadPermisos(session.user.id);
			console.log('[Layout] loadPermisos completed. Current state:', {
				loaded: permisosState.loaded,
				userName: permisosState.userName,
				rolNombre: permisosState.rolNombre,
				permisosCount: permisosState.permisos.length,
				permisos: permisosState.permisos
			});

			// 2. Obtener rol del empleado desde base de datos
			console.log('[Layout] Fetching employee role locally for layout checks...');
			const { data: empleado, error: empleadoError } = await supabase
				.from('empleados')
				.select(`
					roles (
						nombre
					)
				`)
				.eq('auth_user_id', session.user.id)
				.single();
				
			if (!empleadoError && empleado && empleado.roles) {
				// En supabase select con join simple, esto suele devolver roles: { nombre: 'admin' }
				// @ts-ignore
				userRole = empleado.roles.nombre || null;
				console.log('[Layout] Local userRole assigned from db:', userRole);
			} else {
				// Fallback si no tiene empleado vinculado aún
				console.warn('[Layout] Employee query failed or roles missing. Fallback to "asesor":', empleadoError);
				userRole = 'asesor'; // Rol más bajo por defecto
			}
			
			// 3. Proteger rutas dinámicamente usando permisos
			const requiredPermiso = getRequiredPermiso(page.url.pathname);
			console.log('[Layout] Protecting route:', page.url.pathname, '| Required permission key:', requiredPermiso);
			
			if (requiredPermiso) {
				const allowed = hasPermiso(requiredPermiso);
				console.log(`[Layout] Permission Check -> Path: "${page.url.pathname}", Requires: "${requiredPermiso}", Allowed: ${allowed}`);
				if (!allowed) {
					console.warn(`[Layout] Access Denied: Missing permission "${requiredPermiso}" for path "${page.url.pathname}". Redirecting to /dashboard.`);
					goto('/dashboard');
					return;
				}
			} else {
				console.log('[Layout] Path has no restricted permissions mapped. Allowing access.');
			}
			
			console.log('[Layout] Layout loaded successfully. Disabling loading spinner.');
			isLoading = false;
			
		} catch (e) {
			console.error("[Layout] Fatal error in session verification / loading:", e);
			goto('/login');
		}
	});
</script>

{#if isLoading}
	<div class="h-screen w-screen flex flex-col items-center justify-center bg-slate-50">
		<i class="fas fa-spinner fa-spin text-4xl text-blue-600 mb-4"></i>
		<h2 class="text-brand-marine font-bold">Cargando Construni ERP...</h2>
	</div>
{:else}
	<div class="flex h-screen bg-brand-gray overflow-hidden">
		<!-- Sidebar Global -->
		<Sidebar bind:collapsed={sidebarCollapsed} bind:mobileOpen={mobileMenuOpen} />

		<!-- Botón flotante para abrir el menú en móvil (el sidebar de escritorio está oculto con
		     hidden md:flex ahí, no hay otra forma de navegar en pantallas angostas). Se oculta
		     mientras el drawer ya está abierto, para no quedar encimado con el menú. -->
		{#if !mobileMenuOpen}
			<button
				type="button"
				onclick={() => (mobileMenuOpen = true)}
				class="md:hidden fixed bottom-5 left-5 z-30 w-12 h-12 rounded-full bg-[#1a233a] text-white shadow-lg flex items-center justify-center active:scale-95 transition-transform"
				aria-label="Abrir menú de navegación"
			>
				<i class="fas fa-bars text-lg"></i>
			</button>
		{/if}
		
		<!-- Main Content -->
		<main class={`flex-1 overflow-y-auto transition-all duration-200 ${sidebarCollapsed ? 'md:ml-[76px]' : 'md:ml-[280px]'}`}>
			<!-- Placeholder Topbar para Layout General -->
			<header class="bg-white border-b border-slate-100 h-16 px-6 flex items-center justify-end sticky top-0 z-20 shadow-sm">
				<div class="flex items-center gap-4">
					<button class="text-slate-400 hover:text-brand-orange relative">
						<i class="fas fa-bell"></i>
						<span class="absolute -top-1 -right-1 w-2.5 h-2.5 bg-red-500 rounded-full border-2 border-white"></span>
					</button>
					<div class="flex items-center gap-2 pl-4 border-l border-slate-200 cursor-pointer hover:bg-slate-50 p-1 rounded-xl">
						<div class="w-8 h-8 rounded-full bg-[#1a233a] text-white flex items-center justify-center text-xs font-bold">
							U
						</div>
						<div class="hidden sm:block">
							<p class="text-xs font-bold text-slate-800 leading-none mb-1">Usuario</p>
							<p class="text-[10px] text-brand-orange capitalize font-semibold leading-none">{userRole}</p>
						</div>
					</div>
					<button 
						class="text-slate-400 hover:text-red-500 text-sm ml-2"
						title="Cerrar sesión"
						onclick={async () => { await supabase.auth.signOut(); goto('/login'); }}
					>
						<i class="fas fa-sign-out-alt"></i>
					</button>
				</div>
			</header>
			
			<div class="p-4 md:p-8">
				{@render children()}
			</div>
		</main>
	</div>
	<Toast />
{/if}
