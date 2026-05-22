<script lang="ts">
	let { isOpen = false, gasto = null, onClose } = $props();
	
	let form = $state({
		monto: 0,
		fecha: '',
		metodo: 'Transferencia',
		cuenta: '',
		operacion: '',
		observaciones: ''
	});
	
	$effect(() => {
		if (gasto && isOpen) {
			form.monto = gasto.monto_pendiente || 0;
		}
	});
</script>

{#if isOpen}
<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
	<div class="bg-white rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl">
		<div class="flex justify-between items-center p-6 border-b border-slate-100 sticky top-0 bg-white">
			<h2 class="text-xl font-bold text-brand-marine">Nuevo Abono</h2>
			<button onclick={onClose} class="text-slate-400 hover:text-slate-600"><i class="fas fa-times"></i></button>
		</div>

		<form method="POST" action="?/createAbono" enctype="multipart/form-data" class="p-6 space-y-6">
			<input type="hidden" name="gasto_id" value={gasto?.id} />
			
			<div class="bg-blue-50 p-4 rounded-xl flex justify-between items-center border border-blue-100">
				<div>
					<p class="text-xs text-blue-600 uppercase font-semibold">Saldo Pendiente</p>
					<p class="text-2xl font-bold text-brand-marine">S/ {gasto?.monto_pendiente?.toLocaleString() || '0.00'}</p>
				</div>
				<div class="text-right">
					<p class="text-xs text-slate-500">Proveedor</p>
					<p class="font-medium text-slate-800">{gasto?.proveedor || 'Proveedor'}</p>
				</div>
			</div>
			
			<div class="grid grid-cols-2 gap-4">
				<div>
					<label class="block text-xs font-medium text-slate-500 mb-1">Monto a abonar *</label>
					<input type="number" step="0.01" name="monto" bind:value={form.monto} max={gasto?.monto_pendiente} class="w-full text-sm p-2 border rounded-lg focus:ring-1 focus:ring-brand-orange outline-none" required>
				</div>
				<div>
					<label class="block text-xs font-medium text-slate-500 mb-1">Fecha de pago *</label>
					<input type="date" name="fecha" bind:value={form.fecha} class="w-full text-sm p-2 border rounded-lg focus:ring-1 focus:ring-brand-orange outline-none" required>
				</div>
				<div>
					<label class="block text-xs font-medium text-slate-500 mb-1">Método de pago</label>
					<select name="metodo" bind:value={form.metodo} class="w-full text-sm p-2 border rounded-lg focus:ring-1 focus:ring-brand-orange outline-none">
						<option value="Transferencia">Transferencia</option>
						<option value="Efectivo">Efectivo</option>
						<option value="Cheque">Cheque</option>
					</select>
				</div>
				<div>
					<label class="block text-xs font-medium text-slate-500 mb-1">N° Operación</label>
					<input type="text" name="operacion" bind:value={form.operacion} class="w-full text-sm p-2 border rounded-lg focus:ring-1 focus:ring-brand-orange outline-none">
				</div>
				<div class="col-span-2">
					<label class="block text-xs font-medium text-slate-500 mb-1">Comprobante de abono (Opcional)</label>
					<input type="file" name="comprobante" class="w-full text-sm p-2 border rounded-lg file:mr-4 file:py-1 file:px-3 file:rounded-md file:border-0 file:text-xs file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100">
				</div>
				<div class="col-span-2">
					<label class="block text-xs font-medium text-slate-500 mb-1">Observaciones</label>
					<textarea name="observaciones" bind:value={form.observaciones} class="w-full text-sm p-2 border rounded-lg focus:ring-1 focus:ring-brand-orange outline-none" rows="2"></textarea>
				</div>
			</div>

			<div class="flex justify-end gap-3 pt-4 border-t border-slate-100">
				<button type="button" onclick={onClose} class="px-5 py-2 border border-slate-300 text-slate-600 rounded-lg hover:bg-slate-50 font-medium text-sm">Cancelar</button>
				<button type="submit" class="px-5 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium text-sm shadow-md">Registrar Abono</button>
			</div>
		</form>
	</div>
</div>
{/if}
