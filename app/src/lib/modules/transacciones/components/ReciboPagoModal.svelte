<script lang="ts">
	/**
	 * Popup "Autogenerar Boucher de Transferencia" para el caso Externa + Ingreso + Efectivo — a pedido
	 * explícito del usuario, con imagen de referencia. Pide los datos que el "RECIBO DE PAGO" (ver
	 * reciboPagoEfectivo.ts) necesita y que NO están en el formulario principal de la transacción: datos
	 * del cliente que paga, de quien recibe el efectivo en nombre de la empresa, y ambas firmas
	 * manuscritas (ver SignaturePad.svelte). El PDF en sí lo arma y descarga quien abre este modal
	 * (TransaccionModal.svelte, ver onGenerar) — este componente solo captura y valida los datos.
	 */
	import { X, Loader2 } from '@lucide/svelte';
	import SignaturePad from '$lib/shared/components/SignaturePad.svelte';
	import { supabase } from '$lib/supabaseClient';
	import { toast } from '$lib/stores/toast';

	export interface DatosPopupReciboPago {
		concepto: string;
		clienteNombre: string;
		clienteDni: string;
		firmaClienteDataUrl: string;
		receptorNombre: string;
		receptorDni: string;
		cargoRelacion: string;
		firmaReceptorDataUrl: string;
	}

	let {
		open = false,
		conceptoInicial = '',
		generando = false,
		onCancel,
		onGenerar
	}: {
		open?: boolean;
		conceptoInicial?: string;
		generando?: boolean;
		onCancel: () => void;
		onGenerar: (datos: DatosPopupReciboPago) => void | Promise<void>;
	} = $props();

	const MAX_CONCEPTO = 500;

	let concepto = $state('');
	let receptorNombre = $state('');
	let receptorDni = $state('');
	let personaQueRecibeId = $state('');
	let cargoRelacion = $state('');
	let clienteNombre = $state('');
	let clienteDni = $state('');
	let firmaClienteDataUrl = $state('');
	let firmaReceptorDataUrl = $state('');
	let empleados = $state<{ id: number; nombre: string }[]>([]);
	let errores = $state<Record<string, string>>({});

	let abiertoAnterior = false;
	$effect(() => {
		if (open && !abiertoAnterior) {
			concepto = conceptoInicial;
			receptorNombre = '';
			receptorDni = '';
			personaQueRecibeId = '';
			cargoRelacion = '';
			clienteNombre = '';
			clienteDni = '';
			firmaClienteDataUrl = '';
			firmaReceptorDataUrl = '';
			errores = {};
			if (empleados.length === 0) cargarEmpleados();
		}
		abiertoAnterior = open;
	});

	async function cargarEmpleados() {
		const { data, error } = await supabase.from('empleados').select('id,nombre').order('nombre');
		if (!error) empleados = data ?? [];
	}

	function handlePersonaChange(id: string) {
		personaQueRecibeId = id;
		const emp = empleados.find((e) => String(e.id) === id);
		if (emp) receptorNombre = emp.nombre;
	}

	function validar(): boolean {
		const errs: Record<string, string> = {};
		if (!concepto.trim()) errs.concepto = 'Ingresa la descripción del pago.';
		if (!clienteNombre.trim()) errs.clienteNombre = 'Requerido.';
		if (!clienteDni.trim()) errs.clienteDni = 'Requerido.';
		if (!personaQueRecibeId) errs.personaQueRecibeId = 'Selecciona quién recibe el efectivo.';
		if (!receptorNombre.trim()) errs.receptorNombre = 'Requerido.';
		if (!receptorDni.trim()) errs.receptorDni = 'Requerido.';
		if (!firmaClienteDataUrl) errs.firmaCliente = 'Falta la firma del pagador.';
		if (!firmaReceptorDataUrl) errs.firmaReceptor = 'Falta la firma de quien recibe.';
		errores = errs;
		return Object.keys(errs).length === 0;
	}

	async function handleGenerar() {
		if (!validar()) {
			toast.error('Completa todos los campos requeridos, incluidas ambas firmas.');
			return;
		}
		await onGenerar({
			concepto: concepto.trim(),
			clienteNombre: clienteNombre.trim(),
			clienteDni: clienteDni.trim(),
			firmaClienteDataUrl,
			receptorNombre: receptorNombre.trim(),
			receptorDni: receptorDni.trim(),
			cargoRelacion: cargoRelacion.trim(),
			firmaReceptorDataUrl
		});
	}
