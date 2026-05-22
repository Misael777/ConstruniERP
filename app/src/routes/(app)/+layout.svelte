<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { supabase } from '$lib/supabaseClient';
	import Sidebar from '$lib/components/layout/Sidebar.svelte';
	
	let { children } = $props();
	
	let isLoading = $state(true);
	let userRole = $state<string | null>(null);

	onMount(async () => {
		try {
			// 1. Verificar Sesión
			const { data: { session }, error: sessionError } = await supabase.auth.getSession();
			
			if (sessionError || !session) {
				// No autenticado -> mandar a login
				goto('/login');
				return;
			}
			
			// 2. Obtener rol del empleado desde base de datos
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
			} else {
				// Fallback si no tiene empleado vinculado aún
				userRole = 'asesor'; // Rol más bajo por defecto
			}
			
			// 3. Proteger rutas (IAM solo para administrador)
			if (page.url.pathname.startsWith('/iam') && userRole !== 'administrador') {
				console.warn("Acceso denegado: Se requiere rol administrador");
				goto('/dashboard');
				return;
			}
			
			isLoading = false;
			
		} catch (e) {
			console.error("Error en verificación de sesión:", e);
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
		<Sidebar />
		
		<!-- Main Content -->
		<main class="flex-1 overflow-y-auto md:ml-[280px]">
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
{/if}
