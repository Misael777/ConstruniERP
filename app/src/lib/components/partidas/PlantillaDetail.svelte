<script lang="ts">
    import {
        selectedPlantilla, selectedPlantillaDetalle, isLoading,
        instanciarPlantilla, proyectosList, currentAuthUserId,
        draggingNode, addPartidaToPlantilla, removePartidaFromPlantilla,
        selectedPartida, countDescendants,
    } from '$lib/stores/partidas';
    import { GripVertical, Plus, Rocket, ArrowLeft, MoveDown, Folder, FileText, X } from '@lucide/svelte';

    let isInstanciando      = $state(false);
    let successMessage      = $state('');
    let errorMsg            = $state('');
    let selectedProyectoId  = $state<number | null>(null);
    let showProyectoSelector = $state(false);
    let isAdding            = $state(false);
    let deletingId          = $state<number | null>(null);

    async function handleInstanciar() {
        if (!$selectedPlantilla) return;
        if (!selectedProyectoId) { showProyectoSelector = true; return; }

        const userId = $currentAuthUserId;
        if (!userId) { errorMsg = 'No hay sesión activa. Recarga la página.'; return; }

        isInstanciando = true;
        successMessage = '';
        errorMsg = '';

        const result = await instanciarPlantilla(
            $selectedPlantilla.id_plantilla,
            selectedProyectoId,
            true,
            false,
            userId
        );

        if (result.success) {
            successMessage = result.message;
            showProyectoSelector = false;
            setTimeout(() => successMessage = '', 4000);
        } else {
            errorMsg = result.message;
        }
        isInstanciando = false;
    }

    async function handleAddSelected() {
        const partida   = $selectedPartida;
        const plantilla = $selectedPlantilla;
        if (!partida || !plantilla) {
            errorMsg = 'Selecciona una partida del catálogo primero.';
            setTimeout(() => errorMsg = '', 3000);
            return;
        }
        isAdding = true;
        errorMsg = '';
        const result = await addPartidaToPlantilla(plantilla.id_plantilla, partida);
        isAdding = false;
        if (result.success) {
            successMessage = result.count > 0
                ? result.message
                : 'Esa partida ya estaba en la plantilla';
            setTimeout(() => successMessage = '', 3000);
        } else {
            errorMsg = result.message;
        }
    }

    async function handleRemove(id_plantilla_detalle: number) {
        const plantilla = $selectedPlantilla;
        if (!plantilla) return;
        deletingId = id_plantilla_detalle;
        const result = await removePartidaFromPlantilla(id_plantilla_detalle, plantilla.id_plantilla);
        deletingId = null;
        if (!result.success) { errorMsg = result.message; setTimeout(() => errorMsg = '', 3000); }
    }

    // Live count of children in the node being dragged (shown in drop zone label)
    let dragChildCount = $derived(
        $draggingNode?.children?.length
            ? countDescendants($draggingNode)
            : 0
    );
</script>

