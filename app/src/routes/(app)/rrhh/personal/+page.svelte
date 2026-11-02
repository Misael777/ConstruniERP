<script lang="ts">
	/**
	 * Personal: fichas de los trabajadores (obreros de construcción civil y personal en régimen general).
	 * Los registrados primero en un huellero aparecen con "Ficha incompleta" hasta llenar sus datos.
	 * Dar de baja / Ver eliminados / Eliminar permanente: skill dar-de-baja-pattern.
	 */
	import { onMount, onDestroy } from 'svelte';
	import { supabase } from '$lib/supabaseClient';
	import { puedeVerEliminados } from '$lib/stores/permisos.svelte';
	import { setMobileFab } from '$lib/stores/mobileFab.svelte';
	import { toast } from '$lib/stores/toast';
	import { describeError } from '$lib/shared/describeError';
	import { verifyAdminCredentials } from '$lib/shared/adminAuth';
	import ResponsiveDataView from '$lib/shared/components/ResponsiveDataView.svelte';
	import ConfirmModal from '$lib/shared/components/ConfirmModal.svelte';
	import AdminConfirmModal from '$lib/shared/components/AdminConfirmModal.svelte';
	import PersonalModal from '$lib/modules/personal/components/PersonalModal.svelte';
	import PersonalResumen from '$lib/modules/personal/components/PersonalResumen.svelte';
	import {
		getObrasParaHuellero,
		getEstadoEnHuelleros,
		claveEnHuellero,
		getHuellerosElegibles,
		type EstadoEnHuellero,
		type HuelleroElegible
	} from '$lib/modules/asistencia/services/huelleros.service';
	import { getHorarios, resumenHorario } from '$lib/modules/personal/services/horarios.service';
	import {
		CATEGORIAS,
		REGIMENES,
		etiqueta,
		nombreCompleto,
		fichaIncompleta,
		alertasVencimiento,
		hoyLima,
		getPersonal,
		darDeBajaPersonal,
		restaurarPersonal,
		eliminarPersonalPermanente,
		moverPersonal,
		getBiometriaGuardada,
		type Personal
	} from '$lib/modules/personal/services/personal.service';
	import SelectConSaldo from '$lib/shared/components/SelectConSaldo.svelte';
	import { fade, scale } from 'svelte/transition';

	let personal = $state<Personal[]>([]);
	let enHuelleros = $state<Record<string, EstadoEnHuellero>>({});
	let biometria = $state<Record<number, { huellas: number; rostros: number }>>({});
	let obras = $state<{ value: string; label: string; grupo: string }[]>([]);
	let horarios = $state<{ value: string; label: string }[]>([]);
	let huelleros = $state<HuelleroElegible[]>([]);
	let isLoading = $state(true);
	let verEliminados = $state(false);
	let busqueda = $state('');
	const hoy = hoyLima();

	async function fetchPersonal() {
		isLoading = true;
		try {
			[personal, enHuelleros, huelleros, biometria] = await Promise.all([
				getPersonal(supabase, verEliminados),
				getEstadoEnHuelleros(supabase),
				getHuellerosElegibles(supabase),
				getBiometriaGuardada(supabase)
			]);
			seleccionados = seleccionados.filter((id) => personal.some((p) => p.id_personal === id));
		} catch (err) {
			toast.error(`No se pudo cargar el personal. ${describeError(err)}`);
		} finally {
			isLoading = false;
		}
	}

	function toggleVerEliminados() {
		verEliminados = !verEliminados;
		seleccionados = [];
		fetchPersonal();
	}

	// ── Selección y "Mover a otra obra" ──
	let seleccionados = $state<number[]>([]);
	let moverAbierto = $state(false);
	let destino = $state('');
	let cambiarHuelleros = $state(true);
	let moviendo = $state(false);

	function alternarSeleccion(id: number) {
		seleccionados = seleccionados.includes(id) ? seleccionados.filter((x) => x !== id) : [...seleccionados, id];
	}

	function alternarTodos() {
		const visibles = filtrados.map((p) => p.id_personal);
		seleccionados = todosVisiblesSeleccionados
			? seleccionados.filter((id) => !visibles.includes(id))
			: [...new Set([...seleccionados, ...visibles])];
	}

	function abrirMover() {
		destino = '';
		cambiarHuelleros = true;
		moverAbierto = true;
	}

	async function confirmarMover() {
		if (!destino) {
			toast.error('Elige la obra o área de destino.');
			return;
		}
		moviendo = true;
		try {
			const movidos = await moverPersonal(supabase, seleccionados, Number(destino), cambiarHuelleros);
			const lugar = obras.find((o) => o.value === destino)?.label ?? 'la obra elegida';
			toast.success(`${movidos} ${movidos === 1 ? 'trabajador movido' : 'trabajadores movidos'} a ${lugar}.${cambiarHuelleros ? ' Sus huelleros se actualizan en menos de un minuto.' : ''}`);
			moverAbierto = false;
			seleccionados = [];
			await fetchPersonal();
		} catch (err) {
			toast.error(`No se pudo mover. ${describeError(err)}`);
		} finally {
			moviendo = false;
		}
	}

	onDestroy(setMobileFab(() => abrirFicha(null), 'Nuevo trabajador'));

	onMount(async () => {
		fetchPersonal();
		try {
			const [listaObras, listaHorarios] = await Promise.all([getObrasParaHuellero(supabase), getHorarios(supabase)]);
			obras = listaObras;
			horarios = listaHorarios.map((h) => ({ value: String(h.id_horario), label: `${h.nombre} · ${resumenHorario(h)}` }));
		} catch (err) {
			toast.error(`No se pudieron cargar las obras, áreas y horarios. ${describeError(err)}`);
		}
	});

	const normalizar = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

	const fechaCorta = (f: string) => new Date(`${f}T00:00:00`).toLocaleDateString('es-PE');

	// ── Filtros ── ('' = todos; NINGUNO = sin obra / sin huellero)
	const NINGUNO = '__ninguno';
	const FILTROS_VACIOS = { obra: '', huellero: '', cargo: '', regimen: '', categoria: '', ingresoDesde: '', ingresoHasta: '' };
	let filtros = $state({ ...FILTROS_VACIOS });
	let filtrosAbiertos = $state(false);
	/** Botón compacto de los desplegables dentro de cada píldora de filtro. */
	const CLASE_FILTRO = 'bg-transparent text-xs font-medium py-1';
	/** Un color por filtro; se enciende cuando el filtro está activo. */
	const TONOS_FILTRO = {
		sky: { activo: 'bg-sky-50 border-sky-300', icono: 'text-sky-500', texto: 'text-sky-700' },
		emerald: { activo: 'bg-emerald-50 border-emerald-300', icono: 'text-emerald-500', texto: 'text-emerald-700' },
		violet: { activo: 'bg-violet-50 border-violet-300', icono: 'text-violet-500', texto: 'text-violet-700' },
		amber: { activo: 'bg-amber-50 border-amber-300', icono: 'text-amber-500', texto: 'text-amber-700' },
		orange: { activo: 'bg-orange-50 border-orange-300', icono: 'text-orange-500', texto: 'text-orange-700' },
		rose: { activo: 'bg-rose-50 border-rose-300', icono: 'text-rose-500', texto: 'text-rose-700' }
	};
	const filtrosActivos = $derived(Object.values(filtros).filter(Boolean).length);

	const opcionesObra = $derived.by(() => {
		const vistas = new Map<number, string>();
		for (const p of personal) if (p.id_centro_costo && p.centro_costo) vistas.set(p.id_centro_costo, `${p.centro_costo.codigo} · ${p.centro_costo.nombre}`);
		return [
			{ value: '', label: 'Todas las obras' },
			...[...vistas].sort((a, b) => a[1].localeCompare(b[1])).map(([id, label]) => ({ value: String(id), label })),
			{ value: NINGUNO, label: 'Sin obra o área' }
		];
	});
	const opcionesHuelleroFiltro = $derived([
		{ value: '', label: 'Todos los huelleros' },
		...huelleros.map((h) => ({ value: String(h.id_dispositivo), label: `${h.nombre} (ID ${h.numero_serie}) · ${h.lugar}`, color: h.en_linea ? '#10b981' : '#cbd5e1' })),
		{ value: NINGUNO, label: 'Sin huellero' }
	]);
	const opcionesCargo = $derived([
		{ value: '', label: 'Todos los cargos' },
		...[...new Set(personal.map((p) => p.cargo?.trim()).filter((c): c is string => !!c))].sort((a, b) => a.localeCompare(b)).map((c) => ({ value: c, label: c }))
	]);
	const opcionesRegimen = [{ value: '', label: 'Todos los regímenes' }, ...REGIMENES];
	const opcionesCategoria = [{ value: '', label: 'Todas las categorías' }, ...CATEGORIAS];

	/** Filtros activos como etiquetas que se pueden quitar una a una. */
	const etiquetasFiltro = $derived(
		(
			[
				['obra', 'Obra o área', opcionesObra],
				['huellero', 'Huellero', opcionesHuelleroFiltro],
				['cargo', 'Cargo', opcionesCargo],
				['regimen', 'Régimen', opcionesRegimen],
				['categoria', 'Categoría', opcionesCategoria]
			] as const
		)
			.filter(([clave]) => filtros[clave])
			.map(([clave, titulo, lista]) => ({ clave: clave as string, texto: `${titulo}: ${(lista as { value: string; label: string }[]).find((o) => o.value === filtros[clave])?.label ?? filtros[clave]}` }))
			.concat(
				filtros.ingresoDesde || filtros.ingresoHasta
					? [{ clave: 'ingreso', texto: `Ingreso: ${filtros.ingresoDesde ? fechaCorta(filtros.ingresoDesde) : '…'} – ${filtros.ingresoHasta ? fechaCorta(filtros.ingresoHasta) : '…'}` }]
					: []
			)
	);

	function quitarFiltro(clave: string) {
		if (clave === 'ingreso') filtros.ingresoDesde = filtros.ingresoHasta = '';
		else filtros[clave as keyof typeof filtros] = '';
	}

	const filtrados = $derived.by(() => {
		const q = normalizar(busqueda.trim());
		const f = filtros;
		return personal.filter((p) => {
			if (q && !normalizar([nombreCompleto(p), p.numero_documento, p.pin, p.cargo, p.centro_costo?.nombre].filter(Boolean).join(' ')).includes(q)) return false;
			if (f.obra && (f.obra === NINGUNO ? p.id_centro_costo : String(p.id_centro_costo) !== f.obra)) return false;
			const suyos = p.personal_huellero ?? [];
			if (f.huellero && (f.huellero === NINGUNO ? suyos.length : !suyos.some((v) => String(v.id_dispositivo) === f.huellero))) return false;
			if (f.cargo && p.cargo?.trim() !== f.cargo) return false;
			if (f.regimen && p.regimen !== f.regimen) return false;
			if (f.categoria && p.categoria !== f.categoria) return false;
			if (f.ingresoDesde && (!p.fecha_ingreso || p.fecha_ingreso < f.ingresoDesde)) return false;
			if (f.ingresoHasta && (!p.fecha_ingreso || p.fecha_ingreso > f.ingresoHasta)) return false;
			return true;
		});
	});

	/** Estado del trabajador en cada huellero (su última orden ahí). Sin orden = llegó desde el propio huellero. */
	const ESTADO_ENVIO: Record<EstadoEnHuellero | 'sin_orden', { texto: string; icono: string; clase: string; ayuda: string }> = {
		en_huellero: { texto: 'Registrado', icono: 'fa-fingerprint', clase: 'bg-blue-50 text-blue-700 border-blue-200', ayuda: 'El huellero confirmó que lo tiene registrado.' },
		sin_orden: { texto: 'Registrado', icono: 'fa-fingerprint', clase: 'bg-blue-50 text-blue-700 border-blue-200', ayuda: 'Se registró directamente en el huellero.' },
		enviando: { texto: 'Enviando', icono: 'fa-paper-plane', clase: 'bg-amber-50 text-amber-700 border-amber-200', ayuda: 'Se enviará o actualizará cuando el huellero se conecte.' },
		error: { texto: 'Error', icono: 'fa-triangle-exclamation', clase: 'bg-rose-50 text-rose-700 border-rose-200', ayuda: 'El huellero rechazó la orden. Usa Sincronizar en Huelleros para reintentar.' },
		retirado: { texto: 'Retirado', icono: 'fa-user-slash', clase: 'bg-slate-100 text-slate-500 border-slate-200', ayuda: 'Se retiró de este huellero.' }
	};

	/** Huelleros donde marca, con nombre y conexión. */
	const huellerosDe = (p: Personal) => huelleros.filter((h) => p.personal_huellero?.some((v) => v.id_dispositivo === h.id_dispositivo));
	const todosVisiblesSeleccionados = $derived(filtrados.length > 0 && filtrados.every((p) => seleccionados.includes(p.id_personal)));
	const incompletas = $derived(personal.filter(fichaIncompleta).length);
	const conAlertas = $derived(personal.filter((p) => alertasVencimiento(p, hoy).length > 0).length);

	function puesto(p: Personal): string {
		if (p.regimen === 'construccion_civil') return etiqueta(CATEGORIAS, p.categoria) || 'Construcción civil';
		if (p.regimen === 'general') return p.cargo || 'Régimen general';
		return '';
	}

	// ── Ficha ──
	let fichaAbierta = $state(false);
	let enEdicion = $state<Personal | null>(null);

	function abrirFicha(p: Personal | null) {
		enResumen = null;
		enEdicion = p;
		fichaAbierta = true;
	}

	// ── ⓘ Resumen (solo lectura) ──
	let enResumen = $state<Personal | null>(null);

	// ── ✏️ Editar y 🗑️ dar de baja: a pedido del usuario, siempre con la contraseña de un administrador o
	// developer (fn_verificar_credenciales_admin acepta ambos roles). Crear un trabajador no la pide. ──
	let paraEditar = $state<Personal | null>(null);
	let paraDarDeBaja = $state<Personal | null>(null);
	let paraRestaurar = $state<Personal | null>(null);
	let paraEliminar = $state<Personal | null>(null);

	async function autorizarEdicion(email: string, password: string) {
		if (!paraEditar) return;
		const verificacion = await verifyAdminCredentials(email, password);
		if (!verificacion.success) throw new Error(verificacion.message);
		const p = paraEditar;
		paraEditar = null;
		abrirFicha(p);
	}

	async function confirmarDarDeBaja(email: string, password: string) {
		if (!paraDarDeBaja) return;
		const verificacion = await verifyAdminCredentials(email, password);
		if (!verificacion.success) throw new Error(verificacion.message);
		await darDeBajaPersonal(supabase, paraDarDeBaja.id_personal);
		toast.success(`${nombreCompleto(paraDarDeBaja)} dado de baja.`);
		paraDarDeBaja = null;
		await fetchPersonal();
	}

	async function confirmarRestaurar() {
		if (!paraRestaurar) return;
		try {
			await restaurarPersonal(supabase, paraRestaurar.id_personal);
			toast.success(`${nombreCompleto(paraRestaurar)} restaurado.`);
			await fetchPersonal();
		} catch (err) {
			toast.error(`No se pudo restaurar. ${describeError(err)}`);
		} finally {
			paraRestaurar = null;
		}
	}

	async function confirmarEliminar(email: string, password: string) {
		if (!paraEliminar) return;
		const verificacion = await verifyAdminCredentials(email, password);
		if (!verificacion.success) throw new Error(verificacion.message);
		await eliminarPersonalPermanente(supabase, paraEliminar.id_personal);
		toast.success(`${nombreCompleto(paraEliminar)} eliminado permanentemente.`);
		paraEliminar = null;
		await fetchPersonal();
	}

	const columnas = [
		{ label: 'Trabajador' },
		{ label: 'Número en huellero', class: 'w-28 whitespace-normal text-center' },
		{ label: 'Puesto' },
		{ label: 'Obra o área' },
		{ label: 'Huelleros' },
		{ label: 'Avisos' },
		{ label: '', align: 'right' as const }
	];
