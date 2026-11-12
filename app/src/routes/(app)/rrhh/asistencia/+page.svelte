<script lang="ts">
	/**
	 * Asistencia por trabajador: eliges trabajador y periodo y se ve el día a día (entrada, salida, horas,
	 * tardanza, horas extra, faltas) contra su horario, con los totales del periodo. El periodo por defecto
	 * sigue su periodicidad de pago. Se abre también desde Personal (?p=id_personal).
	 * Pestaña "Tareo semanal por obra" (?tab=tareo): ver TareoSemanal.svelte.
	 * Pestaña "Configuración" (?tab=config&p=id): horario, métodos de registro, huelleros y consentimiento del
	 * trabajador (ConfiguracionAsistencia.svelte; antes estaba en la ficha de Personal).
	 */
	import { onMount } from 'svelte';
	import { fade } from 'svelte/transition';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { supabase } from '$lib/supabaseClient';
	import { toast } from '$lib/stores/toast';
	import { describeError } from '$lib/shared/describeError';
	import ResponsiveDataView from '$lib/shared/components/ResponsiveDataView.svelte';
	import SelectConSaldo from '$lib/shared/components/SelectConSaldo.svelte';
	import TareoSemanal from '$lib/modules/asistencia/components/TareoSemanal.svelte';
	import ConfiguracionAsistencia from '$lib/modules/asistencia/components/ConfiguracionAsistencia.svelte';
	import { getPersonal, nombreCompleto, hoyLima, type Personal } from '$lib/modules/personal/services/personal.service';
	import { DIAS_SEMANA, esLibre, hhmm, resumenHorario, type Horario } from '$lib/modules/personal/services/horarios.service';
	import {
		ESTADOS_DIA,
		calcularAsistencia,
		resumirAsistencia,
		minutosProgramados,
		getMarcas,
		sumarDias,
		diaSemana,
		duracion,
		reloj,
		type DiaAsistencia
	} from '$lib/modules/asistencia/services/asistencia.service';

	const hoy = hoyLima();
	type Tab = 'trabajador' | 'config' | 'tareo';
	const tabInicial = page.url.searchParams.get('tab');
	let tab = $state<Tab>(tabInicial === 'tareo' || tabInicial === 'config' ? tabInicial : 'trabajador');
	function elegirTab(t: Tab) {
		tab = t;
		const q = new URLSearchParams(page.url.searchParams);
		if (t !== 'trabajador') q.set('tab', t);
		else q.delete('tab');
		goto(`?${q.toString()}`, { replaceState: true, keepFocus: true, noScroll: true });
	}
	let personal = $state<Personal[]>([]);
	let idPersonal = $state('');
	let desde = $state(hoy);
	let hasta = $state(hoy);
	let horario = $state<Horario | null>(null);
	let dias = $state<DiaAsistencia[]>([]);
	let cargando = $state(false);

	const trabajador = $derived(personal.find((p) => String(p.id_personal) === idPersonal) ?? null);
	const opciones = $derived(
		personal.map((p) => ({ value: String(p.id_personal), label: `${nombreCompleto(p)} · n.º huellero ${p.pin}`, grupo: p.centro_costo?.nombre ?? 'Sin obra o área' }))
	);
	const resumen = $derived(resumirAsistencia(dias));
	const programados = $derived(minutosProgramados(dias));
	/** Más reciente primero. */
	const filas = $derived([...dias].reverse());

	// ── Vista calendario (por defecto) o lista ──
	let vista = $state<'calendario' | 'lista'>('calendario');
	let fechaElegida = $state<string | null>(null);
	const porFecha = $derived(new Map(dias.map((d) => [d.fecha, d])));
	/** Un bloque por mes del periodo (el más reciente arriba), cada uno con sus semanas de lunes a domingo;
	 * null = día de otro mes. */
	const meses = $derived.by(() => {
		if (desde > hasta) return [];
		const lista: { ym: string; titulo: string; semanas: (string | null)[][]; resumen: ReturnType<typeof resumirAsistencia> }[] = [];
		for (let ym = desde.slice(0, 7); ym <= hasta.slice(0, 7); ym = sumarDias(`${ym}-28`, 4).slice(0, 7)) {
			const primero = `${ym}-01`;
			const ultimo = finDeMes(primero);
			const semanas: (string | null)[][] = [];
			for (let lunes = lunesDe(primero); lunes <= ultimo; lunes = sumarDias(lunes, 7))
				semanas.push(Array.from({ length: 7 }, (_, i) => (sumarDias(lunes, i).startsWith(ym) ? sumarDias(lunes, i) : null)));
			const titulo = new Date(`${primero}T00:00:00`).toLocaleDateString('es-PE', { month: 'long', year: 'numeric' });
			lista.push({ ym, titulo: titulo.charAt(0).toUpperCase() + titulo.slice(1), semanas, resumen: resumirAsistencia(dias.filter((d) => d.fecha.startsWith(ym))) });
		}
		return lista.reverse();
	});
	const diaElegido = $derived(fechaElegida ? (porFecha.get(fechaElegida) ?? null) : null);
	/** Estados presentes en el periodo, para la leyenda. */
	const estadosPresentes = $derived([...new Set(dias.map((d) => d.estado))]);

	// ── Periodos rápidos ──
	const lunesDe = (f: string) => sumarDias(f, 1 - diaSemana(f));
	const finDeMes = (f: string) => sumarDias(`${sumarDias(`${f.slice(0, 7)}-28`, 4).slice(0, 7)}-01`, -1);
	const PERIODOS: { id: string; texto: string; rango: () => [string, string] }[] = [
		{ id: 'semana', texto: 'Esta semana', rango: () => [lunesDe(hoy), sumarDias(lunesDe(hoy), 6)] },
		{ id: 'semana_ant', texto: 'Semana anterior', rango: () => [sumarDias(lunesDe(hoy), -7), sumarDias(lunesDe(hoy), -1)] },
		{
			id: 'quincena',
			texto: 'Esta quincena',
			rango: () => (Number(hoy.slice(8)) <= 15 ? [`${hoy.slice(0, 7)}-01`, `${hoy.slice(0, 7)}-15`] : [`${hoy.slice(0, 7)}-16`, finDeMes(hoy)])
		},
		{ id: 'mes', texto: 'Este mes', rango: () => [`${hoy.slice(0, 7)}-01`, finDeMes(hoy)] },
		{
			id: 'mes_ant',
			texto: 'Mes anterior',
			rango: () => {
				const fin = sumarDias(`${hoy.slice(0, 7)}-01`, -1);
				return [`${fin.slice(0, 7)}-01`, fin];
			}
		}
	];
	const periodoActivo = $derived(PERIODOS.find((p) => p.rango()[0] === desde && p.rango()[1] === hasta)?.id ?? null);

	function usarPeriodo(id: string) {
		[desde, hasta] = PERIODOS.find((p) => p.id === id)!.rango();
		cargar();
	}

	/** El periodo inicial sigue cada cuánto se le paga. */
	function periodoPorDefecto(p: Personal) {
		usarPeriodo(p.periodicidad_pago === 'mensual' ? 'mes' : p.periodicidad_pago === 'quincenal' ? 'quincena' : 'semana');
	}

	function elegirTrabajador(v: string) {
		idPersonal = v;
		const q = new URLSearchParams(page.url.searchParams);
		if (v) q.set('p', v);
		else q.delete('p');
		goto(`?${q.toString()}`, { replaceState: true, keepFocus: true, noScroll: true });
		const p = personal.find((x) => String(x.id_personal) === v);
		if (p) periodoPorDefecto(p);
		else dias = [];
	}

	async function cargar() {
		const p = trabajador;
		if (!p) return;
		if (desde > hasta) {
			toast.error('La fecha "desde" no puede ser posterior a "hasta".');
			return;
		}
		cargando = true;
		fechaElegida = null;
		try {
			const [marcas, h] = await Promise.all([
				getMarcas(supabase, p.pin, desde, hasta),
				p.id_horario
					? supabase.from('horario').select('*, horario_dia(*)').eq('id_horario', p.id_horario).single().then(({ data, error }) => {
							if (error) throw error;
							return data as Horario;
						})
					: Promise.resolve(null)
			]);
			horario = h;
			dias = calcularAsistencia(marcas, h, desde, hasta, hoy, { ingreso: p.fecha_ingreso, cese: p.fecha_cese });
		} catch (err) {
			toast.error(`No se pudo cargar la asistencia. ${describeError(err)}`);
		} finally {
			cargando = false;
		}
	}

	/** Tras guardar la configuración: se relee el personal (horario, huelleros) y su asistencia. */
	async function recargarPersonal() {
		try {
			personal = await getPersonal(supabase);
			await cargar();
		} catch (err) {
			toast.error(`No se pudo recargar el personal. ${describeError(err)}`);
		}
	}

	onMount(async () => {
		try {
			personal = await getPersonal(supabase);
		} catch (err) {
			toast.error(`No se pudo cargar el personal. ${describeError(err)}`);
			return;
		}
		const inicial = page.url.searchParams.get('p');
		if (inicial && personal.some((p) => String(p.id_personal) === inicial)) elegirTrabajador(inicial);
	});

	const fechaCorta = (f: string) => new Date(`${f}T00:00:00`).toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit' });
	const libre = $derived(esLibre(horario));
	const programadoTexto = (d: DiaAsistencia) =>
		d.programado ? `${hhmm(d.programado.hora_entrada)}–${hhmm(d.programado.hora_salida)}` : libre ? 'Libre' : horario ? 'Descanso' : '—';
	/** Horario libre: "08:00–12:00 · 14:00–18:00" (una marca sin pareja queda "14:00–…"). */
	const tramos = (d: DiaAsistencia) =>
		d.marcas
			.filter((_, i) => i % 2 === 0)
			.map((m, k) => `${reloj(m.minuto)}–${d.marcas[k * 2 + 1] ? reloj(d.marcas[k * 2 + 1].minuto) : '…'}`)
			.join(' · ');
	const diasTrabajados = $derived(dias.filter((d) => d.trabajados > 0).length);

	const columnas = [
		{ label: 'Día' },
		{ label: 'Horario' },
		{ label: 'Entrada' },
		{ label: 'Salida' },
		{ label: 'Horas trabajadas' },
		{ label: 'Tardanza' },
		{ label: 'Horas extra' },
		{ label: 'Estado' },
		{ label: 'Marcas' }
	];
