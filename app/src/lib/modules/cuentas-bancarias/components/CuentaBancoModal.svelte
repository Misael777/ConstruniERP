<script lang="ts">
	import { supabase } from '$lib/supabaseClient';
	import { X, Loader2 } from '@lucide/svelte';
	import { toast } from '$lib/stores/toast';
	import { validatePayload, applyFieldMask } from '$lib/shared/fieldConfig';
	import { FIELDS_CONFIG } from '$lib/modules/cuentas-bancarias/config/cuentaBanco.config';
	import { createCuentaBanco, updateCuentaBanco, type CuentaBanco } from '$lib/modules/cuentas-bancarias/services/cuentaBanco.service';
	import { permisosState } from '$lib/stores/permisos.svelte';

	let {
		open = false,
		mode = 'create',
		cuenta = null,
		onClose,
		onSaved
	}: {
		open: boolean;
		mode: 'create' | 'edit';
		cuenta: CuentaBanco | null;
		onClose: () => void;
		onSaved: () => void;
	} = $props();

	const formFields = FIELDS_CONFIG.filter((f) => f.showInForm);

	function buildInitialValues(): Record<string, string> {
		const values: Record<string, string> = {};
		for (const field of formFields) {
			const raw = cuenta ? (cuenta as any)[field.key] : '';
			values[field.key] = raw === null || raw === undefined ? '' : String(raw);
		}
		if (!cuenta && !values.estado) values.estado = 'activa';
		return values;
	}

	let formValues = $state<Record<string, string>>(buildInitialValues());
	let fieldErrors = $state<Record<string, string>>({});
	let submitting = $state(false);

	$effect(() => {
		if (open) {
			formValues = buildInitialValues();
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
	const title = $derived(mode === 'create' ? 'Nueva Cuenta Bancaria' : 'Editar Cuenta Bancaria');

	async function handleSubmit(event: SubmitEvent) {
		event.preventDefault();
		revalidate();
		if (hasErrors) return;

		submitting = true;
		try {
			let result;
			if (mode === 'edit' && cuenta) {
				result = await updateCuentaBanco(supabase, cuenta.id_cuenta_banco, formValues);
			} else {
				result = await createCuentaBanco(supabase, formValues, permisosState.userName || null);
			}

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
		<div class="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
			<div class="sticky top-0 flex items-center justify-between bg-white px-6 py-4 border-b border-slate-200 z-10">
				<h2 class="text-lg font-semibold text-[#0f3b5e]">{title}</h2>
				<button type="button" onclick={onClose} class="p-1 hover:bg-slate-100 rounded-full text-slate-500" aria-label="Cerrar">
					<X size={20} />
				</button>
			</div>

			<form onsubmit={handleSubmit}>
				<div class="p-6 grid grid-cols-2 gap-4">
					{#each formFields as field (field.key)}
						<div class={field.key === 'observacion' ? 'col-span-full' : ''}>
							<label for={`cb-${field.key}`} class="flex items-center gap-1 text-sm font-bold text-slate-700 mb-1">
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
									type={field.tipo === 'date' ? 'date' : 'text'}
									value={formValues[field.key]}
									maxlength={field.maxLength}
									placeholder={field.placeholder}
									oninput={(e) => handleInput(field.key, (e.target as HTMLInputElement).value)}
									class={`w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 ${fieldErrors[field.key] ? 'border-red-400 focus:ring-red-200' : 'border-slate-300 focus:ring-blue-200'}`}
								/>
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
						{mode === 'create' ? 'Crear' : 'Actualizar'}
					</button>
				</div>
			</form>
		</div>
	</div>
{/if}
