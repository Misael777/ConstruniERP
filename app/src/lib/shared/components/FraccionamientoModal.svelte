<script lang="ts">
	/**
	 * Ventana reutilizable "Fraccionar este pago" — reemplaza al viejo campo inline "Número de Cuotas"
	 * en Cuentas por Cobrar y Cuentas por Pagar. El "Método de fraccionamiento" tiene dos modos reales:
	 * - Montos iguales: el monto de cada fracción se calcula solo (montoTotal ÷ N, la última absorbe el
	 *   redondeo) y el campo de monto queda BLOQUEADO — no se puede tocar a mano mientras este modo
	 *   esté activo. Cualquier cambio en el número de fracciones (o en montoTotal) recalcula solo.
	 * - Montos desiguales: los campos de monto se DESBLOQUEAN para que el usuario los edite libremente.
	 * En ambos modos, al guardar se exige que la suma de las fracciones sea EXACTAMENTE igual a
	 * `montoTotal` (ni más ni menos) — si no cuadra, se bloquea "Guardar" y se muestra un mensaje de
	 * error (ver `sumaOk`/`handleGuardar`); en Montos iguales esto siempre se cumple por construcción.
	 *
	 * No inserta/edita nada en BD directamente: solo junta el arreglo final y lo devuelve vía onConfirm
	 * para que el formulario padre (CuentaCobrarModal/CuentaPagarModal) lo mande junto con el resto del
	 * payload al guardar la cuenta — ver sincronizarCuotasProgramadas en cada servicio.
	 */
	import { X, Trash2, Plus, Minus, Loader2 } from '@lucide/svelte';
	import { currencyMask, formatCurrency } from '$lib/shared/fieldConfig';

	export interface Fraccion {
		fecha: string; // yyyy-mm-dd
		monto: number;
	}

	let {
		open = false,
		titulo = 'Fraccionar este pago',
		montoTotal,
		fechaEmision,
		fechaVencimiento = null,
		fraccionesIniciales = [],
		onClose,
		onConfirm,
		onEliminar
	}: {
		open: boolean;
		/** Título del encabezado — cada módulo pasa el suyo (ej. "Fraccionar Cobros" en cuentas por
		 * cobrar) para que el popup se identifique con lo que realmente está fraccionando. */
		titulo?: string;
		montoTotal: number;
		fechaEmision: string;
		fechaVencimiento?: string | null;
		fraccionesIniciales?: Fraccion[];
		onClose: () => void;
		/** Puede ser async (ej. escribe en BD desde el tablero de Panoramas) — se espera antes de
		 * cerrar la ventana, para no decirle "listo" al usuario antes de que realmente se haya
		 * guardado (ver `guardando`/handleGuardar). Si lanza un error, la ventana se queda abierta. */
		onConfirm: (fracciones: Fraccion[]) => void | Promise<void>;
		onEliminar: () => void | Promise<void>;
	} = $props();

	/** Igual que addMonths en cuentasCobrar.service.ts/cuentasPagar.service.ts: fija el día al último
	 * válido del mes destino, para no romper con "31 de enero + 1 mes". Se duplica acá (~10 líneas)
	 * a propósito para no acoplar este componente compartido a los servicios de un módulo concreto. */
	function addMonths(date: Date, months: number): Date {
		const d = new Date(date);
		const day = d.getDate();
		d.setDate(1);
		d.setMonth(d.getMonth() + months);
		const diasEnMesDestino = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
		d.setDate(Math.min(day, diasEnMesDestino));
		return d;
	}

	function toISODate(d: Date): string {
		return d.toISOString().slice(0, 10);
	}

	function repartirEnPartesIguales(n: number): Fraccion[] {
		const inicio = new Date(fechaEmision);
		const limite = fechaVencimiento ? new Date(fechaVencimiento) : null;
		const base = Number.isFinite(montoTotal) ? montoTotal : 0;
		const montoBase = Math.floor((base / n) * 100) / 100;
		const filas: Fraccion[] = [];
		let acumulado = 0;
		for (let i = 1; i <= n; i++) {
			let fecha = Number.isNaN(inicio.getTime()) ? new Date() : addMonths(inicio, i);
			if (limite && !Number.isNaN(limite.getTime()) && fecha.getTime() > limite.getTime()) fecha = limite;
			const esUltima = i === n;
			const monto = esUltima ? Number((base - acumulado).toFixed(2)) : montoBase;
			acumulado += monto;
			filas.push({ fecha: toISODate(fecha), monto });
		}
		return filas;
	}

	let activo = $state(fraccionesIniciales.length > 0);
	let filas = $state<Fraccion[]>([]);
	let metodo = $state<'montos_iguales' | 'montos_desiguales'>('montos_iguales');

	/** ¿Los montos de `filas` calzan con lo que daría un reparto en partes iguales? (con tolerancia de
	 * un centavo por redondeo). Se usa solo para decidir con qué método abrir una cuenta YA fraccionada
	 * — si sus cuotas no son iguales, se respeta como "Montos desiguales" en vez de forzarlas a calzar. */
	function pareceMontosIguales(candidatas: Fraccion[]): boolean {
		if (candidatas.length <= 1) return true;
		const esperado = repartirEnPartesIguales(candidatas.length);
		return candidatas.every((f, i) => Math.abs(f.monto - esperado[i].monto) < 0.01);
	}

	// La ventana solo es alcanzable cuando Forma de Pago ya es Fraccionado/Por Porcentaje/Crédito (ver
	// botón "Configurar Cuotas" en CuentaCobrarModal/CuentaPagarModal) — así que siempre abre con el
	// fraccionamiento YA activo (antes quedaba apagado por defecto en cuentas nuevas sin cuotas
	// previas, dejando la ventana casi vacía hasta que el usuario encontrara el interruptor).
	$effect(() => {
		if (!open) return;
		activo = true;
		// OJO: se usa una variable local (`nuevasFilas`) para decidir el método, NO se vuelve a leer
		// `filas` (el $state) — leerla acá la dejaría "suscrita" a los cambios que hace el otro efecto
		// (el que recalcula montos iguales más abajo), disparando este efecto de nuevo, que resetea
		// `filas` a su valor inicial, disparando otra vez al otro efecto... un loop infinito real que
		// nunca deja guardar (ver Svelte error "effect_update_depth_exceeded").
		const nuevasFilas = fraccionesIniciales.length > 0 ? fraccionesIniciales.map((f) => ({ ...f })) : repartirEnPartesIguales(3);
		filas = nuevasFilas;
		metodo = pareceMontosIguales(nuevasFilas) ? 'montos_iguales' : 'montos_desiguales';
	});

	// Mientras el método sea "Montos iguales", el monto de cada fracción se recalcula solo (montoTotal
	// ÷ N, última absorbe el redondeo) cada vez que cambia el número de fracciones o montoTotal — el
	// campo queda bloqueado en el template (ver `disabled={metodo === 'montos_iguales'}`). El chequeo
	// de "¿cambió algo?" evita un loop infinito (este efecto lee Y escribe `filas`).
	$effect(() => {
		if (metodo !== 'montos_iguales' || filas.length === 0) return;
		const esperado = repartirEnPartesIguales(filas.length);
		const cambio = filas.some((f, i) => Math.abs(f.monto - esperado[i].monto) > 0.001);
		if (cambio) filas = filas.map((f, i) => ({ ...f, monto: esperado[i].monto }));
	});

	const sumaFilas = $derived(filas.reduce((sum, f) => sum + (Number.isFinite(f.monto) ? f.monto : 0), 0));
	const sumaOk = $derived(Math.abs(Number(sumaFilas.toFixed(2)) - Number((montoTotal || 0).toFixed(2))) < 0.01);

	function agregarFraccion() {
		const ultima = filas[filas.length - 1];
		const baseFecha = ultima ? new Date(ultima.fecha) : new Date(fechaEmision);
		let fecha = Number.isNaN(baseFecha.getTime()) ? new Date() : addMonths(baseFecha, 1);
		const limite = fechaVencimiento ? new Date(fechaVencimiento) : null;
		if (limite && !Number.isNaN(limite.getTime()) && fecha.getTime() > limite.getTime()) fecha = limite;
		const restante = Number(((montoTotal || 0) - sumaFilas).toFixed(2));
		filas = [...filas, { fecha: toISODate(fecha), monto: restante > 0 ? restante : 0 }];
	}

	function eliminarFraccion(index: number) {
		filas = filas.filter((_, i) => i !== index);
	}

	function actualizarFecha(index: number, fecha: string) {
		filas = filas.map((f, i) => (i === index ? { ...f, fecha } : f));
	}

	function actualizarMonto(index: number, raw: string) {
		const masked = currencyMask(raw);
		filas = filas.map((f, i) => (i === index ? { ...f, monto: masked === '' ? 0 : Number(masked) } : f));
	}

	function incrementarNumero() {
		if (filas.length === 0) {
			filas = repartirEnPartesIguales(3);
			return;
		}
		agregarFraccion();
	}

	function decrementarNumero() {
		if (filas.length <= 1) return;
		filas = filas.slice(0, -1);
	}

	/** true mientras se espera a que onConfirm/onEliminar terminen (pueden ser async, ej. escriben en
	 * BD) — bloquea los botones para evitar doble clic y evita que la ventana se cierre "de mentira"
	 * antes de que el guardado realmente haya terminado. */
	let guardando = $state(false);
	let errorGuardado = $state('');

	async function handleGuardar() {
		errorGuardado = '';
		if (!activo || filas.length === 0) {
			guardando = true;
			try {
				await onEliminar();
				onClose();
			} catch (err: any) {
				errorGuardado = err?.message ?? 'No se pudo guardar el fraccionamiento.';
			} finally {
				guardando = false;
			}
			return;
		}
		if (!sumaOk) return;
		guardando = true;
		try {
			await onConfirm(filas.map((f) => ({ fecha: f.fecha, monto: Number(f.monto) })));
			onClose();
		} catch (err: any) {
			errorGuardado = err?.message ?? 'No se pudo guardar el fraccionamiento.';
		} finally {
			guardando = false;
		}
	}

	async function handleEliminarFraccionamiento() {
		errorGuardado = '';
		activo = false;
		filas = [];
		guardando = true;
		try {
			await onEliminar();
			onClose();
		} catch (err: any) {
			errorGuardado = err?.message ?? 'No se pudo eliminar el fraccionamiento.';
		} finally {
			guardando = false;
		}
	}
