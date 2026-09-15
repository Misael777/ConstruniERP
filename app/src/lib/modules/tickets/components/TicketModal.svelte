<script lang="ts">
	// Modal "Nuevo Ticket" — a pedido explícito del usuario: reemplaza el reporte de reclamos/
	// sugerencias/incidencias/requerimientos por WhatsApp. Cualquier usuario con el permiso
	// 'ver_soporte_tickets' (otorgado a todos los roles, ver ticket_module_migration.sql) puede
	// reportar. El selector de "Módulo" reusa MODULE_REGISTRY (modules.ts) para no mantener un
	// catálogo aparte — incluye "Otro / No aplica" para reclamos que no son de una pantalla puntual
	// (ej. "la app se cierra sola").
	import { X } from '@lucide/svelte';
	import { supabase } from '$lib/supabaseClient';
	import { toast } from '$lib/stores/toast';
	import { MODULE_REGISTRY } from '$lib/config/modules';
	import { crearTicket, type TipoTicket, type PrioridadTicket } from '../services/tickets.service';

	let { open = false, onClose = () => {}, onCreated = () => {} }: { open?: boolean; onClose?: () => void; onCreated?: () => void } = $props();

	/** Lista plana de módulos (top-level + subItems) para el selector — un ticket puede referirse a
	 * cualquier pantalla del ERP, no solo a un módulo de primer nivel. */
	const opcionesModulo = MODULE_REGISTRY.flatMap((mod) => [
		{ value: mod.path, label: mod.label },
		...(mod.subItems ?? []).map((sub) => ({ value: sub.path, label: `${mod.label} — ${sub.label}` }))
	]);

	const OPCIONES_TIPO: { value: TipoTicket; label: string }[] = [
		{ value: 'reclamo', label: 'Reclamo' },
		{ value: 'sugerencia', label: 'Sugerencia' },
		{ value: 'incidencia', label: 'Incidencia' },
		{ value: 'requerimiento', label: 'Requerimiento' }
	];
	const OPCIONES_PRIORIDAD: { value: PrioridadTicket; label: string }[] = [
		{ value: 'baja', label: 'Baja' },
		{ value: 'media', label: 'Media' },
		{ value: 'alta', label: 'Alta' },
		{ value: 'critica', label: 'Crítica' }
	];

	let tipo = $state<TipoTicket>('incidencia');
	let modulo = $state('');
	let titulo = $state('');
	let descripcion = $state('');
	let prioridad = $state<PrioridadTicket>('media');
	let guardando = $state(false);
	let error = $state('');

	function resetForm() {
		tipo = 'incidencia';
		modulo = '';
		titulo = '';
		descripcion = '';
		prioridad = 'media';
		error = '';
	}

	async function handleSubmit(e: Event) {
		e.preventDefault();
		if (!titulo.trim() || !descripcion.trim()) {
			error = 'Título y descripción son obligatorios.';
			return;
		}
		guardando = true;
		error = '';
		try {
			const result = await crearTicket(supabase, {
				tipo,
				modulo: modulo || null,
				titulo: titulo.trim(),
				descripcion: descripcion.trim(),
				prioridad
			});
			if (!result.success) {
				error = result.message || 'No se pudo registrar el ticket.';
				return;
			}
			toast.success('Ticket registrado — el equipo de desarrollo ya puede verlo.');
			resetForm();
			onCreated();
			onClose();
		} catch (err: any) {
			error = err?.message ?? 'Ocurrió un error inesperado.';
		} finally {
			guardando = false;
		}
	}
</script>

{#if open}
	<div class="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
		<div class="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
			<div class="sticky top-0 flex items-center justify-between bg-white px-6 py-4 border-b border-slate-200 z-10">
				<h2 class="text-lg font-semibold text-[#0f3b5e]">Nuevo Ticket</h2>
				<button type="button" onclick={onClose} class="p-1 hover:bg-slate-100 rounded-full text-slate-500" aria-label="Cerrar">
					<X size={20} />
				</button>
			</div>
			<form onsubmit={handleSubmit} class="p-6 flex flex-col gap-4">
				<div class="grid grid-cols-2 gap-3">
					<div>
						<label for="ticket-tipo" class="block text-sm font-bold text-[#0f3b5e] mb-1">Tipo</label>
						<select id="ticket-tipo" bind:value={tipo} class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200">
							{#each OPCIONES_TIPO as opt}<option value={opt.value}>{opt.label}</option>{/each}
						</select>
					</div>
					<div>
						<label for="ticket-prioridad" class="block text-sm font-bold text-[#0f3b5e] mb-1">Prioridad</label>
						<select id="ticket-prioridad" bind:value={prioridad} class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200">
							{#each OPCIONES_PRIORIDAD as opt}<option value={opt.value}>{opt.label}</option>{/each}
						</select>
					</div>
				</div>
				<div>
					<label for="ticket-modulo" class="block text-sm font-bold text-[#0f3b5e] mb-1">Módulo</label>
					<select id="ticket-modulo" bind:value={modulo} class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200">
						<option value="">Otro / No aplica</option>
						{#each opcionesModulo as opt}<option value={opt.value}>{opt.label}</option>{/each}
					</select>
				</div>
				<div>
					<label for="ticket-titulo" class="block text-sm font-bold text-[#0f3b5e] mb-1">Título <span class="text-red-500">*</span></label>
					<input
						id="ticket-titulo"
						type="text"
						bind:value={titulo}
						maxlength={150}
						placeholder="Resumen corto del problema/sugerencia"
						class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
					/>
				</div>
				<div>
					<label for="ticket-descripcion" class="block text-sm font-bold text-[#0f3b5e] mb-1">Descripción <span class="text-red-500">*</span></label>
					<textarea
						id="ticket-descripcion"
						bind:value={descripcion}
						rows="4"
						placeholder="Describe con detalle qué pasó o qué necesitas..."
						class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-200"
					></textarea>
				</div>
				{#if error}<p class="text-xs text-red-600">{error}</p>{/if}
				<div class="flex justify-end gap-2 pt-2">
					<button type="button" onclick={onClose} class="px-4 py-2 text-sm border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50">Cancelar</button>
					<button type="submit" disabled={guardando} class="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
						{guardando ? 'Enviando...' : 'Enviar ticket'}
					</button>
				</div>
			</form>
		</div>
	</div>
{/if}
