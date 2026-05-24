<script lang="ts">
	import { onMount } from 'svelte';
	import { supabase } from '$lib/supabaseClient';
	import { hasPermiso, permisosState } from '$lib/stores/permisos.svelte';

	type Rol = { id: number; nombre: string; descripcion: string };
	type Permiso = { id: number; nombre: string; descripcion: string };
	type RolPermiso = { rol_id: number; permiso_id: number };

	let roles = $state<Rol[]>([]);
	let permisos = $state<Permiso[]>([]);
	let rolesPermisos = $state<RolPermiso[]>([]);
	let isLoading = $state(true);
	let statusMessage = $state({ type: '', text: '' });

	// Modal states
	let isModalOpen = $state(false);
	let isSaving = $state(false);
	let modalError = $state('');
	let editingRolId = $state<number | null>(null);

	// Form states
	let nuevoNombre = $state('');
	let nuevoDescripcion = $state('');
	let seleccionadoPermisos = $state<Record<number, boolean>>({});

	function onInputChange() {
		if (modalError) {
			modalError = '';
		}
	}

	async function checkAndSeedPermisos() {
		try {
			console.log("[Roles/Permisos] Verificando catálogo de permisos...");
			const { count, error } = await supabase
				.from('permisos')
				.select('*', { count: 'exact', head: true });
			if (error) throw error;

			if (!count || count === 0) {
				console.log("[Roles/Permisos] Sembrando lista de permisos por defecto...");
				const defaultPermisos = [
					{ nombre: 'dashboard:read', descripcion: 'Permite ver el panel de control principal (Dashboard).' },
					{ nombre: 'proyectos:read', descripcion: 'Permite ver las obras y proyectos activos.' },
					{ nombre: 'proyectos:write', descripcion: 'Permite crear, modificar y eliminar obras/proyectos.' },
					{ nombre: 'compras:read', descripcion: 'Permite visualizar la lista de compras del sistema.' },
					{ nombre: 'compras:write', descripcion: 'Permite crear, editar y eliminar compras/gastos.' },
					{ nombre: 'almacen:read', descripcion: 'Permite visualizar el stock e inventario de almacén.' },
					{ nombre: 'almacen:write', descripcion: 'Permite modificar existencias y almacenes.' },
					{ nombre: 'ventas:read', descripcion: 'Permite visualizar contratos y ventas.' },
					{ nombre: 'ventas:write', descripcion: 'Permite registrar y modificar ventas/contratos.' },
					{ nombre: 'finanzas:read', descripcion: 'Permite visualizar reportes financieros y KPIs.' },
					{ nombre: 'finanzas:write', descripcion: 'Permite registrar cobros, pagos y conciliar cuentas.' },
					{ nombre: 'recursos_humanos:read', descripcion: 'Permite ver la lista de personal y salarios.' },
					{ nombre: 'recursos_humanos:write', descripcion: 'Permite registrar empleados y modificar sus detalles.' },
					{ nombre: 'iam:read', descripcion: 'Permite ver los usuarios y sus accesos asignados.' },
					{ nombre: 'iam:write', descripcion: 'Permite administrar cuentas de usuario, roles de acceso y credenciales.' },
					{ nombre: 'configuracion:read', descripcion: 'Permite ver configuraciones generales de la empresa.' },
					{ nombre: 'configuracion:write', descripcion: 'Permite actualizar datos de empresa, roles y permisos.' }
				];
				const { data: seededPermisos, error: seedError } = await supabase
					.from('permisos')
					.insert(defaultPermisos)
					.select('id');
				if (seedError) throw seedError;
				console.log("[Roles/Permisos] Permisos sembrados correctamente.");

				// Auto-asignar todos los permisos al rol administrador
				if (seededPermisos && seededPermisos.length > 0) {
					const { data: adminRol } = await supabase
						.from('roles')
						.select('id')
						.eq('nombre', 'administrador')
						.single();

					if (adminRol) {
						const adminPermMappings = seededPermisos.map((p: { id: number }) => ({
							rol_id: adminRol.id,
							permiso_id: p.id
						}));
						const { error: adminPermError } = await supabase
							.from('roles_permisos')
							.insert(adminPermMappings);
						if (adminPermError) {
							console.warn("[Roles/Permisos] No se pudieron asignar todos los permisos al administrador:", adminPermError.message);
						} else {
							console.log("[Roles/Permisos] Todos los permisos asignados al rol administrador.");
						}
					}
				}
			} else {
				// Permisos ya existen: verificar que administrador tiene todos los permisos
				console.log("[Roles/Permisos] Verificando que administrador tiene todos los permisos...");
				const { data: adminRol } = await supabase
					.from('roles')
					.select('id')
					.eq('nombre', 'administrador')
					.single();

				const { data: todosPermisos } = await supabase
					.from('permisos')
					.select('id');

				if (adminRol && todosPermisos && todosPermisos.length > 0) {
					const { data: adminPermsActuales } = await supabase
						.from('roles_permisos')
						.select('permiso_id')
						.eq('rol_id', adminRol.id);

					const asignadosIds = new Set((adminPermsActuales || []).map((rp: { permiso_id: number }) => rp.permiso_id));
					const faltantes = todosPermisos.filter((p: { id: number }) => !asignadosIds.has(p.id));

					if (faltantes.length > 0) {
						const { error: fillError } = await supabase
							.from('roles_permisos')
							.insert(faltantes.map((p: { id: number }) => ({ rol_id: adminRol.id, permiso_id: p.id })));
						if (!fillError) {
							console.log(`[Roles/Permisos] ${faltantes.length} permiso(s) faltante(s) asignado(s) al administrador.`);
						}
					}
				}
			}
		} catch (err: any) {
			console.error("[Roles/Permisos Error] Error al sembrar/verificar permisos:", err);
		}
	}


	async function cargarDatos() {
		try {
			isLoading = true;
			console.log('[Roles/Permisos UI] --- VERIFICACIÓN DE PERMISOS ---');
			console.log('[Roles/Permisos UI] Permisos del usuario en el FrontEnd (Memory Store):', JSON.stringify(permisosState.permisos));
			
			// Obtener la sesión y consultar directamente los permisos guardados en la BD para este usuario
			const sessionRes = await supabase.auth.getSession();
			const userId = sessionRes.data.session?.user?.id;
			if (userId) {
				console.log('[Roles/Permisos UI] ID de Usuario de Auth:', userId);
				const { data: empleado, error: empError } = await supabase
					.from('empleados')
					.select(`
						nombre,
						rol_id,
						roles ( nombre )
					`)
					.eq('auth_user_id', userId)
					.single();

				if (empError) {
					console.error('[Roles/Permisos UI] Error al consultar empleado en BD:', empError);
				} else if (empleado) {
					const rolesObj: any = Array.isArray(empleado.roles) ? empleado.roles[0] : empleado.roles;
					console.log('[Roles/Permisos UI] Rol de Empleado en BD:', rolesObj?.nombre, '(ID:', empleado.rol_id, ')');
					
					if (empleado.rol_id) {
						const { data: permsData, error: permsError } = await supabase
							.from('roles_permisos')
							.select('permisos(nombre)')
							.eq('rol_id', empleado.rol_id);

						if (permsError) {
							console.error('[Roles/Permisos UI] Error al consultar permisos del rol en BD:', permsError);
						} else {
							const dbPerms = (permsData ?? [])
								.map((p: any) => Array.isArray(p.permisos) ? p.permisos[0]?.nombre : p.permisos?.nombre)
								.filter(Boolean);
							console.log('[Roles/Permisos UI] Permisos del usuario en la BD (roles_permisos):', JSON.stringify(dbPerms));
							console.log('[Roles/Permisos UI] Comparativa Front-End vs BD:', {
								frontend: permisosState.permisos,
								database: dbPerms,
								match: JSON.stringify(permisosState.permisos.sort()) === JSON.stringify(dbPerms.sort()) || permisosState.permisos.includes('*')
							});
						}
					}
				}
			}
			console.log('[Roles/Permisos UI] --------------------------------');

			// 1. Sembrar si es necesario
			await checkAndSeedPermisos();

			// 2. Cargar Roles
			const { data: rolesData, error: rolesError } = await supabase.from('roles').select('*').order('id');
			if (rolesError) throw rolesError;
			roles = rolesData || [];

			// 3. Cargar Permisos
			const { data: permisosData, error: permisosError } = await supabase.from('permisos').select('*').order('nombre');
			if (permisosError) throw permisosError;
			permisos = permisosData || [];

			// 4. Cargar Mapeo de Roles y Permisos
			const { data: mappingData, error: mappingError } = await supabase.from('roles_permisos').select('*');
			if (mappingError) throw mappingError;
			rolesPermisos = mappingData || [];

		} catch (error: any) {
			console.error("[Roles/Permisos Error] Error al cargar datos iniciales:", error);
			showStatus('error', 'Error al cargar los roles y permisos de la base de datos.');
		} finally {
			isLoading = false;
		}
	}

	onMount(() => {
		cargarDatos();
	});

	function showStatus(type: 'success' | 'error', text: string) {
		statusMessage = { type, text };
		setTimeout(() => {
			statusMessage = { type: '', text: '' };
		}, 3000);
	}

	function prepararEdicion(rol: Rol) {
		editingRolId = rol.id;
		nuevoNombre = rol.nombre;
		nuevoDescripcion = rol.descripcion || '';
		
		// Resetear y mapear permisos activos
		seleccionadoPermisos = {};
		rolesPermisos
			.filter(rp => rp.rol_id === rol.id)
			.forEach(rp => {
				seleccionadoPermisos[rp.permiso_id] = true;
			});

		modalError = '';
		isModalOpen = true;
	}

	function resetForm() {
		editingRolId = null;
		nuevoNombre = '';
		nuevoDescripcion = '';
		seleccionadoPermisos = {};
		modalError = '';
	}

	async function guardarRol() {
		modalError = '';
		if (!hasPermiso('configuracion:write')) {
			modalError = 'No tienes permiso de escritura (configuracion:write) para guardar o modificar roles.';
			console.warn('[Roles/Permisos UI] Blocked: Save role requested without configuracion:write permission');
			return;
		}

		if (!nuevoNombre.trim()) {
			modalError = 'El nombre del rol es obligatorio';
			return;
		}

		isSaving = true;
		try {
			const activePermIds = Object.keys(seleccionadoPermisos)
				.filter(id => seleccionadoPermisos[Number(id)])
				.map(Number);

			if (editingRolId) {
				// EDITAR ROL EXISTENTE
				console.log(`[Roles/Permisos] Editando rol ID ${editingRolId}...`);
				const { error: rolError } = await supabase
					.from('roles')
					.update({
						nombre: nuevoNombre.trim().toLowerCase(),
						descripcion: nuevoDescripcion.trim()
					})
					.eq('id', editingRolId);

				if (rolError) throw rolError;

				// Actualizar mapeo de permisos (eliminar anteriores e insertar nuevos)
				const { error: delError } = await supabase
					.from('roles_permisos')
					.delete()
					.eq('rol_id', editingRolId);

				if (delError) throw delError;

				if (activePermIds.length > 0) {
					const { error: insError } = await supabase
						.from('roles_permisos')
						.insert(activePermIds.map(permId => ({ rol_id: editingRolId!, permiso_id: permId })));

					if (insError) throw insError;
				}

				showStatus('success', `Rol '${nuevoNombre.trim()}' actualizado correctamente.`);
			} else {
				// CREAR NUEVO ROL
				console.log(`[Roles/Permisos] Creando nuevo rol '${nuevoNombre}'...`);
				const { data: newRol, error: rolError } = await supabase
					.from('roles')
					.insert([{
						nombre: nuevoNombre.trim().toLowerCase(),
						descripcion: nuevoDescripcion.trim()
					}])
					.select()
					.single();

				if (rolError) {
					if (rolError.code === '23505') {
						throw new Error('Ya existe un rol con ese nombre.');
					}
					throw rolError;
				}

				if (newRol && activePermIds.length > 0) {
					const { error: insError } = await supabase
						.from('roles_permisos')
						.insert(activePermIds.map(permId => ({ rol_id: newRol.id, permiso_id: permId })));

					if (insError) throw insError;
				}

				showStatus('success', `Rol '${nuevoNombre.trim()}' creado correctamente.`);
			}

			isModalOpen = false;
			resetForm();
			await cargarDatos(); // Recargar todo para tener la UI consistente

		} catch (error: any) {
			console.error("[Roles/Permisos Error] Error al guardar rol:", error);
			modalError = error.message || 'Error al guardar los cambios del rol.';
		} finally {
			isSaving = false;
		}
	}

	async function eliminarRol(id: number, nombre: string) {
		if (!hasPermiso('configuracion:write')) {
			alert('No tienes permiso de escritura (configuracion:write) para eliminar roles.');
			console.warn('[Roles/Permisos UI] Blocked: Delete role requested without configuracion:write permission');
			return;
		}

		const confirmacion = confirm(`¿Estás seguro de que deseas eliminar el rol "${nombre}"?\nEsta acción es irreversible y removerá los permisos asociados.`);
		if (!confirmacion) return;

		try {
			// Verificar si hay empleados asignados a este rol
			const { count, error: countError } = await supabase
				.from('empleados')
				.select('*', { count: 'exact', head: true })
				.eq('rol_id', id);

			if (countError) throw countError;

			if (count && count > 0) {
				alert(`No se puede eliminar el rol "${nombre}" porque está asignado a ${count} empleado(s). Asigna un rol diferente a este personal antes de eliminarlo.`);
				return;
			}

			// Eliminar el rol (la relación roles_permisos se borrará en cascada en la DB)
			const { error: delError } = await supabase.from('roles').delete().eq('id', id);
			if (delError) throw delError;

			showStatus('success', `Rol '${nombre}' eliminado correctamente.`);
			await cargarDatos();

		} catch (error: any) {
			console.error("[Roles/Permisos Error] Error al eliminar rol:", error);
			showStatus('error', 'Error al eliminar rol: ' + error.message);
		}
	}
