<script lang="ts">
    import {
        selectedPlantilla, selectedPlantillaDetalle, isLoading,
        instanciarPlantilla, proyectosList, currentAuthUserId,
    } from '$lib/stores/partidas';
    import { GripVertical, Plus, Rocket, ArrowLeft } from '@lucide/svelte';

    let isInstanciando = $state(false);
    let successMessage = $state('');
    let errorMsg = $state('');
    let selectedProyectoId = $state<number | null>(null);
    let showProyectoSelector = $state(false);

    async function handleInstanciar() {
        if (!$selectedPlantilla) return;

        if (!selectedProyectoId) {
            showProyectoSelector = true;
            return;
        }

        const userId = $currentAuthUserId;
        if (!userId) {
            errorMsg = 'No hay sesión activa. Recarga la página.';
            return;
        }

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
</script>

<div class="border-t border-slate-200 p-4 h-[45%] md:h-[50%] overflow-y-auto bg-[#fafcff] shrink-0 flex flex-col">
    {#if $selectedPlantilla}
        <div class="font-semibold text-[15px] mb-3 text-[#1e293b]">{$selectedPlantilla.nombre}</div>

        <!-- Proyecto selector -->
        {#if showProyectoSelector}
            <div class="mb-3 p-3 bg-blue-50 border border-blue-200 rounded text-[12px]">
                <label class="block font-medium text-[#1e293b] mb-1">Selecciona el proyecto destino</label>
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
            <div class="flex gap-2 mb-3">
                <button class="flex items-center bg-[#0f3b5e] text-white px-3 py-1.5 rounded text-[12px] font-semibold hover:bg-[#1e4a6d] transition-colors">
                    <Plus size={14} class="mr-1.5" /> Agregar partida
                </button>
                <button
                    class="flex items-center bg-[#e2e8f0] text-[#1e293b] px-3 py-1.5 rounded text-[12px] font-semibold hover:bg-[#cbd5e1] transition-colors"
                    onclick={handleInstanciar}
                    disabled={isInstanciando}
                >
                    <Rocket size={14} class="mr-1.5" />
                    {isInstanciando ? 'Procesando...' : 'Instanciar en proyecto'}
                </button>
            </div>
        {/if}

        {#if successMessage}
            <div class="text-[12px] text-green-700 mb-2 p-2 bg-green-50 rounded border border-green-200">{successMessage}</div>
        {/if}
        {#if errorMsg}
            <div class="text-[12px] text-red-700 mb-2 p-2 bg-red-50 rounded border border-red-200">{errorMsg}</div>
        {/if}

        <div class="mt-1 space-y-1 flex-1 overflow-y-auto">
            {#if $isLoading}
                <div class="text-[12px] text-slate-500">Cargando partidas...</div>
            {:else if $selectedPlantillaDetalle.length === 0}
                <div class="text-[12px] text-slate-400 text-center py-4">No hay partidas en esta plantilla</div>
            {:else}
                {#each $selectedPlantillaDetalle as item, idx}
                    <div class="flex items-center py-1.5 border-b border-slate-100 text-[12px] text-[#475569] hover:bg-white group cursor-pointer rounded px-1">
                        <span class="w-6 text-[#94a3b8] font-medium">{idx + 1}</span>
                        <GripVertical size={14} class="text-[#cbd5e1] mr-2 cursor-grab group-hover:text-[#94a3b8]" />
                        <span class="flex-1 truncate pr-2 text-[#334155]">{item.nombre_partida}</span>
                        <span class="w-16 text-right font-medium">{item.cantidad_sugerida?.toFixed(2) ?? '0.00'}</span>
                    </div>
                {/each}
            {/if}
        </div>
    {:else}
        <div class="flex flex-col items-center justify-center text-slate-400 h-full py-8">
            <ArrowLeft size={32} class="mb-2" />
            <span class="text-sm text-center">Selecciona una plantilla para ver su detalle</span>
        </div>
    {/if}
</div>
