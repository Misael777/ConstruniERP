<script lang="ts">
	// Submódulo "Presupuesto" embebido como pestaña dentro de Proyectos > Gestión (a pedido explícito
	// del usuario) — antes vivía como ruta propia en el menú, ahora se monta acá. Se elige el proyecto
	// AL CREAR el presupuesto (por su código de venta cerrada, ver NuevoPresupuestoModal.svelte). La
	// vista de detalle reusa PresupuestoTab.svelte tal cual (agregar partidas/plantillas, llenar
	// metrado/precio, botón "Guardar") — no se duplicó nada de esa lógica.
	import { onMount } from 'svelte';
	import { fetchPresupuestos, presupuestosList } from '$lib/stores/partidas';
	import PresupuestoTab from '$lib/components/proyecto/PresupuestoTab.svelte';
	import NuevoPresupuestoModal from '$lib/components/proyecto/NuevoPresupuestoModal.svelte';
	import { Plus, ArrowLeft } from '@lucide/svelte';

	let vista = $state<'lista' | 'detalle'>('lista');
	let proyectoActivo = $state<{ id_proyecto: number; nombre_proyecto: string } | null>(null);
	let showNuevoModal = $state(false);
	let loading = $state(true);

	onMount(async () => {
		await cargar();
	});

	async function cargar() {
		loading = true;
		await fetchPresupuestos();
		loading = false;
	}

	function verPresupuesto(item: (typeof $presupuestosList)[number]) {
		proyectoActivo = { id_proyecto: item.id_proyecto, nombre_proyecto: item.nombre_proyecto };
		vista = 'detalle';
	}

	function volverALista() {
		vista = 'lista';
		proyectoActivo = null;
		cargar();
	}

	function handleCreado(info: { idProyecto: number }) {
		const item = $presupuestosList.find((p) => p.id_proyecto === info.idProyecto);
		proyectoActivo = { id_proyecto: info.idProyecto, nombre_proyecto: item?.nombre_proyecto ?? '' };
		vista = 'detalle';
	}

	function fmtFecha(value: string) {
		if (!value) return '—';
		const d = new Date(value + 'T00:00:00');
		if (Number.isNaN(d.getTime())) return value;
		return d.toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric' });
	}
</script>

{#if vista === 'lista'}
	<div class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
		<div>
			<h2 class="text-2xl font-semibold text-slate-800">Presupuestos</h2>
			<p class="text-sm text-slate-500 mt-1">Elige un proyecto (con venta cerrada) para crear o abrir su presupuesto.</p>
		</div>
		<button
			type="button"
			onclick={() => (showNuevoModal = true)}
			class="px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-xl text-sm font-medium shadow-md shadow-orange-600/10 active:scale-[0.98] transition-all flex items-center gap-2"
		>
			<Plus size={16} /> Nuevo Presupuesto
		</button>
	</div>

	{#if loading}
		<div class="flex justify-center text-orange-600 text-3xl py-12">
			<i class="fas fa-circle-notch fa-spin"></i>
		</div>
	{:else if $presupuestosList.length === 0}
		<div class="bg-white rounded-2xl border border-slate-100 shadow-sm p-12 text-center">
			<div class="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-4">
				<i class="fas fa-file-invoice-dollar text-2xl text-slate-400"></i>
			</div>
			<h3 class="text-lg font-bold text-slate-700 mb-2">No hay presupuestos todavía</h3>
			<p class="text-slate-500 text-sm max-w-sm mx-auto">Crea uno con "Nuevo Presupuesto".</p>
		</div>
	{:else}
		<div class="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
			<table class="w-full text-sm">
				<thead class="bg-slate-50 text-left text-xs text-slate-500 uppercase tracking-wide">
					<tr>
						<th class="px-4 py-3 font-semibold">Nombre</th>
						<th class="px-4 py-3 font-semibold">Proyecto</th>
						<th class="px-4 py-3 font-semibold">Cliente</th>
						<th class="px-4 py-3 font-semibold">Fecha de creación</th>
						<th class="px-4 py-3"></th>
					</tr>
				</thead>
				<tbody class="divide-y divide-slate-100">
					{#each $presupuestosList as item (item.id_presupuesto)}
						<tr class="hover:bg-slate-50/70">
							<td class="px-4 py-3 font-medium text-[#1e293b]">{item.nombre}</td>
							<td class="px-4 py-3 text-slate-600">{item.nombre_proyecto}</td>
							<td class="px-4 py-3 text-slate-500">{item.cliente_nombre ?? '—'}</td>
							<td class="px-4 py-3 text-slate-500">{fmtFecha(item.fecha_creacion)}</td>
							<td class="px-4 py-3 text-right">
								<button
									type="button"
									onclick={() => verPresupuesto(item)}
									class="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold transition-colors"
								>
									Ver
								</button>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
{:else if proyectoActivo}
	<div class="flex items-center gap-3 mb-4">
		<button type="button" onclick={volverALista} class="p-2 -ml-2 text-slate-500 hover:bg-slate-100 rounded-full shrink-0" aria-label="Volver">
			<ArrowLeft size={20} />
		</button>
		<h2 class="text-xl font-bold text-slate-800 truncate">{proyectoActivo.nombre_proyecto}</h2>
	</div>
	<PresupuestoTab projectId={proyectoActivo.id_proyecto} proyecto={{ nombre_proyecto: proyectoActivo.nombre_proyecto }} />
{/if}

<NuevoPresupuestoModal isOpen={showNuevoModal} on:close={() => (showNuevoModal = false)} on:created={(e) => handleCreado(e.detail)} />
