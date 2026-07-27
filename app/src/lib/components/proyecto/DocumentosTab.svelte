<script lang="ts">
    import { onMount } from 'svelte';
    import { supabase } from '$lib/supabaseClient';
    import { resolveApiUrl, parseJsonResponse } from '$lib/apiClient';
    import { isRunningInTauri, uploadToDriveClient } from '$lib/driveUploadClient';
    import { generateUniqueFileName } from '$lib/shared/fileNaming';

    const { projectId, projectName = 'Proyecto' } = $props<{
        projectId: number | string;
        projectName?: string;
    }>();

    type DocEstado = 'borrador' | 'revision' | 'aprobado' | 'rechazado';

    interface DocumentoProyecto {
        id_documento: number;
        id_proyecto: number;
        nombre: string;
        tipo_documento: string;
        descripcion: string | null;
        version: string;
        estado: DocEstado;
        storage_path: string | null;
        storage_url: string | null;
        file_size: number | null;
        file_type: string | null;
        creado_por: string | null;
        responsable: string | null;
        created_at: string;
        updated_at: string;
    }

    const TIPOS_DOC = [
        'Project Charter', 'Planos Arquitectura', 'Planos Estructurales',
        'Memoria Descriptiva', 'Especificaciones Técnicas', 'Contrato',
        'Proforma', 'Presupuesto', 'Cronograma', 'Otro',
    ];

    const DOC_TABS = [
        { key: 'contenido',    label: 'Contenido',    icon: 'fas fa-file-alt' },
        { key: 'aprobaciones', label: 'Aprobaciones', icon: 'fas fa-check-double' },
        { key: 'versiones',    label: 'Versiones',    icon: 'fas fa-history' },
        { key: 'historial',    label: 'Historial',    icon: 'fas fa-clock' },
    ] as const;

    let documentos        = $state<DocumentoProyecto[]>([]);
    let selectedDoc       = $state<DocumentoProyecto | null>(null);
    let activeDocTab      = $state<'contenido' | 'aprobaciones' | 'versiones' | 'historial'>('contenido');
    let showUploadModal   = $state(false);
    let isLoadingDocs     = $state(false);
    let isUploading       = $state(false);
    let confirmDeleteDoc  = $state<DocumentoProyecto | null>(null);

    // upload form
    let uploadFile        = $state<File | null>(null);
    let uploadNombre      = $state('');
    let uploadTipo        = $state('Project Charter');
    let uploadDescripcion = $state('');
    let uploadResponsable = $state('');
    let uploadError       = $state('');
    let searchQuery       = $state('');
    let filterEstado      = $state('');
    let isDragging        = $state(false);

const PROJECT_DOCUMENTS_BUCKET = 'project-documents';
const useGoogleDriveDocuments = true; // GOOGLE_DRIVE_FOLDER_ID_DOCUMENTOS is configured server-side

