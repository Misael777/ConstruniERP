<script lang="ts">
	import { supabase } from '$lib/supabaseClient';
	import { X, Loader2, ListOrdered } from '@lucide/svelte';
	import { toast } from '$lib/stores/toast';
	import { validatePayload, applyFieldMask, formatCurrency, type FieldOption } from '$lib/shared/fieldConfig';
	import { FIELDS_CONFIG } from '$lib/modules/cuentas-cobrar/config/cuentaCobrar.config';
	import { createCuentaCobrar, updateCuentaCobrar, getCobros } from '$lib/modules/cuentas-cobrar/services/cuentasCobrar.service';
	import type { CuentaCobrar } from '$lib/modules/cuentas-cobrar/services/cuentasCobrar.service';
	import { isAdmin } from '$lib/stores/permisos.svelte';
	import FraccionamientoModal, { type Fraccion } from '$lib/shared/components/FraccionamientoModal.svelte';

	let {
		open = false,
		mode = 'create',
		cuenta = null,
		dynamicOptions = {},
		onClose,
		onSaved
	}: {
		open: boolean;
		mode: 'create' | 'edit';
		cuenta: CuentaCobrar | null;
		dynamicOptions?: Record<string, FieldOption[]>;
		onClose: () => void;
		onSaved: () => void;
	} = $props();

	// 'condición_pago' (Número de Cuotas) ya no se muestra como campo inline: se configura en la
	// ventana "Fraccionar este pago" (ver FraccionamientoModal) y su valor se sigue guardando en
	// formValues programáticamente desde ahí (ver onFraccionesConfirmadas más abajo).
	const formFields = FIELDS_CONFIG.filter((f) => f.showInForm && f.key !== 'condición_pago');

	function buildInitialValues(): Record<string, string> {
		const values: Record<string, string> = {};
		for (const field of formFields) {
			const raw = cuenta ? (cuenta as any)[field.key] : '';
			values[field.key] = raw === null || raw === undefined ? '' : String(raw);
		}
		return values;
	}

	let formValues = $state<Record<string, string>>(buildInitialValues());
	let fieldErrors = $state<Record<string, string>>({});
	let submitting = $state(false);
	let fracciones = $state<Fraccion[]>([]);
	let fraccionamientoOpen = $state(false);

	$effect(() => {
		if (!open) return;
		formValues = buildInitialValues();
		fieldErrors = {};
		fracciones = [];
		if (mode === 'edit' && cuenta) {
			(async () => {
				const cobros = await getCobros(supabase, cuenta.id_cuenta_cobrar);
				fracciones = cobros
					.filter((c) => c.estado_cobro === 'programado')
					.map((c) => ({ fecha: c.fecha_cobro, monto: Number(c.monto) }))
					.sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0));
			})();
		}
	});

	// forma_pago '1' = Contado (una sola cuota, sin fraccionar). Cualquier otro valor elegido
	// (Fraccionado / Por Porcentaje) habilita la ventana "Fraccionar este pago".
	const esFraccionable = $derived(String(formValues.forma_pago ?? '') !== '' && String(formValues.forma_pago ?? '') !== '1');

	// 'condición_pago' ya no se edita a mano: se mantiene igual a la cantidad de fracciones
	// configuradas (o vacío si Forma de Pago es Contado / todavía no se configuró nada).
	$effect(() => {
		if (!esFraccionable) {
			if (fracciones.length > 0) fracciones = [];
			if (formValues['condición_pago'] !== '') formValues = { ...formValues, 'condición_pago': '' };
			return;
		}
		const nuevo = fracciones.length > 0 ? String(fracciones.length) : '';
		if (formValues['condición_pago'] !== nuevo) formValues = { ...formValues, 'condición_pago': nuevo };
	});

	// Al confirmar las cuotas (siempre con Forma de Pago distinta de Contado, único caso en que esta
	// ventana es alcanzable), la fecha de la última cuota pasa a ser la Fecha Vencimiento de la
	// cuenta — evita que quede desalineada con el calendario que el usuario acaba de definir a mano.
	function onFraccionesConfirmadas(nuevas: Fraccion[]) {
		fracciones = nuevas;
		if (esFraccionable && nuevas.length > 0) {
			const ultimaFecha = nuevas.reduce((max, f) => (f.fecha > max ? f.fecha : max), nuevas[0].fecha);
			formValues = { ...formValues, fecha_vencimiento: ultimaFecha };
		}
	}

	function onFraccionamientoEliminado() {
		fracciones = [];
	}

	// Campo bloqueado por disabledWhen -> se fuerza a su disabledValue (fijo o recalculado en vivo a
	// partir del resto del formulario, ej. monto = monto_dolares * tipo_cambio cuando moneda='USD'),
	// o se limpia a '' si no tiene disabledValue (ej. cuotas cuando forma_pago pasa a "Contado") —
	// así nunca se ve un valor "fantasma" desactualizado en un input deshabilitado.
	$effect(() => {
		for (const field of formFields) {
			if (!field.disabledWhen?.(formValues)) continue;
			const forzado = typeof field.disabledValue === 'function' ? String(field.disabledValue(formValues) ?? '') : String(field.disabledValue ?? '');
			if (formValues[field.key] !== forzado) formValues[field.key] = forzado;
		}
	});

	function isDisabled(field: (typeof formFields)[number]): boolean {
		return field.disabledWhen?.(formValues) ?? false;
	}

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
	const title = $derived(mode === 'create' ? 'Nueva Cuenta por Cobrar' : 'Editar Cuenta por Cobrar');

	const modalWidthClass = $derived(formFields.length <= 4 ? 'max-w-md' : formFields.length <= 8 ? 'max-w-2xl' : 'max-w-4xl');
	const gridColsClass = $derived(formFields.length <= 4 ? 'grid-cols-1' : formFields.length <= 8 ? 'grid-cols-2' : 'grid-cols-3');

	function optionsFor(field: (typeof formFields)[number]): FieldOption[] {
		return (field.optionsSource && dynamicOptions[field.key]) || field.options || [];
	}

	async function handleSubmit(event: SubmitEvent) {
		event.preventDefault();
		revalidate();
		if (hasErrors) return;
		if (esFraccionable && fracciones.length === 0) {
			toast.error('Configura las cuotas en "Fraccionar este pago" antes de guardar.');
			return;
		}

		submitting = true;
		try {
			const fraccionesAEnviar = esFraccionable ? fracciones : [];
			let result;
			if (mode === 'edit' && cuenta) {
				result = await updateCuentaCobrar(supabase, cuenta.id_cuenta_cobrar, formValues, isAdmin(), fraccionesAEnviar);
			} else {
				const { data: userData } = await supabase.auth.getUser();
				result = await createCuentaCobrar(supabase, formValues, userData?.user?.email ?? null, fraccionesAEnviar);
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
		<div class={`bg-white rounded-2xl shadow-2xl w-full ${modalWidthClass} max-h-[90vh] overflow-y-auto`}>
			<div class="sticky top-0 flex items-center justify-between bg-white px-6 py-4 border-b border-slate-200 z-10">
				<h2 class="text-lg font-semibold text-[#0f3b5e]">{title}</h2>
				<button type="button" onclick={onClose} class="p-1 hover:bg-slate-100 rounded-full text-slate-500" aria-label="Cerrar">
					<X size={20} />
				</button>
			</div>

			<form onsubmit={handleSubmit}>
				<div class={`p-6 grid ${gridColsClass} gap-4`}>
					{#each formFields as field (field.key)}
						<div>
							<label for={`ccb-${field.key}`} class="block text-sm font-medium text-slate-700 mb-1">
								{field.label}
								{#if field.required}<span class="text-red-500">*</span>{/if}
							</label>

							{#if field.tipo === 'select' || field.options}
								<select
									id={`ccb-${field.key}`}
									name={field.key}
									value={formValues[field.key]}
									disabled={isDisabled(field)}
									onchange={(e) => handleInput(field.key, (e.target as HTMLSelectElement).value)}
									class={`w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 disabled:bg-slate-100 disabled:text-slate-400 disabled:cursor-not-allowed ${fieldErrors[field.key] ? 'border-red-400 focus:ring-red-200' : 'border-slate-300 focus:ring-blue-200'}`}
								>
									<option value="" disabled>Selecciona una opción</option>
									{#each optionsFor(field) as opt}
										<option value={opt.value}>{opt.label}</option>
									{/each}
								</select>
							{:else}
								<input
									id={`ccb-${field.key}`}
									name={field.key}
									type={field.tipo === 'number' ? 'number' : field.tipo === 'date' ? 'date' : 'text'}
									inputmode={field.tipo === 'currency' ? 'decimal' : undefined}
									step={field.tipo === 'number' ? 'any' : undefined}
									value={formValues[field.key]}
									maxlength={field.maxLength}
									placeholder={field.placeholder}
									disabled={isDisabled(field)}
									oninput={(e) => handleInput(field.key, (e.target as HTMLInputElement).value)}
									class={`w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 disabled:bg-slate-100 disabled:text-slate-400 disabled:cursor-not-allowed ${fieldErrors[field.key] ? 'border-red-400 focus:ring-red-200' : 'border-slate-300 focus:ring-blue-200'}`}
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

						{#if field.key === 'forma_pago' && esFraccionable}
							<div>
								<span class="block text-sm font-medium text-slate-700 mb-1">Cuotas</span>
								<button
									type="button"
									onclick={() => (fraccionamientoOpen = true)}
									class="w-full flex items-center justify-center gap-2 rounded-lg border border-dashed border-blue-300 bg-blue-50 px-3 py-2 text-sm font-medium text-blue-700 hover:bg-blue-100"
								>
									<ListOrdered size={16} />
									{fracciones.length > 0 ? `Configurar Cuotas (${fracciones.length})` : 'Configurar Cuotas'}
								</button>
								<p class="mt-1 text-xs text-slate-400">Define fecha y monto de cada cuota.</p>
							</div>
						{/if}
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

<FraccionamientoModal
	open={fraccionamientoOpen}
	montoTotal={Number(formValues.monto) || 0}
	fechaEmision={formValues.fecha_emision}
	fechaVencimiento={formValues.fecha_vencimiento || null}
	fraccionesIniciales={fracciones}
	onClose={() => (fraccionamientoOpen = false)}
	onConfirm={onFraccionesConfirmadas}
	onEliminar={onFraccionamientoEliminado}
/>
