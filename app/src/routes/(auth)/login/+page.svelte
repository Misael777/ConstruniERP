<script lang="ts">
	import { onMount } from 'svelte';
	import { ENTORNO, CAMBIO_ENTORNO_POSIBLE, cambiarEntorno } from '$lib/supabaseClient';
	import { goto } from '$app/navigation';
	import { supabase } from '$lib/supabaseClient';
	import { confirmActivation, getFirstAdminStatus, createFirstAdmin as crearPrimerAdministrador } from '$lib/edgeFunctionClient';
	import SnoopyLoader, { FONDO_CARGA } from '$lib/shared/components/SnoopyLoader.svelte';
	import TecladoClave from '$lib/shared/components/TecladoClave.svelte';
	import { toDriveThumbnailUrl } from '$lib/shared/drivePreview';
	import { Fingerprint, Lock, ArrowRight } from '@lucide/svelte';
	import {
		leerAccesoRapido,
		activarAccesoRapido,
		abrirConClave,
		abrirConHuella,
		quitarAccesoRapido,
		actualizarPerfilAccesoRapido,
		huellaDisponible,
		fraseDelDia,
		esTelefono,
		leerPerfilRecordado,
		guardarPerfilRecordado,
		AccesoRapidoError,
		type PerfilRecordado,
		type AccesoRapidoGuardado,
		type FraseDelDia
	} from '$lib/shared/accesoRapido';

	// 'rapido': ingreso con clave de 4 dígitos / huella (ticket #112). 'crear_clave': se ofrece justo después de
	// iniciar sesión con la contraseña, si marcó "Activar ingreso rápido".
	let mode = $state<'login' | 'setup_password' | 'forgot_password' | 'first_admin' | 'rapido' | 'crear_clave'>('login');
	let email = $state('');
	let password = $state('');
	let rememberEmail = $state(false);
	let showPassword = $state(false);

	let setupEmail = $state('');
	let setupPassword = $state('');
	let setupConfirmPassword = $state('');
	let setupShowPassword = $state(false);
	let isLoading = $state(false);
	let errorMessage = $state('');
	let otpSent = $state(false);
	let otpToken = $state('');
	let infoMessage = $state('');
	// Ticket #9: pantalla completa (no solo el botón) desde que se envía el formulario hasta llegar al
	// dashboard, o hasta que un error obliga a volver a mostrar el formulario.
	let pantallaCompletaCarga = $state(false);
	let mensajeCargaPantallaCompleta = $state('Iniciando sesión…');

	let allowFirstAdmin = $state(false);
	let firstAdminName = $state('');
	let firstAdminEmail = $state('');
	let firstAdminPassword = $state('');
	let firstAdminConfirmPassword = $state('');
	let firstAdminError = $state('');
	let firstAdminSuccess = $state('');
	let checkingFirstAdmin = $state(true);
	/** Traduce un error técnico de Supabase Auth a un mensaje corto en español, apto para mostrar al
	 * usuario — antes se mostraba el error crudo (message/code/details/hint/stack completos) directo
	 * en pantalla, lo cual no es apto para un usuario final. El detalle técnico completo se sigue
	 * mandando a consola vía console.error en cada catch (sin cambios), solo deja de llegar a la UI. */
	function friendlyAuthError(err: any): string {
		if (!err) return 'Ocurrió un error inesperado. Intenta de nuevo.';

		// Errores propios de esta pantalla (throw new Error('mensaje ya en español') más arriba) no
		// son un AuthError de Supabase — esos SIEMPRE traen `.status` (código HTTP). Un Error plano
		// sin `.status` ya es un mensaje amigable escrito a mano: se muestra tal cual, sin remapear.
		if (err instanceof Error && (err as any).status === undefined && (err as any).code === undefined) {
			return err.message;
		}

		const msg = String(err?.message ?? '').toLowerCase();

		if (msg.includes('invalid login credentials')) return 'Correo o contraseña incorrectos.';
		if (msg.includes('email not confirmed')) return 'Tu correo todavía no ha sido confirmado.';
		if (msg.includes('token has expired') || msg.includes('otp_expired') || msg.includes('invalid otp') || msg.includes('token is invalid'))
			return 'El código ingresado no es válido o ya expiró. Solicita uno nuevo.';
		if (msg.includes('user already registered') || msg.includes('already been registered')) return 'Ya existe una cuenta registrada con ese correo.';
		if (msg.includes('password should be at least') || msg.includes('should be different from the old password'))
			return 'La contraseña no cumple los requisitos mínimos (u es igual a la anterior).';
		if (msg.includes('rate limit') || msg.includes('for security purposes')) return 'Demasiados intentos seguidos. Espera unos minutos y vuelve a intentarlo.';
		if (msg.includes('user not found')) return 'No se encontró ninguna cuenta con ese correo.';
		if (msg.includes('failed to fetch') || msg.includes('network')) return 'No se pudo conectar. Revisa tu conexión a internet e intenta de nuevo.';

		console.error('[Login] Error de auth no mapeado a un mensaje amigable:', err);
		return 'Ocurrió un error al procesar tu solicitud. Intenta de nuevo.';
	}
	
	let passwordInputRef = $state<HTMLInputElement>();

	// ---------- Ticket #112: ingreso rápido (clave de 4 dígitos / huella) y frase del día ----------
	let accesoGuardado = $state<AccesoRapidoGuardado | null>(null);
	let frase = $state<FraseDelDia | null>(null);
	let puedeHuella = $state(false);
	let activarRapido = $state(true);
	let clave = $state('');
	let claveError = $state(false);
	let mensajeRapido = $state('');
	// Paso "crear clave": datos de la sesión recién iniciada (la contraseña solo vive en memoria hasta cifrarse).
	let pendienteActivacion = $state<{ email: string; password: string; nombre: string; fotoUrl: string | null } | null>(null);
	let claveNueva = $state('');
	let claveConfirmar = $state('');
	let pasoClave = $state<'crear' | 'confirmar'>('crear');
	let usarHuella = $state(true);
	let activando = $state(false);
	// Pedido de la clienta (14/11/2026): la clave de 4 dígitos es solo del teléfono. En escritorio se entra con
	// correo y contraseña (maqueta: frase del día con Snoopy y la foto/iniciales de quien entró la última vez).
	let telefono = $state(false);
	let perfilRecordado = $state<PerfilRecordado | null>(null);
	let perfilVisible = $derived(
		perfilRecordado && email.trim().toLowerCase() === perfilRecordado.email.toLowerCase() ? perfilRecordado : null
	);
	// Teléfono con la clave ya creada pero sin huella: se activa al ingresar la clave la próxima vez (hace falta
	// la contraseña descifrada para volver a guardar el acceso, y eso solo se tiene al abrir con la clave).
	let activarHuellaPendiente = $state(false);

	function iniciales(nombre: string): string {
		return nombre
			.split(/\s+/)
			.filter(Boolean)
			.slice(0, 2)
			.map((p) => p[0]?.toUpperCase())
			.join('');
	}

	async function ingresarConClave(pin: string) {
		mensajeRapido = '';
		claveError = false;
		pantallaCompletaCarga = true;
		mensajeCargaPantallaCompleta = 'Iniciando sesión…';
		try {
			const cred = await abrirConClave(pin);
			if (activarHuellaPendiente && accesoGuardado) {
				try {
					await activarAccesoRapido({
						pin,
						email: cred.email,
						password: cred.password,
						nombre: accesoGuardado.nombre,
						fotoUrl: accesoGuardado.fotoUrl,
						conHuella: true
					});
				} catch (err) {
					// No impide entrar: solo queda sin huella.
					console.error('[Login] No se pudo activar la huella:', err);
				}
				activarHuellaPendiente = false;
			}
			await completarIngreso(cred.email, cred.password, 'rapido');
		} catch (err) {
			manejarErrorRapido(err);
		}
	}

	async function ingresarConHuella() {
		mensajeRapido = '';
		claveError = false;
		try {
			const cred = await abrirConHuella();
			pantallaCompletaCarga = true;
			mensajeCargaPantallaCompleta = 'Iniciando sesión…';
			await completarIngreso(cred.email, cred.password, 'rapido');
		} catch (err) {
			// Cancelar el diálogo de la huella no es un error: se sigue con la clave.
			const msg = String((err as any)?.message ?? err ?? '').toLowerCase();
			if (msg.includes('cancel')) return;
			manejarErrorRapido(err);
		}
	}

	function manejarErrorRapido(err: unknown) {
		pantallaCompletaCarga = false;
		clave = '';
		if (err instanceof AccesoRapidoError) {
			if (err.invalidado) {
				accesoGuardado = null;
				infoMessage = '';
				errorMessage = err.message;
				activarRapido = true;
				mode = 'login';
				return;
			}
			claveError = true;
			mensajeRapido = err.message;
			return;
		}
		console.error('[Login] Error en el ingreso rápido:', err);
		const msg = String((err as any)?.message ?? '').toLowerCase();
		if (msg.includes('invalid login credentials')) {
			// La contraseña cambió desde que se activó el ingreso rápido.
			void quitarAccesoRapido();
			accesoGuardado = null;
			errorMessage = 'Tu contraseña cambió. Ingresa con la nueva y vuelve a crear tu clave.';
			activarRapido = true;
			mode = 'login';
			return;
		}
		claveError = true;
		mensajeRapido = friendlyAuthError(err);
	}

	function usarContrasena() {
		email = accesoGuardado?.email ?? email;
		password = '';
		errorMessage = '';
		infoMessage = '';
		activarRapido = true;
		mode = 'login';
		setTimeout(() => passwordInputRef?.focus(), 50);
	}

	async function cambiarCuenta() {
		await quitarAccesoRapido();
		accesoGuardado = null;
		email = '';
		password = '';
		errorMessage = '';
		infoMessage = '';
		activarRapido = true;
		mode = 'login';
	}

	function onClaveNuevaCompleta(pin: string) {
		mensajeRapido = '';
		claveError = false;
		if (pasoClave === 'crear') {
			claveNueva = pin;
			claveConfirmar = '';
			pasoClave = 'confirmar';
			return;
		}
		if (pin !== claveNueva) {
			claveError = true;
			mensajeRapido = 'Las claves no coinciden. Vuelve a crearla.';
			claveNueva = '';
			claveConfirmar = '';
			pasoClave = 'crear';
			return;
		}
		void guardarClaveNueva(pin);
	}

	async function guardarClaveNueva(pin: string) {
		if (!pendienteActivacion) return irAlSistema();
		activando = true;
		try {
			await activarAccesoRapido({ ...pendienteActivacion, pin, conHuella: puedeHuella && usarHuella });
		} catch (err) {
			// No impide entrar: solo queda sin ingreso rápido.
			console.error('[Login] No se pudo activar el ingreso rápido:', err);
		} finally {
			activando = false;
		}
		await irAlSistema();
	}

	async function irAlSistema() {
		pendienteActivacion = null;
		pantallaCompletaCarga = true;
		mensajeCargaPantallaCompleta = 'Cargando tu cuenta…';
		await goto('/dashboard');
	}

	function getSavedEmail() {
		if (typeof localStorage === 'undefined') return null;
		try {
			return localStorage.getItem('construni_saved_email');
		} catch {
			return null;
		}
	}

	function saveEmailToStorage(emailToSave: string) {
		if (typeof localStorage === 'undefined') return;
		try {
			localStorage.setItem('construni_saved_email', emailToSave);
		} catch {
			// Ignorar errores de almacenamiento en entornos restringidos.
		}
	}

	function removeSavedEmailFromStorage() {
		if (typeof localStorage === 'undefined') return;
		try {
			localStorage.removeItem('construni_saved_email');
		} catch {
			// Ignorar errores de almacenamiento en entornos restringidos.
		}
	}

	async function checkFirstAdminAvailability() {
		checkingFirstAdmin = true;
		console.log('[Login] Checking first-admin availability...');
		// Vía la Edge Function user-admin (service_role del lado de Supabase), igual en navegador, Tauri
		// Windows y Tauri Android — antes Tauri usaba un comando Rust y el navegador /api/first-admin, y los
		// dos necesitaban SUPABASE_SERVICE_ROLE_KEY local, que la app instalada no tiene.
		try {
			allowFirstAdmin = await getFirstAdminStatus();
			console.log('[Login] allowFirstAdmin set to', allowFirstAdmin);
		} catch (err) {
			// Sin verificación confiable no se ofrece crear el primer administrador. No se cuenta `empleados`
			// desde el cliente: sin sesión (rol anon) la RLS de esa tabla devuelve 0 filas siempre, lo que
			// mostraría "crear primer administrador" aunque la base ya tenga empleados.
			console.warn('[Login] first-admin availability error — no se ofrece crear el primer administrador:', err);
			allowFirstAdmin = false;
		} finally {
			checkingFirstAdmin = false;
		}
	}

	onMount(async () => {
		console.log('[Login] onMount started');
		// Llegó acá por el cierre automático por inactividad (ver InactividadGuard.svelte).
		if (new URL(window.location.href).searchParams.get('inactividad') === '1') {
			infoMessage = 'Tu sesión se cerró por 10 minutos de inactividad. Ingresa de nuevo para continuar.';
		}

		// If the user already has a valid session, skip the login form
		const { data: { session } } = await supabase.auth.getSession();
		if (session) {
			console.log('[Login] active session found — redirecting to /dashboard');
			goto('/dashboard', { replaceState: true });
			return;
		}

		// Recuperar email de localStorage si existe
		const savedEmail = getSavedEmail();
		if (savedEmail) {
			email = savedEmail;
			rememberEmail = true;
			// Enfocar contraseña automáticamente
			setTimeout(() => {
				passwordInputRef?.focus();
			}, 100);
		}

		checkFirstAdminAvailability();

		// Ticket #112: si este equipo tiene ingreso rápido, se muestra esa pantalla (solo en el teléfono).
		void fraseDelDia().then((f) => (frase = f));
		telefono = await esTelefono();
		perfilRecordado = leerPerfilRecordado();
		accesoGuardado = leerAccesoRapido();
		if (accesoGuardado && !telefono) {
			// Escritorio con una clave creada antes de este cambio: se pasa a correo y contraseña y se borra el
			// acceso guardado (la contraseña cifrada) de este equipo. Se conserva el correo y la foto.
			perfilRecordado = { email: accesoGuardado.email, nombre: accesoGuardado.nombre, fotoUrl: accesoGuardado.fotoUrl };
			guardarPerfilRecordado(perfilRecordado);
			if (!email) {
				email = accesoGuardado.email;
				setTimeout(() => passwordInputRef?.focus(), 100);
			}
			void quitarAccesoRapido();
			accesoGuardado = null;
		}
		activarRapido = telefono && !accesoGuardado;
		if (accesoGuardado) mode = 'rapido';
		puedeHuella = await huellaDisponible();
		if (accesoGuardado?.huella && puedeHuella && mode === 'rapido') void ingresarConHuella();
	});

	async function handleLogin(e: Event) {
		e.preventDefault();
		isLoading = true;
		pantallaCompletaCarga = true;
		mensajeCargaPantallaCompleta = 'Iniciando sesión…';
		errorMessage = '';
		try {
			await completarIngreso(email, password, 'contrasena');
		} catch (err: any) {
			console.error('[Login] Login process exception:', err);
			errorMessage = friendlyAuthError(err);
			isLoading = false;
			pantallaCompletaCarga = false;
		}
	}

	/** Inicia sesión y verifica que sea un empleado autorizado. Lanza el error si algo falla. */
	async function completarIngreso(email: string, password: string, origen: 'contrasena' | 'rapido') {
		console.log('[Login] Attempting sign in with email:', email);
		{
			const { data, error } = await supabase.auth.signInWithPassword({
				email,
				password
			});
			
			if (error) {
				console.error('[Login] Supabase Auth sign-in error:', error);
				throw error;
			}

			console.log('[Login] Supabase Auth sign-in successful. User ID:', data.user?.id);

			// Validar si el usuario está registrado en el módulo de IAM (tabla empleados)
			console.log('[Login] Querying database for employee record linked to auth_user_id:', data.user?.id);
			const { data: empleado, error: empleadoError } = await supabase
				.from('empleados')
				.select('id, nombre')
				.eq('auth_user_id', data.user?.id)
				.maybeSingle();

			if (empleadoError) {
				console.error('[Login] Error fetching employee record:', empleadoError);
				await supabase.auth.signOut();
				throw new Error('No se pudo verificar tu cuenta. Intenta de nuevo o contacta a un administrador.');
			}

			if (!empleado) {
				console.warn('[Login] Employee record not found for auth_user_id:', data.user?.id);
				await supabase.auth.signOut();
				throw new Error('Tu correo electrónico no está registrado o no ha sido autorizado por el administrador.');
			}
			
			console.log('[Login] Employee record verified. ID:', empleado.id);
			
			// Nombre y foto para la pantalla de ingreso rápido (la foto es la del trabajador en RR.HH., si tiene).
			const nombre = (empleado as any).nombre || email;
			let fotoUrl: string | null = null;
			try {
				const { data: per } = await supabase
					.from('personal')
					.select('foto_url')
					.eq('id_empleado', empleado.id)
					.not('foto_url', 'is', null)
					.limit(1)
					.maybeSingle();
				fotoUrl = (per as any)?.foto_url ?? null;
			} catch {
				// Sin foto: se muestran las iniciales.
			}

			// Foto/iniciales en el login de escritorio: solo si pidió recordar el correo.
			if (origen === 'contrasena') guardarPerfilRecordado(rememberEmail ? { email, nombre, fotoUrl } : null);

			if (origen === 'rapido') {
				actualizarPerfilAccesoRapido(nombre, fotoUrl);
				await irAlSistema();
				return;
			}

			// Guardar o eliminar de localStorage
			if (rememberEmail) {
				console.log('[Login] Remembering email in localStorage');
				saveEmailToStorage(email);
			} else {
				console.log('[Login] Removing email from localStorage');
				removeSavedEmailFromStorage();
			}
			
			isLoading = false;
			// Ticket #112: si marcó "Activar ingreso rápido", antes de entrar crea su clave de 4 dígitos.
			if (activarRapido && telefono) {
				pendienteActivacion = { email, password, nombre, fotoUrl };
				claveNueva = '';
				claveConfirmar = '';
				pasoClave = 'crear';
				usarHuella = true;
				mensajeRapido = '';
				claveError = false;
				mode = 'crear_clave';
				pantallaCompletaCarga = false;
				return;
			}

			// Redirigir al sistema. Éxito: NO se apaga pantallaCompletaCarga acá — se queda visible hasta que
			// (app)/+layout.svelte termine su propio arranque (loadPermisos), para que no haya un hueco entre el
			// login y el ERP.
			console.log('[Login] Redirecting to /dashboard...');
			await irAlSistema();
		}
	}

	async function requestPasswordResetOtp(e: Event) {
		e.preventDefault();
		isLoading = true;
		errorMessage = '';
		infoMessage = '';
		console.log('[SetupPassword] Solicitud de OTP para:', setupEmail);

		if (!setupEmail) {
			errorMessage = 'El correo electrónico es obligatorio';
			isLoading = false;
			return;
		}

		pantallaCompletaCarga = true;
		mensajeCargaPantallaCompleta = 'Enviando código…';
		try {
			const { data, error } = await supabase.auth.resetPasswordForEmail(setupEmail);
			if (error) {
				console.error('[SetupPassword] Error al enviar OTP de recuperación:', error);
				throw error;
			}

			otpSent = true;
			infoMessage = `Se ha enviado un código OTP a ${setupEmail}. Revisa tu correo y completa el formulario.`;
			console.log('[SetupPassword] OTP enviado con éxito:', data);
		} catch (err: any) {
			console.error('[SetupPassword] Exception caught while requesting OTP:', err);
			errorMessage = friendlyAuthError(err);
		} finally {
			isLoading = false;
			pantallaCompletaCarga = false;
		}
	}

