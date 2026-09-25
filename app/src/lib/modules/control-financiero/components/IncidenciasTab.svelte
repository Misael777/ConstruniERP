<script lang="ts">
	import SelectConSaldo from '$lib/shared/components/SelectConSaldo.svelte';
	import { onMount } from 'svelte';
	import { supabase } from '$lib/supabaseClient';
	import { toast } from '$lib/stores/toast';
	import { permisosState, isAdmin } from '$lib/stores/permisos.svelte';
	import { verifyAdminCredentials } from '$lib/shared/adminAuth';
	import AdminConfirmModal from '$lib/shared/components/AdminConfirmModal.svelte';
	import {
		getIncidencias,
		getEventosIncidencia,
		getEtiquetaEntidadAfectada,
		iniciarInvestigacion,
		identificarCausa,
		requerirAjuste,
		resolverSinAjuste,
		registrarAjusteYResolver,
		cerrarIncidencia,
		type Incidencia,
		type IncidenciaEvento,
		type EstadoIncidencia,
		type Severidad
	} from '../services/incidencia.service';
	import { AlertCircle, RefreshCw, X, Clock } from '@lucide/svelte';

	let loading = $state(true);
	let incidencias = $state<Incidencia[]>([]);
	let etiquetas = $state<Record<number, string>>({});
	let filtroEstado = $state('');
	let filtroSeveridad = $state('');

	const ESTADOS: EstadoIncidencia[] = ['OPEN', 'INVESTIGATING', 'CAUSE_IDENTIFIED', 'ADJUSTMENT_REQUIRED', 'RESOLVED', 'CLOSED'];
	const ESTADO_LABELS: Record<EstadoIncidencia, string> = {
		OPEN: 'Abierta',
		INVESTIGATING: 'Investigando',
		CAUSE_IDENTIFIED: 'Causa identificada',
		ADJUSTMENT_REQUIRED: 'Requiere ajuste',
		RESOLVED: 'Resuelta',
		CLOSED: 'Cerrada'
	};
	const ESTADO_BADGE: Record<EstadoIncidencia, string> = {
		OPEN: 'bg-red-100 text-red-700',
		INVESTIGATING: 'bg-amber-100 text-amber-700',
		CAUSE_IDENTIFIED: 'bg-blue-100 text-blue-700',
		ADJUSTMENT_REQUIRED: 'bg-purple-100 text-purple-700',
		RESOLVED: 'bg-emerald-100 text-emerald-700',
		CLOSED: 'bg-slate-200 text-slate-600'
	};
	const SEVERIDAD_BADGE: Record<Severidad, string> = {
		baja: 'bg-slate-100 text-slate-600',
		media: 'bg-amber-100 text-amber-700',
		alta: 'bg-orange-100 text-orange-700',
		critica: 'bg-red-100 text-red-700'
	};

	async function cargar() {
		loading = true;
		try {
			incidencias = await getIncidencias(supabase, {
				estado: (filtroEstado || undefined) as EstadoIncidencia | undefined,
				severidad: (filtroSeveridad || undefined) as Severidad | undefined
			});
			const pares = await Promise.all(incidencias.map(async (i) => [i.id_incidencia, await getEtiquetaEntidadAfectada(supabase, i.tipo_entidad, i.id_entidad)] as const));
			etiquetas = Object.fromEntries(pares);
		} catch (err: any) {
			toast.error(err?.message ?? 'No se pudo cargar las incidencias');
		} finally {
			loading = false;
		}
	}

	onMount(cargar);

	function formatFecha(iso: string): string {
		return new Date(iso).toLocaleString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
	}

	// ── Detalle ──────────────────────────────────────────────────────────────
	let detalleAbierto = $state(false);
	let incidenciaActual = $state<Incidencia | null>(null);
	let eventos = $state<IncidenciaEvento[]>([]);
	let cargandoDetalle = $state(false);
	let procesando = $state(false);
	let causaInput = $state('');
	let comentarioResolucion = $state('');

	async function abrirDetalle(incidencia: Incidencia) {
		incidenciaActual = incidencia;
		detalleAbierto = true;
		causaInput = incidencia.causa ?? '';
		comentarioResolucion = '';
		cargandoDetalle = true;
		try {
			eventos = await getEventosIncidencia(supabase, incidencia.id_incidencia);
		} catch (err: any) {
			toast.error(err?.message ?? 'No se pudo cargar el historial');
		} finally {
			cargandoDetalle = false;
		}
	}

	function cerrarDetalle() {
		detalleAbierto = false;
		incidenciaActual = null;
	}

	async function refrescarDetalle() {
		if (!incidenciaActual) return;
		eventos = await getEventosIncidencia(supabase, incidenciaActual.id_incidencia);
	}

	async function handleIniciarInvestigacion() {
		if (!incidenciaActual) return;
		procesando = true;
		try {
			const result = await iniciarInvestigacion(supabase, incidenciaActual.id_incidencia, permisosState.userName || null);
			if (result.success && result.data) {
				incidenciaActual = result.data;
				toast.success(result.message);
				await Promise.all([refrescarDetalle(), cargar()]);
			} else {
				toast.error(result.message);
			}
		} finally {
			procesando = false;
		}
	}

	async function handleIdentificarCausa() {
		if (!incidenciaActual) return;
		procesando = true;
		try {
			const result = await identificarCausa(supabase, incidenciaActual.id_incidencia, causaInput, permisosState.userName || null);
			if (result.success && result.data) {
				incidenciaActual = result.data;
				toast.success(result.message);
				await Promise.all([refrescarDetalle(), cargar()]);
			} else {
				toast.error(result.message);
			}
		} finally {
			procesando = false;
		}
	}

	async function handleRequerirAjuste() {
		if (!incidenciaActual) return;
		procesando = true;
		try {
			const result = await requerirAjuste(supabase, incidenciaActual.id_incidencia, permisosState.userName || null);
			if (result.success && result.data) {
				incidenciaActual = result.data;
				toast.success(result.message);
				await Promise.all([refrescarDetalle(), cargar()]);
			} else {
				toast.error(result.message);
			}
		} finally {
			procesando = false;
		}
	}

	async function handleResolverSinAjuste() {
		if (!incidenciaActual) return;
		procesando = true;
		try {
			const result = await resolverSinAjuste(supabase, incidenciaActual.id_incidencia, comentarioResolucion, permisosState.userName || null);
			if (result.success && result.data) {
				incidenciaActual = result.data;
				comentarioResolucion = '';
				toast.success(result.message);
				await Promise.all([refrescarDetalle(), cargar()]);
			} else {
				toast.error(result.message);
			}
		} finally {
			procesando = false;
		}
	}

	async function handleCerrarIncidencia() {
		if (!incidenciaActual) return;
		procesando = true;
		try {
			const result = await cerrarIncidencia(supabase, incidenciaActual.id_incidencia, permisosState.userName || null);
			if (result.success && result.data) {
				incidenciaActual = result.data;
				toast.success(result.message);
				await Promise.all([refrescarDetalle(), cargar()]);
			} else {
				toast.error(result.message);
			}
		} finally {
			procesando = false;
		}
	}

	// Registrar el ajuste exige re-confirmar credenciales de admin (AdminConfirmModal) — un ajuste
	// redefine "la verdad" de un saldo, mismo nivel de ceremonia que "eliminar permanentemente" en
	// cuentas-pagar/+page.svelte (ver verifyAdminCredentials).
	let confirmAjusteOpen = $state(false);
	async function handleConfirmarAjuste(email: string, password: string) {
		if (!incidenciaActual) return;
		const verificacion = await verifyAdminCredentials(email, password);
		if (!verificacion.success) throw new Error(verificacion.message);
		if (!comentarioResolucion.trim()) throw new Error('Describe el ajuste realizado antes de continuar.');

		const result = await registrarAjusteYResolver(supabase, incidenciaActual.id_incidencia, comentarioResolucion, permisosState.userName || null);
		if (!result.success || !result.data) throw new Error(result.message);
		incidenciaActual = result.data;
		comentarioResolucion = '';
		confirmAjusteOpen = false;
		toast.success(result.message);
		await Promise.all([refrescarDetalle(), cargar()]);
	}
