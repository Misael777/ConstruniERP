<script lang="ts">
    import { plantillasList, selectedPlantilla, fetchPlantillaDetalle } from '$lib/stores/partidas';
    import { FileText } from '@lucide/svelte';

    function selectPlantilla(p: any) {
        selectedPlantilla.set(p);
        fetchPlantillaDetalle(p.id_plantilla);
    }
</script>

<div class="flex-1 overflow-y-auto p-3">
    {#each $plantillasList as p}
        <!-- svelte-ignore a11y-click-events-have-key-events -->
        <!-- svelte-ignore a11y-no-static-element-interactions -->
        <div class="px-4 py-3 rounded-lg border mb-2 cursor-pointer transition-all flex justify-between items-center 
            {$selectedPlantilla?.id_plantilla === p.id_plantilla ? 'bg-[#e0edf9] border-[#0f3b5e]' : 'bg-white border-[#e2e8f0] hover:bg-[#f1f5f9] hover:border-[#cbd5e1]'}"
            on:click={() => selectPlantilla(p)}>
            <div>
                <div class="font-medium text-[14px] text-[#1e293b]">{(p.nombre || 'Sin nombre')}</div>
                <div class="text-[11px] text-[#64748b] mt-0.5">{p.tipo || 'Vivienda'} &middot; {p.num_partidas || 12} partidas</div>
            </div>
            <div class="bg-[#e2e8f0] text-[#475569] px-2.5 py-0.5 rounded-full text-[11px] font-medium flex items-center">
                {p.num_partidas || 12}
            </div>
        </div>
    {/each}
</div>
