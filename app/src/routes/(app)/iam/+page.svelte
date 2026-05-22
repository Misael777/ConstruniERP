<script lang="ts">
	import { onMount } from 'svelte';
	import { supabase } from '$lib/supabaseClient';

	type Rol = { id: number; nombre: string; descripcion: string };
	type Area = { id: number; nombre: string };
	type Empleado = { id: number; nombre: string; telefono: string; rol_id: number; auth_user_id: string; roles?: { nombre: string } };

	let empleados = $state<Empleado[]>([]);
	let roles = $state<Rol[]>([]);
	let areas = $state<Area[]>([]);
	let isLoading = $state(true);
	let statusMessage = $state({ type: '', text: '' });

	// Form states
	let isModalOpen = $state(false);
	let isSaving = $state(false);
	
	let nuevoNombre = $state('');
	let nuevoTelefono = $state('');
	let nuevoRolId = $state<number | null>(null);
	let nuevoAreaId = $state<number | null>(null);
	let nuevaFechaIngreso = $state(new Date().toISOString().split('T')[0]);
	let nuevoSalario = $state(0);
	let nuevasHoras = $state(0);
	let nuevoPeriodo = $state('Mensual');
	let nuevoNivel = $state('');
	let nuevoAuthUserId = $state('');

	onMount(async () => {
		try {
			// Cargar roles
			const { data: rolesData, error: rolesError } = await supabase.from('roles').select('*').order('id');
			if (rolesError) throw rolesError;
			roles = rolesData || [];

			// Cargar áreas
			const { data: areasData, error: areasError } = await supabase.from('areas').select('*').order('nombre');
			if (areasError) throw areasError;
			areas = areasData || [];

			// Cargar empleados con sus roles
			const { data: empData, error: empError } = await supabase
				.from('empleados')
				.select(`
					id, nombre, telefono, rol_id, auth_user_id,
					roles ( nombre )
				`)
				.order('id');
			
			if (empError) throw empError;
			empleados = empData || [];

		} catch (error: any) {
			console.error("Error cargando datos IAM:", error);
			showStatus('error', 'Error al cargar usuarios. Asegúrate de tener permisos.');
		} finally {
			isLoading = false;
		}
	});

	function showStatus(type: 'success' | 'error', text: string) {
		statusMessage = { type, text };
		setTimeout(() => {
			statusMessage = { type: '', text: '' };
		}, 3000);
	}

	async function updateRole(empleadoId: number, nuevoRolId: number) {
		try {
			const { error } = await supabase
				.from('empleados')
				.update({ rol_id: nuevoRolId })
				.eq('id', empleadoId);

			if (error) throw error;
			
			// Actualizar UI localmente
			const rol = roles.find(r => r.id === nuevoRolId);
			empleados = empleados.map(emp => {
				if (emp.id === empleadoId) {
					// @ts-ignore
					return { ...emp, rol_id: nuevoRolId, roles: { nombre: rol?.nombre || '' } };
				}
				return emp;
			});
			
			showStatus('success', 'Rol actualizado correctamente');
		} catch (error: any) {
			console.error("Error al actualizar rol:", error);
			showStatus('error', 'Error al actualizar: ' + error.message);
		}
	}

	async function agregarEmpleado() {
		if (!nuevoNombre.trim()) {
			showStatus('error', 'El nombre es obligatorio');
			return;
		}
		if (!nuevaFechaIngreso) {
			showStatus('error', 'La fecha de ingreso es obligatoria');
			return;
		}
		if (nuevoAuthUserId.trim()) {
			const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
			if (!uuidRegex.test(nuevoAuthUserId.trim())) {
				showStatus('error', 'El ID de Usuario de Auth debe ser un UUID válido');
				return;
			}
		}

		isSaving = true;
		try {
			const insertData = {
				nombre: nuevoNombre.trim(),
				telefono: nuevoTelefono.trim() || null,
				rol_id: nuevoRolId || null,
				area_id: nuevoAreaId || null,
				fecha_ingreso: nuevaFechaIngreso,
				salario: nuevoSalario,
				horas: nuevasHoras,
				periodo: nuevoPeriodo,
				nivel: nuevoNivel.trim() || null,
				auth_user_id: nuevoAuthUserId.trim() || null
			};

			const { data, error } = await supabase
				.from('empleados')
				.insert([insertData])
				.select(`
					id, nombre, telefono, rol_id, auth_user_id,
					roles ( nombre )
				`);

			if (error) throw error;

			if (data && data.length > 0) {
				empleados = [...empleados, data[0]];
			} else {
				// Recargar
				const { data: reloadData, error: reloadError } = await supabase
					.from('empleados')
					.select(`
						id, nombre, telefono, rol_id, auth_user_id,
						roles ( nombre )
					`)
					.order('id');
				if (reloadError) throw reloadError;
				empleados = reloadData || [];
			}

			showStatus('success', 'Empleado agregado correctamente');
			isModalOpen = false;
			resetForm();
		} catch (error: any) {
			console.error("Error al agregar empleado:", error);
			showStatus('error', 'Error al agregar empleado: ' + error.message);
		} finally {
			isSaving = false;
		}
	}

	function resetForm() {
		nuevoNombre = '';
		nuevoTelefono = '';
		nuevoRolId = null;
		nuevoAreaId = null;
		nuevaFechaIngreso = new Date().toISOString().split('T')[0];
		nuevoSalario = 0;
		nuevasHoras = 0;
		nuevoPeriodo = 'Mensual';
		nuevoNivel = '';
		nuevoAuthUserId = '';
	}
