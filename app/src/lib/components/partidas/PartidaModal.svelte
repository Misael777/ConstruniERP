<script lang="ts">
    import { createEventDispatcher } from 'svelte';
    import { X } from '@lucide/svelte';
    import { createPartida, updatePartida, deletePartida, partidasTree, type PartidaNode } from '$lib/stores/partidas';
    import { toast } from '$lib/stores/toast';
    
    const dispatch = createEventDispatcher();
    let { isOpen = false, partida = null } = $props<{ isOpen: boolean; partida: PartidaNode | null }>();
    
    let formData = $state({
        codigo: '',
        descripcion: '',
        nivel: 1,
        id_partida_padre: null as number | null,
        unidad: '',
        precio_unitario: null as number | null
    });
    
    let isLoading = $state(false);
    let errorMessage = $state('');

    $effect(() => {
        if (partida) {
            formData = {
                codigo: partida.codigo,
                descripcion: partida.descripcion,
                nivel: partida.nivel,
                id_partida_padre: partida.id_partida_padre,
                unidad: partida.unidad || '',
                precio_unitario: partida.precio_unitario
            };
        } else {
            formData = {
                codigo: '',
                descripcion: '',
                nivel: 1,
                id_partida_padre: null,
                unidad: '',
                precio_unitario: null
            };
        }
        errorMessage = '';
    });

    // A pedido del usuario: todo popup se cierra de inmediato al guardar/eliminar en vez de mostrar un
    // mensaje de éxito adentro y esperar — mismo patrón que el resto de los modales (ver toast.success
    // + cierre inmediato en CuentaBancoModal.svelte y similares).
    async function handleSubmit() {
        errorMessage = '';

        if (!formData.codigo.trim()) {
            errorMessage = 'El código es requerido';
            return;
        }
        if (!formData.descripcion.trim()) {
            errorMessage = 'La descripción es requerida';
            return;
        }

        isLoading = true;

        try {
            const result = partida
                ? await updatePartida(partida.id_partida, formData)
                : await createPartida(formData);

            if (result.success) {
                toast.success(result.message);
                dispatch('close');
            } else {
                errorMessage = result.message;
            }
        } catch (err: any) {
            errorMessage = err.message || 'Error desconocido';
        } finally {
            isLoading = false;
        }
    }

    async function handleDelete() {
        if (!partida) return;
        if (!confirm('¿Está seguro que desea eliminar esta partida?')) return;

        errorMessage = '';
        isLoading = true;

        try {
            const result = await deletePartida(partida.id_partida);
            if (result.success) {
                toast.success(result.message);
                dispatch('close');
            } else {
                errorMessage = result.message;
            }
        } catch (err: any) {
            errorMessage = err.message || 'Error desconocido';
        } finally {
            isLoading = false;
        }
    }
    
    function handleCancel() {
        dispatch('close');
    }
    
    // Get all partidas for the parent select
    function getAllPartidas(nodes: PartidaNode[]): PartidaNode[] {
        let result: PartidaNode[] = [];
        nodes.forEach(node => {
            result.push(node);
            if (node.children) {
                result = result.concat(getAllPartidas(node.children));
            }
        });
        return result;
    }
    
    let allPartidas = $derived(getAllPartidas($partidasTree));
</script>

{#if isOpen}
    <div class="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 overflow-y-auto">
        <div class="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
            <!-- Header -->
            <div class="sticky top-0 flex items-center justify-between bg-white px-6 py-4 border-b border-slate-200 shrink-0">
                <h2 class="text-lg font-semibold text-[#1e293b]">
                    {partida ? 'Editar Partida' : 'Nueva Partida'}
                </h2>
                <button 
                    onclick={handleCancel}
                    class="p-1 hover:bg-slate-100 rounded-full transition-colors"
                >
                    <X size={20} />
                </button>
            </div>
            
            <!-- Content -->
            <div class="p-6 space-y-4">
                {#if errorMessage}
                    <div class="p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
                        {errorMessage}
                    </div>
                {/if}
                
                <div>
                    <label class="block text-sm font-medium text-[#0f3b5e] mb-1">
                        Código <span class="text-red-500">*</span>
                    </label>
                    <input 
                        type="text"
                        bind:value={formData.codigo}
                        placeholder="ej: EXC-001"
                        class="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                </div>
                
                <div>
                    <label class="block text-sm font-medium text-[#0f3b5e] mb-1">
                        Descripción <span class="text-red-500">*</span>
                    </label>
                    <textarea 
                        bind:value={formData.descripcion}
                        placeholder="Descripción detallada de la partida"
                        rows="3"
                        class="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
                    ></textarea>
                </div>
                
                <div class="grid grid-cols-2 gap-4">
                    <div>
                        <label class="block text-sm font-medium text-[#0f3b5e] mb-1">
                            Nivel
                        </label>
                        <input 
                            type="number"
                            bind:value={formData.nivel}
                            min="1"
                            class="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        />
                    </div>
                    
                    <div>
                        <label class="block text-sm font-medium text-[#0f3b5e] mb-1">
                            Unidad
                        </label>
                        <input 
                            type="text"
                            bind:value={formData.unidad}
                            placeholder="m, m², m³, kg, etc"
                            class="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        />
                    </div>
                </div>
                
                <div>
                    <label class="block text-sm font-medium text-[#0f3b5e] mb-1">
                        Precio Unitario
                    </label>
                    <input 
                        type="number"
                        bind:value={formData.precio_unitario}
                        placeholder="0.00"
                        step="0.01"
                        class="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                </div>
                
                <div>
                    <label class="block text-sm font-medium text-[#0f3b5e] mb-1">
                        Partida Padre (Opcional)
                    </label>
                    <select 
                        bind:value={formData.id_partida_padre}
                        class="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    >
                        <option value={null}>Sin partida padre</option>
                        {#each allPartidas as p}
                            {#if !partida || p.id_partida !== partida.id_partida}
                                <option value={p.id_partida}>
                                    {"&nbsp;".repeat(p.nivel * 2)}{p.codigo} - {p.descripcion}
                                </option>
                            {/if}
                        {/each}
                    </select>
                </div>
            </div>
            
            <!-- Footer -->
            <div class="sticky bottom-0 flex gap-2 justify-end bg-white px-6 py-4 border-t border-slate-200 shrink-0">
                <button 
                    onclick={handleCancel}
                    class="px-4 py-2 border border-slate-300 text-[#1e293b] rounded text-sm font-medium hover:bg-slate-50 transition-colors"
                    disabled={isLoading}
                >
                    Cancelar
                </button>
                
                {#if partida}
                    <button 
                        onclick={handleDelete}
                        class="px-4 py-2 bg-red-600 text-white rounded text-sm font-medium hover:bg-red-700 transition-colors"
                        disabled={isLoading}
                    >
                        {isLoading ? 'Eliminando...' : 'Eliminar'}
                    </button>
                {/if}
                
                <button 
                    onclick={handleSubmit}
                    class="px-4 py-2 bg-blue-600 text-white rounded text-sm font-medium hover:bg-blue-700 transition-colors disabled:bg-gray-400"
                    disabled={isLoading}
                >
                    {isLoading ? 'Guardando...' : (partida ? 'Actualizar' : 'Crear')}
                </button>
            </div>
        </div>
    </div>
{/if}
