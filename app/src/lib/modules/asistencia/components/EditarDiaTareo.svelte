<script lang="ts">
	/**
	 * Editar un día del tareo (estado y pago reconocido: día completo, medio día, sin pago u otras horas). Lo usan el
	 * Tareo de Obra (TareoSemanal.svelte) y el de Consultoría (TareoConsultoria.svelte). El ajuste se guarda por trabajador,
	 * día y obra/área (tareo_ajuste); "Volver al huellero" lo quita.
	 * Ticket #117: sección "Horas extra" para el jefe inmediato (o un administrador): se pagan por hora sobre su tarifa.
	 * Quien solo es jefe (sin permiso de editar el tareo) ve únicamente esa sección.
	 */
	import { toast } from '$lib/stores/toast';
	import { supabase } from '$lib/supabaseClient';
	import { permisosState } from '$lib/stores/permisos.svelte';
	import { describeError } from '$lib/shared/describeError';
	import { formatCurrency } from '$lib/shared/fieldConfig';
	import { DIAS_SEMANA } from '$lib/modules/personal/services/horarios.service';
	import { nombreCompleto } from '$lib/modules/personal/services/personal.service';
	import { duracion, reloj } from '../services/asistencia.service';
	import { ESTADOS_AJUSTE, fraccionDia, guardarAjuste, quitarAjuste, registrarHorasExtra, type DiaTareo, type EstadoAjuste, type FilaTareo } from '../services/tareo.service';

	let {
		edicion,
		idCentroCosto,
		/** Trabajadores a los que se puede aplicar el mismo día ("Aplicar a todos"); vacío = sin esa opción. */
		idsTodos = [],
		puedeEditarDia = true,
		puedeExtra = false,
		onClose,
		onSaved
	}: {
		edicion: { fila: FilaTareo; dia: DiaTareo } | null;
		idCentroCosto: number | null;
		idsTodos?: number[];
		/** Estado y pago del día (permiso aprobar_tareo). */
		puedeEditarDia?: boolean;
		/** Horas extra (jefe inmediato del trabajador o administrador). */
		puedeExtra?: boolean;
		onClose: () => void;
		onSaved: () => void | Promise<void>;
	} = $props();

	type Pago = 'completo' | 'medio' | 'sin_pago' | 'otras';
	let edEstado = $state<EstadoAjuste>('asistio');
	let edPago = $state<Pago>('completo');
	let edHoras = $state('0');
	let edMinutos = $state('0');
	let edObservacion = $state('');
	let edTodos = $state(false);
	let guardando = $state(false);
	let exHoras = $state('0');
	let exMinutos = $state('0');
	let exObservacion = $state('');
	let guardandoExtra = $state(false);
	const minutosExtra = $derived(Math.max(0, Math.min(1440, Math.round(Number(exHoras || 0) * 60 + Number(exMinutos || 0)))));

	$effect(() => {
		const e = edicion;
		if (!e) return;
		const { fila, dia } = e;
		const base = dia.ajuste?.minutos_reconocidos ?? (dia.minutos || dia.minutosHuellero);
		edEstado = dia.ajuste?.estado ?? (dia.estado === 'feriado' || dia.estado === 'falta' || dia.estado === 'sin_trabajo' ? dia.estado : 'asistio');
		const j = fila.jornadaMin;
		edPago = base === j ? 'completo' : base === Math.round(j / 2) ? 'medio' : base === 0 && dia.estado !== 'pendiente' ? 'sin_pago' : 'otras';
		edHoras = String(Math.floor(base / 60));
		edMinutos = String(base % 60);
		edObservacion = dia.ajuste?.observacion ?? '';
		edTodos = false;
		const ex = dia.extra?.minutos ?? 0;
		exHoras = String(Math.floor(ex / 60));
		exMinutos = String(ex % 60);
		exObservacion = dia.extra?.observacion ?? '';
	});

	async function guardarExtra(minutos: number) {
		if (!edicion || !idCentroCosto || guardandoExtra) return;
		guardandoExtra = true;
		try {
			await registrarHorasExtra(supabase, edicion.fila.personal.id_personal, idCentroCosto, edicion.dia.fecha, minutos, exObservacion);
			toast.success(minutos ? 'Horas extra registradas.' : 'Horas extra quitadas.');
			await onSaved();
		} catch (err) {
			toast.error(`No se pudieron guardar las horas extra. ${describeError(err)}`);
		} finally {
			guardandoExtra = false;
		}
	}

	const minutosEditados = $derived.by(() => {
		if (!edicion) return 0;
		const j = edicion.fila.jornadaMin;
		if (edPago === 'completo') return j;
		if (edPago === 'medio') return Math.round(j / 2);
		if (edPago === 'sin_pago') return 0;
		return Math.max(0, Math.min(1440, Math.round(Number(edHoras || 0) * 60 + Number(edMinutos || 0))));
	});

	function cambiarEstado(v: EstadoAjuste) {
		edEstado = v;
		if (v === 'falta' || v === 'sin_trabajo') edPago = 'sin_pago';
		else if (v === 'feriado') edPago = 'completo';
	}

	const ddmm = (f: string) => `${f.slice(8, 10)}/${f.slice(5, 7)}`;

	async function guardar() {
		if (!edicion || !idCentroCosto || guardando) return;
		guardando = true;
		try {
			const ids = edTodos && idsTodos.length ? idsTodos : [edicion.fila.personal.id_personal];
			await guardarAjuste(supabase, ids, idCentroCosto, edicion.dia.fecha, { estado: edEstado, minutos: minutosEditados, observacion: edObservacion }, permisosState.userName || null);
			toast.success(edTodos ? `Día aplicado a ${ids.length} trabajadores.` : 'Día actualizado.');
			await onSaved();
		} catch (err) {
			toast.error(`No se pudo guardar el día. ${describeError(err)}`);
		} finally {
			guardando = false;
		}
	}

	async function restaurar() {
		if (!edicion || !idCentroCosto) return;
		try {
			await quitarAjuste(supabase, edicion.fila.personal.id_personal, idCentroCosto, edicion.dia.fecha);
			toast.success('El día vuelve a lo que marcó el huellero.');
			await onSaved();
		} catch (err) {
			toast.error(`No se pudo quitar el ajuste. ${describeError(err)}`);
		}
	}
