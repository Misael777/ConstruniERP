<script lang="ts">
	import SelectConSaldo from '$lib/shared/components/SelectConSaldo.svelte';
	// Modal "Nuevo Ticket" — a pedido explícito del usuario: reemplaza el reporte de reclamos/
	// sugerencias/incidencias/requerimientos por WhatsApp. Cualquier usuario con el permiso
	// 'ver_soporte_tickets' (otorgado a todos los roles, ver ticket_module_migration.sql) puede
	// reportar. El selector de "Módulo" reusa MODULE_REGISTRY (modules.ts) para no mantener un
	// catálogo aparte — incluye "Otro / No aplica" para reclamos que no son de una pantalla puntual
	// (ej. "la app se cierra sola").
	import { X, ImagePlus, Trash2, Loader2 } from '@lucide/svelte';
	import { supabase } from '$lib/supabaseClient';
	import { toast } from '$lib/stores/toast';
	import { MODULE_REGISTRY } from '$lib/config/modules';
	import { uploadProjectDocument } from '$lib/shared/uploadProjectDocument';
	import { crearTicket, type TipoTicket, type PrioridadTicket, type PlataformaTicket } from '../services/tickets.service';
	import { getInfoVersionApp } from '$lib/shared/appVersion';

	const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB, mismo tope que el resto de adjuntos del ERP (ver AnuncioModal.svelte)

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
	// Ticket #63: ¿el problema es de la app del celular o de la web/escritorio? Por defecto, la plataforma desde
	// donde se está reportando (se puede cambiar, ej. si se reporta desde la PC algo visto en el celular).
	let plataforma = $state<PlataformaTicket>('web');
	async function plataformaPorDefecto(): Promise<PlataformaTicket> {
		const { plataforma: p } = await getInfoVersionApp();
		return p === 'android' || p === 'ios' ? 'app' : 'web';
	}
	$effect(() => {
		if (open) plataformaPorDefecto().then((p) => (plataforma = p));
	});
	let guardando = $state(false);
	let error = $state('');
	let imagenFile = $state<File | null>(null);
	let imagenPreviewUrl = $state<string | null>(null);
	let subiendoImagen = $state(false);

	function resetForm() {
		tipo = 'incidencia';
		modulo = '';
		titulo = '';
		descripcion = '';
		prioridad = 'media';
		error = '';
		imagenFile = null;
		if (imagenPreviewUrl) URL.revokeObjectURL(imagenPreviewUrl);
		imagenPreviewUrl = null;
	}

	function onImagenChange(e: Event) {
		const file = (e.target as HTMLInputElement).files?.[0];
		(e.target as HTMLInputElement).value = '';
		if (!file) return;
		if (file.size > MAX_FILE_SIZE) {
			toast.error('La imagen supera el máximo de 5MB.');
			return;
		}
		imagenFile = file;
		if (imagenPreviewUrl) URL.revokeObjectURL(imagenPreviewUrl);
		imagenPreviewUrl = URL.createObjectURL(file);
	}

	function quitarImagen() {
		imagenFile = null;
		if (imagenPreviewUrl) URL.revokeObjectURL(imagenPreviewUrl);
		imagenPreviewUrl = null;
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
			let imagenUrl: string | null = null;
			if (imagenFile) {
				subiendoImagen = true;
				const { url } = await uploadProjectDocument(imagenFile, { type: 'ticket' });
				imagenUrl = url;
				subiendoImagen = false;
			}
			const result = await crearTicket(supabase, {
				tipo,
				modulo: modulo || null,
				titulo: titulo.trim(),
				descripcion: descripcion.trim(),
				prioridad,
				imagenUrl,
				plataforma
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
			subiendoImagen = false;
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
						<SelectConSaldo
							id="ticket-tipo"
							value={tipo}
							options={[...OPCIONES_TIPO.map((opt) => ({ value: String(opt.value), label: `${opt.label}` }))]}
							onchange={(v) => (tipo = v as typeof tipo)}
						/>
					</div>
					<div>
						<label for="ticket-prioridad" class="block text-sm font-bold text-[#0f3b5e] mb-1">Prioridad</label>
						<SelectConSaldo
							id="ticket-prioridad"
							value={prioridad}
							options={[...OPCIONES_PRIORIDAD.map((opt) => ({ value: String(opt.value), label: `${opt.label}` }))]}
							onchange={(v) => (prioridad = v as typeof prioridad)}
						/>
					</div>
				</div>
				<div>
					<span class="block text-sm font-bold text-[#0f3b5e] mb-1">¿Dónde ocurre?</span>
					<div class="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Dónde ocurre">
						{#each [{ v: 'web', l: 'Web / Escritorio' }, { v: 'app', l: 'App del celular' }] as op (op.v)}
							<button
								type="button"
								role="radio"
								aria-checked={plataforma === op.v}
								onclick={() => (plataforma = op.v as PlataformaTicket)}
								class={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${plataforma === op.v ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-slate-300 text-slate-600 hover:bg-slate-50'}`}
							>{op.l}</button>
						{/each}
					</div>
				</div>
				<div>
					<label for="ticket-modulo" class="block text-sm font-bold text-[#0f3b5e] mb-1">Módulo</label>
					<SelectConSaldo
						id="ticket-modulo"
						value={modulo}
						options={[{ value: '', label: 'Otro / No aplica' }, ...opcionesModulo.map((opt) => ({ value: String(opt.value), label: `${opt.label}` }))]}
						placeholder="Otro / No aplica"
						onchange={(v) => (modulo = v)}
					/>
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
				<div>
					<span class="block text-sm font-bold text-[#0f3b5e] mb-1">Imagen (opcional)</span>
					{#if imagenPreviewUrl}
						<div class="relative w-full h-32 rounded-lg border border-slate-200 overflow-hidden group">
							<img src={imagenPreviewUrl} alt="Vista previa del adjunto" class="w-full h-full object-cover" />
							<button
								type="button"
								onclick={quitarImagen}
								class="absolute top-2 right-2 p-1.5 rounded-full bg-white/90 text-red-600 hover:bg-white shadow"
								aria-label="Quitar imagen"
								title="Quitar imagen"
							>
								<Trash2 size={14} />
							</button>
						</div>
					{:else}
						<label
							for="ticket-imagen"
							class="flex flex-col items-center justify-center gap-1.5 w-full h-20 rounded-lg border-2 border-dashed border-slate-300 text-slate-400 cursor-pointer hover:border-blue-300 hover:text-blue-500"
						>
							<ImagePlus size={18} />
							<span class="text-xs">Adjuntar captura o foto</span>
						</label>
						<input id="ticket-imagen" type="file" accept="image/*" class="hidden" onchange={onImagenChange} />
					{/if}
				</div>
				{#if error}<p class="text-xs text-red-600">{error}</p>{/if}
				<div class="flex justify-end gap-2 pt-2">
					<button type="button" onclick={onClose} class="px-4 py-2 text-sm border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50">Cancelar</button>
					<button type="submit" disabled={guardando} class="flex items-center gap-2 px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
						{#if guardando}<Loader2 size={16} class="animate-spin" />{/if}
						{subiendoImagen ? 'Subiendo imagen...' : guardando ? 'Enviando...' : 'Enviar ticket'}
					</button>
				</div>
			</form>
		</div>
	</div>
{/if}
