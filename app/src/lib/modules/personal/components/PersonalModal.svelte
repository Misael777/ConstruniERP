<script lang="ts">
	/**
	 * Ficha del trabajador (crear / editar). Obligatorios: documento, nombres, apellidos, régimen y código de
	 * huellero; el resto se completa cuando se tenga. El código de huellero se llena con el DNI mientras el
	 * usuario no lo cambie. Desplegables con SelectConSaldo (formato estándar del ERP, con buscador).
	 * "Huelleros donde marca" no depende de la obra: al elegir obra o área se marcan solos sus huelleros (y se
	 * desmarcan los de la anterior), pero se puede elegir cualquiera, p. ej. el de oficina.
	 */
	import { fade, scale } from 'svelte/transition';
	import { supabase } from '$lib/supabaseClient';
	import { toast } from '$lib/stores/toast';
	import { describeError } from '$lib/shared/describeError';
	import SelectConSaldo from '$lib/shared/components/SelectConSaldo.svelte';
	import {
		TIPOS_DOCUMENTO,
		SEXOS,
		REGIMENES,
		CATEGORIAS,
		SISTEMAS_PENSION,
		PERIODICIDADES_PAGO,
		etiquetaMonto,
		guardarPersonal,
		type Personal,
		type DatosPersonal
	} from '$lib/modules/personal/services/personal.service';
	import type { HuelleroElegible } from '$lib/modules/asistencia/services/huelleros.service';

	let {
		open,
		personal = null,
		obras,
		horarios,
		huelleros,
		biometria = null,
		onClose,
		onSaved
	}: {
		open: boolean;
		/** null = nuevo trabajador. */
		personal?: Personal | null;
		obras: { value: string; label: string; grupo?: string }[];
		huelleros: HuelleroElegible[];
		/** Huellas y rostros que el ERP ya tiene guardados de este trabajador (con consentimiento). */
		biometria?: { huellas: number; rostros: number } | null;
		/** Horarios activos (Horarios) para asignar. */
		horarios: { value: string; label: string }[];
		onClose: () => void;
		onSaved: () => void;
	} = $props();

	const VACIO: DatosPersonal = {
		pin: '',
		tipo_documento: 'DNI',
		numero_documento: '',
		nombres: '',
		apellidos: '',
		fecha_nacimiento: null,
		sexo: null,
		telefono: '',
		direccion: '',
		contacto_emergencia_nombre: '',
		contacto_emergencia_telefono: '',
		regimen: null,
		categoria: null,
		cargo: '',
		periodicidad_pago: null,
		monto_pago: null,
		id_centro_costo: null,
		id_horario: null,
		fecha_ingreso: null,
		fecha_cese: null,
		motivo_cese: '',
		sistema_pension: null,
		cuspp: '',
		banco: '',
		numero_cuenta: '',
		cci: '',
		sctr_poliza: '',
		sctr_vencimiento: null,
		examen_medico_vencimiento: null,
		consentimiento_biometrico: false,
		consentimiento_fecha: null
	};

	let form = $state<DatosPersonal>({ ...VACIO });

	/** Si el trabajador tiene un horario ya dado de baja, se muestra igual para no perderlo al guardar. */
	const opcionesHorario = $derived(
		personal?.id_horario && !horarios.some((h) => h.value === String(personal.id_horario))
			? [...horarios, { value: String(personal.id_horario), label: `${personal.horario?.nombre ?? 'Horario'} (dado de baja)` }]
			: horarios
	);
	let errores = $state<Record<string, string>>({});
	let guardando = $state(false);
	/** El código de huellero sigue al DNI hasta que el usuario lo edite a mano. */
	let pinManual = $state(false);
	let huellerosElegidos = $state<number[]>([]);

	$effect(() => {
		if (!open) return;
		const base: DatosPersonal = { ...VACIO };
		if (personal) for (const k of Object.keys(VACIO) as (keyof DatosPersonal)[]) (base as any)[k] = personal[k] ?? VACIO[k];
		form = base;
		errores = {};
		pinManual = !!personal?.pin && personal.pin !== personal.numero_documento;
		huellerosElegidos = (personal?.personal_huellero ?? []).map((v) => v.id_dispositivo);
	});

	/** Al cambiar de obra o área: marca sus huelleros y desmarca los de la anterior. */
	function cambiarLugar(valor: string) {
		const anterior = form.id_centro_costo;
		const nuevo = valor ? Number(valor) : null;
		form.id_centro_costo = nuevo;
		const deAnterior = huelleros.filter((h) => anterior && h.id_centro_costo === anterior).map((h) => h.id_dispositivo);
		const deNuevo = huelleros.filter((h) => nuevo && h.id_centro_costo === nuevo).map((h) => h.id_dispositivo);
		huellerosElegidos = [...new Set([...huellerosElegidos.filter((id) => !deAnterior.includes(id)), ...deNuevo])];
	}

	/** Al elegir el régimen se propone su periodicidad usual (civil: semanal; general: mensual) si aún no tiene. */
	function elegirRegimen(v: string) {
		form.regimen = (v || null) as DatosPersonal['regimen'];
		if (!form.periodicidad_pago) form.periodicidad_pago = form.regimen === 'construccion_civil' ? 'semanal' : form.regimen === 'general' ? 'mensual' : null;
	}

	/** Huelleros que aún no tiene, agrupados por obra o área (punto verde = en línea). */
	const opcionesHuellero = $derived(
		huelleros
			.filter((h) => !huellerosElegidos.includes(h.id_dispositivo))
			.sort((a, b) => a.lugar.localeCompare(b.lugar) || a.nombre.localeCompare(b.nombre))
			.map((h) => ({ value: String(h.id_dispositivo), label: `${h.nombre} (ID ${h.numero_serie})${h.en_linea ? '' : ' · desconectado'}`, grupo: h.lugar, color: h.en_linea ? '#10b981' : '#cbd5e1' }))
	);

	function alternarHuellero(id: number) {
		huellerosElegidos = huellerosElegidos.includes(id) ? huellerosElegidos.filter((x) => x !== id) : [...huellerosElegidos, id];
	}

	function onDocumentoInput() {
		if (!pinManual && form.tipo_documento === 'DNI') form.pin = (form.numero_documento ?? '').replace(/\D/g, '').slice(0, 9);
	}

	const texto = (v: string | null | undefined) => (v ?? '').trim() || null;

	function validar(): boolean {
		const e: Record<string, string> = {};
		const doc = (form.numero_documento ?? '').trim();
		if (!doc) e.numero_documento = 'Ingresa el número de documento.';
		else if (form.tipo_documento === 'DNI' && !/^\d{8}$/.test(doc)) e.numero_documento = 'El DNI tiene 8 dígitos.';
		else if (form.tipo_documento !== 'DNI' && !/^[A-Za-z0-9]{6,12}$/.test(doc)) e.numero_documento = 'Entre 6 y 12 letras o números.';
		if (!texto(form.nombres)) e.nombres = 'Ingresa los nombres.';
		if (!texto(form.apellidos)) e.apellidos = 'Ingresa los apellidos.';
		if (!form.regimen) e.regimen = 'Elige el régimen.';
		if (!/^\d{1,9}$/.test(form.pin.trim())) e.pin = 'Solo números, máximo 9 dígitos (así lo acepta el huellero).';
		if (form.monto_pago && !form.periodicidad_pago) e.periodicidad_pago = 'Elige cada cuánto se le paga ese monto.';
		if (form.cci && !/^\d{20}$/.test(form.cci.trim())) e.cci = 'El CCI tiene 20 dígitos.';
		if (form.fecha_cese && form.fecha_ingreso && form.fecha_cese < form.fecha_ingreso) e.fecha_cese = 'No puede ser anterior al ingreso.';
		if (form.consentimiento_biometrico && !form.consentimiento_fecha) e.consentimiento_fecha = 'Indica la fecha en que firmó el consentimiento.';
		errores = e;
		return Object.keys(e).length === 0;
	}

	async function guardar() {
		if (!validar()) {
			toast.error('Revisa los campos marcados en rojo.');
			return;
		}
		const esCivil = form.regimen === 'construccion_civil';
		const datos: DatosPersonal = {
			...form,
			pin: form.pin.trim(),
			numero_documento: (form.numero_documento ?? '').trim().toUpperCase(),
			nombres: texto(form.nombres),
			apellidos: texto(form.apellidos),
			telefono: texto(form.telefono),
			direccion: texto(form.direccion),
			contacto_emergencia_nombre: texto(form.contacto_emergencia_nombre),
			contacto_emergencia_telefono: texto(form.contacto_emergencia_telefono),
			// Solo se guardan los datos del régimen elegido.
			categoria: esCivil ? form.categoria : null,
			cargo: esCivil ? null : texto(form.cargo),
			monto_pago: form.periodicidad_pago ? form.monto_pago || null : null,
			motivo_cese: form.fecha_cese ? texto(form.motivo_cese) : null,
			cuspp: form.sistema_pension && form.sistema_pension !== 'ONP' ? texto(form.cuspp) : null,
			banco: texto(form.banco),
			numero_cuenta: texto(form.numero_cuenta),
			cci: texto(form.cci),
			sctr_poliza: texto(form.sctr_poliza),
			fecha_nacimiento: form.fecha_nacimiento || null,
			fecha_ingreso: form.fecha_ingreso || null,
			fecha_cese: form.fecha_cese || null,
			sctr_vencimiento: form.sctr_vencimiento || null,
			examen_medico_vencimiento: form.examen_medico_vencimiento || null,
			consentimiento_fecha: form.consentimiento_biometrico ? form.consentimiento_fecha || null : null
		};
		guardando = true;
		try {
			await guardarPersonal(supabase, personal?.id_personal ?? null, datos, huellerosElegidos);
			toast.success(personal ? 'Ficha actualizada.' : 'Trabajador registrado.');
			onSaved();
			onClose();
		} catch (err) {
			toast.error(`No se pudo guardar la ficha. ${describeError(err)}`);
		} finally {
			guardando = false;
		}
	}

	function cerrar() {
		if (!guardando) onClose();
	}

	const inputClase = (campo: string) =>
		`w-full px-3 py-2.5 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 ${errores[campo] ? 'border-rose-400' : 'border-slate-200'}`;
