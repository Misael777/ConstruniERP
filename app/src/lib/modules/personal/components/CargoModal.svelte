<script lang="ts">
	/**
	 * Registrar / editar / ver un cargo del trabajador (ticket #144, 26/11/2026, maqueta de la clienta): cargo,
	 * clasificación (principal o secundario), fechas y las APTITUDES TÉCNICAS del cargo con su nivel. Sugiere las
	 * actividades que ya tienen otros trabajadores con el mismo cargo y deja importarlas de uno de ellos (los niveles se
	 * asignan al nuevo trabajador). Las aptitudes pasan a la ficha y el tareo las compara con los requerimientos (#118).
	 */
	import { fade, scale } from 'svelte/transition';
	import { supabase } from '$lib/supabaseClient';
	import InputConLista from '$lib/shared/components/InputConLista.svelte';
	import {
		CARGOS_POR_AREA,
		NIVELES_APTITUD,
		aptitudesPorCargo,
		type CargoHistorial,
		type NivelAptitud
	} from '../services/personal.service';

	let {
		open,
		inicial,
		idPersonal,
		sugerencias = [],
		soloLectura = false,
		conClasificacion = true,
		onguardar,
		oncerrar
	}: {
		open: boolean;
		inicial: CargoHistorial | null;
		idPersonal: number | null;
		sugerencias?: string[];
		soloLectura?: boolean;
		/** false si la base aún no tiene la migración 20261127140000 (sin clasificación ni aptitudes). */
		conClasificacion?: boolean;
		onguardar: (c: CargoHistorial) => void;
		oncerrar: () => void;
	} = $props();

	const OPCIONES_CARGO = CARGOS_POR_AREA.flatMap((a) => a.grupos.flatMap((g) => g.cargos.map((c) => ({ value: c, grupo: `${a.area} · ${g.grupo}` }))));
	const clave = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();

	let cargo = $state('');
	let clasificacion = $state<'principal' | 'secundario'>('principal');
	let fechaInicio = $state('');
	let fechaFin = $state('');
	let observacion = $state('');
	let filas = $state<{ actividad: string; sel: boolean; nivel: NivelAptitud | null }[]>([]);
	let nuevaActividad = $state('');
	let otros = $state<{ idPersonal: number; nombre: string; aptitudes: { actividad: string; nivel: NivelAptitud | null }[] }[]>([]);
	let importarAbierto = $state(false);
	let importarDe = $state<number | null>(null);
	let error = $state('');

	$effect(() => {
		if (!open || !inicial) return;
		cargo = inicial.cargo;
		clasificacion = inicial.clasificacion ?? 'principal';
		fechaInicio = inicial.fecha_inicio;
		fechaFin = inicial.fecha_fin ?? '';
		observacion = inicial.observacion ?? '';
		filas = (inicial.aptitudes ?? []).map((a) => ({ actividad: a.actividad, sel: true, nivel: a.nivel }));
		nuevaActividad = '';
		importarAbierto = false;
		importarDe = null;
		error = '';
	});

	// Actividades de otros trabajadores con el mismo cargo: se sugieren (sin marcar) y se pueden importar.
	let ultimoCargo = '';
	$effect(() => {
		if (!open || !conClasificacion) return;
		const c = cargo.trim();
		if (c === ultimoCargo) return;
		ultimoCargo = c;
		void aptitudesPorCargo(supabase, c, idPersonal).then((lista) => {
			if (cargo.trim() !== c) return;
			otros = lista;
			importarDe = lista[0]?.idPersonal ?? null;
			for (const o of lista) for (const a of o.aptitudes) agregarFila(a.actividad, false);
		});
	});

	function agregarFila(actividad: string, sel = true) {
		const t = actividad.trim().slice(0, 80);
		if (!t) return;
		const existe = filas.find((f) => clave(f.actividad) === clave(t));
		if (existe) {
			if (sel) existe.sel = true;
			return;
		}
		filas = [...filas, { actividad: t, sel, nivel: null }];
	}
	function agregarNueva(v = nuevaActividad) {
		agregarFila(v);
		nuevaActividad = '';
	}
	function importar() {
		const o = otros.find((x) => x.idPersonal === importarDe);
		if (!o) return;
		for (const a of o.aptitudes) agregarFila(a.actividad, true);
		importarAbierto = false;
	}

	function guardar() {
		if (!cargo.trim()) return void (error = 'Elige o escribe el cargo.');
		if (!fechaInicio) return void (error = 'Indica la fecha de inicio.');
		if (fechaFin && fechaFin < fechaInicio) return void (error = 'La fecha de fin no puede ser anterior al inicio.');
		const sinNivel = filas.filter((f) => f.sel && !f.nivel);
		if (sinNivel.length) return void (error = `Asigna el nivel de: ${sinNivel.map((f) => f.actividad).join(', ')}.`);
		onguardar({
			...inicial!,
			cargo: cargo.trim(),
			clasificacion,
			fecha_inicio: fechaInicio,
			fecha_fin: fechaFin || null,
			observacion: observacion.trim() || null,
			aptitudes: filas.filter((f) => f.sel).map((f) => ({ actividad: f.actividad, nivel: f.nivel }))
		});
	}
