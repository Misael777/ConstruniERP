<script lang="ts">
	import { supabase } from '$lib/supabaseClient';
	import { X, Loader2, ListOrdered } from '@lucide/svelte';
	import { toast } from '$lib/stores/toast';
	import { validatePayload, applyFieldMask, formatCurrency, type FieldOption } from '$lib/shared/fieldConfig';
	import { FIELDS_CONFIG } from '$lib/modules/cuentas-cobrar/config/cuentaCobrar.config';
	import { cuotasEditables } from '$lib/modules/cuentas-cobrar/services/detraccion.service';
	import { createCuentaCobrar, updateCuentaCobrar, getCobros, computeEstadoCuentaCobrar } from '$lib/modules/cuentas-cobrar/services/cuentasCobrar.service';
	import type { CuentaCobrar, ServiceResult } from '$lib/modules/cuentas-cobrar/services/cuentasCobrar.service';
	import { isAdmin, permisosState } from '$lib/stores/permisos.svelte';
	import FraccionamientoModal, { type Fraccion } from '$lib/shared/components/FraccionamientoModal.svelte';
	import SelectConSaldo from '$lib/shared/components/SelectConSaldo.svelte';

	let {
		open = false,
		mode = 'create',
		cuenta = null,
		dynamicOptions = {},
		centroCostoMontoMap = {},
		centroCostoProyectoMap = {},
		centroCostoClienteMap = {},
		clienteBloqueado = false,
		centroCostoOpcionesPrestamo = [],
		prestamoDestinoNombre = '',
		prestatarioNombre = null,
		camposBloqueados = [],
		onSubmitOverride = null,
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
		/** true = "Cliente" queda bloqueado (no editable) — a pedido explícito del usuario, para la
		 * Cuenta por Cobrar que se autogenera al registrar un Egreso "Préstamo Otorgado" con Centro de
		 * Costo Origen=Corporativo (ver finanzas/cuentas-cobrar/+page.svelte): ese caso siempre usa el
		 * cliente genérico fijo "PRÉSTAMOS / FINANCIERA" (ver getOrCrearClientePrestamos), ya viene
		 * elegido en `cuenta` y no debe poder cambiarse. false en cualquier otro flujo (crear/editar
		 * normal) — mismo patrón que proveedorBloqueado en CuentaPagarModal.svelte. */
		clienteBloqueado?: boolean;
		/** Opciones de "Centro de Costo" para el mismo flujo de arriba (Préstamo Otorgado) — a pedido
		 * explícito del usuario: acá NO se ofrecen las ventas cerradas normales (dynamicOptions.
		 * id_centro_costo), sino nuestros propios Obra/Consultoría/Corporativo (calculados en
		 * finanzas/cuentas-cobrar/+page.svelte a partir de listas ya cargadas, sin consulta nueva) —
		 * ver optionsFor. Vacío en cualquier otro flujo (crear/editar normal). */
		centroCostoOpcionesPrestamo?: FieldOption[];
		/** Nombre del Centro de Costo Destino real (el prestatario) de la transacción que originó este
		 * flujo — a pedido explícito del usuario, se muestra como texto informativo junto al campo
		 * "Proyecto" (que no puede guardar ese valor, ver nota en el template): '' en cualquier otro
		 * flujo. */
		prestamoDestinoNombre?: string;
		/** Flujo "Préstamo Otorgado" (crear o editar desde la transacción, ver cuentas-cobrar/+page.svelte):
		 * nombre del prestatario (a quién se le prestó). "Cliente" se rotula "Prestatario" y muestra este
		 * nombre — en la BD sigue guardándose el cliente genérico de préstamos (id_cliente es FK a la tabla
		 * cliente); el nombre queda además en Observaciones. Mismo patrón que prestamistaNombre en
		 * CuentaPagarModal.svelte. null = flujo normal. */
		prestatarioNombre?: string | null;
		/** Campos que vienen de la transacción y no se pueden editar acá (ej. monto, centro de costo). */
		camposBloqueados?: string[];
		/** Cuando se pasa, REEMPLAZA el alta normal (createCuentaCobrar) en handleSubmit — a pedido
		 * explícito del usuario, para el flujo "Préstamo Otorgado": la transacción que originó esta
		 * cuenta debe grabarse PRIMERO, y la Cuenta por Cobrar recién después; si la transacción falla,
		 * la cuenta tampoco debe grabarse. finanzas/cuentas-cobrar/+page.svelte arma acá esa secuencia
		 * (crea la transacción, y solo si sale bien crea la cuenta — revirtiendo la transacción si la
		 * cuenta terminara fallando) y devuelve el mismo ServiceResult<CuentaCobrar> que createCuentaCobrar,
		 * para que el resto de handleSubmit (toast, onSaved, onClose) no tenga que saber nada de esto.
		 * null en cualquier otro flujo (crear/editar normal, mode='edit' nunca lo usa). */
		onSubmitOverride?: ((formValues: Record<string, string>, fracciones: Fraccion[]) => Promise<ServiceResult<CuentaCobrar>>) | null;
		onClose: () => void;
		// Recibe la fila (o filas, si es una serie) recién creada/actualizada — a pedido explícito del
		// usuario, finanzas/cuentas-cobrar/+page.svelte lo usa para grabar recién ahí la transacción del
		// flujo "Préstamo Otorgado" (ver crearTransaccionPorPrestamoOtorgado), mismo criterio que
		// CuentaPagarModal.svelte.
		onSaved: (cuenta?: CuentaCobrar | CuentaCobrar[]) => void | Promise<void>;
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
		// edición se respeta lo que ya tenía guardado esa cuenta. OJO: se checa
		// `(cuenta as any)?.moneda == null` (no solo `!cuenta`) — finanzas/cuentas-cobrar/+page.svelte
		// puede abrir en modo 'create' con `cuenta` YA con algunos campos precargados (ver
		// abrirCreacionPrecargadaDesdeTransaccion, para la Cuenta por Cobrar que se autogenera desde un
		// Egreso "Préstamo Otorgado"); en ese caso `cuenta` no es null pero tampoco trae moneda/
		// responsable, así que estos defaults deben seguir aplicando igual (mismo criterio que
		// CuentaPagarModal.svelte).
		if ((cuenta as any)?.moneda == null && !values.moneda) values.moneda = 'PEN';
		// A pedido del usuario: "Responsable" arranca prellenado con el usuario que inició sesión (mismo
		// patrón que CuentaPagarModal.svelte) — solo al crear, no pisa el valor guardado al editar. Sigue
		// siendo editable por si corresponde asignarla a alguien más.
		if ((cuenta as any)?.responsable == null && 'responsable' in values) values.responsable = permisosState.userName;
		return values;
	}

	let formValues = $state<Record<string, string>>(buildInitialValues());
	let fieldErrors = $state<Record<string, string>>({});
	let submitting = $state(false);
	let fracciones = $state<Fraccion[]>([]);
	let fraccionamientoOpen = $state(false);
	let detraccionReservada = $state(0);

	$effect(() => {
		if (!open) return;
		formValues = buildInitialValues();
		fieldErrors = {};
		fracciones = [];
		detraccionReservada = 0;
		if (mode === 'edit' && cuenta) {
			(async () => {
				const cobros = await getCobros(supabase, cuenta.id_cuenta_cobrar);
				// Detracción: cada cuota con su monto bruto (cuota + su detracción); lo reservado son detracciones de
				// cuotas ya cobradas, que no se reprograman aquí (ver detraccion.service.ts).
				const editables = cuotasEditables(cobros);
				fracciones = editables.fracciones;
				detraccionReservada = editables.reservado;
			})();
		}
	});

	// H6 (ver Documentacion/tests/README.md, decisión del cliente): "Saldo Pendiente" = Valor de venta - lo ya
	// cobrado a través de los cobros de ESTA cuenta (igual que Cuentas por Pagar con sus pagos). Antes se
	// restaban todos los ingresos hacia el centro de costo, lo que hacía que un adelanto "pagara" a la vez
	// todas las cuentas del mismo proyecto. Una cuenta nueva no tiene cobros: 0.
	const montoCobradoPropio = $derived(mode === 'edit' ? Number(cuenta?.monto_cobrado ?? 0) : 0);
	const saldoPendienteReal = $derived(Math.max(Number(formValues.monto || 0) - montoCobradoPropio, 0));

	// "Estado" ya no es un select editable a mano (showInForm:false en cuentaCobrar.config.ts, se
	// recalcula solo en el servicio) — a pedido del usuario, igual se muestra acá como vista previa en
	// un textbox de solo lectura, con la misma fórmula que usará el servicio al guardar.
	const estadoActual = $derived(computeEstadoCuentaCobrar(saldoPendienteReal, formValues.fecha_vencimiento || null, fracciones[0]?.fecha ?? null));
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
		if (field.key === 'id_cliente' && clienteBloqueado) return true;
		if (camposBloqueados.includes(field.key)) return true;
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

	/** true si esta cuenta es (o está por convertirse en) una de "Préstamo Otorgado" — a diferencia de
	 * usar solo `clienteBloqueado` (que únicamente es true mientras se está CREANDO desde ese flujo,
	 * ver finanzas/cuentas-cobrar/+page.svelte), esto también cubre EDITAR una cuenta de préstamo ya
	 * existente (abrirEdicionPrecargadaDesdeTransaccion abre con clienteBloqueado=false a propósito,
	 * porque ahí el Cliente SÍ se puede volver a tocar) — `cuenta?.id_transaccion` (real desde
	 * cuentas_pagar_cobrar_id_transaccion_migration.sql) es la señal confiable de "esto es un préstamo"
	 * sin importar por qué puerta se llegó a editarlo. Usado solo para ETIQUETAS/textos (ver
	 * saldoPendienteReal más arriba para el mismo criterio aplicado al cálculo de saldo). */
	const esPrestamo = $derived(clienteBloqueado || cuenta?.id_transaccion != null);

	/** Etiqueta del campo — normalmente `field.label` tal cual, salvo en un préstamo (ver esPrestamo):
	 * a pedido explícito del usuario, "Centro de Costo" pasa a llamarse "Prestamista" (quién presta,
	 * nuestro propio fondo), "Proyecto" a "Prestatario" (a quién se le presta) y "Valor de venta" a
	 * "Valor de Préstamo" — mismo criterio que labelFor en TransaccionModal.svelte. */
	function labelFor(field: (typeof formFields)[number]): string {
		// Con el nombre del prestatario en "Cliente" (prestatarioNombre), "Proyecto" vuelve a ser Proyecto.
		if (prestatarioNombre !== null && field.key === 'id_cliente') return 'Prestatario';
		if (esPrestamo) {
			if (field.key === 'id_centro_costo') return 'Prestamista';
			if (field.key === 'id_proyecto') return prestatarioNombre !== null ? field.label : 'Prestatario';
			if (field.key === 'monto') return 'Valor de Préstamo';
		}
		return field.label;
	}

	function optionsFor(field: (typeof formFields)[number]): FieldOption[] {
		const base = (field.optionsSource && dynamicOptions[field.key]) || field.options || [];
		// Ticket #93: se podía poner prioridad pero no quitarla — "Sin prioridad" la deja vacía (se guarda NULL).
		if (field.key === 'prioridad') return [{ value: '', label: 'Sin prioridad' }, ...base];
		// Préstamo Otorgado: la única opción de "Cliente" es el cliente ya elegido, mostrado con el nombre del prestatario.
		if (field.key === 'id_cliente' && prestatarioNombre !== null) return [{ value: formValues.id_cliente, label: prestatarioNombre || 'Prestatario' }];
		// Flujo "Préstamo Otorgado" (clienteBloqueado, ver finanzas/cuentas-cobrar/+page.svelte): "Centro
		// de Costo" es NUESTRO centro que financia el préstamo (Obra/Consultoría/Corporativo), no una
		// venta cerrada — va ANTES del filtro por Cliente de abajo, porque ese cliente es el genérico
		// "PRÉSTAMOS / FINANCIERA" y no sirve para filtrar centros de costo en este caso.
		if (field.key === 'id_centro_costo' && clienteBloqueado) return centroCostoOpcionesPrestamo;
		// Si ya hay un Cliente elegido, "Centro de Costo" solo ofrece los suyos — a pedido explícito del
		// usuario ("si elijo un cliente, el campo centro de costo debe mostrarme todos los centros de
		// costos activos que tengan ese cliente"). Sin Cliente elegido se muestran todos (sin filtrar).
		if (field.key === 'id_centro_costo' && formValues.id_cliente) {
			return base.filter((opt) => centroCostoClienteMap[opt.value] === formValues.id_cliente);
		}
		// A pedido explícito del usuario: "Responsable" se veía vacío (el <select> nativo no muestra
		// ningún texto cuando su value no calza con NINGUNA <option> de la lista) — pasaba en la cuenta
		// que autogenera el flujo de préstamo, donde el valor precargado puede llegar antes de que
		// dynamicOptions.responsable termine de cargar, o ya no calzar exactamente con el catálogo de
		// empleados actual. Mismo criterio de seguridad que ya usa este archivo para Centro de Costo/
		// Moneda: si el valor ya elegido no aparece en la lista, se agrega igual (con su propio nombre
		// como label) para que el campo nunca se vea en blanco.
		if (field.key === 'responsable' && formValues.responsable && !base.some((o) => o.value === formValues.responsable)) {
			return [...base, { value: formValues.responsable, label: formValues.responsable }];
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
			if (onSubmitOverride) {
				result = await onSubmitOverride(formValues, fraccionesAEnviar);
			} else if (mode === 'edit' && cuenta) {
				result = await updateCuentaCobrar(supabase, cuenta.id_cuenta_cobrar, formValues, isAdmin(), fraccionesAEnviar);
			} else {
				const { data: userData } = await supabase.auth.getUser();
				result = await createCuentaCobrar(supabase, formValues, userData?.user?.email ?? null, fraccionesAEnviar);
			}

			if (result.success) {
				toast.success(result.message ?? 'Operación realizada con éxito');
				await onSaved(result.data);
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
								{labelFor(field)}
								{#if field.required}<span class="text-red-500">*</span>{/if}
							</label>

							{#if field.key === 'id_proyecto' && clienteBloqueado}
								<!-- A pedido explícito del usuario: el campo "Prestatario" en sí debe MOSTRAR el
								     nombre real del prestatario, no solo un texto de ayuda al costado — pero
								     "Proyecto" (id_proyecto) es una FK real a la tabla `proyecto`, no a
								     `centro_costo`, así que no puede GUARDAR ese valor (ver nota más abajo). Se
								     reemplaza el <select> normal por un input de solo texto, deshabilitado, que
								     muestra el nombre — nunca se envía como id_proyecto (formValues.id_proyecto
								     se queda vacío/null, ver buildInitialValues/handleSubmit, sin tocar). -->
								<input
									id={`ccb-${field.key}`}
									type="text"
									value={prestatarioNombre !== null ? '' : prestamoDestinoNombre}
									placeholder={prestatarioNombre !== null ? 'No aplica a un préstamo' : undefined}
									disabled
									class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-slate-100 text-slate-600 disabled:cursor-not-allowed"
								/>
							{:else if field.optionsSource}
								<!-- Ticket #29: cualquier campo con lista cargada en runtime (cliente/centro de
								     costo/proyecto/responsable — listas que crecen con el tiempo) usa el mismo
								     combo con buscador que ya se agregó a Proveedor en Cuentas por Pagar
								     (ticket #19), en vez del <select> nativo. -->
								<SelectConSaldo
									id={`ccb-${field.key}`}
									value={formValues[field.key] ?? ''}
									options={optionsFor(field).map((opt) => ({ value: opt.value, label: opt.label }))}
									disabled={isDisabled(field)}
									hasError={!!fieldErrors[field.key]}
									onchange={(value) => handleInput(field.key, value)}
								/>
							{:else if field.tipo === 'select' || field.options}
								<div class="relative">
									<!-- Ticket #59: el punto de color (Prioridad) lo dibuja el propio combo; antes iba superpuesto en
									     posición absoluta y quedaba encima de la primera letra. -->
									<SelectConSaldo
										id={`ccb-${field.key}`}
										value={formValues[field.key]}
										options={optionsFor(field).map((o) => ({ ...o, color: field.optionColors?.[String(o.value)] }))}
										placeholder="Selecciona una opción"
										disabled={isDisabled(field)}
										onchange={(v) => handleInput(field.key, v)}
									/>
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
							{:else if field.key === 'id_proyecto' && clienteBloqueado && prestamoDestinoNombre && prestatarioNombre === null}
								<!-- El input de arriba ya MUESTRA el nombre (a pedido explícito del usuario) — acá
								     solo se aclara que ese valor no viaja como id_proyecto (sigue siendo una FK
								     real a la tabla `proyecto`, no a `centro_costo`), sino en Observaciones. -->
								<p class="mt-1 text-xs text-slate-400">También queda guardado en Observaciones.</p>
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
						<h3 class="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-3">{esPrestamo ? 'Resumen de préstamo' : 'Resumen de venta'}</h3>
						<div class="flex flex-col gap-3">
							<div>
								<span class="block text-xs text-slate-500 mb-1">{esPrestamo ? 'Valor de Préstamo' : 'Valor de venta'}</span>
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
	titulo="Cronograma de Cobranza"
	etiquetaInterruptor="Fraccionar Cobros"
	montoTotal={Math.max(Math.round((saldoPendienteReal - detraccionReservada) * 100) / 100, 0)}
	fechaEmision={formValues.fecha_emision}
	fechaVencimiento={formValues.fecha_vencimiento || null}
	fraccionesIniciales={fracciones}
	metodoSugerido={formValues.forma_pago === '3' ? 'por_porcentaje' : undefined}
	conHitoDeCobro
	conComentarios
	onClose={() => (fraccionamientoOpen = false)}
	onConfirm={onFraccionesConfirmadas}
	onEliminar={onFraccionamientoEliminado}
/>
