<script lang="ts">
	/**
	 * Ticket #46: "Nueva oportunidad" / editar — imagen de la clienta: Información general, Montos/fechas/condiciones,
	 * Comisión del asesor, Descripción y Notas internas, con el Resumen de la oportunidad a la derecha.
	 * (Anexos y proforma: pendiente, se adjuntan cuando la oportunidad pase a Ventas.)
	 */
	import { fade, scale } from 'svelte/transition';
	import { untrack } from 'svelte';
	import { supabase } from '$lib/supabaseClient';
	import { toast } from '$lib/stores/toast';
	import { formatCurrency } from '$lib/shared/fieldConfig';
	import { permisosState } from '$lib/stores/permisos.svelte';
	import {
		ETAPAS,
		ORIGENES,
		PRIORIDADES,
		TIPOS_COMPROBANTE,
		TIPOS_OPORTUNIDAD,
		comisionAsesor,
		etapaDe,
		guardarOportunidad,
		valorConIgv,
		valorPonderado,
		type EtapaOportunidad,
		type Oportunidad,
		type PrioridadOportunidad
	} from '../services/preventa.service';

	let {
		oportunidad = null,
		etapaInicial = 'prospecto',
		clientes,
		ejecutivos,
		onClose,
		onGuardado
	}: {
		oportunidad?: Oportunidad | null;
		etapaInicial?: EtapaOportunidad;
		clientes: { id: number; nombre: string; doc: string | null }[];
		ejecutivos: { id: number; nombre: string }[];
		onClose: () => void;
		onGuardado: () => void;
	} = $props();

	const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Lima' });
	const base = untrack(() => oportunidad);
	const yo = untrack(() => ejecutivos.find((e) => e.id === permisosState.empleadoId)?.id ?? null);
	let f = $state({
		id_cliente: base?.id_cliente ?? null,
		prospecto: base?.prospecto ?? '',
		nombre: base?.nombre ?? '',
		tipo: base?.tipo ?? TIPOS_OPORTUNIDAD[0],
		origen: base?.origen ?? '',
		id_ejecutivo: base?.id_ejecutivo ?? yo,
		etapa: (base?.etapa ?? untrack(() => etapaInicial)) as EtapaOportunidad,
		prioridad: (base?.prioridad ?? 'media') as PrioridadOportunidad,
		moneda: base?.moneda ?? 'PEN',
		valor_sin_igv: base?.valor_sin_igv ?? 0,
		con_igv: base?.con_igv ?? true,
		probabilidad: base?.probabilidad ?? etapaDe(base?.etapa ?? untrack(() => etapaInicial)).probabilidad,
		fecha_registro: base?.fecha_registro ?? hoy,
		fecha_cierre: base?.fecha_cierre ?? '',
		vigencia_propuesta: base?.vigencia_propuesta ?? '',
		tipo_comprobante: base?.tipo_comprobante ?? 'Factura',
		comision_porcentaje: base?.comision_porcentaje ?? null,
		descripcion: base?.descripcion ?? '',
		notas: base?.notas ?? '',
		motivo_perdida: base?.motivo_perdida ?? ''
	});
	let clienteNuevo = $state(!base?.id_cliente && !!base?.prospecto);
	let otra = $state(false);
	let guardando = $state(false);

	const simbolo = $derived(f.moneda === 'USD' ? 'US$' : 'S/');
	const monto = (v: number) => `${simbolo} ${formatCurrency(v).replace(/^S\/\s?/, '')}`;
	const conIgv = $derived(valorConIgv(f));
	const ponderado = $derived(valorPonderado(f));
	const comision = $derived(comisionAsesor(f));
	const ejecutivoNombre = $derived(ejecutivos.find((e) => e.id === f.id_ejecutivo)?.nombre ?? '—');

	function cambiarEtapa(e: EtapaOportunidad) {
		f.etapa = e;
		f.probabilidad = etapaDe(e).probabilidad;
	}

	async function guardar() {
		if (!f.nombre.trim()) return toast.error('Escribe el nombre del proyecto u oportunidad.');
		if (!f.id_cliente && !f.prospecto.trim()) return toast.error('Elige un cliente o escribe el nombre del prospecto.');
		if (!f.id_ejecutivo) return toast.error('Elige el ejecutivo comercial.');
		if (!(f.valor_sin_igv >= 0)) return toast.error('Revisa el valor estimado.');
		if (f.etapa === 'perdida' && !f.motivo_perdida.trim()) return toast.error('Indica el motivo de la pérdida.');
		guardando = true;
		try {
			await guardarOportunidad(
				supabase,
				{
					...f,
					id_cliente: clienteNuevo ? null : f.id_cliente,
					prospecto: clienteNuevo ? f.prospecto : null,
					origen: f.origen || null,
					fecha_cierre: f.fecha_cierre || null,
					vigencia_propuesta: f.vigencia_propuesta || null,
					descripcion: f.descripcion.trim() || null,
					notas: f.notas.trim() || null,
					motivo_perdida: f.etapa === 'perdida' ? f.motivo_perdida.trim() : null,
					usuario_registro: base?.usuario_registro ?? (permisosState.userName || null)
				},
				base?.id_oportunidad
			);
			toast.success(base ? 'Oportunidad actualizada.' : 'Oportunidad registrada.');
			onGuardado();
			if (otra && !base) {
				f.nombre = '';
				f.descripcion = '';
				f.notas = '';
				f.valor_sin_igv = 0;
			} else onClose();
		} catch (err: any) {
			toast.error(err?.message || 'No se pudo guardar la oportunidad.');
		} finally {
			guardando = false;
		}
	}

	const caja = 'w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-200';
	const etq = 'text-xs font-semibold text-[#0f3b5e]';
