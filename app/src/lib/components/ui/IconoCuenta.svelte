<script lang="ts" module>
	/** Tipo de contraparte de una cuenta (Cuentas por Pagar y por Cobrar): define el ícono y el color por defecto. */
	export type TipoIconoCuenta = 'obra' | 'consultoria' | 'persona' | 'proveedor' | 'prestamo' | 'otro';
</script>

<script lang="ts">
	// 27/11/2026 (pedido de Romina): cada fila de Cuentas por Pagar/Cobrar se identifica rápido por su ícono —
	// la imagen real si hay (foto del trabajador, logo del proveedor, imagen del proyecto) y si no un ícono por tipo.
	import { HardHat, PencilRuler, UserRound, Store, Landmark, FileText } from '@lucide/svelte';
	import { toDriveThumbnailUrl } from '$lib/shared/drivePreview';

	let { tipo = 'otro', imagen = null, alt = '' }: { tipo?: TipoIconoCuenta; imagen?: string | null; alt?: string } = $props();

	const ESTILO: Record<TipoIconoCuenta, { clase: string; icono: typeof HardHat }> = {
		obra: { clase: 'bg-orange-100 text-orange-500', icono: HardHat },
		consultoria: { clase: 'bg-blue-100 text-blue-600', icono: PencilRuler },
		persona: { clase: 'bg-sky-100 text-sky-700', icono: UserRound },
		proveedor: { clase: 'bg-emerald-100 text-emerald-600', icono: Store },
		prestamo: { clase: 'bg-violet-100 text-violet-600', icono: Landmark },
		otro: { clase: 'bg-slate-100 text-slate-500', icono: FileText }
	};

	let fallo = $state(false);
	$effect(() => {
		imagen;
		fallo = false;
	});
	const estilo = $derived(ESTILO[tipo] ?? ESTILO.otro);
	const Icono = $derived(estilo.icono);
</script>

{#if imagen && !fallo}
	<img
		src={toDriveThumbnailUrl(imagen, 120)}
		{alt}
		referrerpolicy="no-referrer"
		loading="lazy"
		class="w-10 h-10 rounded-lg object-cover shrink-0 bg-slate-100 border border-slate-200"
		onerror={() => (fallo = true)}
	/>
{:else}
	<div class={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${estilo.clase}`} title={alt || undefined}>
		<Icono size={20} />
	</div>
{/if}
