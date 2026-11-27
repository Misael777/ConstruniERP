<script lang="ts">
	/**
	 * Tareo semanal por obra (RRHH → Asistencia → Tareo → Obra; pedido del cliente con imagen de referencia, 06/11/2026).
	 * El residente revisa los días de cada trabajador según el huellero, corrige días (Editar día), marca feriados, agrega
	 * bonos y elige la Fecha CxP. Cálculo y datos: tareo.service.ts.
	 *
	 * Tickets #118/#119 (24/11/2026):
	 * - Vista REAL: cada trabajador queda "Pendiente" hasta que su JEFE INMEDIATO (Personal) o un administrador lo aprueba.
	 *   Ya no hay botones de envío por fila: se seleccionan y se envían juntos, y solo lo aprobado va a Cuentas por Pagar
	 *   (quien tiene aprobar_tareo envía). Si el total cambia después de aprobar, vuelve a pedir aprobación.
	 *   El jefe sin permiso de envío ve solo a sus trabajadores, su asistencia, el monto y Aprobar; la Fecha CxP y lo
	 *   enviado quedan ocultos tras el ojo.
	 * - Vista PROYECCIÓN: días registrados hasta hoy + días previstos según el horario, total proyectado, fondo separado
	 *   y reserva de pago (cuota "Proyección de planilla" en CxP con la fecha elegida).
	 * - #118 rechazado (26/11/2026, maqueta de la clienta): la Proyección también proyecta al PERSONAL. Requerimientos de
	 *   personal por cargo (requeridos, asignados, faltantes, costo estimado y aptitudes requeridas), por obra o por semana
	 *   según elija cada obra; los trabajadores se agrupan por cargo y muestran si cumplen las aptitudes (ficha de
	 *   Personal). Presupuesto disponible escrito a mano, junto al saldo real de la obra, y Saldo disponible.
	 */
	import { onMount } from 'svelte';
	import { supabase } from '$lib/supabaseClient';
	import { toast } from '$lib/stores/toast';
	import { confirmar } from '$lib/stores/confirmDialog.svelte';
	import { hasPermiso, isAdmin, permisosState } from '$lib/stores/permisos.svelte';
	import { describeError } from '$lib/shared/describeError';
	import { formatCurrency } from '$lib/shared/fieldConfig';
	import { DIAS_SEMANA } from '$lib/modules/personal/services/horarios.service';
	import { nombreCompleto, hoyLima, etiquetaMonto } from '$lib/modules/personal/services/personal.service';
	import { sumarDias, duracion } from '../services/asistencia.service';
	import SelectConSaldo from '$lib/shared/components/SelectConSaldo.svelte';
	import EditarDiaTareo from './EditarDiaTareo.svelte';
	import RequerimientoModal from './RequerimientoModal.svelte';
	import { getSaldosVigentesCentroCosto } from '$lib/modules/centro-costos/services/centroCostos.service';
	import {
		ESTADOS_CELDA,
		ORIGENES,
		lunesDe,
		getObrasTareo,
		cargarTareo,
		agregarFeriado,
		quitarFeriado,
		guardarTrabajador,
		enviarTareo,
		aprobarTareo,
		guardarFondo,
		reservarTareo,
		aprobacionDe,
		estaAprobado,
		proyectarFila,
		pagoPlanificadoFila,
		guardarControlTareo,
		cuentasBancoTareo,
		liberarEnviosSinPago,
		proyectarPlanillas,
		exportarTareoXLSX,
		cargarPlanTareo,
		guardarModoRequerimiento,
		guardarRequerimiento,
		eliminarRequerimiento,
		copiarRequerimientosSemanaAnterior,
		guardarPresupuesto,
		catalogoAptitudes,
		cumpleAptitudes,
		mismoTexto,
		type PlanTareo,
		type RequerimientoTareo,
		type ModoRequerimiento,
		type ObraTareo,
		type FilaTareo,
		type DiaTareo,
		type FeriadoTareo,
		type DatosTareo,
		type EstadoAprobacion,
		textoDias
	} from '../services/tareo.service';

	const hoy = hoyLima();
	const CLAVE_OBRA = 'construni_tareo_obra';
	/** Envía a CxP, edita días, bonos, Fecha CxP y feriados (permiso aprobar_tareo; el administrador también). */
	const puedeEnviar = hasPermiso('aprobar_tareo');
	const esAdmin = isAdmin();
	const usuario = () => permisosState.userName || null;

	let obras = $state<ObraTareo[]>([]);
	let idObra = $state('');
	let lunes = $state(lunesDe(hoy));
	let datos = $state<DatosTareo | null>(null);
	let cargando = $state(false);
	let enviando = $state(false);
	let vista = $state<'real' | 'proyeccion'>('real');

	const obra = $derived(obras.find((o) => String(o.id_centro_costo) === idObra) ?? null);
	const fechas = $derived(Array.from({ length: 7 }, (_, i) => sumarDias(lunes, i)));

	// ── Jefe inmediato (#119) ──
	const esJefeDe = (f: FilaTareo) => permisosState.empleadoId != null && f.personal.id_jefe_inmediato === permisosState.empleadoId;
	const puedeAprobarFila = (f: FilaTareo) => esAdmin || esJefeDe(f);
	/** Sin permiso de envío y jefe de alguien: ve solo a sus trabajadores. */
	const soloMios = $derived(!puedeEnviar && !esAdmin && (datos?.filas ?? []).some(esJefeDe));
	const todasFilas = $derived((datos?.filas ?? []).filter((f) => !soloMios || esJefeDe(f)));
	/** El jefe (sin permiso de envío) no ve Fecha CxP ni lo enviado, salvo que lo muestre con el ojo. */
	let verPago = $state(false);
	const mostrarPago = $derived(puedeEnviar || verPago);

	// Filtro por referente / subcontratista (a pedido del usuario): la tabla, los totales, la exportación y el envío se
	// limitan a los trabajadores de ese referente. '' = todos.
	const SIN_REFERENTE = '__sin__';
	let referente = $state('');
	const nombreRef = (f: FilaTareo) => (f.personal.referente_nombre ?? '').trim();
	const opcionesReferente = $derived.by(() => {
		const nombres = [...new Set(todasFilas.map(nombreRef).filter(Boolean))].sort((a, b) => a.localeCompare(b));
		const cargo = (n: string) => todasFilas.find((f) => nombreRef(f) === n)?.personal.referente_cargo;
		return [
			{ value: '', label: 'Todos los subcontratistas' },
			...nombres.map((n) => ({ value: n, label: cargo(n) ? `${n} · ${cargo(n)}` : n })),
			...(todasFilas.some((f) => !nombreRef(f)) ? [{ value: SIN_REFERENTE, label: 'Sin subcontratista / referente' }] : [])
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

	// ── Lo que se escribe por fila (bonos, Fecha CxP, monto a enviar) ──
	let bonos = $state<Record<number, string>>({});
	let fechaCxp = $state<Record<number, string>>({});
	let monto = $state<Record<number, string>>({});
	let seleccion = $state<Record<number, boolean>>({});
	let fechaComun = $state('');

	const num = (v: string | undefined) => {
		const n = Number(String(v ?? '').replace(',', '.'));
		return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0;
	};
	const totalDe = (f: FilaTareo) => Math.round((f.subtotal + f.extrasMonto + num(bonos[f.personal.id_personal])) * 100) / 100;
	const pendienteDe = (f: FilaTareo) => Math.max(Math.round((totalDe(f) - f.enviado) * 100) / 100, 0);
	const montoDe = (f: FilaTareo) => num(monto[f.personal.id_personal]);
	const aprob = (f: FilaTareo): EstadoAprobacion => aprobacionDe(f, totalDe(f));
	const aprobada = (f: FilaTareo) => estaAprobado(aprob(f));
	/** Se puede marcar para aprobar (jefe/admin, sin aprobar) o para enviar (permiso de envío, aprobado con saldo). */
	const seleccionable = (f: FilaTareo) => (puedeAprobarFila(f) && !aprobada(f) && totalDe(f) > 0) || (puedeEnviar && aprobada(f) && pendienteDe(f) > 0);

	const totalSemana = $derived(filas.reduce((t, f) => t + totalDe(f), 0));
	const totalEnviado = $derived(filas.reduce((t, f) => t + f.enviado, 0));
	const saldoPendiente = $derived(filas.reduce((t, f) => t + pendienteDe(f), 0));
	const seleccionados = $derived(filas.filter((f) => seleccion[f.personal.id_personal]));
	const totalSeleccionado = $derived(seleccionados.reduce((t, f) => t + (aprobada(f) ? montoDe(f) : totalDe(f)), 0));
	const marcables = $derived(filas.filter(seleccionable));
	const todosMarcados = $derived(marcables.length > 0 && marcables.every((f) => seleccion[f.personal.id_personal]));
	const porRevisar = $derived(filas.reduce((t, f) => t + f.porRevisar, 0));
	const pendientesAprobacion = $derived(filas.filter((f) => !aprobada(f) && totalDe(f) > 0).length);
	const porAprobarSel = $derived(seleccionados.filter((f) => puedeAprobarFila(f) && !aprobada(f) && totalDe(f) > 0));
	const porEnviarSel = $derived(seleccionados.filter((f) => aprobada(f) && pendienteDe(f) > 0));
	const aprobadosConSaldo = $derived(filas.filter((f) => aprobada(f) && pendienteDe(f) > 0));
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
		selProy = {};
	}

	async function cargar() {
		if (!obra) return;
		cargando = true;
		try {
			datos = await cargarTareo(supabase, obra.id_centro_costo, lunes, hoy);
			iniciarFormulario(datos.filas);
			fondoTexto = datos.semana?.fondo_separado != null ? datos.semana.fondo_separado.toFixed(2) : '';
			fechaReserva = sumarDias(lunes, 5);
			void cargarPlan();
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
		if (!puedeEnviar || !obra) return;
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
		if (v) for (const f of marcables) s[f.personal.id_personal] = true;
		seleccion = s;
	}

	// ── Aprobación del jefe inmediato (#119) ──
	let aprobando = $state(false);
	async function aprobar(lista: FilaTareo[]) {
		if (!obra || aprobando) return;
		const items = lista.filter((f) => puedeAprobarFila(f) && !aprobada(f) && totalDe(f) > 0);
		if (!items.length) {
			toast.error('No hay trabajadores por aprobar en la selección.');
			return;
		}
		const sinRevisar = items.filter((f) => f.porRevisar).length;
		const suma = items.reduce((t, f) => t + totalDe(f), 0);
		const ok = await confirmar({
			title: 'Aprobar tareo',
			message: `Se aprobará el tareo de ${items.length} trabajador${items.length === 1 ? '' : 'es'} por ${formatCurrency(suma)} (semana ${tituloSemana}). Si después cambia la asistencia o los bonos, habrá que aprobarlo de nuevo.${sinRevisar ? ` Ojo: ${sinRevisar} tiene${sinRevisar === 1 ? '' : 'n'} días sin marca de salida sin revisar (no se pagan).` : ''}`,
			confirmLabel: 'Aprobar',
			danger: false
		});
		if (!ok) return;
		aprobando = true;
		try {
			const n = await aprobarTareo(supabase, obra.id_centro_costo, lunes, items.map((f) => ({ fila: f, total: totalDe(f) })));
			toast.success(`Tareo aprobado: ${n} trabajador${n === 1 ? '' : 'es'}.`);
			await cargar();
		} catch (err) {
			toast.error(`No se pudo aprobar. ${describeError(err)}`);
		} finally {
			aprobando = false;
		}
	}

	// ── Envío a Cuentas por Pagar: solo lo aprobado (#118) ──
	async function enviar(lista: FilaTareo[], completo = false) {
		if (!obra || enviando) return;
		const sinAprobar = lista.filter((f) => !aprobada(f) && pendienteDe(f) > 0);
		const envios = lista
			.filter(aprobada)
			.map((f) => {
				const id = f.personal.id_personal;
				return { fila: { ...f, bonos: num(bonos[id]), total: totalDe(f) }, monto: completo ? pendienteDe(f) : montoDe(f), fechaCxp: fechaCxp[id] || fechaComun || sumarDias(lunes, 6) };
			})
			.filter((e) => e.monto > 0);
		if (!envios.length) {
			toast.error(sinAprobar.length ? 'Lo seleccionado aún no tiene la aprobación del jefe inmediato.' : 'No hay montos por enviar.');
			return;
		}
		const excede = envios.find((e) => e.monto - pendienteDe(e.fila) > 0.005);
		if (excede) {
			toast.error(`${nombreCompleto(excede.fila.personal)}: el monto a enviar supera lo pendiente (${formatCurrency(pendienteDe(excede.fila))}).`);
			return;
		}
		const suma = envios.reduce((t, e) => t + e.monto, 0);
		// Ticket #133: cada trabajador va a la planilla de SU periodicidad (semanal / quincenal / mensual).
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
			message: `Se enviarán ${formatCurrency(suma)} de ${envios.length} trabajador${envios.length === 1 ? '' : 'es'} aprobado${envios.length === 1 ? '' : 's'} a Cuentas por Pagar (proveedor "Planilla de personal"). ${porPlanilla.size > 1 ? `Van a ${porPlanilla.size} planillas distintas según cada cuánto cobra el trabajador: ` : ''}${detallePlanillas}.${sinAprobar.length ? ` ${sinAprobar.length} seleccionado${sinAprobar.length === 1 ? '' : 's'} sin aprobar no se envía${sinAprobar.length === 1 ? '' : 'n'}.` : ''}`,
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
			const m = await liberarEnviosSinPago(supabase, obra.id_centro_costo, lunes);
			toast.success(`Liberado ${formatCurrency(m)}: ya se puede volver a enviar.`);
			await cargar();
		} catch (err) {
			toast.error(`No se pudo liberar. ${describeError(err)}`);
		} finally {
			liberando = false;
		}
	}

	// ── Proyección (#118) ──
	let selProy = $state<Record<number, boolean>>({});
	let fondoTexto = $state('');
	let fechaReserva = $state('');
	let reservando = $state(false);
	let verReservas = $state(false);

	// ── Requerimientos de personal, aptitudes y presupuesto (#118, 26/11/2026) ──
	let plan = $state<PlanTareo | null>(null);
	let saldoObra = $state<number | null>(null);
	let presupuestoTexto = $state('');
	// Ticket #118 (27/11/2026): Control presupuestal y Control financiero (fecha de asignación, fecha de reserva, cuenta).
	let presupuestoFecha = $state('');
	let fondoFecha = $state('');
	let idCuentaFondo = $state('');
	let cuentasFondo = $state<{ id: number; nombre: string; detalle: string }[]>([]);
	let aptitudesSugeridas = $state<string[]>([]);
	let reqEditando = $state<RequerimientoTareo | null>(null);
	let guardandoReq = $state(false);
	let gruposCerrados = $state<Record<string, boolean>>({});
	const r2 = (n: number) => Math.round(n * 100) / 100;

	async function cargarPlan() {
		if (!obra) return;
		const id = obra.id_centro_costo;
		const semana = lunes;
		const [p, saldos, apt] = await Promise.all([
			cargarPlanTareo(supabase, id, semana),
			getSaldosVigentesCentroCosto(supabase, [id]),
			catalogoAptitudes(supabase).catch(() => [] as string[])
		]);
		if (obra?.id_centro_costo !== id || lunes !== semana) return;
		plan = p;
		saldoObra = saldos[id]?.saldo ?? null;
		aptitudesSugeridas = apt;
		presupuestoTexto = p.presupuesto != null ? p.presupuesto.toFixed(2) : '';
		presupuestoFecha = p.presupuestoFecha ?? '';
		fondoFecha = p.fondoFecha ?? '';
		idCuentaFondo = p.idCuentaBanco != null ? String(p.idCuentaBanco) : '';
		if (!cuentasFondo.length) cuentasFondo = await cuentasBancoTareo(supabase).catch(() => []);
	}

	/** Guarda fecha de asignación, fecha de reserva y cuenta bancaria del fondo (las tres juntas). */
	async function guardarControl() {
		if (!obra || !puedeEnviar) return;
		try {
			await guardarControlTareo(supabase, obra.id_centro_costo, lunes, {
				presupuestoFecha: presupuestoFecha || null,
				fondoFecha: fondoFecha || null,
				idCuentaBanco: idCuentaFondo ? Number(idCuentaFondo) : null
			});
			toast.success('Guardado.');
		} catch (err) {
			toast.error(`No se pudo guardar. ${describeError(err)}`);
		}
	}

	const cargoDe = (f: FilaTareo) => (f.personal.cargo ?? f.personal.categoria ?? '').trim();
	type ItemProy = (typeof proy)[number];
	interface GrupoProy {
		clave: string;
		req: RequerimientoTareo | null;
		titulo: string;
		items: ItemProy[];
	}
	/** Trabajadores agrupados por requerimiento (mismo cargo); el resto va en "Otros cargos". */
	const grupos = $derived.by((): GrupoProy[] => {
		const reqs = plan?.requerimientos ?? [];
		const usados = new Set<number>();
		const res: GrupoProy[] = reqs.map((r, i) => {
			const items = proy.filter((x) => !usados.has(x.f.personal.id_personal) && mismoTexto(cargoDe(x.f), r.cargo));
			for (const x of items) usados.add(x.f.personal.id_personal);
			return { clave: `r${r.id_requerimiento ?? i}`, req: r, titulo: r.cargo, items };
		});
		const otros = proy.filter((x) => !usados.has(x.f.personal.id_personal));
		if (otros.length || !res.length) res.push({ clave: 'otros', req: null, titulo: reqs.length ? 'Otros cargos (sin requerimiento)' : 'Personal de la obra', items: otros });
		return res;
	});
	const totalGrupo = (g: GrupoProy) => r2(g.items.reduce((t, x) => t + totalProyectadoDe(x), 0));
	/** Lo proyectado de los asignados + las vacantes × tarifa (la de referencia o el promedio) × días previstos. */
	function costoEstimado(g: GrupoProy): number {
		const asignado = totalGrupo(g);
		if (!g.req) return asignado;
		const faltan = Math.max(g.req.cantidad - g.items.length, 0);
		if (!faltan) return asignado;
		const tarifa = g.req.tarifa_dia ?? (g.items.length ? g.items.reduce((t, x) => t + x.f.tarifaDia, 0) / g.items.length : 0);
		const dias = g.items.length ? g.items.reduce((t, x) => t + x.p.dias.reduce((s, d) => s + d.fraccion, 0), 0) / g.items.length : 6;
		return r2(asignado + faltan * tarifa * dias);
	}
	const costoRequerimientos = $derived(grupos.filter((g) => g.req).reduce((t, g) => t + costoEstimado(g), 0));
	const presupuesto = $derived(presupuestoTexto.trim() === '' ? null : num(presupuestoTexto));
	const saldoDisponible = $derived.by(() => (presupuesto == null ? null : r2(presupuesto - totProy.total)));
	// Vista Real: lo previsto según el horario (sin la asistencia) y el saldo del presupuesto con lo real al corte.
	const pagoOriginal = $derived(r2(filas.reduce((t, f) => t + pagoPlanificadoFila(f, num(bonos[f.personal.id_personal])), 0)));
	const saldoAlCorte = $derived(presupuesto == null ? null : r2(presupuesto - totalSemana));
	const cuentaFondo = $derived(cuentasFondo.find((c) => String(c.id) === idCuentaFondo) ?? null);

	async function guardarPresupuestoSemana() {
		if (!obra || !puedeEnviar || !plan?.disponible) return;
		const nuevo = presupuesto;
		if (nuevo === plan.presupuesto) return;
		try {
			await guardarPresupuesto(supabase, obra.id_centro_costo, lunes, nuevo);
			plan.presupuesto = nuevo;
			toast.success('Presupuesto guardado.');
		} catch (err) {
			toast.error(`No se pudo guardar el presupuesto. ${describeError(err)}`);
		}
	}
	function usarSaldoObra() {
		if (saldoObra == null) return;
		presupuestoTexto = Math.max(saldoObra, 0).toFixed(2);
		void guardarPresupuestoSemana();
	}

	function nuevoRequerimiento() {
		if (!obra || !plan) return;
		reqEditando = { id_centro_costo: obra.id_centro_costo, semana_inicio: plan.modo === 'semana' ? lunes : null, cargo: '', cantidad: 1, aptitudes: [], tarifa_dia: null };
	}
	async function guardarReq(r: RequerimientoTareo) {
		guardandoReq = true;
		try {
			await guardarRequerimiento(supabase, r, usuario());
			reqEditando = null;
			toast.success('Requerimiento guardado.');
			await cargarPlan();
		} catch (err) {
			toast.error(`No se pudo guardar el requerimiento. ${describeError(err)}`);
		} finally {
			guardandoReq = false;
		}
	}
	async function borrarReq(r: RequerimientoTareo) {
		if (!r.id_requerimiento) return;
		const ok = await confirmar({ title: 'Quitar requerimiento', message: `Se quitará el requerimiento de ${r.cantidad} × ${r.cargo}. Los trabajadores no cambian.`, confirmLabel: 'Quitar', danger: true });
		if (!ok) return;
		try {
			await eliminarRequerimiento(supabase, r.id_requerimiento);
			await cargarPlan();
		} catch (err) {
			toast.error(`No se pudo quitar. ${describeError(err)}`);
		}
	}
	async function cambiarModo(m: ModoRequerimiento) {
		if (!obra || !plan || plan.modo === m) return;
		try {
			await guardarModoRequerimiento(supabase, obra.id_centro_costo, m, usuario());
			toast.success(m === 'obra' ? 'Los requerimientos de esta obra valen para todas las semanas.' : 'Los requerimientos de esta obra se registran semana por semana.');
			await cargarPlan();
		} catch (err) {
			toast.error(`No se pudo cambiar. ${describeError(err)}`);
		}
	}
	async function copiarAnterior() {
		if (!obra) return;
		try {
			const n = await copiarRequerimientosSemanaAnterior(supabase, obra.id_centro_costo, lunes, usuario());
			if (n) toast.success(`Se copiaron ${n} requerimiento${n === 1 ? '' : 's'} de la semana anterior.`);
			else toast.info('La semana anterior no tiene requerimientos.');
			await cargarPlan();
		} catch (err) {
			toast.error(`No se pudo copiar. ${describeError(err)}`);
		}
	}
	function verPersonal(g: GrupoProy) {
		gruposCerrados[g.clave] = false;
		setTimeout(() => document.getElementById(`grupo-${g.clave}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
	}
	const proy = $derived(filas.map((f) => ({ f, p: proyectarFila(f, hoy) })));
	const totalProyectadoDe = (x: { f: FilaTareo; p: ReturnType<typeof proyectarFila> }) => Math.round((x.p.acumulado + x.p.porCompletar + x.f.extrasMonto + num(bonos[x.f.personal.id_personal])) * 100) / 100;
	const totProy = $derived({
		acumulado: proy.reduce((t, x) => t + x.p.acumulado, 0),
		porCompletar: proy.reduce((t, x) => t + x.p.porCompletar, 0),
		bonos: proy.reduce((t, x) => t + num(bonos[x.f.personal.id_personal]), 0),
		total: proy.reduce((t, x) => t + totalProyectadoDe(x), 0)
	});
	const fondo = $derived(num(fondoTexto));
	const faltaSeparar = $derived(Math.max(Math.round((totProy.total - fondo) * 100) / 100, 0));
	const proySel = $derived(proy.filter((x) => selProy[x.f.personal.id_personal]));
	const todosProy = $derived(proy.length > 0 && proy.every((x) => selProy[x.f.personal.id_personal]));
	const conReserva = $derived(filas.filter((f) => f.reservaMonto));
	const corte = $derived(hoy < fechas[0] ? null : hoy > fechas[6] ? fechas[6] : hoy);

	async function guardarFondoSemana() {
		if (!puedeEnviar || !obra) return;
		const actual = datos?.semana?.fondo_separado ?? null;
		const nuevo = fondoTexto.trim() === '' ? null : num(fondoTexto);
		if (nuevo === actual) return;
		try {
			await guardarFondo(supabase, obra.id_centro_costo, lunes, nuevo);
			if (datos) datos.semana = { ...(datos.semana ?? { estado: 'borrador', aprobado_por: null, aprobado_en: null, fondo_separado: null }), fondo_separado: nuevo };
			toast.success('Fondo separado guardado.');
		} catch (err) {
			toast.error(`No se pudo guardar el fondo. ${describeError(err)}`);
		}
	}

	async function programarReserva() {
		if (!obra || reservando) return;
		if (!fechaReserva) {
			toast.error('Elige la fecha de la reserva para pago.');
			return;
		}
		const items = proySel.map((x) => ({ idPersonal: x.f.personal.id_personal, monto: totalProyectadoDe(x) })).filter((i) => i.monto > 0);
		if (!items.length) {
			toast.error('Selecciona trabajadores con monto proyectado.');
			return;
		}
		const suma = items.reduce((t, i) => t + i.monto, 0);
		const ok = await confirmar({
			title: 'Programar reserva',
			message: `Se reservarán ${formatCurrency(suma)} de ${items.length} trabajador${items.length === 1 ? '' : 'es'} para el ${ddmm(fechaReserva)}/${fechaReserva.slice(0, 4)} en la CxP de la planilla (cuota "Proyección de planilla"). Al aprobar el tareo real se ajusta esta reserva sin duplicar el compromiso, y al enviarlo sale de la proyección.`,
			confirmLabel: 'Reservar',
			danger: false
		});
		if (!ok) return;
		reservando = true;
		try {
			await reservarTareo(supabase, obra.id_centro_costo, lunes, items, fechaReserva, usuario());
			toast.success(`Reserva programada: ${formatCurrency(suma)}.`);
			await cargar();
		} catch (err) {
			toast.error(`No se pudo programar la reserva. ${describeError(err)}`);
		} finally {
			reservando = false;
		}
	}

	async function quitarReserva(f: FilaTareo) {
		if (!obra) return;
		try {
			await reservarTareo(supabase, obra.id_centro_costo, lunes, [{ idPersonal: f.personal.id_personal, monto: 0 }], f.reservaFecha ?? sumarDias(lunes, 6), usuario());
			toast.success('Reserva quitada.');
			await cargar();
		} catch (err) {
			toast.error(`No se pudo quitar la reserva. ${describeError(err)}`);
		}
	}

	// ── Editar día / diagnóstico ──
	let edicion = $state<{ fila: FilaTareo; dia: DiaTareo } | null>(null);
	let diag = $state<FilaTareo | null>(null);
	const marcasDe = (f: FilaTareo) => datos?.diagnostico?.[f.personal.id_personal] ?? [];
	const noCuentan = (f: FilaTareo) => marcasDe(f).filter((m) => !m.cuenta).length;
	const MODOS: Record<number, string> = { 1: 'Huella', 15: 'Rostro', 0: 'Clave', 3: 'Clave', 4: 'Tarjeta' };

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
	const fr = (x: number) => (x === 1 ? '1' : x === 0.5 ? '½' : x ? String(x) : '0');
</script>

{#snippet celda(f: FilaTareo, d: DiaTareo)}
	{@const est = ESTADOS_CELDA[d.estado]}
	{@const editable = (puedeEnviar || puedeAprobarFila(f)) && d.estado !== 'por_venir' && d.estado !== 'fuera_contrato'}
	<button
		type="button"
		onclick={() => editable && (edicion = { fila: f, dia: d })}
		disabled={!editable}
		title={`${DIAS_SEMANA[d.dia - 1]} ${ddmm(d.fecha)} · ${est.texto || 'Por venir'}${d.origen ? ` · ${ORIGENES[d.origen].texto}` : ''}${d.ajuste?.observacion ? ` · ${d.ajuste.observacion}` : ''}${editable ? ' — clic para editar' : ''}`}
		class={`w-full min-w-[46px] h-12 rounded-lg border px-1 py-1 flex flex-col items-center justify-center gap-0.5 text-center transition-shadow ${est.clase} ${editable ? 'hover:shadow-md hover:ring-1 hover:ring-blue-300 cursor-pointer' : 'cursor-default'}`}
	>
		<!-- Ticket #132: se paga por día o medio día; lo grande es "1" o "½" y las horas van debajo, chicas. -->
		<span class="text-base font-extrabold leading-none">{d.fraccion ? (d.fraccion === 1 ? '1' : '½') : d.estado === 'falta' ? 'F' : d.estado === 'por_venir' ? '' : '—'}</span>
		{#if d.minutos}<span class="text-[9px] leading-none text-slate-500 tabular-nums">{horas(d.minutos)}</span>{/if}
		<span class="flex items-center gap-1 text-[9px] leading-none">
			{#if d.origen}<i class={`fas ${ORIGENES[d.origen].icono} ${ORIGENES[d.origen].color}`}></i>{/if}
			{#if d.extra}<span class="font-bold text-violet-700" title="Horas extra registradas por el jefe">+{horas(d.extra.minutos)}</span>{:else if d.estado !== 'asistio' && d.estado !== 'por_venir'}<span class="truncate max-w-[52px]">{est.texto}</span>{/if}
		</span>
	</button>
{/snippet}

{#snippet chipAprobacion(f: FilaTareo)}
	{@const e = aprob(f)}
	<div class="flex flex-col items-center gap-1 min-w-[96px]">
		{#if e === 'aprobado' || e === 'previo'}
			<span class="inline-flex flex-col items-center rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-1 text-emerald-700" title={f.aprobadoEn ? `Aprobado el ${new Date(f.aprobadoEn).toLocaleString('es-PE')}` : 'Enviado antes de que existiera la aprobación'}>
				<span class="text-xs font-bold"><i class="fas fa-circle-check"></i> Aprobado</span>
				<span class="text-[10px] text-emerald-700/80 truncate max-w-[120px]">{e === 'previo' ? 'enviado antes' : (f.aprobadoPor ?? 'Jefe inmediato')}</span>
			</span>
		{:else if totalDe(f) <= 0}
			<span class="text-[11px] text-slate-300">—</span>
		{:else}
			<span class={`text-xs font-semibold ${e === 'cambio' ? 'text-amber-700' : 'text-orange-600'}`} title={e === 'cambio' ? `Se aprobó ${formatCurrency(f.aprobadoMonto ?? 0)}; el total cambió` : 'Falta la aprobación del jefe inmediato'}>
				{e === 'cambio' ? 'Cambió: aprobar de nuevo' : 'Pendiente'}
			</span>
			{#if puedeAprobarFila(f)}
				<button type="button" onclick={() => aprobar([f])} disabled={aprobando} class="px-2.5 py-1 rounded-lg bg-orange-500 text-white text-[11px] font-semibold hover:bg-orange-600 disabled:opacity-40">Aprobar tareo</button>
			{/if}
		{/if}
	</div>
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
					<label for="tareo-referente" class="text-sm font-semibold text-violet-700 flex items-center gap-1.5"><i class="fas fa-user-tie text-violet-500 text-xs"></i> Subcontratista asociado</label>
					<SelectConSaldo id="tareo-referente" value={referente} options={opcionesReferente} placeholder="Todos los subcontratistas" encabezadoNombre="Subcontratista o referente" claseBoton={cajaColor('violet')} disabled={!obra || !todasFilas.length} onchange={(v) => (referente = v)} />
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
				{#if puedeEnviar}
					<button type="button" onclick={() => { feFecha = ''; feDescripcion = ''; feTodas = false; feriadosAbierto = true; }} disabled={!obra} class="px-3 py-2 rounded-xl border border-slate-200 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-40 flex items-center gap-2"><i class="fas fa-umbrella-beach text-sky-600"></i> Configurar feriado</button>
				{/if}
				<button type="button" onclick={exportar} disabled={!obra || !filas.length} class="px-3 py-2 rounded-xl border border-slate-200 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-40 flex items-center gap-2"><i class="fas fa-file-excel text-emerald-600"></i> Exportar Excel</button>
			</div>
		</div>
		{#if obra}
			<div class="flex flex-wrap items-end gap-3 border-t border-slate-100 pt-3">
				{#if puedeEnviar}
					<div class="flex rounded-xl border border-slate-200 bg-white p-0.5 text-sm" role="tablist" aria-label="Vista del tareo">
						<button type="button" role="tab" aria-selected={vista === 'real'} onclick={() => (vista = 'real')} class={`px-4 py-1.5 rounded-lg font-semibold ${vista === 'real' ? 'bg-orange-500 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>Real</button>
						<button type="button" role="tab" aria-selected={vista === 'proyeccion'} onclick={() => (vista = 'proyeccion')} class={`px-4 py-1.5 rounded-lg font-semibold ${vista === 'proyeccion' ? 'bg-orange-500 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>Proyección</button>
					</div>
				{/if}
				{#if vista === 'real' && puedeEnviar}
					<div class="flex flex-col gap-1.5">
						<label for="tareo-fecha-comun" class="text-xs font-medium text-slate-600">Fecha común CxP</label>
						<input id="tareo-fecha-comun" type="date" bind:value={fechaComun} class="px-3 py-1.5 border border-slate-200 rounded-lg text-sm" />
					</div>
					<button type="button" onclick={aplicarFechaComun} class="px-3 py-1.5 rounded-lg bg-orange-500 text-white text-sm font-semibold hover:bg-orange-600">
						Aplicar a {seleccionados.length ? `seleccionados (${seleccionados.length})` : 'todos'}
					</button>
				{/if}
				{#if vista === 'real' && !puedeEnviar}
					<button type="button" onclick={() => (verPago = !verPago)} class="px-3 py-1.5 rounded-lg border border-slate-200 text-sm text-slate-600 hover:bg-slate-50 flex items-center gap-2" title="Fecha de CxP y lo enviado">
						<i class={`fas ${verPago ? 'fa-eye-slash' : 'fa-eye'}`}></i> {verPago ? 'Ocultar' : 'Ver'} datos de pago
					</button>
				{/if}
				{#if vista === 'proyeccion' && corte}
					<span class="text-sm text-slate-600 rounded-lg border border-slate-200 px-3 py-1.5"><i class="fas fa-calendar-day text-slate-400"></i> Corte de asistencia: <b>{DIAS_SEMANA[(new Date(corte + 'T12:00:00Z').getUTCDay() + 6) % 7].toLowerCase()} {ddmm(corte)}</b></span>
				{/if}
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
			{#if vista === 'real' && pendientesAprobacion}
				<span class="rounded-lg bg-orange-50 border border-orange-200 px-2.5 py-0.5 font-semibold text-orange-700">Pendientes de aprobación: {pendientesAprobacion}</span>
			{/if}
			{#if vista === 'real'}<span class="text-xs text-blue-700"><i class="fas fa-circle-info"></i> Aprobación a cargo del jefe inmediato.</span>{/if}
			{#if soloMios}<span class="text-xs text-slate-500">Ves solo a los trabajadores de los que eres jefe inmediato.</span>{/if}
			{#if porRevisar}<span class="text-orange-700"><i class="fas fa-triangle-exclamation"></i> {porRevisar} día{porRevisar === 1 ? '' : 's'} sin marca de salida por revisar</span>{/if}
			{#if cargando}<i class="fas fa-spinner fa-spin text-blue-500"></i>{/if}
		</div>

		{#if datos.enviadoSinPago > 0 && puedeEnviar}
			<div class="flex flex-wrap items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
				<i class="fas fa-triangle-exclamation"></i>
				<span class="flex-1 min-w-[200px]"><b>{formatCurrency(datos.enviadoSinPago)}</b> figuran como enviados, pero sus pagos se eliminaron de Cuentas por Pagar.</span>
				<button type="button" onclick={liberarSinPago} disabled={liberando} class="px-3 py-1.5 rounded-lg bg-amber-600 text-white text-xs font-semibold disabled:opacity-50">{liberando ? 'Liberando…' : 'Liberar para reenviar'}</button>
			</div>
		{/if}

		{#if !filas.length}
			<div class="bg-white border border-slate-100 rounded-2xl shadow-sm py-12 text-center text-sm text-slate-400">{todasFilas.length ? 'Ningún trabajador de esta obra tiene ese subcontratista o referente.' : 'Esta obra no tiene trabajadores activos ni marcas en la semana.'}</div>
		{:else if vista === 'proyeccion'}
			{@render vistaProyeccion()}
		{:else}
			<div class="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500 px-1">
				{#each Object.entries(ORIGENES) as [, o]}<span class="flex items-center gap-1.5"><i class={`fas ${o.icono} ${o.color}`}></i>{o.texto}</span>{/each}
				<span>· Se paga por día: 1 = día completo, ½ = medio día (las horas van debajo). {puedeEnviar ? 'Toca un día para corregirlo.' : ''}</span>
			</div>

			<!-- Escritorio: tabla -->
			<div class="hidden md:block bg-white border border-slate-100 rounded-2xl shadow-sm overflow-x-auto">
				<table class="w-full text-sm">
					<thead class="bg-slate-50 text-slate-600 text-xs">
						<tr>
							<th class="px-2 py-2 w-8"><input type="checkbox" checked={todosMarcados} disabled={!marcables.length} onchange={(e) => marcarTodos((e.currentTarget as HTMLInputElement).checked)} aria-label="Seleccionar todos" /></th>
							<th class="px-2 py-2 text-left min-w-[150px]">Trabajador</th>
							<th class="px-2 py-2 text-left">Subcontratista</th>
							{#each fechas as f, i}
								{@const fer = feriadoDe(f)}
								<th class={`px-1 py-2 text-center ${f === hoy ? 'text-blue-700' : ''}`}>
									<div>{DIAS_SEMANA[i].slice(0, 3)}</div>
									<div class="font-normal text-[11px]">{ddmm(f)}</div>
									{#if fer}<div class="text-[10px] text-sky-600 font-semibold" title={fer.descripcion ?? 'Feriado'}>Feriado</div>{/if}
								</th>
							{/each}
							<th class="px-2 py-2 text-right">Días</th>
							<th class="px-2 py-2 text-right">S/ día</th>
							<th class="px-2 py-2 text-right" title="Horas extra registradas por el jefe inmediato (por hora)">Horas extra</th>
							<th class="px-2 py-2 text-right">Bonos</th>
							<th class="px-2 py-2 text-right">Total</th>
							<th class="px-2 py-2 text-center">Aprobación</th>
							{#if mostrarPago}
								<th class="px-2 py-2 text-left">Fecha CxP</th>
								<th class="px-2 py-2 text-right">Monto a enviar</th>
							{/if}
						</tr>
					</thead>
					<tbody class="divide-y divide-slate-100">
						{#each filas as f (f.personal.id_personal)}
							{@const id = f.personal.id_personal}
							<tr class="align-middle">
								<td class="px-2 py-2 text-center"><input type="checkbox" bind:checked={seleccion[id]} disabled={!seleccionable(f)} aria-label={`Seleccionar ${nombreCompleto(f.personal)}`} /></td>
								<td class="px-2 py-2">
									<div class="font-medium text-slate-800">{nombreCompleto(f.personal)}</div>
									{@render botonMarcas(f)}
									<div class="text-[11px] text-slate-400">{f.personal.cargo ?? f.personal.categoria ?? ''}{f.personal.id_centro_costo !== obra.id_centro_costo ? ' · de otra obra' : ''}</div>
									{#if f.sinMonto}
										<div class="text-[11px] text-amber-700"><i class="fas fa-triangle-exclamation"></i> Sin monto de pago en Personal</div>
									{/if}
								</td>
								<td class="px-2 py-2 text-xs text-slate-600">{nombreRef(f) || '—'}</td>
								{#each f.dias as d (d.fecha)}<td class="px-0.5 py-2">{@render celda(f, d)}</td>{/each}
								<td class="px-2 py-2 text-right whitespace-nowrap"><div class="text-base font-bold text-slate-800">{textoDias(f.diasPagados)}</div><div class="text-[11px] text-slate-400 tabular-nums">{horas(f.minutos)} h</div></td>
								<td class="px-2 py-2 text-right text-xs text-slate-600 whitespace-nowrap" title={`${etiquetaMonto(f.personal.periodicidad_pago)} ${formatCurrency(Number(f.personal.monto_pago ?? 0))} · jornada ${duracion(f.jornadaMin)}`}>{f.sinMonto ? '—' : formatCurrency(f.tarifaDia)}</td>
								<td class="px-2 py-2 text-right whitespace-nowrap">{#if f.extrasMin}<div class="text-xs font-semibold text-violet-700">{formatCurrency(f.extrasMonto)}</div><div class="text-[11px] text-slate-400">{horas(f.extrasMin)} h</div>{:else}<span class="text-slate-300">—</span>{/if}</td>
								<td class="px-2 py-2 text-right">
									{#if puedeEnviar}
										<input type="text" inputmode="decimal" bind:value={bonos[id]} onblur={() => guardarFila(f)} placeholder="0.00" class="w-16 px-1.5 py-1 border border-slate-200 rounded-lg text-right text-xs" aria-label="Bonos" />
									{:else}{formatCurrency(f.bonos)}{/if}
								</td>
								<td class="px-2 py-2 text-right whitespace-nowrap">
									<div class="font-semibold text-slate-800">{formatCurrency(totalDe(f))}</div>
									{#if mostrarPago && f.enviado}<div class="text-[11px] text-emerald-700">Enviado {formatCurrency(f.enviado)}</div>{/if}
								</td>
								<td class="px-2 py-2 text-center">{@render chipAprobacion(f)}</td>
								{#if mostrarPago}
									<td class="px-2 py-2">
										{#if puedeEnviar}
											<input type="date" bind:value={fechaCxp[id]} onchange={() => guardarFila(f)} class="w-[118px] px-1 py-1 border border-slate-200 rounded-lg text-xs" aria-label="Fecha CxP" />
										{:else}{f.fechaCxp ? ddmm(f.fechaCxp) : '—'}{/if}
									</td>
									<td class="px-2 py-2 text-right">
										{#if puedeEnviar && aprobada(f) && pendienteDe(f) > 0}
											<input type="text" inputmode="decimal" bind:value={monto[id]} class="w-20 px-1.5 py-1 border border-slate-200 rounded-lg text-right text-xs" aria-label="Monto a enviar" />
											{#if montoDe(f) && montoDe(f) < pendienteDe(f)}<div class="text-[11px] text-amber-700">Queda {formatCurrency(pendienteDe(f) - montoDe(f))}</div>{/if}
										{:else if pendienteDe(f) <= 0 && f.enviado}
											<span class="text-[11px] text-emerald-700 font-semibold"><i class="fas fa-check"></i> Enviado</span>
										{:else if pendienteDe(f) > 0}
											<span class="text-xs text-slate-500 tabular-nums">{formatCurrency(pendienteDe(f))}</span>
										{:else}<span class="text-slate-300">—</span>{/if}
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
							<input type="checkbox" class="mt-1" bind:checked={seleccion[id]} disabled={!seleccionable(f)} aria-label={`Seleccionar ${nombreCompleto(f.personal)}`} />
							<div class="min-w-0 flex-1">
								<div class="font-semibold text-slate-800">{nombreCompleto(f.personal)}</div>
								{@render botonMarcas(f)}
								<div class="text-[11px] text-slate-500">{f.sinMonto ? 'Sin monto de pago en Personal' : `${formatCurrency(f.tarifaDia)}/día`}{nombreRef(f) ? ` · ${nombreRef(f)}` : ''}</div>
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
						<div class="flex items-center justify-between gap-2">
							{@render chipAprobacion(f)}
							{#if mostrarPago}
								<span class="text-[11px] {f.enviado ? 'text-emerald-700' : 'text-slate-400'}">{f.enviado ? `Enviado ${formatCurrency(f.enviado)}${pendienteDe(f) ? ` · pendiente ${formatCurrency(pendienteDe(f))}` : ''}` : 'Sin enviar'}</span>
							{/if}
						</div>
						{#if puedeEnviar}
							<div class="grid grid-cols-3 gap-2 text-xs">
								<label class="flex flex-col gap-1 text-slate-500">Bonos<input type="text" inputmode="decimal" bind:value={bonos[id]} onblur={() => guardarFila(f)} placeholder="0.00" class="px-2 py-1.5 border border-slate-200 rounded-lg text-sm text-right" /></label>
								<label class="flex flex-col gap-1 text-slate-500">Fecha CxP<input type="date" bind:value={fechaCxp[id]} onchange={() => guardarFila(f)} class="px-1 py-1.5 border border-slate-200 rounded-lg text-sm" /></label>
								<label class="flex flex-col gap-1 text-slate-500">A enviar<input type="text" inputmode="decimal" bind:value={monto[id]} disabled={!aprobada(f) || pendienteDe(f) <= 0} class="px-2 py-1.5 border border-slate-200 rounded-lg text-sm text-right disabled:bg-slate-50" /></label>
							</div>
						{/if}
					</div>
				{/each}
			</div>

			<!-- Ticket #118 (maqueta 27/11/2026): Control presupuestal, Control financiero y Cuentas por pagar. -->
			<div class="lg:sticky bottom-0 z-10 bg-white border border-slate-200 rounded-2xl shadow-lg divide-y divide-slate-100 text-sm">
				{#if puedeEnviar && plan?.disponible}
					<div class="flex flex-wrap items-center gap-x-5 gap-y-2 px-3 py-2">
						{@render franjaTitulo('fa-file-invoice-dollar', 'Control presupuestal', 'bg-orange-50 text-orange-700')}
						<span class="text-slate-600">Presupuesto asignado previamente <b class="text-slate-900">{presupuesto == null ? '—' : formatCurrency(presupuesto)}</b></span>
						<span class="text-slate-600"><i class="far fa-calendar text-slate-400"></i> {presupuestoFecha ? `${ddmm(presupuestoFecha)}/${presupuestoFecha.slice(0, 4)}` : 'Sin fecha de asignación'}</span>
						<span class="text-slate-600">Pago proyectado originalmente <b class="text-blue-700">{formatCurrency(pagoOriginal)}</b></span>
						<span class="text-slate-600">Total real al corte <b class="text-orange-600">{formatCurrency(totalSemana)}</b></span>
						<span class="text-slate-600 lg:ml-auto">Saldo presupuestal al corte <b class={`text-lg ${saldoAlCorte != null && saldoAlCorte < 0 ? 'text-rose-600' : 'text-emerald-700'}`}>{saldoAlCorte == null ? '—' : formatCurrency(saldoAlCorte)}</b></span>
					</div>
				{/if}
				{#if puedeEnviar}
					<div class="flex flex-wrap items-center gap-x-5 gap-y-2 px-3 py-2">
						{@render franjaTitulo('fa-building-columns', 'Control financiero', 'bg-blue-50 text-blue-700')}
						{@render controlFondo()}
						<button type="button" onclick={() => (verReservas = true)} class="lg:ml-auto px-3 py-1.5 rounded-xl border-2 border-blue-500 text-blue-700 text-sm font-bold hover:bg-blue-50">
							Ver reservas{conReserva.length ? ` (${conReserva.length})` : ''}
						</button>
					</div>
				{/if}
				<div class="flex flex-col lg:flex-row lg:items-center gap-3 px-3 py-2">
					<div class="flex flex-wrap items-center gap-x-5 gap-y-1 flex-1">
						{@render franjaTitulo('fa-file-invoice', 'Cuentas por pagar', 'bg-emerald-50 text-emerald-700')}
						<span class="text-slate-600">Total del período <b class="text-orange-600">{formatCurrency(totalSemana)}</b></span>
						{#if seleccionados.length}<span class="text-slate-600">Seleccionados ({seleccionados.length}) <b class="text-blue-700">{formatCurrency(totalSeleccionado)}</b></span>{/if}
						{#if mostrarPago}
							<span class="text-slate-600">Enviado a CxP <b class="text-emerald-700">{formatCurrency(totalEnviado)}</b></span>
							<span class="text-slate-600">Pendiente de enviar <b class={saldoPendiente ? 'text-rose-600' : 'text-slate-800'}>{formatCurrency(saldoPendiente)}</b></span>
						{/if}
					</div>
					<div class="flex flex-wrap items-end gap-2">
						{#if esAdmin || filas.some(esJefeDe)}
							<div class="flex flex-col items-center gap-0.5">
								<span class="text-[10px] font-semibold text-amber-700 bg-amber-100 rounded px-2">Jefe inmediato</span>
								<button type="button" onclick={() => aprobar(seleccionados)} disabled={aprobando || !porAprobarSel.length} class="px-3 py-2 rounded-xl border-2 border-orange-500 text-orange-600 text-sm font-bold hover:bg-orange-50 disabled:opacity-40">
									<i class="fas fa-check"></i> {aprobando ? 'Aprobando…' : `Aprobar seleccionados${porAprobarSel.length ? ` (${porAprobarSel.length})` : ''}`}
								</button>
							</div>
						{/if}
						{#if puedeEnviar}
							<div class="flex flex-col items-center gap-0.5">
								<button type="button" onclick={() => enviar(seleccionados)} disabled={enviando || !porEnviarSel.length} class="px-3 py-2 rounded-xl bg-blue-600 text-white text-sm font-semibold disabled:opacity-40">{enviando ? 'Enviando…' : `Enviar seleccionados a CxP${porEnviarSel.length ? ` (${porEnviarSel.length})` : ''}`}</button>
								<span class="text-[10px] text-slate-400">Requiere aprobación del jefe inmediato</span>
							</div>
							<button type="button" onclick={() => enviar(aprobadosConSaldo, true)} disabled={enviando || !aprobadosConSaldo.length} class="px-3 py-2 rounded-xl border border-blue-200 text-blue-700 text-sm font-semibold hover:bg-blue-50 disabled:opacity-40" title="Envía el saldo de todos los trabajadores ya aprobados">
								Enviar todo lo aprobado{aprobadosConSaldo.length ? ` (${aprobadosConSaldo.length})` : ''}
							</button>
						{/if}
					</div>
				</div>
			</div>
		{/if}
	{/if}
</div>

{#snippet vistaProyeccion()}
	<div class="flex flex-wrap items-center gap-x-4 gap-y-2 px-1">
		<span class="text-lg font-bold text-slate-800">Vista:</span>
		<span class="rounded-lg bg-orange-50 border border-orange-200 px-3 py-0.5 text-lg font-extrabold text-orange-600">PROYECCIÓN</span>
		{#if plan?.disponible}
			<span class="hidden sm:block h-6 w-px bg-slate-300"></span>
			<label class="flex items-center gap-2 text-sm text-slate-700">
				Presupuesto asignado previamente
				{@render montoLapiz(presupuestoTexto, (v) => (presupuestoTexto = v), guardarPresupuestoSemana, 'Presupuesto asignado previamente', 'w-36 text-base font-bold')}
			</label>
			<label class="flex items-center gap-2 text-sm text-slate-700">
				Fecha de asignación
				<input type="date" bind:value={presupuestoFecha} onchange={guardarControl} disabled={!puedeEnviar} class="px-2 py-1.5 border border-slate-200 rounded-lg text-sm" aria-label="Fecha de asignación" />
			</label>
			{#if saldoObra != null}
				<span class="text-xs text-slate-500">Disponible en la obra: <b class={saldoObra < 0 ? 'text-rose-600' : 'text-emerald-700'}>{formatCurrency(saldoObra)}</b>
					{#if puedeEnviar}<button type="button" onclick={usarSaldoObra} class="ml-1 text-blue-600 hover:underline">Usar este monto</button>{/if}
				</span>
			{/if}
		{:else}
			<span class="text-sm text-slate-500">Separar fondos antes del sábado.</span>
		{/if}
	</div>

	{#if plan?.disponible}
		<div class="bg-white border border-slate-100 rounded-2xl shadow-sm p-4 flex flex-col gap-3">
			<div class="flex flex-wrap items-center gap-3">
				<span class="text-lg font-bold text-slate-800">Requerimientos de personal</span>
				{#if puedeEnviar}
					<div class="flex rounded-lg border border-slate-200 p-0.5 text-xs" role="tablist" aria-label="Requerimientos por obra o por semana">
						<button type="button" role="tab" aria-selected={plan.modo === 'obra'} onclick={() => cambiarModo('obra')} title="Los mismos requerimientos para todas las semanas" class={`px-2.5 py-1 rounded-md font-semibold ${plan.modo === 'obra' ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>Por obra</button>
						<button type="button" role="tab" aria-selected={plan.modo === 'semana'} onclick={() => cambiarModo('semana')} title="Cada semana con sus propios requerimientos" class={`px-2.5 py-1 rounded-md font-semibold ${plan.modo === 'semana' ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>Por semana</button>
					</div>
					<span class="ml-auto flex flex-wrap gap-2">
						{#if plan.modo === 'semana'}<button type="button" onclick={copiarAnterior} class="px-3 py-1.5 rounded-xl border border-slate-200 text-sm text-slate-700 hover:bg-slate-50"><i class="fas fa-copy"></i> Copiar de la semana anterior</button>{/if}
						<button type="button" onclick={nuevoRequerimiento} class="px-3 py-1.5 rounded-xl border-2 border-orange-500 text-orange-600 text-sm font-bold hover:bg-orange-50">+ Agregar requerimiento</button>
					</span>
				{/if}
			</div>
			{#if !plan.requerimientos.length}
				<p class="text-sm text-slate-400 italic">Sin requerimientos {plan.modo === 'semana' ? 'para esta semana' : 'para esta obra'}. Agrega el personal que se necesita (cargo, cuántos y qué aptitudes) para ver los faltantes y el costo estimado.</p>
			{:else}
				<div class="overflow-x-auto">
					<table class="w-full text-sm">
						<thead class="bg-slate-50 text-xs text-slate-600">
							<tr>
								<th class="px-2 py-2 text-left">Cargo requerido</th>
								<th class="px-2 py-2 text-left">Aptitudes requeridas</th>
								<th class="px-2 py-2 text-center">Requeridos</th>
								<th class="px-2 py-2 text-center">Asignados</th>
								<th class="px-2 py-2 text-center">Faltantes</th>
								<th class="px-2 py-2 text-right">Costo estimado</th>
								<th class="px-2 py-2 text-center">Acción</th>
							</tr>
						</thead>
						<tbody class="divide-y divide-slate-100">
							{#each grupos.filter((g) => g.req) as g (g.clave)}
								{@const r = g.req!}
								{@const faltan = r.cantidad - g.items.length}
								<tr>
									<td class="px-2 py-2 font-semibold text-slate-800">{r.cargo}</td>
									<td class="px-2 py-2">
										<div class="flex flex-wrap gap-1">
											{#each r.aptitudes as a (a)}<span class="rounded-md bg-blue-50 border border-blue-100 px-1.5 py-0.5 text-xs text-blue-700">{a}</span>{:else}<span class="text-xs text-slate-400">—</span>{/each}
										</div>
									</td>
									<td class="px-2 py-2 text-center tabular-nums">{r.cantidad}</td>
									<td class="px-2 py-2 text-center tabular-nums">{g.items.length}</td>
									<td class={`px-2 py-2 text-center tabular-nums font-bold ${faltan > 0 ? 'text-rose-600' : faltan < 0 ? 'text-amber-600' : 'text-emerald-600'}`} title={faltan < 0 ? `${-faltan} más de lo requerido` : ''}>{faltan > 0 ? faltan : faltan < 0 ? `+${-faltan}` : 0}</td>
									<td class="px-2 py-2 text-right tabular-nums">{formatCurrency(costoEstimado(g))}</td>
									<td class="px-2 py-2">
										<div class="flex items-center justify-center gap-1">
											<button type="button" onclick={() => verPersonal(g)} disabled={!g.items.length} class="px-2.5 py-1 rounded-lg border border-orange-400 text-orange-600 text-xs font-bold hover:bg-orange-50 disabled:opacity-40">Ver personal</button>
											{#if puedeEnviar}
												<button type="button" onclick={() => (reqEditando = { ...r, aptitudes: [...r.aptitudes] })} class="w-7 h-7 rounded-full text-slate-500 hover:bg-slate-100" title="Editar" aria-label="Editar requerimiento"><i class="fas fa-pen text-xs"></i></button>
												<button type="button" onclick={() => borrarReq(r)} class="w-7 h-7 rounded-full text-rose-500 hover:bg-rose-50" title="Quitar" aria-label="Quitar requerimiento"><i class="fas fa-trash-can text-xs"></i></button>
											{/if}
										</div>
									</td>
								</tr>
							{/each}
						</tbody>
						<tfoot>
							<tr class="border-t border-slate-200 text-sm">
								<td colspan="5" class="px-2 py-2 text-right font-semibold text-slate-600">Costo estimado de los requerimientos</td>
								<td class="px-2 py-2 text-right tabular-nums font-bold">{formatCurrency(costoRequerimientos)}</td>
								<td></td>
							</tr>
						</tfoot>
					</table>
				</div>
			{/if}
		</div>
	{/if}
	<div class="bg-white border border-slate-100 rounded-2xl shadow-sm overflow-x-auto">
		<table class="w-full text-sm">
			<thead class="bg-slate-50 text-slate-600 text-xs">
				<tr>
					<th rowspan="2" class="px-2 py-2 w-8"><input type="checkbox" checked={todosProy} onchange={(e) => { const v = (e.currentTarget as HTMLInputElement).checked; const s: Record<number, boolean> = {}; if (v) for (const x of proy) s[x.f.personal.id_personal] = true; selProy = s; }} aria-label="Seleccionar todos" /></th>
					<th rowspan="2" class="px-2 py-2 text-left min-w-[150px]">Trabajador</th>
					<th rowspan="2" class="px-2 py-2 text-left">Cargo</th>
					{#if plan?.disponible}<th rowspan="2" class="px-2 py-2 text-left">Aptitudes (match)</th>{/if}
					<th rowspan="2" class="px-2 py-2 text-left">Subcontratista</th>
					{#if fechas.some((f) => f <= hoy)}<th colspan={fechas.filter((f) => f <= hoy).length} class="px-1 pt-2 text-center text-blue-700 bg-blue-50/60">Registrado</th>{/if}
					{#if fechas.some((f) => f > hoy)}<th colspan={fechas.filter((f) => f > hoy).length} class="px-1 pt-2 text-center text-slate-500 bg-slate-100/60">Previsto</th>{/if}
					<th rowspan="2" class="px-2 py-2 text-right">Tarifa diaria</th>
					<th rowspan="2" class="px-2 py-2 text-right">Acumulado real S/</th>
					<th rowspan="2" class="px-2 py-2 text-right">Por completar S/</th>
					<th rowspan="2" class="px-2 py-2 text-right">Bonos previstos S/</th>
					<th rowspan="2" class="px-2 py-2 text-right">Total proyectado S/</th>
				</tr>
				<tr>
					{#each fechas as f, i}<th class={`px-1 pb-2 text-center font-semibold ${f <= hoy ? 'bg-blue-50/60' : 'bg-slate-100/60'}`}>{DIAS_SEMANA[i].slice(0, 1)}</th>{/each}
				</tr>
			</thead>
			<tbody class="divide-y divide-slate-100">
				{#each grupos as g (g.clave)}
					{#if (plan?.requerimientos.length ?? 0) > 0}
						<tr id={`grupo-${g.clave}`} class="bg-blue-50/70">
							<td colspan={plan?.disponible ? 17 : 16} class="px-2 py-1.5">
								<button type="button" onclick={() => (gruposCerrados[g.clave] = !gruposCerrados[g.clave])} class="flex flex-wrap items-center gap-2 text-left w-full">
									<i class={`fas fa-chevron-${gruposCerrados[g.clave] ? 'right' : 'down'} text-xs text-slate-500`}></i>
									<span class="font-bold text-slate-800">{g.titulo}</span>
									<span class="text-slate-600">· {g.items.length} trabajador{g.items.length === 1 ? '' : 'es'}{g.req ? ` de ${g.req.cantidad}` : ''} · <b>{formatCurrency(totalGrupo(g))}</b></span>
									{#each g.req?.aptitudes ?? [] as a (a)}<span class="rounded-md bg-white border border-blue-100 px-1.5 py-0.5 text-xs text-blue-700">{a}</span>{/each}
								</button>
							</td>
						</tr>
					{/if}
					{#if !gruposCerrados[g.clave]}
					{#each g.items as x (x.f.personal.id_personal)}
					{@const id = x.f.personal.id_personal}
					{@const match = g.req && g.req.aptitudes.length ? cumpleAptitudes(x.f.personal.aptitudes, g.req.aptitudes) : null}
					<tr>
						<td class="px-2 py-2 text-center"><input type="checkbox" bind:checked={selProy[id]} aria-label={`Seleccionar ${nombreCompleto(x.f.personal)}`} /></td>
						<td class="px-2 py-2">
							<div class="font-semibold text-slate-800">{nombreCompleto(x.f.personal)}</div>
							<div class="text-[11px] text-blue-600">{x.f.personal.tipo_documento} {x.f.personal.numero_documento ?? ''}</div>
							{#if x.f.reservaMonto}<div class="text-[11px] text-violet-700"><i class="fas fa-calendar-check"></i> Reservado {formatCurrency(x.f.reservaMonto)}{x.f.reservaFecha ? ` · ${ddmm(x.f.reservaFecha)}` : ''}</div>{/if}
						</td>
						<td class="px-2 py-2 text-xs text-slate-600">{x.f.personal.cargo ?? x.f.personal.categoria ?? ''}</td>
						{#if plan?.disponible}
							<td class="px-2 py-2 text-xs">
								{#if match}
									<span class={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-semibold ${match.tiene === match.total ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-amber-50 border-amber-200 text-amber-700'}`} title={match.faltan.length ? `Le falta: ${match.faltan.join(', ')}` : 'Tiene todas las aptitudes requeridas'}>
										<i class={`fas ${match.tiene === match.total ? 'fa-check' : 'fa-triangle-exclamation'}`}></i> Cumple {match.tiene}/{match.total}
									</span>
								{:else if x.f.personal.aptitudes?.length}
									<span class="text-slate-500" title={x.f.personal.aptitudes.join(', ')}>{x.f.personal.aptitudes.length} aptitud{x.f.personal.aptitudes.length === 1 ? '' : 'es'}</span>
								{:else}
									<span class="text-slate-300">—</span>
								{/if}
							</td>
						{/if}
						<td class="px-2 py-2 text-xs text-slate-600">{nombreRef(x.f) || '—'}</td>
						{#each x.p.dias as d (d.fecha)}
							<td class={`px-1 py-2 text-center tabular-nums ${d.registrado ? 'font-bold text-slate-800' : 'text-slate-400'}`}>
								{#if d.registrado}{x.f.dias.find((y) => y.fecha === d.fecha)?.estado === 'falta' ? 'F' : fr(d.fraccion)}{:else}{d.fraccion ? `${fr(d.fraccion)} P` : '—'}{/if}
							</td>
						{/each}
						<td class="px-2 py-2 text-right tabular-nums">{x.f.sinMonto ? '—' : formatCurrency(x.f.tarifaDia)}</td>
						<td class="px-2 py-2 text-right tabular-nums font-bold">{formatCurrency(x.p.acumulado)}</td>
						<td class="px-2 py-2 text-right tabular-nums">{formatCurrency(x.p.porCompletar)}</td>
						<td class="px-2 py-2 text-right tabular-nums">{formatCurrency(num(bonos[id]))}</td>
						<td class="px-2 py-2 text-right tabular-nums font-extrabold text-slate-900">{formatCurrency(totalProyectadoDe(x))}</td>
					</tr>
					{/each}
					{/if}
				{/each}
			</tbody>
		</table>
	</div>
	<p class="px-1 text-xs italic text-slate-500">P = proyectado · Los días futuros no son asistencia registrada: se prevén según el horario de cada trabajador.</p>
	<!-- Ticket #118 (maqueta 27/11/2026): pie en franjas. Lo que tiene lápiz se escribe. -->
	<div class="lg:sticky bottom-0 z-10 bg-white border border-slate-200 rounded-2xl shadow-lg divide-y divide-slate-100 text-sm">
		<div class="flex flex-wrap items-center gap-x-5 gap-y-2 px-3 py-2">
			{@render franjaTitulo('fa-chart-column', 'Totales de la proyección', 'bg-orange-50 text-orange-700')}
			<span class="text-slate-600">Total acumulado <b class="text-blue-700">{formatCurrency(totProy.acumulado)}</b></span>
			<span class="text-slate-600">Por completar <b class="text-blue-700">{formatCurrency(totProy.porCompletar)}</b></span>
			<span class="text-slate-600">Bonos previstos <b class="text-blue-700">{formatCurrency(totProy.bonos)}</b></span>
			<span class="text-slate-600 lg:ml-auto">Total proyectado <b class="text-lg text-orange-600">{formatCurrency(totProy.total)}</b></span>
		</div>
		{#if plan?.disponible}
			<div class="flex flex-wrap items-center gap-x-5 gap-y-2 px-3 py-2">
				{@render franjaTitulo('fa-file-invoice-dollar', 'Control presupuestal', 'bg-orange-50 text-orange-700')}
				<span class="flex items-center gap-2 text-slate-600">Presupuesto asignado previamente {@render montoLapiz(presupuestoTexto, (v) => (presupuestoTexto = v), guardarPresupuestoSemana, 'Presupuesto asignado previamente', 'w-32 font-bold')}</span>
				<label class="flex items-center gap-2 text-slate-600">Fecha de asignación <input type="date" bind:value={presupuestoFecha} onchange={guardarControl} disabled={!puedeEnviar} class="px-2 py-1 border border-slate-200 rounded-lg text-sm" /></label>
				<span class="text-slate-600">Pago proyectado <b class="text-blue-700">{formatCurrency(totProy.total)}</b></span>
				<span class="text-slate-600 lg:ml-auto">Saldo presupuestal <b class={`text-lg ${saldoDisponible != null && saldoDisponible < 0 ? 'text-rose-600' : 'text-emerald-700'}`}>{saldoDisponible == null ? '—' : formatCurrency(saldoDisponible)}</b></span>
			</div>
		{/if}
		<div class="flex flex-wrap items-center gap-x-5 gap-y-2 px-3 py-2">
			{@render franjaTitulo('fa-building-columns', 'Control financiero', 'bg-blue-50 text-blue-700')}
			{@render controlFondo()}
			<span class="text-slate-600 lg:ml-auto">Pendiente de reservar <b class="text-lg text-rose-600">{formatCurrency(faltaSeparar)}</b></span>
		</div>
		<div class="flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2">
			{@render franjaTitulo('fa-calendar-check', 'Reserva para pago', 'bg-emerald-50 text-emerald-700')}
			<input type="date" bind:value={fechaReserva} class="px-2 py-1 border border-slate-200 rounded-lg text-sm" aria-label="Fecha de la reserva para pago" />
			<button type="button" onclick={programarReserva} disabled={reservando || !proySel.length} class="px-4 py-1.5 rounded-xl bg-orange-500 text-white text-sm font-bold hover:bg-orange-600 disabled:opacity-40">
				<i class="fas fa-calendar-plus"></i> {reservando ? 'Programando…' : `Programar reserva de seleccionados${proySel.length ? ` (${proySel.length})` : ''}`}
			</button>
			<button type="button" onclick={() => (verReservas = true)} class="px-4 py-1.5 rounded-xl border-2 border-blue-500 text-blue-700 text-sm font-bold hover:bg-blue-50">
				<i class="fas fa-list"></i> Ver reservas{conReserva.length ? ` (${conReserva.length})` : ''}
			</button>
			<span class="text-xs italic text-slate-500">Al aprobar el tareo real, se ajusta esta reserva sin duplicar el compromiso.</span>
		</div>
	</div>
{/snippet}

{#snippet franjaTitulo(icono: string, titulo: string, clase: string)}
	<span class={`inline-flex items-center gap-2 rounded-lg px-3 py-1 font-bold whitespace-nowrap ${clase}`}><i class={`fas ${icono}`}></i>{titulo}</span>
{/snippet}

{#snippet montoLapiz(valor: string, poner: (v: string) => void, guardar: () => void, etiqueta: string, clase: string)}
	<span class="relative inline-flex items-center">
		<span class="absolute left-2 text-xs font-bold text-slate-500">S/</span>
		<input type="text" inputmode="decimal" value={valor} oninput={(e) => poner((e.currentTarget as HTMLInputElement).value)} onblur={guardar} disabled={!puedeEnviar} placeholder="0.00" class={`pl-7 pr-7 py-1 border border-slate-200 rounded-lg text-right disabled:bg-slate-50 ${clase}`} aria-label={etiqueta} />
		{#if puedeEnviar}<i class="fas fa-pen absolute right-2 text-[11px] text-slate-400 pointer-events-none"></i>{/if}
	</span>
{/snippet}

<!-- Control financiero: igual en Real y Proyección. -->
{#snippet controlFondo()}
	<span class="flex items-center gap-2 text-slate-600">Fondo reservado actualmente {@render montoLapiz(fondoTexto, (v) => (fondoTexto = v), guardarFondoSemana, 'Fondo reservado actualmente', 'w-32 font-bold')}</span>
	<label class="flex items-center gap-2 text-slate-600">Fecha de reserva <input type="date" bind:value={fondoFecha} onchange={guardarControl} disabled={!puedeEnviar} class="px-2 py-1 border border-slate-200 rounded-lg text-sm" /></label>
	<label class="flex items-center gap-2 text-slate-600">Cuenta
		<select bind:value={idCuentaFondo} onchange={guardarControl} disabled={!puedeEnviar} class="px-2 py-1 border border-slate-200 rounded-lg text-sm font-semibold text-slate-800 max-w-[14rem]" title={cuentaFondo?.detalle ?? ''}>
			<option value="">Elige la cuenta…</option>
			{#each cuentasFondo as c (c.id)}<option value={String(c.id)}>{c.nombre}</option>{/each}
		</select>
	</label>
{/snippet}

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

<!-- Reservas de la semana -->
{#if verReservas}
	<div class="fixed inset-0 z-[120] flex items-end sm:items-center justify-center bg-slate-900/50 p-0 sm:p-4" role="dialog" aria-modal="true" aria-label="Reservas">
		<div class="w-full sm:max-w-lg bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl p-5 flex flex-col gap-3 max-h-[92vh] overflow-y-auto">
			<div class="flex items-start justify-between gap-3">
				<div>
					<h2 class="text-lg font-bold text-slate-800">Reservas de la semana</h2>
					<p class="text-sm text-slate-500">{obra?.codigo} · {tituloSemana}</p>
				</div>
				<button type="button" onclick={() => (verReservas = false)} class="text-slate-400 hover:text-slate-600 p-1" aria-label="Cerrar"><i class="fas fa-times"></i></button>
			</div>
			<p class="text-xs text-slate-500">Cada reserva figura en Cuentas por Pagar como "Proyección de planilla" en su fecha. Si el tareo ya se aprobó, se usa el monto aprobado; al enviarlo, la reserva sale de la proyección.</p>
			{#if !conReserva.length}
				<p class="text-sm text-slate-400">No hay reservas programadas en esta semana.</p>
			{:else}
				<div class="flex flex-col divide-y divide-slate-100 rounded-xl border border-slate-100">
					{#each conReserva as f (f.personal.id_personal)}
						<div class="px-3 py-2 flex items-center gap-3 text-sm">
							<div class="flex-1 min-w-0">
								<div class="font-medium text-slate-800">{nombreCompleto(f.personal)}</div>
								<div class="text-xs text-slate-500">{f.reservaFecha ? `Para el ${ddmm(f.reservaFecha)}/${f.reservaFecha.slice(0, 4)}` : ''}{f.aprobadoMonto != null && !f.enviado ? ` · aprobado ${formatCurrency(f.aprobadoMonto)}` : ''}{f.enviado ? ' · ya enviado a CxP' : ''}</div>
							</div>
							<b class="tabular-nums">{formatCurrency(f.reservaMonto ?? 0)}</b>
							{#if puedeEnviar}<button type="button" onclick={() => quitarReserva(f)} class="text-rose-600 text-xs hover:underline">Quitar</button>{/if}
						</div>
					{/each}
				</div>
			{/if}
			<div class="flex justify-end">
				<button type="button" onclick={() => (verReservas = false)} class="px-4 py-2 rounded-xl border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50">Cerrar</button>
			</div>
		</div>
	</div>
{/if}

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

<RequerimientoModal open={!!reqEditando} inicial={reqEditando} sugerencias={aptitudesSugeridas} guardando={guardandoReq} onguardar={guardarReq} oncerrar={() => (reqEditando = null)} />

<EditarDiaTareo
	{edicion}
	idCentroCosto={obra?.id_centro_costo ?? null}
	idsTodos={todasFilas.map((f) => f.personal.id_personal)}
	puedeEditarDia={puedeEnviar}
	puedeExtra={!!edicion && puedeAprobarFila(edicion.fila)}
	onClose={() => (edicion = null)}
	onSaved={async () => {
		edicion = null;
		await cargar();
	}}
/>

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
