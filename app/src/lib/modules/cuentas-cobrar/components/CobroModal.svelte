<script lang="ts">
	import { supabase } from '$lib/supabaseClient';
	import { X, Loader2 } from '@lucide/svelte';
	import { toast } from '$lib/stores/toast';
	import { validatePayload, applyFieldMask, formatCurrency } from '$lib/shared/fieldConfig';
	import { FIELDS_CONFIG } from '$lib/modules/cuentas-cobrar/config/cobro.config';
	import { createCobro, updateCobro } from '$lib/modules/cuentas-cobrar/services/cuentasCobrar.service';
	import type { Cobro } from '$lib/modules/cuentas-cobrar/services/cuentasCobrar.service';
	import { isAdmin } from '$lib/stores/permisos.svelte';

	let {
		open = false,
		idCuentaCobrar,
		cobro = null,
		onClose,
		onSaved,
		onTransaccionSugerida
	}: {
		open: boolean;
		idCuentaCobrar: number | null;
		/** Si viene un cobro, el modal edita esa cuota en vez de crear una nueva. */
		cobro?: Cobro | null;
		onClose: () => void;
		onSaved: () => void;
		/** Se llama cuando una cuota recién pasa a 'cobrado' y hay un payload de transacción sugerido
		 * para completar — ver updateCobro en cuentasCobrar.service.ts. idCobro es el que hay que
		 * confirmar con confirmarCobroCobrado una vez el usuario complete esa transacción. */
		onTransaccionSugerida?: (payload: Record<string, unknown>, idCobro: number) => void;
	} = $props();

	const formFields = FIELDS_CONFIG.filter((f) => f.showInForm);
	const mode = $derived(cobro ? 'edit' : 'create');
	const title = $derived(cobro ? 'Editar Cuota Programada' : 'Registrar Cobro');

	const ESTADO_OPCIONES: { value: 'programado' | 'cobrado' | 'cancelado'; label: string }[] = [
		{ value: 'programado', label: 'Programado' },
		{ value: 'cobrado', label: 'Cobrado' },
		{ value: 'cancelado', label: 'Cancelado' }
	];

	function buildInitialValues(): Record<string, string> {
		const values: Record<string, string> = {};
		for (const field of formFields) {
			const raw = cobro ? (cobro as any)[field.key] : '';
			values[field.key] = raw === null || raw === undefined ? '' : String(raw);
		}
		return values;
	}

	let formValues = $state<Record<string, string>>(buildInitialValues());
	let estadoCobro = $state<'programado' | 'cobrado' | 'cancelado'>(cobro?.estado_cobro ?? 'programado');
	let fieldErrors = $state<Record<string, string>>({});
	let submitting = $state(false);

	$effect(() => {
		if (open) {
			formValues = buildInitialValues();
			estadoCobro = cobro?.estado_cobro ?? 'programado';
			fieldErrors = {};
		}
	});

	function handleInput(key: string, rawValue: string) {
		const field = formFields.find((f) => f.key === key)!;
		const masked = applyFieldMask(field, rawValue);
		formValues = { ...formValues, [key]: masked };
		revalidate();
	}

	function revalidate() {
		fieldErrors = validatePayload(FIELDS_CONFIG, formValues);
	}

	const hasErrors = $derived(Object.keys(fieldErrors).length > 0);

	async function handleSubmit(event: SubmitEvent) {
		event.preventDefault();
		revalidate();
		if (hasErrors) return;
		if (mode === 'create' && !idCuentaCobrar) return;

		submitting = true;
		try {
			let result;
			if (mode === 'edit' && cobro) {
				result = await updateCobro(supabase, cobro.id_cobro, formValues, estadoCobro, isAdmin());
			} else {
				const { data: userData } = await supabase.auth.getUser();
				result = await createCobro(supabase, idCuentaCobrar as number, formValues, userData?.user?.email ?? null);
			}

			if (result.success) {
				toast.success(result.message ?? 'Guardado con éxito');
				onSaved();
				onClose();
				if (result.transaccionSugerida && result.data) onTransaccionSugerida?.(result.transaccionSugerida, result.data.id_cobro);
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
		<div class="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
			<div class="sticky top-0 flex items-center justify-between bg-white px-6 py-4 border-b border-slate-200 z-10">
				<h2 class="text-lg font-semibold text-[#0f3b5e]">{title}</h2>
				<button type="button" onclick={onClose} class="p-1 hover:bg-slate-100 rounded-full text-slate-500" aria-label="Cerrar">
					<X size={20} />
				</button>
			</div>

			<form onsubmit={handleSubmit}>
				<div class="p-6 grid grid-cols-1 gap-4">
					{#if mode === 'edit'}
						<div>
							<label for="cb-estado_cobro" class="block text-sm font-medium text-[#0f3b5e] mb-1">Estado</label>
							<select
								id="cb-estado_cobro"
								value={estadoCobro}
								onchange={(e) => (estadoCobro = (e.target as HTMLSelectElement).value as typeof estadoCobro)}
								class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
							>
								{#each ESTADO_OPCIONES as opt}
									<option value={opt.value}>{opt.label}</option>
								{/each}
							</select>
							<p class="mt-1 text-xs text-slate-400">
								Pásala a "Cobrado" si se cobró antes o después de lo programado, o a "Cancelado" si ya no se hará.
								{#if estadoCobro === 'cobrado' && cobro?.estado_cobro !== 'cobrado'}
									<span class="block mt-1 text-amber-600 font-medium">Al guardar te pedirá completar la transacción de respaldo — sin ella no queda como "Cobrado".</span>
								{/if}
							</p>
						</div>
					{:else}
						<div class="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-700">
							Al guardar te pedirá completar la transacción de respaldo — el cobro no queda confirmado como "Cobrado" hasta que la completes.
						</div>
					{/if}

					{#each formFields as field (field.key)}
						<div>
							<label for={`cb-${field.key}`} class="block text-sm font-medium text-[#0f3b5e] mb-1">
								{field.label}
								{#if field.required}<span class="text-red-500">*</span>{/if}
							</label>
							{#if field.tipo === 'select' || field.options}
								<select
									id={`cb-${field.key}`}
									name={field.key}
									value={formValues[field.key]}
									onchange={(e) => handleInput(field.key, (e.target as HTMLSelectElement).value)}
									class={`w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 ${fieldErrors[field.key] ? 'border-red-400 focus:ring-red-200' : 'border-slate-300 focus:ring-blue-200'}`}
								>
									<option value="" disabled>Selecciona una opción</option>
									{#each field.options ?? [] as opt}
										<option value={opt.value}>{opt.label}</option>
									{/each}
								</select>
							{:else}
								<input
									id={`cb-${field.key}`}
									name={field.key}
									type={field.renderAsText ? 'text' : field.tipo === 'number' ? 'number' : field.tipo === 'date' ? 'date' : 'text'}
									inputmode={field.tipo === 'currency' ? 'decimal' : field.renderAsText ? 'numeric' : undefined}
									step={!field.renderAsText && field.tipo === 'number' ? 'any' : undefined}
									value={formValues[field.key]}
									maxlength={field.maxLength}
									placeholder={field.placeholder}
									oninput={(e) => handleInput(field.key, (e.target as HTMLInputElement).value)}
									class={`w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 ${fieldErrors[field.key] ? 'border-red-400 focus:ring-red-200' : 'border-slate-300 focus:ring-blue-200'}`}
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

				<div class="sticky bottom-0 flex gap-2 justify-end bg-white px-6 py-4 border-t border-slate-200">
					<button type="button" onclick={onClose} disabled={submitting} class="px-4 py-2 text-sm font-medium rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50 disabled:opacity-50">
						Cancelar
					</button>
					<button type="submit" disabled={submitting || hasErrors} class="px-4 py-2 text-sm font-medium rounded-lg bg-[#0f3b5e] text-white hover:bg-[#0c2f4c] disabled:opacity-50 flex items-center gap-2">
						{#if submitting}<Loader2 size={16} class="animate-spin" />{/if}
						{mode === 'edit' ? 'Guardar Cambios' : 'Registrar'}
					</button>
				</div>
			</form>
		</div>
	</div>
{/if}
