<script lang="ts">
    import { plantillasList, selectedPlantilla, fetchPlantillaDetalle, type Plantilla } from '$lib/stores/partidas';
    import { Pencil } from '@lucide/svelte';

    let { onEdit }: { onEdit: (plantilla: Plantilla) => void } = $props();

    function selectPlantilla(p: any) {
        selectedPlantilla.set(p);
        fetchPlantillaDetalle(p.id_plantilla);
    }
</script>

<div class="flex-1 overflow-y-auto p-3 min-h-0">
    {#if $plantillasList.length === 0}
        <p class="text-center text-xs text-slate-400 mt-6">No hay plantillas creadas</p>
    {:else}
        {#each $plantillasList as p}
            <!-- svelte-ignore a11y-click-events-have-key-events -->
            <!-- svelte-ignore a11y-no-static-element-interactions -->
            <div
                class="group px-4 py-3 rounded-lg border mb-2 cursor-pointer transition-all flex justify-between items-center
                    {$selectedPlantilla?.id_plantilla === p.id_plantilla
                        ? 'bg-[#e0edf9] border-[#0f3b5e]'
                        : 'bg-white border-[#e2e8f0] hover:bg-[#f1f5f9] hover:border-[#cbd5e1]'}"
                onclick={() => selectPlantilla(p)}
            >
                <div class="min-w-0">
                    <div class="font-medium text-[14px] text-[#1e293b] truncate">{p.nombre || 'Sin nombre'}</div>
                    <div class="text-[11px] text-[#64748b] mt-0.5">
                        {p.tipo || 'Sin tipo'} &middot; {p.num_partidas} {p.num_partidas === 1 ? 'partida' : 'partidas'}
                    </div>
                </div>
                <div class="flex items-center gap-1.5 shrink-0 ml-2">
                    <div class="bg-[#e2e8f0] text-[#475569] px-2.5 py-0.5 rounded-full text-[11px] font-medium">
                        {p.num_partidas}
                    </div>
                    <!-- Editar / eliminar (eliminar vive dentro del modal de edición, mismo criterio que
                         PartidaModal.svelte) — visible al pasar el mouse. -->
                    <button
                        onclick={(e) => { e.stopPropagation(); onEdit(p); }}
                        class="w-6 h-6 rounded flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity text-slate-400 hover:text-blue-600 hover:bg-blue-50"
                        title="Editar / eliminar plantilla"
                        aria-label="Editar plantilla"
                    >
                        <Pencil size={13} />
                    </button>
                </div>
            </div>
        {/each}
    {/if}
</div>
