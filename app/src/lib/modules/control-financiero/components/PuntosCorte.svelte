<script lang="ts">
	/**
	 * "Puntos de corte" (Apertura Financiera) — a pedido del cliente (2026-10-11): ver qué corte manda en cada
	 * cuenta, cambiarlo o eliminarlo, y entender con un gráfico por qué un saldo no "suma" ciertos movimientos.
	 * Regla (fn_recalcular_saldo_cuenta_banco): saldo = monto del corte vigente + movimientos con fecha POSTERIOR
	 * al corte; si hay varios cortes, manda el de fecha más reciente. Cambiar fecha y eliminar piden la
	 * contraseña de un administrador (mismo criterio que el resto de borrados de la ERP).
	 */
	import { supabase } from '$lib/supabaseClient';
	import { toast } from '$lib/stores/toast';
	import { formatCurrency } from '$lib/shared/fieldConfig';
	import { verifyAdminCredentials } from '$lib/shared/adminAuth';
	import { getFechaLocalHoy } from '$lib/shared/dateUtils';
	import AdminConfirmModal from '$lib/shared/components/AdminConfirmModal.svelte';
	import SelectConSaldo from '$lib/shared/components/SelectConSaldo.svelte';
	import { CalendarClock, Info, Trash2, Pencil, ChevronDown, ChevronUp, CheckCircle2, CircleSlash } from '@lucide/svelte';
	import { Chart as ChartJS, Tooltip, Legend, CategoryScale, LinearScale, PointElement, LineElement, BarElement, Filler, LineController, BarController } from 'chart.js';
	import { Line } from 'svelte-chartjs';
	import {
		agruparCortes,
		aperturasVigentes,
		eliminarCorte,
		cambiarFechaCorte,
		getMovimientosCuentaBanco,
		type AperturaFinanciera,
		type MovimientoCuenta
	} from '../services/conciliacion.service';

	// LineController + BarController: el gráfico mezcla líneas (saldo) con una barra (marca del corte).
	ChartJS.register(Tooltip, Legend, CategoryScale, LinearScale, PointElement, LineElement, BarElement, Filler, LineController, BarController);

	let {
		aperturas,
		cuentas,
		centroCostoOptions,
		onCambio
	}: {
		aperturas: AperturaFinanciera[];
		cuentas: { id_cuenta_banco: number; numero_cuenta: string; titular_cuenta: string; saldo_actual: number }[];
		centroCostoOptions: { value: string; label: string }[];
		onCambio: () => Promise<void> | void;
	} = $props();

	const fmtFecha = (f: string) => String(f).slice(0, 10).split('-').reverse().join('/');
	const fmtFechaHora = (iso: string) => new Date(iso).toLocaleString('es-PE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

	const cortes = $derived(agruparCortes(aperturas));
	const vigentes = $derived(aperturasVigentes(aperturas));
	const nombreCuenta = (id: number | null) => {
		const c = cuentas.find((x) => x.id_cuenta_banco === id);
		return c ? `${c.titular_cuenta} — ${c.numero_cuenta}` : `Cuenta #${id}`;
	};
	const nombreCentro = (id: number | null) => centroCostoOptions.find((c) => c.value === String(id))?.label ?? `Centro de costo #${id}`;

	// ── Línea de tiempo ──────────────────────────────────────────────────────────────────────────────────
	const hoy = getFechaLocalHoy(); // fecha local (Perú), no UTC
	// Posiciones en orden cronológico y espaciadas por igual (no proporcionales al tiempo): cortes de días
	// seguidos (ej. 10/10 y 11/10) quedaban encimados y no se leían.
	const ejeTiempo = $derived.by(() => {
		const fechas = [...new Set(cortes.map((c) => c.fecha_corte))].sort();
		if (fechas.length === 0) return null;
		const puntos = [...fechas, ...(fechas.includes(hoy) ? [] : [hoy])].sort();
		const paso = puntos.length > 1 ? 88 / (puntos.length - 1) : 0;
		const posiciones = new Map(puntos.map((f, i) => [f, puntos.length > 1 ? 6 + i * paso : 50]));
		return { pos: (f: string) => posiciones.get(f) ?? 50 };
	});

	// ── Acciones (con contraseña de admin) ──────────────────────────────────────────────────────────────
	let expandido = $state<string | null>(null);
	let editandoFecha = $state<string | null>(null);
	let nuevaFecha = $state('');
	let accion = $state<{ tipo: 'eliminar' | 'mover'; fecha: string; nueva?: string } | null>(null);

	async function confirmarAccion(email: string, password: string) {
		if (!accion) return;
		const v = await verifyAdminCredentials(email, password);
		if (!v.success) throw new Error(v.message);
		const r = accion.tipo === 'eliminar' ? await eliminarCorte(supabase, accion.fecha) : await cambiarFechaCorte(supabase, accion.fecha, accion.nueva ?? '');
		if (!r.success) throw new Error(r.message);
		toast.success(r.message);
		accion = null;
		editandoFecha = null;
		await onCambio();
		await cargarMovimientos();
	}

	// ── Saldo de una cuenta en el tiempo ────────────────────────────────────────────────────────────────
	let cuentaSel = $state('');
	let movimientos = $state<MovimientoCuenta[]>([]);
	let saldoInicial = $state(0);
	let cargandoMov = $state(false);

	$effect(() => {
		if (!cuentaSel && cuentas.length > 0) cuentaSel = String([...cuentas].sort((a, b) => Number(b.saldo_actual) - Number(a.saldo_actual))[0].id_cuenta_banco);
	});
	$effect(() => {
		cuentaSel;
		void cargarMovimientos();
	});
	async function cargarMovimientos() {
		const c = cuentas.find((x) => String(x.id_cuenta_banco) === cuentaSel);
		if (!c) return;
		cargandoMov = true;
		try {
			const [movs, { data }] = await Promise.all([
				getMovimientosCuentaBanco(supabase, c.numero_cuenta),
				supabase.from('cuenta_banco').select('saldo_inicial').eq('id_cuenta_banco', c.id_cuenta_banco).maybeSingle()
			]);
			movimientos = movs;
			saldoInicial = Number(data?.saldo_inicial ?? 0);
		} catch (err) {
			console.error('[PuntosCorte] No se pudieron cargar los movimientos:', err);
			movimientos = [];
		} finally {
			cargandoMov = false;
		}
	}

	const corteCuenta = $derived(cuentaSel ? vigentes.get(`b:${cuentaSel}`) ?? null : null);
	const analisis = $derived.by(() => {
		const corte = corteCuenta ? String(corteCuenta.fecha_corte).slice(0, 10) : null;
		const suman = corte ? movimientos.filter((m) => m.fecha > corte) : movimientos;
		const noSuman = corte ? movimientos.filter((m) => m.fecha <= corte) : [];
		const base = corteCuenta ? Number(corteCuenta.monto) : saldoInicial;
		const total = (l: MovimientoCuenta[]) => l.reduce((s, m) => s + m.monto, 0);
		return { corte, base, suman, noSuman, totalSuman: total(suman), totalNoSuman: total(noSuman), saldo: base + total(suman) };
	});

	const chartData = $derived.by(() => {
		const { corte, base } = analisis;
		const fechas = [...new Set([...movimientos.map((m) => m.fecha), ...(corte ? [corte] : [])])].sort();
		let acumTodo = saldoInicial;
		let acumErp = corte ? null as number | null : saldoInicial;
		const serieTodo: (number | null)[] = [];
		const serieErp: (number | null)[] = [];
		for (const f of fechas) {
			const delDia = movimientos.filter((m) => m.fecha === f).reduce((s, m) => s + m.monto, 0);
			acumTodo += delDia;
			if (corte && f === corte) acumErp = base;
			else if (acumErp !== null) acumErp += delDia;
			serieTodo.push(acumTodo);
			serieErp.push(corte && f < corte ? null : acumErp);
		}
		const tope = Math.max(0, ...serieTodo.map((v) => v ?? 0), ...serieErp.map((v) => v ?? 0));
		return {
			labels: fechas.map(fmtFecha),
			datasets: [
				{ type: 'line' as const, label: 'Saldo en la ERP (desde el corte)', data: serieErp, borderColor: '#059669', backgroundColor: 'rgba(5,150,105,0.12)', fill: true, tension: 0.25, pointRadius: 3, spanGaps: false },
				{ type: 'line' as const, label: 'Todos los movimientos (sin corte)', data: serieTodo, borderColor: '#94a3b8', borderDash: [6, 4], pointRadius: 2, tension: 0.25, fill: false },
				...(corte ? [{ type: 'bar' as const, label: `Corte vigente (${fmtFecha(corte)})`, data: fechas.map((f) => (f === corte ? tope || 1 : null)), backgroundColor: 'rgba(217,119,6,0.55)', barThickness: 4 }] : [])
			]
		};
	});
</script>

<div class="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm">
	<div class="flex items-center gap-2 mb-3">
		<CalendarClock size={16} class="text-amber-600" />
		<h2 class="font-bold text-brand-marine text-sm">Puntos de corte</h2>
	</div>

	<div class="flex gap-3 rounded-xl bg-blue-50 border border-blue-100 p-3 mb-5 text-xs text-slate-700">
		<Info size={16} class="shrink-0 text-blue-600 mt-0.5" />
		<div class="space-y-1">
			<p><b>Saldo de una cuenta = monto del corte que manda + movimientos con fecha posterior al corte.</b> Los movimientos con fecha igual o anterior al corte se consideran ya incluidos en ese monto.</p>
			<p>Si hay varios cortes, <b>manda el de fecha más reciente</b>. Generar un corte con una fecha anterior <b>no reemplaza</b> al más reciente: para que mande, elimina o cambia la fecha del corte más reciente aquí abajo.</p>
		</div>
	</div>

	{#if cortes.length === 0}
		<p class="text-sm text-slate-400 text-center py-6">Sin cortes registrados: el saldo de cada cuenta es su saldo inicial + todos sus movimientos.</p>
	{:else}
		<!-- Línea de tiempo -->
		{#if ejeTiempo}
			<div class="relative h-16 mx-2 mb-4">
				<div class="absolute left-0 right-0 top-6 h-1 rounded-full bg-slate-200"></div>
				{#each cortes as c (c.fecha_corte)}
					<div class="absolute top-0 -translate-x-1/2 flex flex-col items-center" style={`left:${ejeTiempo.pos(c.fecha_corte)}%`}>
						<span class={`text-[10px] font-semibold whitespace-nowrap ${c.vigenteEn > 0 ? 'text-emerald-700' : 'text-slate-400'}`}>{c.vigenteEn > 0 ? 'Manda' : 'Reemplazado'}</span>
						<span class={`mt-0.5 rounded-full border-2 ${c.vigenteEn > 0 ? 'w-4 h-4 bg-emerald-500 border-emerald-200' : 'w-3 h-3 bg-slate-300 border-white'}`}></span>
						<span class="mt-1 text-[10px] text-slate-500 whitespace-nowrap">{fmtFecha(c.fecha_corte)}</span>
					</div>
				{/each}
				<div class="absolute top-0 -translate-x-1/2 flex flex-col items-center" style={`left:${ejeTiempo.pos(hoy)}%`}>
					<span class="text-[10px] font-semibold text-blue-600">Hoy</span>
					<span class="mt-1 w-0.5 h-4 bg-blue-500"></span>
				</div>
			</div>
		{/if}

		<!-- Lista de cortes -->
		<div class="overflow-x-auto mb-6">
			<table class="w-full text-xs text-left">
				<thead class="bg-slate-50 border-b border-slate-200 text-slate-500 font-bold uppercase tracking-wide text-[10px]">
					<tr>
						<th class="px-3 py-2.5">Fecha de corte</th>
						<th class="px-3 py-2.5">Alcance</th>
						<th class="px-3 py-2.5 text-right">Total cuentas</th>
						<th class="px-3 py-2.5">¿Manda?</th>
						<th class="px-3 py-2.5">Registrado</th>
						<th class="px-3 py-2.5 text-right">Acciones</th>
					</tr>
				</thead>
				<tbody class="divide-y divide-slate-100">
					{#each cortes as c (c.fecha_corte)}
						<tr class={c.vigenteEn > 0 ? 'bg-emerald-50/40' : ''}>
							<td class="px-3 py-2.5 font-semibold text-slate-700 whitespace-nowrap">
								{#if editandoFecha === c.fecha_corte}
									<div class="flex items-center gap-1.5">
										<input type="date" bind:value={nuevaFecha} class="px-2 py-1 rounded border border-slate-300 text-xs" />
										<button type="button" onclick={() => (accion = { tipo: 'mover', fecha: c.fecha_corte, nueva: nuevaFecha })} disabled={!nuevaFecha || nuevaFecha === c.fecha_corte} class="px-2 py-1 rounded bg-[#0f3b5e] text-white text-[11px] font-semibold disabled:opacity-40">Guardar</button>
										<button type="button" onclick={() => (editandoFecha = null)} class="px-2 py-1 rounded border border-slate-300 text-[11px]">Cancelar</button>
									</div>
								{:else}
									{fmtFecha(c.fecha_corte)}
								{/if}
							</td>
							<td class="px-3 py-2.5 text-slate-600 whitespace-nowrap">{c.cuentas} cuentas · {c.centros} centros{c.filas > c.cuentas + c.centros ? ` · ${c.filas - c.cuentas - c.centros} global` : ''}</td>
							<td class="px-3 py-2.5 text-right whitespace-nowrap">{formatCurrency(c.totalCuentas)}</td>
							<td class="px-3 py-2.5 whitespace-nowrap">
								{#if c.vigenteEn > 0}
									<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 text-[11px] font-semibold"><CheckCircle2 size={12} /> Manda en {c.vigenteEn} de {c.filas}</span>
								{:else}
									<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 text-[11px] font-semibold" title="Hay un corte más reciente en todas sus cuentas/centros"><CircleSlash size={12} /> Reemplazado</span>
								{/if}
							</td>
							<td class="px-3 py-2.5 text-slate-500 whitespace-nowrap">{fmtFechaHora(c.creadoUltimo)}{c.usuarios.length ? ` · ${c.usuarios.join(', ')}` : ''}</td>
							<td class="px-3 py-2.5">
								<div class="flex items-center justify-end gap-1">
									<button type="button" onclick={() => (expandido = expandido === c.fecha_corte ? null : c.fecha_corte)} class="px-2 py-1 rounded-lg text-slate-500 hover:bg-slate-100 flex items-center gap-1" title="Ver detalle">
										{#if expandido === c.fecha_corte}<ChevronUp size={14} />{:else}<ChevronDown size={14} />{/if} Detalle
									</button>
									<button type="button" onclick={() => { editandoFecha = c.fecha_corte; nuevaFecha = c.fecha_corte; }} class="p-1.5 rounded-lg text-slate-500 hover:bg-blue-50 hover:text-blue-600" title="Cambiar fecha del corte" aria-label="Cambiar fecha del corte"><Pencil size={14} /></button>
									<button type="button" onclick={() => (accion = { tipo: 'eliminar', fecha: c.fecha_corte })} class="p-1.5 rounded-lg text-slate-500 hover:bg-red-50 hover:text-red-600" title="Eliminar corte" aria-label="Eliminar corte"><Trash2 size={14} /></button>
								</div>
							</td>
						</tr>
						{#if expandido === c.fecha_corte}
							<tr>
								<td colspan="6" class="px-3 py-3 bg-slate-50/60">
									<div class="grid sm:grid-cols-2 gap-x-6 gap-y-1 max-h-64 overflow-y-auto">
										{#each aperturas.filter((a) => String(a.fecha_corte).slice(0, 10) === c.fecha_corte) as a (a.id_apertura)}
											{@const manda = [...vigentes.values()].some((v) => v.id_apertura === a.id_apertura)}
											<div class="flex items-center justify-between gap-3 py-1 border-b border-slate-100 text-[11px]">
												<span class="truncate text-slate-600">{a.id_cuenta_banco ? `🏦 ${nombreCuenta(a.id_cuenta_banco)}` : a.id_centro_costo ? nombreCentro(a.id_centro_costo) : 'Global'}</span>
												<span class="shrink-0 flex items-center gap-2">
													<span class="font-semibold text-slate-700">{formatCurrency(Number(a.monto))}</span>
													<span class={manda ? 'text-emerald-600' : 'text-slate-300'} title={manda ? 'Manda' : 'Reemplazado'}>{manda ? '●' : '○'}</span>
												</span>
											</div>
										{/each}
									</div>
								</td>
							</tr>
						{/if}
					{/each}
				</tbody>
			</table>
		</div>
	{/if}

	<!-- Saldo de una cuenta en el tiempo -->
	<div class="border-t border-slate-100 pt-5">
		<div class="flex flex-wrap items-center justify-between gap-3 mb-4">
			<h3 class="font-bold text-brand-marine text-sm">¿Por qué este saldo? — cuenta bancaria en el tiempo</h3>
			<div class="w-full sm:w-80">
				<SelectConSaldo
					value={cuentaSel}
					options={cuentas.map((c) => ({ value: String(c.id_cuenta_banco), label: `${c.titular_cuenta} — ${c.numero_cuenta}` }))}
					onchange={(v) => (cuentaSel = String(v))}
				/>
			</div>
		</div>

		<div class="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
			<div class="rounded-xl border border-amber-200 bg-amber-50 p-3">
				<p class="text-[10px] font-bold uppercase tracking-wide text-amber-700">Corte que manda</p>
				{#if analisis.corte}
					<p class="text-base font-black text-amber-800">{fmtFecha(analisis.corte)}</p>
					<p class="text-[11px] text-amber-700">Monto de apertura: {formatCurrency(analisis.base)}</p>
				{:else}
					<p class="text-base font-black text-amber-800">Sin corte</p>
					<p class="text-[11px] text-amber-700">Saldo inicial: {formatCurrency(analisis.base)}</p>
				{/if}
			</div>
			<div class="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
				<p class="text-[10px] font-bold uppercase tracking-wide text-emerald-700">Suman al saldo</p>
				<p class="text-base font-black text-emerald-800">{formatCurrency(analisis.totalSuman)}</p>
				<p class="text-[11px] text-emerald-700">{analisis.suman.length} movimiento{analisis.suman.length === 1 ? '' : 's'} posteriores al corte</p>
			</div>
			<div class="rounded-xl border border-slate-200 bg-slate-50 p-3">
				<p class="text-[10px] font-bold uppercase tracking-wide text-slate-500">No suman (ya incluidos en el corte)</p>
				<p class="text-base font-black text-slate-600">{formatCurrency(analisis.totalNoSuman)}</p>
				<p class="text-[11px] text-slate-500">{analisis.noSuman.length} movimiento{analisis.noSuman.length === 1 ? '' : 's'} con fecha igual o anterior</p>
			</div>
			<div class="rounded-xl border border-blue-200 bg-blue-50 p-3">
				<p class="text-[10px] font-bold uppercase tracking-wide text-blue-700">Saldo en la ERP</p>
				<p class="text-base font-black text-blue-800">{formatCurrency(analisis.saldo)}</p>
				<p class="text-[11px] text-blue-700">{formatCurrency(analisis.base)} + {formatCurrency(analisis.totalSuman)}</p>
			</div>
		</div>

		{#if analisis.suman.length + analisis.noSuman.length > 0}
			{@const total = analisis.suman.length + analisis.noSuman.length}
			<div class="mb-4">
				<div class="flex h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
					<div class="bg-emerald-500" style={`width:${(analisis.suman.length / total) * 100}%`}></div>
					<div class="bg-slate-300" style={`width:${(analisis.noSuman.length / total) * 100}%`}></div>
				</div>
				<p class="mt-1 text-[11px] text-slate-500">{analisis.suman.length} de {total} movimientos de esta cuenta suman al saldo.</p>
			</div>
		{/if}

		<div class="h-72">
			{#if cargandoMov}
				<p class="text-sm text-slate-400 text-center pt-24">Cargando movimientos…</p>
			{:else if movimientos.length === 0}
				<p class="text-sm text-slate-400 text-center pt-24">Esta cuenta no tiene movimientos.</p>
			{:else}
				<Line
					data={chartData as any}
					options={{
						responsive: true,
						maintainAspectRatio: false,
						interaction: { mode: 'index', intersect: false },
						plugins: {
							legend: { position: 'top', labels: { boxWidth: 12, font: { size: 10, weight: 'bold' } } },
							tooltip: { callbacks: { label: (ctx: any) => (ctx.dataset.type === 'bar' ? ctx.dataset.label : `${ctx.dataset.label}: ${formatCurrency(Number(ctx.parsed.y))}`) } }
						},
						scales: { y: { ticks: { callback: (v: any) => formatCurrency(Number(v)) } } }
					}}
				/>
			{/if}
		</div>
	</div>
</div>

<AdminConfirmModal
	open={accion !== null}
	title={accion?.tipo === 'eliminar' ? 'Eliminar corte' : 'Cambiar fecha del corte'}
	message={accion?.tipo === 'eliminar'
		? `Se eliminará el corte del ${accion ? fmtFecha(accion.fecha) : ''} en todas sus cuentas y centros de costo. Pasará a mandar el corte anterior de cada una (o su saldo inicial + todo el historial) y los saldos se recalculan.`
		: `El corte del ${accion ? fmtFecha(accion.fecha) : ''} pasará al ${accion?.nueva ? fmtFecha(accion.nueva) : ''}, con los mismos montos. Los saldos se recalculan.`}
	confirmLabel={accion?.tipo === 'eliminar' ? 'Eliminar corte' : 'Cambiar fecha'}
	onConfirm={confirmarAccion}
	onClose={() => (accion = null)}
/>
