<script lang="ts">
	/**
	 * Horarios de trabajo: catálogo con entrada/salida/refrigerio por día y tolerancia de tardanza. Cada
	 * trabajador tiene asignado uno en su ficha (Personal). Dar de baja oculta el horario de la lista de
	 * opciones; los trabajadores que ya lo tienen lo conservan.
	 */
	import { onMount } from 'svelte';
	import { fade, scale } from 'svelte/transition';
	import { supabase } from '$lib/supabaseClient';
	import { puedeVerEliminados } from '$lib/stores/permisos.svelte';
	import { toast } from '$lib/stores/toast';
	import { describeError } from '$lib/shared/describeError';
	import ConfirmModal from '$lib/shared/components/ConfirmModal.svelte';
	import {
		DIAS_SEMANA,
		aMinutos,
		hhmm,
		minutosDelDia,
		horasSemanales,
		getHorarios,
		guardarHorario,
		cambiarEstadoHorario,
		contarPersonalPorHorario,
		type Horario,
		type HorarioDia
	} from '$lib/modules/personal/services/horarios.service';

	let horarios = $state<Horario[]>([]);
	let porHorario = $state<Record<number, number>>({});
	let isLoading = $state(true);
	let verEliminados = $state(false);

	async function fetchHorarios() {
		isLoading = true;
		try {
			[horarios, porHorario] = await Promise.all([getHorarios(supabase, verEliminados), contarPersonalPorHorario(supabase)]);
		} catch (err) {
			toast.error(`No se pudieron cargar los horarios. ${describeError(err)}`);
		} finally {
			isLoading = false;
		}
	}

	onMount(fetchHorarios);

	function toggleVerEliminados() {
		verEliminados = !verEliminados;
		fetchHorarios();
	}

	// ── Editor ──
	type FilaDia = { laborable: boolean; entrada: string; salida: string; conRefrigerio: boolean; refIni: string; refFin: string };
	let editorAbierto = $state(false);
	let editando = $state<Horario | null>(null);
	let nombre = $state('');
	let tolerancia = $state(10);
	let filas = $state<FilaDia[]>([]);
	let guardando = $state(false);
	let errorEditor = $state('');

	function abrirEditor(h: Horario | null) {
		editando = h;
		nombre = h?.nombre ?? '';
		tolerancia = h?.tolerancia_min ?? 10;
		filas = DIAS_SEMANA.map((_, i) => {
			const d = h?.horario_dia.find((x) => x.dia === i + 1);
			return d
				? { laborable: true, entrada: hhmm(d.hora_entrada), salida: hhmm(d.hora_salida), conRefrigerio: !!d.refrigerio_inicio, refIni: hhmm(d.refrigerio_inicio) || '12:00', refFin: hhmm(d.refrigerio_fin) || '13:00' }
				: { laborable: !h && i < 5, entrada: '07:30', salida: '17:00', conRefrigerio: true, refIni: '12:00', refFin: '13:00' };
		});
		errorEditor = '';
		editorAbierto = true;
	}

	/** Copia el horario del lunes a los demás días laborables. */
	function copiarLunes() {
		const lunes = filas[0];
		filas = filas.map((f, i) => (i === 0 || !f.laborable ? f : { ...lunes }));
	}

	const diasEditor = $derived<HorarioDia[]>(
		filas
			.map((f, i) => ({ f, dia: i + 1 }))
			.filter(({ f }) => f.laborable)
			.map(({ f, dia }) => ({
				dia,
				hora_entrada: f.entrada,
				hora_salida: f.salida,
				refrigerio_inicio: f.conRefrigerio ? f.refIni : null,
				refrigerio_fin: f.conRefrigerio ? f.refFin : null
			}))
	);

	function validar(): string {
		if (!nombre.trim()) return 'Ponle un nombre al horario.';
		if (!Number.isInteger(tolerancia) || tolerancia < 0 || tolerancia > 120) return 'La tolerancia va de 0 a 120 minutos.';
		if (!diasEditor.length) return 'Marca al menos un día laborable.';
		for (const d of diasEditor) {
			const dia = DIAS_SEMANA[d.dia - 1];
			if (!d.hora_entrada || !d.hora_salida) return `${dia}: completa la entrada y la salida.`;
			if (aMinutos(d.hora_salida) <= aMinutos(d.hora_entrada)) return `${dia}: la salida debe ser después de la entrada.`;
			if (d.refrigerio_inicio && d.refrigerio_fin) {
				const ini = aMinutos(d.refrigerio_inicio), fin = aMinutos(d.refrigerio_fin);
				if (fin <= ini || ini < aMinutos(d.hora_entrada) || fin > aMinutos(d.hora_salida)) return `${dia}: el refrigerio debe estar dentro de la jornada.`;
			}
		}
		return '';
	}

	async function guardar() {
		errorEditor = validar();
		if (errorEditor) return;
		guardando = true;
		try {
			await guardarHorario(supabase, editando?.id_horario ?? null, { nombre, tolerancia_min: tolerancia, dias: diasEditor });
			toast.success(editando ? 'Horario actualizado.' : 'Horario creado.');
			editorAbierto = false;
			await fetchHorarios();
		} catch (err) {
			errorEditor = describeError(err);
		} finally {
			guardando = false;
		}
	}

	// ── Dar de baja / restaurar ──
	let paraCambiar = $state<{ horario: Horario; estado: 'activo' | 'baja' } | null>(null);

	async function confirmarCambio() {
		if (!paraCambiar) return;
		try {
			await cambiarEstadoHorario(supabase, paraCambiar.horario.id_horario, paraCambiar.estado);
			toast.success(paraCambiar.estado === 'baja' ? 'Horario dado de baja.' : 'Horario restaurado.');
			await fetchHorarios();
		} catch (err) {
			toast.error(`No se pudo cambiar el horario. ${describeError(err)}`);
		} finally {
			paraCambiar = null;
		}
	}

	const formatoHoras = (h: number) => `${Number.isInteger(h) ? h : h.toFixed(1)} h`;
