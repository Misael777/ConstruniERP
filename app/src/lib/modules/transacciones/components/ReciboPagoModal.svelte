<script lang="ts">
	/**
	 * Popup "Firmar Comprobante" del Recibo de Pago (Externa+Ingreso) — a pedido explícito del usuario: el
	 * Recibo de Pago siempre se autogenera solo, en vivo, con Concepto y datos del cliente editables
	 * directo en el formulario principal (ver conceptoRecibo/clienteReciboNombre/clienteReciboDni en
	 * TransaccionModal.svelte) — este popup ya NO pide esos datos, solo captura las DOS firmas manuscritas
	 * (ver SignaturePad.svelte), disponibles para CUALQUIER medio de pago, no solo Efectivo. Firmar es
	 * opcional: si el usuario nunca abre este popup, el comprobante se genera igual, sin firma. "Quien
	 * recibe" ya NO se elige de una lista — a pedido explícito del usuario, siempre es quien tiene la
	 * sesión abierta (permisosState), así que Persona/Cargo se muestran fijos y solo el DNI queda editable
	 * (se prellena si el empleado ya lo tiene cargado en IAM → Empleados). El PDF en sí lo arma y descarga
	 * quien abre este modal (TransaccionModal.svelte, ver onGenerar) — este componente solo captura y
	 * valida las firmas.
	 */
	import { X, Loader2 } from '@lucide/svelte';
	import SignaturePad from '$lib/shared/components/SignaturePad.svelte';
	import { toast } from '$lib/stores/toast';
	import { permisosState } from '$lib/stores/permisos.svelte';

	export interface DatosFirmaReciboPago {
		receptorDni: string;
		firmaClienteDataUrl: string;
		firmaReceptorDataUrl: string;
	}

	let {
		open = false,
		clienteNombre = '',
		receptorDniInicial = '',
		firmaClienteInicial = '',
		firmaReceptorInicial = '',
		generando = false,
		onCancel,
		onGenerar
	}: {
		open?: boolean;
		/** Nombre del cliente que paga — solo para mostrar bajo su firma, ya se edita en el formulario
		 * principal (ver clienteReciboNombre en TransaccionModal.svelte). */
		clienteNombre?: string;
		receptorDniInicial?: string;
		firmaClienteInicial?: string;
		firmaReceptorInicial?: string;
		generando?: boolean;
		onCancel: () => void;
		onGenerar: (datos: DatosFirmaReciboPago) => void | Promise<void>;
	} = $props();

	let receptorDni = $state('');
	let firmaClienteDataUrl = $state('');
	let firmaReceptorDataUrl = $state('');
	let errores = $state<Record<string, string>>({});

	// "Quien recibe" ya no se elige — siempre es el usuario con la sesión abierta.
	const receptorNombre = $derived(permisosState.userName || 'Usuario');
	const cargoRelacion = $derived(permisosState.rolNombre || '');

	let abiertoAnterior = false;
	$effect(() => {
		if (open && !abiertoAnterior) {
			receptorDni = receptorDniInicial || permisosState.dni || '';
			firmaClienteDataUrl = firmaClienteInicial;
			firmaReceptorDataUrl = firmaReceptorInicial;
			errores = {};
		}
		abiertoAnterior = open;
	});

	function validar(): boolean {
		const errs: Record<string, string> = {};
		if (!receptorDni.trim()) errs.receptorDni = 'Requerido.';
		if (!firmaClienteDataUrl) errs.firmaCliente = 'Falta la firma del pagador.';
		if (!firmaReceptorDataUrl) errs.firmaReceptor = 'Falta la firma de quien recibe.';
		errores = errs;
		return Object.keys(errs).length === 0;
	}

	async function handleGenerar() {
		if (!validar()) {
			toast.error('Completa ambas firmas antes de continuar.');
			return;
		}
		await onGenerar({
			receptorDni: receptorDni.trim(),
			firmaClienteDataUrl,
			firmaReceptorDataUrl
		});
	}
</script>

{#if open}
	<div class="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
		<div class="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden">
			<div class="flex items-center justify-between px-5 py-4 border-b border-slate-200 shrink-0">
				<h2 class="text-base font-bold text-[#0f3b5e]">Firmar Comprobante</h2>
				<button type="button" onclick={onCancel} class="text-slate-400 hover:text-slate-600" aria-label="Cerrar">
					<X size={20} />
				</button>
			</div>

			<div class="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-4">
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
					Guardar firma
				</button>
			</div>
		</div>
	</div>
{/if}
