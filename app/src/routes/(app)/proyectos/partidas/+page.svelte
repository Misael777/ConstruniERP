<script lang="ts">
    import { onMount } from 'svelte';
    import { fetchPartidasTree, fetchPlantillas, partidasTree, selectedPartida, isLoading, errorMessage } from '$lib/stores/partidas';
    import TreeView from '$lib/components/partidas/TreeView.svelte';
    import PartidaDetail from '$lib/components/partidas/PartidaDetail.svelte';
    import PlantillaList from '$lib/components/partidas/PlantillaList.svelte';
    import PlantillaDetail from '$lib/components/partidas/PlantillaDetail.svelte';
    import PartidaModal from '$lib/components/partidas/PartidaModal.svelte';
    import { HardHat, Search, History, Plus, Layers, Menu, X, List, LayoutTemplate, FolderTree, Clock, BookOpen, ClipboardList } from '@lucide/svelte';

    let showLeftDrawer = $state(false);
    let showRightDrawer = $state(false);
    let showPartidaModal = $state(false);
    let editingPartida = $state<any>(null);

    onMount(() => {
        fetchPartidasTree();
        fetchPlantillas();
    });

    function toggleLeft() { showLeftDrawer = !showLeftDrawer; showRightDrawer = false; }
    function toggleRight() { showRightDrawer = !showRightDrawer; showLeftDrawer = false; }
    
    function openNewPartidaModal() {
        editingPartida = null;
        showPartidaModal = true;
    }
    
    function openEditPartidaModal(partida: any) {
        editingPartida = partida;
        showPartidaModal = true;
    }

    function closePartidaModal() {
        showPartidaModal = false;
        editingPartida = null;
    }
    
    $effect(() => {
        if ($selectedPartida) {
            // Auto-open edit modal when a partida is selected
            openEditPartidaModal($selectedPartida);
        }
    });
</script>

