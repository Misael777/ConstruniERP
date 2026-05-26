<script lang="ts">
	import { onMount } from 'svelte';
	import { supabase } from '$lib/supabaseClient';

	let { isOpen = false, onClose, onSave, ventaToEdit = null, empleados = [], obras = [], consultorias = [] } = $props<{
		isOpen: boolean;
		onClose: () => void;
		onSave: () => void;
		ventaToEdit?: any;
		empleados?: any[];
		obras?: any[];
		consultorias?: any[];
	}>();

	// Listas maestras para los campos de selección de características
	const tiposProyecto = [
		{ value: 'O', label: 'Proyecto de Obra (O)' },
		{ value: 'C', label: 'Proyecto de Consultoría (C)' }
	];

	const estadosPredio = [
		{ value: 'A', label: 'Ampliación (A)' },
		{ value: 'N', label: 'Nuevo (N)' },
		{ value: 'R', label: 'Remodelación (R)' }
	];

	const tiposEdificacion = [
		{ value: 'M', label: 'Viv. Multifamiliar (M)' },
		{ value: 'U', label: 'Viv. Unifamiliar (U)' },
		{ value: 'C', label: 'Comercial (C)' },
		{ value: 'O', label: 'Oficinas (O)' }
	];

	const meses = [
		{ value: '01', label: '01 - Enero' },
		{ value: '02', label: '02 - Febrero' },
		{ value: '03', label: '03 - Marzo' },
		{ value: '04', label: '04 - Abril' },
		{ value: '05', label: '05 - Mayo' },
		{ value: '06', label: '06 - Junio' },
		{ value: '07', label: '07 - Julio' },
		{ value: '08', label: '08 - Agosto' },
		{ value: '09', label: '09 - Septiembre' },
		{ value: '10', label: '10 - Octubre' },
		{ value: '11', label: '11 - Noviembre' },
		{ value: '12', label: '12 - Diciembre' }
	];

	const distritos = [
		{ value: 'Ancón', label: 'Ancón' },
		{ value: 'Ate', label: 'Ate' },
		{ value: 'ATE Salamanca', label: 'Ate Salamanca' },
		{ value: 'Barranco', label: 'Barranco' },
		{ value: 'Bellavista', label: 'Bellavista' },
		{ value: 'Breña', label: 'Breña' },
		{ value: 'Callao', label: 'Callao' },
		{ value: 'Carabayllo', label: 'Carabayllo' },
		{ value: 'Carmen de La Legua Reynoso', label: 'Carmen de La Legua Reynoso' },
		{ value: 'Chaclacayo', label: 'Chaclacayo' },
		{ value: 'Chorrillos', label: 'Chorrillos' },
		{ value: 'Cieneguilla', label: 'Cieneguilla' },
		{ value: 'Comas', label: 'Comas' },
		{ value: 'El Agustino', label: 'El Agustino' },
		{ value: 'Independencia', label: 'Independencia' },
		{ value: 'Jesús María', label: 'Jesús María' },
		{ value: 'La Molina', label: 'La Molina' },
		{ value: 'La Perla', label: 'La Perla' },
		{ value: 'La Punta', label: 'La Punta' },
		{ value: 'La Victoria', label: 'La Victoria' },
		{ value: 'Lima', label: 'Lima' },
		{ value: 'Lince', label: 'Lince' },
		{ value: 'Los Olivos', label: 'Los Olivos' },
		{ value: 'Lurigancho', label: 'Lurigancho' },
		{ value: 'Lurín', label: 'Lurín' },
		{ value: 'Magdalena del Mar', label: 'Magdalena del Mar' },
		{ value: 'Mi Perú', label: 'Mi Perú' },
		{ value: 'Miraflores', label: 'Miraflores' },
		{ value: 'Pachacámac', label: 'Pachacámac' },
		{ value: 'Pucusana', label: 'Pucusana' },
		{ value: 'Pueblo Libre', label: 'Pueblo Libre' },
		{ value: 'Puente Piedra', label: 'Puente Piedra' },
		{ value: 'Punta Hermosa', label: 'Punta Hermosa' },
		{ value: 'Punta Negra', label: 'Punta Negra' },
		{ value: 'Rímac', label: 'Rímac' },
		{ value: 'San Bartolo', label: 'San Bartolo' },
		{ value: 'San Borja', label: 'San Borja' },
		{ value: 'San Isidro', label: 'San Isidro' },
		{ value: 'San Juan de Lurigancho', label: 'San Juan de Lurigancho' },
		{ value: 'San Juan de Miraflores', label: 'San Juan de Miraflores' },
		{ value: 'San Luis', label: 'San Luis' },
		{ value: 'San Martín de Porres', label: 'San Martín de Porres' },
		{ value: 'San Miguel', label: 'San Miguel' },
		{ value: 'Santa Anita', label: 'Santa Anita' },
		{ value: 'Santa María del Mar', label: 'Santa María del Mar' },
		{ value: 'Santa Rosa', label: 'Santa Rosa' },
		{ value: 'Santiago de Surco', label: 'Santiago de Surco' },
		{ value: 'Surquillo', label: 'Surquillo' },
		{ value: 'Ventanilla', label: 'Ventanilla' },
		{ value: 'Villa El Salvador', label: 'Villa El Salvador' },
		{ value: 'Villa María del Triunfo', label: 'Villa María del Triunfo' },
		{ value: 'Otros', label: 'Otros' }
	];

	// Estado del formulario
	let proyectoId = $state(0);
	let proyecto = $state('');
	let fechaVenta = $state('');
	let asesor = $state('');
	let cliente = $state('');
	let valorVenta = $state(15000);
	let comisionPorcentaje = $state(10);
	let tipoProyecto = $state('O');
	let estadoPredio = $state('A');
	let tipoEdificacion = $state('M');
	let pisos = $state(4);
	let mes = $state('02');
	let anio = $state('2026');
	let distrito = $state('ATE Salamanca');
	let observaciones = $state('');

	// Sincronizar el nombre del proyecto cuando cambia proyectoId o el catálogo
	$effect(() => {
		if (proyectoId) {
			const list = tipoProyecto === 'O' ? obras : consultorias;
			const selectedProj = list.find((p: any) => p.id === proyectoId);
			if (selectedProj) {
				proyecto = selectedProj.nombre;
			}
		} else {
			proyecto = '';
		}
	});



	// Cargar datos si estamos en modo edición
	$effect(() => {
		if (ventaToEdit) {
			tipoProyecto = ventaToEdit.tipo_proyecto || 'O';
			proyectoId = tipoProyecto === 'O' ? (ventaToEdit.obra_id || 0) : (ventaToEdit.consultoria_id || 0);
			proyecto = ventaToEdit.concepto || '';
			fechaVenta = ventaToEdit.fecha_venta || '';
			// Parse comments to extract Advisor/Client/Obs
			const parts = (ventaToEdit.comentarios || '').split(' | ');
			asesor = parts.find((p: string) => p.startsWith('Asesor:'))?.replace('Asesor: ', '') || '';
			cliente = ventaToEdit.clientes?.nombre || '';
			valorVenta = ventaToEdit.precio_final || 0;
			comisionPorcentaje = ventaToEdit.comision_porcentaje || 0;
			
			// Intento de parsear características del código
			const code = ventaToEdit.codigo || '';
			if (code && code.includes(' - ')) {
				const tokens = code.split(' - ');
				const firstToken = tokens[0]; // Ej. OAM4
				if (firstToken.length >= 4) {
					tipoEdificacion = firstToken.charAt(2);
					estadoPredio = firstToken.charAt(1);
					pisos = parseInt(firstToken.substring(3)) || 4;
				}
				const secondToken = tokens[1]; // Ej. 0226
				if (secondToken.length === 4) {
					mes = secondToken.substring(0, 2);
					anio = '20' + secondToken.substring(2);
				}
				distrito = tokens[2] || 'ATE Salamanca';
			}
			observaciones = parts.find((p: string) => p.startsWith('Obs:'))?.replace('Obs: ', '') || '';
		} else {
			// Reiniciar a valores por defecto
			tipoProyecto = 'O';
			proyectoId = 0;
			proyecto = '';
			fechaVenta = new Date().toISOString().split('T')[0];
			asesor = '';
			cliente = '';
			valorVenta = 15000;
			comisionPorcentaje = 10;
			estadoPredio = 'A';
			tipoEdificacion = 'M';
			pisos = 4;
			mes = '02';
			anio = '2026';
			distrito = 'ATE Salamanca';
			observaciones = '';
		}
	});

	// Variables derivadas / calculadas reactivamente
	let comisionMonto = $derived(valorVenta * (comisionPorcentaje / 100));
	let anioDosDigitos = $derived(anio ? anio.substring(2) : '26');
	
	// Generación del código según la regla: {Tipo}{Estado}{Edificación}{Pisos} - {Mes}{Año} - {Distrito} - {Cliente}
	let codigoGenerado = $derived(
		`${tipoProyecto}${estadoPredio}${tipoEdificacion}${pisos} - ${mes}${anioDosDigitos} - ${distrito} - ${cliente || 'Cliente'}`
	);

	// Contadores
	let obsCharCount = $derived(observaciones.length);

	let isSaving = $state(false);
	let modalError = $state('');

	function handleClose() {
		modalError = '';
		onClose();
	}

	function copyToClipboard() {
		navigator.clipboard.writeText(codigoGenerado);
		alert('¡Código de proyecto copiado al portapapeles!');
	}

	async function handleSubmit() {
		modalError = '';
		if (!proyectoId) {
			modalError = 'Debe seleccionar un proyecto válido de la lista.';
			return;
		}
		if (!fechaVenta) {
			modalError = 'La fecha de venta es obligatoria.';
			return;
		}
		if (!asesor) {
			modalError = 'Debe seleccionar un asesor.';
			return;
		}
		if (!cliente || !cliente.trim()) {
			modalError = 'El nombre del cliente es obligatorio.';
			return;
		}

		isSaving = true;
		try {
			console.log('[NuevaVentaModal] Guardando venta. Modo:', ventaToEdit ? 'Edición' : 'Creación');
			
			// 1. Obtener o crear el cliente en la tabla maestras
			let clienteId: number;
			const { data: existingCliente, error: findError } = await supabase
				.from('clientes')
				.select('id')
				.eq('nombre', cliente.trim())
				.maybeSingle();

			if (findError) {
				console.error('[NuevaVentaModal] Error buscando cliente:', findError);
				throw findError;
			}

			if (existingCliente) {
				clienteId = existingCliente.id;
			} else {
				console.log('[NuevaVentaModal] Cliente no existe, creando:', cliente.trim());
				const { data: newCliente, error: createError } = await supabase
					.from('clientes')
					.insert({ nombre: cliente.trim() })
					.select('id')
					.single();
				if (createError) {
					console.error('[NuevaVentaModal] Error creando cliente:', createError);
					throw createError;
				}
				clienteId = newCliente.id;
			}

			// 2. Asociar Obra o Consultoría según tipoProyecto y obtener su nombre
			let obraId: number | null = null;
			let consultoriaId: number | null = null;
			let proyectoNombre = '';

			if (tipoProyecto === 'O') {
				obraId = proyectoId;
				const { data: obra, error: obraError } = await supabase
					.from('obras')
					.select('nombre')
					.eq('id', obraId)
					.single();
				if (obraError || !obra) {
					console.error('[NuevaVentaModal] Error buscando obra:', obraError);
					throw new Error('El proyecto de obra seleccionado no existe.');
				}
				proyectoNombre = obra.nombre;
			} else {
				consultoriaId = proyectoId;
				const { data: consultoria, error: consultoriaError } = await supabase
					.from('consultorias')
					.select('nombre')
					.eq('id', consultoriaId)
					.single();
				if (consultoriaError || !consultoria) {
					console.error('[NuevaVentaModal] Error buscando consultoría:', consultoriaError);
					throw new Error('El proyecto de consultoría seleccionado no existe.');
				}
				proyectoNombre = consultoria.nombre;
			}

			const payload: any = {
				concepto: proyectoNombre,
				codigo: codigoGenerado,
				codigo_generado: codigoGenerado,
				fecha_venta: fechaVenta,
				precio_final: valorVenta,
				valor_unitario: valorVenta,
				comision_porcentaje: comisionPorcentaje,
				comision_monto: comisionMonto,
				tipo_proyecto: tipoProyecto,
				cliente_id: clienteId,
				obra_id: obraId,
				consultoria_id: consultoriaId,
				comentarios: `Asesor: ${asesor} | Obs: ${observaciones}`
			};

			if (ventaToEdit) {
				console.log('[NuevaVentaModal] Actualizando venta id:', ventaToEdit.id, payload);
				const { error: updateError } = await supabase
					.from('ventas')
					.update(payload)
					.eq('id', ventaToEdit.id);

				if (updateError) {
					console.error('[NuevaVentaModal] Error actualizando venta:', updateError);
					throw updateError;
				}
			} else {
				payload.status = 'En Ejecución';
				payload.status_pago = 'Pendiente';
				console.log('[NuevaVentaModal] Creando nueva venta:', payload);
				const { error: insertError } = await supabase
					.from('ventas')
					.insert([payload]);

				if (insertError) {
					console.error('[NuevaVentaModal] Error insertando venta:', insertError);
					throw insertError;
				}
			}

			console.log('[NuevaVentaModal] Operación exitosa. Invocando onSave y cerrando.');
			if (onSave) onSave();
			handleClose();
		} catch (err: any) {
			console.error('[NuevaVentaModal] Error en handleSubmit:', err);
			modalError = err.message || 'Error al procesar la venta en la base de datos.';
		} finally {
			isSaving = false;
		}
	}