</script>

{#if open}
	<div class="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
		<div class="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden">
			<div class="flex items-center justify-between px-5 py-4 border-b border-slate-200 shrink-0">
				<h2 class="text-base font-bold text-[#0f3b5e]">Autogenerar Boucher de Transferencia</h2>
				<button type="button" onclick={onCancel} class="text-slate-400 hover:text-slate-600" aria-label="Cerrar">
					<X size={20} />
				</button>
			</div>

			<div class="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-4">
				<div>
					<label class="block text-sm font-bold text-[#0f3b5e] mb-1" for="rp-concepto">
						Descripción de la transferencia <span class="text-red-500">*</span>
					</label>
					<textarea
						id="rp-concepto"
						rows="2"
						maxlength={MAX_CONCEPTO}
						bind:value={concepto}
						placeholder="Ingresa la descripción del pago o transferencia..."
						class={`w-full rounded-lg border px-3 py-2 text-sm resize-none ${errores.concepto ? 'border-red-400' : 'border-slate-300'}`}
					></textarea>
					<div class="flex items-center justify-between mt-1">
						{#if errores.concepto}<p class="text-xs text-red-600">{errores.concepto}</p>{:else}<span></span>{/if}
						<span class="text-xs text-slate-400">{concepto.length}/{MAX_CONCEPTO}</span>
					</div>
				</div>

				<div>
					<h3 class="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Datos del cliente que paga</h3>
					<div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
						<div>
							<label class="block text-xs font-semibold text-slate-600 mb-1" for="rp-cliente-nombre">
								Nombre completo <span class="text-red-500">*</span>
							</label>
							<input
								id="rp-cliente-nombre"
								type="text"
								bind:value={clienteNombre}
								placeholder="Ingresa nombre completo"
								class={`w-full rounded-lg border px-3 py-2 text-sm ${errores.clienteNombre ? 'border-red-400' : 'border-slate-300'}`}
							/>
							{#if errores.clienteNombre}<p class="text-xs text-red-600 mt-1">{errores.clienteNombre}</p>{/if}
						</div>
						<div>
							<label class="block text-xs font-semibold text-slate-600 mb-1" for="rp-cliente-dni">
								RUC / DNI <span class="text-red-500">*</span>
							</label>
							<input
								id="rp-cliente-dni"
								type="text"
								bind:value={clienteDni}
								placeholder="Ingresa RUC o DNI"
								class={`w-full rounded-lg border px-3 py-2 text-sm ${errores.clienteDni ? 'border-red-400' : 'border-slate-300'}`}
							/>
							{#if errores.clienteDni}<p class="text-xs text-red-600 mt-1">{errores.clienteDni}</p>{/if}
						</div>
					</div>
				</div>

				<div>
					<h3 class="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Datos de quien recibe</h3>
					<div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
						<div>
							<label class="block text-xs font-semibold text-slate-600 mb-1" for="rp-persona">
								Persona que recibe <span class="text-red-500">*</span>
							</label>
							<select
								id="rp-persona"
								value={personaQueRecibeId}
								onchange={(e) => handlePersonaChange((e.currentTarget as HTMLSelectElement).value)}
								class={`w-full rounded-lg border px-3 py-2 text-sm bg-white ${errores.personaQueRecibeId ? 'border-red-400' : 'border-slate-300'}`}
							>
								<option value="">Selecciona una opción</option>
								{#each empleados as emp (emp.id)}
									<option value={String(emp.id)}>{emp.nombre}</option>
								{/each}
							</select>
							{#if errores.personaQueRecibeId}<p class="text-xs text-red-600 mt-1">{errores.personaQueRecibeId}</p>{/if}
						</div>
						<div>
							<label class="block text-xs font-semibold text-slate-600 mb-1" for="rp-cargo">Cargo / Relación (opcional)</label>
							<input
								id="rp-cargo"
								type="text"
								bind:value={cargoRelacion}
								placeholder="Ej: Proveedor, Colaborador, Cliente"
								class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
							/>
						</div>
						<div>
							<label class="block text-xs font-semibold text-slate-600 mb-1" for="rp-receptor-nombre">
								Nombre completo <span class="text-red-500">*</span>
							</label>
							<input
								id="rp-receptor-nombre"
								type="text"
								bind:value={receptorNombre}
								placeholder="Ingresa nombre completo"
								class={`w-full rounded-lg border px-3 py-2 text-sm ${errores.receptorNombre ? 'border-red-400' : 'border-slate-300'}`}
							/>
							{#if errores.receptorNombre}<p class="text-xs text-red-600 mt-1">{errores.receptorNombre}</p>{/if}
						</div>
						<div>
							<label class="block text-xs font-semibold text-slate-600 mb-1" for="rp-receptor-dni">
								DNI <span class="text-red-500">*</span>
							</label>
							<input
								id="rp-receptor-dni"
								type="text"
								bind:value={receptorDni}
								placeholder="Ingresa DNI"
								class={`w-full rounded-lg border px-3 py-2 text-sm ${errores.receptorDni ? 'border-red-400' : 'border-slate-300'}`}
							/>
							{#if errores.receptorDni}<p class="text-xs text-red-600 mt-1">{errores.receptorDni}</p>{/if}
						</div>
					</div>
				</div>

				<div>
					<h3 class="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Firmas</h3>
					<div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
						<div>
							<p class="text-xs font-semibold text-slate-600 mb-1">
								Firma del pagador <span class="text-red-500">*</span>
							</p>
							<SignaturePad bind:dataUrl={firmaClienteDataUrl} height={100} />
							{#if errores.firmaCliente}<p class="text-xs text-red-600 mt-1">{errores.firmaCliente}</p>{/if}
							<div class="grid grid-cols-2 gap-2 mt-2">
								<input
									type="text"
									bind:value={clienteNombre}
									placeholder="Nombre del pagador"
									class="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs"
								/>
								<input
									type="text"
									bind:value={clienteDni}
									placeholder="DNI del pagador"
									class="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs"
								/>
							</div>
						</div>
						<div>
							<p class="text-xs font-semibold text-slate-600 mb-1">
								Firma de quien recibe <span class="text-red-500">*</span>
							</p>
							<SignaturePad bind:dataUrl={firmaReceptorDataUrl} height={100} />
							{#if errores.firmaReceptor}<p class="text-xs text-red-600 mt-1">{errores.firmaReceptor}</p>{/if}
							<div class="grid grid-cols-2 gap-2 mt-2">
								<input
									type="text"
									bind:value={receptorNombre}
									placeholder="Nombre del receptor"
									class="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs"
								/>
								<input
									type="text"
									bind:value={receptorDni}
									placeholder="DNI del receptor"
									class="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs"
								/>
							</div>
						</div>
					</div>
				</div>
			</div>

			<div class="flex items-center justify-end gap-3 px-5 py-4 border-t border-slate-200 shrink-0">
				<button
					type="button"
					onclick={onCancel}
					disabled={generando}
					class="px-4 py-2 rounded-lg border border-slate-300 text-slate-600 text-sm font-semibold hover:bg-slate-50 disabled:opacity-50"
				>
					Cancelar
				</button>
				<button
					type="button"
					onclick={handleGenerar}
					disabled={generando}
					class="flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-50"
				>
					{#if generando}<Loader2 size={16} class="animate-spin" />{/if}
					Generar Boucher
				</button>
			</div>
		</div>
	</div>
{/if}
