<script lang="ts">
	/**
	 * Ticket #152 (27/11/2026) "Evaluar cargo" — modal según las tres imágenes de la clienta (obrero, consultoría,
	 * gerencial). Lo abre el jefe inmediato (o un administrador) desde el historial de cargos de la ficha o desde el
	 * Tareo. El jefe solo ve esto (cargo y evaluación), no los datos personales ni beneficios del trabajador.
	 */
	import { onMount, untrack } from 'svelte';
	import { fade, scale } from 'svelte/transition';
	import { supabase } from '$lib/supabaseClient';
	import { toast } from '$lib/stores/toast';
	import { permisosState } from '$lib/stores/permisos.svelte';
	import { NIVELES_APTITUD, hoyLima, type CargoHistorial, type NivelAptitud } from '../services/personal.service';
	import {
		APTITUDES_GERENCIALES,
		CRITERIOS_CONSULTORIA,
		ESTADOS_EVALUACION,
		FORMATOS_EVALUACION,
		NOTAS,
		OBJETIVOS_GERENCIALES,
		OPCIONES_CALIDAD,
		OPCIONES_SEGURIDAD,
		UNIDADES_RENDIMIENTO,
		VALIDACIONES,
		aptitudesDesdeCargo,
		calificacionFinal,
		cumplimientoObjetivo,
		formatoSugerido,
		getEvaluacionesCargo,
		guardarEvaluacionCargo,
		porcentajeAptitud,
		promedioAptitudes,
		puntajeCriterio,
		subtotalCriterios,
		subtotalObjetivos,
		validacionAutomatica,
		type AptitudEvaluada,
		type EstadoEvaluacion,
		type EvaluacionCargo,
		type FormatoEvaluacion,
		type ValidacionAptitud
	} from '../services/evaluacionCargo';

	let {
		idPersonal,
		nombre,
		tramo,
		esObra = false,
		onClose,
		onGuardado = () => {}
	}: { idPersonal: number; nombre: string; tramo: CargoHistorial; esObra?: boolean; onClose: () => void; onGuardado?: () => void } = $props();

	const hoy = hoyLima();
	const inicioMes = `${hoy.slice(0, 8)}01`;
	const copia = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

	function nueva(formato: FormatoEvaluacion): EvaluacionCargo {
		return {
			id_personal: idPersonal,
			id_cargo_historial: tramo.id_cargo_historial ?? null,
			formato,
			cargo: tramo.cargo,
			periodo_inicio: tramo.fecha_inicio > inicioMes ? tramo.fecha_inicio : inicioMes,
			periodo_fin: hoy,
			aptitudes: formato === 'gerencial' ? [] : aptitudesDesdeCargo(tramo.aptitudes),
			criterios: formato === 'consultoria' ? copia(CRITERIOS_CONSULTORIA) : formato === 'gerencial' ? copia(APTITUDES_GERENCIALES) : [],
			objetivos: formato === 'gerencial' ? copia(OBJETIVOS_GERENCIALES) : [],
			peso_aptitudes: formato === 'gerencial' ? 40 : null,
			calificacion_final: null,
			observaciones: null,
			calidad_ejecucion: null,
			cumplimiento_seguridad: null,
			evaluado_por: permisosState.userName || '',
			fecha_evaluacion: hoy,
			estado: 'en_evaluacion',
			sustento: '',
			cargo_ascenso: null
		};
	}

	// Valor inicial a propósito: el modal se abre para un tramo y se cierra al terminar.
	let ev = $state<EvaluacionCargo>(untrack(() => nueva(formatoSugerido(tramo.cargo, { esObra }))));
	let historial = $state<EvaluacionCargo[]>([]);
	let verHistorial = $state(false);
	let viendo = $state<EvaluacionCargo | null>(null);
	let guardando = $state(false);
	const soloLectura = $derived(!!viendo);

	onMount(async () => {
		historial = await getEvaluacionesCargo(supabase, idPersonal);
	});

	function cambiarFormato(f: FormatoEvaluacion) {
		const base = nueva(f);
		ev = { ...base, periodo_inicio: ev.periodo_inicio, periodo_fin: ev.periodo_fin, evaluado_por: ev.evaluado_por, sustento: ev.sustento };
	}
	function importarAptitudes() {
		const nuevas = aptitudesDesdeCargo(tramo.aptitudes).filter((a) => !ev.aptitudes.some((x) => x.actividad.toLowerCase() === a.actividad.toLowerCase()));
		if (!nuevas.length) {
			toast.info(tramo.aptitudes?.length ? 'Las aptitudes del cargo ya están en la lista.' : 'El cargo no tiene aptitudes registradas: agrégalas abajo.');
			return;
		}
		ev.aptitudes = [...ev.aptitudes, ...nuevas];
	}
	const agregarAptitud = () =>
		(ev.aptitudes = [...ev.aptitudes, { actividad: '', nivelDeclarado: null, nivelEvaluado: null, unidad: ev.formato === 'obrero' ? UNIDADES_RENDIMIENTO[0] : null, esperado: null, real: null, calificacion: null, validacion: null }]);
	const quitar = <T,>(lista: T[], i: number) => lista.filter((_, j) => j !== i);

	const num = (v: string) => (v.trim() === '' ? null : Number(v.replace(',', '.')));
	const validacionDe = (a: AptitudEvaluada): ValidacionAptitud | null => a.validacion ?? validacionAutomatica(porcentajeAptitud(a, ev.formato));
	const barra = (pct: number | null) => (pct == null ? 'bg-slate-200' : pct >= 80 ? 'bg-emerald-500' : pct >= 60 ? 'bg-orange-400' : 'bg-rose-500');

	const mostrado = $derived(viendo ?? ev);
	const final = $derived(calificacionFinal(mostrado));
	const crit = $derived(subtotalCriterios(mostrado.criterios));
	const objetivos = $derived(subtotalObjetivos(mostrado.objetivos));
	const promedioAp = $derived(promedioAptitudes(mostrado.aptitudes, mostrado.formato));
	const subtitulo = $derived(FORMATOS_EVALUACION.find((f) => f.value === mostrado.formato)?.subtitulo ?? '');

	function errores(estado: EstadoEvaluacion): string | null {
		if (!ev.cargo.trim()) return 'Falta el cargo.';
		if (!ev.periodo_inicio || !ev.periodo_fin || ev.periodo_fin < ev.periodo_inicio) return 'Revisa el periodo evaluado.';
		if (!ev.evaluado_por.trim()) return 'Indica quién evalúa.';
		if (!ev.fecha_evaluacion) return 'Indica la fecha de evaluación.';
		if (!ev.sustento.trim()) return 'Escribe el sustento de la decisión.';
		if (ev.formato !== 'gerencial' && ev.aptitudes.some((a) => !a.actividad.trim())) return 'Hay una aptitud sin nombre.';
		if (ev.formato === 'obrero' && (!ev.calidad_ejecucion || !ev.cumplimiento_seguridad)) return 'Elige la calidad de ejecución y el cumplimiento de seguridad.';
		if (ev.formato !== 'obrero' && ev.criterios.length && crit.pesoTotal !== 100) return `El peso total debe ser 100 % (va ${crit.pesoTotal} %).`;
		if (estado === 'ascenso' && !ev.cargo_ascenso?.trim()) return 'Indica el cargo de ascenso propuesto.';
		return null;
	}

	async function guardar(estado: EstadoEvaluacion = ev.estado) {
		const error = errores(estado);
		if (error) {
			toast.error(error);
			return;
		}
		if (estado === 'baja' && !confirm(`¿Dar de baja el cargo "${ev.cargo}"? El cargo termina el ${ev.fecha_evaluacion.split('-').reverse().join('/')}.`)) return;
		guardando = true;
		try {
			await guardarEvaluacionCargo(supabase, { ...ev, estado, aptitudes: ev.aptitudes.map((a) => ({ ...a, validacion: validacionDe(a) })), registrado_por: permisosState.userName || null });
			toast.success(`Evaluación guardada: ${ESTADOS_EVALUACION[estado].texto.toLowerCase()}.`);
			onGuardado();
			onClose();
		} catch (err: any) {
			toast.error(err?.message || 'No se pudo guardar la evaluación.');
		} finally {
			guardando = false;
		}
	}

	const caja = 'px-2 py-1 border border-slate-200 rounded-lg text-sm bg-white disabled:bg-slate-50';
	const th = 'px-2 py-1.5 text-left font-semibold text-slate-600';
	const fechaCorta = (f: string) => f.split('-').reverse().join('/');
