<script lang="ts">
	// Detalle de un ticket: estado, hilo de comentarios ("el foro" pedido explícitamente por el
	// usuario) y, si ya tiene un release asignado, el banner "Incluido en la vX.Y.Z" con el botón de
	// actualizar. Compartido entre "Mis Tickets" (solo comenta) y "Panel Developer" (además puede
	// cambiar el estado) — `permitirAcciones` decide si se muestran los botones de transición.
	import { X, Send, ShieldCheck, ShieldOff, Loader2, PlayCircle, CheckCircle2, Paperclip, Trash2 } from '@lucide/svelte';
	import { supabase } from '$lib/supabaseClient';
	import { toast } from '$lib/stores/toast';
	import { isAdmin, permisosState } from '$lib/stores/permisos.svelte';
	import { uploadProjectDocument } from '$lib/shared/uploadProjectDocument';
	import {
		getTicket,
		getComentarios,
		agregarComentario,
		marcarEnProgreso,
		marcarResuelto,
		aprobarTicket,
		rechazarTicket,
		type Ticket,
		type TicketComentario
	} from '../services/tickets.service';
	import { getReleaseDeTicket, type AppRelease } from '../services/releases.service';
	import BotonActualizar from '$lib/shared/components/BotonActualizar.svelte';
	import DocumentPreviewModal from '$lib/shared/components/DocumentPreviewModal.svelte';

	const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB, mismo tope que el resto de adjuntos del ERP

	let {
		open = false,
		idTicket = null,
		permitirAcciones = false,
		onClose = () => {},
		onChanged = () => {}
	}: {
		open?: boolean;
		idTicket?: number | null;
		/** true en el Panel Developer (developer/admin) — muestra los botones de En progreso/Resuelto
		 * y, si isAdmin(), Aprobar/Rechazar. En "Mis Tickets" queda en false: el reportante solo
		 * comenta y lee el estado, nunca cambia la transición. */
		permitirAcciones?: boolean;
		onClose?: () => void;
		onChanged?: () => void;
	} = $props();

	let ticket = $state<Ticket | null>(null);
	let comentarios = $state<TicketComentario[]>([]);
	let release = $state<AppRelease | null>(null);
	let cargando = $state(false);
	let nuevoMensaje = $state('');
	let enviandoComentario = $state(false);
	let procesando = $state(false);
	let mostrarMotivoRechazo = $state(false);
	let motivoRechazo = $state('');
	let comentarioImagenFile = $state<File | null>(null);
	let comentarioImagenPreviewUrl = $state<string | null>(null);
	let previewImagenUrl = $state<string | null>(null);

	async function cargar() {
		if (!idTicket) return;
		cargando = true;
		try {
			const [t, c] = await Promise.all([getTicket(supabase, idTicket), getComentarios(supabase, idTicket)]);
			ticket = t;
			comentarios = c;
			release = t?.id_release ? await getReleaseDeTicket(supabase, t.id_release) : null;
		} catch (err: any) {
			toast.error(err?.message ?? 'No se pudo cargar el ticket');
		} finally {
			cargando = false;
		}
	}

	$effect(() => {
		if (open && idTicket) {
			mostrarMotivoRechazo = false;
			motivoRechazo = '';
			cargar();
		}
	});

	function onComentarioImagenChange(e: Event) {
		const file = (e.target as HTMLInputElement).files?.[0];
		(e.target as HTMLInputElement).value = '';
		if (!file) return;
		if (file.size > MAX_FILE_SIZE) {
			toast.error('La imagen supera el máximo de 5MB.');
			return;
		}
		comentarioImagenFile = file;
		if (comentarioImagenPreviewUrl) URL.revokeObjectURL(comentarioImagenPreviewUrl);
		comentarioImagenPreviewUrl = URL.createObjectURL(file);
	}

	function quitarComentarioImagen() {
		comentarioImagenFile = null;
		if (comentarioImagenPreviewUrl) URL.revokeObjectURL(comentarioImagenPreviewUrl);
		comentarioImagenPreviewUrl = null;
	}

	async function handleComentar(e: Event) {
		e.preventDefault();
		if (!idTicket || (!nuevoMensaje.trim() && !comentarioImagenFile)) return;
		enviandoComentario = true;
		try {
			let imagenUrl: string | null = null;
			if (comentarioImagenFile) {
				const { url } = await uploadProjectDocument(comentarioImagenFile, { type: 'ticket' });
				imagenUrl = url;
			}
			const result = await agregarComentario(supabase, idTicket, nuevoMensaje || '(imagen adjunta)', imagenUrl);
			if (result.success) {
				nuevoMensaje = '';
				quitarComentarioImagen();
				await cargar();
			} else {
				toast.error(result.message || 'No se pudo enviar el comentario.');
			}
		} catch (err: any) {
			toast.error(err?.message ?? 'No se pudo subir la imagen del comentario.');
		} finally {
			enviandoComentario = false;
		}
	}

	async function ejecutar(accion: () => Promise<{ success: boolean; message?: string }>) {
		procesando = true;
		try {
			const result = await accion();
			if (result.success) {
				await cargar();
				onChanged();
			} else {
				toast.error(result.message || 'No se pudo completar la acción.');
			}
		} catch (err: any) {
			toast.error(err?.message ?? 'Ocurrió un error inesperado');
		} finally {
			procesando = false;
		}
	}

	const ETIQUETA_ESTADO: Record<string, string> = {
		abierto: 'Abierto',
		en_progreso: 'En progreso',
		resuelto: 'Resuelto — esperando aprobación',
		aprobado: 'Aprobado — esperando release',
		rechazado: 'Rechazado',
		cerrado: 'Cerrado'
	};
	const CLASE_ESTADO: Record<string, string> = {
		abierto: 'bg-amber-50 text-amber-700 border-amber-200',
		en_progreso: 'bg-blue-50 text-blue-700 border-blue-200',
		resuelto: 'bg-violet-50 text-violet-700 border-violet-200',
		aprobado: 'bg-emerald-50 text-emerald-700 border-emerald-200',
		rechazado: 'bg-rose-50 text-rose-700 border-rose-200',
		cerrado: 'bg-slate-100 text-slate-600 border-slate-200'
	};

	function fmt(value: string | null) {
		if (!value) return '—';
		const d = new Date(value);
		return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('es-PE', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
	}
</script>

{#if open}
	<div class="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
		<div class="bg-white rounded-2xl shadow-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto flex flex-col">
			<div class="sticky top-0 flex items-center justify-between bg-white px-6 py-4 border-b border-slate-200 z-10">
				<h2 class="text-lg font-semibold text-[#0f3b5e] truncate pr-4">{ticket?.titulo ?? 'Ticket'}</h2>
				<button type="button" onclick={onClose} class="p-1 hover:bg-slate-100 rounded-full text-slate-500 shrink-0" aria-label="Cerrar">
					<X size={20} />
				</button>
			</div>

			{#if cargando && !ticket}
				<div class="p-8 text-center text-slate-400 text-sm"><Loader2 size={20} class="animate-spin mx-auto mb-2" /> Cargando...</div>
			{:else if ticket}
				<div class="p-6 flex flex-col gap-4">
					<div class="flex items-center gap-2 flex-wrap">
						<span class={`inline-block px-2 py-0.5 rounded-full text-[11px] font-medium border ${CLASE_ESTADO[ticket.estado] ?? 'bg-slate-100 text-slate-600 border-slate-200'}`}>
							{ETIQUETA_ESTADO[ticket.estado] ?? ticket.estado}
						</span>
						<span class="text-[11px] text-slate-400">Reportado por {ticket.creado_por ?? 'Usuario'} · {fmt(ticket.created_at)}</span>
					</div>
					<p class="text-sm text-slate-700 whitespace-pre-wrap">{ticket.descripcion}</p>
					{#if ticket.imagen_url}
						<button type="button" onclick={() => (previewImagenUrl = ticket!.imagen_url)} class="block w-32 h-24 rounded-lg border border-slate-200 overflow-hidden hover:border-blue-300">
							<img src={ticket.imagen_url} alt="Adjunto del ticket" class="w-full h-full object-cover" />
						</button>
					{/if}

					{#if release}
						<div class="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-sm text-emerald-800 flex items-center justify-between gap-3 flex-wrap">
							<span class="flex items-center gap-1.5 font-medium"><ShieldCheck size={16} class="shrink-0" /> Incluido en la versión {release.version}</span>
							<BotonActualizar {release} />
						</div>
					{/if}

					{#if ticket.motivo_rechazo}
						<p class="text-xs text-rose-600 bg-rose-50 border border-rose-200 rounded-lg p-2">Motivo del rechazo: {ticket.motivo_rechazo}</p>
					{/if}

					{#if permitirAcciones}
						<div class="flex flex-wrap gap-2 border-t border-slate-100 pt-3">
							{#if ticket.estado === 'abierto'}
								<button type="button" disabled={procesando} onclick={() => ejecutar(() => marcarEnProgreso(supabase, ticket!.id_ticket))} class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-blue-300 text-blue-600 text-xs font-semibold hover:bg-blue-50 disabled:opacity-50">
									<PlayCircle size={14} /> Marcar en progreso
								</button>
							{/if}
							{#if ticket.estado === 'abierto' || ticket.estado === 'en_progreso'}
								<button type="button" disabled={procesando} onclick={() => ejecutar(() => marcarResuelto(supabase, ticket!.id_ticket))} class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-violet-300 text-violet-600 text-xs font-semibold hover:bg-violet-50 disabled:opacity-50">
									<CheckCircle2 size={14} /> Marcar resuelto
								</button>
							{/if}
							{#if ticket.estado === 'resuelto' && isAdmin()}
								<button type="button" disabled={procesando} onclick={() => ejecutar(() => aprobarTicket(supabase, ticket!.id_ticket, permisosState.userName || null))} class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 disabled:opacity-50">
									<ShieldCheck size={14} /> Aprobar
								</button>
								{#if !mostrarMotivoRechazo}
									<button type="button" onclick={() => (mostrarMotivoRechazo = true)} class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-rose-300 text-rose-600 text-xs font-semibold hover:bg-rose-50">
										<ShieldOff size={14} /> Rechazar
									</button>
								{/if}
							{/if}
						</div>
						{#if mostrarMotivoRechazo}
							<div class="flex flex-col gap-2">
								<textarea bind:value={motivoRechazo} rows="2" placeholder="Motivo del rechazo..." class="w-full rounded-lg border border-rose-300 px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-rose-200"></textarea>
								<div class="flex gap-2">
									<button
										type="button"
										disabled={procesando || !motivoRechazo.trim()}
										onclick={() => ejecutar(() => rechazarTicket(supabase, ticket!.id_ticket, motivoRechazo.trim(), permisosState.userName || null))}
										class="px-3 py-1.5 rounded-lg bg-rose-600 text-white text-xs font-semibold hover:bg-rose-700 disabled:opacity-50"
									>
										Confirmar rechazo
									</button>
									<button type="button" onclick={() => (mostrarMotivoRechazo = false)} class="px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 text-xs font-semibold hover:bg-slate-50">Cancelar</button>
								</div>
							</div>
						{/if}
					{/if}

					<div class="border-t border-slate-100 pt-3">
						<h3 class="text-sm font-bold text-[#0f3b5e] mb-2">Comentarios</h3>
						<div class="flex flex-col gap-2 max-h-56 overflow-y-auto mb-3">
							{#if comentarios.length === 0}
								<p class="text-xs text-slate-400 text-center py-3">Sin comentarios todavía.</p>
							{:else}
								{#each comentarios as c (c.id_comentario)}
									<div class="bg-slate-50 rounded-lg p-2.5">
										<div class="flex items-center justify-between gap-2 mb-1">
											<span class="text-xs font-semibold text-slate-700">{c.autor ?? 'Usuario'}</span>
											<span class="text-[10px] text-slate-400">{fmt(c.created_at)}</span>
										</div>
										<p class="text-xs text-slate-600 whitespace-pre-wrap">{c.mensaje}</p>
										{#if c.imagen_url}
											<button type="button" onclick={() => (previewImagenUrl = c.imagen_url)} class="block w-20 h-16 mt-1.5 rounded-lg border border-slate-200 overflow-hidden hover:border-blue-300">
												<img src={c.imagen_url} alt="Adjunto del comentario" class="w-full h-full object-cover" />
											</button>
										{/if}
									</div>
								{/each}
							{/if}
						</div>
						{#if comentarioImagenPreviewUrl}
							<div class="relative w-20 h-16 mb-2 rounded-lg border border-slate-200 overflow-hidden group">
								<img src={comentarioImagenPreviewUrl} alt="Vista previa del adjunto" class="w-full h-full object-cover" />
								<button
									type="button"
									onclick={quitarComentarioImagen}
									class="absolute top-0.5 right-0.5 p-1 rounded-full bg-white/90 text-red-600 hover:bg-white shadow"
									aria-label="Quitar imagen"
									title="Quitar imagen"
								>
									<Trash2 size={12} />
								</button>
							</div>
						{/if}
						<form onsubmit={handleComentar} class="flex gap-2">
							<input
								type="text"
								bind:value={nuevoMensaje}
								placeholder="Escribe un comentario..."
								class="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
							/>
							<label for="comentario-imagen" class="flex items-center justify-center px-2.5 rounded-lg border border-slate-300 text-slate-500 hover:bg-slate-50 cursor-pointer" title="Adjuntar imagen">
								<Paperclip size={16} />
							</label>
							<input id="comentario-imagen" type="file" accept="image/*" class="hidden" onchange={onComentarioImagenChange} />
							<button type="submit" disabled={enviandoComentario || (!nuevoMensaje.trim() && !comentarioImagenFile)} class="px-3 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
								{#if enviandoComentario}<Loader2 size={16} class="animate-spin" />{:else}<Send size={16} />{/if}
							</button>
						</form>
					</div>
				</div>
			{/if}
		</div>
	</div>
{/if}

<DocumentPreviewModal open={!!previewImagenUrl} url={previewImagenUrl} title="Adjunto" onClose={() => (previewImagenUrl = null)} />
