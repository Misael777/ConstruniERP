<script lang="ts">
	import SelectConSaldo from '$lib/shared/components/SelectConSaldo.svelte';
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
	import { untrack } from 'svelte';
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
		metodoSugerido,
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
		/** Método con el que abrir la ventana cuando todavía NO hay fracciones (cuenta nueva) — a pedido
		 * del usuario, CuentaCobrarModal/CuentaPagarModal lo pasan en 'por_porcentaje' cuando "Forma de
		 * Pago" es Por Porcentaje, para que arranque directo en ese modo en vez de "Montos iguales". Si
		 * ya hay fracciones (edición), se ignora: se detecta el método por la forma de esos datos (ver
		 * pareceMontosIguales) igual que antes. */
		metodoSugerido?: 'montos_iguales' | 'montos_desiguales' | 'por_porcentaje';
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

	type Periodicidad = 'mensual' | 'quincenal' | 'semanal';

	/** Tickets #20/#22: antes las fechas de las cuotas SIEMPRE avanzaban de a un mes exacto
	 * (addMonths), sin importar qué tan seguido se cobra/paga de verdad. 'quincenal'/'semanal' suman
	 * días exactos en vez de meses. `periodo` es un parámetro (y no se lee directo del $state) a
	 * propósito — ver el comentario de repartirEnPartesIguales. */
	function avanzarPeriodo(fecha: Date, periodos: number, periodo: Periodicidad): Date {
		if (periodo === 'mensual') return addMonths(fecha, periodos);
		const dias = periodo === 'quincenal' ? 15 : 7;
		const d = new Date(fecha);
		d.setUTCDate(d.getUTCDate() + dias * periodos);
		return d;
	}

	/** Hoy (fecha LOCAL, no UTC) como medianoche UTC — misma forma que `new Date('yyyy-mm-dd')`, así las
	 * fechas armadas desde acá se comportan igual que las que vienen de un campo de fecha. */
	function hoyComoFechaBase(): Date {
		return new Date(new Date().toLocaleDateString('en-CA'));
	}

	/** Solo las fechas (sin montos) que le tocarían a `n` cuotas con la periodicidad elegida — usada
	 * tanto por repartirEnPartesIguales como para RE-fechar las filas existentes cuando el usuario
	 * cambia la periodicidad (ver el $effect de más abajo). Ticket #22 (2ª vuelta): (1) sin Fecha de
	 * Emisión válida (cuenta nueva a medio llenar) antes TODAS las cuotas caían en "hoy" sin avanzar —
	 * ahora se parte de hoy y cada cuota avanza igual; (2) se quitó el tope contra la Fecha de
	 * Vencimiento: no es un techo del calendario de cuotas (al confirmar, esa fecha pasa a ser la
	 * cuota más cercana a hoy, ver onFraccionesConfirmadas) y recortar contra ella dejaba todas las
	 * cuotas en la misma fecha aun con "Mensual". */
	function fechasParaPeriodicidad(n: number, periodo: Periodicidad = periodicidad): string[] {
		const desdeEmision = new Date(fechaEmision);
		const inicio = Number.isNaN(desdeEmision.getTime()) ? hoyComoFechaBase() : desdeEmision;
		const fechas: string[] = [];
		for (let i = 1; i <= n; i++) fechas.push(toISODate(avanzarPeriodo(inicio, i, periodo)));
		return fechas;
	}

	/** `periodo` opcional: por defecto lee la periodicidad elegida (reactivo); quien NO debe depender de
	 * ella (el efecto de "abrir" y pareceMontosIguales) pasa 'mensual' explícito. Sin esto, cambiar la
	 * periodicidad volvía a disparar el efecto de "abrir" (lo leía indirectamente por acá), que la
	 * reseteaba a 'mensual' — por eso "no cambiaba nada" al elegir Semanal/Quincenal (ticket #22). */
	function repartirEnPartesIguales(n: number, periodo: Periodicidad = periodicidad): Fraccion[] {
		const fechas = fechasParaPeriodicidad(n, periodo);
		const base = Number.isFinite(montoTotal) ? montoTotal : 0;
		const montoBase = Math.floor((base / n) * 100) / 100;
		const filas: Fraccion[] = [];
		let acumulado = 0;
		for (let i = 0; i < n; i++) {
			const esUltima = i === n - 1;
			const monto = esUltima ? Number((base - acumulado).toFixed(2)) : montoBase;
			acumulado += monto;
			filas.push({ fecha: fechas[i], monto });
		}
		return filas;
	}

	let activo = $state(fraccionesIniciales.length > 0);
	let filas = $state<Fraccion[]>([]);
	let metodo = $state<'montos_iguales' | 'montos_desiguales' | 'por_porcentaje'>('montos_iguales');
	/** Independiente de "Método de fraccionamiento" (que decide cómo se reparte el MONTO) — esto decide
	 * cada cuánto avanza la FECHA de una cuota a la siguiente. Arranca en 'mensual' siempre (mismo
	 * comportamiento que ya existía) — no se infiere de datos ya guardados, que se crearon todos bajo la
	 * lógica mensual anterior. */
	let periodicidad = $state<Periodicidad>('mensual');

	/** ¿Los montos de `filas` calzan con lo que daría un reparto en partes iguales? (con tolerancia de
	 * un centavo por redondeo). Se usa solo para decidir con qué método abrir una cuenta YA fraccionada
	 * — si sus cuotas no son iguales, se respeta como "Montos desiguales" en vez de forzarlas a calzar. */
	function pareceMontosIguales(candidatas: Fraccion[]): boolean {
		if (candidatas.length <= 1) return true;
		const esperado = repartirEnPartesIguales(candidatas.length, 'mensual');
		return candidatas.every((f, i) => Math.abs(f.monto - esperado[i].monto) < 0.01);
	}

	// La ventana solo es alcanzable cuando Forma de Pago ya es Fraccionado/Por Porcentaje/Crédito (ver
	// botón "Configurar Cuotas" en CuentaCobrarModal/CuentaPagarModal) — así que siempre abre con el
	// fraccionamiento YA activo (antes quedaba apagado por defecto en cuentas nuevas sin cuotas
	// previas, dejando la ventana casi vacía hasta que el usuario encontrara el interruptor).
	$effect(() => {
		if (!open) return;
		activo = true;
		periodicidad = 'mensual';
		// OJO: se usa una variable local (`nuevasFilas`) para decidir el método, NO se vuelve a leer
		// `filas` (el $state) — leerla acá la dejaría "suscrita" a los cambios que hace el otro efecto
		// (el que recalcula montos iguales más abajo), disparando este efecto de nuevo, que resetea
		// `filas` a su valor inicial, disparando otra vez al otro efecto... un loop infinito real que
		// nunca deja guardar (ver Svelte error "effect_update_depth_exceeded").
		const nuevasFilas = fraccionesIniciales.length > 0 ? fraccionesIniciales.map((f) => ({ ...f })) : repartirEnPartesIguales(3, 'mensual');
		filas = nuevasFilas;
		if (fraccionesIniciales.length === 0 && metodoSugerido) {
			metodo = metodoSugerido;
		} else {
			metodo = pareceMontosIguales(nuevasFilas) ? 'montos_iguales' : 'montos_desiguales';
		}
	});

	// Mientras el método sea "Montos iguales", el monto de cada fracción se recalcula solo (montoTotal
	// ÷ N, última absorbe el redondeo) cada vez que cambia el número de fracciones o montoTotal — el
	// campo queda bloqueado en el template (ver `disabled={metodo === 'montos_iguales'}`). El chequeo
	// de "¿cambió algo?" evita un loop infinito (este efecto lee Y escribe `filas`).
	$effect(() => {
		if (metodo !== 'montos_iguales' || filas.length === 0) return;
		const esperado = repartirEnPartesIguales(filas.length, 'mensual');
		const cambio = filas.some((f, i) => Math.abs(f.monto - esperado[i].monto) > 0.001);
		if (cambio) filas = filas.map((f, i) => ({ ...f, monto: esperado[i].monto }));
	});

	// Cuando el usuario cambia "Periodicidad", re-fecha las cuotas YA generadas (sin tocar sus montos)
	// para que respeten el nuevo espaciado — a propósito NO depende reactivamente de `filas` (se lee con
	// `untrack`, ver comentario del efecto de "abrir" más arriba): si dependiera de `filas`, cualquier
	// edición manual de una fecha (actualizarFecha) volvería a pisarla con la fecha "canónica".
	$effect(() => {
		periodicidad;
		const filasActuales = untrack(() => filas);
		if (filasActuales.length === 0) return;
		const fechas = fechasParaPeriodicidad(filasActuales.length);
		filas = filasActuales.map((f, i) => ({ ...f, fecha: fechas[i] }));
	});

	const sumaFilas = $derived(filas.reduce((sum, f) => sum + (Number.isFinite(f.monto) ? f.monto : 0), 0));
	const sumaOk = $derived(Math.abs(Number(sumaFilas.toFixed(2)) - Number((montoTotal || 0).toFixed(2))) < 0.01);

	function agregarFraccion() {
		const ultima = filas[filas.length - 1];
		const desdeUltima = new Date(ultima ? ultima.fecha : fechaEmision);
		const baseFecha = Number.isNaN(desdeUltima.getTime()) ? hoyComoFechaBase() : desdeUltima;
		const fecha = avanzarPeriodo(baseFecha, 1, periodicidad);
		const restante = Number(((montoTotal || 0) - sumaFilas).toFixed(2));
		filas = [...filas, { fecha: toISODate(fecha), monto: restante > 0 ? restante : 0 }];
		if (metodo === 'por_porcentaje') repartirMontosIgualesEnFilas();
	}

	function eliminarFraccion(index: number) {
		filas = filas.filter((_, i) => i !== index);
		if (metodo === 'por_porcentaje') repartirMontosIgualesEnFilas();
	}

	function actualizarFecha(index: number, fecha: string) {
		filas = filas.map((f, i) => (i === index ? { ...f, fecha } : f));
	}

	/** A pedido explícito del usuario: el campo de monto de cada fracción (modo "Montos desiguales")
	 * solo acepta valores que "encajen" en montoTotal — ninguna fracción puede valer más que el monto
	 * total completo (obviamente no "encajaría"). El primer intento de este arreglo recortaba al
	 * "restante" (montoTotal menos la suma de las OTRAS filas), pero eso depende del orden en que el
	 * usuario llena los campos: mientras las filas siguientes todavía tienen su valor por defecto (del
	 * reparto en partes iguales) sin editar, el "restante" para la PRIMERA fila que se toca queda
	 * artificialmente chico, recortándola a un número que no es el que el usuario escribió — y ese
	 * recorte, aplicado mientras el campo sigue enfocado y el usuario sigue tecleando, hacía que el
	 * cuadro de texto mostrara una cosa (lo tecleado) y el estado interno otra (lo recortado), así que
	 * "Total fracciones" terminaba sin coincidir con lo que se veía en pantalla. Este tope absoluto
	 * (solo contra montoTotal, sin depender de las demás filas) es estable sin importar el orden en que
	 * se editen los campos. La suma EXACTA sigue exigiéndose al guardar (ver sumaOk/handleGuardar) —
	 * ese chequeo, no un recorte en vivo, es el lugar correcto para la validación entre varias filas.
	 * Puro cálculo en el cliente (sin ninguna API de plataforma), funciona igual en web, Tauri Windows y
	 * Tauri Android. */
	function actualizarMonto(index: number, raw: string) {
		const masked = currencyMask(raw);
		const ingresado = masked === '' ? 0 : Number(masked);
		const maximoPermitido = Math.max(Number((montoTotal || 0).toFixed(2)), 0);
		const final = Math.min(ingresado, maximoPermitido);
		filas = filas.map((f, i) => (i === index ? { ...f, monto: final } : f));
	}

	/** Modo "Por porcentaje (%)" — a pedido explícito del usuario: el monto de cada fracción ya no se
	 * edita directamente, se deriva del porcentaje que el usuario escribe (montoTotal × % ÷ 100). El
	 * porcentaje de cada fila se muestra calculado a partir de `monto` (ver `porcentajeDeFila`), no se
	 * guarda aparte — así el arreglo final que recibe `onConfirm` sigue siendo solo {fecha, monto},
	 * igual que en los otros dos métodos. */
	function porcentajeDeFila(monto: number): string {
		if (!montoTotal) return '0.00';
		return ((monto / montoTotal) * 100).toFixed(2);
	}

	/** Reparte `monto` en `n` partes iguales con céntimos exactos (la última absorbe el redondeo). */
	function repartirMonto(monto: number, n: number): number[] {
		if (n <= 0) return [];
		const base = Math.floor((monto / n) * 100) / 100;
		const partes = Array(n).fill(base);
		partes[n - 1] = Number((monto - base * (n - 1)).toFixed(2));
		return partes;
	}

	/** Reparte montoTotal (100%) en partes iguales entre las filas actuales, sin tocar sus fechas. */
	function repartirMontosIgualesEnFilas() {
		const partes = repartirMonto(Number((montoTotal || 0).toFixed(2)), filas.length);
		filas = filas.map((f, i) => ({ ...f, monto: partes[i] }));
	}

	/** A pedido del usuario: en "Por porcentaje" la suma SIEMPRE es 100%. Al fijar el % de una fracción, las
	 * anteriores se respetan (se llenan de arriba hacia abajo) y lo que falta se reparte en partes iguales
	 * entre las SIGUIENTES; si es la última, el ajuste se reparte entre las anteriores. El % ingresado se
	 * limita a lo que queda disponible para que nunca pase del 100%. Se calcula en soles (céntimos exactos),
	 * el % visible sale de cada monto (ver porcentajeDeFila). Se aplica al terminar de escribir (onchange). */
	function actualizarPorcentaje(index: number, raw: string) {
		const total = Number((montoTotal || 0).toFixed(2));
		const masked = raw.replace(/[^\d.]/g, '');
		const ingresado = Math.max(masked === '' ? 0 : Number(masked), 0);
		const esUltima = index === filas.length - 1;
		const fijas = esUltima ? [] : filas.slice(0, index);
		const montoFijo = fijas.reduce((sum, f) => sum + f.monto, 0);
		const disponible = Math.max(Number((total - montoFijo).toFixed(2)), 0);
		const monto = Math.min(Number(((total * Math.min(ingresado, 100)) / 100).toFixed(2)), disponible);
		if (filas.length === 1) {
			filas = [{ ...filas[0], monto: total }];
			return;
		}
		const indicesAjuste = esUltima ? filas.map((_, i) => i).filter((i) => i !== index) : filas.map((_, i) => i).filter((i) => i > index);
		const partes = repartirMonto(Number((disponible - monto).toFixed(2)), indicesAjuste.length);
		filas = filas.map((f, i) => {
			if (i === index) return { ...f, monto };
			const pos = indicesAjuste.indexOf(i);
			return pos === -1 ? f : { ...f, monto: partes[pos] };
		});
	}

	// Al pasar a "Por porcentaje" con fracciones que no suman el 100% (ej. venían de "Montos desiguales"),
	// se reparten en partes iguales para arrancar ya cuadrado.
	$effect(() => {
		if (metodo !== 'por_porcentaje') return;
		const actuales = untrack(() => filas);
		if (actuales.length === 0) return;
		const suma = actuales.reduce((sum, f) => sum + f.monto, 0);
		if (Math.abs(Number(suma.toFixed(2)) - Number((montoTotal || 0).toFixed(2))) >= 0.01) untrack(() => repartirMontosIgualesEnFilas());
	});

	const sumaPorcentajes = $derived(filas.reduce((sum, f) => sum + (montoTotal ? (f.monto / montoTotal) * 100 : 0), 0));

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
					<span class="text-sm font-bold text-[#0f3b5e]">{titulo}</span>
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
						<span class="text-sm font-bold text-[#0f3b5e]">Número de fracciones</span>
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
						<span class="block text-sm font-bold text-[#0f3b5e] mb-1">Periodicidad</span>
						<SelectConSaldo
							value={periodicidad}
							options={[{ value: 'mensual', label: 'Mensual' }, { value: 'quincenal', label: 'Quincenal' }, { value: 'semanal', label: 'Semanal' }]}
							onchange={(v) => ((periodicidad = v as Periodicidad))}
						/>
						<p class="mt-1 text-xs text-slate-400">
							Cada cuota cae {periodicidad === 'mensual' ? 'un mes' : periodicidad === 'quincenal' ? '15 días' : '7 días'} después de la anterior, contando desde la Fecha de Emisión (o desde hoy si todavía no la llenaste).
						</p>
					</div>

					<div>
						<span class="block text-sm font-bold text-[#0f3b5e] mb-1">Método de fraccionamiento</span>
						<SelectConSaldo
							value={metodo}
							options={[{ value: 'montos_iguales', label: 'Montos iguales' }, { value: 'montos_desiguales', label: 'Montos desiguales' }, { value: 'por_porcentaje', label: 'Por porcentaje (%)' }]}
							onchange={(v) => ((metodo = v as 'montos_iguales' | 'montos_desiguales' | 'por_porcentaje'))}
						/>
						{#if metodo === 'montos_iguales'}
							<p class="mt-1 text-xs text-slate-400">El monto de cada fracción se calcula solo y no se puede editar.</p>
						{:else if metodo === 'por_porcentaje'}
							<p class="mt-1 text-xs text-slate-400">La suma siempre es 100%: al cambiar el % de una fracción, las siguientes se recalculan solas.</p>
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
								{#if metodo === 'por_porcentaje'}
									<input
										type="text"
										inputmode="decimal"
										value={porcentajeDeFila(fila.monto)}
										onchange={(e) => { const input = e.target as HTMLInputElement; actualizarPorcentaje(i, input.value); input.value = porcentajeDeFila(filas[i].monto); }}
										onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLInputElement).blur(); } }}
										aria-label={`Porcentaje de la fracción ${i + 1}`}
										class="w-16 rounded-lg border border-slate-300 px-2 py-1.5 text-sm text-right focus:outline-none focus:ring-2 focus:ring-blue-200"
									/>
									<span class="text-xs text-slate-400">%</span>
									<input
										type="text"
										readonly
										value={formatCurrency(fila.monto)}
										aria-label={`Monto de la fracción ${i + 1}`}
										class="w-24 rounded-lg border border-slate-300 bg-slate-100 px-2 py-1.5 text-sm text-right text-slate-500 cursor-default focus:outline-none"
									/>
								{:else}
									<input
										type="text"
										inputmode="decimal"
										value={fila.monto}
										disabled={metodo === 'montos_iguales'}
										oninput={(e) => actualizarMonto(i, (e.target as HTMLInputElement).value)}
										class="w-28 rounded-lg border border-slate-300 px-2 py-1.5 text-sm text-right focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:bg-slate-100 disabled:text-slate-400 disabled:cursor-not-allowed"
									/>
								{/if}
								<button type="button" onclick={() => eliminarFraccion(i)} class="p-1.5 rounded-lg text-red-500 hover:bg-red-50" aria-label="Eliminar fracción">
									<Trash2 size={16} />
								</button>
							</div>
						{/each}
					</div>

					<button type="button" onclick={agregarFraccion} class="flex items-center gap-1 text-sm font-medium text-blue-600 hover:text-blue-700">
						<Plus size={16} /> Agregar fracción
					</button>

					<div class={`flex items-center justify-between rounded-lg px-3 py-2 text-sm font-medium ${sumaOk ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
						<span>Total fracciones</span>
						{#if metodo === 'por_porcentaje'}
							<span class="text-right">
								<span class="block">{sumaPorcentajes.toFixed(2)}%</span>
								<span class="block text-xs font-normal opacity-80">{formatCurrency(sumaFilas)} de {formatCurrency(montoTotal)}</span>
							</span>
						{:else}
							<span>{formatCurrency(sumaFilas)} de {formatCurrency(montoTotal)}</span>
						{/if}
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
