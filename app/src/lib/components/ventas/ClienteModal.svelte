<script lang="ts">
	import { enhance } from '$app/forms';

	let { isOpen = false, onClose, clienteToEdit = null } = $props<{
		isOpen: boolean;
		onClose: () => void;
		clienteToEdit?: any;
	}>();

	// Estado del formulario
	let nombre = $state('');
	let telefono = $state('');
	let correo = $state('');
	let empresa = $state('');
	let dni = $state('');
	let ubicacion = $state('');

	// Cargar datos si estamos en modo edición
	$effect(() => {
		if (clienteToEdit) {
			nombre = clienteToEdit.nombre || '';
			telefono = clienteToEdit.telefono || '';
			correo = clienteToEdit.correo || '';
			empresa = clienteToEdit.empresa || '';
			dni = clienteToEdit.dni || '';
			ubicacion = clienteToEdit.ubicacion || '';
		} else {
			// Reiniciar a valores por defecto
			nombre = '';
			telefono = '';
			correo = '';
			empresa = '';
			dni = '';
			ubicacion = '';
		}
	});

	function handleClose() {
		onClose();
	}
</script>

{#if isOpen}
<div class="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 overflow-y-auto">
	<div class="bg-white rounded-3xl w-full max-w-2xl max-h-[92vh] overflow-y-auto shadow-2xl border border-slate-100 flex flex-col">
		<!-- Header -->
		<div class="flex justify-between items-center px-8 py-5 border-b border-slate-100 bg-slate-50/70 backdrop-blur-md sticky top-0 z-20">
			<div class="flex items-center gap-2">
				<div class="w-8 h-8 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center">
					<i class="fas fa-user-tie text-sm"></i>
				</div>
				<h2 class="text-lg font-bold text-slate-800">{clienteToEdit ? 'Editar Cliente' : 'Nuevo Cliente'}</h2>
			</div>
			<button onclick={handleClose} class="text-slate-400 hover:text-slate-600 transition-colors p-1 cursor-pointer" title="Cerrar modal">
				<i class="fas fa-times text-lg"></i>
			</button>
		</div>

		<!-- Body Form -->
		<form 
			method="POST" 
			action={clienteToEdit ? '?/update' : '?/create'} 
			use:enhance={() => {
				return async ({ update }) => {
					await update();
					handleClose();
				};
			}}
			class="p-8 space-y-6 flex-1"
		>
			{#if clienteToEdit}
				<input type="hidden" name="id" value={clienteToEdit.id} />
			{/if}

			<div class="grid grid-cols-1 md:grid-cols-2 gap-5">
				<!-- Nombre completo -->
				<div class="col-span-1 md:col-span-2">
					<label class="block text-xs font-semibold text-slate-600 mb-1.5">Nombre Completo o Razón Social *</label>
					<div class="relative">
						<span class="absolute inset-y-0 left-0 pl-3 flex items-center text-slate-400">
							<i class="fas fa-user"></i>
						</span>
						<input 
							type="text" 
							name="nombre" 
							bind:value={nombre} 
							class="w-full text-sm pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:bg-white outline-none transition-all" 
							placeholder="Ej. Juan Pérez / Inversiones Casallo S.A.C." 
							required 
						/>
					</div>
				</div>

				<!-- DNI / RUC -->
				<div class="col-span-1">
					<label class="block text-xs font-semibold text-slate-600 mb-1.5">DNI o RUC</label>
					<div class="relative">
						<span class="absolute inset-y-0 left-0 pl-3 flex items-center text-slate-400">
							<i class="fas fa-id-card"></i>
						</span>
						<input 
							type="text" 
							name="dni" 
							bind:value={dni} 
							class="w-full text-sm pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:bg-white outline-none transition-all" 
							placeholder="Ej. 45678912 o 20601234567" 
						/>
					</div>
				</div>

				<!-- Empresa -->
				<div class="col-span-1">
					<label class="block text-xs font-semibold text-slate-600 mb-1.5">Empresa / Institución</label>
					<div class="relative">
						<span class="absolute inset-y-0 left-0 pl-3 flex items-center text-slate-400">
							<i class="fas fa-building"></i>
						</span>
						<input 
							type="text" 
							name="empresa" 
							bind:value={empresa} 
							class="w-full text-sm pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:bg-white outline-none transition-all" 
							placeholder="Ej. Constructora Melchor (Opcional)" 
						/>
					</div>
				</div>

				<!-- Teléfono -->
				<div class="col-span-1">
					<label class="block text-xs font-semibold text-slate-600 mb-1.5">Teléfono de Contacto</label>
					<div class="relative">
						<span class="absolute inset-y-0 left-0 pl-3 flex items-center text-slate-400">
							<i class="fas fa-phone-alt"></i>
						</span>
						<input 
							type="text" 
							name="telefono" 
							bind:value={telefono} 
							class="w-full text-sm pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:bg-white outline-none transition-all" 
							placeholder="Ej. 987654321" 
						/>
					</div>
				</div>

				<!-- Correo electrónico -->
				<div class="col-span-1">
					<label class="block text-xs font-semibold text-slate-600 mb-1.5">Correo Electrónico</label>
					<div class="relative">
						<span class="absolute inset-y-0 left-0 pl-3 flex items-center text-slate-400">
							<i class="fas fa-envelope"></i>
						</span>
						<input 
							type="email" 
							name="correo" 
							bind:value={correo} 
							class="w-full text-sm pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:bg-white outline-none transition-all" 
							placeholder="Ej. contacto@empresa.com" 
						/>
					</div>
				</div>

				<!-- Ubicación/Dirección -->
				<div class="col-span-1 md:col-span-2">
					<label class="block text-xs font-semibold text-slate-600 mb-1.5">Ubicación / Dirección</label>
					<div class="relative">
						<span class="absolute inset-y-0 left-0 pl-3 flex items-center text-slate-400">
							<i class="fas fa-map-marker-alt"></i>
						</span>
						<input 
							type="text" 
							name="ubicacion" 
							bind:value={ubicacion} 
							class="w-full text-sm pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:bg-white outline-none transition-all" 
							placeholder="Ej. Av. Javier Prado Este 1230, San Isidro" 
						/>
					</div>
				</div>
			</div>

			<!-- Footer Buttons -->
			<div class="flex justify-end gap-3 pt-5 border-t border-slate-100">
				<button 
					type="button" 
					onclick={handleClose} 
					class="px-6 py-2.5 border border-slate-200 text-slate-600 rounded-xl hover:bg-slate-50 hover:text-slate-800 font-medium text-sm transition-all cursor-pointer"
				>
					Cancelar
				</button>
				<button 
					type="submit" 
					class="px-6 py-2.5 bg-blue-600 text-white rounded-xl hover:bg-blue-700 font-medium text-sm transition-all shadow-md shadow-blue-600/10 hover:shadow-lg active:scale-[0.98] flex items-center gap-2 cursor-pointer"
				>
					<i class="fas fa-save"></i>
					<span>{clienteToEdit ? 'Guardar Cambios' : 'Registrar Cliente'}</span>
				</button>
			</div>
		</form>
	</div>
</div>
{/if}
