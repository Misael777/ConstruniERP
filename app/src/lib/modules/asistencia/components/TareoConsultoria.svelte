<script lang="ts">
	/**
	 * Tareo de Consultoría (ticket #118, 24/11/2026; maqueta de la clienta): personal que cobra por quincena o por mes y
	 * cuya obra o área principal no es de obra (consultoría, corporativo, oficina). Por trabajador: días reconocidos del
	 * periodo, sueldo base, ajuste por asistencia (faltas o medio día × S/ por día), bonos y total. Igual que en Obra
	 * (#119): queda "Pendiente" hasta que su jefe inmediato (o un administrador) lo aprueba, y solo lo aprobado se envía a
	 * Cuentas por Pagar (planilla quincenal o mensual de su obra o área). Cálculo: cargarTareoConsultoria (tareo.service.ts).
	 */
	import { supabase } from '$lib/supabaseClient';
	import { toast } from '$lib/stores/toast';
	import { confirmar } from '$lib/stores/confirmDialog.svelte';
	import { hasPermiso, isAdmin, permisosState } from '$lib/stores/permisos.svelte';
	import { describeError } from '$lib/shared/describeError';
	import { formatCurrency } from '$lib/shared/fieldConfig';
	import { DIAS_SEMANA } from '$lib/modules/personal/services/horarios.service';
	import { nombreCompleto, hoyLima } from '$lib/modules/personal/services/personal.service';
	import { sumarDias } from '../services/asistencia.service';
	import EditarDiaTareo from './EditarDiaTareo.svelte';
	import {
		ESTADOS_CELDA,
		ORIGENES,
		cargarTareoConsultoria,
		periodoConsultoria,
		guardarTrabajador,
		aprobarTareo,
		enviarTareo,
		aprobacionDe,
		estaAprobado,
		textoDias,
		type FilaConsultoria,
		type FilaTareo,
		type DiaTareo,
		type GrupoConsultoria,
		type EstadoAprobacion
	} from '../services/tareo.service';

	const hoy = hoyLima();
	const puedeEnviar = hasPermiso('aprobar_tareo');
	const esAdmin = isAdmin();
	const usuario = () => permisosState.userName || null;
	const MODALIDAD: Record<string, string> = { presencial: 'Presencial', remoto: 'Remoto', hibrido: 'Híbrido' };
	const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

	let grupo = $state<GrupoConsultoria>('quincenal');
	let inicio = $state(periodoConsultoria('quincenal', hoy).inicio);
	let modalidad = $state('');
	let lista = $state<FilaConsultoria[]>([]);
	let cargando = $state(false);
	let enviando = $state(false);
	let aprobando = $state(false);
	let abiertos = $state<Record<number, boolean>>({});
	let verPago = $state(false);

	const fin = $derived(periodoConsultoria(grupo, inicio).fin);
	const tituloPeriodo = $derived(
		`${grupo === 'quincenal' ? (inicio.slice(8) === '01' ? '1.ª quincena · ' : '2.ª quincena · ') : ''}${MESES[Number(inicio.slice(5, 7)) - 1]} ${inicio.slice(0, 4)}`
	);

	const esJefeDe = (f: FilaTareo) => permisosState.empleadoId != null && f.personal.id_jefe_inmediato === permisosState.empleadoId;
	const puedeAprobarFila = (c: FilaConsultoria) => !!c.idCentroCosto && (esAdmin || esJefeDe(c.fila));
	const soloMios = $derived(!puedeEnviar && !esAdmin && lista.some((c) => esJefeDe(c.fila)));
	const mostrarPago = $derived(puedeEnviar || verPago);
	const filas = $derived(lista.filter((c) => (!soloMios || esJefeDe(c.fila)) && (!modalidad || (c.fila.personal.modalidad ?? '') === (modalidad === 'sin' ? '' : modalidad))));

	let bonos = $state<Record<number, string>>({});
	let fechaCxp = $state<Record<number, string>>({});
	let monto = $state<Record<number, string>>({});
	let seleccion = $state<Record<number, boolean>>({});
	let fechaComun = $state('');

	const num = (v: string | undefined) => {
		const n = Number(String(v ?? '').replace(',', '.'));
		return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0;
	};
	const r2 = (n: number) => Math.round(n * 100) / 100;
	const totalDe = (c: FilaConsultoria) => r2(c.base + c.ajuste + c.fila.extrasMonto + num(bonos[c.fila.personal.id_personal]));
	const pendienteDe = (c: FilaConsultoria) => Math.max(r2(totalDe(c) - c.fila.enviado), 0);
	const montoDe = (c: FilaConsultoria) => num(monto[c.fila.personal.id_personal]);
	const aprob = (c: FilaConsultoria): EstadoAprobacion => aprobacionDe(c.fila, totalDe(c));
	const aprobada = (c: FilaConsultoria) => estaAprobado(aprob(c));
	const seleccionable = (c: FilaConsultoria) => !!c.idCentroCosto && ((puedeAprobarFila(c) && !aprobada(c) && totalDe(c) > 0) || (puedeEnviar && aprobada(c) && pendienteDe(c) > 0));

	const seleccionados = $derived(filas.filter((c) => seleccion[c.fila.personal.id_personal]));
	const marcables = $derived(filas.filter(seleccionable));
	const todosMarcados = $derived(marcables.length > 0 && marcables.every((c) => seleccion[c.fila.personal.id_personal]));
	const totalPeriodo = $derived(filas.reduce((t, c) => t + totalDe(c), 0));
	const pendientesAprobacion = $derived(filas.filter((c) => !aprobada(c) && totalDe(c) > 0).length);
	const porAprobarSel = $derived(seleccionados.filter((c) => puedeAprobarFila(c) && !aprobada(c) && totalDe(c) > 0));
	const porEnviarSel = $derived(seleccionados.filter((c) => aprobada(c) && pendienteDe(c) > 0));
	const totalSeleccionado = $derived(seleccionados.reduce((t, c) => t + (aprobada(c) ? montoDe(c) : totalDe(c)), 0));

	async function cargar() {
		cargando = true;
		try {
			lista = await cargarTareoConsultoria(supabase, grupo, inicio, hoy);
			const b: Record<number, string> = {};
			const fc: Record<number, string> = {};
			const mo: Record<number, string> = {};
			for (const c of lista) {
				const id = c.fila.personal.id_personal;
				b[id] = c.fila.bonos ? String(c.fila.bonos) : '';
				fc[id] = c.fila.fechaCxp ?? '';
				mo[id] = c.fila.pendiente ? c.fila.pendiente.toFixed(2) : '';
			}
			bonos = b;
			fechaCxp = fc;
			monto = mo;
			seleccion = {};
		} catch (err) {
			toast.error(`No se pudo cargar el tareo de Consultoría. ${describeError(err)}`);
			lista = [];
		} finally {
			cargando = false;
		}
	}
	$effect(() => {
		void grupo;
		void inicio;
		cargar();
	});

	function elegirGrupo(g: GrupoConsultoria) {
		if (g === grupo) return;
		grupo = g;
		inicio = periodoConsultoria(g, inicio).inicio;
	}

	function moverPeriodo(paso: 1 | -1) {
		if (grupo === 'mensual') {
			const ref = paso === 1 ? sumarDias(fin, 1) : sumarDias(inicio, -1);
			inicio = periodoConsultoria('mensual', ref).inicio;
		} else {
			inicio = periodoConsultoria('quincenal', paso === 1 ? sumarDias(fin, 1) : sumarDias(inicio, -1)).inicio;
		}
	}

	async function guardarFila(c: FilaConsultoria) {
		if (!puedeEnviar || !c.idCentroCosto) return;
		const f = c.fila;
		const id = f.personal.id_personal;
		if (num(bonos[id]) === f.bonos && (fechaCxp[id] || null) === f.fechaCxp) return;
		try {
			await guardarTrabajador(supabase, c.idCentroCosto, inicio, id, num(bonos[id]), fechaCxp[id] || null, grupo);
			f.bonos = num(bonos[id]);
			f.fechaCxp = fechaCxp[id] || null;
			monto[id] = pendienteDe(c) ? pendienteDe(c).toFixed(2) : '';
		} catch (err) {
			toast.error(`No se pudo guardar. ${describeError(err)}`);
		}
	}

	async function aplicarFechaComun() {
		if (!fechaComun) {
			toast.error('Elige primero la fecha común de CxP.');
			return;
		}
		const objetivo = (seleccionados.length ? seleccionados : filas).filter((c) => c.idCentroCosto);
		for (const c of objetivo) fechaCxp[c.fila.personal.id_personal] = fechaComun;
		await Promise.all(objetivo.map((c) => guardarFila(c)));
		toast.success(`Fecha CxP aplicada a ${objetivo.length} trabajador${objetivo.length === 1 ? '' : 'es'}.`);
	}

	/** Las RPC van por obra/área (cada trabajador se guarda en la de su obra o área principal). */
	function porCentro<T extends FilaConsultoria>(items: T[]): Map<number, T[]> {
		const m = new Map<number, T[]>();
		for (const c of items) if (c.idCentroCosto) m.set(c.idCentroCosto, [...(m.get(c.idCentroCosto) ?? []), c]);
		return m;
	}

	async function aprobar(items: FilaConsultoria[]) {
		if (aprobando) return;
		const sel = items.filter((c) => puedeAprobarFila(c) && !aprobada(c) && totalDe(c) > 0);
		if (!sel.length) {
			toast.error('No hay trabajadores por aprobar en la selección.');
			return;
		}
		const suma = sel.reduce((t, c) => t + totalDe(c), 0);
		const ok = await confirmar({
			title: 'Aprobar tareo',
			message: `Se aprobará el tareo de ${sel.length} trabajador${sel.length === 1 ? '' : 'es'} por ${formatCurrency(suma)} (${tituloPeriodo}). Si después cambia la asistencia o los bonos, habrá que aprobarlo de nuevo.`,
			confirmLabel: 'Aprobar',
			danger: false
		});
		if (!ok) return;
		aprobando = true;
		try {
			let n = 0;
			for (const [idCentro, grupoFilas] of porCentro(sel)) n += await aprobarTareo(supabase, idCentro, inicio, grupoFilas.map((c) => ({ fila: c.fila, total: totalDe(c) })), grupo);
			toast.success(`Tareo aprobado: ${n} trabajador${n === 1 ? '' : 'es'}.`);
			await cargar();
		} catch (err) {
			toast.error(`No se pudo aprobar. ${describeError(err)}`);
			await cargar();
		} finally {
			aprobando = false;
		}
	}

	async function enviar(items: FilaConsultoria[]) {
		if (enviando) return;
		const sinAprobar = items.filter((c) => !aprobada(c)).length;
		const envios = items
			.filter((c) => aprobada(c) && pendienteDe(c) > 0 && montoDe(c) > 0)
			.map((c) => {
				const id = c.fila.personal.id_personal;
				return { c, envio: { fila: { ...c.fila, bonos: num(bonos[id]), total: totalDe(c) }, monto: montoDe(c), fechaCxp: fechaCxp[id] || fechaComun || fin } };
			});
		if (!envios.length) {
			toast.error(sinAprobar ? 'Lo seleccionado aún no tiene la aprobación del jefe inmediato.' : 'No hay montos por enviar.');
			return;
		}
		const excede = envios.find((e) => e.envio.monto - pendienteDe(e.c) > 0.005);
		if (excede) {
			toast.error(`${nombreCompleto(excede.c.fila.personal)}: el monto a enviar supera lo pendiente (${formatCurrency(pendienteDe(excede.c))}).`);
			return;
		}
		const suma = envios.reduce((t, e) => t + e.envio.monto, 0);
		const ok = await confirmar({
			title: 'Enviar a Cuentas por Pagar',
			message: `Se enviarán ${formatCurrency(suma)} de ${envios.length} trabajador${envios.length === 1 ? '' : 'es'} aprobado${envios.length === 1 ? '' : 's'} a Cuentas por Pagar (planilla ${grupo} de su obra o área, proveedor "Planilla de personal").${sinAprobar ? ` ${sinAprobar} seleccionado${sinAprobar === 1 ? '' : 's'} sin aprobar no se envía${sinAprobar === 1 ? '' : 'n'}.` : ''}`,
			confirmLabel: 'Enviar',
			danger: false
		});
		if (!ok) return;
		enviando = true;
		try {
			let n = 0;
			const porC = new Map<number, typeof envios>();
			for (const e of envios) porC.set(e.c.idCentroCosto!, [...(porC.get(e.c.idCentroCosto!) ?? []), e]);
			for (const [idCentro, es] of porC) n += await enviarTareo(supabase, idCentro, inicio, es.map((e) => e.envio), usuario(), grupo);
			toast.success(`Enviado a Cuentas por Pagar: ${n} trabajador${n === 1 ? '' : 'es'}, ${formatCurrency(suma)}.`);
			await cargar();
		} catch (err) {
			toast.error(`No se pudo enviar. ${describeError(err)}`);
			await cargar();
		} finally {
			enviando = false;
		}
	}

	let edicion = $state<{ fila: FilaTareo; dia: DiaTareo; idCentro: number | null } | null>(null);
	const ddmm = (f: string) => `${f.slice(8, 10)}/${f.slice(5, 7)}`;
	const fmtDias = (d: number) => (Number.isInteger(d) ? String(d) : d.toFixed(1).replace('.5', '½').replace('.0', ''));
