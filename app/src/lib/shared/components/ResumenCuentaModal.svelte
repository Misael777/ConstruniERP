<script lang="ts" module>
	export interface CampoResumen {
		label: string;
		valor: string;
		/** true = ocupa todo el ancho (ej. Observaciones). */
		completo?: boolean;
		/** Ticket #106: dato que se oculta con el ojo del título (solo con estiloVenta). */
		sensible?: boolean;
	}

	export interface CuotaResumen {
		id: number;
		monto: number;
		fecha: string; // yyyy-mm-dd
		estado: 'pagado' | 'pendiente' | 'vencido' | 'anulado';
		/** true = el estado se puede tocar para abrir "Editar Cuota Programada" (ver onEditarCuota). */
		editable: boolean;
		/** "Hito de cobro" de la cuota (cobros.referencia) — se muestra si mostrarHito. */
		concepto?: string | null;
		/** Venta con detracción: id de la cuota de la que sale esta detracción (no cuenta como una cuota más). */
		detraccionDe?: number | null;
		/** Transacción con la que se registró la cuota (cobros.id_transaccion): se muestra bajo "Cobrado" para ubicarla. */
		idTransaccion?: number | null;
		/** Comprobante de la transacción de la cuota (ticket #106, columna "Comprobante" del Resumen de venta). */
		comprobanteUrl?: string | null;
	}
</script>

