<script lang="ts">
	import { onMount } from 'svelte';
	import { supabase } from '$lib/supabaseClient';

	type Rol = { id: number; nombre: string; descripcion: string };
	type Permiso = { id: number; nombre: string; descripcion: string };

	let roles = $state<Rol[]>([]);
	let permisos = $state<Permiso[]>([]);
	let rolesPermisos = $state<{ rol_id: number; permiso_id: number }[]>([]);
	let isLoading = $state(true);

	// Estado para modal de Roles
	let isRoleModalOpen = $state(false);
	let isSavingRole = $state(false);
	let editingRoleId = $state<number | null>(null);
	let nuevoRolNombre = $state('');
	let nuevoRolDescripcion = $state('');
	let modalError = $state('');

	onMount(async () => {
		try {
			const { data: rData } = await supabase.from('roles').select('*').order('id');
			if (rData) roles = rData;

			const { data: pData } = await supabase.from('permisos').select('*').order('id');
			if (pData) permisos = pData;

			const { data: rpData } = await supabase.from('roles_permisos').select('*');
			if (rpData) rolesPermisos = rpData;
		} catch (error) {
			console.error("Error al cargar roles y permisos:", error);
		} finally {
			isLoading = false;
		}
	});

	// ==========================================
	// CRUD DE ROLES
	// ==========================================
	function abrirModalNuevoRol() {
		editingRoleId = null;
		nuevoRolNombre = '';
		nuevoRolDescripcion = '';
		modalError = '';
		isRoleModalOpen = true;
	}

	function abrirModalEditarRol(rol: Rol) {
		editingRoleId = rol.id;
		nuevoRolNombre = rol.nombre;
		nuevoRolDescripcion = rol.descripcion || '';
		modalError = '';
		isRoleModalOpen = true;
	}

	async function guardarRol() {
		if (!nuevoRolNombre.trim()) {
			modalError = "El nombre del rol es obligatorio.";
			return;
		}

		isSavingRole = true;
		modalError = '';

		try {
			const payload = {
				nombre: nuevoRolNombre.trim().toLowerCase(),
				descripcion: nuevoRolDescripcion.trim()
			};

			if (editingRoleId) {
				// Actualizar
				const { data, error } = await supabase
					.from('roles')
					.update(payload)
					.eq('id', editingRoleId)
					.select()
					.single();

				if (error) throw error;
				roles = roles.map(r => r.id === editingRoleId ? data : r);
			} else {
				// Crear
				const { data, error } = await supabase
					.from('roles')
					.insert([payload])
					.select()
					.single();

				if (error) throw error;
				roles = [...roles, data];
			}
			isRoleModalOpen = false;
		} catch (error: any) {
			console.error("Error al guardar rol:", error);
			modalError = error.message || "Error al guardar el rol. Revisa que el nombre no esté duplicado.";
		} finally {
			isSavingRole = false;
		}
	}

	async function eliminarRol(id: number, nombre: string) {
		const ok = confirm(`¿Estás seguro de eliminar el rol "${nombre}"?\nEsta acción afectará a todos los empleados con este rol asignado.`);
		if (!ok) return;

		try {
			const { error } = await supabase.from('roles').delete().eq('id', id);
			if (error) throw error;
			
			// Actualizar UI localmente
			roles = roles.filter(r => r.id !== id);
			rolesPermisos = rolesPermisos.filter(rp => rp.rol_id !== id);
		} catch (error: any) {
			console.error("Error al eliminar rol:", error);
			alert("Error al eliminar el rol: " + error.message);
		}
	}

	// ==========================================
	// GESTIÓN DE MATRIZ DE PERMISOS
	// ==========================================
	function hasPermiso(rolId: number, permisoId: number) {
		return rolesPermisos.some(rp => rp.rol_id === rolId && rp.permiso_id === permisoId);
	}

	async function togglePermiso(rolId: number, permisoId: number, currentStatus: boolean) {
		const isAdding = !currentStatus;
		try {
			if (isAdding) {
				await supabase.from('roles_permisos').insert({ rol_id: rolId, permiso_id: permisoId });
				rolesPermisos = [...rolesPermisos, { rol_id: rolId, permiso_id: permisoId }];
			} else {
				await supabase.from('roles_permisos').delete().match({ rol_id: rolId, permiso_id: permisoId });
				rolesPermisos = rolesPermisos.filter(rp => !(rp.rol_id === rolId && rp.permiso_id === permisoId));
			}
		} catch (error) {
			console.error("Error al cambiar permiso:", error);
			alert("Error al guardar el permiso. Verifica que seas administrador.");
		}
	}
