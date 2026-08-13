<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import type { RealtimeChannel } from '@supabase/supabase-js';
	import { supabase } from '$lib/supabaseClient';
	import { isAdmin } from '$lib/stores/permisos.svelte';
	import { crearSolicitud, darDeBajaCliente, restaurarCliente, deleteClienteCascade } from '$lib/modules/aprobaciones/services/aprobaciones.service';
	import { exportarClientesXLSX } from '$lib/modules/clientes/services/clientesExport.service';
	import { toast } from '$lib/stores/toast';
	import { describeError } from '$lib/shared/describeError';
	import { verifyAdminCredentials } from '$lib/shared/adminAuth';
	import ClientesTable from '$lib/components/comercial/clientes/ClientesTable.svelte';
	import ClienteModal from '$lib/components/comercial/clientes/ClienteModal.svelte';
	import ConfirmModal from '$lib/shared/components/ConfirmModal.svelte';
	import AdminConfirmModal from '$lib/shared/components/AdminConfirmModal.svelte';

	let clientes = $state<any[]>([]);
	let isModalOpen = $state(false);
	let clienteToEdit = $state<any>(null);
	let isLoading = $state(true);
	let isExporting = $state(false);

	// A pedido del usuario: los clientes dados de baja dejan de aparecer en el listado normal (para
	// cualquier usuario) — solo un admin puede activar "Ver eliminados" para verlos, y solo desde ahí
	// puede restaurarlos o borrarlos PERMANENTEMENTE (esto último siempre pide contraseña de admin, ver
	// más abajo). Mismo patrón para replicar en el resto de los módulos con "dar de baja" — ver el
	// skill dar-de-baja-pattern.
	let verEliminados = $state(false);

	async function fetchClientes() {
		isLoading = true;
		try {
			let query = supabase.from('cliente').select('*').order('id_cliente', { ascending: false });
			query = verEliminados ? query.eq('estado', 'baja') : query.neq('estado', 'baja');
			const { data, error } = await query;

			if (error) throw error;
			clientes = data || [];
		} catch (err) {
			console.error('Error fetching clientes:', err);
		} finally {
			isLoading = false;
		}
	}

	function toggleVerEliminados() {
		verEliminados = !verEliminados;
		fetchClientes();
	}

	// Tabla en tiempo real (mismo mecanismo que la campanita de notificaciones): apenas cambia algo en
	// `cliente` — otro usuario crea, edita o aprueba la eliminación de un cliente — este canal se
	// entera al instante y vuelve a pedir la lista, sin recargar la página. Requiere
	// ventas_clientes_realtime_migration.sql aplicada en Supabase.
	let realtimeChannel: RealtimeChannel | null = null;

	onMount(() => {
		fetchClientes();

		realtimeChannel = supabase
			.channel('clientes_cliente_changes')
			.on('postgres_changes', { event: '*', schema: 'public', table: 'cliente' }, () => {
				fetchClientes();
			})
			.subscribe();
	});

	onDestroy(() => {
		if (realtimeChannel) supabase.removeChannel(realtimeChannel);
	});

	/** A pedido del usuario: el botón "Exportar" (antes 100% decorativo, sin handler) ahora genera un
	 * .xlsx real — mismo criterio que Ventas: un admin exporta directo, un no-admin manda una solicitud
	 * de aprobación (ver crearSolicitud/aprobarSolicitud en aprobaciones.service.ts). `modulo: 'clientes'`
	 * en payloadCambios es lo que le permite a aprobarSolicitud distinguir esta exportación de la de
	 * Ventas, que comparte el mismo tipo_accion 'exportar'. */
	async function handleExportar() {
		if (!isAdmin()) {
			const result = await crearSolicitud(supabase, {
				tipoEntidad: 'exportacion',
				idEntidad: null,
				tipoAccion: 'exportar',
				descripcionEntidad: 'Exportación de clientes',
				payloadCambios: { modulo: 'clientes' }
			});
			if (result.success) {
				alert('No tienes permisos de administrador. Se envió una solicitud de exportación para que un administrador la apruebe.');
			} else {
				alert(`No se pudo enviar la solicitud. ${result.message ?? ''}`);
			}
			return;
		}

		isExporting = true;
		try {
			const result = await exportarClientesXLSX(supabase);
			if (!result.success) alert(`No se pudo exportar. ${result.message ?? ''}`);
		} finally {
			isExporting = false;
		}
	}

	function openModal(cliente = null) {
		clienteToEdit = cliente;
		isModalOpen = true;
	}

	function closeModal() {
		isModalOpen = false;
		clienteToEdit = null;
	}

	function onSaveSuccess() {
		fetchClientes(); // Refresh list after saving
	}

	/** A pedido del usuario: "Eliminar" (borrado real) se reemplaza por "Dar de baja" — no pasa por el
	 * sistema de solicitudes de aprobación (es un cambio de estado reversible, no un borrado), y
	 * también da de baja el centro de costo que se generó para este cliente (ver darDeBajaCliente en
	 * aprobaciones.service.ts). La confirmación usa ConfirmModal (no window.confirm nativo) — en la app
	 * empaquetada de Tauri, confirm() pasa por el plugin de diálogos y puede fallar por permisos ACL
	 * (ver capabilities/default.json); un modal propio no depende de ningún plugin nativo. Los errores
	 * se muestran con toast.error (mensaje completo vía describeError: message/code/details/hint) en
	 * vez de alert(), para que quede visible en pantalla como un "traceback" legible sin depender de
	 * una consola (no hay una accesible en el .exe empaquetado). */
	let confirmDarDeBajaOpen = $state(false);
	let clienteParaDarDeBaja = $state<{ id: number; nombre: string } | null>(null);

	function handleDarDeBaja(id: number) {
		const cliente = clientes.find((c) => c.id_cliente === id);
		clienteParaDarDeBaja = { id, nombre: cliente?.nombre || `Cliente #${id}` };
		confirmDarDeBajaOpen = true;
	}

	function closeConfirmDarDeBaja() {
		confirmDarDeBajaOpen = false;
		clienteParaDarDeBaja = null;
	}

	async function confirmarDarDeBaja() {
		if (!clienteParaDarDeBaja) return;
		try {
			const result = await darDeBajaCliente(supabase, clienteParaDarDeBaja.id);
			if (result.success) {
				toast.success(`Cliente "${clienteParaDarDeBaja.nombre}" dado de baja correctamente.`);
				await fetchClientes(); // Refresh
			} else {
				console.error('Error dando de baja al cliente:', result.message);
				toast.error(`No se pudo dar de baja al cliente. ${result.message ?? ''}`);
			}
		} catch (err) {
			console.error('Error dando de baja al cliente:', err);
			toast.error(`No se pudo dar de baja al cliente. ${describeError(err)}`);
		} finally {
			closeConfirmDarDeBaja();
		}
	}

	// ── Sección "Eliminados" (solo-admin): restaurar (sin contraseña, reversible) y borrado
	// permanente (SIEMPRE con contraseña de admin, sin excepción — a pedido explícito del usuario). ──

	let confirmRestaurarOpen = $state(false);
	let clienteParaRestaurar = $state<{ id: number; nombre: string } | null>(null);

	function handleRestaurar(id: number) {
		const cliente = clientes.find((c) => c.id_cliente === id);
		clienteParaRestaurar = { id, nombre: cliente?.nombre || `Cliente #${id}` };
		confirmRestaurarOpen = true;
	}

	function closeConfirmRestaurar() {
		confirmRestaurarOpen = false;
		clienteParaRestaurar = null;
	}

	async function confirmarRestaurar() {
		if (!clienteParaRestaurar) return;
		try {
			const result = await restaurarCliente(supabase, clienteParaRestaurar.id);
			if (result.success) {
				toast.success(`Cliente "${clienteParaRestaurar.nombre}" restaurado correctamente.`);
				await fetchClientes();
			} else {
				toast.error(`No se pudo restaurar al cliente. ${result.message ?? ''}`);
			}
		} catch (err) {
			toast.error(`No se pudo restaurar al cliente. ${describeError(err)}`);
		} finally {
			closeConfirmRestaurar();
		}
	}

	let confirmEliminarPermanenteOpen = $state(false);
	let clienteParaEliminarPermanente = $state<{ id: number; nombre: string } | null>(null);

	function handleEliminarPermanente(id: number) {
		const cliente = clientes.find((c) => c.id_cliente === id);
		clienteParaEliminarPermanente = { id, nombre: cliente?.nombre || `Cliente #${id}` };
		confirmEliminarPermanenteOpen = true;
	}

	function closeConfirmEliminarPermanente() {
		if (eliminandoPermanente) return;
		confirmEliminarPermanenteOpen = false;
		clienteParaEliminarPermanente = null;
	}

	/** Igual patrón que el borrado masivo de Transacciones (único precedente hoy, ver
	 * finanzas/tranzacciones/+page.svelte): verifyAdminCredentials re-autentica de verdad contra
	 * Supabase Auth con un cliente descartable (no toca la sesión real) y confirma que el rol sea
	 * admin — recién ahí se ejecuta el borrado real (deleteClienteCascade, que además bloquea si el
	 * cliente todavía tiene ventas/cuentas por cobrar/transacciones vinculadas). */
	let eliminandoPermanente = $state(false);
	async function confirmarEliminarPermanente(email: string, password: string) {
		if (!clienteParaEliminarPermanente) return;
		const verificacion = await verifyAdminCredentials(email, password);
		if (!verificacion.success) throw new Error(verificacion.message);

		eliminandoPermanente = true;
		try {
			const result = await deleteClienteCascade(supabase, clienteParaEliminarPermanente.id);
			if (result.success) {
				toast.success(`Cliente "${clienteParaEliminarPermanente.nombre}" eliminado permanentemente.`);
				confirmEliminarPermanenteOpen = false;
				clienteParaEliminarPermanente = null;
				await fetchClientes();
			} else {
				throw new Error(result.message || 'No se pudo eliminar el cliente.');
			}
		} finally {
			eliminandoPermanente = false;
		}
	}
