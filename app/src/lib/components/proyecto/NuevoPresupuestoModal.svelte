<script lang="ts">
	// Popup "Nuevo Presupuesto" del módulo independiente Presupuesto — a pedido explícito del usuario,
	// el campo "Nombre" no es texto libre: es un selector con los proyectos de venta cerrada,
	// etiquetados con su código generado (ver getProyectoOptionsVentaCerrada). Elegir uno decide a la
	// vez el proyecto y el nombre que queda guardado en `presupuesto.nombre`.
	import { createEventDispatcher } from 'svelte';
	import { X } from '@lucide/svelte';
	import { supabase } from '$lib/supabaseClient';
	import { getProyectoOptionsVentaCerrada, crearOAbrirPresupuesto } from '$lib/stores/partidas';
	import type { FieldOption } from '$lib/shared/fieldConfig';
	import { toast } from '$lib/stores/toast';

	const dispatch = createEventDispatcher<{ close: void; created: { idProyecto: number; idPresupuesto: number } }>();
	let { isOpen = false }: { isOpen: boolean } = $props();

	let opciones = $state<FieldOption[]>([]);
	let idProyecto = $state('');
	let loadingOpciones = $state(false);
	let isLoading = $state(false);
	let errorMsg = $state('');

	$effect(() => {
		if (!isOpen) return;
		idProyecto = '';
		errorMsg = '';
		loadingOpciones = true;
		getProyectoOptionsVentaCerrada(supabase)
			.then((rows) => (opciones = rows))
			.catch((err: any) => (errorMsg = err.message ?? String(err)))
			.finally(() => (loadingOpciones = false));
	});

	async function handleSubmit() {
		errorMsg = '';
		if (!idProyecto) {
			errorMsg = 'Elige el proyecto.';
			return;
		}
		const nombre = opciones.find((o) => o.value === idProyecto)?.label ?? '';

		isLoading = true;
		const {
			data: { session }
		} = await supabase.auth.getSession();
		const userId = session?.user?.id;
		if (!userId) {
			isLoading = false;
			errorMsg = 'No hay sesión activa. Recarga la página.';
			return;
		}

		const result = await crearOAbrirPresupuesto(Number(idProyecto), nombre, userId);
		isLoading = false;

		if (result.success && result.id_presupuesto) {
			toast.success(result.message);
			dispatch('created', { idProyecto: Number(idProyecto), idPresupuesto: result.id_presupuesto });
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
			<div class="flex items-center justify-between px-6 py-4 border-b border-slate-200">
				<h2 class="text-lg font-semibold text-[#1e293b]">Nuevo Presupuesto</h2>
				<button onclick={handleCancel} class="p-1 hover:bg-slate-100 rounded-full transition-colors">
					<X size={20} />
				</button>
			</div>

			<div class="p-6 space-y-4">
				{#if errorMsg}
					<div class="p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">{errorMsg}</div>
				{/if}

				<div>
					<label for="np-nombre" class="block text-sm font-medium text-[#0f3b5e] mb-1">
						Nombre <span class="text-red-500">*</span>
					</label>
					<select
						id="np-nombre"
						bind:value={idProyecto}
						disabled={isLoading || loadingOpciones}
						class="w-full px-3 py-2 border border-slate-300 rounded text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-100 disabled:text-slate-400"
					>
						<option value="">{loadingOpciones ? 'Cargando proyectos...' : '— Elige un proyecto —'}</option>
						{#each opciones as opt}
							<option value={opt.value}>{opt.label}</option>
						{/each}
					</select>
					<p class="mt-1 text-xs text-slate-400">Solo proyectos con venta cerrada. El nombre del presupuesto será el código de ese proyecto.</p>
				</div>
			</div>

			<div class="flex gap-2 justify-end px-6 py-4 border-t border-slate-200">
				<button
					onclick={handleCancel}
					class="px-4 py-2 border border-slate-300 text-[#1e293b] rounded text-sm font-medium hover:bg-slate-50"
					disabled={isLoading}
				>
					Cancelar
				</button>
				<button
					onclick={handleSubmit}
					class="px-4 py-2 bg-[#0f3b5e] text-white rounded text-sm font-semibold hover:bg-[#1e4a6d] disabled:opacity-50"
					disabled={isLoading || loadingOpciones}
				>
					{isLoading ? 'Guardando...' : 'Crear presupuesto'}
				</button>
			</div>
		</div>
	</div>
{/if}
