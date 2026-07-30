<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { page } from '$app/stores';
	import { supabase } from '$lib/supabaseClient';
	import { goto } from '$app/navigation';
	import { toast } from '$lib/stores/toast';
	import { isAdmin } from '$lib/stores/permisos.svelte';
	import { resolveApiUrl, parseJsonResponse } from '$lib/apiClient';
	import { isRunningInTauri, uploadToDriveClient, deleteDriveFileClient } from '$lib/driveUploadClient';
	import { generateUniqueFileName } from '$lib/shared/fileNaming';
	import { extractDriveFileId } from '$lib/shared/uploadProjectDocument';
	import DocumentosTab from '$lib/components/proyecto/DocumentosTab.svelte';
	import GanttTab from '$lib/components/proyecto/GanttTab.svelte';
	import PresupuestoTab from '$lib/components/proyecto/PresupuestoTab.svelte';

	let projectId = $state<string | undefined>(undefined);
	let lastLoadedProjectId = $state<string | undefined>(undefined);
	type Proyecto = {
		id_proyecto: number;
		id_cliente: number;
		tip_proyecto: string;
		nombre_proyecto: string;
		ubicacion: string;
		fecha_inicio_plan: string;
		fecha_fin_plan: string;
		estado_predio: string;
		tipo_edifica: string;
		nro_pisos: number | null;
		distrito: string;
		provincia: string;
		departamento: string;
		costo_estima: number | null;
		precio_venta: number | null;
		descripcion: string;
		responsable: string;
		duracion_semanas: number | null;
		usuario_registro: string;
		contrato: string | null;
		estado_proyecto: string;
		id_pres_inicial: number | null;
		id_pres_final: number | null;
		area_terreno: number | null;
		area_construida: number | null;
		created_at: string;
		updated_at: string;
		asesor_comercial_id: string;
		comision_asesor: number;
		cliente?: { nombre: string } | null;
	};

	// Campos realmente editables desde este tab — deja fuera ids crudos
	// (id_pres_inicial/final, asesor_comercial_id) que no tiene sentido
	// editar como texto libre, y campos de auditoría (created_at/updated_at/
	// usuario_registro) que no son datos de negocio.
	type FormFields = {
		nombre_proyecto: string;
		responsable: string;
		tip_proyecto: string;
		ubicacion: string;
		distrito: string;
		provincia: string;
		departamento: string;
		estado_predio: string;
		tipo_edifica: string;
		nro_pisos: number | null;
		area_terreno: number | null;
		area_construida: number | null;
		fecha_inicio_plan: string;
		fecha_fin_plan: string;
		duracion_semanas: number | null;
		costo_estima: number | null;
		precio_venta: number | null;
		descripcion: string;
	};

	/** Mismo criterio de armado que el "Código generado" de Nueva Venta (ver codigoGenerado en
	 * NuevaVentaModal.svelte) — ahí es solo una vista previa que nunca se guarda, así que se
	 * recalcula aquí a partir de los campos ya guardados del proyecto para mostrarlo en "Nombre del
	 * Proyecto" al abrir uno existente para actualizarlo (incluye ventas ya cerradas). */
	function generarCodigoProyecto(p: Proyecto): string {
		const fecha = p.fecha_inicio_plan ? new Date(p.fecha_inicio_plan) : null;
		const mes = fecha && !Number.isNaN(fecha.getTime()) ? String(fecha.getMonth() + 1).padStart(2, '0') : '';
		const anio = fecha && !Number.isNaN(fecha.getTime()) ? String(fecha.getFullYear()).slice(2) : '';
		const clienteNombre = p.cliente?.nombre?.trim() || 'Cliente';
		return `${p.tip_proyecto ?? ''}${p.estado_predio ?? ''}${p.tipo_edifica ?? ''}${p.nro_pisos ?? ''} - ${mes}${anio} - ${p.distrito ?? ''} - ${clienteNombre}`;
	}

	function seedForm(p: Proyecto): FormFields {
		return {
			nombre_proyecto: generarCodigoProyecto(p),
			responsable: p.responsable ?? '',
			tip_proyecto: p.tip_proyecto ?? '',
			ubicacion: p.ubicacion ?? '',
			distrito: p.distrito ?? '',
			provincia: p.provincia ?? '',
			departamento: p.departamento ?? '',
			estado_predio: p.estado_predio ?? '',
			tipo_edifica: p.tipo_edifica ?? '',
			nro_pisos: p.nro_pisos ?? null,
			area_terreno: p.area_terreno ?? null,
			area_construida: p.area_construida ?? null,
			fecha_inicio_plan: p.fecha_inicio_plan ?? '',
			fecha_fin_plan: p.fecha_fin_plan ?? '',
			duracion_semanas: p.duracion_semanas ?? null,
			costo_estima: p.costo_estima ?? null,
			precio_venta: p.precio_venta ?? null,
			descripcion: p.descripcion ?? '',
		};
	}

	let proyecto = $state<Proyecto | null>(null);
	let form = $state<FormFields | null>(null);
	let isLoading = $state(true);
	let saving = $state(false);
	let activeTab = $state('definicion');
	let hasLoadedProject = $state(false);

	async function loadProject(id: string) {
		isLoading = true;
		try {
			const { data, error } = await supabase
				.from('proyecto')
				.select('*, cliente:id_cliente(nombre)')
				.eq('id_proyecto', id)
				.single();
			if (error) throw error;

			// Bloqueo por URL directa: la lista (gestion/+page.svelte) ya oculta los proyectos ajenos,
			// pero un usuario no-administrador podría igual escribir la URL de un proyecto de otro y
			// entrar sin este chequeo — mismo criterio de propiedad (asesor_comercial_id) que la lista.
			if (!isAdmin()) {
				const { data: userData } = await supabase.auth.getUser();
				const currentUserId = userData?.user?.id;
				if (data.asesor_comercial_id !== currentUserId) {
					toast.error('No tienes permiso para ver este proyecto.');
					goto('/proyectos/gestion');
					return;
				}
			}

			proyecto = data;
			form = seedForm(data);
			lastLoadedProjectId = id;
		} catch (error) {
			console.error('Error cargando el proyecto:', error);
		} finally {
			isLoading = false;
			hasLoadedProject = true;
		}
	}

	const unsubscribe = page.subscribe(($page) => {
		projectId = $page?.params?.id;
		if (projectId && projectId !== lastLoadedProjectId) {
			loadProject(projectId);
		}
	});

	onDestroy(() => unsubscribe());

	onMount(() => {
		if (projectId && projectId !== lastLoadedProjectId) {
			loadProject(projectId);
		} else if (!projectId) {
			console.warn('Gestión: no se encontró projectId en la ruta');
			isLoading = false;
		}
	});

	function goBack() {
		goto('/proyectos/gestion');
	}

	async function guardarCambios() {
		if (!proyecto || !form) return;
		saving = true;
		try {
			const { error } = await supabase.from('proyecto').update({ ...form }).eq('id_proyecto', proyecto.id_proyecto);
			if (error) throw error;
			proyecto = { ...proyecto, ...form };
			toast.success('Cambios guardados');
		} catch (err: any) {
			toast.error(err.message || 'No se pudo guardar los cambios');
		} finally {
			saving = false;
		}
	}

	// ── DOCUMENTO DEL PROYECTO (proforma / contrato) ────────────────────────────
	// Un solo slot (columna proyecto.contrato) que evoluciona con el trato: hoy
	// puede tener la proforma, más adelante se reemplaza por el contrato firmado
	// — mismo mecanismo de subida (Drive) que usa el resto del ERP.
	let contratoUploading = $state(false);
	let showContratoPreview = $state(false);


	// Mismo mecanismo que usa el submódulo de Ventas para previsualizar el
	// contrato/proforma: el visor propio de Google Drive embebido en un
	// iframe (vía /file/d/{id}/preview) renderiza tanto PDFs como imágenes,
	// a diferencia de un <img> plano que solo sirve para imágenes.
	let contratoPreviewUrl = $derived.by(() => {
		if (!proyecto?.contrato) return null;
		const fileId = extractDriveFileId(proyecto.contrato);
		return fileId ? `https://drive.google.com/file/d/${fileId}/preview` : null;
	});

	async function deleteContratoAnterior(fileId: string): Promise<void> {
		try {
			if (isRunningInTauri()) {
				await deleteDriveFileClient(fileId);
			} else {
				const response = await fetch(resolveApiUrl('/api/upload-document'), {
					method: 'DELETE',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ fileId }),
				});
				await parseJsonResponse(response);
			}
		} catch (err) {
			// Best-effort: si falla el borrado del archivo anterior, no bloquea el reemplazo.
			console.warn('No se pudo borrar el documento anterior en Drive:', err);
		}
	}

	async function onContratoFileChange(e: Event) {
		const file = (e.currentTarget as HTMLInputElement).files?.[0];
		(e.currentTarget as HTMLInputElement).value = '';
		if (!file || !proyecto) return;

		contratoUploading = true;
		try {
			const oldFileId = extractDriveFileId(proyecto.contrato);
			const fileName = generateUniqueFileName(`contrato_proy${proyecto.id_proyecto}`, file.name);
			let url: string;

			if (isRunningInTauri()) {
				const uploaded = await uploadToDriveClient(file, fileName, 'contrato');
				url = uploaded.url;
				const { error } = await supabase.from('proyecto').update({ contrato: url }).eq('id_proyecto', proyecto.id_proyecto);
				if (error) throw error;
			} else {
				const formData = new FormData();
				formData.append('file', file);
				formData.append('type', 'contrato');
				formData.append('projectId', String(proyecto.id_proyecto));
				const response = await fetch(resolveApiUrl('/api/upload-document'), { method: 'POST', body: formData });
				const result = await parseJsonResponse(response);
				if (!response.ok || !result.success) throw new Error(result.error || 'Error al subir el documento.');
				url = result.url;
			}

			proyecto = { ...proyecto, contrato: url };
			toast.success('Documento actualizado');

			if (oldFileId) await deleteContratoAnterior(oldFileId);
		} catch (err: any) {
			toast.error(err.message || 'No se pudo subir el documento');
		} finally {
			contratoUploading = false;
		}
	}

	function abrirPreviewContrato() {
		showContratoPreview = true;
	}
