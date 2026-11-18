<script lang="ts">
	/**
	 * Trayectoria de saldo de las cuentas bancarias (Control Financiero → Dashboard). A pedido del usuario
	 * (17/11/2026) se puede elegir el tipo de gráfico:
	 *  - Línea: una línea por cuenta (la de siempre), con el saldo inicial (◇) y el actual (●) resaltados.
	 *  - Flechas: una cuenta; cada transacción es una flecha verde (ingreso) o roja (egreso) del saldo anterior
	 *    al nuevo.
	 *  - Velas: una cuenta agrupada por período (día, semana, mes, trimestre o año): abre, máximo, mínimo y
	 *    cierre del saldo. Al pasar el mouse por una vela, un panel flotante lista sus transacciones (clic = fijarlo).
	 * En todos se ve siempre el saldo inicial (con su fecha de apertura) y el saldo actual.
	 */
	import { onDestroy } from 'svelte';
	import Chart from 'chart.js/auto';
	import type { TrayectoriaResultado, SerieTrayectoria, MovimientoTrayectoria } from '../services/trayectoria.service';

	let { resultado }: { resultado: TrayectoriaResultado } = $props();

	type Tipo = 'linea' | 'flechas' | 'velas';
	type Periodo = 'dia' | 'semana' | 'mes' | 'trimestre' | 'anio';

	const CLAVE_TIPO = 'construni_cf_trayectoria_tipo';
	const CLAVE_PERIODO = 'construni_cf_trayectoria_periodo';
	const leer = (k: string) => {
		try {
			return localStorage.getItem(k);
		} catch {
			return null;
		}
	};
	const guardar = (k: string, v: string) => {
		try {
			localStorage.setItem(k, v);
		} catch {
			/* sin almacenamiento: no pasa nada */
		}
	};

	let tipo = $state<Tipo>((['linea', 'flechas', 'velas'].includes(leer(CLAVE_TIPO) ?? '') ? leer(CLAVE_TIPO) : 'linea') as Tipo);
	let periodo = $state<Periodo>((['dia', 'semana', 'mes', 'trimestre', 'anio'].includes(leer(CLAVE_PERIODO) ?? '') ? leer(CLAVE_PERIODO) : 'mes') as Periodo);
	let cuentaId = $state('');
	/** Filtro de la línea: '' = todas las cuentas. */
	let cuentaLinea = $state('');
	/** Rango de fechas (a pedido del cliente, 17/11/2026). '' = sin límite. Aplica a los tres gráficos. */
	let desde = $state('');
	let hasta = $state('');
	const hayRango = $derived(!!(desde || hasta));
	const enRango = (f: string) => (!desde || f >= desde) && (!hasta || f <= hasta);
	function presetRango(dias: number | 'anio' | null) {
		if (dias === null) {
			desde = '';
			hasta = '';
			return;
		}
		const hoy = new Date();
		const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
		hasta = '';
		if (dias === 'anio') desde = `${hoy.getFullYear()}-01-01`;
		else {
			const d = new Date(hoy);
			d.setDate(d.getDate() - dias);
			desde = iso(d);
		}
	}

	const TIPOS: { id: Tipo; label: string; icono: string }[] = [
		{ id: 'linea', label: 'Línea', icono: 'fa-chart-line' },
		{ id: 'flechas', label: 'Flechas ingreso / egreso', icono: 'fa-arrows-up-down' },
		{ id: 'velas', label: 'Velas', icono: 'fa-chart-column' }
	];
	const PERIODOS: { id: Periodo; label: string }[] = [
		{ id: 'dia', label: 'Día' },
		{ id: 'semana', label: 'Semana' },
		{ id: 'mes', label: 'Mes' },
		{ id: 'trimestre', label: 'Trimestre' },
		{ id: 'anio', label: 'Año' }
	];
	const PALETA = ['#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#10b981', '#64748b', '#ec4899', '#14b8a6', '#f97316', '#6366f1'];
	const VERDE = '#16a34a';
	const ROJO = '#dc2626';
	const COLOR_INICIAL = '#64748b';
	const COLOR_ACTUAL = '#2563eb';

	const NUM = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
	function dinero(v: number, moneda?: string) {
		const s = moneda === 'dolares' ? '$' : moneda === 'otro' ? '' : 'S/';
		const t = NUM.format(Math.abs(v));
		return `${v < 0 ? '−' : ''}${s ? s + ' ' : ''}${t}`;
	}
	const conSigno = (v: number, moneda?: string) => `${v > 0 ? '+' : ''}${dinero(v, moneda)}`;
	function fecha(f?: string) {
		if (!f) return '—';
		const [y, m, d] = f.slice(0, 10).split('-');
		return `${d}/${m}/${y}`;
	}

	// Cuenta elegida (flechas y velas): por defecto la que más movimientos tiene.
	const cuentas = $derived(resultado.series);
	$effect(() => {
		if (!cuentas.length) return;
		if (!cuentas.some((c) => c.id === cuentaId)) {
			cuentaId = [...cuentas].sort((a, b) => (b.movimientos?.length ?? 0) - (a.movimientos?.length ?? 0))[0].id;
		}
	});
	const serie = $derived<SerieTrayectoria | undefined>(cuentas.find((c) => c.id === cuentaId));
	/** Movimientos de la cuenta elegida dentro del rango de fechas. */
	const movsRango = $derived((serie?.movimientos ?? []).filter((m) => enRango(m.fecha)));
	const seriesLinea = $derived(cuentaLinea ? cuentas.filter((c) => c.id === cuentaLinea) : cuentas);

	// ── Velas ──────────────────────────────────────────────────────────────────
	interface Vela {
		clave: string;
		label: string;
		o: number;
		h: number;
		l: number;
		c: number;
		movs: MovimientoTrayectoria[];
	}
	const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
	function clavePeriodo(f: string, p: Periodo): { clave: string; label: string } {
		const [y, m, d] = f.split('-').map(Number);
		if (p === 'dia') return { clave: f, label: fecha(f) };
		if (p === 'mes') return { clave: `${y}-${String(m).padStart(2, '0')}`, label: `${MESES[m - 1]} ${y}` };
		if (p === 'trimestre') {
			const q = Math.floor((m - 1) / 3) + 1;
			return { clave: `${y}-T${q}`, label: `T${q} ${y}` };
		}
		if (p === 'anio') return { clave: String(y), label: String(y) };
		// Semana: lunes a domingo.
		const dt = new Date(Date.UTC(y, m - 1, d));
		dt.setUTCDate(dt.getUTCDate() - ((dt.getUTCDay() + 6) % 7));
		const lunes = dt.toISOString().slice(0, 10);
		return { clave: lunes, label: `Sem. ${fecha(lunes).slice(0, 5)}/${lunes.slice(2, 4)}` };
	}
	const velas = $derived.by<Vela[]>(() => {
		if (!serie) return [];
		const out: Vela[] = [];
		for (const mv of movsRango) {
			const { clave, label } = clavePeriodo(mv.fecha, periodo);
			let v = out[out.length - 1];
			if (!v || v.clave !== clave) {
				v = { clave, label, o: mv.saldoAntes, h: mv.saldoAntes, l: mv.saldoAntes, c: mv.saldoAntes, movs: [] };
				out.push(v);
			}
			v.movs.push(mv);
			v.c = mv.saldoDespues;
			v.h = Math.max(v.h, mv.saldoDespues);
			v.l = Math.min(v.l, mv.saldoDespues);
		}
		return out;
	});

	// ── Panel flotante (velas) ─────────────────────────────────────────────────
	let panel = $state<{ idx: number; x: number; y: number; fijo: boolean } | null>(null);
	let contenedor = $state<HTMLDivElement>();
	const velaPanel = $derived(panel ? velas[panel.idx] : undefined);
	const posPanel = $derived.by(() => {
		if (!panel || !contenedor) return '';
		const ancho = 320;
		const w = contenedor.clientWidth;
		const h = contenedor.clientHeight;
		let left = panel.x + 14;
		if (left + ancho > w) left = Math.max(0, panel.x - ancho - 14);
		const top = Math.max(0, Math.min(panel.y - 20, h - 200));
		return `left:${left}px;top:${top}px;width:${Math.min(ancho, w)}px`;
	});

	// ── Gráfico ────────────────────────────────────────────────────────────────
	let canvas = $state<HTMLCanvasElement>();
	let chart: Chart | null = null;

	/** Líneas punteadas del saldo inicial y del actual, con su etiqueta (flechas y velas). */
	const lineasReferencia = {
		id: 'lineasReferencia',
		afterDatasetsDraw(c: Chart) {
			const ref = (c.options.plugins as any)?.lineasReferencia as { inicial: number; actual: number; moneda?: string } | undefined;
			if (!ref) return;
			const { ctx, chartArea } = c;
			const y = c.scales.y;
			const dibujar = (valor: number, color: string, texto: string, alDerecha: boolean) => {
				const py = y.getPixelForValue(valor);
				if (py < chartArea.top - 1 || py > chartArea.bottom + 1) return;
				ctx.save();
				ctx.strokeStyle = color;
				ctx.lineWidth = 1.5;
				ctx.setLineDash([6, 4]);
				ctx.beginPath();
				ctx.moveTo(chartArea.left, py);
				ctx.lineTo(chartArea.right, py);
				ctx.stroke();
				ctx.setLineDash([]);
				ctx.font = 'bold 11px system-ui, sans-serif';
				const w = ctx.measureText(texto).width + 12;
				const x = alDerecha ? chartArea.right - w - 4 : chartArea.left + 4;
				ctx.fillStyle = color;
				ctx.beginPath();
				ctx.roundRect(x, py - 9, w, 18, 9);
				ctx.fill();
				ctx.fillStyle = '#ffffff';
				ctx.textBaseline = 'middle';
				ctx.fillText(texto, x + 6, py);
				ctx.restore();
			};
			dibujar(ref.inicial, COLOR_INICIAL, `Saldo inicial ${dinero(ref.inicial, ref.moneda)}`, false);
			dibujar(ref.actual, COLOR_ACTUAL, `Saldo actual ${dinero(ref.actual, ref.moneda)}`, true);
		}
	};

	/** Punta de flecha al final de cada barra de movimiento (gráfico de flechas). */
	const puntasFlecha = {
		id: 'puntasFlecha',
		afterDatasetsDraw(c: Chart) {
			if (!(c.options.plugins as any)?.puntasFlecha) return;
			const meta = c.getDatasetMeta(0);
			const { ctx } = c;
			meta.data.forEach((el: any, i: number) => {
				const valor = c.data.datasets[0].data[i] as unknown as [number, number] | null;
				if (!valor) return;
				const sube = valor[1] >= valor[0];
				const ancho = Math.max(8, Math.min(18, (el.width ?? 8) * 1.7));
				const alto = Math.min(9, ancho * 0.7);
				ctx.save();
				ctx.fillStyle = sube ? VERDE : ROJO;
				ctx.beginPath();
				ctx.moveTo(el.x, el.y + (sube ? -alto : alto));
				ctx.lineTo(el.x - ancho / 2, el.y);
				ctx.lineTo(el.x + ancho / 2, el.y);
				ctx.closePath();
				ctx.fill();
				ctx.restore();
			});
		}
	};

	function ejeY(valores: number[], moneda?: string) {
		const min = Math.min(...valores);
		const max = Math.max(...valores);
		const margen = (max - min) * 0.08 || Math.abs(max) * 0.1 || 1;
		return {
			suggestedMin: min - margen,
			suggestedMax: max + margen,
			ticks: { callback: (v: any) => dinero(Number(v), moneda) }
		};
	}

	function configLinea(): any {
		// Eje de fechas: las de las cuentas mostradas, dentro del rango (con el borde "desde" para que la línea
		// arranque en el saldo que traía a esa fecha).
		const fechasSet = new Set<string>();
		for (const s of seriesLinea) for (const p of s.puntos) if (enRango(p.fecha)) fechasSet.add(p.fecha);
		if (desde) fechasSet.add(desde);
		const fechas = [...fechasSet].filter(enRango).sort();
		const datasets = seriesLinea.map((s) => {
			const i = cuentas.indexOf(s);
			const data: (number | null)[] = [];
			let idx = 0;
			let ultimo: number | null = null;
			for (const f of fechas) {
				while (idx < s.puntos.length && s.puntos[idx].fecha <= f) ultimo = s.puntos[idx++].saldo;
				data.push(ultimo);
			}
			const color = PALETA[i % PALETA.length];
			const idxInicial = s.puntos.length ? fechas.indexOf(s.puntos[0].fecha) : -1;
			// El ● de saldo actual solo si el rango llega hasta el último movimiento de la cuenta.
			const ultimaFecha = s.puntos[s.puntos.length - 1]?.fecha ?? '';
			const idxActual = ultimo === null || (hasta && ultimaFecha > hasta) ? -1 : data.length - 1;
			const marcas = data.map((_, k) => (k === idxActual ? 'actual' : k === idxInicial ? 'inicial' : null));
			return {
				label: s.label,
				data,
				marcas,
				moneda: s.moneda,
				borderColor: color,
				backgroundColor: 'transparent',
				borderWidth: 1.5,
				pointRadius: marcas.map((m) => (m ? 6 : 0)),
				pointHoverRadius: marcas.map((m) => (m ? 8 : 4)),
				pointStyle: marcas.map((m) => (m === 'inicial' ? 'rectRot' : 'circle')),
				pointBackgroundColor: marcas.map((m) => (m === 'actual' ? color : '#ffffff')),
				pointBorderColor: color,
				pointBorderWidth: 2,
				tension: 0.1,
				spanGaps: false
			};
		});
		return {
			type: 'line',
			data: { labels: fechas.map(fecha), datasets },
			options: {
				responsive: true,
				maintainAspectRatio: false,
				animation: false,
				interaction: { mode: 'nearest', intersect: false },
				plugins: {
					legend: { position: 'right', labels: { boxWidth: 10, font: { size: 9 } } },
					tooltip: {
						callbacks: {
							label: (ctx: any) => {
								const m = ctx.dataset.marcas?.[ctx.dataIndex];
								const p = m === 'actual' ? 'Saldo actual' : m === 'inicial' ? 'Saldo inicial' : 'Saldo';
								return `${ctx.dataset.label} · ${p}: ${dinero(Number(ctx.parsed.y), ctx.dataset.moneda)}`;
							}
						}
					}
				},
				scales: { y: { ticks: { callback: (v: any) => dinero(Number(v)) } } }
			}
		};
	}

	function configFlechas(s: SerieTrayectoria): any {
		const movs = movsRango;
		const inicial = s.saldoInicial ?? 0;
		const actual = s.saldoActual ?? inicial;
		const todos = s.movimientos ?? [];
		// Con rango, el primer punto es el saldo que traía la cuenta al empezar el rango (no el inicial).
		const recortaInicio = !!movs.length && movs[0] !== todos[0];
		const recortaFin = !!movs.length && movs[movs.length - 1] !== todos[todos.length - 1];
		const saldoPartida = recortaInicio ? movs[0].saldoAntes : inicial;
		const tituloPartida = recortaInicio ? `Saldo al ${fecha(desde || movs[0].fecha)}` : 'Saldo inicial';
		const labels = [recortaInicio ? 'Inicio' : 'Saldo inicial', ...movs.map((m) => fecha(m.fecha))];
		const saldos = [saldoPartida, ...movs.map((m) => m.saldoDespues)];
		const tituloFinal = recortaFin ? `Saldo al ${fecha(hasta || movs[movs.length - 1].fecha)}` : 'Saldo actual';
		return {
			type: 'bar',
			data: {
				labels,
				datasets: [
					{
						type: 'bar',
						label: 'Movimiento',
						data: [null, ...movs.map((m) => [m.saldoAntes, m.saldoDespues])],
						backgroundColor: [null, ...movs.map((m) => (m.delta > 0 ? VERDE : ROJO))],
						barPercentage: 0.35,
						categoryPercentage: 0.9,
						maxBarThickness: 10,
						order: 1
					},
					{
						type: 'line',
						label: 'Saldo',
						data: saldos,
						borderColor: '#cbd5e1',
						borderWidth: 1,
						borderDash: [3, 3],
						tension: 0,
						pointRadius: saldos.map((_, i) => (i === 0 || i === saldos.length - 1 ? 7 : 0)),
						pointHoverRadius: saldos.map((_, i) => (i === 0 || i === saldos.length - 1 ? 9 : 3)),
						pointStyle: saldos.map((_, i) => (i === 0 ? 'rectRot' : 'circle')),
						pointBackgroundColor: saldos.map((_, i) => (i === 0 ? '#ffffff' : COLOR_ACTUAL)),
						pointBorderColor: saldos.map((_, i) => (i === 0 ? COLOR_INICIAL : COLOR_ACTUAL)),
						pointBorderWidth: 2,
						order: 0
					}
				]
			},
			options: {
				responsive: true,
				maintainAspectRatio: false,
				animation: false,
				interaction: { mode: 'index', intersect: false },
				plugins: {
					legend: { display: false },
					lineasReferencia: { inicial, actual, moneda: s.moneda },
					puntasFlecha: true,
					tooltip: {
						filter: (item: any) => item.datasetIndex === 0 || item.dataIndex === 0 || item.dataIndex === saldos.length - 1,
						callbacks: {
							title: (items: any[]) => {
								const i = items[0]?.dataIndex ?? 0;
								return i === 0 ? (recortaInicio ? tituloPartida : `Saldo inicial · ${fecha(s.fechaInicial)}`) : fecha(movs[i - 1].fecha);
							},
							label: (ctx: any) => {
								const i = ctx.dataIndex;
								if (ctx.datasetIndex === 1) {
									if (i === 0) return `${tituloPartida}: ${dinero(saldoPartida, s.moneda)}`;
									return `${tituloFinal}: ${dinero(saldos[i], s.moneda)}`;
								}
								const m = movs[i - 1];
								const lineas = [
									`${m.delta > 0 ? 'Ingreso' : 'Egreso'} ${conSigno(m.delta, s.moneda)}${m.tipo ? ` · ${m.tipo}` : ''}`,
									`Saldo: ${dinero(m.saldoAntes, s.moneda)} → ${dinero(m.saldoDespues, s.moneda)}`
								];
								if (m.descripcion) lineas.push(m.descripcion.length > 70 ? m.descripcion.slice(0, 70) + '…' : m.descripcion);
								return lineas;
							}
						}
					}
				},
				scales: { x: { ticks: { maxRotation: 60, autoSkip: true } }, y: ejeY([...saldos, inicial, actual], s.moneda) }
			}
		};
	}

	function configVelas(s: SerieTrayectoria): any {
		const inicial = s.saldoInicial ?? 0;
		const actual = s.saldoActual ?? inicial;
		const colores = velas.map((v) => (v.c >= v.o ? VERDE : ROJO));
		return {
			type: 'bar',
			data: {
				labels: velas.map((v) => v.label),
				datasets: [
					{
						label: 'Cuerpo',
						data: velas.map((v) => [Math.min(v.o, v.c), Math.max(v.o, v.c)]),
						backgroundColor: colores,
						borderColor: colores,
						borderWidth: 1,
						minBarLength: 3,
						barPercentage: 0.7,
						categoryPercentage: 0.9,
						maxBarThickness: 36,
						grouped: false,
						order: 0
					},
					{
						label: 'Mecha',
						data: velas.map((v) => [v.l, v.h]),
						backgroundColor: colores,
						minBarLength: 1,
						barPercentage: 0.08,
						categoryPercentage: 0.9,
						maxBarThickness: 2,
						grouped: false,
						order: 1
					}
				]
			},
			options: {
				responsive: true,
				maintainAspectRatio: false,
				animation: false,
				interaction: { mode: 'index', intersect: false },
				plugins: {
					legend: { display: false },
					tooltip: { enabled: false },
					lineasReferencia: { inicial, actual, moneda: s.moneda }
				},
				scales: {
					x: { ticks: { maxRotation: 60, autoSkip: true } },
					y: ejeY([...velas.flatMap((v) => [v.h, v.l]), inicial, actual], s.moneda)
				},
				onHover: (evt: any, elementos: any[]) => {
					if (panel?.fijo) return;
					if (!elementos.length) {
						panel = null;
						return;
					}
					panel = { idx: elementos[0].index, x: evt.x, y: evt.y, fijo: false };
				},
				onClick: (evt: any, elementos: any[]) => {
					if (!elementos.length) {
						panel = null;
						return;
					}
					panel = { idx: elementos[0].index, x: evt.x, y: evt.y, fijo: true };
				}
			}
		};
	}

	$effect(() => {
		// Dependencias: tipo, cuenta, período y datos.
		const t = tipo;
		const s = serie;
		void velas;
		void resultado;
		void movsRango;
		void seriesLinea;
		void desde;
		void hasta;
		if (!canvas) return;
		chart?.destroy();
		chart = null;
		panel = null;
		if (!resultado.series.length) return;
		let config: any;
		if (t === 'linea') config = configLinea();
		else if (!s) return;
		else if (t === 'flechas') config = configFlechas(s);
		else config = configVelas(s);
		config.plugins = [lineasReferencia, puntasFlecha];
		chart = new Chart(canvas, config);
	});

	onDestroy(() => chart?.destroy());

	function elegirTipo(t: Tipo) {
		tipo = t;
		guardar(CLAVE_TIPO, t);
	}
	function elegirPeriodo(p: Periodo) {
		periodo = p;
		guardar(CLAVE_PERIODO, p);
	}
