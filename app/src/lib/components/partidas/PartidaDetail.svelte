<script lang="ts">
    import { Box, Ruler } from '@lucide/svelte';
    import { selectedPartida } from '$lib/stores/partidas';
    
    let activeTab = $state('general');
    const tabs = [
        { id: 'general', label: 'Datos generales' },
        { id: 'precios', label: 'Precios' },
        { id: 'metrados', label: 'Metrados' },
        { id: 'plantillas', label: 'Uso en plantillas' },
        { id: 'instancias', label: 'Instancias' },
    ];
</script>

<div class="flex flex-col h-full bg-white min-w-0">
    {#if $selectedPartida}
        <div class="p-4 md:px-6 md:py-4 border-b border-slate-200 bg-[#fafcff] shrink-0">
            <h2 class="text-lg font-semibold flex items-center text-[#1e293b]">
                <Box class="text-amber-500 mr-2" size={20} fill="currentColor" /> 
                {$selectedPartida.descripcion}
            </h2>
            <div class="text-[13px] text-[#64748b] mt-1">
                Código: {$selectedPartida.codigo} &middot; Unidad: {$selectedPartida.unidad || 'glb'} &middot; Nivel: {$selectedPartida.nivel}
            </div>
        </div>
        
        <!-- Pestañas para Desktop / Acordeón para Mobile -->
        <div class="flex flex-wrap border-b border-slate-200 bg-[#fafcff] px-2 md:px-6 shrink-0">
            {#each tabs as tab}
                <!-- svelte-ignore a11y-click-events-have-key-events -->
                <!-- svelte-ignore a11y-no-static-element-interactions -->
                <div class="px-3 md:px-4 py-3 text-[13px] font-medium cursor-pointer border-b-[3px] transition-all {activeTab === tab.id ? 'text-[#0f3b5e] border-[#0f3b5e]' : 'text-[#64748b] border-transparent hover:text-[#0f3b5e]'}" on:click={() => activeTab = tab.id}>
                    {tab.label}
                </div>
            {/each}
        </div>
        
        <div class="flex-1 overflow-y-auto p-4 md:p-6">
            {#if activeTab === 'general'}
                <div class="space-y-4 max-w-2xl">
                    <div class="flex flex-col md:flex-row md:items-center">
                        <label class="w-40 font-medium text-[13px] text-[#475569] mb-1 md:mb-0">Código</label>
                        <input type="text" value={$selectedPartida.codigo} class="flex-1 p-2 border border-[#d1d5db] rounded text-[14px] bg-[#f9fafb] text-[#1e293b] focus:outline-none focus:border-[#0f3b5e] focus:bg-white" readonly />
                    </div>
                    <div class="flex flex-col md:flex-row md:items-center">
                        <label class="w-40 font-medium text-[13px] text-[#475569] mb-1 md:mb-0">Descripción</label>
                        <input type="text" value={$selectedPartida.descripcion} class="flex-1 p-2 border border-[#d1d5db] rounded text-[14px] bg-[#f9fafb] text-[#1e293b] focus:outline-none focus:border-[#0f3b5e] focus:bg-white" readonly />
                    </div>
                    <div class="flex flex-col md:flex-row md:items-center">
                        <label class="w-40 font-medium text-[13px] text-[#475569] mb-1 md:mb-0">Unidad</label>
                        <select class="flex-1 p-2 border border-[#d1d5db] rounded text-[14px] bg-[#f9fafb] text-[#1e293b] focus:outline-none focus:border-[#0f3b5e] focus:bg-white" disabled>
                            <option>{$selectedPartida.unidad || 'glb'}</option>
                        </select>
                    </div>
                    <div class="flex flex-col md:flex-row md:items-center">
                        <label class="w-40 font-medium text-[13px] text-[#475569] mb-1 md:mb-0">Nivel</label>
                        <input type="number" value={$selectedPartida.nivel} class="flex-1 p-2 border border-[#d1d5db] rounded text-[14px] bg-[#f9fafb] text-[#1e293b] focus:outline-none focus:border-[#0f3b5e] focus:bg-white" readonly />
                    </div>
                    <div class="flex flex-col md:flex-row md:items-center">
                        <label class="w-40 font-medium text-[13px] text-[#475569] mb-1 md:mb-0">Partida padre</label>
                        <input type="text" value="C02.01 - Cimentación" class="flex-1 p-2 border border-[#d1d5db] rounded text-[14px] bg-[#f1f5f9] text-[#1e293b] cursor-not-allowed" disabled />
                    </div>
                </div>
            {:else if activeTab === 'precios'}
                <div class="space-y-4 max-w-2xl">
                    <div class="flex flex-col md:flex-row md:items-center">
                        <label class="w-40 font-medium text-[13px] text-[#475569] mb-1 md:mb-0">Precio unitario</label>
                        <input type="number" value={$selectedPartida.precio_unitario || 0.0} class="flex-1 p-2 border border-[#d1d5db] rounded text-[14px] bg-[#f9fafb] text-[#1e293b] focus:outline-none focus:border-[#0f3b5e] focus:bg-white" readonly />
                    </div>
                </div>
            {:else if activeTab === 'metrados'}
                <div class="text-center text-[#94a3b8] py-10">
                    <Ruler size={48} class="mx-auto mb-3 opacity-50" />
                    <p class="text-sm">No hay metrados asociados a esta partida.</p>
                    <button class="mt-4 bg-[#0f3b5e] text-white px-4 py-2 rounded text-sm font-medium hover:bg-[#1e4a6d]">Crear metrado</button>
                </div>
            {:else if activeTab === 'plantillas'}
                <p class="text-[13px] text-[#64748b]">Uso en plantillas (Módulo en construcción)</p>
            {:else if activeTab === 'instancias'}
                <p class="text-[13px] text-[#64748b]">Instancias en presupuestos (Módulo en construcción)</p>
            {/if}
        </div>
    {:else}
        <div class="flex-1 flex items-center justify-center text-[#94a3b8]">
            Selecciona una partida del árbol para ver su detalle
        </div>
    {/if}
</div>
