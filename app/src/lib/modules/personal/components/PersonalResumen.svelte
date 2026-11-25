<script lang="ts">
	/**
	 * Ficha del trabajador en modo lectura (botón ⓘ de Personal). Para editar se pide la contraseña de un
	 * administrador o developer (lo maneja la página con onEditar).
	 */
	import { fade, scale } from 'svelte/transition';
	import {
		TIPOS_DOCUMENTO,
		SEXOS,
		TODOS_REGIMENES as REGIMENES,
		usaCategoria,
		etiquetaCategoria,
		PERIODICIDADES_PAGO,
		etiqueta,
		etiquetaMonto,
		nombreCompleto,
		VINCULOS,
		TAMANOS_EMPRESA,
		vinculoDe,
		empleadorDe,
		getCargosHistorial,
		type CargoHistorial,
		type Personal
	} from '$lib/modules/personal/services/personal.service';
	import type { HuelleroElegible } from '$lib/modules/asistencia/services/huelleros.service';
	import { toDriveThumbnailUrl } from '$lib/shared/drivePreview';
	import { supabase } from '$lib/supabaseClient';
	import { EMPRESA_NOMBRE } from '$lib/shared/empresaConstantes';
	import HistorialAsignaciones from './HistorialAsignaciones.svelte';

	let {
		personal,
		huelleros,
		biometria = null,
		onEditar,
		onClose
	}: {
		personal: Personal | null;
		huelleros: HuelleroElegible[];
		biometria?: { huellas: number; rostros: number } | null;
		/** undefined = sin botón Editar (p. ej. trabajadores dados de baja). */
		onEditar?: (p: Personal) => void;
		onClose: () => void;
	} = $props();

	const fecha = (f: string | null) => (f ? new Date(`${f}T00:00:00`).toLocaleDateString('es-PE') : '');
	const soles = (n: number | null) => (n == null ? '' : `S/ ${Number(n).toLocaleString('es-PE', { minimumFractionDigits: 2 })}`);

	// Historial de cargos (personal_cargo_historial), del más reciente al más antiguo.
	let cargos = $state<CargoHistorial[]>([]);
	$effect(() => {
		const id = personal?.id_personal;
		cargos = [];
		if (!id) return;
		getCargosHistorial(supabase, id)
			.then((lista) => {
				if (personal?.id_personal === id) cargos = lista;
			})
			.catch(() => {});
	});
	const historialCargos = $derived(
		cargos.map((c) => `${c.cargo} · ${fecha(c.fecha_inicio)} – ${c.fecha_fin ? fecha(c.fecha_fin) : 'actual'}`).join('\n')
	);

	type Fila = [string, string | null | undefined];
	const secciones = $derived.by((): { titulo: string; icono: string; filas: Fila[] }[] => {
		const p = personal;
		if (!p) return [];
		const esCivil = usaCategoria(p.regimen);
		const susHuelleros = huelleros.filter((h) => p.personal_huellero?.some((v) => v.id_dispositivo === h.id_dispositivo));
		return [
			{
				titulo: 'Datos personales',
				icono: 'fa-user',
				filas: [
					['Documento', p.numero_documento ? `${etiqueta(TIPOS_DOCUMENTO, p.tipo_documento)} ${p.numero_documento}` : null],
					['Fecha de nacimiento', fecha(p.fecha_nacimiento)],
					['Sexo', etiqueta(SEXOS, p.sexo)],
					['Teléfono', p.telefono],
					['Dirección', p.direccion],
					['Contacto de emergencia', [p.contacto_emergencia_nombre, p.contacto_emergencia_telefono].filter(Boolean).join(' · ')]
				]
			},
			{
				titulo: 'Vínculo laboral',
				icono: 'fa-briefcase',
				filas: [
					['Tipo de vínculo', etiqueta(VINCULOS, vinculoDe(p))],
					['Empleador', [empleadorDe(p, EMPRESA_NOMBRE), p.empleador_ruc ? `RUC ${p.empleador_ruc}` : null, etiqueta(TAMANOS_EMPRESA, p.empleador_tamano)].filter(Boolean).join(' · ')],
					[
						'Obras o áreas',
						[
							p.centro_costo ? `${p.centro_costo.codigo} · ${p.centro_costo.nombre} (principal)` : null,
							...(p.personal_obra ?? []).filter((o) => o.id_centro_costo !== p.id_centro_costo && o.centro_costo).map((o) => `${o.centro_costo!.codigo} · ${o.centro_costo!.nombre}`)
						]
							.filter(Boolean)
							.join('\n')
					],
					['Superior o referente', [p.referente_nombre, p.referente_cargo].filter(Boolean).join(' · ')],
					['Régimen laboral', etiqueta(REGIMENES, p.regimen)],
					...((esCivil ? [['Categoría', etiquetaCategoria(p.categoria)]] : []) as Fila[]),
					['Fecha de ingreso', fecha(p.fecha_ingreso)],
					['Fecha de cese', p.fecha_cese ? `${fecha(p.fecha_cese)}${p.motivo_cese ? ` · ${p.motivo_cese}` : ''}` : null]
				]
			},
			{
				titulo: 'Cargo y remuneración',
				icono: 'fa-coins',
				filas: [
					['Cargo vigente', p.cargo],
					['Historial de cargos', historialCargos],
					['Periodicidad de pago', etiqueta(PERIODICIDADES_PAGO, p.periodicidad_pago)],
					[etiquetaMonto(p.periodicidad_pago), [soles(p.monto_pago), p.monto_pago_desde ? `desde ${fecha(p.monto_pago_desde)}` : null].filter(Boolean).join(' · ')]
				]
			},
			{
				titulo: 'Asistencia',
				icono: 'fa-calendar-days',
				filas: [
					['Horario', p.horario?.nombre],
					['ID en el huellero', p.pin],
					['Huelleros', susHuelleros.map((h) => `${h.nombre} (${h.lugar})`).join('\n') || 'Ningún huellero'],
					[
						'Consentimiento biométrico',
						p.consentimiento_biometrico
							? `Firmado el ${fecha(p.consentimiento_fecha)}${biometria ? ` · guardado: ${biometria.huellas} huella(s), ${biometria.rostros} rostro(s)` : ''}`
							: 'No firmado'
					]
				]
			},
			{
				titulo: 'Pagos y seguros',
				icono: 'fa-shield-halved',
				filas: [
					['Sistema de pensión', [p.sistema_pension, p.cuspp ? `CUSPP ${p.cuspp}` : null].filter(Boolean).join(' · ')],
					['Banco', p.banco],
					['Número de cuenta', p.numero_cuenta],
					['CCI', p.cci],
					['Póliza SCTR', [p.sctr_poliza, p.sctr_vencimiento ? `vence ${fecha(p.sctr_vencimiento)}` : null].filter(Boolean).join(' · ')],
					['Examen médico', p.examen_medico_vencimiento ? `vence ${fecha(p.examen_medico_vencimiento)}` : null]
				]
			}
		];
	});
