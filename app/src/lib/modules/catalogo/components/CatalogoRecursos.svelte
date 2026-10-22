<script lang="ts">
	/**
	 * Catálogo → Recursos (según la imagen del usuario): árbol "Tipos y familias" a la izquierda, tabla de recursos
	 * con buscador y filtros al centro, y el panel de edición a la derecha (en celular se abre encima). Botones:
	 * Importar recursos S10/Excel, Nuevo recurso, Exportar. Patrón dar-de-baja (ver catalogo.service.ts).
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
	import { getProveedorOptions } from '$lib/modules/cuentas-pagar/services/cuentasPagar.service';
	import {
		TIPOS_RECURSO,
		getFamilias,
		crearFamilia,
		getUnidades,
		getRecursos,
		siguienteCodigo,
		guardarRecurso,
		darDeBajaRecurso,
		restaurarRecurso,
		eliminarRecursoPermanente,
		importarRecursosExcel,
		type FamiliaRecurso,
		type UnidadMedida,
		type Recurso,
		type TipoRecurso
	} from '$lib/modules/catalogo/services/catalogo.service';
	import { Search, X, Upload, Plus, Download, Pencil, Copy, Trash2, RotateCcw, Trash, Folder, FolderOpen, FileText, ChevronRight, ChevronDown, Save, Info, Loader2, ChevronLeft } from '@lucide/svelte';

	let recursos = $state<Recurso[]>([]);
	let familias = $state<FamiliaRecurso[]>([]);
	let unidades = $state<UnidadMedida[]>([]);
	let proveedores = $state<{ value: string; label: string }[]>([]);
	let cargando = $state(true);
	let verEliminados = $state(false);

	// Filtros
	let busqueda = $state('');
	let filtroUnidad = $state('');
	let tipoSeleccionado = $state<TipoRecurso | null>(null);
	let familiaSeleccionada = $state<number | null>(null);
	let tiposAbiertos = $state<Record<string, boolean>>({ material: true });

	// Panel de edición
	let panelAbierto = $state(false);
	let editandoId = $state<number | null>(null);
	let guardando = $state(false);
	let form = $state({ codigo: '', nombre: '', tipo: 'material' as TipoRecurso, id_familia: '', unidad: '', precio: '', id_proveedor: '', observaciones: '' });

	// Nueva familia (en el árbol)
	let nuevaFamiliaTipo = $state<TipoRecurso | null>(null);
	let nuevaFamiliaNombre = $state('');

	// Confirmaciones
	let paraBaja = $state<Recurso | null>(null);
	let paraRestaurar = $state<Recurso | null>(null);
	let paraEliminar = $state<Recurso | null>(null);

	// Importación
	let importando = $state(false);
	let exportando = $state(false);

	async function cargar() {
		cargando = true;
		try {
			[recursos, familias, unidades] = await Promise.all([getRecursos(supabase, verEliminados), getFamilias(supabase), getUnidades(supabase)]);
		} catch (err) {
			toast.error(describeError(err));
		} finally {
			cargando = false;
		}
	}

	onMount(async () => {
		await cargar();
		getProveedorOptions(supabase)
			.then((ops) => (proveedores = ops.map((o) => ({ value: String(o.value), label: o.label }))))
			.catch(() => undefined);
	});

	const etiquetaTipo = (t: TipoRecurso) => TIPOS_RECURSO.find((x) => x.value === t)?.label ?? t;
	const familiasDe = (t: TipoRecurso) => familias.filter((f) => f.tipo === t);
	const nombreFamilia = (id: number | null) => familias.find((f) => f.id_familia === id)?.nombre ?? '';
	const soles = (n: number) => n.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
	const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
	function fechaCorta(iso: string | null): string {
		if (!iso) return '—';
		const [a, m, d] = iso.slice(0, 10).split('-');
		return `${d} ${MESES[Number(m) - 1]} ${a}`;
	}

	const filtrados = $derived.by(() => {
		const q = busqueda.trim().toLowerCase();
		return recursos.filter(
			(r) =>
				(!tipoSeleccionado || r.tipo === tipoSeleccionado) &&
				(!familiaSeleccionada || r.id_familia === familiaSeleccionada) &&
				(!filtroUnidad || r.unidad === filtroUnidad) &&
				(!q || `${r.codigo ?? ''} ${r.nombre}`.toLowerCase().includes(q))
		);
	});

	function elegirTipo(t: TipoRecurso) {
		tiposAbiertos = { ...tiposAbiertos, [t]: !(tipoSeleccionado === t && !familiaSeleccionada) || !tiposAbiertos[t] };
		tipoSeleccionado = tipoSeleccionado === t && !familiaSeleccionada ? null : t;
		familiaSeleccionada = null;
	}
	function elegirFamilia(f: FamiliaRecurso) {
		tipoSeleccionado = f.tipo;
		familiaSeleccionada = familiaSeleccionada === f.id_familia ? null : f.id_familia;
	}

	async function agregarFamilia() {
		if (!nuevaFamiliaTipo) return;
		const r = await crearFamilia(supabase, nuevaFamiliaTipo, nuevaFamiliaNombre);
		if (!r.success || !r.data) return toast.error(r.message);
		familias = [...familias, r.data];
		nuevaFamiliaTipo = null;
		nuevaFamiliaNombre = '';
		toast.success(r.message);
	}

	async function nuevoRecurso(base?: Recurso) {
		const tipo = base?.tipo ?? tipoSeleccionado ?? 'material';
		editandoId = null;
		form = {
			codigo: await siguienteCodigo(supabase, tipo),
			nombre: base ? `${base.nombre} (copia)` : '',
			tipo,
			id_familia: base?.id_familia ? String(base.id_familia) : familiaSeleccionada ? String(familiaSeleccionada) : '',
			unidad: base?.unidad ?? '',
			precio: base ? String(base.precio_unitario) : '',
			id_proveedor: base?.id_proveedor ? String(base.id_proveedor) : '',
			observaciones: base?.observaciones ?? ''
		};
		panelAbierto = true;
	}

	function editar(r: Recurso) {
		editandoId = r.id_recurso;
		form = {
			codigo: r.codigo ?? '',
			nombre: r.nombre,
			tipo: r.tipo,
			id_familia: r.id_familia ? String(r.id_familia) : '',
			unidad: r.unidad ?? '',
			precio: String(r.precio_unitario),
			id_proveedor: r.id_proveedor ? String(r.id_proveedor) : '',
			observaciones: r.observaciones ?? ''
		};
		panelAbierto = true;
	}

	async function cambiarTipoForm(t: string) {
		form.tipo = t as TipoRecurso;
		form.id_familia = '';
		if (!editandoId) form.codigo = await siguienteCodigo(supabase, form.tipo);
	}

	async function guardar() {
		guardando = true;
		try {
			const r = await guardarRecurso(
				supabase,
				{
					codigo: form.codigo,
					tipo: form.tipo,
					nombre: form.nombre,
					unidad: form.unidad,
					precio_unitario: Number(form.precio),
					id_familia: form.id_familia ? Number(form.id_familia) : null,
					id_proveedor: form.id_proveedor ? Number(form.id_proveedor) : null,
					observaciones: form.observaciones
				},
				editandoId,
				permisosState.userName || null
			);
			if (!r.success || !r.data) return toast.error(r.message);
			toast.success(r.message);
			const guardado = { ...r.data, precio_unitario: Number(r.data.precio_unitario) };
			recursos = editandoId ? recursos.map((x) => (x.id_recurso === editandoId ? guardado : x)) : [...recursos, guardado];
			editandoId = guardado.id_recurso;
		} finally {
			guardando = false;
		}
	}

	async function confirmarBaja() {
		if (!paraBaja) return;
		const r = await darDeBajaRecurso(supabase, paraBaja.id_recurso);
		if (!r.success) return toast.error(r.message);
		toast.success(r.message);
		recursos = recursos.filter((x) => x.id_recurso !== paraBaja!.id_recurso);
		if (editandoId === paraBaja.id_recurso) panelAbierto = false;
		paraBaja = null;
	}
	async function confirmarRestaurar() {
		if (!paraRestaurar) return;
		const r = await restaurarRecurso(supabase, paraRestaurar.id_recurso);
		if (!r.success) return toast.error(r.message);
		toast.success(r.message);
		recursos = recursos.filter((x) => x.id_recurso !== paraRestaurar!.id_recurso);
		paraRestaurar = null;
	}
	async function confirmarEliminar(email: string, password: string) {
		const v = await verifyAdminCredentials(email, password);
		if (!v.success) throw new Error(v.message);
		if (!paraEliminar) return;
		const r = await eliminarRecursoPermanente(supabase, paraEliminar.id_recurso);
		if (!r.success) throw new Error(r.message);
		toast.success(r.message);
		recursos = recursos.filter((x) => x.id_recurso !== paraEliminar!.id_recurso);
		paraEliminar = null;
	}

	function toggleVerEliminados() {
		verEliminados = !verEliminados;
		panelAbierto = false;
		cargar();
	}

	async function alElegirArchivo(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const archivo = input.files?.[0];
		input.value = '';
		if (!archivo) return;
		importando = true;
		try {
			const r = await importarRecursosExcel(supabase, archivo, permisosState.userName || null);
			toast.success(`Importación terminada: ${r.creados} creados, ${r.actualizados} actualizados${r.omitidos ? `, ${r.omitidos} omitidos (sin precio válido)` : ''}.`);
			if (r.errores.length) toast.error(`${r.errores.length} fila(s) con error. ${r.errores.slice(0, 3).join(' · ')}`);
			await cargar();
		} catch (err) {
			toast.error(`No se pudo importar. ${describeError(err)}`);
		} finally {
			importando = false;
		}
	}

	async function exportar() {
		exportando = true;
		try {
			await exportarTablaXlsx({
				nombreArchivo: 'Catalogo_recursos',
				hoja: 'Recursos',
				columnas: [
					{ titulo: 'Código', ancho: 12 },
					{ titulo: 'Recurso', ancho: 40 },
					{ titulo: 'Tipo', ancho: 14 },
					{ titulo: 'Familia', ancho: 16 },
					{ titulo: 'Und.', ancho: 8 },
					{ titulo: 'Precio ref. (S/)', ancho: 16, formato: 'moneda' },
					{ titulo: 'Proveedor referencial', ancho: 28 },
					{ titulo: 'Actualizado', ancho: 14 },
					{ titulo: 'Observaciones', ancho: 40 }
				],
				filas: filtrados.map((r) => [r.codigo, r.nombre, etiquetaTipo(r.tipo), nombreFamilia(r.id_familia), r.unidad, r.precio_unitario, r.proveedor?.razon_social ?? '', fechaCorta(r.updated_at), r.observaciones ?? ''])
			});
		} catch (err) {
			toast.error(`No se pudo exportar. ${describeError(err)}`);
		} finally {
			exportando = false;
		}
	}
</script>

<!-- Encabezado de la pestaña -->
<div class="flex flex-wrap items-start justify-between gap-3 mb-4">
	<div>
		<h1 class="text-xl font-bold text-[#0f3b5e]">{verEliminados ? 'Recursos eliminados' : 'Catálogo general de recursos'}</h1>
		<p class="text-sm text-slate-500">{verEliminados ? 'Recursos dados de baja: restáuralos o elimínalos de forma permanente.' : 'Recursos reutilizables en los APU de todas las obras.'}</p>
	</div>
	<div class="flex flex-wrap items-center gap-2">
		{#if isAdmin()}
			<button type="button" onclick={toggleVerEliminados} class={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium border ${verEliminados ? 'bg-slate-800 text-white border-slate-800' : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'}`}>
				{#if verEliminados}<ChevronLeft size={16} /> Volver{:else}<Trash2 size={16} /> Ver eliminados{/if}
			</button>
		{/if}
		<button type="button" onclick={exportar} disabled={exportando || filtrados.length === 0} class="flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
			{#if exportando}<Loader2 size={16} class="animate-spin" />{:else}<Download size={16} />{/if} Exportar
		</button>
		{#if !verEliminados}
			<label class={`flex items-center gap-2 px-3 py-2 rounded-lg border border-blue-300 bg-white text-sm font-medium text-blue-700 hover:bg-blue-50 cursor-pointer ${importando ? 'opacity-60 pointer-events-none' : ''}`}>
				{#if importando}<Loader2 size={16} class="animate-spin" />{:else}<Upload size={16} />{/if} Importar recursos S10/Excel
				<input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" class="hidden" onchange={alElegirArchivo} />
			</label>
			<button type="button" onclick={() => nuevoRecurso()} class="flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 text-sm font-semibold text-white hover:bg-blue-700">
				<Plus size={16} /> Nuevo recurso
			</button>
		{/if}
	</div>
</div>

<div class={`grid grid-cols-1 gap-4 ${panelAbierto ? 'lg:grid-cols-[210px_minmax(0,1fr)_320px]' : 'lg:grid-cols-[210px_minmax(0,1fr)]'}`}>
	<!-- Árbol: Tipos y familias -->
	<aside class="rounded-xl border border-slate-200 bg-white p-3 h-fit">
		<p class="px-1 pb-2 text-sm font-bold text-[#0f3b5e]">Tipos y familias</p>
		<button type="button" onclick={() => { tipoSeleccionado = null; familiaSeleccionada = null; }} class={`w-full rounded-md px-2 py-1.5 text-left text-xs font-medium ${!tipoSeleccionado ? 'bg-blue-50 text-blue-700' : 'text-slate-500 hover:bg-slate-50'}`}>Todos los recursos</button>
		{#each TIPOS_RECURSO as t (t.value)}
			{@const abierto = tiposAbiertos[t.value]}
			<div class="mt-1">
				<button type="button" onclick={() => elegirTipo(t.value)} class={`w-full flex items-center gap-1.5 rounded-md px-1.5 py-1.5 text-left text-sm ${tipoSeleccionado === t.value && !familiaSeleccionada ? 'bg-blue-50 text-blue-700 font-semibold' : 'text-slate-700 hover:bg-slate-50'}`}>
					{#if abierto}<ChevronDown size={14} class="shrink-0 text-slate-400" />{:else}<ChevronRight size={14} class="shrink-0 text-slate-400" />{/if}
					{#if abierto}<FolderOpen size={16} class="shrink-0 text-blue-500" />{:else}<Folder size={16} class="shrink-0 text-slate-500" />{/if}
					<span class="truncate">{t.label}</span>
				</button>
				{#if abierto}
					<div class="ml-5 border-l border-slate-100 pl-2">
						{#each familiasDe(t.value) as f (f.id_familia)}
							<button type="button" onclick={() => elegirFamilia(f)} class={`w-full flex items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-[13px] ${familiaSeleccionada === f.id_familia ? 'bg-blue-50 text-blue-700 font-semibold' : 'text-slate-600 hover:bg-slate-50'}`}>
								<FileText size={14} class="shrink-0 text-slate-400" /><span class="truncate">{f.nombre}</span>
							</button>
						{/each}
						{#if !verEliminados}
							{#if nuevaFamiliaTipo === t.value}
								<div class="flex items-center gap-1 py-1">
									<input type="text" bind:value={nuevaFamiliaNombre} maxlength="80" placeholder="Nueva familia" onkeydown={(e) => { if (e.key === 'Enter') agregarFamilia(); if (e.key === 'Escape') nuevaFamiliaTipo = null; }} class="min-w-0 flex-1 rounded border border-slate-300 px-1.5 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-300" />
									<button type="button" onclick={agregarFamilia} class="rounded p-1 text-blue-600 hover:bg-blue-50" aria-label="Agregar familia"><Plus size={14} /></button>
								</div>
							{:else}
								<button type="button" onclick={() => { nuevaFamiliaTipo = t.value; nuevaFamiliaNombre = ''; }} class="w-full flex items-center gap-1 px-1.5 py-1 text-left text-[11px] text-blue-600 hover:underline"><Plus size={12} /> Familia</button>
							{/if}
						{/if}
					</div>
				{/if}
			</div>
		{/each}
	</aside>

	<!-- Tabla de recursos -->
	<section class="min-w-0 rounded-xl border border-slate-200 bg-white">
		<div class="flex flex-wrap items-center gap-2 border-b border-slate-100 p-3">
			<div class="relative w-full sm:w-64">
				<Search size={15} class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
				<input type="text" bind:value={busqueda} placeholder="Buscar código o descripción..." class="w-full pl-8 pr-7 py-1.5 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200" />
				{#if busqueda}<button type="button" onclick={() => (busqueda = '')} class="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400" aria-label="Limpiar búsqueda"><X size={13} /></button>{/if}
			</div>
			<div class="w-40">
				<SelectConSaldo value={filtroUnidad} options={[{ value: '', label: 'Unidad: Todas' }, ...unidades.map((u) => ({ value: u.codigo, label: `Unidad: ${u.codigo}` }))]} onchange={(v) => (filtroUnidad = v)} />
			</div>
			<span class="text-xs text-slate-400">{filtrados.length} recurso{filtrados.length === 1 ? '' : 's'}</span>
		</div>

		{#if cargando}
			<div class="flex items-center justify-center gap-2 py-12 text-sm text-slate-400"><Loader2 size={18} class="animate-spin" /> Cargando recursos…</div>
		{:else if filtrados.length === 0}
			<p class="py-12 text-center text-sm text-slate-400">{verEliminados ? 'No hay recursos dados de baja.' : 'No hay recursos que coincidan. Crea uno con "Nuevo recurso" o importa tu lista desde S10/Excel.'}</p>
		{:else}
			<div class="overflow-x-auto">
				<table class="w-full min-w-[720px] text-sm">
					<thead>
						<tr class="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
							<th class="text-left px-3 py-2.5">Código</th>
							<th class="text-left px-3 py-2.5">Recurso</th>
							<th class="text-left px-3 py-2.5">Und.</th>
							<th class="text-right px-3 py-2.5">Precio ref. (S/)</th>
							<th class="text-left px-3 py-2.5">Actualizado</th>
							<th class="text-left px-3 py-2.5">Familia</th>
							<th class="text-center px-3 py-2.5">Acciones</th>
						</tr>
					</thead>
					<tbody class="divide-y divide-slate-100">
						{#each filtrados as r (r.id_recurso)}
							<tr class={`hover:bg-slate-50 ${editandoId === r.id_recurso && panelAbierto ? 'bg-blue-50/60' : ''}`}>
								<td class="px-3 py-2.5 font-medium text-slate-700 whitespace-nowrap">{r.codigo ?? '—'}</td>
								<td class="px-3 py-2.5 text-slate-700">{r.nombre}</td>
								<td class="px-3 py-2.5 text-slate-600">{r.unidad ?? '—'}</td>
								<td class="px-3 py-2.5 text-right tabular-nums text-slate-700">{soles(r.precio_unitario)}</td>
								<td class="px-3 py-2.5 text-slate-500 whitespace-nowrap">{fechaCorta(r.updated_at)}</td>
								<td class="px-3 py-2.5 text-slate-500">{nombreFamilia(r.id_familia) || etiquetaTipo(r.tipo)}</td>
								<td class="px-3 py-2.5">
									<div class="flex items-center justify-center gap-1">
										{#if verEliminados}
											<button type="button" onclick={() => (paraRestaurar = r)} class="p-1.5 rounded text-slate-500 hover:bg-emerald-50 hover:text-emerald-600" title="Restaurar" aria-label="Restaurar"><RotateCcw size={15} /></button>
											<button type="button" onclick={() => (paraEliminar = r)} class="p-1.5 rounded text-slate-500 hover:bg-red-50 hover:text-red-600" title="Eliminar permanentemente" aria-label="Eliminar permanentemente"><Trash size={15} /></button>
										{:else}
											<button type="button" onclick={() => editar(r)} class="p-1.5 rounded text-slate-500 hover:bg-blue-50 hover:text-blue-600" title="Editar" aria-label="Editar"><Pencil size={15} /></button>
											<button type="button" onclick={() => nuevoRecurso(r)} class="p-1.5 rounded text-slate-500 hover:bg-blue-50 hover:text-blue-600" title="Duplicar" aria-label="Duplicar"><Copy size={15} /></button>
											<button type="button" onclick={() => (paraBaja = r)} class="p-1.5 rounded text-slate-500 hover:bg-red-50 hover:text-red-600" title="Dar de baja" aria-label="Dar de baja"><Trash2 size={15} /></button>
										{/if}
									</div>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</section>

	<!-- Panel de edición (en celular, encima de todo) -->
	{#if panelAbierto}
		<aside class="fixed inset-0 z-[120] overflow-y-auto bg-white p-4 lg:static lg:z-auto lg:rounded-xl lg:border lg:border-slate-200 lg:h-fit">
			<div class="mb-3 flex items-start justify-between gap-2">
				<h2 class="text-base font-bold text-[#0f3b5e]">{editandoId ? `${form.codigo} · ${form.nombre}` : 'Nuevo recurso'}</h2>
				<button type="button" onclick={() => (panelAbierto = false)} class="rounded p-1 text-slate-400 hover:bg-slate-100" aria-label="Cerrar panel"><X size={18} /></button>
			</div>
			<div class="grid gap-3">
				<div>
					<label for="rec-codigo" class="block text-xs font-medium text-slate-600 mb-1">Código</label>
					<input id="rec-codigo" type="text" maxlength="20" bind:value={form.codigo} class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm uppercase focus:outline-none focus:ring-2 focus:ring-blue-200" />
				</div>
				<div>
					<label for="rec-nombre" class="block text-xs font-medium text-slate-600 mb-1">Descripción <span class="text-red-500">*</span></label>
					<input id="rec-nombre" type="text" maxlength="200" bind:value={form.nombre} class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200" />
				</div>
				<div class="grid grid-cols-2 gap-2">
					<div>
						<span class="block text-xs font-medium text-slate-600 mb-1">Tipo</span>
						<SelectConSaldo value={form.tipo} options={TIPOS_RECURSO.map((t) => ({ value: t.value, label: t.label }))} onchange={cambiarTipoForm} />
					</div>
					<div>
						<span class="block text-xs font-medium text-slate-600 mb-1">Familia</span>
						<SelectConSaldo value={form.id_familia} options={[{ value: '', label: '— Sin familia —' }, ...familiasDe(form.tipo).map((f) => ({ value: String(f.id_familia), label: f.nombre }))]} onchange={(v) => (form.id_familia = v)} />
					</div>
				</div>
				<div class="grid grid-cols-2 gap-2">
					<div>
						<span class="block text-xs font-medium text-slate-600 mb-1">Unidad <span class="text-red-500">*</span></span>
						<SelectConSaldo value={form.unidad} placeholder="Elige" options={unidades.map((u) => ({ value: u.codigo, label: `${u.codigo} · ${u.descripcion}` }))} onchange={(v) => (form.unidad = v)} />
					</div>
					<div>
						<label for="rec-precio" class="block text-xs font-medium text-slate-600 mb-1">Precio de referencia (S/)</label>
						<input id="rec-precio" type="number" min="0" step="0.01" inputmode="decimal" bind:value={form.precio} class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-right focus:outline-none focus:ring-2 focus:ring-blue-200" />
					</div>
				</div>
				<div>
					<span class="block text-xs font-medium text-slate-600 mb-1">Proveedor referencial</span>
					<SelectConSaldo value={form.id_proveedor} options={[{ value: '', label: '— Ninguno —' }, ...proveedores]} onchange={(v) => (form.id_proveedor = v)} />
				</div>
				<div>
					<label for="rec-obs" class="block text-xs font-medium text-slate-600 mb-1">Observaciones</label>
					<textarea id="rec-obs" rows="3" bind:value={form.observaciones} class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"></textarea>
				</div>
				<button type="button" onclick={guardar} disabled={guardando} class="flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60">
					{#if guardando}<Loader2 size={16} class="animate-spin" />{:else}<Save size={16} />{/if} Guardar recurso
				</button>
				<p class="flex items-start gap-1.5 rounded-lg bg-blue-50 px-3 py-2 text-[11px] text-blue-800">
					<Info size={13} class="mt-px shrink-0" /> Los cambios de precio general no modifican presupuestos existentes.
				</p>
			</div>
		</aside>
	{/if}
</div>

<ConfirmModal open={!!paraBaja} title="Dar de baja recurso" message={`¿Dar de baja ${paraBaja?.codigo ?? ''} · ${paraBaja?.nombre ?? ''}? Dejará de aparecer en el catálogo; un administrador puede restaurarlo.`} confirmLabel="Dar de baja" danger onConfirm={confirmarBaja} onClose={() => (paraBaja = null)} />
<ConfirmModal open={!!paraRestaurar} title="Restaurar recurso" message={`¿Restaurar ${paraRestaurar?.codigo ?? ''} · ${paraRestaurar?.nombre ?? ''}?`} confirmLabel="Restaurar" onConfirm={confirmarRestaurar} onClose={() => (paraRestaurar = null)} />
<AdminConfirmModal open={!!paraEliminar} title="Eliminar recurso permanentemente" message={`Se borrará ${paraEliminar?.codigo ?? ''} · ${paraEliminar?.nombre ?? ''} de la base de datos. Confirma con tu correo y contraseña de administrador.`} confirmLabel="Eliminar permanentemente" onConfirm={confirmarEliminar} onClose={() => (paraEliminar = null)} />
