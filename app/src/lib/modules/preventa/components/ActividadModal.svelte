<script lang="ts">
	/**
	 * Ticket #46: "Agendar" — llamada, videollamada (con enlace de Meet), visita en campo u oficina, envío de proforma,
	 * contrato o brochure. Cada actividad va ligada a una oportunidad y aparece en "Actividades próximas" y el calendario.
	 */
	import { fade, scale } from 'svelte/transition';
	import { untrack } from 'svelte';
	import { supabase } from '$lib/supabaseClient';
	import { toast } from '$lib/stores/toast';
	import { permisosState } from '$lib/stores/permisos.svelte';
	import { TIPOS_ACTIVIDAD, guardarActividad, tipoActividadDe, type ActividadOportunidad, type Oportunidad, type TipoActividad } from '../services/preventa.service';

	let {
		actividad = null,
		tipo = 'llamada',
		idOportunidad = null,
		fecha = null,
		oportunidades,
		onClose,
		onGuardado
	}: {
		actividad?: ActividadOportunidad | null;
		tipo?: TipoActividad;
		idOportunidad?: number | null;
		fecha?: string | null;
		oportunidades: Oportunidad[];
		onClose: () => void;
		onGuardado: () => void;
	} = $props();

	const base = untrack(() => actividad);
	const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Lima' });
	const local = (iso: string) => {
		const d = new Date(iso);
		const p = (n: number) => String(n).padStart(2, '0');
		return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
	};
	let f = $state({
		tipo: (base?.tipo ?? untrack(() => tipo)) as TipoActividad,
		id_oportunidad: base?.id_oportunidad ?? untrack(() => idOportunidad),
		titulo: base?.titulo ?? '',
		fecha_hora: base ? local(base.fecha_hora) : `${untrack(() => fecha) ?? hoy}T10:00`,
		enlace: base?.enlace ?? '',
		lugar: base?.lugar ?? '',
		notas: base?.notas ?? '',
		responsable: base?.responsable ?? (permisosState.userName || '')
	});
	let guardando = $state(false);
	const op = $derived(oportunidades.find((o) => o.id_oportunidad === f.id_oportunidad) ?? null);
	const tituloSugerido = $derived(`${tipoActividadDe(f.tipo).label}${op ? ` con ${op.cliente?.nombre ?? op.prospecto ?? op.nombre}` : ''}`);

	async function guardar() {
		if (!f.id_oportunidad) return toast.error('Elige la oportunidad.');
		if (!f.fecha_hora) return toast.error('Elige la fecha y hora.');
		if (f.tipo === 'videollamada' && f.enlace && !/^https?:\/\//i.test(f.enlace.trim())) return toast.error('El enlace de la videollamada debe empezar con https://');
		guardando = true;
		try {
			await guardarActividad(
				supabase,
				{
					id_oportunidad: f.id_oportunidad,
					tipo: f.tipo,
					titulo: f.titulo.trim() || tituloSugerido,
					fecha_hora: new Date(f.fecha_hora).toISOString(),
					enlace: f.enlace.trim() || null,
					lugar: f.lugar.trim() || null,
					notas: f.notas.trim() || null,
					responsable: f.responsable.trim() || null,
					completada: base?.completada ?? false,
					usuario_registro: base?.usuario_registro ?? (permisosState.userName || null)
				},
				base?.id_actividad
			);
			toast.success(base ? 'Actividad actualizada.' : 'Actividad agendada.');
			onGuardado();
			onClose();
		} catch (err: any) {
			toast.error(err?.message || 'No se pudo guardar la actividad.');
		} finally {
			guardando = false;
		}
	}
	const caja = 'w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-200';
	const etq = 'text-xs font-semibold text-[#0f3b5e]';
</script>

<div class="fixed inset-0 z-[110] bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-3" transition:fade={{ duration: 150 }}>
	<div class="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[94vh] overflow-y-auto" transition:scale={{ duration: 200, start: 0.96 }}>
		<div class="flex items-center justify-between border-b border-slate-100 px-5 py-3">
			<h2 class="text-lg font-bold text-[#0f3b5e]"><i class={`fas ${tipoActividadDe(f.tipo).icono} text-blue-600 mr-2`}></i>{base ? 'Editar actividad' : `Agendar ${tipoActividadDe(f.tipo).label.toLowerCase()}`}</h2>
			<button type="button" onclick={onClose} class="w-9 h-9 rounded-full text-slate-400 hover:bg-slate-100" aria-label="Cerrar"><i class="fas fa-times"></i></button>
		</div>
		<div class="p-5 space-y-3 text-sm">
			<label class="flex flex-col gap-1"><span class={etq}>Tipo *</span><select class={caja} bind:value={f.tipo}>{#each TIPOS_ACTIVIDAD as t (t.value)}<option value={t.value}>{t.label}</option>{/each}</select></label>
			<label class="flex flex-col gap-1"><span class={etq}>Oportunidad *</span>
				<select class={caja} bind:value={f.id_oportunidad}><option value={null}>Elige…</option>{#each oportunidades as o (o.id_oportunidad)}<option value={o.id_oportunidad}>{o.nombre} · {o.cliente?.nombre ?? o.prospecto ?? ''}</option>{/each}</select>
			</label>
			<label class="flex flex-col gap-1"><span class={etq}>Título</span><input class={caja} bind:value={f.titulo} placeholder={tituloSugerido} /></label>
			<div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
				<label class="flex flex-col gap-1"><span class={etq}>Fecha y hora *</span><input type="datetime-local" class={caja} bind:value={f.fecha_hora} /></label>
				<label class="flex flex-col gap-1"><span class={etq}>Responsable</span><input class={caja} bind:value={f.responsable} /></label>
			</div>
			{#if f.tipo === 'videollamada'}
				<label class="flex flex-col gap-1"><span class={etq}>Enlace de Meet</span><input class={caja} bind:value={f.enlace} placeholder="https://meet.google.com/…" />
					<a href="https://meet.google.com/new" target="_blank" rel="noopener noreferrer" class="self-start text-xs text-blue-600 hover:underline"><i class="fas fa-video"></i> Crear una reunión en Meet y pegar el enlace</a>
				</label>
			{/if}
			{#if f.tipo === 'visita_campo' || f.tipo === 'visita_oficina' || f.tipo === 'reunion'}
				<label class="flex flex-col gap-1"><span class={etq}>Lugar</span><input class={caja} bind:value={f.lugar} placeholder={f.tipo === 'visita_oficina' ? 'Oficina' : 'Dirección de la obra'} /></label>
			{/if}
			<label class="flex flex-col gap-1"><span class={etq}>Notas</span><textarea rows="3" class={caja} bind:value={f.notas}></textarea></label>
		</div>
		<div class="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">
			<button type="button" onclick={onClose} class="px-5 py-2 rounded-xl border border-slate-200 font-semibold text-slate-700 hover:bg-slate-50">Cancelar</button>
			<button type="button" disabled={guardando} onclick={guardar} class="px-5 py-2 rounded-xl bg-blue-600 text-white font-semibold hover:bg-blue-700 disabled:opacity-50">{guardando ? 'Guardando…' : 'Agendar'}</button>
		</div>
	</div>
</div>
