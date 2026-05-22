<script lang="ts">
	let { isOpen = false, onClose } = $props();

	// Formularios reactivos
	let form = $state({
		proyecto: '',
		fecha: '',
		asesor: '',
		cliente: '',
		valor: 0,
		comisionPorcentaje: 10,
		tipoProyecto: 'O', // Obra
		estadoPredio: 'A', // Ampliacion
		tipoEdificacion: 'M', // Multifamiliar
		pisos: 4,
		mes: '02',
		anio: '26',
		distrito: 'ATE Salamanca',
		observaciones: ''
	});

	// Variables derivadas
	let comisionMonto = $derived(form.valor * (form.comisionPorcentaje / 100));
	let codigoGenerado = $derived(`O${form.estadoPredio}${form.tipoEdificacion}${form.pisos} - ${form.mes}${form.anio} - ${form.distrito} - ${form.cliente || 'Cliente'}`);

	function handleClose() {
		if (onClose) onClose();
	}
</script>

{#if isOpen}
<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
	<div class="bg-white rounded-2xl w-full max-w-4xl max-h-[90vh] overflow-y-auto shadow-2xl">
		<!-- Header -->
		<div class="flex justify-between items-center p-6 border-b border-slate-100 sticky top-0 bg-white z-10">
			<h2 class="text-xl font-bold text-brand-marine">Nueva venta</h2>
			<button onclick={handleClose} class="text-slate-400 hover:text-slate-600"><i class="fas fa-times text-xl"></i></button>
		</div>

		<!-- Body -->
		<form method="POST" action="?/create" enctype="multipart/form-data" class="p-6">
			<!-- Información General -->
			<h3 class="font-semibold text-slate-800 mb-4">Información general</h3>
			<div class="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
				<div class="col-span-1">
					<label class="block text-xs font-medium text-slate-500 mb-1">Proyecto *</label>
					<input type="text" name="proyecto" bind:value={form.proyecto} class="w-full text-sm p-2 border rounded-lg outline-none focus:ring-1 focus:ring-brand-orange" placeholder="Nombre del proyecto" required>
				</div>
				<div class="col-span-1">
					<label class="block text-xs font-medium text-slate-500 mb-1">Código de proyecto *</label>
					<input type="text" name="codigo" value={codigoGenerado} readonly class="w-full text-sm p-2 border rounded-lg bg-slate-50 text-slate-500" placeholder="Se generará automáticamente">
				</div>
				<div class="col-span-1">
					<label class="block text-xs font-medium text-slate-500 mb-1">Fecha de venta *</label>
					<input type="date" name="fecha" bind:value={form.fecha} class="w-full text-sm p-2 border rounded-lg outline-none focus:ring-1 focus:ring-brand-orange" required>
				</div>
				<div class="col-span-1">
					<label class="block text-xs font-medium text-slate-500 mb-1">Asesor *</label>
					<select name="asesor" bind:value={form.asesor} class="w-full text-sm p-2 border rounded-lg outline-none focus:ring-1 focus:ring-brand-orange" required>
						<option value="">Seleccione</option>
						<option value="Andrea Martinez">Andrea Martinez</option>
						<option value="Juan Lopez">Juan Lopez</option>
					</select>
				</div>

				<div class="col-span-1">
					<label class="block text-xs font-medium text-slate-500 mb-1">Cliente *</label>
					<input type="text" name="cliente" bind:value={form.cliente} class="w-full text-sm p-2 border rounded-lg outline-none focus:ring-1 focus:ring-brand-orange" required>
				</div>
				<div class="col-span-1">
					<label class="block text-xs font-medium text-slate-500 mb-1">Valor venta (S/) *</label>
					<input type="number" name="valor" bind:value={form.valor} class="w-full text-sm p-2 border rounded-lg outline-none focus:ring-1 focus:ring-brand-orange" required>
				</div>
				<div class="col-span-1 flex gap-2">
					<div class="w-1/3">
						<label class="block text-xs font-medium text-slate-500 mb-1">Com. % *</label>
						<input type="number" name="comisionPorcentaje" bind:value={form.comisionPorcentaje} class="w-full text-sm p-2 border rounded-lg outline-none focus:ring-1 focus:ring-brand-orange" required>
					</div>
					<div class="w-2/3">
						<label class="block text-xs font-medium text-slate-500 mb-1">Comisión (S/)</label>
						<input type="number" name="comisionMonto" value={comisionMonto} readonly class="w-full text-sm p-2 border rounded-lg bg-slate-50 text-slate-500">
					</div>
				</div>
				<div class="col-span-1 flex gap-2">
					<div class="w-1/2">
						<label class="block text-xs font-medium text-slate-500 mb-1">Proforma</label>
						<label class="w-full text-xs p-2 border border-brand-marine text-brand-marine rounded-lg flex items-center justify-center gap-2 cursor-pointer hover:bg-slate-50">
							<i class="fas fa-file-pdf"></i> Adjuntar
							<input type="file" name="proforma_pdf" class="hidden" accept=".pdf">
						</label>
					</div>
					<div class="w-1/2">
						<label class="block text-xs font-medium text-slate-500 mb-1">Contrato</label>
						<label class="w-full text-xs p-2 border border-brand-marine text-brand-marine rounded-lg flex items-center justify-center gap-2 cursor-pointer hover:bg-slate-50">
							<i class="fas fa-file-pdf"></i> Adjuntar
							<input type="file" name="contrato_pdf" class="hidden" accept=".pdf">
						</label>
					</div>
				</div>
			</div>

			<!-- Características del proyecto -->
			<h3 class="font-semibold text-slate-800 mb-4">Características del proyecto nuevo</h3>
			<div class="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
				<div class="col-span-1">
					<label class="block text-xs font-medium text-slate-500 mb-1">Tipo de proyecto *</label>
					<select bind:value={form.tipoProyecto} name="caract_tipo" class="w-full text-sm p-2 border rounded-lg outline-none">
						<option value="O">Proyecto de Obra (O)</option>
						<option value="C">Consultoría (C)</option>
					</select>
				</div>
				<div class="col-span-1">
					<label class="block text-xs font-medium text-slate-500 mb-1">Estado del predio *</label>
					<select bind:value={form.estadoPredio} class="w-full text-sm p-2 border rounded-lg outline-none">
						<option value="A">Ampliación (A)</option>
						<option value="N">Nuevo (N)</option>
					</select>
				</div>
				<div class="col-span-1">
					<label class="block text-xs font-medium text-slate-500 mb-1">Tipo de edificación *</label>
					<select bind:value={form.tipoEdificacion} class="w-full text-sm p-2 border rounded-lg outline-none">
						<option value="M">Viv. Multifamiliar (M)</option>
						<option value="U">Unifamiliar (U)</option>
					</select>
				</div>
				<div class="col-span-1">
					<label class="block text-xs font-medium text-slate-500 mb-1">Número de pisos *</label>
					<input type="number" bind:value={form.pisos} class="w-full text-sm p-2 border rounded-lg outline-none">
				</div>
			</div>

			<!-- Auto Generator Box -->
			<div class="bg-blue-50/50 p-4 rounded-xl border border-blue-100 mb-8">
				<div class="flex items-start gap-2 mb-4">
					<i class="fas fa-info-circle text-blue-500 mt-0.5"></i>
					<p class="text-xs text-blue-800">
						<strong>Generación automática del código del proyecto</strong><br>
						El código se genera según los parámetros seleccionados. Verifica la información antes de guardar.
					</p>
				</div>
				<div class="flex items-center gap-2 overflow-x-auto pb-2 text-sm">
					<div class="flex flex-col items-center bg-white p-2 rounded border border-slate-200 min-w-[80px]">
						<span class="font-bold text-green-600">O</span>
						<span class="text-[10px] text-slate-400">Tipo (Obra)</span>
					</div>
					<span class="text-slate-300">-</span>
					<div class="flex flex-col items-center bg-white p-2 rounded border border-slate-200 min-w-[80px]">
						<span class="font-bold text-blue-600">{form.estadoPredio}</span>
						<span class="text-[10px] text-slate-400">Estado</span>
					</div>
					<span class="text-slate-300">-</span>
					<div class="flex flex-col items-center bg-white p-2 rounded border border-slate-200 min-w-[80px]">
						<span class="font-bold text-purple-600">{form.tipoEdificacion}</span>
						<span class="text-[10px] text-slate-400">Edificación</span>
					</div>
					<span class="text-slate-300">-</span>
					<div class="flex flex-col items-center bg-white p-2 rounded border border-slate-200 min-w-[80px]">
						<span class="font-bold text-orange-600">{form.pisos}</span>
						<span class="text-[10px] text-slate-400">N° Pisos</span>
					</div>
				</div>
				<div class="mt-4 flex items-center gap-4 bg-white p-3 rounded-lg border border-slate-200">
					<span class="text-sm font-semibold text-slate-700">Código generado:</span>
					<span class="text-sm font-bold text-blue-600 bg-blue-100 px-3 py-1 rounded-md">{codigoGenerado}</span>
				</div>
			</div>

			<!-- Observaciones -->
			<div class="mb-8">
				<label class="block text-xs font-medium text-slate-500 mb-1">Observaciones</label>
				<textarea name="observaciones" bind:value={form.observaciones} rows="3" class="w-full text-sm p-3 border rounded-lg outline-none focus:ring-1 focus:ring-brand-orange" placeholder="Ingresa observaciones adicionales sobre la venta (opcional)"></textarea>
			</div>

			<!-- Footer -->
			<div class="flex justify-end gap-3 pt-4 border-t border-slate-100">
				<button type="button" onclick={handleClose} class="px-6 py-2 border border-slate-300 text-slate-600 rounded-xl hover:bg-slate-50 font-medium text-sm transition-colors">Cancelar</button>
				<button type="submit" class="px-6 py-2 bg-blue-600 text-white rounded-xl hover:bg-blue-700 font-medium text-sm transition-colors shadow-md shadow-blue-600/20">Guardar venta</button>
			</div>
		</form>
	</div>
</div>
{/if}
