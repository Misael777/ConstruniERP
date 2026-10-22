<script lang="ts">
	/**
	 * Catálogo → Partidas (según la imagen del usuario): "Catálogo general de partidas" con selector Obra/Consultoría,
	 * árbol "Estructura de especialidades" a la izquierda, tabla de partidas con buscador y filtro de especialidad, y
	 * debajo el "APU de la partida" (mano de obra / materiales / equipos, con cuadrilla, cantidad, precio y parcial).
	 * Los recursos del APU vienen del catálogo de Recursos. Cálculo en services/apu.ts; datos en
	 * services/partidasCatalogo.service.ts. Patrón dar-de-baja en partidas.
	 */
	import { onMount } from 'svelte';
	import { supabase } from '$lib/supabaseClient';
	import { toast } from '$lib/stores/toast';
	import { describeError } from '$lib/shared/describeError';
	import { isAdmin, permisosState } from '$lib/stores/permisos.svelte';
	import { verifyAdminCredentials } from '$lib/shared/adminAuth';
	import { exportarTablaXlsx } from '$lib/shared/exportarXlsx';
	import SelectConSaldo from '$lib/shared/components/SelectConSaldo.svelte';
	import ConfirmModal from '$lib/shared/components/ConfirmModal.svelte';
	import AdminConfirmModal from '$lib/shared/components/AdminConfirmModal.svelte';
	import { TIPOS_RECURSO, getRecursos, getUnidades, type Recurso, type TipoRecurso, type UnidadMedida } from '$lib/modules/catalogo/services/catalogo.service';
	import { calcularApu, usaCuadrilla, esPorcentajeMO } from '$lib/modules/catalogo/services/apu';
	import {
		getEspecialidades,
		crearEspecialidad,
		prefijoDe,
		idsDeRama,
		getPartidas,
		getApu,
		siguienteCodigoPartida,
		guardarPartida,
		darDeBajaPartida,
		restaurarPartida,
		eliminarPartidaPermanente,
		importarPartidasExcel,
		type Ambito,
		type Especialidad,
		type PartidaCat,
		type LineaApu
	} from '$lib/modules/catalogo/services/partidasCatalogo.service';
	import { Search, X, Upload, Plus, Download, Pencil, Copy, Trash2, RotateCcw, Trash, Folder, FolderOpen, FileText, ChevronRight, ChevronDown, Save, Info, Loader2, HardHat, Ruler, Ellipsis, ArrowUp, ArrowDown } from '@lucide/svelte';

	let ambito = $state<Ambito>('obra');
	let especialidades = $state<Especialidad[]>([]);
	let partidas = $state<PartidaCat[]>([]);
	let recursos = $state<Recurso[]>([]);
	let unidades = $state<UnidadMedida[]>([]);
	let cargando = $state(true);
	let verEliminados = $state(false);

	// Filtros
	let busqueda = $state('');
	let especialidadSel = $state<number | null>(null);
	let abiertas = $state<Record<number, boolean>>({});

	// Nueva especialidad (en el árbol): se crea dentro de la seleccionada (o en la raíz).
	let creandoEsp = $state(false);
	let nuevaEspNombre = $state('');
	let nuevaEspPrefijo = $state('');

	// APU de la partida
	let apuAbierto = $state(false);
	let editandoId = $state<number | null>(null);
	let cargandoApu = $state(false);
	let guardando = $state(false);
	let form = $state({ codigo: '', nombre: '', id_especialidad: '', unidad: '', rendimiento: '1', jornada: '8' });
	let lineas = $state<LineaApu[]>([]);
	let apuEl: HTMLElement | undefined = $state();
	let agregandoRecurso = $state(false);

	// Confirmaciones / importación / exportación
	let paraBaja = $state<PartidaCat | null>(null);
	let paraRestaurar = $state<PartidaCat | null>(null);
	let paraEliminar = $state<PartidaCat | null>(null);
	let importando = $state(false);
	let exportando = $state(false);

	const ORDEN_TIPOS: TipoRecurso[] = ['mano_obra', 'material', 'equipo', 'subcontrato'];
	const TITULO_GRUPO: Record<TipoRecurso, string> = { mano_obra: 'MANO DE OBRA', material: 'MATERIALES', equipo: 'EQUIPOS', subcontrato: 'SUBCONTRATOS' };
	const ABREV_TIPO: Record<TipoRecurso, string> = { mano_obra: 'MO', material: 'MAT', equipo: 'EQ', subcontrato: 'SUB' };

	const soles = (n: number) => (Number(n) || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
	const cant = (n: number) => (Number(n) || 0).toLocaleString('es-PE', { minimumFractionDigits: 3, maximumFractionDigits: 3 });

	async function cargar() {
		cargando = true;
		try {
			[especialidades, partidas] = await Promise.all([getEspecialidades(supabase, ambito), getPartidas(supabase, ambito, verEliminados)]);
			// Raíces y primer nivel abiertos, como en la imagen.
			const ab: Record<number, boolean> = {};
			for (const e of especialidades) if (e.id_padre === null || especialidades.some((p) => p.id_especialidad === e.id_padre && p.id_padre === null)) ab[e.id_especialidad] = true;
			abiertas = ab;
		} catch (err) {
			toast.error(describeError(err));
		} finally {
			cargando = false;
		}
	}

	onMount(async () => {
		await cargar();
		Promise.all([getRecursos(supabase), getUnidades(supabase)])
			.then(([r, u]) => {
				recursos = r;
				unidades = u;
			})
			.catch((err) => toast.error(describeError(err)));
	});

	function cambiarAmbito(a: Ambito) {
		if (a === ambito) return;
		ambito = a;
		especialidadSel = null;
		apuAbierto = false;
		cargar();
	}

	// ── Árbol ──
	const hijasDe = (id: number | null) => especialidades.filter((e) => e.id_padre === id);
	const nombreEsp = (id: number | null) => especialidades.find((e) => e.id_especialidad === id)?.nombre ?? '';
	/** Lista plana en orden de árbol (para los desplegables), con su nivel. */
	const especialidadesPlanas = $derived.by(() => {
		const salida: { e: Especialidad; nivel: number }[] = [];
		const visitar = (padre: number | null, nivel: number) => {
			for (const e of hijasDe(padre)) {
				salida.push({ e, nivel });
				visitar(e.id_especialidad, nivel + 1);
			}
		};
		visitar(null, 0);
		return salida;
	});
	const opcionesEspecialidad = $derived(especialidadesPlanas.map(({ e, nivel }) => ({ value: String(e.id_especialidad), label: `${'  '.repeat(nivel)}${e.nombre}` })));

	function elegirEspecialidad(e: Especialidad) {
		const tieneHijas = hijasDe(e.id_especialidad).length > 0;
		if (especialidadSel === e.id_especialidad) {
			if (tieneHijas) abiertas = { ...abiertas, [e.id_especialidad]: !abiertas[e.id_especialidad] };
			else especialidadSel = null;
			return;
		}
		especialidadSel = e.id_especialidad;
		if (tieneHijas) abiertas = { ...abiertas, [e.id_especialidad]: true };
	}

	async function agregarEspecialidad() {
		const r = await crearEspecialidad(supabase, ambito, nuevaEspNombre, especialidadSel, nuevaEspPrefijo);
		if (!r.success || !r.data) return toast.error(r.message);
		especialidades = [...especialidades, r.data];
		if (especialidadSel) abiertas = { ...abiertas, [especialidadSel]: true };
		creandoEsp = false;
		nuevaEspNombre = '';
		nuevaEspPrefijo = '';
		toast.success(r.message);
	}

	const filtradas = $derived.by(() => {
		const q = busqueda.trim().toLowerCase();
		const rama = especialidadSel ? idsDeRama(especialidades, especialidadSel) : null;
		return partidas.filter((p) => (!rama || (p.id_especialidad !== null && rama.has(p.id_especialidad))) && (!q || `${p.codigo} ${p.nombre}`.toLowerCase().includes(q)));
	});

	// ── APU ──
	const calculo = $derived(calcularApu(lineas, Number(form.jornada) || 0, Number(form.rendimiento) || 0));
	/** Líneas agrupadas por tipo, conservando el índice real de cada una (para el cálculo y la edición). */
	const grupos = $derived(
		ORDEN_TIPOS.map((tipo) => ({ tipo, filas: lineas.map((l, i) => ({ l, i })).filter((x) => x.l.tipo === tipo) })).filter((g) => g.filas.length > 0)
	);
	const opcionesRecurso = $derived(
		ORDEN_TIPOS.flatMap((tipo) =>
			recursos
				.filter((r) => r.tipo === tipo)
				.map((r) => ({ value: String(r.id_recurso), label: `${r.codigo ?? ''} · ${r.nombre} (${r.unidad ?? '—'})`, saldo: r.precio_unitario, grupo: TIPOS_RECURSO.find((t) => t.value === tipo)?.label ?? tipo }))
		)
	);

	function abrirApu() {
		apuAbierto = true;
		setTimeout(() => apuEl?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
	}

	async function nuevaPartida() {
		editandoId = null;
		const idEsp = especialidadSel;
		form = { codigo: await siguienteCodigoPartida(supabase, prefijoDe(especialidades, idEsp)), nombre: '', id_especialidad: idEsp ? String(idEsp) : '', unidad: '', rendimiento: '1', jornada: '8' };
		lineas = [];
		abrirApu();
	}

	async function cargarEnFormulario(p: PartidaCat, comoCopia: boolean) {
		cargandoApu = true;
		abrirApu();
		try {
			const apu = await getApu(supabase, p.id_partida_catalogo);
			editandoId = comoCopia ? null : p.id_partida_catalogo;
			form = {
				codigo: comoCopia ? await siguienteCodigoPartida(supabase, prefijoDe(especialidades, p.id_especialidad)) : p.codigo,
				nombre: comoCopia ? `${p.nombre} (copia)` : p.nombre,
				id_especialidad: p.id_especialidad ? String(p.id_especialidad) : '',
				unidad: p.unidad ?? '',
				rendimiento: String(p.rendimiento),
				jornada: String(p.jornada)
			};
			lineas = apu;
		} catch (err) {
			toast.error(describeError(err));
		} finally {
			cargandoApu = false;
		}
	}

	async function cambiarEspecialidadForm(v: string) {
		form.id_especialidad = v;
		if (!editandoId) form.codigo = await siguienteCodigoPartida(supabase, prefijoDe(especialidades, v ? Number(v) : null));
	}

	function agregarRecurso(v: string) {
		const r = recursos.find((x) => String(x.id_recurso) === v);
		if (!r) return;
		if (lineas.some((l) => l.id_recurso === r.id_recurso)) return toast.error(`${r.nombre} ya está en el APU.`);
		const nueva: LineaApu = {
			id_recurso: r.id_recurso,
			codigo: r.codigo,
			nombre: r.nombre,
			tipo: r.tipo,
			unidad: r.unidad,
			precio: r.precio_unitario,
			cuadrilla: usaCuadrilla(r.tipo, r.unidad) ? 1 : null,
			cantidad: 0,
			incluido: true
		};
		// Se inserta al final de su grupo, para que el orden guardado siga MO → MAT → EQ.
		const pos = ORDEN_TIPOS.indexOf(r.tipo);
		const idx = lineas.findIndex((l) => ORDEN_TIPOS.indexOf(l.tipo) > pos);
		lineas = idx === -1 ? [...lineas, nueva] : [...lineas.slice(0, idx), nueva, ...lineas.slice(idx)];
	}

	const quitarLinea = (i: number) => (lineas = lineas.filter((_, j) => j !== i));

	async function guardar() {
		guardando = true;
		try {
			const r = await guardarPartida(
				supabase,
				{ ambito, codigo: form.codigo, nombre: form.nombre, unidad: form.unidad, rendimiento: Number(form.rendimiento), jornada: Number(form.jornada), id_especialidad: form.id_especialidad ? Number(form.id_especialidad) : null },
				lineas,
				editandoId,
				permisosState.userName || null
			);
			if (!r.success || !r.data) return toast.error(r.message);
			toast.success(r.message);
			const g = r.data;
			partidas = (editandoId ? partidas.map((x) => (x.id_partida_catalogo === editandoId ? g : x)) : [...partidas, g]).sort((a, b) => a.codigo.localeCompare(b.codigo));
			editandoId = g.id_partida_catalogo;
			form.codigo = g.codigo;
		} catch (err) {
			toast.error(describeError(err));
		} finally {
			guardando = false;
		}
	}

	function duplicarActual() {
		const actual = partidas.find((p) => p.id_partida_catalogo === editandoId);
		if (actual) return cargarEnFormulario(actual, true);
		toast.error('Guarda la partida antes de duplicarla.');
	}

	async function confirmarBaja() {
		if (!paraBaja) return;
		const r = await darDeBajaPartida(supabase, paraBaja.id_partida_catalogo);
		if (!r.success) return toast.error(r.message);
		toast.success(r.message);
		partidas = partidas.filter((x) => x.id_partida_catalogo !== paraBaja!.id_partida_catalogo);
		if (editandoId === paraBaja.id_partida_catalogo) apuAbierto = false;
		paraBaja = null;
	}
	async function confirmarRestaurar() {
		if (!paraRestaurar) return;
		const r = await restaurarPartida(supabase, paraRestaurar.id_partida_catalogo);
		if (!r.success) return toast.error(r.message);
		toast.success(r.message);
		partidas = partidas.filter((x) => x.id_partida_catalogo !== paraRestaurar!.id_partida_catalogo);
		paraRestaurar = null;
	}
	async function confirmarEliminar(email: string, password: string) {
		const v = await verifyAdminCredentials(email, password);
		if (!v.success) throw new Error(v.message);
		if (!paraEliminar) return;
		const r = await eliminarPartidaPermanente(supabase, paraEliminar.id_partida_catalogo);
		if (!r.success) throw new Error(r.message);
		toast.success(r.message);
		partidas = partidas.filter((x) => x.id_partida_catalogo !== paraEliminar!.id_partida_catalogo);
		paraEliminar = null;
	}

	function toggleVerEliminados() {
		verEliminados = !verEliminados;
		apuAbierto = false;
		cargar();
	}

	async function alElegirArchivo(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const archivo = input.files?.[0];
		input.value = '';
		if (!archivo) return;
		importando = true;
		try {
			const r = await importarPartidasExcel(supabase, ambito, archivo, especialidades, permisosState.userName || null);
			toast.success(`Importación terminada: ${r.creadas} creadas, ${r.actualizadas} actualizadas${r.omitidas ? `, ${r.omitidas} filas omitidas (títulos sin unidad)` : ''}. Arma el APU de cada partida desde aquí.`);
			if (r.errores.length) toast.error(`${r.errores.length} fila(s) con error. ${r.errores.slice(0, 3).join(' · ')}`);
			await cargar();
		} catch (err) {
			toast.error(`No se pudo importar. ${describeError(err)}`);
		} finally {
			importando = false;
		}
	}

	async function exportarPartidas() {
		exportando = true;
		try {
			await exportarTablaXlsx({
				nombreArchivo: `Catalogo_partidas_${ambito}`,
				hoja: 'Partidas',
				columnas: [
					{ titulo: 'Código', ancho: 12 },
					{ titulo: 'Partida', ancho: 50 },
					{ titulo: 'Especialidad', ancho: 24 },
					{ titulo: 'Und.', ancho: 8 },
					{ titulo: 'Rendimiento', ancho: 14 },
					{ titulo: 'Jornada (h)', ancho: 12 },
					{ titulo: 'P.U. ref. (S/)', ancho: 16, formato: 'moneda' }
				],
				filas: filtradas.map((p) => [p.codigo, p.nombre, nombreEsp(p.id_especialidad), p.unidad ?? '', p.rendimiento, p.jornada, p.precio_referencia])
			});
		} catch (err) {
			toast.error(`No se pudo exportar. ${describeError(err)}`);
		} finally {
			exportando = false;
		}
	}

	/** Exporta el APU de una partida (la abierta, o cualquiera desde el menú "⋯" de la tabla). */
	async function exportarApuDe(cab: { codigo: string; nombre: string; unidad: string; rendimiento: number; jornada: number }, ls: LineaApu[]) {
		try {
			const c = calcularApu(ls, cab.jornada, cab.rendimiento);
			await exportarTablaXlsx({
				nombreArchivo: `APU_${cab.codigo || 'partida'}`,
				hoja: 'APU',
				columnas: [
					{ titulo: 'Tipo', ancho: 8 },
					{ titulo: 'Código', ancho: 12 },
					{ titulo: 'Descripción del recurso', ancho: 40 },
					{ titulo: 'Und.', ancho: 8 },
					{ titulo: 'Cuadrilla', ancho: 10 },
					{ titulo: 'Cantidad', ancho: 12 },
					{ titulo: 'Precio ref. (S/)', ancho: 14, formato: 'moneda' },
					{ titulo: 'Parcial (S/)', ancho: 14, formato: 'moneda' }
				],
				filas: [
					...ls.map((l, i) => [ABREV_TIPO[l.tipo], l.codigo ?? '', l.nombre, l.unidad ?? '', l.cuadrilla ?? '', c.cantidades[i], c.precios[i], c.parciales[i]]).filter((_, i) => ls[i].incluido),
					['', '', `P.U. ${cab.codigo} · ${cab.nombre} (${cab.unidad}, rend. ${cab.rendimiento}/día, jornada ${cab.jornada} h)`, '', '', '', '', c.precioUnitario]
				]
			});
		} catch (err) {
			toast.error(`No se pudo exportar. ${describeError(err)}`);
		}
	}
	const exportarApu = () => exportarApuDe({ codigo: form.codigo, nombre: form.nombre, unidad: form.unidad, rendimiento: Number(form.rendimiento) || 0, jornada: Number(form.jornada) || 0 }, lineas);
	async function exportarApuDePartida(p: PartidaCat) {
		try {
			await exportarApuDe({ codigo: p.codigo, nombre: p.nombre, unidad: p.unidad ?? '', rendimiento: p.rendimiento, jornada: p.jornada }, await getApu(supabase, p.id_partida_catalogo));
		} catch (err) {
			toast.error(describeError(err));
		}
	}

	// ── Menú "⋯" (posición fija, para que no lo recorte el scroll de la tabla) ──
	let menu = $state<{ clave: string; x: number; y: number } | null>(null);
	function abrirMenu(e: MouseEvent, clave: string) {
		e.stopPropagation();
		if (menu?.clave === clave) return (menu = null);
		const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
		menu = { clave, x: Math.max(8, r.right - 176), y: r.bottom + 4 };
	}
	const cerrarMenu = () => (menu = null);

	/** Sube/baja una línea del APU dentro de su grupo. */
	function moverLinea(i: number, dir: -1 | 1) {
		let j = i + dir;
		while (j >= 0 && j < lineas.length && lineas[j].tipo !== lineas[i].tipo) j += dir;
		if (j < 0 || j >= lineas.length) return;
		const copia = [...lineas];
		[copia[i], copia[j]] = [copia[j], copia[i]];
		lineas = copia;
	}

	function cambiarEstado(v: string) {
		if ((v === 'eliminadas') !== verEliminados) toggleVerEliminados();
	}

	const partidaAbierta = $derived(partidas.find((x) => x.id_partida_catalogo === editandoId) ?? null);
	const unidadPartida = $derived(form.unidad || 'und');
</script>

<svelte:window onclick={cerrarMenu} onscroll={cerrarMenu} onresize={cerrarMenu} />

{#snippet nodo(e: Especialidad, nivel: number)}
	{@const hijas = hijasDe(e.id_especialidad)}
	{@const abierta = abiertas[e.id_especialidad]}
	{@const sel = especialidadSel === e.id_especialidad}
	<button type="button" onclick={() => elegirEspecialidad(e)} style={`padding-left:${0.25 + nivel * 1.1}rem`} class={`w-full flex items-center gap-1.5 rounded-md py-[5px] pr-1.5 text-left text-[13px] ${sel ? 'bg-orange-50 text-orange-600 font-semibold' : nivel === 0 ? 'font-semibold text-slate-800 hover:bg-slate-50' : 'text-slate-700 hover:bg-slate-50'}`}>
		{#if hijas.length}
			{#if abierta}<ChevronDown size={14} class="shrink-0 text-slate-500" />{:else}<ChevronRight size={14} class="shrink-0 text-slate-500" />{/if}
			{#if abierta}<FolderOpen size={16} strokeWidth={1.6} class={`shrink-0 ${sel ? 'text-orange-500' : 'text-slate-600'}`} />{:else}<Folder size={16} strokeWidth={1.6} class={`shrink-0 ${sel ? 'text-orange-500' : 'text-slate-600'}`} />{/if}
		{:else}
			<span class="w-[14px] shrink-0"></span><FileText size={15} strokeWidth={1.6} class={`shrink-0 ${sel ? 'text-orange-500' : 'text-slate-500'}`} />
		{/if}
		<span class="truncate">{e.nombre}</span>
	</button>
	{#if hijas.length && abierta}
		{#each hijas as h (h.id_especialidad)}{@render nodo(h, nivel + 1)}{/each}
	{/if}
{/snippet}

<!-- Encabezado: título, Obra / Consultoría y botones -->
<div class="mb-4 flex flex-wrap items-start justify-between gap-3">
	<div>
		<h1 class="text-2xl font-bold text-slate-900">{verEliminados ? 'Partidas eliminadas' : 'Catálogo general de partidas'}</h1>
		<div class="mt-3 flex flex-wrap gap-3" role="group" aria-label="Ámbito">
			<button type="button" onclick={() => cambiarAmbito('obra')} class={`flex h-10 w-40 sm:w-48 items-center justify-center gap-2 rounded-lg border text-sm font-semibold transition-colors ${ambito === 'obra' ? 'border-orange-500 bg-orange-500 text-white shadow-sm' : 'border-orange-400 bg-white text-orange-600 hover:bg-orange-50'}`}><HardHat size={17} /> Obra</button>
			<button type="button" onclick={() => cambiarAmbito('consultoria')} class={`flex h-10 w-40 sm:w-48 items-center justify-center gap-2 rounded-lg border text-sm font-semibold transition-colors ${ambito === 'consultoria' ? 'border-orange-500 bg-orange-500 text-white shadow-sm' : 'border-orange-400 bg-white text-orange-600 hover:bg-orange-50'}`}><Ruler size={17} /> Consultoría</button>
		</div>
		<p class="mt-2 text-sm text-slate-500">{verEliminados ? 'Partidas dadas de baja: restáuralas o elimínalas de forma permanente.' : `Partidas y APU reutilizables para presupuestos de ${ambito === 'obra' ? 'obra' : 'consultoría'}`}</p>
	</div>
	<div class="flex flex-wrap items-center gap-3">
		<button type="button" onclick={exportarPartidas} disabled={exportando || filtradas.length === 0} class="flex h-10 items-center gap-2 rounded-lg border border-slate-300 bg-white px-3.5 text-[13px] font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
			{#if exportando}<Loader2 size={16} class="animate-spin" />{:else}<Download size={16} />{/if} Exportar
		</button>
		{#if !verEliminados}
			<label class={`flex h-10 cursor-pointer items-center gap-2 rounded-lg border border-orange-400 bg-white px-4 text-[13px] font-medium text-orange-600 hover:bg-orange-50 ${importando ? 'pointer-events-none opacity-60' : ''}`}>
				{#if importando}<Loader2 size={16} class="animate-spin" />{:else}<Upload size={16} />{/if} Importar partidas S10/Excel
				<input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" class="hidden" onchange={alElegirArchivo} />
			</label>
			<button type="button" onclick={nuevaPartida} class="flex h-10 items-center gap-2 rounded-lg bg-orange-500 px-5 text-[13px] font-semibold text-white shadow-sm hover:bg-orange-600">
				<Plus size={17} /> Nueva partida
			</button>
		{/if}
	</div>
</div>

<div class="grid grid-cols-1 overflow-hidden rounded-xl border border-slate-200 bg-white lg:grid-cols-[240px_minmax(0,1fr)]">
	<!-- Árbol: Estructura de especialidades -->
	<aside class="border-b border-slate-200 p-3 lg:border-b-0 lg:border-r">
		<div class="flex items-center justify-between px-1 pb-2">
			<p class="text-sm font-bold text-slate-900">Estructura de especialidades</p>
			{#if !verEliminados}
				<button type="button" onclick={() => (creandoEsp = !creandoEsp)} class="rounded p-1 text-orange-500 hover:bg-orange-50" title={especialidadSel ? `Agregar dentro de ${nombreEsp(especialidadSel)}` : 'Agregar especialidad'} aria-label="Agregar especialidad"><Plus size={15} /></button>
			{/if}
		</div>
		{#if creandoEsp}
			<div class="mb-2 rounded-lg bg-slate-50 p-2">
				<p class="mb-1 text-[11px] text-slate-500">Nueva especialidad {especialidadSel ? `dentro de "${nombreEsp(especialidadSel)}"` : 'en la raíz'}</p>
				<div class="flex items-center gap-1">
					<input type="text" bind:value={nuevaEspNombre} maxlength="80" placeholder="Nombre" onkeydown={(e) => { if (e.key === 'Enter') agregarEspecialidad(); if (e.key === 'Escape') creandoEsp = false; }} class="min-w-0 flex-1 rounded border border-slate-300 px-1.5 py-1 text-xs focus:border-orange-400 focus:outline-none" />
					<input type="text" bind:value={nuevaEspPrefijo} maxlength="6" placeholder="Prefijo" title="Prefijo del código de sus partidas (ej. EST). Vacío = el de la especialidad padre." class="w-16 rounded border border-slate-300 px-1.5 py-1 text-xs uppercase focus:border-orange-400 focus:outline-none" />
					<button type="button" onclick={agregarEspecialidad} class="rounded p-1 text-orange-500 hover:bg-orange-50" aria-label="Guardar especialidad"><Save size={14} /></button>
				</div>
			</div>
		{/if}
		<button type="button" onclick={() => (especialidadSel = null)} class={`mb-0.5 w-full rounded-md px-2 py-[5px] text-left text-xs font-medium ${!especialidadSel ? 'bg-orange-50 text-orange-600' : 'text-slate-500 hover:bg-slate-50'}`}>Todas las partidas</button>
		{#each hijasDe(null) as raiz (raiz.id_especialidad)}{@render nodo(raiz, 0)}{/each}
	</aside>

	<div class="min-w-0">
		<!-- Filtros -->
		<div class="flex flex-wrap items-center gap-2 border-b border-slate-200 p-3">
			<div class="relative min-w-[200px] flex-1">
				<Search size={15} class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
				<input type="text" bind:value={busqueda} placeholder="Buscar código o descripción..." class="h-9 w-full rounded-lg border border-slate-300 pl-9 pr-7 text-[13px] focus:border-orange-400 focus:outline-none focus:ring-2 focus:ring-orange-100" />
				{#if busqueda}<button type="button" onclick={() => (busqueda = '')} class="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400" aria-label="Limpiar búsqueda"><X size={13} /></button>{/if}
			</div>
			<div class="w-full sm:w-44">
				<SelectConSaldo value={verEliminados ? 'eliminadas' : 'activas'} options={[{ value: 'activas', label: 'Estado: Activas' }, ...(isAdmin() ? [{ value: 'eliminadas', label: 'Estado: Eliminadas' }] : [])]} onchange={cambiarEstado} />
			</div>
			<div class="w-full sm:w-56">
				<SelectConSaldo value={especialidadSel ? String(especialidadSel) : ''} options={[{ value: '', label: 'Especialidad: Todas' }, ...opcionesEspecialidad]} onchange={(v) => (especialidadSel = v ? Number(v) : null)} />
			</div>
		</div>

		<!-- Tabla de partidas -->
		{#if cargando}
			<div class="flex items-center justify-center gap-2 py-12 text-sm text-slate-400"><Loader2 size={18} class="animate-spin" /> Cargando partidas…</div>
		{:else if filtradas.length === 0}
			<p class="py-12 text-center text-sm text-slate-400">{verEliminados ? 'No hay partidas dadas de baja.' : 'No hay partidas que coincidan. Crea una con "Nueva partida" o importa tu lista desde S10/Excel.'}</p>
		{:else}
			<div class="max-h-[360px] overflow-auto">
				<table class="w-full min-w-[760px] text-[13px]">
					<thead class="sticky top-0 z-[1]">
						<tr class="border-b border-slate-200 bg-slate-50 text-left text-[12px] font-semibold text-slate-700">
							<th class="px-3 py-2.5">Código</th>
							<th class="px-3 py-2.5">Partida</th>
							<th class="px-3 py-2.5">Und.</th>
							<th class="px-3 py-2.5">Rendimiento</th>
							<th class="px-3 py-2.5">P.U. ref. (S/)</th>
							<th class="px-3 py-2.5" title="Se mostrará cuando los presupuestos de proyectos usen el catálogo">En proyectos</th>
							<th class="px-3 py-2.5">Acciones</th>
						</tr>
					</thead>
					<tbody class="divide-y divide-slate-100">
						{#each filtradas as p (p.id_partida_catalogo)}
							{@const sel = apuAbierto && editandoId === p.id_partida_catalogo}
							<tr class={sel ? 'bg-orange-50' : 'hover:bg-slate-50'}>
								<td class="whitespace-nowrap px-3 py-2 font-medium text-slate-800">{p.codigo}</td>
								<td class="px-3 py-2 text-slate-800">
									{#if verEliminados}{p.nombre}{:else}<button type="button" onclick={() => cargarEnFormulario(p, false)} class="text-left hover:text-orange-600">{p.nombre}</button>{/if}
								</td>
								<td class="px-3 py-2 text-slate-700">{p.unidad ?? '—'}</td>
								<td class="whitespace-nowrap px-3 py-2 tabular-nums text-slate-700">{p.rendimiento.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 4 })} {p.unidad ?? ''}/día</td>
								<td class="whitespace-nowrap px-3 py-2 tabular-nums text-slate-800">S/ {soles(p.precio_referencia)}</td>
								<td class="px-3 py-2 text-slate-400">—</td>
								<td class="px-3 py-2">
									<div class="flex items-center gap-0.5">
										{#if verEliminados}
											<button type="button" onclick={() => (paraRestaurar = p)} class="rounded p-1.5 text-slate-600 hover:bg-emerald-50 hover:text-emerald-600" title="Restaurar" aria-label="Restaurar"><RotateCcw size={15} /></button>
											<button type="button" onclick={() => (paraEliminar = p)} class="rounded p-1.5 text-red-500 hover:bg-red-50" title="Eliminar permanentemente" aria-label="Eliminar permanentemente"><Trash size={15} /></button>
										{:else}
											<button type="button" onclick={() => cargarEnFormulario(p, false)} class="rounded p-1.5 text-slate-600 hover:bg-orange-50 hover:text-orange-600" title="Editar APU" aria-label="Editar"><Pencil size={15} /></button>
											<button type="button" onclick={() => cargarEnFormulario(p, true)} class="rounded p-1.5 text-slate-600 hover:bg-orange-50 hover:text-orange-600" title="Duplicar" aria-label="Duplicar"><Copy size={15} /></button>
											<button type="button" onclick={() => (paraBaja = p)} class="rounded p-1.5 text-red-500 hover:bg-red-50" title="Dar de baja" aria-label="Dar de baja"><Trash2 size={15} /></button>
											<button type="button" onclick={(e) => abrirMenu(e, `p${p.id_partida_catalogo}`)} class="rounded p-1.5 text-slate-600 hover:bg-slate-100" title="Más opciones" aria-label="Más opciones"><Ellipsis size={15} /></button>
										{/if}
									</div>
									{#if menu?.clave === `p${p.id_partida_catalogo}`}
										<div class="fixed z-[200] w-44 rounded-lg border border-slate-200 bg-white py-1 text-[13px] shadow-lg" style={`left:${menu.x}px;top:${menu.y}px`}>
											<button type="button" onclick={() => { cerrarMenu(); cargarEnFormulario(p, false); }} class="flex w-full items-center gap-2 px-3 py-1.5 text-left text-slate-700 hover:bg-slate-50"><Pencil size={14} /> Ver / editar APU</button>
											<button type="button" onclick={() => { cerrarMenu(); exportarApuDePartida(p); }} class="flex w-full items-center gap-2 px-3 py-1.5 text-left text-slate-700 hover:bg-slate-50"><Download size={14} /> Exportar APU</button>
										</div>
									{/if}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}

		<!-- APU de la partida -->
		{#if apuAbierto}
			<section bind:this={apuEl} class="scroll-mt-4 border-t border-slate-200 p-3">
				<div class="mb-3 flex flex-wrap items-center justify-between gap-2">
					<h2 class="text-lg font-bold text-slate-900">APU de la partida{form.codigo ? ` - ${form.codigo}` : ''}{editandoId ? '' : ' (nueva)'}</h2>
					<div class="flex flex-wrap items-center gap-2">
						<button type="button" onclick={(e) => { e.stopPropagation(); agregandoRecurso = !agregandoRecurso; }} class="flex h-8 items-center gap-1.5 rounded-lg border border-orange-400 bg-white px-3 text-[13px] font-medium text-orange-600 hover:bg-orange-50"><Plus size={15} /> Agregar recurso</button>
						<button type="button" onclick={duplicarActual} disabled={!editandoId} class="flex h-8 items-center gap-1.5 rounded-lg border border-orange-400 bg-white px-3 text-[13px] font-medium text-orange-600 hover:bg-orange-50 disabled:opacity-50"><Copy size={15} /> Duplicar</button>
						<button type="button" onclick={() => { if (partidaAbierta) paraBaja = partidaAbierta; }} disabled={!partidaAbierta} class="flex h-8 items-center gap-1.5 rounded-lg border border-red-400 bg-white px-3 text-[13px] font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"><Trash2 size={15} /> Eliminar</button>
						<button type="button" onclick={exportarApu} disabled={lineas.length === 0} class="flex h-8 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-[13px] font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"><Download size={15} /> Exportar</button>
						<button type="button" onclick={guardar} disabled={guardando || cargandoApu} class="flex h-8 items-center gap-1.5 rounded-lg bg-orange-500 px-4 text-[13px] font-semibold text-white shadow-sm hover:bg-orange-600 disabled:opacity-60">
							{#if guardando}<Loader2 size={15} class="animate-spin" />{:else}<Save size={15} />{/if} Guardar partida
						</button>
						<button type="button" onclick={() => (apuAbierto = false)} class="rounded p-1.5 text-slate-400 hover:bg-slate-100" aria-label="Cerrar APU"><X size={17} /></button>
					</div>
				</div>

				{#if cargandoApu}
					<div class="flex items-center justify-center gap-2 py-12 text-sm text-slate-400"><Loader2 size={18} class="animate-spin" /> Cargando APU…</div>
				{:else}
					<!-- Cabecera de la partida: etiqueta al costado y campo compacto, como en la imagen -->
					<div class="rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-2 text-[13px]">
						<div class="flex flex-wrap items-center gap-x-5 gap-y-2">
							<label class="flex items-center gap-2"><span class="text-slate-600">Código</span>
								<input type="text" maxlength="20" bind:value={form.codigo} class="h-8 w-24 rounded-md border border-slate-300 bg-white px-2 uppercase focus:border-orange-400 focus:outline-none" /></label>
							<label class="flex min-w-[240px] flex-1 items-center gap-2"><span class="text-slate-600">Partida</span>
								<input type="text" maxlength="250" bind:value={form.nombre} placeholder="Ej. Concreto en zapatas f'c=210 kg/cm²" class="h-8 min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-2 focus:border-orange-400 focus:outline-none" /></label>
							<div class="flex items-center gap-2"><span class="text-slate-600">Especialidad</span>
								<div class="w-52"><SelectConSaldo value={form.id_especialidad} options={[{ value: '', label: '— Sin especialidad —' }, ...opcionesEspecialidad]} onchange={cambiarEspecialidadForm} /></div></div>
						</div>
						<div class="mt-2 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-slate-200 pt-2">
							<div class="flex items-center gap-2"><span class="text-slate-600">Unidad</span>
								<div class="w-28"><SelectConSaldo value={form.unidad} placeholder="Elige" options={unidades.filter((u) => !esPorcentajeMO(u.codigo)).map((u) => ({ value: u.codigo, label: `${u.codigo} · ${u.descripcion}` }))} onchange={(v) => (form.unidad = v)} /></div></div>
							<label class="flex items-center gap-2"><span class="text-slate-600">Rendimiento</span>
								<span class="flex h-8 items-center rounded-md border border-slate-300 bg-white pr-2 focus-within:border-orange-400">
									<input type="number" min="0" step="0.01" inputmode="decimal" bind:value={form.rendimiento} class="h-full w-20 rounded-md bg-transparent px-2 text-right focus:outline-none" />
									<span class="whitespace-nowrap text-slate-500">{unidadPartida}/día</span>
								</span></label>
							<label class="flex items-center gap-2"><span class="text-slate-600">Jornada</span>
								<span class="flex h-8 items-center rounded-md border border-slate-300 bg-white pr-2 focus-within:border-orange-400">
									<input type="number" min="0" step="0.5" inputmode="decimal" bind:value={form.jornada} class="h-full w-12 rounded-md bg-transparent px-2 text-right focus:outline-none" />
									<span class="text-slate-500">h</span>
								</span></label>
							<div class="flex items-center gap-2 sm:ml-auto"><span class="text-slate-600">P.U. de referencia</span>
								<span class="flex h-8 min-w-[110px] items-center justify-end rounded-md border border-slate-300 bg-white px-2 font-bold tabular-nums text-slate-900">S/ {soles(calculo.precioUnitario)}</span></div>
						</div>
					</div>

					{#if agregandoRecurso}
						<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
						<div class="mt-2 flex items-center gap-2 rounded-lg border border-orange-200 bg-orange-50/60 px-3 py-2" onclick={(e) => e.stopPropagation()}>
							<span class="whitespace-nowrap text-[13px] font-medium text-orange-700">Agregar recurso</span>
							<div class="min-w-0 flex-1 sm:max-w-md"><SelectConSaldo value="" placeholder="Busca un recurso del catálogo…" encabezadoNombre="Recurso" options={opcionesRecurso} onchange={agregarRecurso} /></div>
							<button type="button" onclick={() => (agregandoRecurso = false)} class="rounded p-1 text-slate-400 hover:bg-white" aria-label="Cerrar"><X size={15} /></button>
						</div>
					{/if}

					<!-- Detalle del APU -->
					<div class="mt-2 overflow-x-auto rounded-lg border border-slate-200">
						<table class="w-full min-w-[860px] text-[13px]">
							<thead>
								<tr class="border-b border-slate-200 bg-slate-50 text-left text-[12px] font-semibold text-slate-700">
									<th class="w-14 px-3 py-2">Tipo</th>
									<th class="w-10 px-2 py-2 text-center"><span class="sr-only">Incluir</span><input type="checkbox" checked={lineas.length > 0 && lineas.every((l) => l.incluido)} onchange={(e) => { const v = e.currentTarget.checked; lineas = lineas.map((l) => ({ ...l, incluido: v })); }} class="h-4 w-4 accent-orange-500 align-middle" aria-label="Incluir todos" /></th>
									<th class="px-3 py-2">Código</th>
									<th class="px-3 py-2">Descripción del recurso</th>
									<th class="px-3 py-2">Und.</th>
									<th class="px-3 py-2 text-right">Cuadrilla</th>
									<th class="px-3 py-2 text-right">Cantidad</th>
									<th class="px-3 py-2 text-right">Precio ref. (S/)</th>
									<th class="px-3 py-2 text-right">Parcial (S/)</th>
									<th class="w-10 px-2 py-2"><span class="sr-only">Opciones</span></th>
								</tr>
							</thead>
							<tbody>
								{#if grupos.length === 0}
									<tr><td colspan="10" class="py-8 text-center text-sm text-slate-400">Sin recursos. Usa "Agregar recurso" para armar el APU con el catálogo de Recursos.</td></tr>
								{/if}
								{#each grupos as g (g.tipo)}
									<tr class="border-b border-slate-200 bg-slate-100">
										<td colspan="8" class="px-3 py-1.5 text-[12px] font-bold uppercase text-slate-800">{TITULO_GRUPO[g.tipo]}</td>
										<td class="px-3 py-1.5 text-right text-[12px] font-bold tabular-nums text-slate-800">S/ {soles(calculo.totalPorTipo[g.tipo])}</td>
										<td></td>
									</tr>
									{#each g.filas as { l, i } (l.id_recurso)}
										<tr class={`border-b border-slate-100 hover:bg-slate-50/70 ${l.incluido ? '' : 'text-slate-400'}`}>
											<td class="px-3 py-1.5 text-slate-700">{ABREV_TIPO[l.tipo]}</td>
											<td class="px-2 py-1.5 text-center"><input type="checkbox" bind:checked={lineas[i].incluido} class="h-4 w-4 accent-orange-500 align-middle" aria-label={`Incluir ${l.nombre}`} /></td>
											<td class="whitespace-nowrap px-3 py-1.5">{l.codigo ?? '—'}</td>
											<td class="px-3 py-1.5">{l.nombre}</td>
											<td class="px-3 py-1.5">{esPorcentajeMO(l.unidad) ? '%MO' : (l.unidad ?? '—')}</td>
											<td class="px-3 py-1 text-right">
												{#if usaCuadrilla(l.tipo, l.unidad)}
													<input type="number" min="0" step="0.01" inputmode="decimal" bind:value={lineas[i].cuadrilla} class="h-7 w-20 rounded border border-transparent bg-transparent px-1.5 text-right tabular-nums hover:border-slate-300 focus:border-orange-500 focus:bg-white focus:outline-none" aria-label={`Cuadrilla de ${l.nombre}`} />
												{:else}<span class="pr-1.5 text-slate-400">-</span>{/if}
											</td>
											<td class="px-3 py-1 text-right tabular-nums">
												{#if usaCuadrilla(l.tipo, l.unidad)}
													<span class="pr-1.5">{cant(calculo.cantidades[i])}</span>
												{:else}
													<input type="number" min="0" step="0.001" inputmode="decimal" bind:value={lineas[i].cantidad} class="h-7 w-24 rounded border border-transparent bg-transparent px-1.5 text-right tabular-nums hover:border-slate-300 focus:border-orange-500 focus:bg-white focus:outline-none" aria-label={`Cantidad de ${l.nombre}`} />
												{/if}
											</td>
											<td class="whitespace-nowrap px-3 py-1.5 text-right tabular-nums" title={esPorcentajeMO(l.unidad) ? 'Total de mano de obra sobre el que se aplica el %' : ''}>S/ {soles(calculo.precios[i])}</td>
											<td class="whitespace-nowrap px-3 py-1.5 text-right tabular-nums">S/ {soles(calculo.parciales[i])}</td>
											<td class="px-2 py-1 text-center">
												<button type="button" onclick={(e) => abrirMenu(e, `l${l.id_recurso}`)} class="rounded p-1 text-slate-500 hover:bg-slate-100" title="Más opciones" aria-label={`Opciones de ${l.nombre}`}><Ellipsis size={15} /></button>
												{#if menu?.clave === `l${l.id_recurso}`}
													<div class="fixed z-[200] w-44 rounded-lg border border-slate-200 bg-white py-1 text-left text-[13px] shadow-lg" style={`left:${menu.x}px;top:${menu.y}px`}>
														<button type="button" onclick={() => { cerrarMenu(); moverLinea(i, -1); }} class="flex w-full items-center gap-2 px-3 py-1.5 text-slate-700 hover:bg-slate-50"><ArrowUp size={14} /> Subir</button>
														<button type="button" onclick={() => { cerrarMenu(); moverLinea(i, 1); }} class="flex w-full items-center gap-2 px-3 py-1.5 text-slate-700 hover:bg-slate-50"><ArrowDown size={14} /> Bajar</button>
														<button type="button" onclick={() => { cerrarMenu(); quitarLinea(i); }} class="flex w-full items-center gap-2 px-3 py-1.5 text-red-600 hover:bg-red-50"><Trash2 size={14} /> Quitar del APU</button>
													</div>
												{/if}
											</td>
										</tr>
									{/each}
								{/each}
							</tbody>
						</table>
					</div>
					<p class="mt-3 flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[12px] text-slate-600">
						<Info size={15} class="shrink-0 text-slate-500" /> Los cambios del catálogo general no modifican presupuestos existentes. Mano de obra y equipos: cantidad = cuadrilla × jornada ÷ rendimiento.
					</p>
				{/if}
			</section>
		{/if}
	</div>
</div>

<ConfirmModal open={!!paraBaja} title="Dar de baja partida" message={`¿Dar de baja ${paraBaja?.codigo ?? ''} · ${paraBaja?.nombre ?? ''}? Dejará de aparecer en el catálogo; un administrador puede restaurarla.`} confirmLabel="Dar de baja" danger onConfirm={confirmarBaja} onClose={() => (paraBaja = null)} />
<ConfirmModal open={!!paraRestaurar} title="Restaurar partida" message={`¿Restaurar ${paraRestaurar?.codigo ?? ''} · ${paraRestaurar?.nombre ?? ''}?`} confirmLabel="Restaurar" onConfirm={confirmarRestaurar} onClose={() => (paraRestaurar = null)} />
<AdminConfirmModal open={!!paraEliminar} title="Eliminar partida permanentemente" message={`Se borrará ${paraEliminar?.codigo ?? ''} · ${paraEliminar?.nombre ?? ''} y su APU de la base de datos. Confirma con tu correo y contraseña de administrador.`} confirmLabel="Eliminar permanentemente" onConfirm={confirmarEliminar} onClose={() => (paraEliminar = null)} />