async function verifyOtpAndSetPassword(e: Event) {
		e.preventDefault();
		isLoading = true;
		errorMessage = '';
		infoMessage = '';
		console.log('[SetupPassword] Verificando OTP para:', setupEmail);
		pantallaCompletaCarga = true;
		mensajeCargaPantallaCompleta = 'Configurando tu acceso…';

		if (setupPassword !== setupConfirmPassword) {
			errorMessage = 'Las contraseñas no coinciden';
			isLoading = false;
			return;
		}

		if (!otpToken) {
			errorMessage = 'El código OTP es obligatorio';
			isLoading = false;
			return;
		}

		try {
			const { data: verifyData, error: verifyError } = await supabase.auth.verifyOtp({
				email: setupEmail,
				token: otpToken,
				type: 'recovery'
			});

			if (verifyError) {
				console.error('[SetupPassword] Error al verificar OTP:', verifyError);
				throw verifyError;
			}

			console.log('[SetupPassword] OTP verificado. Sesión temporal recibida:', verifyData);

			const { data: updateData, error: updateError } = await supabase.auth.updateUser({
				password: setupPassword
			});

			if (updateError) {
				console.error('[SetupPassword] Error al actualizar contraseña:', updateError);
				throw updateError;
			}

			console.log('[SetupPassword] Contraseña actualizada con éxito:', updateData);

			// Marca la cuenta como realmente activada (distinto de "vinculada", ver nota en
			// iam/empleados/+page.svelte) — recién ahora el empleado completó el código OTP y puso su
			// propia contraseña. Pasa por la Edge Function (service_role) porque un update directo a
			// `empleados` desde esta sesión de bajo privilegio fallaba en silencio por RLS — quedaba
			// en "Pendiente de activación" para siempre aunque la contraseña sí se hubiera guardado.
			// No se bloquea el login si esto falla (lo importante, la contraseña, ya quedó guardada);
			// solo se deja constancia en consola.
			if (updateData?.user?.id) {
				try {
					await confirmActivation(updateData.user.id);
				} catch (flagError) {
					console.error('[SetupPassword] No se pudo marcar password_configurado:', flagError);
				}
			}

			mensajeCargaPantallaCompleta = 'Cargando tu cuenta…';
			isLoading = false;
			await goto('/dashboard');
			// Mismo criterio que handleLogin: no se apaga pantallaCompletaCarga en el camino de éxito.
			return;
		} catch (err: any) {
			console.error('[SetupPassword] Exception caught while verifying OTP:', err);
			errorMessage = friendlyAuthError(err);
			isLoading = false;
			pantallaCompletaCarga = false;
		}
	}