</script>

<div class="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm flex flex-col mb-8">
	<div class="flex flex-wrap items-start justify-between gap-3 mb-3">
		<div class="min-w-0">
			<h3 class="font-bold text-brand-marine text-sm mb-1">Trayectoria de Saldo — Cuentas Bancarias</h3>
			<p class="text-[11px] text-slate-400">
				{#if tipo === 'linea'}
					Una línea por cuenta bancaria: arranca en su saldo inicial y avanza con cada transacción que la use como origen o destino.
					<span class="whitespace-nowrap"><span class="font-bold text-slate-500">◇</span> saldo inicial · <span class="font-bold text-slate-500">●</span> saldo actual</span>
				{:else if tipo === 'flechas'}
					Cada transacción es una flecha: <span class="font-semibold text-green-600">verde ↑ ingreso</span>, <span class="font-semibold text-red-600">roja ↓ egreso</span>, del saldo anterior al nuevo. Pasa el mouse para ver el detalle.
				{:else}
					Cada vela es un período: abre con el saldo al inicio, cierra con el del final y la mecha marca el máximo y el mínimo. Pasa el mouse para ver sus transacciones (clic para fijar el panel).
				{/if}
			</p>
		</div>
		<div class="inline-flex flex-wrap rounded-xl border border-slate-200 bg-slate-50 p-0.5 text-xs font-semibold">
			{#each TIPOS as t (t.id)}
				<button
					type="button"
					onclick={() => elegirTipo(t.id)}
					class="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 transition {tipo === t.id ? 'bg-white text-brand-marine shadow-sm' : 'text-slate-500 hover:text-slate-700'}"
				>
					<i class="fas {t.icono}"></i>
					{t.label}
				</button>
			{/each}
		</div>
	</div>

	{#if cuentas.length}
		<div class="flex flex-wrap items-end gap-3 mb-3">
			<label class="flex flex-col gap-1 min-w-0 max-w-full">
				<span class="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Cuenta bancaria</span>
				{#if tipo === 'linea'}
					<select bind:value={cuentaLinea} class="max-w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20">
						<option value="">Todas las cuentas ({cuentas.length})</option>
						{#each cuentas as c (c.id)}
							<option value={c.id}>{c.label} ({c.movimientos?.length ?? 0} mov.)</option>
						{/each}
					</select>
				{:else}
					<select bind:value={cuentaId} class="max-w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20">
						{#each cuentas as c (c.id)}
							<option value={c.id}>{c.label} ({c.movimientos?.length ?? 0} mov.)</option>
						{/each}
					</select>
				{/if}
			</label>
			<div class="flex flex-col gap-1">
				<span class="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Rango de fechas</span>
				<div class="flex flex-wrap items-center gap-1.5">
					<input type="date" bind:value={desde} max={hasta || undefined} aria-label="Desde" class="rounded-xl border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20" />
					<span class="text-xs text-slate-400">a</span>
					<input type="date" bind:value={hasta} min={desde || undefined} aria-label="Hasta" class="rounded-xl border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20" />
					<div class="inline-flex rounded-xl border border-slate-200 bg-slate-50 p-0.5 text-xs font-semibold">
						<button type="button" onclick={() => presetRango(30)} class="rounded-lg px-2 py-1 text-slate-500 hover:bg-white hover:text-slate-700">30 días</button>
						<button type="button" onclick={() => presetRango(90)} class="rounded-lg px-2 py-1 text-slate-500 hover:bg-white hover:text-slate-700">3 meses</button>
						<button type="button" onclick={() => presetRango('anio')} class="rounded-lg px-2 py-1 text-slate-500 hover:bg-white hover:text-slate-700">Este año</button>
						<button type="button" onclick={() => presetRango(null)} class="rounded-lg px-2 py-1 {hayRango ? 'text-slate-500 hover:bg-white hover:text-slate-700' : 'bg-white text-brand-marine shadow-sm'}">Todo</button>
					</div>
				</div>
			</div>
			{#if tipo === 'velas'}
				<div class="flex flex-col gap-1">
					<span class="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Período de cada vela</span>
					<div class="inline-flex flex-wrap rounded-xl border border-slate-200 bg-slate-50 p-0.5 text-xs font-semibold">
						{#each PERIODOS as p (p.id)}
							<button
								type="button"
								onclick={() => elegirPeriodo(p.id)}
								class="rounded-lg px-3 py-1.5 transition {periodo === p.id ? 'bg-white text-brand-marine shadow-sm' : 'text-slate-500 hover:text-slate-700'}"
							>
								{p.label}
							</button>
						{/each}
					</div>
				</div>
			{/if}
		</div>

		{#if serie && tipo !== 'linea'}
			{@const variacion = (serie.saldoActual ?? 0) - (serie.saldoInicial ?? 0)}
			<div class="grid grid-cols-2 lg:grid-cols-4 gap-2 mb-3">
				<div class="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
					<p class="text-[10px] font-bold uppercase tracking-wider text-slate-500"><span class="text-slate-400">◇</span> Saldo inicial</p>
					<p class="text-base font-bold text-slate-700">{dinero(serie.saldoInicial ?? 0, serie.moneda)}</p>
					<p class="text-[11px] text-slate-400">{serie.desdeCorte ? 'Punto de corte' : 'Apertura'}: {fecha(serie.desdeCorte ? serie.fechaInicial : serie.fechaApertura ?? undefined)}</p>
					{#if serie.movsAntesApertura}
						<p class="text-[11px] font-semibold text-amber-600" title="Sí suman en el saldo actual, pero su fecha es anterior a la fecha de apertura. Revisa la fecha de apertura en Cuentas Bancarias.">
							⚠ {serie.movsAntesApertura} transacci{serie.movsAntesApertura === 1 ? 'ón' : 'ones'} antes de la apertura
						</p>
					{/if}
				</div>
				<div class="rounded-xl border border-blue-200 bg-blue-50 px-3 py-2">
					<p class="text-[10px] font-bold uppercase tracking-wider text-blue-700"><span>●</span> Saldo actual</p>
					<p class="text-base font-bold text-blue-700">{dinero(serie.saldoActual ?? 0, serie.moneda)}</p>
					<p class="text-[11px] text-blue-400">Con todas las transacciones registradas</p>
				</div>
				<div class="rounded-xl border border-slate-200 px-3 py-2">
					<p class="text-[10px] font-bold uppercase tracking-wider text-slate-500">Variación</p>
					<p class="text-base font-bold {variacion >= 0 ? 'text-green-600' : 'text-red-600'}">{conSigno(variacion, serie.moneda)}</p>
				</div>
				<div class="rounded-xl border border-slate-200 px-3 py-2">
					<p class="text-[10px] font-bold uppercase tracking-wider text-slate-500">Movimientos</p>
					<p class="text-base font-bold text-slate-700">{hayRango ? `${movsRango.length} de ${serie.movimientos?.length ?? 0}` : (serie.movimientos?.length ?? 0)}</p>
					{#if hayRango}<p class="text-[11px] text-slate-400">en el rango elegido</p>{/if}
				</div>
			</div>
		{/if}
	{/if}

	<div bind:this={contenedor} class="relative h-96" onmouseleave={() => { if (!panel?.fijo) panel = null; }} role="presentation">
		{#if !cuentas.length}
			<p class="text-xs text-slate-300 flex items-center justify-center h-full">Sin cuentas bancarias registradas todavía.</p>
		{:else if tipo !== 'linea' && serie && !(serie.movimientos?.length)}
			<p class="text-xs text-slate-400 flex items-center justify-center h-full">Esta cuenta todavía no tiene transacciones: su saldo sigue en el inicial.</p>
		{:else if tipo !== 'linea' && serie && !movsRango.length}
			<p class="text-xs text-slate-400 flex items-center justify-center h-full">Esta cuenta no tiene transacciones en el rango de fechas elegido.</p>
		{/if}
		<canvas bind:this={canvas} class={tipo !== 'linea' && serie && !movsRango.length ? 'hidden' : ''}></canvas>

		{#if tipo === 'velas' && panel && velaPanel && serie}
			<div
				class="absolute z-20 rounded-xl border border-slate-200 bg-white/95 shadow-xl backdrop-blur-sm text-xs {panel.fijo ? '' : 'pointer-events-none'}"
				style={posPanel}
			>
				<div class="flex items-center justify-between gap-2 border-b border-slate-100 px-3 py-2">
					<p class="font-bold text-brand-marine">{velaPanel.label} · {velaPanel.movs.length} transacci{velaPanel.movs.length === 1 ? 'ón' : 'ones'}</p>
					{#if panel.fijo}
						<button type="button" onclick={() => (panel = null)} class="text-slate-400 hover:text-slate-600" aria-label="Cerrar"><i class="fas fa-times"></i></button>
					{:else}
						<span class="text-[10px] text-slate-400">clic para fijar</span>
					{/if}
				</div>
				<div class="grid grid-cols-4 gap-1 px-3 py-2 text-[10px] text-slate-500 border-b border-slate-100">
					<div>Abrió<br /><span class="font-semibold text-slate-700">{dinero(velaPanel.o, serie.moneda)}</span></div>
					<div>Máx.<br /><span class="font-semibold text-slate-700">{dinero(velaPanel.h, serie.moneda)}</span></div>
					<div>Mín.<br /><span class="font-semibold text-slate-700">{dinero(velaPanel.l, serie.moneda)}</span></div>
					<div>Cerró<br /><span class="font-semibold {velaPanel.c >= velaPanel.o ? 'text-green-600' : 'text-red-600'}">{dinero(velaPanel.c, serie.moneda)}</span></div>
				</div>
				<ul class="max-h-56 overflow-y-auto divide-y divide-slate-100">
					{#each velaPanel.movs as m (m.id_transaccion)}
						<li class="px-3 py-1.5">
							<div class="flex items-center justify-between gap-2">
								<span class="text-slate-500">{fecha(m.fecha)}{m.tipo ? ` · ${m.tipo}` : ''}</span>
								<span class="font-bold {m.delta > 0 ? 'text-green-600' : 'text-red-600'}">{m.delta > 0 ? '↑' : '↓'} {conSigno(m.delta, serie.moneda)}</span>
							</div>
							{#if m.descripcion}<p class="text-slate-600 truncate" title={m.descripcion}>{m.descripcion}</p>{/if}
							<p class="text-[10px] text-slate-400">#{m.id_transaccion}{m.num_operacion ? ` · Op. ${m.num_operacion}` : ''} · saldo {dinero(m.saldoDespues, serie.moneda)}</p>
						</li>
					{/each}
				</ul>
			</div>
		{/if}
	</div>

	{#if tipo === 'linea' && cuentas.length}
		<div class="mt-3 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-x-4 gap-y-1 text-[11px]">
			{#each seriesLinea as c (c.id)}
				{@const i = cuentas.indexOf(c)}
				{@const fApertura = c.desdeCorte ? c.fechaInicial : c.fechaApertura ?? undefined}
				<div class="flex items-center gap-2 min-w-0 border-b border-slate-50 py-1">
					<span class="h-2.5 w-2.5 shrink-0 rounded-full" style="background:{PALETA[i % PALETA.length]}"></span>
					<span class="truncate text-slate-600 flex-1" title={c.label}>{c.label}</span>
					{#if c.movsAntesApertura}
						<span class="shrink-0 font-bold text-amber-600" title="{c.movsAntesApertura} transacción(es) con fecha anterior a la apertura ({fecha(fApertura)}). Sí suman en el saldo; revisa la fecha de apertura.">⚠ {c.movsAntesApertura}</span>
					{/if}
					<span class="shrink-0 text-slate-400" title="Saldo inicial · {c.desdeCorte ? 'punto de corte' : 'apertura'} {fecha(fApertura)}">◇ {dinero(c.saldoInicial ?? 0, c.moneda)} <span class="text-slate-300">({fecha(fApertura)})</span></span>
					<span class="shrink-0 font-bold text-blue-700" title="Saldo actual">● {dinero(c.saldoActual ?? 0, c.moneda)}</span>
				</div>
			{/each}
		</div>
	{/if}
</div>
