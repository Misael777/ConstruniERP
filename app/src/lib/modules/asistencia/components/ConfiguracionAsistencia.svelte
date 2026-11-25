<script lang="ts">
	/**
	 * Configuración de asistencia de un trabajador (Asistencia → pestaña Configuración; a pedido del usuario,
	 * 11/11/2026, salió de la ficha de Personal): horario, métodos de registro, huelleros donde marca y
	 * consentimiento biométrico. Guarda solo esos datos (guardarAsistenciaPersonal); el resto de la ficha no se toca.
	 */
	import { onMount } from 'svelte';
	import { supabase } from '$lib/supabaseClient';
	import { toast } from '$lib/stores/toast';
	import { describeError } from '$lib/shared/describeError';
	import SelectConSaldo from '$lib/shared/components/SelectConSaldo.svelte';
	import {
		getUsuariosErp,
		getBiometriaGuardada,
		guardarAsistenciaPersonal,
		type DatosAsistenciaPersonal,
		type Personal
	} from '$lib/modules/personal/services/personal.service';
	import { getHorarios, esLibre, hhmm, resumenHorario, type Horario } from '$lib/modules/personal/services/horarios.service';
	import { getHuellerosElegibles, type HuelleroElegible } from '$lib/modules/asistencia/services/huelleros.service';

	let { trabajador, onSaved }: { trabajador: Personal; onSaved: () => void } = $props();

	let horarios = $state<Horario[]>([]);
	let huelleros = $state<HuelleroElegible[]>([]);
	let usuariosErp = $state<{ value: string; label: string }[]>([]);
	let biometria = $state<{ huellas: number; rostros: number } | null>(null);
	let cargando = $state(true);
	let guardando = $state(false);

	let form = $state<DatosAsistenciaPersonal>({ id_horario: null, id_empleado: null, consentimiento_biometrico: false, consentimiento_fecha: null, registro_manual: false });
	let elegidos = $state<number[]>([]);
	let errorFecha = $state('');

	/** Vuelve a los datos guardados del trabajador (al cambiar de trabajador o al pulsar Cancelar). */
	function restablecer() {
		form = {
			id_horario: trabajador.id_horario ?? null,
			id_empleado: trabajador.id_empleado ?? null,
			consentimiento_biometrico: !!trabajador.consentimiento_biometrico,
			consentimiento_fecha: trabajador.consentimiento_fecha ?? null,
			registro_manual: !!trabajador.registro_manual
		};
		elegidos = (trabajador.personal_huellero ?? []).map((v) => v.id_dispositivo);
		errorFecha = '';
	}

	$effect(() => {
		void trabajador.id_personal;
		restablecer();
		cargarBiometria(trabajador.id_personal);
	});

	async function cargarBiometria(id: number) {
		try {
			const todo = await getBiometriaGuardada(supabase);
			if (trabajador.id_personal === id) biometria = todo[id] ?? null;
		} catch {
			biometria = null;
		}
	}

	onMount(async () => {
		try {
			[horarios, huelleros, usuariosErp] = await Promise.all([getHorarios(supabase), getHuellerosElegibles(supabase), getUsuariosErp(supabase)]);
		} catch (err) {
			toast.error(`No se pudo cargar la configuración de asistencia. ${describeError(err)}`);
		} finally {
			cargando = false;
		}
	});

	const opcionesHorario = $derived.by(() => {
		const lista = horarios.map((h) => ({ value: String(h.id_horario), label: `${h.nombre} · ${resumenHorario(h)}` }));
		if (trabajador.id_horario && !horarios.some((h) => h.id_horario === trabajador.id_horario))
			lista.push({ value: String(trabajador.id_horario), label: `${trabajador.horario?.nombre ?? 'Horario'} (dado de baja)` });
		return lista;
	});
	const horario = $derived(horarios.find((h) => h.id_horario === form.id_horario) ?? null);
	/** Refrigerio del primer día laborable (para la franja de resumen). */
	const refrigerio = $derived.by(() => {
		const d = horario?.horario_dia?.find((x) => x.refrigerio_inicio && x.refrigerio_fin);
		return d ? `${hhmm(d.refrigerio_inicio)}–${hhmm(d.refrigerio_fin)}` : null;
	});

	const opcionesHuellero = $derived(
		huelleros
			.filter((h) => !elegidos.includes(h.id_dispositivo))
			.sort((a, b) => a.lugar.localeCompare(b.lugar) || a.nombre.localeCompare(b.nombre))
			.map((h) => ({ value: String(h.id_dispositivo), label: `${h.nombre} (ID ${h.numero_serie})${h.en_linea ? '' : ' · desconectado'}`, grupo: h.lugar, color: h.en_linea ? '#10b981' : '#cbd5e1' }))
	);
	const huellerosElegidos = $derived(huelleros.filter((h) => elegidos.includes(h.id_dispositivo)));

	const metodos = $derived([
		{ texto: 'Sistema ERP', icono: 'fa-desktop', activo: !!form.id_empleado, ayuda: 'Al elegir su usuario del ERP' },
		{ texto: 'Huellero', icono: 'fa-fingerprint', activo: elegidos.length > 0, ayuda: 'Al asociar un huellero' },
		{ texto: 'Biometría en el ERP', icono: 'fa-lock', activo: form.consentimiento_biometrico, ayuda: 'Con el consentimiento firmado' },
		{ texto: 'Registro manual', icono: 'fa-hand-pointer', activo: !!form.registro_manual && !!form.id_empleado, ayuda: 'Marca su ingreso y salida desde el ERP aunque su horario sea fijo' }
	]);

	const hayCambios = $derived(
		form.id_horario !== (trabajador.id_horario ?? null) ||
			form.id_empleado !== (trabajador.id_empleado ?? null) ||
			form.consentimiento_biometrico !== !!trabajador.consentimiento_biometrico ||
			(form.consentimiento_fecha ?? null) !== (trabajador.consentimiento_fecha ?? null) ||
			!!form.registro_manual !== !!trabajador.registro_manual ||
			[...elegidos].sort().join(',') !== (trabajador.personal_huellero ?? []).map((v) => v.id_dispositivo).sort().join(',')
	);

	async function guardar() {
		errorFecha = form.consentimiento_biometrico && !form.consentimiento_fecha ? 'Indica la fecha en que firmó el consentimiento.' : '';
		if (errorFecha) return void toast.error(errorFecha);
		guardando = true;
		try {
			// registro_manual solo viaja si se usa (base sin la migración 20261125120000 no tiene la columna).
			const usaManual = !!form.registro_manual || !!trabajador.registro_manual;
			await guardarAsistenciaPersonal(supabase, trabajador.id_personal, { ...form, registro_manual: usaManual ? !!form.registro_manual : undefined }, elegidos);
			toast.success('Configuración de asistencia guardada.');
			onSaved();
		} catch (err) {
			toast.error(`No se pudo guardar la configuración. ${describeError(err)}`);
		} finally {
			guardando = false;
		}
	}