</script>

<svelte:head>
	<title>{proyecto ? `${proyecto.nombre_proyecto} | Gestión` : 'Cargando Proyecto...'}</title>
</svelte:head>


{#if isLoading}
	<div class="flex justify-center text-orange-600 text-3xl py-12">
		<i class="fas fa-circle-notch fa-spin"></i>
	</div>
{:else if !proyecto}
	<div class="bg-white rounded-2xl border border-slate-100 p-12 text-center shadow-sm">
		<i class="fas fa-exclamation-triangle text-4xl text-rose-500 mb-4"></i>
		<h2 class="text-xl font-bold text-slate-800">Proyecto no encontrado</h2>
		<p class="text-slate-500 mt-2 mb-6">El proyecto que intentas buscar no existe o fue eliminado.</p>
		<button onclick={goBack} class="px-5 py-2 bg-slate-800 text-white rounded-xl text-sm font-medium hover:bg-slate-700 transition-colors">
			Volver a Gestión
		</button>
	</div>
{:else}
	<!-- Cabecera del Proyecto -->
	<div class="mb-6 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white p-5 rounded-2xl border border-slate-100 shadow-sm">
		<div class="flex items-center gap-4">
			<button onclick={goBack} class="w-10 h-10 rounded-xl bg-slate-50 hover:bg-slate-100 text-slate-600 border border-slate-200 flex items-center justify-center transition-colors shadow-xs" title="Volver">
				<i class="fas fa-arrow-left"></i>
			</button>
			<div>
				<div class="flex items-center gap-3 mb-1">
					<h2 class="text-2xl font-bold text-slate-800">{proyecto.nombre_proyecto}</h2>
					<span class="px-2.5 py-1 rounded-md text-[10px] font-bold uppercase border bg-emerald-100 text-emerald-700 border-emerald-200 tracking-wider">
						{proyecto.estado_proyecto || 'ACTIVO'}
					</span>
				</div>
				<div class="flex items-center gap-4 text-xs font-medium text-slate-500">
					<span class="flex items-center gap-1.5"><i class="fas fa-map-marker-alt text-slate-400"></i> {proyecto.ubicacion || 'Sin ubicación'}</span>
					<span class="w-1 h-1 rounded-full bg-slate-300"></span>
					<span class="flex items-center gap-1.5"><i class="fas fa-hashtag text-slate-400"></i> PROY-{proyecto.id_proyecto}</span>
				</div>
			</div>
		</div>
		<div class="flex gap-2">
			<button class="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-sm font-medium transition-colors flex items-center gap-2 border border-slate-200">
				<i class="fas fa-print"></i> Reporte
			</button>
			{#if activeTab === 'definicion'}
				<button
					onclick={guardarCambios}
					disabled={saving}
					class="px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-xl text-sm font-medium shadow-md shadow-orange-600/10 transition-colors flex items-center gap-2 disabled:opacity-60"
				>
					{#if saving}
						<i class="fas fa-circle-notch fa-spin"></i> Guardando…
					{:else}
						<i class="fas fa-save"></i> Guardar Cambios
					{/if}
				</button>
			{/if}
		</div>
	</div>

	<!-- Navegación de Pestañas -->
	<div class="bg-white rounded-t-2xl border-x border-t border-slate-100 px-2 pt-2 flex overflow-x-auto gap-1">
		<button 
			class={`px-5 py-3 text-sm font-bold flex items-center gap-2 rounded-t-xl transition-colors border-b-2 ${activeTab === 'definicion' ? 'text-orange-600 border-orange-600 bg-orange-50/50' : 'text-slate-500 border-transparent hover:text-slate-800 hover:bg-slate-50'}`}
			onclick={() => activeTab = 'definicion'}
		>
			<i class="fas fa-info-circle"></i> Definición
		</button>
		<button 
			class={`px-5 py-3 text-sm font-bold flex items-center gap-2 rounded-t-xl transition-colors border-b-2 ${activeTab === 'partidas' ? 'text-orange-600 border-orange-600 bg-orange-50/50' : 'text-slate-500 border-transparent hover:text-slate-800 hover:bg-slate-50'}`}
			onclick={() => activeTab = 'partidas'}
		>
			<i class="fas fa-list-ul"></i> Presupuesto / Partidas
		</button>
		<button
			class={`px-5 py-3 text-sm font-bold flex items-center gap-2 rounded-t-xl transition-colors border-b-2 ${activeTab === 'gestion' ? 'text-orange-600 border-orange-600 bg-orange-50/50' : 'text-slate-500 border-transparent hover:text-slate-800 hover:bg-slate-50'}`}
			onclick={() => activeTab = 'gestion'}
		>
			<i class="fas fa-chart-gantt"></i> Gestión de Obra
		</button>
		<button
			class={`px-5 py-3 text-sm font-bold flex items-center gap-2 rounded-t-xl transition-colors border-b-2 ${activeTab === 'documentos' ? 'text-orange-600 border-orange-600 bg-orange-50/50' : 'text-slate-500 border-transparent hover:text-slate-800 hover:bg-slate-50'}`}
			onclick={() => activeTab = 'documentos'}
		>
			<i class="fas fa-folder-open"></i> Documentos
		</button>
	</div>

	<!-- Contenido de las Pestañas -->
	<div class="bg-white rounded-b-2xl border border-slate-100 shadow-sm p-6 min-h-[400px]">
		
		{#if activeTab === 'definicion' && form}
			<div class="max-w-4xl animate-in fade-in duration-300">
				<h3 class="text-lg font-bold text-slate-800 mb-4 border-b border-slate-100 pb-2">Información General</h3>
				<div class="grid grid-cols-1 md:grid-cols-2 gap-6">
					<div>
						<label class="block text-xs font-bold text-slate-500 mb-1.5 uppercase tracking-wider">Nombre del Proyecto</label>
						<input type="text" bind:value={form.nombre_proyecto} class="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-orange-500 focus:border-orange-500 outline-none transition-all text-sm font-medium text-slate-800" />
					</div>
					<div>
						<label class="block text-xs font-bold text-slate-500 mb-1.5 uppercase tracking-wider">Cliente</label>
						<div class="w-full px-4 py-2.5 bg-slate-100 border border-slate-200 rounded-xl text-sm font-medium text-slate-600">
							{proyecto.cliente?.nombre || 'Sin cliente asignado'}
						</div>
					</div>
					<div>
						<label class="block text-xs font-bold text-slate-500 mb-1.5 uppercase tracking-wider">Responsable (Residente)</label>
						<input type="text" bind:value={form.responsable} placeholder="Ej. Ing. Juan Pérez" class="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-orange-500 focus:border-orange-500 outline-none transition-all text-sm font-medium text-slate-800" />
					</div>
					<div>
						<label class="block text-xs font-bold text-slate-500 mb-1.5 uppercase tracking-wider">Tipo de Proyecto</label>
						<select bind:value={form.tip_proyecto} class="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-orange-500 focus:border-orange-500 outline-none transition-all text-sm font-medium text-slate-800">
							<option value="">Sin especificar</option>
							<option value="O">Obra</option>
							<option value="M">Mantenimiento</option>
						</select>
					</div>
					<div class="md:col-span-2">
						<label class="block text-xs font-bold text-slate-500 mb-1.5 uppercase tracking-wider">Descripción</label>
						<textarea rows="3" bind:value={form.descripcion} class="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-orange-500 focus:border-orange-500 outline-none transition-all text-sm font-medium text-slate-800 resize-none"></textarea>
					</div>
				</div>

				<h3 class="text-lg font-bold text-slate-800 mb-4 mt-8 border-b border-slate-100 pb-2">Ubicación</h3>
				<div class="grid grid-cols-1 md:grid-cols-2 gap-6">
					<div class="md:col-span-2">
						<label class="block text-xs font-bold text-slate-500 mb-1.5 uppercase tracking-wider">Dirección</label>
						<input type="text" bind:value={form.ubicacion} class="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-orange-500 focus:border-orange-500 outline-none transition-all text-sm font-medium text-slate-800" />
					</div>
					<div>
						<label class="block text-xs font-bold text-slate-500 mb-1.5 uppercase tracking-wider">Distrito</label>
						<input type="text" bind:value={form.distrito} class="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-orange-500 focus:border-orange-500 outline-none transition-all text-sm font-medium text-slate-800" />
					</div>
					<div>
						<label class="block text-xs font-bold text-slate-500 mb-1.5 uppercase tracking-wider">Provincia</label>
						<input type="text" bind:value={form.provincia} class="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-orange-500 focus:border-orange-500 outline-none transition-all text-sm font-medium text-slate-800" />
					</div>
					<div>
						<label class="block text-xs font-bold text-slate-500 mb-1.5 uppercase tracking-wider">Departamento</label>
						<input type="text" bind:value={form.departamento} class="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-orange-500 focus:border-orange-500 outline-none transition-all text-sm font-medium text-slate-800" />
					</div>
					<div>
						<label class="block text-xs font-bold text-slate-500 mb-1.5 uppercase tracking-wider">Estado del Predio</label>
						<input type="text" bind:value={form.estado_predio} class="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-orange-500 focus:border-orange-500 outline-none transition-all text-sm font-medium text-slate-800" />
					</div>
					<div>
						<label class="block text-xs font-bold text-slate-500 mb-1.5 uppercase tracking-wider">Tipo de Edificación</label>
						<input type="text" bind:value={form.tipo_edifica} class="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-orange-500 focus:border-orange-500 outline-none transition-all text-sm font-medium text-slate-800" />
					</div>
					<div>
						<label class="block text-xs font-bold text-slate-500 mb-1.5 uppercase tracking-wider">Nro. Pisos</label>
						<input type="number" bind:value={form.nro_pisos} class="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-orange-500 focus:border-orange-500 outline-none transition-all text-sm font-medium text-slate-800" />
					</div>
					<div>
						<label class="block text-xs font-bold text-slate-500 mb-1.5 uppercase tracking-wider">Área Terreno (m²)</label>
						<input type="number" bind:value={form.area_terreno} class="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-orange-500 focus:border-orange-500 outline-none transition-all text-sm font-medium text-slate-800" />
					</div>
					<div>
						<label class="block text-xs font-bold text-slate-500 mb-1.5 uppercase tracking-wider">Área Construida (m²)</label>
						<input type="number" bind:value={form.area_construida} class="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-orange-500 focus:border-orange-500 outline-none transition-all text-sm font-medium text-slate-800" />
					</div>
				</div>

				<h3 class="text-lg font-bold text-slate-800 mb-4 mt-8 border-b border-slate-100 pb-2">Planificación y Costos</h3>
				<div class="grid grid-cols-1 md:grid-cols-3 gap-6">
					<div>
						<label class="block text-xs font-bold text-slate-500 mb-1.5 uppercase tracking-wider">Fecha Inicio Plan.</label>
						<input type="date" bind:value={form.fecha_inicio_plan} class="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-orange-500 focus:border-orange-500 outline-none transition-all text-sm font-medium text-slate-800" />
					</div>
					<div>
						<label class="block text-xs font-bold text-slate-500 mb-1.5 uppercase tracking-wider">Fecha Fin Plan.</label>
						<input type="date" bind:value={form.fecha_fin_plan} class="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-orange-500 focus:border-orange-500 outline-none transition-all text-sm font-medium text-slate-800" />
					</div>
					<div>
						<label class="block text-xs font-bold text-slate-500 mb-1.5 uppercase tracking-wider">Duración (semanas)</label>
						<input type="number" bind:value={form.duracion_semanas} class="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-orange-500 focus:border-orange-500 outline-none transition-all text-sm font-medium text-slate-800" />
					</div>
					<div>
						<label class="block text-xs font-bold text-slate-500 mb-1.5 uppercase tracking-wider">Costo Estimado (S/)</label>
						<input type="number" bind:value={form.costo_estima} class="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-orange-500 focus:border-orange-500 outline-none transition-all text-sm font-medium text-slate-800" />
					</div>
					<div>
						<label class="block text-xs font-bold text-slate-500 mb-1.5 uppercase tracking-wider">Precio Venta (S/)</label>
						<input type="number" bind:value={form.precio_venta} class="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-orange-500 focus:border-orange-500 outline-none transition-all text-sm font-medium text-slate-800" />
					</div>
				</div>

				<h3 class="text-lg font-bold text-slate-800 mb-4 mt-8 border-b border-slate-100 pb-2">Documento del Proyecto</h3>
				<p class="text-xs text-slate-400 -mt-2 mb-4">Proforma o contrato firmado — sube uno nuevo para reemplazar el actual.</p>
				<div class="flex items-center gap-4 p-4 bg-slate-50 border border-slate-200 rounded-xl">
					{#if proyecto.contrato}
						<button
							type="button"
							onclick={abrirPreviewContrato}
							class="w-14 h-14 rounded-xl bg-white border border-slate-200 flex items-center justify-center text-orange-500 text-xl shrink-0 hover:border-orange-300 transition-colors"
							title="Previsualizar documento"
						>
							<i class="fas fa-file-lines"></i>
						</button>
						<div class="flex-1 min-w-0">
							<p class="text-sm font-semibold text-slate-700">Documento cargado</p>
							<button type="button" onclick={abrirPreviewContrato} class="text-xs text-orange-600 hover:underline font-medium">
								Ver previsualización
							</button>
						</div>
					{:else}
						<div class="w-14 h-14 rounded-xl bg-white border border-dashed border-slate-300 flex items-center justify-center text-slate-300 text-xl shrink-0">
							<i class="fas fa-file-circle-plus"></i>
						</div>
						<div class="flex-1 min-w-0">
							<p class="text-sm font-semibold text-slate-500">Sin documento cargado</p>
							<p class="text-xs text-slate-400">Sube la proforma o el contrato en PDF o imagen.</p>
						</div>
					{/if}

					<label class="px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-xl text-sm font-medium transition-colors cursor-pointer shrink-0 flex items-center gap-2 {contratoUploading ? 'opacity-60 pointer-events-none' : ''}">
						{#if contratoUploading}
							<i class="fas fa-circle-notch fa-spin"></i> Subiendo…
						{:else}
							<i class="fas fa-upload"></i> {proyecto.contrato ? 'Reemplazar' : 'Subir documento'}
						{/if}
						<input type="file" accept="application/pdf,image/*" class="hidden" onchange={onContratoFileChange} disabled={contratoUploading} />
					</label>
				</div>

				<p class="text-[11px] text-slate-400 mt-6">
					Registrado por {proyecto.usuario_registro || '—'} · Creado {proyecto.created_at ? new Date(proyecto.created_at).toLocaleDateString('es-PE') : '—'} · Actualizado {proyecto.updated_at ? new Date(proyecto.updated_at).toLocaleDateString('es-PE') : '—'}
				</p>
			</div>
		{/if}

		{#if activeTab === 'partidas'}
			<div class="animate-in fade-in duration-300">
				<PresupuestoTab
					projectId={proyecto.id_proyecto}
					{proyecto}
				/>
			</div>
		{/if}

		{#if activeTab === 'gestion'}
			<div class="animate-in fade-in duration-300">
				<GanttTab
					projectId={proyecto.id_proyecto}
					{proyecto}
				/>
			</div>
		{/if}


		{#if activeTab === 'documentos'}
			<DocumentosTab
				projectId={proyecto.id_proyecto}
				projectName={proyecto.nombre_proyecto}
			/>
		{/if}

	</div>

	<!-- Previsualización del documento del proyecto (proforma / contrato) -->
	{#if showContratoPreview && proyecto?.contrato}
		<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
		<div
			class="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4"
			onclick={(e) => { if (e.target === e.currentTarget) showContratoPreview = false; }}
		>
			<div class="bg-white rounded-2xl shadow-2xl w-full max-w-4xl h-[85vh] flex flex-col">
				<div class="flex items-center justify-between p-5 border-b border-slate-100">
					<h4 class="text-base font-bold text-slate-800">Documento del Proyecto</h4>
					<button
						onclick={() => showContratoPreview = false}
						class="w-8 h-8 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-500 flex items-center justify-center transition-colors"
					>
						<i class="fas fa-times"></i>
					</button>
				</div>
				<div class="flex-1 min-h-0 p-5">
					{#if contratoPreviewUrl}
						<iframe
							src={contratoPreviewUrl}
							title="Documento del proyecto"
							class="w-full h-full border-none rounded-xl border border-slate-200 shadow-sm"
							allowfullscreen
						></iframe>
					{:else}
						<div class="flex flex-col items-center justify-center py-14 border-2 border-dashed border-slate-200 rounded-xl text-center">
							<i class="fas fa-file-lines text-4xl text-slate-300 mb-3"></i>
							<p class="text-sm font-semibold text-slate-600 mb-1">Vista previa no disponible</p>
							<p class="text-xs text-slate-400 mb-5">Ábrelo directamente para verlo.</p>
						</div>
					{/if}
				</div>
				<div class="p-4 border-t border-slate-100 flex justify-between items-center">
					<a
						href={proyecto.contrato}
						target="_blank"
						rel="noopener noreferrer"
						class="text-xs text-orange-600 hover:underline font-medium flex items-center gap-1.5"
					>
						<i class="fas fa-arrow-up-right-from-square"></i> Abrir en una pestaña nueva
					</a>
					<button
						onclick={() => showContratoPreview = false}
						class="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-sm font-medium transition-colors"
					>
						Cerrar
					</button>
				</div>
			</div>
		</div>
	{/if}
{/if}
