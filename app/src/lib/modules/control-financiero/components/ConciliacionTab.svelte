<script lang="ts">
	import { onMount } from 'svelte';
	import { supabase } from '$lib/supabaseClient';
	import { toast } from '$lib/stores/toast';
	import { permisosState } from '$lib/stores/permisos.svelte';
	import { formatCurrency } from '$lib/shared/fieldConfig';
	import { getCuentaBancoOptions } from '$lib/modules/cuentas-bancarias/services/cuentaBanco.service';
	import { getCentroCostoOptions } from '$lib/modules/transacciones/services/transacciones.service';
	import {
		getSaldoTotalCentrosCosto,
		getSaldoTotalCuentasBancarias,
		getSaldoInicialTotalCuentasBancarias,
		registrarConciliacionInterna,
		registrarConciliacionBancoManual,
		getConciliaciones,
		crearAperturaFinanciera,
		getAperturasFinancieras,
		type ConciliacionFinanciera,
		type AperturaFinanciera,
		type FuenteApertura
	} from '../services/conciliacion.service';
	import { Scale, Landmark, Building2, RefreshCw, ShieldCheck, ShieldAlert, Archive } from '@lucide/svelte';

	let loading = $state(true);
	let saldoCentros = $state(0);
	let saldoBancos = $state(0);
	let saldoInicial = $state(0);
	let registrandoInterna = $state(false);

	let conciliaciones = $state<ConciliacionFinanciera[]>([]);
	let aperturas = $state<AperturaFinanciera[]>([]);
	let cuentaOptions = $state<{ value: string; label: string }[]>([]);
	let cuentasParaApertura = $state<{ id_cuenta_banco: number; numero_cuenta: string; titular_cuenta: string }[]>([]);
	let centroCostoOptions = $state<{ value: string; label: string }[]>([]);

	// Conciliación bancaria manual
	let fechaManual = $state(new Date().toISOString().slice(0, 10));
	let cuentaManual = $state('');
	let montoBancoManual = $state('');
	let observacionesManual = $state('');
	let registrandoManual = $state(false);

	// Apertura financiera
	let fechaCorte = $state(new Date().toISOString().slice(0, 10));
	let montoApertura = $state('');
	let ambitoApertura = $state<'global' | 'cuenta_banco' | 'centro_costo'>('global');
	let idCuentaApertura = $state('');
	let idCentroCostoApertura = $state('');
	let fuenteApertura = $state<FuenteApertura>('estado_de_cuenta_bancario');
	let observacionesApertura = $state('');
	let guardandoApertura = $state(false);

	const FUENTE_LABELS: Record<FuenteApertura, string> = {
		estado_de_cuenta_bancario: 'Estado de cuenta bancario',
		migracion_inicial: 'Migración inicial',
		auditoria_externa: 'Auditoría externa',
		otro: 'Otro'
	};

	async function cargar() {
		loading = true;
		try {
			const [sc, sb, si, conc, apert, opciones, cuentas, centros] = await Promise.all([
				getSaldoTotalCentrosCosto(supabase),
				getSaldoTotalCuentasBancarias(supabase),
				getSaldoInicialTotalCuentasBancarias(supabase),
				getConciliaciones(supabase),
				getAperturasFinancieras(supabase),
				getCuentaBancoOptions(supabase),
				supabase.from('cuenta_banco').select('id_cuenta_banco, numero_cuenta, titular_cuenta').eq('activo', true).then((r) => r.data ?? []),
				getCentroCostoOptions(supabase)
			]);
			centroCostoOptions = centros;
			saldoCentros = sc;
			saldoBancos = sb;
			saldoInicial = si;
			conciliaciones = conc;
			aperturas = apert;
			cuentaOptions = opciones;
			cuentasParaApertura = cuentas as any[];
		} catch (err: any) {
			toast.error(err?.message ?? 'No se pudo cargar la conciliación');
		} finally {
			loading = false;
		}
	}

	onMount(cargar);

	// Cuenta Bancaria arranca con saldo_inicial (dinero que YA estaba antes del ERP) mientras que
	// Centro de Costo siempre arranca en 0 — sin restar el saldo inicial, cualquier cuenta con plata
	// real al empezar mostraría una "diferencia" que no es un error, solo el punto de partida.
	const saldoBancosAjustado = $derived(saldoBancos - saldoInicial);
	const diferenciaInterna = $derived(saldoCentros - saldoBancosAjustado);

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

	async function handleGuardarApertura() {
		const monto = Number(montoApertura);
		if (!fechaCorte || !Number.isFinite(monto)) {
			toast.error('Completa la fecha de corte y el monto.');
			return;
		}
		guardandoApertura = true;
		try {
			const result = await crearAperturaFinanciera(
				supabase,
				{
					fecha_corte: fechaCorte,
					monto,
					id_cuenta_banco: ambitoApertura === 'cuenta_banco' && idCuentaApertura ? Number(idCuentaApertura) : null,
					id_centro_costo: ambitoApertura === 'centro_costo' && idCentroCostoApertura ? Number(idCentroCostoApertura) : null,
					fuente: fuenteApertura,
					observaciones: observacionesApertura || null
				},
				permisosState.userName || null
			);
			if (result.success) {
				toast.success(result.message);
				montoApertura = '';
				observacionesApertura = '';
				await cargar();
			} else {
				toast.error(result.message);
			}
		} catch (err: any) {
			toast.error(err?.message ?? 'No se pudo registrar la apertura financiera');
		} finally {
			guardandoApertura = false;
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
		<p class="text-[11px] text-slate-400 mb-4">Automático, sin datos manuales — compara dos totales que ya calcula el ERP. La cuenta bancaria se compara ajustada por su saldo inicial (Centro de Costo siempre arranca en 0, Cuenta Bancaria no).</p>
		<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
			<div>
				<div class="flex items-center gap-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider"><Building2 size={11} /> Saldo Centros de Costo</div>
				<div class="text-xl font-black text-brand-marine mt-0.5">{formatCurrency(saldoCentros)}</div>
			</div>
			<div>
				<div class="flex items-center gap-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider"><Landmark size={11} /> Cuentas Bancarias (ajustado)</div>
				<div class="text-xl font-black text-brand-marine mt-0.5">{formatCurrency(saldoBancosAjustado)}</div>
				<div class="text-[10px] text-slate-400">{formatCurrency(saldoBancos)} real − {formatCurrency(saldoInicial)} saldo inicial</div>
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
				<select id="cf-cuenta-manual" bind:value={cuentaManual} class="px-3 py-2 rounded-lg border border-slate-300 text-sm bg-white">
					<option value="">Consolidado (todas las cuentas)</option>
					{#each cuentaOptions as opt}
						<option value={opt.value}>{opt.label}</option>
					{/each}
				</select>
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
		<p class="text-[11px] text-slate-400 mb-4">Ancla histórica de auditoría — se guarda como referencia, nunca participa en el cálculo de ningún saldo en vivo del ERP.</p>
		<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-4">
			<div class="flex flex-col gap-1">
				<label for="af-fecha" class="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Fecha de Corte</label>
				<input id="af-fecha" type="date" bind:value={fechaCorte} class="px-3 py-2 rounded-lg border border-slate-300 text-sm" />
				<p class="text-[10px] text-slate-400">Fecha "a la cual" este monto se considera correcto — un ancla histórica, no se recalcula después.</p>
			</div>
			<div class="flex flex-col gap-1">
				<label for="af-monto" class="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Monto</label>
				<input id="af-monto" type="number" step="0.01" bind:value={montoApertura} placeholder="0.00" class="px-3 py-2 rounded-lg border border-slate-300 text-sm" />
			</div>
			<div class="flex flex-col gap-1">
				<label for="af-fuente" class="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Fuente</label>
				<select id="af-fuente" bind:value={fuenteApertura} class="px-3 py-2 rounded-lg border border-slate-300 text-sm bg-white">
					{#each Object.entries(FUENTE_LABELS) as [value, label]}
						<option {value}>{label}</option>
					{/each}
				</select>
			</div>
			<div class="flex flex-col gap-1">
				<label for="af-ambito" class="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Ámbito</label>
				<select
					id="af-ambito"
					bind:value={ambitoApertura}
					onchange={() => {
						idCuentaApertura = '';
						idCentroCostoApertura = '';
					}}
					class="px-3 py-2 rounded-lg border border-slate-300 text-sm bg-white"
				>
					<option value="global">Global (todo el ERP)</option>
					<option value="cuenta_banco">Una cuenta bancaria</option>
					<option value="centro_costo">Un centro de costo</option>
				</select>
			</div>
			{#if ambitoApertura === 'cuenta_banco'}
				<div class="flex flex-col gap-1">
					<label for="af-cuenta" class="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Cuenta Bancaria</label>
					<select id="af-cuenta" bind:value={idCuentaApertura} class="px-3 py-2 rounded-lg border border-slate-300 text-sm bg-white">
						<option value="">Selecciona una cuenta...</option>
						{#each cuentasParaApertura as c}
							<option value={String(c.id_cuenta_banco)}>{c.titular_cuenta} - {c.numero_cuenta}</option>
						{/each}
					</select>
				</div>
			{:else if ambitoApertura === 'centro_costo'}
				<div class="flex flex-col gap-1">
					<label for="af-centro" class="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Centro de Costo</label>
					<select id="af-centro" bind:value={idCentroCostoApertura} class="px-3 py-2 rounded-lg border border-slate-300 text-sm bg-white">
						<option value="">Selecciona un centro de costo...</option>
						{#each centroCostoOptions as opt}
							<option value={opt.value}>{opt.label}</option>
						{/each}
					</select>
				</div>
			{/if}
			<div class="flex flex-col gap-1">
				<label for="af-obs" class="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Observaciones</label>
				<input id="af-obs" type="text" bind:value={observacionesApertura} class="px-3 py-2 rounded-lg border border-slate-300 text-sm" />
			</div>
		</div>
		<button type="button" onclick={handleGuardarApertura} disabled={guardandoApertura} class="px-4 py-2 rounded-lg border border-slate-300 text-slate-600 text-sm font-semibold hover:bg-slate-50 disabled:opacity-50 mb-4">
			Registrar apertura
		</button>

		<div class="overflow-x-auto">
			<table class="w-full text-xs text-left whitespace-nowrap">
				<thead class="bg-slate-50 border-b border-slate-200 text-slate-500 font-bold uppercase tracking-wide text-[10px]">
					<tr>
						<th class="px-3 py-2.5">Fecha de Corte</th>
						<th class="px-3 py-2.5 text-right">Monto</th>
						<th class="px-3 py-2.5">Ámbito</th>
						<th class="px-3 py-2.5">Fuente</th>
						<th class="px-3 py-2.5">Observaciones</th>
					</tr>
				</thead>
				<tbody class="divide-y divide-slate-100">
					{#each aperturas as a (a.id_apertura)}
						<tr class="hover:bg-slate-50/70">
							<td class="px-3 py-2">{a.fecha_corte}</td>
							<td class="px-3 py-2 text-right">{formatCurrency(a.monto)}</td>
							<td class="px-3 py-2">
								{#if a.id_cuenta_banco}
									{cuentasParaApertura.find((c) => c.id_cuenta_banco === a.id_cuenta_banco)?.numero_cuenta ?? `Cuenta #${a.id_cuenta_banco}`}
								{:else if a.id_centro_costo}
									{centroCostoOptions.find((c) => c.value === String(a.id_centro_costo))?.label ?? `Centro de Costo #${a.id_centro_costo}`}
								{:else}
									Global
								{/if}
							</td>
							<td class="px-3 py-2">{FUENTE_LABELS[a.fuente]}</td>
							<td class="px-3 py-2 text-slate-500">{a.observaciones ?? '—'}</td>
						</tr>
					{:else}
						<tr><td colspan="5" class="px-3 py-6 text-center text-slate-400">Sin aperturas registradas todavía.</td></tr>
					{/each}
				</tbody>
			</table>
		</div>
	</div>
{/if}
