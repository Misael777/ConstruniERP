<script lang="ts" module>
	export interface CampoResumen {
		label: string;
		valor: string;
		/** true = ocupa todo el ancho (ej. Observaciones). */
		completo?: boolean;
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
	import { X, Lock } from '@lucide/svelte';
	import { formatCurrency } from '$lib/shared/fieldConfig';
	// Adelanto / 1er abono / ... — mismo nombre que la lista de Transacciones (ver acuerdoDePago.ts).
	import { acuerdoDePago } from '$lib/shared/acuerdoDePago';

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
		mostrarHito = false
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
	} = $props();

	const cuotasOrdenadas = $derived([...cuotas].sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : a.id - b.id)));


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
				<h2 class="text-lg font-semibold text-[#0f3b5e]">{titulo}</h2>
				<button type="button" onclick={onClose} class="p-1 hover:bg-slate-100 rounded-full text-slate-500" aria-label="Cerrar">
					<X size={20} />
				</button>
			</div>

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
									{#each cuotasOrdenadas as cuota, i (cuota.id)}
										<tr>
											<td class="px-3 py-2 text-slate-700">{acuerdoDePago(i, cuotasOrdenadas.length)}</td>
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

			<div class="sticky bottom-0 flex justify-end bg-white px-6 py-4 border-t border-slate-200">
				<button type="button" onclick={onClose} class="px-4 py-2 text-sm font-medium rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50">Cerrar</button>
			</div>
		</div>
	</div>
{/if}