</script>

<svelte:head>
	<title>Horarios | Personal y Asistencia - Construni ERP</title>
</svelte:head>

<div class="flex flex-col md:h-[calc(100vh-80px)] md:overflow-hidden bg-slate-50/50">
	<div class="flex-shrink-0 px-4 sm:px-6 py-5 flex items-start sm:items-center justify-between gap-3 border-b border-slate-100 bg-white">
		<div class="flex flex-col min-w-0">
			<div class="flex flex-wrap items-center gap-2 mb-1">
				<span class="font-bold text-slate-800 text-2xl">{verEliminados ? 'Horarios dados de baja' : 'Horarios'}</span>
				{#if verEliminados}
					<span class="text-[10px] font-bold px-2 py-0.5 rounded-md bg-rose-50 text-rose-600 border border-rose-200 uppercase tracking-wide">Solo administradores</span>
				{/if}
			</div>
			<p class="text-sm text-slate-500">
				{verEliminados ? 'Horarios que ya no se ofrecen al asignar. Restáuralos si los necesitas otra vez.' : 'Jornadas de trabajo por día. Cada trabajador tiene asignado uno en su ficha de Personal.'}
			</p>
		</div>
		<div class="flex items-center gap-3 shrink-0">
			{#if puedeVerEliminados()}
				<button onclick={toggleVerEliminados} class={`px-3 sm:px-4 py-2 rounded-xl font-medium text-sm shadow-sm flex items-center gap-2 whitespace-nowrap ${verEliminados ? 'bg-slate-800 text-white hover:bg-slate-900' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
					<i class={`fas ${verEliminados ? 'fa-arrow-left' : 'fa-trash-can'}`}></i>
					{verEliminados ? 'Volver' : 'Ver eliminados'}
				</button>
			{/if}
			{#if !verEliminados}
				<button onclick={() => abrirEditor(null)} class="px-4 py-2 bg-blue-600 text-white rounded-xl hover:bg-blue-700 font-medium text-sm shadow-md shadow-blue-600/20 flex items-center gap-2 whitespace-nowrap">
					<i class="fas fa-plus"></i> <span class="hidden sm:inline">Nuevo horario</span>
				</button>
			{/if}
		</div>
	</div>

	<div class="flex-1 overflow-y-auto p-4 sm:p-6">
		<div class="max-w-[1200px] mx-auto">
			{#if isLoading}
				<div class="flex items-center justify-center py-16 text-slate-400 gap-3">
					<i class="fas fa-spinner fa-spin text-xl text-blue-500"></i>
					<span class="text-sm font-medium">Cargando horarios...</span>
				</div>
			{:else if !horarios.length}
				<div class="text-center text-sm text-slate-500 py-16">{verEliminados ? 'No hay horarios dados de baja.' : 'Todavía no hay horarios. Pulsa "Nuevo horario".'}</div>
			{:else}
				<div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
					{#each horarios as h (h.id_horario)}
						<div class="bg-white border border-slate-100 rounded-2xl shadow-sm p-5 flex flex-col gap-3">
							<div class="flex items-start justify-between gap-3">
								<div class="min-w-0">
									<div class="font-semibold text-slate-800">{h.nombre}</div>
									<div class="text-xs text-slate-500">
										{formatoHoras(horasSemanales(h))} por semana · tolerancia {h.tolerancia_min} min · {porHorario[h.id_horario] ?? 0} trabajadores
									</div>
								</div>
								<div class="flex gap-1 shrink-0">
									{#if verEliminados}
										<button onclick={() => (paraCambiar = { horario: h, estado: 'activo' })} class="px-3 py-1.5 text-xs font-medium rounded-lg text-emerald-700 hover:bg-emerald-50"><i class="fas fa-rotate-left"></i> Restaurar</button>
									{:else}
										<button onclick={() => abrirEditor(h)} class="px-3 py-1.5 text-xs font-medium rounded-lg text-blue-600 hover:bg-blue-50"><i class="fas fa-pen"></i> Editar</button>
										<button onclick={() => (paraCambiar = { horario: h, estado: 'baja' })} class="px-3 py-1.5 text-xs font-medium rounded-lg text-rose-600 hover:bg-rose-50"><i class="fas fa-ban"></i> Dar de baja</button>
									{/if}
								</div>
							</div>
							<div class="grid grid-cols-[auto_1fr_auto] gap-x-4 gap-y-1 text-xs">
								{#each DIAS_SEMANA as nombreDia, i}
									{@const d = h.horario_dia.find((x) => x.dia === i + 1)}
									<span class="text-slate-500">{nombreDia}</span>
									{#if d}
										<span class="text-slate-700 tabular-nums">
											{hhmm(d.hora_entrada)} – {hhmm(d.hora_salida)}
											{#if d.refrigerio_inicio}<span class="text-slate-400"> · refrigerio {hhmm(d.refrigerio_inicio)}–{hhmm(d.refrigerio_fin)}</span>{/if}
										</span>
										<span class="text-slate-500 tabular-nums text-right">{formatoHoras(minutosDelDia(d) / 60)}</span>
									{:else}
										<span class="text-slate-400">Descanso</span><span></span>
									{/if}
								{/each}
							</div>
						</div>
					{/each}
				</div>
			{/if}
		</div>
	</div>
</div>

{#if editorAbierto}
	<div class="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-[100] flex items-center justify-center p-4" transition:fade={{ duration: 200 }}>
		<div class="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col" transition:scale={{ duration: 250, start: 0.95 }}>
			<div class="px-6 py-4 border-b border-slate-100 flex items-center justify-between shrink-0">
				<h2 class="text-xl font-bold text-slate-800">{editando ? 'Editar horario' : 'Nuevo horario'}</h2>
				<button onclick={() => !guardando && (editorAbierto = false)} disabled={guardando} aria-label="Cerrar" class="text-slate-400 hover:text-slate-600 p-2 rounded-full hover:bg-slate-100 disabled:opacity-50">
					<i class="fas fa-times"></i>
				</button>
			</div>
			<div class="p-6 overflow-y-auto flex flex-col gap-4">
				<div class="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-4">
					<label class="flex flex-col gap-1.5">
						<span class="text-sm font-medium text-slate-700">Nombre *</span>
						<input bind:value={nombre} maxlength="80" placeholder="Ej. Obra turno mañana" class="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500" />
					</label>
					<label class="flex flex-col gap-1.5">
						<span class="text-sm font-medium text-slate-700">Tolerancia (min)</span>
						<input type="number" min="0" max="120" bind:value={tolerancia} class="w-full sm:w-32 px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500" />
					</label>
				</div>
				<p class="text-xs text-slate-500 -mt-2">La tolerancia son los minutos después de la hora de entrada que todavía no cuentan como tardanza.</p>

				<div class="flex items-center justify-between">
					<span class="text-sm font-bold text-slate-800">Jornada por día</span>
					<button onclick={copiarLunes} class="text-xs font-medium text-blue-600 hover:underline"><i class="fas fa-copy"></i> Copiar el lunes a los demás días marcados</button>
				</div>
				<div class="flex flex-col divide-y divide-slate-100 border border-slate-100 rounded-xl">
					{#each filas as fila, i}
						<div class="p-3 flex flex-col md:flex-row md:items-center gap-2 md:gap-4">
							<label class="flex items-center gap-2 w-32 shrink-0">
								<input type="checkbox" bind:checked={fila.laborable} class="w-4 h-4 accent-blue-600" />
								<span class={`text-sm font-medium ${fila.laborable ? 'text-slate-800' : 'text-slate-400'}`}>{DIAS_SEMANA[i]}</span>
							</label>
							{#if fila.laborable}
								<div class="flex flex-wrap items-center gap-2 text-sm">
									<input type="time" bind:value={fila.entrada} aria-label={`Entrada ${DIAS_SEMANA[i]}`} class="px-2 py-1.5 border border-slate-200 rounded-lg" />
									<span class="text-slate-400">a</span>
									<input type="time" bind:value={fila.salida} aria-label={`Salida ${DIAS_SEMANA[i]}`} class="px-2 py-1.5 border border-slate-200 rounded-lg" />
									<label class="flex items-center gap-1.5 ml-1 text-xs text-slate-600">
										<input type="checkbox" bind:checked={fila.conRefrigerio} class="w-3.5 h-3.5 accent-blue-600" /> Refrigerio
									</label>
									{#if fila.conRefrigerio}
										<input type="time" bind:value={fila.refIni} aria-label={`Inicio refrigerio ${DIAS_SEMANA[i]}`} class="px-2 py-1.5 border border-slate-200 rounded-lg" />
										<span class="text-slate-400">a</span>
										<input type="time" bind:value={fila.refFin} aria-label={`Fin refrigerio ${DIAS_SEMANA[i]}`} class="px-2 py-1.5 border border-slate-200 rounded-lg" />
									{/if}
								</div>
							{:else}
								<span class="text-xs text-slate-400">Descanso</span>
							{/if}
						</div>
					{/each}
				</div>
				<div class="text-sm text-slate-600">Total: <b>{formatoHoras(horasSemanales({ horario_dia: diasEditor }))}</b> por semana</div>
				{#if errorEditor}
					<div class="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2">{errorEditor}</div>
				{/if}
			</div>
			<div class="px-6 py-4 border-t border-slate-100 flex justify-end gap-3 shrink-0">
				<button onclick={() => (editorAbierto = false)} disabled={guardando} class="px-5 py-2.5 bg-white border border-slate-200 text-slate-600 rounded-xl hover:bg-slate-50 font-medium text-sm disabled:opacity-50">Cancelar</button>
				<button onclick={guardar} disabled={guardando} class="px-5 py-2.5 bg-blue-600 text-white rounded-xl hover:bg-blue-700 font-medium text-sm shadow-md shadow-blue-600/20 disabled:opacity-50 flex items-center gap-2">
					{#if guardando}<i class="fas fa-spinner fa-spin"></i>{/if} Guardar
				</button>
			</div>
		</div>
	</div>
{/if}

<ConfirmModal
	open={!!paraCambiar}
	title={paraCambiar?.estado === 'baja' ? 'Dar de baja el horario' : 'Restaurar horario'}
	danger={paraCambiar?.estado === 'baja'}
	message={paraCambiar
		? paraCambiar.estado === 'baja'
			? `¿Dar de baja "${paraCambiar.horario.nombre}"? Ya no se podrá asignar; los ${porHorario[paraCambiar.horario.id_horario] ?? 0} trabajadores que lo tienen lo conservan.`
			: `¿Restaurar "${paraCambiar.horario.nombre}"? Volverá a ofrecerse al asignar horarios.`
		: ''}
	confirmLabel={paraCambiar?.estado === 'baja' ? 'Dar de baja' : 'Restaurar'}
	onConfirm={confirmarCambio}
	onClose={() => (paraCambiar = null)}
/>