</script>

{#if open}
	<div class="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
		<div class="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
			<div class="sticky top-0 flex items-center justify-between bg-white px-6 py-4 border-b border-slate-200 z-10">
				<h2 class="text-lg font-semibold text-[#0f3b5e]">{titulo}</h2>
				<button type="button" onclick={onClose} class="p-1 hover:bg-slate-100 rounded-full text-slate-500" aria-label="Cerrar">
					<X size={20} />
				</button>
			</div>

			<div class="p-6 space-y-4">
				<div class="flex items-center justify-between rounded-lg border border-slate-200 px-4 py-3">
					<span class="text-sm font-bold text-slate-700">{titulo}</span>
					<button
						type="button"
						role="switch"
						aria-label={titulo}
						aria-checked={activo}
						onclick={() => (activo = !activo)}
						class={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${activo ? 'bg-blue-600' : 'bg-slate-300'}`}
					>
						<span class={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${activo ? 'translate-x-6' : 'translate-x-1'}`}></span>
					</button>
				</div>

				{#if activo}
					<div class="flex items-center justify-between">
						<span class="text-sm font-bold text-slate-700">Número de fracciones</span>
						<div class="flex items-center gap-2">
							<button type="button" onclick={decrementarNumero} class="p-1.5 rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50 disabled:opacity-40" disabled={filas.length <= 1}>
								<Minus size={14} />
							</button>
							<span class="w-8 text-center text-sm font-semibold text-slate-700">{filas.length}</span>
							<button type="button" onclick={incrementarNumero} class="p-1.5 rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50">
								<Plus size={14} />
							</button>
						</div>
					</div>

					<div>
						<span class="block text-sm font-bold text-slate-700 mb-1">Método de fraccionamiento</span>
						<select
							value={metodo}
							onchange={(e) => (metodo = (e.target as HTMLSelectElement).value as 'montos_iguales' | 'montos_desiguales')}
							class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
						>
							<option value="montos_iguales">Montos iguales</option>
							<option value="montos_desiguales">Montos desiguales</option>
						</select>
						{#if metodo === 'montos_iguales'}
							<p class="mt-1 text-xs text-slate-400">El monto de cada fracción se calcula solo y no se puede editar.</p>
						{/if}
					</div>

					<div class="space-y-2">
						{#each filas as fila, i (i)}
							<div class="flex items-center gap-2 rounded-lg border border-slate-200 p-2">
								<span class="w-16 shrink-0 text-xs font-medium text-slate-500">Fracción {i + 1}</span>
								<input
									type="date"
									value={fila.fecha}
									onchange={(e) => actualizarFecha(i, (e.target as HTMLInputElement).value)}
									class="flex-1 rounded-lg border border-slate-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
								/>
								<input
									type="text"
									inputmode="decimal"
									value={fila.monto}
									disabled={metodo === 'montos_iguales'}
									oninput={(e) => actualizarMonto(i, (e.target as HTMLInputElement).value)}
									class="w-28 rounded-lg border border-slate-300 px-2 py-1.5 text-sm text-right focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:bg-slate-100 disabled:text-slate-400 disabled:cursor-not-allowed"
								/>
								<button type="button" onclick={() => eliminarFraccion(i)} class="p-1.5 rounded-lg text-red-500 hover:bg-red-50" aria-label="Eliminar fracción">
									<Trash2 size={16} />
								</button>
							</div>
						{/each}
					</div>

					<button type="button" onclick={agregarFraccion} class="flex items-center gap-1 text-sm font-medium text-blue-600 hover:text-blue-700">
						<Plus size={16} /> Agregar fracción
					</button>

					<div class={`flex justify-between rounded-lg px-3 py-2 text-sm font-medium ${sumaOk ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
						<span>Total fracciones</span>
						<span>{formatCurrency(sumaFilas)} de {formatCurrency(montoTotal)}</span>
					</div>
					{#if !sumaOk}
						<p class="text-xs text-red-600">La suma de las fracciones debe ser igual al monto total antes de guardar.</p>
					{/if}
				{/if}
				{#if errorGuardado}
					<p class="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">{errorGuardado}</p>
				{/if}
			</div>

			<div class="sticky bottom-0 flex items-center justify-between gap-2 bg-white px-6 py-4 border-t border-slate-200">
				<button type="button" onclick={handleEliminarFraccionamiento} disabled={guardando} class="px-3 py-2 text-sm font-medium rounded-lg text-red-600 hover:bg-red-50 flex items-center gap-1 disabled:opacity-50">
					<Trash2 size={16} /> Eliminar fraccionamiento
				</button>
				<div class="flex gap-2">
					<button type="button" onclick={onClose} disabled={guardando} class="px-4 py-2 text-sm font-medium rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50 disabled:opacity-50">
						Cancelar
					</button>
					<button
						type="button"
						onclick={handleGuardar}
						disabled={guardando || (activo && (filas.length === 0 || !sumaOk))}
						class="px-4 py-2 text-sm font-medium rounded-lg bg-[#0f3b5e] text-white hover:bg-[#0c2f4c] disabled:opacity-50 flex items-center gap-2"
					>
						{#if guardando}<Loader2 size={16} class="animate-spin" />{/if}
						Guardar
					</button>
				</div>
			</div>
		</div>
	</div>
{/if}