</script>

<svelte:head>
	<title>Clientes | Comercial - Construni ERP</title>
</svelte:head>

<div class="flex flex-col md:h-[calc(100vh-80px)] md:overflow-hidden bg-slate-50/50">
	
	<!-- Header area -->
	<div class="flex-shrink-0 px-6 py-5 flex items-center justify-between border-b border-slate-100 bg-white">
		<div class="flex flex-col">
			<div class="flex items-center gap-2 text-slate-500 text-sm mb-1">
				<span class="font-bold text-slate-800 text-2xl">{verEliminados ? 'Clientes eliminados' : 'Directorio de Clientes'}</span>
				{#if verEliminados}
					<span class="text-[10px] font-bold px-2 py-0.5 rounded-md bg-rose-50 text-rose-600 border border-rose-200 uppercase tracking-wide">Solo administradores</span>
				{/if}
			</div>
			<p class="text-sm text-slate-500">
				{verEliminados
					? 'Clientes dados de baja — restauralos o elimínalos de la base de datos permanentemente.'
					: 'Gestiona la base de datos de tus clientes corporativos y personas naturales.'}
			</p>
		</div>

		<div class="flex items-center gap-3">
			{#if isAdmin()}
				<button onclick={toggleVerEliminados} class={`px-4 py-2 rounded-xl font-medium text-sm transition-colors shadow-sm flex items-center gap-2 ${verEliminados ? 'bg-slate-800 text-white hover:bg-slate-900' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
					<i class={`fas ${verEliminados ? 'fa-arrow-left' : 'fa-trash-can'}`}></i>
					{verEliminados ? 'Volver al directorio' : 'Ver eliminados'}
				</button>
			{/if}
			{#if !verEliminados}
				<button onclick={handleExportar} disabled={isExporting} class="px-4 py-2 bg-white border border-slate-200 text-slate-600 rounded-xl hover:bg-slate-50 font-medium text-sm transition-colors shadow-sm flex items-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed">
					{#if isExporting}
						<i class="fas fa-spinner fa-spin"></i>
					{:else}
						<i class="fas fa-download"></i>
					{/if}
					Exportar
				</button>
				<button onclick={() => openModal(null)} class="px-5 py-2 bg-blue-600 text-white rounded-xl hover:bg-blue-700 font-medium text-sm shadow-md shadow-blue-600/20 transition-all active:scale-[0.98] flex items-center gap-2">
					<i class="fas fa-plus"></i> Nuevo Cliente
				</button>
			{/if}
		</div>
	</div>

	<!-- Scrollable content -->
	<div class="flex-1 overflow-y-auto md:overflow-hidden p-6">
		<div class="md:h-full max-w-[1200px] mx-auto flex flex-col">
			{#if isLoading}
				<div class="flex-1 flex items-center justify-center">
					<div class="flex flex-col items-center gap-3 text-slate-400">
						<i class="fas fa-spinner fa-spin text-2xl text-blue-500"></i>
						<span class="text-sm font-medium">Cargando clientes...</span>
					</div>
				</div>
			{:else}
				<ClientesTable
					{clientes}
					modoEliminados={verEliminados}
					onEdit={openModal}
					onDarDeBaja={handleDarDeBaja}
					onRestaurar={handleRestaurar}
					onEliminarPermanente={handleEliminarPermanente}
				/>
			{/if}
		</div>
	</div>
</div>

<ClienteModal
	isOpen={isModalOpen}
	clienteEdit={clienteToEdit}
	onClose={closeModal}
	onSave={onSaveSuccess}
/>

<ConfirmModal
	open={confirmDarDeBajaOpen}
	title="Dar de baja al cliente"
	message={clienteParaDarDeBaja ? `¿Dar de baja al cliente "${clienteParaDarDeBaja.nombre}"? Quedará marcado como inactivo.` : ''}
	confirmLabel="Dar de baja"
	onConfirm={confirmarDarDeBaja}
	onClose={closeConfirmDarDeBaja}
/>

<ConfirmModal
	open={confirmRestaurarOpen}
	title="Restaurar cliente"
	danger={false}
	message={clienteParaRestaurar ? `¿Restaurar al cliente "${clienteParaRestaurar.nombre}"? Volverá a aparecer en el directorio.` : ''}
	confirmLabel="Restaurar"
	onConfirm={confirmarRestaurar}
	onClose={closeConfirmRestaurar}
/>

<AdminConfirmModal
	open={confirmEliminarPermanenteOpen}
	title="Eliminar cliente permanentemente"
	message={clienteParaEliminarPermanente ? `Vas a eliminar PERMANENTEMENTE al cliente "${clienteParaEliminarPermanente.nombre}" de la base de datos. Esta acción no se puede deshacer. Ingresa el correo y la contraseña de un administrador para continuar.` : ''}
	confirmLabel="Eliminar permanentemente"
	onConfirm={confirmarEliminarPermanente}
	onClose={closeConfirmEliminarPermanente}
/>
