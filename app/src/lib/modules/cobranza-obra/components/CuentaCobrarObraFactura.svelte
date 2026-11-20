<script lang="ts">
	/**
	 * Cuenta por cobrar de una venta de OBRA en formato factura (a pedido del usuario, 18/11/2026; maqueta aprobada
	 * "cxc-factura"). Un cliente y una obra arriba (una sola vez) y, como líneas, las cuentas por cobrar de esa obra:
	 * adelantos (solo lectura: se registran desde Ventas) y valorizaciones con sus pagos.
	 *
	 * Flujo de datos (no cambia): es la misma cuenta de la venta (cuentas_cobrar) con sus grupos (cobro_grupo) y cuotas
	 * (cobros); todo se escribe con cobranzaObra.service.ts, que conserva sus validaciones (no superar la valorización
	 * ni el valor de venta, detracción como cuota aparte, recálculo de la cuenta). Cliente, centro de costo y proyecto
	 * vienen de la venta y no se editan aquí: cambiarlos desconectaría la cuenta de sus transacciones. Moneda (Soles por
	 * defecto / Dólares) y tipo de cambio sí se editan (18/11/2026); los montos siguen en soles.
	 *
	 * Los cambios se acumulan y se guardan juntos con "Guardar cambios". Modo "embebido" = dentro de una página (ficha
	 * del proyecto), sin ventana; con soloLectura no muestra controles de edición.
	 */
	import { supabase } from '$lib/supabaseClient';
	import { formatCurrency } from '$lib/shared/fieldConfig';
	import { toast } from '$lib/stores/toast';
	import { hasPermiso } from '$lib/stores/permisos.svelte';
	import { verificarConexion } from '$lib/stores/conexion.svelte';
	import { getFechaLocalHoy } from '$lib/shared/dateUtils';
	import SelectConSaldo from '$lib/shared/components/SelectConSaldo.svelte';
	import ConfirmModal from '$lib/shared/components/ConfirmModal.svelte';
	import DocumentPreviewModal from '$lib/shared/components/DocumentPreviewModal.svelte';
	import { getEmpleadoOptions } from '$lib/modules/transacciones/services/transacciones.service';
	import {
		getResumenCobroObra,
		getCabeceraCuentaObra,
		actualizarCabeceraCuentaObra,
		crearValorizacion,
		actualizarValorizacion,
		eliminarValorizacion,
		eliminarAdelantoVacio,
		agregarPago,
		editarPago,
		eliminarPago,
		montoBruto,
		type ResumenCobroObra,
		type CabeceraCuentaObra,
		type GrupoObra,
		type PagoObra
	} from '$lib/modules/cobranza-obra/services/cobranzaObra.service';

	let {
		idCuentaCobrar,
		modo = 'modal',
		open = true,
		soloLectura = false,
		/** Sube cuando la página registra un cobro, para volver a leer. */
		recargar = 0,
		onClose = () => {},
		onSaved = () => {},
		/** Tocar "Pendiente" de un pago: la página abre la transacción del cobro. Sin esto, el estado es solo texto. */
		onCobrarPago,
		/** Solo en modo embebido: botón "Editar" (abre la versión editable). */
		onEditar
	}: {
		idCuentaCobrar: number | null;
		modo?: 'modal' | 'embebido';
		open?: boolean;
		soloLectura?: boolean;
		recargar?: number;
		onClose?: () => void;
		onSaved?: () => void;
		onCobrarPago?: (idCobro: number) => void;
		onEditar?: () => void;
	} = $props();

	let cab = $state<CabeceraCuentaObra | null>(null);
	let r = $state<ResumenCobroObra | null>(null);
	let cargando = $state(false);
	let error = $state('');
	let guardando = $state(false);
	let responsables = $state<{ value: string; label: string }[]>([]);

	// Clases de los campos (mismo formato del Resumen de cobro: azul #0f3b5e, bordes slate).
	const inp = 'w-full h-9 px-3 border border-slate-200 rounded-lg text-sm text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-[#0f3b5e]/20';
	const ro = 'w-full min-h-9 px-3 py-2 border border-slate-200 rounded-lg text-sm text-slate-600 bg-slate-50 truncate';
	const celda = 'w-full h-8 px-2 border border-slate-200 rounded-md text-xs bg-white focus:outline-none focus:ring-2 focus:ring-[#0f3b5e]/20';

	const puedeCabecera = $derived(!soloLectura);
	const puedeLineas = $derived(!soloLectura && hasPermiso('gestionar_valorizaciones'));

	// ---- Borrador (lo que el usuario cambió y aún no guardó) ----
	type Linea = { partida: string; fecha: string; observacion: string; monto: number | null };
	type Nuevo = Linea & { key: number };
	let formCab = $state({ responsable: '', fecha_emision: '', prioridad: '', observaciones: '', moneda: 'PEN' as 'PEN' | 'USD', tipo_cambio: null as number | null });
	const MONEDAS = [
		{ value: 'PEN', label: 'Soles (PEN)' },
		{ value: 'USD', label: 'Dólares (USD)' }
	];
	let pagos = $state<Record<number, Linea>>({});
	let montosVal = $state<Record<number, number | null>>({});
	let borrarPagos = $state<Set<number>>(new Set());
	let borrarVals = $state<Set<number>>(new Set());
	let nuevosPagos = $state<Record<number, Nuevo[]>>({});
	let nuevasVals = $state<{ key: number; monto: number | null; observaciones: string; pagos: Nuevo[] }[]>([]);
	let secuencia = 0;

	const PRIORIDADES = [
		{ value: '', label: 'Sin prioridad' },
		{ value: 'alto', label: 'Alto', color: '#dc2626' },
		{ value: 'medio', label: 'Medio', color: '#d97706' },
		{ value: 'bajo', label: 'Bajo', color: '#16a34a' }
	];

	function reiniciarBorrador() {
		if (!cab || !r) return;
		formCab = {
			responsable: cab.responsable ?? '',
			fecha_emision: cab.fecha_emision ?? '',
			prioridad: cab.prioridad ?? '',
			observaciones: cab.observaciones ?? '',
			moneda: cab.moneda === 'USD' ? 'USD' : 'PEN',
			tipo_cambio: cab.tipo_cambio
		};
		const p: Record<number, Linea> = {};
		const v: Record<number, number | null> = {};
		for (const g of r.valorizaciones) {
			v[g.id_grupo] = g.total;
			for (const x of g.pagos) if (x.estado !== 'cobrado') p[x.id_cobro] = { partida: x.partida ?? '', fecha: x.fecha, observacion: x.observacion ?? '', monto: montoBruto(x) };
		}
		pagos = p;
		montosVal = v;
		borrarPagos = new Set();
		borrarVals = new Set();
		nuevosPagos = {};
		nuevasVals = [];
	}

	async function cargar() {
		if (!idCuentaCobrar) return;
		cargando = true;
		error = '';
		try {
			const [c, res] = await Promise.all([getCabeceraCuentaObra(supabase, idCuentaCobrar), getResumenCobroObra(supabase, idCuentaCobrar)]);
			cab = c;
			r = res;
			reiniciarBorrador();
		} catch (err: any) {
			error = err?.message ?? String(err);
		} finally {
			cargando = false;
		}
	}
	$effect(() => {
		void recargar;
		if (open && idCuentaCobrar) cargar();
	});

	// Adelanto sin armadas (p. ej. quedó vacío por un registro fallido, 20/11/2026): se elimina al confirmar, sin tocar
	// el borrador de valorizaciones (solo se vuelve a leer el resumen). Los adelantos siguientes se renumeran.
	let adelantoAEliminar = $state<GrupoObra | null>(null);
	async function confirmarEliminarAdelanto() {
		const g = adelantoAEliminar;
		if (!g || !idCuentaCobrar) return;
		const res = await eliminarAdelantoVacio(supabase, g.id_grupo);
		if (!res.success) {
			toast.error(res.message);
			return;
		}
		adelantoAEliminar = null;
		if (res.aviso) toast.info(res.aviso);
		else toast.success(`Adelanto ${g.numero} eliminado.`);
		try {
			r = await getResumenCobroObra(supabase, idCuentaCobrar);
		} catch {
			/* se verá al reabrir */
		}
		onSaved();
	}
	$effect(() => {
		if (open && puedeCabecera && !responsables.length) getEmpleadoOptions(supabase).then((o) => (responsables = o)).catch(() => {});
	});

	// ---- Derivados ----
	const r2 = (n: number) => Math.round(n * 100) / 100;
	const fmtFecha = (f: string | null) => (f ? f.split('-').reverse().join('/') : '—');
	const pct = (parte: number) => (r && r.valorVenta > 0 ? `${((parte / r.valorVenta) * 100).toFixed(2)} %` : '—');
	const ultimaFecha = (g: GrupoObra) => g.pagos.map((p) => p.fecha).sort().at(-1) ?? null;
	const editable = (p: PagoObra) => puedeLineas && p.estado !== 'cobrado';

	const cambioCabecera = $derived(
		!!cab &&
			(formCab.responsable !== (cab.responsable ?? '') ||
				formCab.fecha_emision !== (cab.fecha_emision ?? '') ||
				formCab.prioridad !== (cab.prioridad ?? '') ||
				formCab.observaciones !== (cab.observaciones ?? '') ||
				formCab.moneda !== (cab.moneda === 'USD' ? 'USD' : 'PEN') ||
				(formCab.moneda === 'USD' && Number(formCab.tipo_cambio ?? 0) !== Number(cab.tipo_cambio ?? 0)))
	);
	function pagoCambiado(p: PagoObra): boolean {
		const f = pagos[p.id_cobro];
		return !!f && (f.partida !== (p.partida ?? '') || f.fecha !== p.fecha || f.observacion !== (p.observacion ?? '') || Number(f.monto) !== montoBruto(p));
	}
	const pagosCambiados = $derived(r ? r.valorizaciones.flatMap((g) => g.pagos.filter((p) => !borrarPagos.has(p.id_cobro) && !borrarVals.has(g.id_grupo) && pagoCambiado(p))) : []);
	const valsCambiadas = $derived(r ? r.valorizaciones.filter((g) => !borrarVals.has(g.id_grupo) && Number(montosVal[g.id_grupo]) !== g.total) : []);
	const hayCambios = $derived(
		cambioCabecera || pagosCambiados.length > 0 || valsCambiadas.length > 0 || borrarPagos.size > 0 || borrarVals.size > 0 || Object.values(nuevosPagos).some((l) => l.length) || nuevasVals.length > 0
	);

	/** Totales en vivo, con lo que se está editando. */
	const totales = $derived.by(() => {
		if (!r) return null;
		const vals = r.valorizaciones.filter((g) => !borrarVals.has(g.id_grupo));
		const totalVal = r2(vals.reduce((s, g) => s + Number(montosVal[g.id_grupo] ?? g.total), 0) + nuevasVals.reduce((s, v) => s + Number(v.monto ?? 0), 0));
		const montoPago = (p: PagoObra) => (pagos[p.id_cobro] ? Number(pagos[p.id_cobro].monto ?? 0) : montoBruto(p));
		const programadoVal =
			vals.reduce((s, g) => s + g.pagos.filter((p) => !borrarPagos.has(p.id_cobro)).reduce((t, p) => t + montoPago(p), 0) + (nuevosPagos[g.id_grupo] ?? []).reduce((t, n) => t + Number(n.monto ?? 0), 0), 0) +
			nuevasVals.reduce((s, v) => s + v.pagos.reduce((t, n) => t + Number(n.monto ?? 0), 0), 0);
		// En obras no hay "otras cuotas" (a pedido del usuario): lo programado son adelantos + pagos de valorizaciones.
		const programado = r2(r.totalAdelantos + programadoVal);
		return { totalVal, programado, faltaProgramar: r2(r.valorVenta - r.totalAdelantos - totalVal) };
	});

	const ESTADO_CUENTA: Record<string, { texto: string; clase: string }> = {
		pendiente: { texto: 'Pendiente', clase: 'bg-amber-50 text-amber-700 border-amber-300' },
		pagado: { texto: 'Cobrado', clase: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
		vencido: { texto: 'Vencido', clase: 'bg-rose-50 text-rose-700 border-rose-300' }
	};
	const CLASE_PAGO: Record<PagoObra['estado'], string> = {
		cobrado: 'bg-emerald-50 text-emerald-700 border-emerald-200',
		pendiente: 'bg-amber-50 text-amber-700 border-amber-300',
		vencido: 'bg-rose-50 text-rose-700 border-rose-300'
	};
	const TEXTO_PAGO: Record<PagoObra['estado'], string> = { cobrado: 'Cobrado', pendiente: 'Pendiente', vencido: 'Vencido' };
	const ESTADO_GRUPO: Record<GrupoObra['estado'], { texto: string; clase: string }> = {
		completada: { texto: 'Cobrado', clase: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
		en_proceso: { texto: 'En proceso', clase: 'bg-blue-50 text-blue-700 border-blue-200' },
		pendiente: { texto: 'Pendiente', clase: 'bg-amber-50 text-amber-700 border-amber-300' }
	};

	// ---- Acciones del borrador ----
	function nuevaLinea(sugerido: number): Nuevo {
		return { key: ++secuencia, partida: '', fecha: getFechaLocalHoy(), observacion: '', monto: sugerido > 0 ? r2(sugerido) : null };
	}
	function agregarPagoA(g: GrupoObra) {
		const usado = g.pagos.filter((p) => !borrarPagos.has(p.id_cobro)).reduce((s, p) => s + Number(pagos[p.id_cobro]?.monto ?? montoBruto(p)), 0) + (nuevosPagos[g.id_grupo] ?? []).reduce((s, n) => s + Number(n.monto ?? 0), 0);
		nuevosPagos[g.id_grupo] = [...(nuevosPagos[g.id_grupo] ?? []), nuevaLinea(Number(montosVal[g.id_grupo] ?? g.total) - usado)];
	}
	function agregarValorizacion() {
		const falta = totales?.faltaProgramar ?? 0;
		const monto = falta > 0 ? r2(falta) : null;
		nuevasVals = [...nuevasVals, { key: ++secuencia, monto, observaciones: '', pagos: [nuevaLinea(monto ?? 0)] }];
	}
	function alternar(set: Set<number>, id: number): Set<number> {
		const s = new Set(set);
		if (s.has(id)) s.delete(id);
		else s.add(id);
		return s;
	}

	// ---- Guardar ----
	function validar(): string | null {
		const lineas: Linea[] = [
			...pagosCambiados.map((p) => pagos[p.id_cobro]),
			...Object.values(nuevosPagos).flat(),
			...nuevasVals.flatMap((v) => v.pagos)
		];
		if (lineas.some((l) => !(Number(l.monto) > 0))) return 'Cada pago debe tener un monto mayor a 0.';
		if (lineas.some((l) => !l.fecha)) return 'Cada pago debe tener su fecha estimada.';
		if (valsCambiadas.some((g) => !(Number(montosVal[g.id_grupo]) > 0)) || nuevasVals.some((v) => !(Number(v.monto) > 0))) return 'Cada valorización debe tener un monto mayor a 0.';
		if (cambioCabecera && !formCab.fecha_emision) return 'Indica la fecha de emisión.';
		if (cambioCabecera && formCab.moneda === 'USD' && !(Number(formCab.tipo_cambio) > 0)) return 'Con moneda Dólares, indica el tipo de cambio (mayor a 0).';
		return null;
	}

	async function guardar() {
		if (!cab || !r || guardando || !hayCambios) return;
		const problema = validar();
		if (problema) {
			toast.error(problema);
			return;
		}
		if (!(await verificarConexion(supabase))) {
			toast.error('Sin conexión a internet: no se guardó nada. Vuelve a intentarlo cuando regrese la conexión.');
			return;
		}
		guardando = true;
		const hechos: string[] = [];
		// Orden pensado para las validaciones del servicio (una valorización no puede quedar por debajo de sus pagos
		// ni lo programado por encima del valor de venta): primero lo que libera monto, después lo que lo ocupa.
		const paso = async (que: string, fn: () => Promise<{ success: boolean; message?: string }>) => {
			const res = await fn();
			if (!res.success) throw new Error(`${que}: ${res.message ?? 'no se pudo guardar'}`);
			hechos.push(que);
		};
		const datos = (l: Linea) => ({ monto: Number(l.monto), fecha: l.fecha, partida: l.partida, observacion: l.observacion });
		try {
			if (cambioCabecera) await paso('Datos de la cuenta', () => actualizarCabeceraCuentaObra(supabase, cab!.id_cuenta_cobrar, { ...formCab, prioridad: formCab.prioridad || null }));
			for (const id of borrarPagos) await paso('Pago eliminado', () => eliminarPago(supabase, id));
			for (const id of borrarVals) await paso('Valorización eliminada', () => eliminarValorizacion(supabase, id));
			const bajan = pagosCambiados.filter((p) => Number(pagos[p.id_cobro].monto) <= montoBruto(p));
			const suben = pagosCambiados.filter((p) => Number(pagos[p.id_cobro].monto) > montoBruto(p));
			for (const p of bajan) await paso(`Pago ${p.numero}`, () => editarPago(supabase, p.id_cobro, datos(pagos[p.id_cobro])));
			for (const g of valsCambiadas) await paso(`Valorización ${g.numero}`, () => actualizarValorizacion(supabase, g.id_grupo, Number(montosVal[g.id_grupo]), g.observaciones));
			for (const p of suben) await paso(`Pago ${p.numero}`, () => editarPago(supabase, p.id_cobro, datos(pagos[p.id_cobro])));
			for (const [idGrupo, lista] of Object.entries(nuevosPagos)) for (const n of lista) await paso('Pago nuevo', () => agregarPago(supabase, Number(idGrupo), datos(n), null));
			for (const v of nuevasVals) {
				const creada = await crearValorizacion(supabase, cab.id_cuenta_cobrar, Number(v.monto), v.observaciones, null);
				if (!creada.success) throw new Error(`Valorización nueva: ${creada.message}`);
				hechos.push(`Valorización ${creada.numero}`);
				for (const n of v.pagos) await paso(`Pago de la Valorización ${creada.numero}`, () => agregarPago(supabase, creada.id_grupo, datos(n), null));
			}
			toast.success('Cuenta por cobrar actualizada.');
			onSaved();
		} catch (err: any) {
			const parcial = hechos.length ? ` Ya se guardó: ${hechos.join(', ')}. Revisa y vuelve a guardar lo que falta.` : '';
			toast.error(`${err?.message ?? String(err)}${parcial}`);
			if (hechos.length) onSaved();
		} finally {
			guardando = false;
			await cargar();
		}
	}

	// ---- Cerrar con cambios sin guardar ----
	let confirmarDescartar = $state(false);
	function cerrar() {
		if (hayCambios && !soloLectura) confirmarDescartar = true;
		else onClose();
	}

	// ---- Comprobantes ----
	let visor = $state<{ url: string; titulo: string } | null>(null);
</script>

{#snippet documento()}
	{#if cargando && !r}
		<p class="p-10 text-center text-slate-400"><i class="fas fa-spinner fa-spin"></i> Cargando...</p>
	{:else if error}
		<p class="m-6 p-3 rounded-lg bg-rose-50 border border-rose-200 text-sm text-rose-700">{error}</p>
	{:else if cab && r && totales}
		{@const est = ESTADO_CUENTA[cab.estado] ?? ESTADO_CUENTA.pendiente}
		<!-- Encabezado del documento -->
		<div class="flex flex-wrap items-start justify-between gap-3 px-4 sm:px-6 pt-5 pb-4 border-b-[3px] border-[#0f3b5e]">
			<div class="min-w-0">
				<h2 class="text-xl sm:text-2xl font-extrabold tracking-wide text-[#0f3b5e]">CUENTA POR COBRAR DE OBRA</h2>
				<p class="text-xs text-slate-500 mt-0.5">Un cliente · una obra · varias cuentas por cobrar (adelantos y valorizaciones)</p>
			</div>
			<div class="flex items-start gap-2">
				<div class="border-[1.5px] border-[#0f3b5e] rounded-xl px-4 py-2 text-center min-w-[11rem]">
					<p class="text-[10px] font-bold uppercase tracking-wider text-slate-500">N.° de cuenta</p>
					<p class="text-base sm:text-lg font-extrabold text-[#0f3b5e] whitespace-nowrap">{cab.folio}</p>
					<span class={`inline-block mt-1 px-2 py-0.5 rounded-md border text-[11px] font-semibold ${est.clase}`}>{est.texto}</span>
				</div>
				{#if modo === 'modal'}
					<button type="button" onclick={cerrar} class="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100" aria-label="Cerrar"><i class="fas fa-times"></i></button>
				{/if}
			</div>
		</div>

		<!-- Datos del cliente y la obra -->
		<section class="px-4 sm:px-6 pt-4">
			<h3 class="text-[11px] font-extrabold uppercase tracking-wider text-[#0f3b5e] mb-2.5">Datos del cliente y la obra</h3>
			<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-4 gap-y-3">
				{@render soloVer('Cliente', [cab.clienteNombre, cab.clienteDocumento].filter(Boolean).join(' · '), true)}
				{@render soloVer('Centro de Costo', cab.centroCosto, true)}
				{@render soloVer('Proyecto', cab.proyectoNombre)}
				<div>
					<label for="cxo-responsable" class="block text-[11px] font-bold text-[#0f3b5e] mb-1">Responsable</label>
					{#if puedeCabecera}
						<SelectConSaldo id="cxo-responsable" value={formCab.responsable} options={[{ value: '', label: 'Sin responsable' }, ...responsables, ...(formCab.responsable && !responsables.some((o) => o.value === formCab.responsable) ? [{ value: formCab.responsable, label: formCab.responsable }] : [])]} encabezadoNombre="Responsable" onchange={(v) => (formCab.responsable = v)} />
					{:else}<p class={ro}>{cab.responsable || '—'}</p>{/if}
				</div>
				<div>
					<label for="cxo-moneda" class="block text-[11px] font-bold text-[#0f3b5e] mb-1">Moneda</label>
					{#if puedeCabecera}
						<SelectConSaldo id="cxo-moneda" value={formCab.moneda} options={MONEDAS} encabezadoNombre="Moneda" onchange={(v) => (formCab.moneda = v === 'USD' ? 'USD' : 'PEN')} />
					{:else}<p class={ro}>{cab.moneda === 'USD' ? 'Dólares (USD)' : 'Soles (PEN)'}</p>{/if}
				</div>
				<div>
					<label for="cxo-tc" class="block text-[11px] font-bold text-[#0f3b5e] mb-1">Tipo de Cambio{#if formCab.moneda === 'USD' && puedeCabecera} <span class="text-rose-600">*</span>{/if}</label>
					{#if puedeCabecera && formCab.moneda === 'USD'}
						<input id="cxo-tc" type="number" min="0.01" step="0.01" bind:value={formCab.tipo_cambio} placeholder="Ej. 3.75" class={inp} />
						<p class="mt-0.5 text-[10px] text-slate-500">S/ por US$.</p>
					{:else}<p class={`${ro} ${puedeCabecera ? 'text-slate-400 bg-slate-100' : ''}`}>{cab.moneda === 'USD' && cab.tipo_cambio ? cab.tipo_cambio.toFixed(2) : '—'}</p>
						{#if puedeCabecera}<p class="mt-0.5 text-[10px] text-slate-500">Solo con Dólares.</p>{/if}
					{/if}
				</div>
				<div>
					<label for="cxo-emision" class="block text-[11px] font-bold text-[#0f3b5e] mb-1">Fecha Emisión <span class="text-rose-600">*</span></label>
					{#if puedeCabecera}
						<input id="cxo-emision" type="date" bind:value={formCab.fecha_emision} class={inp} />
					{:else}<p class={ro}>{fmtFecha(cab.fecha_emision)}</p>{/if}
				</div>
				<div>
					<label for="cxo-prioridad" class="block text-[11px] font-bold text-[#0f3b5e] mb-1">Prioridad</label>
					{#if puedeCabecera}
						<SelectConSaldo id="cxo-prioridad" value={formCab.prioridad} options={PRIORIDADES} encabezadoNombre="Prioridad" onchange={(v) => (formCab.prioridad = v)} />
					{:else}<p class={ro}>{PRIORIDADES.find((o) => o.value === (cab?.prioridad ?? ''))?.label ?? '—'}</p>{/if}
				</div>
			</div>
			{#if puedeCabecera}
				<p class="mt-2 text-[10.5px] text-slate-400"><i class="fas fa-lock mr-1"></i>Cliente, centro de costo y proyecto vienen de la venta cerrada y no se cambian aquí.</p>
			{/if}
		</section>

		<!-- Resumen -->
		<section class="px-4 sm:px-6 pt-4 grid grid-cols-2 lg:grid-cols-4 gap-2.5">
			{#each [{ t: 'Valor de venta', v: r.valorVenta }, { t: 'Programado', v: totales.programado }, { t: 'Cobrado', v: r.cobrado }, { t: 'Saldo por cobrar', v: Math.max(r2(r.valorVenta - r.cobrado), 0) }] as k}
				<div class="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
					<p class="text-[10.5px] font-bold text-slate-500">{k.t}</p>
					<p class="text-base font-extrabold text-[#0f3b5e] tabular-nums whitespace-nowrap">{formatCurrency(k.v)}</p>
				</div>
			{/each}
		</section>

		<!-- Detalle -->
		<section class="px-4 sm:px-6 pt-4">
			<h3 class="text-[11px] font-extrabold uppercase tracking-wider text-[#0f3b5e] mb-2.5">Proyección de valorización</h3>
			<div class="overflow-x-auto rounded-t-lg">
				<table class="w-full min-w-[920px] text-[12.5px]">
					<thead>
						<tr class="bg-[#0f3b5e] text-white text-[11px] font-bold text-left">
							<th class="py-2 px-2 w-12">N.°</th><th class="py-2 px-2 w-44">Concepto</th><th class="py-2 px-2">Partidas ejecutadas</th><th class="py-2 px-2 w-36">Fecha estimada</th>
							<th class="py-2 px-2 w-44">Observaciones</th><th class="py-2 px-2 w-20 text-right">% venta</th><th class="py-2 px-2 w-36 text-right">Monto (S/)</th><th class="py-2 px-2 w-24 text-center">Estado</th><th class="py-2 px-2 w-16"></th>
						</tr>
					</thead>
					<tbody>
						<!-- Adelantos (solo lectura) -->
						<tr class="bg-slate-100 font-bold text-[#0f3b5e]"><td class="py-2 px-2">A</td><td class="py-2 px-2" colspan="5">Adelantos</td><td class="py-2 px-2 text-right tabular-nums">{formatCurrency(r.totalAdelantos)}</td><td></td><td></td></tr>
						{#each r.adelantos as g (g.id_grupo)}
							{@const comp = g.pagos.find((p) => p.comprobante_url)?.comprobante_url ?? null}
							<tr class="border-b border-slate-100">
								<td class="py-2 px-2 pl-5 text-slate-600">{g.numero}</td><td class="py-2 px-2">Adelanto {g.numero}{g.pagos.length > 1 ? ` (${g.pagos.length} armadas)` : ''}</td>
								<td class="py-2 px-2 text-slate-400">—</td><td class="py-2 px-2">{fmtFecha(ultimaFecha(g))}</td><td class="py-2 px-2 text-slate-600">{g.observaciones ?? ''}</td>
								<td class="py-2 px-2 text-right">{pct(g.total)}</td><td class="py-2 px-2 text-right font-bold text-[#0f3b5e] tabular-nums">{formatCurrency(g.total)}</td>
								<td class="py-2 px-2 text-center">
									{#if g.pagos.length === 0}
										<span class="inline-block px-2 py-0.5 rounded-md border border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-500" title="Este adelanto no tiene armadas registradas">Sin armadas</span>
									{:else}
										<span class={`inline-block px-2 py-0.5 rounded-md border text-[11px] font-semibold ${ESTADO_GRUPO[g.estado].clase}`}>{ESTADO_GRUPO[g.estado].texto}</span>
									{/if}
								</td>
								<td class="py-2 px-2 text-center">{#if g.pagos.length === 0 && puedeLineas}<button type="button" onclick={() => (adelantoAEliminar = g)} class="p-1 text-rose-500 hover:text-rose-700" title={`Eliminar Adelanto ${g.numero} (sin armadas)`} aria-label={`Eliminar Adelanto ${g.numero}`}><i class="fas fa-trash-alt"></i></button>{/if}{#if comp}<button type="button" onclick={() => (visor = { url: comp, titulo: `Adelanto ${g.numero}` })} class="p-1 text-slate-500 hover:text-[#0f3b5e]" aria-label="Ver comprobante"><i class="fas fa-eye"></i></button>{/if}</td>
							</tr>
						{:else}
							<tr class="border-b border-slate-100"><td colspan="9" class="py-2 px-2 pl-5 text-xs text-slate-400">Sin adelantos (se registran desde Ventas).</td></tr>
						{/each}

						<!-- Valorizaciones -->
						{#each r.valorizaciones as g (g.id_grupo)}
							{@const fuera = borrarVals.has(g.id_grupo)}
							{@const compVal = g.pagos.find((p) => p.comprobante_url)?.comprobante_url ?? null}
							<tr class={`bg-slate-100 font-bold text-[#0f3b5e] ${fuera ? 'opacity-50 line-through' : ''}`}>
								<td class="py-1.5 px-2">{g.numero}</td><td class="py-1.5 px-2" colspan="5">Valorización {g.numero}</td>
								<td class="py-1.5 px-2 text-right">
									{#if puedeLineas && !fuera && g.estado !== 'completada'}
										<input type="number" min="0.01" step="0.01" bind:value={montosVal[g.id_grupo]} aria-label={`Monto de la Valorización ${g.numero}`} class={`${celda} text-right font-bold text-[#0f3b5e]`} />
									{:else}<span class="tabular-nums">{formatCurrency(g.total)}</span>{/if}
								</td>
								<td class="py-1.5 px-2 text-center"><span class={`inline-block px-2 py-0.5 rounded-md border text-[11px] font-semibold no-underline ${ESTADO_GRUPO[g.estado].clase}`}>{ESTADO_GRUPO[g.estado].texto}</span></td>
								<td class="py-1.5 px-2 text-center whitespace-nowrap">
									{#if compVal}<button type="button" onclick={() => (visor = { url: compVal, titulo: `Valorización ${g.numero}` })} class="p-1 text-slate-500 hover:text-[#0f3b5e]" title="Ver voucher del cobro" aria-label="Ver voucher del cobro"><i class="fas fa-eye"></i></button>{/if}
									{#if puedeLineas && g.cobrado === 0}
										<button type="button" onclick={() => (borrarVals = alternar(borrarVals, g.id_grupo))} class={`p-1 ${fuera ? 'text-slate-500' : 'text-rose-500'}`} title={fuera ? 'Deshacer' : 'Eliminar valorización (al guardar)'} aria-label={fuera ? 'Deshacer eliminar valorización' : 'Eliminar valorización'}><i class={`fas ${fuera ? 'fa-rotate-left' : 'fa-trash-alt'}`}></i></button>
									{/if}
								</td>
							</tr>
							{#if !fuera}
								{#each g.pagos as p, i (p.id_cobro)}
									{@const quitado = borrarPagos.has(p.id_cobro)}
									<tr class={`border-b border-slate-100 ${quitado ? 'opacity-50 line-through' : ''}`}>
										<td class="py-1.5 px-2 pl-5 text-slate-600">{g.numero}.{i + 1}</td><td class="py-1.5 px-2">Pago {p.numero}</td>
										{#if editable(p) && !quitado && pagos[p.id_cobro]}
											<td class="py-1.5 px-2"><input type="text" maxlength="200" bind:value={pagos[p.id_cobro].partida} placeholder="Ej. Tarrajeo" aria-label="Partidas ejecutadas" class={celda} /></td>
											<td class="py-1.5 px-2"><input type="date" bind:value={pagos[p.id_cobro].fecha} aria-label="Fecha estimada" class={celda} /></td>
											<td class="py-1.5 px-2"><input type="text" maxlength="100" bind:value={pagos[p.id_cobro].observacion} placeholder="Escribir" aria-label="Observaciones" class={celda} /></td>
											<td class="py-1.5 px-2 text-right">{pct(Number(pagos[p.id_cobro].monto ?? 0))}</td>
											<td class="py-1.5 px-2"><input type="number" min="0.01" step="0.01" bind:value={pagos[p.id_cobro].monto} aria-label="Monto" class={`${celda} text-right font-bold text-[#0f3b5e]`} /></td>
										{:else}
											<td class="py-1.5 px-2 text-slate-600">{p.partida ?? ''}</td><td class="py-1.5 px-2">{fmtFecha(p.fecha)}</td><td class="py-1.5 px-2 text-slate-600">{p.observacion ?? ''}</td>
											<td class="py-1.5 px-2 text-right">{pct(montoBruto(p))}</td><td class="py-1.5 px-2 text-right font-bold text-[#0f3b5e] tabular-nums">{formatCurrency(montoBruto(p))}</td>
										{/if}
										<td class="py-1.5 px-2 text-center">{@render estadoPago(p)}</td>
										<td class="py-1.5 px-2 text-center whitespace-nowrap">
											{#if p.comprobante_url}<button type="button" onclick={() => (visor = { url: p.comprobante_url!, titulo: `Valorización ${g.numero} · Pago ${p.numero}` })} class="p-1 text-slate-500 hover:text-[#0f3b5e]" aria-label="Ver comprobante"><i class="fas fa-eye"></i></button>{/if}
											{#if editable(p)}
												<button type="button" onclick={() => (borrarPagos = alternar(borrarPagos, p.id_cobro))} class={`p-1 ${quitado ? 'text-slate-500' : 'text-rose-500'}`} title={quitado ? 'Deshacer' : 'Eliminar pago (al guardar)'} aria-label={quitado ? 'Deshacer eliminar pago' : 'Eliminar pago'}><i class={`fas ${quitado ? 'fa-rotate-left' : 'fa-trash-alt'}`}></i></button>
											{/if}
										</td>
									</tr>
									{#if p.detraccion}
										<tr class="bg-amber-50/50 text-[11.5px]">
											<td></td><td class="py-1 px-2 pl-4 text-amber-800" colspan="2">↳ Detracción – Pago {p.numero} (incluida en el monto)</td><td class="py-1 px-2">{fmtFecha(p.detraccion.fecha)}</td><td></td>
											<td class="py-1 px-2 text-right">{pct(p.detraccion.monto)}</td><td class="py-1 px-2 text-right tabular-nums">{formatCurrency(p.detraccion.monto)}</td>
											<td class="py-1 px-2 text-center">{@render estadoPago(p.detraccion)}</td><td></td>
										</tr>
									{/if}
								{/each}
								{#each nuevosPagos[g.id_grupo] ?? [] as n, j (n.key)}
									{@render lineaNueva(n, `${g.numero}.${g.pagos.length + j + 1}`, () => (nuevosPagos[g.id_grupo] = nuevosPagos[g.id_grupo].filter((x) => x.key !== n.key)))}
								{/each}
								{#if puedeLineas}
									<tr class="border-b border-slate-100"><td></td><td colspan="8" class="py-1.5 px-2">
										<button type="button" onclick={() => agregarPagoA(g)} class="px-3 py-1 border border-orange-300 text-[#0f3b5e] rounded-lg text-xs font-semibold hover:bg-orange-50"><i class="fas fa-plus mr-1"></i>Agregar pago a Valorización {g.numero}</button>
									</td></tr>
								{/if}
							{/if}
						{/each}

						<!-- Valorizaciones nuevas (aún sin guardar) -->
						{#each nuevasVals as v, k (v.key)}
							{@const num = r.valorizaciones.length + k + 1}
							<tr class="bg-orange-50 font-bold text-[#0f3b5e]">
								<td class="py-1.5 px-2">{num}</td>
								<td class="py-1.5 px-2" colspan="5">
									<div class="flex flex-wrap items-center gap-2">Valorización {num} <span class="text-[10px] font-semibold text-orange-600">(nueva)</span>
										<input type="text" maxlength="200" bind:value={v.observaciones} placeholder="Observaciones de la valorización" aria-label="Observaciones de la valorización" class={`${celda} flex-1 min-w-[10rem] font-normal`} />
									</div>
								</td>
								<td class="py-1.5 px-2"><input type="number" min="0.01" step="0.01" bind:value={v.monto} aria-label="Monto de la valorización" class={`${celda} text-right font-bold text-[#0f3b5e]`} /></td>
								<td></td>
								<td class="py-1.5 px-2 text-center"><button type="button" onclick={() => (nuevasVals = nuevasVals.filter((x) => x.key !== v.key))} class="p-1 text-rose-500" aria-label="Quitar valorización nueva"><i class="fas fa-times"></i></button></td>
							</tr>
							{#each v.pagos as n, j (n.key)}
								{@render lineaNueva(n, `${num}.${j + 1}`, () => (v.pagos = v.pagos.filter((x) => x.key !== n.key)))}
							{/each}
							<tr class="border-b border-slate-100"><td></td><td colspan="8" class="py-1.5 px-2">
								<button type="button" onclick={() => (v.pagos = [...v.pagos, nuevaLinea(Number(v.monto ?? 0) - v.pagos.reduce((s, x) => s + Number(x.monto ?? 0), 0))])} class="px-3 py-1 border border-orange-300 text-[#0f3b5e] rounded-lg text-xs font-semibold hover:bg-orange-50"><i class="fas fa-plus mr-1"></i>Agregar pago a Valorización {num}</button>
							</td></tr>
						{/each}

					</tbody>
				</table>
			</div>
			{#if puedeLineas}
				<button type="button" onclick={agregarValorizacion} class="mt-2.5 px-3 py-1.5 border border-[#0f3b5e] text-[#0f3b5e] rounded-lg text-xs font-semibold hover:bg-slate-50"><i class="fas fa-plus mr-1"></i>Agregar valorización</button>
			{/if}
		</section>

		<!-- Observaciones (el cuadro de totales se quitó a pedido del usuario, 18/11/2026: ya están en el resumen de arriba) -->
		<section class="px-4 sm:px-6 pt-4 pb-5">
			<div>
				<label for="cxo-obs" class="block text-[11px] font-bold text-[#0f3b5e] mb-1">Observaciones generales</label>
				{#if puedeCabecera}
					<textarea id="cxo-obs" rows="3" maxlength="200" bind:value={formCab.observaciones} placeholder="Escribir" class="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-[#0f3b5e]/20"></textarea>
				{:else}<p class="px-3 py-2 min-h-[3.5rem] border border-slate-200 rounded-lg text-sm text-slate-600 bg-slate-50 whitespace-pre-line">{cab.observaciones || '—'}</p>{/if}
			</div>
		</section>
	{/if}
{/snippet}

{#snippet soloVer(etiqueta: string, valor: string, requerido = false)}
	<div>
		<p class="text-[11px] font-bold text-[#0f3b5e] mb-1">{etiqueta}{#if requerido} <span class="text-rose-600">*</span>{/if}</p>
		<p class={ro} title={valor}>{valor || '—'}</p>
	</div>
{/snippet}

{#snippet estadoPago(p: PagoObra)}
	{#if p.estado !== 'cobrado' && onCobrarPago && !soloLectura}
		<button type="button" disabled={hayCambios} onclick={() => onCobrarPago?.(p.id_cobro)} title={hayCambios ? 'Guarda los cambios antes de registrar un cobro' : 'Registrar el cobro de este pago'} class={`px-2 py-0.5 rounded-md border text-[11px] font-semibold disabled:opacity-50 ${CLASE_PAGO[p.estado]}`}>{TEXTO_PAGO[p.estado]}</button>
	{:else}
		<span class={`inline-block px-2 py-0.5 rounded-md border text-[11px] font-semibold ${CLASE_PAGO[p.estado]}`}>{TEXTO_PAGO[p.estado]}</span>
	{/if}
{/snippet}

{#snippet lineaNueva(n: Nuevo, numero: string, quitar: () => void)}
	<tr class="border-b border-slate-100 bg-orange-50/40">
		<td class="py-1.5 px-2 pl-5 text-slate-600">{numero}</td><td class="py-1.5 px-2">Pago nuevo</td>
		<td class="py-1.5 px-2"><input type="text" maxlength="200" bind:value={n.partida} placeholder="Ej. Tarrajeo" aria-label="Partidas ejecutadas" class={celda} /></td>
		<td class="py-1.5 px-2"><input type="date" bind:value={n.fecha} aria-label="Fecha estimada" class={celda} /></td>
		<td class="py-1.5 px-2"><input type="text" maxlength="100" bind:value={n.observacion} placeholder="Escribir" aria-label="Observaciones" class={celda} /></td>
		<td class="py-1.5 px-2 text-right">{pct(Number(n.monto ?? 0))}</td>
		<td class="py-1.5 px-2"><input type="number" min="0.01" step="0.01" bind:value={n.monto} aria-label="Monto" class={`${celda} text-right font-bold text-[#0f3b5e]`} /></td>
		<td class="py-1.5 px-2 text-center"><span class="inline-block px-2 py-0.5 rounded-md border text-[11px] font-semibold bg-orange-50 text-orange-700 border-orange-200">Nuevo</span></td>
		<td class="py-1.5 px-2 text-center"><button type="button" onclick={quitar} class="p-1 text-rose-500" aria-label="Quitar pago nuevo"><i class="fas fa-times"></i></button></td>
	</tr>
{/snippet}

{#if open}
	{#if modo === 'embebido'}
		<div class="rounded-2xl border border-slate-200 bg-white overflow-hidden">
			{@render documento()}
			{#if onEditar && soloLectura && r}
				<div class="flex justify-end px-4 sm:px-6 py-3 border-t border-slate-100">
					<button type="button" onclick={onEditar} class="px-4 py-2 rounded-lg bg-[#0f3b5e] text-white text-sm font-bold hover:bg-[#0c3150]"><i class="fas fa-pen mr-1.5"></i>Editar cuenta por cobrar</button>
				</div>
			{/if}
		</div>
	{:else}
		<div class="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-2 sm:p-4" role="dialog" aria-modal="true" aria-label="Cuenta por cobrar de obra">
			<div class="w-full max-w-6xl max-h-[95dvh] flex flex-col rounded-2xl bg-white shadow-2xl overflow-hidden">
				<div class="flex-1 overflow-y-auto">{@render documento()}</div>
				<div class="flex flex-wrap items-center justify-end gap-2 px-4 sm:px-6 py-3 border-t border-slate-200 bg-white">
					{#if hayCambios && !soloLectura}<span class="mr-auto text-xs font-semibold text-orange-600"><i class="fas fa-circle text-[6px] align-middle mr-1"></i>Cambios sin guardar</span>{/if}
					<button type="button" onclick={cerrar} class="px-4 py-2 rounded-lg border border-slate-200 text-sm font-bold text-slate-600 hover:bg-slate-50">{soloLectura ? 'Cerrar' : 'Cancelar'}</button>
					{#if !soloLectura}
						<button type="button" onclick={guardar} disabled={!hayCambios || guardando} class="px-4 py-2 rounded-lg bg-[#0f3b5e] text-white text-sm font-bold hover:bg-[#0c3150] disabled:opacity-50">
							{#if guardando}<i class="fas fa-spinner fa-spin mr-1"></i>Guardando…{:else}Guardar cambios{/if}
						</button>
					{/if}
				</div>
			</div>
		</div>
	{/if}
{/if}

<ConfirmModal
	open={confirmarDescartar}
	title="Descartar cambios"
	message="Hay cambios sin guardar en la cuenta por cobrar. ¿Cerrar sin guardarlos?"
	confirmLabel="Descartar"
	cancelLabel="Seguir editando"
	danger
	onConfirm={() => {
		confirmarDescartar = false;
		reiniciarBorrador();
		onClose();
	}}
	onClose={() => (confirmarDescartar = false)}
/>
<ConfirmModal
	open={!!adelantoAEliminar}
	title="Eliminar adelanto"
	message={adelantoAEliminar ? `¿Eliminar el Adelanto ${adelantoAEliminar.numero}? No tiene armadas registradas, así que no afecta montos, cobros ni transacciones. Los adelantos siguientes se renumeran.` : ''}
	confirmLabel="Eliminar"
	onConfirm={confirmarEliminarAdelanto}
	onClose={() => (adelantoAEliminar = null)}
/>
<DocumentPreviewModal open={visor !== null} url={visor?.url ?? ''} title={visor?.titulo ?? ''} onClose={() => (visor = null)} />
