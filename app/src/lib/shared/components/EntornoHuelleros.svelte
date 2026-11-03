<script lang="ts">
	/**
	 * Botón "Huelleros PRD/DEV" de la barra superior, junto al cambio de base (a pedido del usuario, 03/11/2026).
	 * Solo rol developer. Elige a qué base envía sus datos cada huellero: Producción (normal) o Desarrollo (para
	 * probar con un equipo real sin tocar datos reales). Lo decide Producción (asistencia_dispositivo.destino,
	 * migración 20261103120000): el receptor de Cloudflare lo consulta y reenvía a Dev con sus variables DEV_*.
	 * Por eso solo se cambia estando conectado a Producción; en Dev se explica cómo hacerlo.
	 */
	import { supabase, ENTORNO } from '$lib/supabaseClient';
	import { esDeveloper } from '$lib/stores/permisos.svelte';
	import { toast } from '$lib/stores/toast';
	import { describeError } from '$lib/shared/describeError';
	import ConfirmModal from '$lib/shared/components/ConfirmModal.svelte';
	import { getHuelleros, cambiarDestinoHuellero, estaEnLinea, type Huellero } from '$lib/modules/asistencia/services/huelleros.service';

	const enPrd = ENTORNO === 'prd';
	let abierto = $state(false);
	let cargando = $state(false);
	let huelleros = $state<Huellero[]>([]);
	let porCambiar = $state<{ h: Huellero; destino: Huellero['destino'] } | null>(null);
	let contenedor: HTMLDivElement | undefined = $state();

	const enDev = $derived(huelleros.filter((h) => h.destino === 'desarrollo').length);

	async function cargar() {
		if (!enPrd) return;
		cargando = true;
		try {
			huelleros = await getHuelleros(supabase);
		} catch (err) {
			toast.error(`No se pudieron cargar los huelleros. ${describeError(err)}`);
		} finally {
			cargando = false;
		}
	}

	function alternar() {
		abierto = !abierto;
		if (abierto) cargar();
	}

	function cerrarSiAfuera(e: MouseEvent) {
		if (abierto && contenedor && !contenedor.contains(e.target as Node)) abierto = false;
	}

	async function confirmarCambio() {
		if (!porCambiar) return;
		const { h, destino } = porCambiar;
		try {
			await cambiarDestinoHuellero(supabase, h.id_dispositivo, destino);
			toast.success(`${h.nombre ?? h.numero_serie} enviará sus datos a ${destino === 'desarrollo' ? 'DESARROLLO' : 'PRODUCCIÓN'} en menos de un minuto.`);
			await cargar();
		} catch (err) {
			toast.error(`No se pudo cambiar. ${describeError(err)}`);
		} finally {
			porCambiar = null;
		}
	}

	// Al entrar en Producción se carga una vez para que el botón avise si algún huellero está enviando a Dev.
	$effect(() => {
		if (enPrd && esDeveloper()) cargar();
	});
</script>

<svelte:window onclick={cerrarSiAfuera} />

{#if esDeveloper()}
	<div class="relative" bind:this={contenedor}>
		<button
			type="button"
			onclick={alternar}
			title="A qué base envían sus datos los huelleros (solo developer)"
			class={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-semibold ${enDev ? 'border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}
		>
			<i class="fas fa-fingerprint"></i>
			<span class="hidden sm:inline">{enDev ? `${enDev} en DEV` : 'Huelleros'}</span>
			<i class="fas fa-chevron-down text-[9px]"></i>
		</button>
		{#if abierto}
			<div class="absolute right-0 mt-2 w-[22rem] max-w-[calc(100vw-2rem)] rounded-xl border border-slate-200 bg-white shadow-xl z-50 p-2 text-sm">
				<p class="px-2 pt-1 pb-2 text-[11px] text-slate-500">A qué base envía sus datos cada huellero. Solo el rol developer ve este menú.</p>
				{#if !enPrd}
					<p class="mx-2 mb-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
						Esto lo decide <b>Producción</b>. Para mandar un huellero a esta base de desarrollo, vuelve a Producción
						(botón de base <b>DEV → Volver a Producción</b>), elige aquí <b>DEV</b> en ese huellero y regresa a Desarrollo.
					</p>
				{:else if cargando && !huelleros.length}
					<p class="px-2 py-3 text-xs text-slate-400"><i class="fas fa-spinner fa-spin"></i> Cargando huelleros…</p>
				{:else if !huelleros.length}
					<p class="px-2 py-3 text-xs text-slate-400">No hay huelleros conectados a Producción.</p>
				{:else}
					<div class="flex flex-col divide-y divide-slate-100">
						{#each huelleros as h (h.id_dispositivo)}
							{@const enLinea = estaEnLinea(h)}
							<div class="flex items-center gap-3 px-2 py-2">
								<span class={`w-2 h-2 rounded-full shrink-0 ${enLinea ? 'bg-emerald-500' : 'bg-slate-300'}`} title={enLinea ? 'En línea con Producción' : 'Sin conexión con Producción'}></span>
								<div class="min-w-0 flex-1">
									<div class="text-xs font-semibold text-slate-700 truncate">{h.nombre ?? 'Huellero nuevo'}</div>
									<div class="text-[10px] font-mono text-slate-400 truncate">ID {h.numero_serie}</div>
								</div>
								<div class="flex rounded-lg border border-slate-200 p-0.5 text-[11px] font-bold shrink-0" role="group" aria-label={`Base de ${h.nombre ?? h.numero_serie}`}>
									<button type="button" onclick={() => h.destino !== 'produccion' && (porCambiar = { h, destino: 'produccion' })} class={`px-2 py-1 rounded-md ${h.destino === 'produccion' ? 'bg-blue-600 text-white' : 'text-slate-500 hover:bg-slate-50'}`}>PRD</button>
									<button type="button" onclick={() => h.destino !== 'desarrollo' && (porCambiar = { h, destino: 'desarrollo' })} class={`px-2 py-1 rounded-md ${h.destino === 'desarrollo' ? 'bg-amber-400 text-[#1a233a]' : 'text-slate-500 hover:bg-slate-50'}`}>DEV</button>
								</div>
							</div>
						{/each}
					</div>
					<p class="px-2 pt-2 text-[10px] text-slate-400">En DEV el huellero aparece "fuera de línea" aquí: sus marcas y latidos van a la base de desarrollo.</p>
				{/if}
			</div>
		{/if}
	</div>
{/if}

<ConfirmModal
	open={!!porCambiar}
	title={porCambiar?.destino === 'desarrollo' ? 'Enviar huellero a DESARROLLO' : 'Volver huellero a PRODUCCIÓN'}
	message={porCambiar?.destino === 'desarrollo'
		? `${porCambiar?.h.nombre ?? porCambiar?.h.numero_serie} enviará sus marcas y recibirá órdenes de la base de DESARROLLO. Las marcas que se hagan mientras tanto NO llegarán a Producción (no se pagan ni salen en Asistencia real). ¿Continuar?`
		: `${porCambiar?.h.nombre ?? porCambiar?.h.numero_serie} volverá a enviar sus marcas a PRODUCCIÓN. Las marcas hechas mientras estuvo en Desarrollo se quedan en Desarrollo.`}
	confirmLabel={porCambiar?.destino === 'desarrollo' ? 'Enviar a DEV' : 'Volver a PRD'}
	danger={porCambiar?.destino === 'desarrollo'}
	onConfirm={confirmarCambio}
	onClose={() => (porCambiar = null)}
/>
