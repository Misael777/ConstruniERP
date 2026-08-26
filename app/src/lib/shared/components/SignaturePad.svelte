<script lang="ts">
	/**
	 * Recuadro de firma manuscrita (canvas) — usado por el "RECIBO DE PAGO" (ver ReciboPagoModal.svelte)
	 * para capturar la firma del pagador y de quien recibe el efectivo. Usa Pointer Events (unifica
	 * mouse/touch/lápiz en un solo set de handlers, sin ninguna API específica de plataforma) — funciona
	 * igual en navegador, Tauri Windows (mouse) y Tauri Android (dedo/touch). El resultado se expone como
	 * un PNG en base64 (`dataUrl`), listo para `doc.addImage(...)` en el PDF.
	 */
	let {
		dataUrl = $bindable(''),
		height = 130,
		disabled = false
	}: { dataUrl?: string; height?: number; disabled?: boolean } = $props();

	let canvasEl: HTMLCanvasElement | undefined = $state();
	let drawing = false;
	let hasStroke = $state(false);
	const ANCHO_CANVAS = 420;

	function pintarFondoBlanco() {
		if (!canvasEl) return;
		const ctx = canvasEl.getContext('2d');
		if (!ctx) return;
		ctx.fillStyle = '#ffffff';
		ctx.fillRect(0, 0, canvasEl.width, canvasEl.height);
	}

	function posicionDesdeEvento(e: PointerEvent): { x: number; y: number } {
		const rect = canvasEl!.getBoundingClientRect();
		const escalaX = canvasEl!.width / rect.width;
		const escalaY = canvasEl!.height / rect.height;
		return { x: (e.clientX - rect.left) * escalaX, y: (e.clientY - rect.top) * escalaY };
	}

	function iniciarTrazo(e: PointerEvent) {
		if (disabled || !canvasEl) return;
		e.preventDefault();
		drawing = true;
		canvasEl.setPointerCapture(e.pointerId);
		const ctx = canvasEl.getContext('2d')!;
		const { x, y } = posicionDesdeEvento(e);
		ctx.beginPath();
		ctx.moveTo(x, y);
	}

	function continuarTrazo(e: PointerEvent) {
		if (!drawing || !canvasEl) return;
		e.preventDefault();
		const ctx = canvasEl.getContext('2d')!;
		const { x, y } = posicionDesdeEvento(e);
		ctx.strokeStyle = '#1e293b';
		ctx.lineWidth = 2.2;
		ctx.lineCap = 'round';
		ctx.lineJoin = 'round';
		ctx.lineTo(x, y);
		ctx.stroke();
		hasStroke = true;
	}

	function terminarTrazo() {
		if (!drawing || !canvasEl) return;
		drawing = false;
		dataUrl = canvasEl.toDataURL('image/png');
	}

	export function limpiar() {
		pintarFondoBlanco();
		hasStroke = false;
		dataUrl = '';
	}

	$effect(() => {
		if (canvasEl) pintarFondoBlanco();
	});
</script>

<div class="flex flex-col gap-1">
	<div
		class={`relative rounded-lg border-2 border-dashed overflow-hidden bg-white ${disabled ? 'opacity-60' : ''} border-slate-300`}
		style={`height:${height}px`}
	>
		<canvas
			bind:this={canvasEl}
			width={ANCHO_CANVAS}
			height={height}
			class={`w-full h-full touch-none ${disabled ? '' : 'cursor-crosshair'}`}
			onpointerdown={iniciarTrazo}
			onpointermove={continuarTrazo}
			onpointerup={terminarTrazo}
			onpointerleave={terminarTrazo}
			onpointercancel={terminarTrazo}
		></canvas>
		{#if !hasStroke}
			<div class="absolute inset-0 flex items-center justify-center pointer-events-none">
				<span class="text-xs text-slate-400">Haz clic para firmar</span>
			</div>
		{/if}
	</div>
	{#if hasStroke && !disabled}
		<button type="button" onclick={limpiar} class="text-xs text-blue-600 hover:underline w-fit">Limpiar firma</button>
	{/if}
</div>