<script lang="ts">
	/**
	 * "Resumen de cobro" / "Resumen de pago" — a pedido del usuario (con imagen de referencia), se abre con
	 * el ojito de cada fila en Cuentas por Cobrar y Cuentas por Pagar. Solo lectura: arriba los datos de la
	 * cuenta, abajo el cronograma de cuotas (Acuerdo de pago, Monto, Porcentaje, Fecha, Estado) con la fila
	 * de total al 100%. Tocar el estado de una cuota pendiente/vencida llama a `onEditarCuota`, que en cada
	 * página abre la ventana "Editar Cuota Programada" ya existente (CobroModal/PagoModal) — ahí se cambia
	 * el Estado a Cobrado/Pagado con su transacción. Va en z-40 para que esa ventana (z-50) quede encima.
	 * Solo HTML/CSS estándar: igual en navegador, Tauri Windows y Tauri Android.
	 */
	import { X, Lock, Eye, EyeOff, FileText, Coins } from '@lucide/svelte';
	import DocumentPreviewModal from '$lib/shared/components/DocumentPreviewModal.svelte';
	import { formatCurrency } from '$lib/shared/fieldConfig';
	// Adelanto / 1er abono / ... — mismo nombre que la lista de Transacciones (ver acuerdoDePago.ts).
	import { acuerdoDePago, contarArmadasAdelanto } from '$lib/shared/acuerdoDePago';
	import { nombreDetraccion } from '$lib/shared/detraccion';

	let {
		open = false,
		titulo,
		tituloCronograma,
		etiquetaTotal,
		textoPagado = 'Pagado',
		campos,
		cuotas,
		montoTotal,
		onClose,
		onEditarCuota,
		soloLectura = false,
		etiquetaPlan = 'Acuerdo de pago',
		mostrarHito = false,
		esObra = false,
		estiloVenta = false
	}: {
		open: boolean;
		titulo: string;
		tituloCronograma: string;
		/** Etiqueta de la fila de total (ej. "Valor venta"). */
		etiquetaTotal: string;
		/** Texto del estado ya pagado/cobrado de una cuota. */
		textoPagado?: string;
		campos: CampoResumen[];
		cuotas: CuotaResumen[];
		montoTotal: number;
		onClose: () => void;
		onEditarCuota: (id: number) => void;
		/** true = solo consulta (ej. Resumen de venta): sin el texto de ayuda para registrar cobros/pagos. */
		soloLectura?: boolean;
		/** Título de la 1.ª columna del cronograma ("Plan de pagos" en Cuentas por Cobrar y Ventas). */
		etiquetaPlan?: string;
		/** Agrega la columna "Hito de cobro" (concepto de cada cuota). */
		mostrarHito?: boolean;
		/** Ticket #95: cuenta de una venta de Obra — las cuotas se llaman "Valorización 1, 2...". */
		esObra?: boolean;
		/** Ticket #106 (arte del cliente): diseño del Resumen de venta — un solo ojo junto al título que oculta
		 * o muestra los datos sensibles, tarjetas de avance, columnas Fecha programada/Estado/Comprobante y la
		 * fila TOTAL CONTRATADO. Cuentas por Cobrar/Pagar siguen con el diseño de siempre. */
		estiloVenta?: boolean;
	} = $props();

	const cuotasOrdenadas = $derived([...cuotas].sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : a.id - b.id)));
	// Ticket #102: si el adelanto se pagó en varias armadas, todas se llaman "Adelanto (…armada)" y los abonos o
	// valorizaciones se numeran desde la cuota siguiente.
	// Detracción: sus cuotas no corren la numeración; se llaman como su cuota de origen ("Detracción – 1er abono").
	const principales = $derived(cuotasOrdenadas.filter((c) => !c.detraccionDe));
	const armadasAdelanto = $derived(contarArmadasAdelanto(principales.map((c) => c.concepto)));
	const nombreDe = $derived.by(() => {
		const nombres = new Map<number, string>();
		principales.forEach((c, i) => nombres.set(c.id, acuerdoDePago(i, principales.length, esObra, armadasAdelanto)));
		for (const c of cuotasOrdenadas) if (c.detraccionDe) nombres.set(c.id, nombreDetraccion(nombres.get(c.detraccionDe)));
		return nombres;
	});
	// Orden de las filas: cada detracción va justo debajo de su cuota de origen (a pedido del usuario); una
	// detracción sin su origen en la lista queda al final, por fecha.
	const filas = $derived.by(() => {
		const ids = new Set(principales.map((c) => c.id));
		const out: CuotaResumen[] = [];
		for (const c of principales) out.push(c, ...cuotasOrdenadas.filter((d) => d.detraccionDe === c.id));
		return [...out, ...cuotasOrdenadas.filter((d) => d.detraccionDe && !ids.has(d.detraccionDe))];
	});


	// Ticket #106: arranca oculto; el ojo del título muestra/oculta todo a la vez.
	let visible = $state(false);
	$effect(() => {
		if (!open) visible = false;
	});
	const OCULTO = '••••••';
	const kpi = $derived.by(() => {
		const vigentes = cuotas.filter((c) => c.estado !== 'anulado');
		const programado = vigentes.reduce((s, c) => s + c.monto, 0);
		const cobrado = vigentes.filter((c) => c.estado === 'pagado').reduce((s, c) => s + c.monto, 0);
		const proxima = filas.find((c) => c.estado === 'pendiente' || c.estado === 'vencido') ?? null;
		const pct = (n: number) => (montoTotal > 0 ? Math.min((n / montoTotal) * 100, 100) : 0);
		return {
			programado, cobrado, proxima,
			pctProgramado: pct(programado), pctCobrado: pct(cobrado),
			porProgramar: Math.max(montoTotal - programado, 0), porCobrar: Math.max(montoTotal - cobrado, 0)
		};
	});
	const documentos = $derived(
		filas.filter((c) => c.comprobanteUrl).map((c) => ({ url: c.comprobanteUrl as string, label: nombreDe.get(c.id) ?? 'Comprobante' }))
	);
	let visorAbierto = $state(false);
	let visorInicial = $state(0);
	function verComprobante(url: string) {
		visorInicial = Math.max(0, documentos.findIndex((d) => d.url === url));
		visorAbierto = true;
	}

	function porcentaje(monto: number): string {
		if (!montoTotal) return '—';
		return `${Number(((monto / montoTotal) * 100).toFixed(2))}%`;
	}

	function formatDate(value: string | null | undefined): string {
		if (!value) return '—';
		const [y, m, d] = value.slice(0, 10).split('-');
		return y && m && d ? `${d}/${m}/${y}` : '—';
	}

	const ESTADO_CLASE: Record<CuotaResumen['estado'], string> = {
		pagado: 'bg-emerald-100 text-emerald-700',
		pendiente: 'bg-amber-100 text-amber-700',
		vencido: 'bg-red-100 text-red-700',
		anulado: 'bg-slate-200 text-slate-600'
	};
	function textoEstado(estado: CuotaResumen['estado']): string {
		if (estado === 'pagado') return textoPagado;
		if (estado === 'pendiente') return 'Pendiente';
		if (estado === 'vencido') return 'Vencido';
		return 'Anulado';
	}
</script>

