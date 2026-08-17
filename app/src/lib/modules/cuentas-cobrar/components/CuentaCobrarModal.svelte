<script lang="ts">
	import { supabase } from '$lib/supabaseClient';
	import { X, Loader2, ListOrdered } from '@lucide/svelte';
	import { toast } from '$lib/stores/toast';
	import { validatePayload, applyFieldMask, formatCurrency, type FieldOption } from '$lib/shared/fieldConfig';
	import { FIELDS_CONFIG } from '$lib/modules/cuentas-cobrar/config/cuentaCobrar.config';
	import { createCuentaCobrar, updateCuentaCobrar, getCobros, computeEstadoCuentaCobrar } from '$lib/modules/cuentas-cobrar/services/cuentasCobrar.service';
	import type { CuentaCobrar } from '$lib/modules/cuentas-cobrar/services/cuentasCobrar.service';
	import { getMontoRecibidoPorCentroCosto } from '$lib/modules/centro-costos/services/centroCostos.service';
	import { isAdmin, permisosState } from '$lib/stores/permisos.svelte';
	import FraccionamientoModal, { type Fraccion } from '$lib/shared/components/FraccionamientoModal.svelte';

	let {
		open = false,
		mode = 'create',
		cuenta = null,
		dynamicOptions = {},
		centroCostoMontoMap = {},
		centroCostoProyectoMap = {},
		centroCostoClienteMap = {},
		onClose,
		onSaved
	}: {
		open: boolean;
		mode: 'create' | 'edit';
		cuenta: CuentaCobrar | null;
		dynamicOptions?: Record<string, FieldOption[]>;
		/** id_centro_costo (texto) -> precio_venta de la venta cerrada vinculada — para autocompletar
		 * "Monto" al elegir el Centro de Costo (ver handleInput), a pedido del usuario. */
		centroCostoMontoMap?: Record<string, number>;
		/** id_centro_costo (texto) -> id_proyecto de la venta cerrada vinculada — para autocompletar
		 * "Proyecto" con el código de ese proyecto al elegir el Centro de Costo (ver handleInput), a
		 * pedido explícito del usuario. */
		centroCostoProyectoMap?: Record<string, string>;
		/** id_centro_costo (texto) -> id_cliente del proyecto vinculado — a pedido explícito del
		 * usuario: si se elige el Centro de Costo primero, autocompleta "Cliente"; si se elige el
		 * Cliente primero, filtra la lista de Centro de Costo a solo los suyos (ver handleInput /
		 * optionsFor). */
		centroCostoClienteMap?: Record<string, string>;
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
		// Moneda arranca en Soles por defecto para una cuenta nueva (a pedido del usuario) — en
		// edición se respeta lo que ya tenía guardado esa cuenta.
		if (!cuenta && !values.moneda) values.moneda = 'PEN';
		// A pedido del usuario: "Responsable" arranca prellenado con el usuario que inició sesión (mismo
		// patrón que CuentaPagarModal.svelte) — solo al crear, no pisa el valor guardado al editar. Sigue
		// siendo editable por si corresponde asignarla a alguien más.
		if (!cuenta && 'responsable' in values) values.responsable = permisosState.userName;
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

	// A pedido explícito del usuario: "Saldo Pendiente" = Valor de venta - la suma de los montos YA
	// registrados en `transaccion` como ingreso hacia el centro de costo de ese proyecto (no
	// `cuenta.monto_cobrado`, que es un total aparte llevado por los "cobros" de ESTA cuenta puntual —
	// acá se pidió específicamente la plata real ya recibida por el proyecto, vía transacciones). Se
	// recalcula cada vez que cambia el Centro de Costo elegido (distinto proyecto = distinto total
	// recibido) o se abre el modal.
	let montoRecibidoCentro = $state(0);
	$effect(() => {
		if (!open || !formValues.id_centro_costo) {
			montoRecibidoCentro = 0;
			return;
		}
		const idCentro = Number(formValues.id_centro_costo);
		if (!idCentro) {
			montoRecibidoCentro = 0;
			return;
		}
		(async () => {
			const montos = await getMontoRecibidoPorCentroCosto(supabase, [idCentro]);
			montoRecibidoCentro = montos[idCentro] ?? 0;
		})();
	});
	const saldoPendienteReal = $derived(Math.max(Number(formValues.monto || 0) - montoRecibidoCentro, 0));

	// "Estado" ya no es un select editable a mano (showInForm:false en cuentaCobrar.config.ts, se
	// recalcula solo en el servicio) — a pedido del usuario, igual se muestra acá como vista previa en
	// un textbox de solo lectura, con la misma fórmula que usará el servicio al guardar.
	const estadoActual = $derived(computeEstadoCuentaCobrar(saldoPendienteReal, formValues.fecha_vencimiento || null));
	const estadoLabel: Record<string, string> = { pendiente: 'Pendiente', pagado: 'Pagado', vencido: 'Vencido' };
	// Mismos colores que el badge de "Estado" en la tabla del listado (+page.svelte), para consistencia.
	const estadoTextClass: Record<string, string> = { pendiente: 'text-amber-700', pagado: 'text-emerald-700', vencido: 'text-red-700' };

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
		// "Monto" lo determina el Centro de Costo elegido (precio de esa venta cerrada) — a pedido del
		// usuario, se muestra pero ya no se puede editar a mano una vez que hay un monto conocido para
		// ese centro de costo (ver handleInput/centroCostoMontoMap).
		if (field.key === 'monto' && centroCostoMontoMap[formValues.id_centro_costo] !== undefined) return true;
		// "Proyecto" lo determina el Centro de Costo elegido (cada venta cerrada tiene su propio centro
		// de costo) — a pedido explícito del usuario, se autocompleta y ya no se elige a mano una vez
		// que hay un proyecto vinculado a ese centro de costo (ver handleInput/centroCostoProyectoMap).
		if (field.key === 'id_proyecto' && centroCostoProyectoMap[formValues.id_centro_costo] !== undefined) return true;
		// "Cliente" lo determina el Centro de Costo elegido, igual que "Proyecto" — a pedido explícito
		// del usuario ("si elijo primero el centro de costo, el campo cliente debe mostrar el cliente
		// de ese proyecto"), se autocompleta y se bloquea una vez que hay un cliente vinculado a ese
		// centro de costo (ver handleInput/centroCostoClienteMap).
		if (field.key === 'id_cliente' && centroCostoClienteMap[formValues.id_centro_costo] !== undefined) return true;
		return field.disabledWhen?.(formValues) ?? false;
	}

	function handleInput(key: string, rawValue: string) {
		const field = formFields.find((f) => f.key === key)!;
		const masked = applyFieldMask(field, rawValue);
		formValues = { ...formValues, [key]: masked };
		// Autocompleta "Monto", "Proyecto" y "Cliente" a partir de la venta cerrada vinculada a ese
		// Centro de Costo — "Monto" el usuario puede seguir editándolo a mano; "Proyecto" y "Cliente"
		// quedan fijos al de esa venta (ver isDisabled).
		if (key === 'id_centro_costo') {
			const monto = centroCostoMontoMap[masked];
			if (monto !== undefined) formValues = { ...formValues, monto: monto.toFixed(2) };
			const idProyecto = centroCostoProyectoMap[masked];
			const idCliente = centroCostoClienteMap[masked];
			formValues = { ...formValues, id_proyecto: idProyecto ?? '', id_cliente: idCliente ?? formValues.id_cliente };
		}
		// Si cambia el Cliente y el Centro de Costo ya elegido no es de ese cliente, se limpia (junto con
		// lo que dependía de él) para no dejar una combinación inconsistente en pantalla.
		if (key === 'id_cliente' && formValues.id_centro_costo && centroCostoClienteMap[formValues.id_centro_costo] !== masked) {
			formValues = { ...formValues, id_centro_costo: '', monto: '', id_proyecto: '' };
		}
		revalidate();
	}

	function revalidate() {
		fieldErrors = validatePayload(FIELDS_CONFIG, formValues);
	}

	/** A pedido explícito del usuario: la suma de las cuotas en "Fraccionar Cobros" debe ser EXACTAMENTE
	 * igual al Saldo Pendiente (saldoPendienteReal, calculado arriba: valor de venta menos lo ya
	 * recibido según `transaccion`) — ni más ni menos; ese es el `montoTotal` que se le pasa a
	 * FraccionamientoModal más abajo, que ya exige la igualdad exacta al guardar (ver `sumaOk` ahí). El
	 * "Monto próximo a cobrar" usa el mismo total como caída por defecto. */
	const montoProximoACobrar = $derived.by(() => {
		if (esFraccionable && fracciones.length > 0) {
			const hoy = new Date();
			hoy.setHours(0, 0, 0, 0);
			const diff = (fecha: string) => Math.abs(new Date(fecha + 'T00:00:00').getTime() - hoy.getTime());
			return fracciones.reduce((min, f) => (diff(f.fecha) < diff(min.fecha) ? f : min), fracciones[0]).monto;
		}
		return saldoPendienteReal;
	});

	const hasErrors = $derived(Object.keys(fieldErrors).length > 0);
	const title = $derived(mode === 'create' ? 'Nueva Cuenta por Cobrar' : 'Editar Cuenta por Cobrar');

	const modalWidthClass = $derived(formFields.length <= 4 ? 'max-w-md' : formFields.length <= 8 ? 'max-w-2xl' : 'max-w-5xl');
	const gridColsClass = $derived(formFields.length <= 4 ? 'grid-cols-1' : formFields.length <= 8 ? 'grid-cols-2' : 'grid-cols-3');

	// "Resumen de venta" (Valor de venta / Saldo Pendiente / Próximo a cobrar) se muestra en un
	// recuadro aparte al lado derecho del popup — a pedido del usuario, para que no se amontone junto
	// al campo "Valor de venta" y sus vecinos (Monto en Dólares/Tipo de Cambio).
	const mostrarResumenVenta = $derived(!!formValues.monto && !fieldErrors.monto);

	function optionsFor(field: (typeof formFields)[number]): FieldOption[] {
		const base = (field.optionsSource && dynamicOptions[field.key]) || field.options || [];
		// Si ya hay un Cliente elegido, "Centro de Costo" solo ofrece los suyos — a pedido explícito del
		// usuario ("si elijo un cliente, el campo centro de costo debe mostrarme todos los centros de
		// costos activos que tengan ese cliente"). Sin Cliente elegido se muestran todos (sin filtrar).
		if (field.key === 'id_centro_costo' && formValues.id_cliente) {
			return base.filter((opt) => centroCostoClienteMap[opt.value] === formValues.id_cliente);
		}
		return base;
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
				<div class="p-6 flex flex-col lg:flex-row gap-4 items-start">
				<div class={`grid ${gridColsClass} gap-4 flex-1 min-w-0`}>
					{#each formFields as field (field.key)}
						<div>
							<label for={`ccb-${field.key}`} class="block text-sm font-medium text-[#0f3b5e] mb-1">
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
										id={`ccb-${field.key}`}
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

							{#if field.tipo === 'currency' && field.key !== 'monto' && formValues[field.key] && !fieldErrors[field.key]}
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
								<p class="mt-1 text-xs text-slate-400">
								Define fecha y monto de cada cuota — la suma debe ser igual al Saldo Pendiente ({formatCurrency(saldoPendienteReal)}).
							</p>
							</div>
						{/if}
					{/each}
				</div>

				{#if mostrarResumenVenta}
					<div class="w-full lg:w-60 shrink-0 rounded-xl border border-slate-200 bg-slate-50 p-4">
						<h3 class="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-3">Resumen de venta</h3>
						<div class="flex flex-col gap-3">
							<div>
								<span class="block text-xs text-slate-500 mb-1">Valor de venta</span>
								<input
									type="text"
									readonly
									value={formatCurrency(formValues.monto)}
									class="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 cursor-default focus:outline-none"
								/>
							</div>
							<div>
								<span class="block text-xs text-slate-500 mb-1">Saldo Pendiente</span>
								<input
									type="text"
									readonly
									value={formatCurrency(saldoPendienteReal)}
									class="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 cursor-default focus:outline-none"
								/>
							</div>
							<div>
								<span class="block text-xs text-slate-500 mb-1">Próximo a cobrar</span>
								<input
									type="text"
									readonly
									value={formatCurrency(montoProximoACobrar)}
									class="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 cursor-default focus:outline-none"
								/>
							</div>
							<div>
								<span class="block text-xs text-slate-500 mb-1">Estado</span>
								<input
									type="text"
									readonly
									value={estadoLabel[estadoActual]}
									class={`w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold cursor-default focus:outline-none ${estadoTextClass[estadoActual]}`}
								/>
							</div>
						</div>
					</div>
				{/if}
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
	titulo="Fraccionar Cobros"
	montoTotal={saldoPendienteReal}
	fechaEmision={formValues.fecha_emision}
	fechaVencimiento={formValues.fecha_vencimiento || null}
	fraccionesIniciales={fracciones}
	onClose={() => (fraccionamientoOpen = false)}
	onConfirm={onFraccionesConfirmadas}
	onEliminar={onFraccionamientoEliminado}
/>
