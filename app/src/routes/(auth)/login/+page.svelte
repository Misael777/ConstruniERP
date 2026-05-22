<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { supabase } from '$lib/supabaseClient';
	
	let email = $state('');
	let password = $state('');
	let rememberEmail = $state(false);
	let showPassword = $state(false);
	
	let isLoading = $state(false);
	let errorMessage = $state('');
	
	let passwordInputRef: HTMLInputElement;

	onMount(() => {
		// Recuperar email de localStorage si existe
		const savedEmail = localStorage.getItem('construni_saved_email');
		if (savedEmail) {
			email = savedEmail;
			rememberEmail = true;
			// Enfocar contraseña automáticamente
			setTimeout(() => {
				passwordInputRef?.focus();
			}, 100);
		}
	});

	async function handleLogin(e: Event) {
		e.preventDefault();
		isLoading = true;
		errorMessage = '';
		
		try {
			const { data, error } = await supabase.auth.signInWithPassword({
				email,
				password
			});
			
			if (error) {
				throw error;
			}
			
			// Guardar o eliminar de localStorage
			if (rememberEmail) {
				localStorage.setItem('construni_saved_email', email);
			} else {
				localStorage.removeItem('construni_saved_email');
			}
			
			// Redirigir al sistema
			goto('/dashboard');
			
		} catch (err: any) {
			errorMessage = err.message || 'Error al iniciar sesión. Revisa tus credenciales.';
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

			<!-- Correo -->
			<div>
				<label class="block text-sm font-semibold text-slate-700 mb-1">Correo Electrónico</label>
				<div class="relative">
					<div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
						<i class="fas fa-envelope"></i>
					</div>
					<input 
						type="email" 
						bind:value={email}
						placeholder="ejemplo@construni.com"
						class="w-full pl-10 pr-3 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:bg-white outline-none transition-all text-sm"
						required
					/>
				</div>
			</div>
			
			<!-- Contraseña -->
			<div>
				<label class="block text-sm font-semibold text-slate-700 mb-1">Contraseña</label>
				<div class="relative">
					<div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
						<i class="fas fa-lock"></i>
					</div>
					<input 
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
						class="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600"
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
				<a href="#" class="text-brand-orange hover:text-orange-600 font-semibold">¿Olvidaste tu contraseña?</a>
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
		</form>
	</div>
</div>
