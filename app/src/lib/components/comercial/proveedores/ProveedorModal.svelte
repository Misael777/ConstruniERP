<script lang="ts">
	import { fade, scale } from 'svelte/transition';
	import { supabase } from '$lib/supabaseClient';

	let { isOpen = false, proveedorEdit = null, onClose = () => {}, onSave = () => {} } = $props<{
		isOpen?: boolean;
		proveedorEdit?: any;
		onClose?: () => void;
		onSave?: () => void;
	}>();

	// Form State
	let razonSocial = $state('');
	let ruc = $state('');
	let contacto = $state('');
	let telefono = $state('');
	let email = $state('');
	let vendedor = $state('');
	
	let isSaving = $state(false);
	let errorMsg = $state('');

	// Effect to populate form when editing
	$effect(() => {
		if (isOpen) {
			if (proveedorEdit) {
				razonSocial = proveedorEdit.razon_social || '';
				ruc = proveedorEdit.ruc || '';
				contacto = proveedorEdit.contacto || '';
				telefono = proveedorEdit.telefono || '';
				email = proveedorEdit.email || '';
				vendedor = proveedorEdit.vendedor || '';
			} else {
				// Reset form
				razonSocial = '';
				ruc = '';
				contacto = '';
				telefono = '';
				email = '';
				vendedor = '';
			}
			errorMsg = '';
		}
	});

	async function handleGuardar() {
		if (!razonSocial || !ruc) {
			errorMsg = 'La Razón Social y el RUC son obligatorios.';
			return;
		}

		isSaving = true;
		errorMsg = '';

		try {
			const payload = {
				razon_social: razonSocial,
				ruc,
				contacto,
				telefono,
				email,
				vendedor,
				updated_at: new Date().toISOString()
			};

			if (proveedorEdit) {
				// Update
				const { error } = await supabase
					.from('proveedor')
					.update(payload)
					.eq('id_proveedor', proveedorEdit.id_proveedor);
				if (error) throw error;
			} else {
				// Insert
				const { error } = await supabase
					.from('proveedor')
					.insert([payload]);
				if (error) throw error;
			}

			onSave();
			onClose();
		} catch (error: any) {
			console.error('Error guardando proveedor:', error);
			errorMsg = error.message || 'Ocurrió un error al guardar el proveedor.';
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
					{proveedorEdit ? 'Editar Proveedor' : 'Nuevo Proveedor'}
				</h2>
				<button onclick={onClose} disabled={isSaving} class="text-slate-400 hover:text-slate-600 transition-colors p-2 rounded-full hover:bg-slate-100 disabled:opacity-50">
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
						<div class="flex flex-col gap-1 md:col-span-2">
							<label class="text-xs font-semibold text-slate-600">Razón Social *</label>
							<input type="text" bind:value={razonSocial} disabled={isSaving} placeholder="Ej. Corporación ABC S.A.C." class="px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all">
						</div>

						<div class="flex flex-col gap-1 md:col-span-1">
							<label class="text-xs font-semibold text-slate-600">RUC *</label>
							<input type="text" bind:value={ruc} disabled={isSaving} placeholder="Ej. 20123456789" class="px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all">
						</div>
						
						<div class="flex flex-col gap-1 md:col-span-1">
							<label class="text-xs font-semibold text-slate-600">Vendedor Asignado (Nosotros)</label>
							<input type="text" bind:value={vendedor} disabled={isSaving} placeholder="Ej. Juan Pérez" class="px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all">
						</div>

						<div class="col-span-2 pt-4 border-t border-slate-100 mt-2">
							<h3 class="text-sm font-bold text-slate-800 mb-4 flex items-center gap-2">
								<i class="fas fa-address-book text-emerald-500"></i>
								Datos de Contacto
							</h3>
						</div>

						<div class="flex flex-col gap-1 md:col-span-2">
							<label class="text-xs font-semibold text-slate-600">Nombre del Contacto</label>
							<input type="text" bind:value={contacto} disabled={isSaving} placeholder="Ej. Ana García" class="px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all">
						</div>

						<div class="flex flex-col gap-1 md:col-span-1">
							<label class="text-xs font-semibold text-slate-600">Teléfono</label>
							<input type="text" bind:value={telefono} disabled={isSaving} placeholder="Ej. 987654321" class="px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all">
						</div>

						<div class="flex flex-col gap-1 md:col-span-1">
							<label class="text-xs font-semibold text-slate-600">Correo Electrónico</label>
							<input type="email" bind:value={email} disabled={isSaving} placeholder="Ej. ventas@empresa.com" class="px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all">
						</div>

					</div>
				</div>
			</div>

			<!-- Footer -->
			<div class="p-6 border-t border-slate-100 bg-slate-50 rounded-b-2xl flex justify-end gap-3">
				<button onclick={onClose} disabled={isSaving} class="px-5 py-2.5 bg-white border border-slate-200 text-slate-600 rounded-xl hover:bg-slate-50 hover:text-slate-800 font-medium text-sm transition-colors shadow-sm disabled:opacity-50">
					Cancelar
				</button>
				<button onclick={handleGuardar} disabled={isSaving} class="px-6 py-2.5 bg-blue-600 text-white rounded-xl hover:bg-blue-700 font-medium text-sm shadow-md shadow-blue-600/20 active:scale-[0.98] transition-all flex items-center gap-2 disabled:opacity-50 disabled:active:scale-100">
					{#if isSaving}
						<i class="fas fa-spinner fa-spin"></i> Guardando...
					{:else}
						<i class="fas fa-save"></i> Guardar proveedor
					{/if}
				</button>
			</div>
		</div>
	</div>
{/if}
