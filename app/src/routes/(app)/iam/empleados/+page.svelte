<script lang="ts">
	import { onMount } from 'svelte';
	import { supabase } from '$lib/supabaseClient';
	import { createUser, updateUser, deleteUser } from '$lib/edgeFunctionClient';
	import ResponsiveDataView from '$lib/shared/components/ResponsiveDataView.svelte';

	type Rol = { id: number; nombre: string; descripcion: string };
	type Area = { id: number; nombre: string };
	type Empleado = { 
		id: number; 
		nombre: string; 
		telefono: string; 
		correo?: string; 
		rol_id: number; 
		area_id?: number | null;
		auth_user_id: string;
		/** true = ya completó el flujo de "Configura tu acceso" (código OTP + su propia contraseña),
		 * distinto de solo tener auth_user_id — ver nota junto al badge de Estado Cuenta más abajo. */
		passwordConfigurado: boolean;
		fecha_ingreso?: string;
		salario?: number;
		horas?: number;
		periodo?: string;
		nivel?: string;
		roles?: { nombre: string } 
	};

	let empleados = $state<Empleado[]>([]);
	let roles = $state<Rol[]>([]);
	let areas = $state<Area[]>([]);
	let isLoading = $state(true);
	let statusMessage = $state({ type: '', text: '' });

	// Form states
	let isModalOpen = $state(false);
	let isSaving = $state(false);
	let modalError = $state('');
	let editingEmpleadoId = $state<number | null>(null);
	
	let nuevoNombre = $state('');
	let nuevoCorreo = $state('');
	let nuevoTelefono = $state('');
	let nuevoRolId = $state<number | null>(null);
	let nuevoAreaId = $state<number | null>(null);
	let nuevaFechaIngreso = $state(new Date().toISOString().split('T')[0]);
	let nuevoSalario = $state(0);
	let nuevasHoras = $state(0);
	let nuevoPeriodo = $state('Mensual');
	let nuevoNivel = $state('');

	function onInputChange() {
		if (modalError) {
			console.log("[IAM UI] Limpiando modalError por nueva accion de modificacion del formulario.");
			modalError = '';
		}
	}

	function formatEmpleado(emp: any): Empleado {
		const rolesObj = Array.isArray(emp.roles) ? emp.roles[0] : emp.roles;
		const roleFromList = rolesObj || roles.find((r: any) => r.id === Number(emp.rol_id));
		return {
			id: emp.id,
			nombre: emp.nombre,
			telefono: emp.telefono || '',
			correo: emp.correo,
			rol_id: emp.rol_id,
			area_id: emp.area_id || null,
			auth_user_id: emp.auth_user_id,
			passwordConfigurado: Boolean(emp.password_configurado),
			fecha_ingreso: emp.fecha_ingreso,
			salario: emp.salario ? Number(emp.salario) : 0,
			horas: emp.horas ? Number(emp.horas) : 0,
			periodo: emp.periodo || 'Mensual',
			nivel: emp.nivel || '',
			roles: roleFromList ? { nombre: String(roleFromList.nombre) } : undefined
		};
	}

	function formatEmpleados(data: any[]): Empleado[] {
		return data.map(formatEmpleado);
	}

	onMount(async () => {
		console.log("[IAM UI] Iniciando carga de datos iniciales en onMount...");
		try {
			// Cargar roles
			console.log("[IAM UI] 1. Solicitando roles a Supabase...");
			const { data: rolesData, error: rolesError } = await supabase.from('roles').select('*').order('id');
			if (rolesError) {
				console.error("[IAM UI Error] Error al obtener roles de Supabase:", rolesError);
				throw rolesError;
			}
			roles = rolesData || [];
			console.log("[IAM UI] Roles cargados exitosamente:", roles);

			// Cargar áreas
			const { data: areasData } = await supabase.from('area').select('*').order('nombre');
			if (areasData) areas = areasData;

			// Cargar empleados con sus roles
			console.log("[IAM UI] 3. Solicitando lista de empleados con roles a Supabase...");
			const { data: empData, error: empError } = await supabase
				.from('empleados')
				.select(`
					id, nombre, telefono, correo, rol_id, auth_user_id, password_configurado,
					fecha_ingreso, salario, horas, periodo, nivel, area_id,
					roles ( nombre )
				`)
				.order('id');
			
			if (empError) {
				console.error("[IAM UI Error] Error al obtener empleados de Supabase:", empError);
				throw empError;
			}
			empleados = formatEmpleados(empData || []);
			console.log("[IAM UI] Empleados cargados exitosamente:", empleados);
			console.log("[IAM UI] Carga de datos iniciales completada con éxito.");

		} catch (error: any) {
			console.error("[IAM UI Error] Excepcion capturada durante la carga inicial de datos (onMount):", error);
			showStatus('error', 'Error al cargar usuarios. Asegúrate de tener permisos.');
		} finally {
			isLoading = false;
		}
	});

	function showStatus(type: 'success' | 'error', text: string) {
		console.log(`[IAM UI Status] Mostrando mensaje de estado (${type}): ${text}`);
		statusMessage = { type, text };
		setTimeout(() => {
			statusMessage = { type: '', text: '' };
		}, 3000);
	}

	async function agregarEmpleado() {
		console.log("[IAM UI] Iniciando proceso de agregar nuevo empleado...");
		modalError = ''; // Limpiamos cualquier error previo
		
		// Validaciones de frontend
		if (!nuevoNombre.trim()) {
			console.warn("[IAM UI Validation] Fallo validacion: El nombre está vacío");
			modalError = 'El nombre es obligatorio';
			return;
		}
		if (!nuevoCorreo.trim()) {
			console.warn("[IAM UI Validation] Fallo validacion: El correo está vacío");
			modalError = 'El correo electronico es obligatorio';
			return;
		}
		const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
		if (!emailRegex.test(nuevoCorreo.trim())) {
			console.warn(`[IAM UI Validation] Fallo validacion: Formato de correo inválido (${nuevoCorreo})`);
			modalError = 'Ingresa un correo electronico válido';
			return;
		}
		if (!nuevaFechaIngreso) {
			console.warn("[IAM UI Validation] Fallo validacion: Fecha de ingreso no seleccionada");
			modalError = 'La fecha de ingreso es obligatoria';
			return;
		}

		const payload = {
			nombre: nuevoNombre.trim(),
			correo: nuevoCorreo.trim(),
			telefono: nuevoTelefono.trim() || null,
			rol_id: nuevoRolId || null,
			area_id: nuevoAreaId || null,
			fecha_ingreso: nuevaFechaIngreso,
			salario: nuevoSalario,
			horas: nuevasHoras,
			periodo: nuevoPeriodo,
			nivel: nuevoNivel.trim() || null
		};

		console.log("[IAM UI] Validaciones de formulario superadas. Payload a enviar:", payload);
		isSaving = true;

		try {
			console.log("[IAM UI] Creando empleado mediante Supabase Edge Function...");
			const result = await createUser({
				email: payload.correo,
				nombre: payload.nombre,
				telefono: payload.telefono,
				rol_id: payload.rol_id,
				area_id: payload.area_id,
				fecha_ingreso: payload.fecha_ingreso,
				salario: payload.salario,
				horas: payload.horas,
				periodo: payload.periodo,
				nivel: payload.nivel
			});

			if (!result.success) {
				console.error("[IAM UI Error] Error en Supabase Edge Function createUser:", result);
				throw new Error(result?.error || 'Error desconocido al crear el empleado');
			}

			console.log("[IAM UI] Respuesta de Edge Function:", result);

			if (result.empleado) {
				const formatted = formatEmpleado(result.empleado);
				console.log("[IAM UI] Empleado creado recibido con éxito. Añadiendo a lista local formateada:", formatted);
				empleados = [...empleados, formatted];
			} else {
				// Recargar lista por si acaso
				console.warn("[IAM UI] El empleado no fue devuelto en la respuesta. Iniciando recarga de seguridad de la lista completa desde Supabase...");
				const { data: reloadData, error: reloadError } = await supabase
					.from('empleados')
					.select(`
						id, nombre, telefono, correo, rol_id, auth_user_id, password_configurado,
						fecha_ingreso, salario, horas, periodo, nivel, area_id,
						roles ( nombre )
					`)
					.order('id');
				if (reloadError) {
					console.error("[IAM UI Error] Error al recargar la lista de empleados tras el registro:", reloadError);
					throw reloadError;
				}
				empleados = formatEmpleados(reloadData || []);
				console.log("[IAM UI] Lista de empleados recargada exitosamente. Total local:", empleados.length);
			}

			showStatus('success', `Empleado registrado y usuario de acceso creado con el correo ${nuevoCorreo.trim()}`);
			isModalOpen = false;
			resetForm();
		} catch (error: any) {
			console.error("[IAM UI Error] Excepcion capturada en agregarEmpleado():", error);
			modalError = error.message; // El error se muestra dentro del popup
		} finally {
			isSaving = false;
			console.log("[IAM UI] Finalizo ejecucion de agregarEmpleado()");
		}
	}

	function prepararEdicion(emp: Empleado) {
		console.log(`[IAM UI] Preparando edicion de empleado ID: ${emp.id} ("${emp.nombre}")...`);
		editingEmpleadoId = emp.id;
		nuevoNombre = emp.nombre;
		nuevoCorreo = emp.correo || '';
		nuevoTelefono = emp.telefono || '';
		nuevoRolId = emp.rol_id || null;
		nuevoAreaId = emp.area_id || null;
		nuevaFechaIngreso = emp.fecha_ingreso || new Date().toISOString().split('T')[0];
		nuevoSalario = emp.salario || 0;
		nuevasHoras = emp.horas || 0;
		nuevoPeriodo = emp.periodo || 'Mensual';
		nuevoNivel = emp.nivel || '';
		modalError = '';
		isModalOpen = true;
	}

	async function actualizarEmpleado() {
		if (!editingEmpleadoId) return;
		console.log(`[IAM UI] Iniciando actualizacion de empleado ID: ${editingEmpleadoId}...`);
		modalError = '';
		
		// Validaciones de frontend
		if (!nuevoNombre.trim()) {
			modalError = 'El nombre es obligatorio';
			return;
		}
		if (!nuevoCorreo.trim()) {
			modalError = 'El correo electronico es obligatorio';
			return;
		}
		const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
		if (!emailRegex.test(nuevoCorreo.trim())) {
			modalError = 'Ingresa un correo electronico válido';
			return;
		}
		if (!nuevaFechaIngreso) {
			modalError = 'La fecha de ingreso es obligatoria';
			return;
		}

		isSaving = true;

		try {
			const currentEmp = empleados.find(emp => emp.id === editingEmpleadoId);
			const payload = {
				nombre: nuevoNombre.trim(),
				correo: nuevoCorreo.trim(),
				telefono: nuevoTelefono.trim() || null,
				rol_id: nuevoRolId || null,
				area_id: nuevoAreaId || null,
				fecha_ingreso: nuevaFechaIngreso,
				salario: nuevoSalario,
				horas: nuevasHoras,
				periodo: nuevoPeriodo,
				nivel: nuevoNivel.trim() || null
			};

			console.log("[IAM UI] Actualizando empleado mediante Supabase Edge Function para ID:", editingEmpleadoId);
			const result = await updateUser({
				auth_user_id: currentEmp?.auth_user_id || '',
				email: payload.correo,
				nombre: payload.nombre,
				telefono: payload.telefono,
				rol_id: payload.rol_id,
				area_id: payload.area_id,
				fecha_ingreso: payload.fecha_ingreso,
				salario: payload.salario,
				horas: payload.horas,
				periodo: payload.periodo,
				nivel: payload.nivel
			});

			if (!result.success) {
				console.error("[IAM UI Error] Error en Supabase Edge Function updateUser:", result);
				throw new Error(result?.error || 'Error al actualizar el empleado');
			}

			console.log("[IAM UI] Respuesta de Edge Function:", result);

			if (result.empleado) {
				const formatted = formatEmpleado(result.empleado);
				empleados = empleados.map(emp => emp.id === editingEmpleadoId ? formatted : emp);
			} else {
				// Recargar lista por si acaso
				const { data: reloadData, error: reloadError } = await supabase
					.from('empleados')
					.select(`
						id, nombre, telefono, correo, rol_id, auth_user_id, password_configurado,
						fecha_ingreso, salario, horas, periodo, nivel, area_id,
						roles ( nombre )
					`)
					.order('id');
				if (reloadError) throw reloadError;
				empleados = formatEmpleados(reloadData || []);
			}

			showStatus('success', `Empleado '${payload.nombre}' actualizado correctamente.`);
			isModalOpen = false;
			resetForm();
		} catch (error: any) {
			console.error("[IAM UI Error] Excepcion en actualizarEmpleado():", error);
			modalError = error.message;
		} finally {
			isSaving = false;
		}
	}

	async function eliminarEmpleado(id: number, nombre: string) {
		const confirmacion = confirm(`¿Estás seguro de que deseas eliminar al empleado "${nombre}"?\nEsta accion eliminará su registro y el usuario de autenticacion.`);
		if (!confirmacion) return;

		console.log(`[IAM UI] Solicitando eliminacion remota del empleado ID: ${id} ("${nombre}") via Supabase Edge Function...`);
		try {
			const currentEmp = empleados.find(emp => emp.id === id);
			if (!currentEmp?.auth_user_id) {
				throw new Error('No se encontro auth_user_id para este empleado');
			}

			const data = await deleteUser(currentEmp.auth_user_id);

			if (!data?.success) {
				console.error('[IAM UI Error] Error en Supabase Edge Function deleteUser:', data);
				throw new Error(data?.error || 'Error al eliminar el empleado');
			}

			// Actualizar UI localmente
			empleados = empleados.filter(emp => emp.id !== id);
			console.log(`[IAM UI] Empleado ID ${id} eliminado correctamente del estado local.`);
			showStatus('success', `Empleado '${nombre}' eliminado correctamente.`);
		} catch (error: any) {
			console.error('[IAM UI Error] Excepcion en eliminarEmpleado():', error);
			showStatus('error', 'Error al eliminar: ' + error.message);
		}
	}

	function resetForm() {
		nuevoNombre = '';
		nuevoCorreo = '';
		nuevoTelefono = '';
		nuevoRolId = null;
		nuevoAreaId = null;
		nuevaFechaIngreso = new Date().toISOString().split('T')[0];
		nuevoSalario = 0;
		nuevasHoras = 0;
		nuevoPeriodo = 'Mensual';
		nuevoNivel = '';
		modalError = '';
		editingEmpleadoId = null;
	}
