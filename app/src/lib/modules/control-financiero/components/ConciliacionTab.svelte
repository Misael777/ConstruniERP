<script lang="ts">
	import SelectConSaldo from '$lib/shared/components/SelectConSaldo.svelte';
	import { onMount } from 'svelte';
	import { supabase } from '$lib/supabaseClient';
	import { toast } from '$lib/stores/toast';
	import { permisosState } from '$lib/stores/permisos.svelte';
	import { formatCurrency } from '$lib/shared/fieldConfig';
	import { getCuentaBancoOptions } from '$lib/modules/cuentas-bancarias/services/cuentaBanco.service';
	// Solo "Centros de Costos" (fondos propios) — NO "Cuentas Internas" (cliente/proveedor/empleado,
	// ledgers de contraparte, no dinero de la empresa) — mismo filtro que la pestaña "Centros de
	// Costos" en Centro de Costos y Cuentas Internas, ver nota en conciliacion.service.ts.
	import { getCentroCostoOptionsSoloCentros } from '$lib/modules/transacciones/services/transacciones.service';
	import {
		getSaldoTotalCentrosCosto,
		getSaldoTotalCuentasBancarias,
		getSaldosDetalleCentrosCosto,
		registrarConciliacionInterna,
		registrarConciliacionBancoManual,
		getConciliaciones,
		crearAperturaFinancieraLote,
		getAperturasFinancieras,
		type ConciliacionFinanciera,
		type AperturaFinanciera,
		type FuenteApertura,
		type SaldoDetalleEntidad
	} from '../services/conciliacion.service';
	import { Scale, Landmark, Building2, RefreshCw, ShieldCheck, ShieldAlert, Archive } from '@lucide/svelte';
	import PuntosCorte from './PuntosCorte.svelte';

	let loading = $state(true);
	let saldoCentros = $state(0);
	let saldoBancos = $state(0);
	let registrandoInterna = $state(false);

	let conciliaciones = $state<ConciliacionFinanciera[]>([]);
	let aperturas = $state<AperturaFinanciera[]>([]);
	let cuentaOptions = $state<{ value: string; label: string }[]>([]);
	let cuentasParaApertura = $state<{ id_cuenta_banco: number; numero_cuenta: string; titular_cuenta: string; saldo_actual: number }[]>([]);
	let centroCostoOptions = $state<{ value: string; label: string }[]>([]);
	let saldosDetalleCentros = $state<SaldoDetalleEntidad[]>([]);

	// Conciliación bancaria manual
	let fechaManual = $state(new Date().toISOString().slice(0, 10));
	let cuentaManual = $state('');
	let montoBancoManual = $state('');
	let observacionesManual = $state('');
	let registrandoManual = $state(false);

	// Apertura financiera / Corte — a pedido explícito del usuario: revisa TODAS las cuentas
	// bancarias Y todos los centros de costo de un tirón para la misma fecha de corte, y no deja
	// "Generar Apertura" hasta que Σ centros === Σ cuentas (dentro de tolerancia) — mismo criterio de
	// tolerancia que Cruce Interno/Consistencia (TOLERANCIA_CONCILIACION = 0.01).
	let fechaCorte = $state(new Date().toISOString().slice(0, 10));
	let fuenteApertura = $state<FuenteApertura>('estado_de_cuenta_bancario');
	let observacionesApertura = $state('');
	let montosCuentas = $state<Record<number, string>>({});
	let montosCentros = $state<Record<string, string>>({});
	let generandoApertura = $state(false);

	/** Prefill de cuenta bancaria lee `saldo_actual` (el saldo VIGENTE, ya sea que venga de una apertura
	 * previa + transacciones posteriores, o de saldo_inicial + historial completo si nunca tuvo un
	 * corte — ver fn_recalcular_saldo_cuenta_banco) — antes leía `saldo_inicial` directo, que era
	 * correcto bajo el diseño viejo (un corte SÍ pisaba esa columna, ver
	 * cuenta_banco_saldo_fecha_corte_migration.sql para el bug real que corrigió), pero dejó de serlo
	 * al desacoplar el corte de esa columna: ahora saldo_inicial vuelve a ser el valor de una sola vez
	 * al crear la cuenta, no lo último declarado. Centro de costo ya hacía lo mismo con su saldo
	 * VIGENTE actual (getSaldosDetalleCentrosCosto) — antes caía a `montosCentros[c.value] ?? '0'`, un
	 * valor que solo vivía en memoria del componente y se perdía al cambiar de pestaña (el {#if} del
	 * orquestador destruye y recrea ConciliacionTab). Eso hacía que reabrir el wizard prellenara todos
	 * los centros en 0, y si el usuario solo editaba uno para que la suma cuadrara, "Generar Apertura"
	 * creaba una fila MÁS RECIENTE con monto=0 para el resto — que por diseño (última apertura gana)
	 * pisaba en silencio sus valores reales anteriores. */
	function prellenarMontosApertura() {
		montosCuentas = Object.fromEntries(cuentasParaApertura.map((c) => [c.id_cuenta_banco, String(c.saldo_actual ?? 0)]));
		const saldoVigentePorCentro = Object.fromEntries(saldosDetalleCentros.map((d) => [d.id, d.monto]));
		montosCentros = Object.fromEntries(centroCostoOptions.map((c) => [c.value, String(saldoVigentePorCentro[c.value] ?? 0)]));
	}

	const FUENTE_LABELS: Record<FuenteApertura, string> = {
		estado_de_cuenta_bancario: 'Estado de cuenta bancario',
		migracion_inicial: 'Migración inicial',
		auditoria_externa: 'Auditoría externa',
		otro: 'Otro'
	};

	async function cargar() {
		loading = true;
		try {
			const [sc, sb, conc, apert, opciones, cuentas, centros, detalleCentros] = await Promise.all([
				getSaldoTotalCentrosCosto(supabase),
				getSaldoTotalCuentasBancarias(supabase),
				getConciliaciones(supabase),
				getAperturasFinancieras(supabase),
				getCuentaBancoOptions(supabase),
				supabase.from('cuenta_banco').select('id_cuenta_banco, numero_cuenta, titular_cuenta, saldo_actual').eq('activo', true).then((r) => r.data ?? []),
				getCentroCostoOptionsSoloCentros(supabase),
				getSaldosDetalleCentrosCosto(supabase)
			]);
			centroCostoOptions = centros;
			saldoCentros = sc;
			saldoBancos = sb;
			conciliaciones = conc;
			aperturas = apert;
			cuentaOptions = opciones;
			cuentasParaApertura = cuentas as any[];
			saldosDetalleCentros = detalleCentros;
			prellenarMontosApertura();
		} catch (err: any) {
			toast.error(err?.message ?? 'No se pudo cargar la conciliación');
		} finally {
			loading = false;
		}
	}

	onMount(cargar);

	// Apertura Financiera genera movimientos REALES en ambos lados (ver conciliacion.service.ts) — se
	// comparan directamente, sin ningún ajuste aparte.
	const diferenciaInterna = $derived(saldoCentros - saldoBancos);

	async function handleRegistrarInterna() {
		registrandoInterna = true;
		try {
			const result = await registrarConciliacionInterna(supabase, permisosState.userName || null);
			if (result.success) {
				toast.success(result.message);
				await cargar();
			} else {
				toast.error(result.message);
			}
		} catch (err: any) {
			toast.error(err?.message ?? 'No se pudo registrar la conciliación interna');
		} finally {
			registrandoInterna = false;
		}
	}

	async function handleRegistrarManual() {
		const monto = Number(montoBancoManual);
		if (!Number.isFinite(monto)) {
			toast.error('Ingresa el monto reportado por el banco.');
			return;
		}
		registrandoManual = true;
		try {
			const result = await registrarConciliacionBancoManual(supabase, monto, cuentaManual || null, permisosState.userName || null, observacionesManual || null);
			if (result.success) {
				toast.success(result.message);
				montoBancoManual = '';
				observacionesManual = '';
				await cargar();
			} else {
				toast.error(result.message);
			}
		} catch (err: any) {
			toast.error(err?.message ?? 'No se pudo registrar la conciliación bancaria');
		} finally {
			registrandoManual = false;
		}
	}

	// Σ de lo que el usuario va tipeando en cada fila, en vivo — esto es lo que arma/rompe el gate de
	// "Generar Apertura" de abajo, no las sumas ya persistidas (saldoCentros/saldoBancos arriba).
	const totalCuentasLote = $derived(Object.values(montosCuentas).reduce((sum, v) => sum + (Number(v) || 0), 0));
	const totalCentrosLote = $derived(Object.values(montosCentros).reduce((sum, v) => sum + (Number(v) || 0), 0));
	const diferenciaLote = $derived(Number((totalCentrosLote - totalCuentasLote).toFixed(2)));
	const loteCuadra = $derived(Math.abs(diferenciaLote) <= 0.01);
	const puedeGenerarApertura = $derived(loteCuadra && !!fechaCorte && !generandoApertura);
	// Puntos de corte: un corte con fecha anterior al más reciente NO lo reemplaza (manda el de fecha más
	// reciente) — se avisa antes de generarlo, que fue justo la confusión del cliente (2026-10-11).
	const corteMasReciente = $derived(aperturas.reduce((max, a) => (String(a.fecha_corte).slice(0, 10) > max ? String(a.fecha_corte).slice(0, 10) : max), ''));
	const corteNoMandara = $derived(!!fechaCorte && !!corteMasReciente && fechaCorte < corteMasReciente);

	async function handleGenerarApertura() {
		if (!puedeGenerarApertura) return;
		generandoApertura = true;
		try {
			const result = await crearAperturaFinancieraLote(
				supabase,
				{
					fecha_corte: fechaCorte,
					fuente: fuenteApertura,
					observaciones: observacionesApertura || null,
					cuentas: cuentasParaApertura.map((c) => ({ id_cuenta_banco: c.id_cuenta_banco, monto: Number(montosCuentas[c.id_cuenta_banco] || 0) })),
					centros: centroCostoOptions.map((c) => ({ id_centro_costo: Number(c.value), monto: Number(montosCentros[c.value] || 0) }))
				},
				permisosState.userName || null
			);
			if (result.success) {
				toast.success(result.message);
				observacionesApertura = '';
				await cargar();
			} else {
				toast.error(result.message);
			}
		} catch (err: any) {
			toast.error(err?.message ?? 'No se pudo generar la apertura financiera');
		} finally {
			generandoApertura = false;
		}
	}

