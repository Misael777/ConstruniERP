<script lang="ts">
    import { selectedPlantilla, selectedPlantillaDetalle, isLoading, instanciarPlantilla } from '$lib/stores/partidas';
    import { GripVertical, Plus, Rocket, ArrowLeft } from '@lucide/svelte';
    
    let isInstanciando = $state(false);
    let successMessage = $state('');

    async function handleInstanciar() {
        if (!$selectedPlantilla) return;
        isInstanciando = true;
        successMessage = '';
        const id_proyecto = 1; // HARDCODED for now
        const result = await instanciarPlantilla($selectedPlantilla.id_plantilla, id_proyecto, true, false, 'user-id-uuid');
        if (result.success) {
            successMessage = result.message;
            setTimeout(() => successMessage = '', 3000);
        }
        isInstanciando = false;
    }
</script>

<div class="border-t border-slate-200 p-4 h-[45%] md:h-[50%] overflow-y-auto bg-[#fafcff] shrink-0">
    {#if $selectedPlantilla}
        <div class="font-semibold text-[15px] mb-3 text-[#1e293b]">{$selectedPlantilla.nombre}</div>
        <div class="flex gap-2 mb-4">
            <button class="flex items-center bg-[#0f3b5e] text-white px-3 py-1.5 rounded text-[12px] font-semibold hover:bg-[#1e4a6d] transition-colors">
                <Plus size={14} class="mr-1.5" /> Agregar partida
            </button>
            <button class="flex items-center bg-[#e2e8f0] text-[#1e293b] px-3 py-1.5 rounded text-[12px] font-semibold hover:bg-[#cbd5e1] transition-colors" onclick={handleInstanciar} disabled={isInstanciando}>
                <Rocket size={14} class="mr-1.5" /> {isInstanciando ? 'Procesando...' : 'Instanciar'}
            </button>
        </div>
        
        {#if successMessage}
            <div class="text-[12px] text-green-700 mb-2 p-2 bg-green-50 rounded border border-green-200">{successMessage}</div>
        {/if}

        <div class="mt-2 space-y-1">
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
                        <span class="w-16 text-right font-medium">{item.cantidad_sugerida?.toFixed(2) || '0.00'}</span>
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
