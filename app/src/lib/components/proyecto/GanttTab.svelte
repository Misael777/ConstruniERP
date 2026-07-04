<script lang="ts">
	import { supabase } from '$lib/supabaseClient';

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

	type FlatRow = Actividad & { depth: number; hasChildren: boolean };

	type PartidaItem = {
		id_partida: number;
		codigo: string;
		descripcion: string;
		nivel: number;
		id_partida_padre: number | null;
		unidad: string | null;
		precio_unitario: number | null;
	};

	type PartidaNode = PartidaItem & { children: PartidaNode[] };

	type PlantillaActividad = {
		id_plantilla_actividad: number;
		id_plantilla: number;
		id_partida: number | null;
		nombre_actividad: string;
		nivel: number;
		id_actividad_padre_template: number | null;
		duracion_dias: number;
		lag_inicio_dias: number;
		orden: number;
		partida?: { codigo: string; descripcion: string; unidad: string | null } | null;
	};

	type Plantilla = {
		id_plantilla: number;
		nombre: string;
		descripcion: string | null;
		categoria: string | null;
		actividades?: PlantillaActividad[];
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

	let collapsedIds = $state(new Set<number>());
	let selectedId   = $state<number | null>(null);

	let planBaseDate = $state<string | null>(null);

	// Budget sync: presupuesto ID for this project (stored so sidebar-drag can upsert)
	let presupuestoId  = $state<number | null>(null);

	// Partidas sidebar
	let showSidebar    = $state(true);
	let sidebarTab     = $state<'partidas' | 'plantillas'>('partidas');
	let partidas       = $state<PartidaItem[]>([]);
	let plantillas     = $state<Plantilla[]>([]);
	let buscarPartida  = $state('');
	let partidaExpIds  = $state(new Set<number>());

	// Sidebar drag state (ghost follows pointer)
	type SidebarDrag = { partida: PartidaItem; x: number; y: number };
	let sidebarDrag = $state<SidebarDrag | null>(null);

	// Plantilla application
	let applyingPlantId  = $state<number | null>(null);
	let plantStartDate   = $state(new Date().toISOString().slice(0, 10));

	// Row drag
	let dragSrcId  = $state<number | null>(null);
	let dragOverId = $state<number | null>(null);

	// Bar drag (pointer events — works on touch, mouse, stylus)
	type BarDrag = { id: number; mode: 'move' | 'resize'; startX: number; origStart: Date; origEnd: Date };
	let barDrag    = $state<BarDrag | null>(null);
	let barPreview = $state<{ id: number; start: Date; end: Date } | null>(null);

	// Inline add
	let showAddForm    = $state(false);
	let addingParentId = $state<number | null>(null);
	let newActName     = $state('');

	// Dependency creation
	let depSrcId = $state<number | null>(null);

	// Restrictions form
	let showRestrictForm = $state(false);
	let newR = $state({ actividad: '', responsable: '', fecha: '', tipo: '', descripcion: '' });

	// ── CONSTANTS ──────────────────────────────────────────────────────────────
	const DAY_PX    = 26;
	const ROW_H     = 44;  // ≥44 px for WCAG touch target minimum
	const HEADER_H  = 52;
	const LABEL_W   = 280;
	const MONTHS_ES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
	const BAR_COLORS = ['#f97316','#3b82f6','#14b8a6','#a78bfa','#f43f5e','#eab308'];

	// ── DERIVED ────────────────────────────────────────────────────────────────
	const flatList = $derived.by(() => {
		const childMap = new Map<number | null, Actividad[]>();
		for (const a of actividades) {
			const key = a.id_actividad_padre ?? null;
			if (!childMap.has(key)) childMap.set(key, []);
			childMap.get(key)!.push(a);
		}
		for (const [, arr] of childMap) arr.sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0));

		const result: FlatRow[] = [];
		function dfs(pid: number | null, depth: number) {
			for (const a of childMap.get(pid) ?? []) {
				const hasChildren = (childMap.get(a.id_cronograma_actividad)?.length ?? 0) > 0;
				result.push({ ...a, depth, hasChildren });
				if (hasChildren && !collapsedIds.has(a.id_cronograma_actividad))
					dfs(a.id_cronograma_actividad, depth + 1);
			}
		}
		dfs(null, 0);
		return result;
	});

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

	const totalDays  = $derived(Math.ceil((+timelineEnd - +timelineStart) / 864e5));
	const totalWidth = $derived(Math.max(totalDays * DAY_PX, 600));

	const monthHeaders = $derived.by(() => {
		const out: { label: string; left: number; width: number }[] = [];
		let cur = new Date(timelineStart.getFullYear(), timelineStart.getMonth(), 1);
		while (+cur < +timelineEnd) {
			const next = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
			const cStart = Math.max(+cur, +timelineStart);
			const cEnd   = Math.min(+next, +timelineEnd);
			out.push({
				label: `${MONTHS_ES[cur.getMonth()]} ${cur.getFullYear()}`,
				left:  (+cStart - +timelineStart) / 864e5 * DAY_PX,
				width: (+cEnd   - +cStart)         / 864e5 * DAY_PX,
			});
			cur = next;
		}
		return out;
	});

	const weekHeaders = $derived.by(() => {
		const out: { label: string; left: number }[] = [];
		const d = new Date(timelineStart);
		while (+d < +timelineEnd) {
			out.push({ label: `S${getWeekNum(d)}`, left: (+d - +timelineStart) / 864e5 * DAY_PX });
			d.setDate(d.getDate() + 7);
		}
		return out;
	});

	const todayPx = $derived(Math.max(0, (+new Date() - +timelineStart) / 864e5 * DAY_PX));

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

	// ── PARTIDA TREE (filtered) ────────────────────────────────────────────────
	const filteredPartidas = $derived.by(() => {
		if (!buscarPartida.trim()) return partidas;
		const q = buscarPartida.toLowerCase();
		return partidas.filter(p =>
			p.descripcion.toLowerCase().includes(q) || p.codigo.toLowerCase().includes(q)
		);
	});

	const partidaTree = $derived.by((): PartidaNode[] => {
		const map = new Map<number, PartidaNode>();
		for (const p of filteredPartidas) map.set(p.id_partida, { ...p, children: [] });
		const roots: PartidaNode[] = [];
		for (const p of filteredPartidas) {
			const node = map.get(p.id_partida)!;
			if (p.id_partida_padre && map.has(p.id_partida_padre)) {
				map.get(p.id_partida_padre)!.children.push(node);
			} else {
				roots.push(node);
			}
		}
		return roots;
	});

	// ── DATE UTILS ─────────────────────────────────────────────────────────────
	function dateToPx(d: Date) { return (+d - +timelineStart) / 864e5 * DAY_PX; }
	function addDays(d: Date, n: number) { return new Date(+d + n * 864e5); }
	function fmt(d: Date)  { return d.toISOString().slice(0, 10); }
	function fmtDisp(s: string | null) {
		if (!s) return '—';
		return new Date(s).toLocaleDateString('es-PE', { day: '2-digit', month: 'short' });
	}
	function daysDiff(s: string, e: string) { return Math.ceil((+new Date(e) - +new Date(s)) / 864e5) + 1; }
	function getWeekNum(d: Date) {
		const j1 = new Date(d.getFullYear(), 0, 1);
		return Math.ceil(((+d - +j1) / 864e5 + j1.getDay() + 1) / 7);
	}
	function barColor(a: Actividad) {
		return a.color ?? (a.nivel === 1 ? '#f97316' : a.nivel === 2 ? '#3b82f6' : '#14b8a6');
	}

	// ── BAR DATES (live during drag) ───────────────────────────────────────────
	function getBarDates(a: Actividad): { start: Date; end: Date } | null {
		if (barPreview?.id === a.id_cronograma_actividad) return barPreview;
		if (!a.fecha_inicio_plan || !a.fecha_fin_plan) return null;
		return { start: new Date(a.fecha_inicio_plan), end: new Date(a.fecha_fin_plan) };
	}

	// ── LOAD ───────────────────────────────────────────────────────────────────
	async function load() {
		isLoading = true;

		const [{ data: acts }, { data: rests }, { data: pb }, { data: plantas }] = await Promise.all([
			// Join partida so each activity carries its catalog code+unit
			supabase.from('cronograma_actividad')
				.select('*, partida:id_partida(codigo, descripcion, unidad)')
				.eq('id_proyecto', projectId)
				.order('orden').order('id_cronograma_actividad'),
			supabase.from('restriccion').select('*').eq('id_proyecto', projectId)
				.order('created_at', { ascending: false }),
			supabase.from('cronograma_plan_base').select('fecha_snapshot').eq('id_proyecto', projectId)
				.order('created_at', { ascending: false }).limit(1).maybeSingle(),
			supabase.from('plantilla_cronograma')
				.select('*, actividades:plantilla_actividad(*, partida:id_partida(codigo, descripcion, unidad))')
				.order('nombre'),
		]);

		actividades   = (acts ?? []) as Actividad[];
		restricciones = (rests ?? []) as Restriccion[];
		planBaseDate  = pb?.fecha_snapshot ?? null;
		plantillas    = (plantas ?? []) as Plantilla[];

		if (actividades.length) {
			const ids = actividades.map(a => a.id_cronograma_actividad);
			const { data: deps } = await supabase.from('cronograma_dependencia')
				.select('*').in('id_actividad_origen', ids);
			dependencias = (deps ?? []) as Dependencia[];
		}

		// Load partidas: prefer project's presupuesto_detalle, fall back to full catalog
		await loadPartidas();
		isLoading = false;
	}

	async function loadPartidas() {
		// Try to get the project's presupuesto (use id_pres_inicial or the latest one)
		const { data: pres } = await supabase.from('presupuesto')
			.select('id_presupuesto')
			.eq('id_proyecto', projectId)
			.order('created_at', { ascending: false })
			.limit(1).maybeSingle();

		if (pres) {
			presupuestoId = pres.id_presupuesto;
			// Load partidas instanciadas en el presupuesto del proyecto
			const { data: pd } = await supabase.from('presupuesto_detalle')
				.select('id_partida, partida:id_partida(id_partida, codigo, descripcion, nivel, id_partida_padre, unidad, precio_unitario)')
				.eq('id_presupuesto', pres.id_presupuesto)
				.order('id_partida');
			if (pd && pd.length > 0) {
				partidas = pd
					.map((row: any) => row.partida)
					.filter(Boolean)
					.filter((p: any, i: number, arr: any[]) =>
						arr.findIndex(x => x.id_partida === p.id_partida) === i
					) as PartidaItem[];
				return;
			}
		}
		// Fallback: load the full catalog
		const { data: cats } = await supabase.from('partida').select('*').order('codigo');
		partidas = (cats ?? []) as PartidaItem[];
	}

	// ── SAVE DATES ─────────────────────────────────────────────────────────────
	async function saveBarDates(id: number, start: Date, end: Date) {
		const s = fmt(start), e = fmt(end);
		await supabase.from('cronograma_actividad').update({ fecha_inicio_plan: s, fecha_fin_plan: e })
			.eq('id_cronograma_actividad', id);
		actividades = actividades.map(a =>
			a.id_cronograma_actividad === id ? { ...a, fecha_inicio_plan: s, fecha_fin_plan: e } : a
		);
	}

	// ── BAR DRAG (Pointer Events API — mouse + touch + stylus) ───────────────
	function startBarDrag(e: PointerEvent, id: number, mode: 'move' | 'resize') {
		e.preventDefault(); e.stopPropagation();
		const a = actividades.find(x => x.id_cronograma_actividad === id);
		if (!a) return;
		barDrag = {
			id, mode, startX: e.clientX,
			origStart: new Date(a.fecha_inicio_plan ?? new Date()),
			origEnd:   new Date(a.fecha_fin_plan   ?? new Date()),
		};

		const onMove = (ev: PointerEvent) => {
			if (!barDrag) return;
			const days = Math.round((ev.clientX - barDrag.startX) / DAY_PX);
			if (barDrag.mode === 'move') {
				barPreview = { id: barDrag.id, start: addDays(barDrag.origStart, days), end: addDays(barDrag.origEnd, days) };
			} else {
				const newEnd = addDays(barDrag.origEnd, days);
				if (+newEnd > +barDrag.origStart)
					barPreview = { id: barDrag.id, start: barDrag.origStart, end: newEnd };
			}
		};
		const onUp = async () => {
			if (barPreview) {
				await saveBarDates(barPreview.id, barPreview.start, barPreview.end);
				barPreview = null;
			}
			barDrag = null;
			window.removeEventListener('pointermove', onMove);
			window.removeEventListener('pointerup', onUp);
		};
		window.addEventListener('pointermove', onMove);
		window.addEventListener('pointerup', onUp);
	}

	// ── DEPENDENCY CREATION (drag from bar end) ────────────────────────────────
	async function createDep(srcId: number, dstId: number) {
		if (srcId === dstId) return;
		const exists = dependencias.some(d => d.id_actividad_origen === srcId && d.id_actividad_destino === dstId);
		if (exists) return;
		const { data } = await supabase.from('cronograma_dependencia')
			.insert({ id_actividad_origen: srcId, id_actividad_destino: dstId, tipo_dependencia: 'FS', lag_dias: 0 })
			.select().single();
		if (data) dependencias = [...dependencias, data as Dependencia];
	}

	// ── ROW DRAG (Pointer Events — works on touch + mouse) ────────────────────
	// Uses elementFromPoint hit-testing instead of HTML5 DnD (which has no touch support).
	function startRowDrag(e: PointerEvent, id: number) {
		e.preventDefault();
		dragSrcId = id;

		const onMove = (ev: PointerEvent) => {
			const el = document.elementFromPoint(ev.clientX, ev.clientY);
			const rowEl = el?.closest('[data-row-id]') as HTMLElement | null;
			dragOverId = rowEl ? Number(rowEl.dataset.rowId) : null;
		};
		const onUp = async () => {
			if (dragOverId !== null && dragOverId !== dragSrcId) await commitRowDrop(dragOverId);
			dragSrcId = null; dragOverId = null;
			window.removeEventListener('pointermove', onMove);
			window.removeEventListener('pointerup', onUp);
		};
		window.addEventListener('pointermove', onMove);
		window.addEventListener('pointerup', onUp);
	}

	async function commitRowDrop(targetId: number) {
		if (!dragSrcId || dragSrcId === targetId) return;
		const si = actividades.findIndex(a => a.id_cronograma_actividad === dragSrcId);
		const ti = actividades.findIndex(a => a.id_cronograma_actividad === targetId);
		if (si === -1 || ti === -1) return;
		const next = [...actividades];
		const [moved] = next.splice(si, 1);
		next.splice(ti, 0, moved);
		actividades = next.map((a, i) => ({ ...a, orden: i + 1 }));
		for (let i = 0; i < actividades.length; i++) {
			await supabase.from('cronograma_actividad')
				.update({ orden: i + 1 })
				.eq('id_cronograma_actividad', actividades[i].id_cronograma_actividad);
		}
	}

	// ── COLLAPSE ───────────────────────────────────────────────────────────────
	function toggleCollapse(id: number) {
		const s = new Set(collapsedIds);
		s.has(id) ? s.delete(id) : s.add(id);
		collapsedIds = s;
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

	// ── BUDGET SYNC ───────────────────────────────────────────────────────────
	// Ensures id_partida appears in presupuesto_detalle so the Presupuesto tab shows it.
	async function syncPartidaToBudget(idPartida: number) {
		if (!presupuestoId) {
			const { data: newPres } = await supabase.from('presupuesto').insert({
				id_proyecto: projectId,
				nombre: `Presupuesto - ${proyecto.nombre_proyecto}`,
				tipo: 'obra',
			}).select('id_presupuesto').single();
			presupuestoId = newPres?.id_presupuesto ?? null;
		}
		if (!presupuestoId) return;

		const { data: existing } = await supabase.from('presupuesto_detalle')
			.select('id_presupuesto_detalle')
			.eq('id_presupuesto', presupuestoId)
			.eq('id_partida', idPartida)
			.maybeSingle();

		if (!existing) {
			await supabase.from('presupuesto_detalle').insert({
				id_presupuesto: presupuestoId,
				id_partida: idPartida,
				cantidad: 1,
				precio_mo: 0,
				precio_mat: 0,
			});
		}
	}

	// ── ADD FROM PARTIDA (sidebar + or drag-drop) ──────────────────────────────
	async function addFromPartida(p: PartidaItem, parentId: number | null = selectedId) {
		const siblings = actividades.filter(a => a.id_actividad_padre === parentId);
		const parent   = parentId ? actividades.find(a => a.id_cronograma_actividad === parentId) : null;
		const nivel    = parent ? parent.nivel + 1 : 1;
		const { data } = await supabase.from('cronograma_actividad').insert({
			id_proyecto: projectId,
			nombre_actividad: p.descripcion,
			nivel,
			id_actividad_padre: parentId,
			orden: siblings.length + 1,
			porcentaje_avance_real: 0,
			id_partida: p.id_partida,
		}).select('*, partida:id_partida(codigo, descripcion, unidad)').single();
		if (data) actividades = [...actividades, data as Actividad];
		// Mirror to budget so user can set quantities/prices in Presupuesto tab
		await syncPartidaToBudget(p.id_partida);
	}

	// ── SIDEBAR DRAG (partida → gantt) ────────────────────────────────────────
	function startSidebarDrag(e: PointerEvent, p: PartidaItem) {
		e.preventDefault();
		sidebarDrag = { partida: p, x: e.clientX, y: e.clientY };

		const onMove = (ev: PointerEvent) => {
			if (sidebarDrag) sidebarDrag = { ...sidebarDrag, x: ev.clientX, y: ev.clientY };
		};
		const onUp = async (ev: PointerEvent) => {
			if (sidebarDrag) {
				const el = document.elementFromPoint(ev.clientX, ev.clientY);
				const rowEl = el?.closest('[data-row-id]') as HTMLElement | null;
				const parentId = rowEl ? Number(rowEl.dataset.rowId) : null;
				await addFromPartida(sidebarDrag.partida, parentId);
			}
			sidebarDrag = null;
			window.removeEventListener('pointermove', onMove);
			window.removeEventListener('pointerup', onUp);
		};
		window.addEventListener('pointermove', onMove);
		window.addEventListener('pointerup', onUp);
	}

	// ── APPLY PLANTILLA ────────────────────────────────────────────────────────
	async function applyPlantilla(plant: Plantilla) {
		if (!plant.actividades?.length) return;
		const startDate = new Date(plantStartDate + 'T00:00:00');
		const idMap = new Map<number, number>(); // template id → new cronograma_actividad id
		const sorted = [...plant.actividades].sort((a, b) =>
			a.lag_inicio_dias - b.lag_inicio_dias || a.orden - b.orden
		);
		for (const ta of sorted) {
			const inicio    = addDays(startDate, ta.lag_inicio_dias);
			const fin       = addDays(inicio, Math.max(ta.duracion_dias - 1, 0));
			const parentAct = ta.id_actividad_padre_template ? idMap.get(ta.id_actividad_padre_template) ?? null : null;
			const siblings  = actividades.filter(a => a.id_actividad_padre === parentAct);
			const { data }  = await supabase.from('cronograma_actividad').insert({
				id_proyecto: projectId,
				nombre_actividad: ta.nombre_actividad,
				nivel: ta.nivel,
				id_actividad_padre: parentAct,
				orden: actividades.length + siblings.length + 1,
				porcentaje_avance_real: 0,
				id_partida: ta.id_partida ?? null,
				fecha_inicio_plan: fmt(inicio),
				fecha_fin_plan: fmt(fin),
			}).select('*, partida:id_partida(codigo, descripcion, unidad)').single();
			if (data) {
				actividades = [...actividades, data as Actividad];
				idMap.set(ta.id_plantilla_actividad, (data as Actividad).id_cronograma_actividad);
			}
			if (ta.id_partida) await syncPartidaToBudget(ta.id_partida);
		}
		applyingPlantId = null;
	}

	function togglePartidaExp(id: number) {
		const s = new Set(partidaExpIds);
		s.has(id) ? s.delete(id) : s.add(id);
		partidaExpIds = s;
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
			estado: 'abierta',
		}).select().single();
		if (data) restricciones = [data as Restriccion, ...restricciones];
		newR = { actividad: '', responsable: '', fecha: '', tipo: '', descripcion: '' };
		showRestrictForm = false;
	}

	async function setEstado(id: number, estado: string) {
		await supabase.from('restriccion').update({ estado }).eq('id_restriccion', id);
		restricciones = restricciones.map(r => r.id_restriccion === id ? { ...r, estado } : r);
	}

	async function deleteRestricion(id: number) {
		await supabase.from('restriccion').delete().eq('id_restriccion', id);
		restricciones = restricciones.filter(r => r.id_restriccion !== id);
	}

	// ── DEPENDENCY SVG PATHS ──────────────────────────────────────────────────
	function depPath(dep: Dependencia): string | null {
		const si = flatList.findIndex(r => r.id_cronograma_actividad === dep.id_actividad_origen);
		const di = flatList.findIndex(r => r.id_cronograma_actividad === dep.id_actividad_destino);
		if (si === -1 || di === -1) return null;
		const srcDates = getBarDates(flatList[si]);
		const dstDates = getBarDates(flatList[di]);
		if (!srcDates || !dstDates) return null;
		const x1 = dateToPx(srcDates.end);
		const y1 = si * ROW_H + ROW_H / 2;
		const x2 = dateToPx(dstDates.start);
		const y2 = di * ROW_H + ROW_H / 2;
		const mx = Math.max(x1 + 12, x2 - 12);
		return `M${x1},${y1} L${mx},${y1} L${mx},${y2} L${x2},${y2}`;
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
			<!-- Sidebar toggle -->
			<button
				class="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border transition-colors font-medium {showSidebar ? 'bg-orange-50 border-orange-200 text-orange-700' : 'bg-white border-slate-200 text-slate-500'}"
				onclick={() => showSidebar = !showSidebar}
				title="Mostrar/ocultar panel de partidas"
			><i class="fas fa-layer-group text-[10px]"></i> Partidas</button>

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

			<div class="flex-1"></div>

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
		<!-- Two-column layout: partidas sidebar + gantt area -->
		<div class="flex flex-1 min-h-0 overflow-hidden">

		<!-- ════ PARTIDAS / PLANTILLAS SIDEBAR ════════════════════════════════ -->
		{#if showSidebar}
		<div class="flex flex-col border-r border-slate-200 bg-slate-50" style="width:240px;flex-shrink:0;min-width:200px">
			<!-- Sidebar header -->
			<div class="flex items-center border-b border-slate-200 bg-white">
				<button
					class="flex-1 py-2 text-[11px] font-bold uppercase tracking-wider transition-colors
						{sidebarTab === 'partidas' ? 'text-orange-600 border-b-2 border-orange-500' : 'text-slate-400 hover:text-slate-600'}"
					onclick={() => sidebarTab = 'partidas'}
				>Partidas</button>
				<button
					class="flex-1 py-2 text-[11px] font-bold uppercase tracking-wider transition-colors
						{sidebarTab === 'plantillas' ? 'text-orange-600 border-b-2 border-orange-500' : 'text-slate-400 hover:text-slate-600'}"
					onclick={() => sidebarTab = 'plantillas'}
				>Plantillas</button>
				<button
					class="px-2 py-2 text-slate-300 hover:text-slate-600"
					onclick={() => showSidebar = false}
					title="Ocultar panel"
				><i class="fas fa-chevron-left text-xs"></i></button>
			</div>

			{#if sidebarTab === 'partidas'}
				<!-- Search -->
				<div class="px-2 py-2 border-b border-slate-100">
					<div class="flex items-center gap-1.5 px-2 py-1.5 bg-white rounded-lg border border-slate-200">
						<i class="fas fa-search text-slate-300 text-[10px]"></i>
						<input
							class="flex-1 text-xs bg-transparent outline-none placeholder-slate-300"
							placeholder="Buscar partida…"
							bind:value={buscarPartida}
						/>
						{#if buscarPartida}<button class="text-slate-300 hover:text-slate-500 text-[10px]" onclick={() => buscarPartida = ''}><i class="fas fa-times"></i></button>{/if}
					</div>
				</div>
				<!-- Partida tree -->
				<div class="flex-1 overflow-y-auto text-xs">
					{#if partidas.length === 0}
						<div class="px-3 py-6 text-center text-slate-400 text-[11px]">
							<i class="fas fa-box-open text-xl mb-2 block text-slate-300"></i>
							Sin partidas en el presupuesto.<br>Agrega partidas al presupuesto del proyecto primero.
						</div>
					{:else}
						{#each partidaTree as node}
							{@render PartidaNodeRow(node, 0)}
						{/each}
					{/if}
				</div>
				<div class="px-2 py-2 border-t border-slate-100 text-[10px] text-slate-400 text-center">
					Arrastra o presiona <strong>+</strong> para agregar al cronograma
				</div>

			{:else}
				<!-- Plantillas tab -->
				<div class="flex-1 overflow-y-auto p-2 space-y-2">
					{#if plantillas.length === 0}
						<div class="py-6 text-center text-slate-400 text-[11px]">
							<i class="fas fa-layer-group text-xl mb-2 block text-slate-300"></i>
							Sin plantillas disponibles.
						</div>
					{:else}
						{#each plantillas as plant (plant.id_plantilla)}
							<div class="bg-white rounded-lg border border-slate-200 p-2.5 text-xs">
								<div class="font-bold text-slate-700 mb-0.5">{plant.nombre}</div>
								{#if plant.descripcion}
									<div class="text-slate-400 text-[10px] mb-1.5">{plant.descripcion}</div>
								{/if}
								<div class="text-slate-400 text-[10px] mb-2">
									{plant.actividades?.length ?? 0} actividades
									{#if plant.categoria}· <span class="text-orange-500">{plant.categoria}</span>{/if}
								</div>

								{#if applyingPlantId === plant.id_plantilla}
									<div class="flex gap-1 items-center mt-1">
										<input
											type="date"
											class="flex-1 px-1.5 py-1 border border-slate-200 rounded text-[10px] bg-white focus:outline-none focus:ring-1 focus:ring-orange-300"
											bind:value={plantStartDate}
										/>
										<button
											class="px-2 py-1 bg-orange-500 hover:bg-orange-600 text-white rounded text-[10px] font-bold transition-colors whitespace-nowrap"
											onclick={() => applyPlantilla(plant)}
										>Aplicar</button>
										<button
											class="px-1.5 py-1 text-slate-400 hover:text-slate-600 text-[10px]"
											onclick={() => applyingPlantId = null}
										><i class="fas fa-times"></i></button>
									</div>
								{:else}
									<button
										class="w-full py-1.5 bg-orange-50 hover:bg-orange-100 text-orange-600 border border-orange-200 rounded text-[10px] font-bold transition-colors"
										onclick={() => applyingPlantId = plant.id_plantilla}
									><i class="fas fa-magic mr-1"></i>Aplicar plantilla</button>
								{/if}
							</div>
						{/each}
					{/if}
				</div>
			{/if}
		</div>
		{:else}
			<!-- Collapsed sidebar: show toggle button -->
			<div class="flex flex-col items-center py-3 border-r border-slate-200 bg-slate-50" style="width:28px;flex-shrink:0">
				<button
					class="text-slate-400 hover:text-orange-500 transition-colors"
					onclick={() => showSidebar = true}
					title="Mostrar partidas"
				><i class="fas fa-layer-group text-xs"></i></button>
				<div class="mt-2 text-slate-300 text-[9px] font-bold uppercase tracking-widest" style="writing-mode:vertical-rl;transform:rotate(180deg)">Partidas</div>
			</div>
		{/if}

		<!-- ════ GANTT MAIN AREA ═══════════════════════════════════════════════ -->
		<div class="flex-1 flex flex-col min-w-0 min-h-0">

		{#if actividades.length === 0 && !showAddForm}
			<div class="flex-1 flex flex-col items-center justify-center py-16 text-center">
				<div class="w-16 h-16 bg-orange-50 rounded-full flex items-center justify-center mb-4 border border-orange-100">
					<i class="fas fa-chart-gantt text-2xl text-orange-400"></i>
				</div>
				<h4 class="font-bold text-slate-700 mb-1">Sin actividades aún</h4>
				<p class="text-slate-400 text-sm mb-4">
					Arrastra partidas desde el panel izquierdo o agrega actividades manualmente
				</p>
				<button
					class="px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white rounded-xl text-sm font-semibold transition-colors"
					onclick={() => { addingParentId = null; showAddForm = true; }}
				><i class="fas fa-plus mr-2"></i>Agregar primera actividad</button>
			</div>
		{:else}
			<!-- Gantt scrollable area: touch-action pan-x pan-y lets the user scroll
			     freely; individual drag targets (bars, drag handles) override with none -->
			<div class="flex-1 overflow-auto" style="max-height:calc(100vh - 280px);touch-action:pan-x pan-y;-webkit-overflow-scrolling:touch">
				<div style="min-width:{LABEL_W + totalWidth}px">

					<!-- ── HEADER (sticky top) ──────────────────────────────── -->
					<div class="flex sticky top-0 z-30 bg-white border-b border-slate-200 select-none" style="height:{HEADER_H}px">
						<!-- Label header -->
						<div
							class="sticky left-0 z-40 bg-slate-50 border-r border-slate-200 flex items-end px-3 pb-1"
							style="width:{LABEL_W}px;flex-shrink:0;height:{HEADER_H}px"
						>
							<span class="text-[10px] font-bold uppercase tracking-wider text-slate-400">Actividad</span>
						</div>
						<!-- Timeline header -->
						<div class="relative flex-1" style="width:{totalWidth}px;height:{HEADER_H}px">
							<!-- Month row -->
							<div class="absolute top-0 left-0 right-0 h-6 border-b border-slate-100">
								{#each monthHeaders as mh}
									<div
										class="absolute top-0 h-6 flex items-center pl-2 text-[10px] font-bold text-slate-500 border-r border-slate-200 overflow-hidden"
										style="left:{mh.left}px;width:{mh.width}px"
									>{mh.label}</div>
								{/each}
							</div>
							<!-- Week row -->
							<div class="absolute bottom-0 left-0 right-0 h-6">
								{#each weekHeaders as wh}
									<div
										class="absolute top-0 h-6 flex items-center pl-1.5 text-[9px] text-slate-400 border-r border-slate-100 overflow-hidden"
										style="left:{wh.left}px;width:{7 * DAY_PX}px"
									>{wh.label}</div>
								{/each}
							</div>
							<!-- Today marker header -->
							<div
								class="absolute top-0 bottom-0 w-px bg-orange-400 z-10"
								style="left:{todayPx}px"
							></div>
						</div>
					</div>

					<!-- ── ROWS ────────────────────────────────────────────── -->
					<div class="relative">
						<!-- SVG dependency overlay -->
						{#if showDeps && dependencias.length > 0}
							<svg
								class="absolute pointer-events-none z-20"
								style="left:{LABEL_W}px;top:0;width:{totalWidth}px;height:{flatList.length * ROW_H}px;overflow:visible"
							>
								<defs>
									<marker id="arr" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
										<path d="M0,0 L6,3 L0,6 Z" fill="#94a3b8" />
									</marker>
									<marker id="arr-hl" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
										<path d="M0,0 L6,3 L0,6 Z" fill="#f97316" />
									</marker>
								</defs>
								{#each dependencias as dep}
									{@const path = depPath(dep)}
									{#if path}
										{@const isSelected = selectedId === dep.id_actividad_origen || selectedId === dep.id_actividad_destino}
										<path
											d={path}
											fill="none"
											stroke={isSelected ? '#f97316' : '#94a3b8'}
											stroke-width={isSelected ? 2 : 1.5}
											stroke-dasharray="5 3"
											marker-end={isSelected ? 'url(#arr-hl)' : 'url(#arr)'}
											opacity={isSelected ? 1 : 0.6}
										/>
									{/if}
								{/each}
							</svg>
						{/if}

						{#each flatList as row, ri (row.id_cronograma_actividad)}
							{@const barDates = getBarDates(row)}
							{@const pbDates  = (row.plan_base_inicio && row.plan_base_fin) ? { start: new Date(row.plan_base_inicio), end: new Date(row.plan_base_fin) } : null}
							{@const realDates= (showAvanceReal && row.fecha_inicio_real && row.fecha_fin_real) ? { start: new Date(row.fecha_inicio_real), end: new Date(row.fecha_fin_real) } : null}
							{@const bc = barColor(row)}
							{@const isSelected = selectedId === row.id_cronograma_actividad}

							<!-- data-row-id is used by startRowDrag's elementFromPoint hit-test -->
							<div
								class="flex border-b transition-colors {isSelected ? 'bg-orange-50/50' : 'hover:bg-slate-50/70'} {dragOverId === row.id_cronograma_actividad ? 'bg-blue-50' : ''}"
								style="height:{ROW_H}px"
								data-row-id={row.id_cronograma_actividad}
								role="row"
								tabindex="0"
							>
								<!-- ── LABEL CELL ──────────────────────────── -->
								<div
									class="group sticky left-0 z-10 flex items-center gap-1 border-r border-slate-100 px-1 select-none"
									style="width:{LABEL_W}px;flex-shrink:0;padding-left:{4 + row.depth * 14}px;background:inherit"
									onclick={() => selectedId = isSelected ? null : row.id_cronograma_actividad}
									role="gridcell"
									tabindex="0"
								>
									<!-- Drag handle: pointer events for cross-platform touch+mouse support -->
									<div
										class="cursor-grab text-slate-400 hover:text-slate-600 px-0.5 text-[13px] shrink-0 select-none"
										onpointerdown={(e) => startRowDrag(e, row.id_cronograma_actividad)}
										style="touch-action: none;"
										role="button"
										tabindex="0"
										aria-label="Arrastrar para reordenar"
									>⣿</div>

									<!-- Collapse toggle -->
									{#if row.hasChildren}
										<button
											class="w-4 h-4 flex items-center justify-center text-slate-400 hover:text-slate-600 shrink-0"
											onclick={(e) => { e.stopPropagation(); toggleCollapse(row.id_cronograma_actividad); }}
										>
											<i class="fas fa-chevron-{collapsedIds.has(row.id_cronograma_actividad) ? 'right' : 'down'} text-[8px]"></i>
										</button>
									{:else}
										<div class="w-4 shrink-0"></div>
									{/if}

									<!-- Color dot -->
									<div class="w-2 h-2 rounded-full shrink-0" style="background:{bc}"></div>

									<!-- Name + partida code chip -->
									<div class="flex-1 min-w-0">
										{#if row.partida?.codigo}
											<div class="text-[9px] text-orange-500 font-mono font-bold leading-none mb-0.5 truncate">{row.partida.codigo}{row.partida.unidad ? ` · ${row.partida.unidad}` : ''}</div>
										{/if}
										<span
											class="text-xs truncate block"
											class:font-bold={row.nivel <= 2}
											class:text-slate-800={row.nivel === 1}
											class:text-slate-700={row.nivel === 2}
											class:text-slate-600={row.nivel > 2}
										>{row.nombre_actividad}</span>
									</div>

									<!-- Row actions: visible on hover (desktop) or when selected (touch) -->
									<div class="flex gap-0.5 {isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'} transition-opacity shrink-0">
										<button
											class="w-5 h-5 flex items-center justify-center rounded text-slate-300 hover:text-blue-500 hover:bg-blue-50 text-[9px]"
											title="Agregar sub-actividad"
											onclick={(e) => { e.stopPropagation(); addingParentId = row.id_cronograma_actividad; showAddForm = true; }}
										><i class="fas fa-plus"></i></button>
										<button
											class="w-5 h-5 flex items-center justify-center rounded text-slate-300 hover:text-rose-500 hover:bg-rose-50 text-[9px]"
											title="Eliminar"
											onclick={(e) => { e.stopPropagation(); deleteActividad(row.id_cronograma_actividad); }}
										><i class="fas fa-trash-alt"></i></button>
									</div>
								</div>

								<!-- ── TIMELINE CELL ────────────────────────── -->
								<div class="relative flex-1" style="width:{totalWidth}px;height:{ROW_H}px">
									<!-- Alternating row bg -->
									{#if ri % 2 === 0}
										<div class="absolute inset-0 bg-slate-50/30 pointer-events-none"></div>
									{/if}

									<!-- Week grid lines -->
									{#each weekHeaders as wh}
										<div class="absolute top-0 bottom-0 w-px bg-slate-100/60" style="left:{wh.left}px"></div>
									{/each}

									<!-- Today marker -->
									<div class="absolute top-0 bottom-0 w-px bg-orange-400/60 z-10" style="left:{todayPx}px"></div>

									{#if barDates}
										{@const left  = dateToPx(barDates.start)}
										{@const width = Math.max(dateToPx(barDates.end) - left + DAY_PX, 8)}
										{@const barTop = (ROW_H - (row.nivel === 1 ? 22 : 18)) / 2}
										{@const barH   = row.nivel === 1 ? 22 : 18}

										<!-- Plan base ghost bar -->
										{#if pbDates}
											{@const pl = dateToPx(pbDates.start)}
											{@const pw = Math.max(dateToPx(pbDates.end) - pl + DAY_PX, 4)}
											<div
												class="absolute rounded pointer-events-none"
												style="left:{pl}px;width:{pw}px;top:{barTop + 2}px;height:{barH - 4}px;background:{bc};opacity:0.18;border:1px dashed {bc}"
											></div>
										{/if}

										<!-- Real bar -->
										{#if realDates}
											{@const rl = dateToPx(realDates.start)}
											{@const rw = Math.max(dateToPx(realDates.end) - rl + DAY_PX, 4)}
											<div
												class="absolute rounded pointer-events-none"
												style="left:{rl}px;width:{rw}px;top:{barTop + barH - 5}px;height:4px;background:#1d4ed8;opacity:0.7"
											></div>
										{/if}

										<!-- Main plan bar: touch-action none so pointer events reach us -->
										<div
											class="absolute rounded overflow-hidden select-none cursor-move group/bar shadow-sm"
											style="left:{left}px;width:{width}px;top:{barTop}px;height:{barH}px;background:{bc};opacity:{barDrag?.id === row.id_cronograma_actividad ? 0.6 : 0.85};touch-action:none"
											onpointerdown={(e) => startBarDrag(e, row.id_cronograma_actividad, 'move')}
										>
											<!-- Avance overlay -->
											{#if row.porcentaje_avance_real > 0}
												<div
													class="absolute inset-y-0 left-0 pointer-events-none"
													style="width:{Math.min(row.porcentaje_avance_real, 100)}%;background:rgba(0,0,0,0.22)"
												></div>
											{/if}

											<!-- Bar label -->
											{#if width > 50}
												<span class="absolute inset-0 flex items-center px-1.5 text-[9px] font-bold text-white pointer-events-none overflow-hidden whitespace-nowrap">
													{row.fecha_inicio_plan && row.fecha_fin_plan ? daysDiff(row.fecha_inicio_plan, row.fecha_fin_plan) + 'd' : ''}
													{row.porcentaje_avance_real > 0 ? ` · ${row.porcentaje_avance_real}%` : ''}
												</span>
											{/if}

											<!-- Resize handle: wider on touch (12px instead of 8px) -->
											<div
												class="absolute right-0 top-0 bottom-0 w-3 cursor-col-resize hover:bg-black/20"
												style="touch-action:none"
												onpointerdown={(e) => { e.stopPropagation(); startBarDrag(e, row.id_cronograma_actividad, 'resize'); }}
											></div>

											<!-- Dependency connect point: tap to select row first, then drag dot -->
											{#if isSelected}
												<div
													class="absolute -right-3 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-orange-500 border-2 border-white cursor-crosshair z-20 shadow flex items-center justify-center"
													title="Arrastrar para crear dependencia"
													style="touch-action:none"
													onpointerdown={(e) => { e.stopPropagation(); e.preventDefault(); depSrcId = row.id_cronograma_actividad; }}
												>
													<i class="fas fa-link text-white text-[8px] pointer-events-none"></i>
												</div>
											{/if}
										</div>
									{:else}
										<!-- No dates: show empty placeholder line -->
										<div
											class="absolute rounded border-2 border-dashed border-slate-200 cursor-pointer hover:border-orange-300 transition-colors"
											style="left:4px;right:4px;top:{(ROW_H - 14) / 2}px;height:14px"
											title="Haz clic para asignar fechas"
										></div>
									{/if}

									<!-- Dep destination drop target when depSrcId is active -->
									{#if depSrcId && depSrcId !== row.id_cronograma_actividad}
										<div
											class="absolute inset-0 z-30 cursor-crosshair"
											onpointerup={() => { if (depSrcId) { createDep(depSrcId, row.id_cronograma_actividad); depSrcId = null; } }}
										></div>
									{/if}
								</div>
							</div>
						{/each}

						<!-- Clear dep src on background mouseup -->
						{#if depSrcId}
							<div
								class="fixed inset-0 z-40 cursor-crosshair"
								onpointerup={() => depSrcId = null}
								role="presentation"
							></div>
						{/if}
					</div>
				</div>
			</div>

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
		{/if}

		</div><!-- /gantt main area -->
		</div><!-- /two-column layout -->

	<!-- ── RESTRICCIONES SECTION ──────────────────────────────────────────── -->
	{:else}
		<!-- Add restriction form -->
		{#if showRestrictForm}
			<div class="mx-4 mt-4 p-4 bg-slate-50 rounded-xl border border-slate-200">
				<h4 class="font-bold text-slate-700 text-sm mb-3"><i class="fas fa-plus-circle mr-1 text-orange-500"></i>Nueva Restricción</h4>
				<div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
					<button class="px-4 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-600 rounded-lg text-xs font-medium transition-colors" onclick={() => { showRestrictForm = false; newR = { actividad:'',responsable:'',fecha:'',tipo:'',descripcion:'' }; }}>Cancelar</button>
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

	<!-- ── SIDEBAR DRAG GHOST (follows pointer) ───────────────────────────── -->
	{#if sidebarDrag}
		<div
			class="fixed z-50 pointer-events-none px-3 py-1.5 bg-slate-800 text-white text-xs rounded-lg shadow-xl flex items-center gap-2 max-w-[200px]"
			style="left:{sidebarDrag.x + 12}px;top:{sidebarDrag.y - 16}px"
		>
			<i class="fas fa-grip-vertical text-slate-400 text-[10px]"></i>
			<span class="truncate">{sidebarDrag.partida.descripcion}</span>
		</div>
	{/if}
</div>

<!-- ── PARTIDA NODE SNIPPET (recursive tree) ─────────────────────────────── -->
{#snippet PartidaNodeRow(node: PartidaNode, depth: number)}
	{@const hasKids = node.children.length > 0}
	{@const expanded = partidaExpIds.has(node.id_partida)}
	{@const alreadyInGantt = actividades.some(a => a.id_partida === node.id_partida)}
	<div
		class="flex items-center gap-1 border-b border-slate-100 hover:bg-white cursor-pointer group/pn select-none"
		style="padding-left:{8 + depth * 10}px;padding-right:4px;min-height:32px"
		onpointerdown={(e) => { if (!hasKids) startSidebarDrag(e, node); }}
		style:touch-action={hasKids ? 'auto' : 'none'}
		role="treeitem"
		tabindex="0"
	>
		<!-- Expand toggle for parent nodes -->
		{#if hasKids}
			<button
				class="w-4 h-4 flex items-center justify-center text-slate-400 hover:text-slate-700 shrink-0"
				onpointerdown={(e) => { e.stopPropagation(); togglePartidaExp(node.id_partida); }}
				onclick={(e) => e.stopPropagation()}
			><i class="fas fa-chevron-{expanded ? 'down' : 'right'} text-[8px]"></i></button>
		{:else}
			<div class="w-4 shrink-0 flex items-center justify-center">
				<i class="fas fa-grip-vertical text-slate-200 text-[8px]"></i>
			</div>
		{/if}

		<!-- Content -->
		<div class="flex-1 min-w-0 py-1">
			{#if node.codigo}
				<div class="text-[9px] font-mono text-orange-500 font-bold leading-none">{node.codigo}</div>
			{/if}
			<div class="text-[10px] text-slate-600 truncate leading-tight">{node.descripcion}</div>
			{#if node.unidad}
				<div class="text-[9px] text-slate-300">{node.unidad}</div>
			{/if}
		</div>

		<!-- Add button (non-drag alternative, touch-friendly) -->
		{#if !hasKids}
			<button
				class="w-6 h-6 rounded flex items-center justify-center text-slate-300
					{alreadyInGantt ? 'text-emerald-400 hover:text-emerald-600' : 'hover:text-orange-500 hover:bg-orange-50'}
					opacity-0 group-hover/pn:opacity-100 transition-opacity shrink-0"
				title={alreadyInGantt ? 'Ya está en el cronograma — agregar otra instancia' : 'Agregar al cronograma'}
				onclick={(e) => { e.stopPropagation(); addFromPartida(node); }}
			>
				<i class="fas {alreadyInGantt ? 'fa-plus-circle' : 'fa-plus'} text-[10px]"></i>
			</button>
		{/if}
	</div>

	<!-- Children (recursive) -->
	{#if hasKids && expanded}
		{#each node.children as child}
			{@render PartidaNodeRow(child, depth + 1)}
		{/each}
	{/if}
{/snippet}