</script>

{#if edicion}
	{@const e = edicion}
	<div class="fixed inset-0 z-[120] flex items-end sm:items-center justify-center bg-slate-900/50 p-0 sm:p-4" role="dialog" aria-modal="true" aria-label="Editar día">
		<div class="w-full sm:max-w-md bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl p-5 flex flex-col gap-3 max-h-[92vh] overflow-y-auto">
			<div>
				<h2 class="text-lg font-bold text-slate-800">Editar día</h2>
				<p class="text-sm text-slate-500">{nombreCompleto(e.fila.personal)} · {DIAS_SEMANA[e.dia.dia - 1]} {ddmm(e.dia.fecha)}</p>
			</div>
			<div class="rounded-xl bg-slate-50 border border-slate-100 p-3 text-xs text-slate-600 flex flex-col gap-1">
				<span><b>Huellero:</b> {e.dia.asistencia?.marcas.length ? e.dia.asistencia.marcas.map((m) => `${reloj(m.minuto)} (${m.huellero})`).join(' · ') : 'sin marcas'}</span>
				<span><b>Horas según huellero:</b> {duracion(e.dia.minutosHuellero)} · jornada {duracion(e.fila.jornadaMin)}</span>
				{#if e.dia.extraHuellero}<span class="text-violet-700"><b>Después de su hora de salida:</b> {duracion(e.dia.extraHuellero)} (no se paga si el jefe no registra horas extra)</span>{/if}
				{#if e.dia.ajuste}<span class="text-amber-700"><i class="fas fa-pen"></i> Modificado{e.dia.ajuste.usuario ? ` por ${e.dia.ajuste.usuario}` : ''}</span>{/if}
			</div>
			{#if puedeEditarDia}
			<label class="flex flex-col gap-1 text-sm font-medium text-slate-700">Estado
				<select value={edEstado} onchange={(ev) => cambiarEstado((ev.currentTarget as HTMLSelectElement).value as EstadoAjuste)} class="px-3 py-2 border border-slate-200 rounded-xl text-sm font-normal">
					{#each ESTADOS_AJUSTE as op}<option value={op.value}>{op.label}</option>{/each}
				</select>
			</label>
			<fieldset class="flex flex-col gap-1.5">
				<legend class="text-sm font-medium text-slate-700 mb-1">Pago reconocido</legend>
				{#each [['completo', `Día completo (${duracion(e.fila.jornadaMin)})`], ['medio', `Medio día (${duracion(Math.round(e.fila.jornadaMin / 2))})`], ['sin_pago', 'Sin pago'], ['otras', 'Otras horas']] as [v, t]}
					<label class="flex items-center gap-2 text-sm text-slate-700"><input type="radio" name="tareo-pago" value={v} bind:group={edPago} /> {t}</label>
				{/each}
				{#if edPago === 'otras'}
					<div class="flex items-center gap-2 pl-6">
						<input type="number" min="0" max="24" bind:value={edHoras} class="w-16 px-2 py-1 border border-slate-200 rounded-lg text-sm" aria-label="Horas" /> h
						<input type="number" min="0" max="59" step="5" bind:value={edMinutos} class="w-16 px-2 py-1 border border-slate-200 rounded-lg text-sm" aria-label="Minutos" /> min
					</div>
				{/if}
			</fieldset>
			<label class="flex flex-col gap-1 text-sm font-medium text-slate-700">Observación
				<input type="text" bind:value={edObservacion} maxlength="200" placeholder="Ej.: lluvia, se paró la obra a mediodía" class="px-3 py-2 border border-slate-200 rounded-xl text-sm font-normal" />
			</label>
			{#if true}
				{@const fr = fraccionDia(minutosEditados, e.fila.jornadaMin)}
				<div class="text-sm text-slate-600">Importe del día: <b class="text-slate-800">{formatCurrency(Math.round(fr * e.fila.tarifaDia * 100) / 100)}</b> <span class="text-xs text-slate-400">({fr === 1 ? '1 día' : fr ? '½ día' : 'sin pago'} × {formatCurrency(e.fila.tarifaDia)} · más de la mitad de la jornada = día completo)</span></div>
			{/if}
			{#if idsTodos.length > 1}
				<label class="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" bind:checked={edTodos} /> Aplicar a todos los trabajadores de esta obra ({idsTodos.length})</label>
			{/if}
			<div class="flex flex-wrap justify-between gap-2 pt-1">
				{#if e.dia.ajuste}
					<button type="button" onclick={restaurar} class="px-3 py-2 rounded-lg text-sm text-slate-600 hover:bg-slate-50 border border-slate-200"><i class="fas fa-rotate-left"></i> Volver al huellero</button>
				{:else}<span></span>{/if}
				<div class="flex gap-2">
					<button type="button" onclick={onClose} class="px-4 py-2 rounded-lg border border-slate-200 text-sm">Cancelar</button>
					<button type="button" onclick={guardar} disabled={guardando} class="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold disabled:opacity-40">{guardando ? 'Guardando…' : 'Guardar día'}</button>
				</div>
			</div>
			{/if}
			{#if puedeExtra}
				<fieldset class="rounded-xl border border-violet-200 bg-violet-50/50 p-3 flex flex-col gap-2">
					<legend class="px-1 text-sm font-semibold text-violet-800">Horas extra <span class="font-normal text-xs text-violet-600">(las registra el jefe inmediato)</span></legend>
					{#if e.dia.extra}<p class="text-xs text-violet-700">Registradas: {duracion(e.dia.extra.minutos)}{e.dia.extra.registrado_por ? ` por ${e.dia.extra.registrado_por}` : ''}</p>{/if}
					<div class="flex items-center gap-2 text-sm">
						<input type="number" min="0" max="24" bind:value={exHoras} class="w-16 px-2 py-1 border border-slate-200 rounded-lg text-sm" aria-label="Horas extra" /> h
						<input type="number" min="0" max="59" step="5" bind:value={exMinutos} class="w-16 px-2 py-1 border border-slate-200 rounded-lg text-sm" aria-label="Minutos extra" /> min
						<span class="text-xs text-slate-500">= {formatCurrency(Math.round((minutosExtra / 60) * e.fila.tarifaHora * 100) / 100)} ({formatCurrency(e.fila.tarifaHora)}/h)</span>
					</div>
					<input type="text" bind:value={exObservacion} maxlength="200" placeholder="Motivo (ej.: vaciado de losa)" class="px-3 py-1.5 border border-slate-200 rounded-lg text-sm" />
					<div class="flex justify-end gap-2">
						{#if e.dia.extra}<button type="button" onclick={() => guardarExtra(0)} disabled={guardandoExtra} class="px-3 py-1.5 rounded-lg border border-slate-200 text-xs text-rose-600">Quitar</button>{/if}
						<button type="button" onclick={() => guardarExtra(minutosExtra)} disabled={guardandoExtra || !minutosExtra} class="px-3 py-1.5 rounded-lg bg-violet-600 text-white text-xs font-semibold disabled:opacity-40">{guardandoExtra ? 'Guardando…' : 'Registrar horas extra'}</button>
					</div>
				</fieldset>
			{/if}
			{#if !puedeEditarDia}
				<div class="flex justify-end"><button type="button" onclick={onClose} class="px-4 py-2 rounded-lg border border-slate-200 text-sm">Cerrar</button></div>
			{/if}
		</div>
	</div>
{/if}