</script>

{#snippet campo(id: string, etiqueta: string, obligatorio: boolean, control: import('svelte').Snippet, ayuda?: string)}
	<div class="flex flex-col gap-1.5">
		<label for={id} class="text-sm font-medium text-slate-700">{etiqueta}{obligatorio ? ' *' : ''}</label>
		{@render control()}
		{#if errores[id]}
			<span class="text-xs text-rose-600">{errores[id]}</span>
		{:else if ayuda}
			<span class="text-xs text-slate-400">{ayuda}</span>
		{/if}
	</div>
{/snippet}

{#snippet seccion(titulo: string, icono: string)}
	<h3 class="text-sm font-bold text-slate-800 flex items-center gap-2 sm:col-span-2 pt-2"><i class={`fas ${icono} text-blue-600`}></i> {titulo}</h3>
{/snippet}

{#if open}
	<div class="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-[100] flex items-center justify-center p-4" transition:fade={{ duration: 200 }}>
		<div class="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col" transition:scale={{ duration: 250, start: 0.95 }}>
			<div class="px-6 py-4 border-b border-slate-100 flex items-center justify-between shrink-0">
				<h2 class="text-xl font-bold text-slate-800">{personal ? 'Editar trabajador' : 'Nuevo trabajador'}</h2>
				<button onclick={cerrar} disabled={guardando} aria-label="Cerrar" class="text-slate-400 hover:text-slate-600 p-2 rounded-full hover:bg-slate-100 disabled:opacity-50">
					<i class="fas fa-times"></i>
				</button>
			</div>

			<div class="p-6 overflow-y-auto grid grid-cols-1 sm:grid-cols-2 gap-4">
				{@render seccion('Datos personales', 'fa-user')}
				{#snippet ctlTipoDoc()}
					<SelectConSaldo id="tipo_documento" value={form.tipo_documento} options={TIPOS_DOCUMENTO} encabezadoNombre="Documento" onchange={(v) => { form.tipo_documento = v as DatosPersonal['tipo_documento']; onDocumentoInput(); }} />
				{/snippet}
				{@render campo('tipo_documento', 'Tipo de documento', true, ctlTipoDoc)}
				{#snippet ctlDoc()}
					<input id="numero_documento" bind:value={form.numero_documento} oninput={onDocumentoInput} maxlength="12" inputmode={form.tipo_documento === 'DNI' ? 'numeric' : 'text'} class={inputClase('numero_documento')} />
				{/snippet}
				{@render campo('numero_documento', 'Número de documento', true, ctlDoc)}
				{#snippet ctlNombres()}<input id="nombres" bind:value={form.nombres} maxlength="100" class={inputClase('nombres')} />{/snippet}
				{@render campo('nombres', 'Nombres', true, ctlNombres)}
				{#snippet ctlApellidos()}<input id="apellidos" bind:value={form.apellidos} maxlength="100" class={inputClase('apellidos')} />{/snippet}
				{@render campo('apellidos', 'Apellidos', true, ctlApellidos)}
				{#snippet ctlNac()}<input id="fecha_nacimiento" type="date" bind:value={form.fecha_nacimiento} class={inputClase('fecha_nacimiento')} />{/snippet}
				{@render campo('fecha_nacimiento', 'Fecha de nacimiento', false, ctlNac)}
				{#snippet ctlSexo()}
					<SelectConSaldo id="sexo" value={form.sexo ?? ''} options={SEXOS} placeholder="Sin especificar" encabezadoNombre="Sexo" onchange={(v) => (form.sexo = (v || null) as DatosPersonal['sexo'])} />
				{/snippet}
				{@render campo('sexo', 'Sexo', false, ctlSexo)}
				{#snippet ctlTel()}<input id="telefono" type="tel" bind:value={form.telefono} maxlength="20" class={inputClase('telefono')} />{/snippet}
				{@render campo('telefono', 'Teléfono', false, ctlTel)}
				{#snippet ctlDir()}<input id="direccion" bind:value={form.direccion} maxlength="200" class={inputClase('direccion')} />{/snippet}
				{@render campo('direccion', 'Dirección', false, ctlDir)}
				{#snippet ctlEmNom()}<input id="contacto_emergencia_nombre" bind:value={form.contacto_emergencia_nombre} maxlength="100" class={inputClase('contacto_emergencia_nombre')} />{/snippet}
				{@render campo('contacto_emergencia_nombre', 'Contacto de emergencia', false, ctlEmNom)}
				{#snippet ctlEmTel()}<input id="contacto_emergencia_telefono" type="tel" bind:value={form.contacto_emergencia_telefono} maxlength="20" class={inputClase('contacto_emergencia_telefono')} />{/snippet}
				{@render campo('contacto_emergencia_telefono', 'Teléfono de emergencia', false, ctlEmTel)}

				{@render seccion('Datos laborales', 'fa-hard-hat')}
				{#snippet ctlPin()}
					<input id="pin" bind:value={form.pin} oninput={() => (pinManual = true)} maxlength="9" inputmode="numeric" class={inputClase('pin')} />
				{/snippet}
				{@render campo('pin', 'Número en huellero', true, ctlPin, personal ? 'Si lo cambias, regístralo igual en el huellero; sus marcas anteriores quedan con el número antiguo.' : 'Se llena con el DNI. Es el ID de usuario en el huellero.')}
				{#snippet ctlRegimen()}
					<SelectConSaldo id="regimen" value={form.regimen ?? ''} options={REGIMENES} placeholder="Selecciona el régimen" hasError={!!errores.regimen} encabezadoNombre="Régimen" onchange={elegirRegimen} />
				{/snippet}
				{@render campo('regimen', 'Régimen', true, ctlRegimen)}
				{#if form.regimen === 'construccion_civil'}
					{#snippet ctlCat()}
						<SelectConSaldo id="categoria" value={form.categoria ?? ''} options={CATEGORIAS} placeholder="Selecciona la categoría" encabezadoNombre="Categoría" onchange={(v) => (form.categoria = v as DatosPersonal['categoria'])} />
					{/snippet}
					{@render campo('categoria', 'Categoría', false, ctlCat)}
				{:else if form.regimen === 'general'}
					{#snippet ctlCargo()}<input id="cargo" bind:value={form.cargo} maxlength="100" class={inputClase('cargo')} />{/snippet}
					{@render campo('cargo', 'Cargo', false, ctlCargo)}
				{/if}
				{#snippet ctlPeriodicidad()}
					<SelectConSaldo id="periodicidad_pago" value={form.periodicidad_pago ?? ''} options={PERIODICIDADES_PAGO} placeholder="Selecciona la periodicidad" hasError={!!errores.periodicidad_pago} encabezadoNombre="Periodicidad" onchange={(v) => (form.periodicidad_pago = (v || null) as DatosPersonal['periodicidad_pago'])} />
				{/snippet}
				{@render campo('periodicidad_pago', 'Periodicidad de pago', false, ctlPeriodicidad)}
				{#snippet ctlMonto()}<input id="monto_pago" type="number" min="0" step="0.01" bind:value={form.monto_pago} disabled={!form.periodicidad_pago} placeholder={form.periodicidad_pago ? '0.00' : 'Elige primero la periodicidad'} class={`${inputClase('monto_pago')} disabled:bg-slate-50`} />{/snippet}
				{@render campo('monto_pago', `${etiquetaMonto(form.periodicidad_pago)} (S/)`, false, ctlMonto, form.periodicidad_pago ? 'Monto bruto que recibe en cada periodo de pago.' : undefined)}
				{#snippet ctlObra()}
					<SelectConSaldo id="id_centro_costo" value={form.id_centro_costo ? String(form.id_centro_costo) : ''} options={obras} placeholder="Sin obra o área" encabezadoNombre="Obra o área" onchange={cambiarLugar} />
				{/snippet}
				{@render campo('id_centro_costo', 'Obra o área', false, ctlObra, 'Para el personal administrativo elige Corporativo o su área.')}
				{#snippet ctlHorario()}
					<SelectConSaldo id="id_horario" value={form.id_horario ? String(form.id_horario) : ''} options={opcionesHorario} placeholder="Sin horario" encabezadoNombre="Horario" onchange={(v) => (form.id_horario = v ? Number(v) : null)} />
				{/snippet}
				{@render campo('id_horario', 'Horario', false, ctlHorario, 'Con él se calculan tardanzas, faltas y horas extra. Se crean en Horarios.')}
				{#snippet ctlIngreso()}<input id="fecha_ingreso" type="date" bind:value={form.fecha_ingreso} class={inputClase('fecha_ingreso')} />{/snippet}
				{@render campo('fecha_ingreso', 'Fecha de ingreso', false, ctlIngreso)}
				{#snippet ctlCese()}<input id="fecha_cese" type="date" bind:value={form.fecha_cese} class={inputClase('fecha_cese')} />{/snippet}
				{@render campo('fecha_cese', 'Fecha de cese', false, ctlCese)}
				{#if form.fecha_cese}
					{#snippet ctlMotivo()}<input id="motivo_cese" bind:value={form.motivo_cese} maxlength="200" class={inputClase('motivo_cese')} />{/snippet}
					{@render campo('motivo_cese', 'Motivo del cese', false, ctlMotivo)}
				{/if}

				{@render seccion('Huelleros donde marca', 'fa-fingerprint')}
				<div class="sm:col-span-2 flex flex-col gap-2">
					{#if huelleros.length}
						{#if huellerosElegidos.length}
							<div class="flex flex-col divide-y divide-slate-100 border border-slate-100 rounded-xl">
								{#each huelleros.filter((h) => huellerosElegidos.includes(h.id_dispositivo)) as h (h.id_dispositivo)}
									<div class="flex items-center gap-3 px-3 py-2.5">
										<span class={`w-2.5 h-2.5 rounded-full shrink-0 ${h.en_linea ? 'bg-emerald-500' : 'bg-slate-300'}`} title={h.en_linea ? 'En línea' : 'Desconectado'}></span>
										<span class="min-w-0 flex-1">
											<span class="block text-sm font-medium text-slate-800">{h.nombre} <span class={`text-[11px] font-normal ${h.en_linea ? 'text-emerald-600' : 'text-slate-400'}`}>{h.en_linea ? 'En línea' : 'Desconectado'}</span></span>
											<span class="block text-xs text-slate-500 [overflow-wrap:anywhere]"><span class="font-mono text-slate-400">ID {h.numero_serie}</span> · {h.lugar}</span>
										</span>
										<button type="button" onclick={() => alternarHuellero(h.id_dispositivo)} title="Quitar de este huellero" aria-label={`Quitar ${h.nombre}`} class="w-8 h-8 rounded-full text-slate-400 hover:text-rose-600 hover:bg-rose-50 shrink-0">
											<i class="fas fa-xmark"></i>
										</button>
									</div>
								{/each}
							</div>
						{:else}
							<span class="text-xs text-amber-700"><i class="fas fa-triangle-exclamation"></i> No marca en ningún huellero. Agrega al menos uno.</span>
						{/if}
						{#if opcionesHuellero.length}
							<SelectConSaldo
								id="agregar_huellero"
								value=""
								options={opcionesHuellero}
								placeholder={`Agregar huellero (${opcionesHuellero.length} disponible${opcionesHuellero.length === 1 ? '' : 's'})`}
								encabezadoNombre="Huellero"
								onchange={(v) => v && alternarHuellero(Number(v))}
							/>
						{:else}
							<span class="text-xs text-slate-400">Ya está en todos los huelleros registrados ({huelleros.length}).</span>
						{/if}
						<span class="text-xs text-slate-400">Se listan todos los huelleros registrados en Huelleros, agrupados por obra o área (punto verde = en línea). Al guardar se envía a los que agregaste y se retira de los que quitaste; en cada huellero registra su huella o rostro.</span>
					{:else}
						<span class="text-xs text-slate-500">Todavía no hay huelleros conectados. Agrégalos en Huelleros.</span>
					{/if}
				</div>
				<div class="sm:col-span-2 flex flex-col gap-2 bg-slate-50 border border-slate-100 rounded-xl p-3">
					<label class="flex items-start gap-3 cursor-pointer">
						<input type="checkbox" bind:checked={form.consentimiento_biometrico} class="w-4 h-4 mt-0.5 accent-blue-600" />
						<span class="text-sm text-slate-700">
							<b>Firmó el consentimiento</b> para que el ERP guarde su huella y rostro (Ley 29733)
							<span class="block text-xs text-slate-500">Con él, al cambiar de obra su huella y rostro se copian solos al huellero nuevo. Se guardan cifrados y nadie puede verlos. Sin consentimiento debe registrarse en cada huellero. Si lo desmarcas, se borran del ERP.</span>
						</span>
					</label>
					{#if form.consentimiento_biometrico}
						<div class="flex flex-wrap items-end gap-4 pl-7">
							<div class="flex flex-col gap-1">
								<label for="consentimiento_fecha" class="text-xs font-medium text-slate-600">Fecha de firma *</label>
								<input id="consentimiento_fecha" type="date" bind:value={form.consentimiento_fecha} class={inputClase('consentimiento_fecha')} />
								{#if errores.consentimiento_fecha}<span class="text-xs text-rose-600">{errores.consentimiento_fecha}</span>{/if}
							</div>
							<span class="text-xs text-slate-600 pb-3">
								{#if biometria && (biometria.huellas || biometria.rostros)}
									<i class="fas fa-lock text-emerald-600"></i> Guardado en el ERP: {biometria.huellas} {biometria.huellas === 1 ? 'huella' : 'huellas'}, {biometria.rostros} {biometria.rostros === 1 ? 'rostro' : 'rostros'}
								{:else}
									Aún no hay huella ni rostro guardados: se traen de sus huelleros al guardar (o cuando los registre).
								{/if}
							</span>
						</div>
					{/if}
				</div>

				{@render seccion('Pagos y seguros', 'fa-shield-halved')}
				{#snippet ctlPension()}
					<SelectConSaldo id="sistema_pension" value={form.sistema_pension ?? ''} options={SISTEMAS_PENSION} placeholder="Sin especificar" encabezadoNombre="Sistema" onchange={(v) => (form.sistema_pension = v || null)} />
				{/snippet}
				{@render campo('sistema_pension', 'Sistema de pensión', false, ctlPension)}
				{#if form.sistema_pension && form.sistema_pension !== 'ONP'}
					{#snippet ctlCuspp()}<input id="cuspp" bind:value={form.cuspp} maxlength="15" class={inputClase('cuspp')} />{/snippet}
					{@render campo('cuspp', 'CUSPP', false, ctlCuspp)}
				{/if}
				{#snippet ctlBanco()}<input id="banco" bind:value={form.banco} maxlength="60" placeholder="Ej. BCP" class={inputClase('banco')} />{/snippet}
				{@render campo('banco', 'Banco', false, ctlBanco)}
				{#snippet ctlCuenta()}<input id="numero_cuenta" bind:value={form.numero_cuenta} maxlength="30" class={inputClase('numero_cuenta')} />{/snippet}
				{@render campo('numero_cuenta', 'Número de cuenta', false, ctlCuenta)}
				{#snippet ctlCci()}<input id="cci" bind:value={form.cci} maxlength="20" inputmode="numeric" class={inputClase('cci')} />{/snippet}
				{@render campo('cci', 'CCI', false, ctlCci)}
				{#snippet ctlSctr()}<input id="sctr_poliza" bind:value={form.sctr_poliza} maxlength="40" class={inputClase('sctr_poliza')} />{/snippet}
				{@render campo('sctr_poliza', 'Póliza SCTR', false, ctlSctr)}
				{#snippet ctlSctrVence()}<input id="sctr_vencimiento" type="date" bind:value={form.sctr_vencimiento} class={inputClase('sctr_vencimiento')} />{/snippet}
				{@render campo('sctr_vencimiento', 'Vencimiento del SCTR', false, ctlSctrVence, 'El ERP avisa 30 días antes.')}
				{#snippet ctlExamen()}<input id="examen_medico_vencimiento" type="date" bind:value={form.examen_medico_vencimiento} class={inputClase('examen_medico_vencimiento')} />{/snippet}
				{@render campo('examen_medico_vencimiento', 'Vencimiento del examen médico', false, ctlExamen, 'El ERP avisa 30 días antes.')}
			</div>

			<div class="px-6 py-4 border-t border-slate-100 flex justify-end gap-3 shrink-0">
				<button onclick={cerrar} disabled={guardando} class="px-5 py-2.5 bg-white border border-slate-200 text-slate-600 rounded-xl hover:bg-slate-50 font-medium text-sm disabled:opacity-50">Cancelar</button>
				<button onclick={guardar} disabled={guardando} class="px-5 py-2.5 bg-blue-600 text-white rounded-xl hover:bg-blue-700 font-medium text-sm shadow-md shadow-blue-600/20 disabled:opacity-50 flex items-center gap-2">
					{#if guardando}<i class="fas fa-spinner fa-spin"></i>{/if} Guardar
				</button>
			</div>
		</div>
	</div>
{/if}
