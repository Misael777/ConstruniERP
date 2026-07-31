<script lang="ts">
	import { supabase } from '$lib/supabaseClient';
	import { X, Loader2, Link } from '@lucide/svelte';
	import { toast } from '$lib/stores/toast';
	import {
		FIELDS_CONFIG,
		validateCentroCostoPayload,
		applyFieldMask,
		formatCurrency
	} from '$lib/modules/centro-costos/config/centroCostos.config';
	import { createCentroCosto, updateCentroCosto, resolveEntidadVinculada } from '$lib/modules/centro-costos/services/centroCostos.service';
	import type { CentroCosto, EntidadVinculada } from '$lib/modules/centro-costos/services/centroCostos.service';

	let {
		open = false,
		mode = 'create',
		centro = null,
		onClose,
		onSaved
	}: {
		open: boolean;
		mode: 'create' | 'edit';
		centro: CentroCosto | null;
		onClose: () => void;
		onSaved: () => void;
	} = $props();

	const formFields = FIELDS_CONFIG.filter((f) => f.showInForm);

	function buildInitialValues(): Record<string, string> {
		const values: Record<string, string> = {};
		for (const field of formFields) {
			const raw = centro ? (centro as any)[field.key] : '';
			values[field.key] = raw === null || raw === undefined ? '' : String(raw);
		}
		return values;
	}

	let formValues = $state<Record<string, string>>(buildInitialValues());
	let fieldErrors = $state<Record<string, string>>({});
	let submitting = $state(false);

	// La vinculación (id_proyecto/id_cliente/id_proveedor) existe en la fila de `centro` pero
	// FIELDS_CONFIG no la expone como campo de formulario (se completa sola, nunca a mano — ver
	// centroCostos.service.ts), así que el modal nunca mostraba a qué entidad pertenecía este centro
	// de costo. Este banner de solo lectura resuelve eso: busca el nombre ACTUAL de la entidad
	// vinculada (no el `centro.nombre` guardado, que podría haber quedado desactualizado si la
	// entidad se renombró después) y lo muestra arriba del formulario.
	let linkedEntity = $state<EntidadVinculada | null>(null);
	let loadingLink = $state(false);
	const hasLink = $derived(
		!!(centro?.id_proyecto || centro?.id_cliente || centro?.id_proveedor || centro?.id_empleado)
	);

	async function loadLinkedEntity() {
		linkedEntity = null;
		if (!centro) return;
		loadingLink = true;
		try {
			linkedEntity = await resolveEntidadVinculada(supabase, centro);
		} finally {
			loadingLink = false;
		}
	}

	// Reconstruye el formulario cada vez que se abre el modal o cambia el registro a editar.
	$effect(() => {
		if (open) {
			formValues = buildInitialValues();
			fieldErrors = {};
			if (mode === 'edit') loadLinkedEntity();
			else linkedEntity = null;
		}
	});

	function handleInput(key: string, rawValue: string) {
		const field = formFields.find((f) => f.key === key)!;
		const masked = applyFieldMask(field, rawValue);
		formValues = { ...formValues, [key]: masked };
		revalidate();
	}

	function revalidate() {
		fieldErrors = validateCentroCostoPayload(formValues);
	}

	const hasErrors = $derived(Object.keys(fieldErrors).length > 0);
	const title = $derived(mode === 'create' ? 'Nuevo Centro de Costo' : 'Editar Centro de Costo');

	// El modal se ajusta al número de campos de FIELDS_CONFIG: pocos campos -> columna única
	// y angosto; más campos -> se ensancha y pasa a 2/3 columnas para no quedar demasiado alto.
	const modalWidthClass = $derived(
		formFields.length <= 4 ? 'max-w-md' : formFields.length <= 8 ? 'max-w-2xl' : 'max-w-4xl'
	);
	const gridColsClass = $derived(
		formFields.length <= 4 ? 'grid-cols-1' : formFields.length <= 8 ? 'grid-cols-2' : 'grid-cols-3'
	);

	async function handleSubmit(event: SubmitEvent) {
		event.preventDefault();
		revalidate();
		if (hasErrors) return;

		submitting = true;
		try {
			const result =
				mode === 'edit' && centro
					? await updateCentroCosto(supabase, centro.id_centro_costo, formValues)
					: await createCentroCosto(supabase, formValues);

			if (result.success) {
				toast.success(result.message ?? 'Operación realizada con éxito');
				onSaved();
				onClose();
			} else {
				toast.error(result.message ?? 'Ocurrió un error al guardar');
				if (result.errors) fieldErrors = { ...fieldErrors, ...result.errors };
			}
		} catch (err: any) {
			toast.error(err?.message ?? 'Ocurrió un error inesperado');
		} finally {
			submitting = false;
		}
	}
