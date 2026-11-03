<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { toast } from '$lib/stores/toast';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { supabase } from '$lib/supabaseClient';
	import Sidebar from '$lib/components/layout/Sidebar.svelte';
	import NotificacionesBell from '$lib/components/layout/NotificacionesBell.svelte';
	import ActualizacionBell from '$lib/components/layout/ActualizacionBell.svelte';
	import Toast from '$lib/components/Toast.svelte';
	import { loadPermisos, permisosState, hasPermiso } from '$lib/stores/permisos.svelte';
	import { getRequiredPermiso, getFirstAccessiblePath } from '$lib/config/modules';
	import { consumePendingSharedFile } from '$lib/shareTarget';
	import { pendingShareState } from '$lib/stores/pendingShare.svelte';
	import { isRunningInTauri } from '$lib/driveUploadClient';
	import { getCurrentWindow } from '@tauri-apps/api/window';
	import { mobileFabState } from '$lib/stores/mobileFab.svelte';
	import MobileFab from '$lib/shared/components/MobileFab.svelte';
	import ConfirmDialogHost from '$lib/shared/components/ConfirmDialogHost.svelte';
	import InactividadGuard from '$lib/components/layout/InactividadGuard.svelte';
	import { getInfoVersionApp, registrarVersionUsuario } from '$lib/shared/appVersion';
	import SnoopyLoader, { FONDO_CARGA } from '$lib/shared/components/SnoopyLoader.svelte';
	import { iniciarSesionAuditoria, registrarCierre, cerrarSesion, esCierreManual } from '$lib/shared/auditoria';
	import { cargarClientes } from '$lib/stores/clientes.svelte';
	import { reportarDiagnostico } from '$lib/shared/auditoria';
	import { diag, revisarCaidaAnterior, leerLog, formatearEntrada, infoEquipo, diagState, activarDiagnostico } from '$lib/shared/diagnostico.svelte';
	import DiagnosticoPanel from '$lib/shared/components/DiagnosticoPanel.svelte';
	import EntornoDeveloper from '$lib/shared/components/EntornoDeveloper.svelte';
	import EntornoHuelleros from '$lib/shared/components/EntornoHuelleros.svelte';

	let { children } = $props();

	// Ticket #96: botón "Actualizar" del encabezado — vuelve a leer TODO de la BD sin cerrar sesión: rol y
	// permisos (Control de Accesos), menú, clientes, la campanita y la pantalla abierta (se remonta con
	// {#key}, así cada módulo vuelve a correr su carga inicial). Si al usuario le quitaron el acceso a la
	// pantalla en la que está, lo manda al primer módulo que sí puede ver.
	// Modo diagnóstico: 5 toques seguidos (en menos de 3 s) sobre la versión lo activan/desactivan.
	let toquesVersion: number[] = [];
	function tocarVersion() {
		const ahora = Date.now();
		toquesVersion = [...toquesVersion.filter((t) => ahora - t < 3000), ahora];
		if (toquesVersion.length < 5) return;
		toquesVersion = [];
		activarDiagnostico(!diagState.activo);
		if (diagState.activo) diagState.abierto = true;
		toast.info(diagState.activo ? 'Modo diagnóstico activado.' : 'Modo diagnóstico desactivado.');
	}

	let refreshKey = $state(0);
	let sincronizando = $state(false);
	async function sincronizarTodo() {
		if (sincronizando) return;
		sincronizando = true;
		try {
			const { data: { session } } = await supabase.auth.getSession();
			if (!session) {
				goto('/login');
				return;
			}
			await Promise.all([loadPermisos(session.user.id), cargarClientes()]);
			if (permisosState.rolNombre) userRole = permisosState.rolNombre;
			const requerido = getRequiredPermiso(page.url.pathname);
			if (requerido && !hasPermiso(requerido)) {
				const destino = getFirstAccessiblePath(hasPermiso);
				if (destino) await goto(destino, { replaceState: true });
			}
			refreshKey++;
			toast.success('ERP actualizado con los datos más recientes.');
		} catch (err) {
			console.error('[Layout] No se pudo actualizar:', err);
			toast.error('No se pudo actualizar. Revisa tu conexión e inténtalo de nuevo.');
		} finally {
			sincronizando = false;
		}
	}

	// Versión instalada, visible en el encabezado — para que cualquiera (incluida quien reporta un
	// problema) pueda decir exactamente con qué versión está.
	let versionApp = $state('');
	getInfoVersionApp().then((info) => (versionApp = info.version));

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
			diag('Imagen compartida recibida desde otra app', { archivo: sharedFile.name, tipo: sharedFile.type, kb: Math.round(sharedFile.size / 1024) });
			pendingShareState.file = sharedFile;
			goto('/finanzas/tranzacciones');
		}
	}

	// Tickets #33/#35/#36: si el refresco del token falla (red caída, equipo suspendido), supabase-js descarta la
	// sesión y desde ahí las consultas salen como ANÓNIMAS — las tablas sin RLS siguen respondiendo (así "todo
	// parece normal"), pero empleados/documento_proyecto/etc. devuelven vacío o "violates row-level security
	// policy" (listas de Responsable vacías, Asesor "Usuario", ventas a medio guardar). Antes la app no se enteraba.
	// Auditoría: ese momento queda registrado como 'sesion_expirada' con la hora exacta (ver auditoria.ts).
	const { data: authListener } = supabase.auth.onAuthStateChange((evento, sesion) => {
		if (evento === 'SIGNED_OUT' && !esCierreManual() && page.url.pathname !== '/login') {
			void registrarCierre('sesion_expirada', 'Supabase descartó la sesión (falló el refresco del token)');
			toast.error('Tu sesión expiró o se perdió. Vuelve a iniciar sesión para continuar.');
			goto('/login');
		}
	});
	onDestroy(() => authListener.subscription.unsubscribe());

	onMount(async () => {
		if (isRunningInTauri()) {
			getCurrentWindow().onFocusChanged(({ payload: focused }) => {
				if (focused) checkPendingShare();
			});
		}

		console.log('[Layout] onMount initiated for (app) layout. Path:', page.url.pathname);
		diag('App iniciada', { version: versionApp || null, ruta: page.url.pathname, ...infoEquipo() });
		// Al elegir una imagen de la galería la app pasa a segundo plano: si Android la mata ahí (falta de
		// memoria), el registro muestra "segundo plano" y nunca "volvió".
		document.addEventListener('visibilitychange', () => diag(document.visibilityState === 'visible' ? 'App volvió al frente' : 'App pasó a segundo plano'));
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

			// Deja registrada la versión de la app que este usuario tiene instalada (Panel Developer →
			// "Versiones instaladas"). Sin await a propósito: es best-effort y no debe demorar el arranque.
			void registrarVersionUsuario(supabase, session.user.id, permisosState.userName || null);
			// Control de Accesos → Auditoría: sesión, latido, cierre y eventos pendientes. Best-effort, sin await.
			void iniciarSesionAuditoria(session.user.id).then(() => {
				// Modo diagnóstico: si la vez anterior la app murió en medio del OCR (u otra operación marcada),
				// se reporta a la auditoría con el registro paso a paso, para verlo desde Prod.
				const caida = revisarCaidaAnterior();
				if (caida) {
					const ultimos = leerLog().slice(-40).map(formatearEntrada);
					reportarDiagnostico(`La app se cerró en medio de "${caida.nombre}"`, [JSON.stringify(infoEquipo()), ...ultimos].join('\n'));
				}
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
	<div class="h-screen w-screen flex items-center justify-center" style:background-color={FONDO_CARGA}>
		<SnoopyLoader mensaje="Cargando Construni ERP…" size="lg" />
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
			onclick={async () => { await cerrarSesion(); goto('/login'); }}
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
	<!-- Cierre de sesión tras 10 minutos de inactividad, con aviso para continuar (ver InactividadGuard). -->
	<InactividadGuard />
	<DiagnosticoPanel />

	<div class="flex h-screen bg-brand-gray overflow-hidden">
		<!-- Main Content -->
		<main class={`flex-1 overflow-y-auto transition-all duration-200 ${sidebarCollapsed ? 'md:ml-[76px]' : 'md:ml-[280px]'}`}>
			<!-- Placeholder Topbar para Layout General -->
			<header class="bg-white border-b border-slate-100 h-16 px-6 flex items-center justify-end sticky top-0 z-20 shadow-sm">
				<div class="flex items-center gap-4">
					{#if versionApp}
						<button type="button" onclick={tocarVersion} class="text-[11px] font-medium text-slate-400 select-text" title="Versión de la app instalada">v{versionApp}</button>
					{/if}
					<EntornoDeveloper />
					<EntornoHuelleros />
					<button
						type="button"
						onclick={sincronizarTodo}
						disabled={sincronizando}
						title="Actualizar: vuelve a cargar roles, permisos y los datos de todos los módulos"
						class="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-slate-50 hover:text-[#0f3b5e] disabled:opacity-60"
					>
						<i class={`fas fa-sync-alt ${sincronizando ? 'fa-spin' : ''}`}></i>
						<span class="hidden sm:inline">Actualizar</span>
					</button>
					<ActualizacionBell />
					{#key refreshKey}
						<NotificacionesBell />
					{/key}
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
						onclick={async () => { await cerrarSesion(); goto('/login'); }}
					>
						<i class="fas fa-sign-out-alt"></i>
					</button>
				</div>
			</header>
			
			<div class="p-4 md:p-8">
				{#key refreshKey}
					{@render children()}
				{/key}
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

	<!-- Botón flotante de "+" para la acción de alta de la página actual (ver mobileFabState) — mismo
	     motivo que el botón del menú de arriba para vivir acá y no dentro de cada página: un ancestro
	     overflow-hidden recorta position:fixed en algunos WebView de Android. Se exige que
	     mobileFabState.path coincida con la ruta ACTUAL — sin esto, un remanente de la página anterior
	     (ej. si su onDestroy corre después de que esta ya montó) se podía ver en cualquier otro módulo,
	     no solo en el dueño real de esas acciones. -->
	{#if mobileFabState.actions.length > 0 && mobileFabState.path === page.url.pathname}
		<MobileFab actions={mobileFabState.actions} />
	{/if}

	<Toast />
	<ConfirmDialogHost />
{/if}
