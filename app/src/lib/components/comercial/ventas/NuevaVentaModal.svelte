<script lang="ts">
	import { fade, scale } from 'svelte/transition';

	let { isOpen = false, onClose = () => {} } = $props<{ isOpen?: boolean, onClose?: () => void }>();

	// Form State
	let proyectoNombre = $state('');
	let fechaVenta = $state('2026-05-20');
	let asesor = $state('Andrea Martínez');
	let cliente = $state('Maria Jhong');
	let valorVenta = $state('15000.00');
	let comisionPorcentaje = $state('10');
	let comisionMonto = $state('1500.00');

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

	// Auto-calculated code
	let codigoGenerado = $derived(`${tipoProyecto}${estadoPredio}${tipoEdificacion}${numeroPisos} - ${mes}${anio.substring(2)} - ${distrito} - ${clienteNombreGen}`);

	function handleGuardar() {
		// Logica de guardado aquí
		onClose();
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
								<select bind:value={asesor} class="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all appearance-none text-slate-700">
									<option value="Andrea Martínez">Andrea Martínez</option>
									<option value="Juan López">Juan López</option>
								</select>
							</div>

							<div class="flex flex-col gap-1 md:col-span-1">
								<label class="text-xs font-semibold text-slate-600">Cliente *</label>
								<input type="text" bind:value={cliente} class="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all text-slate-700">
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
									<button class="px-3 py-2 border border-slate-200 rounded-lg text-sm text-slate-600 hover:bg-slate-50 flex items-center justify-center gap-2 transition-colors">
										<i class="fas fa-file-pdf text-rose-500"></i> Adjuntar PDF
									</button>
								</div>
								<div class="flex flex-col gap-1">
									<label class="text-xs font-semibold text-slate-600">Contrato</label>
									<button class="px-3 py-2 border border-slate-200 rounded-lg text-sm text-slate-600 hover:bg-slate-50 flex items-center justify-center gap-2 transition-colors">
										<i class="fas fa-file-pdf text-rose-500"></i> Adjuntar PDF
									</button>
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
				<button on:click={handleGuardar} class="px-6 py-2.5 bg-blue-600 text-white rounded-xl hover:bg-blue-700 font-medium text-sm shadow-md shadow-blue-600/20 active:scale-[0.98] transition-all flex items-center gap-2">
					<i class="fas fa-save"></i> Guardar venta
				</button>
			</div>
		</div>
	</div>
{/if}