</script>

{#if open}
	<div class="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
		<div class={`bg-white rounded-2xl shadow-2xl w-full ${modalWidthClass} max-h-[90vh] overflow-y-auto`}>
			<!-- Header -->
			<div class="sticky top-0 flex items-center justify-between bg-white px-6 py-4 border-b border-slate-200 z-10">
				<h2 class="text-lg font-semibold text-[#0f3b5e]">{title}</h2>
				<button
					type="button"
					onclick={onClose}
					class="p-1 hover:bg-slate-100 rounded-full text-slate-500"
					aria-label="Cerrar"
				>
					<X size={20} />
				</button>
			</div>

			{#if mode === 'edit'}
				{#if loadingLink}
					<div class="mx-6 mt-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-400">
						Buscando entidad vinculada...
					</div>
				{:else if linkedEntity}
					<div class="mx-6 mt-4 flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-800">
						<Link size={16} class="shrink-0" />
						<span
							>Vinculado a <strong>{linkedEntity.tipo}</strong>: {linkedEntity.nombre}
							<span class="text-blue-500">(#{linkedEntity.id})</span></span
						>
					</div>
				{:else if !hasLink}
					<div class="mx-6 mt-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-500">
						Centro de costo manual — no está vinculado a ningún proyecto, cliente ni proveedor.
					</div>
				{/if}
			{/if}

			<form onsubmit={handleSubmit}>
				<!-- Content: grid_cols escala con la cantidad de campos (ver modalWidthClass/gridColsClass) -->
				<div class={`p-6 grid ${gridColsClass} gap-4`}>
					{#each formFields as field (field.key)}
						<div>
							<label for={`ccf-${field.key}`} class="block text-sm font-medium text-[#0f3b5e] mb-1">
								{field.label}
								{#if field.required}<span class="text-red-500">*</span>{/if}
							</label>

							{#if field.tipo === 'select'}
								<select
									id={`ccf-${field.key}`}
									name={field.key}
									value={formValues[field.key]}
									onchange={(e) => handleInput(field.key, (e.target as HTMLSelectElement).value)}
									class={`w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 ${
										fieldErrors[field.key]
											? 'border-red-400 focus:ring-red-200'
											: 'border-slate-300 focus:ring-blue-200'
									}`}
								>
									<option value="" disabled>Selecciona una opción</option>
									{#each field.formOptions ?? field.options ?? [] as opt}
										<option value={opt.value}>{opt.label}</option>
									{/each}
								</select>
							{:else}
								<input
									id={`ccf-${field.key}`}
									name={field.key}
									type={field.tipo === 'number' ? 'number' : 'text'}
									inputmode={field.tipo === 'currency' ? 'decimal' : undefined}
									step={field.tipo === 'number' ? 'any' : undefined}
									value={formValues[field.key]}
									maxlength={field.maxLength}
									placeholder={field.placeholder}
									oninput={(e) => handleInput(field.key, (e.target as HTMLInputElement).value)}
									class={`w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 ${
										fieldErrors[field.key]
											? 'border-red-400 focus:ring-red-200'
											: 'border-slate-300 focus:ring-blue-200'
									}`}
								/>
							{/if}

							{#if field.tipo === 'currency' && formValues[field.key] && !fieldErrors[field.key]}
								<p class="mt-1 text-xs text-slate-500">{formatCurrency(formValues[field.key])}</p>
							{/if}

							{#if fieldErrors[field.key]}
								<p class="mt-1 text-xs text-red-600">{fieldErrors[field.key]}</p>
							{:else if field.helpText}
								<p class="mt-1 text-xs text-slate-400">{field.helpText}</p>
							{/if}
						</div>
					{/each}
				</div>

				<!-- Footer -->
				<div class="sticky bottom-0 flex gap-2 justify-end bg-white px-6 py-4 border-t border-slate-200">
					<button
						type="button"
						onclick={onClose}
						disabled={submitting}
						class="px-4 py-2 text-sm font-medium rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50 disabled:opacity-50"
					>
						Cancelar
					</button>
					<button
						type="submit"
						disabled={submitting || hasErrors}
						class="px-4 py-2 text-sm font-medium rounded-lg bg-[#0f3b5e] text-white hover:bg-[#0c2f4c] disabled:opacity-50 flex items-center gap-2"
					>
						{#if submitting}
							<Loader2 size={16} class="animate-spin" />
						{/if}
						{mode === 'create' ? 'Crear' : 'Actualizar'}
					</button>
				</div>
			</form>
		</div>
	</div>
{/if}
