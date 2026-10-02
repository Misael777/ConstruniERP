<script lang="ts">
	// Control de Accesos → Auditoría: quién está conectado, qué hizo y cómo/cuándo terminó cada sesión.
	// Solo lectura — los datos los escriben la base (triggers) y $lib/shared/auditoria.ts. Retención: acciones y
	// sesiones 14 días, errores 7 días (ver supabase/migrations/20261002120000_auditoria.sql).
	import { onMount } from 'svelte';
	import { ScrollText, RefreshCw, X } from '@lucide/svelte';
	import { supabase } from '$lib/supabaseClient';
	import { toast } from '$lib/stores/toast';
	import SelectConSaldo from '$lib/shared/components/SelectConSaldo.svelte';
	import {
		getSesionesConectadas,
		getSesiones,
		getAcciones,
		getErrores,
		getUsuariosAuditables,
		estaConectada,
		type SesionAuditoria,
		type AccionAuditoria,
		type ErrorAuditoria,
		type MotivoFin
	} from '$lib/modules/auditoria/services/auditoria.service';

	type Pestana = 'sesiones' | 'acciones' | 'errores';
	const PAGE_SIZE = 25;

	let pestana = $state<Pestana>('sesiones');
	let pageNum = $state(1);
	let total = $state(0);
	let loading = $state(false);

	// Filtros comunes
	let usuario = $state('');
	let desde = $state('');
	let hasta = $state('');
	// Filtros por pestaña
	let motivo = $state<MotivoFin | 'abierta' | ''>('');
	let tipoAccion = $state<AccionAuditoria['tipo'] | ''>('');
	let tabla = $state('');
	let origen = $state<ErrorAuditoria['origen'] | ''>('');
	let sesionFiltro = $state<string | null>(null);

	let usuarios = $state<string[]>([]);
	let conectados = $state<SesionAuditoria[]>([]);
	let sesiones = $state<SesionAuditoria[]>([]);
	let acciones = $state<AccionAuditoria[]>([]);
	let errores = $state<ErrorAuditoria[]>([]);
	let accionDetalle = $state<AccionAuditoria | null>(null);

	const totalPaginas = $derived(Math.max(1, Math.ceil(total / PAGE_SIZE)));

	const MOTIVOS: Record<MotivoFin, { label: string; clase: string }> = {
		logout_manual: { label: 'Cerró sesión', clase: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
		sesion_expirada: { label: 'Sesión expirada', clase: 'bg-amber-50 text-amber-700 border-amber-200' },
		app_cerrada: { label: 'Cerró la app', clase: 'bg-slate-100 text-slate-600 border-slate-200' },
		cierre_inesperado: { label: 'Cierre inesperado', clase: 'bg-rose-50 text-rose-700 border-rose-200' }
	};
	const TIPOS_ACCION: Record<AccionAuditoria['tipo'], { label: string; clase: string }> = {
		insert: { label: 'Creó', clase: 'bg-emerald-50 text-emerald-700' },
		update: { label: 'Editó', clase: 'bg-blue-50 text-blue-700' },
		delete: { label: 'Eliminó', clase: 'bg-rose-50 text-rose-700' },
		descarga: { label: 'Descargó', clase: 'bg-violet-50 text-violet-700' },
		pdf: { label: 'Generó PDF', clase: 'bg-violet-50 text-violet-700' },
		subida: { label: 'Subió archivo', clase: 'bg-amber-50 text-amber-700' }
	};
	const TABLAS: Record<string, string> = {
		transaccion: 'Transacciones',
		cobros: 'Cobros',
		pagos: 'Pagos',
		cuentas_cobrar: 'Cuentas por Cobrar',
		cuentas_pagar: 'Cuentas por Pagar',
		factura: 'Facturación',
		cliente: 'Clientes',
		proveedor: 'Proveedores',
		proyecto: 'Ventas / Proyectos',
		centro_costo: 'Centros de Costo',
		cuenta_banco: 'Cuentas Bancarias',
		documento_proyecto: 'Documentos de Proyecto',
		empleados: 'Empleados',
		roles_permisos: 'Roles y Permisos'
	};
	const ORIGENES: Record<ErrorAuditoria['origen'], string> = { js: 'Pantalla (JS)', rust_panic: 'Falla interna (app)', cierre: 'Cierre' };

	function fechaHora(v: string | null) {
		if (!v) return '—';
		const d = new Date(v);
		return Number.isNaN(d.getTime())
			? '—'
			: d.toLocaleString('es-PE', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' });
	}

	function duracion(s: SesionAuditoria) {
		const fin = new Date(s.fin ?? s.ultimo_latido).getTime();
		const min = Math.max(0, Math.round((fin - new Date(s.inicio).getTime()) / 60_000));
		if (min < 60) return `${min} min`;
		return `${Math.floor(min / 60)} h ${min % 60} min`;
	}

	function etiquetaModulo(a: AccionAuditoria) {
		if (a.tabla) return TABLAS[a.tabla] ?? a.tabla;
		return a.modulo || '—';
	}

	function resumenAccion(a: AccionAuditoria) {
		if (a.resumen) return a.resumen;
		const ref = a.id_registro ? `#${a.id_registro}` : '';
		if (a.tipo === 'update' && a.cambios) {
			const campos = Object.keys(a.cambios);
			return `${ref} — ${campos.length} campo${campos.length === 1 ? '' : 's'}: ${campos.slice(0, 4).join(', ')}${campos.length > 4 ? '…' : ''}`;
		}
		return ref || '—';
	}

	function valorTexto(v: unknown) {
		if (v === null || v === undefined) return '—';
		if (typeof v === 'object') return JSON.stringify(v);
		return String(v);
	}

	/** Filas del detalle de cambios: en un UPDATE cada campo trae {antes, despues}; en INSERT/DELETE es la fila. */
	const filasDetalle = $derived.by(() => {
		const a = accionDetalle;
		if (!a?.cambios) return [];
		return Object.entries(a.cambios).map(([campo, v]) => {
			if (a.tipo === 'update' && v && typeof v === 'object' && 'antes' in (v as any)) {
				return { campo, antes: valorTexto((v as any).antes), despues: valorTexto((v as any).despues) };
			}
			return { campo, antes: a.tipo === 'delete' ? valorTexto(v) : '', despues: a.tipo === 'insert' ? valorTexto(v) : '' };
		});
	});

	async function cargar() {
		loading = true;
		try {
			const comunes = { page: pageNum, pageSize: PAGE_SIZE, usuario: usuario || undefined, desde: desde || undefined, hasta: hasta || undefined };
			if (pestana === 'sesiones') {
				const [vivos, r] = await Promise.all([getSesionesConectadas(supabase), getSesiones(supabase, { ...comunes, motivo: motivo || undefined })]);
				conectados = vivos;
				sesiones = r.items;
				total = r.total;
			} else if (pestana === 'acciones') {
				const r = await getAcciones(supabase, { ...comunes, tipo: tipoAccion || undefined, tabla: tabla || undefined, sesionId: sesionFiltro ?? undefined });
				acciones = r.items;
				total = r.total;
			} else {
				const r = await getErrores(supabase, { ...comunes, origen: origen || undefined });
				errores = r.items;
				total = r.total;
			}
		} catch (err: any) {
			toast.error(err?.message ?? 'No se pudo cargar la auditoría. ¿Ya se corrió la migración de Auditoría?');
		} finally {
			loading = false;
		}
	}

	function aplicarFiltros() {
		pageNum = 1;
		cargar();
	}

	function cambiarPestana(p: Pestana) {
		pestana = p;
		if (p !== 'acciones') sesionFiltro = null;
		aplicarFiltros();
	}

	function verAccionesDeSesion(s: SesionAuditoria) {
		sesionFiltro = s.id;
		pestana = 'acciones';
		aplicarFiltros();
	}

	function limpiarFiltros() {
		usuario = '';
		desde = '';
		hasta = '';
		motivo = '';
		tipoAccion = '';
		tabla = '';
		origen = '';
		sesionFiltro = null;
		aplicarFiltros();
	}

	function irAPagina(n: number) {
		if (n < 1 || n > totalPaginas) return;
		pageNum = n;
		cargar();
	}

	onMount(async () => {
		try {
			usuarios = await getUsuariosAuditables(supabase);
		} catch {
			usuarios = [];
		}
		cargar();
	});
</script>

<svelte:head>
	<title>Auditoría | Construni ERP</title>
</svelte:head>

<div class="mb-4 flex items-start justify-between gap-3">
	<div>
		<h1 class="text-2xl font-bold text-brand-marine flex items-center gap-2">
			<ScrollText size={24} class="text-blue-600" /> Auditoría
		</h1>
		<p class="text-sm text-slate-500 mt-1">
			Quién está conectado, qué hizo en la plataforma y cómo terminó cada sesión. Se guardan 14 días de sesiones y acciones, y 7 días de errores.
		</p>
	</div>
	<button
		type="button"
		onclick={cargar}
		disabled={loading}
		class="flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-300 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50 shrink-0"
	>
		<RefreshCw size={14} class={loading ? 'animate-spin' : ''} /> Actualizar
	</button>
</div>

<!-- Pestañas -->
<div class="flex gap-1 border-b border-slate-200 mb-4">
	{#each [{ id: 'sesiones', label: 'Sesiones' }, { id: 'acciones', label: 'Acciones' }, { id: 'errores', label: 'Errores' }] as p (p.id)}
		<button
			type="button"
			onclick={() => cambiarPestana(p.id as Pestana)}
			class={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${pestana === p.id ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
		>
			{p.label}
		</button>
	{/each}
</div>

<!-- Filtros -->
<div class="flex flex-wrap items-end gap-3 mb-4">
	<div class="w-56">
		<label class="block text-xs font-semibold text-slate-500 mb-1" for="aud-usuario">Usuario</label>
		<SelectConSaldo
			id="aud-usuario"
			value={usuario}
			options={[{ value: '', label: 'Todos los usuarios' }, ...usuarios.map((u) => ({ value: u, label: u }))]}
			placeholder="Todos los usuarios"
			onchange={(v) => { usuario = v; aplicarFiltros(); }}
		/>
	</div>
	<div>
		<label class="block text-xs font-semibold text-slate-500 mb-1" for="aud-desde">Desde</label>
		<input id="aud-desde" type="date" bind:value={desde} onchange={aplicarFiltros} class="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-600" />
	</div>
	<div>
		<label class="block text-xs font-semibold text-slate-500 mb-1" for="aud-hasta">Hasta</label>
		<input id="aud-hasta" type="date" bind:value={hasta} onchange={aplicarFiltros} class="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-600" />
	</div>
	{#if pestana === 'sesiones'}
		<div class="w-52">
			<label class="block text-xs font-semibold text-slate-500 mb-1" for="aud-motivo">Cómo terminó</label>
			<SelectConSaldo
				id="aud-motivo"
				value={motivo}
				options={[
					{ value: '', label: 'Todas' },
					{ value: 'abierta', label: 'Sin terminar' },
					...Object.entries(MOTIVOS).map(([value, m]) => ({ value, label: m.label }))
				]}
				placeholder="Todas"
				onchange={(v) => { motivo = v as typeof motivo; aplicarFiltros(); }}
			/>
		</div>
	{:else if pestana === 'acciones'}
		<div class="w-44">
			<label class="block text-xs font-semibold text-slate-500 mb-1" for="aud-tipo">Acción</label>
			<SelectConSaldo
				id="aud-tipo"
				value={tipoAccion}
				options={[{ value: '', label: 'Todas' }, ...Object.entries(TIPOS_ACCION).map(([value, t]) => ({ value, label: t.label }))]}
				placeholder="Todas"
				onchange={(v) => { tipoAccion = v as typeof tipoAccion; aplicarFiltros(); }}
			/>
		</div>
		<div class="w-52">
			<label class="block text-xs font-semibold text-slate-500 mb-1" for="aud-tabla">Módulo</label>
			<SelectConSaldo
				id="aud-tabla"
				value={tabla}
				options={[{ value: '', label: 'Todos' }, ...Object.entries(TABLAS).map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label))]}
				placeholder="Todos"
				onchange={(v) => { tabla = v; aplicarFiltros(); }}
			/>
		</div>
	{:else}
		<div class="w-48">
			<label class="block text-xs font-semibold text-slate-500 mb-1" for="aud-origen">Origen</label>
			<SelectConSaldo
				id="aud-origen"
				value={origen}
				options={[{ value: '', label: 'Todos' }, ...Object.entries(ORIGENES).map(([value, label]) => ({ value, label }))]}
				placeholder="Todos"
				onchange={(v) => { origen = v as typeof origen; aplicarFiltros(); }}
			/>
		</div>
	{/if}
	<button type="button" onclick={limpiarFiltros} class="px-3 py-2 text-sm text-slate-500 hover:text-slate-700">Limpiar filtros</button>
</div>

{#if pestana === 'acciones' && sesionFiltro}
	<div class="mb-3 inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-blue-50 text-blue-700 text-xs">
		Mostrando solo las acciones de una sesión
		<button type="button" onclick={() => { sesionFiltro = null; aplicarFiltros(); }} aria-label="Quitar filtro de sesión"><X size={12} /></button>
	</div>
{/if}

{#if pestana === 'sesiones'}
	<div class="mb-4 bg-white rounded-2xl border border-slate-200 p-4">
		<p class="text-sm font-bold text-slate-700 mb-2">
			Conectados ahora <span class="font-normal text-slate-400">({conectados.length})</span>
		</p>
		{#if conectados.length === 0}
			<p class="text-sm text-slate-400">Nadie conectado en este momento.</p>
		{:else}
			<div class="flex flex-wrap gap-2">
				{#each conectados as s (s.id)}
					<span class="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-50 border border-emerald-200 text-sm text-emerald-800">
						<span class="w-2 h-2 rounded-full bg-emerald-500"></span>
						{s.usuario ?? 'Usuario'} <span class="text-emerald-600/70 text-xs">· {s.plataforma ?? '—'} · desde {fechaHora(s.inicio)}</span>
					</span>
				{/each}
			</div>
		{/if}
	</div>

	<div class="bg-white rounded-2xl border border-slate-200 overflow-x-auto">
		<table class="w-full text-sm min-w-[860px]">
			<thead>
				<tr class="text-[11px] uppercase tracking-wide text-slate-400 bg-slate-50">
					<th class="text-left px-4 py-2 font-semibold">Usuario</th>
					<th class="text-left px-4 py-2 font-semibold">Plataforma</th>
					<th class="text-left px-4 py-2 font-semibold">Inicio</th>
					<th class="text-left px-4 py-2 font-semibold">Fin</th>
					<th class="text-left px-4 py-2 font-semibold">Duración</th>
					<th class="text-left px-4 py-2 font-semibold">Cómo terminó</th>
					<th class="px-4 py-2"></th>
				</tr>
			</thead>
			<tbody>
				{#each sesiones as s (s.id)}
					<tr class="border-t border-slate-100 align-top">
						<td class="px-4 py-2 text-slate-800">{s.usuario ?? 'Usuario'}</td>
						<td class="px-4 py-2 text-slate-500">{s.plataforma ?? '—'}{s.version_app ? ` · v${s.version_app}` : ''}</td>
						<td class="px-4 py-2 text-slate-600 whitespace-nowrap">{fechaHora(s.inicio)}</td>
						<td class="px-4 py-2 text-slate-600 whitespace-nowrap">{s.fin ? fechaHora(s.fin) : '—'}</td>
						<td class="px-4 py-2 text-slate-600 whitespace-nowrap">{duracion(s)}</td>
						<td class="px-4 py-2">
							{#if s.motivo_fin}
								<span class={`inline-block px-2 py-0.5 rounded-full text-[11px] font-medium border ${MOTIVOS[s.motivo_fin].clase}`} title={s.detalle ?? ''}>
									{MOTIVOS[s.motivo_fin].label}
								</span>
								{#if s.detalle}<p class="text-[11px] text-slate-400 mt-0.5 max-w-xs">{s.detalle}</p>{/if}
							{:else if estaConectada(s)}
								<span class="inline-block px-2 py-0.5 rounded-full text-[11px] font-medium border bg-emerald-50 text-emerald-700 border-emerald-200">Conectado</span>
							{:else}
								<span class="inline-block px-2 py-0.5 rounded-full text-[11px] font-medium border bg-slate-50 text-slate-500 border-slate-200" title="Se cerrará automáticamente como 'Cierre inesperado' en el próximo mantenimiento">Sin latido</span>
							{/if}
						</td>
						<td class="px-4 py-2 text-right">
							<button type="button" onclick={() => verAccionesDeSesion(s)} class="text-xs text-blue-600 hover:underline whitespace-nowrap">Ver acciones</button>
						</td>
					</tr>
				{:else}
					<tr><td colspan="7" class="px-4 py-10 text-center text-slate-400">{loading ? 'Cargando...' : 'No hay sesiones registradas con estos filtros.'}</td></tr>
				{/each}
			</tbody>
		</table>
	</div>
{:else if pestana === 'acciones'}
	<div class="bg-white rounded-2xl border border-slate-200 overflow-x-auto">
		<table class="w-full text-sm min-w-[820px]">
			<thead>
				<tr class="text-[11px] uppercase tracking-wide text-slate-400 bg-slate-50">
					<th class="text-left px-4 py-2 font-semibold">Fecha y hora</th>
					<th class="text-left px-4 py-2 font-semibold">Usuario</th>
					<th class="text-left px-4 py-2 font-semibold">Acción</th>
					<th class="text-left px-4 py-2 font-semibold">Módulo</th>
					<th class="text-left px-4 py-2 font-semibold">Detalle</th>
				</tr>
			</thead>
			<tbody>
				{#each acciones as a (a.id)}
					<tr
						class={`border-t border-slate-100 ${a.cambios ? 'cursor-pointer hover:bg-slate-50' : ''}`}
						onclick={() => { if (a.cambios) accionDetalle = a; }}
					>
						<td class="px-4 py-2 text-slate-600 whitespace-nowrap">{fechaHora(a.creado_en)}</td>
						<td class="px-4 py-2 text-slate-800">{a.usuario ?? 'Sistema'}</td>
						<td class="px-4 py-2">
							<span class={`inline-block px-2 py-0.5 rounded-full text-[11px] font-medium ${TIPOS_ACCION[a.tipo].clase}`}>{TIPOS_ACCION[a.tipo].label}</span>
						</td>
						<td class="px-4 py-2 text-slate-600">{etiquetaModulo(a)}</td>
						<td class="px-4 py-2 text-slate-500 truncate max-w-md" title={resumenAccion(a)}>{resumenAccion(a)}</td>
					</tr>
				{:else}
					<tr><td colspan="5" class="px-4 py-10 text-center text-slate-400">{loading ? 'Cargando...' : 'No hay acciones registradas con estos filtros.'}</td></tr>
				{/each}
			</tbody>
		</table>
	</div>
{:else}
	<div class="bg-white rounded-2xl border border-slate-200 overflow-x-auto">
		<table class="w-full text-sm min-w-[760px]">
			<thead>
				<tr class="text-[11px] uppercase tracking-wide text-slate-400 bg-slate-50">
					<th class="text-left px-4 py-2 font-semibold">Fecha y hora</th>
					<th class="text-left px-4 py-2 font-semibold">Usuario</th>
					<th class="text-left px-4 py-2 font-semibold">Origen</th>
					<th class="text-left px-4 py-2 font-semibold">Plataforma</th>
					<th class="text-left px-4 py-2 font-semibold">Mensaje</th>
				</tr>
			</thead>
			<tbody>
				{#each errores as e (e.id)}
					<tr class="border-t border-slate-100 align-top">
						<td class="px-4 py-2 text-slate-600 whitespace-nowrap">{fechaHora(e.creado_en)}</td>
						<td class="px-4 py-2 text-slate-800">{e.usuario ?? '—'}</td>
						<td class="px-4 py-2 text-slate-600">{ORIGENES[e.origen]}</td>
						<td class="px-4 py-2 text-slate-500">{e.plataforma ?? '—'}</td>
						<td class="px-4 py-2 text-slate-600">
							<p class="break-words">{e.mensaje}</p>
							{#if e.stack}
								<details class="mt-1">
									<summary class="text-xs text-blue-600 cursor-pointer">Ver detalle técnico</summary>
									<pre class="mt-1 text-[11px] text-slate-500 whitespace-pre-wrap break-all bg-slate-50 rounded p-2">{e.stack}</pre>
								</details>
							{/if}
						</td>
					</tr>
				{:else}
					<tr><td colspan="5" class="px-4 py-10 text-center text-slate-400">{loading ? 'Cargando...' : 'No hay errores registrados en la última semana.'}</td></tr>
				{/each}
			</tbody>
		</table>
	</div>
{/if}

<div class="flex items-center justify-between mt-3 text-sm text-slate-500">
	<span>{total} resultado{total === 1 ? '' : 's'} · Página {pageNum} de {totalPaginas}</span>
	<div class="flex items-center gap-2">
		<button type="button" onclick={() => irAPagina(pageNum - 1)} disabled={pageNum <= 1} class="px-3 py-1.5 rounded-lg border border-slate-300 disabled:opacity-40 hover:bg-slate-50">Anterior</button>
		<button type="button" onclick={() => irAPagina(pageNum + 1)} disabled={pageNum >= totalPaginas} class="px-3 py-1.5 rounded-lg border border-slate-300 disabled:opacity-40 hover:bg-slate-50">Siguiente</button>
	</div>
</div>

{#if accionDetalle}
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
	<div class="fixed inset-0 z-[120] bg-slate-900/40 flex items-center justify-center p-4" onclick={() => (accionDetalle = null)}>
		<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
		<div class="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col" onclick={(e) => e.stopPropagation()}>
			<div class="flex items-start justify-between gap-3 px-5 py-4 border-b border-slate-100">
				<div>
					<p class="font-bold text-slate-800">
						{TIPOS_ACCION[accionDetalle.tipo].label} · {etiquetaModulo(accionDetalle)}{accionDetalle.id_registro ? ` #${accionDetalle.id_registro}` : ''}
					</p>
					<p class="text-xs text-slate-500 mt-0.5">{accionDetalle.usuario ?? 'Sistema'} · {fechaHora(accionDetalle.creado_en)}</p>
				</div>
				<button type="button" onclick={() => (accionDetalle = null)} class="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100" aria-label="Cerrar"><X size={18} /></button>
			</div>
			<div class="overflow-auto p-5">
				<table class="w-full text-sm">
					<thead>
						<tr class="text-[11px] uppercase tracking-wide text-slate-400">
							<th class="text-left py-1 pr-3 font-semibold">Campo</th>
							{#if accionDetalle.tipo !== 'insert'}<th class="text-left py-1 pr-3 font-semibold">Antes</th>{/if}
							{#if accionDetalle.tipo !== 'delete'}<th class="text-left py-1 font-semibold">Después</th>{/if}
						</tr>
					</thead>
					<tbody>
						{#each filasDetalle as f (f.campo)}
							<tr class="border-t border-slate-100 align-top">
								<td class="py-1.5 pr-3 font-medium text-slate-700 whitespace-nowrap">{f.campo}</td>
								{#if accionDetalle.tipo !== 'insert'}<td class="py-1.5 pr-3 text-rose-700 break-all">{f.antes}</td>{/if}
								{#if accionDetalle.tipo !== 'delete'}<td class="py-1.5 text-emerald-700 break-all">{f.despues}</td>{/if}
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</div>
	</div>
{/if}