</script>

<svelte:head>
	<title>Roles y Permisos | Construni ERP</title>
</svelte:head>

<div class="mb-6">
	<div class="text-xs text-slate-500 mb-2">IAM &nbsp;>&nbsp; Roles y Permisos</div>
	<div class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
		<div>
			<h2 class="text-2xl font-semibold text-brand-marine">Matriz de Roles y Accesos</h2>
			<p class="text-sm text-slate-500 mt-1">Crea nuevos roles y administra la visibilidad de los módulos marcando o desmarcando los permisos.</p>
		</div>
		<button 
			onclick={abrirModalNuevoRol}
			class="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-medium shadow-md shadow-blue-600/10 active:scale-[0.98] transition-all flex items-center gap-2"
		>
			<i class="fas fa-plus"></i> Crear Nuevo Rol
		</button>
	</div>
</div>

<div class="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden p-6">
	{#if isLoading}
		<div class="flex justify-center text-blue-600 text-2xl py-8">
			<i class="fas fa-spinner fa-spin"></i>
		</div>
	{:else}
		<div class="overflow-x-auto pb-4">
			<table class="w-full text-sm text-left border-collapse min-w-[600px]">
				<thead class="text-xs text-slate-500 bg-slate-50 font-medium uppercase border-b border-slate-200">
					<tr>
						<th class="p-4 border-r border-slate-100 bg-slate-100 sticky left-0 z-10 w-64">Módulos \ Roles</th>
						{#each roles as rol}
							<th class="p-4 text-center border-r border-slate-100 min-w-[160px] relative group">
								<div class="font-bold text-slate-800 capitalize">{rol.nombre}</div>
								<div class="text-[10px] text-slate-400 font-normal truncate mt-1 max-w-[140px] mx-auto" title={rol.descripcion}>{rol.descripcion || 'Sin descripción'}</div>
								
								<!-- Hover Acciones de Rol -->
								<div class="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity flex gap-1">
									<button onclick={() => abrirModalEditarRol(rol)} class="w-6 h-6 rounded bg-slate-200 hover:bg-blue-100 text-slate-500 hover:text-blue-600 flex items-center justify-center transition-colors shadow-xs" title="Editar Rol">
										<i class="fas fa-edit text-[10px]"></i>
									</button>
									{#if rol.nombre !== 'administrador'}
										<button onclick={() => eliminarRol(rol.id, rol.nombre)} class="w-6 h-6 rounded bg-slate-200 hover:bg-rose-100 text-slate-500 hover:text-rose-600 flex items-center justify-center transition-colors shadow-xs" title="Eliminar Rol">
											<i class="fas fa-trash-alt text-[10px]"></i>
										</button>
									{/if}
								</div>
							</th>
						{/each}
					</tr>
				</thead>
				<tbody class="divide-y divide-slate-100">
					{#each permisos as permiso}
						<tr class="hover:bg-slate-50 transition-colors">
							<td class="p-4 border-r border-slate-100 sticky left-0 bg-white group-hover:bg-slate-50 z-10">
								<div class="font-bold text-slate-700">{permiso.nombre}</div>
								<div class="text-xs text-slate-400 mt-0.5 max-w-xs">{permiso.descripcion}</div>
							</td>
							{#each roles as rol}
								{@const isChecked = hasPermiso(rol.id, permiso.id)}
								<td class="p-4 text-center border-r border-slate-100 align-middle">
									<label class="flex items-center justify-center cursor-pointer w-full h-full">
										<input 
											type="checkbox" 
											checked={isChecked}
											onchange={() => togglePermiso(rol.id, permiso.id, isChecked)}
											class="w-5 h-5 text-blue-600 bg-slate-100 border-slate-300 rounded focus:ring-blue-500 focus:ring-2 cursor-pointer transition-all"
										/>
									</label>
								</td>
							{/each}
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
		<div class="mt-4 p-4 bg-blue-50 border border-blue-100 rounded-xl flex items-start gap-3 text-sm text-blue-800">
			<i class="fas fa-info-circle mt-0.5"></i>
			<p>Pasa el ratón sobre el encabezado de un rol para ver las opciones de editar o eliminar. Al crear un nuevo rol, este aparecerá automáticamente tanto en esta matriz como en el selector de la pantalla de Empleados.</p>
		</div>
	{/if}
</div>

<!-- Modal CREAR / EDITAR ROL -->
{#if isRoleModalOpen}
	<div class="fixed inset-0 bg-slate-900/50 backdrop-blur-xs z-50 flex items-center justify-center p-4 transition-all duration-300">
		<div class="bg-white rounded-3xl shadow-2xl border border-slate-100 max-w-md w-full overflow-hidden flex flex-col scale-100 transition-transform duration-300">
			<!-- Header -->
			<div class="bg-slate-50 border-b border-slate-100 px-6 py-4 flex items-center justify-between">
				<div class="flex items-center gap-2">
					<div class="w-8 h-8 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center">
						<i class="fas fa-shield-alt text-sm"></i>
					</div>
					<h3 class="font-bold text-slate-800 text-base">{editingRoleId ? 'Editar Rol' : 'Crear Nuevo Rol'}</h3>
				</div>
				<button onclick={() => isRoleModalOpen = false} class="text-slate-400 hover:text-slate-600 text-lg p-1">
					<i class="fas fa-times"></i>
				</button>
			</div>
			
			<!-- Content -->
			<form onsubmit={(e) => { e.preventDefault(); guardarRol(); }} class="p-6 space-y-4">
				{#if modalError}
					<div class="p-3 rounded-xl bg-rose-50 border border-rose-100 text-xs text-rose-700 font-medium">
						<i class="fas fa-exclamation-triangle mr-1"></i> {modalError}
					</div>
				{/if}

				<div>
					<label class="block text-xs font-semibold text-slate-600 mb-1">Nombre del Rol *</label>
					<input type="text" bind:value={nuevoRolNombre} placeholder="ej. supervisor" disabled={editingRoleId && nuevoRolNombre === 'administrador'} required class="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:bg-white outline-none transition-all text-sm disabled:opacity-50" />
					<p class="text-[10px] text-slate-400 mt-1">Se guardará en minúsculas. Evita espacios.</p>
				</div>
				<div>
					<label class="block text-xs font-semibold text-slate-600 mb-1">Descripción</label>
					<textarea bind:value={nuevoRolDescripcion} placeholder="Breve descripción de las responsabilidades..." rows="3" class="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:bg-white outline-none transition-all text-sm resize-none"></textarea>
				</div>
				
				<!-- Footer / Buttons -->
				<div class="pt-4 border-t border-slate-100 flex justify-end gap-3 mt-6">
					<button type="button" onclick={() => isRoleModalOpen = false} class="px-4 py-2 bg-slate-100 text-slate-700 rounded-xl hover:bg-slate-200 text-sm font-medium transition-colors">
						Cancelar
					</button>
					<button type="submit" disabled={isSavingRole} class="px-5 py-2 bg-blue-600 text-white rounded-xl hover:bg-blue-700 text-sm font-medium shadow-md shadow-blue-600/10 disabled:opacity-70 flex items-center gap-2 transition-colors">
						{#if isSavingRole}
							<i class="fas fa-spinner fa-spin"></i> Guardando...
						{:else}
							<i class="fas fa-save"></i> Guardar Rol
						{/if}
					</button>
				</div>
			</form>
		</div>
	</div>
{/if}