</script>

{#if personal}
	<div class="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-[100] flex items-center justify-center p-4" transition:fade={{ duration: 200 }}>
		<div class="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col" transition:scale={{ duration: 250, start: 0.95 }}>
			<div class="px-6 py-4 border-b border-slate-100 flex items-center justify-between gap-3 shrink-0">
				<div class="flex items-center gap-3 min-w-0">
					<div class="w-14 h-14 rounded-2xl bg-slate-100 border border-slate-200 overflow-hidden shrink-0 flex items-center justify-center">
						{#if personal.foto_url}
							<img src={toDriveThumbnailUrl(personal.foto_url, 200)} alt="Foto del trabajador" referrerpolicy="no-referrer" class="w-full h-full object-cover" />
						{:else}
							<i class="fas fa-user text-slate-300 text-2xl"></i>
						{/if}
					</div>
					<div class="min-w-0">
						<h2 class="text-xl font-bold text-slate-800 truncate">{nombreCompleto(personal)}</h2>
						<p class="text-xs text-slate-500">Resumen de la ficha · solo lectura</p>
					</div>
				</div>
				<button onclick={onClose} aria-label="Cerrar" class="text-slate-400 hover:text-slate-600 p-2 rounded-full hover:bg-slate-100">
					<i class="fas fa-times"></i>
				</button>
			</div>
			<div class="p-6 overflow-y-auto overflow-x-hidden grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-5">
				{#each secciones as s}
					<section class="min-w-0 flex flex-col gap-2">
						<h3 class="text-sm font-bold text-slate-800 flex items-center gap-2"><i class={`fas ${s.icono} text-blue-600`}></i> {s.titulo}</h3>
						<dl class="flex flex-col gap-1.5 text-sm">
							{#each s.filas as [nombre, valor]}
								<div class="grid grid-cols-[8.5rem_minmax(0,1fr)] gap-3 border-b border-slate-100 pb-1.5">
									<dt class="text-slate-500">{nombre}</dt>
									<dd class={`text-right whitespace-pre-line [overflow-wrap:anywhere] ${valor ? 'text-slate-800' : 'text-slate-300'}`}>{valor || '—'}</dd>
								</div>
							{/each}
						</dl>
					</section>
				{/each}
				<section class="sm:col-span-2 min-w-0 flex flex-col gap-2">
					<h3 class="text-sm font-bold text-slate-800 flex items-center gap-2"><i class="fas fa-clock-rotate-left text-blue-600"></i> Historial de obras, huelleros y referentes</h3>
					<HistorialAsignaciones idPersonal={personal.id_personal} />
				</section>
			</div>
			<div class="px-6 py-4 border-t border-slate-100 flex justify-end gap-3 shrink-0">
				<button onclick={onClose} class="px-5 py-2.5 bg-white border border-slate-200 text-slate-600 rounded-xl hover:bg-slate-50 font-medium text-sm">Cerrar</button>
				{#if onEditar}
					<button onclick={() => personal && onEditar(personal)} class="px-5 py-2.5 bg-blue-600 text-white rounded-xl hover:bg-blue-700 font-medium text-sm shadow-md shadow-blue-600/20 flex items-center gap-2">
						<i class="fas fa-pen"></i> Editar
					</button>
				{/if}
			</div>
		</div>
	</div>
{/if}
