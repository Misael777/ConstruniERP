<script lang="ts" module>
	/** Ticket #102: una "armada" es cada depósito con el que el cliente paga el adelanto. Cada una se registra como
	 * su propia transacción de ingreso (con su comprobante) y su propia cuota cobrada en la Cuenta por Cobrar. */
	export interface ArmadaAdelanto {
		id: number;
		monto: string;
		fecha: string;
		file: File | null;
		observacion: string;
	}

	let siguienteId = 1;
	export function nuevaArmada(fecha: string): ArmadaAdelanto {
		return { id: siguienteId++, monto: '', fecha, file: null, observacion: '' };
	}

	/** Las filas que el usuario empezó a llenar (una fila totalmente vacía no cuenta). */
	export function armadasUsadas(armadas: ArmadaAdelanto[]): ArmadaAdelanto[] {
		return armadas.filter((a) => !!a.file || Number(a.monto) > 0 || a.observacion.trim() !== '');
	}

	/** Qué le falta a cada armada empezada, en texto (vacío = todas completas). */
	export function faltantesArmadas(armadas: ArmadaAdelanto[]): string[] {
		const usadas = armadasUsadas(armadas);
		if (usadas.length === 0) return ['registra al menos una armada con su monto, fecha de pago y comprobante'];
		return usadas.flatMap((a) => {
			const faltan = [!(Number(a.monto) > 0) && 'monto', !a.fecha && 'fecha de pago', !a.file && 'comprobante'].filter(Boolean);
			return faltan.length ? [`${armadas.indexOf(a) + 1}.ª armada: falta ${faltan.join(', ')}`] : [];
		});
	}
</script>

<script lang="ts">
	import { formatCurrency } from '$lib/shared/fieldConfig';
	import { ordinalArmada } from '$lib/shared/acuerdoDePago';

	let {
		armadas = $bindable(),
		valorVenta,
		fechaPorDefecto,
		etiquetaValor = 'Valor venta total',
		marcarFaltantes = false
	}: {
		armadas: ArmadaAdelanto[];
		/** Base del "% sobre el valor de venta" y del saldo (Valor venta al crear; Monto final al cerrar). */
		valorVenta: number;
		/** Fecha de una armada nueva (la Fecha de venta). */
		fechaPorDefecto: string;
		etiquetaValor?: string;
		/** true = resalta en rojo lo que falta en cada armada empezada (al intentar cerrar o guardar). */
		marcarFaltantes?: boolean;
	} = $props();

	const redondear2 = (n: number) => Math.round(n * 100) / 100;
	const total = $derived(redondear2(armadas.reduce((s, a) => s + (Number(a.monto) > 0 ? Number(a.monto) : 0), 0)));
	const saldo = $derived(redondear2(Math.max(valorVenta - total, 0)));
	function porcentaje(monto: number): string {
		return valorVenta > 0 ? `${(Math.round((monto / valorVenta) * 10000) / 100).toFixed(2)} %` : '—';
	}
	const excede = $derived(valorVenta > 0 && total > valorVenta + 0.005);

	function agregar() {
		armadas = [...armadas, nuevaArmada(armadas[armadas.length - 1]?.fecha || fechaPorDefecto)];
	}
	function quitar(id: number) {
		const restantes = armadas.filter((a) => a.id !== id);
		armadas = restantes.length ? restantes : [nuevaArmada(fechaPorDefecto)];
	}
	function elegirArchivo(armada: ArmadaAdelanto, event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (file) armada.file = file;
	}
	const usada = (a: ArmadaAdelanto) => !!a.file || Number(a.monto) > 0 || a.observacion.trim() !== '';
	const inputClase = 'w-full px-2 py-1.5 bg-slate-50 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all text-slate-700';
	const borde = (mal: boolean) => (mal ? 'border-rose-400 bg-rose-50' : 'border-slate-200');
</script>