</script>

<div class="flex items-center justify-between mb-6 flex-wrap gap-3">
	<div>
		<h1 class="text-xl font-bold text-brand-marine flex items-center gap-2"><AlertCircle size={20} class="text-blue-600" /> Incidencias</h1>
		<p class="text-sm text-slate-500 mt-1">Hallazgos de Consistencia/Conciliación (o dados de alta a mano) y su ciclo de investigación y resolución.</p>
	</div>
	<div class="flex items-center gap-2">
		<SelectConSaldo
			value={filtroEstado}
			options={[{ value: '', label: 'Todos los estados (sin cerradas)' }, ...ESTADOS.map((e) => ({ value: String(e), label: `${ESTADO_LABELS[e]}` }))]}
			placeholder="Todos los estados (sin cerradas)"
			onchange={(v) => { filtroEstado = v; cargar(); }}
		/>
		<SelectConSaldo
			value={filtroSeveridad}
			options={[{ value: '', label: 'Toda severidad' }, { value: 'baja', label: 'Baja' }, { value: 'media', label: 'Media' }, { value: 'alta', label: 'Alta' }, { value: 'critica', label: 'Crítica' }]}
			placeholder="Toda severidad"
			onchange={(v) => { filtroSeveridad = v; cargar(); }}
		/>
		<button type="button" onclick={cargar} class="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 text-slate-600 text-sm font-medium hover:bg-slate-50">
			<RefreshCw size={14} class={loading ? 'animate-spin' : ''} />
		</button>
	</div>