</script>

<svelte:head>
	<title>Personal | Personal y Asistencia - Construni ERP</title>
</svelte:head>

{#snippet avisos(p: Personal)}
	<div class="flex flex-wrap gap-1">
		{#if fichaIncompleta(p)}
			<span class="text-[11px] font-bold px-2 py-0.5 rounded-md bg-amber-50 text-amber-700 border border-amber-200">Ficha incompleta</span>
		{/if}
		{#if !verEliminados && !p.personal_huellero?.length}
			<span class="text-[11px] font-medium px-2 py-0.5 rounded-md bg-slate-50 text-slate-500 border border-slate-200" title="Elige sus huelleros en la ficha">Sin huellero asignado</span>
		{/if}
		{#if !verEliminados && huellerosDe(p).some((h) => enHuelleros[claveEnHuellero(p.pin, h.id_dispositivo)] === 'error')}
			<span class="text-[11px] font-medium px-2 py-0.5 rounded-md bg-rose-50 text-rose-700 border border-rose-200" title="Usa Sincronizar en Huelleros para reintentar">Error al enviar al huellero</span>
		{/if}
		{#if biometria[p.id_personal]}
			<span class="text-[11px] font-medium px-2 py-0.5 rounded-md bg-slate-50 text-slate-600 border border-slate-200" title="Huella o rostro guardados cifrados: se copian solos al cambiar de huellero"><i class="fas fa-lock"></i> Biometría guardada</span>
		{/if}
		{#each alertasVencimiento(p, hoy) as alerta}
			<span class={`text-[11px] font-bold px-2 py-0.5 rounded-md border ${alerta.vencido ? 'bg-rose-50 text-rose-700 border-rose-200' : 'bg-orange-50 text-orange-700 border-orange-200'}`}>{alerta.texto}</span>
		{/each}
	</div>
{/snippet}

{#snippet listaHuelleros(p: Personal)}
	{@const suyos = huellerosDe(p)}
	{#if suyos.length}
		<div class="flex flex-col gap-1.5">
			{#each suyos as h (h.id_dispositivo)}
				{@const envio = ESTADO_ENVIO[enHuelleros[claveEnHuellero(p.pin, h.id_dispositivo)] ?? 'sin_orden']}
				<div class="min-w-0 rounded-lg border border-slate-100 bg-slate-50/60 px-2 py-1.5 flex flex-col gap-1" title={h.lugar}>
					<span class="text-xs font-semibold text-slate-700 truncate">{h.nombre}</span>
					<span class="text-[10px] font-mono text-slate-400 truncate" title="Identificador del huellero (número de serie)">ID {h.numero_serie}</span>
					<div class="flex flex-wrap gap-1">
						<span class={`inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded border ${h.en_linea ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-slate-100 text-slate-500 border-slate-200'}`} title="Conexión del huellero con el ERP">
							<span class={`w-1.5 h-1.5 rounded-full ${h.en_linea ? 'bg-emerald-500' : 'bg-slate-400'}`}></span>{h.en_linea ? 'En línea' : 'Desconectado'}
						</span>
						{#if !verEliminados}
							<span class={`inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded border ${envio.clase}`} title={envio.ayuda}>
								<i class={`fas ${envio.icono}`}></i>{envio.texto}
							</span>
						{/if}
					</div>
				</div>
			{/each}
		</div>
	{:else}
		<span class="text-xs text-slate-300">—</span>
	{/if}
{/snippet}

{#snippet filtro(id: string, titulo: string, tono: keyof typeof TONOS_FILTRO, icono: string, activo: boolean, control: import('svelte').Snippet, fijo = false)}
	<!-- En pantallas medianas o más, los seis filtros van en una sola fila: el nombre se ve desde xl; antes, solo el ícono (con tooltip). -->
	<div title={titulo} class={`flex items-center gap-1.5 h-9 pl-3 pr-2 rounded-full border transition-colors min-w-0 ${fijo ? 'md:shrink-0' : 'md:flex-1 md:basis-0'} ${activo ? TONOS_FILTRO[tono].activo : 'bg-white border-slate-200 hover:border-slate-300'}`}>
		<i class={`fas ${icono} text-xs shrink-0 ${TONOS_FILTRO[tono].icono}`}></i>
		<label for={id} class={`text-[11px] font-semibold shrink-0 md:hidden xl:inline ${activo ? TONOS_FILTRO[tono].texto : 'text-slate-400'}`}>{titulo}</label>
		<div class="flex-1 min-w-0">{@render control()}</div>
	</div>
{/snippet}

{#snippet encabezado()}
	<th class="sticky top-0 z-10 bg-slate-50 pl-5 py-4 w-8">
		<input type="checkbox" checked={todosVisiblesSeleccionados} onchange={alternarTodos} aria-label="Seleccionar todos" class="w-4 h-4 accent-blue-600" />
	</th>
	{#each columnas as col}
		<th class={`sticky top-0 z-10 bg-slate-50 px-5 py-4 ${col.align === 'right' ? 'text-right' : 'text-left'} ${col.class ?? ''}`}>{col.label}</th>
	{/each}
{/snippet}

{#snippet acciones(p: Personal)}
	<div class="flex items-center justify-end gap-1">
		<button onclick={() => (enResumen = p)} title="Ver resumen" aria-label={`Ver resumen de ${nombreCompleto(p)}`} class="w-9 h-9 rounded-full text-slate-500 hover:bg-slate-100 hover:text-slate-700">
			<i class="fas fa-circle-info"></i>
		</button>
		<a href={`/rrhh/asistencia?p=${p.id_personal}`} title="Ver asistencia" aria-label={`Ver asistencia de ${nombreCompleto(p)}`} class="w-9 h-9 rounded-full text-slate-500 hover:bg-slate-100 hover:text-slate-700 inline-flex items-center justify-center">
			<i class="fas fa-calendar-check"></i>
		</a>
		{#if verEliminados}
			<button onclick={() => (paraRestaurar = p)} title="Restaurar" aria-label={`Restaurar a ${nombreCompleto(p)}`} class="w-9 h-9 rounded-full text-emerald-700 hover:bg-emerald-50">
				<i class="fas fa-rotate-left"></i>
			</button>
			<button onclick={() => (paraEliminar = p)} title="Eliminar permanentemente" aria-label={`Eliminar permanentemente a ${nombreCompleto(p)}`} class="w-9 h-9 rounded-full text-rose-600 hover:bg-rose-50">
				<i class="fas fa-trash"></i>
			</button>
		{:else}
			<button onclick={() => (paraEditar = p)} title={fichaIncompleta(p) ? 'Completar ficha (pide administrador)' : 'Editar (pide administrador)'} aria-label={`Editar a ${nombreCompleto(p)}`} class="w-9 h-9 rounded-full text-blue-600 hover:bg-blue-50">
				<i class="fas fa-pen"></i>
			</button>
			<button onclick={() => (paraDarDeBaja = p)} title="Eliminar / dar de baja (pide administrador)" aria-label={`Eliminar a ${nombreCompleto(p)}`} class="w-9 h-9 rounded-full text-rose-600 hover:bg-rose-50">
				<i class="fas fa-trash"></i>
			</button>
		{/if}
	</div>
{/snippet}

<div class="flex flex-col md:h-[calc(100vh-80px)] md:overflow-hidden bg-slate-50/50">
	<div class="flex-shrink-0 px-4 sm:px-6 py-5 flex items-start sm:items-center justify-between gap-3 border-b border-slate-100 bg-white">
		<div class="flex flex-col min-w-0">
			<div class="flex flex-wrap items-center gap-2 mb-1">
				<span class="font-bold text-slate-800 text-2xl">{verEliminados ? 'Personal dado de baja' : 'Personal'}</span>
				{#if verEliminados}
					<span class="text-[10px] font-bold px-2 py-0.5 rounded-md bg-rose-50 text-rose-600 border border-rose-200 uppercase tracking-wide">Solo administradores</span>
				{/if}
			</div>
			<p class="text-sm text-slate-500">
				{verEliminados
					? 'Trabajadores dados de baja: restáuralos o elimina su ficha permanentemente (sus marcaciones se conservan).'
					: 'Fichas de los trabajadores de obra y oficina. El número en huellero es el ID con el que marcan.'}
			</p>
		</div>
		<div class="flex items-center gap-3 shrink-0">
			{#if puedeVerEliminados()}
				<button onclick={toggleVerEliminados} class={`px-3 sm:px-4 py-2 rounded-xl font-medium text-sm transition-colors shadow-sm flex items-center gap-2 whitespace-nowrap ${verEliminados ? 'bg-slate-800 text-white hover:bg-slate-900' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
					<i class={`fas ${verEliminados ? 'fa-arrow-left' : 'fa-trash-can'}`}></i>
					{verEliminados ? 'Volver' : 'Ver eliminados'}
				</button>
			{/if}
			{#if !verEliminados}
				<button onclick={() => abrirFicha(null)} class="hidden md:flex px-5 py-2 bg-blue-600 text-white rounded-xl hover:bg-blue-700 font-medium text-sm shadow-md shadow-blue-600/20 items-center gap-2">
					<i class="fas fa-plus"></i> Nuevo trabajador
				</button>
			{/if}
		</div>
	</div>

	<div class="flex-1 overflow-y-auto p-4 sm:p-6">
		<div class="max-w-[1400px] mx-auto flex flex-col gap-4">
			<div class="flex flex-col sm:flex-row sm:items-center gap-3">
				<div class="flex gap-2 flex-1 min-w-0">
					<div class="relative flex-1 min-w-0">
						<i class="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm"></i>
						<input bind:value={busqueda} placeholder="Buscar por nombre, documento, número u obra" class="w-full pl-9 pr-3 py-2.5 border border-slate-200 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500" />
					</div>
					<button
						onclick={() => (filtrosAbiertos = !filtrosAbiertos)}
						aria-expanded={filtrosAbiertos}
						class={`shrink-0 px-4 py-2.5 rounded-xl text-sm font-medium border flex items-center gap-2 transition-colors ${filtrosAbiertos || filtrosActivos ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}`}
					>
						<i class="fas fa-sliders"></i>
						<span class="hidden sm:inline">Filtros</span>
						{#if filtrosActivos}<span class="min-w-5 h-5 px-1.5 rounded-full bg-blue-600 text-white text-[11px] font-bold inline-flex items-center justify-center">{filtrosActivos}</span>{/if}
						<i class={`fas fa-chevron-down text-[10px] transition-transform ${filtrosAbiertos ? 'rotate-180' : ''}`}></i>
					</button>
				</div>
				{#if !verEliminados}
					<div class="flex flex-wrap gap-2 text-xs">
						<span class="px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-slate-600">{personal.length} trabajadores</span>
						{#if incompletas}<span class="px-3 py-1.5 rounded-lg bg-amber-50 border border-amber-200 text-amber-700">{incompletas} fichas incompletas</span>{/if}
						{#if conAlertas}<span class="px-3 py-1.5 rounded-lg bg-orange-50 border border-orange-200 text-orange-700">{conAlertas} con SCTR/examen por vencer</span>{/if}
					</div>
				{/if}
			</div>

			{#if filtrosAbiertos}
				<div class="bg-white border border-slate-100 rounded-2xl shadow-sm p-3 flex flex-col gap-3" transition:fade={{ duration: 150 }}>
					<div class="grid grid-cols-1 sm:grid-cols-2 md:flex md:flex-nowrap gap-2">
						{#snippet fObra()}<SelectConSaldo id="f_obra" value={filtros.obra} options={opcionesObra} placeholder="Todas" encabezadoNombre="Obra o área" claseBoton={CLASE_FILTRO} onchange={(v) => (filtros.obra = v)} />{/snippet}
						{@render filtro('f_obra', 'Obra', 'sky', 'fa-helmet-safety', !!filtros.obra, fObra)}
						{#snippet fHuellero()}<SelectConSaldo id="f_huellero" value={filtros.huellero} options={opcionesHuelleroFiltro} placeholder="Todos" encabezadoNombre="Huellero" claseBoton={CLASE_FILTRO} onchange={(v) => (filtros.huellero = v)} />{/snippet}
						{@render filtro('f_huellero', 'Huellero', 'emerald', 'fa-fingerprint', !!filtros.huellero, fHuellero)}
						{#snippet fCargo()}<SelectConSaldo id="f_cargo" value={filtros.cargo} options={opcionesCargo} placeholder="Todos" encabezadoNombre="Cargo" claseBoton={CLASE_FILTRO} onchange={(v) => (filtros.cargo = v)} />{/snippet}
						{@render filtro('f_cargo', 'Cargo', 'violet', 'fa-briefcase', !!filtros.cargo, fCargo)}
						{#snippet fRegimen()}<SelectConSaldo id="f_regimen" value={filtros.regimen} options={opcionesRegimen} placeholder="Todos" encabezadoNombre="Régimen" claseBoton={CLASE_FILTRO} onchange={(v) => (filtros.regimen = v)} />{/snippet}
						{@render filtro('f_regimen', 'Régimen', 'amber', 'fa-scale-balanced', !!filtros.regimen, fRegimen)}
						{#snippet fCategoria()}<SelectConSaldo id="f_categoria" value={filtros.categoria} options={opcionesCategoria} placeholder="Todas" encabezadoNombre="Categoría" claseBoton={CLASE_FILTRO} onchange={(v) => (filtros.categoria = v)} />{/snippet}
						{@render filtro('f_categoria', 'Categoría', 'orange', 'fa-layer-group', !!filtros.categoria, fCategoria)}
						{#snippet fIngreso()}
							<div class="flex items-center gap-1 min-w-0">
								<input id="f_ingreso" type="date" bind:value={filtros.ingresoDesde} aria-label="Ingreso desde" title="Desde" class="flex-1 md:flex-none md:w-[6.75rem] min-w-0 bg-transparent text-[11px] font-medium text-slate-700 focus:outline-none" />
								<span class="text-slate-300 text-xs">–</span>
								<input type="date" bind:value={filtros.ingresoHasta} aria-label="Ingreso hasta" title="Hasta" class="flex-1 md:flex-none md:w-[6.75rem] min-w-0 bg-transparent text-[11px] font-medium text-slate-700 focus:outline-none" />
							</div>
						{/snippet}
						{@render filtro('f_ingreso', 'Ingreso', 'rose', 'fa-calendar-day', !!(filtros.ingresoDesde || filtros.ingresoHasta), fIngreso, true)}
					</div>
					<div class="flex flex-wrap items-center justify-between gap-2 px-1 text-xs">
						<span class="text-slate-500">Mostrando <b class="text-slate-800">{filtrados.length}</b> de {personal.length} trabajadores</span>
						<div class="flex gap-2">
							<button onclick={() => (filtros = { ...FILTROS_VACIOS })} disabled={!filtrosActivos} class="px-3 py-1.5 rounded-full text-slate-600 hover:bg-slate-100 font-medium disabled:opacity-40 flex items-center gap-1.5"><i class="fas fa-rotate-left"></i> Limpiar</button>
							<button onclick={() => (filtrosAbiertos = false)} class="px-4 py-1.5 rounded-full bg-blue-600 text-white hover:bg-blue-700 font-semibold shadow-sm shadow-blue-600/20 flex items-center gap-1.5"><i class="fas fa-check"></i> Listo</button>
						</div>
					</div>
				</div>
			{:else if etiquetasFiltro.length}
				<div class="flex flex-wrap items-center gap-2 text-xs" transition:fade={{ duration: 150 }}>
					{#each etiquetasFiltro as e (e.clave)}
						<span class="inline-flex items-center gap-1.5 max-w-full pl-3 pr-1 py-1 rounded-full bg-blue-50 border border-blue-200 text-blue-800">
							<span class="truncate">{e.texto}</span>
							<button onclick={() => quitarFiltro(e.clave)} aria-label={`Quitar filtro ${e.texto}`} class="w-5 h-5 rounded-full hover:bg-blue-100 inline-flex items-center justify-center shrink-0"><i class="fas fa-xmark text-[10px]"></i></button>
						</span>
					{/each}
					<button onclick={() => (filtros = { ...FILTROS_VACIOS })} class="text-slate-500 hover:text-slate-700 hover:underline ml-1">Limpiar todo</button>
					<span class="text-slate-400 ml-auto">{filtrados.length} de {personal.length}</span>
				</div>
			{/if}

			{#if seleccionados.length && !verEliminados}
				<div class="flex flex-wrap items-center gap-3 bg-blue-50 border border-blue-200 rounded-xl px-4 py-2.5 text-sm" transition:fade={{ duration: 150 }}>
					<span class="font-medium text-blue-800">{seleccionados.length} {seleccionados.length === 1 ? 'seleccionado' : 'seleccionados'}</span>
					<button onclick={abrirMover} class="px-4 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium flex items-center gap-2">
						<i class="fas fa-right-left"></i> Mover a otra obra o área
					</button>
					<button onclick={() => (seleccionados = [])} class="text-blue-700 hover:underline">Quitar selección</button>
				</div>
			{/if}

			<div class="bg-white border border-slate-100 rounded-2xl shadow-sm overflow-hidden">
				{#if isLoading}
					<div class="flex items-center justify-center py-16 text-slate-400 gap-3">
						<i class="fas fa-spinner fa-spin text-xl text-blue-500"></i>
						<span class="text-sm font-medium">Cargando personal...</span>
					</div>
				{:else}
					<ResponsiveDataView
						items={filtrados}
						keyField="id_personal"
						columns={columnas}
						header={verEliminados ? undefined : encabezado}
						colspan={verEliminados ? columnas.length : columnas.length + 1}
						emptyMessage={busqueda ? 'Ningún trabajador coincide con la búsqueda.' : verEliminados ? 'No hay trabajadores dados de baja.' : 'Todavía no hay trabajadores. Pulsa "Nuevo trabajador".'}
						onRowDblClick={(p) => (enResumen = p)}
					>
						{#snippet row(p: Personal)}
							{#if !verEliminados}
								<td class="pl-5 py-4 w-8">
									<input type="checkbox" checked={seleccionados.includes(p.id_personal)} onchange={() => alternarSeleccion(p.id_personal)} aria-label={`Seleccionar a ${nombreCompleto(p)}`} class="w-4 h-4 accent-blue-600" />
								</td>
							{/if}
							<td class="px-5 py-4">
								<div class="font-semibold text-slate-800">{nombreCompleto(p)}</div>
								<div class="text-xs text-slate-400">{p.numero_documento ? `${p.tipo_documento} ${p.numero_documento}` : 'Sin documento'}</div>
							</td>
							<td class="px-3 py-4 w-28 font-mono text-slate-700 text-center">{p.pin}</td>
							<td class="px-5 py-4 text-slate-700">
								{puesto(p)}
								<div class={`text-xs ${p.horario ? 'text-slate-400' : 'text-amber-600'}`}>{p.horario?.nombre ?? 'Sin horario'}</div>
							</td>
							<td class="px-5 py-4 text-slate-700 whitespace-normal min-w-[11rem] max-w-[15rem]">
								{#if p.centro_costo}
									<div class="text-xs font-mono text-slate-400">{p.centro_costo.codigo}</div>
									<div class="[overflow-wrap:anywhere]" title={p.centro_costo.nombre}>{p.centro_costo.nombre}</div>
								{/if}
							</td>
							<td class="px-5 py-4 whitespace-normal min-w-[9rem] max-w-[13rem]">{@render listaHuelleros(p)}</td>
							<td class="px-5 py-4 whitespace-normal min-w-[9rem]">{@render avisos(p)}</td>
							<td class="px-5 py-4 whitespace-nowrap">{@render acciones(p)}</td>
						{/snippet}
						{#snippet card(p: Personal)}
							<div class="p-4 flex flex-col gap-2">
								<div class="flex items-start gap-3">
									{#if !verEliminados}
										<input type="checkbox" checked={seleccionados.includes(p.id_personal)} onchange={() => alternarSeleccion(p.id_personal)} aria-label={`Seleccionar a ${nombreCompleto(p)}`} class="w-5 h-5 mt-0.5 accent-blue-600 shrink-0" />
									{/if}
									<div class="min-w-0">
										<div class="font-semibold text-slate-800">{nombreCompleto(p)}</div>
										<div class="text-xs text-slate-400">{p.numero_documento ? `${p.tipo_documento} ${p.numero_documento}` : 'Sin documento'} · N.º huellero {p.pin}</div>
									</div>
								</div>
								<div class="text-sm text-slate-600 [overflow-wrap:anywhere]">{[puesto(p), p.centro_costo?.nombre, p.horario?.nombre ?? 'Sin horario'].filter(Boolean).join(' · ')}</div>
								{@render listaHuelleros(p)}
								{@render avisos(p)}
								{@render acciones(p)}
							</div>
						{/snippet}
					</ResponsiveDataView>
				{/if}
			</div>
		</div>
	</div>
</div>

<PersonalModal
	open={fichaAbierta}
	personal={enEdicion}
	{obras}
	{horarios}
	{huelleros}
	biometria={enEdicion ? biometria[enEdicion.id_personal] : null}
	onClose={() => (fichaAbierta = false)}
	onSaved={fetchPersonal}
/>

{#if moverAbierto}
	<div class="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-[100] flex items-center justify-center p-4" transition:fade={{ duration: 200 }}>
		<div class="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col" transition:scale={{ duration: 250, start: 0.95 }}>
			<div class="px-6 py-4 border-b border-slate-100 flex items-center justify-between shrink-0">
				<h2 class="text-xl font-bold text-slate-800">Mover a otra obra o área</h2>
				<button onclick={() => !moviendo && (moverAbierto = false)} disabled={moviendo} aria-label="Cerrar" class="text-slate-400 hover:text-slate-600 p-2 rounded-full hover:bg-slate-100 disabled:opacity-50">
					<i class="fas fa-times"></i>
				</button>
			</div>
			<div class="p-6 overflow-y-auto flex flex-col gap-4">
				<div class="text-sm text-slate-600">
					<b>{seleccionados.length} {seleccionados.length === 1 ? 'trabajador' : 'trabajadores'}:</b>
					{personal.filter((p) => seleccionados.includes(p.id_personal)).map(nombreCompleto).join('; ')}
				</div>
				<div class="flex flex-col gap-1.5">
					<label for="destino-mover" class="text-sm font-medium text-slate-700">Obra o área de destino *</label>
					<SelectConSaldo id="destino-mover" value={destino} options={obras} placeholder="Selecciona el destino" encabezadoNombre="Obra o área" onchange={(v) => (destino = v)} />
				</div>
				<label class="flex items-start gap-3 cursor-pointer bg-slate-50 border border-slate-100 rounded-xl p-3">
					<input type="checkbox" bind:checked={cambiarHuelleros} class="w-4 h-4 mt-0.5 accent-blue-600" />
					<span class="text-sm text-slate-700">
						<b>Cambiar también sus huelleros</b>
						<span class="block text-xs text-slate-500">Se retiran de los huelleros de su obra anterior y se registran en los de la nueva. Quienes firmaron el consentimiento llevan su huella y rostro; los demás deben registrarlos en el huellero nuevo. Otros huelleros (como el de oficina) se conservan.</span>
					</span>
				</label>
				<p class="text-xs text-slate-500">Las marcas ya registradas siguen contando para la obra donde se hicieron.</p>
			</div>
			<div class="px-6 py-4 border-t border-slate-100 flex justify-end gap-3 shrink-0">
				<button onclick={() => (moverAbierto = false)} disabled={moviendo} class="px-5 py-2.5 bg-white border border-slate-200 text-slate-600 rounded-xl hover:bg-slate-50 font-medium text-sm disabled:opacity-50">Cancelar</button>
				<button onclick={confirmarMover} disabled={moviendo} class="px-5 py-2.5 bg-blue-600 text-white rounded-xl hover:bg-blue-700 font-medium text-sm shadow-md shadow-blue-600/20 disabled:opacity-50 flex items-center gap-2">
					{#if moviendo}<i class="fas fa-spinner fa-spin"></i>{/if} Mover
				</button>
			</div>
		</div>
	</div>
{/if}

<PersonalResumen
	personal={enResumen}
	{huelleros}
	biometria={enResumen ? biometria[enResumen.id_personal] : null}
	onEditar={verEliminados ? undefined : (p) => { enResumen = null; paraEditar = p; }}
	onClose={() => (enResumen = null)}
/>

<AdminConfirmModal
	open={!!paraEditar}
	title="Autorizar edición"
	message={paraEditar ? `Para editar la ficha de ${nombreCompleto(paraEditar)} ingresa el correo y la contraseña de un administrador o developer.` : ''}
	confirmLabel="Autorizar y editar"
	onConfirm={autorizarEdicion}
	onClose={() => (paraEditar = null)}
/>

<AdminConfirmModal
	open={!!paraDarDeBaja}
	title="Eliminar trabajador"
	message={paraDarDeBaja ? `¿Eliminar (dar de baja) a ${nombreCompleto(paraDarDeBaja)}? Dejará de aparecer en el listado y se retirará de sus huelleros; un administrador puede restaurarlo desde "Ver eliminados". Ingresa el correo y la contraseña de un administrador o developer.` : ''}
	confirmLabel="Eliminar"
	onConfirm={confirmarDarDeBaja}
	onClose={() => (paraDarDeBaja = null)}
/>

<ConfirmModal
	open={!!paraRestaurar}
	title="Restaurar trabajador"
	danger={false}
	message={paraRestaurar ? `¿Restaurar a ${nombreCompleto(paraRestaurar)}? Volverá al listado de personal.` : ''}
	confirmLabel="Restaurar"
	onConfirm={confirmarRestaurar}
	onClose={() => (paraRestaurar = null)}
/>

<AdminConfirmModal
	open={!!paraEliminar}
	title="Eliminar ficha permanentemente"
	message={paraEliminar ? `Vas a eliminar PERMANENTEMENTE la ficha de ${nombreCompleto(paraEliminar)}. Sus marcaciones se conservan. Esta acción no se puede deshacer. Ingresa el correo y la contraseña de un administrador para continuar.` : ''}
	confirmLabel="Eliminar permanentemente"
	onConfirm={confirmarEliminar}
	onClose={() => (paraEliminar = null)}
/>
