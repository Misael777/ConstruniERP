<script lang="ts">
	import { onMount } from 'svelte';
	import { supabase } from '$lib/supabaseClient';
	import { isAdmin, permisosState } from '$lib/stores/permisos.svelte';
	import { toast } from '$lib/stores/toast';
	import { Compass, Megaphone, Plus, Pencil, Trash2, CalendarDays, UserRound, RefreshCw } from '@lucide/svelte';
	import { EMPRESA_NOMBRE } from '$lib/shared/empresaConstantes';
	import { getAnuncios, createAnuncio, updateAnuncio, eliminarAnuncio, type Anuncio } from '$lib/modules/anuncios/services/anuncios.service';
	import AnuncioModal from '$lib/modules/anuncios/components/AnuncioModal.svelte';
	import { toDriveThumbnailUrl } from '$lib/shared/drivePreview';
	import ConfirmModal from '$lib/shared/components/ConfirmModal.svelte';

	// Landing temática de Dashboard — a pedido explícito del usuario: el panel financiero que vivía acá
	// se movió a Finanzas → Control Financiero (ver finanzas/control-financiero/+page.svelte); este módulo pasó a
	// ser la pantalla de bienvenida tras iniciar sesión, con anuncios/comunicados corporativos que
	// cualquier admin puede publicar (ver AnuncioModal.svelte/anuncios.service.ts). Mismo path
	// `/dashboard` y mismo permiso `ver_dashboard` de siempre — nada de la navegación/login que ya
	// apunta ahí necesitaba cambiar.

	let anuncios = $state<Anuncio[]>([]);
	let loading = $state(true);
	let loadError = $state('');

	async function fetchAnuncios() {
		loading = true;
		try {
			anuncios = await getAnuncios(supabase, true);
			loadError = '';
		} catch (err: any) {
			loadError = err?.message ?? 'No se pudieron cargar los anuncios';
		} finally {
			loading = false;
		}
	}

	onMount(fetchAnuncios);

	function formatDate(value: string | null | undefined) {
		if (!value) return '—';
		const [y, m, d] = value.split('-');
		if (!y || !m || !d) return value;
		return `${d}/${m}/${y}`;
	}

	const saludo = $derived.by(() => {
		const hora = new Date().getHours();
		if (hora < 12) return 'Buenos días';
		if (hora < 19) return 'Buenas tardes';
		return 'Buenas noches';
	});

	let modalOpen = $state(false);
	let modalMode = $state<'create' | 'edit'>('create');
	let editingAnuncio = $state<Anuncio | null>(null);
	let guardando = $state(false);

	function abrirNuevo() {
		modalMode = 'create';
		editingAnuncio = null;
		modalOpen = true;
	}
	function abrirEditar(item: Anuncio) {
		modalMode = 'edit';
		editingAnuncio = item;
		modalOpen = true;
	}
	function cerrarModal() {
		modalOpen = false;
		editingAnuncio = null;
	}

	async function handleGuardarAnuncio(payload: { titulo: string; contenido: string; imagen_url: string | null; fecha_publicacion: string }) {
		guardando = true;
		try {
			const result =
				modalMode === 'edit' && editingAnuncio
					? await updateAnuncio(supabase, editingAnuncio.id_anuncio, payload)
					: await createAnuncio(supabase, payload, permisosState.userName || null);
			if (result.success) {
				toast.success(result.message ?? 'Operación realizada con éxito');
				cerrarModal();
				await fetchAnuncios();
			} else {
				toast.error(result.message ?? 'Ocurrió un error al guardar');
			}
		} catch (err: any) {
			toast.error(err?.message ?? 'Ocurrió un error inesperado');
		} finally {
			guardando = false;
		}
	}

	let confirmEliminarOpen = $state(false);
	let anuncioAEliminar = $state<Anuncio | null>(null);
	function pedirEliminar(item: Anuncio) {
		anuncioAEliminar = item;
		confirmEliminarOpen = true;
	}
	async function confirmarEliminar() {
		if (!anuncioAEliminar) return;
		const result = await eliminarAnuncio(supabase, anuncioAEliminar.id_anuncio);
		if (result.success) {
			toast.success(result.message ?? 'Anuncio eliminado');
			await fetchAnuncios();
		} else {
			toast.error(result.message ?? 'No se pudo eliminar el anuncio');
		}
		confirmEliminarOpen = false;
		anuncioAEliminar = null;
	}
</script>

<svelte:head>
	<title>Dashboard | Construni ERP</title>
</svelte:head>