</script>

<div class="fixed inset-0 z-[110] bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-3" transition:fade={{ duration: 150 }}>
	<div class="bg-white rounded-2xl shadow-2xl w-full max-w-6xl max-h-[94vh] overflow-y-auto" transition:scale={{ duration: 200, start: 0.96 }}>
		<!-- Cabecera -->
		<div class="sticky top-0 z-10 bg-white border-b border-slate-100 px-5 py-3 flex flex-wrap items-start justify-between gap-3">
			<div>
				<h2 class="text-xl font-bold text-[#0f3b5e]">Evaluar cargo</h2>
				<p class="text-sm text-blue-600">{subtitulo} <span class="text-slate-500">· {nombre}</span></p>
			</div>
			<div class="flex items-center gap-2">
				<div class="relative">
					<button type="button" onclick={() => (verHistorial = !verHistorial)} class="px-3 py-1.5 rounded-xl border border-blue-300 text-blue-700 text-sm font-semibold hover:bg-blue-50">
						<i class="fas fa-clock-rotate-left mr-1"></i> Historial de evaluaciones ({historial.length}) <i class="fas fa-chevron-down text-[10px] ml-1"></i>
					</button>
					{#if verHistorial}
						<div class="absolute right-0 top-full mt-1 z-20 w-80 rounded-xl border border-slate-200 bg-white shadow-xl p-1 text-sm">
							{#if viendo}
								<button type="button" onclick={() => { viendo = null; verHistorial = false; }} class="w-full text-left px-3 py-2 rounded-lg text-orange-600 font-semibold hover:bg-orange-50"><i class="fas fa-plus mr-1"></i> Nueva evaluación</button>
							{/if}
							{#each historial as h (h.id_evaluacion)}
								<button type="button" onclick={() => { viendo = h; verHistorial = false; }} class="w-full text-left px-3 py-2 rounded-lg hover:bg-slate-50">
									<div class="flex items-center justify-between gap-2">
										<span class="font-semibold text-slate-700 truncate">{h.cargo}</span>
										<span class="text-xs font-bold text-slate-700">{h.calificacion_final != null ? `${h.calificacion_final} %` : '—'}</span>
									</div>
									<div class="flex items-center justify-between gap-2 text-xs text-slate-500">
										<span>{fechaCorta(h.fecha_evaluacion)} · {h.evaluado_por}</span>
										<span class={`px-1.5 rounded border ${ESTADOS_EVALUACION[h.estado].clase}`}>{ESTADOS_EVALUACION[h.estado].texto}</span>
									</div>
								</button>
							{:else}
								<p class="px-3 py-2 text-xs text-slate-400">Aún no hay evaluaciones de este trabajador.</p>
							{/each}
						</div>
					{/if}
				</div>
				<button type="button" onclick={onClose} class="w-9 h-9 rounded-full text-slate-400 hover:bg-slate-100" aria-label="Cerrar"><i class="fas fa-times"></i></button>
			</div>
		</div>

		<div class="px-5 py-4 space-y-5 text-sm">
			{#if viendo}
				<div class="rounded-xl bg-slate-50 border border-slate-200 px-3 py-2 text-xs text-slate-600">
					<i class="fas fa-eye mr-1"></i> Viendo la evaluación del {fechaCorta(viendo.fecha_evaluacion)} (solo lectura). Registrada por {viendo.registrado_por || viendo.evaluado_por}.
				</div>
			{/if}

			<!-- Cargo -->
			<div class="grid grid-cols-1 md:grid-cols-4 gap-3">
				<label class="flex flex-col gap-1"><span class="font-semibold text-[#0f3b5e]">Cargo *</span><input class={caja} value={mostrado.cargo} disabled /></label>
				<label class="flex flex-col gap-1"><span class="font-semibold text-[#0f3b5e]">Clasificación *</span><input class={caja} value={tramo.clasificacion === 'secundario' ? 'Secundario' : 'Principal'} disabled /></label>
				<label class="flex flex-col gap-1"><span class="font-semibold text-[#0f3b5e]">Fecha de inicio *</span><input type="date" class={caja} value={tramo.fecha_inicio} disabled /></label>
				<label class="flex flex-col gap-1"><span class="font-semibold text-[#0f3b5e]">Fecha de fin</span><input type="date" class={caja} value={tramo.fecha_fin ?? ''} disabled /></label>
			</div>

			<div class="flex flex-wrap items-end gap-3">
				<label class="flex flex-col gap-1"><span class="font-semibold text-[#0f3b5e]">Formato de evaluación</span>
					<select class={caja} value={mostrado.formato} disabled={soloLectura} onchange={(e) => cambiarFormato((e.currentTarget as HTMLSelectElement).value as FormatoEvaluacion)}>
						{#each FORMATOS_EVALUACION as f (f.value)}<option value={f.value}>{f.label}</option>{/each}
					</select>
				</label>
				<div class="flex items-end gap-2">
					<label class="flex flex-col gap-1"><span class="font-semibold text-[#0f3b5e]">Periodo evaluado *</span><input type="date" class={caja} bind:value={ev.periodo_inicio} disabled={soloLectura} /></label>
					<span class="pb-1.5 text-slate-400">–</span>
					<input type="date" class={caja} bind:value={ev.periodo_fin} disabled={soloLectura} />
				</div>
				{#if mostrado.formato !== 'gerencial' && !soloLectura}
					<button type="button" onclick={importarAptitudes} class="px-3 py-1.5 rounded-xl border border-orange-300 bg-orange-50 text-orange-700 font-semibold hover:bg-orange-100"><i class="fas fa-file-import mr-1"></i> Importar aptitudes del cargo</button>
				{/if}
			</div>

			<!-- Aptitudes: obrero y consultoría -->
			{#if mostrado.formato !== 'gerencial'}
				<section>
					<h3 class="text-base font-bold text-[#0f3b5e]"><i class="fas fa-clipboard-check text-blue-600 mr-1"></i> {mostrado.formato === 'obrero' ? 'Evaluación de aptitudes y rendimiento' : 'Evaluación de aptitudes técnicas'}</h3>
					<p class="text-xs text-blue-600 mb-2">{mostrado.formato === 'obrero' ? 'Valida el dominio técnico y la productividad de cada actividad.' : 'Competencias técnicas clave del cargo y su nivel de dominio.'}</p>
					<div class="overflow-x-auto rounded-xl border border-slate-200">
						<table class="w-full min-w-[860px] text-sm">
							<thead class="bg-slate-50">
								<tr>
									<th class={th}>{mostrado.formato === 'obrero' ? 'Actividad específica' : 'Aptitud técnica'}</th>
									<th class={th}>Nivel declarado</th>
									<th class={th}>Nivel evaluado</th>
									{#if mostrado.formato === 'obrero'}<th class={th}>Unidad</th><th class={th}>Rend. esperado</th><th class={th}>Rend. real</th><th class={th}>Cumplimiento</th>{:else}<th class={th}>Calificación</th>{/if}
									<th class={th}>Validación</th>
									<th class="w-8"></th>
								</tr>
							</thead>
							<tbody class="divide-y divide-slate-100">
								{#each mostrado.aptitudes as a, i (i)}
									{@const pct = porcentajeAptitud(a, mostrado.formato)}
									{@const val = a.validacion ?? validacionAutomatica(pct)}
									<tr>
										<td class="px-2 py-1"><input class={`${caja} w-full`} bind:value={a.actividad} disabled={soloLectura} placeholder="Actividad" /></td>
										<td class="px-2 py-1"><select class={caja} bind:value={a.nivelDeclarado} disabled={soloLectura}><option value={null}>—</option>{#each NIVELES_APTITUD as n (n.value)}<option value={n.value as NivelAptitud}>{n.label}</option>{/each}</select></td>
										<td class="px-2 py-1"><select class={caja} bind:value={a.nivelEvaluado} disabled={soloLectura}><option value={null}>—</option>{#each NIVELES_APTITUD as n (n.value)}<option value={n.value as NivelAptitud}>{n.label}</option>{/each}</select></td>
										{#if mostrado.formato === 'obrero'}
											<td class="px-2 py-1"><select class={caja} bind:value={a.unidad} disabled={soloLectura}>{#each UNIDADES_RENDIMIENTO as u (u)}<option value={u}>{u}</option>{/each}</select></td>
											<td class="px-2 py-1"><input type="number" min="0" step="0.1" class={`${caja} w-20 text-right`} value={a.esperado ?? ''} oninput={(e) => (a.esperado = num((e.currentTarget as HTMLInputElement).value))} disabled={soloLectura} /></td>
											<td class="px-2 py-1"><input type="number" min="0" step="0.1" class={`${caja} w-20 text-right`} value={a.real ?? ''} oninput={(e) => (a.real = num((e.currentTarget as HTMLInputElement).value))} disabled={soloLectura} /></td>
										{:else}
											<td class="px-2 py-1"><input type="number" min="0" max="100" class={`${caja} w-20 text-right`} value={a.calificacion ?? ''} oninput={(e) => (a.calificacion = num((e.currentTarget as HTMLInputElement).value))} disabled={soloLectura} placeholder="%" /></td>
										{/if}
										{#if mostrado.formato === 'obrero'}
											<td class="px-2 py-1">
												<div class="flex items-center gap-2"><b class="w-10 text-right">{pct == null ? '—' : `${pct} %`}</b><div class="h-2 w-20 rounded-full bg-slate-100"><div class={`h-2 rounded-full ${barra(pct)}`} style={`width:${pct ?? 0}%`}></div></div></div>
											</td>
										{/if}
										<td class="px-2 py-1">
											<select class={`${caja} font-semibold ${val ? VALIDACIONES[val].clase : ''}`} value={a.validacion ?? ''} disabled={soloLectura} onchange={(e) => (a.validacion = ((e.currentTarget as HTMLSelectElement).value || null) as ValidacionAptitud | null)}>
												<option value="">{val ? `${VALIDACIONES[val].texto} (auto)` : 'Automática'}</option>
												{#each Object.entries(VALIDACIONES) as [k, v] (k)}<option value={k}>{v.texto}</option>{/each}
											</select>
										</td>
										<td class="px-1">{#if !soloLectura}<button type="button" onclick={() => (ev.aptitudes = quitar(ev.aptitudes, i))} class="text-rose-500 hover:text-rose-700" aria-label="Quitar"><i class="fas fa-trash text-xs"></i></button>{/if}</td>
									</tr>
								{:else}
									<tr><td colspan="9" class="px-3 py-3 text-center text-xs text-slate-400">Sin aptitudes: usa "Importar aptitudes del cargo" o agrega una.</td></tr>
								{/each}
							</tbody>
						</table>
					</div>
					<div class="mt-1 flex items-center justify-between text-xs">
						{#if !soloLectura}<button type="button" onclick={agregarAptitud} class="text-blue-600 font-semibold hover:underline"><i class="fas fa-plus mr-1"></i> Agregar aptitud</button>{:else}<span></span>{/if}
						<span class="text-slate-500">Promedio de aptitudes: <b class="text-slate-800">{promedioAp == null ? '—' : `${promedioAp} %`}</b></span>
					</div>
					{#if mostrado.formato === 'obrero'}
						<label class="mt-2 flex flex-col gap-1"><span class="font-semibold text-[#0f3b5e]">Observaciones de aptitudes <span class="font-normal text-slate-400">(opcional)</span></span>
							<textarea rows="2" class={caja} bind:value={ev.observaciones} disabled={soloLectura}></textarea>
						</label>
					{/if}
				</section>
			{/if}

			<!-- Criterios: desempeño profesional (consultoría) o aptitudes gerenciales -->
			{#if mostrado.formato !== 'obrero'}
				<div class={mostrado.formato === 'gerencial' ? 'grid grid-cols-1 lg:grid-cols-2 gap-4' : ''}>
					<section>
						<h3 class="text-base font-bold text-[#0f3b5e]"><i class={`fas ${mostrado.formato === 'gerencial' ? 'fa-users' : 'fa-chart-column'} text-blue-600 mr-1`}></i> {mostrado.formato === 'gerencial' ? 'Evaluación de aptitudes gerenciales' : 'Evaluación del desempeño profesional'}</h3>
						{#if mostrado.formato === 'consultoria'}<p class="text-xs text-blue-600 mb-2">Valoración del desempeño según criterios y ponderaciones del cargo.</p>{/if}
						<div class="overflow-x-auto rounded-xl border border-slate-200 mt-2">
							<table class="w-full min-w-[480px] text-sm">
								<thead class="bg-slate-50"><tr><th class={th}>{mostrado.formato === 'gerencial' ? 'Aptitud del cargo' : 'Criterio'}</th><th class={th}>Peso</th><th class={th}>Calificación</th><th class={`${th} text-right`}>Puntaje ponderado</th><th class="w-6"></th></tr></thead>
								<tbody class="divide-y divide-slate-100">
									{#each mostrado.criterios as c, i (i)}
										<tr>
											<td class="px-2 py-1"><input class={`${caja} w-full`} bind:value={c.criterio} disabled={soloLectura} /></td>
											<td class="px-2 py-1"><input type="number" min="0" max="100" class={`${caja} w-16 text-right`} value={c.peso} oninput={(e) => (c.peso = num((e.currentTarget as HTMLInputElement).value) ?? 0)} disabled={soloLectura} /> %</td>
											<td class="px-2 py-1"><select class={caja} bind:value={c.nota} disabled={soloLectura}><option value={null}>Elegir…</option>{#each NOTAS as n (n.value)}<option value={n.value}>{n.label}</option>{/each}</select></td>
											<td class="px-2 py-1 text-right font-bold">{c.nota == null ? '—' : `${puntajeCriterio(c)} %`}</td>
											<td class="px-1">{#if !soloLectura}<button type="button" onclick={() => (ev.criterios = quitar(ev.criterios, i))} class="text-rose-500" aria-label="Quitar"><i class="fas fa-trash text-xs"></i></button>{/if}</td>
										</tr>
									{/each}
								</tbody>
								<tfoot class="bg-slate-50 text-sm">
									<tr>
										<td class="px-2 py-1.5">{#if !soloLectura}<button type="button" onclick={() => (ev.criterios = [...ev.criterios, { criterio: '', peso: 0, nota: null }])} class="text-blue-600 text-xs font-semibold hover:underline"><i class="fas fa-plus mr-1"></i> Agregar</button>{/if}</td>
										<td class="px-2 py-1.5" colspan="2"><span class={`px-2 py-0.5 rounded-lg font-bold ${crit.pesoTotal === 100 ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-600'}`}>Peso total: {crit.pesoTotal} %</span></td>
										<td class="px-2 py-1.5 text-right font-bold">Subtotal: {crit.subtotal} %</td>
										<td></td>
									</tr>
								</tfoot>
							</table>
						</div>
					</section>

					{#if mostrado.formato === 'gerencial'}
						<section>
							<div class="flex items-center justify-between">
								<h3 class="text-base font-bold text-[#0f3b5e]"><i class="fas fa-bullseye text-blue-600 mr-1"></i> Cumplimiento de objetivos (KPI)</h3>
								{#if !soloLectura}<button type="button" onclick={() => (ev.objetivos = [...ev.objetivos, { indicador: '', unidad: '%', meta: null, real: null }])} class="px-2 py-1 rounded-lg border border-blue-300 text-blue-700 text-xs font-semibold hover:bg-blue-50"><i class="fas fa-plus mr-1"></i> Agregar indicador</button>{/if}
							</div>
							<div class="overflow-x-auto rounded-xl border border-slate-200 mt-2">
								<table class="w-full min-w-[480px] text-sm">
									<thead class="bg-slate-50"><tr><th class={th}>Indicador</th><th class={th}>Unidad</th><th class={th}>Meta</th><th class={th}>Resultado real</th><th class={th}>Cumplimiento</th><th class="w-6"></th></tr></thead>
									<tbody class="divide-y divide-slate-100">
										{#each mostrado.objetivos as o, i (i)}
											{@const pct = cumplimientoObjetivo(o)}
											<tr>
												<td class="px-2 py-1"><input class={`${caja} w-full`} bind:value={o.indicador} disabled={soloLectura} /></td>
												<td class="px-2 py-1"><select class={caja} bind:value={o.unidad} disabled={soloLectura}><option value="S/">S/</option><option value="%">%</option><option value="und">und</option></select></td>
												<td class="px-2 py-1"><input type="number" min="0" class={`${caja} w-24 text-right`} value={o.meta ?? ''} oninput={(e) => (o.meta = num((e.currentTarget as HTMLInputElement).value))} disabled={soloLectura} /></td>
												<td class="px-2 py-1"><input type="number" min="0" class={`${caja} w-24 text-right`} value={o.real ?? ''} oninput={(e) => (o.real = num((e.currentTarget as HTMLInputElement).value))} disabled={soloLectura} /></td>
												<td class="px-2 py-1"><div class="flex items-center gap-2"><b class="w-11 text-right">{pct == null ? '—' : `${pct} %`}</b><div class="h-2 w-16 rounded-full bg-slate-100"><div class={`h-2 rounded-full ${barra(pct)}`} style={`width:${pct ?? 0}%`}></div></div></div></td>
												<td class="px-1">{#if !soloLectura}<button type="button" onclick={() => (ev.objetivos = quitar(ev.objetivos, i))} class="text-rose-500" aria-label="Quitar"><i class="fas fa-trash text-xs"></i></button>{/if}</td>
											</tr>
										{/each}
									</tbody>
									<tfoot class="bg-slate-50"><tr><td class="px-2 py-1.5 font-bold" colspan="4">Subtotal objetivos (KPI)</td><td class="px-2 py-1.5 font-bold" colspan="2">{objetivos == null ? '—' : `${objetivos} %`}</td></tr></tfoot>
								</table>
							</div>
						</section>
					{/if}
				</div>
			{/if}

			<!-- Calificación final -->
			<div class="flex flex-wrap items-center gap-4 rounded-xl border border-blue-200 bg-blue-50/40 px-4 py-2">
				{#if mostrado.formato === 'gerencial'}
					<span class="font-semibold text-[#0f3b5e]"><i class="fas fa-sliders mr-1"></i> Ponderación de la evaluación</span>
					<span>Aptitudes <input type="number" min="0" max="100" class={`${caja} w-16 text-right`} value={mostrado.peso_aptitudes ?? 40} oninput={(e) => (ev.peso_aptitudes = Math.min(100, Math.max(0, num((e.currentTarget as HTMLInputElement).value) ?? 0)))} disabled={soloLectura} /> % · {crit.subtotal} %</span>
					<span>Objetivos <b>{100 - (mostrado.peso_aptitudes ?? 40)} %</b> · {objetivos ?? '—'} %</span>
				{/if}
				<span class="ml-auto font-bold text-[#0f3b5e]"><i class="fas fa-award text-emerald-600 mr-1"></i> Calificación final</span>
				<span class={`px-4 py-1 rounded-xl border-2 text-xl font-bold ${final == null ? 'border-slate-200 text-slate-400' : final >= 80 ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : final >= 60 ? 'border-orange-300 bg-orange-50 text-orange-600' : 'border-rose-300 bg-rose-50 text-rose-600'}`}>{final == null ? '—' : `${final} %`}</span>
			</div>

			<!-- Evaluación final del cargo -->
			<section class="rounded-xl border border-blue-300 px-4 py-3 space-y-3">
				<h3 class="text-base font-bold text-[#0f3b5e]"><i class="fas fa-medal text-blue-600 mr-1"></i> Evaluación final del cargo</h3>
				<div class="grid grid-cols-1 md:grid-cols-3 gap-3">
					<label class="flex flex-col gap-1"><span class="font-semibold text-[#0f3b5e]">Evaluado por *</span><input class={caja} bind:value={ev.evaluado_por} disabled={soloLectura} placeholder="Ej. Ing. residente de obra" /></label>
					<label class="flex flex-col gap-1"><span class="font-semibold text-[#0f3b5e]">Fecha de evaluación *</span><input type="date" class={caja} bind:value={ev.fecha_evaluacion} disabled={soloLectura} /></label>
					<div class="flex flex-col gap-1"><span class="font-semibold text-[#0f3b5e]">Estado *</span><span class={`self-start px-3 py-1 rounded-lg border font-semibold ${ESTADOS_EVALUACION[mostrado.estado].clase}`}>{ESTADOS_EVALUACION[mostrado.estado].texto}</span></div>
				</div>
				{#if mostrado.formato === 'obrero'}
					<div class="grid grid-cols-1 md:grid-cols-2 gap-3">
						<label class="flex flex-col gap-1"><span class="font-semibold text-[#0f3b5e]">Calidad de ejecución *</span><select class={caja} bind:value={ev.calidad_ejecucion} disabled={soloLectura}><option value={null}>Seleccionar</option>{#each OPCIONES_CALIDAD as o (o)}<option value={o}>{o}</option>{/each}</select></label>
						<label class="flex flex-col gap-1"><span class="font-semibold text-[#0f3b5e]">Cumplimiento de seguridad *</span><select class={caja} bind:value={ev.cumplimiento_seguridad} disabled={soloLectura}><option value={null}>Seleccionar</option>{#each OPCIONES_SEGURIDAD as o (o)}<option value={o}>{o}</option>{/each}</select></label>
					</div>
				{/if}
				<label class="flex flex-col gap-1"><span class="font-semibold text-[#0f3b5e]">Sustento de la decisión *</span>
					<textarea rows="2" class={caja} bind:value={ev.sustento} disabled={soloLectura} placeholder="Describe el sustento de la decisión del cargo según la evaluación de aptitudes y rendimiento…"></textarea>
				</label>
				<label class="flex flex-col gap-1 md:w-1/2"><span class="font-semibold text-[#0f3b5e]">Cargo de ascenso propuesto <span class="font-normal text-slate-400">(para "Recomendar ascenso", sujeto a aprobación)</span></span>
					<input class={caja} bind:value={ev.cargo_ascenso} disabled={soloLectura} placeholder="Ej. Capataz de obra" />
				</label>
				{#if !soloLectura}
					<div class="grid grid-cols-2 md:grid-cols-4 gap-2 pt-1">
						<button type="button" disabled={guardando} onclick={() => guardar('aprobado')} class="py-2 rounded-xl border-2 border-emerald-300 bg-emerald-50 text-emerald-700 font-semibold hover:bg-emerald-100 disabled:opacity-50"><i class="fas fa-check mr-1"></i> Aprobar cargo</button>
						<button type="button" disabled={guardando} onclick={() => guardar('en_evaluacion')} class="py-2 rounded-xl border-2 border-orange-300 bg-orange-50 text-orange-600 font-semibold hover:bg-orange-100 disabled:opacity-50"><i class="fas fa-circle-exclamation mr-1"></i> Mantener en evaluación</button>
						<button type="button" disabled={guardando} onclick={() => guardar('ascenso')} class="py-2 rounded-xl border-2 border-blue-300 bg-blue-50 text-blue-700 font-semibold hover:bg-blue-100 disabled:opacity-50"><i class="fas fa-arrow-up mr-1"></i> Recomendar ascenso</button>
						<button type="button" disabled={guardando} onclick={() => guardar('baja')} class="py-2 rounded-xl border-2 border-rose-300 bg-rose-50 text-rose-600 font-semibold hover:bg-rose-100 disabled:opacity-50"><i class="fas fa-trash mr-1"></i> Dar de baja cargo</button>
					</div>
				{/if}
			</section>
		</div>

		<div class="sticky bottom-0 bg-white border-t border-slate-100 px-5 py-3 flex justify-end gap-2">
			<button type="button" onclick={onClose} class="px-5 py-2 rounded-xl border border-slate-200 font-semibold text-slate-700 hover:bg-slate-50">{soloLectura ? 'Cerrar' : 'Cancelar'}</button>
			{#if !soloLectura}
				<button type="button" disabled={guardando} onclick={() => guardar()} class="px-5 py-2 rounded-xl bg-orange-500 text-white font-semibold hover:bg-orange-600 disabled:opacity-50">{guardando ? 'Guardando…' : 'Guardar evaluación'}</button>
			{/if}
		</div>
	</div>
</div>