<div class="flex flex-col h-screen bg-slate-50 text-slate-800 font-sans overflow-hidden">
    <!-- Topbar -->
    <header class="bg-white px-6 py-3 border-b border-slate-200 flex items-center justify-between shrink-0 shadow-sm z-20">
        <div class="flex items-center">
            <button class="md:hidden p-2 -ml-2 mr-2 text-slate-600 hover:bg-slate-100 rounded-full" onclick={toggleLeft}>
                <Menu size={20} />
            </button>
            <div class="font-bold text-xl text-[#0f3b5e] flex items-center">
                <HardHat class="text-amber-500 mr-2" size={24} /> CONSTRUNI
            </div>
        </div>

        <div class="hidden md:flex items-center bg-slate-100 rounded-full px-4 py-2 w-96 ml-8">
            <Search class="text-slate-400 mr-2" size={18} />
            <input type="text" placeholder="Buscar partidas, códigos..." class="bg-transparent border-none outline-none w-full text-sm text-slate-700 placeholder-slate-400" />
        </div>

        <div class="flex items-center gap-2">
            <button class="md:hidden p-2 text-slate-600 hover:bg-slate-100 rounded-full" onclick={toggleRight}>
                <Layers size={20} />
            </button>
            <div class="hidden md:flex gap-3">
                <button class="flex items-center px-4 py-1.5 border border-slate-300 text-[#0f3b5e] rounded text-sm font-semibold hover:bg-slate-50 transition-colors">
                    <History size={16} class="mr-2" /> Historial
                </button>
                <button class="flex items-center px-4 py-1.5 bg-[#0f3b5e] text-white rounded text-sm font-semibold hover:bg-[#1e4a6d] transition-colors" onclick={openNewPartidaModal}>
                    <Plus size={16} class="mr-2" /> Nueva partida
                </button>
                <button class="flex items-center px-4 py-1.5 bg-[#0f3b5e] text-white rounded text-sm font-semibold hover:bg-[#1e4a6d] transition-colors">
                    <Layers size={16} class="mr-2" /> Nueva plantilla
                </button>
            </div>
        </div>
    </header>

    <!-- Error/Loading Overlay -->
    {#if $errorMessage}
        <div class="bg-red-100 text-red-700 p-2 text-center text-sm">{$errorMessage}</div>
    {/if}

    <!-- Main Content Area -->
    <main class="flex flex-1 overflow-hidden relative">
        
        <!-- Left Panel: Tree -->
        <aside class="absolute inset-y-0 left-0 z-10 w-72 lg:w-80 bg-white border-r border-slate-200 flex flex-col transform transition-transform duration-300 ease-in-out md:relative md:translate-x-0 {showLeftDrawer ? 'translate-x-0' : '-translate-x-full'} shadow-xl md:shadow-none shrink-0">
            <div class="p-4 border-b border-slate-200 flex justify-between items-center bg-[#fafcff] shrink-0">
                <div class="flex items-center font-semibold text-sm text-[#475569]">
                    <BookOpen size={16} class="mr-2" /> Catálogo de partidas
                </div>
                <span class="text-xs text-slate-500 font-normal">{$partidasTree.length > 0 ? '45 partidas' : '0 partidas'}</span>
                {#if showLeftDrawer}
                    <button class="md:hidden text-slate-500 ml-2" onclick={toggleLeft}><X size={18} /></button>
                {/if}
            </div>
            <div class="flex-1 overflow-y-auto py-2">
                {#if $isLoading && $partidasTree.length === 0}
                    <div class="text-center text-xs text-slate-500 mt-4">Cargando árbol...</div>
                {:else if $partidasTree.length === 0}
                    <div class="text-center text-xs text-slate-500 mt-4">No hay partidas disponibles</div>
                {:else}
                    <TreeView nodes={$partidasTree} />
                {/if}
            </div>
        </aside>

        <!-- Center Panel: Detail -->
        <section class="flex-1 flex flex-col min-w-0 bg-white">
            <div class="md:hidden p-3 border-b border-slate-200 bg-slate-50 shrink-0">
                <div class="flex items-center bg-white border border-slate-300 rounded-full px-3 py-1.5">
                    <Search class="text-slate-400 mr-2" size={16} />
                    <input type="text" placeholder="Buscar..." class="bg-transparent border-none outline-none w-full text-sm" />
                </div>
            </div>
            <PartidaDetail />
        </section>

        <!-- Right Panel: Plantillas -->
        <aside class="absolute inset-y-0 right-0 z-10 w-80 lg:w-[380px] bg-white border-l border-slate-200 flex flex-col transform transition-transform duration-300 ease-in-out md:relative md:translate-x-0 {showRightDrawer ? 'translate-x-0' : 'translate-x-full'} shadow-xl md:shadow-none shrink-0">
            <div class="p-4 border-b border-slate-200 flex justify-between items-center bg-[#fafcff] shrink-0">
                <div class="flex items-center font-semibold text-sm text-[#475569]">
                    <ClipboardList size={16} class="mr-2" /> Plantillas
                </div>
                <div class="flex items-center">
                    <button class="md:hidden text-slate-500 mr-2" onclick={toggleRight}><X size={18} /></button>
                    <button class="bg-[#0f3b5e] text-white px-3 py-1 rounded text-xs font-semibold hover:bg-[#1e4a6d] flex items-center">
                        <Plus size={14} class="mr-1" /> Nueva
                    </button>
                </div>
            </div>
            
            <PlantillaList />
            <PlantillaDetail />
            
        </aside>

        <!-- Mobile overlay background -->
        {#if showLeftDrawer || showRightDrawer}
            <!-- svelte-ignore a11y-click-events-have-key-events -->
            <!-- svelte-ignore a11y-no-static-element-interactions -->
            <div role="button" tabindex="0" class="fixed inset-0 bg-black/20 z-0 md:hidden" onclick={() => {showLeftDrawer = false; showRightDrawer = false;}}></div>
        {/if}
    </main>

    <!-- Bottom Bar -->
    <footer class="bg-white border-t border-slate-200 px-6 py-3 flex justify-around items-center shrink-0 text-xs text-[#475569]">
        <div class="flex items-center gap-1.5"><List size={16} class="text-amber-500"/> Partidas: <strong class="text-[#0f3b5e] font-bold">45</strong></div>
        <div class="flex items-center gap-1.5"><Layers size={16} class="text-amber-500"/> Plantillas: <strong class="text-[#0f3b5e] font-bold">4</strong></div>
        <div class="hidden sm:flex items-center gap-1.5"><FolderTree size={16} class="text-amber-500"/> Proyectos activos: <strong class="text-[#0f3b5e] font-bold">7</strong></div>
        <div class="hidden md:flex items-center gap-1.5"><Clock size={16} class="text-amber-500"/> Última modificación: <strong class="text-[#0f3b5e] font-bold">hace 2 min</strong></div>
    </footer>
    
    <!-- Partida CRUD Modal -->
    <PartidaModal isOpen={showPartidaModal} partida={editingPartida} on:close={closePartidaModal} />
</div>