</script>

<div class="mb-6">
	<h1 class="text-xl font-bold text-brand-marine flex items-center gap-2"><Scale size={20} class="text-blue-600" /> Conciliación</h1>
	<p class="text-sm text-slate-500 mt-1">Comparaciones de saldo, nunca ajustes automáticos — toda diferencia genera una Incidencia para investigar.</p>
</div>

{#if loading}
	<div class="flex items-center justify-center py-24 text-slate-400">
		<RefreshCw size={28} class="animate-spin" />
	</div>
{:else}
	<!-- ── Cruce interno ────────────────────────────────────────────────────── -->
	<div class="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm mb-8">
		<h2 class="font-bold text-brand-marine text-sm mb-1">Cruce Interno — Centros de Costo vs Cuentas Bancarias</h2>
		<p class="text-[11px] text-slate-400 mb-4">
			Automático, sin datos manuales — compara dos totales que ya calcula el ERP. Saldo Cuentas Bancarias es el saldo "vigente" de cada cuenta: su última Apertura + solo las transacciones reales
			posteriores a esa fecha de corte (o saldo_inicial + historial completo si nunca tuvo un corte). Saldo Centros de Costo funciona igual: su última Apertura + solo las transacciones reales
			posteriores a esa fecha de corte (no se refleja en la pantalla propia de Centro de Costos, que siempre suma todo el historial sin fecha de corte).
			"Centro de Costo" acá es solo fondos propios (pestaña "Centros de Costos" del submódulo Centro de Costos y Cuentas Internas) — Cuentas Internas (cliente/proveedor/empleado) queda fuera, son
			ledgers de contraparte, no dinero de la empresa.
		</p>
		<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
			<div>
				<div class="flex items-center gap-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider"><Building2 size={11} /> Saldo Centros de Costo</div>
				<div class="text-xl font-black text-brand-marine mt-0.5">{formatCurrency(saldoCentros)}</div>
			</div>
			<div>
				<div class="flex items-center gap-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider"><Landmark size={11} /> Saldo Cuentas Bancarias</div>
				<div class="text-xl font-black text-brand-marine mt-0.5">{formatCurrency(saldoBancos)}</div>
			</div>
			<div>
				<div class="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Diferencia</div>
				<div class={`text-xl font-black mt-0.5 flex items-center gap-1.5 ${Math.abs(diferenciaInterna) <= 0.01 ? 'text-emerald-600' : 'text-red-600'}`}>
					{#if Math.abs(diferenciaInterna) <= 0.01}<ShieldCheck size={18} />{:else}<ShieldAlert size={18} />{/if}
					{formatCurrency(diferenciaInterna)}
				</div>
			</div>
		</div>
		<button type="button" onclick={handleRegistrarInterna} disabled={registrandoInterna} class="px-4 py-2 rounded-lg bg-[#0f3b5e] text-white text-sm font-semibold hover:bg-[#154a73] disabled:opacity-50">
			Registrar conciliación interna
		</button>
	</div>

	<!-- ── Conciliación bancaria manual ─────────────────────────────────────── -->
	<div class="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm mb-8">
		<h2 class="font-bold text-brand-marine text-sm mb-1">Conciliación Bancaria Manual</h2>
		<p class="text-[11px] text-slate-400 mb-4">Compara el saldo del ERP contra el monto real del estado de cuenta — ingrésalo a mano (sin integración bancaria).</p>
		<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
			<div class="flex flex-col gap-1">
				<label for="cf-fecha-manual" class="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Fecha</label>
				<input id="cf-fecha-manual" type="date" bind:value={fechaManual} class="px-3 py-2 rounded-lg border border-slate-300 text-sm" />
			</div>
			<div class="flex flex-col gap-1">
				<label for="cf-cuenta-manual" class="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Cuenta (vacío = consolidado)</label>
				<SelectConSaldo
					id="cf-cuenta-manual"
					value={cuentaManual}
					options={[{ value: '', label: 'Consolidado (todas las cuentas)' }, ...cuentaOptions.map((opt) => ({ value: String(opt.value), label: `${opt.label}` }))]}
					placeholder="Consolidado (todas las cuentas)"
					onchange={(v) => (cuentaManual = v)}
				/>
			</div>
			<div class="flex flex-col gap-1">
				<label for="cf-monto-manual" class="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Monto según el banco</label>
				<input id="cf-monto-manual" type="number" step="0.01" bind:value={montoBancoManual} placeholder="0.00" class="px-3 py-2 rounded-lg border border-slate-300 text-sm" />
			</div>
			<div class="flex flex-col gap-1">
				<label for="cf-obs-manual" class="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Observaciones (opcional)</label>
				<input id="cf-obs-manual" type="text" bind:value={observacionesManual} class="px-3 py-2 rounded-lg border border-slate-300 text-sm" />
			</div>
		</div>
		<button type="button" onclick={handleRegistrarManual} disabled={registrandoManual} class="px-4 py-2 rounded-lg bg-[#0f3b5e] text-white text-sm font-semibold hover:bg-[#154a73] disabled:opacity-50">
			Registrar conciliación bancaria
		</button>
	</div>

	<!-- ── Historial ────────────────────────────────────────────────────────── -->
	<div class="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden mb-8">
		<div class="p-4 border-b border-slate-100">
			<h3 class="font-bold text-brand-marine text-sm">Historial de Conciliaciones</h3>
		</div>
		<div class="overflow-x-auto">
			<table class="w-full text-xs text-left whitespace-nowrap">
				<thead class="bg-slate-50 border-b border-slate-200 text-slate-500 font-bold uppercase tracking-wide text-[10px]">
					<tr>
						<th class="px-3 py-2.5">Fecha</th>
						<th class="px-3 py-2.5">Tipo</th>
						<th class="px-3 py-2.5 text-right">Saldo A</th>
						<th class="px-3 py-2.5 text-right">Saldo B</th>
						<th class="px-3 py-2.5 text-right">Diferencia</th>
						<th class="px-3 py-2.5">Estado</th>
					</tr>
				</thead>
				<tbody class="divide-y divide-slate-100">
					{#each conciliaciones as c (c.id_conciliacion)}
						<tr class="hover:bg-slate-50/70">
							<td class="px-3 py-2">{c.fecha}</td>
							<td class="px-3 py-2">{c.tipo === 'interna' ? 'Cruce interno' : 'Banco manual'}</td>
							<td class="px-3 py-2 text-right">{formatCurrency(c.saldo_a)}</td>
							<td class="px-3 py-2 text-right">{formatCurrency(c.saldo_b)}</td>
							<td class={`px-3 py-2 text-right font-bold ${Math.abs(c.diferencia) <= 0.01 ? 'text-emerald-600' : 'text-red-600'}`}>{formatCurrency(c.diferencia)}</td>
							<td class="px-3 py-2">
								<span class={`px-1.5 py-0.5 rounded text-[10px] font-bold ${c.estado === 'cuadrada' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
									{c.estado === 'cuadrada' ? 'Cuadrada' : 'Con diferencia'}
								</span>
							</td>
						</tr>
					{:else}
						<tr><td colspan="6" class="px-3 py-6 text-center text-slate-400">Sin conciliaciones registradas todavía.</td></tr>
					{/each}
				</tbody>
			</table>
		</div>
	</div>

	<!-- ── Apertura Financiera / Saldo Inicial ──────────────────────────────── -->
	<div class="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm">
		<div class="flex items-center gap-2 mb-1">
			<Archive size={16} class="text-slate-400" />
			<h2 class="font-bold text-brand-marine text-sm">Apertura Financiera / Saldo Inicial</h2>
		</div>
		<p class="text-[11px] text-slate-400 mb-4">
			Al generar, esto queda como referencia en Apertura Financiera para ambos lados — NINGUNO pisa una columna real (ni el Saldo Inicial de la cuenta bancaria ni nada en el centro de costo).
			El Saldo Actual de cada cuenta bancaria (verás el cambio también en Cuentas Bancarias) y el saldo vigente de cada centro de costo se recalculan igual: ese monto declarado más las
			transacciones reales que registres después de esta fecha (el del centro de costo no se refleja en la pantalla propia de Centro de Costos). Revisa TODAS las cuentas bancarias y TODOS los
			centros de costo (solo fondos propios — Cuentas Internas queda fuera, ver nota de Cruce Interno) para la misma fecha de corte; solo se puede generar cuando la suma de ambos lados cuadra.
		</p>

		<div class="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-5">
			<div class="flex flex-col gap-1">
				<label for="af-fecha" class="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Fecha de Corte</label>
				<input id="af-fecha" type="date" bind:value={fechaCorte} class="px-3 py-2 rounded-lg border border-slate-300 text-sm" />
				{#if corteNoMandara}
					<p class="rounded-md bg-amber-50 border border-amber-200 px-2 py-1 text-[11px] text-amber-800">
						Ya existe un corte al {corteMasReciente.split('-').reverse().join('/')}, más reciente: ese seguirá mandando y este no cambiará los saldos. Elimina o cambia la fecha de ese corte en "Puntos de corte" (abajo).
					</p>
				{/if}
				<p class="text-[10px] text-slate-400">Fecha "a la cual" estos montos se consideran correctos — un ancla histórica, no se recalcula después.</p>
			</div>
			<div class="flex flex-col gap-1">
				<label for="af-fuente" class="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Fuente</label>
				<SelectConSaldo
					id="af-fuente"
					value={fuenteApertura}
					options={[...Object.entries(FUENTE_LABELS).map(([value, label]) => ({ value: String(value), label: `${label}` }))]}
					onchange={(v) => (fuenteApertura = v as typeof fuenteApertura)}
				/>
			</div>
			<div class="flex flex-col gap-1">
				<label for="af-obs" class="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Observaciones</label>
				<input id="af-obs" type="text" bind:value={observacionesApertura} class="px-3 py-2 rounded-lg border border-slate-300 text-sm" placeholder="Ej. corte inicial de migración" />
			</div>
		</div>

		<div class="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
			<!-- Cuentas Bancarias -->
			<div class="border border-slate-200 rounded-xl overflow-hidden">
				<div class="px-3 py-2 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
					<span class="text-xs font-bold text-slate-600 flex items-center gap-1.5"><Landmark size={13} /> Cuentas Bancarias ({cuentasParaApertura.length})</span>
					<span class="text-xs font-black text-brand-marine">{formatCurrency(totalCuentasLote)}</span>
				</div>
				<div class="max-h-72 overflow-y-auto divide-y divide-slate-100">
					{#each cuentasParaApertura as c (c.id_cuenta_banco)}
						<div class="flex items-center gap-2 px-3 py-2">
							<span class="flex-1 text-xs text-slate-600 truncate">{c.titular_cuenta} - {c.numero_cuenta}</span>
							<input
								type="number"
								step="0.01"
								value={montosCuentas[c.id_cuenta_banco] ?? ''}
								oninput={(e) => (montosCuentas = { ...montosCuentas, [c.id_cuenta_banco]: (e.target as HTMLInputElement).value })}
								class="w-28 px-2 py-1 rounded-lg border border-slate-300 text-xs text-right"
							/>
						</div>
					{:else}
						<div class="px-3 py-6 text-center text-xs text-slate-400">Sin cuentas bancarias activas.</div>
					{/each}
				</div>
			</div>

			<!-- Centros de Costo -->
			<div class="border border-slate-200 rounded-xl overflow-hidden">
				<div class="px-3 py-2 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
					<span class="text-xs font-bold text-slate-600 flex items-center gap-1.5"><Building2 size={13} /> Centros de Costo ({centroCostoOptions.length})</span>
					<span class="text-xs font-black text-brand-marine">{formatCurrency(totalCentrosLote)}</span>
				</div>
				<div class="max-h-72 overflow-y-auto divide-y divide-slate-100">
					{#each centroCostoOptions as opt (opt.value)}
						<div class="flex items-center gap-2 px-3 py-2">
							<span class="flex-1 text-xs text-slate-600 truncate">{opt.label}</span>
							<input
								type="number"
								step="0.01"
								value={montosCentros[opt.value] ?? ''}
								oninput={(e) => (montosCentros = { ...montosCentros, [opt.value]: (e.target as HTMLInputElement).value })}
								class="w-28 px-2 py-1 rounded-lg border border-slate-300 text-xs text-right"
							/>
						</div>
					{:else}
						<div class="px-3 py-6 text-center text-xs text-slate-400">Sin centros de costo activos.</div>
					{/each}
				</div>
			</div>
		</div>

		<div class="flex flex-wrap items-center justify-between gap-4 p-4 rounded-xl bg-slate-50 border border-slate-100 mb-4">
			<div class="flex items-center gap-6">
				<div>
					<div class="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Total Centros de Costo</div>
					<div class="text-base font-black text-brand-marine">{formatCurrency(totalCentrosLote)}</div>
				</div>
				<div>
					<div class="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Total Cuentas Bancarias</div>
					<div class="text-base font-black text-brand-marine">{formatCurrency(totalCuentasLote)}</div>
				</div>
				<div>
					<div class="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Diferencia</div>
					<div class={`text-base font-black flex items-center gap-1.5 ${loteCuadra ? 'text-emerald-600' : 'text-red-600'}`}>
						{#if loteCuadra}<ShieldCheck size={16} />{:else}<ShieldAlert size={16} />{/if}
						{formatCurrency(diferenciaLote)}
					</div>
				</div>
			</div>
			<div class="flex flex-col items-end gap-1">
				<button
					type="button"
					onclick={handleGenerarApertura}
					disabled={!puedeGenerarApertura}
					class="px-4 py-2 rounded-lg bg-[#0f3b5e] text-white text-sm font-semibold hover:bg-[#154a73] disabled:opacity-40 disabled:cursor-not-allowed"
				>
					Generar Apertura
				</button>
				{#if !loteCuadra}
					<p class="text-[10px] text-red-500">Ajusta los montos hasta que la diferencia sea S/ 0.00 para poder generar.</p>
				{/if}
			</div>
		</div>

	</div>

	<!-- ── Puntos de corte (historial agrupado, qué corte manda, gráfico por cuenta) ─────────────── -->
	<div class="mt-6">
		<PuntosCorte {aperturas} cuentas={cuentasParaApertura} {centroCostoOptions} onCambio={cargar} />
	</div>
{/if}