async function uploadDocumentToDrive(file: File, tipo: string, nombre: string) {
    console.log(`[DocumentosTab] uploadDocumentToDrive() - tipo: ${tipo}, inTauri: ${isRunningInTauri()}`);

    if (isRunningInTauri()) {
        // adapter-static: no server endpoint available — upload directly from the WebView
        const fileName = generateUniqueFileName(`documento_${tipo}_${nombre}_${projectName}`, file.name);
        const { url } = await uploadToDriveClient(file, fileName, 'documento');
        console.log(`[DocumentosTab] ✓ Tauri upload OK. URL: ${url}`);
        return { url, fileName };
    }

    // Web: delegate to the SvelteKit server endpoint
    const formData = new FormData();
    formData.append('file', file);
    formData.append('type', 'documento');
    formData.append('projectId', String(projectId));
    formData.append('documentType', tipo);
    formData.append('documentName', nombre);
    formData.append('projectName', projectName);

    const response = await fetch(resolveApiUrl('/api/upload-document'), {
        method: 'POST',
        body: formData
    });

    const result = await parseJsonResponse(response);
    if (!response.ok || !result.success) {
        throw new Error(result.details || result.error || 'Error al subir documento a Google Drive.');
    }

    console.log(`[DocumentosTab] ✓ Server upload OK. URL: ${result.url}`);
    return { url: result.url as string, fileName: result.fileName as string };
}

    const filteredDocs = $derived(documentos.filter(d => {
        if (filterEstado && d.estado !== filterEstado) return false;
        if (searchQuery && !d.nombre.toLowerCase().includes(searchQuery.toLowerCase())) return false;
        return true;
    }));

    async function loadDocumentos() {
        isLoadingDocs = true;
        const { data, error } = await supabase
            .from('documento_proyecto')
            .select('*')
            .eq('id_proyecto', projectId)
            .order('created_at', { ascending: false });
        isLoadingDocs = false;
        if (!error && data) documentos = data as DocumentoProyecto[];
    }

    async function handleUpload() {
        if (!uploadNombre.trim()) { uploadError = 'El nombre es requerido.'; return; }
        isUploading = true;
        uploadError = '';

        let storagePath: string | null = null;
        let storageUrl: string | null  = null;
        let fileSize: number | null    = null;
        let fileType: string | null    = null;

        if (uploadFile) {
            const originalName = uploadFile.name;
            fileSize = uploadFile.size;
            fileType = uploadFile.type;

            if (useGoogleDriveDocuments) {
                try {
                    const result = await uploadDocumentToDrive(uploadFile, uploadTipo, uploadNombre || originalName.replace(/\.[^.]+$/, ''));
                    storagePath = result.fileName;
                    storageUrl = result.url;
                } catch (err) {
                    uploadError = err instanceof Error ? err.message : 'Error al subir a Google Drive.';
                    isUploading = false;
                    return;
                }
            } else {
                const documentFileName = generateUniqueFileName(`documento_${uploadTipo}_${uploadNombre}_${projectName}`, originalName);
                storagePath = `${projectId}/${documentFileName}`;

                const { error: se } = await supabase.storage
                    .from(PROJECT_DOCUMENTS_BUCKET)
                    .upload(storagePath, uploadFile, { cacheControl: '3600', upsert: false });

                if (se) {
                    uploadError = `Error al subir archivo: ${se.message}`;
                    isUploading = false;
                    return;
                }

                const { data: urlData } = supabase.storage
                    .from(PROJECT_DOCUMENTS_BUCKET)
                    .getPublicUrl(storagePath);
                storageUrl = urlData?.publicUrl ?? null;
            }
        }

        const { error: de } = await supabase.from('documento_proyecto').insert({
            id_proyecto:    Number(projectId),
            nombre:         uploadNombre.trim(),
            tipo_documento: uploadTipo,
            descripcion:    uploadDescripcion.trim() || null,
            version:        'V1.0',
            estado:         'borrador',
            storage_path:   storagePath,
            storage_url:    storageUrl,
            file_size:      fileSize,
            file_type:      fileType,
            creado_por:     uploadResponsable.trim() || null,
            responsable:    uploadResponsable.trim() || null,
        });

        isUploading = false;
        if (de) { uploadError = `Error al guardar: ${de.message}`; return; }

        showUploadModal = false;
        await loadDocumentos();
    }

    async function handleDelete(doc: DocumentoProyecto) {
        if (doc.storage_path && !useGoogleDriveDocuments) {
            await supabase.storage.from(PROJECT_DOCUMENTS_BUCKET).remove([doc.storage_path]);
        }
        await supabase.from('documento_proyecto').delete().eq('id_documento', doc.id_documento);
        if (selectedDoc?.id_documento === doc.id_documento) selectedDoc = null;
        confirmDeleteDoc = null;
        await loadDocumentos();
    }

    async function changeEstado(doc: DocumentoProyecto, newEstado: DocEstado) {
        const { data, error } = await supabase
            .from('documento_proyecto')
            .update({ estado: newEstado })
            .eq('id_documento', doc.id_documento)
            .select()
            .single();
        if (!error && data) {
            const updated = data as DocumentoProyecto;
            documentos = documentos.map(d => d.id_documento === updated.id_documento ? updated : d);
            if (selectedDoc?.id_documento === updated.id_documento) selectedDoc = updated;
        }
    }

    function fileIcon(ft: string | null): string {
        if (!ft) return 'fas fa-file';
        if (ft.includes('pdf'))                                        return 'fas fa-file-pdf';
        if (ft.includes('image'))                                      return 'fas fa-file-image';
        if (ft.includes('word') || ft.includes('document'))            return 'fas fa-file-word';
        if (ft.includes('excel') || ft.includes('spreadsheet'))        return 'fas fa-file-excel';
        if (ft.includes('powerpoint') || ft.includes('presentation'))  return 'fas fa-file-powerpoint';
        if (ft.includes('zip') || ft.includes('rar'))                  return 'fas fa-file-archive';
        return 'fas fa-file';
    }

    function fileIconColor(ft: string | null): string {
        if (!ft) return 'text-slate-400';
        if (ft.includes('pdf'))                                        return 'text-rose-500';
        if (ft.includes('image'))                                      return 'text-blue-500';
        if (ft.includes('word') || ft.includes('document'))            return 'text-blue-700';
        if (ft.includes('excel') || ft.includes('spreadsheet'))        return 'text-green-600';
        if (ft.includes('powerpoint') || ft.includes('presentation'))  return 'text-orange-600';
        return 'text-slate-400';
    }

    function estadoBadge(estado: DocEstado): string {
        const map: Record<DocEstado, string> = {
            borrador:  'bg-slate-100 text-slate-600 border-slate-200',
            revision:  'bg-amber-100 text-amber-700 border-amber-200',
            aprobado:  'bg-emerald-100 text-emerald-700 border-emerald-200',
            rechazado: 'bg-rose-100 text-rose-700 border-rose-200',
        };
        return map[estado] ?? 'bg-slate-100 text-slate-600 border-slate-200';
    }

    function estadoLabel(estado: DocEstado): string {
        const map: Record<DocEstado, string> = {
            borrador:  'Borrador',
            revision:  'En Revisión',
            aprobado:  'Aprobado',
            rechazado: 'Rechazado',
        };
        return map[estado] ?? estado;
    }

    function fmtSize(b: number | null): string {
        if (!b) return '';
        if (b < 1024)           return `${b} B`;
        if (b < 1024 * 1024)    return `${(b / 1024).toFixed(1)} KB`;
        return `${(b / (1024 * 1024)).toFixed(1)} MB`;
    }

    function fmtDate(d: string | null | undefined): string {
        if (!d) return '—';
        return new Date(d).toLocaleDateString('es-PE', { day: '2-digit', month: 'short', year: 'numeric' });
    }

    function onFileInput(e: Event) {
        const f = (e.target as HTMLInputElement).files?.[0];
        if (f) {
            uploadFile = f;
            if (!uploadNombre) uploadNombre = f.name.replace(/\.[^.]+$/, '');
        }
    }

    function onDrop(e: DragEvent) {
        e.preventDefault();
        isDragging = false;
        const f = e.dataTransfer?.files[0];
        if (f) {
            uploadFile = f;
            if (!uploadNombre) uploadNombre = f.name.replace(/\.[^.]+$/, '');
        }
    }

    onMount(loadDocumentos);