async function handleSetupPassword(e: Event) {
		if (!otpSent) {
			await requestPasswordResetOtp(e);
		} else {
			await verifyOtpAndSetPassword(e);
		}
	}

	async function createFirstAdmin(e: Event) {
		e.preventDefault();
		firstAdminError = '';
		firstAdminSuccess = '';

		if (!firstAdminName || !firstAdminEmail || !firstAdminPassword) {
			firstAdminError = 'Nombre, correo y contraseña son obligatorios.';
			return;
		}

		if (firstAdminPassword !== firstAdminConfirmPassword) {
			firstAdminError = 'Las contraseñas no coinciden.';
			return;
		}

		if (firstAdminPassword.length < 6) {
			firstAdminError = 'La contraseña debe tener al menos 6 caracteres.';
			return;
		}

		isLoading = true;
		pantallaCompletaCarga = true;
		mensajeCargaPantallaCompleta = 'Creando el primer administrador…';
		try {
			// Edge Function user-admin — mismo camino en navegador, Tauri Windows y Tauri Android.
			await crearPrimerAdministrador({ nombre: firstAdminName.trim(), email: firstAdminEmail.trim(), password: firstAdminPassword });
			allowFirstAdmin = false;

			firstAdminSuccess = 'Primer administrador creado con éxito. Ahora puedes iniciar sesión.';
			firstAdminError = '';
			infoMessage = firstAdminSuccess;
			mode = 'login';
			email = firstAdminEmail;
		} catch (err: any) {
			console.error('[Login] Error creating first admin:', err);
			firstAdminError = friendlyAuthError(err);
		} finally {
			isLoading = false;
			pantallaCompletaCarga = false;
		}
	}

	function togglePassword() {
		showPassword = !showPassword;
	}
