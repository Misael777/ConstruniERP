<script lang="ts">
    import { onMount } from 'svelte';
    import { supabase } from '$lib/supabaseClient';
    import {
        fetchPartidasTree, fetchPlantillas, fetchProyectos,
        filteredPartidasTree, partidasTree, partidasCount, plantillasList,
        isLoadingTree, errorMessage,
        searchTerm, currentAuthUserId,
        draggingNode, draggingPos, countDescendants,
        type Plantilla,
    } from '$lib/stores/partidas';
    import TreeView from '$lib/components/partidas/TreeView.svelte';
    import PartidaDetail from '$lib/components/partidas/PartidaDetail.svelte';
    import PlantillaList from '$lib/components/partidas/PlantillaList.svelte';
    import PlantillaDetail from '$lib/components/partidas/PlantillaDetail.svelte';
    import PartidaModal from '$lib/components/partidas/PartidaModal.svelte';
    import PlantillaModal from '$lib/components/partidas/PlantillaModal.svelte';
    import { HardHat, Search, Plus, Layers, Menu, X, List, FolderTree, BookOpen, ClipboardList } from '@lucide/svelte';

    let showLeftDrawer  = $state(false);
    let showRightDrawer = $state(false);
    let showPartidaModal  = $state(false);
    let showPlantillaModal = $state(false);
    let editingPartida = $state<any>(null);
    let editingPlantilla = $state<Plantilla | null>(null);

    onMount(async () => {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user?.id) currentAuthUserId.set(session.user.id);
        fetchPartidasTree();
        fetchPlantillas();
        fetchProyectos();
    });

    function toggleLeft()  { showLeftDrawer  = !showLeftDrawer;  showRightDrawer = false; }
    function toggleRight() { showRightDrawer = !showRightDrawer; showLeftDrawer  = false; }

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

    function openNewPlantillaModal() {
        editingPlantilla = null;
        showPlantillaModal = true;
    }

    function openEditPlantillaModal(plantilla: Plantilla) {
        editingPlantilla = plantilla;
        showPlantillaModal = true;
    }

    function closePlantillaModal() {
        showPlantillaModal = false;
        editingPlantilla = null;
    }
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

        <!-- Search — bound to store searchTerm -->
        <div class="hidden md:flex items-center bg-slate-100 rounded-full px-4 py-2 w-96 ml-8">
            <Search class="text-slate-400 mr-2 shrink-0" size={18} />
            <input
                type="text"
                placeholder="Buscar partidas, códigos..."
                class="bg-transparent border-none outline-none w-full text-sm text-slate-700 placeholder-slate-400"
                bind:value={$searchTerm}
            />
            {#if $searchTerm}
                <button class="ml-2 text-slate-400 hover:text-slate-600" onclick={() => searchTerm.set('')}>
                    <X size={14} />
                </button>
            {/if}
        </div>

        <div class="flex items-center gap-2">
            <button class="md:hidden p-2 text-slate-600 hover:bg-slate-100 rounded-full" onclick={toggleRight}>
                <Layers size={20} />
            </button>
            <div class="hidden md:flex gap-3">
                <button
                    class="flex items-center px-4 py-1.5 bg-[#0f3b5e] text-white rounded text-sm font-semibold hover:bg-[#1e4a6d] transition-colors"
                    onclick={openNewPartidaModal}
                >
                    <Plus size={16} class="mr-2" /> Nueva partida
                </button>
                <button
                    class="flex items-center px-4 py-1.5 border border-[#0f3b5e] text-[#0f3b5e] rounded text-sm font-semibold hover:bg-slate-50 transition-colors"
                    onclick={openNewPlantillaModal}
                >
                    <Layers size={16} class="mr-2" /> Nueva plantilla
                </button>
            </div>
        </div>
    </header>

    <!-- Error banner -->
    {#if $errorMessage}
        <div class="bg-red-100 text-red-700 px-6 py-2 text-sm shrink-0 flex justify-between items-center">
            <span>{$errorMessage}</span>
            <button onclick={() => errorMessage.set(null)}><X size={14} /></button>
        </div>
    {/if}

    <!-- Main content -->
    <main class="flex flex-1 overflow-hidden relative">

        <!-- Left panel: partida tree -->
        <aside class="absolute inset-y-0 left-0 z-10 w-72 lg:w-80 bg-white border-r border-slate-200 flex flex-col
                       transform transition-transform duration-300 ease-in-out
                       md:relative md:translate-x-0 shadow-xl md:shadow-none shrink-0
                       {showLeftDrawer ? 'translate-x-0' : '-translate-x-full'}">

            <div class="p-4 border-b border-slate-200 flex items-center justify-between bg-[#fafcff] shrink-0">
                <div class="flex items-center font-semibold text-sm text-[#475569]">
                    <BookOpen size={16} class="mr-2" /> Catálogo de partidas
                </div>
                <span class="text-xs text-slate-500">{$partidasCount} partidas</span>
                {#if showLeftDrawer}
                    <button class="md:hidden text-slate-500 ml-2" onclick={toggleLeft}><X size={18} /></button>
                {/if}
            </div>

            <!-- Mobile search -->
            <div class="md:hidden p-3 border-b border-slate-100 shrink-0">
                <div class="flex items-center bg-slate-100 rounded-full px-3 py-1.5">
                    <Search class="text-slate-400 mr-2 shrink-0" size={14} />
                    <input
                        type="text"
                        placeholder="Buscar..."
                        class="bg-transparent border-none outline-none w-full text-sm"
                        bind:value={$searchTerm}
                    />
                </div>
            </div>

            <div class="flex-1 overflow-y-auto py-2">
                {#if $isLoadingTree && $partidasTree.length === 0}
                    <div class="text-center text-xs text-slate-500 mt-8">Cargando árbol...</div>
                {:else if $filteredPartidasTree.length === 0 && $searchTerm}
                    <div class="text-center text-xs text-slate-500 mt-8">
                        Sin resultados para «{$searchTerm}»
                    </div>
                {:else if $partidasTree.length === 0}
                    <div class="text-center text-xs text-slate-500 mt-8">No hay partidas disponibles</div>
                {:else}
                    <TreeView nodes={$filteredPartidasTree} level={0} forceExpand={!!$searchTerm} />
                {/if}
            </div>
        </aside>

        <!-- Center panel: partida detail -->
        <section class="flex-1 flex flex-col min-w-0 bg-white border-r border-slate-100">
            <PartidaDetail onEdit={openEditPartidaModal} />
        </section>

        <!-- Right panel: plantillas -->
        <aside class="absolute inset-y-0 right-0 z-10 w-80 lg:w-[380px] bg-white border-l border-slate-200 flex flex-col
                       transform transition-transform duration-300 ease-in-out
                       md:relative md:translate-x-0 shadow-xl md:shadow-none shrink-0
                       {showRightDrawer ? 'translate-x-0' : 'translate-x-full'}">

            <div class="p-4 border-b border-slate-200 flex items-center justify-between bg-[#fafcff] shrink-0">
                <div class="flex items-center font-semibold text-sm text-[#475569]">
                    <ClipboardList size={16} class="mr-2" /> Plantillas
                </div>
                <div class="flex items-center gap-2">
                    {#if showRightDrawer}
                        <button class="md:hidden text-slate-500" onclick={toggleRight}><X size={18} /></button>
                    {/if}
                    <button
                        class="bg-[#0f3b5e] text-white px-3 py-1 rounded text-xs font-semibold hover:bg-[#1e4a6d] flex items-center"
                        onclick={openNewPlantillaModal}
                    >
                        <Plus size={14} class="mr-1" /> Nueva
                    </button>
                </div>
            </div>

            <PlantillaList onEdit={openEditPlantillaModal} />
            <PlantillaDetail />
        </aside>

        <!-- Mobile overlay -->
        {#if showLeftDrawer || showRightDrawer}
            <!-- svelte-ignore a11y-click-events-have-key-events -->
            <!-- svelte-ignore a11y-no-static-element-interactions -->
            <div
                role="button"
                tabindex="0"
                class="fixed inset-0 bg-black/20 z-0 md:hidden"
                onclick={() => { showLeftDrawer = false; showRightDrawer = false; }}
            ></div>
        {/if}
    </main>

    <!-- Footer: live counts from stores -->
    <footer class="bg-white border-t border-slate-200 px-6 py-3 flex justify-around items-center shrink-0 text-xs text-[#475569]">
        <div class="flex items-center gap-1.5">
            <List size={16} class="text-amber-500" />
            Partidas: <strong class="text-[#0f3b5e] font-bold ml-1">{$partidasCount}</strong>
        </div>
        <div class="flex items-center gap-1.5">
            <Layers size={16} class="text-amber-500" />
            Plantillas: <strong class="text-[#0f3b5e] font-bold ml-1">{$plantillasList.length}</strong>
        </div>
        <div class="hidden sm:flex items-center gap-1.5">
            <FolderTree size={16} class="text-amber-500" />
            Raíces: <strong class="text-[#0f3b5e] font-bold ml-1">{$partidasTree.length}</strong>
        </div>
    </footer>

    <!-- Modals -->
    <PartidaModal isOpen={showPartidaModal} partida={editingPartida} on:close={closePartidaModal} />
    <PlantillaModal isOpen={showPlantillaModal} plantilla={editingPlantilla} on:close={closePlantillaModal} />

    <!-- Drag ghost: follows cursor while dragging a catalog node -->
    {#if $draggingNode && $draggingPos}
        {@const childCount = countDescendants($draggingNode)}
        <div
            class="fixed z-[9999] pointer-events-none bg-white border border-amber-400 shadow-xl rounded-lg px-3 py-2 text-xs max-w-[200px]"
            style="left:{$draggingPos.x + 14}px; top:{$draggingPos.y - 14}px; transform:rotate(-1.5deg)"
        >
            <div class="font-mono text-amber-600 text-[10px] font-bold mb-0.5 truncate">{$draggingNode.codigo}</div>
            <div class="text-slate-700 truncate font-medium">{$draggingNode.descripcion}</div>
            {#if childCount > 0}
                <div class="text-[10px] text-slate-400 mt-0.5">+ {childCount} partida{childCount !== 1 ? 's' : ''} hijas</div>
            {/if}
        </div>
    {/if}
</div>