</script>

<!-- Two-panel layout — escapes parent p-6 padding -->
<div class="-m-6 flex rounded-b-2xl overflow-hidden" style="min-height: 580px;">

    <!-- ══════════════════════════════════════════
         LEFT: Document list panel
    ══════════════════════════════════════════ -->
    <div class="w-64 shrink-0 bg-slate-50/80 border-r border-slate-200 flex flex-col rounded-bl-2xl">

        <!-- Panel header -->
        <div class="p-3 border-b border-slate-200 space-y-2 bg-white rounded-bl-none">
            <div class="flex items-center justify-between">
                <span class="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Documentos</span>
                <button
                    onclick={() => showUploadModal = true}
                    class="flex items-center gap-1 px-2.5 py-1.5 bg-orange-600 hover:bg-orange-700 text-white text-[11px] font-bold rounded-lg transition-colors shadow-sm"
                >
                    <i class="fas fa-plus text-[9px]"></i> Subir
                </button>
            </div>
            <input
                type="text"
                bind:value={searchQuery}
                placeholder="Buscar documento..."
                class="w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg bg-slate-50 focus:outline-none focus:ring-1 focus:ring-orange-400 focus:bg-white transition-colors"
            />
            <select
                bind:value={filterEstado}
                class="w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg bg-slate-50 focus:outline-none focus:ring-1 focus:ring-orange-400 transition-colors"
            >
                <option value="">Todos los estados</option>
                <option value="borrador">Borrador</option>
                <option value="revision">En Revisión</option>
                <option value="aprobado">Aprobado</option>
                <option value="rechazado">Rechazado</option>
            </select>
        </div>

        <!-- Document list -->
        <div class="flex-1 overflow-y-auto p-2 space-y-1">
            {#if isLoadingDocs}
                <div class="flex justify-center py-10 text-orange-500">
                    <i class="fas fa-circle-notch fa-spin text-2xl"></i>
                </div>
            {:else if filteredDocs.length === 0}
                <div class="py-12 text-center px-3">
                    <i class="fas fa-folder-open text-3xl text-slate-300 mb-3 block"></i>
                    <p class="text-xs text-slate-400 font-medium">
                        {searchQuery || filterEstado ? 'Sin resultados' : 'No hay documentos'}
                    </p>
                    {#if !searchQuery && !filterEstado}
                        <button
                            onclick={() => showUploadModal = true}
                            class="mt-3 text-[11px] text-orange-600 hover:text-orange-700 font-semibold underline"
                        >
                            Subir el primero
                        </button>
                    {/if}
                </div>
            {:else}
                {#each filteredDocs as doc (doc.id_documento)}
                    <button
                        onclick={() => { selectedDoc = doc; activeDocTab = 'contenido'; }}
                        class="w-full text-left p-2.5 rounded-xl transition-all border {selectedDoc?.id_documento === doc.id_documento ? 'bg-orange-50 border-orange-300 shadow-sm' : 'bg-white border-transparent hover:border-slate-200 hover:shadow-sm'}"
                    >
                        <div class="flex items-start gap-2">
                            <i class="{fileIcon(doc.file_type)} {fileIconColor(doc.file_type)} text-lg mt-0.5 w-5 shrink-0 text-center"></i>
                            <div class="min-w-0 flex-1">
                                <p class="text-xs font-semibold text-slate-800 truncate leading-snug">{doc.nombre}</p>
                                <p class="text-[10px] text-slate-400 truncate mt-0.5">{doc.tipo_documento}</p>
                                <div class="flex items-center gap-1.5 mt-1.5 flex-wrap">
                                    <span class="px-1.5 py-0.5 rounded text-[9px] font-bold border {estadoBadge(doc.estado)}">{estadoLabel(doc.estado)}</span>
                                    {#if doc.file_size}
                                        <span class="text-[9px] text-slate-400">{fmtSize(doc.file_size)}</span>
                                    {/if}
                                </div>
                            </div>
                        </div>
                    </button>
                {/each}
            {/if}
        </div>

        <!-- Count footer -->
        <div class="p-2.5 border-t border-slate-200 text-[10px] text-slate-400 text-center bg-white rounded-bl-2xl">
            {filteredDocs.length} de {documentos.length} documento{documentos.length !== 1 ? 's' : ''}
        </div>
    </div>

    <!-- ══════════════════════════════════════════
         RIGHT: Document detail / empty state
    ══════════════════════════════════════════ -->
    <div class="flex-1 min-w-0 flex flex-col bg-white">

        {#if !selectedDoc}
            <!-- Empty state -->
            <div class="flex-1 flex flex-col items-center justify-center p-10 text-center">
                <div class="w-20 h-20 bg-orange-50 rounded-full flex items-center justify-center mx-auto mb-5 border border-orange-100 shadow-inner">
                    <i class="fas fa-file-alt text-3xl text-orange-400"></i>
                </div>
                <h3 class="text-base font-bold text-slate-800 mb-2">Selecciona un documento</h3>
                <p class="text-sm text-slate-500 max-w-xs mb-6 leading-relaxed">
                    Elige un documento de la lista para ver su contenido, estado de aprobación y detalles.
                </p>
                <button
                    onclick={() => showUploadModal = true}
                    class="px-5 py-2.5 bg-orange-600 hover:bg-orange-700 text-white rounded-xl font-bold text-sm transition-colors shadow-md shadow-orange-600/15 flex items-center gap-2"
                >
                    <i class="fas fa-upload"></i> Subir primer documento
                </button>
            </div>

        {:else}
            <!-- Document detail -->
            <div class="flex flex-col h-full">

                <!-- Breadcrumb -->
                <div class="flex items-center gap-1.5 px-5 pt-4 pb-1 text-xs text-slate-400 flex-wrap">
                    <button
                        onclick={() => selectedDoc = null}
                        class="hover:text-orange-600 transition-colors"
                    >{projectName}</button>
                    <i class="fas fa-chevron-right text-[8px]"></i>
                    <button
                        onclick={() => selectedDoc = null}
                        class="hover:text-orange-600 transition-colors"
                    >Documentos</button>
                    <i class="fas fa-chevron-right text-[8px]"></i>
                    <span class="text-slate-600 font-medium truncate max-w-[200px]">{selectedDoc.nombre}</span>
                </div>

                <!-- Document header -->
                <div class="px-5 pt-2 pb-3 border-b border-slate-100">
                    <div class="flex items-start justify-between gap-3">
                        <div class="min-w-0">
                            <div class="flex items-center gap-2 mb-1 flex-wrap">
                                <h3 class="text-xl font-bold text-slate-800 leading-tight">{selectedDoc.nombre}</h3>
                                <span class="shrink-0 px-2 py-0.5 rounded-md bg-blue-100 text-blue-700 text-[11px] font-bold border border-blue-200">{selectedDoc.version}</span>
                                <span class="shrink-0 px-2 py-0.5 rounded-md text-[11px] font-bold border {estadoBadge(selectedDoc.estado)}">{estadoLabel(selectedDoc.estado)}</span>
                            </div>
                            <div class="flex items-center gap-2.5 text-xs text-slate-500 flex-wrap">
                                <span class="flex items-center gap-1"><i class="fas fa-tag text-slate-400 text-[10px]"></i>{selectedDoc.tipo_documento}</span>
                                {#if selectedDoc.creado_por}
                                    <span class="text-slate-300">·</span>
                                    <span class="flex items-center gap-1"><i class="fas fa-user text-slate-400 text-[10px]"></i>{selectedDoc.creado_por}</span>
                                {/if}
                                <span class="text-slate-300">·</span>
                                <span class="flex items-center gap-1"><i class="fas fa-calendar-alt text-slate-400 text-[10px]"></i>{fmtDate(selectedDoc.created_at)}</span>
                            </div>
                        </div>
                        <div class="flex items-center gap-2 shrink-0">
                            {#if selectedDoc.storage_url}
                                <a
                                    href={selectedDoc.storage_url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    class="px-3 py-1.5 bg-white border border-slate-200 hover:border-slate-300 hover:shadow-sm text-slate-700 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5"
                                >
                                    <i class="fas fa-download text-slate-500"></i> Descargar
                                </a>
                            {/if}
                            <button
                                onclick={() => { if (selectedDoc) confirmDeleteDoc = selectedDoc; }}
                                class="px-3 py-1.5 bg-white border border-slate-200 hover:border-rose-300 hover:text-rose-600 hover:bg-rose-50 text-slate-500 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5"
                                title="Eliminar documento"
                            >
                                <i class="fas fa-trash-alt"></i>
                            </button>
                        </div>
                    </div>
                </div>

                <!-- Sub-tabs -->
                <div class="px-5 border-b border-slate-100 flex">
                    {#each DOC_TABS as t}
                        <button
                            onclick={() => activeDocTab = t.key}
                            class="px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors whitespace-nowrap {activeDocTab === t.key ? 'text-orange-600 border-orange-600' : 'text-slate-500 border-transparent hover:text-slate-700 hover:border-slate-300'}"
                        >
                            <i class="{t.icon} mr-1.5"></i>{t.label}
                        </button>
                    {/each}
                </div>

                <!-- Tab content (scrollable inner area) -->
                <div class="flex-1 min-h-0 overflow-hidden flex">

                    <!-- ─── CONTENIDO ─── -->
                    {#if activeDocTab === 'contenido'}
                        <!-- Preview -->
                        <div class="flex-1 min-w-0 overflow-y-auto p-4 space-y-3">
                            {#if selectedDoc.storage_url && selectedDoc.file_type?.includes('image')}
                                <img
                                    src={selectedDoc.storage_url}
                                    alt={selectedDoc.nombre}
                                    class="max-w-full rounded-xl border border-slate-200 shadow-sm"
                                />
                            {:else if selectedDoc.storage_url && selectedDoc.file_type?.includes('pdf')}
                                <iframe
                                    src={selectedDoc.storage_url}
                                    title={selectedDoc.nombre}
                                    class="w-full rounded-xl border border-slate-200 shadow-sm"
                                    style="height: 480px;"
                                ></iframe>
                            {:else if selectedDoc.storage_url}
                                <div class="flex flex-col items-center justify-center py-14 border-2 border-dashed border-slate-200 rounded-xl text-center">
                                    <i class="{fileIcon(selectedDoc.file_type)} {fileIconColor(selectedDoc.file_type)} text-5xl mb-4"></i>
                                    <p class="text-sm font-semibold text-slate-700 mb-1">{selectedDoc.nombre}</p>
                                    <p class="text-xs text-slate-400 mb-5">Vista previa no disponible para este tipo de archivo</p>
                                    <a
                                        href={selectedDoc.storage_url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        class="px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-lg text-sm font-semibold transition-colors flex items-center gap-2"
                                    >
                                        <i class="fas fa-download"></i> Descargar archivo
                                    </a>
                                </div>
                            {:else}
                                <div class="flex flex-col items-center justify-center py-14 border-2 border-dashed border-slate-200 rounded-xl text-center">
                                    <i class="fas fa-paperclip text-4xl text-slate-300 mb-3"></i>
                                    <p class="text-sm font-semibold text-slate-600 mb-1">Sin archivo adjunto</p>
                                    <p class="text-xs text-slate-400">Este documento no tiene archivo subido aún.</p>
                                </div>
                            {/if}

                            {#if selectedDoc.descripcion}
                                <div class="p-3.5 bg-slate-50 rounded-xl border border-slate-200">
                                    <p class="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">Descripción</p>
                                    <p class="text-sm text-slate-700 leading-relaxed">{selectedDoc.descripcion}</p>
                                </div>
                            {/if}
                        </div>

                        <!-- Info sidebar -->
                        <div class="w-56 shrink-0 border-l border-slate-100 overflow-y-auto p-4 space-y-5 bg-slate-50/40">

                            <!-- Document info -->
                            <div>
                                <p class="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2.5">Información</p>
                                <dl class="space-y-2.5">
                                    <div>
                                        <dt class="text-[10px] text-slate-400 mb-0.5">Tipo</dt>
                                        <dd class="text-xs font-semibold text-slate-700">{selectedDoc.tipo_documento}</dd>
                                    </div>
                                    <div>
                                        <dt class="text-[10px] text-slate-400 mb-0.5">Estado</dt>
                                        <dd><span class="px-2 py-0.5 rounded text-[10px] font-bold border {estadoBadge(selectedDoc.estado)}">{estadoLabel(selectedDoc.estado)}</span></dd>
                                    </div>
                                    <div>
                                        <dt class="text-[10px] text-slate-400 mb-0.5">Versión</dt>
                                        <dd class="text-xs font-semibold text-slate-700">{selectedDoc.version}</dd>
                                    </div>
                                    <div>
                                        <dt class="text-[10px] text-slate-400 mb-0.5">Creado</dt>
                                        <dd class="text-xs text-slate-600">{fmtDate(selectedDoc.created_at)}</dd>
                                    </div>
                                    {#if selectedDoc.responsable}
                                        <div>
                                            <dt class="text-[10px] text-slate-400 mb-0.5">Responsable</dt>
                                            <dd class="text-xs font-semibold text-slate-700">{selectedDoc.responsable}</dd>
                                        </div>
                                    {/if}
                                    {#if selectedDoc.file_size}
                                        <div>
                                            <dt class="text-[10px] text-slate-400 mb-0.5">Tamaño</dt>
                                            <dd class="text-xs text-slate-600">{fmtSize(selectedDoc.file_size)}</dd>
                                        </div>
                                    {/if}
                                </dl>
                            </div>

                            <!-- Approval flow -->
                            <div>
                                <p class="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2.5">Flujo de Aprobación</p>
                                <div class="space-y-2.5">
                                    {#each [
                                        { label: 'Elaboración', done: true, active: false, icon: 'fas fa-pencil-alt' },
                                        { label: 'Revisión', done: selectedDoc.estado === 'aprobado', active: selectedDoc.estado === 'revision', icon: 'fas fa-search' },
                                        { label: 'Aprobación', done: selectedDoc.estado === 'aprobado', active: false, icon: 'fas fa-check-double' },
                                        { label: 'Publicación', done: false, active: false, icon: 'fas fa-share-square' },
                                    ] as step}
                                        <div class="flex items-center gap-2">
                                            <div class="w-6 h-6 rounded-full flex items-center justify-center text-[10px] shrink-0 border {step.done ? 'bg-emerald-100 text-emerald-600 border-emerald-300' : step.active ? 'bg-orange-100 text-orange-600 border-orange-300' : 'bg-slate-100 text-slate-400 border-slate-200'}">
                                                <i class="{step.done ? 'fas fa-check' : step.icon}"></i>
                                            </div>
                                            <span class="text-xs {step.done ? 'text-emerald-700 font-semibold' : step.active ? 'text-orange-600 font-semibold' : 'text-slate-400'}">{step.label}</span>
                                        </div>
                                    {/each}
                                </div>
                            </div>

                            <!-- Quick actions -->
                            <div>
                                <p class="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2.5">Acciones Rápidas</p>
                                <div class="space-y-1.5">
                                    {#if selectedDoc.estado === 'borrador'}
                                        <button
                                            onclick={() => selectedDoc && changeEstado(selectedDoc, 'revision')}
                                            class="w-full text-left px-3 py-2 text-xs font-semibold text-amber-700 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-lg transition-colors flex items-center gap-2"
                                        >
                                            <i class="fas fa-paper-plane w-3.5 text-center"></i> Enviar a revisión
                                        </button>
                                    {/if}
                                    {#if selectedDoc.estado === 'revision'}
                                        <button
                                            onclick={() => selectedDoc && changeEstado(selectedDoc, 'aprobado')}
                                            class="w-full text-left px-3 py-2 text-xs font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg transition-colors flex items-center gap-2"
                                        >
                                            <i class="fas fa-check-circle w-3.5 text-center"></i> Aprobar
                                        </button>
                                        <button
                                            onclick={() => selectedDoc && changeEstado(selectedDoc, 'rechazado')}
                                            class="w-full text-left px-3 py-2 text-xs font-semibold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-lg transition-colors flex items-center gap-2"
                                        >
                                            <i class="fas fa-times-circle w-3.5 text-center"></i> Rechazar
                                        </button>
                                    {/if}
                                    {#if selectedDoc.estado === 'rechazado' || selectedDoc.estado === 'aprobado'}
                                        <button
                                            onclick={() => selectedDoc && changeEstado(selectedDoc, 'borrador')}
                                            class="w-full text-left px-3 py-2 text-xs font-semibold text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg transition-colors flex items-center gap-2"
                                        >
                                            <i class="fas fa-undo w-3.5 text-center"></i> Volver a borrador
                                        </button>
                                    {/if}
                                    {#if selectedDoc.storage_url}
                                        <a
                                            href={selectedDoc.storage_url}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            class="w-full text-left px-3 py-2 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg transition-colors flex items-center gap-2"
                                        >
                                            <i class="fas fa-download w-3.5 text-center"></i> Descargar
                                        </a>
                                    {/if}
                                    <button
                                        onclick={() => { if (selectedDoc) confirmDeleteDoc = selectedDoc; }}
                                        class="w-full text-left px-3 py-2 text-xs font-semibold text-rose-600 bg-white hover:bg-rose-50 border border-rose-200 rounded-lg transition-colors flex items-center gap-2"
                                    >
                                        <i class="fas fa-trash-alt w-3.5 text-center"></i> Eliminar
                                    </button>
                                </div>
                            </div>
                        </div>

                    <!-- ─── APROBACIONES ─── -->
                    {:else if activeDocTab === 'aprobaciones'}
                        <div class="flex-1 overflow-y-auto p-6">
                            <h4 class="text-sm font-bold text-slate-700 mb-5">Flujo de Aprobación</h4>
                            <div class="max-w-md space-y-0">
                                {#each [
                                    { step: 1, label: 'Elaboración', desc: 'Documento creado y preparado para revisión', done: true, active: false, icon: 'fas fa-pencil-alt' },
                                    { step: 2, label: 'Revisión Técnica', desc: 'Revisión por el equipo técnico responsable', done: selectedDoc.estado === 'aprobado', active: selectedDoc.estado === 'revision', icon: 'fas fa-search' },
                                    { step: 3, label: 'Aprobación Final', desc: 'Aprobación definitiva por el jefe de proyecto', done: selectedDoc.estado === 'aprobado', active: false, icon: 'fas fa-check-double' },
                                    { step: 4, label: 'Publicación', desc: 'Documento publicado y disponible para el equipo', done: false, active: false, icon: 'fas fa-share-square' },
                                ] as ap, i}
                                    <div class="flex gap-4">
                                        <div class="flex flex-col items-center">
                                            <div class="w-9 h-9 rounded-full flex items-center justify-center text-sm shrink-0 border-2 {ap.done ? 'bg-emerald-600 text-white border-emerald-600' : ap.active ? 'bg-orange-50 text-orange-600 border-orange-400' : 'bg-slate-50 text-slate-400 border-slate-200'}">
                                                {#if ap.done}
                                                    <i class="fas fa-check text-xs"></i>
                                                {:else}
                                                    <span class="text-xs font-bold">{ap.step}</span>
                                                {/if}
                                            </div>
                                            {#if i < 3}
                                                <div class="w-0.5 h-10 {ap.done ? 'bg-emerald-400' : 'bg-slate-200'}"></div>
                                            {/if}
                                        </div>
                                        <div class="pb-8 pt-1">
                                            <p class="text-sm font-bold {ap.done ? 'text-emerald-700' : ap.active ? 'text-orange-600' : 'text-slate-500'}">{ap.label}</p>
                                            <p class="text-xs text-slate-400 mt-0.5 leading-relaxed">{ap.desc}</p>
                                            {#if ap.active}
                                                <span class="inline-flex items-center gap-1 mt-1.5 px-2 py-0.5 bg-orange-100 text-orange-600 text-[10px] font-bold rounded-full border border-orange-200">
                                                    <i class="fas fa-circle-notch fa-spin text-[8px]"></i> En curso
                                                </span>
                                            {:else if ap.done}
                                                <span class="inline-flex items-center gap-1 mt-1.5 px-2 py-0.5 bg-emerald-100 text-emerald-700 text-[10px] font-bold rounded-full border border-emerald-200">
                                                    <i class="fas fa-check text-[8px]"></i> Completado
                                                </span>
                                            {/if}
                                        </div>
                                    </div>
                                {/each}
                            </div>
                        </div>

                    <!-- ─── VERSIONES ─── -->
                    {:else if activeDocTab === 'versiones'}
                        <div class="flex-1 overflow-y-auto p-6">
                            <h4 class="text-sm font-bold text-slate-700 mb-4">Historial de Versiones</h4>
                            <div class="border border-slate-200 rounded-xl overflow-hidden">
                                <table class="w-full text-xs">
                                    <thead class="bg-slate-50 border-b border-slate-200">
                                        <tr>
                                            <th class="p-3 text-left font-bold text-slate-500 uppercase tracking-wide text-[10px]">Versión</th>
                                            <th class="p-3 text-left font-bold text-slate-500 uppercase tracking-wide text-[10px]">Fecha</th>
                                            <th class="p-3 text-left font-bold text-slate-500 uppercase tracking-wide text-[10px]">Estado</th>
                                            <th class="p-3 text-left font-bold text-slate-500 uppercase tracking-wide text-[10px]">Autor</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        <tr class="border-b border-slate-100 hover:bg-slate-50/50">
                                            <td class="p-3">
                                                <span class="font-bold text-blue-700">{selectedDoc.version}</span>
                                                <span class="ml-1.5 px-1.5 py-0.5 bg-blue-50 text-blue-600 rounded text-[9px] border border-blue-200 font-bold">Actual</span>
                                            </td>
                                            <td class="p-3 text-slate-600">{fmtDate(selectedDoc.updated_at)}</td>
                                            <td class="p-3">
                                                <span class="px-1.5 py-0.5 rounded text-[9px] font-bold border {estadoBadge(selectedDoc.estado)}">{estadoLabel(selectedDoc.estado)}</span>
                                            </td>
                                            <td class="p-3 text-slate-600">{selectedDoc.creado_por || '—'}</td>
                                        </tr>
                                    </tbody>
                                </table>
                            </div>
                            <p class="text-xs text-slate-400 mt-4 text-center">El versionado completo estará disponible próximamente.</p>
                        </div>

                    <!-- ─── HISTORIAL ─── -->
                    {:else if activeDocTab === 'historial'}
                        <div class="flex-1 overflow-y-auto p-6">
                            <h4 class="text-sm font-bold text-slate-700 mb-4">Historial de Actividad</h4>
                            <div class="space-y-3 max-w-lg">
                                <div class="flex items-start gap-3">
                                    <div class="w-8 h-8 bg-orange-100 text-orange-600 rounded-full flex items-center justify-center shrink-0 text-xs mt-0.5">
                                        <i class="fas fa-upload"></i>
                                    </div>
                                    <div>
                                        <p class="text-sm font-semibold text-slate-700">Documento subido</p>
                                        <p class="text-xs text-slate-400">{fmtDate(selectedDoc.created_at)} · {selectedDoc.creado_por || 'Sistema'}</p>
                                    </div>
                                </div>
                                {#if selectedDoc.created_at !== selectedDoc.updated_at}
                                    <div class="flex items-start gap-3">
                                        <div class="w-8 h-8 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center shrink-0 text-xs mt-0.5">
                                            <i class="fas fa-edit"></i>
                                        </div>
                                        <div>
                                            <p class="text-sm font-semibold text-slate-700">Última actualización</p>
                                            <p class="text-xs text-slate-400">{fmtDate(selectedDoc.updated_at)}</p>
                                        </div>
                                    </div>
                                {/if}
                            </div>
                        </div>
                    {/if}

                </div><!-- end tab content -->
            </div><!-- end doc detail -->
        {/if}
    </div><!-- end right panel -->
</div><!-- end two-panel -->


<!-- ══════════════════════════════════════════
     Upload Modal
══════════════════════════════════════════ -->
{#if showUploadModal}
    <div class="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
        <div class="bg-white rounded-2xl shadow-2xl w-full max-w-lg">

            <div class="flex items-center justify-between px-6 py-4 border-b border-slate-200">
                <h2 class="text-base font-bold text-slate-800 flex items-center gap-2">
                    <i class="fas fa-upload text-orange-500"></i> Subir Documento
                </h2>
                <button
                    onclick={() => showUploadModal = false}
                    class="w-8 h-8 rounded-full hover:bg-slate-100 flex items-center justify-center transition-colors"
                >
                    <i class="fas fa-times text-slate-500"></i>
                </button>
            </div>

            <div class="p-6 space-y-4 max-h-[80vh] overflow-y-auto">
                {#if uploadError}
                    <div class="p-3 bg-rose-50 border border-rose-200 rounded-lg text-rose-700 text-sm flex items-start gap-2">
                        <i class="fas fa-exclamation-circle mt-0.5 shrink-0"></i>
                        <span>{uploadError}</span>
                    </div>
                {/if}

                <!-- Drop zone -->
                <div
                    class="border-2 border-dashed rounded-xl p-6 text-center transition-all cursor-pointer select-none {isDragging ? 'border-orange-500 bg-orange-50 scale-[1.01]' : 'border-slate-300 hover:border-orange-400 hover:bg-orange-50/30'}"
                    ondragover={(e) => { e.preventDefault(); isDragging = true; }}
                    ondragleave={() => isDragging = false}
                    ondrop={onDrop}
                    onclick={() => document.getElementById('doc-file-input')?.click()}
                    role="button"
                    tabindex="0"
                    onkeydown={(e) => { if (e.key === 'Enter') document.getElementById('doc-file-input')?.click(); }}
                >
                    <input id="doc-file-input" type="file" class="hidden" oninput={onFileInput} />
                    {#if uploadFile}
                        <i class="{fileIcon(uploadFile.type)} {fileIconColor(uploadFile.type)} text-4xl mb-2 block"></i>
                        <p class="text-sm font-semibold text-slate-700 truncate">{uploadFile.name}</p>
                        <p class="text-xs text-slate-400 mt-0.5">{fmtSize(uploadFile.size)}</p>
                        <button
                            onclick={(e) => { e.stopPropagation(); uploadFile = null; }}
                            class="mt-2 text-xs text-rose-500 hover:text-rose-700 underline"
                        >Quitar archivo</button>
                    {:else}
                        <i class="fas fa-cloud-upload-alt text-4xl text-slate-300 mb-2 block"></i>
                        <p class="text-sm font-semibold text-slate-600">Arrastra tu archivo aquí</p>
                        <p class="text-xs text-slate-400 mt-0.5">o haz clic para seleccionar · PDF, Word, Excel, imágenes…</p>
                    {/if}
                </div>

                <!-- Nombre -->
                <div>
                    <label for="doc-nombre" class="block text-xs font-bold text-slate-600 mb-1">
                        Nombre del documento <span class="text-rose-500">*</span>
                    </label>
                    <input
                        id="doc-nombre"
                        type="text"
                        bind:value={uploadNombre}
                        placeholder="ej: Project Charter v1"
                        class="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 focus:border-orange-400"
                    />
                </div>

                <!-- Tipo -->
                <div>
                    <label for="doc-tipo" class="block text-xs font-bold text-slate-600 mb-1">Tipo de documento</label>
                    <select
                        id="doc-tipo"
                        bind:value={uploadTipo}
                        class="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-orange-400 focus:border-orange-400"
                    >
                        {#each TIPOS_DOC as t}
                            <option value={t}>{t}</option>
                        {/each}
                    </select>
                </div>

                <!-- Responsable -->
                <div>
                    <label for="doc-resp" class="block text-xs font-bold text-slate-600 mb-1">Responsable / Creado por</label>
                    <input
                        id="doc-resp"
                        type="text"
                        bind:value={uploadResponsable}
                        placeholder="ej: Ing. Juan Pérez"
                        class="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 focus:border-orange-400"
                    />
                </div>

                <!-- Descripción -->
                <div>
                    <label for="doc-desc" class="block text-xs font-bold text-slate-600 mb-1">Descripción</label>
                    <textarea
                        id="doc-desc"
                        bind:value={uploadDescripcion}
                        placeholder="Descripción opcional del documento…"
                        rows="2"
                        class="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 focus:border-orange-400 resize-none"
                    ></textarea>
                </div>
            </div>

            <div class="flex gap-2 justify-end px-6 py-4 border-t border-slate-200">
                <button
                    onclick={() => showUploadModal = false}
                    class="px-4 py-2 border border-slate-300 text-slate-700 rounded-lg text-sm font-medium hover:bg-slate-50 transition-colors"
                    disabled={isUploading}
                >
                    Cancelar
                </button>
                <button
                    onclick={handleUpload}
                    class="px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-lg text-sm font-semibold transition-colors flex items-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
                    disabled={isUploading}
                >
                    {#if isUploading}
                        <i class="fas fa-circle-notch fa-spin"></i> Subiendo…
                    {:else}
                        <i class="fas fa-upload"></i> Subir documento
                    {/if}
                </button>
            </div>
        </div>
    </div>
{/if}


<!-- ══════════════════════════════════════════
     Delete Confirm Modal
══════════════════════════════════════════ -->
{#if confirmDeleteDoc}
    <div class="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
        <div class="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 text-center">
            <div class="w-14 h-14 bg-rose-100 rounded-full flex items-center justify-center mx-auto mb-4 border border-rose-200">
                <i class="fas fa-trash-alt text-2xl text-rose-500"></i>
            </div>
            <h3 class="text-base font-bold text-slate-800 mb-2">Eliminar documento</h3>
            <p class="text-sm text-slate-500 mb-6 leading-relaxed">
                ¿Estás seguro de eliminar <span class="font-semibold text-slate-700">"{confirmDeleteDoc.nombre}"</span>?
                El archivo también se eliminará del almacenamiento. Esta acción no se puede deshacer.
            </p>
            <div class="flex gap-3 justify-center">
                <button
                    onclick={() => confirmDeleteDoc = null}
                    class="px-4 py-2 border border-slate-300 text-slate-700 rounded-lg text-sm font-medium hover:bg-slate-50 transition-colors"
                >
                    Cancelar
                </button>
                <button
                    onclick={() => { if (confirmDeleteDoc) handleDelete(confirmDeleteDoc); }}
                    class="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-sm font-semibold transition-colors flex items-center gap-2"
                >
                    <i class="fas fa-trash-alt"></i> Sí, eliminar
                </button>
            </div>
        </div>
    </div>
{/if}
