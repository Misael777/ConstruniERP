<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { supabase } from '$lib/supabaseClient';
	import Sidebar from '$lib/components/layout/Sidebar.svelte';
	import NotificacionesBell from '$lib/components/layout/NotificacionesBell.svelte';
	import Toast from '$lib/components/Toast.svelte';
	import { loadPermisos, permisosState, hasPermiso } from '$lib/stores/permisos.svelte';
	import { getRequiredPermiso, getFirstAccessiblePath } from '$lib/config/modules';
	import { consumePendingSharedFile } from '$lib/shareTarget';
	import { pendingShareState } from '$lib/stores/pendingShare.svelte';
	import { isRunningInTauri } from '$lib/driveUploadClient';
	import { getCurrentWindow } from '@tauri-apps/api/window';

	let { children } = $props();

	let isLoading = $state(true);
	/** true = el usuario está autenticado pero no tiene permiso para NINGÚN módulo del ERP — no hay
	 * a dónde redirigirlo, así que se muestra una pantalla explicándolo en vez de dejarlo con el
	 * spinner de carga pegado para siempre (ver bug en el bloque de protección de rutas abajo). */
	let noAccess = $state(false);
	let userRole = $state<string | null>(null);
	let sidebarCollapsed = $state(false);
	// El sidebar de escritorio (franja fija, hidden md:flex) no se ve en pantallas angostas — en
	// vez de quedar sin forma de navegar, este estado controla el drawer móvil del Sidebar
	// (ver mobileOpen en Sidebar.svelte) que se abre con el botón flotante de abajo.
	let mobileMenuOpen = $state(false);

	// Ingreso rápido desde el Share Sheet de Android (compartir una foto/captura del comprobante
	// directo a Construni ERP) — si hay una imagen pendiente (ver tauri-plugin-share-target), manda a
	// Transacciones con el archivo ya listo para que TransaccionModal lo adjunte solo. Se llama tanto
	// al montar este layout (arranque en frío, o justo después de iniciar sesión) COMO cada vez que la
	// ventana recupera el foco (ver onFocusChanged más abajo) — sin eso, compartir con la app YA
	// abierta en segundo plano (Android reutiliza la misma Activity vía onNewIntent, singleTask) nunca
	// se detectaba porque este layout no se vuelve a montar en una navegación normal de SvelteKit.
	// No-op en Windows/desktop y en un arranque normal sin compartir nada.
	async function checkPendingShare() {
		const sharedFile = await consumePendingSharedFile();
		if (sharedFile) {
			pendingShareState.file = sharedFile;
			goto('/finanzas/tranzacciones');
		}
	}

	onMount(async () => {
		if (isRunningInTauri()) {
			getCurrentWindow().onFocusChanged(({ payload: focused }) => {
				if (focused) checkPendingShare();
			});
		}

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
					// Antes esto siempre mandaba a /dashboard sin importar si el usuario tenía acceso a
					// esa ruta — si NO lo tenía (caso típico: rol sin ver_dashboard, que es exactamente
					// donde el login te deja después de iniciar sesión), goto('/dashboard') es una
					// navegación al MISMO path en el que ya estás, SvelteKit no la trata como una
					// navegación real y este onMount no se vuelve a ejecutar (los layouts compartidos
					// no se remontan en cada nav) — el spinner de carga se quedaba pegado para siempre.
					// Ahora se calcula el primer módulo al que el usuario SÍ tiene acceso; si no tiene
					// acceso a ninguno, se muestra una pantalla explicándolo en vez de redirigir en
					// círculos.
					const fallback = getFirstAccessiblePath(hasPermiso);
					console.warn(`[Layout] Access Denied: Missing permission "${requiredPermiso}" for path "${page.url.pathname}". Fallback:`, fallback);
					if (fallback && fallback !== page.url.pathname) {
						goto(fallback, { replaceState: true });
					} else {
						noAccess = true;
					}
				}
			} else {
				console.log('[Layout] Path has no restricted permissions mapped. Allowing access.');
			}

			console.log('[Layout] Layout loaded successfully. Disabling loading spinner.');
			isLoading = false;

			await checkPendingShare();

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
{:else if noAccess}
	<div class="h-screen w-screen flex flex-col items-center justify-center bg-slate-50 px-6 text-center">
		<div class="w-16 h-16 rounded-full bg-amber-100 text-amber-500 flex items-center justify-center mb-4">
			<i class="fas fa-lock text-2xl"></i>
		</div>
		<h2 class="text-brand-marine font-bold text-lg mb-2">No tienes acceso a ningún módulo</h2>
		<p class="text-slate-500 text-sm max-w-sm mb-6">
			Tu cuenta no tiene permisos asignados para ver ninguna sección del ERP todavía. Contacta a un administrador para que te asigne un rol con acceso.
		</p>
		<button
			type="button"
			class="px-5 py-2 bg-[#1a233a] text-white rounded-xl hover:bg-[#0f1729] font-medium text-sm transition-colors"
			onclick={async () => { await supabase.auth.signOut(); goto('/login'); }}
		>
			Cerrar sesión
		</button>
	</div>
{:else}
	<!-- Sidebar Global: hermano directo del <div overflow-hidden>, no hijo — su <aside>/backdrop
	     internos son `position: fixed`, así que no participan del layout flex del contenedor (los
	     elementos fixed salen del flujo normal); sacarlos de aquí evita el mismo riesgo de recorte
	     de WebView en Android descrito abajo, ahora también para el drawer en sí, no solo el botón
	     que lo abre. -->
	<Sidebar bind:collapsed={sidebarCollapsed} bind:mobileOpen={mobileMenuOpen} />

	<div class="flex h-screen bg-brand-gray overflow-hidden">
		<!-- Main Content -->
		<main class={`flex-1 overflow-y-auto transition-all duration-200 ${sidebarCollapsed ? 'md:ml-[76px]' : 'md:ml-[280px]'}`}>
			<!-- Placeholder Topbar para Layout General -->
			<header class="bg-white border-b border-slate-100 h-16 px-6 flex items-center justify-end sticky top-0 z-20 shadow-sm">
				<div class="flex items-center gap-4">
					<NotificacionesBell />
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

	<!-- Botón flotante para abrir el menú en móvil (el sidebar de escritorio está oculto con
	     hidden md:flex ahí, no hay otra forma de navegar en pantallas angostas). Se oculta mientras
	     el drawer ya está abierto, para no quedar encimado con el menú.
	     A propósito FUERA del <div overflow-hidden> de arriba, como hermano directo del `{:else}` —
	     algunos WebView de Android no respetan `position: fixed` de forma confiable dentro de un
	     ancestro con overflow-hidden (lo recortan como si fuera absolute dentro de ese contenedor,
	     en vez de fijarlo contra el viewport real) aunque en un navegador de escritorio normal no se
	     note ninguna diferencia. -->
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

	<Toast />
{/if}
