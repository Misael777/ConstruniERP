<script lang="ts">
	let { isOpen = false, gasto = null, onClose, onAbono } = $props();

	let activeTab = $state('Información');
	const tabs = ['Información', 'Pago', 'Factura', 'Impuestos', 'Historial'];

	function close() { if (onClose) onClose(); }
</script>

{#if isOpen}
<!-- Overlay -->
<div class="fixed inset-0 bg-black/20 z-40" onclick={close}></div>

<!-- Slide-over Panel -->
<div class="fixed top-0 right-0 h-full w-[450px] bg-white shadow-2xl z-50 transform transition-transform overflow-y-auto">
	<div class="p-6 border-b border-slate-100 flex justify-between items-center">
		<h3 class="font-bold text-lg text-brand-marine">Detalle del Gasto</h3>
		<button onclick={close} class="text-slate-400 hover:text-slate-700"><i class="fas fa-times"></i></button>
	</div>

	<!-- Tabs -->
	<div class="flex border-b border-slate-100 px-6 mt-4 gap-4">
		{#each tabs as tab}
			<button 
				class="pb-3 text-sm font-medium transition-colors border-b-2 {activeTab === tab ? 'border-brand-marine text-brand-marine' : 'border-transparent text-slate-500 hover:text-slate-700'}"
				onclick={() => activeTab = tab}
			>
				{tab}
			</button>
		{/each}
	</div>

	<div class="p-6">
		{#if activeTab === 'Información'}
			<div class="space-y-6">
				<!-- Content structured similarly to the mockup -->
				<div>
					<h4 class="text-sm font-bold text-slate-800 mb-3 border-b pb-2">Información General</h4>
					<div class="grid grid-cols-2 gap-4 text-sm">
						<div>
							<div class="text-slate-500 text-xs">Status</div>
							<div class="mt-1">
								<span class="px-2 py-1 rounded text-xs font-semibold {gasto?.status === 'Pagado' ? 'bg-green-100 text-green-700' : gasto?.status === 'Pendiente' ? 'bg-red-100 text-red-700' : 'bg-orange-100 text-orange-700'}">
									{gasto?.status || 'Pendiente'}
								</span>
							</div>
						</div>
						<div><div class="text-slate-500 text-xs">Fecha Gasto</div><div class="font-medium">{gasto?.fecha_gasto || 'N/A'}</div></div>
						<div><div class="text-slate-500 text-xs">Tipo</div><div class="mt-1"><span class="px-2 py-1 bg-blue-100 text-blue-700 rounded text-xs font-semibold">{gasto?.tipo || 'Servicios'}</span></div></div>
						<div><div class="text-slate-500 text-xs">Proveedor</div><div class="font-medium">{gasto?.proveedor || 'N/A'}</div></div>
					</div>
				</div>

				<!-- Financial Info -->
				<div>
					<h4 class="text-sm font-bold text-slate-800 mb-3 border-b pb-2">Información Financiera</h4>
					<div class="grid grid-cols-2 gap-4 text-sm">
						<div><div class="text-slate-500 text-xs">Costo Unitario</div><div class="font-medium">S/ {gasto?.costo_unitario || '0.00'}</div></div>
						<div><div class="text-slate-500 text-xs">Cantidad</div><div class="font-medium">{gasto?.cantidad || '1'}</div></div>
						<div><div class="text-slate-500 text-xs">Costo Final</div><div class="font-medium text-brand-marine font-bold">S/ {gasto?.costo_final || '0.00'}</div></div>
						<div><div class="text-slate-500 text-xs">Monto Abonado</div><div class="font-medium text-green-600">S/ {gasto?.pagado || '0.00'}</div></div>
					</div>
				</div>
				
				<!-- Action Buttons -->
				<div class="flex gap-3 pt-4 border-t border-slate-100">
					<button class="flex-1 py-2 border border-slate-300 text-slate-600 rounded-lg hover:bg-slate-50 text-sm font-medium"><i class="fas fa-edit mr-2"></i> Editar</button>
					<button class="flex-1 py-2 border border-red-200 text-red-600 bg-red-50 rounded-lg hover:bg-red-100 text-sm font-medium"><i class="fas fa-ban mr-2"></i> Anular</button>
				</div>
				<div class="mt-2">
					<button onclick={() => {if (onAbono) onAbono(gasto)}} class="w-full py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium shadow-md transition-colors">
						<i class="fas fa-hand-holding-usd mr-2"></i> Registrar Abono
					</button>
				</div>
			</div>
		{/if}
	</div>
</div>
{/if}
