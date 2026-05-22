<script lang="ts">
	import Topbar from '$lib/components/layout/Topbar.svelte';
	import KPICard from '$lib/components/ui/KPICard.svelte';
	import Card from '$lib/components/ui/Card.svelte';
</script>

<svelte:head>
	<title>Finanzas | Construni</title>
</svelte:head>

<Topbar pageTitle="Finanzas y Flujo" pageSubtitle="Control de caja, cobros y pagos" />

<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 mb-8">
	<KPICard title="Saldo en Cuentas" value="S/ 840.5K" icon="fas fa-piggy-bank" trendText="Liquidez actual" trendUp={true} />
	<KPICard title="Cuentas x Cobrar" value="S/ 2.1M" icon="fas fa-hand-holding-dollar" trendText="3 facturas por vencer" trendUp={true} />
	<KPICard title="Cuentas x Pagar" value="S/ 1.4M" icon="fas fa-file-invoice-dollar" trendText="Proveedores y subcontratas" trendUp={false} />
</div>

<Card title="Últimos Movimientos (Pagos y Abonos)" icon="fas fa-exchange-alt">
	<table class="w-full text-sm text-left">
		<thead class="text-xs text-slate-500 uppercase bg-slate-50">
			<tr>
				<th class="py-3 px-2">Fecha</th>
				<th class="py-3 px-2">Concepto</th>
				<th class="py-3 px-2">Monto</th>
				<th class="py-3 px-2">Estado</th>
			</tr>
		</thead>
		<tbody>
			<tr class="border-b border-slate-100">
				<td class="py-3 px-2">18 May 2026</td>
				<td class="py-3 px-2">Pago a Aceros Arequipa</td>
				<td class="py-3 px-2 text-brand-danger">- S/ 39,200</td>
				<td class="py-3 px-2 text-brand-success font-semibold">Ejecutado</td>
			</tr>
			<tr class="border-b border-slate-100">
				<td class="py-3 px-2">15 May 2026</td>
				<td class="py-3 px-2">Abono Inmobiliaria Norte</td>
				<td class="py-3 px-2 text-brand-success">+ S/ 412,000</td>
				<td class="py-3 px-2 text-brand-success font-semibold">Ejecutado</td>
			</tr>
		</tbody>
	</table>
</Card
