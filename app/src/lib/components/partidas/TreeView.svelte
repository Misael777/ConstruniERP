<script lang="ts">
    import { ChevronDown, ChevronRight, Folder, FileText } from '@lucide/svelte';
    import { selectedPartida, type PartidaNode } from '$lib/stores/partidas';

    const { nodes = [], level = 0, forceExpand = false } = $props<{
        nodes: PartidaNode[];
        level: number;
        forceExpand?: boolean;
    }>();

    let expanded: Record<number, boolean> = $state({});

    function toggle(id: number) {
        expanded[id] = !expanded[id];
    }

    function select(node: PartidaNode) {
        selectedPartida.set(node);
    }

    function isExpanded(id: number) {
        return forceExpand || !!expanded[id];
    }
</script>

{#each nodes as node}
    {@const hasChildren = node.children && node.children.length > 0}
    <!-- svelte-ignore a11y-click-events-have-key-events -->
    <!-- svelte-ignore a11y-no-static-element-interactions -->
    <div
        class="group flex items-center py-1.5 cursor-pointer text-sm hover:bg-[#f1f5f9] transition-colors border-l-2
               {$selectedPartida?.id_partida === node.id_partida
                   ? 'bg-[#e0edf9] border-[#0f3b5e]'
                   : 'border-transparent'}"
        style="padding-left: {16 + level * 16}px; padding-right: 12px;"
        onclick={() => select(node)}
    >
        <!-- Expand/collapse toggle -->
        <div
            class="w-5 text-center text-[#94a3b8] mr-1 shrink-0"
            onclick={(e) => { e.stopPropagation(); if (hasChildren) toggle(node.id_partida); }}
        >
            {#if hasChildren}
                {#if isExpanded(node.id_partida)}
                    <ChevronDown size={14} />
                {:else}
                    <ChevronRight size={14} />
                {/if}
            {:else}
                <span class="text-[10px]">&bull;</span>
            {/if}
        </div>

        <!-- Icon -->
        <div class="w-5 text-amber-500 mr-1.5 shrink-0">
            {#if hasChildren}
                <Folder size={15} fill="currentColor" />
            {:else}
                <FileText size={15} class="text-slate-400" />
            {/if}
        </div>

        <span class="text-[#64748b] font-mono font-medium mr-2 text-[11px] shrink-0">{node.codigo}</span>
        <span class="flex-1 truncate text-[#1e293b] text-[12px]">{node.descripcion}</span>
        <span class="text-[10px] bg-[#e2e8f0] py-0.5 px-1.5 rounded-full text-[#475569] ml-2 shrink-0">N{node.nivel}</span>
    </div>

    {#if hasChildren && isExpanded(node.id_partida)}
        <svelte:self nodes={node.children} level={level + 1} forceExpand={forceExpand} />
    {/if}
{/each}
