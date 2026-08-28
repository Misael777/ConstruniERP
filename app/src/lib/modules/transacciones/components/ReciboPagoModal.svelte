<script lang="ts">
	/**
	 * Popup "Autogenerar Recibo por Pago" para el caso Externa + Ingreso + Efectivo — a pedido explícito
	 * del usuario, con imagen de referencia. Pide los datos que el "RECIBO DE PAGO" (ver
	 * reciboPagoEfectivo.ts) necesita y que NO están en el formulario principal de la transacción: datos
	 * del cliente que paga (prellenados desde el Centro de Costo Origen de la transacción — ver
	 * clienteNombreInicial/clienteDniInicial), y ambas firmas manuscritas (ver SignaturePad.svelte).
	 * "Quien recibe" el efectivo ya NO se elige de una lista — a pedido explícito del usuario, siempre es
	 * quien tiene la sesión abierta (permisosState), así que Persona/Cargo se muestran fijos y solo el
	 * DNI queda editable (se prellena si el empleado ya lo tiene cargado en IAM → Empleados). El PDF en
	 * sí lo arma y descarga quien abre este modal (TransaccionModal.svelte, ver onGenerar) — este
	 * componente solo captura y valida los datos.
	 */
	import { X, Loader2 } from '@lucide/svelte';
	import SignaturePad from '$lib/shared/components/SignaturePad.svelte';
	import { toast } from '$lib/stores/toast';
	import { permisosState } from '$lib/stores/permisos.svelte';

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
		clienteNombreInicial = '',
		clienteDniInicial = '',
		generando = false,
		onCancel,
		onGenerar
	}: {
		open?: boolean;
		conceptoInicial?: string;
		clienteNombreInicial?: string;
		clienteDniInicial?: string;
		generando?: boolean;
		onCancel: () => void;
		onGenerar: (datos: DatosPopupReciboPago) => void | Promise<void>;
	} = $props();

	const MAX_CONCEPTO = 500;

	let concepto = $state('');
	let receptorDni = $state('');
	let clienteNombre = $state('');
	let clienteDni = $state('');
	let firmaClienteDataUrl = $state('');
	let firmaReceptorDataUrl = $state('');
	let errores = $state<Record<string, string>>({});

	// "Quien recibe" ya no se elige — siempre es el usuario con la sesión abierta.
	const receptorNombre = $derived(permisosState.userName || 'Usuario');
	const cargoRelacion = $derived(permisosState.rolNombre || '');

	let abiertoAnterior = false;
	$effect(() => {
		if (open && !abiertoAnterior) {
			concepto = conceptoInicial;
			clienteNombre = clienteNombreInicial;
			clienteDni = clienteDniInicial;
			receptorDni = permisosState.dni || '';
			firmaClienteDataUrl = '';
			firmaReceptorDataUrl = '';
			errores = {};
		}
		abiertoAnterior = open;
	});

	function validar(): boolean {
		const errs: Record<string, string> = {};
		if (!concepto.trim()) errs.concepto = 'Ingresa la descripción del pago.';
		if (!clienteNombre.trim()) errs.clienteNombre = 'Requerido.';
		if (!clienteDni.trim()) errs.clienteDni = 'Requerido.';
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
			receptorNombre,
			receptorDni: receptorDni.trim(),
			cargoRelacion,
			firmaReceptorDataUrl
		});
	}
</script>

{#if open}
	<div class="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
		<div class="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden">
			<div class="flex items-center justify-between px-5 py-4 border-b border-slate-200 shrink-0">
				<h2 class="text-base font-bold text-[#0f3b5e]">Autogenerar Recibo por Pago</h2>
				<button type="button" onclick={onCancel} class="text-slate-400 hover:text-slate-600" aria-label="Cerrar">
					<X size={20} />
				</button>
			</div>

			<div class="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-4">
				<div>
					<label class="block text-sm font-bold text-[#0f3b5e] mb-1" for="rp-concepto">
						Descripción <span class="text-red-500">*</span>
					</label>
					<textarea
						id="rp-concepto"
						rows="2"
						maxlength={MAX_CONCEPTO}
						bind:value={concepto}
						placeholder="Ingresa la descripción del pago..."
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
							<label class="block text-xs font-semibold text-slate-600 mb-1" for="rp-persona">Persona que recibe</label>
							<input
								id="rp-persona"
								type="text"
								value={receptorNombre}
								disabled
								class="w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-600 disabled:opacity-80"
							/>
						</div>
						<div>
							<label class="block text-xs font-semibold text-slate-600 mb-1" for="rp-cargo">Cargo</label>
							<input
								id="rp-cargo"
								type="text"
								value={cargoRelacion}
								disabled
								class="w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-600 disabled:opacity-80"
							/>
						</div>
						<div class="sm:col-span-2">
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
							<p class="text-xs text-slate-500 mt-2">{clienteNombre || 'Nombre del pagador'}</p>
						</div>
						<div>
							<p class="text-xs font-semibold text-slate-600 mb-1">
								Firma de quien recibe <span class="text-red-500">*</span>
							</p>
							<SignaturePad bind:dataUrl={firmaReceptorDataUrl} height={100} />
							{#if errores.firmaReceptor}<p class="text-xs text-red-600 mt-1">{errores.firmaReceptor}</p>{/if}
							<p class="text-xs text-slate-500 mt-2">{receptorNombre}</p>
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
					Generar Recibo
				</button>
			</div>
		</div>
	</div>
{/if}
