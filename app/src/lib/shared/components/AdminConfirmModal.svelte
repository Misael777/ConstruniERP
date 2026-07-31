<script lang="ts">
	// Modal genérico de confirmación con credenciales de administrador para acciones destructivas
	// (ej. borrado masivo de transacciones) — pide correo/contraseña, el padre decide qué hacer con
	// ellos vía onConfirm (normalmente: verificar con verifyAdminCredentials y luego ejecutar la acción).
	import { X, ShieldAlert, Loader2, Eye, EyeOff } from '@lucide/svelte';

	let {
		open = false,
		title = 'Confirmar acción',
		message = '',
		confirmLabel = 'Eliminar',
		onConfirm = async (_email: string, _password: string) => {},
		onClose = () => {}
	}: {
		open?: boolean;
		title?: string;
		message?: string;
		confirmLabel?: string;
		onConfirm?: (email: string, password: string) => Promise<void>;
		onClose?: () => void;
	} = $props();

	const STORAGE_KEY = 'construni_admin_confirm_email';

	let email = $state('');
	let password = $state('');
	let rememberEmail = $state(false);
	let showPassword = $state(false);
	let submitting = $state(false);
	let error = $state('');

	function getSavedEmail(): string | null {
		if (typeof localStorage === 'undefined') return null;
		try {
			return localStorage.getItem(STORAGE_KEY);
		} catch {
			return null;
		}
	}

	function persistEmail() {
		if (typeof localStorage === 'undefined') return;
		try {
			if (rememberEmail && email) localStorage.setItem(STORAGE_KEY, email);
			else localStorage.removeItem(STORAGE_KEY);
		} catch {
			// almacenamiento restringido (ej. modo privado), se ignora.
		}
	}

	$effect(() => {
		if (open) {
			const saved = getSavedEmail();
			email = saved ?? '';
			rememberEmail = Boolean(saved);
			password = '';
			error = '';
		}
	});

	async function handleSubmit(e: Event) {
		e.preventDefault();
		if (submitting) return;
		error = '';
		submitting = true;
		try {
			await onConfirm(email, password);
			persistEmail();
		} catch (err: any) {
			error = err?.message ?? 'Ocurrió un error inesperado.';
		} finally {
			submitting = false;
		}
	}

	function handleClose() {
		if (submitting) return;
		password = '';
		error = '';
		onClose();
	}
</script>

{#if open}
	<div class="fixed inset-0 bg-black/50 backdrop-blur-sm z-[110] flex items-center justify-center p-4">
		<div class="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
			<div class="flex items-center justify-between px-6 py-4 border-b border-slate-200">
				<div class="flex items-center gap-2">
					<ShieldAlert size={20} class="text-red-600" />
					<h2 class="text-lg font-semibold text-slate-800">{title}</h2>
				</div>
				<button
					type="button"
					onclick={handleClose}
					disabled={submitting}
					class="text-slate-400 hover:text-slate-600 w-8 h-8 flex items-center justify-center hover:bg-slate-100 rounded-lg disabled:opacity-50"
					aria-label="Cerrar"
				>
					<X size={18} />
				</button>
			</div>

			<form class="p-6 space-y-4" onsubmit={handleSubmit}>
				{#if message}
					<p class="text-sm text-slate-600">{message}</p>
				{/if}

				{#if error}
					<div class="p-3 bg-red-50 border border-red-100 text-red-600 text-sm rounded-xl font-medium">{error}</div>
				{/if}

				<div>
					<label for="admin-confirm-email" class="block text-sm font-semibold text-[#0f3b5e] mb-1">Correo del administrador</label>
					<input
						id="admin-confirm-email"
						type="email"
						bind:value={email}
						placeholder="admin@construni.com"
						class="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:bg-white outline-none text-sm"
						required
						autocomplete="username"
					/>
				</div>

				<div>
					<label for="admin-confirm-password" class="block text-sm font-semibold text-[#0f3b5e] mb-1">Contraseña</label>
					<div class="relative">
						<input
							id="admin-confirm-password"
							type={showPassword ? 'text' : 'password'}
							bind:value={password}
							placeholder="••••••••"
							class="w-full px-3 py-2 pr-10 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:bg-white outline-none text-sm"
							required
							autocomplete="current-password"
						/>
						<button
							type="button"
							onclick={() => (showPassword = !showPassword)}
							class="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600"
							aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
						>
							{#if showPassword}<EyeOff size={16} />{:else}<Eye size={16} />{/if}
						</button>
					</div>
				</div>

				<label class="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
					<input type="checkbox" bind:checked={rememberEmail} class="rounded text-blue-600 focus:ring-blue-500 border-slate-300 w-4 h-4" />
					No volver a pedir este correo
				</label>

				<div class="flex justify-end gap-2 pt-2">
					<button
						type="button"
						onclick={handleClose}
						disabled={submitting}
						class="px-4 py-2 rounded-lg border border-slate-300 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
					>
						Cancelar
					</button>
					<button
						type="submit"
						disabled={submitting}
						class="flex items-center gap-2 px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700 disabled:opacity-60"
					>
						{#if submitting}<Loader2 size={16} class="animate-spin" />{/if}
						{confirmLabel}
					</button>
				</div>
			</form>
		</div>
	</div>
{/if}