</script>

{#snippet chipAprobacion(c: FilaConsultoria)}
	{@const e = aprob(c)}
	<div class="flex flex-col items-center gap-1 min-w-[96px]">
		{#if e === 'aprobado' || e === 'previo'}
			<span class="inline-flex flex-col items-center rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-1 text-emerald-700">
				<span class="text-xs font-bold"><i class="fas fa-circle-check"></i> Aprobado</span>
				<span class="text-[10px] truncate max-w-[120px]">{e === 'previo' ? 'enviado antes' : (c.fila.aprobadoPor ?? 'Jefe inmediato')}</span>
			</span>
		{:else if !c.idCentroCosto}
			<span class="text-[11px] text-amber-700" title="Asígnale su obra o área principal en Personal">Sin obra o área</span>
		{:else if totalDe(c) <= 0}
			<span class="text-[11px] text-slate-300">—</span>
		{:else}
			<span class={`text-xs font-semibold ${e === 'cambio' ? 'text-amber-700' : 'text-orange-600'}`}>{e === 'cambio' ? 'Cambió: aprobar de nuevo' : 'Pendiente'}</span>
			{#if puedeAprobarFila(c)}
				<button type="button" onclick={() => aprobar([c])} disabled={aprobando} class="px-2.5 py-1 rounded-lg bg-orange-500 text-white text-[11px] font-semibold hover:bg-orange-600 disabled:opacity-40">Aprobar tareo</button>
			{/if}
		{/if}
	</div>
{/snippet}

<div class="flex flex-col gap-4">
	<div class="bg-white border border-slate-100 rounded-2xl shadow-sm p-4 flex flex-col gap-3">
		<div class="flex flex-wrap items-end gap-4">
			<div class="flex flex-col gap-1.5">
				<span class="text-sm font-semibold text-blue-800">Periodo de pago</span>
				<div class="flex rounded-xl border border-slate-200 bg-white p-0.5 text-sm">
					<button type="button" onclick={() => elegirGrupo('quincenal')} class={`px-4 py-1.5 rounded-lg font-semibold ${grupo === 'quincenal' ? 'bg-orange-500 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>Quincenal</button>
					<button type="button" onclick={() => elegirGrupo('mensual')} class={`px-4 py-1.5 rounded-lg font-semibold ${grupo === 'mensual' ? 'bg-orange-500 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>Mensual</button>
				</div>
			</div>
			<div class="flex flex-col gap-1.5">
				<span class="text-sm font-semibold text-blue-800">Periodo</span>
				<div class="flex items-center gap-1">
					<button type="button" onclick={() => moverPeriodo(-1)} class="px-2.5 py-2 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50" aria-label="Periodo anterior"><i class="fas fa-chevron-left"></i></button>
					<span class="px-3 py-2 rounded-xl border border-slate-200 text-sm font-semibold text-slate-800 min-w-[220px] text-center"><i class="fas fa-calendar text-slate-400 mr-1"></i> {tituloPeriodo} <span class="font-normal text-slate-400">({ddmm(inicio)} – {ddmm(fin)})</span></span>
					<button type="button" onclick={() => moverPeriodo(1)} class="px-2.5 py-2 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50" aria-label="Periodo siguiente"><i class="fas fa-chevron-right"></i></button>
				</div>
			</div>
			<label class="flex flex-col gap-1.5 text-sm font-semibold text-blue-800">Modalidad
				<select bind:value={modalidad} class="px-3 py-2 border border-slate-200 rounded-xl text-sm font-normal text-slate-800 min-w-[160px]">
					<option value="">Todas</option>
					<option value="presencial">Presencial</option>
					<option value="remoto">Remoto</option>
					<option value="hibrido">Híbrido</option>
					<option value="sin">Sin indicar</option>
				</select>
			</label>
		</div>
		<div class="flex flex-wrap items-end gap-3 border-t border-slate-100 pt-3">
			{#if puedeEnviar}
				<div class="flex flex-col gap-1.5">
					<label for="cons-fecha-comun" class="text-xs font-medium text-slate-600">Fecha común CxP</label>
					<input id="cons-fecha-comun" type="date" bind:value={fechaComun} class="px-3 py-1.5 border border-slate-200 rounded-lg text-sm" />
				</div>
				<button type="button" onclick={aplicarFechaComun} class="px-3 py-1.5 rounded-lg bg-orange-500 text-white text-sm font-semibold hover:bg-orange-600">Aplicar a {seleccionados.length ? `seleccionados (${seleccionados.length})` : 'todos'}</button>
			{:else}
				<button type="button" onclick={() => (verPago = !verPago)} class="px-3 py-1.5 rounded-lg border border-slate-200 text-sm text-slate-600 hover:bg-slate-50 flex items-center gap-2"><i class={`fas ${verPago ? 'fa-eye-slash' : 'fa-eye'}`}></i> {verPago ? 'Ocultar' : 'Ver'} datos de pago</button>
			{/if}
			{#if pendientesAprobacion}<span class="rounded-lg bg-orange-50 border border-orange-200 px-3 py-1 font-semibold text-orange-700 text-sm">Pendientes de aprobación: {pendientesAprobacion}</span>{/if}
			<span class="text-xs text-blue-700"><i class="fas fa-circle-info"></i> Aprobación a cargo del jefe inmediato.</span>
			{#if cargando}<i class="fas fa-spinner fa-spin text-blue-500"></i>{/if}
		</div>
	</div>

	{#if !filas.length && !cargando}
		<div class="bg-white border border-slate-100 rounded-2xl shadow-sm py-12 text-center text-sm text-slate-400">
			No hay personal de Consultoría, Corporativo u oficina que cobre {grupo === 'quincenal' ? 'por quincena' : 'por mes'}{modalidad ? ' con esa modalidad' : ''}.
		</div>
	{:else if filas.length}
		<div class="bg-white border border-slate-100 rounded-2xl shadow-sm overflow-x-auto">
			<table class="w-full text-sm">
				<thead class="bg-slate-50 text-slate-600 text-xs">
					<tr>
						<th class="px-2 py-2 w-8"><input type="checkbox" checked={todosMarcados} disabled={!marcables.length} onchange={(e) => { const v = (e.currentTarget as HTMLInputElement).checked; const s: Record<number, boolean> = {}; if (v) for (const c of marcables) s[c.fila.personal.id_personal] = true; seleccion = s; }} aria-label="Seleccionar todos" /></th>
						<th class="px-2 py-2 text-left min-w-[170px]">Colaborador</th>
						<th class="px-2 py-2 text-left">Cargo</th>
						<th class="px-2 py-2 text-left">Modalidad</th>
						<th class="px-2 py-2 text-right">Días reconocidos</th>
						<th class="px-2 py-2 text-right">Base del periodo S/</th>
						<th class="px-2 py-2 text-right">Ajuste por asistencia S/</th>
						<th class="px-2 py-2 text-right">Bonos S/</th>
						<th class="px-2 py-2 text-right">Total S/</th>
						<th class="px-2 py-2 text-center">Aprobación</th>
						{#if mostrarPago}
							<th class="px-2 py-2 text-left">Fecha CxP</th>
							<th class="px-2 py-2 text-right">Monto a enviar S/</th>
						{/if}
					</tr>
				</thead>
				<tbody class="divide-y divide-slate-100">
					{#each filas as c (c.fila.personal.id_personal)}
						{@const id = c.fila.personal.id_personal}
						<tr class="align-middle">
							<td class="px-2 py-2 text-center"><input type="checkbox" bind:checked={seleccion[id]} disabled={!seleccionable(c)} aria-label={`Seleccionar ${nombreCompleto(c.fila.personal)}`} /></td>
							<td class="px-2 py-2">
								<div class="font-semibold text-slate-800">{nombreCompleto(c.fila.personal)}</div>
								<div class="text-[11px] text-blue-600">{c.fila.personal.tipo_documento} {c.fila.personal.numero_documento ?? ''}</div>
								<button type="button" onclick={() => (abiertos[id] = !abiertos[id])} class="text-[11px] text-blue-600 hover:underline"><i class="fas fa-cloud"></i> {abiertos[id] ? 'Ocultar' : 'Ver'} asistencia</button>
								{#if c.centro}<div class="text-[10px] text-slate-400 truncate max-w-[200px]">{c.centro}</div>{/if}
								{#if c.fila.sinMonto}<div class="text-[11px] text-amber-700"><i class="fas fa-triangle-exclamation"></i> Sin monto de pago en Personal</div>{/if}
							</td>
							<td class="px-2 py-2 text-xs text-slate-600">{c.fila.personal.cargo ?? ''}</td>
							<td class="px-2 py-2 text-xs text-slate-600">{MODALIDAD[c.fila.personal.modalidad ?? ''] ?? '—'}</td>
							<td class="px-2 py-2 text-right tabular-nums" title={`${textoDias(c.diasReconocidos)} de ${c.diasBase}`}>{fmtDias(c.diasReconocidos)}</td>
							<td class="px-2 py-2 text-right tabular-nums">{formatCurrency(c.base)}</td>
							<td class={`px-2 py-2 text-right tabular-nums ${c.ajuste < 0 ? 'text-rose-600' : ''}`}>
								{formatCurrency(c.ajuste)}
								{#if c.fila.extrasMonto}<div class="text-[11px] text-violet-700" title="Horas extra registradas por el jefe">+ extra {formatCurrency(c.fila.extrasMonto)}</div>{/if}
							</td>
							<td class="px-2 py-2 text-right">
								{#if puedeEnviar && c.idCentroCosto}
									<input type="text" inputmode="decimal" bind:value={bonos[id]} onblur={() => guardarFila(c)} placeholder="0.00" class="w-20 px-1.5 py-1 border border-slate-200 rounded-lg text-right text-xs" aria-label="Bonos" />
								{:else}{formatCurrency(c.fila.bonos)}{/if}
							</td>
							<td class="px-2 py-2 text-right tabular-nums font-bold text-slate-900">
								{formatCurrency(totalDe(c))}
								{#if mostrarPago && c.fila.enviado}<div class="text-[11px] font-normal text-emerald-700">Enviado {formatCurrency(c.fila.enviado)}</div>{/if}
							</td>
							<td class="px-2 py-2 text-center">{@render chipAprobacion(c)}</td>
							{#if mostrarPago}
								<td class="px-2 py-2">
									{#if puedeEnviar && c.idCentroCosto}
										<input type="date" bind:value={fechaCxp[id]} onchange={() => guardarFila(c)} class="w-[118px] px-1 py-1 border border-slate-200 rounded-lg text-xs" aria-label="Fecha CxP" />
									{:else}{c.fila.fechaCxp ? ddmm(c.fila.fechaCxp) : '—'}{/if}
								</td>
								<td class="px-2 py-2 text-right">
									{#if puedeEnviar && aprobada(c) && pendienteDe(c) > 0}
										<input type="text" inputmode="decimal" bind:value={monto[id]} class="w-24 px-1.5 py-1 border border-slate-200 rounded-lg text-right text-xs" aria-label="Monto a enviar" />
									{:else if pendienteDe(c) <= 0 && c.fila.enviado}
										<span class="text-[11px] text-emerald-700 font-semibold"><i class="fas fa-check"></i> Enviado</span>
									{:else}<span class="text-xs text-slate-500 tabular-nums">{formatCurrency(pendienteDe(c))}</span>{/if}
								</td>
							{/if}
						</tr>
						{#if abiertos[id]}
							<tr class="bg-slate-50/60">
								<td colspan={mostrarPago ? 12 : 10} class="px-4 py-3">
									<div class="flex flex-wrap gap-1">
										{#each c.fila.dias as d (d.fecha)}
											{@const est = ESTADOS_CELDA[d.estado]}
											{@const editable = (puedeEnviar || puedeAprobarFila(c)) && !!c.idCentroCosto && d.estado !== 'por_venir' && d.estado !== 'fuera_contrato'}
											<button
												type="button"
												disabled={!editable}
												onclick={() => editable && (edicion = { fila: c.fila, dia: d, idCentro: c.idCentroCosto })}
												title={`${DIAS_SEMANA[d.dia - 1]} ${ddmm(d.fecha)} · ${est.texto || 'Por venir'}${d.origen ? ` · ${ORIGENES[d.origen].texto}` : ''}${editable ? ' — clic para editar' : ''}`}
												class={`w-12 h-14 rounded-lg border flex flex-col items-center justify-center text-center ${est.clase} ${editable ? 'hover:ring-1 hover:ring-blue-300' : ''}`}
											>
												<span class="text-[9px] text-slate-500">{DIAS_SEMANA[d.dia - 1].slice(0, 2)} {d.fecha.slice(8)}</span>
												<span class="text-sm font-extrabold leading-none">{d.fraccion ? (d.fraccion === 1 ? '1' : '½') : d.estado === 'falta' ? 'F' : d.estado === 'por_venir' ? '' : '—'}</span>
												{#if d.extra}<span class="text-[9px] font-bold text-violet-700">+{Math.floor(d.extra.minutos / 60)}:{String(d.extra.minutos % 60).padStart(2, '0')}</span>{:else if d.origen}<i class={`fas ${ORIGENES[d.origen].icono} ${ORIGENES[d.origen].color} text-[9px]`}></i>{/if}
											</button>
										{/each}
									</div>
									<p class="mt-2 text-[11px] text-slate-500">Se descuentan las faltas del horario{c.fila.personal.modalidad === 'remoto' ? ' (trabajo remoto: solo los días editados como falta)' : ''}, los medios días y los días fuera de contrato. {puedeEnviar ? 'Toca un día para corregirlo.' : ''}</p>
								</td>
							</tr>
						{/if}
					{/each}
				</tbody>
			</table>
		</div>

		<div class="sticky bottom-0 bg-white border border-slate-200 rounded-2xl shadow-lg p-3 flex flex-col lg:flex-row lg:items-center gap-3">
			<div class="flex flex-wrap gap-x-5 gap-y-1 text-sm flex-1">
				<span class="text-lg font-bold text-orange-600">Total del periodo {formatCurrency(totalPeriodo)}</span>
				{#if seleccionados.length}<span class="text-slate-500">Seleccionados ({seleccionados.length}) <b class="text-blue-700">{formatCurrency(totalSeleccionado)}</b></span>{/if}
			</div>
			<div class="flex flex-wrap gap-2">
				{#if esAdmin || lista.some((c) => esJefeDe(c.fila))}
					<button type="button" onclick={() => aprobar(seleccionados)} disabled={aprobando || !porAprobarSel.length} class="px-3 py-2 rounded-xl border-2 border-orange-500 text-orange-600 text-sm font-bold hover:bg-orange-50 disabled:opacity-40"><i class="fas fa-check"></i> {aprobando ? 'Aprobando…' : `Aprobar seleccionados${porAprobarSel.length ? ` (${porAprobarSel.length})` : ''}`}</button>
				{/if}
				{#if puedeEnviar}
					<button type="button" onclick={() => enviar(seleccionados)} disabled={enviando || !porEnviarSel.length} class="px-3 py-2 rounded-xl bg-blue-600 text-white text-sm font-semibold disabled:opacity-40" title="Requiere aprobación del jefe inmediato">{enviando ? 'Enviando…' : `Enviar seleccionados a cuentas por pagar${porEnviarSel.length ? ` (${porEnviarSel.length})` : ''}`}</button>
				{/if}
			</div>
		</div>
	{/if}
</div>

<EditarDiaTareo
	edicion={edicion ? { fila: edicion.fila, dia: edicion.dia } : null}
	idCentroCosto={edicion?.idCentro ?? null}
	puedeEditarDia={puedeEnviar}
	puedeExtra={!!edicion && (esAdmin || esJefeDe(edicion.fila))}
	onClose={() => (edicion = null)}
	onSaved={async () => {
		edicion = null;
		await cargar();
	}}
/>
