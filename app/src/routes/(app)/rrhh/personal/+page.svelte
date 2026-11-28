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
	import {
		CATEGORIAS,
		usaCategoria,
		etiquetaCategoria,
		TODOS_REGIMENES as REGIMENES,
		etiqueta,
		nombreCompleto,
		fichaIncompleta,
		obrasDe,
		huellerosSinHuella,
		huellerosSinRostro,
		alertasVencimiento,
		hoyLima,
		getPersonal,
		darDeBajaPersonal,
		restaurarPersonal,
		eliminarPersonalPermanente,
		getBiometriaGuardada,
		VINCULOS,
		TAMANOS_EMPRESA,
		vinculoDe,
		empleadorDe,
		unidadMonto,
		etiquetaPeriodicidad,
		type Personal
	} from '$lib/modules/personal/services/personal.service';
	import SelectConSaldo from '$lib/shared/components/SelectConSaldo.svelte';
	import { toDriveThumbnailUrl } from '$lib/shared/drivePreview';
	import { fade } from 'svelte/transition';
	import { EMPRESA_NOMBRE } from '$lib/shared/empresaConstantes';

	let personal = $state<Personal[]>([]);
	let enHuelleros = $state<Record<string, EstadoEnHuellero>>({});
	let biometria = $state<Record<number, { huellas: number; rostros: number }>>({});
	let obras = $state<{ value: string; label: string; grupo: string }[]>([]);
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
		} catch (err) {
			toast.error(`No se pudo cargar el personal. ${describeError(err)}`);
		} finally {
			isLoading = false;
		}
	}

	function toggleVerEliminados() {
		verEliminados = !verEliminados;
		fetchPersonal();
	}

	onDestroy(setMobileFab(() => abrirFicha(null), 'Nuevo trabajador'));

	onMount(async () => {
		fetchPersonal();
		try {
			obras = await getObrasParaHuellero(supabase);
		} catch (err) {
			toast.error(`No se pudieron cargar las obras y áreas. ${describeError(err)}`);
		}
	});

	const normalizar = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

	const fechaCorta = (f: string) => new Date(`${f}T00:00:00`).toLocaleDateString('es-PE');

	// ── Filtros ── ('' = todos; NINGUNO = sin obra / sin huellero)
	/** Contadores "sin huella" / "sin rostro" de arriba: al pulsar uno muestra solo a esos trabajadores. */
	let soloSinHuella = $state(false);
	let soloSinRostro = $state(false);
	const NINGUNO = '__ninguno';
	const FILTROS_VACIOS = { obra: '', empleador: '', huellero: '', cargo: '', regimen: '', categoria: '', ingresoDesde: '', ingresoHasta: '' };
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
	/** Filtros del panel "Más filtros" (obra y empleador están a la vista). */
	const filtrosAvanzados = $derived(
		[filtros.huellero, filtros.cargo, filtros.regimen, filtros.categoria, filtros.ingresoDesde || filtros.ingresoHasta].filter(Boolean).length
	);
	const hayFiltros = $derived(!!busqueda.trim() || Object.values(filtros).some(Boolean) || soloSinHuella || soloSinRostro);
	function limpiarFiltros() {
		filtros = { ...FILTROS_VACIOS };
		busqueda = '';
		soloSinHuella = soloSinRostro = false;
	}

	/** Nombre de la empresa en formato título ("CASALLO & MELCHOR S.A.C." → "Casallo & Melchor S.A.C."). */
	const EMPRESA = EMPRESA_NOMBRE.split(' ')
		.map((w) => (w.includes('.') || w.length <= 1 ? w : w[0] + w.slice(1).toLowerCase()))
		.join(' ');
	const soles = (n: number) => `S/ ${Number(n).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
	const opcionesEmpleador = $derived([
		{ value: '', label: 'Todos los empleadores' },
		...[...new Set(personal.map((p) => empleadorDe(p, EMPRESA)).filter(Boolean))].sort((a, b) => a.localeCompare(b)).map((e) => ({ value: e, label: e }))
	]);

	const opcionesObra = $derived.by(() => {
		const vistas = new Map<number, string>();
		for (const p of personal) {
			if (p.id_centro_costo && p.centro_costo) vistas.set(p.id_centro_costo, `${p.centro_costo.codigo} · ${p.centro_costo.nombre}`);
			for (const o of p.personal_obra ?? []) if (o.centro_costo) vistas.set(o.id_centro_costo, `${o.centro_costo.codigo} · ${o.centro_costo.nombre}`);
		}
		return [
			{ value: '', label: 'Todas las áreas y obras' },
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
			if (soloSinHuella && !huellerosSinHuella(p).length) return false;
			if (soloSinRostro && !huellerosSinRostro(p).length) return false;
			if (q && !normalizar([nombreCompleto(p), p.numero_documento, p.pin, p.cargo, p.centro_costo?.nombre, p.referente_nombre].filter(Boolean).join(' ')).includes(q)) return false;
			if (f.empleador && empleadorDe(p, EMPRESA) !== f.empleador) return false;
			// Cualquiera de sus obras o áreas (no solo la principal).
			if (f.obra && (f.obra === NINGUNO ? obrasDe(p).length : !obrasDe(p).includes(Number(f.obra)))) return false;
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
	// ── Agrupar (Área u obra / Empleador / Vínculo) y páginas ──
	type Agrupar = 'obra' | 'empleador' | 'vinculo' | 'ninguno';
	const OPCIONES_AGRUPAR = [
		{ value: 'obra', label: 'Área u obra' },
		{ value: 'empleador', label: 'Empleador' },
		{ value: 'vinculo', label: 'Vínculo' },
		{ value: 'ninguno', label: 'Sin agrupar' }
	];
	let agrupar = $state<Agrupar>('obra');
	const TIPO_LUGAR: Record<string, { texto: string; icono: string }> = {
		'bolsa general': { texto: 'Corporativo', icono: 'fa-building' },
		consultoria: { texto: 'Consultoría', icono: 'fa-building' },
		proyecto: { texto: 'Obra', icono: 'fa-helmet-safety' },
		obra: { texto: 'Obra', icono: 'fa-helmet-safety' }
	};
	type Grupo = { clave: string; titulo: string; icono: string; orden: string };
	function grupoDe(p: Personal): Grupo {
		if (agrupar === 'empleador') {
			const e = empleadorDe(p, EMPRESA);
			return { clave: `e:${e}`, titulo: e || 'Sin empleador', icono: 'fa-briefcase', orden: e ? `0${e}` : '1' };
		}
		if (agrupar === 'vinculo') {
			const v = vinculoDe(p);
			return { clave: `v:${v}`, titulo: etiqueta(VINCULOS, v), icono: v === 'subcontratista' ? 'fa-people-carry-box' : 'fa-id-badge', orden: v };
		}
		if (agrupar === 'ninguno') return { clave: 'todos', titulo: '', icono: '', orden: '' };
		const cc = p.centro_costo;
		if (!cc) return { clave: 'cc:ninguno', titulo: 'Sin obra o área', icono: 'fa-circle-question', orden: '9' };
		const tipo = TIPO_LUGAR[cc.tipo ?? ''] ?? { texto: 'Área', icono: 'fa-building' };
		const nombre = normalizar(cc.nombre) === normalizar(tipo.texto) ? cc.codigo : `${cc.codigo} — ${cc.nombre}`;
		const rango = cc.tipo === 'bolsa general' ? '0' : cc.tipo === 'consultoria' ? '1' : '2';
		return { clave: `cc:${p.id_centro_costo}`, titulo: `${tipo.texto} · ${nombre}`, icono: tipo.icono, orden: `${rango}${cc.codigo}${cc.nombre}` };
	}
	/** Filtrados en el orden de sus grupos (dentro de cada grupo, por apellidos como llegan de la base). */
	const ordenados = $derived.by(() => {
		const conGrupo = filtrados.map((p, i) => ({ p, g: grupoDe(p), i }));
		conGrupo.sort((a, b) => a.g.orden.localeCompare(b.g.orden) || a.i - b.i);
		return conGrupo;
	});
	const conteoGrupo = $derived(ordenados.reduce<Record<string, number>>((acc, { g }) => ((acc[g.clave] = (acc[g.clave] ?? 0) + 1), acc), {}));
	const POR_PAGINA = 25;
	let pagina = $state(1);
	const totalPaginas = $derived(Math.max(1, Math.ceil(ordenados.length / POR_PAGINA)));
	const paginaActual = $derived(Math.min(pagina, totalPaginas));
	const paginaItems = $derived(ordenados.slice((paginaActual - 1) * POR_PAGINA, paginaActual * POR_PAGINA));
	const gruposPagina = $derived.by(() => {
		const lista: (Grupo & { items: Personal[] })[] = [];
		for (const { p, g } of paginaItems) {
			const ultimo = lista[lista.length - 1];
			if (ultimo?.clave === g.clave) ultimo.items.push(p);
			else lista.push({ ...g, items: [p] });
		}
		return lista;
	});
	// Al cambiar búsqueda, filtros o agrupación se vuelve a la primera página.
	$effect(() => {
		void filtrados;
		void agrupar;
		pagina = 1;
	});
	let colapsados = $state<string[]>([]);
	const alternarGrupo = (clave: string) =>
		(colapsados = colapsados.includes(clave) ? colapsados.filter((c) => c !== clave) : [...colapsados, clave]);
	/** Huellero en oficina/corporativo (ícono de edificio) o en obra (ícono de ubicación). */
	const esOficina = (h: HuelleroElegible) => obras.some((o) => o.value === String(h.id_centro_costo) && o.grupo !== 'Obras');

	const incompletas = $derived(personal.filter(fichaIncompleta).length);
	const sinHuella = $derived(personal.filter((p) => huellerosSinHuella(p).length > 0).length);
	const sinRostro = $derived(personal.filter((p) => huellerosSinRostro(p).length > 0).length);
	/** La base aún no informa huellas (falta la migración 20261103130000): el aviso "sin huella" no puede calcularse. */
	const revisionHuellaInactiva = $derived(personal.some((p) => p.personal_huellero?.some((v) => v.huellas === undefined)));
	const conAlertas = $derived(personal.filter((p) => alertasVencimiento(p, hoy).length > 0).length);

	function puesto(p: Personal): string {
		// Ticket #151 (27/11/2026): primero el cargo principal vigente (personal.cargo se sincroniza con el historial de
		// cargos); antes, con régimen Contrata o Locación salía "Contrata (anterior)" o vacío.
		if (p.cargo?.trim()) return p.cargo.trim();
		if (usaCategoria(p.regimen)) return etiquetaCategoria(p.categoria) || etiqueta(REGIMENES, p.regimen);
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

</script>

<svelte:head>
	<title>Personal | Personal y Asistencia - Construni ERP</title>
</svelte:head>

{#snippet avisos(p: Personal)}
	{@const vencimientos = alertasVencimiento(p, hoy)}
	{@const faltaHuella = !verEliminados ? huellerosSinHuella(p).length : 0}
	{@const faltaRostro = !verEliminados ? huellerosSinRostro(p).length : 0}
	{@const sinHuellero = !verEliminados && !p.personal_huellero?.length}
	{@const errorEnvio = !verEliminados && huellerosDe(p).some((h) => enHuelleros[claveEnHuellero(p.pin, h.id_dispositivo)] === 'error')}
	<div class="flex flex-wrap gap-1 max-w-[12rem]">
		{#if faltaHuella}
			<span class="aviso bg-rose-50 text-rose-700 border-rose-200" title="Debe registrar su huella en el huellero">
				<i class="fas fa-triangle-exclamation"></i> Falta registrar huella{faltaHuella > 1 ? ` (${faltaHuella} eq.)` : ''}
			</span>
		{/if}
		{#if faltaRostro}
			<span class="aviso bg-emerald-50 text-emerald-700 border-emerald-200" title="Debe registrar su rostro en el huellero">
				<i class="fas fa-face-smile"></i> Falta tomar rostro{faltaRostro > 1 ? ` (${faltaRostro} eq.)` : ''}
			</span>
		{/if}
		{#if fichaIncompleta(p)}
			<span class="aviso bg-amber-50 text-amber-700 border-amber-200" title="Faltan datos obligatorios en la ficha"><i class="fas fa-file-pen"></i> Ficha incompleta</span>
		{/if}
		{#if sinHuellero}
			<span class="aviso bg-slate-50 text-slate-500 border-slate-200" title="Elige sus huelleros en la ficha"><i class="fas fa-fingerprint"></i> Sin huellero asignado</span>
		{/if}
		{#if errorEnvio}
			<span class="aviso bg-rose-50 text-rose-700 border-rose-200" title="Usa Sincronizar en Huelleros para reintentar"><i class="fas fa-circle-exclamation"></i> Error al enviar al huellero</span>
		{/if}
		{#each vencimientos as alerta}
			<span class={`aviso ${alerta.vencido ? 'bg-rose-50 text-rose-700 border-rose-200' : 'bg-amber-50 text-amber-700 border-amber-200'}`}><i class="fas fa-triangle-exclamation"></i> {alerta.texto}</span>
		{/each}
		{#if biometria[p.id_personal]}
			<span class="aviso bg-slate-50 text-slate-500 border-slate-200" title="Huella o rostro guardados cifrados: se copian solos al cambiar de huellero"><i class="fas fa-lock"></i> Biometría guardada</span>
		{/if}
		{#if !verEliminados && !faltaHuella && !faltaRostro && !fichaIncompleta(p) && !sinHuellero && !errorEnvio && !vencimientos.length}
			<span class="aviso bg-emerald-50 text-emerald-700 border-emerald-200"><i class="fas fa-check"></i> Sin pendientes</span>
		{/if}
	</div>
{/snippet}

{#snippet vinculo(p: Personal)}
	{@const v = vinculoDe(p)}
	<div class="flex flex-col items-start gap-1 min-w-0">
		<span class={`text-[11px] font-semibold px-2 py-0.5 rounded-md ${v === 'subcontratista' ? 'bg-violet-50 text-violet-700' : 'bg-blue-50 text-blue-700'}`}>{etiqueta(VINCULOS, v)}</span>
		{#if empleadorDe(p, EMPRESA)}
			<span class="text-xs text-slate-700 [overflow-wrap:anywhere]" title={p.empleador_ruc ? `RUC ${p.empleador_ruc}` : undefined}>{empleadorDe(p, EMPRESA)}</span>
		{/if}
		{#if p.empleador_tamano}
			<span class="text-[10px] px-1.5 py-px rounded border border-slate-200 bg-slate-50 text-slate-500">{etiqueta(TAMANOS_EMPRESA, p.empleador_tamano)}</span>
		{/if}
		{#if p.referente_nombre}
			<span class="text-[11px] text-slate-500 [overflow-wrap:anywhere]" title="Superior inmediato / encargado (referente)">
				<i class="fas fa-user-tie text-violet-400"></i> {p.referente_nombre}{p.referente_cargo ? ` · ${p.referente_cargo}` : ''}
			</span>
		{/if}
	</div>
{/snippet}

{#snippet salario(p: Personal)}
	{#if p.monto_pago != null && p.periodicidad_pago}
		<div class="flex flex-col items-start gap-1">
			<span class="font-bold text-slate-800 whitespace-nowrap">{soles(p.monto_pago)}{#if unidadMonto(p.periodicidad_pago)}<span class="text-xs font-semibold text-slate-500"> {unidadMonto(p.periodicidad_pago)}</span>{/if}</span>
			<span class="text-[11px] font-semibold px-2 py-0.5 rounded-md bg-sky-50 text-sky-700">{etiquetaPeriodicidad(p.periodicidad_pago)}</span>
			{#if p.monto_pago_desde}<span class="text-[11px] text-slate-400">Desde {fechaCorta(p.monto_pago_desde)}</span>{/if}
		</div>
	{:else}
		<span class="text-xs text-slate-300" title="Se indica en la ficha: periodicidad y monto de pago">—</span>
	{/if}
{/snippet}

{#snippet listaHuelleros(p: Personal)}
	{@const suyos = huellerosDe(p)}
	<div class="flex flex-col gap-1 min-w-0">
		{#each suyos as h (h.id_dispositivo)}
			{@const estado = enHuelleros[claveEnHuellero(p.pin, h.id_dispositivo)]}
			{@const bio = p.personal_huellero?.find((v) => v.id_dispositivo === h.id_dispositivo)}
			<div class="flex flex-col items-start gap-0.5 min-w-0" title={`${h.lugar} · Serie ${h.numero_serie}`}>
				<span class="text-[11px] text-slate-700 flex items-center gap-1 min-w-0 max-w-full">
					<i class={`fas ${esOficina(h) ? 'fa-building' : 'fa-location-dot'} text-slate-400`}></i>
					<span class="truncate">{h.nombre}</span>
					<span class={`shrink-0 inline-flex items-center gap-1 ${h.en_linea ? 'text-emerald-600' : 'text-slate-400'}`}>
						<span class={`w-1.5 h-1.5 rounded-full ${h.en_linea ? 'bg-emerald-500' : 'bg-slate-300'}`}></span>{h.en_linea ? 'En línea' : 'Desconectado'}
					</span>
				</span>
				{#if bio?.huellas && bio?.rostros}
					<span class="chip bg-indigo-50 text-indigo-700"><i class="fas fa-fingerprint"></i> Huella y rostro</span>
				{:else if bio?.huellas}
					<span class="chip bg-emerald-50 text-emerald-700"><i class="fas fa-fingerprint"></i> Huella registrada</span>
				{:else if bio?.rostros}
					<span class="chip bg-emerald-50 text-emerald-700"><i class="fas fa-face-smile"></i> Rostro registrado</span>
				{/if}
				{#if !verEliminados && (estado === 'enviando' || estado === 'error')}
					<span class={`chip border ${ESTADO_ENVIO[estado].clase}`} title={ESTADO_ENVIO[estado].ayuda}><i class={`fas ${ESTADO_ENVIO[estado].icono}`}></i> {ESTADO_ENVIO[estado].texto}</span>
				{/if}
			</div>
		{:else}
			<span class="text-xs text-slate-300">Sin huellero</span>
		{/each}
		<span class="text-[11px] font-mono text-slate-400" title="Número en huellero: el ID con el que marca">ID {p.pin}</span>
	</div>
{/snippet}

{#snippet filtro(id: string, titulo: string, tono: keyof typeof TONOS_FILTRO, icono: string, activo: boolean, control: import('svelte').Snippet, fijo = false)}
	<!-- En pantallas medianas o más, los filtros van en una sola fila: el nombre se ve desde xl; antes, solo el ícono (con tooltip). -->
	<div title={titulo} class={`flex items-center gap-1.5 h-9 pl-3 pr-2 rounded-full border transition-colors min-w-0 ${fijo ? 'md:shrink-0' : 'md:flex-1 md:basis-0'} ${activo ? TONOS_FILTRO[tono].activo : 'bg-white border-slate-200 hover:border-slate-300'}`}>
		<i class={`fas ${icono} text-xs shrink-0 ${TONOS_FILTRO[tono].icono}`}></i>
		<label for={id} class={`text-[11px] font-semibold shrink-0 md:hidden xl:inline ${activo ? TONOS_FILTRO[tono].texto : 'text-slate-400'}`}>{titulo}</label>
		<div class="flex-1 min-w-0">{@render control()}</div>
	</div>
{/snippet}

{#snippet foto(p: Personal, tam: string)}
	<div class={`${tam} rounded-full bg-slate-100 border border-slate-200 overflow-hidden shrink-0 flex items-center justify-center`}>
		{#if p.foto_url}
			<img src={toDriveThumbnailUrl(p.foto_url, 120)} alt="" loading="lazy" referrerpolicy="no-referrer" class="w-full h-full object-cover" />
		{:else}
			<i class="fas fa-user text-slate-300"></i>
		{/if}
	</div>
{/snippet}

{#snippet acciones(p: Personal)}
	<div class="flex items-center justify-end gap-1.5">
		<button onclick={() => (enResumen = p)} title="Ficha" aria-label={`Ver ficha de ${nombreCompleto(p)}`} class="accion text-blue-600 hover:bg-blue-50">
			<i class="fas fa-circle-info"></i>
		</button>
		<a href={`/rrhh/asistencia?p=${p.id_personal}`} title="Calendario de asistencia" aria-label={`Ver asistencia de ${nombreCompleto(p)}`} class="accion text-blue-600 hover:bg-blue-50">
			<i class="fas fa-calendar-check"></i>
		</a>
		{#if verEliminados}
			<button onclick={() => (paraRestaurar = p)} title="Restaurar" aria-label={`Restaurar a ${nombreCompleto(p)}`} class="accion text-emerald-600 hover:bg-emerald-50">
				<i class="fas fa-rotate-left"></i>
			</button>
			<button onclick={() => (paraEliminar = p)} title="Eliminar permanentemente" aria-label={`Eliminar permanentemente a ${nombreCompleto(p)}`} class="accion text-rose-600 hover:bg-rose-50">
				<i class="fas fa-trash"></i>
			</button>
		{:else}
			<button onclick={() => (paraEditar = p)} title={fichaIncompleta(p) ? 'Completar ficha (pide administrador)' : 'Editar (pide administrador)'} aria-label={`Editar a ${nombreCompleto(p)}`} class="accion text-blue-600 hover:bg-blue-50">
				<i class="fas fa-pen"></i>
			</button>
			<button onclick={() => (paraDarDeBaja = p)} title="Eliminar / dar de baja (pide administrador)" aria-label={`Eliminar a ${nombreCompleto(p)}`} class="accion text-rose-600 hover:bg-rose-50">
				<i class="fas fa-trash"></i>
			</button>
		{/if}
	</div>
{/snippet}

{#snippet puestoCelda(p: Personal)}
	<div class="text-sm text-slate-700">{puesto(p) || '—'}</div>
	<div class={`text-[11px] ${p.horario ? 'text-slate-400' : 'text-amber-600'}`}>{p.horario?.nombre ?? 'Sin horario'}</div>
	{#if agrupar !== 'obra' && p.centro_costo}
		<div class="text-[11px] text-slate-500 [overflow-wrap:anywhere]"><span class="font-mono text-sky-700">{p.centro_costo.codigo}</span> · {p.centro_costo.nombre}</div>
	{/if}
	{#each (p.personal_obra ?? []).filter((o) => o.id_centro_costo !== p.id_centro_costo && o.centro_costo) as o (o.id_centro_costo)}
		<div class="text-[11px] text-slate-500 [overflow-wrap:anywhere]" title="También asignado a esta obra o área"><i class="fas fa-plus text-[8px] text-slate-400"></i> <span class="font-mono text-sky-700">{o.centro_costo?.codigo}</span> · {o.centro_costo?.nombre}</div>
	{/each}
{/snippet}

<div class="flex flex-col md:h-[calc(100vh-80px)] md:overflow-hidden bg-slate-50/50">
	<!-- Encabezado -->
	<div class="flex-shrink-0 px-4 sm:px-6 py-4 flex flex-col md:flex-row md:items-start justify-between gap-3 border-b border-slate-100 bg-white">
		<div class="flex items-center gap-3 min-w-0">
			<div class={`w-12 h-12 rounded-2xl shrink-0 flex items-center justify-center text-xl ${verEliminados ? 'bg-rose-50 text-rose-500' : 'bg-blue-50 text-blue-600'}`}>
				<i class={`fas ${verEliminados ? 'fa-user-slash' : 'fa-users'}`}></i>
			</div>
			<div class="min-w-0">
				<div class="flex flex-wrap items-center gap-2">
					<h1 class="font-bold text-slate-800 text-2xl">{verEliminados ? 'Personal dado de baja' : 'Personal'}</h1>
					{#if verEliminados}
						<span class="text-[10px] font-bold px-2 py-0.5 rounded-md bg-rose-50 text-rose-600 border border-rose-200 uppercase tracking-wide">Solo administradores</span>
					{/if}
				</div>
				<p class="text-sm text-slate-500">
					{verEliminados ? 'Restáuralos o elimina su ficha permanentemente (sus marcaciones se conservan).' : 'Gestiona trabajadores de oficina y obra.'}
				</p>
			</div>
		</div>
		<div class="flex flex-col items-stretch md:items-end gap-2 shrink-0">
			<div class="flex items-center gap-2 md:justify-end">
				{#if puedeVerEliminados()}
					<button onclick={toggleVerEliminados} class={`px-4 py-2 rounded-xl font-medium text-sm transition-colors shadow-sm flex items-center gap-2 whitespace-nowrap ${verEliminados ? 'bg-slate-800 text-white hover:bg-slate-900' : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'}`}>
						<i class={`fas ${verEliminados ? 'fa-arrow-left' : 'fa-trash-can'}`}></i>
						{verEliminados ? 'Volver' : 'Ver eliminados'}
					</button>
				{/if}
				{#if !verEliminados}
					<button onclick={() => abrirFicha(null)} class="hidden md:flex px-5 py-2 bg-orange-500 text-white rounded-xl hover:bg-orange-600 font-semibold text-sm shadow-md shadow-orange-500/25 items-center gap-2">
						<i class="fas fa-plus"></i> Nuevo trabajador
					</button>
				{/if}
			</div>
			{#if !verEliminados}
				<div class="flex flex-wrap gap-2 text-xs md:justify-end">
					<span class="contador bg-slate-100 border-slate-200 text-slate-700"><i class="fas fa-users text-slate-500"></i> {personal.length} trabajadores</span>
					{#if sinHuella || soloSinHuella}
						<button onclick={() => (soloSinHuella = !soloSinHuella)} title={soloSinHuella ? 'Mostrar a todos' : 'Mostrar solo a quienes les falta registrar su huella'} class={`contador ${soloSinHuella ? 'bg-rose-100 border-rose-300 text-rose-800 ring-2 ring-rose-200' : 'bg-rose-50 border-rose-200 text-rose-700 hover:bg-rose-100'}`}>
							<i class="fas fa-fingerprint"></i> {sinHuella} sin huella {#if soloSinHuella}<i class="fas fa-xmark"></i>{/if}
						</button>
					{/if}
					{#if sinRostro || soloSinRostro}
						<button onclick={() => (soloSinRostro = !soloSinRostro)} title={soloSinRostro ? 'Mostrar a todos' : 'Mostrar solo a quienes les falta tomar el rostro'} class={`contador ${soloSinRostro ? 'bg-emerald-100 border-emerald-300 text-emerald-800 ring-2 ring-emerald-200' : 'bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100'}`}>
							<i class="fas fa-face-smile"></i> {sinRostro} sin rostro {#if soloSinRostro}<i class="fas fa-xmark"></i>{/if}
						</button>
					{/if}
					{#if incompletas}<span class="contador bg-amber-50 border-amber-200 text-amber-700"><i class="fas fa-file-lines"></i> {incompletas} fichas incompletas</span>{/if}
					{#if conAlertas}<span class="contador bg-orange-50 border-orange-200 text-orange-700"><i class="fas fa-triangle-exclamation"></i> {conAlertas} con SCTR/examen por vencer</span>{/if}
				</div>
			{/if}
		</div>
	</div>

	<div class="flex-1 overflow-y-auto p-4 sm:p-6">
		<div class="max-w-[1400px] mx-auto flex flex-col gap-4">
			<!-- Filtros principales -->
			<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto] gap-3 items-end">
				<div class="relative min-w-0 sm:col-span-2 lg:col-span-1">
					<i class="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm"></i>
					<input bind:value={busqueda} aria-label="Buscar" placeholder="Buscar por nombre, DNI, número u obra" class="w-full pl-9 pr-3 py-2.5 border border-slate-200 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-400" />
				</div>
				<div class="flex flex-col gap-1 min-w-0">
					<label for="f_obra" class="text-xs font-medium text-slate-600">Área u obra</label>
					<SelectConSaldo id="f_obra" value={filtros.obra} options={opcionesObra} placeholder="Todas las áreas y obras" encabezadoNombre="Área u obra" onchange={(v) => (filtros.obra = v)} />
				</div>
				<div class="flex flex-col gap-1 min-w-0">
					<label for="f_empleador" class="text-xs font-medium text-slate-600">Empleador</label>
					<SelectConSaldo id="f_empleador" value={filtros.empleador} options={opcionesEmpleador} placeholder="Todos los empleadores" encabezadoNombre="Empleador" onchange={(v) => (filtros.empleador = v)} />
				</div>
				<div class="flex flex-col gap-1 min-w-0">
					<label for="f_agrupar" class="text-xs font-medium text-slate-600">Agrupar por</label>
					<SelectConSaldo id="f_agrupar" value={agrupar} options={OPCIONES_AGRUPAR} placeholder="Área u obra" encabezadoNombre="Agrupar por" onchange={(v) => (agrupar = (v || 'obra') as Agrupar)} />
				</div>
				<div class="flex items-center gap-3 sm:col-span-2 lg:col-span-1 h-[42px]">
					<button
						onclick={() => (filtrosAbiertos = !filtrosAbiertos)}
						aria-expanded={filtrosAbiertos}
						class={`px-3 py-2 rounded-xl text-sm font-medium border flex items-center gap-2 transition-colors whitespace-nowrap ${filtrosAbiertos || filtrosAvanzados ? 'bg-orange-50 border-orange-200 text-orange-700' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}`}
					>
						<i class="fas fa-sliders"></i> Más filtros
						{#if filtrosAvanzados}<span class="min-w-5 h-5 px-1.5 rounded-full bg-orange-500 text-white text-[11px] font-bold inline-flex items-center justify-center">{filtrosAvanzados}</span>{/if}
					</button>
					<button onclick={limpiarFiltros} disabled={!hayFiltros} class="text-sm font-semibold text-orange-600 hover:text-orange-700 hover:underline disabled:text-slate-300 disabled:no-underline whitespace-nowrap">Limpiar filtros</button>
				</div>
			</div>

			{#if filtrosAbiertos}
				<div class="bg-white border border-slate-100 rounded-2xl shadow-sm p-3 flex flex-col gap-3" transition:fade={{ duration: 150 }}>
					<div class="grid grid-cols-1 sm:grid-cols-2 md:flex md:flex-nowrap gap-2">
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
					<div class="flex justify-end">
						<button onclick={() => (filtrosAbiertos = false)} class="px-4 py-1.5 rounded-full bg-orange-500 text-white hover:bg-orange-600 text-xs font-semibold flex items-center gap-1.5"><i class="fas fa-check"></i> Listo</button>
					</div>
				</div>
			{:else if etiquetasFiltro.length}
				<div class="flex flex-wrap items-center gap-2 text-xs" transition:fade={{ duration: 150 }}>
					{#each etiquetasFiltro as e (e.clave)}
						<span class="inline-flex items-center gap-1.5 max-w-full pl-3 pr-1 py-1 rounded-full bg-orange-50 border border-orange-200 text-orange-800">
							<span class="truncate">{e.texto}</span>
							<button onclick={() => quitarFiltro(e.clave)} aria-label={`Quitar filtro ${e.texto}`} class="w-5 h-5 rounded-full hover:bg-orange-100 inline-flex items-center justify-center shrink-0"><i class="fas fa-xmark text-[10px]"></i></button>
						</span>
					{/each}
				</div>
			{/if}

			{#if revisionHuellaInactiva && !verEliminados}
				<div class="flex items-start gap-2 bg-amber-50 border border-amber-200 text-amber-800 rounded-xl px-4 py-2.5 text-sm">
					<i class="fas fa-triangle-exclamation mt-0.5"></i>
					<span>La revisión de <b>huella registrada</b> no está activa en esta base: falta aplicar la migración <code class="text-xs">20261103130000_huella_por_huellero</code>. Mientras tanto no se puede avisar quién no tiene huella.</span>
				</div>
			{/if}

			<div class="bg-white border border-slate-100 rounded-2xl shadow-sm overflow-clip">
				{#if isLoading}
					<div class="flex items-center justify-center py-16 text-slate-400 gap-3">
						<i class="fas fa-spinner fa-spin text-xl text-orange-500"></i>
						<span class="text-sm font-medium">Cargando personal...</span>
					</div>
				{:else if !ordenados.length}
					<div class="py-16 text-center text-sm text-slate-400">
						{hayFiltros || soloSinHuella || soloSinRostro ? 'Ningún trabajador coincide con los filtros.' : verEliminados ? 'No hay trabajadores dados de baja.' : 'Todavía no hay trabajadores. Pulsa "Nuevo trabajador".'}
					</div>
				{:else}
					<!-- Escritorio: tabla agrupada -->
					<table class="hidden md:table w-full text-left text-sm">
						<thead class="text-xs text-slate-600 font-semibold">
							<tr>
								<th class="sticky top-0 z-10 bg-slate-100 px-4 py-3">Trabajador</th>
								<th class="sticky top-0 z-10 bg-slate-100 px-4 py-3">Vínculo y empleador</th>
								<th class="sticky top-0 z-10 bg-slate-100 px-4 py-3">Puesto</th>
								<th class="sticky top-0 z-10 bg-slate-100 px-4 py-3">Salario vigente</th>
								<th class="sticky top-0 z-10 bg-slate-100 px-4 py-3">Huelleros</th>
								<th class="sticky top-0 z-10 bg-slate-100 px-4 py-3">Avisos</th>
								<th class="sticky top-0 z-10 bg-slate-100 px-4 py-3 text-center">Acciones</th>
							</tr>
						</thead>
						{#each gruposPagina as g (g.clave)}
							<tbody>
								{#if agrupar !== 'ninguno'}
									<tr class="bg-slate-50 border-y border-slate-100">
										<td colspan="7" class="p-0">
											<button onclick={() => alternarGrupo(g.clave)} aria-expanded={!colapsados.includes(g.clave)} class="w-full flex items-center gap-2 px-4 py-2.5 text-left hover:bg-slate-100/70">
												<i class={`fas ${g.icono} text-slate-500`}></i>
												<span class="text-xs font-bold text-slate-700 uppercase tracking-wide [overflow-wrap:anywhere]">{g.titulo}</span>
												<span class="min-w-6 h-5 px-1.5 rounded-full bg-slate-200 text-slate-600 text-[11px] font-bold inline-flex items-center justify-center">{conteoGrupo[g.clave] ?? g.items.length}</span>
												<i class={`fas fa-chevron-down ml-auto text-slate-400 text-xs transition-transform ${colapsados.includes(g.clave) ? '-rotate-90' : ''}`}></i>
											</button>
										</td>
									</tr>
								{/if}
								{#if !colapsados.includes(g.clave)}
									{#each g.items as p (p.id_personal)}
										<tr class="border-b border-slate-100 hover:bg-orange-50/30 align-middle" ondblclick={() => (enResumen = p)}>
											<td class="px-4 py-3">
												<div class="flex items-center gap-3 min-w-[12rem]">
													{@render foto(p, 'w-11 h-11')}
													<div class="min-w-0">
														<div class="font-semibold text-slate-800 [overflow-wrap:anywhere]">{nombreCompleto(p)}</div>
														<div class="text-xs text-slate-500">{p.numero_documento ? `${p.tipo_documento} ${p.numero_documento}` : 'Sin documento'}</div>
													</div>
												</div>
											</td>
											<td class="px-4 py-3 min-w-[10rem] max-w-[14rem]">{@render vinculo(p)}</td>
											<td class="px-4 py-3 min-w-[8rem] max-w-[13rem]">{@render puestoCelda(p)}</td>
											<td class="px-4 py-3 min-w-[8rem]">{@render salario(p)}</td>
											<td class="px-4 py-3 min-w-[9rem] max-w-[13rem]">{@render listaHuelleros(p)}</td>
											<td class="px-4 py-3 min-w-[9rem]">{@render avisos(p)}</td>
											<td class="px-4 py-3 whitespace-nowrap">{@render acciones(p)}</td>
										</tr>
									{/each}
								{/if}
							</tbody>
						{/each}
					</table>

					<!-- Móvil: tarjetas agrupadas -->
					<div class="md:hidden flex flex-col">
						{#each gruposPagina as g (g.clave)}
							{#if agrupar !== 'ninguno'}
								<button onclick={() => alternarGrupo(g.clave)} aria-expanded={!colapsados.includes(g.clave)} class="flex items-center gap-2 px-4 py-2.5 bg-slate-50 border-y border-slate-100 text-left">
									<i class={`fas ${g.icono} text-slate-500`}></i>
									<span class="text-xs font-bold text-slate-700 uppercase tracking-wide [overflow-wrap:anywhere]">{g.titulo}</span>
									<span class="min-w-6 h-5 px-1.5 rounded-full bg-slate-200 text-slate-600 text-[11px] font-bold inline-flex items-center justify-center">{conteoGrupo[g.clave] ?? g.items.length}</span>
									<i class={`fas fa-chevron-down ml-auto text-slate-400 text-xs transition-transform ${colapsados.includes(g.clave) ? '-rotate-90' : ''}`}></i>
								</button>
							{/if}
							{#if !colapsados.includes(g.clave)}
								{#each g.items as p (p.id_personal)}
									<div class="p-4 flex flex-col gap-2.5 border-b border-slate-100">
										<div class="flex items-start gap-3">
											{@render foto(p, 'w-12 h-12')}
											<div class="min-w-0 flex-1">
												<div class="font-semibold text-slate-800 [overflow-wrap:anywhere]">{nombreCompleto(p)}</div>
												<div class="text-xs text-slate-500">{p.numero_documento ? `${p.tipo_documento} ${p.numero_documento}` : 'Sin documento'}</div>
											</div>
										</div>
										<div class="grid grid-cols-2 gap-3">
											<div class="min-w-0">{@render vinculo(p)}</div>
											<div class="min-w-0">{@render salario(p)}</div>
											<div class="min-w-0">{@render puestoCelda(p)}</div>
											<div class="min-w-0">{@render listaHuelleros(p)}</div>
										</div>
										{@render avisos(p)}
										{@render acciones(p)}
									</div>
								{/each}
							{/if}
						{/each}
					</div>

					<!-- Pie: total, páginas y leyenda -->
					<div class="flex flex-col lg:flex-row items-center justify-between gap-3 px-4 py-3 border-t border-slate-100 text-xs text-slate-500">
						<span>Mostrando <b class="text-slate-700">{paginaItems.length}</b> de {ordenados.length} trabajadores</span>
						{#if totalPaginas > 1}
							<div class="flex items-center gap-1.5">
								<button onclick={() => (pagina = paginaActual - 1)} disabled={paginaActual === 1} aria-label="Página anterior" class="w-8 h-8 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-40"><i class="fas fa-chevron-left text-[10px]"></i></button>
								{#each Array.from({ length: totalPaginas }, (_, i) => i + 1) as n}
									<button onclick={() => (pagina = n)} aria-current={n === paginaActual ? 'page' : undefined} class={`w-8 h-8 rounded-lg text-sm font-semibold ${n === paginaActual ? 'bg-orange-500 text-white shadow-sm shadow-orange-500/30' : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}>{n}</button>
								{/each}
								<button onclick={() => (pagina = paginaActual + 1)} disabled={paginaActual === totalPaginas} aria-label="Página siguiente" class="w-8 h-8 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-40"><i class="fas fa-chevron-right text-[10px]"></i></button>
							</div>
						{/if}
						<div class="flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
							<span><i class="fas fa-circle-info text-blue-600"></i> Ficha</span>
							<span><i class="fas fa-calendar-check text-blue-600"></i> Calendario asistencia</span>
							{#if verEliminados}
								<span><i class="fas fa-rotate-left text-emerald-600"></i> Restaurar</span>
							{:else}
								<span><i class="fas fa-pen text-blue-600"></i> Editar</span>
							{/if}
							<span><i class="fas fa-trash text-rose-600"></i> Eliminar</span>
						</div>
					</div>
				{/if}
			</div>
		</div>
	</div>
</div>

<style>
	.aviso {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		font-size: 10px;
		line-height: 1rem;
		font-weight: 600;
		padding: 1px 6px;
		border-radius: 0.375rem;
		border-width: 1px;
	}
	.chip {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		font-size: 10px;
		line-height: 1rem;
		font-weight: 600;
		padding: 1px 6px;
		border-radius: 9999px;
	}
	.contador {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.25rem 0.625rem;
		border-radius: 0.5rem;
		border-width: 1px;
		font-weight: 600;
	}
	.accion {
		width: 2rem;
		height: 2rem;
		border-radius: 9999px;
		border: 1px solid rgb(226 232 240);
		display: inline-flex;
		align-items: center;
		justify-content: center;
		font-size: 0.8rem;
		transition: background-color 0.15s;
	}
	.accion:not(:hover) {
		background: white;
	}
</style>

<PersonalModal
	open={fichaAbierta}
	personal={enEdicion}
	{obras}
	{huelleros}
	onClose={() => (fichaAbierta = false)}
	onSaved={fetchPersonal}
/>

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
