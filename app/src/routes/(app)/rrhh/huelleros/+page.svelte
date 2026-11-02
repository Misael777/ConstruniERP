<script lang="ts">
	/**
	 * Huelleros ZKTeco de las obras. Un huellero nuevo aparece solo aquí ("Pendiente") la primera vez que se
	 * conecta al receptor ADMS; se le asigna nombre y obra o área (ej. Corporativo para el huellero de oficina) para que sus marcas cuenten ahí.
	 * Dar de baja / Ver eliminados / Eliminar permanente: skill dar-de-baja-pattern.
	 */
	import { onMount, onDestroy } from 'svelte';
	import { fade, scale } from 'svelte/transition';
	import { supabase } from '$lib/supabaseClient';
	import { puedeVerEliminados } from '$lib/stores/permisos.svelte';
	import { toast } from '$lib/stores/toast';
	import { describeError } from '$lib/shared/describeError';
	import { verifyAdminCredentials } from '$lib/shared/adminAuth';
	import ResponsiveDataView from '$lib/shared/components/ResponsiveDataView.svelte';
	import SelectConSaldo from '$lib/shared/components/SelectConSaldo.svelte';
	import ConfirmModal from '$lib/shared/components/ConfirmModal.svelte';
	import AdminConfirmModal from '$lib/shared/components/AdminConfirmModal.svelte';
	import {
		RECEPTOR_ADMS,
		estaEnLinea,
		getHuelleros,
		guardarHuellero,
		darDeBajaHuellero,
		restaurarHuellero,
		eliminarHuelleroPermanente,
		getObrasParaHuellero,
		sincronizarHuellero,
		type Huellero
	} from '$lib/modules/asistencia/services/huelleros.service';

	let huelleros = $state<Huellero[]>([]);
	let obras = $state<{ value: string; label: string; grupo: string }[]>([]);
	let isLoading = $state(true);
	let verEliminados = $state(false);
	let mostrarAyuda = $state(false);
	let ahora = $state(Date.now());

	async function fetchHuelleros(silencioso = false) {
		if (!silencioso) isLoading = true;
		try {
			huelleros = await getHuelleros(supabase, verEliminados);
			ahora = Date.now();
		} catch (err) {
			if (!silencioso) toast.error(`No se pudieron cargar los huelleros. ${describeError(err)}`);
		} finally {
			isLoading = false;
		}
	}

	function toggleVerEliminados() {
		verEliminados = !verEliminados;
		fetchHuelleros();
	}

	// El estado "En línea" depende de la última conexión: se refresca solo cada 30 s.
	let intervalo: ReturnType<typeof setInterval> | undefined;
	onMount(async () => {
		fetchHuelleros();
		intervalo = setInterval(() => fetchHuelleros(true), 30_000);
		try {
			obras = await getObrasParaHuellero(supabase);
		} catch (err) {
			toast.error(`No se pudieron cargar las obras. ${describeError(err)}`);
		}
	});
	onDestroy(() => clearInterval(intervalo));

	function haceCuanto(fecha: string | null): string {
		if (!fecha) return 'Nunca';
		const minutos = Math.floor((ahora - new Date(fecha).getTime()) / 60_000);
		if (minutos < 1) return 'Hace segundos';
		if (minutos < 60) return `Hace ${minutos} min`;
		return new Date(fecha).toLocaleString('es-PE', { timeZone: 'America/Lima', dateStyle: 'short', timeStyle: 'short' });
	}

	const nombreHuellero = (h: Huellero) => h.nombre || `Huellero ${h.numero_serie}`;
	const pendientes = $derived(huelleros.filter((h) => h.estado === 'pendiente').length);

	// ── Editar (nombre + obra) ──
	let editando = $state<Huellero | null>(null);
	let formNombre = $state('');
	let formObra = $state('');
	let guardando = $state(false);

	function abrirEditar(h: Huellero) {
		editando = h;
		formNombre = h.nombre ?? '';
		formObra = h.id_centro_costo ? String(h.id_centro_costo) : '';
	}

	function cerrarEditar() {
		if (guardando) return;
		editando = null;
	}

	async function guardar() {
		if (!editando) return;
		if (!formObra) {
			toast.error('Elige la obra o área donde está el huellero.');
			return;
		}
		guardando = true;
		try {
			await guardarHuellero(supabase, editando.id_dispositivo, { nombre: formNombre, id_centro_costo: Number(formObra) });
			toast.success('Huellero guardado. Sus marcas se registrarán en la obra o área elegida.');
			editando = null;
			await fetchHuelleros();
		} catch (err) {
			toast.error(`No se pudo guardar el huellero. ${describeError(err)}`);
		} finally {
			guardando = false;
		}
	}

	// ── Sincronizar: trae los usuarios del huellero y le reenvía los trabajadores vinculados a él ──
	let sincronizando = $state<number | null>(null);

	async function sincronizar(h: Huellero) {
		sincronizando = h.id_dispositivo;
		try {
			const enviados = await sincronizarHuellero(supabase, h.id_dispositivo);
			toast.success(
				`Sincronización en cola. Se reenvían ${enviados} trabajadores vinculados; ` +
					`${estaEnLinea(h, ahora) ? 'el huellero la recibirá en menos de un minuto.' : 'el huellero la recibirá cuando vuelva a estar en línea.'}`
			);
			await fetchHuelleros(true);
		} catch (err) {
			toast.error(`No se pudo sincronizar. ${describeError(err)}`);
		} finally {
			sincronizando = null;
		}
	}

	// ── Dar de baja / restaurar / eliminar permanente ──
	let paraDarDeBaja = $state<Huellero | null>(null);
	let paraRestaurar = $state<Huellero | null>(null);
	let paraEliminar = $state<Huellero | null>(null);

	async function confirmarDarDeBaja() {
		if (!paraDarDeBaja) return;
		try {
			await darDeBajaHuellero(supabase, paraDarDeBaja.id_dispositivo);
			toast.success(`"${nombreHuellero(paraDarDeBaja)}" dado de baja. Sus marcas nuevas ya no se guardarán.`);
			await fetchHuelleros();
		} catch (err) {
			toast.error(`No se pudo dar de baja el huellero. ${describeError(err)}`);
		} finally {
			paraDarDeBaja = null;
		}
	}

	async function confirmarRestaurar() {
		if (!paraRestaurar) return;
		try {
			await restaurarHuellero(supabase, paraRestaurar.id_dispositivo);
			toast.success(`"${nombreHuellero(paraRestaurar)}" restaurado.`);
			await fetchHuelleros();
		} catch (err) {
			toast.error(`No se pudo restaurar el huellero. ${describeError(err)}`);
		} finally {
			paraRestaurar = null;
		}
	}

	async function confirmarEliminar(email: string, password: string) {
		if (!paraEliminar) return;
		const verificacion = await verifyAdminCredentials(email, password);
		if (!verificacion.success) throw new Error(verificacion.message);
		await eliminarHuelleroPermanente(supabase, paraEliminar.id_dispositivo);
		toast.success(`"${nombreHuellero(paraEliminar)}" eliminado permanentemente.`);
		paraEliminar = null;
		await fetchHuelleros();
	}

	const columnas = [
		{ label: 'Huellero' },
		{ label: 'Obra o área' },
		{ label: 'Conexión' },
		{ label: 'Marcas hoy', align: 'center' as const },
		{ label: '', align: 'right' as const }
	];