<div class="space-y-3">
	<div class="flex items-start gap-2.5 p-3 rounded-xl bg-blue-50 border border-blue-100 text-xs text-slate-700">
		<i class="fas fa-info-circle text-blue-600 text-base mt-px"></i>
		<span>Puedes registrar el adelanto en una o varias armadas (depósitos), cada una con su monto, fecha de pago y comprobante.</span>
	</div>

	<div class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
		<h4 class="text-sm font-bold text-slate-800 flex items-center gap-2">
			<div class="w-1.5 h-4 bg-amber-500 rounded-full"></div>
			Adelanto
		</h4>
		<p class="text-xs text-slate-600">
			Monto total del adelanto: <span class="font-bold text-[#0f3b5e]">{formatCurrency(total)}</span>
			<span class="mx-1.5 text-slate-300">|</span>
			<span class="font-bold text-[#0f3b5e]">{porcentaje(total)}</span> sobre el valor de venta
		</p>
	</div>

	<!-- Celular: una tarjeta por armada (la tabla no entra a lo ancho). -->
	<div class="md:hidden space-y-2">
		{#each armadas as armada, i (armada.id)}
			{@const marcar = marcarFaltantes && usada(armada)}
			<div class="rounded-xl border border-slate-200 p-3 space-y-2">
				<div class="flex items-center justify-between gap-2">
					<p class="text-sm font-semibold text-slate-700">{i + 1}. Adelanto – {ordinalArmada(i)} armada</p>
					<button type="button" onclick={() => quitar(armada.id)} class="p-1.5 rounded text-rose-500 hover:bg-rose-50" title="Quitar armada" aria-label="Quitar armada"><i class="fas fa-trash-alt"></i></button>
				</div>
				<div class="grid grid-cols-2 gap-2">
					<label class="flex flex-col gap-1 text-[11px] font-semibold text-slate-500">
						Monto (S/)
						<input type="number" min="0.01" step="0.01" inputmode="decimal" bind:value={armada.monto} placeholder="0.00" class={`${inputClase} ${borde(marcar && !(Number(armada.monto) > 0))}`} />
					</label>
					<label class="flex flex-col gap-1 text-[11px] font-semibold text-slate-500">
						Fecha de pago
						<input type="date" bind:value={armada.fecha} class={`${inputClase} ${borde(marcar && !armada.fecha)}`} />
					</label>
				</div>
				<p class="text-xs text-slate-500">{porcentaje(Number(armada.monto) || 0)} sobre el valor de venta</p>
				<label class={`cursor-pointer flex items-center gap-1.5 px-2 py-2 border rounded-lg text-xs ${borde(marcar && !armada.file)}`}>
					<input type="file" accept="image/*,application/pdf" class="hidden" onchange={(e) => elegirArchivo(armada, e)} />
					{#if armada.file}
						<i class={`fas ${armada.file.type === 'application/pdf' ? 'fa-file-pdf text-rose-500' : 'fa-file-image text-blue-500'}`}></i>
						<span class="truncate text-slate-700">{armada.file.name}</span>
					{:else}
						<i class="fas fa-paperclip text-slate-400"></i>
						<span class="text-slate-500">Adjuntar comprobante</span>
					{/if}
				</label>
				<input type="text" bind:value={armada.observacion} maxlength="80" placeholder="Observaciones (opcional)" aria-label={`Observaciones de la ${ordinalArmada(i)} armada`} class={`${inputClase} border-slate-200`} />
			</div>
		{/each}
	</div>

	<div class="hidden md:block overflow-x-auto rounded-xl border border-slate-200">
		<table class="w-full text-sm border-collapse min-w-[860px]">
			<thead>
				<tr class="bg-slate-50 text-[11px] font-semibold text-slate-500 border-b border-slate-200">
					<th class="text-center py-2 px-2 w-10">N.°</th>
					<th class="text-left py-2 px-2">Detalle / Concepto</th>
					<th class="text-left py-2 px-2 w-32">Monto (S/)</th>
					<th class="text-left py-2 px-2 w-40">Fecha de pago</th>
					<th class="text-right py-2 px-2 w-24">% s/ valor</th>
					<th class="text-left py-2 px-2 w-44">Comprobante</th>
					<th class="text-left py-2 px-2">Observaciones</th>
					<th class="text-center py-2 px-2 w-14">Acciones</th>
				</tr>
			</thead>
			<tbody>
				{#each armadas as armada, i (armada.id)}
					{@const marcar = marcarFaltantes && usada(armada)}
					<tr class="border-b border-slate-100 last:border-b-0">
						<td class="py-2 px-2 text-center text-slate-500">{i + 1}</td>
						<td class="py-2 px-2 text-slate-700 whitespace-nowrap">Adelanto – {ordinalArmada(i)} armada</td>
						<td class="py-2 px-2">
							<input type="number" min="0.01" step="0.01" inputmode="decimal" bind:value={armada.monto} placeholder="0.00" aria-label={`Monto de la ${ordinalArmada(i)} armada`} class={`${inputClase} ${borde(marcar && !(Number(armada.monto) > 0))}`} />
						</td>
						<td class="py-2 px-2">
							<input type="date" bind:value={armada.fecha} aria-label={`Fecha de pago de la ${ordinalArmada(i)} armada`} class={`${inputClase} ${borde(marcar && !armada.fecha)}`} />
						</td>
						<td class="py-2 px-2 text-right text-slate-600 whitespace-nowrap">{porcentaje(Number(armada.monto) || 0)}</td>
						<td class="py-2 px-2">
							<label class={`cursor-pointer flex items-center gap-1.5 px-2 py-1.5 border rounded-lg text-xs hover:bg-slate-50 transition-colors ${borde(marcar && !armada.file)}`} title={armada.file ? `${armada.file.name} — clic para reemplazar` : 'Adjuntar comprobante'}>
								<input type="file" accept="image/*,application/pdf" class="hidden" onchange={(e) => elegirArchivo(armada, e)} />
								{#if armada.file}
									<i class={`fas ${armada.file.type === 'application/pdf' ? 'fa-file-pdf text-rose-500' : 'fa-file-image text-blue-500'}`}></i>
									<span class="truncate max-w-[130px] text-slate-700">{armada.file.name}</span>
								{:else}
									<i class="fas fa-paperclip text-slate-400"></i>
									<span class="text-slate-500">Adjuntar</span>
								{/if}
							</label>
						</td>
						<td class="py-2 px-2">
							<input type="text" bind:value={armada.observacion} maxlength="80" placeholder="Ej. Primer pago del adelanto" aria-label={`Observaciones de la ${ordinalArmada(i)} armada`} class={`${inputClase} border-slate-200 min-w-[170px]`} />
						</td>
						<td class="py-2 px-2 text-center">
							<button type="button" onclick={() => quitar(armada.id)} class="p-1.5 rounded text-rose-500 hover:bg-rose-50 transition-colors" title="Quitar armada" aria-label="Quitar armada">
								<i class="fas fa-trash-alt"></i>
							</button>
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>

	<div class="flex flex-wrap items-center justify-between gap-3">
		<button type="button" onclick={agregar} class="px-3 py-2 border border-blue-200 text-blue-600 rounded-lg text-xs font-semibold hover:bg-blue-50 flex items-center gap-1.5 transition-colors">
			<i class="fas fa-plus"></i> Agregar armada
		</button>
		<div class="flex items-center gap-6 px-4 py-2 rounded-lg bg-blue-50 text-sm">
			<span class="font-semibold text-slate-700">Total adelanto:</span>
			<span class="font-bold text-[#0f3b5e]">{formatCurrency(total)}</span>
			<span class="font-semibold text-blue-600">{porcentaje(total)}</span>
		</div>
	</div>
	{#if excede}
		<p class="text-xs text-rose-500">El adelanto no puede ser mayor que el {etiquetaValor.toLowerCase()}.</p>
	{/if}

	<div class="grid grid-cols-1 sm:grid-cols-3 gap-px rounded-xl overflow-hidden bg-slate-200 border border-slate-200">
		<div class="bg-slate-50 p-3 text-center">
			<p class="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{etiquetaValor}</p>
			<p class="text-lg font-bold text-[#0f3b5e]">{formatCurrency(valorVenta)}</p>
		</div>
		<div class="bg-slate-50 p-3 text-center">
			<p class="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Adelanto registrado</p>
			<p class="text-lg font-bold text-[#0f3b5e]">{formatCurrency(total)}</p>
			<p class="text-xs text-slate-500">({porcentaje(total)})</p>
		</div>
		<div class="bg-slate-50 p-3 text-center">
			<p class="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Saldo por cobrar</p>
			<p class="text-lg font-bold text-[#0f3b5e]">{formatCurrency(saldo)}</p>
			<p class="text-xs text-slate-500">({porcentaje(saldo)})</p>
		</div>
	</div>
</div>
