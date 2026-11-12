// Suite de PUNTA A PUNTA de Control Financiero — ver Documentacion/tests/control-financiero.md.
// Corre contra el servidor MCP de DEV (nunca Producción): crea proyectos, cuentas bancarias, cuentas por cobrar/pagar
// y transacciones FICTICIAS (marcadas "E2E-CF") con las MISMAS funciones de servicio que la UI, y después de cada paso
// lee TODAS las pestañas de Control Financiero (cf_dashboard, cf_conciliacion, cf_consistencia_evaluar, cf_igv,
// cf_incidencias) y las compara contra el valor esperado calculado a mano.
// Uso: cd app && npm run test:negocio:control-financiero
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const child = spawn(process.execPath, ['--env-file=.env.dev', '--import', './scripts/register-lib-resolver.mjs', '--experimental-strip-types', 'mcp-server/index.ts'], { cwd: APP, stdio: ['pipe', 'pipe', 'pipe'] });
let buf = '';
const waiters = new Map();
child.stdout.on('data', (d) => {
	buf += d;
	let i;
	while ((i = buf.indexOf('\n')) >= 0) {
		const line = buf.slice(0, i);
		buf = buf.slice(i + 1);
		if (!line.trim()) continue;
		const m = JSON.parse(line);
		if (m.id && waiters.has(m.id)) waiters.get(m.id)(m);
	}
});
let srvErr = '';
child.stderr.on('data', (d) => (srvErr += d));
let n = 0;
const rpc = (method, params) => new Promise((res) => { const id = ++n; waiters.set(id, res); child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); });
await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'e2e-cf', version: '1' } });
child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
await new Promise((r) => setTimeout(r, 300));
if (!srvErr.includes('(dev)')) {
	console.error('El servidor MCP no arrancó contra DEV — abortando por seguridad.\n' + srvErr);
	process.exit(1);
}

/** Llama una herramienta; si falla LANZA (para pasos que deben funcionar). */
async function call(name, args = {}) {
	const r = await rpc('tools/call', { name, arguments: args });
	const txt = r.result?.content?.[0]?.text ?? JSON.stringify(r.error ?? '');
	if (r.result?.isError || r.error) throw new Error(`${name}: ${txt}`);
	try { return JSON.parse(txt); } catch { return txt; }
}
/** Llama una herramienta que PUEDE fallar (para probar bloqueos). */
async function intentar(name, args = {}) {
	try { return { ok: true, data: await call(name, args) }; } catch (e) { return { ok: false, error: e.message }; }
}

// ───────────── resultados ─────────────
const results = [];
let pasoActual = '';
const rec = (titulo, pass, detalle = '') => {
	results.push({ paso: pasoActual, titulo, pass, detalle });
	console.log(`${pass === true ? 'PASS' : pass === false ? 'FAIL' : 'INFO'} [${pasoActual}] ${titulo}${detalle ? ' :: ' + detalle : ''}`);
};
const r2 = (x) => Math.round(Number(x) * 100) / 100;
const eq = (titulo, actual, esperado, tol = 0.011) => rec(titulo, actual !== undefined && actual !== null && Math.abs(Number(actual) - Number(esperado)) <= tol, `esperado ${r2(esperado)}, obtenido ${actual === undefined || actual === null ? actual : r2(actual)}`);
const is = (titulo, actual, esperado) => rec(titulo, actual === esperado, `esperado ${JSON.stringify(esperado)}, obtenido ${JSON.stringify(actual)}`);
const paso = (t) => { pasoActual = t; console.log(`\n=== ${t} ===`); };