<div class="w-full max-w-none">
	<!-- Hero — a pedido explícito del usuario, temático/de bienvenida en vez del panel financiero de
	     antes (ver contexto arriba). -->
	<div class="relative overflow-hidden rounded-3xl bg-gradient-to-br from-[#0f3b5e] via-[#154a73] to-[#1e6091] px-6 py-10 sm:px-10 sm:py-14 mb-8 shadow-lg">
		<div class="absolute -right-10 -top-10 text-white/10 rotate-12"><Compass size={220} /></div>
		<div class="relative">
			<div class="w-12 h-12 rounded-2xl bg-white/15 backdrop-blur flex items-center justify-center mb-4">
				<Compass class="text-white" size={24} />
			</div>
			<h1 class="text-2xl sm:text-3xl font-black text-white tracking-tight">
				{saludo}{permisosState.userName ? `, ${permisosState.userName.split(' ')[0]}` : ''}
			</h1>
			<p class="text-sm sm:text-base text-white/70 mt-2 max-w-xl">
				Bienvenido al panel de {EMPRESA_NOMBRE}. Acá encontrarás los anuncios y comunicados más recientes del equipo.
			</p>
		</div>
	</div>

	<!-- Anuncios -->
	<div class="flex items-center justify-between mb-4 flex-wrap gap-3">
		<div class="flex items-center gap-2">
			<Megaphone class="text-[#0f3b5e]" size={22} />
			<h2 class="text-lg font-bold text-[#0f3b5e]">Anuncios Corporativos</h2>
		</div>
		<div class="flex items-center gap-2">
			<button type="button" onclick={fetchAnuncios} disabled={loading} class="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 text-slate-600 text-sm font-medium hover:bg-slate-50 disabled:opacity-50">
				<RefreshCw size={14} class={loading ? 'animate-spin' : ''} /> Actualizar
			</button>
			{#if isAdmin()}
				<button type="button" onclick={abrirNuevo} class="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 shadow-sm">
					<Plus size={16} /> Nuevo Anuncio
				</button>
			{/if}
		</div>
	</div>

	{#if loadError}
		<div class="mb-4 bg-red-100 text-red-700 px-4 py-2 rounded-lg text-sm">{loadError}</div>
	{/if}

	{#if loading}
		<div class="flex items-center justify-center py-20 text-slate-400">
			<RefreshCw size={26} class="animate-spin" />
		</div>
	{:else if anuncios.length === 0}
		<div class="text-center py-20 bg-white rounded-2xl border border-slate-100 shadow-sm">
			<Megaphone size={40} class="mx-auto mb-3 text-slate-300" />
			<p class="text-slate-400 text-sm">Sin anuncios publicados todavía.</p>
			{#if isAdmin()}
				<button type="button" onclick={abrirNuevo} class="mt-4 text-sm text-blue-600 font-semibold hover:underline">Publicar el primer anuncio</button>
			{/if}
		</div>
	{:else}
		<div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-5">
			{#each anuncios as item (item.id_anuncio)}
				<div class="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden flex flex-col">
					{#if item.imagen_url}
						<!-- Ticket #61: la URL guardada (uc?export=download) Drive ya no la deja incrustar en una página y se
						     veía rota; la miniatura de Drive sí. object-contain: la imagen se ve completa, sin deformarse. -->
						<div class="w-full h-44 bg-slate-50 flex items-center justify-center">
							<img src={toDriveThumbnailUrl(item.imagen_url, 1600)} alt={item.titulo} class="max-w-full max-h-full object-contain" />
						</div>
					{/if}
					<div class="p-5 flex flex-col gap-2 flex-1">
						<h3 class="font-bold text-[#0f3b5e] leading-snug">{item.titulo}</h3>
						<p class="text-sm text-slate-600 whitespace-pre-line flex-1">{item.contenido}</p>
						<div class="flex items-center justify-between pt-3 mt-2 border-t border-slate-100 text-[11px] text-slate-400">
							<span class="flex items-center gap-1"><CalendarDays size={12} /> {formatDate(item.fecha_publicacion)}</span>
							{#if item.autor}
								<span class="flex items-center gap-1"><UserRound size={12} /> {item.autor}</span>
							{/if}
						</div>
						{#if isAdmin()}
							<div class="flex items-center gap-2 pt-2">
								<button type="button" onclick={() => abrirEditar(item)} class="flex-1 h-8 rounded-lg border border-slate-200 text-slate-600 flex items-center justify-center gap-1.5 text-xs font-medium hover:bg-slate-50">
									<Pencil size={13} /> Editar
								</button>
								<button type="button" onclick={() => pedirEliminar(item)} class="flex-1 h-8 rounded-lg border border-red-200 text-red-600 flex items-center justify-center gap-1.5 text-xs font-medium hover:bg-red-50">
									<Trash2 size={13} /> Eliminar
								</button>
							</div>
						{/if}
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>

<AnuncioModal open={modalOpen} mode={modalMode} anuncio={editingAnuncio} generando={guardando} onCancel={cerrarModal} onGuardar={handleGuardarAnuncio} />

<ConfirmModal
	open={confirmEliminarOpen}
	title="Eliminar anuncio"
	message={`¿Eliminar "${anuncioAEliminar?.titulo ?? ''}"? Dejará de verse en la landing.`}
	confirmLabel="Eliminar"
	danger={true}
	onConfirm={confirmarEliminar}
	onClose={() => (confirmEliminarOpen = false)}
/>
