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
	import HistorialAsignaciones from './HistorialAsignaciones.svelte';
	import {
		TIPOS_DOCUMENTO,
		SEXOS,
		REGIMENES,
		CATEGORIAS,
		CARGOS_REFERENTE,
		VINCULOS,
		TAMANOS_EMPRESA,
		vinculoDe,
		usaCategoria,
		etiquetaCategoria,
		SISTEMAS_PENSION,
		PERIODICIDADES_PAGO,
		etiquetaMonto,
		etiqueta,
		guardarPersonal,
		obrasDe,
		getCargosHistorial,
		guardarCargosHistorial,
		cargoActual,
		type CargoHistorial,
		type Personal,
		type DatosPersonal
	} from '$lib/modules/personal/services/personal.service';
	import type { HuelleroElegible } from '$lib/modules/asistencia/services/huelleros.service';
	import { reducirFoto, subirFotoPersonal, FOTO_MAX_BYTES } from '$lib/modules/personal/services/personalFoto';
	import { diag } from '$lib/shared/diagnostico.svelte';
	import { borrarArchivosDriveHuerfanos } from '$lib/shared/borrarArchivosDrive';
	import { toDriveThumbnailUrl } from '$lib/shared/drivePreview';
	import { esTelefono } from '$lib/shared/accesoRapido';
	import { EMPRESA_NOMBRE } from '$lib/shared/empresaConstantes';

	let {
		open,
		personal = null,
		obras,
		huelleros,
		onClose,
		onSaved
	}: {
		open: boolean;
		/** null = nuevo trabajador. */
		personal?: Personal | null;
		obras: { value: string; label: string; grupo?: string }[];
		/** Para proponer, en un alta, los huelleros de la obra o área elegida. */
		huelleros: HuelleroElegible[];
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
		consentimiento_fecha: null,
		id_empleado: null,
		foto_url: null,
		referente_nombre: '',
		referente_cargo: null,
		vinculo: null,
		empleador_nombre: '',
		empleador_ruc: '',
		empleador_tamano: null,
		monto_pago_desde: null
	};

	let form = $state<DatosPersonal>({ ...VACIO });

	/** Si la ficha tiene una categoría antigua (sin especialidad), se muestra igual para no perderla sin querer. */
	const opcionesCategoria = $derived(
		form.categoria && !CATEGORIAS.some((c) => c.value === form.categoria)
			? [...CATEGORIAS, { value: form.categoria, label: `${etiquetaCategoria(form.categoria)} (anterior, elige la especialidad)`, grupo: 'Anterior' }]
			: CATEGORIAS
	);
	let errores = $state<Record<string, string>>({});
	let guardando = $state(false);
	let huellerosElegidos = $state<number[]>([]);

	$effect(() => {
		if (!open) return;
		const base: DatosPersonal = { ...VACIO };
		if (personal) for (const k of Object.keys(VACIO) as (keyof DatosPersonal)[]) (base as any)[k] = personal[k] ?? VACIO[k];
		// Llegó desde el huellero (solo trae su nombre en un texto): se propone primera palabra = nombres, resto =
		// apellidos, para no volver a escribirlo. Se revisa y corrige antes de guardar.
		if (personal?.nombre && !personal.nombres && !personal.apellidos) {
			const [primero, ...resto] = personal.nombre.trim().split(/\s+/);
			base.nombres = primero ?? '';
			base.apellidos = resto.join(' ');
		}
		form = base;
		errores = {};
		huellerosElegidos = (personal?.personal_huellero ?? []).map((v) => v.id_dispositivo);
		quitarFotoNueva();
		obrasElegidas = personal ? obrasDe(personal) : [];
		cargarCargos(personal?.id_personal ?? null);
	});

	// Historial de cargos (personal_cargo_historial): varios por trabajador, cada uno con sus fechas. El tramo sin
	// fecha "hasta" es el cargo actual y se copia a personal.cargo al guardar.
	let cargos = $state<CargoHistorial[]>([]);
	let cargandoCargos = $state(false);
	let erroresCargos = $state<Record<number, string>>({});
	const hoyIso = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Lima' });

	async function cargarCargos(id: number | null) {
		cargos = [];
		erroresCargos = {};
		if (!id) return;
		cargandoCargos = true;
		try {
			const lista = await getCargosHistorial(supabase, id);
			if (personal?.id_personal === id) cargos = lista;
		} catch (err) {
			toast.error(`No se pudo leer el historial de cargos. ${describeError(err)}`);
		} finally {
			cargandoCargos = false;
		}
	}

	/** Nuevo cargo: cierra el actual el día anterior (si no tenía fecha de fin) y abre uno desde hoy. */
	function agregarCargo() {
		const hoy = hoyIso();
		const ayer = new Date(Date.parse(`${hoy}T12:00:00Z`) - 86400000).toISOString().slice(0, 10);
		cargos = [
			{ cargo: '', fecha_inicio: hoy, fecha_fin: null, observacion: null },
			...cargos.map((c) => (!c.fecha_fin && c.fecha_inicio <= ayer ? { ...c, fecha_fin: ayer } : c))
		];
	}

	function quitarCargo(i: number) {
		cargos = cargos.filter((_, j) => j !== i);
		erroresCargos = {};
	}

	function duracionCargo(c: CargoHistorial): string {
		if (!c.fecha_inicio) return '';
		const fin = c.fecha_fin || hoyIso();
		const dias = Math.round((Date.parse(fin) - Date.parse(c.fecha_inicio)) / 86400000) + 1;
		if (dias < 1) return '';
		const meses = Math.floor(dias / 30.44);
		if (meses >= 12) return `${Math.floor(meses / 12)} a ${meses % 12 ? `${meses % 12} m` : ''}`.trim();
		return meses ? `${meses} ${meses === 1 ? 'mes' : 'meses'}` : `${dias} ${dias === 1 ? 'día' : 'días'}`;
	}

	// Foto: se reduce al elegirla (vista previa inmediata) y se sube recién al guardar, así cancelar no deja
	// archivos sueltos en Drive. accept="image/*" en Android ofrece cámara o galería; en PC, el explorador.
	let fotoNueva = $state<Blob | null>(null);
	let fotoNuevaUrl = $state<string | null>(null);
	let procesandoFoto = $state(false);
	// En PC el botón «Cámara» solo volvía a abrir el explorador de archivos (y el aviso de girar la cámara no aplica):
	// se muestra solo en el teléfono.
	let telefono = $state(false);
	void esTelefono().then((v) => (telefono = v)).catch(() => {});
	const fotoVista = $derived(fotoNuevaUrl ?? (form.foto_url ? toDriveThumbnailUrl(form.foto_url, 300) : null));

	function quitarFotoNueva() {
		if (fotoNuevaUrl) URL.revokeObjectURL(fotoNuevaUrl);
		fotoNueva = null;
		fotoNuevaUrl = null;
	}

	async function elegirFoto(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = ''; // permite volver a elegir el mismo archivo
		diag('Foto del trabajador: archivo elegido', { hay: !!file, tipo: file?.type, bytes: file?.size, nombre: file?.name });
		if (!file) return;
		// La galería de Android a veces entrega la foto SIN tipo: solo se rechaza si trae un tipo que no es imagen.
		if (file.type && !file.type.startsWith('image/')) return void toast.error('Elige una imagen (JPG o PNG).');
		if (file.size === 0)
			return void toast.error('El teléfono no entregó la foto (puede estar solo en la nube de Google Fotos). Descárgala al teléfono o tómala con la cámara.');
		if (file.size > FOTO_MAX_BYTES) return void toast.error('La imagen pesa más de 20 MB.');
		procesandoFoto = true;
		try {
			const reducida = await reducirFoto(file);
			quitarFotoNueva();
			fotoNueva = reducida;
			fotoNuevaUrl = URL.createObjectURL(reducida);
		} catch (err) {
			diag('Foto del trabajador: no se pudo leer', { error: String((err as any)?.message ?? err) });
			toast.error(err instanceof Error ? err.message : 'No se pudo leer la imagen.');
		} finally {
			procesandoFoto = false;
		}
	}

	function quitarFoto() {
		quitarFotoNueva();
		form.foto_url = null;
	}

	// Obras o áreas (varias, a pedido del usuario 16/11/2026; personal_obra). La principal es form.id_centro_costo:
	// a ella se carga su costo en la planilla y por ella se agrupa la lista. Al agregar una obra se suman sus
	// huelleros; al quitarla, se quitan los de esa obra.
	let obrasElegidas = $state<number[]>([]);
	const nombreObra = (id: number) => obras.find((o) => o.value === String(id))?.label ?? `Centro de costo ${id}`;
	const opcionesObraNueva = $derived(obras.filter((o) => !obrasElegidas.includes(Number(o.value))));
	const huellerosDeObra = (id: number) => huelleros.filter((h) => h.id_centro_costo === id).map((h) => h.id_dispositivo);

	function agregarObra(valor: string) {
		const id = Number(valor);
		if (!id || obrasElegidas.includes(id)) return;
		obrasElegidas = [...obrasElegidas, id];
		if (!form.id_centro_costo) form.id_centro_costo = id;
		huellerosElegidos = [...new Set([...huellerosElegidos, ...huellerosDeObra(id)])];
	}

	function quitarObra(id: number) {
		obrasElegidas = obrasElegidas.filter((o) => o !== id);
		if (form.id_centro_costo === id) form.id_centro_costo = obrasElegidas[0] ?? null;
		const deEsa = huellerosDeObra(id);
		huellerosElegidos = huellerosElegidos.filter((d) => !deEsa.includes(d));
	}

	/** Al elegir el régimen se propone su periodicidad usual (civil: semanal; general: mensual) si aún no tiene. */
	function elegirRegimen(v: string) {
		form.regimen = (v || null) as DatosPersonal['regimen'];
		if (!form.periodicidad_pago) form.periodicidad_pago = usaCategoria(form.regimen) ? 'semanal' : form.regimen === 'general' ? 'mensual' : null;
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
		if (form.monto_pago && !form.periodicidad_pago) e.periodicidad_pago = 'Elige cada cuánto se le paga ese monto.';
		if (form.cci && !/^\d{20}$/.test(form.cci.trim())) e.cci = 'El CCI tiene 20 dígitos.';
		if (form.empleador_ruc && !/^\d{11}$/.test(form.empleador_ruc.trim())) e.empleador_ruc = 'El RUC tiene 11 dígitos.';
		if (form.fecha_cese && form.fecha_ingreso && form.fecha_cese < form.fecha_ingreso) e.fecha_cese = 'No puede ser anterior al ingreso.';
		const ec: Record<number, string> = {};
		cargos.forEach((c, i) => {
			if (!c.cargo.trim()) ec[i] = 'Escribe el cargo.';
			else if (!c.fecha_inicio) ec[i] = 'Indica desde cuándo.';
			else if (c.fecha_fin && c.fecha_fin < c.fecha_inicio) ec[i] = '"Hasta" no puede ser anterior a "Desde".';
		});
		if (cargos.filter((c) => !c.fecha_fin).length > 1) e.cargos = 'Solo un cargo puede quedar sin fecha "Hasta" (el actual).';
		erroresCargos = ec;
		errores = e;
		return Object.keys(e).length === 0 && Object.keys(ec).length === 0;
	}

	async function guardar() {
		if (!validar()) {
			toast.error('Revisa los campos marcados en rojo.');
			irAPrimerError();
			return;
		}
		const esCivil = usaCategoria(form.regimen);
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
			referente_nombre: texto(form.referente_nombre),
			referente_cargo: form.referente_cargo || null,
			vinculo: form.vinculo || null,
			empleador_nombre: texto(form.empleador_nombre),
			empleador_ruc: texto(form.empleador_ruc),
			empleador_tamano: form.empleador_tamano || null,
			monto_pago_desde: form.periodicidad_pago ? form.monto_pago_desde || null : null,
			// Solo se guardan los datos del régimen elegido.
			categoria: esCivil ? form.categoria : null,
			// El cargo actual sale del historial (el tramo sin fecha "Hasta").
			cargo: cargoActual(cargos),
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
			if (fotoNueva) {
				try {
					datos.foto_url = await subirFotoPersonal(fotoNueva, datos.numero_documento ?? '');
				} catch (err) {
					toast.error(`No se pudo subir la foto. ${describeError(err)}`);
					return;
				}
			}
			// Al editar, horario, usuario del ERP, consentimiento y huelleros se configuran en Asistencia → Configuración:
			// no se envían para no pisar lo que se cambió ahí. En un alta van los huelleros de su obra o área.
			if (personal) for (const k of ['id_horario', 'id_empleado', 'consentimiento_biometrico', 'consentimiento_fecha'] as const) delete (datos as Partial<DatosPersonal>)[k];
			// Huelleros: en un alta, los de su obra o área; al editar solo si cambió de obra (se cambian los de la anterior
			// por los de la nueva, igual que «Mover»); si no, se dejan como estén en Asistencia → Configuración.
			const obrasFinal = datos.id_centro_costo && !obrasElegidas.includes(datos.id_centro_costo) ? [datos.id_centro_costo, ...obrasElegidas] : obrasElegidas;
			const cambioDeObra = !!personal && [...obrasDe(personal)].sort().join(',') !== [...obrasFinal].sort().join(',');
			const fotoAnterior = personal?.foto_url ?? null;
			const idGuardado = await guardarPersonal(supabase, personal?.id_personal ?? null, datos, !personal || cambioDeObra ? huellerosElegidos : null, obrasFinal);
			// Ticket #123: la foto reemplazada o quitada se borra también de Drive.
			if (fotoAnterior && datos.foto_url !== fotoAnterior) void borrarArchivosDriveHuerfanos(supabase, [fotoAnterior]);
			try {
				await guardarCargosHistorial(supabase, idGuardado, cargos);
			} catch (err) {
				toast.error(`La ficha se guardó, pero no el historial de cargos. ${describeError(err)}`);
				onSaved();
				onClose();
				return;
			}
			toast.success(personal ? 'Ficha actualizada.' : 'Trabajador registrado.');
			quitarFotoNueva();
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

	// ── Submenú de la ficha (a pedido del usuario, 11/11/2026): una sección a la vez, como en el diseño de referencia.
	type Seccion = 'personales' | 'vinculo' | 'cargo' | 'beneficios' | 'pagos';
	const SECCIONES: { id: Seccion; titulo: string; subtitulo: string; icono: string }[] = [
		{ id: 'personales', titulo: 'Datos personales', subtitulo: 'Identificación y contacto del trabajador.', icono: 'fa-user' },
		{ id: 'vinculo', titulo: 'Vínculo laboral', subtitulo: 'Define la relación laboral y su vigencia.', icono: 'fa-briefcase' },
		{ id: 'cargo', titulo: 'Cargo y remuneración', subtitulo: 'Condiciones vigentes e historial de cargos con sus fechas.', icono: 'fa-coins' },
		{ id: 'beneficios', titulo: 'Beneficios y proyección', subtitulo: 'Beneficios y anticipo de los próximos pagos.', icono: 'fa-gift' },
		{ id: 'pagos', titulo: 'Pagos y seguros', subtitulo: 'Abono de remuneraciones y coberturas.', icono: 'fa-shield-halved' }
	];
	/** En qué sección está cada campo validado (para saltar a ella y marcarla si tiene errores). */
	const SECCION_DE: Record<string, Seccion> = {
		tipo_documento: 'personales',
		numero_documento: 'personales',
		nombres: 'personales',
		apellidos: 'personales',
		regimen: 'vinculo',
		empleador_ruc: 'vinculo',
		fecha_cese: 'vinculo',
		periodicidad_pago: 'cargo',
		monto_pago: 'cargo',
		cargos: 'cargo',
		cci: 'pagos'
	};
	let seccion = $state<Seccion>('personales');
	$effect(() => {
		if (open) seccion = 'personales';
	});
	const seccionesConError = $derived(
		new Set<Seccion>([...Object.keys(errores).map((k) => SECCION_DE[k] ?? 'personales'), ...(Object.keys(erroresCargos).length ? ['cargo' as Seccion] : [])])
	);
	const seccionInfo = $derived(SECCIONES.find((s) => s.id === seccion) ?? SECCIONES[0]);

	/** Si la validación falla, se abre la primera sección con errores. */
	function irAPrimerError() {
		const primera = SECCIONES.find((s) => seccionesConError.has(s.id));
		if (primera) seccion = primera.id;
	}

	// Cabecera: nombre · obra o área · régimen de la empresa.
	const nombreFicha = $derived([form.nombres, form.apellidos].map((v) => (v ?? '').trim()).filter(Boolean).join(' '));
	const lugarFicha = $derived(obras.find((o) => o.value === String(form.id_centro_costo ?? ''))?.label ?? null);
	const tamanoFicha = $derived(form.empleador_tamano ? etiqueta(TAMANOS_EMPRESA, form.empleador_tamano) : null);

	// Cargo y remuneración: tarjetas de resumen y estado de cada tramo.
	const cargoVigente = $derived(cargoActual(cargos));
	function estadoCargo(c: CargoHistorial): { texto: string; clase: string } {
		const hoy = hoyIso();
		if (c.fecha_inicio && c.fecha_inicio > hoy) return { texto: 'Programado', clase: 'bg-orange-50 text-orange-700 border-orange-200' };
		if (!c.fecha_fin || c.fecha_fin >= hoy) return { texto: 'Vigente', clase: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
		return { texto: 'Cerrado', clase: 'bg-slate-100 text-slate-600 border-slate-200' };
	}
	const soles = (n: number | null) => (n == null ? null : `S/ ${Number(n).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
	const fechaCorta = (f: string | null) => (f ? new Date(`${f}T00:00:00`).toLocaleDateString('es-PE') : null);

	/** Estado de una cobertura según su vencimiento (aviso 7 días antes para el SCTR y 30 para el examen médico, como en la lista). */
	function estadoVence(f: string | null, diasAviso = 30): { texto: string; clase: string } {
		if (!f) return { texto: 'Sin registrar', clase: 'bg-slate-100 text-slate-500 border-slate-200' };
		const dias = Math.round((Date.parse(f) - Date.parse(hoyIso())) / 86400000);
		if (dias < 0) return { texto: 'Vencido', clase: 'bg-rose-50 text-rose-700 border-rose-200' };
		if (dias <= diasAviso) return { texto: 'Por vencer', clase: 'bg-amber-50 text-amber-700 border-amber-200' };
		return { texto: 'Vigente', clase: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
	}
</script>

{#snippet campo(id: string, etiqueta: string, obligatorio: boolean, control: import('svelte').Snippet, ayuda?: string)}
	<div class="flex flex-col gap-1">
		<label for={id} class="text-xs font-semibold text-slate-700">{etiqueta}{#if obligatorio}<span class="text-orange-600"> *</span>{/if}</label>
		{@render control()}
		{#if errores[id]}
			<span class="text-xs text-rose-600">{errores[id]}</span>
		{:else if ayuda}
			<span class="text-xs text-slate-400">{ayuda}</span>
		{/if}
	</div>
{/snippet}

{#snippet subtitulo(titulo: string, accion?: import('svelte').Snippet)}
	<div class="sm:col-span-2 flex items-center justify-between gap-3 pt-4 mt-1 border-t border-slate-100 first:border-0 first:pt-0 first:mt-0">
		<h4 class="text-base font-bold text-slate-800">{titulo}</h4>
		{#if accion}{@render accion()}{/if}
	</div>
{/snippet}

{#snippet nota(texto: string)}
	<p class="sm:col-span-2 flex items-start gap-2 text-xs text-slate-600 bg-slate-50 border border-slate-100 rounded-lg px-3 py-2">
		<i class="fas fa-circle-info text-blue-500 mt-0.5"></i> <span>{texto}</span>
	</p>
{/snippet}

{#snippet insignia(e: { texto: string; clase: string })}
	<span class={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full border whitespace-nowrap ${e.clase}`}>
		<span class="w-1.5 h-1.5 rounded-full bg-current opacity-70"></span>{e.texto}
	</span>
{/snippet}

{#snippet botonNaranja(texto: string, onclick: () => void)}
	<button type="button" {onclick} class="shrink-0 px-3 py-1.5 rounded-lg border border-orange-300 bg-white text-orange-600 text-xs font-semibold hover:bg-orange-50 flex items-center gap-1.5">
		<i class="fas fa-plus"></i> {texto}
	</button>
{/snippet}

{#if open}
	<div class="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-[100] flex items-center justify-center p-2 sm:p-4" transition:fade={{ duration: 200 }}>
		<div class="bg-white rounded-2xl shadow-2xl w-full max-w-5xl h-[94vh] sm:h-[90vh] flex flex-col overflow-hidden" transition:scale={{ duration: 250, start: 0.95 }}>
			<!-- Cabecera -->
			<div class="px-4 sm:px-6 py-3 border-b border-slate-100 shrink-0">
				<div class="flex items-center justify-between gap-3">
					<h2 class="text-lg sm:text-xl font-bold text-slate-800">{personal ? 'Ficha del trabajador' : 'Nuevo trabajador'}</h2>
					<button onclick={cerrar} disabled={guardando} aria-label="Cerrar" class="text-slate-400 hover:text-slate-600 p-2 rounded-full hover:bg-slate-100 disabled:opacity-50">
						<i class="fas fa-times"></i>
					</button>
				</div>
				<div class="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm min-w-0">
					<i class="fas fa-user text-blue-500"></i>
					<span class="font-bold text-slate-800">{nombreFicha || 'Sin nombre'}</span>
					{#if lugarFicha}<span class="text-slate-300">•</span><span class="text-slate-600 truncate max-w-[18rem]">{lugarFicha}</span>{/if}
					{#if tamanoFicha}<span class="text-slate-300">•</span><span class="text-[11px] font-semibold px-2 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200">{tamanoFicha}</span>{/if}
				</div>
			</div>

			<div class="flex-1 min-h-0 flex flex-col md:flex-row">
				<!-- Submenú: columna en PC, tira desplazable en celular -->
				<nav class="shrink-0 md:w-60 md:border-r border-b md:border-b-0 border-slate-100 bg-white md:p-3 overflow-x-auto md:overflow-y-auto" aria-label="Secciones de la ficha">
					<ul class="flex md:flex-col gap-1 p-2 md:p-0 min-w-max md:min-w-0">
						{#each SECCIONES as s (s.id)}
							{@const activa = seccion === s.id}
							<li>
								<button
									type="button"
									onclick={() => (seccion = s.id)}
									aria-current={activa ? 'page' : undefined}
									class={`w-full flex items-center gap-2.5 px-3 py-2 md:py-2.5 rounded-lg border text-sm font-medium text-left whitespace-nowrap transition-colors ${activa ? 'bg-orange-50 border-orange-200 text-slate-800 md:border-l-4 md:border-l-orange-500' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}`}
								>
									<i class={`fas ${s.icono} w-4 text-center ${activa ? 'text-orange-500' : 'text-blue-500'}`}></i>
									<span class="flex-1">{s.titulo}</span>
									{#if seccionesConError.has(s.id)}<span class="w-2 h-2 rounded-full bg-rose-500" title="Tiene campos por corregir"></span>{/if}
									<i class={`fas ${activa ? 'fa-chevron-up' : 'fa-chevron-down'} text-[10px] text-slate-400 hidden md:inline`}></i>
								</button>
							</li>
						{/each}
						<li>
							{#if personal}
								<a
									href={`/rrhh/asistencia?tab=config&p=${personal.id_personal}`}
									title="Horario, métodos de registro, huelleros y consentimiento biométrico"
									class="w-full flex items-center gap-2.5 px-3 py-2 md:py-2.5 rounded-lg border border-slate-200 bg-white text-sm font-medium text-slate-600 hover:bg-slate-50 whitespace-nowrap"
								>
									<i class="fas fa-calendar-days w-4 text-center text-blue-500"></i>
									<span class="flex-1">Asistencia</span>
									<i class="fas fa-arrow-up-right-from-square text-[10px] text-slate-400"></i>
								</a>
							{:else}
								<span class="w-full flex items-center gap-2.5 px-3 py-2 md:py-2.5 rounded-lg border border-dashed border-slate-200 text-xs text-slate-400 md:whitespace-normal whitespace-nowrap" title="Se configura en Asistencia → Configuración">
									<i class="fas fa-calendar-days w-4 text-center"></i>
									<span class="flex-1">Asistencia: se configura después de guardar</span>
								</span>
							{/if}
						</li>
					</ul>
				</nav>

				<!-- Contenido de la sección -->
				<div class="flex-1 min-w-0 overflow-y-auto p-4 sm:p-6">
					<div class="mb-4">
						<h3 class="text-xl font-bold text-slate-800">{seccionInfo.titulo}</h3>
						<p class="text-xs text-slate-500">{seccionInfo.subtitulo}</p>
					</div>

					<div class="grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-3">
						{#if seccion === 'personales'}
							{@render subtitulo('Identificación')}
							<div class="sm:col-span-2 flex items-center gap-4">
								<div class="w-20 h-20 rounded-2xl bg-slate-100 border border-slate-200 overflow-hidden shrink-0 flex items-center justify-center">
									{#if procesandoFoto}
										<i class="fas fa-spinner fa-spin text-slate-400 text-xl"></i>
									{:else if fotoVista}
										<img src={fotoVista} alt="Foto del trabajador" class="w-full h-full object-cover" referrerpolicy="no-referrer" />
									{:else}
										<i class="fas fa-user text-slate-300 text-3xl"></i>
									{/if}
								</div>
								<div class="flex flex-col gap-2 min-w-0">
									<span class="text-xs font-semibold text-slate-700">Foto del trabajador</span>
									<div class="flex flex-wrap gap-2">
										<!-- Pedido de la clienta (16/11/2026): en la app de Android un solo botón abría solo la galería.
										     Ahora son dos: Galería (selector de fotos) y Cámara (capture → abre la cámara; ahí se cambia
										     a la frontal o la trasera con el botón de girar de la propia cámara). -->
										<label class="cursor-pointer inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-blue-200 bg-blue-50 text-blue-700 text-sm font-semibold hover:bg-blue-100 {procesandoFoto || guardando ? 'opacity-50 pointer-events-none' : ''}">
											<input type="file" accept="image/*" class="hidden" onchange={elegirFoto} disabled={procesandoFoto || guardando} />
											<i class="fas fa-image"></i> {telefono ? (fotoVista ? 'Cambiar (galería)' : 'Galería') : fotoVista ? 'Cambiar foto' : 'Subir foto'}
										</label>
										{#if telefono}
										<label class="cursor-pointer inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-blue-200 bg-blue-50 text-blue-700 text-sm font-semibold hover:bg-blue-100 {procesandoFoto || guardando ? 'opacity-50 pointer-events-none' : ''}">
											<input type="file" accept="image/*" capture="environment" class="hidden" onchange={elegirFoto} disabled={procesandoFoto || guardando} />
											<i class="fas fa-camera"></i> Cámara
										</label>
										{/if}
										{#if fotoVista}
											<button type="button" onclick={quitarFoto} disabled={procesandoFoto || guardando} class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 text-sm hover:bg-slate-50 disabled:opacity-50">
												<i class="fas fa-trash-alt text-rose-500"></i> Quitar
											</button>
										{/if}
									</div>
									<span class="text-xs text-slate-400">{fotoNueva ? 'Se guardará al pulsar Guardar cambios.' : telefono ? 'En la cámara puedes girar a la frontal o la trasera.' : 'JPG o PNG. Se guarda al pulsar Guardar cambios.'}</span>
								</div>
							</div>
							{#snippet ctlTipoDoc()}
								<SelectConSaldo id="tipo_documento" value={form.tipo_documento} options={TIPOS_DOCUMENTO} encabezadoNombre="Documento" onchange={(v) => (form.tipo_documento = v as DatosPersonal['tipo_documento'])} />
							{/snippet}
							{@render campo('tipo_documento', 'Tipo de documento', true, ctlTipoDoc)}
							{#snippet ctlDoc()}
								<input id="numero_documento" bind:value={form.numero_documento} maxlength="12" inputmode={form.tipo_documento === 'DNI' ? 'numeric' : 'text'} class={inputClase('numero_documento')} />
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

							{@render subtitulo('Contacto y domicilio')}
							{#snippet ctlTel()}<input id="telefono" type="tel" bind:value={form.telefono} maxlength="20" class={inputClase('telefono')} />{/snippet}
							{@render campo('telefono', 'Teléfono', false, ctlTel)}
							{#snippet ctlDir()}<input id="direccion" bind:value={form.direccion} maxlength="200" class={inputClase('direccion')} />{/snippet}
							{@render campo('direccion', 'Dirección', false, ctlDir)}

							{@render subtitulo('Contacto de emergencia')}
							{#snippet ctlEmNom()}<input id="contacto_emergencia_nombre" bind:value={form.contacto_emergencia_nombre} maxlength="100" class={inputClase('contacto_emergencia_nombre')} />{/snippet}
							{@render campo('contacto_emergencia_nombre', 'Nombre completo', false, ctlEmNom)}
							{#snippet ctlEmTel()}<input id="contacto_emergencia_telefono" type="tel" bind:value={form.contacto_emergencia_telefono} maxlength="20" class={inputClase('contacto_emergencia_telefono')} />{/snippet}
							{@render campo('contacto_emergencia_telefono', 'Teléfono', false, ctlEmTel)}
						{:else if seccion === 'vinculo'}
							{@render subtitulo('Asignación y empleador')}
							{#snippet ctlVinculo()}
								<SelectConSaldo id="vinculo" value={form.vinculo ?? vinculoDe(form)} options={VINCULOS} placeholder="Selecciona el vínculo" encabezadoNombre="Vínculo" onchange={(v) => (form.vinculo = (v || null) as DatosPersonal['vinculo'])} />
							{/snippet}
							{@render campo('vinculo', 'Tipo de vínculo', false, ctlVinculo, 'Planilla propia o personal de un subcontratista.')}
							<div class="sm:col-span-2 flex flex-col gap-1.5">
								<label for="id_centro_costo" class="text-xs font-semibold text-slate-700">Obras o áreas asignadas</label>
								{#if obrasElegidas.length}
									<div class="border border-slate-200 rounded-xl divide-y divide-slate-100">
										{#each obrasElegidas as o (o)}
											<div class="flex items-center gap-2 px-3 py-2 text-sm">
												<i class="fas fa-helmet-safety text-slate-400 shrink-0"></i>
												<span class="flex-1 min-w-0 text-slate-800 [overflow-wrap:anywhere]">{nombreObra(o)}</span>
												{#if form.id_centro_costo === o}
													<span class="shrink-0 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-orange-50 text-orange-700 border border-orange-200" title="Su costo se carga a esta obra en la planilla">Principal</span>
												{:else}
													<button type="button" onclick={() => (form.id_centro_costo = o)} class="shrink-0 text-[11px] font-medium px-2 py-0.5 rounded-full border border-slate-200 text-slate-500 hover:bg-slate-50">Hacer principal</button>
												{/if}
												<button type="button" onclick={() => quitarObra(o)} title="Quitar esta obra o área" aria-label={`Quitar ${nombreObra(o)}`} class="shrink-0 w-8 h-8 rounded-full text-rose-500 hover:bg-rose-50"><i class="fas fa-trash-can text-xs"></i></button>
											</div>
										{/each}
									</div>
								{/if}
								{#if opcionesObraNueva.length}
									<SelectConSaldo id="id_centro_costo" value="" options={opcionesObraNueva} placeholder={obrasElegidas.length ? '+ Agregar otra obra o área' : 'Elige la obra o área'} encabezadoNombre="Obra o área" onchange={agregarObra} />
								{/if}
								<span class="text-xs text-slate-400">Puede estar en varias a la vez (Obra, Consultoría o Corporativo). La <b>principal</b> es a la que se carga su costo en la planilla. Al agregar o quitar una obra se agregan o quitan sus huelleros.</span>
							</div>
							{#snippet ctlEmpleador()}<input id="empleador_nombre" bind:value={form.empleador_nombre} maxlength="150" placeholder={vinculoDe(form) === 'planilla_propia' ? EMPRESA_NOMBRE : 'Ej. Servicios Marín S.A.C.'} class={inputClase('empleador_nombre')} />{/snippet}
							{@render campo('empleador_nombre', 'Empleador', false, ctlEmpleador, vinculoDe(form) === 'planilla_propia' ? 'Vacío = la propia empresa.' : 'Empresa del subcontratista que lo emplea.')}
							{#snippet ctlEmpRuc()}<input id="empleador_ruc" bind:value={form.empleador_ruc} maxlength="11" inputmode="numeric" placeholder="11 dígitos" class={inputClase('empleador_ruc')} />{/snippet}
							{@render campo('empleador_ruc', 'RUC del empleador', false, ctlEmpRuc)}
							{#snippet ctlRefNombre()}<input id="referente_nombre" bind:value={form.referente_nombre} maxlength="150" placeholder="Ej. Juan Pérez" class={inputClase('referente_nombre')} />{/snippet}
							{@render campo('referente_nombre', 'Superior o referente', false, ctlRefNombre, 'Quién lo trajo o responde por él en obra.')}
							{#snippet ctlRefCargo()}
								<SelectConSaldo id="referente_cargo" value={form.referente_cargo ?? ''} options={[{ value: '', label: 'Sin cargo' }, ...CARGOS_REFERENTE]} placeholder="Selecciona el cargo" encabezadoNombre="Cargo del referente" onchange={(v) => (form.referente_cargo = v || null)} />
							{/snippet}
							{@render campo('referente_cargo', 'Cargo del referente', false, ctlRefCargo)}

							{@render subtitulo('Régimen')}
							{#snippet ctlRegimen()}
								<SelectConSaldo id="regimen" value={form.regimen ?? ''} options={REGIMENES} placeholder="Selecciona el régimen" hasError={!!errores.regimen} encabezadoNombre="Régimen" onchange={elegirRegimen} />
							{/snippet}
							{@render campo('regimen', 'Régimen laboral', true, ctlRegimen)}
							{#snippet ctlTamano()}
								<SelectConSaldo id="empleador_tamano" value={form.empleador_tamano ?? ''} options={[{ value: '', label: 'Sin indicar' }, ...TAMANOS_EMPRESA]} placeholder="Sin indicar" encabezadoNombre="Régimen de la empresa" onchange={(v) => (form.empleador_tamano = (v || null) as DatosPersonal['empleador_tamano'])} />
							{/snippet}
							{@render campo('empleador_tamano', 'Régimen de la empresa', false, ctlTamano, 'MYPE (micro o pequeña empresa) o régimen general.')}
							{#if usaCategoria(form.regimen)}
								{#snippet ctlCat()}
									<SelectConSaldo id="categoria" value={form.categoria ?? ''} options={opcionesCategoria} placeholder="Selecciona la categoría" encabezadoNombre="Categoría" onchange={(v) => (form.categoria = v as DatosPersonal['categoria'])} />
								{/snippet}
								{@render campo('categoria', 'Categoría (construcción civil)', false, ctlCat)}
							{/if}

							{@render subtitulo('Fechas y estado')}
							{#snippet ctlIngreso()}<input id="fecha_ingreso" type="date" bind:value={form.fecha_ingreso} class={inputClase('fecha_ingreso')} />{/snippet}
							{@render campo('fecha_ingreso', 'Fecha de ingreso', false, ctlIngreso)}
							{#snippet ctlCese()}<input id="fecha_cese" type="date" bind:value={form.fecha_cese} class={inputClase('fecha_cese')} />{/snippet}
							{@render campo('fecha_cese', 'Fecha de cese', false, ctlCese)}
							{#if form.fecha_cese}
								{#snippet ctlMotivo()}<input id="motivo_cese" bind:value={form.motivo_cese} maxlength="200" class={inputClase('motivo_cese')} />{/snippet}
								{@render campo('motivo_cese', 'Motivo del cese', false, ctlMotivo)}
							{/if}
							<div class="flex flex-col gap-1">
								<span class="text-xs font-semibold text-slate-700">Estado</span>
								<div class="py-2">
									{@render insignia(form.fecha_cese && form.fecha_cese <= hoyIso()
										? { texto: 'Cesado', clase: 'bg-slate-100 text-slate-600 border-slate-200' }
										: form.fecha_cese
											? { texto: `Activo · cesa el ${fechaCorta(form.fecha_cese)}`, clase: 'bg-amber-50 text-amber-700 border-amber-200' }
											: { texto: 'Activo', clase: 'bg-emerald-50 text-emerald-700 border-emerald-200' })}
								</div>
								<span class="text-xs text-slate-400">Se calcula con la fecha de cese.</span>
							</div>

							{@render subtitulo('Historial de obras, huelleros y referentes')}
							<div class="sm:col-span-2">
								{#if personal}
									<HistorialAsignaciones idPersonal={personal.id_personal} />
								{:else}
									<span class="text-xs text-slate-400">Se empieza a registrar al guardar el trabajador.</span>
								{/if}
							</div>
						{:else if seccion === 'cargo'}
							<div class="sm:col-span-2 grid grid-cols-1 sm:grid-cols-3 gap-3">
								{#each [
									{ icono: 'fa-briefcase', titulo: 'Cargo vigente', valor: cargoVigente || (usaCategoria(form.regimen) && form.categoria ? etiquetaCategoria(form.categoria) : null), extra: null },
									{ icono: 'fa-coins', titulo: 'Remuneración vigente', valor: form.periodicidad_pago ? soles(form.monto_pago) : null, extra: form.periodicidad_pago ? etiqueta(PERIODICIDADES_PAGO, form.periodicidad_pago) : null },
									{ icono: 'fa-calendar', titulo: 'Vigencia actual', valor: form.monto_pago_desde ? `Desde ${fechaCorta(form.monto_pago_desde)}` : null, extra: null }
								] as t}
									<div class="flex items-center gap-3 rounded-xl border border-slate-200 p-3 min-w-0">
										<span class="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0"><i class={`fas ${t.icono}`}></i></span>
										<span class="min-w-0">
											<span class="block text-xs text-slate-500">{t.titulo}</span>
											<span class={`block font-bold truncate ${t.valor ? 'text-slate-800' : 'text-slate-300'}`}>{t.valor || '—'}</span>
											{#if t.extra}<span class="block text-xs text-slate-500">{t.extra}</span>{/if}
										</span>
									</div>
								{/each}
							</div>

							{@render subtitulo('Condiciones actuales')}
							{#snippet ctlPeriodicidad()}
								<SelectConSaldo id="periodicidad_pago" value={form.periodicidad_pago ?? ''} options={PERIODICIDADES_PAGO} placeholder="Selecciona la periodicidad" hasError={!!errores.periodicidad_pago} encabezadoNombre="Periodicidad" onchange={(v) => (form.periodicidad_pago = (v || null) as DatosPersonal['periodicidad_pago'])} />
							{/snippet}
							{@render campo('periodicidad_pago', 'Periodicidad', false, ctlPeriodicidad)}
							{#snippet ctlMonto()}<input id="monto_pago" type="number" min="0" step="0.01" bind:value={form.monto_pago} disabled={!form.periodicidad_pago} placeholder={form.periodicidad_pago ? '0.00' : 'Elige primero la periodicidad'} class={`${inputClase('monto_pago')} disabled:bg-slate-50`} />{/snippet}
							{@render campo('monto_pago', `${etiquetaMonto(form.periodicidad_pago)} (S/)`, false, ctlMonto, form.periodicidad_pago ? 'Monto bruto que recibe en cada periodo de pago.' : undefined)}
							{#snippet ctlMontoDesde()}<input id="monto_pago_desde" type="date" bind:value={form.monto_pago_desde} disabled={!form.periodicidad_pago} class={`${inputClase('monto_pago_desde')} disabled:bg-slate-50`} />{/snippet}
							{@render campo('monto_pago_desde', 'Vigente desde', false, ctlMontoDesde, 'Desde cuándo rige este monto.')}

							{#snippet accionCargo()}{@render botonNaranja('Registrar cambio de cargo', agregarCargo)}{/snippet}
							{@render subtitulo('Historial de cargos', accionCargo)}
							<div class="sm:col-span-2 flex flex-col gap-2">
								{#if cargandoCargos}
									<span class="text-xs text-slate-400"><i class="fas fa-spinner fa-spin"></i> Cargando historial…</span>
								{:else if !cargos.length}
									<span class="text-xs text-slate-400 italic">Sin cargos registrados. Pulsa «Registrar cambio de cargo».</span>
								{:else}
									<div class="border border-slate-200 rounded-xl overflow-hidden">
										<div class="hidden sm:grid grid-cols-[9rem_9rem_minmax(0,1fr)_6.5rem_2.5rem] gap-2 px-3 py-2 bg-slate-100 text-xs font-semibold text-slate-600">
											<span>Desde</span><span>Hasta</span><span>Cargo</span><span>Estado</span><span class="sr-only">Acciones</span>
										</div>
										{#each cargos as c, i (c.id_cargo_historial ?? `n${i}`)}
											<div class={`grid grid-cols-2 sm:grid-cols-[9rem_9rem_minmax(0,1fr)_6.5rem_2.5rem] items-center gap-2 px-3 py-2 border-t border-slate-100 first:border-t-0 ${erroresCargos[i] ? 'bg-rose-50/50' : ''}`}>
												<label class="flex flex-col gap-0.5 text-[11px] text-slate-500 sm:contents">
													<span class="sm:hidden">Desde</span>
													<input type="date" bind:value={c.fecha_inicio} aria-label="Desde" class="w-full px-2 py-1.5 border border-slate-200 rounded-lg text-sm text-slate-700" />
												</label>
												<label class="flex flex-col gap-0.5 text-[11px] text-slate-500 sm:contents">
													<span class="sm:hidden">Hasta</span>
													<input type="date" value={c.fecha_fin ?? ''} oninput={(e) => (c.fecha_fin = e.currentTarget.value || null)} aria-label="Hasta" class="w-full px-2 py-1.5 border border-slate-200 rounded-lg text-sm text-slate-700" />
												</label>
												<span class="col-span-2 sm:col-span-1 flex flex-col gap-0.5 min-w-0">
													<input id={`cargo_${i}`} bind:value={c.cargo} maxlength="100" placeholder="Ej. Maestro de obra" aria-label="Cargo" class="w-full min-w-0 px-2.5 py-1.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-400" />
													<span class="text-[11px] text-slate-400">{duracionCargo(c)}</span>
												</span>
												<span>{@render insignia(estadoCargo(c))}</span>
												<button type="button" onclick={() => quitarCargo(i)} title="Quitar este tramo" aria-label="Quitar este tramo" class="justify-self-end w-8 h-8 rounded-full text-rose-500 hover:bg-rose-50"><i class="fas fa-trash-can text-xs"></i></button>
												{#if erroresCargos[i]}<span class="col-span-2 sm:col-span-5 text-xs text-rose-600">{erroresCargos[i]}</span>{/if}
											</div>
										{/each}
									</div>
								{/if}
								{#if errores.cargos}<span class="text-xs text-rose-600">{errores.cargos}</span>{/if}
							</div>
							{@render nota('Cada tramo conserva su cargo, sin fechas superpuestas. El que no tiene fecha «Hasta» es el cargo vigente; si su «Desde» es futuro queda como Programado.')}
						{:else if seccion === 'beneficios'}
							<div class="sm:col-span-2 flex flex-col items-center text-center gap-3 rounded-2xl border border-dashed border-slate-200 bg-slate-50/60 px-6 py-10">
								<span class="w-12 h-12 rounded-2xl bg-orange-50 text-orange-500 flex items-center justify-center text-xl"><i class="fas fa-gift"></i></span>
								<h4 class="font-bold text-slate-800">Aún no hay beneficios configurados</h4>
								<p class="text-sm text-slate-500 max-w-md">Esta sección queda reservada para gratificaciones, bonos y su proyección en cuentas por pagar. Todavía no se guardan en el ERP.</p>
							</div>
						{:else if seccion === 'pagos'}
							{@render subtitulo('Datos de pago')}
							{#snippet ctlBanco()}<input id="banco" bind:value={form.banco} maxlength="60" placeholder="Ej. BCP" class={inputClase('banco')} />{/snippet}
							{@render campo('banco', 'Banco', false, ctlBanco)}
							{#snippet ctlCuenta()}<input id="numero_cuenta" bind:value={form.numero_cuenta} maxlength="30" class={inputClase('numero_cuenta')} />{/snippet}
							{@render campo('numero_cuenta', 'Número de cuenta (haberes)', false, ctlCuenta)}
							{#snippet ctlCci()}<input id="cci" bind:value={form.cci} maxlength="20" inputmode="numeric" class={inputClase('cci')} />{/snippet}
							{@render campo('cci', 'CCI', false, ctlCci, '20 dígitos.')}

							{@render subtitulo('Afiliación previsional')}
							{#snippet ctlPension()}
								<SelectConSaldo id="sistema_pension" value={form.sistema_pension ?? ''} options={SISTEMAS_PENSION} placeholder="Sin especificar" encabezadoNombre="Sistema" onchange={(v) => (form.sistema_pension = v || null)} />
							{/snippet}
							{@render campo('sistema_pension', 'Sistema de pensión', false, ctlPension)}
							{#if form.sistema_pension && form.sistema_pension !== 'ONP'}
								{#snippet ctlCuspp()}<input id="cuspp" bind:value={form.cuspp} maxlength="15" class={inputClase('cuspp')} />{/snippet}
								{@render campo('cuspp', 'CUSPP', false, ctlCuspp)}
							{/if}

							{@render subtitulo('Seguros y salud ocupacional')}
							<div class="sm:col-span-2 border border-slate-200 rounded-xl overflow-hidden">
								<div class="hidden sm:grid grid-cols-[10rem_minmax(0,1fr)_10rem_7rem] gap-2 px-3 py-2 bg-slate-100 text-xs font-semibold text-slate-600">
									<span>Cobertura</span><span>Póliza o documento</span><span>Vencimiento</span><span>Estado</span>
								</div>
								<div class="grid grid-cols-2 sm:grid-cols-[10rem_minmax(0,1fr)_10rem_7rem] items-center gap-2 px-3 py-2 text-sm">
									<span class="font-medium text-slate-800">SCTR</span>
									<span class="justify-self-end sm:justify-self-auto sm:order-last">{@render insignia(estadoVence(form.sctr_vencimiento, 7))}</span>
									<input id="sctr_poliza" bind:value={form.sctr_poliza} maxlength="40" placeholder="N.º de póliza" aria-label="Póliza SCTR" class="col-span-2 sm:col-span-1 px-2.5 py-1.5 border border-slate-200 rounded-lg text-sm" />
									<input id="sctr_vencimiento" type="date" bind:value={form.sctr_vencimiento} aria-label="Vencimiento del SCTR" class="col-span-2 sm:col-span-1 px-2 py-1.5 border border-slate-200 rounded-lg text-sm text-slate-700" />
								</div>
								<div class="grid grid-cols-2 sm:grid-cols-[10rem_minmax(0,1fr)_10rem_7rem] items-center gap-2 px-3 py-2 border-t border-slate-100 text-sm">
									<span class="font-medium text-slate-800">Examen médico ocupacional</span>
									<span class="justify-self-end sm:justify-self-auto sm:order-last">{@render insignia(estadoVence(form.examen_medico_vencimiento))}</span>
									<span class="hidden sm:block text-slate-300">—</span>
									<input id="examen_medico_vencimiento" type="date" bind:value={form.examen_medico_vencimiento} aria-label="Vencimiento del examen médico" class="col-span-2 sm:col-span-1 px-2 py-1.5 border border-slate-200 rounded-lg text-sm text-slate-700" />
								</div>
							</div>
							{@render nota('El ERP avisa en la lista de Personal 1 semana antes del vencimiento del SCTR y 30 días antes del examen médico.')}
						{/if}
					</div>
				</div>
			</div>

			<div class="px-4 sm:px-6 py-3 border-t border-slate-100 flex items-center justify-end gap-3 shrink-0">
				<button onclick={cerrar} disabled={guardando} class="px-6 py-2.5 bg-white border border-slate-200 text-slate-700 rounded-xl hover:bg-slate-50 font-semibold text-sm disabled:opacity-50">Cancelar</button>
				<button onclick={guardar} disabled={guardando} class="px-6 py-2.5 bg-orange-500 text-white rounded-xl hover:bg-orange-600 font-semibold text-sm shadow-md shadow-orange-500/20 disabled:opacity-50 flex items-center gap-2">
					{#if guardando}<i class="fas fa-spinner fa-spin"></i>{/if} Guardar cambios
				</button>
			</div>
		</div>
	</div>
{/if}