</script>

<svelte:head>
	<title>Asistencia | Personal y Asistencia - Construni ERP</title>
</svelte:head>

{#snippet estado(d: DiaAsistencia)}
	<span class={`text-[11px] font-bold px-2 py-0.5 rounded-md border ${ESTADOS_DIA[d.estado].clase}`}>{ESTADOS_DIA[d.estado].texto}</span>
	{#if d.salidaAnticipada && d.estado !== 'incompleto'}
		<span class="text-[11px] font-medium px-2 py-0.5 rounded-md border bg-orange-50 text-orange-700 border-orange-200" title="Marcó la salida antes de la hora">Salió {duracion(d.salidaAnticipada)} antes</span>
	{/if}
{/snippet}

{#snippet marcasDelDia(d: DiaAsistencia)}
	<span class="text-xs text-slate-500" title={d.marcas.map((m) => `${reloj(m.minuto)} · ${m.huellero}`).join('\n')}>
		{d.marcas.map((m) => reloj(m.minuto)).join(' · ') || '—'}
	</span>
{/snippet}

{#snippet dato(titulo: string, valor: string, color = 'text-slate-800')}
	<span class="text-slate-500 whitespace-nowrap">{titulo} <b class={`font-semibold ${color}`}>{valor}</b></span>
{/snippet}

{#snippet detalleDia(d: DiaAsistencia)}
	<div class="mt-2 border border-blue-100 bg-blue-50/30 rounded-xl p-4 flex flex-col gap-3" transition:fade={{ duration: 150 }}>
		<div class="flex flex-wrap items-center justify-between gap-2">
			<span class="font-semibold text-slate-800">{DIAS_SEMANA[d.dia - 1]} {fechaCorta(d.fecha)}{d.fecha === hoy ? ' · hoy' : ''}</span>
			<div class="flex flex-wrap gap-1">{@render estado(d)}</div>
		</div>
		<div class="grid grid-cols-2 sm:grid-cols-6 gap-3 text-sm">
			<div><div class="text-[11px] text-slate-400">Horario</div><div class="text-slate-700">{programadoTexto(d)}</div></div>
			<div><div class="text-[11px] text-slate-400">Entrada</div><div class={`font-mono ${d.tardanza ? 'text-amber-700 font-semibold' : 'text-slate-700'}`}>{reloj(d.entrada) || '—'}</div></div>
			<div><div class="text-[11px] text-slate-400">Salida</div><div class="font-mono text-slate-700">{reloj(d.salida) || '—'}</div></div>
			<div><div class="text-[11px] text-slate-400">Horas trabajadas</div><div class="text-slate-700">{duracion(d.trabajados)}</div></div>
			{#if libre}
				<div class="col-span-2"><div class="text-[11px] text-slate-400">Tramos</div><div class="font-mono text-slate-700">{tramos(d) || '—'}</div></div>
			{:else}
				<div><div class="text-[11px] text-slate-400">Tardanza</div><div class={d.tardanza ? 'text-amber-700' : 'text-slate-400'}>{duracion(d.tardanza)}</div></div>
				<div><div class="text-[11px] text-slate-400">Horas extra</div><div class={d.extra ? 'text-violet-700' : 'text-slate-400'}>{duracion(d.extra)}</div></div>
			{/if}
		</div>
		<div class="text-xs text-slate-500">
			<span class="font-medium text-slate-600">Marcas:</span>
			{d.marcas.map((m) => `${reloj(m.minuto)} (${m.huellero})`).join(' · ') || 'ninguna'}
		</div>
	</div>
{/snippet}

<div class="flex flex-col md:h-[calc(100vh-80px)] md:overflow-hidden bg-slate-50/50">
	<div class="flex-shrink-0 px-4 sm:px-6 py-5 border-b border-slate-100 bg-white">
		<span class="font-bold text-slate-800 text-2xl">Asistencia</span>
		<p class="text-sm text-slate-500 mt-1">
			{tab === 'tareo'
				? 'Tareo de la semana por obra: revisa y corrige las horas de cada trabajador, agrega bonos y envíalo a Cuentas por Pagar.'
				: tab === 'config'
					? 'Elige un trabajador para configurar su horario, cómo registra su asistencia y en qué huelleros marca.'
					: 'Elige un trabajador y el periodo: verás cada día con su entrada, salida, horas, tardanzas y horas extra según su horario.'}
		</p>
		<div class="mt-3 -mb-5 flex gap-1" role="tablist">
			<button role="tab" aria-selected={tab === 'trabajador'} onclick={() => elegirTab('trabajador')} class={`px-4 py-2 text-sm font-semibold border-b-2 ${tab === 'trabajador' ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}><i class="fas fa-user-clock mr-1"></i> Por trabajador</button>
			<button role="tab" aria-selected={tab === 'config'} onclick={() => elegirTab('config')} class={`px-4 py-2 text-sm font-semibold border-b-2 ${tab === 'config' ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}><i class="fas fa-sliders mr-1"></i> Configuración</button>
			<button role="tab" aria-selected={tab === 'tareo'} onclick={() => elegirTab('tareo')} class={`px-4 py-2 text-sm font-semibold border-b-2 ${tab === 'tareo' ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}><i class="fas fa-helmet-safety mr-1"></i> Tareo semanal por obra</button>
		</div>
	</div>

	<div class="flex-1 overflow-y-auto p-4 sm:p-6">
		{#if tab === 'tareo'}
		<div class="max-w-[1400px] mx-auto"><TareoSemanal /></div>
		{:else if tab === 'config'}
		<div class="max-w-[1000px] mx-auto flex flex-col gap-4">
			<div class="bg-white border border-slate-100 rounded-2xl shadow-sm p-4 flex flex-col gap-1.5">
				<label for="trabajador_cfg" class="text-sm font-medium text-slate-700">Trabajador</label>
				<SelectConSaldo id="trabajador_cfg" value={idPersonal} options={opciones} placeholder="Busca por nombre o código" encabezadoNombre="Trabajador" onchange={elegirTrabajador} />
			</div>
			{#if trabajador}
				<ConfiguracionAsistencia {trabajador} onSaved={recargarPersonal} />
			{:else}
				<div class="bg-white border border-slate-100 rounded-2xl shadow-sm py-16 flex flex-col items-center gap-2 text-slate-400">
					<i class="fas fa-sliders text-3xl"></i>
					<span class="text-sm">Elige un trabajador para configurar su asistencia.</span>
				</div>
			{/if}
		</div>
		{:else}
		<div class="max-w-[1200px] mx-auto flex flex-col gap-4">
			<div class="bg-white border border-slate-100 rounded-2xl shadow-sm p-4 grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_auto] gap-4 items-end">
				<div class="flex flex-col gap-1.5 min-w-0">
					<label for="trabajador" class="text-sm font-medium text-slate-700">Trabajador</label>
					<SelectConSaldo id="trabajador" value={idPersonal} options={opciones} placeholder="Busca por nombre o código" encabezadoNombre="Trabajador" onchange={elegirTrabajador} />
				</div>
				<div class="flex flex-wrap items-end gap-3">
					<div class="flex flex-col gap-1.5">
						<label for="desde" class="text-sm font-medium text-slate-700">Desde</label>
						<input id="desde" type="date" bind:value={desde} onchange={cargar} disabled={!trabajador} class="px-3 py-2 border border-slate-200 rounded-xl text-sm disabled:bg-slate-50" />
					</div>
					<div class="flex flex-col gap-1.5">
						<label for="hasta" class="text-sm font-medium text-slate-700">Hasta</label>
						<input id="hasta" type="date" bind:value={hasta} onchange={cargar} disabled={!trabajador} class="px-3 py-2 border border-slate-200 rounded-xl text-sm disabled:bg-slate-50" />
					</div>
				</div>
				<div class="lg:col-span-2 flex flex-wrap gap-2">
					{#each PERIODOS as p}
						<button
							onclick={() => usarPeriodo(p.id)}
							disabled={!trabajador}
							class={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors disabled:opacity-50 ${periodoActivo === p.id ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}
						>
							{p.texto}
						</button>
					{/each}
				</div>
			</div>

			{#if !trabajador}
				<div class="bg-white border border-slate-100 rounded-2xl shadow-sm py-16 flex flex-col items-center gap-2 text-slate-400">
					<i class="fas fa-calendar-check text-3xl"></i>
					<span class="text-sm">Elige un trabajador para ver su asistencia.</span>
				</div>
			{:else}
				<div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-600 px-1">
					<span class="font-semibold text-slate-800">{nombreCompleto(trabajador)}</span>
					<span>N.º en huellero {trabajador.pin}</span>
					{#if trabajador.centro_costo}<span class="[overflow-wrap:anywhere]">{trabajador.centro_costo.nombre}</span>{/if}
					{#if libre && horario}
						<span>Horario: {horario.nombre} · <span class="text-teal-700 font-medium">libre, por horas</span> (se suman las horas entre sus marcas de cada día)</span>
					{:else if horario}
						<span>Horario: {horario.nombre} · {resumenHorario(horario)} · tolerancia {horario.tolerancia_min} min</span>
					{:else}
						<span class="text-amber-700"><i class="fas fa-triangle-exclamation"></i> Sin horario: no se calculan tardanzas, faltas ni horas extra. <button type="button" onclick={() => elegirTab('config')} class="underline font-medium">Asígnale uno en Configuración</button>.</span>
					{/if}
				</div>

				<div class="bg-white border border-slate-100 rounded-xl shadow-sm px-4 py-2 flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
					{#if libre}
						{@render dato('Días trabajados', `${resumen.asistidos}`)}
						{@render dato('Horas trabajadas', duracion(resumen.minutosTrabajados), 'text-teal-700')}
						{@render dato('Promedio por día', diasTrabajados ? duracion(Math.round(resumen.minutosTrabajados / diasTrabajados)) : '—')}
						{#if resumen.incompletos}{@render dato('Sin salida', `${resumen.incompletos}`, 'text-orange-600')}{/if}
					{:else}
						{@render dato('Asistió', horario ? `${resumen.asistidos} de ${resumen.laborables} días` : `${resumen.asistidos} días`)}
						{@render dato('Faltas', `${resumen.faltas}`, resumen.faltas ? 'text-rose-600' : undefined)}
						{#if resumen.incompletos}{@render dato('Sin salida', `${resumen.incompletos}`, 'text-orange-600')}{/if}
						{@render dato('Tardanzas', resumen.tardanzas ? `${resumen.tardanzas} · ${duracion(resumen.minutosTardanza)}` : '0', resumen.tardanzas ? 'text-amber-600' : undefined)}
						{@render dato('Horas', horario ? `${duracion(resumen.minutosTrabajados)} de ${duracion(programados)}` : duracion(resumen.minutosTrabajados))}
						{@render dato('Extra', duracion(resumen.minutosExtra), resumen.minutosExtra ? 'text-violet-600' : undefined)}
					{/if}
					<span class="text-xs text-slate-400 whitespace-nowrap sm:ml-auto">{fechaCorta(desde)} – {fechaCorta(hasta)}{hasta > hoy ? ' · hasta hoy' : ''}</span>
				</div>

				<div class="flex flex-wrap items-center justify-between gap-3">
					<div class="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500 px-1">
						{#each estadosPresentes as e}
							<span class="flex items-center gap-1.5"><span class={`w-2.5 h-2.5 rounded-full ${ESTADOS_DIA[e].punto}`}></span>{ESTADOS_DIA[e].texto}</span>
						{/each}
					</div>
					<div class="flex rounded-xl border border-slate-200 bg-white p-0.5 text-sm">
						<button onclick={() => (vista = 'calendario')} class={`px-3 py-1.5 rounded-lg flex items-center gap-2 ${vista === 'calendario' ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`}><i class="fas fa-calendar-days"></i> Calendario</button>
						<button onclick={() => (vista = 'lista')} class={`px-3 py-1.5 rounded-lg flex items-center gap-2 ${vista === 'lista' ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`}><i class="fas fa-list"></i> Lista</button>
					</div>
				</div>

				<div class={vista === 'calendario' && !cargando ? 'flex flex-col gap-4' : 'bg-white border border-slate-100 rounded-2xl shadow-sm overflow-hidden'}>
					{#if cargando}
						<div class="flex items-center justify-center py-16 text-slate-400 gap-3">
							<i class="fas fa-spinner fa-spin text-xl text-blue-500"></i>
							<span class="text-sm font-medium">Cargando asistencia...</span>
						</div>
					{:else if vista === 'calendario'}
						{#each meses as mes (mes.ym)}
							<section class="bg-white border border-slate-100 rounded-2xl shadow-sm p-2 sm:p-4 flex flex-col gap-1 sm:gap-2">
								<div class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-1 pb-1">
									<h3 class="text-base font-bold text-slate-800">{mes.titulo}</h3>
									{#if mes.resumen.asistidos || mes.resumen.faltas || mes.resumen.tardanzas}
										<div class="flex flex-wrap gap-x-4 text-xs">
											{@render dato(libre ? 'Días trabajados' : 'Asistió', `${mes.resumen.asistidos}`)}
											{#if !libre}
												{@render dato('Faltas', `${mes.resumen.faltas}`, mes.resumen.faltas ? 'text-rose-600' : undefined)}
												{@render dato('Tardanzas', `${mes.resumen.tardanzas}`, mes.resumen.tardanzas ? 'text-amber-600' : undefined)}
											{/if}
											{@render dato('Horas', duracion(mes.resumen.minutosTrabajados))}
										</div>
									{/if}
								</div>
								<div class="grid grid-cols-7 gap-1 sm:gap-2">
									{#each DIAS_SEMANA as nombre}
										<div class="text-center text-[11px] sm:text-xs font-semibold text-slate-500 py-1"><span class="sm:hidden">{nombre.slice(0, 2)}</span><span class="hidden sm:inline">{nombre}</span></div>
									{/each}
								</div>
								{#each mes.semanas as semana}
									<div class="grid grid-cols-7 gap-1 sm:gap-2">
										{#each semana as fecha}
											{@const d = fecha ? porFecha.get(fecha) : undefined}
											{#if !fecha}
												<!-- Día de otro mes: hueco. -->
												<div></div>
											{:else if !d}
												<!-- Fuera del periodo o todavía no llega (después de hoy). -->
												<div class="min-h-12 sm:min-h-24 rounded-lg sm:rounded-xl border border-dashed border-slate-100 p-1.5 sm:p-2">
													<span class="text-xs sm:text-sm font-semibold text-slate-300">{Number(fecha.slice(8))}</span>
												</div>
											{:else}
												<button
													onclick={() => (fechaElegida = fechaElegida === fecha ? null : fecha)}
													title={`${DIAS_SEMANA[d.dia - 1]} ${fechaCorta(fecha)} · ${ESTADOS_DIA[d.estado].texto}`}
													class={`min-h-12 sm:min-h-24 min-w-0 rounded-lg sm:rounded-xl border p-1.5 sm:p-2 flex flex-col items-stretch gap-0.5 sm:gap-1 text-left transition-shadow hover:shadow-md ${ESTADOS_DIA[d.estado].celda} ${fechaElegida === fecha ? 'ring-2 ring-blue-500' : fecha === hoy ? 'ring-2 ring-blue-200' : ''}`}
												>
													<div class="flex items-center justify-between gap-1 min-w-0">
														<span class="text-xs sm:text-sm font-bold text-slate-700">{Number(fecha.slice(8))}</span>
														<span class={`w-2 h-2 rounded-full shrink-0 sm:hidden ${ESTADOS_DIA[d.estado].punto}`}></span>
														<span class={`hidden sm:inline text-[10px] font-bold px-1.5 py-0.5 rounded border truncate ${ESTADOS_DIA[d.estado].clase}`}>{ESTADOS_DIA[d.estado].texto}</span>
													</div>
													{#if d.entrada != null}
														<span class="font-mono text-[10px] sm:text-xs text-slate-700 truncate">{reloj(d.entrada)}<span class="hidden sm:inline">{d.salida != null ? ` → ${reloj(d.salida)}` : ''}</span></span>
													{/if}
													<span class="hidden sm:block text-[11px] text-slate-400 truncate">{programadoTexto(d)}</span>
													{#if d.trabajados}<span class="hidden sm:block text-[11px] text-slate-600 truncate">{duracion(d.trabajados)}</span>{/if}
													{#if d.tardanza}<span class="hidden sm:block text-[11px] text-amber-700 truncate">Tarde {duracion(d.tardanza)}</span>{/if}
													{#if d.extra}<span class="hidden sm:block text-[11px] text-violet-700 truncate">Extra {duracion(d.extra)}</span>{/if}
												</button>
											{/if}
										{/each}
									</div>
								{/each}
								{#if diaElegido && diaElegido.fecha.startsWith(mes.ym)}
									{@render detalleDia(diaElegido)}
								{/if}
							</section>
						{/each}
					{:else}
						<ResponsiveDataView items={filas} keyField="fecha" columns={columnas} emptyMessage={desde > hoy ? 'El periodo aún no empieza.' : 'No hay días en este periodo.'}>
							{#snippet row(d: DiaAsistencia)}
								<td class="px-5 py-3">
									<div class="font-medium text-slate-800">{DIAS_SEMANA[d.dia - 1]}</div>
									<div class="text-xs text-slate-400">{fechaCorta(d.fecha)}{d.fecha === hoy ? ' · hoy' : ''}</div>
								</td>
								<td class="px-5 py-3 text-slate-500">{programadoTexto(d)}</td>
								<td class={`px-5 py-3 font-mono ${d.tardanza ? 'text-amber-700 font-semibold' : 'text-slate-700'}`}>{reloj(d.entrada) || '—'}</td>
								<td class="px-5 py-3 font-mono text-slate-700">{reloj(d.salida) || '—'}</td>
								<td class="px-5 py-3 text-slate-700">{duracion(d.trabajados)}</td>
								<td class={`px-5 py-3 ${d.tardanza ? 'text-amber-700' : 'text-slate-300'}`}>{duracion(d.tardanza)}</td>
								<td class={`px-5 py-3 ${d.extra ? 'text-violet-700' : 'text-slate-300'}`}>{duracion(d.extra)}</td>
								<td class="px-5 py-3"><div class="flex flex-wrap gap-1">{@render estado(d)}</div></td>
								<td class="px-5 py-3">{@render marcasDelDia(d)}</td>
							{/snippet}
							{#snippet card(d: DiaAsistencia)}
								<div class="p-4 flex flex-col gap-2">
									<div class="flex items-center justify-between gap-2">
										<span class="font-semibold text-slate-800">{DIAS_SEMANA[d.dia - 1]} {fechaCorta(d.fecha)}{d.fecha === hoy ? ' · hoy' : ''}</span>
										<div class="flex flex-wrap justify-end gap-1">{@render estado(d)}</div>
									</div>
									<div class="grid grid-cols-3 gap-2 text-sm">
										<div><div class="text-[11px] text-slate-400">Entrada</div><div class={`font-mono ${d.tardanza ? 'text-amber-700 font-semibold' : 'text-slate-700'}`}>{reloj(d.entrada) || '—'}</div></div>
										<div><div class="text-[11px] text-slate-400">Salida</div><div class="font-mono text-slate-700">{reloj(d.salida) || '—'}</div></div>
										<div><div class="text-[11px] text-slate-400">Horas</div><div class="text-slate-700">{duracion(d.trabajados)}</div></div>
									</div>
									<div class="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
										<span>Horario: {programadoTexto(d)}</span>
										{#if d.tardanza}<span class="text-amber-700">Tardanza {duracion(d.tardanza)}</span>{/if}
										{#if d.extra}<span class="text-violet-700">Extra {duracion(d.extra)}</span>{/if}
									</div>
									{#if d.marcas.length}<div>{@render marcasDelDia(d)}</div>{/if}
								</div>
							{/snippet}
						</ResponsiveDataView>
					{/if}
				</div>
			{/if}
		</div>
		{/if}
	</div>
</div>