</script>

<svelte:head>
	<title>Iniciar Sesión | Construni ERP</title>
</svelte:head>

{#if pantallaCompletaCarga}
	<div class="min-h-screen flex items-center justify-center p-4" style:background-color={FONDO_CARGA}>
		<SnoopyLoader mensaje={mensajeCargaPantallaCompleta} size="lg" />
	</div>
{:else if mode === 'rapido' || mode === 'crear_clave'}
	<!-- Ticket #112: pantalla de ingreso según la maqueta de la clienta (encabezado azul con el logo, "Hola", foto,
	     frase del día con Snoopy, clave de 4 dígitos con teclado grande y botón naranja). También el paso de crear la
	     clave, con el mismo diseño. -->
	{@const perfil = mode === 'rapido' ? accesoGuardado : pendienteActivacion}
	<!-- Pedido de la clienta (13/11/2026): "todo en 1 pantalla". En el teléfono la pantalla mide exactamente el alto
	     visible (h-dvh, sin scroll) y las teclas/casillas se achican con el alto disponible (ver TecladoClave). -->
	<div class="h-dvh sm:h-auto sm:min-h-dvh bg-slate-100 sm:flex sm:items-center sm:justify-center sm:p-6">
		<div class="w-full sm:max-w-md h-dvh sm:h-auto flex flex-col bg-[#0b2447] sm:rounded-3xl sm:shadow-2xl overflow-hidden">
			<header class="shrink-0 flex items-center gap-2.5 px-5 pt-[calc(env(safe-area-inset-top)+min(0.75rem,1.5dvh))] pb-[min(1.75rem,4dvh)]">
				<img src="/logo-isotipo.png" alt="" class="h-[min(2.25rem,5.5dvh)] w-auto" />
				<div class="leading-none">
					<p class="text-white text-2xl font-bold tracking-tight">construni</p>
					<p class="mt-0.5 pl-0.5 border-l-2 border-white/60 text-brand-orange text-base font-bold tracking-wide">&nbsp;ERP</p>
				</div>
			</header>

			<main class="flex-1 min-h-0 overflow-y-auto [scrollbar-width:none] -mt-5 bg-white rounded-t-[1.75rem] px-5 pt-[min(1rem,2dvh)] pb-[calc(env(safe-area-inset-bottom)+min(0.75rem,1dvh))] flex flex-col">
				{#if ENTORNO === 'dev'}
					<div class="mb-3 px-3 py-1.5 rounded-lg bg-amber-100 border border-amber-300 text-amber-900 text-xs text-center">
						Base de <b>DESARROLLO</b> (datos de prueba)
					</div>
				{/if}

				<div class="text-center">
					<h1 class="text-[clamp(1.375rem,4.2dvh,1.75rem)] leading-tight font-extrabold text-[#0f2a4a]">Hola</h1>
					<!-- Pantallas bajas (< 700 px, ej. 360×640): se ocultan subtítulo y correo para que entre todo sin deslizar. -->
					<p class={`text-sm text-slate-600 ${mode === 'rapido' ? '[@media(max-height:700px)]:hidden' : ''}`}>{mode === 'rapido' ? '¡Qué bueno tenerte aquí!' : 'Crea tu clave de ingreso rápido'}</p>
				</div>

				<!-- Pedido de la clienta (14/11/2026), igual que en escritorio: arriba la frase del día con Snoopy al lado y,
				     debajo, la foto al centro (la foto al lado de la frase se veía rara en el celular). -->
				{#if frase}
					<div class="mt-[min(0.5rem,1dvh)] grid grid-cols-[3.25rem_minmax(0,1fr)_3.25rem] items-center gap-1.5">
						<div></div>
						<div class="text-center min-w-0">
							<p class="text-xs font-semibold leading-snug text-[#0f2a4a] line-clamp-3">“{frase.frase}”</p>
							{#if frase.autor}<p class="mt-0.5 text-[10px] text-slate-500 truncate">{frase.autor}</p>{/if}
						</div>
						<img src="/snoopy-casco.webp" alt="" width="376" height="473" class="h-[min(3.75rem,7dvh)] w-auto justify-self-end select-none" draggable="false" />
					</div>
				{/if}
				<div class="mt-[min(0.375rem,0.8dvh)] flex justify-center">
					<div class="w-[min(5rem,9dvh)] h-[min(5rem,9dvh)] sm:w-24 sm:h-24 rounded-full overflow-hidden bg-slate-200 ring-4 ring-white shadow-md flex items-center justify-center">
						{#if perfil?.fotoUrl}
							<img src={toDriveThumbnailUrl(perfil.fotoUrl, 300)} alt="" referrerpolicy="no-referrer" class="w-full h-full object-cover" />
						{:else}
							<span class="text-2xl font-bold text-slate-500">{iniciales(perfil?.nombre ?? '')}</span>
						{/if}
					</div>
				</div>

				<div class="mt-1 text-center leading-tight">
					<p class="text-lg font-bold text-[#0f2a4a] truncate">{perfil?.nombre ?? ''}</p>
					<p class="text-sm text-slate-500 truncate [@media(max-height:700px)]:hidden">{perfil?.email ?? ''}</p>
					{#if mode === 'rapido'}
						<button type="button" onclick={cambiarCuenta} class="mt-0.5 text-sm font-medium text-brand-orange hover:underline">Cambiar cuenta</button>
					{/if}
				</div>

				<p class="mt-[min(0.75rem,1.2dvh)] text-center text-base font-semibold text-[#0f2a4a]">
					{#if mode === 'rapido'}
						Ingresa tu clave de 4 dígitos
					{:else if pasoClave === 'crear'}
						Elige una clave de 4 dígitos
					{:else}
						Repite la clave para confirmarla
					{/if}
				</p>

				<div class="mt-2">
					{#if mode === 'rapido'}
						<TecladoClave bind:valor={clave} error={claveError} alCompletar={ingresarConClave}>
							{#snippet nota()}
								{#if mensajeRapido}
									<p class="mt-[min(0.75rem,1.2dvh)] text-center text-xs font-medium text-red-600">{mensajeRapido}</p>
								{:else if activarHuellaPendiente}
									<p class="mt-[min(0.75rem,1.2dvh)] flex items-center justify-center gap-1.5 text-xs font-medium text-brand-orange">
										<Fingerprint size={13} /> Ingresa tu clave para activar tu huella
									</p>
								{:else}
									<p class="mt-[min(0.75rem,1.2dvh)] flex items-center justify-center gap-1.5 text-xs text-slate-500">
										<Lock size={13} /> Acceso guardado en este equipo
									</p>
								{/if}
							{/snippet}
							{#snippet teclaExtra()}
								{#if accesoGuardado?.huella && puedeHuella}
									<button
										type="button"
										onclick={ingresarConHuella}
										aria-label="Ingresar con huella"
										class="h-[min(52px,6dvh)] [@media(max-height:700px)]:h-[5.6dvh] sm:h-14 rounded-2xl bg-orange-50 text-brand-orange shadow-sm active:scale-[0.97] flex items-center justify-center"
									>
										<Fingerprint size={26} />
									</button>
								{:else if puedeHuella}
									<!-- Teléfono con huella registrada pero sin activarla aquí: se activa al ingresar la clave. -->
									<button
										type="button"
										onclick={() => { activarHuellaPendiente = !activarHuellaPendiente; mensajeRapido = ''; }}
										aria-pressed={activarHuellaPendiente}
										aria-label="Activar ingreso con huella"
										title="Activar ingreso con huella"
										class={`h-[min(52px,6dvh)] [@media(max-height:700px)]:h-[5.6dvh] sm:h-14 rounded-2xl active:scale-[0.97] flex flex-col items-center justify-center leading-none ${activarHuellaPendiente ? 'bg-orange-100 text-brand-orange ring-2 ring-brand-orange' : 'bg-slate-100 text-slate-500'}`}
									>
										<Fingerprint size={20} />
										<span class="mt-0.5 text-[9px] font-semibold">Activar</span>
									</button>
								{:else}
									<div class="h-[min(52px,6dvh)] [@media(max-height:700px)]:h-[5.6dvh] sm:h-14 rounded-2xl bg-slate-100/60"></div>
								{/if}
							{/snippet}
						</TecladoClave>
					{:else if pasoClave === 'crear'}
						<TecladoClave bind:valor={claveNueva} error={claveError} deshabilitado={activando} alCompletar={onClaveNuevaCompleta}>
							{#snippet nota()}
								<p class={`mt-[min(0.75rem,1.2dvh)] text-center text-xs ${mensajeRapido ? 'font-medium text-red-600' : 'text-slate-500'}`}>
									{mensajeRapido || 'La usarás para entrar sin escribir tu contraseña.'}
								</p>
							{/snippet}
						</TecladoClave>
					{:else}
						<TecladoClave bind:valor={claveConfirmar} deshabilitado={activando} alCompletar={onClaveNuevaCompleta}>
							{#snippet nota()}
								<p class="mt-[min(0.75rem,1.2dvh)] text-center text-xs text-slate-500">Escribe la misma clave otra vez.</p>
							{/snippet}
						</TecladoClave>
					{/if}
				</div>

				{#if mode === 'crear_clave' && puedeHuella}
					<label class="mt-2 flex items-center justify-center gap-2 text-sm font-medium text-slate-700">
						<input type="checkbox" bind:checked={usarHuella} class="w-4 h-4 rounded text-brand-orange focus:ring-brand-orange" />
						<Fingerprint size={18} class="text-brand-orange" /> Ingresar también con mi huella
					</label>
				{/if}

				<div class="mt-auto pt-[min(0.5rem,1dvh)]">
					{#if mode === 'rapido'}
						<button
							type="button"
							disabled={clave.length < 4}
							onclick={() => ingresarConClave(clave)}
							class="w-full h-[min(3.25rem,6dvh)] rounded-2xl bg-brand-orange text-white text-lg font-bold shadow-lg shadow-orange-500/25 active:scale-[0.98] transition disabled:opacity-60 flex items-center justify-center gap-2"
						>
							Ingresar <ArrowRight size={20} />
						</button>
						<button type="button" onclick={usarContrasena} class="mt-2 w-full text-center text-sm font-medium text-[#0f2a4a] hover:underline">
							¿Olvidaste tu acceso?
						</button>
					{:else}
						<button
							type="button"
							disabled={activando}
							onclick={irAlSistema}
							class="w-full text-center text-sm font-medium text-slate-500 hover:underline disabled:opacity-50"
						>
							{activando ? 'Guardando…' : 'Ahora no'}
						</button>
					{/if}
				</div>
			</main>
		</div>
	</div>
{:else}
<!-- Ticket #124 (rechazo 21/11/2026): "debería ver solo 1 pantalla sin barra". En PC la ventana mide ~790 px de alto y
     esta tarjeta medía ~830: se compactó (encabezado en una fila, menos márgenes, Snoopy y foto más chicos) y en
     ventanas bajas se achica un poco más con @media(max-height). -->
<div class="min-h-dvh bg-slate-50 flex flex-col justify-center items-center p-3 sm:p-4">
	<div class="w-full max-w-md bg-white rounded-3xl shadow-xl overflow-hidden border border-slate-100">
		<!-- Branding Header -->
		<div class="bg-brand-marine px-6 py-4 [@media(max-height:720px)]:py-3 flex items-center justify-center gap-3">
			<!-- Insignia: halo en brand-orange detrás del tile (mismo tratamiento que Sidebar.svelte). -->
			<div class="relative">
				<div class="absolute inset-0 bg-brand-orange/30 blur-xl rounded-full scale-125"></div>
				<div class="relative w-12 h-12 rounded-2xl overflow-hidden shadow-xl shadow-black/40 ring-1 ring-white/10">
					<img src="/logo.png" alt="Construni ERP" class="w-full h-full object-cover" />
				</div>
			</div>
			<div class="flex flex-col text-white">
				<h1 class="font-bold text-2xl leading-tight">CONSTRUNI</h1>
				<span class="text-xs font-bold text-brand-orange uppercase tracking-widest">ERP</span>
			</div>
		</div>
		
		<!-- Formulario -->
		{#if mode === 'login'}
			{#if ENTORNO === 'dev'}
				<!-- Cambio de base PRD/DEV (rol developer): en el login de Dev se avisa y se puede volver a Producción. -->
				<div class="mx-8 mt-6 -mb-2 px-3 py-2 rounded-lg bg-amber-100 border border-amber-300 text-amber-900 text-sm flex items-center justify-between gap-2">
					<span><i class="fas fa-database mr-1"></i> Base de <b>DESARROLLO</b> (datos de prueba)</span>
					{#if CAMBIO_ENTORNO_POSIBLE}
						<button type="button" onclick={() => cambiarEntorno('prd')} class="text-xs font-semibold underline">Volver a Producción</button>
					{/if}
				</div>
			{/if}
			<form class="px-7 py-5 [@media(max-height:720px)]:py-4 space-y-4 [@media(max-height:720px)]:space-y-3" onsubmit={handleLogin}>
				<div class="text-center">
					<h2 class="text-xl font-bold text-slate-800">Bienvenido de nuevo</h2>
					<p class="text-sm text-slate-500 mt-0.5 [@media(max-height:720px)]:hidden">Ingresa tus credenciales para continuar</p>
				</div>

				<!-- Maqueta de la clienta (14/11/2026): frase del día con Snoopy y, debajo, la foto o iniciales de quien
				     entró la última vez en este equipo (si pidió recordar el correo y es el mismo correo escrito). -->
				{#if frase || perfilVisible}
					<div class="flex flex-col items-center">
						{#if frase}
							<div class="w-full grid grid-cols-[3.5rem_minmax(0,1fr)_3.5rem] items-center gap-2">
								<div></div>
								<div class="text-center">
									<p class="text-sm font-semibold leading-snug text-[#0f2a4a]">“{frase.frase}”</p>
									{#if frase.autor}<p class="mt-0.5 text-xs text-slate-500">{frase.autor}</p>{/if}
								</div>
								<img src="/snoopy-casco.webp" alt="" width="376" height="473" class="h-16 [@media(max-height:720px)]:h-12 w-auto justify-self-end select-none" draggable="false" />
							</div>
						{/if}
						{#if perfilVisible}
							<div class="mt-1 w-16 h-16 [@media(max-height:720px)]:w-12 [@media(max-height:720px)]:h-12 rounded-full overflow-hidden bg-slate-200 ring-4 ring-white shadow-md flex items-center justify-center" title={perfilVisible.nombre}>
								{#if perfilVisible.fotoUrl}
									<img src={toDriveThumbnailUrl(perfilVisible.fotoUrl, 300)} alt="" referrerpolicy="no-referrer" class="w-full h-full object-cover" />
								{:else}
									<span class="text-2xl font-bold text-slate-500">{iniciales(perfilVisible.nombre)}</span>
								{/if}
							</div>
						{/if}
					</div>
				{/if}
				
				{#if errorMessage}
					<div class="p-3 bg-red-50 border border-red-100 text-red-600 text-sm rounded-xl font-medium text-center">
						{errorMessage}
					</div>
				{/if}

				{#if infoMessage}
					<div class="p-3 bg-emerald-50 border border-emerald-100 text-emerald-700 text-sm rounded-xl font-medium text-center">
						{infoMessage}
					</div>
				{/if}

				<!-- Correo -->
				<div>
					<label for="login-email" class="block text-sm font-semibold text-[#0f3b5e] mb-1">Correo Electrónico</label>
					<div class="relative">
						<div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
							<i class="fas fa-envelope"></i>
						</div>
						<input 
							type="email" 
							id="login-email"
							bind:value={email}
							placeholder="ejemplo@construni.com"
							class="w-full pl-10 pr-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:bg-white outline-none transition-all text-sm"
							required
						/>
					</div>
				</div>
				
				<!-- Contraseña -->
				<div>
					<label for="login-password" class="block text-sm font-semibold text-[#0f3b5e] mb-1">Contraseña</label>
					<div class="relative">
						<div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
							<i class="fas fa-lock"></i>
						</div>
						<input 
							id="login-password"
							bind:this={passwordInputRef}
							type={showPassword ? "text" : "password"} 
							bind:value={password}
							placeholder="••••••••"
							class="w-full pl-10 pr-10 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:bg-white outline-none transition-all text-sm"
							required
						/>
						<button 
							type="button" 
							onclick={togglePassword}
							aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
							class="absolute z-10 inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600 cursor-pointer"
						>
							<i class="fas {showPassword ? 'fa-eye-slash' : 'fa-eye'}"></i>
						</button>
					</div>
				</div>
				
				<!-- Recordar -->
				<div class="flex items-center justify-between text-sm">
					<label class="flex items-center cursor-pointer text-slate-600 font-medium">
						<input type="checkbox" bind:checked={rememberEmail} class="mr-2 rounded text-blue-600 focus:ring-blue-500 border-slate-300 w-4 h-4">
						Recordar correo
					</label>
					<button type="button" onclick={() => { mode = 'forgot_password'; errorMessage = ''; setupEmail = ''; setupPassword = ''; setupConfirmPassword = ''; }} class="text-brand-orange hover:text-orange-600 font-semibold">¿Olvidaste tu contraseña?</button>
				</div>

				<!-- Ticket #112: ingreso rápido con clave de 4 dígitos (y huella en Android). Solo en el teléfono. -->
				{#if telefono}
				<label class="flex items-start gap-2 cursor-pointer text-sm text-slate-600 font-medium -mt-2">
					<input type="checkbox" bind:checked={activarRapido} class="mt-0.5 rounded text-blue-600 focus:ring-blue-500 border-slate-300 w-4 h-4" />
					<span>
						Activar ingreso rápido en este equipo
						<span class="block text-xs font-normal text-slate-400">Entra con una clave de 4 dígitos{puedeHuella ? ' o con tu huella' : ''}, sin escribir tu contraseña.</span>
					</span>
				</label>
				{/if}
				
				<!-- Botón -->
				<button 
					type="submit" 
					disabled={isLoading}
					class="w-full h-11 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 active:scale-[0.98] transition-all shadow-md shadow-blue-600/20 disabled:opacity-70 flex justify-center items-center gap-2"
				>
					{#if isLoading}
						<i class="fas fa-spinner fa-spin"></i> Ingresando...
					{:else}
						Iniciar Sesión <i class="fas fa-arrow-right"></i>
					{/if}
				</button>

				<div class="text-center">
					<button type="button" onclick={() => { mode = 'setup_password'; errorMessage = ''; setupEmail = ''; setupPassword = ''; setupConfirmPassword = ''; }} class="text-blue-600 hover:text-blue-700 font-semibold text-sm">
						¿Es tu primera vez? Configura tu contraseña aquí
					</button>
				</div>

				{#if accesoGuardado}
					<div class="text-center -mt-3">
						<button type="button" onclick={() => { mode = 'rapido'; errorMessage = ''; clave = ''; mensajeRapido = ''; claveError = false; }} class="text-slate-500 hover:text-slate-700 font-semibold text-sm">
							<i class="fas fa-arrow-left mr-1"></i> Volver al ingreso con clave
						</button>
					</div>
				{/if}

				{#if allowFirstAdmin}
					<div class="text-center pt-4 border-t border-slate-200 mt-4 pt-4">
						<p class="text-sm text-slate-500 mb-3">Parece que no hay usuarios registrados aún.</p>
						<button type="button" onclick={() => { console.log('[Login] first admin option clicked'); mode = 'first_admin'; firstAdminError = ''; firstAdminSuccess = ''; firstAdminName = ''; firstAdminEmail = ''; firstAdminPassword = ''; firstAdminConfirmPassword = ''; }} class="text-brand-orange hover:text-orange-600 font-semibold text-sm">
							Crear primer administrador
						</button>
					</div>
				{/if}
			</form>
		{:else if mode === 'first_admin'}
			<form class="p-8 space-y-6" onsubmit={createFirstAdmin}>
				<div class="text-center mb-4">
					<h2 class="text-xl font-bold text-slate-800">Primer administrador</h2>
					<p class="text-sm text-slate-500 mt-1">Crea el primer usuario administrador para inicializar el sistema</p>
				</div>

				{#if firstAdminError}
					<div class="p-3 bg-red-50 border border-red-100 text-red-600 text-sm rounded-xl font-medium text-center">
						{firstAdminError}
					</div>
				{/if}
				{#if firstAdminSuccess}
					<div class="p-3 bg-emerald-50 border border-emerald-100 text-emerald-700 text-sm rounded-xl font-medium text-center">
						{firstAdminSuccess}
					</div>
				{/if}

				<div>
					<label for="first-admin-name" class="block text-sm font-semibold text-[#0f3b5e] mb-1">Nombre completo</label>
					<input
						type="text"
						id="first-admin-name"
						bind:value={firstAdminName}
						placeholder="Ej. Ana Pérez"
						class="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:bg-white outline-none transition-all text-sm"
						required
					/>
				</div>

				<div>
					<label for="first-admin-email" class="block text-sm font-semibold text-[#0f3b5e] mb-1">Correo electrónico</label>
					<input
						type="email"
						id="first-admin-email"
						bind:value={firstAdminEmail}
						placeholder="ejemplo@construni.com"
						class="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:bg-white outline-none transition-all text-sm"
						required
					/>
				</div>

				<div>
					<label for="first-admin-password" class="block text-sm font-semibold text-[#0f3b5e] mb-1">Contraseña</label>
					<input
						type="password"
						id="first-admin-password"
						bind:value={firstAdminPassword}
						placeholder="Mínimo 6 caracteres"
						class="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:bg-white outline-none transition-all text-sm"
						required
					/>
				</div>

				<div>
					<label for="first-admin-confirm-password" class="block text-sm font-semibold text-[#0f3b5e] mb-1">Confirmar contraseña</label>
					<input
						type="password"
						id="first-admin-confirm-password"
						bind:value={firstAdminConfirmPassword}
						placeholder="Repite la contraseña"
						class="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:bg-white outline-none transition-all text-sm"
						required
					/>
				</div>

				<button
					type="submit"
					disabled={isLoading}
					class="w-full h-12 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 active:scale-[0.98] transition-all shadow-md shadow-blue-600/20 disabled:opacity-70 flex justify-center items-center gap-2"
				>
					{#if isLoading}
						<i class="fas fa-spinner fa-spin"></i> Creando administrador...
					{:else}
						Crear administrador
					{/if}
				</button>

				<div class="text-center pt-2">
					<button type="button" onclick={() => { mode = 'login'; firstAdminError = ''; firstAdminSuccess = ''; }} class="text-slate-500 hover:text-slate-700 font-semibold text-sm">
						<i class="fas fa-arrow-left mr-1"></i> Volver al inicio de sesión
					</button>
				</div>
			</form>

		{:else if mode === 'setup_password'}
			<form class="p-8 space-y-6" onsubmit={handleSetupPassword}>
				<div class="text-center mb-4">
					<h2 class="text-xl font-bold text-slate-800">Crea tu contraseña</h2>
					<p class="text-sm text-slate-500 mt-1">Configura tu acceso si fuiste registrado por el administrador</p>
				</div>
				
				{#if errorMessage}
					<div class="p-3 bg-red-50 border border-red-100 text-red-600 text-sm rounded-xl font-medium text-center">
						{errorMessage}
					</div>
				{/if}
				{#if infoMessage}
					<div class="p-3 bg-emerald-50 border border-emerald-100 text-emerald-700 text-sm rounded-xl font-medium text-center">
						{infoMessage}
					</div>
				{/if}

				<!-- Correo -->
				<div>
					<label for="setup-email" class="block text-sm font-semibold text-[#0f3b5e] mb-1">Correo Electrónico</label>
					<div class="relative">
						<div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
							<i class="fas fa-envelope"></i>
						</div>
						<input 
							type="email" 
							bind:value={setupEmail}
							placeholder="ejemplo@construni.com"
							class="w-full pl-10 pr-3 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:bg-white outline-none transition-all text-sm"
							required
							disabled={otpSent}
						/>
					</div>
				</div>

				{#if otpSent}
					<div>
						<label for="otp-token" class="block text-sm font-semibold text-[#0f3b5e] mb-1">Código OTP</label>
						<div class="relative">
							<div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
								<i class="fas fa-key"></i>
							</div>
							<input 
								type="text" 
								bind:value={otpToken}
								placeholder="123456"
								class="w-full pl-10 pr-3 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:bg-white outline-none transition-all text-sm"
								required
							/>
						</div>
					</div>

					<div>
						<label for="setup-password" class="block text-sm font-semibold text-[#0f3b5e] mb-1">Nueva Contraseña</label>
						<div class="relative">
							<div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
								<i class="fas fa-lock"></i>
							</div>
							<input 
								type={setupShowPassword ? "text" : "password"} 
								id="setup-password"
							bind:value={setupPassword}
								placeholder="Mínimo 6 caracteres"
								class="w-full pl-10 pr-10 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:bg-white outline-none transition-all text-sm"
								required
							/>
							<button 
								type="button" 
								onclick={() => setupShowPassword = !setupShowPassword} aria-label={setupShowPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
								class="absolute z-10 inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600 cursor-pointer"
							>
								<i class="fas {setupShowPassword ? 'fa-eye-slash' : 'fa-eye'}"></i>
							</button>
						</div>
					</div>

					<div>
						<label for="setup-confirm-password" class="block text-sm font-semibold text-[#0f3b5e] mb-1">Confirmar Contraseña</label>
						<div class="relative">
							<div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
								<i class="fas fa-lock"></i>
							</div>
							<input 
								type={setupShowPassword ? "text" : "password"} 
								id="setup-confirm-password"
							bind:value={setupConfirmPassword}
								placeholder="••••••••"
								class="w-full pl-10 pr-10 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:bg-white outline-none transition-all text-sm"
								required
							/>
							<button 
								type="button" 
								onclick={() => setupShowPassword = !setupShowPassword} aria-label={setupShowPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
								class="absolute z-10 inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600 cursor-pointer"
							>
								<i class="fas {setupShowPassword ? 'fa-eye-slash' : 'fa-eye'}"></i>
							</button>
						</div>
					</div>
				{/if}

				<!-- Botón -->
				<button 
					type="submit" 
					disabled={isLoading}
					class="w-full h-12 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 active:scale-[0.98] transition-all shadow-md shadow-blue-600/20 disabled:opacity-70 flex justify-center items-center gap-2"
				>
					{#if isLoading}
						<i class="fas fa-spinner fa-spin"></i> {otpSent ? 'Procesando...' : 'Enviando código...'}
					{:else}
						{otpSent ? 'Verificar código y guardar contraseña' : 'Enviar código OTP'}
					{/if}
				</button>

				<div class="text-center pt-2">
					<button type="button" onclick={() => { mode = 'login'; otpSent = false; otpToken = ''; infoMessage = ''; errorMessage = ''; }} class="text-slate-500 hover:text-slate-700 font-semibold text-sm">
						<i class="fas fa-arrow-left mr-1"></i> Volver al inicio de sesión
					</button>
				</div>
			</form>
		{:else}
			<form class="p-8 space-y-6" onsubmit={handleSetupPassword}>
				<div class="text-center mb-4">
					<h2 class="text-xl font-bold text-slate-800">Restablece tu contraseña</h2>
					<p class="text-sm text-slate-500 mt-1">Ingresa tu correo y nueva contraseña para recuperar el acceso</p>
				</div>
				
				{#if errorMessage}
					<div class="p-3 bg-red-50 border border-red-100 text-red-600 text-sm rounded-xl font-medium text-center">
						{errorMessage}
					</div>
				{/if}
				{#if infoMessage}
					<div class="p-3 bg-emerald-50 border border-emerald-100 text-emerald-700 text-sm rounded-xl font-medium text-center">
						{infoMessage}
					</div>
				{/if}

				<!-- Correo -->
				<div>
					<label for="setup-email" class="block text-sm font-semibold text-[#0f3b5e] mb-1">Correo Electrónico</label>
					<div class="relative">
						<div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
							<i class="fas fa-envelope"></i>
						</div>
						<input 
							type="email" 
							bind:value={setupEmail}
							placeholder="ejemplo@construni.com"
							class="w-full pl-10 pr-3 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:bg-white outline-none transition-all text-sm"
							required
							disabled={otpSent}
						/>
					</div>
				</div>

				{#if otpSent}
					<div>
						<label for="otp-token" class="block text-sm font-semibold text-[#0f3b5e] mb-1">Código OTP</label>
						<div class="relative">
							<div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
								<i class="fas fa-key"></i>
							</div>
							<input 
								type="text" 
								bind:value={otpToken}
								placeholder="123456"
								class="w-full pl-10 pr-3 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:bg-white outline-none transition-all text-sm"
								required
							/>
						</div>
					</div>

					<div>
						<label for="setup-password" class="block text-sm font-semibold text-[#0f3b5e] mb-1">Nueva Contraseña</label>
						<div class="relative">
							<div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
								<i class="fas fa-lock"></i>
							</div>
							<input 
								type={setupShowPassword ? "text" : "password"} 
								id="setup-password"
							bind:value={setupPassword}
								placeholder="Mínimo 6 caracteres"
								class="w-full pl-10 pr-10 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:bg-white outline-none transition-all text-sm"
								required
							/>
							<button 
								type="button" 
								onclick={() => setupShowPassword = !setupShowPassword} aria-label={setupShowPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
								class="absolute z-10 inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600 cursor-pointer"
							>
								<i class="fas {setupShowPassword ? 'fa-eye-slash' : 'fa-eye'}"></i>
							</button>
						</div>
					</div>

					<div>
						<label for="setup-confirm-password" class="block text-sm font-semibold text-[#0f3b5e] mb-1">Confirmar Contraseña</label>
						<div class="relative">
							<div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
								<i class="fas fa-lock"></i>
							</div>
							<input 
								type={setupShowPassword ? "text" : "password"} 
								id="setup-confirm-password"
							bind:value={setupConfirmPassword}
								placeholder="••••••••"
								class="w-full pl-10 pr-10 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:bg-white outline-none transition-all text-sm"
								required
							/>
							<button 
								type="button" 
								onclick={() => setupShowPassword = !setupShowPassword} aria-label={setupShowPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
								class="absolute z-10 inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600 cursor-pointer"
							>
								<i class="fas {setupShowPassword ? 'fa-eye-slash' : 'fa-eye'}"></i>
							</button>
						</div>
					</div>
				{/if}

				<!-- Botón -->
				<button 
					type="submit" 
					disabled={isLoading}
					class="w-full h-12 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 active:scale-[0.98] transition-all shadow-md shadow-blue-600/20 disabled:opacity-70 flex justify-center items-center gap-2"
				>
					{#if isLoading}
						<i class="fas fa-spinner fa-spin"></i> {otpSent ? 'Procesando...' : 'Enviando código...'}
					{:else}
						{otpSent ? 'Verificar código y guardar contraseña' : 'Enviar código OTP'}
					{/if}
				</button>

				<div class="text-center pt-2">
					<button type="button" onclick={() => { mode = 'login'; otpSent = false; otpToken = ''; infoMessage = ''; errorMessage = ''; }} class="text-slate-500 hover:text-slate-700 font-semibold text-sm">
						<i class="fas fa-arrow-left mr-1"></i> Volver al inicio de sesión
					</button>
				</div>
			</form>
		{/if}
	</div>
</div>
{/if}
