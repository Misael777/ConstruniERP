<script lang="ts">
	import SelectConSaldo from '$lib/shared/components/SelectConSaldo.svelte';
	// "Control Mensual" — popup dentro de Control de IGV que replica la hoja Excel de referencia entregada
	// por el usuario: 12 meses (Ene-Dic) de un año, con estado REAL (datos ya registrados en el ERP) o
	// PROYECCIÓN (los meses restantes, con el PROMEDIO de los meses reales), arrastre de Saldo a Favor mes
	// a mes, Renta Mensual (pago a cuenta) y Tributos del mes. Los 3 parámetros (Tasa IGV, Tasa de pago a
	// cuenta, Meses reales cargados) son editables como en la hoja, y recalculan al instante en el
	// navegador — solo se vuelve a consultar Supabase si cambia el Año o la cantidad de meses reales (ver
	// igv.service.ts: getDatosCrudosPorMes trae los datos, calcularControlMensual es cálculo puro).
	import { supabase } from '$lib/supabaseClient';
	import { toast } from '$lib/stores/toast';
	import { X, RefreshCw, Calendar } from '@lucide/svelte';
	import { getDatosCrudosPorMes, calcularControlMensual, type DatosCrudosMes, type ControlMensualResultado } from '../services/igv.service';

	let { open = false, onClose }: { open?: boolean; onClose: () => void } = $props();

	function sol(v: number): string {
		const n = Number.isFinite(v) ? v : 0;
		return `S/ ${Math.abs(n).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
	}

	const ANIO_ACTUAL = new Date().getFullYear();
	const MES_ACTUAL = new Date().getMonth() + 1;
	let anio = $state(ANIO_ACTUAL);
	let mesesRealesCargados = $state(MES_ACTUAL);
	let tasaIgvPct = $state('18');
	let tasaPagoACuentaPct = $state('1');

	let crudos = $state<DatosCrudosMes[]>([]);
	let loading = $state(false);
	let loadError = $state('');

	const tasaIgv = $derived(Math.max(0, Number(tasaIgvPct) || 0) / 100);
	const tasaPagoACuenta = $derived(Math.max(0, Number(tasaPagoACuentaPct) || 0) / 100);
	const resultado = $derived<ControlMensualResultado>(calcularControlMensual(crudos, mesesRealesCargados, tasaIgv, tasaPagoACuenta));
	const maxIgvAPagar = $derived(Math.max(1, ...resultado.filas.map((f) => f.igvAPagar)));


	async function cargarDatos() {
		loading = true;
		loadError = '';
		try {
			crudos = await getDatosCrudosPorMes(supabase, anio, mesesRealesCargados);
		} catch (err: any) {
			loadError = err?.message ?? 'No se pudo cargar el Control Mensual';
			toast.error(loadError);
		} finally {
			loading = false;
		}
	}

	$effect(() => {
		if (!open) return;
		anio;
		mesesRealesCargados;
		cargarDatos();
	});

	function cambiarMesesReales(valor: string) {
		mesesRealesCargados = Math.min(12, Math.max(0, Number(valor) || 0));
	}
</script>

{#if open}
	<div class="fixed inset-0 bg-black/50 backdrop-blur-sm z-[120] flex items-center justify-center p-4">
		<div class="bg-white rounded-2xl shadow-2xl w-full max-w-[1400px] max-h-[92vh] flex flex-col overflow-hidden">
			<div class="flex items-center justify-between px-6 py-4 border-b border-slate-200 flex-shrink-0">
				<div>
					<h2 class="text-lg font-bold text-brand-marine flex items-center gap-2"><Calendar size={20} class="text-blue-600" /> Control Mensual — IGV y Renta</h2>
					<p class="text-xs text-slate-500 mt-0.5">Proyección anual con arrastre de Saldo a Favor. Los meses sin datos registrados se proyectan con el promedio de los meses reales.</p>
				</div>
				<button type="button" onclick={onClose} class="text-slate-400 hover:text-slate-600 w-9 h-9 flex items-center justify-center hover:bg-slate-100 rounded-lg" aria-label="Cerrar"><X size={20} /></button>
			</div>

			<!-- Parámetros -->
			<div class="flex flex-wrap items-end gap-4 px-6 py-4 border-b border-slate-100 bg-slate-50 flex-shrink-0">
				<div class="flex flex-col gap-1">
					<label for="cm-anio" class="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Año</label>
					<SelectConSaldo
						id="cm-anio"
						value={String(anio)}
						options={[...[ANIO_ACTUAL, ANIO_ACTUAL - 1, ANIO_ACTUAL - 2].map((a) => ({ value: String(a), label: `${a}` }))]}
						onchange={(v) => (anio = Number(v))}
					/>
				</div>
				<div class="flex flex-col gap-1">
					<label for="cm-tasa-igv" class="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Tasa IGV</label>
					<div class="flex items-center rounded-lg border border-slate-300 bg-white overflow-hidden">
						<input id="cm-tasa-igv" type="number" min="0" max="100" step="0.01" bind:value={tasaIgvPct} class="w-20 px-3 py-1.5 text-sm focus:outline-none" />
						<span class="pr-3 text-sm text-slate-400 font-semibold">%</span>
					</div>
				</div>
				<div class="flex flex-col gap-1">
					<label for="cm-tasa-renta" class="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Tasa pago a cuenta</label>
					<div class="flex items-center rounded-lg border border-slate-300 bg-white overflow-hidden">
						<input id="cm-tasa-renta" type="number" min="0" max="100" step="0.01" bind:value={tasaPagoACuentaPct} class="w-20 px-3 py-1.5 text-sm focus:outline-none" />
						<span class="pr-3 text-sm text-slate-400 font-semibold">%</span>
					</div>
				</div>
				<div class="flex flex-col gap-1">
					<label for="cm-meses" class="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Meses reales cargados</label>
					<input id="cm-meses" type="number" min="0" max="12" step="1" value={mesesRealesCargados} oninput={(e) => cambiarMesesReales((e.target as HTMLInputElement).value)} class="w-24 px-3 py-1.5 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200" />
				</div>
				<button type="button" onclick={cargarDatos} disabled={loading} class="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 text-slate-600 text-sm font-medium hover:bg-slate-50 disabled:opacity-50">
					<RefreshCw size={14} class={loading ? 'animate-spin' : ''} /> Actualizar
				</button>
			</div>

			{#if loadError}
				<div class="mx-6 mt-3 bg-red-100 text-red-700 px-4 py-2 rounded-lg text-sm">{loadError}</div>
			{/if}

			<!-- Sin padding-top: con position:sticky, el "top:0" del thead se mide desde el borde superior de
			     este contenedor con scroll — si tuviera padding arriba, el encabezado quedaría pegado más
			     abajo del borde real y las filas ya scrolleadas se asomarían por encima de él. -->
			<div class="flex-1 overflow-auto px-6 pb-6">
				{#if loading && crudos.length === 0}
					<div class="flex items-center justify-center py-24 text-slate-400"><RefreshCw size={28} class="animate-spin" /></div>
				{:else}
					<table class="w-full text-xs border-collapse min-w-[1300px] mt-4">
						<thead>
							<tr>
								<th class="sticky top-0 z-10 bg-[#3f5f8a] text-white px-3 py-2 text-left font-bold">MES</th>
								<th class="sticky top-0 z-10 bg-[#3f5f8a] text-white px-3 py-2 text-left font-bold">ESTADO</th>
								<th class="sticky top-0 z-10 bg-[#3f5f8a] text-white px-3 py-2 text-right font-bold">VENTAS (S/)</th>
								<th class="sticky top-0 z-10 bg-[#3f5f8a] text-white px-3 py-2 text-right font-bold">IGV VENTAS (S/)</th>
								<th class="sticky top-0 z-10 bg-[#3f5f8a] text-white px-3 py-2 text-right font-bold">COMPRAS (S/)</th>
								<th class="sticky top-0 z-10 bg-[#3f5f8a] text-white px-3 py-2 text-right font-bold">IGV COMPRAS (S/)</th>
								<th class="sticky top-0 z-10 bg-[#3f5f8a] text-white px-3 py-2 text-right font-bold">RESULTADO IGV MES (S/)</th>
								<th class="sticky top-0 z-10 bg-[#3f5f8a] text-white px-3 py-2 text-right font-bold">SALDO A FAVOR ANTERIOR (S/)</th>
								<th class="sticky top-0 z-10 bg-[#3f5f8a] text-white px-3 py-2 text-right font-bold">IGV A PAGAR (S/)</th>
								<th class="sticky top-0 z-10 bg-[#3f5f8a] text-white px-3 py-2 text-right font-bold">SALDO A FAVOR SIGUIENTE (S/)</th>
								<th class="sticky top-0 z-10 bg-[#3f5f8a] text-white px-3 py-2 text-right font-bold">RENTA MENSUAL (S/)</th>
								<th class="sticky top-0 z-10 bg-[#3f5f8a] text-white px-3 py-2 text-right font-bold">TRIBUTOS DEL MES (S/)</th>
							</tr>
						</thead>
						<tbody>
							{#each resultado.filas as f (f.mes)}
								<tr class="border-b border-slate-100 hover:bg-slate-50/70">
									<td class="px-3 py-2 font-semibold text-slate-700 whitespace-nowrap">{f.label}</td>
									<td class="px-3 py-2 whitespace-nowrap">
										{#if f.estado === 'REAL'}
											<span class="text-slate-500 font-medium">REAL</span>
										{:else}
											<span class="text-amber-700 font-bold">PROYECCIÓN</span>
										{/if}
									</td>
									<td class={`px-3 py-2 text-right whitespace-nowrap ${f.estado === 'REAL' ? 'text-slate-800' : 'text-blue-600 font-medium'}`}>{sol(f.ventas)}</td>
									<td class={`px-3 py-2 text-right whitespace-nowrap ${f.estado === 'REAL' ? 'text-slate-800' : 'text-blue-600 font-medium'}`}>{sol(f.igvVentas)}</td>
									<td class={`px-3 py-2 text-right whitespace-nowrap ${f.estado === 'REAL' ? 'text-slate-800' : 'text-blue-600 font-medium'}`}>{sol(f.compras)}</td>
									<td class={`px-3 py-2 text-right whitespace-nowrap ${f.estado === 'REAL' ? 'text-slate-800' : 'text-blue-600 font-medium'}`}>{sol(f.igvCompras)}</td>
									<td class={`px-3 py-2 text-right whitespace-nowrap font-semibold ${f.resultadoIgvMes < 0 ? 'text-red-600' : 'text-emerald-600'}`}>
										{f.resultadoIgvMes < 0 ? `(${sol(f.resultadoIgvMes)})` : sol(f.resultadoIgvMes)}
									</td>
									<td class="px-3 py-2 text-right whitespace-nowrap text-slate-500">{f.saldoAFavorAnterior > 0 ? sol(f.saldoAFavorAnterior) : '-'}</td>
									<td class="px-3 py-2 text-right whitespace-nowrap relative">
										{#if f.igvAPagar > 0}
											<div class="absolute inset-y-1 left-1 rounded bg-blue-100" style={`width:${Math.min(100, (f.igvAPagar / maxIgvAPagar) * 100)}%`}></div>
										{/if}
										<span class="relative font-semibold text-slate-800">{f.igvAPagar > 0 ? sol(f.igvAPagar) : '-'}</span>
									</td>
									<td class={`px-3 py-2 text-right whitespace-nowrap ${f.saldoAFavorSiguiente > 0 ? 'bg-emerald-50 font-semibold text-emerald-700' : 'text-slate-400'}`}>
										{f.saldoAFavorSiguiente > 0 ? sol(f.saldoAFavorSiguiente) : '-'}
									</td>
									<td class="px-3 py-2 text-right whitespace-nowrap text-slate-700">{sol(f.rentaMensual)}</td>
									<td class="px-3 py-2 text-right whitespace-nowrap">
										<div class="font-semibold text-slate-800">{sol(f.tributosDelMes)}</div>
										<div class={`text-[10px] font-medium ${f.etiquetaTributos === 'IGV por pagar' ? 'text-blue-600' : 'text-emerald-600'}`}>{f.etiquetaTributos}</div>
									</td>
								</tr>
							{/each}
						</tbody>
						<tfoot>
							<tr class="bg-emerald-50 font-bold text-slate-800 border-t-2 border-emerald-200">
								<td class="px-3 py-2.5" colspan="2">TOTAL / PROYECCIÓN ANUAL</td>
								<td class="px-3 py-2.5 text-right">{sol(resultado.totales.ventas)}</td>
								<td class="px-3 py-2.5 text-right">{sol(resultado.totales.igvVentas)}</td>
								<td class="px-3 py-2.5 text-right">{sol(resultado.totales.compras)}</td>
								<td class="px-3 py-2.5 text-right">{sol(resultado.totales.igvCompras)}</td>
								<td class="px-3 py-2.5 text-right">{sol(resultado.totales.resultadoIgvMes)}</td>
								<td class="px-3 py-2.5"></td>
								<td class="px-3 py-2.5 text-right">{sol(resultado.totales.igvAPagar)}</td>
								<td class="px-3 py-2.5 text-right">{resultado.totales.saldoAFavorFinal > 0 ? sol(resultado.totales.saldoAFavorFinal) : '-'}</td>
								<td class="px-3 py-2.5 text-right">{sol(resultado.totales.rentaMensual)}</td>
								<td class="px-3 py-2.5 text-right">{sol(resultado.totales.tributosDelMes)}</td>
							</tr>
						</tfoot>
					</table>
				{/if}
			</div>
		</div>
	</div>
{/if}
