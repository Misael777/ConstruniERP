<script lang="ts">
	/**
	 * Herramientas de entorno (a pedido del usuario, 22/10/2026):
	 *  - Para TODOS: la base a la que está conectada la app ("BASE DEV" en ámbar bien visible, "BASE PRD" discreta), para que
	 *    nadie confunda datos de prueba con datos reales.
	 *  - Solo rol developer (esDeveloper): cambiar entre PRD y DEV (cambiarEntorno, supabaseClient.ts) y, estando en
	 *    DEV, "Vaciar base de desarrollo" (RPC dev_vaciar_base, que solo existe en Dev — supabase/dev-only/ — y vuelve
	 *    a verificar el rol y la confirmación en la base).
	 */
	import { supabase, ENTORNO, CAMBIO_ENTORNO_POSIBLE, cambiarEntorno } from '$lib/supabaseClient';
	import { esDeveloper } from '$lib/stores/permisos.svelte';
	import { toast } from '$lib/stores/toast';

	let menuAbierto = $state(false);
	let vaciarAbierto = $state(false);
	let confirmacion = $state('');
	let vaciando = $state(false);
	const enDev = ENTORNO === 'dev';

	function cambiar() {
		const destino = enDev ? 'prd' : 'dev';
		const texto = destino === 'dev'
			? '¿Cambiar a la base de DESARROLLO? Se cerrará la sesión y tendrás que entrar con tu usuario de Dev.'
			: '¿Volver a la base de PRODUCCIÓN? Se cerrará la sesión y tendrás que entrar con tu usuario de Producción.';
		if (!window.confirm(texto)) return;
		supabase.auth.signOut().finally(() => cambiarEntorno(destino));
	}

	async function vaciar() {
		if (confirmacion !== 'VACIAR DEV' || vaciando) return;
		vaciando = true;
		try {
			const { data, error } = await supabase.rpc('dev_vaciar_base', { p_confirmacion: confirmacion });
			if (error) throw error;
			toast.success(`Base de desarrollo vaciada (${(data as any)?.tablas_vaciadas ?? 0} tablas). Se conservaron usuarios, roles y permisos.`);
			vaciarAbierto = false;
			setTimeout(() => window.location.reload(), 1200);
		} catch (err: any) {
			toast.error(`No se pudo vaciar: ${err?.message ?? err}`);
		} finally {
			vaciando = false;
		}
	}
</script>

{#if enDev}
	<span class="px-2 py-1 rounded-md bg-amber-400 text-[#1a233a] text-[11px] font-black tracking-wide" title="Estás conectado a la base de DESARROLLO (datos de prueba)">BASE DEV</span>
{:else}
	<!-- A pedido del usuario (03/11/2026): que siempre se vea con qué base se trabaja, también en Producción. -->
	<span class="px-2 py-1 rounded-md bg-emerald-50 border border-emerald-200 text-emerald-700 text-[11px] font-bold tracking-wide" title="Estás conectado a la base de PRODUCCIÓN (datos reales)">BASE PRD</span>
{/if}

{#if esDeveloper() && (CAMBIO_ENTORNO_POSIBLE || enDev)}
	<div class="relative">
		<button type="button" onclick={() => (menuAbierto = !menuAbierto)} class="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-slate-50" title="Herramientas de desarrollo">
			<i class="fas fa-database"></i>
			<span class="hidden sm:inline">{enDev ? 'DEV' : 'PRD'}</span>
			<i class="fas fa-chevron-down text-[9px]"></i>
		</button>
		{#if menuAbierto}
			<div class="absolute right-0 mt-2 w-72 rounded-xl border border-slate-200 bg-white shadow-xl z-50 p-2 text-sm">
				<p class="px-2 pt-1 pb-2 text-[11px] text-slate-500">Conectado a <b>{enDev ? 'DESARROLLO' : 'PRODUCCIÓN'}</b>. Solo el rol developer ve este menú.</p>
				{#if CAMBIO_ENTORNO_POSIBLE}
					<button type="button" onclick={cambiar} class="w-full text-left px-2 py-2 rounded-lg hover:bg-slate-50 flex items-center gap-2">
						<i class="fas fa-right-left text-blue-600"></i> {enDev ? 'Volver a Producción' : 'Cambiar a Desarrollo'}
					</button>
				{/if}
				{#if enDev}
					<button type="button" onclick={() => { menuAbierto = false; confirmacion = ''; vaciarAbierto = true; }} class="w-full text-left px-2 py-2 rounded-lg hover:bg-rose-50 text-rose-600 flex items-center gap-2">
						<i class="fas fa-trash-can"></i> Vaciar base de desarrollo
					</button>
				{/if}
			</div>
		{/if}
	</div>
{/if}

{#if vaciarAbierto}
	<div class="fixed inset-0 z-[150] flex items-center justify-center bg-slate-900/60 p-4" role="dialog" aria-modal="true" aria-label="Vaciar base de desarrollo">
		<div class="w-full max-w-md rounded-2xl bg-white shadow-2xl p-5 space-y-3">
			<h2 class="text-lg font-bold text-rose-600"><i class="fas fa-triangle-exclamation mr-1"></i> Vaciar base de desarrollo</h2>
			<p class="text-sm text-slate-600">Se borran <b>todos los datos de la base DEV</b>: ventas, clientes, proyectos, cuentas, transacciones, tickets, auditoría… Se conservan los usuarios, empleados, roles, permisos y catálogos básicos para que puedas seguir entrando.</p>
			<p class="text-sm text-slate-600">No afecta a Producción (esta función solo existe en la base de desarrollo). Para cargar datos de ejemplo después: <code class="text-xs bg-slate-100 px-1 rounded">npm run seed:dev</code>.</p>
			<label class="block text-xs font-semibold text-slate-600">Escribe <b>VACIAR DEV</b> para confirmar
				<input type="text" bind:value={confirmacion} class="mt-1 w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" autocomplete="off" />
			</label>
			<div class="flex justify-end gap-2 pt-1">
				<button type="button" onclick={() => (vaciarAbierto = false)} class="px-4 py-2 rounded-lg border border-slate-200 text-sm">Cancelar</button>
				<button type="button" onclick={vaciar} disabled={confirmacion !== 'VACIAR DEV' || vaciando} class="px-4 py-2 rounded-lg bg-rose-600 text-white text-sm font-semibold disabled:opacity-40">
					{vaciando ? 'Vaciando…' : 'Vaciar'}
				</button>
			</div>
		</div>
	</div>
{/if}