</script>

{#snippet subtitulo(titulo: string, detalle?: string)}
	<div class="pt-4 mt-1 border-t border-slate-100 first:border-0 first:pt-0 first:mt-0">
		<h4 class="text-base font-bold text-slate-800">{titulo}</h4>
		{#if detalle}<p class="text-xs text-slate-500">{detalle}</p>{/if}
	</div>
{/snippet}

{#snippet nota(texto: string)}
	<p class="flex items-start gap-2 text-xs text-slate-600 bg-slate-50 border border-slate-100 rounded-lg px-3 py-2">
		<i class="fas fa-circle-info text-blue-500 mt-0.5"></i> <span>{texto}</span>
	</p>
{/snippet}

<div class="bg-white border border-slate-100 rounded-2xl shadow-sm p-4 sm:p-6 flex flex-col gap-3">
	<div>
		<h3 class="text-xl font-bold text-slate-800">Configuración de asistencia</h3>
		<p class="text-xs text-slate-500">Configura el horario y los medios de registro del trabajador.</p>
	</div>

	{#if cargando}
		<span class="text-sm text-slate-400 py-6 text-center"><i class="fas fa-spinner fa-spin"></i> Cargando…</span>
	{:else}
		<!-- Horario y control -->
		<div class="flex items-center justify-between gap-3 pt-1">
			<h4 class="text-base font-bold text-slate-800">Horario y control</h4>
			<a href="/rrhh/horarios" class="shrink-0 px-3 py-1.5 rounded-lg border border-orange-300 bg-white text-orange-600 text-xs font-semibold hover:bg-orange-50 flex items-center gap-1.5"><i class="fas fa-plus"></i> Crear horario</a>
		</div>
		<div class="flex flex-col gap-1">
			<label for="cfg_horario" class="text-xs font-semibold text-slate-700">Horario asignado</label>
			<SelectConSaldo id="cfg_horario" value={form.id_horario ? String(form.id_horario) : ''} options={[{ value: '', label: 'Sin horario' }, ...opcionesHorario]} placeholder="Sin horario" encabezadoNombre="Horario" onchange={(v) => (form.id_horario = v ? Number(v) : null)} />
		</div>
		{#if horario}
			<div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600 bg-slate-50 border border-slate-100 rounded-lg px-3 py-2">
				<i class="fas fa-calendar-days text-blue-500"></i>
				<span><b class="text-slate-700">Jornada:</b> {esLibre(horario) ? 'Libre, por horas' : resumenHorario(horario)}</span>
				{#if refrigerio}<span><b class="text-slate-700">Refrigerio:</b> {refrigerio}</span>{/if}
				{#if !esLibre(horario)}<span><b class="text-slate-700">Tolerancia:</b> {horario.tolerancia_min} min</span>{/if}
			</div>
		{:else}
			<span class="text-xs text-amber-700"><i class="fas fa-triangle-exclamation"></i> Sin horario no se calculan tardanzas, faltas ni horas extra.</span>
		{/if}

		<!-- Métodos de registro -->
		{@render subtitulo('Métodos de registro', 'Puede tener más de uno; se activan con los datos de abajo.')}
		<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
			{#each metodos as m}
				<span class={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm ${m.activo ? 'border-orange-200 bg-orange-50/60 text-slate-800' : 'border-slate-200 text-slate-400'}`} title={m.ayuda}>
					<i class={`fas ${m.activo ? 'fa-square-check text-orange-500' : 'fa-square text-slate-300'}`}></i>
					<i class={`fas ${m.icono} text-xs ${m.activo ? 'text-slate-500' : 'text-slate-300'}`}></i> {m.texto}
				</span>
			{/each}
		</div>
		<div class="flex flex-col gap-1">
			<label for="cfg_usuario" class="text-xs font-semibold text-slate-700">Usuario del ERP (Sistema ERP)</label>
			<SelectConSaldo id="cfg_usuario" value={form.id_empleado ? String(form.id_empleado) : ''} options={[{ value: '', label: 'Sin usuario (no marca desde el ERP)' }, ...usuariosErp]} placeholder="Sin usuario" encabezadoNombre="Usuario del ERP" onchange={(v) => (form.id_empleado = v ? Number(v) : null)} />
			<span class="text-xs text-slate-400">Con horario libre o mixto, esa persona registra su ingreso y salida desde Inicio → «Mi asistencia».</span>
		</div>
		<label class={`flex items-start gap-2 text-sm ${form.id_empleado ? 'text-slate-700' : 'text-slate-400'}`}>
			<input type="checkbox" class="mt-0.5" bind:checked={form.registro_manual} disabled={!form.id_empleado} />
			<span><b>Registro manual de asistencia</b> — con cualquier horario (también fijo), al entrar al ERP le pregunta si comienza su jornada y puede marcar su ingreso y salida desde «Mi asistencia». {form.id_empleado ? '' : 'Primero elige su usuario del ERP.'}</span>
		</label>

		<!-- Dispositivos asociados -->
		{@render subtitulo('Dispositivos asociados')}
		<div class="grid grid-cols-1 sm:grid-cols-[16rem_minmax(0,1fr)] items-center gap-x-4 gap-y-1">
			<div class="flex flex-col gap-1">
				<label for="cfg_pin" class="text-xs font-semibold text-slate-700">ID del trabajador en el huellero</label>
				<input id="cfg_pin" value={trabajador.pin} readonly tabindex="-1" class="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm bg-slate-100 font-mono text-slate-700 cursor-not-allowed" />
			</div>
			<span class="text-xs text-slate-400 sm:pt-5">Correlativo automático. No se cambia: sus marcas se enlazan por este número.</span>
		</div>
		{#if huelleros.length}
			{#if huellerosElegidos.length}
				<div class="border border-slate-200 rounded-xl overflow-hidden">
					<div class="hidden sm:grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_7.5rem_3rem] gap-2 px-3 py-2 bg-slate-100 text-xs font-semibold text-slate-600">
						<span>Dispositivo</span><span>Ubicación</span><span>Conexión</span><span class="text-center">Acciones</span>
					</div>
					{#each huellerosElegidos as h (h.id_dispositivo)}
						<div class="grid grid-cols-[minmax(0,1fr)_auto] sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_7.5rem_3rem] items-center gap-x-2 gap-y-1 px-3 py-2 border-t border-slate-100 first:border-t-0 text-sm">
							<span class="min-w-0">
								<span class="block font-medium text-slate-800 truncate">{h.nombre}</span>
								<span class="block text-[11px] font-mono text-slate-400">ID {h.numero_serie}</span>
							</span>
							<span class="order-3 sm:order-none text-xs text-slate-600 [overflow-wrap:anywhere]">{h.lugar}</span>
							<span class="order-4 sm:order-none">
								<span class={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full border ${h.en_linea ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-slate-100 text-slate-500 border-slate-200'}`}>
									<span class={`w-1.5 h-1.5 rounded-full ${h.en_linea ? 'bg-emerald-500' : 'bg-slate-400'}`}></span>{h.en_linea ? 'En línea' : 'Sin conexión'}
								</span>
							</span>
							<button type="button" onclick={() => (elegidos = elegidos.filter((x) => x !== h.id_dispositivo))} title="Quitar de este huellero" aria-label={`Quitar ${h.nombre}`} class="order-2 sm:order-none justify-self-end sm:justify-self-center w-8 h-8 rounded-full text-rose-500 hover:bg-rose-50">
								<i class="fas fa-trash-can text-xs"></i>
							</button>
						</div>
					{/each}
				</div>
			{:else}
				<span class="text-xs text-amber-700"><i class="fas fa-triangle-exclamation"></i> No marca en ningún huellero.</span>
			{/if}
			{#if opcionesHuellero.length}
				<SelectConSaldo
					id="cfg_agregar_huellero"
					value=""
					options={opcionesHuellero}
					placeholder={`+ Agregar huellero (${opcionesHuellero.length} disponible${opcionesHuellero.length === 1 ? '' : 's'})`}
					encabezadoNombre="Huellero"
					onchange={(v) => v && (elegidos = [...elegidos, Number(v)])}
				/>
			{/if}
			<span class="text-xs text-slate-400">Puedes asociar huelleros de otras obras o áreas. Al guardar se envía a los que agregaste y se retira de los que quitaste.</span>
		{:else}
			<span class="text-xs text-slate-500">Todavía no hay huelleros conectados. Agrégalos en Huelleros.</span>
		{/if}

		<!-- Autorización biométrica -->
		{@render subtitulo('Autorización biométrica')}
		<div class="flex flex-col gap-2 border border-slate-200 rounded-xl p-3">
			<label class="flex items-start gap-3 cursor-pointer">
				<input type="checkbox" bind:checked={form.consentimiento_biometrico} class="w-4 h-4 mt-0.5 accent-orange-500" />
				<span class="text-sm text-slate-700">
					<b>Consentimiento biométrico registrado</b> (Ley 29733)
					<span class="block text-xs text-slate-500">Permite guardar huella y rostro cifrados en el ERP: al cambiar de obra se copian solos al huellero nuevo. Si lo desmarcas, se borran del ERP.</span>
				</span>
			</label>
			{#if form.consentimiento_biometrico}
				<div class="flex flex-wrap items-end gap-4 pl-7">
					<div class="flex flex-col gap-1">
						<label for="cfg_consentimiento_fecha" class="text-xs font-semibold text-slate-700">Fecha de firma <span class="text-orange-600">*</span></label>
						<input id="cfg_consentimiento_fecha" type="date" bind:value={form.consentimiento_fecha} class={`px-3 py-2 border rounded-xl text-sm ${errorFecha ? 'border-rose-400' : 'border-slate-200'}`} />
						{#if errorFecha}<span class="text-xs text-rose-600">{errorFecha}</span>{/if}
					</div>
					<span class="text-xs text-slate-600 pb-2.5">
						{#if biometria && (biometria.huellas || biometria.rostros)}
							<i class="fas fa-lock text-emerald-600"></i> Guardado en el ERP: {biometria.huellas} {biometria.huellas === 1 ? 'huella' : 'huellas'}, {biometria.rostros} {biometria.rostros === 1 ? 'rostro' : 'rostros'}
						{:else}
							Aún no hay huella ni rostro guardados: se traen de sus huelleros cuando los registre.
						{/if}
					</span>
				</div>
			{/if}
		</div>
		{@render nota('Los cambios de horario se aplican desde que guardas; la asistencia de días anteriores se recalcula con el horario vigente.')}

		<div class="flex justify-end gap-3 pt-3 border-t border-slate-100">
			<button type="button" onclick={restablecer} disabled={guardando || !hayCambios} class="px-6 py-2.5 bg-white border border-slate-200 text-slate-700 rounded-xl hover:bg-slate-50 font-semibold text-sm disabled:opacity-50">Cancelar</button>
			<button type="button" onclick={guardar} disabled={guardando || !hayCambios} class="px-6 py-2.5 bg-orange-500 text-white rounded-xl hover:bg-orange-600 font-semibold text-sm shadow-md shadow-orange-500/20 disabled:opacity-50 flex items-center gap-2">
				{#if guardando}<i class="fas fa-spinner fa-spin"></i>{/if} Guardar cambios
			</button>
		</div>
	{/if}
</div>