</script>

{#if isOpen}
<div class="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 overflow-y-auto">
	<div class="bg-white rounded-3xl w-full max-w-4xl max-h-[92vh] overflow-y-auto shadow-2xl border border-slate-100 flex flex-col">
		<!-- Header -->
		<div class="flex justify-between items-center px-8 py-5 border-b border-slate-100 bg-slate-50/70 backdrop-blur-md sticky top-0 z-20">
			<div class="flex items-center gap-2">
				<div class="w-8 h-8 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center">
					<i class="fas fa-file-invoice-dollar text-sm"></i>
				</div>
				<h2 class="text-lg font-bold text-slate-800">{ventaToEdit ? 'Editar Venta' : 'Nueva venta'}</h2>
			</div>
			<button onclick={handleClose} class="text-slate-400 hover:text-slate-600 transition-colors p-1 cursor-pointer" title="Cerrar modal">
				<i class="fas fa-times text-lg"></i>
			</button>
		</div>

		<!-- Body Form -->
		<form 
			onsubmit={(e) => { e.preventDefault(); handleSubmit(); }}
			class="p-8 space-y-8 flex-1"
		>
			{#if modalError}
				<div class="p-4 rounded-2xl bg-rose-50 border border-rose-100 text-rose-800 text-sm font-medium flex items-center gap-2.5 transition-all">
					<i class="fas fa-exclamation-triangle text-rose-600 text-base"></i>
					{modalError}
				</div>
			{/if}

			<!-- Bloque 1: Información General -->
			<div>
				<h3 class="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4">Información general</h3>
				<div class="grid grid-cols-1 md:grid-cols-4 gap-4">

					<!-- 1. Tipo de proyecto — must come FIRST so it filters the project list below -->
					<div class="col-span-1">
						<label class="block text-xs font-semibold text-slate-600 mb-1">Tipo de proyecto *</label>
						<select name="tipo_proyecto_info" bind:value={tipoProyecto} onchange={() => { proyectoId = 0; proyecto = ''; }} class="w-full text-sm px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 transition-all cursor-pointer">
							{#each tiposProyecto as t}
								<option value={t.value}>{t.label}</option>
							{/each}
						</select>
					</div>

					<!-- 2. Proyecto — filtered by Tipo de proyecto -->
					<div class="col-span-1">
						<label class="block text-xs font-semibold text-slate-600 mb-1">
							Proyecto *
							<span class="ml-1 text-[10px] font-normal text-slate-400">
								({(tipoProyecto === 'O' ? obras : consultorias).length} disponibles)
							</span>
						</label>
						<select name="proyecto_id" bind:value={proyectoId} class="w-full text-sm px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:bg-white outline-none transition-all cursor-pointer" required>
							<option value={0}>Seleccione proyecto</option>
							{#each (tipoProyecto === 'O' ? obras : consultorias) as proj}
								<option value={proj.id}>{proj.nombre} ({proj.codigo || 'S/C'})</option>
							{/each}
						</select>
						<input type="hidden" name="proyecto_nombre" value={proyecto} />
						{#if (tipoProyecto === 'O' ? obras : consultorias).length === 0}
							<p class="text-[10px] text-amber-600 font-semibold mt-1 flex items-center gap-1">
								<i class="fas fa-exclamation-triangle"></i>
								No hay {tipoProyecto === 'O' ? 'obras' : 'consultorías'} registradas. Ve al módulo de Proyectos para agregar una.
							</p>
						{/if}
					</div>

					<div class="col-span-1">
						<label class="block text-xs font-semibold text-slate-600 mb-1">Código de proyecto</label>
						<div class="relative">
							<input type="text" name="codigo" value={codigoGenerado} readonly class="w-full text-sm px-3 py-2 bg-slate-100 border border-slate-200 rounded-xl text-slate-500 cursor-not-allowed outline-none" />
						</div>
						<span class="text-[10px] text-slate-400 mt-1 block">Se generará automáticamente</span>
					</div>
					<div class="col-span-1">
						<label class="block text-xs font-semibold text-slate-600 mb-1">Fecha de venta *</label>
						<input type="date" name="fecha" bind:value={fechaVenta} class="w-full text-sm px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:bg-white outline-none transition-all" required />
					</div>
					<div class="col-span-1">
						<label class="block text-xs font-semibold text-slate-600 mb-1">Asesor *</label>
						<select name="asesor" bind:value={asesor} class="w-full text-sm px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:bg-white outline-none transition-all cursor-pointer" required>
							<option value="">Seleccione asesor</option>
							{#each empleados as emp}
								<option value={emp.nombre}>{emp.nombre}</option>
							{/each}
							<option value="Andrea Martinez">Andrea Martinez</option>
							<option value="Juan Lopez">Juan Lopez</option>
							<option value="Maria Condori">Maria Condori</option>
						</select>
					</div>

					<div class="col-span-1">
						<label class="block text-xs font-semibold text-slate-600 mb-1">Cliente *</label>
						<input type="text" name="cliente" bind:value={cliente} class="w-full text-sm px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:bg-white outline-none transition-all" placeholder="Ej. María Jhong" required />
					</div>
					<div class="col-span-1">
						<label class="block text-xs font-semibold text-slate-600 mb-1">Valor venta (S/) *</label>
						<input type="number" step="0.01" name="valor" bind:value={valorVenta} class="w-full text-sm px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:bg-white outline-none transition-all" required />
					</div>
					<div class="col-span-1">
						<div class="grid grid-cols-2 gap-2">
							<div>
								<label class="block text-xs font-semibold text-slate-600 mb-1">Comisión (%) *</label>
								<input type="number" step="0.5" name="comisionPorcentaje" bind:value={comisionPorcentaje} class="w-full text-sm px-2 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:bg-white outline-none transition-all text-center" required />
							</div>
							<div>
								<label class="block text-xs font-semibold text-slate-600 mb-1">Comisión (S/)</label>
								<input type="text" value={comisionMonto.toLocaleString('es-PE', { minimumFractionDigits: 2 })} readonly class="w-full text-sm px-2 py-2 bg-slate-100 border border-slate-200 rounded-xl text-slate-500 cursor-not-allowed text-center outline-none" />
								<input type="hidden" name="comisionMonto" value={comisionMonto} />
							</div>
						</div>
					</div>
					<div class="col-span-1">
						<div class="grid grid-cols-2 gap-2">
							<div>
								<label class="block text-xs font-semibold text-slate-600 mb-1">Proforma</label>
								<label class="w-full h-[38px] px-2 border border-slate-200 hover:border-blue-500 text-slate-600 hover:text-blue-600 rounded-xl flex items-center justify-center gap-1.5 cursor-pointer bg-slate-50 hover:bg-blue-50/30 transition-all text-xs font-medium">
									<i class="fas fa-file-pdf text-red-500"></i> Adjuntar PDF
									<input type="file" name="proforma_pdf" class="hidden" accept=".pdf" />
								</label>
							</div>
							<div>
								<label class="block text-xs font-semibold text-slate-600 mb-1">Contrato</label>
								<label class="w-full h-[38px] px-2 border border-slate-200 hover:border-blue-500 text-slate-600 hover:text-blue-600 rounded-xl flex items-center justify-center gap-1.5 cursor-pointer bg-slate-50 hover:bg-blue-50/30 transition-all text-xs font-medium">
									<i class="fas fa-file-pdf text-red-500"></i> Adjuntar PDF
									<input type="file" name="contrato_pdf" class="hidden" accept=".pdf" />
								</label>
							</div>
						</div>
					</div>
				</div>
			</div>

			<!-- Bloque 2: Características del Proyecto Nuevo -->
			<div>
				<h3 class="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4">
					Características del proyecto nuevo
					<span class="ml-2 normal-case font-normal text-blue-500">
						— tipo: {tipoProyecto === 'O' ? 'Obra' : 'Consultoría'}
					</span>
				</h3>
				<div class="grid grid-cols-1 md:grid-cols-4 gap-4">
					<div>
						<label class="block text-xs font-semibold text-slate-600 mb-1">Estado del predio *</label>

						<select bind:value={estadoPredio} class="w-full text-sm px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 transition-all cursor-pointer">
							{#each estadosPredio as est}
								<option value={est.value}>{est.label}</option>
							{/each}
						</select>
					</div>
					<div>
						<label class="block text-xs font-semibold text-slate-600 mb-1">Tipo de edificación *</label>
						<select bind:value={tipoEdificacion} class="w-full text-sm px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 transition-all cursor-pointer">
							{#each tiposEdificacion as ed}
								<option value={ed.value}>{ed.label}</option>
							{/each}
						</select>
					</div>
					<div>
						<label class="block text-xs font-semibold text-slate-600 mb-1">Número de pisos *</label>
						<input type="number" bind:value={pisos} min="1" class="w-full text-sm px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:bg-white outline-none transition-all" />
					</div>

					<div>
						<label class="block text-xs font-semibold text-slate-600 mb-1">Mes *</label>
						<select bind:value={mes} class="w-full text-sm px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 transition-all cursor-pointer">
							{#each meses as m}
								<option value={m.value}>{m.label}</option>
							{/each}
						</select>
					</div>
					<div>
						<label class="block text-xs font-semibold text-slate-600 mb-1">Año *</label>
						<select bind:value={anio} class="w-full text-sm px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 transition-all cursor-pointer">
							<option value="2025">2025</option>
							<option value="2026">2026</option>
							<option value="2027">2027</option>
							<option value="2028">2028</option>
						</select>
					</div>
					<div>
						<label class="block text-xs font-semibold text-slate-600 mb-1">Distrito *</label>
						<select bind:value={distrito} class="w-full text-sm px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 transition-all cursor-pointer">
							{#each distritos as d}
								<option value={d.value}>{d.label}</option>
							{/each}
						</select>
					</div>
					<div>
						<label class="block text-xs font-semibold text-slate-600 mb-1">Nombre del cliente *</label>
						<input type="text" value={cliente} readonly class="w-full text-sm px-3 py-2 bg-slate-100 border border-slate-200 rounded-xl text-slate-500 cursor-not-allowed outline-none" />
					</div>
				</div>
			</div>

			<!-- Bloque 3: Generación Automática del Código de Proyecto (Caja azul de visualización de tokens) -->
			<div class="bg-blue-50/50 p-6 rounded-2xl border border-blue-100/70 space-y-4">
				<div class="flex items-start gap-2.5">
					<div class="text-blue-500 text-base mt-0.5">
						<i class="fas fa-info-circle"></i>
					</div>
					<div>
						<h4 class="text-xs font-bold text-blue-900 leading-none">Generación automática del código del proyecto</h4>
						<p class="text-[10px] text-blue-700/80 mt-1 font-medium">El código se genera según los parámetros seleccionados. Verifica la información antes de guardar.</p>
					</div>
				</div>

				<!-- Representación Gráfica de Tokens -->
				<div class="flex flex-wrap items-center gap-2 overflow-x-auto py-2 text-slate-800">
					<!-- Token 1: Tipo -->
					<div class="flex flex-col items-center bg-white border border-slate-200 rounded-xl px-4 py-2 min-w-[90px] shadow-xs">
						<span class="text-sm font-black text-green-600">{tipoProyecto}</span>
						<span class="text-[9px] text-slate-400 font-bold mt-0.5">Tipo ({tipoProyecto === 'O' ? 'Obra' : 'Consult.'})</span>
					</div>
					<span class="text-slate-300 font-bold">-</span>

					<!-- Token 2: Estado -->
					<div class="flex flex-col items-center bg-white border border-slate-200 rounded-xl px-4 py-2 min-w-[90px] shadow-xs">
						<span class="text-sm font-black text-blue-600">{estadoPredio}</span>
						<span class="text-[9px] text-slate-400 font-bold mt-0.5">Estado ({estadoPredio === 'A' ? 'Amplia.' : estadoPredio === 'N' ? 'Nuevo' : 'Remod.'})</span>
					</div>
					<span class="text-slate-300 font-bold">-</span>

					<!-- Token 3: Edificación -->
					<div class="flex flex-col items-center bg-white border border-slate-200 rounded-xl px-4 py-2 min-w-[90px] shadow-xs">
						<span class="text-sm font-black text-indigo-600">{tipoEdificacion}</span>
						<span class="text-[9px] text-slate-400 font-bold mt-0.5">Edific. ({tipoEdificacion})</span>
					</div>
					<span class="text-slate-300 font-bold">-</span>

					<!-- Token 4: Pisos -->
					<div class="flex flex-col items-center bg-white border border-slate-200 rounded-xl px-4 py-2 min-w-[90px] shadow-xs">
						<span class="text-sm font-black text-amber-500">{pisos}</span>
						<span class="text-[9px] text-slate-400 font-bold mt-0.5">N° Pisos</span>
					</div>
					<span class="text-slate-300 font-bold">-</span>

					<!-- Token 5: Mes -->
					<div class="flex flex-col items-center bg-white border border-slate-200 rounded-xl px-4 py-2 min-w-[90px] shadow-xs">
						<span class="text-sm font-black text-rose-500">{mes}</span>
						<span class="text-[9px] text-slate-400 font-bold mt-0.5">Mes</span>
					</div>
					<span class="text-slate-300 font-bold">-</span>

					<!-- Token 6: Año -->
					<div class="flex flex-col items-center bg-white border border-slate-200 rounded-xl px-4 py-2 min-w-[90px] shadow-xs">
						<span class="text-sm font-black text-purple-600">{anioDosDigitos}</span>
						<span class="text-[9px] text-slate-400 font-bold mt-0.5">Año ({anio})</span>
					</div>
					<span class="text-slate-300 font-bold">-</span>

					<!-- Token 7: Distrito -->
					<div class="flex flex-col items-center bg-white border border-slate-200 rounded-xl px-4 py-2 min-w-[90px] shadow-xs">
						<span class="text-xs font-black text-slate-700 truncate max-w-[80px]">{distrito}</span>
						<span class="text-[9px] text-slate-400 font-bold mt-0.5">Distrito</span>
					</div>
					<span class="text-slate-300 font-bold">-</span>

					<!-- Token 8: Cliente -->
					<div class="flex flex-col items-center bg-white border border-slate-200 rounded-xl px-4 py-2 min-w-[90px] shadow-xs">
						<span class="text-xs font-black text-slate-700 truncate max-w-[80px]">{cliente || 'Cliente'}</span>
						<span class="text-[9px] text-slate-400 font-bold mt-0.5">Cliente</span>
					</div>
				</div>

				<!-- Código Generado Resultado -->
				<div class="flex items-center justify-between bg-white border border-slate-200 rounded-2xl p-4 shadow-xs">
					<div class="flex items-center gap-2">
						<span class="text-xs font-bold text-slate-500">Código generado:</span>
						<span class="text-sm font-black text-blue-600 bg-blue-50 border border-blue-100 rounded-lg px-3 py-1 font-mono tracking-wide">{codigoGenerado}</span>
					</div>
					<button 
						type="button" 
						onclick={copyToClipboard} 
						class="text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl p-2 transition-all flex items-center gap-1.5 text-xs font-semibold cursor-pointer active:scale-95" 
						title="Copiar código al portapapeles"
					>
						<i class="far fa-copy text-sm"></i>
						<span>Copiar</span>
					</button>
				</div>
			</div>

			<!-- Bloque 4: Observaciones -->
			<div class="relative">
				<label class="block text-xs font-semibold text-slate-600 mb-1">Observaciones</label>
				<textarea 
					name="observaciones" 
					bind:value={observaciones} 
					maxlength="500" 
					rows="3" 
					class="w-full text-sm px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:bg-white outline-none transition-all resize-none" 
					placeholder="Ingresa observaciones adicionales sobre la venta (opcional)"
				></textarea>
				<span class="absolute bottom-3 right-3 text-[10px] text-slate-400 font-semibold">{obsCharCount}/500</span>
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
					disabled={isSaving}
					class="px-6 py-2.5 bg-blue-600 text-white rounded-xl hover:bg-blue-700 font-medium text-sm transition-all shadow-md shadow-blue-600/10 hover:shadow-lg active:scale-[0.98] flex items-center gap-2 cursor-pointer disabled:opacity-75"
				>
					{#if isSaving}
						<i class="fas fa-spinner fa-spin"></i>
						<span>Guardando...</span>
					{:else}
						<i class="fas fa-save"></i>
						<span>{ventaToEdit ? 'Guardar Cambios' : 'Guardar venta'}</span>
					{/if}
				</button>
			</div>
		</form>
	</div>
</div>
{/if}
