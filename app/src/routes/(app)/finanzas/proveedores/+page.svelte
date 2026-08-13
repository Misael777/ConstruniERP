<script lang="ts">
	import { onMount } from 'svelte';
	import { supabase } from '$lib/supabaseClient';
	import { isAdmin } from '$lib/stores/permisos.svelte';
	import { toast } from '$lib/stores/toast';
	import { describeError } from '$lib/shared/describeError';
	import { verifyAdminCredentials } from '$lib/shared/adminAuth';
	import ProveedoresTable from '$lib/components/finanzas/proveedores/ProveedoresTable.svelte';
	import ProveedorModal from '$lib/components/finanzas/proveedores/ProveedorModal.svelte';
	import ConfirmModal from '$lib/shared/components/ConfirmModal.svelte';
	import AdminConfirmModal from '$lib/shared/components/AdminConfirmModal.svelte';
	import {
		getProveedores,
		darDeBajaProveedor,
		restaurarProveedor,
		deleteProveedorCascade
	} from '$lib/modules/proveedores/services/proveedores.service';

	let proveedores = $state<any[]>([]);
	let isModalOpen = $state(false);
	let proveedorToEdit = $state<any>(null);
	let isLoading = $state(true);

	// A pedido del usuario: los proveedores dados de baja dejan de aparecer en el listado normal —
	// solo un admin puede activar "Ver eliminados" (mismo patrón que Clientes, ver skill
	// dar-de-baja-pattern).
	let verEliminados = $state(false);

	async function fetchProveedores() {
		isLoading = true;
		try {
			proveedores = await getProveedores(supabase, verEliminados);
		} catch (err) {
			console.error('Error fetching proveedores:', err);
			toast.error(`No se pudieron cargar los proveedores. ${describeError(err)}`);
		} finally {
			isLoading = false;
		}
	}

	function toggleVerEliminados() {
		verEliminados = !verEliminados;
		fetchProveedores();
	}

	onMount(() => {
		fetchProveedores();
	});

	function openModal(proveedor = null) {
		proveedorToEdit = proveedor;
		isModalOpen = true;
	}

	function closeModal() {
		isModalOpen = false;
		proveedorToEdit = null;
	}

	function onSaveSuccess() {
		fetchProveedores(); // Refresh list after saving
	}

	/** A pedido del usuario: "Eliminar" (borrado real) se reemplaza por "Dar de baja" — reversible, sin
	 * contraseña (ver darDeBajaProveedor). ConfirmModal en vez de window.confirm nativo (puede fallar
	 * por ACL en Tauri) y toast.error en vez de alert() (mensaje completo con describeError). */
	let confirmDarDeBajaOpen = $state(false);
	let proveedorParaDarDeBaja = $state<{ id: number; nombre: string } | null>(null);

	function handleDarDeBaja(id: number) {
		const proveedor = proveedores.find((p) => p.id_proveedor === id);
		proveedorParaDarDeBaja = { id, nombre: proveedor?.razon_social || `Proveedor #${id}` };
		confirmDarDeBajaOpen = true;
	}

	function closeConfirmDarDeBaja() {
		confirmDarDeBajaOpen = false;
		proveedorParaDarDeBaja = null;
	}

	async function confirmarDarDeBaja() {
		if (!proveedorParaDarDeBaja) return;
		try {
			const result = await darDeBajaProveedor(supabase, proveedorParaDarDeBaja.id);
			if (result.success) {
				toast.success(`Proveedor "${proveedorParaDarDeBaja.nombre}" dado de baja correctamente.`);
				await fetchProveedores();
			} else {
				toast.error(`No se pudo dar de baja al proveedor. ${result.message ?? ''}`);
			}
		} catch (err) {
			toast.error(`No se pudo dar de baja al proveedor. ${describeError(err)}`);
		} finally {
			closeConfirmDarDeBaja();
		}
	}

	// ── Sección "Eliminados" (solo-admin): restaurar (sin contraseña) y borrado permanente (SIEMPRE
	// con contraseña de admin, sin excepción). ──

	let confirmRestaurarOpen = $state(false);
	let proveedorParaRestaurar = $state<{ id: number; nombre: string } | null>(null);

	function handleRestaurar(id: number) {
		const proveedor = proveedores.find((p) => p.id_proveedor === id);
		proveedorParaRestaurar = { id, nombre: proveedor?.razon_social || `Proveedor #${id}` };
		confirmRestaurarOpen = true;
	}

	function closeConfirmRestaurar() {
		confirmRestaurarOpen = false;
		proveedorParaRestaurar = null;
	}

	async function confirmarRestaurar() {
		if (!proveedorParaRestaurar) return;
		try {
			const result = await restaurarProveedor(supabase, proveedorParaRestaurar.id);
			if (result.success) {
				toast.success(`Proveedor "${proveedorParaRestaurar.nombre}" restaurado correctamente.`);
				await fetchProveedores();
			} else {
				toast.error(`No se pudo restaurar al proveedor. ${result.message ?? ''}`);
			}
		} catch (err) {
			toast.error(`No se pudo restaurar al proveedor. ${describeError(err)}`);
		} finally {
			closeConfirmRestaurar();
		}
	}

	let confirmEliminarPermanenteOpen = $state(false);
	let proveedorParaEliminarPermanente = $state<{ id: number; nombre: string } | null>(null);
	let eliminandoPermanente = $state(false);

	function handleEliminarPermanente(id: number) {
		const proveedor = proveedores.find((p) => p.id_proveedor === id);
		proveedorParaEliminarPermanente = { id, nombre: proveedor?.razon_social || `Proveedor #${id}` };
		confirmEliminarPermanenteOpen = true;
	}

	function closeConfirmEliminarPermanente() {
		if (eliminandoPermanente) return;
		confirmEliminarPermanenteOpen = false;
		proveedorParaEliminarPermanente = null;
	}

	/** Igual patrón que el borrado masivo de Transacciones: verifyAdminCredentials re-autentica de
	 * verdad contra Supabase Auth antes de ejecutar deleteProveedorCascade. */
	async function confirmarEliminarPermanente(email: string, password: string) {
		if (!proveedorParaEliminarPermanente) return;
		const verificacion = await verifyAdminCredentials(email, password);
		if (!verificacion.success) throw new Error(verificacion.message);

		eliminandoPermanente = true;
		try {
			const result = await deleteProveedorCascade(supabase, proveedorParaEliminarPermanente.id);
			if (result.success) {
				toast.success(`Proveedor "${proveedorParaEliminarPermanente.nombre}" eliminado permanentemente.`);
				confirmEliminarPermanenteOpen = false;
				proveedorParaEliminarPermanente = null;
				await fetchProveedores();
			} else {
				throw new Error(result.message || 'No se pudo eliminar el proveedor.');
			}
		} finally {
			eliminandoPermanente = false;
		}
	}
