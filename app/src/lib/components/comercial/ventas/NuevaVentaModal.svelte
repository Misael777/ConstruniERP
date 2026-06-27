<script lang="ts">
	import { fade, scale } from 'svelte/transition';
	import { onMount } from 'svelte';
	import { supabase } from '$lib/supabaseClient';
	import { resolveApiUrl } from '$lib/apiClient';

	let { isOpen = false, onClose = () => {}, onSaved = () => {} } = $props<{ isOpen?: boolean, onClose?: () => void, onSaved?: () => void }>();

	// Form State
	let proyectoNombre = $state('');
	let fechaVenta = $state('2026-05-20');
	let asesor = $state('');
	let cliente = $state('Maria Jhong');
	let clientes = $state<any[]>([]);
	let selectedClienteId = $state<string>('');
	let nuevoClienteNombre = $state('');
	let valorVenta = $state('15000.00');
	let comisionPorcentaje = $state('10');

	let contratoFile = $state<File | null>(null);
	let proformaFile = $state<File | null>(null);

	// Generation fields
	let tipoProyecto = $state('O'); // Proyecto de Obra (O)
	let estadoPredio = $state('A'); // Ampliación (A)
	let tipoEdificacion = $state('M'); // Viv. Multifamiliar (M)
	let numeroPisos = $state('4');
	let mes = $state('02'); // 02 - Febrero
	let anio = $state('2026');
	let distrito = $state('ATE Salamanca');
	let clienteNombreGen = $state('Maria Jhong');
	
	let observaciones = $state('');
	let isSaving = $state(false);
	let saveError = $state('');

	// Auto-calculated code
	let codigoGenerado = $derived(`${tipoProyecto}${estadoPredio}${tipoEdificacion}${numeroPisos} - ${mes}${anio.substring(2)} - ${distrito} - ${clienteNombreGen}`);

	let comisionMonto = $derived(() => (Number(valorVenta) || 0) * (Number(comisionPorcentaje) || 0) / 100);

	async function resolveCurrentAsesorName(): Promise<string> {
		try {
			const { data: { session }, error: sessionError } = await supabase.auth.getSession();

			if (sessionError) {
				console.warn('[NuevaVentaModal] No se pudo recuperar la sesión para asignar asesor:', sessionError);
			}

			if (!session?.user?.id) {
				return 'Usuario';
			}

			const { data: empleado, error: empleadoError } = await supabase
				.from('empleados')
				.select('nombre')
				.eq('auth_user_id', session.user.id)
				.maybeSingle();

			if (empleadoError) {
				console.warn('[NuevaVentaModal] No se pudo obtener el nombre del empleado para asignar asesor:', empleadoError);
			}

			const nombreEmpleado = empleado?.nombre?.trim();
			if (nombreEmpleado) {
				return nombreEmpleado;
			}

			return session.user.email?.trim() || 'Usuario';
		} catch (err) {
			console.error('[NuevaVentaModal] Error resolviendo el asesor actual:', err);
			return 'Usuario';
		}
	}

	async function loadCurrentAsesor() {
		const resolvedAsesor = await resolveCurrentAsesorName();
		asesor = resolvedAsesor;
		console.log('[NuevaVentaModal] Asesor inicial cargado:', asesor);
	}

	async function uploadDocument(type: 'contrato' | 'proforma', file: File, projectId: number) {
		console.log(`[NuevaVentaModal] uploadDocument() iniciado - type: ${type}, file: ${file.name}, projectId: ${projectId}`);
		console.log(`[NuevaVentaModal] Tamaño del archivo: ${file.size} bytes, tipo MIME: ${file.type}`);

		const formData = new FormData();
		formData.append('file', file);
		formData.append('type', type);
		formData.append('projectId', String(projectId));

		console.log(`[NuevaVentaModal] FormData construido, llamando a /api/upload-document...`);

		const response = await fetch(resolveApiUrl('/api/upload-document'), {
			method: 'POST',
			body: formData
		});

		console.log(`[NuevaVentaModal] Respuesta del servidor recibida. Status: ${response.status}`);

		const result = await response.json();
		console.log(`[NuevaVentaModal] Resultado JSON parseado:`, result);

		if (!response.ok || !result.success) {
			console.error(`[NuevaVentaModal] ❌ ERROR en uploadDocument: status=${response.status}, success=${result.success}`);
			throw new Error(result.error || 'Error al subir documento.');
		}

		console.log(`[NuevaVentaModal] ✓ uploadDocument completado exitosamente. URL: ${result.url}`);
		return result.url as string;
	}

	async function ensureCliente(nombre: string) {
		console.log('[NuevaVentaModal] ensureCliente() iniciado con nombre:', nombre);
		const trimmed = String(nombre || '').trim();
		if (!trimmed) {
			console.log('[NuevaVentaModal] Nombre vacío, retornando null');
			return null;
		}

		console.log('[NuevaVentaModal] Buscando cliente existente con nombre ILIKE:', trimmed);
		const { data: existing, error: selectError } = await supabase
			.from('cliente')
			.select('id_cliente')
			.ilike('nombre', trimmed)
			.limit(1)
			.maybeSingle();

		if (selectError) {
			console.error('[NuevaVentaModal] ❌ Error consultando cliente:', selectError);
			return null;
		}

		if (existing?.id_cliente) {
			console.log('[NuevaVentaModal] ✓ Cliente existente encontrado con ID:', existing.id_cliente);
			return existing.id_cliente;
		}

		console.log('[NuevaVentaModal] Cliente no existe, creando nuevo...');
		const { data: inserted, error: insertError } = await supabase
			.from('cliente')
			.insert([{ nombre: trimmed }])
			.select('id_cliente')
			.single();

		if (insertError) {
			console.error('[NuevaVentaModal] ❌ Error creando cliente:', insertError);
			return null;
		}

		console.log('[NuevaVentaModal] ✓ Nuevo cliente creado con ID:', inserted?.id_cliente);
		return inserted?.id_cliente ?? null;
	}

	async function loadClientes() {
		console.log('[NuevaVentaModal] loadClientes() iniciado');
		try {
			console.log('[NuevaVentaModal] Consultando supabase.from("cliente")...');
			const { data, error } = await supabase.from('cliente').select('id_cliente,nombre').order('nombre', { ascending: true }).limit(200);
			if (error) throw error;
			clientes = data || [];
			console.log(`[NuevaVentaModal] ✓ ${clientes.length} clientes cargados`);
			console.log('[NuevaVentaModal] Lista de clientes:', clientes.map(c => ({ id: c.id_cliente, nombre: c.nombre })));
		} catch (err) {
			console.error('[NuevaVentaModal] ❌ Error cargando clientes:', err);
			clientes = [];
		}
	}

	onMount(() => {
		console.log('[NuevaVentaModal] onMount() ejecutado, cargando clientes y asesor...');
		loadClientes();
		loadCurrentAsesor();
	});

	async function handleGuardar() {
		console.log('[NuevaVentaModal] === INICIO handleGuardar ===');
		console.log('[NuevaVentaModal] Estado inicial:', {
			proyectoNombre,
			fechaVenta,
			asesor,
			selectedClienteId,
			nuevoClienteNombre,
			valorVenta,
			comisionPorcentaje,
			contratoFile: contratoFile?.name || null,
			proformaFile: proformaFile?.name || null
		});

		saveError = '';

		// === Validación 1: Nombre del proyecto ===
		console.log('[NuevaVentaModal] Validando nombre del proyecto...');
		if (!proyectoNombre.trim()) {
			saveError = 'Debes ingresar un nombre de proyecto.';
			console.warn('[NuevaVentaModal] ❌ ERROR: Nombre del proyecto vacío');
			return;
		}
		console.log('[NuevaVentaModal] ✓ Nombre del proyecto OK:', proyectoNombre);

		// === Validación 2: Fecha de venta ===
		console.log('[NuevaVentaModal] Validando fecha de venta...');
		if (!fechaVenta) {
			saveError = 'Debes seleccionar la fecha de venta.';
			console.warn('[NuevaVentaModal] ❌ ERROR: Fecha de venta vacía');
			return;
		}
		console.log('[NuevaVentaModal] ✓ Fecha de venta OK:', fechaVenta);

		// === Determinación del Cliente ID ===
		console.log('[NuevaVentaModal] Determinando cliente ID...');
		console.log('[NuevaVentaModal]   selectedClienteId:', selectedClienteId);
		console.log('[NuevaVentaModal]   nuevoClienteNombre:', nuevoClienteNombre);
		console.log('[NuevaVentaModal]   cliente (fallback):', cliente);

		let clienteId: number | null = null;

		if (selectedClienteId && selectedClienteId !== '__new__') {
			// Cliente seleccionado del dropdown
			clienteId = Number(selectedClienteId);
			console.log('[NuevaVentaModal] ✓ Cliente seleccionado del dropdown, ID:', clienteId);
		} else if (selectedClienteId === '__new__') {
			// Crear nuevo cliente
			console.log('[NuevaVentaModal] Opción "Nuevo cliente" seleccionada');
			if (!nuevoClienteNombre.trim()) {
				saveError = 'Debes ingresar el nombre del cliente.';
				console.warn('[NuevaVentaModal] ❌ ERROR: Nombre del nuevo cliente vacío');
				return;
			}
			console.log('[NuevaVentaModal] Creando nuevo cliente:', nuevoClienteNombre);
			clienteId = await ensureCliente(nuevoClienteNombre);
			console.log('[NuevaVentaModal] Nuevo cliente creado con ID:', clienteId);
		} else {
			// Fallback a texto libre (legacy)
			console.log('[NuevaVentaModal] Usando modo fallback (sin dropdown seleccionado)');
			if (!cliente.trim()) {
				saveError = 'Debes ingresar el nombre del cliente.';
				console.warn('[NuevaVentaModal] ❌ ERROR: Cliente fallback vacío');
				return;
			}
			console.log('[NuevaVentaModal] Buscando o creando cliente:', cliente);
			clienteId = await ensureCliente(cliente);
			console.log('[NuevaVentaModal] Cliente obtenido/creado con ID:', clienteId);
		}

		if (!clienteId) {
			saveError = 'No se pudo obtener o crear el cliente.';
			console.error('[NuevaVentaModal] ❌ ERROR: No se pudo obtener clienteId');
			return;
		}
		console.log('[NuevaVentaModal] ✓ clienteId final:', clienteId);

		// === Preparación de datos ===
		console.log('[NuevaVentaModal] Preparando datos para inserción...');
		const precioVenta = Number(valorVenta) || 0;
		const comision = Number(comisionPorcentaje) || 0;
		const numeroPisosValue = Number(numeroPisos) || null;
		const fechaInicio = fechaVenta;
		const asesorFinal = (asesor || '').trim() || await resolveCurrentAsesorName();
		asesor = asesorFinal;

		console.log('[NuevaVentaModal] Datos calculados:', {
			precioVenta,
			comision,
			numeroPisosValue,
			fechaInicio
		});

		isSaving = true;
		console.log('[NuevaVentaModal] isSaving = true');

		// === Construcción del Payload ===
		const proyectoPayload = {
			id_cliente: clienteId,
			nombre_proyecto: proyectoNombre,
			fecha_inicio_plan: fechaInicio,
			precio_venta: precioVenta,
			comision_asesor: comision,
			responsable: asesorFinal
		};

		console.log('[NuevaVentaModal] Payload para proyecto:', proyectoPayload);

		// === INSERT proyecto ===
		console.log('[NuevaVentaModal] Insertando proyecto en Supabase...');
		console.log('[NuevaVentaModal] Llamando a supabase.from("proyecto").insert()...');

		const { data, error } = await supabase
			.from('proyecto')
			.insert([proyectoPayload])
			.select('id_proyecto')
			.single();

		if (error) {
			console.error('[NuevaVentaModal] ❌ ERROR al insertar proyecto:', error);
			console.error('[NuevaVentaModal] Error code:', error.code);
			console.error('[NuevaVentaModal] Error message:', error.message);
			console.error('[NuevaVentaModal] Error details:', error.details);
			saveError = 'Error guardando la venta en Proyectos. Revisa los datos e intenta de nuevo.';
			isSaving = false;
			return;
		}

		console.log('[NuevaVentaModal] ✓ Proyecto insertado exitosamente');
		console.log('[NuevaVentaModal] Datos retornados:', data);

		if (data?.id_proyecto) {
			const nuevoProyectoId = data.id_proyecto;
			console.log('[NuevaVentaModal] Nuevo ID_PROYECTO:', nuevoProyectoId);

			// === UPSERT centro_costo ===
			const centroCostoPayload = {
				codigo: `PROY-${nuevoProyectoId}`,
				nombre: proyectoNombre,
				tipo: 'proyecto',
				id_referencia: nuevoProyectoId
			};

			console.log('[NuevaVentaModal] Payload para centro_costo:', centroCostoPayload);
			console.log('[NuevaVentaModal] Insertando/actualizando centro_costo...');

			const ccResult = await supabase.from('centro_costo').upsert([centroCostoPayload], { onConflict: 'id_referencia', ignoreDuplicates: true });

			console.log('[NuevaVentaModal] ✓ Centro de costo actualizado');
			console.log('[NuevaVentaModal] Resultado centro_costo:', ccResult);

			// === UPLOAD documentos ===
			try {
				console.log('[NuevaVentaModal] Verificando documentos para subir...');
				console.log('[NuevaVentaModal]   contratoFile:', contratoFile ? `${contratoFile.name} (${contratoFile.size} bytes)` : 'null');
				console.log('[NuevaVentaModal]   proformaFile:', proformaFile ? `${proformaFile.name} (${proformaFile.size} bytes)` : 'null');

				if (contratoFile) {
					console.log('[NuevaVentaModal] Subiendo contrato...');
					const contratoResult = await uploadDocument('contrato', contratoFile, nuevoProyectoId);
					console.log('[NuevaVentaModal] ✓ Contrato subido exitosamente. URL:', contratoResult);
				}

				if (proformaFile) {
					console.log('[NuevaVentaModal] Subiendo proforma...');
					const proformaResult = await uploadDocument('proforma', proformaFile, nuevoProyectoId);
					console.log('[NuevaVentaModal] ✓ Proforma subida exitosamente. URL:', proformaResult);
				}

				console.log('[NuevaVentaModal] ✓ Todos los documentos procesados');
			} catch (uploadError) {
				console.error('[NuevaVentaModal] ❌ ERROR al subir documentos:', uploadError);
				console.error('[NuevaVentaModal] Error tipo:', typeof uploadError);
				console.error('[NuevaVentaModal] Error stack:', uploadError instanceof Error ? uploadError.stack : 'N/A');

				saveError = String(uploadError instanceof Error ? uploadError.message : uploadError);
				isSaving = false;
				return;
			}
		} else {
			console.warn('[NuevaVentaModal] ⚠️ Advertencia: data no contiene id_proyecto');
		}

		// === Finalización ===
		isSaving = false;
		console.log('[NuevaVentaModal] isSaving = false');
		console.log('[NuevaVentaModal] Llamando onSaved()...');
		onSaved();
		console.log('[NuevaVentaModal] Llamando onClose()...');
		onClose();
		console.log('[NuevaVentaModal] === FIN handleGuardar (exitoso) ===');
	}
