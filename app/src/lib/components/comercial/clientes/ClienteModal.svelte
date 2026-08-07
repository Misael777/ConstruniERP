<script lang="ts">
	import { fade, scale } from 'svelte/transition';
	import { supabase } from '$lib/supabaseClient';
	import { getOrCrearCentroCostoParaEntidad } from '$lib/modules/centro-costos/services/centroCostos.service';
	import { isAdmin } from '$lib/stores/permisos.svelte';
	import { crearSolicitud } from '$lib/modules/aprobaciones/services/aprobaciones.service';

	let { isOpen = false, clienteEdit = null, onClose = () => {}, onSave = () => {} } = $props<{
		isOpen?: boolean;
		clienteEdit?: any;
		onClose?: () => void;
		onSave?: () => void;
	}>();

	// Form State
	let tipPersona = $state('J'); // J = Jurídica (Empresa), N = Natural (Persona)
	let nombre = $state('');
	let tipoDoc = $state('RUC');
	let numDocumento = $state('');
	let direccion = $state('');
	let telefono = $state('');
	let email = $state('');
	
	let isSaving = $state(false);
	let errorMsg = $state('');

	// Effect to populate form when editing
	$effect(() => {
		if (isOpen) {
			if (clienteEdit) {
				tipPersona = clienteEdit.tip_persona || 'J';
				nombre = clienteEdit.nombre || '';
				tipoDoc = clienteEdit.tipo_doc || 'RUC';
				numDocumento = clienteEdit.num_documento || '';
				direccion = clienteEdit.direccion || '';
				telefono = clienteEdit.telefono || '';
				email = clienteEdit.email || '';
			} else {
				// Reset form
				tipPersona = 'J';
				nombre = '';
				tipoDoc = 'RUC';
				numDocumento = '';
				direccion = '';
				telefono = '';
				email = '';
			}
			errorMsg = '';
		}
	});

	// A pedido del usuario: Tipo de Documento se autocompleta según Tipo de Persona — Natural -> DNI,
	// Jurídica -> RUC (el usuario todavía puede cambiarlo a mano después, ej. a CE para un extranjero).
	$effect(() => {
		if (tipPersona === 'N') tipoDoc = 'DNI';
		else if (tipPersona === 'J') tipoDoc = 'RUC';
	});

	// A pedido del usuario: el campo "Razón Social" pasa a llamarse "Nombre Completo" apenas el Tipo
	// de Documento es DNI o CE (documentos de persona natural), sin importar qué Tipo de Persona
	// esté seleccionado — reacciona directo al Tipo de Documento, no solo al efecto de arriba.
	let esPersonaNatural = $derived(tipoDoc === 'DNI' || tipoDoc === 'CE');

	async function handleGuardar() {
		if (!nombre || !numDocumento) {
			errorMsg = 'El nombre y documento son obligatorios.';
			return;
		}

		isSaving = true;
		errorMsg = '';

		try {
			const payload = {
				tip_persona: tipPersona,
				nombre,
				tipo_doc: tipoDoc,
				num_documento: numDocumento,
				direccion,
				telefono,
				email,
				updated_at: new Date().toISOString()
			};

			if (clienteEdit) {
				// A pedido del usuario: un no-administrador ya no puede editar un cliente directo — se
				// envía una solicitud de aprobación en vez de guardar, visible para todos los admins en
				// la campanita (ver aprobaciones.service.ts). El alta de un cliente nuevo (rama else de
				// abajo) sigue libre para cualquiera, esto solo aplica a EDITAR uno existente.
				if (!isAdmin()) {
					// Snapshot del valor ANTERIOR de cada campo (mismas claves que `payload`) — a pedido del
					// usuario: la campanita del admin debe resaltar cuáles campos realmente cambian, no solo
					// listar el registro. clienteEdit ya trae la fila completa tal como está en la BD.
					const payloadAnterior = {
						tip_persona: clienteEdit.tip_persona ?? null,
						nombre: clienteEdit.nombre ?? null,
						tipo_doc: clienteEdit.tipo_doc ?? null,
						num_documento: clienteEdit.num_documento ?? null,
						direccion: clienteEdit.direccion ?? null,
						telefono: clienteEdit.telefono ?? null,
						email: clienteEdit.email ?? null
					};
					const result = await crearSolicitud(supabase, {
						tipoEntidad: 'cliente',
						idEntidad: clienteEdit.id_cliente,
						tipoAccion: 'editar',
						descripcionEntidad: nombre,
						payloadCambios: payload,
						payloadAnterior
					});
					if (!result.success) throw new Error(result.message || 'No se pudo enviar la solicitud.');
					alert('No tienes permisos de administrador. Los cambios se enviaron para que un administrador los apruebe.');
					onSave();
					onClose();
					return;
				}

				// Update
				const { error } = await supabase
					.from('cliente')
					.update(payload)
					.eq('id_cliente', clienteEdit.id_cliente);
				if (error) throw error;
			} else {
				// Insert
				const { data: nuevoCliente, error } = await supabase
					.from('cliente')
					.insert([payload])
					.select('id_cliente')
					.single();
				if (error) throw error;

				// Centro de costo del cliente — secundario: si falla, el cliente ya quedó guardado
				// (se puede reintentar más tarde vía getOrCrearCentroCostoParaEntidad, p.ej. al generar
				// la primera transacción de un cobro suyo).
				if (nuevoCliente) {
					const idCentroCosto = await getOrCrearCentroCostoParaEntidad(supabase, 'cliente', nuevoCliente.id_cliente, nombre);
					if (!idCentroCosto) {
						console.warn('[ClienteModal] No se pudo crear el centro de costo del cliente recién creado.');
					}
				}
			}

			onSave();
			onClose();
		} catch (error: any) {
			console.error('Error guardando cliente:', error);
			errorMsg = error.message || 'Ocurrió un error al guardar el cliente.';
		} finally {
			isSaving = false;
		}
	}
