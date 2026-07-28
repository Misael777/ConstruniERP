<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { supabase } from '$lib/supabaseClient';
	import { fetchApi, parseJsonResponse } from '$lib/apiClient';
	import { isRunningInTauri } from '$lib/driveUploadClient';
	import { confirmActivation } from '$lib/edgeFunctionClient';
	
	let mode = $state<'login' | 'setup_password' | 'forgot_password' | 'first_admin'>('login');
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
	function isTauriApp() {
		return isRunningInTauri();
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
		try {
			if (isTauriApp()) {
				// @ts-ignore: module may only exist in desktop runtime
				const core = await import('@tauri-apps/api/core');
				const canCreate = await core.invoke('check_first_admin_available');
				console.log('[Login] Tauri first-admin availability result:', canCreate);
				allowFirstAdmin = Boolean(canCreate);
				return;
			}

			const response = await fetchApi('/api/first-admin');
			const result = await parseJsonResponse(response);
			console.log('[Login] /api/first-admin response status:', response.status, 'result:', result);
			allowFirstAdmin = response.ok && result.canCreate === true;
			console.log('[Login] allowFirstAdmin set to', allowFirstAdmin);
			if (!response.ok) {
				console.warn('[Login] first-admin availability failed:', result);
			}
		} catch (err) {
			console.warn('[Login] first-admin availability error, trying fallback:', err);
			try {
				const { count, error } = await supabase
					.from('empleados')
					.select('id', { head: true, count: 'exact' });
				if (error) {
					console.error('[Login] client-side empleados count failed:', error);
					allowFirstAdmin = false;
				} else {
					console.log('[Login] client-side empleados count:', count);
					allowFirstAdmin = !count || count === 0;
				}
			} catch (fallbackError) {
				console.error('[Login] Error during fallback empleados count:', fallbackError);
				allowFirstAdmin = false;
			}
		} finally {
			checkingFirstAdmin = false;
		}
	}

	onMount(async () => {
		console.log('[Login] onMount started');

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
	});

	async function handleLogin(e: Event) {
		e.preventDefault();
		isLoading = true;
		errorMessage = '';
		console.log('[Login] Attempting sign in with email:', email);
		
		try {
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
				.select('id')
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
			
			// Guardar o eliminar de localStorage
			if (rememberEmail) {
				console.log('[Login] Remembering email in localStorage');
				saveEmailToStorage(email);
			} else {
				console.log('[Login] Removing email from localStorage');
				removeSavedEmailFromStorage();
			}
			
			// Redirigir al sistema
			console.log('[Login] Redirecting to /dashboard...');
			goto('/dashboard');
			
		} catch (err: any) {
			console.error('[Login] Login process exception:', err);
			errorMessage = friendlyAuthError(err);
		} finally {
			isLoading = false;
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
		}
	}

async function verifyOtpAndSetPassword(e: Event) {
		e.preventDefault();
		isLoading = true;
		errorMessage = '';
		infoMessage = '';
		console.log('[SetupPassword] Verificando OTP para:', setupEmail);

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

			goto('/dashboard');
		} catch (err: any) {
			console.error('[SetupPassword] Exception caught while verifying OTP:', err);
			errorMessage = friendlyAuthError(err);
		} finally {
			isLoading = false;
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
		try {
			if (isTauriApp()) {
				// @ts-ignore: module may only exist in desktop runtime
				const core = await import('@tauri-apps/api/core');
				const response = await core.invoke('create_first_admin', {
					nombre: firstAdminName,
					email: firstAdminEmail,
					password: firstAdminPassword
				});

				console.log('[Login] Tauri create_first_admin response:', response);
				if (!response || !response.success) {
					firstAdminError = response?.message || 'No se pudo crear el administrador.';
					return;
				}
			} else {
				const response = await fetchApi('/api/first-admin', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						nombre: firstAdminName,
						email: firstAdminEmail,
						password: firstAdminPassword
					})
				});

				let result: any = null;
				try {
					result = await parseJsonResponse(response);
				} catch (parseError) {
					console.error('[Login] Failed to parse first-admin response:', parseError);
					firstAdminError = `Error al crear administrador: ${parseError instanceof Error ? parseError.message : 'Respuesta inválida del servidor'}`;
					return;
				}

				if (!response.ok || !result?.success) {
					const serverMessage = result?.error || result?.message || `HTTP ${response.status}`;
					console.error('[Login] first-admin creation failed:', {
						status: response.status,
						statusText: response.statusText,
						result
					});
					firstAdminError = `Error al crear administrador: ${serverMessage}`;
					return;
				}
			}

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
		}
	}

	function togglePassword() {
		showPassword = !showPassword;
	}
</script>

<svelte:head>
	<title>Iniciar Sesión | Construni ERP</title>
</svelte:head>

<div class="min-h-screen bg-slate-50 flex flex-col justify-center items-center p-4">
	<div class="w-full max-w-md bg-white rounded-3xl shadow-xl overflow-hidden border border-slate-100">
		<!-- Branding Header -->
		<div class="bg-[#1a233a] p-8 text-center flex flex-col items-center">
			<div class="text-blue-500 text-4xl mb-2">
				<i class="fas fa-cubes"></i>
			</div>
			<div class="flex flex-col text-white">
				<h1 class="font-bold text-2xl leading-tight">CONSTRUNI</h1>
				<span class="text-xs font-bold text-brand-orange uppercase tracking-widest">ERP</span>
			</div>
		</div>
		
		<!-- Formulario -->
		{#if mode === 'login'}
			<form class="p-8 space-y-6" onsubmit={handleLogin}>
				<div class="text-center mb-4">
					<h2 class="text-xl font-bold text-slate-800">Bienvenido de nuevo</h2>
					<p class="text-sm text-slate-500 mt-1">Ingresa tus credenciales para continuar</p>
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
							class="w-full pl-10 pr-3 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:bg-white outline-none transition-all text-sm"
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
							class="w-full pl-10 pr-10 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:bg-white outline-none transition-all text-sm"
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
				
				<!-- Botón -->
				<button 
					type="submit" 
					disabled={isLoading}
					class="w-full h-12 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 active:scale-[0.98] transition-all shadow-md shadow-blue-600/20 disabled:opacity-70 flex justify-center items-center gap-2"
				>
					{#if isLoading}
						<i class="fas fa-spinner fa-spin"></i> Ingresando...
					{:else}
						Iniciar Sesión <i class="fas fa-arrow-right"></i>
					{/if}
				</button>

				<div class="text-center pt-2">
					<button type="button" onclick={() => { mode = 'setup_password'; errorMessage = ''; setupEmail = ''; setupPassword = ''; setupConfirmPassword = ''; }} class="text-blue-600 hover:text-blue-700 font-semibold text-sm">
						¿Es tu primera vez? Configura tu contraseña aquí
					</button>
				</div>

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