</script>

<svelte:head>
	<title>Control de Accesos (IAM) | Construni ERP</title>
</svelte:head>

<div class="mb-6">
	<div class="text-xs text-slate-500 mb-2">Configuracion &nbsp;>&nbsp; Control de Accesos (IAM)</div>
	<div class="flex justify-between items-center">
		<div>
			<h2 class="text-2xl font-semibold text-brand-marine">Gestion de Personal y Roles</h2>
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
			<ResponsiveDataView items={empleados} keyField="id" emptyMessage="No hay empleados registrados o no tienes permiso para verlos." columns={[
				{ label: 'Personal' },
				{ label: 'Contacto' },
				{ label: 'Estado Cuenta' },
				{ label: 'Rol Asignado' },
				{ label: 'Acciones', align: 'center' }
			]}>
				{#snippet row(emp)}
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
						<div class="flex flex-col gap-1">
							{#if emp.telefono}
								<div class="flex items-center gap-2 text-slate-600 text-sm">
									<i class="fas fa-phone-alt text-slate-400 text-xs w-3"></i>
									{emp.telefono}
								</div>
							{/if}
							{#if emp.correo}
								<div class="flex items-center gap-2 text-slate-500 text-xs">
									<i class="fas fa-envelope text-slate-400 text-xs w-3"></i>
									{emp.correo}
								</div>
							{/if}
							{#if !emp.telefono && !emp.correo}
								<span class="text-slate-400 italic text-xs">No registrado</span>
							{/if}
						</div>
					</td>
					<td class="p-4">
						{#if emp.auth_user_id && emp.passwordConfigurado}
							<span class="px-2 py-1 bg-green-100 text-green-700 rounded text-xs font-semibold"><i class="fas fa-link"></i> Vinculada</span>
						{:else if emp.auth_user_id}
							<span class="px-2 py-1 bg-amber-100 text-amber-700 rounded text-xs font-semibold" title="Ya se creó su acceso pero todavía no completó 'Configura tu acceso' (código OTP + su contraseña)"><i class="fas fa-clock"></i> Pendiente de activación</span>
						{:else}
							<span class="px-2 py-1 bg-orange-100 text-orange-700 rounded text-xs font-semibold"><i class="fas fa-unlink"></i> Sin vincular</span>
						{/if}
					</td>
					<td class="p-4 capitalize font-medium text-slate-700">
						{#if emp.roles?.nombre}
							<span class="px-2.5 py-1 bg-blue-50 text-blue-700 rounded-lg text-xs font-semibold border border-blue-100">
								{emp.roles.nombre}
							</span>
						{:else}
							<span class="px-2.5 py-1 bg-slate-50 text-slate-400 rounded-lg text-xs font-medium border border-slate-100 italic">
								Sin Rol
							</span>
						{/if}
					</td>
					<td class="p-4 text-center whitespace-nowrap">
						<div class="flex items-center justify-center gap-2">
							<button
								onclick={() => prepararEdicion(emp)}
								class="px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 hover:text-blue-800 border border-blue-200 rounded-xl text-xs font-semibold shadow-xs active:scale-[0.97] transition-all flex items-center gap-1.5 cursor-pointer"
								title="Editar empleado"
							>
								<i class="fas fa-edit text-[10px]"></i>
								<span>Editar</span>
							</button>
							<button
								onclick={() => eliminarEmpleado(emp.id, emp.nombre)}
								class="px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 hover:bg-rose-800 border border-rose-200 rounded-xl text-xs font-semibold shadow-xs active:scale-[0.97] transition-all flex items-center gap-1.5 cursor-pointer"
								title="Eliminar empleado"
							>
								<i class="fas fa-trash-alt text-[10px]"></i>
								<span>Eliminar</span>
							</button>
						</div>
					</td>
				{/snippet}
				{#snippet card(emp)}
					<div class="flex items-start justify-between gap-3 mb-3">
						<div class="flex items-center gap-3 min-w-0">
							<div class="w-10 h-10 shrink-0 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center font-bold">
								{emp.nombre.charAt(0).toUpperCase()}
							</div>
							<div class="min-w-0">
								<div class="font-bold text-slate-800 truncate">{emp.nombre}</div>
								{#if emp.roles?.nombre}
									<span class="inline-block mt-1 px-2 py-0.5 bg-blue-50 text-blue-700 rounded text-[10px] font-semibold border border-blue-100 capitalize">{emp.roles.nombre}</span>
								{:else}
									<span class="inline-block mt-1 px-2 py-0.5 bg-slate-50 text-slate-400 rounded text-[10px] font-medium border border-slate-100 italic">Sin Rol</span>
								{/if}
							</div>
						</div>
						{#if emp.auth_user_id && emp.passwordConfigurado}
							<span class="shrink-0 px-2 py-1 bg-green-100 text-green-700 rounded text-[10px] font-semibold"><i class="fas fa-link"></i> Vinculada</span>
						{:else if emp.auth_user_id}
							<span class="shrink-0 px-2 py-1 bg-amber-100 text-amber-700 rounded text-[10px] font-semibold" title="Ya se creó su acceso pero todavía no completó 'Configura tu acceso'"><i class="fas fa-clock"></i> Pendiente</span>
						{:else}
							<span class="shrink-0 px-2 py-1 bg-orange-100 text-orange-700 rounded text-[10px] font-semibold"><i class="fas fa-unlink"></i> Sin vincular</span>
						{/if}
					</div>
					<div class="flex flex-col gap-1 mb-3">
						{#if emp.telefono}
							<div class="flex items-center gap-2 text-slate-600 text-sm">
								<i class="fas fa-phone-alt text-slate-400 text-xs w-3"></i>
								{emp.telefono}
							</div>
						{/if}
						{#if emp.correo}
							<div class="flex items-center gap-2 text-slate-500 text-xs">
								<i class="fas fa-envelope text-slate-400 text-xs w-3"></i>
								{emp.correo}
							</div>
						{/if}
						{#if !emp.telefono && !emp.correo}
							<span class="text-slate-400 italic text-xs">No registrado</span>
						{/if}
					</div>
					<div class="flex items-center gap-2 pt-2 border-t border-slate-100">
						<button
							onclick={() => prepararEdicion(emp)}
							class="flex-1 h-10 rounded-lg bg-blue-50 text-blue-700 border border-blue-200 flex items-center justify-center gap-2 text-xs font-semibold active:bg-blue-100"
						>
							<i class="fas fa-edit text-[10px]"></i> Editar
						</button>
						<button
							onclick={() => eliminarEmpleado(emp.id, emp.nombre)}
							class="flex-1 h-10 rounded-lg bg-rose-50 text-rose-700 border border-rose-200 flex items-center justify-center gap-2 text-xs font-semibold active:bg-rose-100"
						>
							<i class="fas fa-trash-alt text-[10px]"></i> Eliminar
						</button>
					</div>
				{/snippet}
			</ResponsiveDataView>
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
						<i class="fas {editingEmpleadoId ? 'fa-user-edit' : 'fa-user-plus'} text-sm"></i>
					</div>
					<h3 class="font-bold text-slate-800 text-base">{editingEmpleadoId ? 'Editar Empleado' : 'Registrar Nuevo Empleado'}</h3>
				</div>
				<button onclick={() => { isModalOpen = false; resetForm(); }} class="text-slate-400 hover:text-slate-600 text-lg p-1">
					<i class="fas fa-times"></i>
				</button>
			</div>
			
			<!-- Content -->
			<form onsubmit={(e) => { e.preventDefault(); if (editingEmpleadoId) { actualizarEmpleado(); } else { agregarEmpleado(); } }} class="flex-1 overflow-y-auto p-6 space-y-6">
				{#if modalError}
					<div class="p-4 rounded-2xl bg-rose-50 border border-rose-100 text-sm text-rose-800 flex items-start gap-3 transition-all duration-300">
						<i class="fas fa-exclamation-circle mt-0.5 text-rose-500 text-base flex-shrink-0"></i>
						<div class="flex-1">
							<div class="font-semibold text-rose-900">No se pudo guardar el empleado</div>
							<div class="text-xs text-rose-700 mt-1">{modalError}</div>
						</div>
						<button type="button" onclick={() => { modalError = ''; }} class="text-rose-400 hover:text-rose-600 transition-colors p-1" title="Cerrar advertencia">
							<i class="fas fa-times"></i>
						</button>
					</div>
				{/if}

				<!-- Section 1: Personal Info -->
				<div>
					<h4 class="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Informacion Personal</h4>
					<div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
						<div>
							<label class="block text-xs font-semibold text-[#0f3b5e] mb-1">Nombre Completo *</label>
							<input type="text" bind:value={nuevoNombre} oninput={onInputChange} placeholder="Nombre y Apellidos" required class="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:bg-white outline-none transition-all text-sm" />
						</div>
						<div>
							<label class="block text-xs font-semibold text-[#0f3b5e] mb-1">Teléfono</label>
							<input type="text" bind:value={nuevoTelefono} oninput={onInputChange} placeholder="987654321" class="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:bg-white outline-none transition-all text-sm" />
						</div>
					</div>
					<div class="mt-4">
						<label class="block text-xs font-semibold text-[#0f3b5e] mb-1">
							Correo Electronico * 
							{#if editingEmpleadoId}
								<span class="font-normal text-slate-400">(se actualizará el acceso del empleado)</span>
							{:else}
								<span class="font-normal text-slate-400">(se usará para el acceso al sistema)</span>
							{/if}
						</label>
						<div class="relative">
							<i class="fas fa-envelope absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs"></i>
							<input type="email" bind:value={nuevoCorreo} oninput={onInputChange} placeholder="empleado@empresa.com" required class="w-full pl-8 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:bg-white outline-none transition-all text-sm disabled:opacity-60 disabled:cursor-not-allowed" />
						</div>
					</div>
				</div>
				
				<!-- Section 2: Roles -->
				<div>
					<h4 class="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Asignacion de Roles</h4>
					<div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
						<div>
							<label class="block text-xs font-semibold text-[#0f3b5e] mb-1">Rol de Acceso</label>
							<select bind:value={nuevoRolId} onchange={onInputChange} class="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:bg-white outline-none transition-all text-sm">
								<option value={null}>Sin Rol / Acceso Restringido</option>
								{#each roles as rol}
									<option value={rol.id}>{rol.nombre}</option>
								{/each}
							</select>
						</div>
						<div>
							<label class="block text-xs font-semibold text-[#0f3b5e] mb-1">Área / Departamento</label>
							<select bind:value={nuevoAreaId} onchange={onInputChange} class="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:bg-white outline-none transition-all text-sm">
								<option value={null}>Sin Área Asignada</option>
								{#each areas as area}
									<option value={area.id}>{area.nombre}</option>
								{/each}
							</select>
						</div>
					</div>
				</div>

				<!-- Section 3: Labor Details -->
				<div>
					<h4 class="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Detalles Laborales</h4>
					<div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
						<div>
							<label class="block text-xs font-semibold text-[#0f3b5e] mb-1">Fecha de Ingreso *</label>
							<input type="date" bind:value={nuevaFechaIngreso} onchange={onInputChange} required class="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:bg-white outline-none transition-all text-sm" />
						</div>
						<div>
							<label class="block text-xs font-semibold text-[#0f3b5e] mb-1">Nivel Laboral</label>
							<input type="text" bind:value={nuevoNivel} oninput={onInputChange} placeholder="Junior, Senior, Practicante..." class="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:bg-white outline-none transition-all text-sm" />
						</div>
					</div>
				</div>

				<!-- Section 4: Auto Auth Info -->
				{#if !editingEmpleadoId}
					<div class="bg-blue-50 border border-blue-100 rounded-2xl p-4">
						<div class="flex items-start gap-3">
							<div class="w-8 h-8 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center flex-shrink-0 mt-0.5">
								<i class="fas fa-magic text-sm"></i>
							</div>
							<div>
								<p class="text-sm font-semibold text-blue-800">Cuenta de acceso automática</p>
								<p class="text-xs text-blue-600 mt-1">Al guardar, se creará automáticamente un usuario en Supabase Auth con el correo ingresado. El empleado podrá iniciar sesion con ese correo y establecer su contraseña.</p>
							</div>
						</div>
					</div>
				{/if}
				
				<!-- Footer / Buttons -->
				<div class="pt-4 border-t border-slate-100 flex justify-end gap-3">
					<button type="button" onclick={() => { isModalOpen = false; resetForm(); }} class="px-4 py-2.5 bg-slate-100 text-slate-700 rounded-xl hover:bg-slate-200 text-sm font-medium transition-colors">
						Cancelar
					</button>
					<button type="submit" disabled={isSaving} class="px-5 py-2.5 bg-blue-600 text-white rounded-xl hover:bg-blue-700 text-sm font-medium shadow-md shadow-blue-600/10 disabled:opacity-70 flex items-center gap-2 transition-colors">
						{#if isSaving}
							<i class="fas fa-spinner fa-spin"></i> Guardando...
						{:else}
							<i class="fas fa-save"></i> {editingEmpleadoId ? 'Actualizar Empleado' : 'Guardar Empleado'}
						{/if}
					</button>
				</div>
			</form>
		</div>
	</div>
{/if}
