<script lang="ts">
    import { ChevronDown, ChevronRight, Folder, FileText } from '@lucide/svelte';
    import { selectedPartida, type PartidaNode } from '$lib/stores/partidas';
    
    const { nodes = [], level = 0 } = $props<{ nodes: PartidaNode[]; level: number }>();
    
    let expanded: Record<number, boolean> = {};

    function toggle(id: number) {
        expanded[id] = !expanded[id];
    }

    function select(node: PartidaNode) {
        selectedPartida.set(node);
    }
</script>

{#each nodes as node}
    {@const hasChildren = node.children && node.children.length > 0}
    <!-- svelte-ignore a11y-click-events-have-key-events -->
    <!-- svelte-ignore a11y-no-static-element-interactions -->
    <div class="group flex items-center py-1.5 px-3 cursor-pointer text-sm hover:bg-[#f1f5f9] transition-colors border-l-2 {$selectedPartida?.id_partida === node.id_partida ? 'bg-[#e0edf9] border-[#0f3b5e]' : 'border-transparent'}" style="padding-left: {16 + level * 16}px;" on:click={() => select(node)}>
        <div class="w-5 text-center text-[#94a3b8] text-[10px] mr-1" on:click|stopPropagation={() => hasChildren && toggle(node.id_partida)}>
            {#if hasChildren}
                {#if expanded[node.id_partida]}
                    <ChevronDown size={14} />
                {:else}
                    <ChevronRight size={14} />
                {/if}
            {:else}
                &bull;
            {/if}
        </div>
        <div class="w-6 text-amber-500">
            {#if hasChildren}
                <Folder size={16} fill="currentColor" />
            {:else}
                <FileText size={16} fill="currentColor" class="text-amber-500 bg-white" />
            {/if}
        </div>
        <span class="text-[#64748b] font-medium mr-2 text-[11px]">{node.codigo}</span>
        <span class="flex-1 truncate text-[#1e293b]">{node.descripcion}</span>
        <span class="text-[10px] bg-[#e2e8f0] py-0.5 px-2 rounded-full text-[#475569] ml-2">N{node.nivel}</span>
    </div>

    {#if hasChildren && expanded[node.id_partida]}
        <svelte:self nodes={node.children} level={level + 1} />
    {/if}
{/each}
