<script lang="ts">
	// 27/11/2026 (pedido de Romina): subir el logo del proveedor o la imagen del proyecto, que se ven como ícono en
	// Cuentas por Pagar y por Cobrar. La imagen se reduce en el dispositivo y se sube a Drive (igual que la foto
	// del trabajador). `onchange` recibe el enlace nuevo, o null al quitarla.
	import IconoCuenta, { type TipoIconoCuenta } from './IconoCuenta.svelte';
	import { reducirFoto, subirImagenReducida, FOTO_MAX_BYTES } from '$lib/modules/personal/services/personalFoto';
	import { toast } from '$lib/stores/toast';

	let {
		imagen = null,
		tipo = 'otro',
		nombre = '',
		etiqueta = 'logo',
		carpeta,
		disabled = false,
		onchange
	}: {
		imagen?: string | null;
		tipo?: TipoIconoCuenta;
		nombre?: string;
		etiqueta?: string;
		carpeta: string;
		disabled?: boolean;
		onchange: (url: string | null) => void | Promise<void>;
	} = $props();

	let subiendo = $state(false);
	let input = $state<HTMLInputElement | null>(null);

	async function elegir(e: Event) {
		const file = (e.currentTarget as HTMLInputElement).files?.[0];
		(e.currentTarget as HTMLInputElement).value = '';
		if (!file) return;
		if (file.size > FOTO_MAX_BYTES) {
			toast.error('La imagen es muy pesada (máx. 20 MB).');
			return;
		}
		subiendo = true;
		try {
			const reducida = await reducirFoto(file);
			const url = await subirImagenReducida(reducida, nombre, { prefijo: `${carpeta.toLowerCase()}-${etiqueta}`, tipo: `${etiqueta}_${carpeta.toLowerCase()}`, carpeta });
			await onchange(url);
		} catch (err: any) {
			toast.error(err?.message || 'No se pudo subir la imagen.');
		} finally {
			subiendo = false;
		}
	}
</script>

<div class="flex items-center gap-3">
	<IconoCuenta {tipo} {imagen} alt={nombre} />
	<div class="flex flex-wrap items-center gap-2 text-xs">
		<button
			type="button"
			class="px-3 py-1.5 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 disabled:opacity-50"
			disabled={disabled || subiendo}
			onclick={() => input?.click()}
		>
			{#if subiendo}<i class="fas fa-spinner fa-spin mr-1"></i>Subiendo…{:else}<i class="fas fa-image mr-1 text-slate-400"></i>{imagen ? `Cambiar ${etiqueta}` : `Subir ${etiqueta}`}{/if}
		</button>
		{#if imagen && !subiendo}
			<button type="button" class="px-2 py-1.5 text-rose-600 hover:underline disabled:opacity-50" {disabled} onclick={() => onchange(null)}>Quitar</button>
		{/if}
		<span class="text-slate-400 w-full">Se ve como ícono en Cuentas por Pagar y por Cobrar. Sin imagen se usa el ícono por tipo.</span>
	</div>
	<input bind:this={input} type="file" accept="image/*" class="hidden" onchange={elegir} />
</div>