</script>

<div class="fixed inset-0 z-[110] bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-3" transition:fade={{ duration: 150 }}>
	<div class="bg-white rounded-2xl shadow-2xl w-full max-w-6xl max-h-[94vh] overflow-y-auto" transition:scale={{ duration: 200, start: 0.96 }}>
		<div class="sticky top-0 z-10 bg-white border-b border-slate-100 px-5 py-3 flex items-start justify-between gap-3">
			<div class="flex items-center gap-3">
				<span class="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center"><i class="fas fa-briefcase"></i></span>
				<div>
					<h2 class="text-xl font-bold text-[#0f3b5e]">{base ? `Editar oportunidad ${base.codigo ?? ''}` : 'Nueva oportunidad'}</h2>
					<p class="text-sm text-slate-500">Registra una oportunidad comercial en el embudo de pre-venta.</p>
				</div>
			</div>
			<button type="button" onclick={onClose} class="w-9 h-9 rounded-full text-slate-400 hover:bg-slate-100" aria-label="Cerrar"><i class="fas fa-times"></i></button>
		</div>

		<div class="grid grid-cols-1 lg:grid-cols-[1fr_20rem] gap-4 p-5 text-sm">
			<div class="space-y-5">
				<section class="space-y-3">
					<h3 class="font-bold text-slate-800">Información general</h3>
					<div class="grid grid-cols-1 md:grid-cols-2 gap-3">
						<div class="flex flex-col gap-1">
							<span class={etq}>Cliente / Prospecto *</span>
							{#if clienteNuevo}
								<input class={caja} bind:value={f.prospecto} placeholder="Nombre del prospecto (aún no es cliente)" />
							{:else}
								<select class={caja} bind:value={f.id_cliente}>
									<option value={null}>Elige un cliente…</option>
									{#each clientes as c (c.id)}<option value={c.id}>{c.nombre}{c.doc ? ` · ${c.doc}` : ''}</option>{/each}
								</select>
							{/if}
							<button type="button" onclick={() => (clienteNuevo = !clienteNuevo)} class="self-start text-xs text-blue-600 hover:underline">{clienteNuevo ? 'Elegir un cliente registrado' : '+ Es un prospecto nuevo'}</button>
						</div>
						<label class="flex flex-col gap-1"><span class={etq}>Ejecutivo comercial *</span>
							<select class={caja} bind:value={f.id_ejecutivo}><option value={null}>Elige…</option>{#each ejecutivos as e (e.id)}<option value={e.id}>{e.nombre}</option>{/each}</select>
						</label>
						<label class="flex flex-col gap-1"><span class={etq}>Proyecto / Oportunidad *</span><input class={caja} bind:value={f.nombre} maxlength="150" placeholder="Ej. Edificio Multifamiliar - Miraflores" /></label>
						<label class="flex flex-col gap-1"><span class={etq}>Fecha de registro *</span><input type="date" class={caja} bind:value={f.fecha_registro} /></label>
						<label class="flex flex-col gap-1"><span class={etq}>Tipo de oportunidad *</span><select class={caja} bind:value={f.tipo}>{#each TIPOS_OPORTUNIDAD as t (t)}<option value={t}>{t}</option>{/each}</select></label>
						<label class="flex flex-col gap-1"><span class={etq}>Prioridad</span>
							<select class={caja} bind:value={f.prioridad}>{#each Object.entries(PRIORIDADES) as [k, p] (k)}<option value={k}>{p.label}</option>{/each}</select>
						</label>
						<label class="flex flex-col gap-1"><span class={etq}>Origen del lead</span><select class={caja} bind:value={f.origen}><option value="">—</option>{#each ORIGENES as o (o)}<option value={o}>{o}</option>{/each}</select></label>
						<label class="flex flex-col gap-1"><span class={etq}>Etapa</span>
							<select class={caja} value={f.etapa} onchange={(e) => cambiarEtapa((e.currentTarget as HTMLSelectElement).value as EtapaOportunidad)}>{#each ETAPAS as e (e.value)}<option value={e.value}>{e.label}</option>{/each}</select>
						</label>
						{#if f.etapa === 'perdida'}
							<label class="flex flex-col gap-1 md:col-span-2"><span class={etq}>Motivo de la pérdida *</span><input class={caja} bind:value={f.motivo_perdida} placeholder="Ej. Precio, competencia, sin respuesta…" /></label>
						{/if}
					</div>
				</section>

				<section class="space-y-3">
					<h3 class="font-bold text-slate-800">Montos, fechas y condiciones</h3>
					<div class="grid grid-cols-2 md:grid-cols-4 gap-3">
						<label class="flex flex-col gap-1"><span class={etq}>Moneda *</span><select class={caja} bind:value={f.moneda}><option value="PEN">Soles (PEN)</option><option value="USD">Dólares (USD)</option></select></label>
						<label class="flex flex-col gap-1"><span class={etq}>Valor estimado (sin IGV) *</span><input type="number" min="0" step="0.01" class={`${caja} text-right`} value={f.valor_sin_igv} oninput={(e) => (f.valor_sin_igv = Number((e.currentTarget as HTMLInputElement).value) || 0)} /></label>
						<label class="flex flex-col gap-1"><span class={etq}>IGV *</span><select class={caja} bind:value={f.con_igv}><option value={true}>Con IGV (18%)</option><option value={false}>Sin IGV</option></select></label>
						<label class="flex flex-col gap-1"><span class={etq}>Valor estimado (con IGV)</span><input class={`${caja} text-right bg-slate-50`} value={monto(conIgv)} disabled /></label>
						<label class="flex flex-col gap-1"><span class={etq}>Tipo de comprobante *</span><select class={caja} bind:value={f.tipo_comprobante}>{#each TIPOS_COMPROBANTE as t (t)}<option value={t}>{t}</option>{/each}</select></label>
						<label class="flex flex-col gap-1"><span class={etq}>Probabilidad de cierre *</span><select class={caja} bind:value={f.probabilidad}>{#each [0, 10, 20, 30, 40, 50, 60, 70, 75, 80, 85, 90, 95, 100] as p (p)}<option value={p}>{p}%</option>{/each}</select></label>
						<label class="flex flex-col gap-1"><span class={etq}>Fecha estimada de cierre *</span><input type="date" class={caja} bind:value={f.fecha_cierre} /></label>
						<label class="flex flex-col gap-1"><span class={etq}>Vigencia de la propuesta</span><input type="date" class={caja} bind:value={f.vigencia_propuesta} /></label>
					</div>
					<div class="rounded-xl border border-blue-300 p-3 grid grid-cols-1 md:grid-cols-3 gap-3">
						<p class="md:col-span-3 font-semibold text-slate-800">Comisión del asesor</p>
						<label class="flex flex-col gap-1"><span class={etq}>Porcentaje de comisión (%)</span><input type="number" min="0" max="100" step="0.01" class={`${caja} text-right`} value={f.comision_porcentaje ?? ''} oninput={(e) => { const v = (e.currentTarget as HTMLInputElement).value; f.comision_porcentaje = v === '' ? null : Number(v); }} /></label>
						<label class="flex flex-col gap-1"><span class={etq}>Monto base para comisión</span><input class={`${caja} bg-slate-50`} value="Valor (sin IGV)" disabled /></label>
						<label class="flex flex-col gap-1"><span class={etq}>Monto a comisionar</span><input class={`${caja} text-right bg-slate-50`} value={monto(comision)} disabled /></label>
						<p class="md:col-span-3 text-xs text-blue-600"><i class="fas fa-circle-info"></i> El monto a comisionar se calcula sobre el valor sin IGV y el porcentaje de comisión.</p>
					</div>
					<label class="flex flex-col gap-1"><span class={etq}>Descripción de la oportunidad</span><textarea rows="3" class={caja} bind:value={f.descripcion} placeholder="Ej. Edificio multifamiliar de 8 pisos con 16 departamentos…"></textarea></label>
				</section>
			</div>

			<aside class="space-y-4">
				<div class="rounded-xl border border-slate-200 p-4 space-y-2">
					<h3 class="font-bold text-slate-800"><i class="fas fa-clipboard-list text-blue-600 mr-1"></i> Resumen de la oportunidad</h3>
					<div class="flex justify-between"><span class="text-slate-500">Etapa</span><span class={`px-2 rounded-md border text-xs font-semibold ${etapaDe(f.etapa).chip}`}>{etapaDe(f.etapa).label}</span></div>
					<div class="flex justify-between"><span class="text-slate-500">Valor estimado (con IGV)</span><b>{monto(conIgv)}</b></div>
					<div class="flex justify-between"><span class="text-slate-500">Probabilidad</span><span>{f.probabilidad}%</span></div>
					<div class="flex justify-between" title="Valor estimado × probabilidad"><span class="text-slate-500">Valor ponderado</span><b>{monto(ponderado)}</b></div>
					<div class="flex justify-between"><span class="text-slate-500">Cierre estimado</span><span>{f.fecha_cierre ? f.fecha_cierre.split('-').reverse().join('/') : '—'}</span></div>
					<div class="flex justify-between gap-2"><span class="text-slate-500">Ejecutivo</span><span class="text-right">{ejecutivoNombre}</span></div>
					<div class="flex justify-between"><span class="text-slate-500">Prioridad</span><span class="flex items-center gap-1"><span class={`w-2 h-2 rounded-full ${PRIORIDADES[f.prioridad].punto}`}></span>{PRIORIDADES[f.prioridad].label}</span></div>
				</div>
				<div class="rounded-xl border border-slate-200 p-4 space-y-2">
					<h3 class="font-bold text-slate-800"><i class="fas fa-note-sticky text-amber-500 mr-1"></i> Notas internas</h3>
					<textarea rows="4" maxlength="900" class={caja} bind:value={f.notas} placeholder="Escribe una nota interna sobre esta oportunidad…"></textarea>
					<p class="text-right text-[11px] text-slate-400">{f.notas.length}/900</p>
				</div>
			</aside>
		</div>

		<div class="sticky bottom-0 bg-white border-t border-slate-100 px-5 py-3 flex flex-wrap items-center justify-between gap-2">
			{#if !base}<label class="flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" bind:checked={otra} /> Crear otra oportunidad al guardar</label>{:else}<span></span>{/if}
			<div class="flex gap-2">
				<button type="button" onclick={onClose} class="px-5 py-2 rounded-xl border border-slate-200 font-semibold text-slate-700 hover:bg-slate-50">Cancelar</button>
				<button type="button" disabled={guardando} onclick={guardar} class="px-5 py-2 rounded-xl bg-blue-600 text-white font-semibold hover:bg-blue-700 disabled:opacity-50">{guardando ? 'Guardando…' : 'Guardar'}</button>
			</div>
		</div>
	</div>
</div>
