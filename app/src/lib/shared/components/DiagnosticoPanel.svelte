<script lang="ts">
	/**
	 * Panel del modo diagnóstico (ver diagnostico.svelte.ts). Se activa tocando 5 veces la versión en el
	 * encabezado. Muestra el registro paso a paso guardado en el teléfono (sobrevive a que Android mate la
	 * app), permite enviarlo a soporte (auditoría en Prod) y correr una prueba A/B del OCR con la misma imagen:
	 * pipeline actual vs. propuesto.
	 */
	import { diagState, leerLog, limpiarLog, activarDiagnostico, formatearEntrada, infoEquipo, memoriaActual, diag } from '$lib/shared/diagnostico.svelte';
	import { reportarDiagnostico } from '$lib/shared/auditoria';
	import { probarOcr, type ModoOcr } from '$lib/shared/ocrComprobante';
	import { toast } from '$lib/stores/toast';

	const lineas = $derived.by(() => {
		void diagState.version;
		return diagState.abierto ? leerLog().map(formatearEntrada) : [];
	});
	let probando = $state<ModoOcr | null>(null);
	let resultados = $state<string[]>([]);

	async function elegirYProbar(modo: ModoOcr, event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file || probando) return;
		probando = modo;
		try {
			const r = await probarOcr(file, modo);
			resultados = [...resultados, `${modo === 'actual' ? 'Actual' : 'Propuesto'}: ${r.segundos} s, ${r.caracteres} caracteres leídos (${file.name})`];
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			diag('Prueba OCR falló', { modo, error: msg });
			resultados = [...resultados, `${modo === 'actual' ? 'Actual' : 'Propuesto'}: ERROR ${msg}`];
		} finally {
			probando = null;
		}
	}

	function textoCompleto(): string {
		return [JSON.stringify(infoEquipo()), ...resultados, ...leerLog().map(formatearEntrada)].join('\n');
	}

	function enviar() {
		reportarDiagnostico('Registro enviado desde el panel de diagnóstico', textoCompleto().slice(-3900));
		toast.success('Registro enviado a soporte.');
	}

	async function copiar() {
		try {
			await navigator.clipboard.writeText(textoCompleto());
			toast.success('Registro copiado.');
		} catch {
			toast.error('No se pudo copiar el registro.');
		}
	}
</script>

{#if diagState.activo && !diagState.abierto}
	<button
		type="button"
		onclick={() => (diagState.abierto = true)}
		class="fixed left-3 bottom-20 md:bottom-4 z-[140] px-3 py-2 rounded-full bg-amber-500 text-white text-xs font-bold shadow-lg"
	>
		<i class="fas fa-stethoscope mr-1"></i> Diagnóstico
	</button>
{/if}

{#if diagState.activo && diagState.abierto}
	<div class="fixed inset-0 z-[140] bg-slate-900/50 flex items-stretch sm:items-center justify-center sm:p-4">
		<div class="w-full sm:max-w-2xl bg-white sm:rounded-2xl shadow-2xl flex flex-col max-h-[100dvh] sm:max-h-[90dvh]">
			<div class="flex items-center justify-between px-4 py-3 border-b border-slate-100">
				<h2 class="font-bold text-[#0f3b5e]"><i class="fas fa-stethoscope mr-1.5 text-amber-500"></i>Diagnóstico</h2>
				<button type="button" onclick={() => (diagState.abierto = false)} class="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100" aria-label="Cerrar"><i class="fas fa-times"></i></button>
			</div>

			<div class="px-4 py-3 space-y-3 overflow-y-auto">
				<p class="text-xs text-slate-500">
					Memoria JS ahora: <span class="font-semibold text-slate-700">{memoriaActual() ?? 'no disponible'}</span> ·
					Equipo: <span class="font-semibold text-slate-700">{infoEquipo().memoriaEquipoGB ?? '?'} GB, {infoEquipo().nucleos ?? '?'} núcleos</span>
				</p>

				<div class="rounded-xl border border-slate-200 p-3 space-y-2">
					<p class="text-sm font-semibold text-slate-700">Prueba del lector de comprobantes (OCR)</p>
					<p class="text-xs text-slate-500">Elige la misma captura de transferencia en las dos pruebas. Si la app se cierra, vuelve a abrirla y entra aquí: el registro dirá en qué paso murió.</p>
					<div class="grid grid-cols-2 gap-2">
						<label class={`flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold cursor-pointer ${probando ? 'opacity-50 pointer-events-none' : ''} bg-slate-100 text-slate-700`}>
							<input type="file" accept="image/*,application/pdf" class="hidden" onchange={(e) => elegirYProbar('actual', e)} />
							{#if probando === 'actual'}<i class="fas fa-spinner fa-spin"></i>{:else}<i class="fas fa-image"></i>{/if} Probar actual
						</label>
						<label class={`flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold cursor-pointer ${probando ? 'opacity-50 pointer-events-none' : ''} bg-emerald-600 text-white`}>
							<input type="file" accept="image/*,application/pdf" class="hidden" onchange={(e) => elegirYProbar('propuesto', e)} />
							{#if probando === 'propuesto'}<i class="fas fa-spinner fa-spin"></i>{:else}<i class="fas fa-wand-magic-sparkles"></i>{/if} Probar propuesto
						</label>
					</div>
					{#each resultados as r}
						<p class="text-xs font-mono text-slate-700">{r}</p>
					{/each}
				</div>

				<div class="flex flex-wrap gap-2">
					<button type="button" onclick={enviar} class="px-3 py-1.5 rounded-lg bg-[#0f3b5e] text-white text-xs font-semibold"><i class="fas fa-paper-plane mr-1"></i>Enviar a soporte</button>
					<button type="button" onclick={copiar} class="px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-700"><i class="fas fa-copy mr-1"></i>Copiar</button>
					<button type="button" onclick={limpiarLog} class="px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-700"><i class="fas fa-eraser mr-1"></i>Limpiar</button>
					<button type="button" onclick={() => activarDiagnostico(false)} class="px-3 py-1.5 rounded-lg border border-rose-200 text-xs font-semibold text-rose-600">Desactivar</button>
				</div>

				<div class="rounded-xl bg-slate-900 text-slate-100 p-3 font-mono text-[10.5px] leading-relaxed space-y-0.5 overflow-x-auto">
					{#if lineas.length === 0}
						<p class="text-slate-400">Sin registros todavía.</p>
					{:else}
						{#each [...lineas].reverse() as linea}
							<p class={`whitespace-pre-wrap break-all ${linea.includes('✖') ? 'text-rose-400 font-bold' : linea.includes('▶') || linea.includes('■') ? 'text-amber-300' : ''}`}>{linea}</p>
						{/each}
					{/if}
				</div>
			</div>
		</div>
	</div>
{/if}