</script>

<svelte:head>
	<title>Configuración de Roles y Permisos | Construni ERP</title>
</svelte:head>

<div class="mb-6">
	<div class="text-xs text-slate-500 mb-2">Configuración &nbsp;>&nbsp; Roles y Permisos</div>
	<div class="flex justify-between items-center">
		<div>
			<h2 class="text-2xl font-semibold text-brand-marine">Roles y Permisos del Sistema (RBAC)</h2>
			<p class="text-sm text-slate-500 mt-1">Define el nivel de acceso para cada tipo de empleado mediante asignación de permisos individuales.</p>
		</div>
		{#if hasPermiso('configuracion:write')}
			<button 
				onclick={() => { resetForm(); isModalOpen = true; }}
				class="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-medium shadow-md shadow-blue-600/10 active:scale-[0.98] transition-all flex items-center gap-2 cursor-pointer"
			>
				<i class="fas fa-plus-circle"></i> Nuevo Rol
			</button>
		{/if}
	</div>
</div>

{#if statusMessage.text}
	<div class="p-3 mb-6 rounded-lg text-sm font-medium flex items-center gap-2 {statusMessage.type === 'success' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'} transition-all">
		<i class="fas {statusMessage.type === 'success' ? 'fa-check-circle' : 'fa-exclamation-triangle'}"></i>
		{statusMessage.text}
	</div>
{/if}

{#if !hasPermiso('configuracion:write')}
	<div class="p-3 mb-4 rounded-xl text-xs font-medium bg-amber-50 text-amber-800 border border-amber-200/50 flex items-center gap-2">
		<i class="fas fa-info-circle text-amber-500"></i>
		<span><strong>Modo de solo lectura:</strong> No tienes el permiso de escritura (<code>configuracion:write</code>) para agregar, editar o eliminar roles.</span>
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
						<th class="p-4">Rol</th>
						<th class="p-4">Descripción</th>
						<th class="p-4 text-center">Permisos Habilitados</th>
						{#if hasPermiso('configuracion:write')}
							<th class="p-4 text-center">Acciones</th>
						{/if}
					</tr>
				</thead>
				<tbody class="divide-y divide-slate-100">
					{#each roles as rol}
						{@const activePermsCount = rolesPermisos.filter(rp => rp.rol_id === rol.id).length}
						<tr class="hover:bg-slate-50 transition-colors">
							<td class="p-4">
								<div class="font-bold text-slate-800 capitalize">{rol.nombre}</div>
							</td>
							<td class="p-4 text-slate-600 text-xs">
								{rol.descripcion || 'Sin descripción descriptiva.'}
							</td>
							<td class="p-4 text-center">
								<span class="px-2.5 py-1 rounded-lg text-xs font-semibold border {activePermsCount > 0 ? 'bg-green-50 text-green-700 border-green-100' : 'bg-slate-50 text-slate-400 border-slate-100'}">
									{activePermsCount} {activePermsCount === 1 ? 'permiso activo' : 'permisos activos'}
								</span>
							</td>
							{#if hasPermiso('configuracion:write')}
								<td class="p-4 text-center whitespace-nowrap">
									<div class="flex items-center justify-center gap-2">
										<button 
											onclick={() => prepararEdicion(rol)} 
											class="px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 hover:text-blue-800 border border-blue-200 rounded-xl text-xs font-semibold shadow-xs active:scale-[0.97] transition-all flex items-center gap-1.5 cursor-pointer" 
											title="Configurar permisos del rol"
										>
											<i class="fas fa-cog text-[10px]"></i>
											<span>Configurar</span>
										</button>
										<button 
											onclick={() => eliminarRol(rol.id, rol.nombre)} 
											class="px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 hover:text-rose-800 border border-rose-200 rounded-xl text-xs font-semibold shadow-xs active:scale-[0.97] transition-all flex items-center gap-1.5 cursor-pointer" 
											title="Eliminar rol"
										>
											<i class="fas fa-trash-alt text-[10px]"></i>
											<span>Eliminar</span>
										</button>
									</div>
								</td>
							{/if}
						</tr>
					{/each}
					{#if roles.length === 0}
						<tr>
							<td colspan="4" class="p-8 text-center text-slate-500">No hay roles registrados en el sistema.</td>
						</tr>
					{/if}
				</tbody>
			</table>
		</div>
	{/if}
</div>

{#if isModalOpen}
	<div class="fixed inset-0 bg-slate-900/50 backdrop-blur-xs z-50 flex items-center justify-center p-4 transition-all duration-300">
		<div class="bg-white rounded-3xl shadow-2xl border border-slate-100 max-w-3xl w-full overflow-hidden flex flex-col max-h-[90vh] scale-100 transition-transform duration-300">
			<!-- Header -->
			<div class="bg-slate-50 border-b border-slate-100 px-6 py-4 flex items-center justify-between">
				<div class="flex items-center gap-2">
					<div class="w-8 h-8 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center">
						<i class="fas {editingRolId ? 'fa-cog' : 'fa-plus-circle'} text-sm"></i>
					</div>
					<h3 class="font-bold text-slate-800 text-base">{editingRolId ? 'Configurar Rol y Permisos' : 'Crear Nuevo Rol'}</h3>
				</div>
				<button onclick={() => { isModalOpen = false; resetForm(); }} class="text-slate-400 hover:text-slate-600 text-lg p-1 cursor-pointer">
					<i class="fas fa-times"></i>
				</button>
			</div>
			
			<!-- Content -->
			<form onsubmit={(e) => { e.preventDefault(); guardarRol(); }} class="flex-1 overflow-y-auto p-6 space-y-6">
				{#if modalError}
					<div class="p-4 rounded-2xl bg-rose-50 border border-rose-100 text-sm text-rose-800 flex items-start gap-3 transition-all duration-300">
						<i class="fas fa-exclamation-circle mt-0.5 text-rose-500 text-base flex-shrink-0"></i>
						<div class="flex-1">
							<div class="font-semibold text-rose-900">No se pudo guardar el rol</div>
							<div class="text-xs text-rose-700 mt-1">{modalError}</div>
						</div>
						<button type="button" onclick={() => { modalError = ''; }} class="text-rose-400 hover:text-rose-600 transition-colors p-1" title="Cerrar advertencia">
							<i class="fas fa-times"></i>
						</button>
					</div>
				{/if}

				<!-- Section 1: Rol Info -->
				<div>
					<h4 class="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Información del Rol</h4>
					<div class="grid grid-cols-1 gap-4">
						<div>
							<label class="block text-xs font-semibold text-slate-600 mb-1">Nombre del Rol *</label>
							<input type="text" bind:value={nuevoNombre} oninput={onInputChange} placeholder="Ej. administrador, vendedor, supervisor" required class="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:bg-white outline-none transition-all text-sm capitalize" />
						</div>
						<div>
							<label class="block text-xs font-semibold text-slate-600 mb-1">Descripción</label>
							<textarea bind:value={nuevoDescripcion} oninput={onInputChange} placeholder="Escribe el alcance y responsabilidades de este rol..." rows="2" class="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:bg-white outline-none transition-all text-sm"></textarea>
						</div>
					</div>
				</div>
				
				<!-- Section 2: Permissions Matrix (Checkboxes) -->
				<div>
					<h4 class="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Permisos Disponibles</h4>
					<p class="text-xs text-slate-500 mb-4">Marca las casillas correspondientes para activar el acceso del rol a los diferentes módulos del ERP.</p>
					
					<div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
						{#each permisos as permiso}
							<label class="flex items-start gap-3 p-3 bg-slate-50 hover:bg-slate-100/70 border border-slate-200 rounded-xl transition-all cursor-pointer select-none">
								<input 
									type="checkbox" 
									bind:checked={seleccionadoPermisos[permiso.id]} 
									class="w-4 h-4 text-blue-600 border-slate-300 rounded-lg focus:ring-blue-500 focus:ring-offset-2 transition-all mt-0.5 cursor-pointer" 
								/>
								<div>
									<span class="text-xs font-semibold text-slate-800 block">{permiso.nombre}</span>
									<span class="text-[10px] text-slate-500 mt-0.5 block leading-tight">{permiso.descripcion}</span>
								</div>
							</label>
						{/each}
					</div>
				</div>
				
				<!-- Footer / Buttons -->
				<div class="pt-4 border-t border-slate-100 flex justify-end gap-3">
					<button type="button" onclick={() => { isModalOpen = false; resetForm(); }} class="px-4 py-2.5 bg-slate-100 text-slate-700 rounded-xl hover:bg-slate-200 text-sm font-medium transition-colors cursor-pointer">
						Cancelar
					</button>
					<button type="submit" disabled={isSaving} class="px-5 py-2.5 bg-blue-600 text-white rounded-xl hover:bg-blue-700 text-sm font-medium shadow-md shadow-blue-600/10 disabled:opacity-70 flex items-center gap-2 transition-colors cursor-pointer">
						{#if isSaving}
							<i class="fas fa-spinner fa-spin"></i> Guardando...
						{:else}
							<i class="fas fa-save"></i> Guardar Cambios
						{/if}
					</button>
				</div>
			</form>
		</div>
	</div>
{/if}
