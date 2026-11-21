<script lang="ts">
	/**
	 * "Resumen de cobro" de una venta de OBRA (imagen 7 del Excel del cliente, Documentacion/PlanFinanzasObras.md):
	 * cabecera con avance de cobranza programada y efectiva, Adelantos (solo lectura, desplegables con sus armadas) y
	 * Valorizaciones con sus pagos (agregar/editar/eliminar con el permiso gestionar_valorizaciones). "Pendiente" de un
	 * pago llama a onCobrarPago → la página abre "Editar Transacción" (categoría Valorización) y, al guardar, el pago
	 * pasa a Cobrado. Todo se lee/escribe con cobranzaObra.service.ts; los cambios se guardan al momento.
	 */
	import { supabase } from '$lib/supabaseClient';
	import { formatCurrency } from '$lib/shared/fieldConfig';
	import DocumentPreviewModal from '$lib/shared/components/DocumentPreviewModal.svelte';
	import { hasPermiso, isAdmin } from '$lib/stores/permisos.svelte';
	import { toast } from '$lib/stores/toast';
	import { getFechaLocalHoy } from '$lib/shared/dateUtils';
	import {
		getResumenCobroObra, crearValorizacion, actualizarValorizacion, eliminarValorizacion, agregarPago, editarPago, eliminarPago, eliminarAdelantoVacio,
		montoBruto, type ResumenCobroObra, type GrupoObra, type PagoObra
	} from '$lib/modules/cobranza-obra/services/cobranzaObra.service';
	import ConfirmModal from '$lib/shared/components/ConfirmModal.svelte';

	let {
		open,
		idCuentaCobrar,
		titulo = 'Resumen de cobro',
		/** Sube cuando la página registra un cobro, para volver a leer el resumen. */
		recargar = 0,
		soloLectura = false,
		/** Ticket #129: ojo junto al título que oculta todos los montos (como el Resumen de venta de Consultoría). */
		ocultable = false,
		onClose,
		onCobrarPago
	}: {
		open: boolean;
		idCuentaCobrar: number | null;
		titulo?: string;
		recargar?: number;
		soloLectura?: boolean;
		ocultable?: boolean;
		onClose: () => void;
		onCobrarPago: (idCobro: number) => void;
	} = $props();

	let resumen = $state<ResumenCobroObra | null>(null);
	let cargando = $state(false);
	let error = $state('');
	let abiertos = $state<Record<string, boolean>>({});
	const puedeGestionar = $derived(!soloLectura && hasPermiso('gestionar_valorizaciones'));
	// A pedido del usuario (18/11/2026): el lápiz (editar valorización / pago) solo para administradores.
	const puedeEditar = $derived(puedeGestionar && isAdmin());

	async function cargar() {
		if (!idCuentaCobrar) return;
		cargando = true;
		error = '';
		try {
			resumen = await getResumenCobroObra(supabase, idCuentaCobrar);
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

	const pct = (parte: number, total = resumen?.valorVenta ?? 0) => (total > 0 ? `${((parte / total) * 100).toFixed(2)} %` : '—');
	const fmtFecha = (f: string | null) => (f ? f.split('-').reverse().join('/') : '—');
	const ultimaFecha = (g: GrupoObra) => g.pagos.map((p) => p.fecha).sort().at(-1) ?? null;
	const claseEstadoPago: Record<PagoObra['estado'], string> = {
		cobrado: 'bg-emerald-50 text-emerald-700 border-emerald-200',
		pendiente: 'bg-amber-50 text-amber-700 border-amber-300 hover:bg-amber-100',
		vencido: 'bg-rose-50 text-rose-700 border-rose-300 hover:bg-rose-100'
	};
	const etiquetaEstadoPago: Record<PagoObra['estado'], string> = { cobrado: 'Cobrado', pendiente: 'Pendiente', vencido: 'Vencido' };
	const estadoVal: Record<GrupoObra['estado'], { texto: string; clase: string; punto: string }> = {
		completada: { texto: 'Completada', clase: 'bg-emerald-50 text-emerald-700 border-emerald-200', punto: 'bg-emerald-500' },
		// Pendiente en naranja (ámbar), como en Cuentas por Cobrar/Pagar; "En proceso" en azul para distinguirlo.
		en_proceso: { texto: 'En proceso', clase: 'bg-blue-50 text-blue-700 border-blue-200', punto: 'bg-blue-500' },
		pendiente: { texto: 'Pendiente', clase: 'bg-amber-50 text-amber-700 border-amber-300', punto: 'bg-amber-500' }
	};

	// ---- Formularios en línea (valorización / pago) ----
	let formVal = $state<{ idGrupo: number | null; monto: string; observaciones: string } | null>(null);
	let formPago = $state<{ idGrupo: number; idCobro: number | null; monto: string; fecha: string; partida: string } | null>(null);
	let guardando = $state(false);

	// Adelanto sin armadas (p. ej. quedó vacío por un registro fallido, 20/11/2026): se puede eliminar; los siguientes se renumeran.
	let adelantoAEliminar = $state<GrupoObra | null>(null);
	async function confirmarEliminarAdelanto() {
		const g = adelantoAEliminar;
		if (!g) return;
		let aviso: string | null = null;
		const listo = await ejecutar(async () => {
			const r = await eliminarAdelantoVacio(supabase, g.id_grupo);
			if (r.success) aviso = r.aviso;
			return r;
		}, `Adelanto ${g.numero} eliminado.`);
		if (listo) {
			adelantoAEliminar = null;
			if (aviso) toast.info(aviso);
		}
	}

	async function ejecutar(fn: () => Promise<{ success: boolean; message?: string }>, ok: string) {
		if (guardando) return;
		guardando = true;
		try {
			const r = await fn();
			if (!r.success) {
				toast.error(r.message ?? 'No se pudo guardar.');
				return false;
			}
			toast.success(ok);
			await cargar();
			return true;
		} finally {
			guardando = false;
		}
	}
	async function guardarValorizacion() {
		if (!formVal || !resumen) return;
		const monto = Number(formVal.monto);
		const f = formVal;
		const listo = await ejecutar(
			() => (f.idGrupo ? actualizarValorizacion(supabase, f.idGrupo, monto, f.observaciones) : crearValorizacion(supabase, resumen!.id_cuenta_cobrar, monto, f.observaciones, null)),
			f.idGrupo ? 'Valorización actualizada.' : 'Valorización agregada.'
		);
		if (listo) formVal = null;
	}
	async function guardarPago() {
		if (!formPago) return;
		const f = formPago;
		const datos = { monto: Number(f.monto), fecha: f.fecha, partida: f.partida };
		const listo = await ejecutar(() => (f.idCobro ? editarPago(supabase, f.idCobro, datos) : agregarPago(supabase, f.idGrupo, datos, null)), f.idCobro ? 'Pago actualizado.' : 'Pago agregado.');
		if (listo) formPago = null;
	}
	function nuevoPago(g: GrupoObra) {
		const restante = Math.max(Math.round((g.total - g.programado) * 100) / 100, 0);
		formPago = { idGrupo: g.id_grupo, idCobro: null, monto: restante > 0 ? String(restante) : '', fecha: getFechaLocalHoy(), partida: '' };
		abiertos[`v${g.id_grupo}`] = true;
	}
	function nuevaValorizacion() {
		const sugerido = Math.max(resumen?.diferenciaPlan ?? 0, 0);
		formVal = { idGrupo: null, monto: sugerido > 0 ? String(sugerido) : '', observaciones: '' };
	}
	// "Ver" comprobante (a pedido del usuario): antes abría una miniatura de Drive con window.open, que en la app
	// (Tauri Windows/Android) no hace nada. Ahora abre el visor de la app (DocumentPreviewModal, PDF o imagen, igual
	// en navegador, Windows y Android) con TODOS los comprobantes de la venta — adelantos/armadas, pagos de
	// valorizaciones y cuotas sueltas —, posicionado en el que se tocó y con pastillas para pasar a los demás.
	const documentosVenta = $derived.by(() => {
		if (!resumen) return [] as { url: string; label: string }[];
		const docs: { url: string; label: string }[] = [];
		const agregar = (url: string | null, label: string) => {
			if (url && !docs.some((d) => d.url === url)) docs.push({ url, label });
		};
		for (const g of resumen.adelantos) for (const a of g.pagos) agregar(a.comprobante_url, g.pagos.length > 1 ? `Adelanto ${g.numero} · Armada ${a.numero}` : `Adelanto ${g.numero}`);
		for (const g of resumen.valorizaciones) for (const p of g.pagos) agregar(p.comprobante_url, `Valorización ${g.numero} · Pago ${p.numero}`);
		for (const p of resumen.sinGrupo) agregar(p.comprobante_url, `Cuota ${p.numero}`);
		return docs;
	});
	let visorAbierto = $state(false);
	let visorInicial = $state(0);
	function verComprobante(url: string | null) {
		if (!url) return;
		visorInicial = Math.max(0, documentosVenta.findIndex((d) => d.url === url));
		visorAbierto = true;
	}
	const comprobantesDe = (g: GrupoObra) => g.pagos.filter((p) => p.comprobante_url).length;

	// Ticket #129: con `ocultable` arranca oculto (igual que Consultoría); el ojo del título muestra/oculta todo a la vez.
	let montosVisibles = $state(false);
	$effect(() => {
		if (!open) montosVisibles = false;
	});
	const OCULTO = '••••••';
	const verMontos = $derived(!ocultable || montosVisibles);
	const m = (n: number) => (verMontos ? formatCurrency(n) : OCULTO);
	const pctM = (n: number, total?: number) => (verMontos ? pct(n, total) : '••••');
</script>

{#if open}
	<div class="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-2 sm:p-4" role="dialog" aria-modal="true" aria-label={titulo}>
		<div class="w-full max-w-6xl max-h-[95dvh] overflow-y-auto rounded-2xl bg-white shadow-2xl">
			<div class="sticky top-0 z-10 flex items-center justify-between gap-3 bg-white px-4 sm:px-6 py-3 border-b border-slate-100">
				<div class="flex items-center gap-2 min-w-0">
					<h2 class="text-xl font-bold text-[#0f3b5e] truncate">{titulo}</h2>
					{#if ocultable}
						<button type="button" onclick={() => (montosVisibles = !montosVisibles)} class="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 shrink-0" title={montosVisibles ? 'Ocultar montos' : 'Mostrar montos'} aria-label={montosVisibles ? 'Ocultar montos' : 'Mostrar montos'}>
							<i class={`fas ${montosVisibles ? 'fa-eye' : 'fa-eye-slash'}`}></i>
						</button>
					{/if}
				</div>
				<!-- Ticket #106: sin botón "Comprobantes (N)" acá — duplicaba el "Ver" de cada adelanto (mismo visor). -->
				<div class="ml-auto flex items-center gap-2">
				<button type="button" onclick={onClose} class="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100" aria-label="Cerrar"><i class="fas fa-times"></i></button>
				</div>
			</div>

			{#if cargando && !resumen}
				<p class="p-10 text-center text-slate-400"><i class="fas fa-spinner fa-spin"></i> Cargando...</p>
			{:else if error}
				<p class="m-6 p-3 rounded-lg bg-rose-50 border border-rose-200 text-sm text-rose-700">{error}</p>
			{:else if resumen}
				{@const r = resumen}
				<div class="p-4 sm:p-6 space-y-5">
					<!-- Cabecera -->
					<div class="grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-4">
						<!-- Ticket #106: "Valor venta total del proyecto (S/)" ocupa dos líneas; cada casilla se apoya abajo para que los
						     cuatro valores queden en la misma línea. -->
						<div class="grid grid-cols-2 md:grid-cols-4 gap-3 items-stretch">
							<div class="flex flex-col justify-end"><p class="text-xs text-slate-500 leading-tight">Valor venta total del proyecto (S/)</p><p class="mt-1 px-3 py-2 rounded-lg border border-slate-200 font-semibold text-slate-800">{m(r.valorVenta)}</p></div>
							<div class="flex flex-col justify-end"><p class="text-xs text-slate-500 leading-tight">Monto de adelanto (S/)</p><p class="mt-1 px-3 py-2 rounded-lg border border-slate-200 font-semibold text-slate-800">{m(r.totalAdelantos)}</p></div>
							<div class="flex flex-col justify-end"><p class="text-xs text-slate-500 leading-tight">Porcentaje adelanto</p><p class="mt-1 px-3 py-2 rounded-lg border border-slate-200 font-semibold text-slate-800">{pctM(r.totalAdelantos)}</p></div>
							<div class="flex flex-col justify-end"><p class="text-xs text-slate-500 leading-tight">Fecha de venta</p><p class="mt-1 px-3 py-2 rounded-lg border border-slate-200 font-semibold text-slate-800">{fmtFecha(r.fechaVenta)}</p></div>
						</div>
						<div class="grid grid-cols-1 sm:grid-cols-2 gap-3 lg:w-[520px]">
							{#each [{ t: 'Avance de cobranza programada', p: r.pctProgramado, a: 'Monto programado', av: r.programado, b: 'Saldo por cobrar (prog)', bv: r.valorVenta - r.programado, color: 'bg-blue-600' }, { t: 'Avance de cobranza efectiva', p: r.pctCobrado, a: 'Total cobrado', av: r.cobrado, b: 'Saldo por cobrar', bv: r.valorVenta - r.cobrado, color: 'bg-emerald-500' }] as k}
								<div class="rounded-xl border border-blue-100 bg-blue-50/40 p-3">
									<p class="text-[11px] font-bold text-[#0f3b5e]">{k.t}</p>
									<div class="mt-1 flex items-center gap-2">
										<div class="h-2.5 flex-1 rounded-full bg-slate-200 overflow-hidden"><div class={`h-full ${k.color}`} style={`width:${Math.min(k.p, 100)}%`}></div></div>
										<span class="text-sm font-bold text-[#0f3b5e]">{verMontos ? `${k.p.toFixed(2)} %` : '••••'}</span>
									</div>
									<div class="mt-1 grid grid-cols-2 gap-2 text-[11px] text-slate-500">
										<div>{k.a}<p class="text-sm font-bold text-[#0f3b5e]">{m(k.av)}</p></div>
										<div>{k.b}<p class="text-sm font-bold text-[#0f3b5e]">{m(Math.max(k.bv, 0))}</p></div>
									</div>
								</div>
							{/each}
						</div>
					</div>

					<!-- Adelantos (solo lectura: se registran y modifican desde Ventas) -->
					<section class="rounded-xl border border-slate-200 overflow-hidden">
						<h3 class="px-4 py-2 font-bold text-[#0f3b5e] bg-slate-50 border-b border-slate-200">Adelantos</h3>
						<div class="overflow-x-auto">
							<table class="w-full text-sm min-w-[860px]">
								<thead>
									<tr class="text-[11px] font-semibold text-slate-500 border-b border-slate-200">
										<th class="py-2 px-2 text-center w-10">N.°</th><th class="py-2 px-2 text-left">Concepto</th><th class="py-2 px-2 text-right">Monto (S/)</th><th class="py-2 px-2 text-center">Fecha de pago</th>
										<th class="py-2 px-2 text-right">% sobre valor de venta</th><th class="py-2 px-2 text-right">% sobre valor de armadas</th><th class="py-2 px-2 text-left">Comprobante</th><th class="py-2 px-2 text-left">Observaciones</th><th class="py-2 px-2 text-center">Estado</th><th class="py-2 px-2 w-10"></th>
									</tr>
								</thead>
								<tbody>
									{#each r.adelantos as g (g.id_grupo)}
										<tr class="border-b border-slate-100">
											<td class="py-2 px-2 text-center font-semibold">{g.numero}</td>
											<td class="py-2 px-2">Adelanto {g.numero}</td>
											<td class="py-2 px-2 text-right">{m(g.total)}</td>
											<td class="py-2 px-2 text-center">{fmtFecha(ultimaFecha(g))}</td>
											<td class="py-2 px-2 text-right">{pctM(g.total)}</td>
											<td class="py-2 px-2 text-right">100.00 %</td>
											<td class="py-2 px-2">
												{#if comprobantesDe(g) > 0}<button type="button" onclick={() => verComprobante(g.pagos.find((p) => p.comprobante_url)?.comprobante_url ?? null)} class="text-xs text-blue-600 hover:underline"><i class="fas fa-eye mr-1"></i>Ver{comprobantesDe(g) > 1 ? ` (${comprobantesDe(g)})` : ''}</button>{:else}<span class="text-xs text-slate-400">Sin comprobante</span>{/if}
											</td>
											<td class="py-2 px-2 text-xs text-slate-600">{g.observaciones ?? ''}</td>
											<td class="py-2 px-2 text-center">
												{#if g.pagos.length === 0}
													<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-500" title="Este adelanto no tiene armadas registradas">Sin armadas</span>
												{:else}
													<span class={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[11px] font-semibold ${g.estado === 'completada' ? estadoVal.completada.clase : estadoVal.pendiente.clase}`}>{g.estado === 'completada' ? 'Cobrado' : 'Pendiente'}</span>
												{/if}
											</td>
											<td class="py-2 px-2 text-center whitespace-nowrap">
												{#if g.pagos.length === 0 && puedeGestionar}
													<button type="button" onclick={() => (adelantoAEliminar = g)} class="p-1 text-rose-500 hover:text-rose-700" title={`Eliminar Adelanto ${g.numero} (sin armadas)`} aria-label={`Eliminar Adelanto ${g.numero}`}><i class="fas fa-trash-alt"></i></button>
												{/if}
												<button type="button" onclick={() => (abiertos[`a${g.id_grupo}`] = !abiertos[`a${g.id_grupo}`])} class="p-1 text-slate-500 hover:text-[#0f3b5e]" aria-label="Ver armadas"><i class={`fas fa-chevron-${abiertos[`a${g.id_grupo}`] ? 'up' : 'down'}`}></i></button>
											</td>
										</tr>
										{#if abiertos[`a${g.id_grupo}`]}
											<tr class="bg-slate-50/60">
												<td colspan="10" class="px-4 py-2">
													<p class="text-xs font-bold text-[#0f3b5e] mb-1">Detalle de armadas - Adelanto {g.numero}</p>
													{#if g.pagos.length === 0}
														<p class="py-1 text-xs text-slate-400">Este adelanto no tiene armadas registradas.</p>
													{:else}
													<table class="w-full text-xs">
														<thead><tr class="text-slate-500"><th class="py-1 text-center w-10">N.°</th><th class="py-1 text-left">Concepto</th><th class="py-1 text-right">Monto (S/)</th><th class="py-1 text-center">Fecha de pago</th><th class="py-1 text-right">% s/ venta</th><th class="py-1 text-right">% s/ armadas</th><th class="py-1 text-left pl-3">Observaciones</th><th class="py-1 text-center">Comprobante</th></tr></thead>
														<tbody>
															{#each g.pagos as a (a.id_cobro)}
																<tr class="border-t border-slate-100">
																	<td class="py-1 text-center">{a.numero}</td><td class="py-1">Armada {a.numero}</td><td class="py-1 text-right">{m(a.monto)}</td><td class="py-1 text-center">{fmtFecha(a.fecha)}</td>
																	<td class="py-1 text-right">{pctM(a.monto)}</td><td class="py-1 text-right">{pctM(a.monto, g.total)}</td><td class="py-1 pl-3 text-slate-600">{a.observacion ?? ''}</td>
																	<td class="py-1 text-center">{#if a.comprobante_url}<button type="button" onclick={() => verComprobante(a.comprobante_url)} class="text-blue-600" aria-label="Ver comprobante"><i class="fas fa-eye"></i></button>{:else}—{/if}</td>
																</tr>
																{#if a.detraccion}
																	{@const d = a.detraccion}
																	<tr class="bg-amber-50/50">
																		<td></td><td class="py-1 pl-3 text-amber-800">↳ Detracción – Armada {a.numero}</td><td class="py-1 text-right">{m(d.monto)}</td>
																		<td class="py-1 text-center" title="Vence 5 días hábiles después de la armada">{fmtFecha(d.fecha)}</td>
																		<td class="py-1 text-right">{pctM(d.monto)}</td><td class="py-1 text-right">{pctM(d.monto, g.total)}</td>
																		<td class="py-1 pl-3">{@render estadoDetraccion(d)}</td>
																		<td class="py-1 text-center">{#if d.comprobante_url}<button type="button" onclick={() => verComprobante(d.comprobante_url)} class="text-blue-600" aria-label="Ver comprobante de la detracción"><i class="fas fa-eye"></i></button>{:else}—{/if}</td>
																	</tr>
																{/if}
															{/each}
														</tbody>
													</table>
													{/if}
												</td>
											</tr>
										{/if}
									{:else}
										<tr><td colspan="10" class="py-4 text-center text-xs text-slate-400">Sin adelantos registrados (se registran desde Ventas).</td></tr>
									{/each}
								</tbody>
							</table>
						</div>
						<div class="flex justify-end px-4 py-2 border-t border-slate-100 text-sm"><span class="font-semibold text-slate-700 mr-3">Total adelantos:</span><span class="font-bold text-[#0f3b5e]">{m(r.totalAdelantos)}</span></div>
					</section>

					<!-- Valorizaciones -->
					<section class="rounded-xl border border-slate-200 overflow-hidden">
						<div class="overflow-x-auto">
							<table class="w-full text-sm min-w-[900px]">
								<thead>
									<tr class="text-[11px] font-semibold text-slate-500 bg-slate-50 border-b border-slate-200">
										<th class="py-2 px-2 text-center w-10">N.°</th><th class="py-2 px-2 text-left">Valorización</th><th class="py-2 px-2 text-left">Pagos incluidos</th><th class="py-2 px-2 text-right">Monto total (S/)</th>
										<th class="py-2 px-2 text-right">% sobre valor venta</th><th class="py-2 px-2 text-left w-48">Avance</th><th class="py-2 px-2 text-center">Estado</th><th class="py-2 px-2 text-center w-20">Acciones</th>
									</tr>
								</thead>
								<tbody>
									{#each r.valorizaciones as g (g.id_grupo)}
										{@const ev = estadoVal[g.estado]}
										<tr class="border-b border-slate-100">
											<td class="py-2 px-2 text-center font-semibold">{g.numero}</td>
											<td class="py-2 px-2">
												<button type="button" onclick={() => (abiertos[`v${g.id_grupo}`] = !abiertos[`v${g.id_grupo}`])} class="font-bold text-[#0f3b5e] flex items-center gap-2"><i class={`fas fa-chevron-${abiertos[`v${g.id_grupo}`] ? 'down' : 'right'} text-xs`}></i>Valorización {g.numero}</button>
											</td>
											<td class="py-2 px-2 text-slate-600">{g.pagos.length ? `Pago ${g.pagos.map((p) => p.numero).join(', ')}` : '—'}</td>
											<td class="py-2 px-2 text-right font-semibold">{m(g.total)}</td>
											<td class="py-2 px-2 text-right">{pctM(g.total)}</td>
											<td class="py-2 px-2">
												<div class="flex items-center gap-2"><div class="h-2 flex-1 rounded-full bg-slate-200 overflow-hidden"><div class="h-full bg-blue-600" style={`width:${Math.min(g.avance, 100)}%`}></div></div><span class="text-xs font-semibold w-14 text-right">{g.avance.toFixed(2)} %</span></div>
											</td>
											<td class="py-2 px-2 text-center"><span class={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border text-[11px] font-semibold ${ev.clase}`}><span class={`w-1.5 h-1.5 rounded-full ${ev.punto}`}></span>{ev.texto}</span></td>
											<td class="py-2 px-2 text-center whitespace-nowrap">
												{#if comprobantesDe(g) > 0}
													<button type="button" onclick={() => verComprobante(g.pagos.find((p) => p.comprobante_url)?.comprobante_url ?? null)} class="p-1 text-slate-500 hover:text-[#0f3b5e]" title="Ver voucher del cobro" aria-label="Ver voucher del cobro"><i class="fas fa-eye"></i></button>
												{/if}
												{#if puedeEditar}
													<button type="button" onclick={() => (formVal = { idGrupo: g.id_grupo, monto: String(g.total), observaciones: g.observaciones ?? '' })} class="p-1 text-blue-600" title="Editar valorización" aria-label="Editar valorización"><i class="fas fa-pen"></i></button>
												{/if}
												{#if puedeGestionar}
													<button type="button" onclick={() => ejecutar(() => eliminarValorizacion(supabase, g.id_grupo), 'Valorización eliminada.')} class="p-1 text-rose-500" title="Eliminar valorización" aria-label="Eliminar valorización"><i class="fas fa-trash-alt"></i></button>
												{/if}
											</td>
										</tr>
										{#if formVal?.idGrupo === g.id_grupo}
											<tr class="bg-blue-50/50"><td colspan="8" class="px-4 py-2">
												{@render formularioValorizacion()}
											</td></tr>
										{/if}
										{#if abiertos[`v${g.id_grupo}`]}
											<tr class="bg-slate-50/60">
												<td colspan="8" class="px-4 py-2">
													<table class="w-full text-xs">
														<thead><tr class="text-slate-500"><th class="py-1 text-center w-12">N.°</th><th class="py-1 text-left">Pago</th><th class="py-1 text-center">Fecha estimada</th><th class="py-1 text-left">Partidas ejecutadas</th><th class="py-1 text-right">Monto (S/)</th><th class="py-1 text-right">% s/ valor venta</th><th class="py-1 text-center">Estado</th><th class="py-1 text-center w-24">Acciones</th></tr></thead>
														<tbody>
															{#each g.pagos as p, i (p.id_cobro)}
																<tr class="border-t border-slate-100">
																	<td class="py-1 text-center">{g.numero}.{i + 1}</td><td class="py-1">Pago {p.numero}</td><td class="py-1 text-center">{fmtFecha(p.fecha)}</td><td class="py-1">{p.partida ?? ''}</td>
																	<td class="py-1 text-right">{m(p.monto)}</td><td class="py-1 text-right">{pctM(p.monto)}</td>
																	<td class="py-1 text-center">
																		{#if p.estado === 'cobrado' || soloLectura}
																			<span class={`inline-block px-2 py-0.5 rounded-md border text-[11px] font-semibold ${claseEstadoPago[p.estado]}`}>{etiquetaEstadoPago[p.estado]}</span>
																		{:else}
																			<button type="button" onclick={() => onCobrarPago(p.id_cobro)} class={`px-2 py-0.5 rounded-md border text-[11px] font-semibold ${claseEstadoPago[p.estado]}`} title="Registrar el cobro de este pago">{etiquetaEstadoPago[p.estado]}</button>
																		{/if}
																	</td>
																	<td class="py-1 text-center whitespace-nowrap">
																		{#if p.comprobante_url}<button type="button" onclick={() => verComprobante(p.comprobante_url)} class="p-1 text-slate-500" aria-label="Ver comprobante"><i class="fas fa-eye"></i></button>{/if}
																		{#if puedeEditar && p.estado !== 'cobrado'}
																			<button type="button" onclick={() => (formPago = { idGrupo: g.id_grupo, idCobro: p.id_cobro, monto: String(montoBruto(p)), fecha: p.fecha, partida: p.partida ?? '' })} class="p-1 text-blue-600" aria-label="Editar pago"><i class="fas fa-pen"></i></button>
																		{/if}
																		{#if puedeGestionar && p.estado !== 'cobrado'}
																			<button type="button" onclick={() => ejecutar(() => eliminarPago(supabase, p.id_cobro), 'Pago eliminado.')} class="p-1 text-rose-500" aria-label="Eliminar pago"><i class="fas fa-trash-alt"></i></button>
																		{/if}
																	</td>
																</tr>
																{#if p.detraccion}
																	{@const d = p.detraccion}
																	<tr class="bg-amber-50/50">
																		<td></td><td class="py-1 pl-3 text-amber-800">↳ Detracción – Pago {p.numero}</td>
																		<td class="py-1 text-center" title="Vence 5 días hábiles después del pago">{fmtFecha(d.fecha)}</td><td></td>
																		<td class="py-1 text-right">{m(d.monto)}</td><td class="py-1 text-right">{pctM(d.monto)}</td>
																		<td class="py-1 text-center">{@render estadoDetraccion(d)}</td>
																		<td class="py-1 text-center">{#if d.comprobante_url}<button type="button" onclick={() => verComprobante(d.comprobante_url)} class="p-1 text-slate-500" aria-label="Ver comprobante de la detracción"><i class="fas fa-eye"></i></button>{/if}</td>
																	</tr>
																{/if}
																{#if formPago?.idCobro === p.id_cobro}<tr><td colspan="8">{@render formularioPago()}</td></tr>{/if}
															{:else}
																<tr><td colspan="8" class="py-2 text-center text-slate-400">Sin pagos programados.</td></tr>
															{/each}
														</tbody>
													</table>
													{#if formPago?.idGrupo === g.id_grupo && formPago.idCobro === null}
														{@render formularioPago()}
													{:else if puedeGestionar}
														<button type="button" onclick={() => nuevoPago(g)} class="mt-2 px-3 py-1.5 border border-orange-300 text-[#0f3b5e] rounded-lg text-xs font-semibold hover:bg-orange-50"><i class="fas fa-plus mr-1"></i>Agregar pago a Valorización {g.numero}</button>
													{/if}
												</td>
											</tr>
										{/if}
									{:else}
										<tr><td colspan="8" class="py-4 text-center text-xs text-slate-400">Todavía no hay valorizaciones programadas.</td></tr>
									{/each}
								</tbody>
							</table>
						</div>
						{#if r.sinGrupo.length > 0}
							<p class="px-4 py-2 text-xs text-amber-700 bg-amber-50 border-t border-amber-100">Esta cuenta tiene {r.sinGrupo.length} cuota(s) sin valorización asignada (registradas antes): {r.sinGrupo.map((p) => `${m(p.monto)} ${fmtFecha(p.fecha)}`).join(' · ')}.</p>
						{/if}
						{#if formVal && formVal.idGrupo === null}
							<div class="px-4 py-3 border-t border-slate-100 bg-blue-50/50">{@render formularioValorizacion()}</div>
						{/if}
						<div class="flex flex-wrap items-end justify-between gap-3 px-4 py-3 border-t border-slate-100">
							{#if puedeGestionar && !(formVal && formVal.idGrupo === null)}
								<button type="button" onclick={nuevaValorizacion} class="px-4 py-2 border border-[#0f3b5e] text-[#0f3b5e] rounded-lg text-sm font-semibold hover:bg-slate-50"><i class="fas fa-plus mr-1"></i>Agregar valorización</button>
							{:else}<span></span>{/if}
							<table class="text-xs">
								<tbody>
									<tr><td class="pr-4 text-slate-600">Total valorizaciones</td><td class="pr-4 text-right">{m(r.totalValorizacionesPlan)}</td><td class="text-right">{pctM(r.totalValorizacionesPlan)}</td></tr>
									<tr><td class="pr-4 text-slate-600">Total adelantos</td><td class="pr-4 text-right">{m(r.totalAdelantos)}</td><td class="text-right">{pctM(r.totalAdelantos)}</td></tr>
									<tr class="font-bold text-[#0f3b5e]"><td class="pr-4">Total venta</td><td class="pr-4 text-right">{m(r.valorVenta)}</td><td class="text-right">100.00 %</td></tr>
								</tbody>
							</table>
						</div>
						{#if Math.abs(r.diferenciaPlan) >= 0.01}
							<p class="px-4 py-2 text-xs border-t {r.diferenciaPlan > 0 ? 'text-amber-700 bg-amber-50 border-amber-100' : 'text-rose-700 bg-rose-50 border-rose-100'}">
								{r.diferenciaPlan > 0 ? `Faltan ${m(r.diferenciaPlan)} por programar en valorizaciones para llegar al valor de venta.` : `Las valorizaciones y adelantos superan el valor de venta en ${m(-r.diferenciaPlan)}.`}
							</p>
						{/if}
					</section>
				</div>
				<div class="sticky bottom-0 flex justify-end gap-2 px-4 sm:px-6 py-3 bg-white border-t border-slate-100">
					<button type="button" onclick={onClose} class="px-5 py-2 rounded-lg border border-slate-200 text-sm font-medium text-slate-600 hover:bg-slate-50">Cerrar</button>
				</div>
			{/if}
		</div>
	</div>
{/if}

<ConfirmModal
	open={!!adelantoAEliminar}
	title="Eliminar adelanto"
	message={adelantoAEliminar ? `¿Eliminar el Adelanto ${adelantoAEliminar.numero}? No tiene armadas registradas, así que no afecta montos, cobros ni transacciones. Los adelantos siguientes se renumeran.` : ''}
	confirmLabel="Eliminar"
	onConfirm={confirmarEliminarAdelanto}
	onClose={() => (adelantoAEliminar = null)}
/>

<DocumentPreviewModal open={visorAbierto} documents={documentosVenta} initialIndex={visorInicial} title={`Comprobantes - ${titulo}`} onClose={() => (visorAbierto = false)} />

{#snippet estadoDetraccion(d: PagoObra)}
	{#if d.estado === 'cobrado' || soloLectura}
		<span class={`inline-block px-2 py-0.5 rounded-md border text-[11px] font-semibold ${claseEstadoPago[d.estado]}`}>{etiquetaEstadoPago[d.estado]}</span>
	{:else}
		<button type="button" onclick={() => onCobrarPago(d.id_cobro)} class={`px-2 py-0.5 rounded-md border text-[11px] font-semibold ${claseEstadoPago[d.estado]}`} title="Registrar el depósito de la detracción">{etiquetaEstadoPago[d.estado]}</button>
	{/if}
{/snippet}

{#snippet formularioValorizacion()}
	{#if formVal}
		<div class="flex flex-wrap items-end gap-3">
			<label class="flex flex-col gap-1 text-[11px] font-semibold text-slate-600">Monto de la valorización (S/)
				<input type="number" min="0.01" step="0.01" bind:value={formVal.monto} class="w-40 px-2 py-1.5 border border-slate-200 rounded-lg text-sm" />
			</label>
			<label class="flex flex-col gap-1 text-[11px] font-semibold text-slate-600 flex-1 min-w-[180px]">Observaciones
				<input type="text" maxlength="200" bind:value={formVal.observaciones} class="px-2 py-1.5 border border-slate-200 rounded-lg text-sm" />
			</label>
			<button type="button" onclick={guardarValorizacion} disabled={guardando} class="px-3 py-1.5 rounded-lg bg-[#0f3b5e] text-white text-xs font-semibold disabled:opacity-50">Guardar</button>
			<button type="button" onclick={() => (formVal = null)} class="px-3 py-1.5 rounded-lg border border-slate-200 text-xs">Cancelar</button>
		</div>
	{/if}
{/snippet}

{#snippet formularioPago()}
	{#if formPago}
		<div class="mt-2 flex flex-wrap items-end gap-3 p-2 rounded-lg bg-white border border-orange-200">
			<label class="flex flex-col gap-1 text-[11px] font-semibold text-slate-600">Fecha estimada<input type="date" bind:value={formPago.fecha} class="px-2 py-1.5 border border-slate-200 rounded-lg text-sm" /></label>
			<label class="flex flex-col gap-1 text-[11px] font-semibold text-slate-600 flex-1 min-w-[180px]">Partidas ejecutadas<input type="text" maxlength="200" bind:value={formPago.partida} placeholder="Ej. Movimiento de tierras" class="px-2 py-1.5 border border-slate-200 rounded-lg text-sm" /></label>
			<label class="flex flex-col gap-1 text-[11px] font-semibold text-slate-600">Monto (S/)<input type="number" min="0.01" step="0.01" bind:value={formPago.monto} class="w-32 px-2 py-1.5 border border-slate-200 rounded-lg text-sm" /></label>
			<button type="button" onclick={guardarPago} disabled={guardando} class="px-3 py-1.5 rounded-lg bg-[#0f3b5e] text-white text-xs font-semibold disabled:opacity-50">Guardar</button>
			<button type="button" onclick={() => (formPago = null)} class="px-3 py-1.5 rounded-lg border border-slate-200 text-xs">Cancelar</button>
		</div>
	{/if}
{/snippet}
