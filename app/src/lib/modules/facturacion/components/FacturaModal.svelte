<script lang="ts">
	// Nueva/Editar Factura (borrador) — dirigido por FIELDS_CONFIG para los campos de cabecera simples
	// (mismo motor genérico que el resto de Finanzas, ver fieldConfig.ts), con dos secciones custom
	// mezcladas en el mismo formulario (mismo criterio que "Fraccionar este pago" en
	// CuentaCobrarModal.svelte): el selector de Proyecto (que además autocompleta Cliente/RUC y carga
	// las partidas facturables de ese proyecto) y la tabla de líneas + resumen de totales en vivo.
	//
	// Proyecto/Partida usan <select> NATIVO a propósito (no un widget custom) — un <select> nativo ya
	// trae "escribe para saltar a la opción" gratis del navegador, sin tener que construir un
	// typeahead a mano (ver feedback_dropdown_typeahead en memoria).
	import { supabase } from '$lib/supabaseClient';
	import { X, Loader2, Plus, Trash2 } from '@lucide/svelte';
	import { toast } from '$lib/stores/toast';
	import { validatePayload, applyFieldMask, formatCurrency, type FieldOption } from '$lib/shared/fieldConfig';
	import { FIELDS_CONFIG } from '$lib/modules/facturacion/config/factura.config';
	import {
		getProyectosParaFacturar,
		getPartidasFacturables,
		calcularTotalesFactura,
		guardarBorradorFactura,
		emitirFactura,
		type Factura,
		type FacturaDetalle,
		type ProyectoParaFacturar,
		type PartidaFacturable
	} from '$lib/modules/facturacion/services/facturacion.service';
	import { permisosState } from '$lib/stores/permisos.svelte';

	let {
		open = false,
		mode = 'create',
		factura = null,
		detalleInicial = [],
		onClose,
		onSaved
	}: {
		open: boolean;
		mode: 'create' | 'edit';
		factura: Factura | null;
		detalleInicial?: FacturaDetalle[];
		onClose: () => void;
		onSaved: () => void | Promise<void>;
	} = $props();

	type Fila = { id_partida: number | null; codigo: string | null; descripcion: string; unidad: string | null; cantidad: number; precio_unitario: number };

	const formFields = FIELDS_CONFIG.filter((f) => f.showInForm);

	function buildInitialValues(): Record<string, string> {
		const values: Record<string, string> = {};
		for (const field of formFields) {
			const raw = factura ? (factura as any)[field.key] : '';
			values[field.key] = raw === null || raw === undefined ? '' : String(raw);
		}
		if (!factura) values.moneda = 'PEN';
		if (!factura) values.tipo_comprobante = 'factura';
		return values;
	}

	function buildInitialFilas(): Fila[] {
		return detalleInicial.map((d) => ({
			id_partida: d.id_partida,
			codigo: d.codigo,
			descripcion: d.descripcion,
			unidad: d.unidad,
			cantidad: Number(d.cantidad),
			precio_unitario: Number(d.precio_unitario)
		}));
	}

	let formValues = $state<Record<string, string>>(buildInitialValues());
	let fieldErrors = $state<Record<string, string>>({});
	let idProyecto = $state(factura ? String(factura.id_proyecto) : '');
	let filas = $state<Fila[]>(buildInitialFilas());
	let proyectos = $state<ProyectoParaFacturar[]>([]);
	let partidasDisponibles = $state<PartidaFacturable[]>([]);
	let cargandoPartidas = $state(false);
	let guardando = $state<'borrador' | 'emitir' | null>(null);

	$effect(() => {
		if (!open) return;
		formValues = buildInitialValues();
		fieldErrors = {};
		idProyecto = factura ? String(factura.id_proyecto) : '';
		filas = buildInitialFilas();
		getProyectosParaFacturar(supabase)
			.then((data) => (proyectos = data))
			.catch((err) => console.error('[FacturaModal] No se pudieron cargar los proyectos:', err));
	});

	const proyectoSeleccionado = $derived(proyectos.find((p) => String(p.id_proyecto) === idProyecto) ?? null);

	async function handleProyectoChange(value: string) {
		idProyecto = value;
		partidasDisponibles = [];
		if (!value) return;
		cargandoPartidas = true;
		try {
			partidasDisponibles = await getPartidasFacturables(supabase, Number(value));
		} catch (err) {
			console.error('[FacturaModal] No se pudieron cargar las partidas del proyecto:', err);
		} finally {
			cargandoPartidas = false;
		}
	}

	// Precarga las partidas también al editar un borrador que ya tenía un proyecto elegido (buildInitialFilas
	// ya trae las líneas guardadas — esto solo alimenta el selector de "agregar otra línea").
	$effect(() => {
		if (open && idProyecto && partidasDisponibles.length === 0 && !cargandoPartidas) {
			getPartidasFacturables(supabase, Number(idProyecto))
				.then((data) => (partidasDisponibles = data))
				.catch(() => {});
		}
	});

	function agregarFila() {
		filas = [...filas, { id_partida: null, codigo: null, descripcion: '', unidad: null, cantidad: 1, precio_unitario: 0 }];
	}

	function quitarFila(index: number) {
		filas = filas.filter((_, i) => i !== index);
	}

	function elegirPartida(index: number, idPartidaStr: string) {
		const idPartida = idPartidaStr ? Number(idPartidaStr) : null;
		const partida = partidasDisponibles.find((p) => p.id_partida === idPartida) ?? null;
		filas = filas.map((f, i) =>
			i === index
				? partida
					? { id_partida: partida.id_partida, codigo: partida.codigo, descripcion: partida.descripcion, unidad: partida.unidad, cantidad: f.cantidad || 1, precio_unitario: partida.precio_unitario_sugerido }
					: { ...f, id_partida: null, codigo: null }
				: f
		);
	}

	function actualizarFila(index: number, campo: 'descripcion' | 'unidad' | 'cantidad' | 'precio_unitario', valor: string) {
		filas = filas.map((f, i) => {
			if (i !== index) return f;
			if (campo === 'cantidad' || campo === 'precio_unitario') return { ...f, [campo]: Number(valor) || 0 };
			return { ...f, [campo]: valor };
		});
	}

	function handleInput(key: string, rawValue: string) {
		const field = formFields.find((f) => f.key === key)!;
		const masked = applyFieldMask(field, rawValue);
		formValues = { ...formValues, [key]: masked };
		revalidate();
	}

	function revalidate() {
		fieldErrors = validatePayload(FIELDS_CONFIG, formValues);
		if (!idProyecto) fieldErrors = { ...fieldErrors, id_proyecto: 'Selecciona un proyecto' };
	}

	function isDisabled(field: (typeof formFields)[number]): boolean {
		return field.disabledWhen?.(formValues) ?? false;
	}

	function optionsFor(field: (typeof formFields)[number]): FieldOption[] {
		return field.options ?? [];
	}

	const totales = $derived.by(() => calcularTotalesFactura(filas, Number(formValues.porcentaje_amortizacion || 0), Number(formValues.porcentaje_retencion_garantia || 0)));
	const hasErrors = $derived(Object.keys(fieldErrors).length > 0);
	const puedeGuardar = $derived(!!idProyecto && filas.length > 0 && filas.every((f) => f.descripcion.trim() !== ''));
	const soloLectura = $derived(mode === 'edit' && factura?.estado !== 'borrador');
	const title = $derived(soloLectura ? 'Consultar Factura' : mode === 'create' ? 'Nueva Factura' : 'Editar Factura (Borrador)');

	function payloadCompleto(): Record<string, unknown> {
		return { ...formValues, id_proyecto: idProyecto, id_cliente: proyectoSeleccionado ? String(proyectoSeleccionado.id_cliente) : '' };
	}

	async function handleGuardarBorrador() {
		revalidate();
		if (!idProyecto || hasErrors) {
			toast.error('Revisa los campos marcados');
			return;
		}
		guardando = 'borrador';
		try {
			const result = await guardarBorradorFactura(supabase, payloadCompleto(), filas, permisosState.userName || null, factura?.id_factura);
			if (result.success) {
				toast.success(result.message);
				await onSaved();
				onClose();
			} else {
				toast.error(result.message);
				if (result.errors) fieldErrors = { ...fieldErrors, ...result.errors };
			}
		} catch (err: any) {
			toast.error(err?.message ?? 'Ocurrió un error inesperado');
		} finally {
			guardando = null;
		}
	}

	async function handleEmitir() {
		revalidate();
		if (!idProyecto || hasErrors) {
			toast.error('Revisa los campos marcados');
			return;
		}
		guardando = 'emitir';
		try {
			const resultGuardado = await guardarBorradorFactura(supabase, payloadCompleto(), filas, permisosState.userName || null, factura?.id_factura);
			if (!resultGuardado.success || !resultGuardado.data) {
				toast.error(resultGuardado.message);
				if (resultGuardado.errors) fieldErrors = { ...fieldErrors, ...resultGuardado.errors };
				return;
			}
			const resultEmitir = await emitirFactura(supabase, resultGuardado.data.id_factura, permisosState.userName || null, permisosState.userName || null);
			if (resultEmitir.success) {
				toast.success('Factura emitida — se generó la Cuenta por Cobrar vinculada.');
				await onSaved();
				onClose();
			} else {
				toast.error(resultEmitir.message);
			}
		} catch (err: any) {
			toast.error(err?.message ?? 'Ocurrió un error inesperado');
		} finally {
			guardando = null;
		}
	}
