<script lang="ts">
	/**
	 * Tareo semanal por obra (RRHH → Asistencia, pestaña "Tareo semanal por obra"; pedido del cliente con imagen de
	 * referencia, 06/11/2026). El residente revisa las horas de cada trabajador según el huellero, corrige días
	 * (Editar día), marca feriados, agrega bonos, elige la Fecha CxP y envía a Cuentas por Pagar: cada envío es una
	 * cuota de la planilla de la obra (una CxP por obra y periodo, proveedor "PLANILLA DE PERSONAL"). Se puede enviar
	 * una parte y el resto queda como saldo pendiente. Cálculo y datos: tareo.service.ts. Sin el permiso
	 * aprobar_tareo la vista es de solo lectura (y se puede exportar a Excel).
	 */
	import { onMount } from 'svelte';
	import { supabase } from '$lib/supabaseClient';
	import { toast } from '$lib/stores/toast';
	import { confirmar } from '$lib/stores/confirmDialog.svelte';
	import { hasPermiso, permisosState } from '$lib/stores/permisos.svelte';
	import { describeError } from '$lib/shared/describeError';
	import { formatCurrency } from '$lib/shared/fieldConfig';
	import { DIAS_SEMANA } from '$lib/modules/personal/services/horarios.service';
	import { nombreCompleto, hoyLima, etiquetaMonto } from '$lib/modules/personal/services/personal.service';
	import { sumarDias, duracion, reloj } from '../services/asistencia.service';
	import SelectConSaldo from '$lib/shared/components/SelectConSaldo.svelte';
	import {
		ESTADOS_AJUSTE,
		ESTADOS_CELDA,
		ORIGENES,
		lunesDe,
		getObrasTareo,
		cargarTareo,
		guardarAjuste,
		quitarAjuste,
		agregarFeriado,
		quitarFeriado,
		guardarTrabajador,
		enviarTareo,
		liberarEnviosSinPago,
		proyectarPlanillas,
		exportarTareoXLSX,
		type ObraTareo,
		type FilaTareo,
		type DiaTareo,
		type FeriadoTareo,
		type EstadoAjuste,
		type DatosTareo,
		fraccionDia,
		textoDias
	} from '../services/tareo.service';

	const hoy = hoyLima();
	const CLAVE_OBRA = 'construni_tareo_obra';
	const puedeAprobar = hasPermiso('aprobar_tareo');
	const usuario = () => permisosState.userName || null;

	let obras = $state<ObraTareo[]>([]);
	let idObra = $state('');
	let lunes = $state(lunesDe(hoy));
	let datos = $state<DatosTareo | null>(null);
	let cargando = $state(false);
	let enviando = $state(false);

	const obra = $derived(obras.find((o) => String(o.id_centro_costo) === idObra) ?? null);
	const fechas = $derived(Array.from({ length: 7 }, (_, i) => sumarDias(lunes, i)));
	const todasFilas = $derived(datos?.filas ?? []);

	// Filtro por referente (a pedido del usuario): la tabla, los totales, la exportación y el envío a CxP se limitan a
	// los trabajadores de ese referente (p. ej. para pagar a un subcontratista). '' = todos.
	const SIN_REFERENTE = '__sin__';
	let referente = $state('');
	const nombreRef = (f: FilaTareo) => (f.personal.referente_nombre ?? '').trim();
	const opcionesReferente = $derived.by(() => {
		const nombres = [...new Set(todasFilas.map(nombreRef).filter(Boolean))].sort((a, b) => a.localeCompare(b));
		const cargo = (n: string) => todasFilas.find((f) => nombreRef(f) === n)?.personal.referente_cargo;
		return [
			{ value: '', label: 'Todos los referentes' },
			...nombres.map((n) => ({ value: n, label: cargo(n) ? `${n} · ${cargo(n)}` : n })),
			...(todasFilas.some((f) => !nombreRef(f)) ? [{ value: SIN_REFERENTE, label: 'Sin referente' }] : [])
		];
	});
	const filas = $derived(
		!referente ? todasFilas : todasFilas.filter((f) => (referente === SIN_REFERENTE ? !nombreRef(f) : nombreRef(f) === referente))
	);
	/** Cajas de filtro con color propio (a pedido del usuario): Obra azul, Referente violeta, Semana verde. */
	const TONOS_CAJA = {
		blue: 'bg-blue-50 border-blue-200 text-blue-900 hover:border-blue-300 focus:ring-blue-200',
		violet: 'bg-violet-50 border-violet-200 text-violet-900 hover:border-violet-300 focus:ring-violet-200'
	};
	const cajaColor = (tono: keyof typeof TONOS_CAJA) => `rounded-xl border px-3 py-2 text-sm focus:ring-2 disabled:opacity-60 ${TONOS_CAJA[tono]}`;
	const opcionesObra = $derived(obras.map((o) => ({ value: String(o.id_centro_costo), label: `${o.codigo} · ${o.nombre}` })));

	// ── Lo que el residente escribe por fila (bonos, Fecha CxP, monto a enviar) ──
	let bonos = $state<Record<number, string>>({});
	let fechaCxp = $state<Record<number, string>>({});
	let monto = $state<Record<number, string>>({});
	let seleccion = $state<Record<number, boolean>>({});
	let fechaComun = $state('');

	const num = (v: string | undefined) => {
		const n = Number(String(v ?? '').replace(',', '.'));
		return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0;
	};
	const totalDe = (f: FilaTareo) => Math.round((f.subtotal + num(bonos[f.personal.id_personal])) * 100) / 100;
	const pendienteDe = (f: FilaTareo) => Math.max(Math.round((totalDe(f) - f.enviado) * 100) / 100, 0);
	const montoDe = (f: FilaTareo) => num(monto[f.personal.id_personal]);

	const totalSemana = $derived(filas.reduce((t, f) => t + totalDe(f), 0));
	const totalEnviado = $derived(filas.reduce((t, f) => t + f.enviado, 0));
	const saldoPendiente = $derived(filas.reduce((t, f) => t + pendienteDe(f), 0));
	const seleccionados = $derived(filas.filter((f) => seleccion[f.personal.id_personal]));
	const totalSeleccionado = $derived(seleccionados.reduce((t, f) => t + montoDe(f), 0));
	const conPendiente = $derived(filas.filter((f) => pendienteDe(f) > 0));
	const todosMarcados = $derived(conPendiente.length > 0 && conPendiente.every((f) => seleccion[f.personal.id_personal]));
	const porRevisar = $derived(filas.reduce((t, f) => t + f.porRevisar, 0));
	const feriadoDe = (fecha: string) => datos?.feriados.find((x) => x.fecha === fecha) ?? null;

	function iniciarFormulario(lista: FilaTareo[]) {
		const b: Record<number, string> = {};
		const fc: Record<number, string> = {};
		const mo: Record<number, string> = {};
		for (const f of lista) {
			const id = f.personal.id_personal;
			b[id] = f.bonos ? String(f.bonos) : '';
			fc[id] = f.fechaCxp ?? '';
			mo[id] = f.pendiente ? f.pendiente.toFixed(2) : '';
		}
		bonos = b;
		fechaCxp = fc;
		monto = mo;
		seleccion = {};
	}

	async function cargar() {
		if (!obra) return;
		cargando = true;
		try {
			datos = await cargarTareo(supabase, obra.id_centro_costo, lunes, hoy);
			iniciarFormulario(datos.filas);
		} catch (err) {
			toast.error(`No se pudo cargar el tareo. ${describeError(err)}`);
			datos = null;
		} finally {
			cargando = false;
		}
	}

	function elegirObra(v: string) {
		idObra = v;
		referente = '';
		try {
			localStorage.setItem(CLAVE_OBRA, v);
		} catch {
			/* sin almacenamiento local: no se recuerda la obra */
		}
		cargar();
	}

	function moverSemana(dias: number) {
		lunes = sumarDias(lunes, dias);
		cargar();
	}

	function elegirFechaSemana(v: string) {
		if (!v) return;
		lunes = lunesDe(v);
		cargar();
	}

	onMount(async () => {
		try {
			obras = await getObrasTareo(supabase);
		} catch (err) {
			toast.error(`No se pudieron cargar las obras. ${describeError(err)}`);
			return;
		}
		let guardada = '';
		try {
			guardada = localStorage.getItem(CLAVE_OBRA) ?? '';
		} catch {
			/* sin almacenamiento local */
		}
		const inicial = obras.find((o) => String(o.id_centro_costo) === guardada) ?? (obras.length === 1 ? obras[0] : null);
		if (inicial) {
			idObra = String(inicial.id_centro_costo);
			await cargar();
		}
		// La CxP proyectada del periodo actual (no bloquea la vista).
		void proyectarPlanillas(supabase);
	});

	// ── Bonos y Fecha CxP: se guardan al salir del campo ──
	async function guardarFila(f: FilaTareo) {
		if (!puedeAprobar || !obra) return;
		const id = f.personal.id_personal;
		if (num(bonos[id]) === f.bonos && (fechaCxp[id] || null) === f.fechaCxp) return;
		try {
			await guardarTrabajador(supabase, obra.id_centro_costo, lunes, id, num(bonos[id]), fechaCxp[id] || null);
			f.bonos = num(bonos[id]);
			f.fechaCxp = fechaCxp[id] || null;
			monto[id] = pendienteDe(f) ? pendienteDe(f).toFixed(2) : '';
		} catch (err) {
			toast.error(`No se pudo guardar. ${describeError(err)}`);
		}
	}

	async function aplicarFechaComun() {
		if (!fechaComun) {
			toast.error('Elige primero la fecha común de CxP.');
			return;
		}
		const lista = seleccionados.length ? seleccionados : filas;
		for (const f of lista) fechaCxp[f.personal.id_personal] = fechaComun;
		await Promise.all(lista.map((f) => guardarFila(f)));
		toast.success(`Fecha CxP aplicada a ${lista.length} trabajador${lista.length === 1 ? '' : 'es'}.`);
	}

	function marcarTodos(v: boolean) {
		const s: Record<number, boolean> = {};
		if (v) for (const f of filas) if (pendienteDe(f) > 0) s[f.personal.id_personal] = true;
		seleccion = s;
	}

	// ── Envío a Cuentas por Pagar ──
	async function enviar(lista: FilaTareo[], completo = false) {
		if (!obra || enviando) return;
		const envios = lista
			.map((f) => {
				const id = f.personal.id_personal;
				return { fila: { ...f, bonos: num(bonos[id]), total: totalDe(f) }, monto: completo ? pendienteDe(f) : montoDe(f), fechaCxp: fechaCxp[id] || fechaComun || sumarDias(lunes, 6) };
			})
			.filter((e) => e.monto > 0);
		if (!envios.length) {
			toast.error('No hay montos por enviar.');
			return;
		}
		const excede = envios.find((e) => e.monto - pendienteDe(e.fila) > 0.005);
		if (excede) {
			toast.error(`${nombreCompleto(excede.fila.personal)}: el monto a enviar supera lo pendiente (${formatCurrency(pendienteDe(excede.fila))}).`);
			return;
		}
		const sinRevisar = envios.filter((e) => e.fila.porRevisar).length;
		const suma = envios.reduce((t, e) => t + e.monto, 0);
		// Ticket #133: cada trabajador va a la planilla de SU periodicidad (semanal / quincenal / mensual). Antes el
		// mensaje decía "la planilla de la obra" y, si alguien cobraba mensual, aparecía una segunda CxP sin aviso.
		const GRUPO: Record<string, string> = { quincenal: 'quincenal', mensual: 'mensual' };
		const porPlanilla = new Map<string, { n: number; monto: number }>();
		for (const e of envios) {
			const g = GRUPO[e.fila.personal.periodicidad_pago ?? ''] ?? 'semanal';
			const a = porPlanilla.get(g) ?? { n: 0, monto: 0 };
			porPlanilla.set(g, { n: a.n + 1, monto: a.monto + e.monto });
		}
		const detallePlanillas = [...porPlanilla.entries()]
			.map(([g, v]) => `Planilla ${g} ${obra!.codigo}: ${formatCurrency(v.monto)} (${v.n} trabajador${v.n === 1 ? '' : 'es'})`)
			.join(' · ');
		const ok = await confirmar({
			title: 'Enviar a Cuentas por Pagar',
			message: `Se enviarán ${formatCurrency(suma)} de ${envios.length} trabajador${envios.length === 1 ? '' : 'es'} a Cuentas por Pagar (proveedor "Planilla de personal"). ${porPlanilla.size > 1 ? `Van a ${porPlanilla.size} planillas distintas según cada cuánto cobra el trabajador: ` : ''}${detallePlanillas}. En la CxP de cada planilla también figura, aparte, la "Proyección de planilla" del personal que aún no tiene tareo enviado. La semana queda aprobada a tu nombre.${sinRevisar ? ` Ojo: ${sinRevisar} tiene${sinRevisar === 1 ? '' : 'n'} días sin marca de salida sin revisar (no se pagan).` : ''}`,
			confirmLabel: 'Enviar',
			danger: false
		});
		if (!ok) return;
		enviando = true;
		try {
			const n = await enviarTareo(supabase, obra.id_centro_costo, lunes, envios, usuario());
			toast.success(`Enviado a Cuentas por Pagar: ${n} trabajador${n === 1 ? '' : 'es'}, ${formatCurrency(suma)}.`);
			await cargar();
		} catch (err) {
			toast.error(`No se pudo enviar. ${describeError(err)}`);
		} finally {
			enviando = false;
		}
	}

	// Ticket #133: lo enviado cuyo pago se eliminó de CxP se libera para volver a enviarlo.
	let liberando = $state(false);
	async function liberarSinPago() {
		if (!obra || !datos?.enviadoSinPago || liberando) return;
		const ok = await confirmar({
			title: 'Liberar envíos de pagos eliminados',
			message: `En esta semana hay ${formatCurrency(datos.enviadoSinPago)} marcados como enviados cuyos pagos ya se eliminaron de Cuentas por Pagar. Se quitarán de "Enviado" y volverán a quedar pendientes para enviarlos de nuevo. No se modifica ninguna CxP ni pago.`,
			confirmLabel: 'Liberar',
			danger: false
		});
		if (!ok) return;
		liberando = true;
		try {
			const monto = await liberarEnviosSinPago(supabase, obra.id_centro_costo, lunes);
			toast.success(`Liberado ${formatCurrency(monto)}: ya se puede volver a enviar.`);
			await cargar();
		} catch (err) {
			toast.error(`No se pudo liberar. ${describeError(err)}`);
		} finally {
			liberando = false;
		}
	}

	// ── Editar día ──
	type Pago = 'completo' | 'medio' | 'sin_pago' | 'otras';
	// Diagnóstico de marcas (19/11/2026): todas las marcas de la semana del trabajador y por qué cuentan o no.
	let diag = $state<FilaTareo | null>(null);
	const marcasDe = (f: FilaTareo) => datos?.diagnostico?.[f.personal.id_personal] ?? [];
	const noCuentan = (f: FilaTareo) => marcasDe(f).filter((m) => !m.cuenta).length;
	const MODOS: Record<number, string> = { 1: 'Huella', 15: 'Rostro', 0: 'Clave', 3: 'Clave', 4: 'Tarjeta' };

	let edicion = $state<{ fila: FilaTareo; dia: DiaTareo } | null>(null);
	let edEstado = $state<EstadoAjuste>('asistio');
	let edPago = $state<Pago>('completo');
	let edHoras = $state('0');
	let edMinutos = $state('0');
	let edObservacion = $state('');
	let edTodos = $state(false);
	let guardandoDia = $state(false);

	const minutosEditados = $derived.by(() => {
		if (!edicion) return 0;
		const j = edicion.fila.jornadaMin;
		if (edPago === 'completo') return j;
		if (edPago === 'medio') return Math.round(j / 2);
		if (edPago === 'sin_pago') return 0;
		return Math.max(0, Math.min(1440, Math.round(Number(edHoras || 0) * 60 + Number(edMinutos || 0))));
	});

	function abrirDia(fila: FilaTareo, dia: DiaTareo) {
		if (dia.estado === 'por_venir' || dia.estado === 'fuera_contrato') return;
		edicion = { fila, dia };
		const base = dia.ajuste?.minutos_reconocidos ?? (dia.minutos || dia.minutosHuellero);
		edEstado = dia.ajuste?.estado ?? (dia.estado === 'feriado' || dia.estado === 'falta' || dia.estado === 'sin_trabajo' ? dia.estado : 'asistio');
		const j = fila.jornadaMin;
		edPago = base === j ? 'completo' : base === Math.round(j / 2) ? 'medio' : base === 0 && dia.estado !== 'pendiente' ? 'sin_pago' : 'otras';
		edHoras = String(Math.floor(base / 60));
		edMinutos = String(base % 60);
		edObservacion = dia.ajuste?.observacion ?? '';
		edTodos = false;
	}

	function cambiarEstado(v: EstadoAjuste) {
		edEstado = v;
		if (v === 'falta' || v === 'sin_trabajo') edPago = 'sin_pago';
		else if (v === 'feriado') edPago = 'completo';
	}

	async function guardarDia() {
		if (!edicion || !obra || guardandoDia) return;
		guardandoDia = true;
		try {
			const ids = edTodos ? todasFilas.map((f) => f.personal.id_personal) : [edicion.fila.personal.id_personal];
			await guardarAjuste(supabase, ids, obra.id_centro_costo, edicion.dia.fecha, { estado: edEstado, minutos: minutosEditados, observacion: edObservacion }, usuario());
			toast.success(edTodos ? `Día aplicado a los ${ids.length} trabajadores de la obra.` : 'Día actualizado.');
			edicion = null;
			await cargar();
		} catch (err) {
			toast.error(`No se pudo guardar el día. ${describeError(err)}`);
		} finally {
			guardandoDia = false;
		}
	}

	async function restaurarDia() {
		if (!edicion || !obra) return;
		try {
			await quitarAjuste(supabase, edicion.fila.personal.id_personal, obra.id_centro_costo, edicion.dia.fecha);
			toast.success('El día vuelve a lo que marcó el huellero.');
			edicion = null;
			await cargar();
		} catch (err) {
			toast.error(`No se pudo quitar el ajuste. ${describeError(err)}`);
		}
	}

	// ── Feriados ──
	let feriadosAbierto = $state(false);
	let feFecha = $state('');
	let feDescripcion = $state('');
	let feTodas = $state(false);

	async function nuevoFeriado() {
		if (!feFecha || !obra) {
			toast.error('Elige la fecha del feriado.');
			return;
		}
		try {
			await agregarFeriado(supabase, feFecha, feTodas ? null : obra.id_centro_costo, feDescripcion, usuario());
			feFecha = '';
			feDescripcion = '';
			await cargar();
		} catch (err) {
			toast.error(`No se pudo guardar el feriado. ${describeError(err)}`);
		}
	}

	async function borrarFeriado(f: FeriadoTareo) {
		try {
			await quitarFeriado(supabase, f.id_feriado);
			await cargar();
		} catch (err) {
			toast.error(`No se pudo quitar el feriado. ${describeError(err)}`);
		}
	}

	async function exportar() {
		if (!obra || !datos) return;
		try {
			const lista = filas.map((f) => ({ ...f, bonos: num(bonos[f.personal.id_personal]), total: totalDe(f), pendiente: pendienteDe(f), fechaCxp: fechaCxp[f.personal.id_personal] || f.fechaCxp }));
			await exportarTareoXLSX(obra, lunes, lista);
		} catch (err) {
			toast.error(`No se pudo exportar. ${describeError(err)}`);
		}
	}

	const ddmm = (f: string) => `${f.slice(8, 10)}/${f.slice(5, 7)}`;
	const horas = (min: number) => (min ? `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}` : '—');
	const tituloSemana = $derived(`${ddmm(fechas[0])} – ${ddmm(fechas[6])}/${fechas[6].slice(0, 4)}`);