<div class="border-t border-slate-200 p-4 h-[45%] md:h-[50%] bg-[#fafcff] shrink-0 flex flex-col overflow-hidden">
    {#if $selectedPlantilla}
        <div class="font-semibold text-[15px] mb-2.5 text-[#1e293b] truncate">{$selectedPlantilla.nombre}</div>

        <!-- Proyecto selector -->
        {#if showProyectoSelector}
            <div class="mb-3 p-3 bg-blue-50 border border-blue-200 rounded text-[12px]">
                <label class="block font-medium text-[#0f3b5e] mb-1">Selecciona el proyecto destino</label>
                {#if $proyectosList.length === 0}
                    <p class="text-slate-500 italic">No hay proyectos activos disponibles.</p>
                {:else}
                    <select
                        bind:value={selectedProyectoId}
                        class="w-full border border-slate-300 rounded px-2 py-1.5 text-[12px] bg-white focus:outline-none focus:border-[#0f3b5e] mb-2"
                    >
                        <option value={null}>— Elige un proyecto —</option>
                        {#each $proyectosList as p}
                            <option value={p.id_proyecto}>{p.nombre_proyecto}</option>
                        {/each}
                    </select>
                {/if}
                <div class="flex gap-2 mt-1">
                    <button
                        onclick={handleInstanciar}
                        disabled={!selectedProyectoId || isInstanciando}
                        class="bg-[#0f3b5e] text-white px-3 py-1 rounded text-[11px] font-semibold hover:bg-[#1e4a6d] disabled:opacity-50"
                    >
                        {isInstanciando ? 'Procesando...' : 'Confirmar'}
                    </button>
                    <button
                        onclick={() => { showProyectoSelector = false; errorMsg = ''; }}
                        class="bg-slate-200 text-slate-700 px-3 py-1 rounded text-[11px] font-semibold hover:bg-slate-300"
                    >
                        Cancelar
                    </button>
                </div>
            </div>
        {:else}
            <div class="flex flex-wrap gap-1.5 mb-2.5">
                <!-- Fixed "Agregar partida" button -->
                <button
                    onclick={handleAddSelected}
                    disabled={!$selectedPartida || isAdding}
                    class="flex items-center bg-[#0f3b5e] text-white px-3 py-1.5 rounded text-[11px] font-semibold
                           hover:bg-[#1e4a6d] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    title={$selectedPartida
                        ? `Agregar: ${$selectedPartida.descripcion}`
                        : 'Haz clic en una partida del catálogo primero'}
                >
                    {#if isAdding}
                        <span class="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin mr-1.5"></span>
                    {:else}
                        <Plus size={13} class="mr-1.5" />
                    {/if}
                    Agregar partida
                </button>
                <button
                    class="flex items-center bg-[#e2e8f0] text-[#1e293b] px-3 py-1.5 rounded text-[11px] font-semibold hover:bg-[#cbd5e1] transition-colors"
                    onclick={handleInstanciar}
                    disabled={isInstanciando}
                >
                    <Rocket size={13} class="mr-1.5" />
                    {isInstanciando ? 'Procesando...' : 'Instanciar en proyecto'}
                </button>
            </div>
        {/if}

        <!-- Feedback messages -->
        {#if successMessage}
            <div class="text-[11px] text-green-700 mb-2 px-2.5 py-1.5 bg-green-50 rounded border border-green-200">{successMessage}</div>
        {/if}
        {#if errorMsg}
            <div class="text-[11px] text-red-700 mb-2 px-2.5 py-1.5 bg-red-50 rounded border border-red-200">{errorMsg}</div>
        {/if}

        <!-- Partidas list + drop zone -->
        <div class="flex-1 min-h-0 flex flex-col gap-1 overflow-hidden">

            <!-- Existing partidas (scrollable) — shown as tree, sorted by codigo -->
            <div class="flex-1 overflow-y-auto min-h-0">
                {#if $isLoading}
                    <div class="text-[12px] text-slate-500 mt-2 px-2">Cargando partidas...</div>
                {:else if $selectedPlantillaDetalle.length === 0}
                    <div class="text-[12px] text-slate-400 text-center py-3 italic">Sin partidas — agrega desde el catálogo</div>
                {:else}
                    {@const sortedItems = [...$selectedPlantillaDetalle].sort((a, b) =>
                        a.codigo.localeCompare(b.codigo, 'es', { numeric: true })
                    )}
                    {@const inPlantillaIds = new Set(sortedItems.map(i => i.id_partida))}
                    {@const parentIds = new Set(
                        sortedItems.map(i => i.id_partida_padre).filter((id): id is number => id !== null && inPlantillaIds.has(id))
                    )}
                    {#each sortedItems as item}
                        {@const isParent = parentIds.has(item.id_partida)}
                        {@const indent  = ((item.nivel ?? 1) - 1) * 10}
                        {@const isDeleting = deletingId === item.id_plantilla_detalle}
                        <div
                            class="group flex items-center py-1 border-b border-slate-100/80 text-[11px] hover:bg-red-50/40 transition-colors"
                            class:opacity-40={isDeleting}
                            style="padding-left:{indent + 6}px; padding-right:4px"
                        >
                            <!-- Folder / file icon -->
                            <span class="shrink-0 mr-1 {isParent ? 'text-amber-500' : 'text-slate-300'}">
                                {#if isParent}
                                    <Folder size={12} fill="currentColor" />
                                {:else}
                                    <FileText size={12} />
                                {/if}
                            </span>

                            <!-- Code badge -->
                            <span class="font-mono text-[10px] font-bold shrink-0 mr-1.5
                                {isParent ? 'text-amber-600' : 'text-slate-400'}">
                                {item.codigo}
                            </span>

                            <!-- Description -->
                            <span class="flex-1 truncate {isParent ? 'font-semibold text-[#1e293b]' : 'text-[#475569]'}">
                                {item.nombre_partida}
                            </span>

                            <!-- Quantity (leaf only) -->
                            {#if !isParent}
                                <span class="text-[10px] text-slate-400 ml-1 shrink-0 tabular-nums">
                                    {item.cantidad_sugerida?.toFixed(2) ?? '—'}
                                </span>
                            {/if}

                            <!-- Delete button (visible on hover) -->
                            <button
                                onclick={() => handleRemove(item.id_plantilla_detalle)}
                                disabled={isDeleting}
                                class="ml-1 shrink-0 w-5 h-5 rounded flex items-center justify-center
                                       opacity-0 group-hover:opacity-100 transition-opacity
                                       text-slate-300 hover:text-red-500 hover:bg-red-50
                                       disabled:cursor-not-allowed"
                                title="Quitar de la plantilla"
                            >
                                {#if isDeleting}
                                    <span class="w-2.5 h-2.5 border border-slate-300 border-t-slate-600 rounded-full animate-spin"></span>
                                {:else}
                                    <X size={11} />
                                {/if}
                            </button>
                        </div>
                    {/each}
                {/if}
            </div>

            <!-- Drop zone: always visible, highlights while dragging -->
            <div
                data-dropzone="plantilla"
                class="rounded-lg border-2 border-dashed transition-all duration-150 py-2.5 flex items-center justify-center gap-2 shrink-0 select-none
                    {$draggingNode
                        ? 'border-amber-400 bg-amber-50 shadow-inner'
                        : 'border-slate-200 bg-slate-50/60 hover:border-slate-300'}"
            >
                <MoveDown
                    size={14}
                    class="shrink-0 transition-colors {$draggingNode ? 'text-amber-500 animate-bounce' : 'text-slate-300'}"
                />
                <p class="text-[10px] leading-tight text-center transition-colors {$draggingNode ? 'text-amber-700 font-medium' : 'text-slate-400'}">
                    {#if $draggingNode}
                        Suelta aquí · <strong>{$draggingNode.descripcion.slice(0, 22)}{$draggingNode.descripcion.length > 22 ? '…' : ''}</strong>
                        {#if dragChildCount > 0}
                            <span class="ml-0.5 text-amber-600">+ {dragChildCount} hijos</span>
                        {/if}
                    {:else}
                        Arrastra partidas del catálogo aquí
                    {/if}
                </p>
            </div>
        </div>

    {:else}
        <div class="flex flex-col items-center justify-center text-slate-400 h-full py-8">
            <ArrowLeft size={32} class="mb-2" />
            <span class="text-sm text-center">Selecciona una plantilla para ver su detalle</span>
        </div>
    {/if}
</div>