</script>

<svelte:head>
	<title>Control de Accesos (IAM) | Construni ERP</title>
</svelte:head>

<div class="mb-6">
	<div class="text-xs text-slate-500 mb-2">Configuración &nbsp;>&nbsp; Control de Accesos (IAM)</div>
	<div class="flex justify-between items-center">
		<div>
			<h2 class="text-2xl font-semibold text-brand-marine">Gestión de Personal y Roles</h2>
			<p class="text-sm text-slate-500 mt-1">Administra los accesos, roles y números de contacto del equipo de trabajo.</p>
		</div>
		<button 
			onclick={() => isModalOpen = true}
			class="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-medium shadow-md shadow-blue-600/10 active:scale-[0.98] transition-all flex items-center gap-2"
		>
			<i class="fas fa-user-plus"></i> Nuevo Empleado
		</button>
	</div>
</div>

{#if statusMessage.text}
	<div class="p-3 mb-6 rounded-lg text-sm font-medium flex items-center gap-2 {statusMessage.type === 'success' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'} transition-all">
		<i class="fas {statusMessage.type === 'success' ? 'fa-check-circle' : 'fa-exclamation-triangle'}"></i>
		{statusMessage.text}
	</div>
{/if}

<div class="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
	{#if isLoading}
		<div class="p-8 flex justify-center text-blue-600 text-2xl">
			<i class="fas fa-spinner fa-spin"></i>
		</div>
	{:else}
		<div class="overflow-x-auto">
			<table class="w-full text-sm text-left">
				<thead class="text-xs text-slate-500 bg-slate-50 font-medium uppercase border-b border-slate-100">
					<tr>
						<th class="p-4">Personal</th>
						<th class="p-4">Contacto</th>
						<th class="p-4">Estado Cuenta</th>
						<th class="p-4 w-48">Rol Asignado</th>
						<th class="p-4 text-center">Acciones</th>
					</tr>
				</thead>
				<tbody class="divide-y divide-slate-100">
					{#each empleados as emp}
						<tr class="hover:bg-slate-50 transition-colors">
							<td class="p-4">
								<div class="flex items-center gap-3">
									<div class="w-10 h-10 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center font-bold">
										{emp.nombre.charAt(0).toUpperCase()}
									</div>
									<div>
										<div class="font-bold text-slate-800">{emp.nombre}</div>
										<div class="text-[10px] text-slate-400 capitalize">
											<!-- @ts-ignore -->
											{emp.roles?.nombre || 'Sin Rol'}
										</div>
									</div>
								</div>
							</td>
							<td class="p-4">
								{#if emp.telefono}
									<div class="flex items-center gap-2 text-slate-600">
										<i class="fas fa-phone-alt text-slate-400 text-xs"></i>
										{emp.telefono}
									</div>
								{:else}
									<span class="text-slate-400 italic text-xs">No registrado</span>
								{/if}
							</td>
							<td class="p-4">
								{#if emp.auth_user_id}
									<span class="px-2 py-1 bg-green-100 text-green-700 rounded text-xs font-semibold"><i class="fas fa-link"></i> Vinculada</span>
								{:else}
									<span class="px-2 py-1 bg-orange-100 text-orange-700 rounded text-xs font-semibold"><i class="fas fa-unlink"></i> Sin vincular</span>
								{/if}
							</td>
							<td class="p-4">
								<select 
									class="w-full text-sm p-2 border rounded-lg bg-slate-50 focus:ring-1 focus:ring-blue-500 outline-none capitalize"
									onchange={(e) => updateRole(emp.id, parseInt(e.currentTarget.value))}
								>
									<option value="" disabled selected={!emp.rol_id}>Selecciona un rol</option>
									{#each roles as rol}
										<option value={rol.id} selected={emp.rol_id === rol.id}>{rol.nombre}</option>
									{/each}
								</select>
							</td>
							<td class="p-4 text-center">
								<button class="text-slate-400 hover:text-blue-600 mx-1" title="Editar detalles"><i class="fas fa-edit"></i></button>
								<button class="text-slate-400 hover:text-red-500 mx-1" title="Revocar acceso"><i class="fas fa-ban"></i></button>
							</td>
						</tr>
					{/each}
					{#if empleados.length === 0}
						<tr>
							<td colspan="5" class="p-8 text-center text-slate-500">No hay empleados registrados o no tienes permiso para verlos.</td>
						</tr>
					{/if}
				</tbody>
			</table>
		</div>
	{/if}
</div>

{#if isModalOpen}
	<div class="fixed inset-0 bg-slate-900/50 backdrop-blur-xs z-50 flex items-center justify-center p-4 transition-all duration-300">
		<div class="bg-white rounded-3xl shadow-2xl border border-slate-100 max-w-2xl w-full overflow-hidden flex flex-col max-h-[90vh] scale-100 transition-transform duration-300">
			<!-- Header -->
			<div class="bg-slate-50 border-b border-slate-100 px-6 py-4 flex items-center justify-between">
				<div class="flex items-center gap-2">
					<div class="w-8 h-8 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center">
						<i class="fas fa-user-plus text-sm"></i>
					</div>
					<h3 class="font-bold text-slate-800 text-base">Registrar Nuevo Empleado</h3>
				</div>
				<button onclick={() => { isModalOpen = false; resetForm(); }} class="text-slate-400 hover:text-slate-600 text-lg p-1">
					<i class="fas fa-times"></i>
				</button>
			</div>
			
			<!-- Content -->
			<form onsubmit={(e) => { e.preventDefault(); agregarEmpleado(); }} class="flex-1 overflow-y-auto p-6 space-y-6">
				<!-- Section 1: Personal Info -->
				<div>
					<h4 class="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Información Personal</h4>
					<div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
						<div>
							<label class="block text-xs font-semibold text-slate-600 mb-1">Nombre Completo *</label>
							<input type="text" bind:value={nuevoNombre} placeholder="Nombre y Apellidos" required class="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:bg-white outline-none transition-all text-sm" />
						</div>
						<div>
							<label class="block text-xs font-semibold text-slate-600 mb-1">Teléfono</label>
							<input type="text" bind:value={nuevoTelefono} placeholder="987654321" class="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:bg-white outline-none transition-all text-sm" />
						</div>
					</div>
				</div>
				
				<!-- Section 2: Roles and Areas -->
				<div>
					<h4 class="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Asignación de Roles y Áreas</h4>
					<div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
						<div>
							<label class="block text-xs font-semibold text-slate-600 mb-1">Rol de Acceso</label>
							<select bind:value={nuevoRolId} class="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:bg-white outline-none transition-all text-sm">
								<option value={null}>Sin Rol / Acceso Restringido</option>
								{#each roles as rol}
									<option value={rol.id}>{rol.nombre}</option>
								{/each}
							</select>
						</div>
						<div>
							<label class="block text-xs font-semibold text-slate-600 mb-1">Área / Departamento</label>
							<select bind:value={nuevoAreaId} class="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:bg-white outline-none transition-all text-sm">
								<option value={null}>Sin Área Asignada</option>
								{#each areas as area}
									<option value={area.id}>{area.nombre}</option>
								{/each}
							</select>
						</div>
					</div>
				</div>

				<!-- Section 3: Financials and Labour -->
				<div>
					<h4 class="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Detalles Financieros y Laborales</h4>
					<div class="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
						<div>
							<label class="block text-xs font-semibold text-slate-600 mb-1">Salario Fijo (S/.) *</label>
							<input type="number" step="0.01" min="0" bind:value={nuevoSalario} required class="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:bg-white outline-none transition-all text-sm" />
						</div>
						<div>
							<label class="block text-xs font-semibold text-slate-600 mb-1">Horas Mensuales</label>
							<input type="number" step="0.1" min="0" bind:value={nuevasHoras} class="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:bg-white outline-none transition-all text-sm" />
						</div>
						<div>
							<label class="block text-xs font-semibold text-slate-600 mb-1">Periodo de Pago</label>
							<select bind:value={nuevoPeriodo} class="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:bg-white outline-none transition-all text-sm">
								<option value="Mensual">Mensual</option>
								<option value="Quincenal">Quincenal</option>
								<option value="Semanal">Semanal</option>
								<option value="Diario">Diario</option>
							</select>
						</div>
					</div>
					<div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
						<div>
							<label class="block text-xs font-semibold text-slate-600 mb-1">Fecha de Ingreso *</label>
							<input type="date" bind:value={nuevaFechaIngreso} required class="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:bg-white outline-none transition-all text-sm" />
						</div>
						<div>
							<label class="block text-xs font-semibold text-slate-600 mb-1">Nivel Laboral</label>
							<input type="text" bind:value={nuevoNivel} placeholder="Junior, Senior, Practicante..." class="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:bg-white outline-none transition-all text-sm" />
						</div>
					</div>
				</div>

				<!-- Section 4: Security and Auth Link -->
				<div>
					<h4 class="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Acceso y Autenticación (Opcional)</h4>
					<div>
						<label class="block text-xs font-semibold text-slate-600 mb-1">ID de Usuario en Auth (UUID)</label>
						<input type="text" bind:value={nuevoAuthUserId} placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" class="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:bg-white outline-none transition-all text-sm font-mono" />
						<span class="text-[10px] text-slate-400 mt-1 block">Si el usuario ya se registró, ingresa su ID de Supabase Auth para vincular la cuenta.</span>
					</div>
				</div>
				
				<!-- Footer / Buttons -->
				<div class="pt-4 border-t border-slate-100 flex justify-end gap-3">
					<button type="button" onclick={() => { isModalOpen = false; resetForm(); }} class="px-4 py-2.5 bg-slate-100 text-slate-700 rounded-xl hover:bg-slate-200 text-sm font-medium transition-colors">
						Cancelar
					</button>
					<button type="submit" disabled={isSaving} class="px-5 py-2.5 bg-blue-600 text-white rounded-xl hover:bg-blue-700 text-sm font-medium shadow-md shadow-blue-600/10 disabled:opacity-70 flex items-center gap-2 transition-colors">
						{#if isSaving}
							<i class="fas fa-spinner fa-spin"></i> Guardando...
						{:else}
							<i class="fas fa-save"></i> Guardar Empleado
						{/if}
					</button>
				</div>
			</form>
		</div>
	</div>
{/if}