</div>

{#if loading}
	<div class="flex items-center justify-center py-24 text-slate-400">
		<RefreshCw size={28} class="animate-spin" />
	</div>
{:else if incidencias.length === 0}
	<div class="text-center py-20 text-slate-400 bg-white rounded-2xl border border-slate-100 shadow-sm">
		<AlertCircle size={40} class="mx-auto mb-3 text-slate-300" />
		Sin incidencias para este filtro.
	</div>
{:else}
	<div class="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
		<div class="overflow-x-auto">
			<table class="w-full text-xs text-left whitespace-nowrap">
				<thead class="bg-slate-50 border-b border-slate-200 text-slate-500 font-bold uppercase tracking-wide text-[10px]">
					<tr>
						<th class="px-3 py-2.5">Severidad</th>
						<th class="px-3 py-2.5">Estado</th>
						<th class="px-3 py-2.5">Fecha</th>
						<th class="px-3 py-2.5">Entidad Afectada</th>
						<th class="px-3 py-2.5">Descripción</th>
						<th class="px-3 py-2.5"></th>
					</tr>
				</thead>
				<tbody class="divide-y divide-slate-100">
					{#each incidencias as i (i.id_incidencia)}
						<tr class="hover:bg-slate-50/70">
							<td class="px-3 py-2"><span class={`px-1.5 py-0.5 rounded text-[10px] font-bold ${SEVERIDAD_BADGE[i.severidad]}`}>{i.severidad}</span></td>
							<td class="px-3 py-2"><span class={`px-1.5 py-0.5 rounded text-[10px] font-bold ${ESTADO_BADGE[i.estado]}`}>{ESTADO_LABELS[i.estado]}</span></td>
							<td class="px-3 py-2">{formatFecha(i.fecha_deteccion)}</td>
							<td class="px-3 py-2">{etiquetas[i.id_incidencia] ?? '—'}</td>
							<td class="px-3 py-2 max-w-[320px] truncate">{i.descripcion}</td>
							<td class="px-3 py-2">
								<button type="button" onclick={() => abrirDetalle(i)} class="text-blue-600 font-semibold hover:underline">Ver</button>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</div>
{/if}

{#if detalleAbierto && incidenciaActual}
	<div class="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
		<div class="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
			<div class="flex items-center justify-between px-5 py-4 border-b border-slate-200 shrink-0">
				<h2 class="text-base font-bold text-[#0f3b5e]">Incidencia #{incidenciaActual.id_incidencia}</h2>
				<button type="button" onclick={cerrarDetalle} class="text-slate-400 hover:text-slate-600" aria-label="Cerrar"><X size={20} /></button>
			</div>
			<div class="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-4">
				<div class="flex items-center gap-2 flex-wrap">
					<span class={`px-2 py-1 rounded text-[11px] font-bold ${SEVERIDAD_BADGE[incidenciaActual.severidad]}`}>{incidenciaActual.severidad}</span>
					<span class={`px-2 py-1 rounded text-[11px] font-bold ${ESTADO_BADGE[incidenciaActual.estado]}`}>{ESTADO_LABELS[incidenciaActual.estado]}</span>
					<span class="text-xs text-slate-400">{formatFecha(incidenciaActual.fecha_deteccion)}</span>
				</div>
				<p class="text-sm text-slate-700">{incidenciaActual.descripcion}</p>
				{#if incidenciaActual.monto_diferencia !== null}
					<p class="text-xs text-slate-500">Diferencia: <span class="font-bold">{incidenciaActual.monto_diferencia}</span></p>
				{/if}
				{#if incidenciaActual.causa}
					<div class="bg-slate-50 rounded-lg p-3 text-xs text-slate-600"><span class="font-bold">Causa:</span> {incidenciaActual.causa}</div>
				{/if}

				<!-- ── Acción según estado actual ─────────────────────────────────── -->
				{#if incidenciaActual.estado === 'OPEN'}
					<button type="button" onclick={handleIniciarInvestigacion} disabled={procesando} class="self-start px-4 py-2 rounded-lg bg-[#0f3b5e] text-white text-sm font-semibold hover:bg-[#154a73] disabled:opacity-50">
						Iniciar investigación
					</button>
				{:else if incidenciaActual.estado === 'INVESTIGATING'}
					<div class="flex flex-col gap-2">
						<label for="inc-causa" class="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Causa identificada</label>
						<textarea id="inc-causa" bind:value={causaInput} rows="3" class="px-3 py-2 rounded-lg border border-slate-300 text-sm resize-none" placeholder="Describe la causa raíz de la diferencia..."></textarea>
						<button type="button" onclick={handleIdentificarCausa} disabled={procesando} class="self-start px-4 py-2 rounded-lg bg-[#0f3b5e] text-white text-sm font-semibold hover:bg-[#154a73] disabled:opacity-50">
							Identificar causa
						</button>
					</div>
				{:else if incidenciaActual.estado === 'CAUSE_IDENTIFIED'}
					<div class="flex flex-col gap-2">
						<label for="inc-resolucion" class="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Comentario (si resuelves sin ajuste)</label>
						<textarea id="inc-resolucion" bind:value={comentarioResolucion} rows="2" class="px-3 py-2 rounded-lg border border-slate-300 text-sm resize-none" placeholder="Ej. diferencia de tiempo que se autorresuelve el próximo periodo..."></textarea>
						<div class="flex gap-2">
							<button type="button" onclick={handleRequerirAjuste} disabled={procesando} class="px-4 py-2 rounded-lg bg-purple-600 text-white text-sm font-semibold hover:bg-purple-700 disabled:opacity-50">
								Requerir ajuste
							</button>
							<button type="button" onclick={handleResolverSinAjuste} disabled={procesando} class="px-4 py-2 rounded-lg border border-slate-300 text-slate-600 text-sm font-semibold hover:bg-slate-50 disabled:opacity-50">
								Resolver sin ajuste
							</button>
						</div>
					</div>
				{:else if incidenciaActual.estado === 'ADJUSTMENT_REQUIRED'}
					<div class="flex flex-col gap-2">
						<label for="inc-ajuste" class="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Describe el ajuste realizado</label>
						<textarea id="inc-ajuste" bind:value={comentarioResolucion} rows="3" class="px-3 py-2 rounded-lg border border-slate-300 text-sm resize-none" placeholder="Ej. se registró un Egreso de S/2,000 para corregir la diferencia..."></textarea>
						<button type="button" onclick={() => (confirmAjusteOpen = true)} class="self-start px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-semibold hover:bg-red-700">
							Registrar ajuste y resolver
						</button>
					</div>
				{:else if incidenciaActual.estado === 'RESOLVED'}
					{#if isAdmin()}
						<button type="button" onclick={handleCerrarIncidencia} disabled={procesando} class="self-start px-4 py-2 rounded-lg bg-[#0f3b5e] text-white text-sm font-semibold hover:bg-[#154a73] disabled:opacity-50">
							Cerrar incidencia
						</button>
					{:else}
						<p class="text-xs text-slate-400">Solo un administrador puede cerrar la incidencia.</p>
					{/if}
				{/if}

				<!-- ── Timeline ───────────────────────────────────────────────────── -->
				<div class="border-t border-slate-100 pt-3">
					<div class="flex items-center gap-1.5 text-xs font-bold text-slate-500 mb-2"><Clock size={13} /> Historial</div>
					{#if cargandoDetalle}
						<RefreshCw size={16} class="animate-spin text-slate-300" />
					{:else}
						<ul class="flex flex-col gap-2">
							{#each eventos as e (e.id_evento)}
								<li class="text-xs text-slate-500 border-l-2 border-slate-200 pl-3">
									<span class="font-semibold text-slate-600">{formatFecha(e.created_at)}</span>
									{#if e.estado_anterior && e.estado_nuevo}— {ESTADO_LABELS[e.estado_anterior]} → {ESTADO_LABELS[e.estado_nuevo]}{/if}
									{#if e.comentario}<div class="text-slate-400">{e.comentario}</div>{/if}
									{#if e.usuario}<div class="text-slate-300">{e.usuario}</div>{/if}
								</li>
							{/each}
						</ul>
					{/if}
				</div>
			</div>
		</div>
	</div>
{/if}

<AdminConfirmModal
	open={confirmAjusteOpen}
	title="Registrar ajuste de saldo"
	message="Vas a registrar un ajuste que resuelve esta incidencia. Esta acción redefine el saldo considerado correcto — ingresa el correo y la contraseña de un administrador para continuar."
	confirmLabel="Registrar ajuste"
	onConfirm={handleConfirmarAjuste}
	onClose={() => (confirmAjusteOpen = false)}
/>