// ───────────── fechas ─────────────
const fechaLima = (d) => d.toLocaleDateString('en-CA', { timeZone: 'America/Lima' });
const HOY = fechaLima(new Date());
const AYER = fechaLima(new Date(Date.now() - 86400000));
const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
const etiqueta = (iso) => `${MESES[Number(iso.slice(5, 7)) - 1]} ${iso.slice(2, 4)}`;
const [anioHoy, mesHoy] = HOY.split('-').map(Number);
const finMes = (offset) => { const d = new Date(anioHoy, mesHoy - 1 + offset + 1, 0); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const VENC_1 = finMes(1); // fin del mes siguiente (dentro de la proyección de 6 meses)
const VENC_2 = finMes(2);
const ET_HOY = etiqueta(HOY), ET_V1 = etiqueta(VENC_1), ET_V2 = etiqueta(VENC_2);
const MARCA = `E2E-CF-${Date.now().toString(36)}`;

// ───────────── foto de TODAS las pestañas ─────────────
async function snap() {
	const [dash, conc, cons, igv, inc, cuentas, saldosCC] = await Promise.all([
		call('cf_dashboard', { trayectoria_completa: false }),
		call('cf_conciliacion', { limite_historial: 5 }),
		call('cf_consistencia_evaluar'),
		call('cf_igv', {}),
		call('cf_incidencias', {}),
		call('listar_cuentas_bancarias'),
		call('saldos_centros_costo')
	]);
	const S = { dash, conc, cons, igv, inc, cuentas, saldosCC };
	S.form = (id) => saldosCC.find((c) => c.id_centro_costo === Number(id))?.saldo_formulario;
	S.lista = (id) => saldosCC.find((c) => c.id_centro_costo === Number(id))?.monto_actual_lista;
	S.bancoSoles = (num) => conc.cuentas_bancarias.find((c) => c.id === num)?.monto;
	S.centro = (id) => conc.centros_de_costo.find((c) => c.id === String(id))?.monto;
	// Saldo de la cuenta en SU moneda (en dólares para la cuenta USD); bancoSoles = su equivalente en soles para el cuadre.
	S.banco = (num) => { const c = conc.cuentas_bancarias.find((x) => x.id === num); return c ? (c.saldo_moneda ?? c.monto) : undefined; };
	S.bancoLista = (num) => cuentas.find((c) => c.numero_cuenta === num)?.saldo_actual;
	S.rend = (id) => dash.rendimiento.items.find((i) => i.id_centro_costo === id);
	S.nodo = (id) => dash.flujo_nodos.nodos.find((x) => x.id === id);
	S.trayC = (id) => dash.trayectoria_centros.series.find((s) => s.id === String(id))?.saldo_final;
	S.trayB = (num) => dash.trayectoria_cuentas.series.find((s) => s.id === num)?.saldo_final;
	S.chk = (id) => cons.resultado.find((r) => r.id === id);
	S.serieIng = () => dash.serie_mensual.ingresos[dash.serie_mensual.labels.indexOf(ET_HOY)];
	S.serieEgr = () => dash.serie_mensual.egresos[dash.serie_mensual.labels.indexOf(ET_HOY)];
	S.proyIng = (et) => dash.proyeccion.ingresosProyectados[dash.proyeccion.labels.indexOf(et)];
	S.proyEgr = (et) => dash.proyeccion.egresosProyectados[dash.proyeccion.labels.indexOf(et)];
	return S;
}

// ───────────── modelo esperado ─────────────
// Saldos esperados de lo que crea ESTA suite (empiezan en 0) + deltas esperados de CORPORATIVO.
const M = { centros: {}, bancos: {}, corpDelta: 0 };
let BASE; // foto justo después del corte de partida
let ID = {};

/** Verificación común después de CADA paso: cada centro/cuenta de la suite dice lo mismo en todas las pestañas. */
function verificarModelo(S, { cuadre = 0 } = {}) {
	for (const [id, saldo] of Object.entries(M.centros)) {
		const nombre = Object.keys(ID).find((k) => ID[k] === Number(id)) ?? id;
		eq(`Conciliación: saldo centro ${nombre}`, S.centro(id), saldo);
		eq(`Dashboard/Rendimiento: flujo neto ${nombre} = su saldo`, S.rend(Number(id))?.flujoCajaNeto, saldo);
		const nodo = S.nodo(Number(id));
		if (nodo || saldo !== 0) eq(`Dashboard/Grafo: saldo nodo ${nombre}`, nodo?.saldo, saldo);
		const tray = S.trayC(id);
		if (tray !== undefined && tray !== null) eq(`Dashboard/Trayectoria: saldo final ${nombre}`, tray, saldo);
	}
	for (const [num, saldo] of Object.entries(M.bancos)) {
		eq(`Conciliación: saldo cuenta ${num}`, S.banco(num), saldo);
		eq(`Cuentas Bancarias: saldo_actual ${num}`, S.bancoLista(num), saldo);
		const tray = S.trayB(num);
		if (tray !== undefined && tray !== null) eq(`Dashboard/Trayectoria: saldo final cuenta ${num}`, tray, saldo);
	}
	eq('Conciliación: saldo CORPORATIVO (delta desde el inicio)', S.centro(ID.CORP) - BASE.centro(ID.CORP), M.corpDelta);
	// Una sola cifra en todo el sistema (también con punto de corte: CORPORATIVO tiene uno desde la preparación).
	for (const id of [...Object.keys(M.centros).map(Number), ID.CORP]) {
		const nombre = Object.keys(ID).find((k) => ID[k] === id) ?? id;
		eq(`Formulario de transacciones: "Saldo actual" ${nombre} = Control Financiero`, S.form(id), S.centro(id));
	}
	eq('Centros de Costo: "Monto Actual" de CORPORATIVO (con corte) = Control Financiero', S.lista(ID.CORP), S.centro(ID.CORP));
	eq('Cruce interno: diferencia Σ centros − Σ bancos', S.conc.cruce_interno.diferencia, cuadre);
	eq('Dashboard/Salud: misma diferencia que Conciliación', S.dash.salud_financiera.diferencia, S.conc.cruce_interno.diferencia);
	is('Consistencia: saldos bancarios = recálculo', S.chk('consistencia_saldos')?.estado, 'ok');
	is('Consistencia: integridad de pagos/cobros', S.chk('integridad_movimientos')?.estado, 'ok');
	is('Consistencia: cuadre centros vs bancos', S.chk('saldos_consistentes')?.estado, Math.abs(cuadre) <= 0.01 ? 'ok' : 'error');
}

const trx = (o, d, monto, extra = {}) => ({ tipo_alcance: 'externa', id_centro_costo_origen: o, id_centro_costo_destino: d, fecha: HOY, tipo: 'egreso', categoria: 'Servicios', tipo_moneda: 'soles', monto_total: monto, descripcion: `${MARCA}`, ...extra });
const idDe = (r) => r?.data?.id_transaccion ?? r?.data?.transaccion?.id_transaccion ?? r?.id_transaccion;

/** Anula TODA transacción activa que toque una cuenta bancaria de la suite (de esta corrida o de corridas
 * anteriores interrumpidas): sus saldos vuelven a 0 y Dev queda como antes. Anular (no borrar) también funciona con
 * las que respaldan un pago/cobro. */
async function limpiarE2E() {
	let total = 0;
	for (let vuelta = 0; vuelta < 20; vuelta++) {
		const lista = await call('listar_transacciones', { cuenta_contiene: 'E2E-CF-', estado: 'activo', limit: 200 });
		if (!lista.length) break;
		for (const t of lista) {
			await call('anular_transaccion', { id_transaccion: t.id_transaccion });
			total++;
		}
	}
	return total;
}

let corteInicial = null;
try {
	paso('Limpieza previa');
	rec('Transacciones de corridas anteriores anuladas', null, String(await limpiarE2E()));
	// ═════════════ 0. PREPARACIÓN: punto de corte de partida (deja Dev cuadrado) ═════════════
	paso('0 Preparación');
	const c0 = await call('cf_conciliacion', { limite_historial: 1 });
	const yaHayCorteAyer = c0.aperturas.some((a) => String(a.fecha_corte).slice(0, 10) === AYER);
	if (yaHayCorteAyer) throw new Error(`Ya existe un punto de corte en ${AYER} en Dev: elimínalo antes de correr la suite.`);
	const centrosCC = await call('listar_centros_costo', { limit: 500 });
	ID.CORP = centrosCC.find((c) => c.tipo === 'bolsa general' && c.estado === 'activo')?.id_centro_costo;
	ID.CLI1 = centrosCC.find((c) => c.tipo === 'cliente' && c.id_cliente === 1)?.id_centro_costo;
	ID.CLI2 = centrosCC.find((c) => c.tipo === 'cliente' && c.id_cliente === 2)?.id_centro_costo;
	ID.PROV1 = centrosCC.find((c) => c.tipo === 'proveedor' && c.id_proveedor === 1)?.id_centro_costo;
	if (!ID.CORP || !ID.CLI1 || !ID.CLI2 || !ID.PROV1) throw new Error('Faltan centros base en Dev (CORPORATIVO / cliente 1 y 2 / proveedor 1): correr npm run seed:dev.');
	const sumaBancos = r2(c0.cuentas_bancarias.reduce((s, c) => s + c.monto, 0));
	const ctas = await call('listar_cuentas_bancarias');
	corteInicial = AYER;
	await call('cf_crear_corte', {
		fecha_corte: AYER,
		fuente: 'otro',
		observaciones: `${MARCA} corte de partida de la suite (se elimina al final)`,
		cuentas: ctas.map((c) => ({ id_cuenta_banco: c.id_cuenta_banco, monto: Number(c.saldo_actual) })),
		centros: c0.centros_de_costo.map((c) => ({ id_centro_costo: Number(c.id), monto: Number(c.id) === ID.CORP ? sumaBancos : 0 }))
	});
	BASE = await snap();
	eq('Tras el corte de partida, Σ centros = Σ bancos', BASE.conc.cruce_interno.diferencia, 0);
	is('Tras el corte, chequeo de cuadre OK', BASE.chk('saldos_consistentes')?.estado, 'ok');
	is('Tras el corte, ningún saldo negativo', BASE.chk('saldos_negativos')?.estado, 'ok');
	eq('CORPORATIVO arranca con lo declarado en el corte', BASE.centro(ID.CORP), sumaBancos);

	// HALLAZGO esperado: el formulario de transacciones y el bloqueo de saldo ¿respetan el corte?
	{
		const r = await intentar('crear_transaccion', { payload: trx(ID.CORP, ID.PROV1, 1, { descripcion: `${MARCA} sondeo corte` }) });
		const nota = `Control Financiero dice que CORPORATIVO tiene ${r2(BASE.centro(ID.CORP))} tras el corte`;
		if (r.ok) {
			rec('Tras un corte, se puede gastar lo que el corte declaró en el centro', true, nota);
			await call('eliminar_transaccion', { id_transaccion: idDe(r.data) });
		} else rec('Tras un corte, se puede gastar lo que el corte declaró en el centro', false, `${nota}, pero el sistema bloquea: ${r.error.slice(0, 160)}`);
		const r2b = await intentar('crear_transaccion', { payload: trx(ID.CORP, ID.PROV1, r2(BASE.centro(ID.CORP) + 1), { descripcion: `${MARCA} sondeo corte` }) });
		rec('Tras un corte, NO se puede gastar más de lo declarado', !r2b.ok, r2b.ok ? 'se dejó gastar de más' : r2b.error.slice(0, 140));
		if (r2b.ok) await call('eliminar_transaccion', { id_transaccion: idDe(r2b.data) });
	}

	// Entidades de la suite
	const banco = async (sufijo, tipo_cuenta = 'corriente', tipo_moneda = 'soles') => {
		const num = `${MARCA}-${tipo_cuenta === 'efectivo' ? 'EFECTIVO-' : ''}${sufijo}`;
		await call('crear_cuenta_bancaria_prueba', { payload: { numero_cuenta: num, titular_cuenta: `${MARCA} ${sufijo}`, nombre_banco: 'BANCO E2E', tipo_cuenta, tipo_moneda, saldo_inicial: 0 } });
		M.bancos[num] = 0;
		return num;
	};
	const BAN = await banco('BAN');
	const CAJ = await banco('CAJ', 'efectivo');
	const CAJ2 = await banco('CAJ2', 'efectivo');
	const NEG = await banco('NEG');
	const USD = await banco('USD', 'corriente', 'dolares');
	const proy = async (k, tipo_venta, id_cliente, precio) => {
		const p = await call('crear_proyecto_prueba', { nombre: `${MARCA}_${k}`, id_cliente, tipo_venta, precio_venta: precio });
		ID[k] = p.id_centro_costo;
		ID[`P_${k}`] = p.id_proyecto;
		M.centros[p.id_centro_costo] = 0;
	};
	await proy('OBRA_A', 'obra', 1, 100000);
	await proy('OBRA_B', 'obra', 2, 50000);
	await proy('CONS_C', 'consultoria', 1, 20000);
	await call('cf_ejecutar_revision');
	let S = await snap();
	BASE = S;
	const GENERAL_BASE = S.dash.salud_financiera.estado_general;
	rec('Estado general de partida (Dev)', null, `${GENERAL_BASE} — ${S.cons.resultado.filter((r) => r.estado !== 'ok').map((r) => `${r.id}=${r.estado}`).join(', ') || 'todos los chequeos OK'}; incidencias abiertas ${S.inc.abiertas}; conciliaciones pendientes ${S.dash.salud_financiera.conciliaciones_pendientes}`);
	verificarModelo(S);
	rec('Proyectos nuevos aparecen en Rendimiento con 0', [ID.OBRA_A, ID.OBRA_B, ID.CONS_C].every((id) => S.rend(id)?.ingresos === 0 && S.rend(id)?.egresos === 0));

	// ═════════════ 1. Cuenta por cobrar fraccionada (Obra A) ═════════════
	paso('1 CxC Obra A 100 000 en 2 cuotas');
	const cxcA = (await call('crear_cuenta_cobrar', {
		payload: { id_cliente: 1, id_centro_costo: ID.OBRA_A, id_proyecto: ID.P_OBRA_A, monto: 100000, fecha_emision: HOY, fecha_vencimiento: VENC_2, observaciones: MARCA },
		fracciones: [{ fecha: HOY, monto: 30000 }, { fecha: VENC_2, monto: 70000 }]
	})).data;
	S = await snap();
	verificarModelo(S);
	eq(`Proyección: +100 000 por cobrar en ${ET_V2} (vencimiento de la cuenta)`, S.proyIng(ET_V2) - BASE.proyIng(ET_V2), 100000);

	// ═════════════ 2. Cobro de la 1ra cuota → ingreso a Obra A, entra a BAN ═════════════
	paso('2 Cobro cuota 1 (30 000) a BAN');
	const cuotasA = (await call('ver_cuenta_cobrar', { id_cuenta_cobrar: cxcA.id_cuenta_cobrar })).cobros;
	const rCobroA = await call('confirmar_cobro_cuota', { id_cobro: cuotasA[0].id_cobro, transaccion: trx(ID.CLI1, ID.OBRA_A, 30000, { tipo: 'ingreso', categoria: 'Adelanto', cuente_destino: BAN }) });
	M.centros[ID.OBRA_A] += 30000; M.bancos[BAN] += 30000;
	S = await snap();
	verificarModelo(S);
	eq('Rendimiento Obra A: ingresos', S.rend(ID.OBRA_A).ingresos, 30000);
	is('Rendimiento Obra A: autosuficiencia sin egresos = —', S.rend(ID.OBRA_A).autosuficiencia, null);
	eq('Resumen general: Ingresos totales +30 000', S.dash.resumen_general.totalIngresos - BASE.dash.resumen_general.totalIngresos, 30000);
	eq(`Flujo de caja ${ET_HOY}: ingresos +30 000`, S.serieIng() - BASE.serieIng(), 30000);
	eq(`Proyección ${ET_V2}: queda 70 000 por cobrar`, S.proyIng(ET_V2) - BASE.proyIng(ET_V2), 70000);
	{
		const aud = await call('auditar_cuentas_cobrar', { id_cuenta_cobrar: cxcA.id_cuenta_cobrar });
		rec('CxC Obra A sin inconsistencias', aud?.inconsistencias_encontradas === 0, JSON.stringify(aud).slice(0, 200));
	}

	// ═════════════ 3. CxC Obra B al contado, cobrada a CAJ ═════════════
	paso('3 CxC Obra B 50 000 cobrada completa a CAJ');
	const cxcB = (await call('crear_cuenta_cobrar', { payload: { id_cliente: 2, id_centro_costo: ID.OBRA_B, id_proyecto: ID.P_OBRA_B, monto: 50000, fecha_emision: HOY, fecha_vencimiento: VENC_1, observaciones: MARCA } })).data;
	const rCobroB = await call('registrar_cobro_cuenta_cobrar', { id_cuenta_cobrar: cxcB.id_cuenta_cobrar, transaccion: trx(ID.CLI2, ID.OBRA_B, 50000, { tipo: 'ingreso', categoria: 'Adelanto', cuente_destino: CAJ }) });
	let trxCobroB = idDe(rCobroB) ?? (await call('ver_cuenta_cobrar', { id_cuenta_cobrar: cxcB.id_cuenta_cobrar })).cobros.find((c) => c.estado_cobro === 'cobrado')?.id_transaccion;
	M.centros[ID.OBRA_B] += 50000; M.bancos[CAJ] += 50000;
	S = await snap();
	verificarModelo(S);
	is('CxC Obra B queda pagada', (await call('ver_cuenta_cobrar', { id_cuenta_cobrar: cxcB.id_cuenta_cobrar })).cuenta.estado, 'pagado');
	eq(`Proyección ${ET_V1}: la cuenta ya cobrada no suma`, S.proyIng(ET_V1) - BASE.proyIng(ET_V1), 0);

	// ═════════════ 4. CxP de Obra A y su pago desde BAN ═════════════
	paso('4 CxP proveedor 11 800 (Obra A) y su pago desde BAN');
	const cxpA = (await call('crear_cuenta_pagar', { payload: { id_proveedor: 1, id_centro_costo: ID.OBRA_A, monto_comprometido: 11800, fecha_emision: HOY, fecha_vencimiento: VENC_1, categoria_gasto: 60, observacion: MARCA } })).data;
	S = await snap();
	eq(`Proyección ${ET_V1}: +11 800 por pagar`, S.proyEgr(ET_V1) - BASE.proyEgr(ET_V1), 11800);
	const igv0 = BASE.igv.resumen;
	await call('registrar_pago_cuenta_pagar', { id_cuenta_pagar: cxpA.id_cuenta_pagar, transaccion: trx(ID.OBRA_A, ID.PROV1, 11800, { categoria: 'Compras', cuente_origen: BAN }) });
	M.centros[ID.OBRA_A] -= 11800; M.bancos[BAN] -= 11800;
	S = await snap();
	verificarModelo(S);
	eq('Rendimiento Obra A: egresos', S.rend(ID.OBRA_A).egresos, 11800);
	eq('Rendimiento Obra A: autosuficiencia 30 000 / 11 800', S.rend(ID.OBRA_A).autosuficiencia, (30000 / 11800) * 100, 0.01);
	{
		const conc = S.rend(ID.OBRA_A).concentracion;
		rec('Rendimiento Obra A: concentración = Compras (PCGE 60) 100%', conc.length === 1 && conc[0].categoria === 'Compras' && Math.abs(conc[0].pct - 100) < 0.01, JSON.stringify(conc));
	}
	eq('IGV del mes: base de compras +10 000', S.igv.resumen.comprasBase - igv0.comprasBase, 10000);
	eq('IGV del mes: crédito fiscal = 18% de la base', S.igv.resumen.creditoFiscalCompras, r2(S.igv.resumen.comprasBase * 0.18));
	eq('IGV estimado = IGV ventas − crédito fiscal', S.igv.resumen.igvEstimado, r2(S.igv.resumen.igvVentas - S.igv.resumen.creditoFiscalCompras));
	eq(`Proyección ${ET_V1}: la CxP pagada ya no suma`, S.proyEgr(ET_V1) - BASE.proyEgr(ET_V1), 0);
	eq('Resumen general: Egresos totales +11 800', S.dash.resumen_general.totalEgresos - BASE.dash.resumen_general.totalEgresos, 11800);
	eq('Gastos corporativos: un gasto de proyecto NO cuenta', S.dash.rendimiento.gastos_corporativos - BASE.dash.rendimiento.gastos_corporativos, 0);

	// ═════════════ 5. Transferencia INTERNA Obra A → CORPORATIVO (BAN → CAJ) ═════════════
	paso('5 Transferencia interna Obra A → CORPORATIVO 5 000');
	const rT = await call('crear_transaccion', { payload: trx(ID.OBRA_A, ID.CORP, 5000, { tipo: 'transferencia', tipo_alcance: 'interna', categoria: 'Inyecciones', cuente_origen: BAN, cuente_destino: CAJ }) });
	const trxT = idDe(rT);
	M.centros[ID.OBRA_A] -= 5000; M.corpDelta += 5000; M.bancos[BAN] -= 5000; M.bancos[CAJ] += 5000;
	S = await snap();
	verificarModelo(S);
	eq('Rendimiento Obra A: la transferencia cuenta como salida', S.rend(ID.OBRA_A).egresos, 16800);
	eq('Rendimiento CORPORATIVO: la transferencia cuenta como entrada', S.rend(ID.CORP).ingresos - BASE.rend(ID.CORP).ingresos, 5000);
	eq('Resumen general: una transferencia NO es ingreso de la empresa', S.dash.resumen_general.totalIngresos - BASE.dash.resumen_general.totalIngresos, 80000);
	eq('IGV: una transferencia interna no es compra', S.igv.resumen.comprasBase - igv0.comprasBase, 10000);
	rec('Grafo: arista Obra A → CORPORATIVO por 5 000', S.dash.flujo_nodos.aristas.some((a) => a.origen === ID.OBRA_A && a.destino === ID.CORP && Math.abs(a.monto - 5000) < 0.01));

	// ═════════════ 6. Egreso de CORPORATIVO (sin CxP) desde CAJ ═════════════
	paso('6 Egreso CORPORATIVO 2 000 (servicios) desde CAJ');
	const rE6 = await call('crear_transaccion', { payload: trx(ID.CORP, ID.PROV1, 2000, { cuente_origen: CAJ }) });
	M.corpDelta -= 2000; M.bancos[CAJ] -= 2000;
	S = await snap();
	verificarModelo(S);
	eq('Rendimiento CORPORATIVO: flujo neto = su saldo (+5 000 − 2 000)', S.rend(ID.CORP).flujoCajaNeto - BASE.rend(ID.CORP).flujoCajaNeto, 3000);
	eq('Gastos corporativos +2 000', S.dash.rendimiento.gastos_corporativos - BASE.dash.rendimiento.gastos_corporativos, 2000);
	eq('IGV: base de compras +2 000/1.18', S.igv.resumen.comprasBase - igv0.comprasBase, 10000 + r2(2000 / 1.18));

	// ═════════════ 7. Financiamiento a la consultoría C ═════════════
	paso('7 Financiamiento 8 000 a Consultoría C (a BAN)');
	await call('crear_transaccion', { payload: trx(ID.CLI1, ID.CONS_C, 8000, { tipo: 'financiamiento', categoria: 'Inyecciones', cuente_destino: BAN }) });
	M.centros[ID.CONS_C] += 8000; M.bancos[BAN] += 8000;
	S = await snap();
	verificarModelo(S);
	eq('Rendimiento Consultoría C: el financiamiento es entrada', S.rend(ID.CONS_C).ingresos, 8000);
	rec('Resumen general: el financiamiento NO suma a "Ingresos totales"', Math.abs(S.dash.resumen_general.totalIngresos - BASE.dash.resumen_general.totalIngresos - 80000) < 0.01 ? null : false, 'Solo tipo "ingreso" cuenta como ingreso de la empresa (un financiamiento es deuda/aporte, no venta)');

	// ═════════════ 8-9. EDITAR la transferencia: monto y cuenta destino ═════════════
	paso('8 Editar transferencia: 5 000 → 4 000');
	await call('editar_transaccion', { id_transaccion: trxT, cambios: { monto_total: 4000 } });
	M.centros[ID.OBRA_A] += 1000; M.corpDelta -= 1000; M.bancos[BAN] += 1000; M.bancos[CAJ] -= 1000;
	S = await snap();
	verificarModelo(S);
	paso('9 Editar transferencia: cuenta destino CAJ → CAJ2');
	await call('editar_transaccion', { id_transaccion: trxT, cambios: { cuente_destino: CAJ2 } });
	M.bancos[CAJ] -= 4000; M.bancos[CAJ2] += 4000;
	S = await snap();
	verificarModelo(S);
	{
		const r = await intentar('editar_transaccion', { id_transaccion: trxT, cambios: { monto_total: 99999999 } });
		rec('Editar: no deja subir la transferencia por encima del saldo del centro', !r.ok, r.ok ? 'se dejó' : r.error.slice(0, 140));
	}

	// ═════════════ 10. Posible duplicado ═════════════
	paso('10 Duplicado: mismo egreso CORPORATIVO otra vez');
	const rDup = await call('crear_transaccion', { payload: trx(ID.CORP, ID.PROV1, 2000, { cuente_origen: CAJ }) });
	M.corpDelta -= 2000; M.bancos[CAJ] -= 2000;
	S = await snap();
	verificarModelo(S);
	is('Consistencia: detecta el posible duplicado', S.chk('posibles_duplicados')?.estado, 'alerta');
	rec('El duplicado señalado incluye las dos transacciones', JSON.stringify(S.chk('posibles_duplicados')?.detalle?.grupos_duplicados ?? []).includes(String(idDe(rDup))) && JSON.stringify(S.chk('posibles_duplicados')?.detalle?.grupos_duplicados ?? []).includes(String(idDe(rE6))));
	await call('eliminar_transaccion', { id_transaccion: idDe(rDup) });
	M.corpDelta += 2000; M.bancos[CAJ] += 2000;
	S = await snap();
	verificarModelo(S);
	is('Al eliminar el duplicado, el chequeo vuelve a como estaba', S.chk('posibles_duplicados')?.estado, BASE.chk('posibles_duplicados')?.estado);

	// ═════════════ 11-12. ANULAR y REACTIVAR el cobro de Obra B ═════════════
	paso('11 Anular el cobro de Obra B (50 000)');
	await call('anular_transaccion', { id_transaccion: trxCobroB });
	M.centros[ID.OBRA_B] -= 50000; M.bancos[CAJ] -= 50000;
	S = await snap();
	verificarModelo(S);
	{
		const vb = await call('ver_cuenta_cobrar', { id_cuenta_cobrar: cxcB.id_cuenta_cobrar });
		rec('CxC Obra B vuelve a deber 50 000', vb.cuenta.estado !== 'pagado' && Math.abs(Number(vb.cuenta.saldo_pendiente) - 50000) < 0.01, `${vb.cuenta.estado} ${vb.cuenta.saldo_pendiente}`);
	}
	eq(`Proyección ${ET_V1}: vuelve a aparecer el cobro pendiente`, S.proyIng(ET_V1) - BASE.proyIng(ET_V1), 50000);
	is('Saldos negativos: CAJ quedó en negativo → ALERTA', S.chk('saldos_negativos')?.estado, M.bancos[CAJ] < 0 ? 'alerta' : 'ok');
	paso('12 Reactivar el cobro anulado');
	await call('reactivar_transaccion', { id_transaccion: trxCobroB });
	M.centros[ID.OBRA_B] += 50000; M.bancos[CAJ] += 50000;
	S = await snap();
	verificarModelo(S);
	{
		const vb = await call('ver_cuenta_cobrar', { id_cuenta_cobrar: cxcB.id_cuenta_cobrar });
		rec('Reactivar un cobro: la CxC vuelve a quedar pagada (no se cuenta dos veces)', vb.cuenta.estado === 'pagado', `estado ${vb.cuenta.estado}, saldo pendiente ${vb.cuenta.saldo_pendiente}`);
		eq(`Reactivar: la proyección ${ET_V1} ya no lo cuenta como por cobrar`, S.proyIng(ET_V1) - BASE.proyIng(ET_V1), 0);
		const aud = await call('auditar_cuentas_cobrar', { id_cuenta_cobrar: cxcB.id_cuenta_cobrar });
		rec('Reactivar: CxC Obra B sin inconsistencias', aud?.inconsistencias_encontradas === 0, JSON.stringify(aud?.inconsistencias ?? []).slice(0, 160));
		is('Reactivar: integridad de pagos/cobros OK', S.chk('integridad_movimientos')?.estado, 'ok');
	}
	paso('12b Reactivar una transacción cuyo cobro ya se registró de nuevo → bloqueado');
	{
		await call('anular_transaccion', { id_transaccion: trxCobroB });
		M.centros[ID.OBRA_B] -= 50000; M.bancos[CAJ] -= 50000;
		const viejo = trxCobroB;
		const cuota = (await call('ver_cuenta_cobrar', { id_cuenta_cobrar: cxcB.id_cuenta_cobrar })).cobros.find((c) => c.estado_cobro === 'programado');
		await call('confirmar_cobro_cuota', { id_cobro: cuota.id_cobro, transaccion: trx(ID.CLI2, ID.OBRA_B, 50000, { tipo: 'ingreso', categoria: 'Adelanto', cuente_destino: CAJ }) });
		M.centros[ID.OBRA_B] += 50000; M.bancos[CAJ] += 50000;
		trxCobroB = (await call('ver_cuenta_cobrar', { id_cuenta_cobrar: cxcB.id_cuenta_cobrar })).cobros.find((c) => c.estado_cobro === 'cobrado')?.id_transaccion;
		const r = await intentar('reactivar_transaccion', { id_transaccion: viejo });
		rec('No deja reactivar la transacción vieja (el cobro ya se registró con otra)', !r.ok, r.ok ? 'se reactivó: contaría 50 000 dos veces' : r.error.slice(0, 200));
		S = await snap();
		verificarModelo(S);
		is('CxC Obra B sigue pagada una sola vez', (await call('ver_cuenta_cobrar', { id_cuenta_cobrar: cxcB.id_cuenta_cobrar })).cuenta.estado, 'pagado');
	}
	paso('12c Anular y reactivar el PAGO de la CxP de Obra A');
	{
		const vp = await call('ver_cuenta_pagar', { id_cuenta_pagar: cxpA.id_cuenta_pagar });
		const trxPago = vp.pagos.find((p) => p.estado_pago === 'pagado')?.id_transaccion;
		await call('anular_transaccion', { id_transaccion: trxPago });
		M.centros[ID.OBRA_A] += 11800; M.bancos[BAN] += 11800;
		S = await snap();
		verificarModelo(S);
		const vp2 = await call('ver_cuenta_pagar', { id_cuenta_pagar: cxpA.id_cuenta_pagar });
		rec('Anular el pago: la CxP vuelve a deber 11 800', vp2.cuenta.estado !== 'pagado' && Math.abs(Number(vp2.cuenta.saldo_pendiente) - 11800) < 0.01, `${vp2.cuenta.estado} ${vp2.cuenta.saldo_pendiente}`);
		eq(`Anular el pago: la proyección ${ET_HOY} (fecha programada del pago) vuelve a mostrarlo pendiente`, S.proyEgr(ET_HOY) - BASE.proyEgr(ET_HOY), 11800);
		await call('reactivar_transaccion', { id_transaccion: trxPago });
		M.centros[ID.OBRA_A] -= 11800; M.bancos[BAN] -= 11800;
		S = await snap();
		verificarModelo(S);
		is('Reactivar el pago: la CxP vuelve a quedar pagada', (await call('ver_cuenta_pagar', { id_cuenta_pagar: cxpA.id_cuenta_pagar })).cuenta.estado, 'pagado');
		eq(`Reactivar el pago: la proyección ya no lo cuenta`, S.proyEgr(ET_HOY) - BASE.proyEgr(ET_HOY) + S.proyEgr(ET_V1) - BASE.proyEgr(ET_V1), 0);
		const aud = await call('auditar_cuentas_pagar', { id_cuenta_pagar: cxpA.id_cuenta_pagar });
		rec('Reactivar el pago: CxP sin inconsistencias', aud?.inconsistencias_encontradas === 0, JSON.stringify(aud?.inconsistencias ?? []).slice(0, 160));
	}

	// ═════════════ 13. Centro de costo en NEGATIVO (lo que reclamó la clienta) ═════════════
	paso('13 Centro de costo en negativo: se gasta un ingreso y luego se elimina el ingreso');
	const rIng = await call('crear_transaccion', { payload: trx(ID.CLI1, ID.OBRA_A, 3000, { tipo: 'ingreso', categoria: 'Valorización', cuente_destino: BAN }) });
	M.centros[ID.OBRA_A] += 3000; M.bancos[BAN] += 3000;
	const gastoA = r2(M.centros[ID.OBRA_A] - 200);
	await call('crear_transaccion', { payload: trx(ID.OBRA_A, ID.PROV1, gastoA, { categoria: 'Compras', cuente_origen: BAN }) });
	M.centros[ID.OBRA_A] -= gastoA; M.bancos[BAN] -= gastoA;
	S = await snap();
	verificarModelo(S);
	eq('Obra A queda con 200', S.centro(ID.OBRA_A), 200);
	{
		const r = await intentar('eliminar_transaccion', { id_transaccion: idDe(rIng) });
		rec('El sistema deja eliminar un ingreso que ya se gastó', r.ok ? null : true, r.ok ? 'se permite (sin guarda) — por eso hace falta la alerta' : r.error.slice(0, 120));
		if (r.ok) { M.centros[ID.OBRA_A] -= 3000; M.bancos[BAN] -= 3000; }
	}
	S = await snap();
	verificarModelo(S);
	is('Consistencia: SALDOS NEGATIVOS = error', S.chk('saldos_negativos')?.estado, 'error');
	rec('El mensaje nombra el centro en negativo con su saldo', (S.chk('saldos_negativos')?.mensaje ?? '').includes('-2800.00'), S.chk('saldos_negativos')?.mensaje);
	await call('cf_ejecutar_revision');
	S = await snap();
	is('Dashboard: "Ejecutar revisión" deja el estado general en ERROR', S.dash.salud_financiera.estado_general, 'error');
	rec('Dashboard: la última revisión cuenta al menos 1 control en error', (S.dash.salud_financiera.ultima_revision?.controles_error ?? 0) >= 1, JSON.stringify(S.dash.salud_financiera.ultima_revision));
	{
		const ult = await call('cf_consistencia_ultima');
		is('Consistencia (revisión guardada): saldos negativos en error', ult.resultado.find((r) => r.id === 'saldos_negativos')?.estado, 'error');
	}
	await call('crear_transaccion', { payload: trx(ID.CLI1, ID.OBRA_A, 3000, { tipo: 'ingreso', categoria: 'Valorización', cuente_destino: BAN }) });
	M.centros[ID.OBRA_A] += 3000; M.bancos[BAN] += 3000;
	await call('cf_ejecutar_revision');
	S = await snap();
	verificarModelo(S);
	is('Al reponer el ingreso, saldos negativos vuelve a como estaba', S.chk('saldos_negativos')?.estado, BASE.chk('saldos_negativos')?.estado);

	// ═════════════ 14. Cuenta bancaria en negativo (permitido, pero con alerta) ═════════════
	paso('14 Cuenta bancaria en negativo');
	const rNeg = await call('crear_transaccion', { payload: trx(ID.CORP, ID.PROV1, 100, { cuente_origen: NEG }) });
	M.corpDelta -= 100; M.bancos[NEG] -= 100;
	S = await snap();
	verificarModelo(S);
	is('Saldos negativos: cuenta bancaria <0 → ALERTA (no error)', S.chk('saldos_negativos')?.estado, 'alerta');
	await call('cf_ejecutar_revision');
	S = await snap();
	if (GENERAL_BASE === 'ok') is('Dashboard: estado general en ALERTA', S.dash.salud_financiera.estado_general, 'alerta');
	else rec('Dashboard: estado general con la alerta', S.dash.salud_financiera.estado_general !== 'ok', `${S.dash.salud_financiera.estado_general} (Dev ya partía en ${GENERAL_BASE})`);
	await call('eliminar_transaccion', { id_transaccion: idDe(rNeg) });
	M.corpDelta += 100; M.bancos[NEG] += 100;
	await call('cf_ejecutar_revision');
	S = await snap();
	verificarModelo(S);
	is('Sin negativos, el estado general vuelve al de partida', S.dash.salud_financiera.estado_general, GENERAL_BASE);

	// ═════════════ 15. Dólares ═════════════
	paso('15a Ingreso en dólares ($100 a 3.75) a la cuenta en dólares');
	const igv15 = (await snap()).igv.resumen;
	const totIng15 = (await call('cf_dashboard', {})).resumen_general.totalIngresos;
	const rUsd = await call('crear_transaccion', { payload: trx(ID.CLI1, ID.CONS_C, 100, { tipo: 'ingreso', categoria: 'Abonos', tipo_moneda: 'dolares', tipo_cambio: 3.75, cuente_destino: USD }) });
	M.centros[ID.CONS_C] += 375; M.bancos[USD] += 100;
	S = await snap();
	verificarModelo(S);
	eq('Cuenta en dólares: sube US$ 100', S.banco(USD), 100);
	eq('Cuadre: la cuenta en dólares vale S/ 375 en el consolidado', S.bancoSoles(USD), 375);
	eq('Resumen general: el ingreso cuenta S/ 375', S.dash.resumen_general.totalIngresos - totIng15, 375);

	paso('15b Transferencia interna en SOLES (S/ 375) de BAN a la cuenta en dólares, TC 3.75');
	{
		const sinTc = await intentar('crear_transaccion', { payload: trx(ID.CONS_C, ID.CORP, 375, { tipo: 'transferencia', tipo_alcance: 'interna', categoria: 'Inyecciones', cuente_origen: BAN, cuente_destino: USD }) });
		rec('Sin tipo de cambio, el sistema NO deja mover soles a una cuenta en dólares', !sinTc.ok, sinTc.ok ? 'se dejó' : sinTc.error.slice(0, 140));
		if (sinTc.ok) await call('eliminar_transaccion', { id_transaccion: idDe(sinTc.data) });
	}
	const rT15 = await call('crear_transaccion', { payload: trx(ID.CONS_C, ID.CORP, 375, { tipo: 'transferencia', tipo_alcance: 'interna', categoria: 'Inyecciones', tipo_cambio: 3.75, cuente_origen: BAN, cuente_destino: USD }) });
	M.centros[ID.CONS_C] -= 375; M.corpDelta += 375; M.bancos[BAN] -= 375; M.bancos[USD] += 100;
	S = await snap();
	verificarModelo(S);
	eq('Cuenta en dólares: recibe US$ 100 (375 ÷ 3.75)', S.banco(USD), 200);
	eq('Cuadre: la cuenta en dólares vale S/ 750', S.bancoSoles(USD), 750);

	paso('15c Egreso en dólares (US$ 50 a 3.80) desde la cuenta en dólares');
	const rE15 = await call('crear_transaccion', { payload: trx(ID.CORP, ID.PROV1, 50, { tipo_moneda: 'dolares', tipo_cambio: 3.8, cuente_origen: USD }) });
	M.corpDelta -= 190; M.bancos[USD] -= 50;
	S = await snap();
	verificarModelo(S);
	eq('Cuenta en dólares: baja US$ 50', S.banco(USD), 150);
	eq('Cuadre: la cuenta en dólares vale S/ 560 (750 − 190)', S.bancoSoles(USD), 560);
	eq('IGV: la compra en dólares entra como S/ 190 / 1.18', S.igv.resumen.comprasBase - igv15.comprasBase, r2(190 / 1.18));

	paso('15d Editar el ingreso en dólares: US$ 100 → 120');
	await call('editar_transaccion', { id_transaccion: idDe(rUsd), cambios: { monto_total: 120, comprobante_url: 'https://e2e.invalid/comprobante.pdf' } });
	M.centros[ID.CONS_C] += 75; M.bancos[USD] += 20;
	S = await snap();
	verificarModelo(S);
	{
		const t = (await call('listar_transacciones', { cuenta_contiene: USD.slice(-14), limit: 20 })).find((x) => x.id_transaccion === idDe(rUsd));
		rec('Al editar, el monto en soles se recalcula solo (120 × 3.75 = 450)', t && Math.abs(Number(t.monto_total) * Number(t.tipo_cambio) - 450) < 0.01, JSON.stringify(t ?? {}).slice(0, 160));
	}

	for (const id of [idDe(rE15), idDe(rT15), idDe(rUsd)]) await call('eliminar_transaccion', { id_transaccion: id });
	M.centros[ID.CONS_C] -= 450 - 375; M.corpDelta += 190 - 375; M.bancos[BAN] += 375; M.bancos[USD] = 0;
	S = await snap();
	verificarModelo(S);

	// ═════════════ 16. Punto de corte: movimiento el MISMO día del corte ═════════════
	paso('16 Corte hoy y un ingreso el mismo día');
	await call('cf_crear_corte', { fecha_corte: HOY, fuente: 'otro', observaciones: `${MARCA} corte del día`, cuentas: [], centros: [{ id_centro_costo: ID.OBRA_A, monto: M.centros[ID.OBRA_A] }] });
	const rMismoDia = await call('crear_transaccion', { payload: trx(ID.CLI1, ID.OBRA_A, 1000, { tipo: 'ingreso', categoria: 'Valorización', cuente_destino: BAN }) });
	S = await snap();
	{
		const cf = S.centro(ID.OBRA_A), rend = S.rend(ID.OBRA_A).flujoCajaNeto;
		rec('Ingreso del mismo día del corte: Control Financiero lo ignora (regla "solo después del corte")', Math.abs(cf - M.centros[ID.OBRA_A]) < 0.01 ? null : false, `Conciliación ${r2(cf)} vs Rendimiento/Centros de Costo ${r2(rend)}; la cuenta BAN sí lo suma (${r2(S.banco(BAN) - M.bancos[BAN])}) → el cuadre se descuadra en ${r2(S.conc.cruce_interno.diferencia)}`);
	}
	await call('cf_eliminar_corte', { fecha_corte: HOY });
	await call('eliminar_transaccion', { id_transaccion: idDe(rMismoDia) });
	S = await snap();
	verificarModelo(S);

	// ═════════════ 17. Corte DESCUADRADO → conciliación interna con incidencia ═════════════
	paso('17 Corte descuadrado + conciliación interna');
	const incAntes = S.inc.abiertas;
	const idBAN = (await call('listar_cuentas_bancarias')).find((c) => c.numero_cuenta === BAN).id_cuenta_banco;
	await call('cf_crear_corte', { fecha_corte: HOY, fuente: 'otro', observaciones: `${MARCA} corte descuadrado`, cuentas: [{ id_cuenta_banco: idBAN, monto: M.bancos[BAN] + 1000 }], centros: [] });
	S = await snap();
	eq('Cruce interno: diferencia −1 000', S.conc.cruce_interno.diferencia, -1000);
	is('Consistencia: cuadre en ERROR', S.chk('saldos_consistentes')?.estado, 'error');
	const conc17 = await call('cf_registrar_conciliacion_interna');
	is('Conciliación interna registrada con diferencia', conc17.data?.estado, 'con_diferencia');
	S = await snap();
	eq('Incidencias: +1 abierta', S.inc.abiertas - incAntes, 1);
	is('Incidencia de 1 000 = severidad alta', S.inc.items.find((i) => i.id_incidencia === conc17.data?.id_incidencia)?.severidad, 'alta');
	eq('Dashboard: conciliaciones pendientes cuenta la nueva', S.dash.salud_financiera.conciliaciones_pendientes - BASE.dash.salud_financiera.conciliaciones_pendientes, 1);
	is('Dashboard: con una incidencia abierta el estado general es ERROR', S.dash.salud_financiera.estado_general, 'error');
	await call('cf_eliminar_corte', { fecha_corte: HOY });
	await call('cf_resolver_y_cerrar_incidencia', { id_incidencia: conc17.data.id_incidencia, comentario: `${MARCA} prueba` });
	S = await snap();
	verificarModelo(S);
	eq('Incidencia cerrada: abiertas vuelve a como estaba', S.inc.abiertas, incAntes);

	// ═════════════ 18. Conciliación bancaria manual ═════════════
	paso('18 Conciliación bancaria manual de BAN');
	const okManual = await call('cf_registrar_conciliacion_banco', { monto_banco: M.bancos[BAN], numero_cuenta: BAN });
	is('Monto igual al ERP → cuadrada, sin incidencia', `${okManual.data?.estado}/${okManual.data?.id_incidencia}`, 'cuadrada/null');
	const malManual = await call('cf_registrar_conciliacion_banco', { monto_banco: M.bancos[BAN] - 200, numero_cuenta: BAN });
	is('200 de diferencia → con_diferencia', malManual.data?.estado, 'con_diferencia');
	S = await snap();
	is('Incidencia de 200 = severidad media', S.inc.items.find((i) => i.id_incidencia === malManual.data?.id_incidencia)?.severidad, 'media');
	await call('cf_resolver_y_cerrar_incidencia', { id_incidencia: malManual.data.id_incidencia, comentario: `${MARCA} prueba` });

	// ═════════════ 19. Totales finales ═════════════
	paso('19 Totales del día');
	S = await snap();
	verificarModelo(S);
	eq('IGV: base de compras total del día', S.igv.resumen.comprasBase - igv0.comprasBase, 10000 + r2(2000 / 1.18) + r2(gastoA / 1.18), 0.03);
	eq('Resumen: ingresos de la empresa (30 000 + 50 000 + 3 000)', S.dash.resumen_general.totalIngresos - BASE.dash.resumen_general.totalIngresos, 83000);
	eq('Resumen: egresos de la empresa (11 800 + 2 000 + gasto Obra A)', S.dash.resumen_general.totalEgresos - BASE.dash.resumen_general.totalEgresos, 13800 + gastoA);
	{
		const t = S.dash.rendimiento.totales;
		eq('Totales de Rendimiento: flujo neto = Σ de los centros', t.flujoCajaNeto, S.dash.rendimiento.items.reduce((s, i) => s + i.flujoCajaNeto, 0));
		eq('Totales de Rendimiento: ingresos − egresos', t.flujoCajaNeto, t.ingresos - t.egresos);
	}
	for (const k of ['saldos_negativos', 'integridad_transacciones', 'integridad_movimientos', 'consistencia_saldos', 'saldos_consistentes', 'consistencia_centros_costo', 'consistencia_cuentas_bancarias']) {
		is(`Consistencia final: ${k}`, S.chk(k)?.estado, BASE.chk(k)?.estado);
	}
} catch (err) {
	rec('La suite se interrumpió', false, err.message);
} finally {
	pasoActual = 'Limpieza';
	try { rec('Transacciones de la suite anuladas (Dev vuelve a como estaba)', null, String(await limpiarE2E())); } catch (e) { rec('Limpieza de transacciones', false, e.message); }
	if (corteInicial) {
		const r = await intentar('cf_eliminar_corte', { fecha_corte: corteInicial });
		rec('Se elimina el corte de partida (Dev vuelve a como estaba)', r.ok, r.ok ? '' : r.error);
		try { await call('cf_eliminar_corte', { fecha_corte: HOY }); } catch {}
	}
	const pass = results.filter((r) => r.pass === true).length;
	const fail = results.filter((r) => r.pass === false).length;
	const info = results.filter((r) => r.pass === null).length;
	console.log(`\nRESUMEN: ${pass} PASS · ${fail} FAIL · ${info} INFO  (marca ${MARCA})`);
	writeFileSync(path.join(tmpdir(), 'tests-control-financiero.json'), JSON.stringify({ marca: MARCA, fecha: HOY, results }, null, 2));
	child.kill();
	process.exit(0);
}