</script>

{#if open}
	<div class="fixed inset-0 bg-black/50 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
		<div class="bg-white rounded-2xl shadow-2xl w-full max-w-5xl max-h-[92vh] flex flex-col overflow-hidden">
			<div class="flex items-center justify-between px-6 py-4 border-b border-slate-200 flex-shrink-0">
				<h2 class="text-lg font-semibold text-[#0f3b5e]">{title}{proyectoSeleccionado ? ` — Proyecto: ${proyectoSeleccionado.codigo}` : ''}</h2>
				<button onclick={onClose} class="text-slate-400 hover:text-slate-600 w-8 h-8 flex items-center justify-center hover:bg-slate-100 rounded-lg" aria-label="Cerrar">
					<X size={18} />
				</button>
			</div>

			<div class="p-6 overflow-y-auto flex-1">
				<div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-5">
					<div>
						<label for="fac-proyecto" class="block text-sm font-medium text-[#0f3b5e] mb-1">Proyecto <span class="text-red-500">*</span></label>
						<select
							id="fac-proyecto"
							value={idProyecto}
							disabled={mode === 'edit'}
							onchange={(e) => handleProyectoChange((e.target as HTMLSelectElement).value)}
							class={`w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 disabled:bg-slate-100 disabled:text-slate-500 ${fieldErrors.id_proyecto ? 'border-red-400 focus:ring-red-200' : 'border-slate-300 focus:ring-blue-200'}`}
						>
							<option value="" disabled>Selecciona un proyecto</option>
							{#each proyectos as p (p.id_proyecto)}
								<option value={String(p.id_proyecto)}>{p.codigo} — {p.nombre_proyecto}</option>
							{/each}
						</select>
						{#if fieldErrors.id_proyecto}<p class="mt-1 text-xs text-red-600">{fieldErrors.id_proyecto}</p>{/if}
					</div>
					<div>
						<span class="block text-sm font-medium text-[#0f3b5e] mb-1">Cliente</span>
						<input type="text" readonly value={proyectoSeleccionado?.cliente?.nombre ?? ''} class="w-full rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 text-sm text-slate-600 cursor-default" />
						{#if proyectoSeleccionado?.cliente}
							<p class="mt-1 text-xs text-slate-400">{proyectoSeleccionado.cliente.tipo_doc ?? '—'}: {proyectoSeleccionado.cliente.num_documento ?? '—'}</p>
						{/if}
					</div>
					{#if factura?.folio}
						<div>
							<span class="block text-sm font-medium text-[#0f3b5e] mb-1">Folio</span>
							<input type="text" readonly value={factura.folio} class="w-full rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 text-sm text-slate-600 cursor-default" />
						</div>
					{/if}
				</div>

				<div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
					{#each formFields as field (field.key)}
						<div>
							<label for={`fac-${field.key}`} class="block text-sm font-medium text-[#0f3b5e] mb-1">
								{field.label}
								{#if field.required}<span class="text-red-500">*</span>{/if}
							</label>
							{#if field.tipo === 'select' || field.options}
								<select
									id={`fac-${field.key}`}
									value={formValues[field.key]}
									disabled={isDisabled(field)}
									onchange={(e) => handleInput(field.key, (e.target as HTMLSelectElement).value)}
									class={`w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 disabled:bg-slate-100 disabled:text-slate-400 ${fieldErrors[field.key] ? 'border-red-400 focus:ring-red-200' : 'border-slate-300 focus:ring-blue-200'}`}
								>
									<option value="" disabled>Selecciona una opción</option>
									{#each optionsFor(field) as opt}
										<option value={opt.value}>{opt.label}</option>
									{/each}
								</select>
							{:else if field.key === 'comentarios'}
								<textarea
									id={`fac-${field.key}`}
									value={formValues[field.key]}
									maxlength={field.maxLength}
									placeholder="Comentarios o Notas"
									rows="2"
									oninput={(e) => handleInput(field.key, (e.target as HTMLTextAreaElement).value)}
									class={`w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 ${fieldErrors[field.key] ? 'border-red-400 focus:ring-red-200' : 'border-slate-300 focus:ring-blue-200'}`}
								></textarea>
							{:else}
								<input
									id={`fac-${field.key}`}
									type={field.tipo === 'number' ? 'number' : field.tipo === 'date' ? 'date' : 'text'}
									step={field.tipo === 'number' ? 'any' : undefined}
									value={formValues[field.key]}
									placeholder={field.placeholder}
									disabled={isDisabled(field)}
									oninput={(e) => handleInput(field.key, (e.target as HTMLInputElement).value)}
									class={`w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 disabled:bg-slate-100 disabled:text-slate-400 ${fieldErrors[field.key] ? 'border-red-400 focus:ring-red-200' : 'border-slate-300 focus:ring-blue-200'}`}
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

				<div class="flex items-center justify-between mb-2">
					<h3 class="text-sm font-semibold text-[#0f3b5e]">Partidas</h3>
					<button type="button" onclick={agregarFila} class="flex items-center gap-1.5 text-xs font-medium text-blue-700 hover:text-blue-800">
						<Plus size={14} /> Añadir Partida
					</button>
				</div>

				<div class="border border-slate-200 rounded-xl overflow-hidden mb-6">
					<div class="grid grid-cols-[1.6fr_2fr_0.7fr_0.8fr_1fr_1fr_auto] gap-2 items-center px-3 py-2 bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-500 uppercase">
						<span>Partida (Código)</span>
						<span>Descripción</span>
						<span>Unidad</span>
						<span class="text-right">Cantidad</span>
						<span class="text-right">P. Unitario</span>
						<span class="text-right">Subtotal</span>
						<span></span>
					</div>
					{#each filas as fila, i (i)}
						<div class="grid grid-cols-[1.6fr_2fr_0.7fr_0.8fr_1fr_1fr_auto] gap-2 items-center px-3 py-2 border-b border-slate-100 last:border-b-0">
							<select
								value={fila.id_partida != null ? String(fila.id_partida) : ''}
								onchange={(e) => elegirPartida(i, (e.target as HTMLSelectElement).value)}
								class="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-200"
							>
								<option value="">Línea libre</option>
								{#each partidasDisponibles as p (p.id_partida)}
									<option value={String(p.id_partida)}>{p.codigo}</option>
								{/each}
							</select>
							<input
								type="text"
								value={fila.descripcion}
								disabled={fila.id_partida != null}
								placeholder="Descripción"
								oninput={(e) => actualizarFila(i, 'descripcion', (e.target as HTMLInputElement).value)}
								class="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs disabled:bg-slate-100 disabled:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
							/>
							<input
								type="text"
								value={fila.unidad ?? ''}
								disabled={fila.id_partida != null}
								placeholder="und"
								oninput={(e) => actualizarFila(i, 'unidad', (e.target as HTMLInputElement).value)}
								class="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs disabled:bg-slate-100 disabled:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
							/>
							<input
								type="number"
								step="any"
								value={fila.cantidad}
								oninput={(e) => actualizarFila(i, 'cantidad', (e.target as HTMLInputElement).value)}
								class="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs text-right focus:outline-none focus:ring-2 focus:ring-blue-200"
							/>
							<input
								type="number"
								step="any"
								value={fila.precio_unitario}
								oninput={(e) => actualizarFila(i, 'precio_unitario', (e.target as HTMLInputElement).value)}
								class="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs text-right focus:outline-none focus:ring-2 focus:ring-blue-200"
							/>
							<span class="text-right text-xs font-semibold text-slate-700 pr-1">{formatCurrency(fila.cantidad * fila.precio_unitario)}</span>
							<button type="button" onclick={() => quitarFila(i)} class="p-1 rounded text-slate-400 hover:text-red-600 hover:bg-red-50" aria-label="Quitar partida">
								<Trash2 size={14} />
							</button>
						</div>
					{:else}
						<p class="px-3 py-6 text-center text-xs text-slate-400">
							{cargandoPartidas ? 'Cargando partidas del proyecto...' : idProyecto ? 'Sin partidas — usa "Añadir Partida" para una línea libre.' : 'Elige un proyecto para ver sus partidas.'}
						</p>
					{/each}
				</div>

				<div class="flex flex-col lg:flex-row gap-4">
					<div class="flex-1 min-w-0">
						<!-- El resto de campos (Amortización/Retención/Comentarios) ya se rindieron arriba junto
						     con la cabecera — este bloque solo deja espacio para futuras notas si hiciera falta. -->
					</div>
					<div class="w-full lg:w-72 shrink-0 rounded-xl border border-slate-200 bg-slate-50 p-4">
						<h3 class="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-3">Resumen</h3>
						<div class="flex flex-col gap-1.5 text-sm">
							<div class="flex justify-between"><span class="text-slate-500">Subtotal</span><span class="font-medium text-slate-700">{formatCurrency(totales.subtotal)}</span></div>
							{#if totales.montoAmortizacion > 0}
								<div class="flex justify-between"><span class="text-slate-500">(-) Amortización</span><span class="font-medium text-red-600">-{formatCurrency(totales.montoAmortizacion)}</span></div>
							{/if}
							{#if totales.montoRetencionGarantia > 0}
								<div class="flex justify-between"><span class="text-slate-500">(-) Retención</span><span class="font-medium text-red-600">-{formatCurrency(totales.montoRetencionGarantia)}</span></div>
							{/if}
							<div class="flex justify-between"><span class="text-slate-500">(+) IGV (18%)</span><span class="font-medium text-slate-700">+{formatCurrency(totales.montoIgv)}</span></div>
							<div class="flex justify-between pt-2 mt-1 border-t border-slate-200 text-base"><span class="font-semibold text-[#0f3b5e]">Total a Pagar</span><span class="font-bold text-[#0f3b5e]">{formatCurrency(totales.montoTotal)}</span></div>
						</div>
					</div>
				</div>
			</div>

			{#if !soloLectura}
				<div class="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-200 flex-shrink-0">
					<button type="button" onclick={onClose} class="px-4 py-2 text-sm border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50">Cancelar</button>
					<button
						type="button"
						onclick={handleGuardarBorrador}
						disabled={!puedeGuardar || guardando !== null}
						class="px-4 py-2 text-sm bg-slate-700 text-white rounded-lg hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
					>
						{#if guardando === 'borrador'}<Loader2 size={14} class="animate-spin" />{/if} Guardar Borrador
					</button>
					<button
						type="button"
						onclick={handleEmitir}
						disabled={!puedeGuardar || guardando !== null}
						class="px-4 py-2 text-sm bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
					>
						{#if guardando === 'emitir'}<Loader2 size={14} class="animate-spin" />{/if} Emitir Factura
					</button>
				</div>
			{:else}
				<div class="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-200 flex-shrink-0">
					<button type="button" onclick={onClose} class="px-4 py-2 text-sm border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50">Cerrar</button>
				</div>
			{/if}
		</div>
	</div>
{/if}