</script>

{#if isOpen}
	<div class="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-[100] flex items-center justify-center p-4 overflow-y-auto" transition:fade={{duration: 200}}>
		<div class="bg-white rounded-2xl shadow-2xl w-full max-w-2xl my-8 relative" transition:scale={{duration: 300, start: 0.95}}>
			
			<!-- Header -->
			<div class="flex items-center justify-between p-6 border-b border-slate-100 sticky top-0 bg-white rounded-t-2xl z-10">
				<h2 class="text-xl font-bold text-slate-800">
					{clienteEdit ? 'Editar Cliente' : 'Nuevo Cliente'}
				</h2>
				<button on:click={onClose} disabled={isSaving} class="text-slate-400 hover:text-slate-600 transition-colors p-2 rounded-full hover:bg-slate-100 disabled:opacity-50">
					<i class="fas fa-times text-lg"></i>
				</button>
			</div>

			<!-- Body -->
			<div class="p-6 overflow-y-auto">
				{#if errorMsg}
					<div class="mb-4 p-3 bg-red-50 text-red-600 border border-red-200 rounded-lg text-sm flex items-start gap-2">
						<i class="fas fa-exclamation-circle mt-0.5"></i>
						<span>{errorMsg}</span>
					</div>
				{/if}

				<div class="space-y-6">
					
					<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
						<div class="flex flex-col gap-1 md:col-span-1">
							<label class="text-xs font-semibold text-[#0f3b5e]">Tipo de Persona *</label>
							<select bind:value={tipPersona} disabled={isSaving} class="px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all">
								<option value="J">Jurídica (Empresa)</option>
								<option value="N">Natural (Persona)</option>
							</select>
						</div>

						<div class="flex flex-col gap-1 md:col-span-1">
							<label class="text-xs font-semibold text-[#0f3b5e]">Tipo de Documento *</label>
							<select bind:value={tipoDoc} disabled={isSaving} class="px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all">
								<option value="RUC">RUC</option>
								<option value="DNI">DNI</option>
								<option value="CE">CE</option>
							</select>
						</div>

						<div class="flex flex-col gap-1 md:col-span-2">
							<label class="text-xs font-semibold text-[#0f3b5e]">{esPersonaNatural ? 'Nombre Completo' : 'Razón Social'} *</label>
							<input type="text" bind:value={nombre} disabled={isSaving} placeholder={esPersonaNatural ? "Ej. Juan Pérez" : "Ej. Constructora ABC S.A.C."} class="px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all">
						</div>

						<div class="flex flex-col gap-1 md:col-span-2">
							<label class="text-xs font-semibold text-[#0f3b5e]">Nº de Documento ({tipoDoc}) *</label>
							<input type="text" bind:value={numDocumento} disabled={isSaving} placeholder="Ej. 20123456789" class="px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all">
						</div>

						<div class="flex flex-col gap-1 md:col-span-2">
							<label class="text-xs font-semibold text-[#0f3b5e]">Dirección</label>
							<input type="text" bind:value={direccion} disabled={isSaving} placeholder="Ej. Av. Javier Prado 123, San Isidro" class="px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all">
						</div>

						<div class="flex flex-col gap-1 md:col-span-1">
							<label class="text-xs font-semibold text-[#0f3b5e]">Teléfono</label>
							<input type="text" bind:value={telefono} disabled={isSaving} placeholder="Ej. 987654321" class="px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all">
						</div>

						<div class="flex flex-col gap-1 md:col-span-1">
							<label class="text-xs font-semibold text-[#0f3b5e]">Correo Electrónico</label>
							<input type="email" bind:value={email} disabled={isSaving} placeholder="Ej. contacto@empresa.com" class="px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all">
						</div>

					</div>
				</div>
			</div>

			<!-- Footer -->
			<div class="p-6 border-t border-slate-100 bg-slate-50 rounded-b-2xl flex justify-end gap-3">
				<button on:click={onClose} disabled={isSaving} class="px-5 py-2.5 bg-white border border-slate-200 text-slate-600 rounded-xl hover:bg-slate-50 hover:text-slate-800 font-medium text-sm transition-colors shadow-sm disabled:opacity-50">
					Cancelar
				</button>
				<button on:click={handleGuardar} disabled={isSaving} class="px-6 py-2.5 bg-blue-600 text-white rounded-xl hover:bg-blue-700 font-medium text-sm shadow-md shadow-blue-600/20 active:scale-[0.98] transition-all flex items-center gap-2 disabled:opacity-50 disabled:active:scale-100">
					{#if isSaving}
						<i class="fas fa-spinner fa-spin"></i> Guardando...
					{:else}
						<i class="fas fa-save"></i> Guardar cliente
					{/if}
				</button>
			</div>
		</div>
	</div>
{/if}