</script>

{#if open && inicial}
	<div class="fixed inset-0 z-[110] flex items-center justify-center bg-slate-900/40 p-3" transition:fade={{ duration: 120 }}>
		<div class="w-full max-w-2xl bg-white rounded-2xl shadow-xl flex flex-col max-h-[92vh]" transition:scale={{ duration: 150, start: 0.97 }} role="dialog" aria-modal="true" aria-labelledby="cargo-modal-titulo">
			<div class="px-5 py-4 border-b border-slate-100 flex items-start justify-between gap-3">
				<div>
					<h3 id="cargo-modal-titulo" class="text-lg font-bold text-slate-800">{soloLectura ? 'Cargo' : inicial.id_cargo_historial || inicial.cargo ? 'Editar cargo' : 'Registrar cargo'}</h3>
					<p class="text-sm text-blue-700">Define el cargo y las aptitudes técnicas del trabajador.</p>
				</div>
				<button type="button" onclick={oncerrar} class="w-8 h-8 rounded-full text-slate-400 hover:bg-slate-100" aria-label="Cerrar"><i class="fas fa-xmark"></i></button>
			</div>
			<fieldset disabled={soloLectura} class="px-5 py-4 flex flex-col gap-4 overflow-y-auto">
				<div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
					<label class="flex flex-col gap-1 text-sm font-semibold text-slate-700 sm:col-span-1">
						<span>Cargo <span class="text-rose-500">*</span></span>
						<InputConLista bind:value={cargo} opciones={OPCIONES_CARGO} maxlength={100} placeholder="Elige o escribe" disabled={soloLectura} class="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm font-normal" />
					</label>
					{#if conClasificacion}
						<label class="flex flex-col gap-1 text-sm font-semibold text-slate-700">
							<span>Clasificación <span class="text-rose-500">*</span></span>
							<select bind:value={clasificacion} class="px-3 py-2 border border-slate-200 rounded-lg text-sm font-normal bg-white">
								<option value="principal">Principal</option>
								<option value="secundario">Secundario</option>
							</select>
						</label>
					{/if}
					<label class="flex flex-col gap-1 text-sm font-semibold text-slate-700">
						<span>Fecha de inicio <span class="text-rose-500">*</span></span>
						<input type="date" bind:value={fechaInicio} class="px-3 py-2 border border-slate-200 rounded-lg text-sm font-normal" />
					</label>
					{#if inicial.id_cargo_historial || fechaFin}
						<label class="flex flex-col gap-1 text-sm font-semibold text-slate-700">
							<span>Fecha de fin</span>
							<input type="date" bind:value={fechaFin} class="px-3 py-2 border border-slate-200 rounded-lg text-sm font-normal" />
						</label>
					{/if}
				</div>

				{#if conClasificacion}
					<div class="flex flex-wrap items-end gap-2">
						<div class="mr-auto">
							<h4 class="font-bold text-slate-800">Aptitudes técnicas del cargo</h4>
							<p class="text-xs text-blue-700">Selecciona las actividades que domina y asigna su nivel.</p>
						</div>
						{#if !soloLectura}
							<div class="relative">
								<button type="button" onclick={() => (importarAbierto = !importarAbierto)} disabled={!otros.length} title={otros.length ? '' : 'Ningún otro trabajador con este cargo tiene aptitudes registradas'} class="px-3 py-1.5 rounded-lg border border-orange-400 text-orange-600 text-sm font-semibold hover:bg-orange-50 disabled:opacity-40"><i class="fas fa-file-import"></i> Importar aptitudes</button>
								{#if importarAbierto}
									<div class="absolute right-0 mt-1 w-72 rounded-xl border border-slate-200 bg-white shadow-xl p-3 z-10 flex flex-col gap-2">
										<span class="font-bold text-slate-800 text-sm">Importar de otro trabajador</span>
										<span class="text-xs text-slate-500">Trabajadores con cargo {cargo}</span>
										<div class="flex flex-col gap-1 max-h-48 overflow-y-auto">
											{#each otros as o (o.idPersonal)}
												<label class="flex items-center gap-2 text-sm text-slate-700"><input type="radio" name="importar-de" value={o.idPersonal} bind:group={importarDe} /> {o.nombre} · {o.aptitudes.length} actividad{o.aptitudes.length === 1 ? '' : 'es'}</label>
											{/each}
										</div>
										<span class="text-[11px] text-slate-400">Los niveles se asignan al nuevo trabajador.</span>
										<button type="button" onclick={importar} disabled={!importarDe} class="px-3 py-1.5 rounded-lg bg-orange-500 text-white text-sm font-bold hover:bg-orange-600 disabled:opacity-40">Importar actividades</button>
									</div>
								{/if}
							</div>
						{/if}
					</div>
					<div class="border border-slate-200 rounded-xl overflow-hidden">
						<div class="grid grid-cols-[4.5rem_minmax(0,1fr)_9rem] gap-2 px-3 py-2 bg-slate-100 text-xs font-semibold text-slate-600">
							<span>Selección</span><span>Actividad específica</span><span>Nivel</span>
						</div>
						{#each filas as f, i (f.actividad)}
							<div class="grid grid-cols-[4.5rem_minmax(0,1fr)_9rem] items-center gap-2 px-3 py-1.5 border-t border-slate-100 text-sm">
								<span class="text-center"><input type="checkbox" bind:checked={f.sel} aria-label={`Seleccionar ${f.actividad}`} class="w-4 h-4" /></span>
								<span class={f.sel ? 'text-slate-800' : 'text-slate-500'}>{f.actividad}</span>
								<select value={f.nivel ?? ''} onchange={(e) => { f.nivel = (e.currentTarget.value || null) as NivelAptitud | null; if (f.nivel) f.sel = true; }} aria-label={`Nivel de ${f.actividad}`} class={`px-2 py-1 border rounded-lg text-sm bg-white ${f.sel && !f.nivel ? 'border-rose-300' : 'border-slate-200'}`}>
									<option value="">Seleccionar nivel</option>
									{#each NIVELES_APTITUD as n (n.value)}<option value={n.value}>{n.label}</option>{/each}
								</select>
							</div>
						{:else}
							<p class="px-3 py-3 text-xs text-slate-400 italic border-t border-slate-100">Sin actividades. Agrega las que domina (ej. Asentado de ladrillos, Tarrajeo de muros).</p>
						{/each}
						{#if !soloLectura}
							<div class="flex items-center gap-2 px-3 py-2 border-t border-slate-100 bg-slate-50/60">
								<span class="flex-1">
									<InputConLista bind:value={nuevaActividad} opciones={sugerencias.filter((s) => !filas.some((f) => clave(f.actividad) === clave(s)))} onelegir={(v) => agregarNueva(v)} onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); agregarNueva(); } }} maxlength={80} placeholder="Escribe una actividad…" class="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg text-sm bg-white" />
								</span>
								<button type="button" onclick={() => agregarNueva()} class="px-3 py-1.5 rounded-lg border border-orange-400 text-orange-600 text-sm font-semibold hover:bg-orange-50">+ Agregar actividad</button>
							</div>
						{/if}
					</div>
				{/if}

				<label class="flex flex-col gap-1 text-sm font-semibold text-slate-700">
					<span>Observaciones <span class="font-normal text-slate-400">(opcional)</span></span>
					<textarea bind:value={observacion} maxlength="200" rows="2" class="px-3 py-2 border border-slate-200 rounded-lg text-sm font-normal"></textarea>
				</label>
				{#if error}<span class="text-sm text-rose-600">{error}</span>{/if}
			</fieldset>
			<div class="px-5 py-3 border-t border-slate-100 flex justify-end gap-2">
				<button type="button" onclick={oncerrar} class="px-5 py-2 rounded-xl border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50">{soloLectura ? 'Cerrar' : 'Cancelar'}</button>
				{#if !soloLectura}<button type="button" onclick={guardar} class="px-5 py-2 rounded-xl bg-orange-500 text-white text-sm font-bold hover:bg-orange-600">Guardar cargo</button>{/if}
			</div>
		</div>
	</div>
{/if}
