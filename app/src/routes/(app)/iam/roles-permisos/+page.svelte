<script lang="ts">
	import { onMount } from 'svelte';
	import { supabase } from '$lib/supabaseClient';

	type Rol = { id: number; nombre: string; descripcion: string };
	type Permiso = { id: number; nombre: string; descripcion: string };

	let roles = $state<Rol[]>([]);
	let permisos = $state<Permiso[]>([]);
	let rolesPermisos = $state<{ rol_id: number; permiso_id: number }[]>([]);
	let isLoading = $state(true);

	// Configuración de la matriz agrupada
	const modulesConfig = [
		{
			id: 'dashboard', name: 'Dashboard', icon: 'fas fa-home', colorClass: 'text-purple-600 bg-purple-50 border-purple-100',
			submodules: [{ key: 'ver_dashboard', label: 'Panel Principal' }]
		},
		{
			id: 'comercial', name: 'Comercial', icon: 'fas fa-shopping-cart', colorClass: 'text-emerald-600 bg-emerald-50 border-emerald-100',
			submodules: [
				{ key: 'ver_comercial', label: 'General Comercial' },
				{ key: 'ver_comercial_ventas', label: 'Ventas' },
				{ key: 'ver_comercial_clientes', label: 'Clientes' },
				{ key: 'ver_comercial_proveedores', label: 'Proveedores' }
			]
		},
		{
			id: 'proyectos', name: 'Proyectos', icon: 'fas fa-hard-hat', colorClass: 'text-orange-600 bg-orange-50 border-orange-100',
			submodules: [
				{ key: 'ver_proyectos', label: 'General Proyectos' },
				{ key: 'ver_proyectos_dashboard', label: 'Dashboard Proyectos' },
				{ key: 'ver_proyectos_gestion', label: 'Gestión de Proyectos' }
			]
		},
		{
			id: 'finanzas', name: 'Finanzas', icon: 'fas fa-dollar-sign', colorClass: 'text-blue-600 bg-blue-50 border-blue-100',
			submodules: [
				{ key: 'ver_finanzas', label: 'General Finanzas' },
				{ key: 'ver_finanzas_centros_costos', label: 'Centros de Costos' },
				{ key: 'ver_finanzas_cuentas_pendientes', label: 'Cuentas Pendientes' },
				{ key: 'ver_finanzas_transacciones', label: 'Transacciones' }
			]
		},
		{
			id: 'recursos_humanos', name: 'Recursos Humanos', icon: 'fas fa-users', colorClass: 'text-pink-600 bg-pink-50 border-pink-100',
			submodules: [{ key: 'ver_empleados', label: 'Empleados' }]
		},
		{
			id: 'configuracion', name: 'Configuración', icon: 'fas fa-cog', colorClass: 'text-slate-600 bg-slate-50 border-slate-200',
			submodules: [
				{ key: 'ver_iam', label: 'Control de Accesos' },
				{ key: 'ver_roles_permisos', label: 'Roles y Permisos' }
			]
		}
	];

	let structuredModules = $derived(
		modulesConfig.map(mod => {
			return {
				...mod,
				submodules: mod.submodules.map(sub => {
					const dbPermiso = permisos.find(p => p.nombre === sub.key);
					return {
						...sub,
						dbId: dbPermiso ? dbPermiso.id : null,
						descripcion: dbPermiso ? dbPermiso.descripcion : ''
					};
				}).filter(sub => sub.dbId !== null)
			};
		}).filter(mod => mod.submodules.length > 0)
	);

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
						<th class="p-4 border-r border-slate-100 bg-slate-100 sticky left-0 z-10 min-w-[140px]">Módulo</th>
						<th class="p-4 border-r border-slate-100 bg-slate-100 sticky left-[140px] z-10 min-w-[160px]">Submódulo</th>
						<th class="p-4 border-r border-slate-100 bg-slate-100 sticky left-[300px] z-10 min-w-[200px]">Descripción</th>
						{#each roles as rol}
							<th class="p-4 text-center border-r border-slate-100 min-w-[180px] group">
								<div class="font-bold text-slate-800 capitalize text-sm">{rol.nombre}</div>
								<div class="text-[10px] text-slate-400 font-normal truncate mt-0.5 max-w-[140px] mx-auto" title={rol.descripcion}>{rol.descripcion || 'Sin descripción'}</div>
								
								<!-- Botones CRUD explícitos (siempre visibles) -->
								<div class="flex justify-center gap-2 mt-3 opacity-100 transition-opacity">
									<button onclick={() => abrirModalEditarRol(rol)} class="px-2 py-1 text-[11px] rounded bg-slate-100 hover:bg-blue-100 text-slate-600 hover:text-blue-700 font-medium transition-colors border border-slate-200 hover:border-blue-200 flex items-center gap-1" title="Editar Rol">
										<i class="fas fa-edit"></i> Editar
									</button>
									{#if rol.nombre !== 'administrador'}
										<button onclick={() => eliminarRol(rol.id, rol.nombre)} class="px-2 py-1 text-[11px] rounded bg-slate-100 hover:bg-rose-100 text-slate-600 hover:text-rose-700 font-medium transition-colors border border-slate-200 hover:border-rose-200 flex items-center gap-1" title="Eliminar Rol">
											<i class="fas fa-trash-alt"></i> Borrar
										</button>
									{/if}
								</div>
							</th>
						{/each}
					</tr>
				</thead>
				<tbody class="divide-y divide-slate-100">
					{#each structuredModules as mod}
						{#each mod.submodules as sub, index}
							<tr class="hover:bg-slate-50 transition-colors">
								{#if index === 0}
									<td class="p-4 border-r border-slate-100 align-top sticky left-0 bg-white z-10" rowspan={mod.submodules.length}>
										<div class={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border ${mod.colorClass} font-semibold text-sm`}>
											<i class={mod.icon}></i> {mod.name}
										</div>
									</td>
								{/if}
								<td class="p-4 border-r border-slate-100 sticky left-[140px] bg-white z-10">
									<div class="font-bold text-slate-700">{sub.label}</div>
								</td>
								<td class="p-4 border-r border-slate-100 sticky left-[300px] bg-white z-10">
									<div class="text-xs text-slate-500">{sub.descripcion}</div>
								</td>
								{#each roles as rol}
									{@const isChecked = hasPermiso(rol.id, sub.dbId!)}
									<td class="p-4 text-center border-r border-slate-100 align-middle">
										<label class="flex items-center justify-center cursor-pointer w-full h-full group/chk">
											<div class="relative flex items-center justify-center">
												<input 
													type="checkbox" 
													checked={isChecked}
													onchange={() => togglePermiso(rol.id, sub.dbId!, isChecked)}
													disabled={rol.nombre === 'administrador'}
													class={`w-5 h-5 rounded cursor-pointer appearance-none outline-none ring-offset-1 transition-all ${
														isChecked 
															? 'bg-blue-600 ring-2 ring-blue-600 border-transparent' 
															: 'bg-white border-2 border-slate-300 group-hover/chk:border-blue-400 group-hover/chk:bg-blue-50'
													} ${rol.nombre === 'administrador' ? 'opacity-70 cursor-not-allowed' : ''}`}
												/>
												{#if isChecked}
													<i class="fas fa-check absolute text-white text-xs pointer-events-none"></i>
												{/if}
											</div>
										</label>
									</td>
								{/each}
							</tr>
						{/each}
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