</script>

{#if isOpen}
	<div class="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-[100] flex items-center justify-center p-4 overflow-y-auto" transition:fade={{duration: 200}}>
		<div class="bg-white rounded-2xl shadow-2xl w-full max-w-5xl my-8 relative" transition:scale={{duration: 300, start: 0.95}}>
			
			<!-- Header -->
			<div class="flex items-center justify-between p-6 border-b border-slate-100 sticky top-0 bg-white rounded-t-2xl z-10">
				<h2 class="text-xl font-bold text-slate-800">Nueva venta</h2>
				<button on:click={onClose} class="text-slate-400 hover:text-slate-600 transition-colors p-2 rounded-full hover:bg-slate-100">
					<i class="fas fa-times text-lg"></i>
				</button>
			</div>

			<!-- Body -->
			<div class="p-6 md:p-8 overflow-y-auto max-h-[calc(100vh-200px)]">
				<div class="space-y-8">
					
					<!-- Información general -->
					<section>
						<h3 class="text-sm font-bold text-slate-800 mb-4 flex items-center gap-2">
							<div class="w-1.5 h-4 bg-blue-600 rounded-full"></div>
							Información general
						</h3>
						<div class="grid grid-cols-1 md:grid-cols-4 gap-4">
							<div class="flex flex-col gap-1 md:col-span-1">
								<label class="text-xs font-semibold text-slate-600">Proyecto *</label>
								<input type="text" bind:value={proyectoNombre} placeholder="Nombre del proyecto" class="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all">
							</div>
							<div class="flex flex-col gap-1 md:col-span-1">
								<label class="text-xs font-semibold text-slate-600">Código de proyecto</label>
								<input type="text" readonly value={codigoGenerado} class="px-3 py-2 bg-slate-100 border border-slate-200 text-slate-500 rounded-lg text-sm outline-none cursor-not-allowed">
								<span class="text-[10px] text-slate-400 mt-0.5">Se generará automáticamente</span>
							</div>
							<div class="flex flex-col gap-1 md:col-span-1">
								<label class="text-xs font-semibold text-slate-600">Fecha de venta *</label>
								<input type="date" bind:value={fechaVenta} class="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all text-slate-700">
							</div>
							<div class="flex flex-col gap-1 md:col-span-1">
								<label class="text-xs font-semibold text-slate-600">Asesor *</label>
								<input type="text" readonly value={asesor || 'Cargando asesor...'} class="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none text-slate-700">
								<span class="text-[10px] text-slate-400 mt-0.5">Se asigna automáticamente con el usuario activo</span>
							</div>
							<div class="flex flex-col gap-1 md:col-span-1">
								<label class="text-xs font-semibold text-slate-600">Cliente *</label>
								<select bind:value={selectedClienteId} class="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all appearance-none text-slate-700">
									<option value="">-- Selecciona cliente --</option>
									{#each clientes as c}
										<option value={c.id_cliente}>{c.nombre}</option>
									{/each}
									<option value="__new__">+ Nuevo cliente</option>
								</select>
								{#if selectedClienteId === '__new__'}
									<input type="text" bind:value={nuevoClienteNombre} placeholder="Nombre del nuevo cliente" class="mt-2 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all text-slate-700" />
								{/if}
							</div>
							<div class="flex flex-col gap-1 md:col-span-1">
								<label class="text-xs font-semibold text-slate-600">Valor venta (S/) *</label>
								<input type="text" bind:value={valorVenta} class="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all text-slate-700">
							</div>
							<div class="flex flex-col gap-1 md:col-span-1 grid grid-cols-2 gap-2">
								<div class="flex flex-col gap-1">
									<label class="text-xs font-semibold text-slate-600">Comisión (%) *</label>
									<input type="number" bind:value={comisionPorcentaje} class="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all text-slate-700">
								</div>
								<div class="flex flex-col gap-1">
									<label class="text-xs font-semibold text-slate-600">Comisión (S/)</label>
									<input type="text" readonly bind:value={comisionMonto} class="px-3 py-2 bg-slate-100 border border-slate-200 text-slate-500 rounded-lg text-sm outline-none cursor-not-allowed">
								</div>
							</div>
							<div class="flex flex-col gap-1 md:col-span-1 grid grid-cols-2 gap-2">
								<div class="flex flex-col gap-1">
									<label class="text-xs font-semibold text-slate-600">Proforma</label>
									<label class="cursor-pointer px-3 py-2 border border-slate-200 rounded-lg text-sm text-slate-600 hover:bg-slate-50 flex items-center justify-center gap-2 transition-colors">
										<i class="fas fa-file-pdf text-rose-500"></i>
										<input type="file" accept="application/pdf" on:change={(event) => proformaFile = event.currentTarget.files?.[0] ?? null} class="hidden" />
										{#if proformaFile}
											<span class="text-xs text-slate-500 truncate max-w-[120px]">{proformaFile.name}</span>
										{:else}
											<span>Adjuntar PDF</span>
										{/if}
									</label>
								</div>
								<div class="flex flex-col gap-1">
									<label class="text-xs font-semibold text-slate-600">Contrato</label>
									<label class="cursor-pointer px-3 py-2 border border-slate-200 rounded-lg text-sm text-slate-600 hover:bg-slate-50 flex items-center justify-center gap-2 transition-colors">
										<i class="fas fa-file-pdf text-rose-500"></i>
										<input type="file" accept="application/pdf" on:change={(event) => contratoFile = event.currentTarget.files?.[0] ?? null} class="hidden" />
										{#if contratoFile}
											<span class="text-xs text-slate-500 truncate max-w-[120px]">{contratoFile.name}</span>
										{:else}
											<span>Adjuntar PDF</span>
										{/if}
									</label>
								</div>
							</div>
						</div>
					</section>

					<!-- Características del proyecto nuevo -->
					<section class="border-t border-slate-100 pt-6">
						<h3 class="text-sm font-bold text-slate-800 mb-4 flex items-center gap-2">
							<div class="w-1.5 h-4 bg-orange-500 rounded-full"></div>
							Características del proyecto nuevo
						</h3>
						<div class="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
							<div class="flex flex-col gap-1">
								<label class="text-xs font-semibold text-slate-600">Tipo de proyecto *</label>
								<select bind:value={tipoProyecto} class="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all">
									<option value="O">Proyecto de Obra (O)</option>
									<option value="M">Mantenimiento (M)</option>
								</select>
							</div>
							<div class="flex flex-col gap-1">
								<label class="text-xs font-semibold text-slate-600">Estado del predio *</label>
								<select bind:value={estadoPredio} class="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all">
									<option value="A">Ampliación (A)</option>
									<option value="N">Nuevo (N)</option>
								</select>
							</div>
							<div class="flex flex-col gap-1">
								<label class="text-xs font-semibold text-slate-600">Tipo de edificación *</label>
								<select bind:value={tipoEdificacion} class="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all">
									<option value="M">Viv. Multifamiliar (M)</option>
									<option value="U">Viv. Unifamiliar (U)</option>
									<option value="C">Comercial (C)</option>
								</select>
							</div>
							<div class="flex flex-col gap-1">
								<label class="text-xs font-semibold text-slate-600">Número de pisos *</label>
								<input type="number" bind:value={numeroPisos} class="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all">
							</div>

							<div class="flex flex-col gap-1">
								<label class="text-xs font-semibold text-slate-600">Mes *</label>
								<select bind:value={mes} class="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all">
									<option value="02">02 - Febrero</option>
									<option value="03">03 - Marzo</option>
								</select>
							</div>
							<div class="flex flex-col gap-1">
								<label class="text-xs font-semibold text-slate-600">Año *</label>
								<select bind:value={anio} class="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all">
									<option value="2026">2026</option>
									<option value="2027">2027</option>
								</select>
							</div>
							<div class="flex flex-col gap-1">
								<label class="text-xs font-semibold text-slate-600">Distrito *</label>
								<select bind:value={distrito} class="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all">
									<option value="ATE Salamanca">Ate</option>
									<option value="Miraflores">Miraflores</option>
									<option value="San Isidro">San Isidro</option>
								</select>
							</div>
							<div class="flex flex-col gap-1">
								<label class="text-xs font-semibold text-slate-600">Nombre del cliente *</label>
								<input type="text" bind:value={clienteNombreGen} class="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all">
							</div>
						</div>

						<!-- Generador de Código visual -->
						<div class="bg-blue-50/50 border border-blue-100 rounded-xl p-5 mb-2">
							<div class="flex items-start gap-3 mb-4">
								<i class="fas fa-info-circle text-blue-500 mt-0.5"></i>
								<div>
									<h4 class="text-sm font-semibold text-blue-900">Generación automática del código del proyecto</h4>
									<p class="text-xs text-blue-700/80 mt-0.5">El código se genera según los parámetros seleccionados. Verifica la información antes de guardar.</p>
								</div>
							</div>

							<!-- Visualizer -->
							<div class="flex flex-wrap items-center gap-2 text-xs font-bold justify-center md:justify-start">
								<div class="flex flex-col items-center">
									<span class="text-emerald-500 text-sm mb-1">{tipoProyecto}</span>
									<span class="text-[9px] text-slate-500 font-normal">Tipo de proyecto</span>
									<span class="text-[9px] text-slate-400 font-normal">(Obra)</span>
								</div>
								<span class="text-slate-300">-</span>
								<div class="flex flex-col items-center">
									<span class="text-blue-500 text-sm mb-1">{estadoPredio}</span>
									<span class="text-[9px] text-slate-500 font-normal">Estado del predio</span>
									<span class="text-[9px] text-slate-400 font-normal">(Ampliación)</span>
								</div>
								<span class="text-slate-300">-</span>
								<div class="flex flex-col items-center">
									<span class="text-purple-500 text-sm mb-1">{tipoEdificacion}</span>
									<span class="text-[9px] text-slate-500 font-normal">Tipo de edificación</span>
									<span class="text-[9px] text-slate-400 font-normal">(Multifamiliar)</span>
								</div>
								<span class="text-slate-300">-</span>
								<div class="flex flex-col items-center">
									<span class="text-orange-500 text-sm mb-1">{numeroPisos}</span>
									<span class="text-[9px] text-slate-500 font-normal">Nº de pisos</span>
								</div>
								<span class="text-slate-300">-</span>
								<div class="flex flex-col items-center">
									<span class="text-rose-500 text-sm mb-1">{mes}</span>
									<span class="text-[9px] text-slate-500 font-normal">Mes</span>
									<span class="text-[9px] text-slate-400 font-normal">(Febrero)</span>
								</div>
								<span class="text-slate-300">-</span>
								<div class="flex flex-col items-center">
									<span class="text-blue-600 text-sm mb-1">{anio.substring(2)}</span>
									<span class="text-[9px] text-slate-500 font-normal">Año</span>
									<span class="text-[9px] text-slate-400 font-normal">({anio})</span>
								</div>
								<span class="text-slate-300">-</span>
								<div class="flex flex-col items-center">
									<span class="text-slate-800 text-sm mb-1 px-2">{distrito}</span>
									<span class="text-[9px] text-slate-500 font-normal">Distrito</span>
								</div>
								<span class="text-slate-300">-</span>
								<div class="flex flex-col items-center">
									<span class="text-slate-800 text-sm mb-1 px-2">{clienteNombreGen}</span>
									<span class="text-[9px] text-slate-500 font-normal">Cliente</span>
								</div>
							</div>

							<div class="mt-6 flex items-center gap-4 bg-white px-4 py-3 rounded-lg border border-slate-200">
								<span class="text-sm font-bold text-slate-800">Código generado:</span>
								<div class="bg-blue-50 text-blue-700 px-4 py-1.5 rounded text-sm font-bold tracking-wide flex-1 md:flex-none flex items-center justify-between">
									{codigoGenerado}
									<button class="ml-4 text-blue-400 hover:text-blue-600"><i class="far fa-copy"></i></button>
								</div>
							</div>
						</div>
					</section>

					<!-- Observaciones -->
					<section class="border-t border-slate-100 pt-6">
						<h3 class="text-sm font-bold text-slate-800 mb-4 flex items-center gap-2">
							<div class="w-1.5 h-4 bg-purple-500 rounded-full"></div>
							Observaciones
						</h3>
						<div class="relative">
							<textarea bind:value={observaciones} placeholder="Ingresa observaciones adicionales sobre la venta (opcional)" rows="3" class="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all resize-none"></textarea>
							<div class="absolute bottom-3 right-3 text-[10px] text-slate-400">
								{observaciones.length}/500
							</div>
						</div>
					</section>
				</div>
			</div>

			<!-- Footer -->
			<div class="p-6 border-t border-slate-100 bg-slate-50 rounded-b-2xl flex justify-end gap-3">
				<button on:click={onClose} class="px-5 py-2.5 bg-white border border-slate-200 text-slate-600 rounded-xl hover:bg-slate-50 hover:text-slate-800 font-medium text-sm transition-colors shadow-sm">
					Cancelar
				</button>
				<button on:click={() => !isSaving && handleGuardar()} disabled={isSaving} aria-busy={isSaving} class="px-6 py-2.5 bg-blue-600 text-white rounded-xl font-medium text-sm shadow-md shadow-blue-600/20 active:scale-[0.98] transition-all flex items-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed">
					{#if isSaving}
						<i class="fas fa-spinner fa-spin"></i> Guardando...
					{:else}
						<i class="fas fa-save"></i> Guardar venta
					{/if}
				</button>
			</div>
		</div>
	</div>
{/if}