</script>

{#snippet celda(f: FilaTareo, d: DiaTareo)}
	{@const est = ESTADOS_CELDA[d.estado]}
	{@const editable = puedeAprobar && d.estado !== 'por_venir' && d.estado !== 'fuera_contrato'}
	<button
		type="button"
		onclick={() => editable && abrirDia(f, d)}
		disabled={!editable}
		title={`${DIAS_SEMANA[d.dia - 1]} ${ddmm(d.fecha)} · ${est.texto || 'Por venir'}${d.origen ? ` · ${ORIGENES[d.origen].texto}` : ''}${d.ajuste?.observacion ? ` · ${d.ajuste.observacion}` : ''}${editable ? ' — clic para editar' : ''}`}
		class={`w-full min-w-[46px] h-12 rounded-lg border px-1 py-1 flex flex-col items-center justify-center gap-0.5 text-center transition-shadow ${est.clase} ${editable ? 'hover:shadow-md hover:ring-1 hover:ring-blue-300 cursor-pointer' : 'cursor-default'}`}
	>
		<!-- Ticket #132: se paga por día o medio día; lo grande es "1" o "½" y las horas van debajo, chicas. -->
		<span class="text-base font-extrabold leading-none">{d.fraccion ? (d.fraccion === 1 ? '1' : '½') : d.estado === 'falta' ? 'F' : d.estado === 'por_venir' ? '' : '—'}</span>
		{#if d.minutos}<span class="text-[9px] leading-none text-slate-500 tabular-nums">{horas(d.minutos)}</span>{/if}
		<span class="flex items-center gap-1 text-[9px] leading-none">
			{#if d.origen}<i class={`fas ${ORIGENES[d.origen].icono} ${ORIGENES[d.origen].color}`}></i>{/if}
			{#if d.estado !== 'asistio' && d.estado !== 'por_venir'}<span class="truncate max-w-[52px]">{est.texto}</span>{/if}
		</span>
	</button>
{/snippet}

<div class="flex flex-col gap-4">
	<!-- Filtros -->
	<div class="bg-white border border-slate-100 rounded-2xl shadow-sm p-4 flex flex-col gap-3">
		<div class="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_auto] gap-3 items-end">
			<div class="grid grid-cols-1 sm:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] gap-3 min-w-0">
				<div class="flex flex-col gap-1.5 min-w-0">
					<label for="tareo-obra" class="text-sm font-semibold text-blue-700 flex items-center gap-1.5"><i class="fas fa-helmet-safety text-blue-500 text-xs"></i> Obra</label>
					<SelectConSaldo id="tareo-obra" value={idObra} options={opcionesObra} placeholder="Elige la obra…" encabezadoNombre="Obra" claseBoton={cajaColor('blue')} onchange={elegirObra} />
				</div>
				<div class="flex flex-col gap-1.5 min-w-0">
					<label for="tareo-referente" class="text-sm font-semibold text-violet-700 flex items-center gap-1.5"><i class="fas fa-user-tie text-violet-500 text-xs"></i> Referente</label>
					<SelectConSaldo id="tareo-referente" value={referente} options={opcionesReferente} placeholder="Todos los referentes" encabezadoNombre="Referente" claseBoton={cajaColor('violet')} disabled={!obra || !todasFilas.length} onchange={(v) => (referente = v)} />
				</div>
			</div>
			<div class="flex flex-wrap items-end gap-2">
				<div class="flex flex-col gap-1.5">
					<span class="text-sm font-semibold text-emerald-700 flex items-center gap-1.5"><i class="fas fa-calendar-week text-emerald-500 text-xs"></i> Semana</span>
					<div class="flex items-center gap-1">
						<button type="button" onclick={() => moverSemana(-7)} disabled={!obra} class="px-2.5 py-2 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 disabled:opacity-40" aria-label="Semana anterior"><i class="fas fa-chevron-left"></i></button>
						<input type="date" value={lunes} onchange={(e) => elegirFechaSemana((e.currentTarget as HTMLInputElement).value)} disabled={!obra} class="px-3 py-2 border border-emerald-200 bg-emerald-50 text-emerald-900 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-200 disabled:opacity-60" aria-label="Cualquier día de la semana" />
						<button type="button" onclick={() => moverSemana(7)} disabled={!obra} class="px-2.5 py-2 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 disabled:opacity-40" aria-label="Semana siguiente"><i class="fas fa-chevron-right"></i></button>
					</div>
				</div>
				{#if puedeAprobar}
					<button type="button" onclick={() => { feFecha = ''; feDescripcion = ''; feTodas = false; feriadosAbierto = true; }} disabled={!obra} class="px-3 py-2 rounded-xl border border-slate-200 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-40 flex items-center gap-2"><i class="fas fa-umbrella-beach text-sky-600"></i> Configurar feriado</button>
				{/if}
				<button type="button" onclick={exportar} disabled={!obra || !filas.length} class="px-3 py-2 rounded-xl border border-slate-200 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-40 flex items-center gap-2"><i class="fas fa-file-excel text-emerald-600"></i> Exportar Excel</button>
			</div>
		</div>
		{#if obra && puedeAprobar}
			<div class="flex flex-wrap items-end gap-2 border-t border-slate-100 pt-3">
				<div class="flex flex-col gap-1.5">
					<label for="tareo-fecha-comun" class="text-xs font-medium text-slate-600">Fecha común de CxP</label>
					<input id="tareo-fecha-comun" type="date" bind:value={fechaComun} class="px-3 py-1.5 border border-slate-200 rounded-lg text-sm" />
				</div>
				<button type="button" onclick={aplicarFechaComun} class="px-3 py-1.5 rounded-lg border border-slate-200 text-sm text-slate-700 hover:bg-slate-50">
					Aplicar a {seleccionados.length ? `seleccionados (${seleccionados.length})` : 'todos'}
				</button>
				<span class="text-xs text-slate-400">Fecha en que se programa el pago en Cuentas por Pagar.</span>
			</div>
		{/if}
	</div>

	{#if !obra}
		<div class="bg-white border border-slate-100 rounded-2xl shadow-sm py-16 flex flex-col items-center gap-2 text-slate-400">
			<i class="fas fa-helmet-safety text-3xl"></i>
			<span class="text-sm">{obras.length ? 'Elige una obra para ver su tareo de la semana.' : 'No hay obras con personal asignado ni huelleros instalados.'}</span>
		</div>
	{:else if cargando && !datos}
		<div class="flex items-center justify-center py-16 text-slate-400 gap-3">
			<i class="fas fa-spinner fa-spin text-xl text-blue-500"></i>
			<span class="text-sm font-medium">Cargando tareo...</span>
		</div>
	{:else if datos}
		<div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-600 px-1">
			<span class="font-semibold text-slate-800">{obra.codigo} · {obra.nombre}</span>
			<span>Semana {tituloSemana}</span>
			{#if datos.semana?.estado === 'aprobado'}
				<span class="text-emerald-700"><i class="fas fa-circle-check"></i> Aprobado{datos.semana.aprobado_por ? ` por ${datos.semana.aprobado_por}` : ''}{datos.semana.aprobado_en ? ` el ${new Date(datos.semana.aprobado_en).toLocaleDateString('es-PE')}` : ''}</span>
			{:else}
				<span class="text-slate-400">Borrador (sin enviar)</span>
			{/if}
			{#if porRevisar}<span class="text-orange-700"><i class="fas fa-triangle-exclamation"></i> {porRevisar} día{porRevisar === 1 ? '' : 's'} sin marca de salida por revisar</span>{/if}
			{#if cargando}<i class="fas fa-spinner fa-spin text-blue-500"></i>{/if}
		</div>

		{#if datos.enviadoSinPago > 0}
			<div class="flex flex-wrap items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
				<i class="fas fa-triangle-exclamation"></i>
				<span class="flex-1 min-w-[200px]"><b>{formatCurrency(datos.enviadoSinPago)}</b> figuran como enviados, pero sus pagos se eliminaron de Cuentas por Pagar.{puedeAprobar ? '' : ' Quien aprueba tareos puede liberarlos para reenviarlos.'}</span>
				{#if puedeAprobar}
					<button type="button" onclick={liberarSinPago} disabled={liberando} class="px-3 py-1.5 rounded-lg bg-amber-600 text-white text-xs font-semibold disabled:opacity-50">{liberando ? 'Liberando…' : 'Liberar para reenviar'}</button>
				{/if}
			</div>
		{/if}

		<div class="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500 px-1">
			{#each Object.entries(ORIGENES) as [, o]}<span class="flex items-center gap-1.5"><i class={`fas ${o.icono} ${o.color}`}></i>{o.texto}</span>{/each}
			<span>· Se paga por día: 1 = día completo, ½ = medio día (las horas van debajo). {puedeAprobar ? 'Toca un día para corregirlo.' : ''}</span>
		</div>

		{#if !filas.length}
			<div class="bg-white border border-slate-100 rounded-2xl shadow-sm py-12 text-center text-sm text-slate-400">{todasFilas.length ? 'Ningún trabajador de esta obra tiene ese referente.' : 'Esta obra no tiene trabajadores activos ni marcas en la semana.'}</div>
		{:else}
			<!-- Escritorio: tabla -->
			<div class="hidden md:block bg-white border border-slate-100 rounded-2xl shadow-sm overflow-x-auto">
				<table class="w-full text-sm">
					<thead class="bg-slate-50 text-slate-600 text-xs">
						<tr>
							{#if puedeAprobar}<th class="px-2 py-2 w-8"><input type="checkbox" checked={todosMarcados} disabled={!conPendiente.length} onchange={(e) => marcarTodos((e.currentTarget as HTMLInputElement).checked)} aria-label="Seleccionar todos" /></th>{/if}
							<th class="px-2 py-2 text-left min-w-[150px]">Trabajador</th>
							{#each fechas as f, i}
								{@const fer = feriadoDe(f)}
								<th class={`px-1 py-2 text-center ${f === hoy ? 'text-blue-700' : ''}`}>
									<div>{DIAS_SEMANA[i].slice(0, 3)}</div>
									<div class="font-normal text-[11px]">{ddmm(f)}</div>
									{#if fer}<div class="text-[10px] text-sky-600 font-semibold" title={fer.descripcion ?? 'Feriado'}>Feriado</div>{/if}
								</th>
							{/each}
							<th class="px-2 py-2 text-right">Días</th>
							<th class="px-2 py-2 text-right">Bonos</th>
							<th class="px-2 py-2 text-right">Total</th>
							<th class="px-2 py-2 text-left">Fecha CxP</th>
							<th class="px-2 py-2 text-right">A enviar</th>
							{#if puedeAprobar}<th class="px-2 py-2"></th>{/if}
						</tr>
					</thead>
					<tbody class="divide-y divide-slate-100">
						{#each filas as f (f.personal.id_personal)}
							{@const id = f.personal.id_personal}
							<tr class="align-middle">
								{#if puedeAprobar}<td class="px-2 py-2 text-center"><input type="checkbox" bind:checked={seleccion[id]} disabled={pendienteDe(f) <= 0} aria-label={`Seleccionar ${nombreCompleto(f.personal)}`} /></td>{/if}
								<td class="px-2 py-2">
									<div class="font-medium text-slate-800">{nombreCompleto(f.personal)}</div>
									{@render botonMarcas(f)}
									<div class="text-[11px] text-slate-400">{f.personal.cargo ?? f.personal.categoria ?? ''}{f.personal.id_centro_costo !== obra.id_centro_costo ? ' · de otra obra' : ''}</div>
									{#if f.sinMonto}
										<div class="text-[11px] text-amber-700"><i class="fas fa-triangle-exclamation"></i> Sin monto de pago en Personal</div>
									{:else}
										<div class="text-[11px] text-slate-500" title={`${etiquetaMonto(f.personal.periodicidad_pago)} ${formatCurrency(Number(f.personal.monto_pago))} · jornada ${duracion(f.jornadaMin)}`}>{formatCurrency(f.tarifaDia)}/día</div>
									{/if}
								</td>
								{#each f.dias as d (d.fecha)}<td class="px-0.5 py-2">{@render celda(f, d)}</td>{/each}
								<td class="px-2 py-2 text-right whitespace-nowrap"><div class="text-base font-bold text-slate-800">{textoDias(f.diasPagados)}</div><div class="text-[11px] text-slate-400 tabular-nums">{horas(f.minutos)} h</div></td>
								<td class="px-2 py-2 text-right">
									{#if puedeAprobar}
										<input type="text" inputmode="decimal" bind:value={bonos[id]} onblur={() => guardarFila(f)} placeholder="0.00" class="w-16 px-1.5 py-1 border border-slate-200 rounded-lg text-right text-xs" aria-label="Bonos" />
									{:else}{formatCurrency(f.bonos)}{/if}
								</td>
								<td class="px-2 py-2 text-right whitespace-nowrap">
									<div class="font-semibold text-slate-800">{formatCurrency(totalDe(f))}</div>
									{#if f.enviado}<div class="text-[11px] text-emerald-700">Enviado {formatCurrency(f.enviado)}</div>{/if}
								</td>
								<td class="px-2 py-2">
									{#if puedeAprobar}
										<input type="date" bind:value={fechaCxp[id]} onchange={() => guardarFila(f)} class="w-[118px] px-1 py-1 border border-slate-200 rounded-lg text-xs" aria-label="Fecha CxP" />
									{:else}{f.fechaCxp ? ddmm(f.fechaCxp) : '—'}{/if}
								</td>
								<td class="px-2 py-2 text-right">
									{#if puedeAprobar && pendienteDe(f) > 0}
										<input type="text" inputmode="decimal" bind:value={monto[id]} class="w-20 px-1.5 py-1 border border-slate-200 rounded-lg text-right text-xs" aria-label="Monto a enviar" />
										{#if montoDe(f) && montoDe(f) < pendienteDe(f)}<div class="text-[11px] text-amber-700">Queda {formatCurrency(pendienteDe(f) - montoDe(f))}</div>{/if}
									{:else if pendienteDe(f) <= 0 && f.enviado}
										<span class="text-[11px] text-emerald-700 font-semibold"><i class="fas fa-check"></i> Completo</span>
									{:else}<span class="text-slate-300">—</span>{/if}
								</td>
								{#if puedeAprobar}
									<td class="px-2 py-2">
										<button type="button" onclick={() => enviar([f])} disabled={enviando || !montoDe(f) || pendienteDe(f) <= 0} class="px-2.5 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-semibold whitespace-nowrap disabled:opacity-30" title="Enviar a cuenta por pagar" aria-label={`Enviar a cuenta por pagar: ${nombreCompleto(f.personal)}`}>
											<i class="fas fa-paper-plane"></i>
										</button>
									</td>
								{/if}
							</tr>
						{/each}
					</tbody>
				</table>
			</div>

			<!-- Celular: una tarjeta por trabajador -->
			<div class="md:hidden flex flex-col gap-3">
				{#each filas as f (f.personal.id_personal)}
					{@const id = f.personal.id_personal}
					<div class="bg-white border border-slate-100 rounded-2xl shadow-sm p-3 flex flex-col gap-2">
						<div class="flex items-start gap-2">
							{#if puedeAprobar}<input type="checkbox" class="mt-1" bind:checked={seleccion[id]} disabled={pendienteDe(f) <= 0} aria-label={`Seleccionar ${nombreCompleto(f.personal)}`} />{/if}
							<div class="min-w-0 flex-1">
								<div class="font-semibold text-slate-800">{nombreCompleto(f.personal)}</div>
								{@render botonMarcas(f)}
								<div class="text-[11px] text-slate-500">{f.sinMonto ? 'Sin monto de pago en Personal' : `${formatCurrency(f.tarifaDia)}/día`}</div>
							</div>
							<div class="text-right">
								<div class="font-bold text-slate-800">{formatCurrency(totalDe(f))}</div>
								<div class="text-[11px] text-slate-500">{textoDias(f.diasPagados)} · {horas(f.minutos)} h</div>
							</div>
						</div>
						<div class="grid grid-cols-7 gap-1">
							{#each f.dias as d (d.fecha)}
								<div class="flex flex-col items-center gap-0.5">
									<span class="text-[10px] text-slate-400">{DIAS_SEMANA[d.dia - 1].slice(0, 2)} {d.fecha.slice(8)}</span>
									{@render celda(f, d)}
								</div>
							{/each}
						</div>
						{#if puedeAprobar}
							<div class="grid grid-cols-3 gap-2 text-xs">
								<label class="flex flex-col gap-1 text-slate-500">Bonos<input type="text" inputmode="decimal" bind:value={bonos[id]} onblur={() => guardarFila(f)} placeholder="0.00" class="px-2 py-1.5 border border-slate-200 rounded-lg text-sm text-right" /></label>
								<label class="flex flex-col gap-1 text-slate-500">Fecha CxP<input type="date" bind:value={fechaCxp[id]} onchange={() => guardarFila(f)} class="px-1 py-1.5 border border-slate-200 rounded-lg text-sm" /></label>
								<label class="flex flex-col gap-1 text-slate-500">A enviar<input type="text" inputmode="decimal" bind:value={monto[id]} disabled={pendienteDe(f) <= 0} class="px-2 py-1.5 border border-slate-200 rounded-lg text-sm text-right disabled:bg-slate-50" /></label>
							</div>
							<div class="flex items-center justify-between gap-2">
								<span class="text-[11px] {f.enviado ? 'text-emerald-700' : 'text-slate-400'}">{f.enviado ? `Enviado ${formatCurrency(f.enviado)}${pendienteDe(f) ? ` · pendiente ${formatCurrency(pendienteDe(f))}` : ' · completo'}` : 'Sin enviar'}</span>
								<button type="button" onclick={() => enviar([f])} disabled={enviando || !montoDe(f) || pendienteDe(f) <= 0} class="px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-semibold disabled:opacity-30"><i class="fas fa-paper-plane"></i> Enviar a CxP</button>
							</div>
						{/if}
					</div>
				{/each}
			</div>

			<!-- Totales y envío -->
			<div class="sticky bottom-0 bg-white border border-slate-200 rounded-2xl shadow-lg p-3 flex flex-col sm:flex-row sm:items-center gap-3">
				<div class="flex flex-wrap gap-x-5 gap-y-1 text-sm flex-1">
					<span class="text-slate-500">Total semana <b class="text-slate-800">{formatCurrency(totalSemana)}</b></span>
					<span class="text-slate-500">Enviado <b class="text-emerald-700">{formatCurrency(totalEnviado)}</b></span>
					<span class="text-slate-500">Saldo pendiente <b class={saldoPendiente ? 'text-amber-700' : 'text-slate-800'}>{formatCurrency(saldoPendiente)}</b></span>
					{#if seleccionados.length}<span class="text-slate-500">Seleccionados ({seleccionados.length}) <b class="text-blue-700">{formatCurrency(totalSeleccionado)}</b></span>{/if}
				</div>
				{#if puedeAprobar}
					<div class="flex flex-wrap gap-2">
						<button type="button" onclick={() => enviar(seleccionados)} disabled={enviando || !seleccionados.length} class="px-3 py-2 rounded-xl border border-blue-200 text-blue-700 text-sm font-semibold hover:bg-blue-50 disabled:opacity-40">Enviar seleccionados a CxP</button>
						<button type="button" onclick={() => enviar(filas, true)} disabled={enviando || saldoPendiente <= 0} class="px-3 py-2 rounded-xl bg-blue-600 text-white text-sm font-semibold disabled:opacity-40">{enviando ? 'Enviando…' : referente ? 'Enviar total del referente' : 'Enviar total de la obra'}</button>
					</div>
				{/if}
			</div>
		{/if}
	{/if}
</div>

{#snippet botonMarcas(f: FilaTareo)}
	{@const n = marcasDe(f).length}
	{@const nc = noCuentan(f)}
	<button
		type="button"
		onclick={() => (diag = f)}
		class="text-[11px] font-semibold {nc ? 'text-amber-700 hover:text-amber-800' : 'text-slate-400 hover:text-blue-600'}"
		title="Ver todas las marcas de la semana y si cuentan en esta obra"
	>
		<i class="fas {nc ? 'fa-triangle-exclamation' : 'fa-magnifying-glass'}"></i>
		{n ? `${n} marca${n === 1 ? '' : 's'}` : 'Sin marcas'}{nc ? ` · ${nc} no cuenta${nc === 1 ? '' : 'n'}` : ''}
	</button>
{/snippet}

<!-- Diagnóstico de marcas -->
{#if diag}
	{@const lista = marcasDe(diag)}
	<div class="fixed inset-0 z-[120] flex items-end sm:items-center justify-center bg-slate-900/50 p-0 sm:p-4" role="dialog" aria-modal="true" aria-label="Marcas de la semana">
		<div class="w-full sm:max-w-2xl bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl p-5 flex flex-col gap-3 max-h-[92vh] overflow-y-auto">
			<div class="flex items-start justify-between gap-3">
				<div>
					<h2 class="text-lg font-bold text-slate-800">Marcas de la semana</h2>
					<p class="text-sm text-slate-500">{nombreCompleto(diag.personal)} · PIN {diag.personal.pin} · {ddmm(lunes)} – {ddmm(sumarDias(lunes, 6))}</p>
				</div>
				<button type="button" onclick={() => (diag = null)} class="text-slate-400 hover:text-slate-600 p-1" aria-label="Cerrar"><i class="fas fa-times"></i></button>
			</div>
			<p class="text-xs text-slate-500">
				Todas las marcas que llegaron al ERP para este trabajador. Solo las marcadas <b class="text-emerald-700">Cuenta</b> se usan para las horas del tareo de esta obra; las demás dicen por qué no.
			</p>
			{#if !lista.length}
				<div class="rounded-xl border border-slate-100 bg-slate-50 p-4 text-sm text-slate-600">
					No llegó ninguna marca de este trabajador esta semana (PIN {diag.personal.pin}). Si sí marcó, revisa que el huellero esté conectado y que su PIN en el huellero sea el mismo que en Personal.
				</div>
			{:else}
				<div class="flex flex-col divide-y divide-slate-100 rounded-xl border border-slate-100">
					{#each lista as m, i (i)}
						<div class="px-3 py-2 flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3 text-sm">
							<div class="sm:w-36 shrink-0">
								<span class="font-semibold text-slate-800">{DIAS_SEMANA[(new Date(m.fecha + 'T12:00:00Z').getUTCDay() + 6) % 7].slice(0, 3)} {ddmm(m.fecha)}</span>
								<span class="text-slate-500">{m.hora.slice(0, 5)}</span>
							</div>
							<div class="flex-1 min-w-0 text-xs text-slate-500">
								<div>{m.huellero}{m.modo != null && MODOS[m.modo] ? ` · ${MODOS[m.modo]}` : ''} · <span class="text-slate-600">{m.obra}</span></div>
								<div class={m.cuenta ? 'text-slate-400' : 'text-amber-700'}>{m.motivo}</div>
							</div>
							<span class="shrink-0 self-start sm:self-center px-2 py-0.5 rounded-full text-[11px] font-semibold border {m.cuenta ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-amber-50 text-amber-700 border-amber-200'}">
								{m.cuenta ? 'Cuenta' : 'No cuenta'}
							</span>
						</div>
					{/each}
				</div>
			{/if}
			<div class="flex justify-end">
				<button type="button" onclick={() => (diag = null)} class="px-4 py-2 rounded-xl border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50">Cerrar</button>
			</div>
		</div>
	</div>
{/if}

<!-- Editar día -->
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
				{#if e.dia.ajuste}<span class="text-amber-700"><i class="fas fa-pen"></i> Modificado{e.dia.ajuste.usuario ? ` por ${e.dia.ajuste.usuario}` : ''}</span>{/if}
			</div>
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
			<label class="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" bind:checked={edTodos} /> Aplicar a todos los trabajadores de esta obra ({todasFilas.length})</label>
			<div class="flex flex-wrap justify-between gap-2 pt-1">
				{#if e.dia.ajuste}
					<button type="button" onclick={restaurarDia} class="px-3 py-2 rounded-lg text-sm text-slate-600 hover:bg-slate-50 border border-slate-200"><i class="fas fa-rotate-left"></i> Volver al huellero</button>
				{:else}<span></span>{/if}
				<div class="flex gap-2">
					<button type="button" onclick={() => (edicion = null)} class="px-4 py-2 rounded-lg border border-slate-200 text-sm">Cancelar</button>
					<button type="button" onclick={guardarDia} disabled={guardandoDia} class="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold disabled:opacity-40">{guardandoDia ? 'Guardando…' : 'Guardar'}</button>
				</div>
			</div>
		</div>
	</div>
{/if}

<!-- Feriados -->
{#if feriadosAbierto && obra}
	<div class="fixed inset-0 z-[120] flex items-end sm:items-center justify-center bg-slate-900/50 p-0 sm:p-4" role="dialog" aria-modal="true" aria-label="Configurar feriado">
		<div class="w-full sm:max-w-md bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl p-5 flex flex-col gap-3">
			<h2 class="text-lg font-bold text-slate-800">Configurar feriado</h2>
			<p class="text-xs text-slate-500">Un feriado reconoce la jornada del día a cada trabajador que lo tenga en su horario (salvo que edites ese día).</p>
			{#if datos?.feriados.length}
				<ul class="flex flex-col gap-1">
					{#each datos.feriados as f (f.id_feriado)}
						<li class="flex items-center justify-between gap-2 text-sm rounded-lg bg-sky-50 border border-sky-100 px-3 py-1.5">
							<span>{ddmm(f.fecha)} · {f.descripcion ?? 'Feriado'} <span class="text-xs text-slate-500">({f.id_centro_costo ? 'esta obra' : 'todas las obras'})</span></span>
							<button type="button" onclick={() => borrarFeriado(f)} class="text-rose-600 text-xs hover:underline">Quitar</button>
						</li>
					{/each}
				</ul>
			{:else}
				<p class="text-sm text-slate-400">No hay feriados en esta semana.</p>
			{/if}
			<div class="grid grid-cols-2 gap-2">
				<label class="flex flex-col gap-1 text-sm font-medium text-slate-700">Fecha
					<input type="date" bind:value={feFecha} min={fechas[0]} max={fechas[6]} class="px-3 py-2 border border-slate-200 rounded-xl text-sm font-normal" />
				</label>
				<label class="flex flex-col gap-1 text-sm font-medium text-slate-700">Descripción
					<input type="text" bind:value={feDescripcion} maxlength="100" placeholder="Ej.: Todos los Santos" class="px-3 py-2 border border-slate-200 rounded-xl text-sm font-normal" />
				</label>
			</div>
			<label class="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" bind:checked={feTodas} /> Para todas las obras (feriado nacional)</label>
			<div class="flex justify-end gap-2">
				<button type="button" onclick={() => (feriadosAbierto = false)} class="px-4 py-2 rounded-lg border border-slate-200 text-sm">Cerrar</button>
				<button type="button" onclick={nuevoFeriado} class="px-4 py-2 rounded-lg bg-sky-600 text-white text-sm font-semibold">Agregar feriado</button>
			</div>
		</div>
	</div>
{/if}