{#if open}
	<div class="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-40 flex items-center justify-center p-4">
		<div class="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto">
			<div class="sticky top-0 flex items-center justify-between bg-white px-6 py-4 border-b border-slate-200 z-10">
				<div class="flex items-center gap-2 min-w-0">
					<h2 class="text-lg font-semibold text-[#0f3b5e] truncate">{titulo}</h2>
					{#if estiloVenta}
						<button type="button" onclick={() => (visible = !visible)} class="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 shrink-0" title={visible ? 'Ocultar datos' : 'Mostrar datos'} aria-label={visible ? 'Ocultar datos' : 'Mostrar datos'}>
							{#if visible}<Eye size={20} />{:else}<EyeOff size={20} />{/if}
						</button>
					{/if}
				</div>
				<button type="button" onclick={onClose} class="p-1 hover:bg-slate-100 rounded-full text-slate-500" aria-label="Cerrar">
					<X size={20} />
				</button>
			</div>

			{#if estiloVenta}
				{@render vistaVenta()}
			{:else}
			<div class="p-6 space-y-6">
				<div class="grid grid-cols-1 sm:grid-cols-3 gap-x-4 gap-y-3">
					{#each campos as campo (campo.label)}
						<div class={campo.completo ? 'sm:col-span-3' : ''}>
							<span class="block text-xs font-semibold text-[#0f3b5e] mb-1">{campo.label}</span>
							<div class="w-full min-h-[38px] rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 break-words">{campo.valor || '—'}</div>
						</div>
					{/each}
				</div>

				<div>
					<h3 class="text-base font-semibold text-[#0f3b5e] mb-3">{tituloCronograma}</h3>
					{#if cuotasOrdenadas.length === 0}
						<p class="text-sm text-slate-400 text-center py-6 rounded-lg border border-slate-200">Sin cuotas registradas todavía.</p>
					{:else}
						<!-- Ticket #77: en celular la tabla se desliza de lado y cada columna conserva su ancho (sin partir el texto). -->
						<div class="overflow-x-auto overscroll-x-contain rounded-lg border border-slate-200">
							<table class={`w-full text-sm whitespace-nowrap ${mostrarHito ? 'min-w-[700px]' : 'min-w-[520px]'}`}>
								<thead>
									<tr class="bg-slate-50 text-xs font-semibold text-slate-500 border-b border-slate-200">
										<th class="text-left px-3 py-2">{etiquetaPlan}</th>
										{#if mostrarHito}<th class="text-left px-3 py-2 w-[200px] min-w-[200px]">Hito de cobro</th>{/if}
										<th class="text-right px-3 py-2">Monto</th>
										<th class="text-right px-3 py-2">Porcentaje</th>
										<th class="text-center px-3 py-2">Fecha</th>
										<th class="text-center px-3 py-2">Estado</th>
									</tr>
								</thead>
								<tbody class="divide-y divide-slate-100">
									{#each filas as cuota, i (cuota.id)}
										<tr>
											<td class="px-3 py-2 text-slate-700">{nombreDe.get(cuota.id) ?? ''}</td>
											{#if mostrarHito}<td class="px-3 py-2 text-slate-600 w-[200px] min-w-[200px] max-w-[200px] whitespace-normal break-words">{cuota.concepto || '—'}</td>{/if}
											<td class="px-3 py-2 text-right text-slate-700">{formatCurrency(cuota.monto)}</td>
											<td class="px-3 py-2 text-right text-slate-500">{porcentaje(cuota.monto)}</td>
											<td class="px-3 py-2 text-center text-slate-500">{formatDate(cuota.fecha)}</td>
											<td class="px-3 py-2 text-center">
												{#if cuota.editable}
													<button
														type="button"
														onclick={() => onEditarCuota(cuota.id)}
														class={`px-2.5 py-0.5 rounded-full text-[11px] font-medium underline decoration-dotted underline-offset-2 hover:opacity-80 ${ESTADO_CLASE[cuota.estado]}`}
														title="Editar esta cuota"
													>
														{textoEstado(cuota.estado)}
													</button>
												{:else}
													<span class={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-medium ${ESTADO_CLASE[cuota.estado]}`} title={cuota.estado === 'pendiente' || cuota.estado === 'vencido' ? 'Se habilita cuando se registre la cuota anterior' : undefined}>{#if cuota.estado === 'pendiente' || cuota.estado === 'vencido'}<Lock size={10} />{/if}{textoEstado(cuota.estado)}</span>
												{/if}
												{#if cuota.estado === 'pagado' && cuota.idTransaccion}<span class="block mt-0.5 text-[10px] text-slate-400">Transacción #{cuota.idTransaccion}</span>{/if}
											</td>
										</tr>
									{/each}
								</tbody>
								<tfoot>
									<tr class="bg-emerald-50 font-semibold text-emerald-800 border-t border-emerald-100">
										<td class="px-3 py-2">{etiquetaTotal}</td>
										{#if mostrarHito}<td class="px-3 py-2"></td>{/if}
										<td class="px-3 py-2 text-right">{formatCurrency(montoTotal)}</td>
										<td class="px-3 py-2 text-right">100%</td>
										<td class="px-3 py-2 text-center">—</td>
										<td class="px-3 py-2 text-center">—</td>
									</tr>
								</tfoot>
							</table>
						</div>
{#if !soloLectura}<p class="mt-2 text-xs text-slate-400">Solo la cuota pendiente más próxima está habilitada: toca su estado para editarla o registrar su {textoPagado === 'Cobrado' ? 'cobro' : 'pago'}. Las siguientes se habilitan en orden.</p>{/if}
					{/if}
				</div>
			</div>
			{/if}

			<div class="sticky bottom-0 flex justify-end bg-white px-6 py-4 border-t border-slate-200">
				<button type="button" onclick={onClose} class={`px-4 py-2 text-sm font-medium rounded-lg border ${estiloVenta ? 'border-orange-400 text-orange-600 hover:bg-orange-50' : 'border-slate-300 text-slate-600 hover:bg-slate-50'}`}>Cerrar</button>
			</div>
		</div>
	</div>
{/if}

{#snippet vistaVenta()}
	<div class="p-4 sm:p-6 space-y-4">
		<div class="grid grid-cols-1 sm:grid-cols-3 gap-x-4 gap-y-2">
			{#each campos.filter((c) => !c.completo) as campo (campo.label)}
				<div>
					<span class="block text-xs text-slate-500 mb-0.5">{campo.label}</span>
					<div class="w-full min-h-[38px] rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 break-words">
						{#if campo.sensible && !visible}<span class="tracking-widest text-slate-500">{OCULTO}</span>{:else}{campo.valor || '—'}{/if}
					</div>
				</div>
			{/each}
		</div>

		<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
			<div class="rounded-xl border border-slate-200 p-3 flex items-center gap-3">
				<div class="w-11 h-11 rounded-full bg-violet-100 text-violet-600 flex items-center justify-center shrink-0"><FileText size={20} /></div>
				<div class="min-w-0"><p class="text-xs text-slate-500">Monto contratado</p><p class="text-[clamp(1rem,1.6vw,1.25rem)] font-bold text-[#0f3b5e] whitespace-nowrap tabular-nums">{formatCurrency(montoTotal)}</p></div>
			</div>
			<div class="rounded-xl border border-slate-200 p-3 flex items-center gap-3">
				<div class="w-11 h-11 rounded-full bg-orange-100 text-orange-600 flex items-center justify-center shrink-0"><Coins size={20} /></div>
				<div class="min-w-0"><p class="text-xs text-slate-500">Próximo a cobrar</p><p class="text-[clamp(1rem,1.6vw,1.25rem)] font-bold text-[#0f3b5e] whitespace-nowrap tabular-nums">{#if !visible}<span class="tracking-widest">{OCULTO}</span>{:else}{kpi.proxima ? formatCurrency(kpi.proxima.monto) : '—'}{/if}</p></div>
			</div>
			{#each [{ t: 'Avance de cobranza programada', p: kpi.pctProgramado, a: 'Monto programado', av: kpi.programado, b: 'Saldo por programar', bv: kpi.porProgramar, barra: 'bg-blue-600', punto: 'bg-blue-600' }, { t: 'Avance de cobranza efectiva', p: kpi.pctCobrado, a: 'Total cobrado', av: kpi.cobrado, b: 'Saldo por cobrar', bv: kpi.porCobrar, barra: 'bg-emerald-500', punto: 'bg-emerald-500' }] as k (k.t)}
				<div class="rounded-xl border border-slate-200 p-3">
					<p class="flex items-center gap-1.5 text-xs font-semibold text-[#0f3b5e]"><span class={`w-2 h-2 rounded-full ${k.punto}`}></span>{k.t}</p>
					<div class="mt-1.5 flex items-center gap-2">
						<div class="h-2.5 flex-1 rounded-full bg-slate-200 overflow-hidden"><div class={`h-full ${k.barra}`} style={`width:${visible ? k.p : 0}%`}></div></div>
						<span class="text-xs font-bold text-[#0f3b5e] whitespace-nowrap">{visible ? `${k.p.toFixed(2)}%` : '••••'}</span>
					</div>
					<div class="mt-1 grid grid-cols-2 gap-2 text-[11px] text-slate-500">
						<div>{k.a}<p class="text-sm font-bold text-[#0f3b5e] whitespace-nowrap">{visible ? formatCurrency(k.av) : OCULTO}</p></div>
						<div>{k.b}<p class="text-sm font-bold text-[#0f3b5e] whitespace-nowrap">{visible ? formatCurrency(k.bv) : OCULTO}</p></div>
					</div>
				</div>
			{/each}
		</div>

		<div class="rounded-xl border border-slate-200 overflow-hidden">
			<h3 class="px-4 py-2 text-base font-semibold text-[#0f3b5e] bg-slate-50 border-b border-slate-200">{tituloCronograma}</h3>
			{#if cuotasOrdenadas.length === 0}
				<p class="text-sm text-slate-400 text-center py-6">Sin cuotas registradas todavía.</p>
			{:else}
				<div class="overflow-x-auto overscroll-x-contain">
					<table class="w-full text-sm whitespace-nowrap min-w-[820px]">
						<thead>
							<tr class="text-xs font-semibold text-slate-500 border-b border-slate-200">
								<th class="text-left px-3 py-2">{etiquetaPlan}</th>
								<th class="text-left px-3 py-2 w-[240px] min-w-[240px]">Hito de cobro</th>
								<th class="text-right px-3 py-2">Monto</th>
								<th class="text-right px-3 py-2">Porcentaje</th>
								<th class="text-center px-3 py-2">Fecha programada</th>
								<th class="text-center px-3 py-2">Estado</th>
								<th class="text-center px-3 py-2">Comprobante</th>
							</tr>
						</thead>
						<tbody class="divide-y divide-slate-100">
							{#each filas as cuota (cuota.id)}
								<tr>
									<td class="px-3 py-2 text-slate-700">{nombreDe.get(cuota.id) ?? ''}</td>
									<td class="px-3 py-2 text-slate-600 w-[240px] min-w-[240px] max-w-[240px] whitespace-normal break-words uppercase text-xs">{cuota.concepto || '—'}</td>
									<td class="px-3 py-2 text-right text-slate-700">{formatCurrency(cuota.monto)}</td>
									<td class="px-3 py-2 text-right text-slate-500">{porcentaje(cuota.monto)}</td>
									{#if visible}
										<td class="px-3 py-2 text-center text-slate-500">{formatDate(cuota.fecha)}</td>
										<td class="px-3 py-2 text-center">
											<span class={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-medium ${ESTADO_CLASE[cuota.estado]}`}>{textoEstado(cuota.estado)}</span>
											{#if cuota.estado === 'pagado' && cuota.idTransaccion}<span class="block mt-0.5 text-[10px] text-slate-400">Transacción #{cuota.idTransaccion}</span>{/if}
										</td>
										<td class="px-3 py-2 text-center">
											{#if cuota.comprobanteUrl}
												<button type="button" onclick={() => verComprobante(cuota.comprobanteUrl as string)} class="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:underline"><Eye size={13} /> Ver</button>
											{:else}<span class="text-slate-300">—</span>{/if}
										</td>
									{:else}
										<td class="px-3 py-2 text-center text-slate-500 tracking-widest">••••</td>
										<td class="px-3 py-2 text-center text-slate-500 tracking-widest">••••</td>
										<td class="px-3 py-2 text-center text-slate-500 tracking-widest">••••</td>
									{/if}
								</tr>
							{/each}
						</tbody>
						<tfoot>
							<tr class="bg-orange-50 font-bold text-orange-600 border-t border-orange-100">
								<td class="px-3 py-2.5" colspan="2">{etiquetaTotal}</td>
								<td class="px-3 py-2.5 text-right">{formatCurrency(montoTotal)}</td>
								<td class="px-3 py-2.5 text-right">100%</td>
								<td class="px-3 py-2.5 text-center font-normal">—</td>
								<td class="px-3 py-2.5 text-center font-normal">—</td>
								<td class="px-3 py-2.5 text-center font-normal">—</td>
							</tr>
						</tfoot>
					</table>
				</div>
			{/if}
		</div>

		{#each campos.filter((c) => c.completo) as campo (campo.label)}
			<div>
				<span class="block text-xs text-slate-500 mb-0.5">{campo.label}</span>
				<div class="w-full min-h-[38px] rounded-lg border border-slate-200 px-3 py-2 text-sm text-blue-800 break-words">{campo.sensible && !visible ? OCULTO : campo.valor || '—'}</div>
			</div>
		{/each}
	</div>
{/snippet}

<DocumentPreviewModal open={visorAbierto} url={documentos[visorInicial]?.url ?? null} title="Comprobante" documents={documentos} initialIndex={visorInicial} onClose={() => (visorAbierto = false)} />
