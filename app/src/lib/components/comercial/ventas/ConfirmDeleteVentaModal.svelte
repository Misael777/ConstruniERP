<script lang="ts">
	// Segundo factor antes de borrar una venta: eliminar una venta borra su proyecto EN CASCADA
	// (presupuesto, cronograma, documentos, adelantos, etc. — ver performDelete en
	// comercial/ventas/+page.svelte), así que ya no basta un confirm() del navegador. Pide correo +
	// contraseña de un ADMINISTRADOR (no necesariamente el usuario actual, que puede ser un asesor
	// sin ese rol) y los verifica vía la Edge Function (ver verifyAdminPassword en
	// edgeFunctionClient.ts) antes de dejar avanzar al borrado real.
	import { verifyAdminPassword } from '$lib/edgeFunctionClient';

	let {
		open = false,
		ventaNombre = '',
		onCancel = () => {},
		onConfirmed = () => {}
	}: {
		open?: boolean;
		ventaNombre?: string;
		onCancel?: () => void;
		onConfirmed?: () => void;
	} = $props();

	let email = $state('');
	let password = $state('');
	let loading = $state(false);
	let error = $state('');

	$effect(() => {
		if (!open) {
			email = '';
			password = '';
			error = '';
			loading = false;
		}
	});

	async function handleSubmit(e: Event) {
		e.preventDefault();
		if (!email.trim() || !password) {
			error = 'Correo y contraseña son obligatorios.';
			return;
		}
		loading = true;
		error = '';
		try {
			await verifyAdminPassword(email.trim(), password);
			onConfirmed();
		} catch (err: any) {
			error = err?.message ?? 'No se pudo verificar la contraseña.';
		} finally {
			loading = false;
		}
	}
</script>

{#if open}
	<div class="fixed inset-0 bg-slate-900/50 backdrop-blur-xs z-50 flex items-center justify-center p-4">
		<div class="bg-white rounded-2xl shadow-2xl border border-slate-100 max-w-md w-full overflow-hidden">
			<div class="bg-red-50 border-b border-red-100 px-6 py-4 flex items-center gap-3">
				<div class="w-10 h-10 rounded-full bg-red-100 text-red-600 flex items-center justify-center shrink-0">
					<i class="fas fa-exclamation-triangle"></i>
				</div>
				<div>
					<h3 class="font-bold text-slate-800">Eliminar venta</h3>
					<p class="text-xs text-slate-500">Esta acción no se puede deshacer</p>
				</div>
			</div>

			<form onsubmit={handleSubmit} class="p-6 flex flex-col gap-4">
				<div class="p-3 bg-red-50 border border-red-100 rounded-xl text-sm text-red-700">
					Vas a eliminar <strong>"{ventaNombre}"</strong> y, en cascada, <strong>todo su proyecto asociado</strong>
					(presupuesto, cronograma, documentos, adelantos, etc.). Esto es permanente.
				</div>

				<p class="text-sm text-slate-600">Para continuar, ingresa el correo y la contraseña de un <strong>administrador</strong>:</p>

				<div>
					<label for="confirmDeleteEmail" class="block text-xs font-semibold text-slate-600 mb-1">Correo del administrador</label>
					<input
						id="confirmDeleteEmail"
						type="email"
						bind:value={email}
						autocomplete="off"
						required
						class="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-red-400"
					/>
				</div>
				<div>
					<label for="confirmDeletePassword" class="block text-xs font-semibold text-slate-600 mb-1">Contraseña</label>
					<input
						id="confirmDeletePassword"
						type="password"
						bind:value={password}
						autocomplete="off"
						required
						class="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-red-400"
					/>
				</div>

				{#if error}
					<div class="p-2.5 bg-red-50 border border-red-100 rounded-lg text-xs text-red-600 font-medium text-center">{error}</div>
				{/if}

				<div class="flex gap-2 mt-2">
					<button
						type="button"
						onclick={onCancel}
						disabled={loading}
						class="flex-1 px-4 py-2.5 rounded-xl border border-slate-200 text-slate-600 font-medium text-sm hover:bg-slate-50 disabled:opacity-50"
					>
						Cancelar
					</button>
					<button
						type="submit"
						disabled={loading}
						class="flex-1 px-4 py-2.5 rounded-xl bg-red-600 text-white font-medium text-sm hover:bg-red-700 disabled:opacity-60 flex items-center justify-center gap-2"
					>
						{#if loading}<i class="fas fa-spinner fa-spin"></i>{/if} Eliminar definitivamente
					</button>
				</div>
			</form>
		</div>
	</div>
{/if}
