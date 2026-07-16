<script lang="ts">
	import { supabase } from '$lib/supabaseClient';
	import GanttTimeline from './GanttTimeline.svelte';
	import { buildTree, fillMissingAncestors, flattenSubtree } from '$lib/utils/tree';
	import {
		diffDraft,
		commitDraft,
		computeBlockShift,
		resolveConstraints,
		computeRollup,
		type ConstraintEdge,
	} from '$lib/modules/gantt-planning/services/ganttPlanning.service';

	const { projectId, proyecto } = $props<{
		projectId: number;
		proyecto: {
			fecha_inicio_plan?: string | null;
			fecha_fin_plan?: string | null;
			nombre_proyecto: string;
		};
	}>();

	// ── TYPES ──────────────────────────────────────────────────────────────────
	type PartidaJoin = { codigo: string; descripcion: string; unidad: string | null };

	type Actividad = {
		id_cronograma_actividad: number;
		nombre_actividad: string;
		nivel: number;
		id_actividad_padre: number | null;
		fecha_inicio_plan: string | null;
		fecha_fin_plan: string | null;
		plan_base_inicio: string | null;
		plan_base_fin: string | null;
		fecha_inicio_real: string | null;
		fecha_fin_real: string | null;
		porcentaje_avance_real: number;
		orden: number | null;
		id_partida: number | null;
		color: string | null;
		partida?: PartidaJoin | null;   // joined from supabase select
	};

	type PartidaItem = {
		id_partida: number;
		codigo: string;
		descripcion: string;
		nivel: number;
		id_partida_padre: number | null;
		unidad: string | null;
		precio_unitario: number | null;
	};

	type Dependencia = {
		id_dependencia: number;
		id_actividad_origen: number;
		id_actividad_destino: number;
		tipo_dependencia: string;
		lag_dias: number;
	};

	type Restriccion = {
		id_restriccion: number;
		actividad_relacionada: string;
		responsable: string | null;
		fecha_maxima: string;
		estado: string;
		tipo_restriccion: string | null;
		descripcion: string | null;
		id_cronograma_actividad: number | null;
		/** Actividad cuyo fin (evento de fin) satisface esta restricción — la
		 * "condición de inicio" de id_cronograma_actividad. Null = restricción
		 * externa/manual, no ligada a otra actividad del cronograma. */
		id_actividad_origen: number | null;
		created_at: string;
	};

	// ── STATE ──────────────────────────────────────────────────────────────────
	let actividades   = $state<Actividad[]>([]);
	let dependencias  = $state<Dependencia[]>([]);
	let restricciones = $state<Restriccion[]>([]);
	let isLoading     = $state(true);

	let showAvanceReal  = $state(true);
	let showDeps        = $state(true);
	let tolerancia      = $state(0);
	let activeSection   = $state<'gantt' | 'restricciones'>('gantt');
	// Plegar el toolbar del Gantt para ver más área del cronograma — solo
	// "Guardar cambios"/"Descartar" (cuando hay cambios sin guardar) quedan
	// siempre visibles, el resto de controles se ocultan.
	let toolbarCollapsed = $state(false);

	let selectedId   = $state<number | null>(null);

	let planBaseDate = $state<string | null>(null);

	// Budget sync: presupuesto ID for this project
	let presupuestoId  = $state<number | null>(null);
	let partidas       = $state<PartidaItem[]>([]);

	// Inline add
	let showAddForm    = $state(false);
	let addingParentId = $state<number | null>(null);
	let newActName     = $state('');

	// Restrictions form
	let showRestrictForm = $state(false);
	let newR = $state<{ actividad: string; responsable: string; fecha: string; tipo: string; descripcion: string; idActividad: number | null }>(
		{ actividad: '', responsable: '', fecha: '', tipo: '', descripcion: '', idActividad: null }
	);

	// Alta rápida de restricción — se abre con el icono ⚑ al pasar el cursor
	// sobre una barra en GanttTimeline, ya vinculada a esa actividad sin tener
	// que ir a la sección "Restricciones" y llenar el formulario completo.
	let quickR = $state<{ idActividad: number; nombre: string; idOrigen: number | null; nombreOrigen: string | null; clientX: number; clientY: number; fecha: string; tipo: string; descripcion: string } | null>(null);

	// Local draft of pending schedule edits (drag/resize/block-move), keyed by
	// actividad id. Nothing here touches Supabase until "Guardar cambios" —
	// see ganttPlanning.service.ts's reconstruction checklist item 9.
	let draftDates = $state(new Map<number, { inicio: string; fin: string }>());
	// Set only when resolveConstraints finds an unsolvable cycle — replaces the
	// old advisory-only draftWarnings (removed): the solver is now a hard
	// constraint engine, so the only "warning" left is a full rejection.
	let draftConflict = $state<string | null>(null);

	// Full, unscoped partida catalog — used only to repair a legacy
	// presupuesto_detalle that's missing an ancestor group (see
	// syncActividadesFromPresupuesto below via fillMissingAncestors).
	let catalogAll = $state<PartidaItem[]>([]);

	// ── DERIVED ────────────────────────────────────────────────────────────────
	const timelineStart = $derived.by(() => {
		const dates = actividades.filter(a => a.fecha_inicio_plan).map(a => +new Date(a.fecha_inicio_plan!));
		const base = dates.length ? Math.min(...dates) : +(proyecto.fecha_inicio_plan ? new Date(proyecto.fecha_inicio_plan) : new Date());
		const d = new Date(base);
		const dow = d.getDay();
		d.setDate(d.getDate() - (dow === 0 ? 6 : dow - 1) - 7);
		d.setHours(0, 0, 0, 0);
		return d;
	});

	const timelineEnd = $derived.by(() => {
		const dates = actividades.filter(a => a.fecha_fin_plan).map(a => +new Date(a.fecha_fin_plan!));
		const base = dates.length
			? Math.max(...dates)
			: +(proyecto.fecha_fin_plan ? new Date(proyecto.fecha_fin_plan) : new Date(+new Date() + 90 * 864e5));
		const d = new Date(base);
		d.setDate(d.getDate() + 21);
		return d;
	});

	const planVsReal = $derived.by(() => {
		const today = new Date(); today.setHours(0, 0, 0, 0);
		let atrasadas = 0, enTiempo = 0, completadas = 0;
		for (const a of actividades) {
			if (!a.fecha_fin_plan) continue;
			if (a.porcentaje_avance_real >= 100) { completadas++; continue; }
			const fin = new Date(a.fecha_fin_plan);
			if (fin < today && a.porcentaje_avance_real < 100 - tolerancia) atrasadas++;
			else enTiempo++;
		}
		return { atrasadas, enTiempo, completadas, total: actividades.length };
	});

	// ── RESTRICCIONES ↔ ACTIVIDAD LINK ─────────────────────────────────────────
	// Restricciones with id_cronograma_actividad set are tied to a specific
	// actividad; used to flag that actividad in both the sidebar row label and
	// its gantt bar (only "abierta"/"en_seguimiento" ones count as active).
	const restriccionesAbiertasPorActividad = $derived.by(() => {
		const m = new Map<number, Restriccion[]>();
		for (const r of restricciones) {
			if (!r.id_cronograma_actividad || r.estado === 'resuelta') continue;
			if (!m.has(r.id_cronograma_actividad)) m.set(r.id_cronograma_actividad, []);
			m.get(r.id_cronograma_actividad)!.push(r);
		}
		return m;
	});

	// Restricciones que además funcionan como "wait condition" ligada al fin de
	// otra actividad (id_actividad_origen) — se dibujan como conectores en el
	// Gantt, distintos de una dependencia normal (ver GanttTimeline).
	const restriccionLinks = $derived.by(() => {
		const links: { idOrigen: number; idDestino: number }[] = [];
		for (const r of restricciones) {
			if (r.estado === 'resuelta' || !r.id_actividad_origen || !r.id_cronograma_actividad) continue;
			links.push({ idOrigen: r.id_actividad_origen, idDestino: r.id_cronograma_actividad });
		}
		return links;
	});

	// Unified constraint graph fed to resolveConstraints: every FS dependency
	// plus every connected restricción (implicit lag 0), see
	// ganttPlanning.service.ts checklist item 8.
	const constraintEdges = $derived.by((): ConstraintEdge[] => {
		const edges: ConstraintEdge[] = [];
		for (const d of dependencias) {
			if (d.tipo_dependencia !== 'FS') continue;
			edges.push({ origenId: d.id_actividad_origen, destinoId: d.id_actividad_destino, lagDias: d.lag_dias, kind: 'dependencia' });
		}
		for (const r of restriccionLinks) {
			edges.push({ origenId: r.idOrigen, destinoId: r.idDestino, lagDias: 0, kind: 'restriccion' });
		}
		return edges;
	});

	// ── SCHEDULE DRAFT (local-only until "Guardar cambios") ────────────────────
	// GanttTimeline renders `draftActividades`, never `actividades` directly,
	// so every drag/resize/block-move is visible immediately but nothing hits
	// Supabase until the user explicitly commits it.
	const draftActividades = $derived.by((): Actividad[] => {
		if (draftDates.size === 0) return actividades;
		return actividades.map(a => {
			const d = draftDates.get(a.id_cronograma_actividad);
			return d ? { ...a, fecha_inicio_plan: d.inicio, fecha_fin_plan: d.fin } : a;
		});
	});
	const hasDraftChanges = $derived(draftDates.size > 0);

	// Fechas "efectivas" por actividad, iguales a lo que GanttTimeline realmente
	// dibuja: para una actividad con hijos (grupo), NO son fecha_inicio_plan/
	// fecha_fin_plan propias (esas quedan vacías/vestigiales, ver
	// ganttPlanning.service.ts) sino el rollup calculado de sus descendientes.
	// El panel "Inicio/Fin/Duración" del toolbar leía directo de la actividad
	// y por eso mostraba vacío/duración 1 al seleccionar una barra padre que
	// en el Gantt sí se ve con fechas — este rollup es lo que lo sincroniza.
	const draftRollup = $derived(computeRollup(buildTree(draftActividades, 'id_cronograma_actividad', 'id_actividad_padre')));

	// Runs the hard constraint solver seeded from a proposed change and applies
	// its FULL result (every downstream activity it moved, not just the one the
	// user touched) into draftDates. On an unsolvable cycle, rejects the whole
	// change — draftDates is left untouched — and surfaces draftConflict.
	function applyResolution(seed: Map<number, { inicio: string; fin: string }>) {
		const res = resolveConstraints(draftActividades, constraintEdges, seed);
		if (!res.ok) {
			draftConflict = res.message;
			return;
		}
		draftConflict = null;
		const next = new Map(draftDates);
		for (const [id, dates] of res.shifted) next.set(id, dates);
		draftDates = next;
	}

	function handleLeafChange(id: number, inicio: string, fin: string) {
		if (new Date(fin) < new Date(inicio)) return; // ignore invalid ranges
		applyResolution(new Map([[id, { inicio, fin }]]));
	}

	function handleBlockMove(rootId: number, deltaDays: number) {
		const shift = computeBlockShift(draftActividades, rootId, deltaDays);
		if (shift.size === 0) return;
		applyResolution(shift);
	}

	// After a dependency/restricción edge is written (immediate-write, see
	// checklist item 10), pushes the cascade it now implies into draftDates —
	// origenId itself stays fixed (it's the anchor resolveConstraints defaults
	// to), only what depends on it moves.
	function cascadeFromOrigen(origenId: number) {
		const eff = draftRollup.get(origenId);
		if (!eff?.inicio || !eff?.fin) return;
		applyResolution(new Map([[origenId, { inicio: eff.inicio, fin: eff.fin }]]));
	}

	async function guardarCambios() {
		const diff = diffDraft(actividades, draftActividades);
		if (!diff.length) return;
		const res = await commitDraft(supabase, diff);
		if (res.ok) {
			actividades = draftActividades;
			draftDates = new Map();
			draftConflict = null;
		} else {
			alert('No se pudieron guardar los cambios: ' + res.error);
		}
	}

	function descartarCambios() {
		draftDates = new Map();
		draftConflict = null;
	}

	// ── DATE UTILS ─────────────────────────────────────────────────────────────
	function addDays(d: Date, n: number) { return new Date(+d + n * 864e5); }
	function fmt(d: Date)  { return d.toISOString().slice(0, 10); }
	function fmtDisp(s: string | null) {
		if (!s) return '—';
		return new Date(s).toLocaleDateString('es-PE', { day: '2-digit', month: 'short' });
	}

	// ── LOAD ───────────────────────────────────────────────────────────────────
	async function load() {
		isLoading = true;

		const [{ data: acts }, { data: rests }, { data: pb }] = await Promise.all([
			// Join partida so each activity carries its catalog code+unit
			supabase.from('cronograma_actividad')
				.select('*, partida:id_partida(codigo, descripcion, unidad)')
				.eq('id_proyecto', projectId)
				.order('orden').order('id_cronograma_actividad'),
			supabase.from('restriccion').select('*').eq('id_proyecto', projectId)
				.order('created_at', { ascending: false }),
			supabase.from('cronograma_plan_base').select('fecha_snapshot').eq('id_proyecto', projectId)
				.order('created_at', { ascending: false }).limit(1).maybeSingle(),
		]);

		actividades   = (acts ?? []) as Actividad[];
		restricciones = (rests ?? []) as Restriccion[];
		planBaseDate  = pb?.fecha_snapshot ?? null;

		if (actividades.length) {
			const ids = actividades.map(a => a.id_cronograma_actividad);
			const { data: deps } = await supabase.from('cronograma_dependencia')
				.select('*').in('id_actividad_origen', ids);
			dependencias = (deps ?? []) as Dependencia[];
		}

		await loadPartidas();
		await syncActividadesFromPresupuesto();
		validateProjectOnLoad();
		isLoading = false;
	}

	// Resolves the ENTIRE constraint graph on load, per explicit user decision:
	// a pre-existing violation (e.g. edited outside the app, or from data that
	// predates the solver) must surface immediately as a reviewable draft
	// correction — not only forward from the next edit the user happens to make.
	// Every dated activity with incoming edges is always re-derived regardless
	// of being seeded here (see resolveConstraints), so this naturally corrects
	// anything already out of alignment.
	function validateProjectOnLoad() {
		const seed = new Map<number, { inicio: string; fin: string }>();
		for (const a of actividades) {
			if (a.fecha_inicio_plan && a.fecha_fin_plan) {
				seed.set(a.id_cronograma_actividad, { inicio: a.fecha_inicio_plan, fin: a.fecha_fin_plan });
			}
		}
		if (seed.size === 0) return;
		const res = resolveConstraints(actividades, constraintEdges, seed);
		if (!res.ok) {
			draftConflict = res.message;
			return;
		}
		if (res.shifted.size > 0) {
			draftDates = new Map(res.shifted);
		}
	}

	async function loadPartidas() {
		// Full catalog (unscoped) — only used to repair a legacy
		// presupuesto_detalle missing an ancestor group, see below.
		const { data: allCats } = await supabase.from('partida').select('*').order('codigo');
		catalogAll = (allCats ?? []) as PartidaItem[];

		const { data: pres } = await supabase.from('presupuesto')
			.select('id_presupuesto')
			.eq('id_proyecto', projectId)
			.order('created_at', { ascending: false })
			.limit(1).maybeSingle();

		if (!pres) { presupuestoId = null; partidas = []; return; }
		presupuestoId = pres.id_presupuesto;

		const { data: pd } = await supabase.from('presupuesto_detalle')
			.select('id_partida, partida:id_partida(id_partida, codigo, descripcion, nivel, id_partida_padre, unidad, precio_unitario)')
			.eq('id_presupuesto', pres.id_presupuesto)
			.order('id_partida');
		partidas = (pd ?? [])
			.map((row: any) => row.partida)
			.filter(Boolean)
			.filter((p: any, i: number, arr: any[]) => arr.findIndex(x => x.id_partida === p.id_partida) === i) as PartidaItem[];
	}

	// Mirrors every partida already in the project's presupuesto (backlog) into
	// cronograma_actividad, preserving the catalog's parent/child hierarchy —
	// no manual drag/select needed, the schedule always reflects the budget.
	// Existing activities are left untouched (matched by id_partida); this
	// only ever adds what's missing, in parent-before-child order.
	async function syncActividadesFromPresupuesto() {
		if (!presupuestoId || partidas.length === 0) return;
		const completos = fillMissingAncestors(partidas, catalogAll, 'id_partida', 'id_partida_padre');
		const tree = buildTree(completos, 'id_partida', 'id_partida_padre');
		// Parent-before-child order, so a just-repaired parent's nivel is
		// already correct by the time we compute its children's nivel below.
		const ordenados = tree.flatMap(root => flattenSubtree(root));

		for (const p of ordenados) {
			const parentAct = p.id_partida_padre ? actividades.find(a => a.id_partida === p.id_partida_padre) : undefined;
			const parentActId = parentAct?.id_cronograma_actividad ?? null;
			const nivel = parentAct ? parentAct.nivel + 1 : 1;

			const existing = actividades.find(a => a.id_partida === p.id_partida);
			if (!existing) {
				const siblings = actividades.filter(a => a.id_actividad_padre === parentActId);
				const { data } = await supabase.from('cronograma_actividad').insert({
					id_proyecto: projectId,
					nombre_actividad: p.descripcion,
					nivel,
					id_actividad_padre: parentActId,
					orden: siblings.length + 1,
					porcentaje_avance_real: 0,
					id_partida: p.id_partida,
				}).select('*, partida:id_partida(codigo, descripcion, unidad)').single();
				if (data) actividades = [...actividades, data as Actividad];
				continue;
			}

			// Repair an activity created by the old manual "arrastrar al Gantt"
			// flow (before this auto-sync existed), whose id_actividad_padre no
			// longer matches the partida catalog's real hierarchy — e.g. a "2
			// PISO" child that ended up nested under "1 PISO" because its actual
			// parent activity didn't exist yet at the time it was created.
			if (existing.id_actividad_padre !== parentActId || existing.nivel !== nivel) {
				await supabase.from('cronograma_actividad')
					.update({ id_actividad_padre: parentActId, nivel })
					.eq('id_cronograma_actividad', existing.id_cronograma_actividad);
				actividades = actividades.map(a =>
					a.id_cronograma_actividad === existing.id_cronograma_actividad
						? { ...a, id_actividad_padre: parentActId, nivel }
						: a
				);
			}
		}
	}

	// Manual toolbar date/duration edits go through the same draft path as
	// gantt drag/resize (see draftDates above) — one persistence model, not two.
	function setFechasManual(id: number, inicioStr: string, finStr: string) {
		if (!inicioStr || !finStr) return;
		handleLeafChange(id, inicioStr, finStr);
	}

	function duracionDias(inicio: string | null | undefined, fin: string | null | undefined): number {
		if (!inicio || !fin) return 1;
		return Math.max(1, Math.round((+new Date(fin) - +new Date(inicio)) / 864e5) + 1);
	}

	function finFromDuracion(inicioStr: string, dias: number): string {
		return fmt(addDays(new Date(inicioStr + 'T00:00:00'), Math.max(dias, 1) - 1));
	}

	// ── DEPENDENCY CREATION/EDIT/DELETE — vía el dropdown "Depende de…" del
	//    toolbar (lag 0) o arrastrando desde el handle circular del borde de
	//    una barra en GanttTimeline (con offset editable en un popover). ─────
	async function createDep(srcId: number, dstId: number, lagDias = 0) {
		if (srcId === dstId) return;
		const exists = dependencias.some(d => d.id_actividad_origen === srcId && d.id_actividad_destino === dstId);
		if (exists) return;
		const { data } = await supabase.from('cronograma_dependencia')
			.insert({ id_actividad_origen: srcId, id_actividad_destino: dstId, tipo_dependencia: 'FS', lag_dias: lagDias })
			.select().single();
		if (data) {
			dependencias = [...dependencias, data as Dependencia];
			cascadeFromOrigen(srcId);
		}
	}

	async function editDepLag(depId: number, lagDias: number) {
		await supabase.from('cronograma_dependencia').update({ lag_dias: lagDias }).eq('id_dependencia', depId);
		const dep = dependencias.find(d => d.id_dependencia === depId);
		dependencias = dependencias.map(d => d.id_dependencia === depId ? { ...d, lag_dias: lagDias } : d);
		if (dep) cascadeFromOrigen(dep.id_actividad_origen);
	}

	async function deleteDep(depId: number) {
		await supabase.from('cronograma_dependencia').delete().eq('id_dependencia', depId);
		dependencias = dependencias.filter(d => d.id_dependencia !== depId);
	}

	// ── ADD ACTIVITY ───────────────────────────────────────────────────────────
	async function addActivity() {
		if (!newActName.trim()) return;
		const sibling = actividades.filter(a => a.id_actividad_padre === addingParentId);
		const parent  = addingParentId ? actividades.find(a => a.id_cronograma_actividad === addingParentId) : null;
		const nivel   = parent ? (parent.nivel + 1) : 1;
		const { data } = await supabase.from('cronograma_actividad').insert({
			id_proyecto: projectId,
			nombre_actividad: newActName.trim(),
			nivel,
			id_actividad_padre: addingParentId ?? null,
			orden: sibling.length + 1,
			porcentaje_avance_real: 0,
		}).select().single();
		if (data) actividades = [...actividades, data as Actividad];
		newActName = ''; showAddForm = false; addingParentId = null;
	}

	// ── DELETE ─────────────────────────────────────────────────────────────────
	async function deleteActividad(id: number) {
		if (!confirm('¿Eliminar esta actividad?')) return;
		const ids = new Set<number>([id]);
		// collect children recursively
		let changed = true;
		while (changed) {
			changed = false;
			for (const a of actividades) {
				if (a.id_actividad_padre && ids.has(a.id_actividad_padre) && !ids.has(a.id_cronograma_actividad)) {
					ids.add(a.id_cronograma_actividad); changed = true;
				}
			}
		}
		await supabase.from('cronograma_actividad').delete().in('id_cronograma_actividad', [...ids]);
		actividades = actividades.filter(a => !ids.has(a.id_cronograma_actividad));
		if (selectedId && ids.has(selectedId)) selectedId = null;
	}

	// ── PLAN BASE ──────────────────────────────────────────────────────────────
	async function savePlanBase() {
		const today = fmt(new Date());
		const datos = actividades.map(a => ({
			id: a.id_cronograma_actividad, nombre: a.nombre_actividad,
			inicio: a.fecha_inicio_plan, fin: a.fecha_fin_plan, avance: a.porcentaje_avance_real,
		}));
		await supabase.from('cronograma_plan_base').insert({
			id_proyecto: projectId, nombre: `Plan Base ${today}`, fecha_snapshot: today, datos_json: datos,
		});
		// stamp plan_base_inicio/fin on each activity
		for (const a of actividades) {
			if (a.fecha_inicio_plan && a.fecha_fin_plan) {
				await supabase.from('cronograma_actividad').update({
					plan_base_inicio: a.fecha_inicio_plan, plan_base_fin: a.fecha_fin_plan,
				}).eq('id_cronograma_actividad', a.id_cronograma_actividad);
			}
		}
		actividades = actividades.map(a => ({
			...a, plan_base_inicio: a.fecha_inicio_plan, plan_base_fin: a.fecha_fin_plan,
		}));
		planBaseDate = today;
	}

	// ── RESTRICTIONS ──────────────────────────────────────────────────────────
	async function addRestriction() {
		if (!newR.actividad.trim() || !newR.fecha) return;
		const { data } = await supabase.from('restriccion').insert({
			id_proyecto: projectId,
			actividad_relacionada: newR.actividad.trim(),
			responsable: newR.responsable || null,
			fecha_maxima: newR.fecha,
			tipo_restriccion: newR.tipo || null,
			descripcion: newR.descripcion || null,
			id_cronograma_actividad: newR.idActividad,
			estado: 'abierta',
		}).select().single();
		if (data) restricciones = [data as Restriccion, ...restricciones];
		newR = { actividad: '', responsable: '', fecha: '', tipo: '', descripcion: '', idActividad: null };
		showRestrictForm = false;
	}

	// idOrigen: si viene de arrastrar el icono ⚑ de una barra hasta otra (en
	// vez de un simple clic), esa barra de origen queda como "evento de fin"
	// que resuelve la condición de inicio de idActividad.
	function abrirQuickRestriccion(idActividad: number, clientX: number, clientY: number, idOrigen: number | null = null) {
		const act = actividades.find(a => a.id_cronograma_actividad === idActividad);
		const origenAct = idOrigen ? actividades.find(a => a.id_cronograma_actividad === idOrigen) : null;
		quickR = {
			idActividad,
			nombre: act?.nombre_actividad ?? '',
			idOrigen,
			nombreOrigen: origenAct?.nombre_actividad ?? null,
			clientX, clientY,
			fecha: '', tipo: '', descripcion: '',
		};
	}

	async function guardarQuickRestriccion() {
		if (!quickR || !quickR.fecha) return;
		const { data } = await supabase.from('restriccion').insert({
			id_proyecto: projectId,
			actividad_relacionada: quickR.nombre,
			fecha_maxima: quickR.fecha,
			tipo_restriccion: quickR.tipo || null,
			descripcion: quickR.descripcion || null,
			id_cronograma_actividad: quickR.idActividad,
			id_actividad_origen: quickR.idOrigen,
			estado: 'abierta',
		}).select().single();
		if (data) {
			restricciones = [data as Restriccion, ...restricciones];
			if (quickR.idOrigen) cascadeFromOrigen(quickR.idOrigen);
		}
		quickR = null;
	}

	// Jump to the gantt and select the actividad linked to a restricción
	function verEnGantt(id: number) {
		activeSection = 'gantt';
		selectedId = id;
	}

	async function setEstado(id: number, estado: string) {
		await supabase.from('restriccion').update({ estado }).eq('id_restriccion', id);
		restricciones = restricciones.map(r => r.id_restriccion === id ? { ...r, estado } : r);
	}

	async function deleteRestricion(id: number) {
		await supabase.from('restriccion').delete().eq('id_restriccion', id);
		restricciones = restricciones.filter(r => r.id_restriccion !== id);
	}

	// ── HELPERS ────────────────────────────────────────────────────────────────
	function isRestriccionOverdue(r: Restriccion): boolean {
		if (r.estado === 'resuelta') return false;
		const today = new Date(); today.setHours(0, 0, 0, 0);
		return new Date(r.fecha_maxima) < today;
	}

	// ── INIT ───────────────────────────────────────────────────────────────────
	$effect(() => { if (projectId) load(); });
