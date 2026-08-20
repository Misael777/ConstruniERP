<script lang="ts">
    import { createEventDispatcher } from 'svelte';
    import { X } from '@lucide/svelte';
    import { createPlantilla, updatePlantilla, deletePlantilla, type Plantilla } from '$lib/stores/partidas';
    import { toast } from '$lib/stores/toast';

    const dispatch = createEventDispatcher();
    let { isOpen = false, plantilla = null }: { isOpen: boolean; plantilla?: Plantilla | null } = $props();

    const TIPOS = ['Vivienda', 'Local comercial', 'Oficina', 'Industrial', 'Otro'];

    let nombre      = $state('');
    let descripcion = $state('');
    let tipo        = $state('');
    let isLoading   = $state(false);
    let errorMsg    = $state('');

    $effect(() => {
        if (isOpen) {
            // Modo edición: precarga los datos de la plantilla elegida. Modo creación: formulario limpio.
            nombre = plantilla?.nombre ?? '';
            descripcion = plantilla?.descripcion ?? '';
            tipo = plantilla?.tipo ?? '';
            errorMsg = '';
        }
    });

    async function handleSubmit() {
        errorMsg = '';
        if (!nombre.trim()) {
            errorMsg = 'El nombre es requerido.';
            return;
        }

        isLoading = true;
        const payload = { nombre: nombre.trim(), descripcion: descripcion.trim() || null, tipo: tipo.trim() || null };
        const result = plantilla ? await updatePlantilla(plantilla.id_plantilla, payload) : await createPlantilla(payload);
        isLoading = false;

        // A pedido del usuario: todo popup se cierra de inmediato al guardar en vez de mostrar un
        // mensaje de éxito adentro y esperar — mismo patrón que el resto de los modales (ver
        // toast.success + cierre inmediato en CuentaBancoModal.svelte y similares).
        if (result.success) {
            toast.success(result.message);
            dispatch('close');
        } else {
            errorMsg = result.message;
        }
    }

    async function handleDelete() {
        if (!plantilla) return;
        if (!confirm(`¿Eliminar la plantilla "${plantilla.nombre}"? También se eliminan sus partidas asociadas (solo de la plantilla, no del catálogo). Esta acción no se puede deshacer.`)) return;

        errorMsg = '';
        isLoading = true;
        const result = await deletePlantilla(plantilla.id_plantilla);
        isLoading = false;

        if (result.success) {
            toast.success(result.message);
            dispatch('close');
        } else {
            errorMsg = result.message;
        }
    }

    function handleCancel() {
        dispatch('close');
    }
</script>

{#if isOpen}
    <div class="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
        <div class="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <!-- Header -->
            <div class="flex items-center justify-between px-6 py-4 border-b border-slate-200">
                <h2 class="text-lg font-semibold text-[#1e293b]">{plantilla ? 'Editar Plantilla' : 'Nueva Plantilla'}</h2>
                <button onclick={handleCancel} class="p-1 hover:bg-slate-100 rounded-full transition-colors">
                    <X size={20} />
                </button>
            </div>

            <!-- Body -->
            <div class="p-6 space-y-4">
                {#if errorMsg}
                    <div class="p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">{errorMsg}</div>
                {/if}

                <div>
                    <label for="pm-nombre" class="block text-sm font-medium text-[#0f3b5e] mb-1">
                        Nombre <span class="text-red-500">*</span>
                    </label>
                    <input
                        id="pm-nombre"
                        type="text"
                        bind:value={nombre}
                        placeholder="ej: Plantilla Vivienda Unifamiliar"
                        class="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        disabled={isLoading}
                    />
                </div>

                <div>
                    <label for="pm-tipo" class="block text-sm font-medium text-[#0f3b5e] mb-1">Tipo</label>
                    <select
                        id="pm-tipo"
                        bind:value={tipo}
                        class="w-full px-3 py-2 border border-slate-300 rounded text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                        disabled={isLoading}
                    >
                        <option value="">— Sin tipo —</option>
                        {#each TIPOS as t}
                            <option value={t}>{t}</option>
                        {/each}
                    </select>
                </div>

                <div>
                    <label for="pm-descripcion" class="block text-sm font-medium text-[#0f3b5e] mb-1">Descripción</label>
                    <textarea
                        id="pm-descripcion"
                        bind:value={descripcion}
                        placeholder="Descripción opcional de la plantilla..."
                        rows="3"
                        class="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                        disabled={isLoading}
                    ></textarea>
                </div>
            </div>

            <!-- Footer -->
            <div class="flex gap-2 justify-end px-6 py-4 border-t border-slate-200">
                <button
                    onclick={handleCancel}
                    class="px-4 py-2 border border-slate-300 text-[#1e293b] rounded text-sm font-medium hover:bg-slate-50"
                    disabled={isLoading}
                >
                    Cancelar
                </button>
                {#if plantilla}
                    <button
                        onclick={handleDelete}
                        class="px-4 py-2 bg-red-600 text-white rounded text-sm font-medium hover:bg-red-700 disabled:opacity-50"
                        disabled={isLoading}
                    >
                        {isLoading ? 'Eliminando...' : 'Eliminar'}
                    </button>
                {/if}
                <button
                    onclick={handleSubmit}
                    class="px-4 py-2 bg-[#0f3b5e] text-white rounded text-sm font-semibold hover:bg-[#1e4a6d] disabled:opacity-50"
                    disabled={isLoading}
                >
                    {isLoading ? 'Guardando...' : plantilla ? 'Actualizar plantilla' : 'Crear plantilla'}
                </button>
            </div>
        </div>
    </div>
{/if}
