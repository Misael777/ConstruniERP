<script lang="ts">
	import { onMount } from 'svelte';
	import { supabase } from '$lib/supabaseClient';

	type Rol = { id: number; nombre: string; descripcion: string };
	type Empleado = { id: number; nombre: string; telefono: string; rol_id: number; auth_user_id: string; roles?: { nombre: string } };

	let empleados = $state<Empleado[]>([]);
	let roles = $state<Rol[]>([]);
	let isLoading = $state(true);
	let statusMessage = $state({ type: '', text: '' });

	onMount(async () => {
		try {
			// Cargar roles
			const { data: rolesData, error: rolesError } = await supabase.from('roles').select('*').order('id');
			if (rolesError) throw rolesError;
			roles = rolesData || [];

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
		<button class="px-4 py-2 bg-blue-600 text-white rounded-xl hover:bg-blue-700 text-sm font-medium shadow-md"><i class="fas fa-user-plus"></i> Nuevo Empleado</button>
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
