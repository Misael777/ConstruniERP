<script lang="ts">
	import { supabase } from '$lib/supabaseClient';
	import { X, Loader2, ListOrdered } from '@lucide/svelte';
	import { toast } from '$lib/stores/toast';
	import { validatePayload, applyFieldMask, formatCurrency, type FieldOption } from '$lib/shared/fieldConfig';
	import { FIELDS_CONFIG } from '$lib/modules/cuentas-pagar/config/cuentaPagar.config';
	import {
		createCuentaPagar,
		createCuentasPagarRecurrentes,
		updateCuentaPagar,
		getPagos,
		calcularFechasRecurrentes,
		computeEstadoCuentaPagar
	} from '$lib/modules/cuentas-pagar/services/cuentasPagar.service';
	import type { CuentaPagar, Pago, FechaCuentaRecurrente } from '$lib/modules/cuentas-pagar/services/cuentasPagar.service';
	import { isAdmin, permisosState } from '$lib/stores/permisos.svelte';
	import FraccionamientoModal, { type Fraccion } from '$lib/shared/components/FraccionamientoModal.svelte';

	let {
		open = false,
		mode = 'create',
		cuenta = null,
		dynamicOptions = {},
		centroCostoTipoMap = {},
		onClose,
		onSaved
	}: {
		open: boolean;
		mode: 'create' | 'edit';
		cuenta: CuentaPagar | null;
		dynamicOptions?: Record<string, FieldOption[]>;
		/** id_centro_costo (texto) -> tipo — para bloquear "ID Partida" cuando el centro de costo
		 * elegido es 'bolsa general', ver getCentroCostoTipoMap en transacciones.service.ts. */
		centroCostoTipoMap?: Record<string, string>;
		onClose: () => void;
		onSaved: () => void;
	} = $props();

	// 'condicion_pago' (Número de Cuotas) ya no se muestra como campo inline: se configura en la
	// ventana "Fraccionar este pago" (ver FraccionamientoModal) y su valor se sigue guardando en
	// formValues programáticamente desde ahí (ver onFraccionesConfirmadas más abajo).
	const formFields = FIELDS_CONFIG.filter((f) => f.showInForm && f.key !== 'condicion_pago');

	function buildInitialValues(): Record<string, string> {
		const values: Record<string, string> = {};
		for (const field of formFields) {
			const raw = cuenta ? (cuenta as any)[field.key] : '';
			values[field.key] = raw === null || raw === undefined ? '' : String(raw);
		}
		// A pedido del usuario: "Responsable" arranca prellenado con el usuario que está creando la
		// cuenta (mismo nombre que empleados.nombre, ver getEmpleadoOptions) — solo al crear, no pisa el
		// valor guardado al editar. Sigue siendo editable por si corresponde asignarla a alguien más.
		if (!cuenta && 'responsable' in values) values.responsable = permisosState.userName;
		// A pedido del usuario: "Frecuencia de Pago" arranca en 'Sin periodicidad' al crear.
		if (!cuenta && 'frecuencia_pago' in values) values.frecuencia_pago = 'sin_periodicidad';
		return values;
	}

	let formValues = $state<Record<string, string>>(buildInitialValues());
	let fieldErrors = $state<Record<string, string>>({});
	let submitting = $state(false);
	let fracciones = $state<Fraccion[]>([]);
	let fraccionamientoOpen = $state(false);
	/** TODAS las cuotas reales de la cuenta (pagado + programado + cancelado), a diferencia de
	 * `fracciones` (que solo trae las 'programado', lo único editable en "Fraccionar este pago") — se
	 * muestran de una vez en el formulario, sin tener que abrir el popup, a pedido del usuario. */
	let cuotasExistentes = $state<Pago[]>([]);

	/** Fecha de la primera fracción configurada (la más temprana) — usada para autocompletar Fecha
	 * Pago Programada cuando Forma de Pago es Crédito. Se calcula sobre `fracciones` a propósito (NO
	 * sobre los pagos ya guardados en BD): así funciona igual creando una cuenta nueva (donde todavía
	 * no existe ninguna fila en `pagos`, solo lo que el usuario acaba de configurar en "Fraccionar
	 * este pago") que editando una existente (donde `fracciones` se precarga desde sus pagos
	 * 'programado' reales, ver el $effect de abajo). '' si no hay ninguna fracción configurada.
	 */
	const cuotaEstadoLabel: Record<Pago['estado_pago'], string> = { pagado: 'Pagado', programado: 'Pendiente', cancelado: 'Anulado' };
	const cuotaEstadoBadge: Record<Pago['estado_pago'], string> = {
		pagado: 'bg-emerald-100 text-emerald-700',
		programado: 'bg-amber-100 text-amber-700',
		cancelado: 'bg-slate-200 text-slate-500'
	};
	function formatDate(value: string | null | undefined): string {
		if (!value) return '—';
		const date = new Date(value);
		if (Number.isNaN(date.getTime())) return '—';
		// timeZone: 'UTC' evita el corrimiento de un día que 'new Date("YYYY-MM-DD")' produce en husos
		// horarios detrás de UTC (Perú, UTC-5) al leerse de vuelta en hora local.
		return date.toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' });
	}

	function primeraFechaFraccion(lista: Fraccion[]): string {
		if (lista.length === 0) return '';
		return lista.reduce((min, f) => (f.fecha < min.fecha ? f : min)).fecha;
	}

	/** Fecha de la fracción más cercana a HOY (por diferencia absoluta en días, no solo la más próxima
	 * en el futuro) — usada para "Fecha Vencimiento" en vez de la última cuota, a pedido del usuario. */
	function fechaMasCercanaAHoy(lista: Fraccion[]): string {
		if (lista.length === 0) return '';
		const hoy = new Date();
		hoy.setHours(0, 0, 0, 0);
		const diff = (fecha: string) => Math.abs(new Date(fecha + 'T00:00:00').getTime() - hoy.getTime());
		return lista.reduce((cercana, f) => (diff(f.fecha) < diff(cercana.fecha) ? f : cercana), lista[0]).fecha;
	}

	/** Contado ('1') -> Fecha Pago Programada en blanco, se pide a mano. Crédito (cualquier otro
	 * valor) -> se autocompleta con la fecha de la primera fracción configurada. */
	function actualizarFechaPagoProgramada(formaPago: string) {
		formValues = {
			...formValues,
			fecha_pago_programada: formaPago === '1' ? '' : primeraFechaFraccion(fracciones)
		};
	}

	$effect(() => {
		if (!open) return;
		formValues = buildInitialValues();
		fieldErrors = {};
		fracciones = [];
		cuotasExistentes = [];
		if (mode === 'edit' && cuenta) {
			(async () => {
				const pagos = await getPagos(supabase, cuenta.id_cuenta_pagar);
				cuotasExistentes = [...pagos].sort((a, b) => (a.fecha_pago < b.fecha_pago ? -1 : a.fecha_pago > b.fecha_pago ? 1 : 0));
				fracciones = pagos
					.filter((p) => p.estado_pago === 'programado')
					.map((p) => ({ fecha: p.fecha_pago, monto: Number(p.monto) }))
					.sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0));
				actualizarFechaPagoProgramada(String(formValues.fotma_pago ?? ''));
			})();
		}
	});

	// fotma_pago '1' = Contado (una sola cuota, sin fraccionar). Cualquier otro valor elegido (ej.
	// Crédito) habilita la ventana "Fraccionar este pago".
	const esFraccionable = $derived(String(formValues.fotma_pago ?? '') !== '' && String(formValues.fotma_pago ?? '') !== '1');

	// A pedido EXPLÍCITO del usuario: "Frecuencia de Pago" mensual/quincenal/semanal NO reparte el
	// Monto Comprometido entre cuotas (eso es "Fraccionar este pago", un concepto distinto) — genera
	// una cuenta por pagar POR CADA fecha del periodo, cada una con el monto íntegro. Solo aplica al
	// CREAR (editar una cuenta ya existente no debe disparar una serie nueva). Ver
	// calcularFechasRecurrentes en cuentasPagar.service.ts — misma función que usa el submit, así la
	// vista previa siempre coincide exactamente con lo que se va a generar.
	const esPeriodico = $derived(mode === 'create' && ['mensual', 'quincenal', 'semanal'].includes(String(formValues.frecuencia_pago ?? '')));
	const previewCuentas = $derived<FechaCuentaRecurrente[]>(
		esPeriodico
			? calcularFechasRecurrentes(
					String(formValues.frecuencia_pago ?? ''),
					formValues.fecha_emision || null,
					formValues.fecha_vencimiento || null,
					formValues.fecha_pago_programada || null,
					formValues.fin_periodo_pago || null
				)
			: []
	);
	function previewEstado(f: FechaCuentaRecurrente): string {
		return computeEstadoCuentaPagar(Number(formValues.monto_comprometido || 0), f.fecha_vencimiento, f.fecha_pago_programada);
	}
	const previewEstadoLabel: Record<string, string> = { pendiente: 'Pendiente', vencido: 'Vencido', pagado: 'Pagado' };
	const previewEstadoBadge: Record<string, string> = {
		pendiente: 'bg-amber-100 text-amber-700',
		vencido: 'bg-red-100 text-red-700',
		pagado: 'bg-emerald-100 text-emerald-700'
	};

	// "ID Partida" e "ID Presupuesto" se bloquean cuando el Centro de Costo elegido es de tipo
	// 'bolsa general' (Corporativo) — un gasto corporativo no se carga a una partida ni a un
	// presupuesto puntual de obra.
	const idPartidaBloqueado = $derived(centroCostoTipoMap[String(formValues.id_centro_costo ?? '')] === 'bolsa general');
	const idPresupuestoBloqueado = $derived(centroCostoTipoMap[String(formValues.id_centro_costo ?? '')] === 'bolsa general');

	// 'condicion_pago' ya no se edita a mano: se mantiene igual a la cantidad de fracciones
	// configuradas (o vacío si Forma de Pago es Contado / todavía no se configuró nada).
	$effect(() => {
		if (!esFraccionable) {
			if (fracciones.length > 0) fracciones = [];
			if (formValues.condicion_pago !== '') formValues = { ...formValues, condicion_pago: '' };
			return;
		}
		const nuevo = fracciones.length > 0 ? String(fracciones.length) : '';
		if (formValues.condicion_pago !== nuevo) formValues = { ...formValues, condicion_pago: nuevo };
	});

	// Al confirmar las cuotas (siempre con Forma de Pago distinta de Contado, único caso en que esta
	// ventana es alcanzable), la Fecha Vencimiento de la cuenta pasa a ser la de la cuota más cercana a
	// HOY (no la última) — a pedido del usuario. La PRIMERA cuota, a su vez, autocompleta Fecha Pago
	// Programada (ver primeraFechaFraccion).
	function onFraccionesConfirmadas(nuevas: Fraccion[]) {
		fracciones = nuevas;
		if (esFraccionable && nuevas.length > 0) {
			formValues = { ...formValues, fecha_vencimiento: fechaMasCercanaAHoy(nuevas) };
		}
		actualizarFechaPagoProgramada(String(formValues.fotma_pago ?? ''));
	}

	function onFraccionamientoEliminado() {
		fracciones = [];
		actualizarFechaPagoProgramada(String(formValues.fotma_pago ?? ''));
	}

	// Recalcula en vivo los campos con computeValue (monto_imponible, monto_igv, monto_retencion)
	// cada vez que cambia algo de lo que dependen (monto_comprometido, detraccion, etc.). También
	// fuerza los campos bloqueados por disabledWhen a su disabledValue.
	$effect(() => {
		for (const field of formFields) {
			if (field.computeValue) {
				const computed = String(field.computeValue(formValues) ?? '');
				if (formValues[field.key] !== computed) formValues[field.key] = computed;
				continue;
			}
			if (field.disabledWhen?.(formValues)) {
				const forzado = String(field.disabledValue ?? '');
				if (formValues[field.key] !== forzado) formValues[field.key] = forzado;
			}
		}
		// "ID Partida" e "ID Presupuesto" no usan disabledWhen/disabledValue (dependen de un lookup
		// externo, ver idPartidaBloqueado/idPresupuestoBloqueado) — se limpian aparte al bloquearse,
		// para no guardar un valor que ya no aplica (bolsa general no se carga a una partida/presupuesto
		// puntual).
		if (idPartidaBloqueado && formValues.id_partida !== '') formValues.id_partida = '';
		if (idPresupuestoBloqueado && formValues.id_presupuesto !== '') formValues.id_presupuesto = '';
	});

	function isDisabled(field: (typeof formFields)[number]): boolean {
		if (field.key === 'id_partida' && idPartidaBloqueado) return true;
		if (field.key === 'id_presupuesto' && idPresupuestoBloqueado) return true;
		return !!field.computeValue || (field.disabledWhen?.(formValues) ?? false);
	}

	function handleInput(key: string, rawValue: string) {
		const field = formFields.find((f) => f.key === key)!;
		const masked = applyFieldMask(field, rawValue);
		formValues = { ...formValues, [key]: masked };
		// Ver actualizarFechaPagoProgramada: Contado -> en blanco, Crédito -> cuota más cercana a hoy.
		if (key === 'fotma_pago') actualizarFechaPagoProgramada(masked);
		revalidate();
	}

	function revalidate() {
		fieldErrors = validatePayload(FIELDS_CONFIG, formValues);
	}

	// "Fraccionar este pago" solo debe repartir lo que TODAVÍA no está pagado: las cuotas 'pagado' ya
	// son reales y sincronizarCuotasProgramadas nunca las toca (solo reemplaza las 'programado'), pero
	// antes se le exigía al usuario que sus fracciones sumaran el Monto Comprometido COMPLETO (ej.
	// S/1000) en vez del saldo que falta (ej. S/650 si ya hay S/350 pagados) — eso forzaba a inflar el
	// calendario con cuotas de más (o negativas, para "cuadrar") solo para poder guardar. Ver
	// FraccionamientoModal (sumaOk exige sumaFilas === montoTotal) y sincronizarCuotasProgramadas.
	const montoPendienteFraccionar = $derived(Math.max(Number(formValues.monto_comprometido || 0) - Number(cuenta?.monto_pagado ?? 0), 0));

	const hasErrors = $derived(Object.keys(fieldErrors).length > 0);
	const title = $derived(mode === 'create' ? 'Nueva Cuenta por Pagar' : 'Editar Cuenta por Pagar');

	const modalWidthClass = $derived(formFields.length <= 4 ? 'max-w-md' : formFields.length <= 8 ? 'max-w-2xl' : 'max-w-4xl');
	const gridColsClass = $derived(formFields.length <= 4 ? 'grid-cols-1' : formFields.length <= 8 ? 'grid-cols-2' : 'grid-cols-3');

	function optionsFor(field: (typeof formFields)[number]): FieldOption[] {
		return (field.optionsSource && dynamicOptions[field.key]) || field.options || [];
	}

	async function handleSubmit(event: SubmitEvent) {
		event.preventDefault();
		revalidate();
		if (hasErrors) return;
		// El fraccionamiento en cuotas (Forma de Pago = Crédito) es un concepto distinto de la serie
		// periódica de "Frecuencia de Pago" — cuando hay serie, no aplica (cada cuenta generada es un
		// pago íntegro de su propio periodo).
		if (!esPeriodico && esFraccionable && fracciones.length === 0) {
			toast.error('Configura las cuotas en "Fraccionar este pago" antes de guardar.');
			return;
		}
		if (esPeriodico && previewCuentas.length === 0) {
			toast.error('Completa Fecha Emisión y Fin de Periodo de Pago para generar la serie.');
			return;
		}

		submitting = true;
		try {
			const fraccionesAEnviar = esFraccionable ? fracciones : [];
			let result;
			if (mode === 'edit' && cuenta) {
				result = await updateCuentaPagar(supabase, cuenta.id_cuenta_pagar, formValues, isAdmin(), fraccionesAEnviar);
			} else if (esPeriodico) {
				const { data: userData } = await supabase.auth.getUser();
				result = await createCuentasPagarRecurrentes(supabase, formValues, userData?.user?.email ?? null, previewCuentas);
			} else {
				const { data: userData } = await supabase.auth.getUser();
				result = await createCuentaPagar(supabase, formValues, userData?.user?.email ?? null, fraccionesAEnviar);
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
							<label for={`ccp-${field.key}`} class="block text-sm font-medium text-[#0f3b5e] mb-1">
								{field.label}
								{#if field.required}<span class="text-red-500">*</span>{/if}
							</label>

							{#if field.tipo === 'select' || field.options}
								<div class="relative">
									{#if field.optionColors}
										<span
											class="absolute left-3 top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full pointer-events-none"
											style={`background-color:${field.optionColors[formValues[field.key]] ?? '#cbd5e1'}`}
										></span>
									{/if}
									<select
										id={`ccp-${field.key}`}
										name={field.key}
										value={formValues[field.key]}
										disabled={isDisabled(field)}
										onchange={(e) => handleInput(field.key, (e.target as HTMLSelectElement).value)}
										class={`w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 disabled:bg-slate-100 disabled:text-slate-400 disabled:cursor-not-allowed ${field.optionColors ? 'pl-7' : ''} ${fieldErrors[field.key] ? 'border-red-400 focus:ring-red-200' : 'border-slate-300 focus:ring-blue-200'}`}
									>
										<option value="" disabled>Selecciona una opción</option>
										{#each optionsFor(field) as opt}
											<option value={opt.value} style={field.optionColors?.[opt.value] ? `color:${field.optionColors[opt.value]}` : undefined}>{opt.label}</option>
										{/each}
									</select>
								</div>
							{:else}
								<input
									id={`ccp-${field.key}`}
									name={field.key}
									type={field.renderAsText ? 'text' : field.tipo === 'number' ? 'number' : field.tipo === 'date' ? 'date' : 'text'}
									inputmode={field.tipo === 'currency' ? 'decimal' : field.renderAsText ? 'numeric' : undefined}
									step={!field.renderAsText && field.tipo === 'number' ? 'any' : undefined}
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
							{:else if field.key === 'id_partida' && idPartidaBloqueado}
								<p class="mt-1 text-xs text-slate-400">Se bloquea porque el Centro de Costo es "Corporativa".</p>
							{:else if field.key === 'id_presupuesto' && idPresupuestoBloqueado}
								<p class="mt-1 text-xs text-slate-400">Se bloquea porque el Centro de Costo es "Corporativa".</p>
							{:else if field.helpText}
								<p class="mt-1 text-xs text-slate-400">{field.helpText}</p>
							{/if}
						</div>

						{#if field.key === 'fotma_pago' && esFraccionable}
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
								<p class="mt-1 text-xs text-slate-400">
									Define fecha y monto de cada cuota.
									{#if Number(cuenta?.monto_pagado ?? 0) > 0}
										Reparte solo el saldo pendiente ({formatCurrency(montoPendienteFraccionar)}) — lo ya pagado no se toca.
									{/if}
								</p>

								{#if mode === 'edit' && cuotasExistentes.length > 0}
									<div class="mt-2 rounded-lg border border-slate-200 divide-y divide-slate-100 max-h-48 overflow-y-auto">
										{#each cuotasExistentes as cuota (cuota.id_pago)}
											<div class="flex items-center justify-between gap-2 px-3 py-1.5 text-xs">
												<span class="text-slate-500">{formatDate(cuota.fecha_pago)}</span>
												<span class="font-semibold text-slate-700">{formatCurrency(cuota.monto)}</span>
												<span class={`px-2 py-0.5 rounded-full font-medium shrink-0 ${cuotaEstadoBadge[cuota.estado_pago]}`}>{cuotaEstadoLabel[cuota.estado_pago]}</span>
											</div>
										{/each}
									</div>
								{/if}
							</div>
						{:else if field.key === 'fotma_pago' && mode === 'edit' && !esFraccionable}
							<div>
								<span class="block text-sm font-medium text-slate-700 mb-1">Cuota (al Contado)</span>
								<!-- Contado es "una sola cuota" por definición (ver esContadoSinPagos en +page.svelte) —
								se presenta con el mismo formato fecha/monto/estado que una cuota de Crédito, en vez de
								no mostrar nada solo porque no hay fraccionamiento configurado. -->
								{#if cuotasExistentes.length > 0}
									<div class="rounded-lg border border-slate-200 divide-y divide-slate-100">
										{#each cuotasExistentes as cuota (cuota.id_pago)}
											<div class="flex items-center justify-between gap-2 px-3 py-1.5 text-xs">
												<span class="text-slate-500">{formatDate(cuota.fecha_pago)}</span>
												<span class="font-semibold text-slate-700">{formatCurrency(cuota.monto)}</span>
												<span class={`px-2 py-0.5 rounded-full font-medium shrink-0 ${cuotaEstadoBadge[cuota.estado_pago]}`}>{cuotaEstadoLabel[cuota.estado_pago]}</span>
											</div>
										{/each}
									</div>
								{:else}
									<div class="flex items-center justify-between gap-2 px-3 py-1.5 text-xs rounded-lg border border-slate-200">
										<span class="text-slate-500">{formatDate(cuenta?.fecha_pago_programada || cuenta?.fecha_vencimiento)}</span>
										<span class="font-semibold text-slate-700">{formatCurrency(cuenta?.saldo_pendiente ?? Number(formValues.monto_comprometido || 0))}</span>
										<span class="px-2 py-0.5 rounded-full font-medium shrink-0 bg-amber-100 text-amber-700">Por registrar</span>
									</div>
								{/if}
								<p class="mt-1 text-xs text-slate-400">Al Contado se paga en una sola cuota — se registra desde "Registrar Pago" en el listado de la cuenta.</p>
							</div>
						{/if}
					{/each}
				</div>

				{#if esPeriodico}
					<div class="px-6 pb-6">
						<h3 class="text-sm font-semibold text-[#0f3b5e] mb-1">Vista previa de la serie</h3>
						{#if previewCuentas.length === 0}
							<p class="text-xs text-slate-400 rounded-lg border border-dashed border-slate-200 px-3 py-4 text-center">
								Completa Fecha Emisión y Fin de Periodo de Pago para ver las cuentas que se van a generar.
							</p>
						{:else}
							<p class="text-xs text-slate-400 mb-2">
								Se van a crear <strong>{previewCuentas.length}</strong> cuentas por pagar, cada una por el monto íntegro — la Frecuencia de Pago no lo reparte entre ellas.
								{#if previewCuentas.length >= 500}
									Se llegó al máximo de 500 registros por serie — ajusta Fin de Periodo de Pago si necesitas menos.
								{/if}
							</p>
							<div class="rounded-lg border border-slate-200 max-h-56 overflow-y-auto">
								<table class="w-full text-xs">
									<thead class="sticky top-0 bg-slate-50 text-slate-500">
										<tr>
											<th class="text-left px-3 py-1.5 font-medium">N°</th>
											<th class="text-left px-3 py-1.5 font-medium">Fecha</th>
											<th class="text-right px-3 py-1.5 font-medium">Monto</th>
											<th class="text-left px-3 py-1.5 font-medium">Estado</th>
										</tr>
									</thead>
									<tbody class="divide-y divide-slate-100">
										{#each previewCuentas as f (f.numero)}
											<tr>
												<td class="px-3 py-1.5 text-slate-500">{f.numero}</td>
												<td class="px-3 py-1.5 text-slate-700">{formatDate(f.fecha_emision)}</td>
												<td class="px-3 py-1.5 text-right font-semibold text-slate-700">{formatCurrency(formValues.monto_comprometido)}</td>
												<td class="px-3 py-1.5">
													<span class={`px-2 py-0.5 rounded-full font-medium ${previewEstadoBadge[previewEstado(f)]}`}>{previewEstadoLabel[previewEstado(f)]}</span>
												</td>
											</tr>
										{/each}
									</tbody>
								</table>
							</div>
						{/if}
					</div>
				{/if}

				<div class="sticky bottom-0 flex gap-2 justify-end bg-white px-6 py-4 border-t border-slate-200">
					<button type="button" onclick={onClose} disabled={submitting} class="px-4 py-2 text-sm font-medium rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50 disabled:opacity-50">
						Cancelar
					</button>
					<button type="submit" disabled={submitting || hasErrors} class="px-4 py-2 text-sm font-medium rounded-lg bg-[#0f3b5e] text-white hover:bg-[#0c2f4c] disabled:opacity-50 flex items-center gap-2">
						{#if submitting}<Loader2 size={16} class="animate-spin" />{/if}
						{mode === 'edit' ? 'Actualizar' : esPeriodico && previewCuentas.length > 0 ? `Generar ${previewCuentas.length} cuentas` : 'Crear'}
					</button>
				</div>
			</form>
		</div>
	</div>
{/if}

<FraccionamientoModal
	open={fraccionamientoOpen}
	montoTotal={montoPendienteFraccionar}
	fechaEmision={formValues.fecha_emision}
	fechaVencimiento={formValues.fecha_vencimiento || null}
	fraccionesIniciales={fracciones}
	metodoSugerido={formValues.fotma_pago === '3' ? 'por_porcentaje' : undefined}
	onClose={() => (fraccionamientoOpen = false)}
	onConfirm={onFraccionesConfirmadas}
	onEliminar={onFraccionamientoEliminado}
/>