</script>

<svelte:head>
	<title>Huelleros | Personal y Asistencia - Construni ERP</title>
</svelte:head>

{#snippet estadoConexion(h: Huellero)}
	{#if h.estado === 'baja'}
		<span class="text-xs text-slate-400">Dado de baja · {haceCuanto(h.ultima_conexion)}</span>
	{:else if estaEnLinea(h, ahora)}
		<span class="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700">
			<span class="w-2 h-2 rounded-full bg-emerald-500"></span> En línea
		</span>
	{:else}
		<span class="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500">
			<span class="w-2 h-2 rounded-full bg-slate-300"></span> Fuera de línea · {haceCuanto(h.ultima_conexion)}
		</span>
	{/if}
{/snippet}

{#snippet ordenes(h: Huellero)}
	{#if h.ordenes_pendientes}
		<div class="text-[11px] text-blue-600 mt-0.5"><i class="fas fa-paper-plane"></i> {h.ordenes_pendientes} {h.ordenes_pendientes === 1 ? 'orden' : 'órdenes'} por enviar</div>
	{/if}
	{#if h.ordenes_error}
		<div class="text-[11px] text-rose-600 mt-0.5"><i class="fas fa-triangle-exclamation"></i> {h.ordenes_error} rechazadas (7 días)</div>
	{/if}
{/snippet}

{#snippet obra(h: Huellero)}
	{#if h.centro_costo}
		<span class="text-slate-700">{h.centro_costo.codigo} · {h.centro_costo.nombre}</span>
	{:else}
		<span class="text-[11px] font-bold px-2 py-0.5 rounded-md bg-amber-50 text-amber-700 border border-amber-200">Pendiente: asignar obra o área</span>
	{/if}
{/snippet}

{#snippet acciones(h: Huellero)}
	<div class="flex items-center justify-end gap-1">
		{#if verEliminados}
			<button onclick={() => (paraRestaurar = h)} class="px-3 py-1.5 text-xs font-medium rounded-lg text-emerald-700 hover:bg-emerald-50">
				<i class="fas fa-rotate-left"></i> Restaurar
			</button>
			<button onclick={() => (paraEliminar = h)} class="px-3 py-1.5 text-xs font-medium rounded-lg text-rose-600 hover:bg-rose-50">
				<i class="fas fa-trash"></i> Eliminar
			</button>
		{:else}
			<button
				onclick={() => sincronizar(h)}
				disabled={sincronizando === h.id_dispositivo}
				title="Trae al ERP los usuarios registrados en el huellero y le reenvía los trabajadores vinculados a él"
				class="px-3 py-1.5 text-xs font-medium rounded-lg text-slate-600 hover:bg-slate-100 disabled:opacity-50"
			>
				<i class={`fas fa-rotate ${sincronizando === h.id_dispositivo ? 'fa-spin' : ''}`}></i> Sincronizar
			</button>
			<button onclick={() => abrirEditar(h)} class="px-3 py-1.5 text-xs font-medium rounded-lg text-blue-600 hover:bg-blue-50">
				<i class="fas fa-pen"></i> {h.estado === 'pendiente' ? 'Asignar lugar' : 'Editar'}
			</button>
			<button onclick={() => (paraDarDeBaja = h)} class="px-3 py-1.5 text-xs font-medium rounded-lg text-rose-600 hover:bg-rose-50">
				<i class="fas fa-ban"></i> Dar de baja
			</button>
		{/if}
	</div>
{/snippet}

<div class="flex flex-col md:h-[calc(100vh-80px)] md:overflow-hidden bg-slate-50/50">
	<div class="flex-shrink-0 px-4 sm:px-6 py-5 flex items-start sm:items-center justify-between gap-3 border-b border-slate-100 bg-white">
		<div class="flex flex-col min-w-0">
			<div class="flex flex-wrap items-center gap-2 mb-1">
				<span class="font-bold text-slate-800 text-2xl">{verEliminados ? 'Huelleros eliminados' : 'Huelleros'}</span>
				{#if verEliminados}
					<span class="text-[10px] font-bold px-2 py-0.5 rounded-md bg-rose-50 text-rose-600 border border-rose-200 uppercase tracking-wide">Solo administradores</span>
				{/if}
			</div>
			<p class="text-sm text-slate-500">
				{verEliminados
					? 'Huelleros dados de baja: restáuralos o elimínalos permanentemente junto con sus marcaciones.'
					: 'Huelleros de las obras conectados al ERP. Cada huellero nuevo aparece aquí solo al configurarlo.'}
			</p>
		</div>
		<div class="flex items-center gap-3 shrink-0">
			{#if puedeVerEliminados()}
				<button onclick={toggleVerEliminados} class={`px-3 sm:px-4 py-2 rounded-xl font-medium text-sm transition-colors shadow-sm flex items-center gap-2 whitespace-nowrap ${verEliminados ? 'bg-slate-800 text-white hover:bg-slate-900' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
					<i class={`fas ${verEliminados ? 'fa-arrow-left' : 'fa-trash-can'}`}></i>
					{verEliminados ? 'Volver' : 'Ver eliminados'}
				</button>
			{/if}
			{#if !verEliminados}
				<button onclick={() => (mostrarAyuda = !mostrarAyuda)} class="px-4 py-2 bg-blue-600 text-white rounded-xl hover:bg-blue-700 font-medium text-sm shadow-md shadow-blue-600/20 flex items-center gap-2 whitespace-nowrap">
					<i class="fas fa-plus"></i> <span class="hidden sm:inline">Agregar huellero</span>
				</button>
			{/if}
		</div>
	</div>

	<div class="flex-1 overflow-y-auto p-4 sm:p-6">
		<div class="max-w-[1200px] mx-auto flex flex-col gap-4">
			{#if mostrarAyuda && !verEliminados}
				<div class="bg-white border border-blue-100 rounded-2xl p-5 shadow-sm" transition:fade={{ duration: 150 }}>
					<h3 class="text-sm font-bold text-slate-800 mb-3 flex items-center gap-2"><i class="fas fa-fingerprint text-blue-600"></i> Cómo agregar un huellero (obra u oficina)</h3>
					<ol class="text-sm text-slate-600 space-y-2 list-decimal pl-5">
						<li>Conecta el huellero a internet (cable al router, WiFi o router 4G de la obra).</li>
						<li>En el huellero entra a <b>Red → Conf. Srvr. de Nube</b> y configura:
							<div class="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs bg-slate-50 rounded-xl p-3 border border-slate-100">
								<span class="text-slate-500">Modo de Servidor</span><b>ADMS</b>
								<span class="text-slate-500">Habilitar Nombre de Dominio</span><b>Activado</b>
								<span class="text-slate-500">Dirección del Servidor</span><b class="break-all select-all">{RECEPTOR_ADMS.direccion}</b>
								<span class="text-slate-500">Puerto</span><b>{RECEPTOR_ADMS.puerto}</b>
								<span class="text-slate-500">Servidor Proxy</span><b>Desactivado</b>
							</div>
						</li>
						<li>Si va por <b>WiFi</b>: en <b>Red → Ethernet</b> pon IP <b>10.10.10.201</b>, máscara 255.255.255.0, puerta de enlace 0.0.0.0 y DHCP apagado. De fábrica el puerto de cable usa 192.168.1.201 y choca con las redes WiFi 192.168.1.x: el huellero dice "Conectado" pero no sale a internet. Si va por <b>cable</b> (router de la obra o 4G): Ethernet con DHCP activado.</li>
						<li>En uno o dos minutos aparece en esta lista como <b>Pendiente</b>. Pulsa <b>Asignar lugar</b> y elige la obra o el área (para la oficina: Corporativo). Los trabajadores de esa obra o área se le envían solos; a los demás agrégalo desde su ficha en Personal.</li>
						<li>Revisa que la fecha y hora del huellero sean las de Lima (<b>Sistema → Fecha y Hora</b>).</li>
					</ol>
				</div>
			{/if}

			{#if pendientes > 0 && !verEliminados}
				<div class="bg-amber-50 border border-amber-200 text-amber-800 rounded-xl px-4 py-3 text-sm flex items-center gap-2">
					<i class="fas fa-circle-exclamation"></i>
					{pendientes === 1 ? 'Hay 1 huellero nuevo sin obra o área asignada.' : `Hay ${pendientes} huelleros nuevos sin obra o área asignada.`}
				</div>
			{/if}

			<div class="bg-white border border-slate-100 rounded-2xl shadow-sm overflow-hidden">
				{#if isLoading}
					<div class="flex items-center justify-center py-16 text-slate-400 gap-3">
						<i class="fas fa-spinner fa-spin text-xl text-blue-500"></i>
						<span class="text-sm font-medium">Cargando huelleros...</span>
					</div>
				{:else}
					<ResponsiveDataView
						items={huelleros}
						keyField="id_dispositivo"
						columns={columnas}
						emptyMessage={verEliminados ? 'No hay huelleros dados de baja.' : 'Todavía no se ha conectado ningún huellero. Pulsa "Agregar huellero" para ver cómo configurarlo.'}
					>
						{#snippet row(h: Huellero)}
							<td class="px-5 py-4">
								<div class="font-semibold text-slate-800">{nombreHuellero(h)}</div>
								<div class="text-xs text-slate-400">Serie {h.numero_serie}</div>
							</td>
							<td class="px-5 py-4">{@render obra(h)}</td>
							<td class="px-5 py-4">{@render estadoConexion(h)}{@render ordenes(h)}</td>
							<td class="px-5 py-4 text-center font-semibold text-slate-700">{h.marcas_hoy}</td>
							<td class="px-5 py-4">{@render acciones(h)}</td>
						{/snippet}
						{#snippet card(h: Huellero)}
							<div class="p-4 flex flex-col gap-2">
								<div class="flex items-start justify-between gap-2">
									<div class="min-w-0">
										<div class="font-semibold text-slate-800">{nombreHuellero(h)}</div>
										<div class="text-xs text-slate-400">Serie {h.numero_serie}</div>
									</div>
									<div class="text-xs text-slate-500 shrink-0">{h.marcas_hoy} marcas hoy</div>
								</div>
								<div class="text-sm">{@render obra(h)}</div>
								{@render estadoConexion(h)}
								{@render ordenes(h)}
								{@render acciones(h)}
							</div>
						{/snippet}
					</ResponsiveDataView>
				{/if}
			</div>
		</div>
	</div>
</div>

{#if editando}
	<div class="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-[100] flex items-center justify-center p-4" transition:fade={{ duration: 200 }}>
		<div class="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto" transition:scale={{ duration: 250, start: 0.95 }}>
			<div class="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
				<h2 class="text-xl font-bold text-slate-800">{editando.estado === 'pendiente' ? 'Asignar lugar al huellero' : 'Editar huellero'}</h2>
				<button onclick={cerrarEditar} disabled={guardando} aria-label="Cerrar" class="text-slate-400 hover:text-slate-600 p-2 rounded-full hover:bg-slate-100 disabled:opacity-50">
					<i class="fas fa-times"></i>
				</button>
			</div>
			<div class="p-6 flex flex-col gap-4">
				<div class="text-xs text-slate-500 bg-slate-50 rounded-xl p-3 border border-slate-100">
					Serie <b>{editando.numero_serie}</b>{editando.info ? ` · ${editando.info}` : ''}
				</div>
				<label class="flex flex-col gap-1.5">
					<span class="text-sm font-medium text-slate-700">Nombre</span>
					<input
						bind:value={formNombre}
						maxlength="100"
						placeholder="Ej. Huellero entrada principal"
						class="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
					/>
				</label>
				<div class="flex flex-col gap-1.5">
					<label for="obra-huellero" class="text-sm font-medium text-slate-700">Obra o área (centro de costo) *</label>
					<SelectConSaldo
						id="obra-huellero"
						value={formObra}
						options={obras}
						placeholder="Selecciona la obra o el área"
						encabezadoNombre="Obra o área"
						onchange={(v) => (formObra = v)}
					/>
					<span class="text-xs text-slate-400">Las marcas de este huellero contarán para esta obra o área. Al asignarla, se le envían los trabajadores que tienen esta obra o área en su ficha.</span>
				</div>
			</div>
			<div class="px-6 py-4 border-t border-slate-100 flex justify-end gap-3">
				<button onclick={cerrarEditar} disabled={guardando} class="px-5 py-2.5 bg-white border border-slate-200 text-slate-600 rounded-xl hover:bg-slate-50 font-medium text-sm disabled:opacity-50">Cancelar</button>
				<button onclick={guardar} disabled={guardando} class="px-5 py-2.5 bg-blue-600 text-white rounded-xl hover:bg-blue-700 font-medium text-sm shadow-md shadow-blue-600/20 disabled:opacity-50 flex items-center gap-2">
					{#if guardando}<i class="fas fa-spinner fa-spin"></i>{/if} Guardar
				</button>
			</div>
		</div>
	</div>
{/if}

<ConfirmModal
	open={!!paraDarDeBaja}
	title="Dar de baja el huellero"
	message={paraDarDeBaja ? `¿Dar de baja "${nombreHuellero(paraDarDeBaja)}"? Las marcas que envíe desde ahora no se guardarán. Las anteriores se conservan.` : ''}
	confirmLabel="Dar de baja"
	onConfirm={confirmarDarDeBaja}
	onClose={() => (paraDarDeBaja = null)}
/>

<ConfirmModal
	open={!!paraRestaurar}
	title="Restaurar huellero"
	danger={false}
	message={paraRestaurar ? `¿Restaurar "${nombreHuellero(paraRestaurar)}"? Volverá a guardar sus marcas.` : ''}
	confirmLabel="Restaurar"
	onConfirm={confirmarRestaurar}
	onClose={() => (paraRestaurar = null)}
/>

<AdminConfirmModal
	open={!!paraEliminar}
	title="Eliminar huellero permanentemente"
	message={paraEliminar ? `Vas a eliminar PERMANENTEMENTE "${nombreHuellero(paraEliminar)}" y TODAS sus marcaciones. Esta acción no se puede deshacer. Ingresa el correo y la contraseña de un administrador para continuar.` : ''}
	confirmLabel="Eliminar permanentemente"
	onConfirm={confirmarEliminar}
	onClose={() => (paraEliminar = null)}
/>