</script>

<svelte:head>
	<title>Proveedores | Finanzas - Construni ERP</title>
</svelte:head>

<div class="flex flex-col md:h-[calc(100vh-80px)] md:overflow-hidden bg-slate-50/50">

	<!-- Header area -->
	<div class="flex-shrink-0 px-6 py-5 flex items-center justify-between border-b border-slate-100 bg-white">
		<div class="flex flex-col">
			<div class="flex items-center gap-2 text-slate-500 text-sm mb-1">
				<a href="/finanzas" class="hover:text-blue-600 transition-colors"><i class="fas fa-arrow-left"></i></a>
				<span class="font-bold text-slate-800 text-2xl ml-2">{verEliminados ? 'Proveedores eliminados' : 'Directorio de Proveedores'}</span>
				{#if verEliminados}
					<span class="text-[10px] font-bold px-2 py-0.5 rounded-md bg-rose-50 text-rose-600 border border-rose-200 uppercase tracking-wide">Solo administradores</span>
				{/if}
			</div>
			<p class="text-sm text-slate-500 ml-7">
				{verEliminados
					? 'Proveedores dados de baja — restauralos o elimínalos de la base de datos permanentemente.'
					: 'Administra los proveedores de materiales, servicios y equipos.'}
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
				<button class="px-4 py-2 bg-white border border-slate-200 text-slate-600 rounded-xl hover:bg-slate-50 font-medium text-sm transition-colors shadow-sm flex items-center gap-2">
					<i class="fas fa-download"></i> Exportar
				</button>
				<button onclick={() => openModal(null)} class="px-5 py-2 bg-blue-600 text-white rounded-xl hover:bg-blue-700 font-medium text-sm shadow-md shadow-blue-600/20 transition-all active:scale-[0.98] flex items-center gap-2">
					<i class="fas fa-plus"></i> Nuevo Proveedor
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
						<span class="text-sm font-medium">Cargando proveedores...</span>
					</div>
				</div>
			{:else}
				<ProveedoresTable
					{proveedores}
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

<ProveedorModal
	isOpen={isModalOpen}
	proveedorEdit={proveedorToEdit}
	onClose={closeModal}
	onSave={onSaveSuccess}
/>

<ConfirmModal
	open={confirmDarDeBajaOpen}
	title="Dar de baja al proveedor"
	message={proveedorParaDarDeBaja ? `¿Dar de baja al proveedor "${proveedorParaDarDeBaja.nombre}"? Quedará marcado como inactivo.` : ''}
	confirmLabel="Dar de baja"
	onConfirm={confirmarDarDeBaja}
	onClose={closeConfirmDarDeBaja}
/>

<ConfirmModal
	open={confirmRestaurarOpen}
	title="Restaurar proveedor"
	danger={false}
	message={proveedorParaRestaurar ? `¿Restaurar al proveedor "${proveedorParaRestaurar.nombre}"? Volverá a aparecer en el directorio.` : ''}
	confirmLabel="Restaurar"
	onConfirm={confirmarRestaurar}
	onClose={closeConfirmRestaurar}
/>

<AdminConfirmModal
	open={confirmEliminarPermanenteOpen}
	title="Eliminar proveedor permanentemente"
	message={proveedorParaEliminarPermanente ? `Vas a eliminar PERMANENTEMENTE al proveedor "${proveedorParaEliminarPermanente.nombre}" de la base de datos. Esta acción no se puede deshacer. Ingresa el correo y la contraseña de un administrador para continuar.` : ''}
	confirmLabel="Eliminar permanentemente"
	onConfirm={confirmarEliminarPermanente}
	onClose={closeConfirmEliminarPermanente}
/>
