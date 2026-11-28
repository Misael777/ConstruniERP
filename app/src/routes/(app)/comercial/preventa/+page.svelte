<script lang="ts">
	/**
	 * Ticket #46 "Submódulo de Pre-Venta" (Comercial) — según las imágenes de la clienta: indicadores del embudo, vistas
	 * Lista / Kanban (arrastrar entre etapas) / Calendario, "Nueva oportunidad", "Agendar" (llamada, videollamada,
	 * visitas, envíos) y a la derecha Actividades próximas, Oportunidades por vencer y Mejores oportunidades.
	 */
	import { onMount } from 'svelte';
	import { supabase } from '$lib/supabaseClient';
	import { toast } from '$lib/stores/toast';
	import { describeError } from '$lib/shared/describeError';
	import { formatCurrency } from '$lib/shared/fieldConfig';
	import { arrastrable } from '$lib/shared/arrastre';
	import OportunidadModal from '$lib/modules/preventa/components/OportunidadModal.svelte';
	import ActividadModal from '$lib/modules/preventa/components/ActividadModal.svelte';
	import {
		ETAPAS,
		PRIORIDADES,
		TIPOS_ACTIVIDAD,
		archivarOportunidad,
		completarActividad,
		borrarActividad,
		etapaDe,
		getActividades,
		getClientesOpciones,
		getEjecutivos,
		getOportunidades,
		indicadores,
		mejores,
		moverEtapa,
		normalizar,
		porVencer,
		proximaActividad,
		tipoActividadDe,
		valorConIgv,
		valorPonderado,
		type ActividadOportunidad,
		type EtapaOportunidad,
		type Oportunidad,
		type TipoActividad
	} from '$lib/modules/preventa/services/preventa.service';

	const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Lima' });
	let ops = $state<Oportunidad[]>([]);
	let acts = $state<ActividadOportunidad[]>([]);
	let clientes = $state<{ id: number; nombre: string; doc: string | null }[]>([]);
	let ejecutivos = $state<{ id: number; nombre: string }[]>([]);
	let cargando = $state(true);

	let vista = $state<'lista' | 'kanban' | 'calendario'>('lista');
	let q = $state('');
	let fEstado = $state<'' | 'abiertas' | 'adjudicada' | 'perdida'>('abiertas');
	let fEtapa = $state('');
	let fEjecutivo = $state('');
	let pagina = $state(1);
	let porPagina = $state(8);

	let modalOp = $state<{ op: Oportunidad | null; etapa?: EtapaOportunidad } | null>(null);
	let modalAct = $state<{ act?: ActividadOportunidad | null; tipo?: TipoActividad; idOp?: number | null; fecha?: string | null } | null>(null);
	let menuAgendar = $state(false);
	let menuFila = $state<number | null>(null);

	async function cargar() {
		try {
			[ops, acts] = await Promise.all([getOportunidades(supabase), getActividades(supabase)]);
		} catch (err) {
			toast.error(`No se pudo cargar Pre-Venta. ${describeError(err)}`);
		} finally {
			cargando = false;
		}
	}
	onMount(() => {
		void (async () => {
			await cargar();
			[clientes, ejecutivos] = await Promise.all([getClientesOpciones(supabase), getEjecutivos(supabase)]);
		})();
		const cerrar = () => {
			menuAgendar = false;
			menuFila = null;
		};
		window.addEventListener('click', cerrar);
		return () => window.removeEventListener('click', cerrar);
	});

	const clienteDe = (o: Oportunidad) => o.cliente?.nombre ?? o.prospecto ?? '—';
	const k = $derived(indicadores(ops, hoy));
	const ahoraIso = new Date().toISOString();
	const proxima = $derived(proximaActividad(acts, ahoraIso));
	const filtradas = $derived(
		ops.filter((o) => {
			if (fEstado === 'abiertas' && (o.etapa === 'adjudicada' || o.etapa === 'perdida')) return false;
			if ((fEstado === 'adjudicada' || fEstado === 'perdida') && o.etapa !== fEstado) return false;
			if (fEtapa && o.etapa !== fEtapa) return false;
			if (fEjecutivo && String(o.id_ejecutivo) !== fEjecutivo) return false;
			if (q.trim()) {
				const t = normalizar([o.nombre, o.codigo, clienteDe(o), o.cliente?.num_documento, o.ejecutivo?.nombre].filter(Boolean).join(' '));
				if (!t.includes(normalizar(q.trim()))) return false;
			}
			return true;
		})
	);
	const totalPaginas = $derived(Math.max(1, Math.ceil(filtradas.length / porPagina)));
	const visibles = $derived(filtradas.slice((pagina - 1) * porPagina, pagina * porPagina));
	$effect(() => {
		q;
		fEstado;
		fEtapa;
		fEjecutivo;
		porPagina;
		pagina = 1;
	});

	// Kanban: todas las etapas (las cerradas se ven aunque el filtro diga "abiertas").
	const kanban = $derived(
		ETAPAS.map((e) => {
			const items = ops.filter(
				(o) => o.etapa === e.value && (!fEjecutivo || String(o.id_ejecutivo) === fEjecutivo) && (!q.trim() || normalizar(`${o.nombre} ${clienteDe(o)} ${o.codigo ?? ''}`).includes(normalizar(q.trim())))
			);
			return { ...e, items, total: items.reduce((t, o) => t + valorConIgv(o), 0) };
		})
	);
	async function soltarEnEtapa(id: string, destino: HTMLElement | null) {
		const etapa = destino?.dataset.etapa as EtapaOportunidad | undefined;
		const o = ops.find((x) => String(x.id_oportunidad) === id);
		if (!o || !etapa || etapa === o.etapa) return;
		let motivo: string | null = null;
		if (etapa === 'perdida') {
			motivo = prompt('Motivo de la pérdida (precio, competencia, sin respuesta…):')?.trim() || null;
			if (!motivo) return;
		}
		try {
			await moverEtapa(supabase, o, etapa, motivo);
			toast.success(`"${o.nombre}" pasó a ${etapaDe(etapa).label}.`);
			await cargar();
		} catch (err) {
			toast.error(`No se pudo mover. ${describeError(err)}`);
		}
	}

	// Calendario (mes): actividades y cierres estimados por día.
	let mesCal = $state(hoy.slice(0, 7));
	const diasMes = $derived.by(() => {
		const [a, m] = mesCal.split('-').map(Number);
		const primero = new Date(Date.UTC(a, m - 1, 1));
		const inicio = new Date(primero);
		inicio.setUTCDate(1 - ((primero.getUTCDay() + 6) % 7));
		return Array.from({ length: 42 }, (_, i) => {
			const d = new Date(inicio);
			d.setUTCDate(inicio.getUTCDate() + i);
			return d.toISOString().slice(0, 10);
		});
	});
	const diaLocal = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/Lima' });
	const horaLocal = (iso: string) => new Date(iso).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Lima' });
	function moverMes(n: number) {
		const [a, m] = mesCal.split('-').map(Number);
		const d = new Date(Date.UTC(a, m - 1 + n, 1));
		mesCal = d.toISOString().slice(0, 7);
	}
	const nombreMes = $derived(new Date(`${mesCal}-15T12:00:00Z`).toLocaleDateString('es-PE', { month: 'long', year: 'numeric', timeZone: 'UTC' }));

	// Paneles laterales.
	const proximas7 = $derived.by(() => {
		const limite = new Date(Date.now() + 7 * 86400000).toISOString();
		return acts.filter((a) => !a.completada && a.fecha_hora >= ahoraIso.slice(0, 10) && a.fecha_hora <= limite).slice(0, 5);
	});
	const vencer = $derived(porVencer(ops, hoy).slice(0, 4));
	const top = $derived(mejores(ops, 3));
	const opDe = (id: number | null) => ops.find((o) => o.id_oportunidad === id) ?? null;
	const cuandoTexto = (iso: string) => {
		const d = diaLocal(iso);
		const manana = new Date(Date.now() + 86400000).toLocaleDateString('en-CA', { timeZone: 'America/Lima' });
		return d === hoy ? 'Hoy' : d === manana ? 'Mañana' : new Date(`${d}T12:00:00Z`).toLocaleDateString('es-PE', { day: 'numeric', month: 'short', timeZone: 'UTC' });
	};
	const fechaCorta = (f: string | null) => (f ? new Date(`${f}T12:00:00Z`).toLocaleDateString('es-PE', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—');
	const millones = (v: number) => (v >= 1_000_000 ? `S/ ${(v / 1_000_000).toFixed(1)} M` : formatCurrency(v));
	const iniciales = (n: string | undefined) => (n ?? '?').split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('');

	async function archivar(o: Oportunidad) {
		if (!confirm(`¿Archivar "${o.nombre}"? Sale de Pre-Venta (no se borra).`)) return;
		try {
			await archivarOportunidad(supabase, o.id_oportunidad);
			toast.success('Oportunidad archivada.');
			await cargar();
		} catch (err) {
			toast.error(describeError(err));
		}
	}
	async function marcar(o: Oportunidad, etapa: EtapaOportunidad) {
		await soltarEnEtapa(String(o.id_oportunidad), { dataset: { etapa } } as unknown as HTMLElement);
	}
	async function hecha(a: ActividadOportunidad) {
		try {
			await completarActividad(supabase, a.id_actividad, !a.completada);
			await cargar();
		} catch (err) {
			toast.error(describeError(err));
		}
	}
	async function quitarActividad(a: ActividadOportunidad) {
		if (!confirm(`¿Quitar "${a.titulo}"?`)) return;
		try {
			await borrarActividad(supabase, a.id_actividad);
			await cargar();
		} catch (err) {
			toast.error(describeError(err));
		}
	}

	function exportar() {
		const filas = [['Código', 'Oportunidad', 'Cliente', 'Etapa', 'Ejecutivo', 'Valor (con IGV)', 'Probabilidad %', 'Valor ponderado', 'Cierre', 'Prioridad']];
		for (const o of filtradas) filas.push([o.codigo ?? '', o.nombre, clienteDe(o), etapaDe(o.etapa).label, o.ejecutivo?.nombre ?? '', String(valorConIgv(o)), String(o.probabilidad), String(valorPonderado(o)), o.fecha_cierre ?? '', PRIORIDADES[o.prioridad].label]);
		const csv = '﻿' + filas.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\r\n');
		const a = document.createElement('a');
		a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
		a.download = `preventa_${hoy}.csv`;
		a.click();
		URL.revokeObjectURL(a.href);
	}

	const tarjetas = $derived([
		{ t: 'Oportunidades activas', v: String(k.activas), i: 'fa-briefcase', c: 'bg-blue-50 text-blue-600', accion: () => { fEstado = 'abiertas'; fEtapa = ''; vista = 'lista'; } },
		{ t: 'Valor total del pipeline', v: millones(k.valorPipeline), i: 'fa-dollar-sign', c: 'bg-emerald-50 text-emerald-600', accion: () => { fEstado = 'abiertas'; vista = 'kanban'; } },
		{ t: 'Cotizaciones enviadas', v: String(k.cotizacionesEnviadas), i: 'fa-file-lines', c: 'bg-violet-50 text-violet-600', accion: () => { fEstado = 'abiertas'; fEtapa = 'cotizacion'; vista = 'lista'; } },
		{ t: 'En negociación', v: String(k.enNegociacion), i: 'fa-users', c: 'bg-orange-50 text-orange-600', accion: () => { fEstado = 'abiertas'; fEtapa = 'negociacion'; vista = 'lista'; } },
		{ t: 'Ganadas este mes', v: String(k.ganadasMes), i: 'fa-trophy', c: 'bg-emerald-50 text-emerald-600', accion: () => { fEstado = 'adjudicada'; fEtapa = ''; vista = 'lista'; } },
		{ t: 'Perdidas este mes', v: String(k.perdidasMes), i: 'fa-circle-xmark', c: 'bg-rose-50 text-rose-600', accion: () => { fEstado = 'perdida'; fEtapa = ''; vista = 'lista'; } },
		{ t: 'Tasa de conversión', v: k.tasaConversion == null ? '—' : `${k.tasaConversion}%`, i: 'fa-arrow-trend-up', c: 'bg-blue-50 text-blue-600', accion: () => { fEstado = ''; vista = 'lista'; } },
		{ t: 'Por confirmar (ponderado)', v: millones(k.porConfirmar), i: 'fa-coins', c: 'bg-violet-50 text-violet-600', accion: () => { fEstado = 'abiertas'; vista = 'kanban'; } }
	]);
	const caja = 'px-3 py-2 border border-slate-200 rounded-xl text-sm bg-white';
</script>

<svelte:head><title>Pre-Venta | Construni</title></svelte:head>

<div class="space-y-4">
	<!-- Cabecera -->
	<div class="flex flex-wrap items-start justify-between gap-3">
		<div>
			<h1 class="text-2xl font-bold text-[#0f3b5e]">Pre-Venta</h1>
			<p class="text-sm text-slate-500">Gestiona oportunidades comerciales y el seguimiento del embudo de ventas para convertir prospectos en proyectos.</p>
		</div>
		<div class="flex flex-wrap gap-2">
			<button type="button" onclick={exportar} class="px-4 py-2 rounded-xl border border-slate-200 bg-white text-sm font-semibold text-slate-700 hover:bg-slate-50"><i class="fas fa-download mr-1"></i> Exportar</button>
			<div class="relative">
				<button type="button" onclick={(e) => { e.stopPropagation(); menuAgendar = !menuAgendar; }} class="px-4 py-2 rounded-xl border border-blue-300 bg-white text-sm font-semibold text-blue-700 hover:bg-blue-50"><i class="fas fa-calendar-plus mr-1"></i> Agendar <i class="fas fa-chevron-down text-[10px] ml-1"></i></button>
				{#if menuAgendar}
					<div class="absolute right-0 top-full mt-1 z-30 w-60 rounded-xl border border-slate-200 bg-white shadow-xl p-1 text-sm">
						{#each TIPOS_ACTIVIDAD.filter((t) => t.menu) as t, i (t.value)}
							{#if i === 4}<div class="my-1 border-t border-slate-100"></div>{/if}
							<button type="button" onclick={() => (modalAct = { tipo: t.value })} class="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-slate-50 text-left">
								<i class={`fas ${t.icono} w-4 text-slate-500`}></i>{t.value === 'llamada' ? 'Agendar llamada' : t.value === 'videollamada' ? 'Agendar videollamada' : t.label}
								{#if t.value === 'videollamada'}<span class="ml-auto text-[10px] text-slate-400">enlace de Meet</span>{/if}
							</button>
						{/each}
					</div>
				{/if}
			</div>
			<button type="button" onclick={() => (modalOp = { op: null })} class="px-4 py-2 rounded-xl bg-blue-600 text-sm font-semibold text-white hover:bg-blue-700"><i class="fas fa-plus mr-1"></i> Nueva oportunidad</button>
		</div>
	</div>

	<!-- Indicadores -->
	<div class="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-8 gap-2">
		{#each tarjetas as t (t.t)}
			<div class="rounded-2xl border border-slate-100 bg-white shadow-sm p-3 flex flex-col gap-1">
				<div class="flex items-center gap-2">
					<span class={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${t.c}`}><i class={`fas ${t.i} text-sm`}></i></span>
					<span class="text-[11px] font-semibold leading-tight text-slate-600">{t.t}</span>
				</div>
				<span class="text-xl font-bold text-slate-800">{t.v}</span>
				<button type="button" onclick={t.accion} class="self-start text-[11px] font-semibold text-blue-600 hover:underline">Ver detalle <i class="fas fa-arrow-right text-[9px]"></i></button>
			</div>
		{/each}
	</div>

	<div class="grid grid-cols-1 xl:grid-cols-[1fr_19rem] gap-4">
		<div class="rounded-2xl border border-slate-100 bg-white shadow-sm min-w-0">
			<!-- Filtros -->
			<div class="flex flex-wrap items-center gap-2 p-3 border-b border-slate-100">
				<div class="relative flex-1 min-w-[14rem]">
					<i class="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs"></i>
					<input class={`${caja} w-full pl-8`} bind:value={q} placeholder="Buscar por cliente, código, proyecto o responsable…" />
				</div>
				<select class={caja} bind:value={fEstado}><option value="abiertas">Abiertas</option><option value="adjudicada">Adjudicadas</option><option value="perdida">Perdidas</option><option value="">Estado (Todos)</option></select>
				<select class={caja} bind:value={fEtapa}><option value="">Etapa (Todas)</option>{#each ETAPAS as e (e.value)}<option value={e.value}>{e.label}</option>{/each}</select>
				<select class={caja} bind:value={fEjecutivo}><option value="">Ejecutivo (Todos)</option>{#each ejecutivos as e (e.id)}<option value={String(e.id)}>{e.nombre}</option>{/each}</select>
			</div>
			<div class="flex items-center gap-1 px-3 pt-2 border-b border-slate-100 text-sm">
				<span class="text-slate-500 mr-2">Vista:</span>
				{#each [['lista', 'fa-list', 'Lista'], ['kanban', 'fa-table-columns', 'Kanban'], ['calendario', 'fa-calendar', 'Calendario']] as [v, i, t] (v)}
					<button type="button" onclick={() => (vista = v as typeof vista)} class={`px-3 py-2 -mb-px border-b-2 font-semibold ${vista === v ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}><i class={`fas ${i} mr-1`}></i>{t}</button>
				{/each}
			</div>

			{#if cargando}
				<p class="p-8 text-center text-sm text-slate-400"><i class="fas fa-spinner fa-spin"></i> Cargando…</p>
			{:else if vista === 'lista'}
				<div class="overflow-x-auto">
					<table class="w-full min-w-[1050px] text-sm">
						<thead class="text-left text-xs text-slate-500 border-b border-slate-100">
							<tr>
								<th class="px-3 py-2">Oportunidad</th><th class="px-3 py-2">Cliente</th><th class="px-3 py-2">Etapa</th><th class="px-3 py-2">Ejecutivo</th>
								<th class="px-3 py-2 text-right">Valor estimado</th><th class="px-3 py-2">Probabilidad</th><th class="px-3 py-2">Próxima actividad</th>
								<th class="px-3 py-2">Fecha cierre</th><th class="px-3 py-2">Prioridad</th><th class="px-3 py-2 w-10"></th>
							</tr>
						</thead>
						<tbody class="divide-y divide-slate-50">
							{#each visibles as o (o.id_oportunidad)}
								{@const pa = proxima.get(o.id_oportunidad)}
								<tr class="hover:bg-slate-50 cursor-pointer" onclick={() => (modalOp = { op: o })}>
									<td class="px-3 py-2"><div class="font-semibold text-slate-800">{o.nombre}</div><div class="text-[11px] text-slate-400">{o.codigo}</div></td>
									<td class="px-3 py-2"><div class="text-slate-700">{clienteDe(o)}</div>{#if o.cliente?.num_documento}<div class="text-[11px] text-slate-400">RUC: {o.cliente.num_documento}</div>{:else if !o.id_cliente}<div class="text-[11px] text-amber-600">Prospecto</div>{/if}</td>
									<td class="px-3 py-2"><span class={`px-2 py-0.5 rounded-md border text-xs font-semibold whitespace-nowrap ${etapaDe(o.etapa).chip}`}>{etapaDe(o.etapa).label}</span></td>
									<td class="px-3 py-2"><div class="flex items-center gap-2"><span class="w-7 h-7 rounded-full bg-slate-100 text-slate-600 text-[10px] font-bold flex items-center justify-center">{iniciales(o.ejecutivo?.nombre)}</span><span class="text-slate-700">{o.ejecutivo?.nombre ?? '—'}</span></div></td>
									<td class="px-3 py-2 text-right font-semibold whitespace-nowrap">{formatCurrency(valorConIgv(o))}</td>
									<td class="px-3 py-2"><div class="text-xs font-semibold">{o.probabilidad}%</div><div class="h-1.5 w-20 rounded-full bg-slate-100"><div class={`h-1.5 rounded-full ${etapaDe(o.etapa).punto}`} style={`width:${o.probabilidad}%`}></div></div></td>
									<td class="px-3 py-2">{#if pa}<div class="text-slate-700"><i class={`fas ${tipoActividadDe(pa.tipo).icono} text-slate-400 mr-1`}></i>{tipoActividadDe(pa.tipo).label}</div><div class="text-[11px] text-slate-400">{cuandoTexto(pa.fecha_hora)}, {horaLocal(pa.fecha_hora)}</div>{:else}<span class="text-slate-300">—</span>{/if}</td>
									<td class="px-3 py-2 whitespace-nowrap">{fechaCorta(o.fecha_cierre)}</td>
									<td class="px-3 py-2"><span class="flex items-center gap-1.5"><span class={`w-2 h-2 rounded-full ${PRIORIDADES[o.prioridad].punto}`}></span>{PRIORIDADES[o.prioridad].label}</span></td>
									<td class="px-3 py-2 relative">
										<button type="button" onclick={(e) => { e.stopPropagation(); menuFila = menuFila === o.id_oportunidad ? null : o.id_oportunidad; }} class="w-7 h-7 rounded-full text-slate-500 hover:bg-slate-100" aria-label="Acciones"><i class="fas fa-ellipsis-vertical"></i></button>
										{#if menuFila === o.id_oportunidad}
											<div class="absolute right-2 top-9 z-20 w-52 rounded-xl border border-slate-200 bg-white shadow-xl p-1 text-sm text-left">
												<button type="button" onclick={(e) => { e.stopPropagation(); menuFila = null; modalOp = { op: o }; }} class="w-full text-left px-3 py-1.5 rounded-lg hover:bg-slate-50"><i class="fas fa-pen w-4 text-slate-400"></i> Editar</button>
												<button type="button" onclick={(e) => { e.stopPropagation(); menuFila = null; modalAct = { idOp: o.id_oportunidad }; }} class="w-full text-left px-3 py-1.5 rounded-lg hover:bg-slate-50"><i class="fas fa-calendar-plus w-4 text-slate-400"></i> Agendar actividad</button>
												{#if o.etapa !== 'adjudicada'}<button type="button" onclick={(e) => { e.stopPropagation(); menuFila = null; marcar(o, 'adjudicada'); }} class="w-full text-left px-3 py-1.5 rounded-lg hover:bg-slate-50 text-emerald-700"><i class="fas fa-trophy w-4"></i> Marcar como ganada</button>{/if}
												{#if o.etapa !== 'perdida'}<button type="button" onclick={(e) => { e.stopPropagation(); menuFila = null; marcar(o, 'perdida'); }} class="w-full text-left px-3 py-1.5 rounded-lg hover:bg-slate-50 text-rose-600"><i class="fas fa-circle-xmark w-4"></i> Marcar como perdida</button>{/if}
												<button type="button" onclick={(e) => { e.stopPropagation(); menuFila = null; archivar(o); }} class="w-full text-left px-3 py-1.5 rounded-lg hover:bg-slate-50 text-slate-500"><i class="fas fa-box-archive w-4"></i> Archivar</button>
											</div>
										{/if}
									</td>
								</tr>
							{:else}
								<tr><td colspan="10" class="px-3 py-10 text-center text-sm text-slate-400">{ops.length ? 'No hay oportunidades con esos filtros.' : 'Aún no hay oportunidades. Usa "Nueva oportunidad" para registrar la primera.'}</td></tr>
							{/each}
						</tbody>
					</table>
				</div>
				<div class="flex flex-wrap items-center justify-between gap-2 px-3 py-2 border-t border-slate-100 text-xs text-slate-500">
					<span>Mostrando {filtradas.length ? (pagina - 1) * porPagina + 1 : 0}–{Math.min(pagina * porPagina, filtradas.length)} de {filtradas.length} registros</span>
					<div class="flex items-center gap-1">
						<button type="button" disabled={pagina <= 1} onclick={() => pagina--} class="w-8 h-8 rounded-lg border border-slate-200 disabled:opacity-40" aria-label="Anterior"><i class="fas fa-chevron-left"></i></button>
						<span class="px-2">{pagina} / {totalPaginas}</span>
						<button type="button" disabled={pagina >= totalPaginas} onclick={() => pagina++} class="w-8 h-8 rounded-lg border border-slate-200 disabled:opacity-40" aria-label="Siguiente"><i class="fas fa-chevron-right"></i></button>
						<select class="ml-2 px-2 py-1 border border-slate-200 rounded-lg" bind:value={porPagina}>{#each [8, 15, 30, 50] as n (n)}<option value={n}>{n} por página</option>{/each}</select>
					</div>
				</div>
			{:else if vista === 'kanban'}
				<div class="flex gap-3 overflow-x-auto p-3">
					{#each kanban as col (col.value)}
						<div data-soltar data-etapa={col.value} class="w-64 shrink-0 rounded-2xl bg-slate-50 border border-slate-100 p-2 flex flex-col gap-2 min-h-[20rem]">
							<div class="px-1">
								<div class="flex items-center gap-2 font-bold text-slate-700"><span class={`w-2.5 h-2.5 rounded-full ${col.punto}`}></span>{col.label}</div>
								<div class="flex justify-between text-[11px] text-slate-500"><span>{col.items.length}</span><span>{millones(col.total)}</span></div>
							</div>
							{#each col.items as o (o.id_oportunidad)}
								<div data-arrastre-item class={`rounded-xl bg-white border border-slate-100 border-l-4 ${col.borde} shadow-sm p-2.5 text-xs`}>
									<div class="flex items-start gap-1">
										<button type="button" use:arrastrable={{ id: String(o.id_oportunidad), onSoltar: (id, destino) => soltarEnEtapa(id, destino) }} class="cursor-grab text-slate-300 hover:text-slate-500 px-0.5" aria-label="Arrastrar"><i class="fas fa-grip-vertical"></i></button>
										<button type="button" onclick={() => (modalOp = { op: o })} class="flex-1 text-left">
											<div class="font-semibold text-slate-800 text-[13px] leading-snug">{o.nombre}</div>
											<div class="text-slate-500">{clienteDe(o)}</div>
											<div class="text-slate-400">{o.codigo}</div>
										</button>
									</div>
									<div class="mt-1 flex items-center justify-between">
										<b class="text-slate-800">{formatCurrency(valorConIgv(o))}</b>
										<span class="w-6 h-6 rounded-full bg-slate-100 text-[9px] font-bold text-slate-600 flex items-center justify-center" title={o.ejecutivo?.nombre ?? ''}>{iniciales(o.ejecutivo?.nombre)}</span>
									</div>
									<div class="mt-1 flex flex-wrap items-center gap-1">
										<span class={`px-1.5 rounded ${PRIORIDADES[o.prioridad].chip}`}>{PRIORIDADES[o.prioridad].label}</span>
										{#if o.etapa === 'adjudicada' && o.fecha_cierre}<span class="text-emerald-600">Cierre: {fechaCorta(o.fecha_cierre)}</span>{/if}
										{#if o.etapa === 'perdida' && o.motivo_perdida}<span class="text-rose-600">Motivo: {o.motivo_perdida}</span>{/if}
									</div>
								</div>
							{/each}
							<button type="button" onclick={() => (modalOp = { op: null, etapa: col.value })} class="text-xs font-semibold text-blue-600 hover:underline py-1">+ Nueva oportunidad</button>
						</div>
					{/each}
				</div>
				<p class="px-3 pb-3 text-xs text-slate-500"><i class="fas fa-circle-info text-blue-500"></i> Arrastra las oportunidades (desde <i class="fas fa-grip-vertical"></i>) para moverlas entre etapas del embudo.</p>
			{:else}
				<div class="p-3">
					<div class="flex items-center justify-between mb-2">
						<button type="button" onclick={() => moverMes(-1)} class="w-8 h-8 rounded-lg border border-slate-200" aria-label="Mes anterior"><i class="fas fa-chevron-left"></i></button>
						<span class="font-bold text-slate-700 capitalize">{nombreMes}</span>
						<button type="button" onclick={() => moverMes(1)} class="w-8 h-8 rounded-lg border border-slate-200" aria-label="Mes siguiente"><i class="fas fa-chevron-right"></i></button>
					</div>
					<div class="grid grid-cols-7 gap-1 text-[11px]">
						{#each ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'] as d (d)}<div class="text-center font-semibold text-slate-500 py-1">{d}</div>{/each}
						{#each diasMes as dia (dia)}
							{@const delDia = acts.filter((a) => diaLocal(a.fecha_hora) === dia)}
							{@const cierres = ops.filter((o) => o.fecha_cierre === dia && o.etapa !== 'perdida')}
							<div class={`min-h-[6rem] rounded-xl border p-1 flex flex-col gap-0.5 ${dia === hoy ? 'border-orange-400 bg-orange-50/50' : dia.slice(0, 7) !== mesCal ? 'border-slate-100 bg-slate-50 opacity-60' : 'border-slate-100 bg-white'}`}>
								<div class="flex items-center justify-between">
									<span class="font-semibold text-slate-600">{Number(dia.slice(8))}</span>
									<button type="button" onclick={() => (modalAct = { fecha: dia })} class="text-slate-300 hover:text-blue-600" aria-label="Agendar en este día"><i class="fas fa-plus"></i></button>
								</div>
								{#each delDia as a (a.id_actividad)}
									<button type="button" onclick={() => (modalAct = { act: a })} class={`text-left rounded-md px-1 py-0.5 truncate ${a.completada ? 'bg-slate-100 text-slate-400 line-through' : 'bg-blue-50 text-blue-800'}`} title={`${a.titulo} · ${opDe(a.id_oportunidad)?.nombre ?? ''}`}>
										<i class={`fas ${tipoActividadDe(a.tipo).icono}`}></i> {horaLocal(a.fecha_hora)} {a.titulo}
									</button>
								{/each}
								{#each cierres as o (o.id_oportunidad)}
									<button type="button" onclick={() => (modalOp = { op: o })} class="text-left rounded-md px-1 py-0.5 truncate bg-emerald-50 text-emerald-800" title={`Cierre estimado: ${o.nombre}`}><i class="fas fa-flag-checkered"></i> Cierre: {o.nombre}</button>
								{/each}
							</div>
						{/each}
					</div>
				</div>
			{/if}
		</div>

		<!-- Paneles laterales -->
		<aside class="space-y-3">
			<div class="rounded-2xl border border-slate-100 bg-white shadow-sm p-3">
				<div class="flex items-center justify-between mb-2"><h3 class="font-bold text-slate-800"><i class="fas fa-calendar-days text-blue-600 mr-1"></i> Actividades próximas</h3><span class="text-[11px] text-slate-400">7 días</span></div>
				{#each proximas7 as a (a.id_actividad)}
					<div class="flex items-start gap-2 py-1.5 border-b border-slate-50 last:border-0 text-xs">
						<button type="button" onclick={() => hecha(a)} title="Marcar como hecha" class="mt-0.5 w-4 h-4 rounded-full border-2 border-blue-400 hover:bg-blue-100 shrink-0" aria-label="Marcar como hecha"></button>
						<button type="button" onclick={() => (modalAct = { act: a })} class="flex-1 text-left min-w-0">
							<div class="font-semibold text-slate-700 truncate">{a.titulo}</div>
							<div class="text-slate-400 truncate">{a.responsable ?? ''}{a.enlace ? ' · Meet' : ''}</div>
						</button>
						<div class="text-right shrink-0"><div class={`font-semibold ${cuandoTexto(a.fecha_hora) === 'Hoy' ? 'text-emerald-600' : cuandoTexto(a.fecha_hora) === 'Mañana' ? 'text-orange-500' : 'text-slate-600'}`}>{cuandoTexto(a.fecha_hora)}</div><div class="text-slate-400">{horaLocal(a.fecha_hora)}</div></div>
						{#if a.enlace}<a href={a.enlace} target="_blank" rel="noopener noreferrer" class="text-blue-600" aria-label="Abrir Meet"><i class="fas fa-video"></i></a>{/if}
						<button type="button" onclick={() => quitarActividad(a)} class="text-slate-300 hover:text-rose-500" aria-label="Quitar"><i class="fas fa-xmark"></i></button>
					</div>
				{:else}
					<p class="text-xs text-slate-400">Sin actividades en los próximos 7 días.</p>
				{/each}
				<button type="button" onclick={() => (vista = 'calendario')} class="mt-1 text-xs font-semibold text-blue-600 hover:underline">Ver calendario completo <i class="fas fa-arrow-right text-[9px]"></i></button>
			</div>

			<div class="rounded-2xl border border-slate-100 bg-white shadow-sm p-3">
				<h3 class="font-bold text-slate-800 mb-2"><i class="fas fa-triangle-exclamation text-rose-500 mr-1"></i> Oportunidades por vencer</h3>
				{#each vencer as o (o.id_oportunidad)}
					<button type="button" onclick={() => (modalOp = { op: o })} class="w-full flex items-start justify-between gap-2 py-1.5 border-b border-slate-50 last:border-0 text-xs text-left">
						<div class="min-w-0"><div class="font-semibold text-slate-700 truncate">{o.nombre}</div><div class="text-slate-400">{o.diasParaCierre < 0 ? `Venció hace ${-o.diasParaCierre} día${o.diasParaCierre === -1 ? '' : 's'}` : o.diasParaCierre === 0 ? 'Cierra hoy' : `Cierre en ${o.diasParaCierre} día${o.diasParaCierre === 1 ? '' : 's'}`}</div></div>
						<span class="font-semibold text-rose-600 whitespace-nowrap">{fechaCorta(o.fecha_cierre).replace(/ de \d{4}|\s\d{4}$/, '')}</span>
					</button>
				{:else}
					<p class="text-xs text-slate-400">Nada cierra en los próximos 7 días.</p>
				{/each}
			</div>

			<div class="rounded-2xl border border-slate-100 bg-white shadow-sm p-3">
				<h3 class="font-bold text-slate-800 mb-2"><i class="fas fa-trophy text-amber-500 mr-1"></i> Mejores oportunidades <span class="font-normal text-[11px] text-slate-400">por valor ponderado</span></h3>
				{#each top as o (o.id_oportunidad)}
					<button type="button" onclick={() => (modalOp = { op: o })} class="w-full flex items-start justify-between gap-2 py-1.5 border-b border-slate-50 last:border-0 text-xs text-left">
						<div class="min-w-0"><div class="font-semibold text-slate-700 truncate"><i class="fas fa-trophy text-amber-400 mr-1"></i>{o.nombre}</div><div class="text-slate-400 truncate">{clienteDe(o)}</div></div>
						<div class="text-right"><div class="font-bold text-slate-800 whitespace-nowrap">{millones(valorConIgv(o))}</div><div class="text-slate-400">{o.probabilidad}%</div></div>
					</button>
				{:else}
					<p class="text-xs text-slate-400">Sin oportunidades abiertas.</p>
				{/each}
			</div>
		</aside>
	</div>
</div>

{#if modalOp}
	<OportunidadModal oportunidad={modalOp.op} etapaInicial={modalOp.etapa ?? 'prospecto'} {clientes} {ejecutivos} onClose={() => (modalOp = null)} onGuardado={cargar} />
{/if}
{#if modalAct}
	<ActividadModal actividad={modalAct.act ?? null} tipo={modalAct.tipo ?? 'llamada'} idOportunidad={modalAct.idOp ?? null} fecha={modalAct.fecha ?? null} oportunidades={ops.filter((o) => o.etapa !== 'perdida')} onClose={() => (modalAct = null)} onGuardado={cargar} />
{/if}