</script>

<!-- ─────────────────────────────────────────────────────────────────────────── -->
<!-- CONTAINER: break out of parent p-6 padding                                  -->
<!-- ─────────────────────────────────────────────────────────────────────────── -->
<div class="-m-6 flex flex-col" style="min-height:600px">

	<!-- ── TOOLBAR ─────────────────────────────────────────────────────────── -->
	<div class="flex items-center gap-2 flex-wrap px-4 py-2 bg-slate-50 border-b border-slate-100 text-xs">
		<!-- Section toggle -->
		<div class="flex rounded-lg border border-slate-200 overflow-hidden mr-2">
			<button
				class="px-3 py-1.5 font-semibold transition-colors {activeSection === 'gantt' ? 'bg-orange-500 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}"
				onclick={() => activeSection = 'gantt'}
			><i class="fas fa-chart-gantt mr-1"></i>Cronograma</button>
			<button
				class="px-3 py-1.5 font-semibold transition-colors {activeSection === 'restricciones' ? 'bg-orange-500 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}"
				onclick={() => activeSection = 'restricciones'}
			><i class="fas fa-triangle-exclamation mr-1"></i>Restricciones
				{#if restricciones.filter(r => r.estado === 'abierta').length > 0}
					<span class="ml-1 px-1.5 py-0.5 bg-rose-500 text-white rounded-full text-[9px] font-bold">
						{restricciones.filter(r => r.estado === 'abierta').length}
					</span>
				{/if}
			</button>
		</div>

		{#if activeSection === 'gantt'}
			<!-- Collapse toggle: oculta el resto del toolbar para ver el Gantt más grande -->
			<button
				class="flex items-center justify-center w-7 h-7 rounded-lg border transition-colors {toolbarCollapsed ? 'bg-orange-50 border-orange-200 text-orange-700' : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'}"
				onclick={() => toolbarCollapsed = !toolbarCollapsed}
				title={toolbarCollapsed ? 'Mostrar controles' : 'Ocultar controles (más espacio para el Gantt)'}
			><i class="fas fa-chevron-{toolbarCollapsed ? 'down' : 'up'} text-[10px]"></i></button>

		{#if !toolbarCollapsed}
			<!-- Avance real toggle -->
			<button
				class="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border transition-colors font-medium {showAvanceReal ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-white border-slate-200 text-slate-500'}"
				onclick={() => showAvanceReal = !showAvanceReal}
			>
				<span class="w-2 h-2 rounded-sm {showAvanceReal ? 'bg-blue-500' : 'bg-slate-300'}"></span>
				Avance Real
			</button>

			<!-- Dependencias toggle -->
			<button
				class="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border transition-colors font-medium {showDeps ? 'bg-rose-50 border-rose-200 text-rose-700' : 'bg-white border-slate-200 text-slate-500'}"
				onclick={() => showDeps = !showDeps}
			>
				<span class="w-2 h-2 rounded-sm {showDeps ? 'bg-rose-500' : 'bg-slate-300'}"></span>
				Dependencias
			</button>

			<!-- Tolerancia -->
			<div class="flex items-center gap-1 ml-1">
				<span class="text-slate-400">Tolerancia:</span>
				<select
					class="border border-slate-200 rounded px-1.5 py-1 bg-white text-slate-700 font-medium"
					bind:value={tolerancia}
				>
					{#each [0, 10, 20, 30, 50] as t}
						<option value={t}>{t}%</option>
					{/each}
				</select>
			</div>

			<!-- Activity picker: lets you select an activity even if it has no
			     dates yet (and so no bar to click on in the gantt) -->
			<div class="flex items-center gap-1 ml-1">
				<span class="text-slate-400">Actividad:</span>
				<select
					class="border border-slate-200 rounded px-1.5 py-1 bg-white text-slate-700 font-medium max-w-[180px]"
					value={selectedId ?? ''}
					onchange={(e) => { const v = (e.target as HTMLSelectElement).value; selectedId = v ? Number(v) : null; }}
				>
					<option value="">Seleccionar…</option>
					{#each actividades as a}
						<option value={a.id_cronograma_actividad}>{'—'.repeat(Math.max(a.nivel - 1, 0))} {a.nombre_actividad}</option>
					{/each}
				</select>
			</div>

			<!-- Selected activity actions + manual date/duration editing -->
			{#if selectedId}
				{@const selAct = draftActividades.find(a => a.id_cronograma_actividad === selectedId)}
				{@const selIsGroup = draftActividades.some(a => a.id_actividad_padre === selectedId)}
				{@const selRollup = draftRollup.get(selectedId)}
				{@const selInicio = selIsGroup ? (selRollup?.inicio ?? null) : (selAct?.fecha_inicio_plan ?? null)}
				{@const selFin = selIsGroup ? (selRollup?.fin ?? null) : (selAct?.fecha_fin_plan ?? null)}
				<div class="flex items-center gap-1.5 ml-1 px-2 py-1 bg-white border border-slate-200 rounded-lg flex-wrap">
					<button
						class="w-5 h-5 flex items-center justify-center rounded text-slate-300 hover:text-blue-500 hover:bg-blue-50"
						title="Agregar sub-actividad"
						onclick={() => { addingParentId = selectedId; showAddForm = true; }}
					><i class="fas fa-plus text-[9px]"></i></button>
					<button
						class="w-5 h-5 flex items-center justify-center rounded text-slate-300 hover:text-rose-500 hover:bg-rose-50"
						title="Eliminar"
						onclick={() => selectedId && deleteActividad(selectedId)}
					><i class="fas fa-trash-alt text-[9px]"></i></button>

					<span class="text-slate-300">|</span>

					{#if selIsGroup}
						<span class="text-slate-400" title="Es una actividad grupo — sus fechas se calculan de sus hijos, arrastra el bloque en el Gantt para moverlas">
							<i class="fas fa-layer-group text-[9px] mr-1"></i>{fmtDisp(selInicio)} → {fmtDisp(selFin)} (calculado)
						</span>
					{:else}
						<!-- Manual fecha inicio/fin + duración — same draft path as gantt drag/resize -->
						<span class="text-slate-400">Inicio:</span>
						<input
							type="date"
							class="border border-slate-200 rounded px-1 py-0.5 bg-white text-[10px]"
							value={selInicio ?? ''}
							onchange={(e) => {
								const v = (e.target as HTMLInputElement).value;
								if (selectedId && v) setFechasManual(selectedId, v, selFin && selFin >= v ? selFin : v);
							}}
						/>
						<span class="text-slate-400">Fin:</span>
						<input
							type="date"
							class="border border-slate-200 rounded px-1 py-0.5 bg-white text-[10px]"
							value={selFin ?? ''}
							onchange={(e) => {
								const v = (e.target as HTMLInputElement).value;
								if (selectedId && v) setFechasManual(selectedId, selInicio && selInicio <= v ? selInicio : v, v);
							}}
						/>
						<span class="text-slate-400">Duración (d):</span>
						<input
							type="number"
							min="1"
							class="w-14 border border-slate-200 rounded px-1 py-0.5 bg-white text-[10px]"
							value={duracionDias(selInicio, selFin)}
							onchange={(e) => {
								const dias = Number((e.target as HTMLInputElement).value);
								const inicio = selInicio ?? fmt(new Date());
								if (selectedId && dias > 0) setFechasManual(selectedId, inicio, finFromDuracion(inicio, dias));
							}}
						/>
					{/if}

					<span class="text-slate-300">|</span>

					<select
						class="border border-slate-200 rounded px-1 py-0.5 bg-white text-[10px]"
						onchange={(e) => {
							const v = Number((e.target as HTMLSelectElement).value);
							if (v && selectedId) createDep(v, selectedId);
							(e.target as HTMLSelectElement).value = '';
						}}
					>
						<option value="">Depende de…</option>
						{#each actividades.filter(a => a.id_cronograma_actividad !== selectedId) as a}
							<option value={a.id_cronograma_actividad}>{a.nombre_actividad}</option>
						{/each}
					</select>
					<button class="text-slate-300 hover:text-slate-500" onclick={() => selectedId = null}><i class="fas fa-times text-[10px]"></i></button>
				</div>
			{/if}
		{/if}

			<div class="flex-1"></div>

			<!-- Draft save/discard — nothing above hits Supabase until "Guardar cambios";
			     siempre visible aunque el resto del toolbar esté plegado. -->
			{#if hasDraftChanges}
				<span class="flex items-center gap-1 text-amber-600 font-semibold">
					<i class="fas fa-circle text-[6px]"></i> Cambios sin guardar
				</span>
				<button
					class="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-200 hover:bg-slate-50 text-slate-600 rounded-lg font-semibold transition-colors"
					onclick={descartarCambios}
				><i class="fas fa-undo text-xs"></i> Descartar</button>
				<button
					class="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-semibold transition-colors"
					onclick={guardarCambios}
				><i class="fas fa-check text-xs"></i> Guardar cambios</button>
			{/if}

		{#if !toolbarCollapsed}
			<!-- Plan base date -->
			{#if planBaseDate}
				<span class="text-slate-400 flex items-center gap-1">
					<i class="fas fa-bookmark text-slate-300"></i>
					Plan Base: <strong class="text-slate-600">{new Date(planBaseDate).toLocaleDateString('es-PE',{day:'2-digit',month:'short',year:'numeric'})}</strong>
				</span>
			{/if}

			<!-- Save plan base -->
			<button
				class="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-white rounded-lg font-semibold transition-colors"
				onclick={savePlanBase}
				title="Capturar Plan Base con las fechas actuales"
			>
				<i class="fas fa-bookmark text-xs"></i> Guardar Plan Base
			</button>

			<!-- Add activity -->
			<button
				class="flex items-center gap-1.5 px-3 py-1.5 bg-orange-500 hover:bg-orange-600 text-white rounded-lg font-semibold transition-colors"
				onclick={() => { addingParentId = null; showAddForm = true; }}
			>
				<i class="fas fa-plus text-xs"></i> Actividad
			</button>
		{/if}
		{:else}
			<div class="flex-1"></div>
			<button
				class="flex items-center gap-1.5 px-3 py-1.5 bg-orange-500 hover:bg-orange-600 text-white rounded-lg font-semibold transition-colors"
				onclick={() => showRestrictForm = true}
			>
				<i class="fas fa-plus text-xs"></i> Restricción
			</button>
		{/if}
	</div>

	<!-- ── CONSTRAINT CONFLICT (hard solver found an unsolvable cycle) ─────── -->
	{#if draftConflict}
		<div class="flex items-center gap-2 px-4 py-2 bg-rose-50 border-b border-rose-200 text-xs text-rose-700">
			<i class="fas fa-circle-exclamation"></i>
			<span class="flex-1">{draftConflict}</span>
			<button
				class="px-2 py-1 bg-white border border-rose-200 rounded-lg text-rose-600 hover:bg-rose-100 font-medium transition-colors"
				onclick={() => activeSection = 'restricciones'}
			>Ver restricciones</button>
			<button class="text-rose-400 hover:text-rose-600 px-1" onclick={() => draftConflict = null}>
				<i class="fas fa-xmark"></i>
			</button>
		</div>
	{/if}

	<!-- ── PLAN vs REAL SUMMARY (gantt only) ─────────────────────────────── -->
	{#if activeSection === 'gantt' && actividades.length > 0}
		<div class="flex items-center gap-4 px-4 py-1.5 bg-white border-b border-slate-100 text-xs font-medium">
			<span class="text-slate-400"><i class="fas fa-chart-bar mr-1"></i>Plan vs Real:</span>
			<span class="flex items-center gap-1 text-rose-600">
				<span class="w-2 h-2 rounded-full bg-rose-500"></span>
				{planVsReal.atrasadas} atrasada{planVsReal.atrasadas !== 1 ? 's' : ''}
			</span>
			<span class="flex items-center gap-1 text-emerald-600">
				<span class="w-2 h-2 rounded-full bg-emerald-500"></span>
				{planVsReal.enTiempo} en tiempo
			</span>
			<span class="flex items-center gap-1 text-blue-600">
				<span class="w-2 h-2 rounded-full bg-blue-500"></span>
				{planVsReal.completadas} completada{planVsReal.completadas !== 1 ? 's' : ''}
			</span>
			<span class="text-slate-300">|</span>
			<span class="text-slate-400">{actividades.length} actividades total</span>
		</div>
	{/if}

	<!-- ── LOADING ────────────────────────────────────────────────────────── -->
	{#if isLoading}
		<div class="flex-1 flex items-center justify-center text-orange-500 text-2xl">
			<i class="fas fa-circle-notch fa-spin"></i>
		</div>

	<!-- ── GANTT SECTION ──────────────────────────────────────────────────── -->
	{:else if activeSection === 'gantt'}
		<div class="flex-1 flex flex-col min-w-0 min-h-0">

		{#if actividades.length === 0 && !showAddForm}
			<div class="flex-1 flex flex-col items-center justify-center py-16 text-center">
				<div class="w-16 h-16 bg-orange-50 rounded-full flex items-center justify-center mb-4 border border-orange-100">
					<i class="fas fa-chart-gantt text-2xl text-orange-400"></i>
				</div>
				<h4 class="font-bold text-slate-700 mb-1">Sin actividades aún</h4>
				<p class="text-slate-400 text-sm mb-4">
					Agrega partidas en el tab <strong>Presupuesto / Partidas</strong> — aparecerán aquí automáticamente, o crea una actividad manual.
				</p>
				<button
					class="px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white rounded-xl text-sm font-semibold transition-colors"
					onclick={() => { addingParentId = null; showAddForm = true; }}
				><i class="fas fa-plus mr-2"></i>Agregar actividad manual</button>
			</div>
		{:else}
			<div class="flex-1 min-h-0">
				<GanttTimeline
					actividades={draftActividades}
					{dependencias}
					{restriccionesAbiertasPorActividad}
					restrictionLinks={restriccionLinks}
					{timelineStart}
					{timelineEnd}
					{showAvanceReal}
					{showDeps}
					{tolerancia}
					bind:selectedId
					onLeafChange={handleLeafChange}
					onBlockMove={handleBlockMove}
					onQuickRestriction={abrirQuickRestriccion}
					onCreateDependency={createDep}
					onEditDependencyLag={editDepLag}
					onDeleteDependency={deleteDep}
				/>
			</div>
			<p class="px-4 py-1.5 text-[10px] text-slate-400 border-t border-slate-100">
				<i class="fas fa-info-circle mr-1"></i>
				Actividades sin fecha aparecen con un recuadro punteado — arrastra sobre su fila para definir inicio y fin, o usa "Seleccionar actividad" arriba para ponerle fechas manualmente. Arrastra una barra existente para moverla o desde sus bordes para redimensionarla; arrastra una barra con hijos (grupo) para mover todo el bloque. Pasa el cursor sobre una barra para ver el punto de conexión del borde derecho: clic = restricción rápida; arrastra hasta otra barra (se resalta en verde) para elegir dependencia o restricción entre ambas. Nada se guarda hasta pulsar "Guardar cambios".
			</p>
		{/if}

		<!-- ── ADD FORM ────────────────────────────────────────────────── -->
		{#if showAddForm}
			<div class="px-4 py-3 bg-orange-50 border-t border-orange-100 flex items-center gap-2">
				<div class="w-2 h-2 rounded-full bg-orange-400 shrink-0"></div>
				<input
					class="flex-1 px-3 py-1.5 rounded-lg border border-orange-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-orange-300"
					placeholder={addingParentId ? 'Nombre de la sub-actividad…' : 'Nombre de la actividad raíz…'}
					bind:value={newActName}
					onkeydown={(e) => { if (e.key === 'Enter') addActivity(); if (e.key === 'Escape') { showAddForm = false; newActName = ''; } }}
					autofocus
				/>
				<button
					class="px-3 py-1.5 bg-orange-500 hover:bg-orange-600 text-white rounded-lg text-xs font-bold transition-colors"
					onclick={addActivity}
				>Agregar</button>
				<button
					class="px-3 py-1.5 bg-white border border-slate-200 hover:bg-slate-50 text-slate-600 rounded-lg text-xs font-medium transition-colors"
					onclick={() => { showAddForm = false; newActName = ''; addingParentId = null; }}
				>Cancelar</button>
				{#if addingParentId}
					<span class="text-xs text-slate-400">
						sub-actividad de: <strong>{actividades.find(a => a.id_cronograma_actividad === addingParentId)?.nombre_actividad ?? ''}</strong>
					</span>
				{/if}
			</div>
		{/if}

		</div><!-- /gantt main area -->

	<!-- ── RESTRICCIONES SECTION ──────────────────────────────────────────── -->
	{:else}
		<!-- Add restriction form -->
		{#if showRestrictForm}
			<div class="mx-4 mt-4 p-4 bg-slate-50 rounded-xl border border-slate-200">
				<h4 class="font-bold text-slate-700 text-sm mb-3"><i class="fas fa-plus-circle mr-1 text-orange-500"></i>Nueva Restricción</h4>
				<div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
					<div class="sm:col-span-2">
						<label class="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Vincular a actividad del cronograma (opcional)</label>
						<select
							class="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-orange-300"
							value={newR.idActividad ?? ''}
							onchange={(e) => {
								const v = (e.target as HTMLSelectElement).value;
								newR.idActividad = v ? Number(v) : null;
								const a = actividades.find(x => x.id_cronograma_actividad === newR.idActividad);
								if (a) newR.actividad = a.nombre_actividad;
							}}
						>
							<option value="">— Sin vincular (solo texto libre) —</option>
							{#each actividades as a}
								<option value={a.id_cronograma_actividad}>{'—'.repeat(Math.max(a.nivel - 1, 0))} {a.nombre_actividad}</option>
							{/each}
						</select>
						<p class="text-[10px] text-slate-400 mt-1">Al vincularla aparecerá con ⚠ en el cronograma, sobre la barra de esa actividad.</p>
					</div>
					<div class="sm:col-span-2">
						<label class="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Actividad relacionada *</label>
						<input class="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-orange-300" placeholder="Ej. Excavación — Cimiento Corrido" bind:value={newR.actividad} />
					</div>
					<div>
						<label class="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Tipo</label>
						<select class="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-orange-300" bind:value={newR.tipo}>
							<option value="">Sin clasificar</option>
							<option value="Diseño">Diseño / Ingeniería</option>
							<option value="Materiales">Materiales</option>
							<option value="Equipos">Equipos</option>
							<option value="Mano de Obra">Mano de Obra</option>
							<option value="Permisos">Permisos / Legal</option>
							<option value="Financiero">Financiero</option>
							<option value="Externo">Externo</option>
						</select>
					</div>
					<div>
						<label class="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Responsable</label>
						<input class="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-orange-300" placeholder="Nombre del responsable" bind:value={newR.responsable} />
					</div>
					<div>
						<label class="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Fecha Máxima *</label>
						<input type="date" class="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-orange-300" bind:value={newR.fecha} />
					</div>
					<div>
						<label class="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Descripción / Acción</label>
						<input class="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-orange-300" placeholder="Qué se necesita hacer…" bind:value={newR.descripcion} />
					</div>
				</div>
				<div class="flex gap-2 mt-3">
					<button class="px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white rounded-lg text-xs font-bold transition-colors" onclick={addRestriction}>Guardar</button>
					<button class="px-4 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-600 rounded-lg text-xs font-medium transition-colors" onclick={() => { showRestrictForm = false; newR = { actividad:'',responsable:'',fecha:'',tipo:'',descripcion:'',idActividad:null }; }}>Cancelar</button>
				</div>
			</div>
		{/if}

		<!-- Restrictions table -->
		<div class="flex-1 overflow-auto p-4">
			{#if restricciones.length === 0}
				<div class="text-center py-16">
					<div class="w-14 h-14 bg-amber-50 rounded-full flex items-center justify-center mx-auto mb-3 border border-amber-100">
						<i class="fas fa-check-circle text-2xl text-amber-400"></i>
					</div>
					<p class="font-bold text-slate-700 mb-1">Sin restricciones activas</p>
					<p class="text-slate-400 text-sm">¡El camino está libre! Agrega restricciones cuando detectes impedimentos.</p>
				</div>
			{:else}
				<div class="border border-slate-200 rounded-xl overflow-hidden">
					<table class="w-full text-xs text-left">
						<thead class="bg-slate-50 border-b border-slate-200 text-slate-500 font-bold uppercase tracking-wider">
							<tr>
								<th class="px-3 py-2.5">Actividad</th>
								<th class="px-3 py-2.5">Tipo</th>
								<th class="px-3 py-2.5">Responsable</th>
								<th class="px-3 py-2.5">Fecha Máx.</th>
								<th class="px-3 py-2.5">Estado</th>
								<th class="px-3 py-2.5 text-center">Acciones</th>
							</tr>
						</thead>
						<tbody class="divide-y divide-slate-100">
							{#each restricciones as r (r.id_restriccion)}
								{@const isOverdue = isRestriccionOverdue(r)}
								<tr class="hover:bg-slate-50/70 {isOverdue ? 'bg-rose-50/30' : ''}">
									<td class="px-3 py-2 max-w-[200px]">
										<div class="font-semibold text-slate-700 truncate">{r.actividad_relacionada}</div>
										{#if r.descripcion}
											<div class="text-slate-400 text-[10px] truncate mt-0.5">{r.descripcion}</div>
										{/if}
										{#if r.id_cronograma_actividad}
											<button
												class="mt-1 inline-flex items-center gap-1 text-[10px] text-orange-600 hover:text-orange-700 font-semibold"
												onclick={() => verEnGantt(r.id_cronograma_actividad!)}
											><i class="fas fa-chart-gantt text-[9px]"></i> Ver en cronograma</button>
										{/if}
									</td>
									<td class="px-3 py-2">
										{#if r.tipo_restriccion}
											<span class="px-1.5 py-0.5 bg-slate-100 text-slate-600 rounded text-[10px] font-medium">{r.tipo_restriccion}</span>
										{:else}
											<span class="text-slate-300">—</span>
										{/if}
									</td>
									<td class="px-3 py-2 text-slate-600">{r.responsable ?? '—'}</td>
									<td class="px-3 py-2">
										<span class="{isOverdue ? 'text-rose-600 font-bold' : 'text-slate-600'}">
											{new Date(r.fecha_maxima).toLocaleDateString('es-PE',{day:'2-digit',month:'short',year:'numeric'})}
											{#if isOverdue}<i class="fas fa-exclamation-triangle ml-1 text-[10px]"></i>{/if}
										</span>
									</td>
									<td class="px-3 py-2">
										<select
											class="border rounded px-1.5 py-0.5 text-[10px] font-bold cursor-pointer focus:outline-none
												{r.estado === 'abierta' ? 'bg-rose-50 border-rose-200 text-rose-700' :
												 r.estado === 'en_seguimiento' ? 'bg-amber-50 border-amber-200 text-amber-700' :
												 'bg-emerald-50 border-emerald-200 text-emerald-700'}"
											value={r.estado}
											onchange={(e) => setEstado(r.id_restriccion, (e.target as HTMLSelectElement).value)}
										>
											<option value="abierta">Abierta</option>
											<option value="en_seguimiento">Seguimiento</option>
											<option value="resuelta">Resuelta</option>
										</select>
									</td>
									<td class="px-3 py-2 text-center">
										<button
											class="w-6 h-6 rounded hover:bg-rose-50 hover:text-rose-600 text-slate-300 transition-colors inline-flex items-center justify-center"
											onclick={() => deleteRestricion(r.id_restriccion)}
											title="Eliminar"
										><i class="fas fa-trash-alt text-[10px]"></i></button>
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
		</div>
	{/if}
</div>

<!-- Popover de alta rápida de restricción (icono ⚑ al pasar el cursor sobre una barra) -->
{#if quickR}
	<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
	<div class="fixed inset-0 z-40" onclick={() => quickR = null}></div>
	<div
		class="fixed z-50 bg-white rounded-xl shadow-xl border border-slate-200 p-3.5 w-64"
		style="left:{Math.min(quickR.clientX, (typeof window !== 'undefined' ? window.innerWidth : 1000) - 272)}px;top:{quickR.clientY + 12}px"
	>
		<p class="text-xs font-bold text-slate-700 mb-0.5"><i class="fas fa-flag mr-1 text-orange-500"></i>Restricción rápida</p>
		<p class="text-[10px] text-slate-400 {quickR.nombreOrigen ? 'mb-1' : 'mb-2.5'} truncate">{quickR.nombre}</p>
		{#if quickR.nombreOrigen}
			<p class="text-[10px] text-amber-600 mb-2.5 flex items-center gap-1">
				<i class="fas fa-link"></i> Se resuelve cuando termine: <strong class="truncate">{quickR.nombreOrigen}</strong>
			</p>
		{/if}
		<div class="space-y-2">
			<div>
				<label class="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Fecha Máxima *</label>
				<input type="date" class="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg text-xs bg-white focus:outline-none focus:ring-2 focus:ring-orange-300" bind:value={quickR.fecha} autofocus />
			</div>
			<div>
				<label class="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Tipo</label>
				<select class="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg text-xs bg-white focus:outline-none focus:ring-2 focus:ring-orange-300" bind:value={quickR.tipo}>
					<option value="">Sin clasificar</option>
					<option value="Diseño">Diseño / Ingeniería</option>
					<option value="Materiales">Materiales</option>
					<option value="Equipos">Equipos</option>
					<option value="Mano de Obra">Mano de Obra</option>
					<option value="Permisos">Permisos / Legal</option>
					<option value="Financiero">Financiero</option>
					<option value="Externo">Externo</option>
				</select>
			</div>
			<div>
				<label class="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Descripción</label>
				<input class="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg text-xs bg-white focus:outline-none focus:ring-2 focus:ring-orange-300" placeholder="Qué se necesita hacer…" bind:value={quickR.descripcion} />
			</div>
		</div>
		<div class="flex gap-1.5 mt-3">
			<button class="flex-1 px-2 py-1.5 bg-orange-500 hover:bg-orange-600 text-white rounded-lg text-xs font-bold transition-colors disabled:opacity-50" disabled={!quickR.fecha} onclick={guardarQuickRestriccion}>Guardar</button>
			<button class="px-2 py-1.5 bg-white border border-slate-200 hover:bg-slate-50 text-slate-600 rounded-lg text-xs font-medium transition-colors" onclick={() => quickR = null}>Cancelar</button>
		</div>
	</div>
{/if}

