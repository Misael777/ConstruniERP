// Tests de negocio: cambiar la periodicidad del saldo restante a mitad de un plan de pagos/cobros
// (ej. 10 meses mensuales que, tras el mes 4, pasan a semanales). Ver Documentacion/tests/fraccionamiento.md.
// Corre contra el servidor MCP de DEV (escribe datos marcados "TEST-F"; nunca apunta a Producción).
// Uso: cd app && npm run test:negocio:fraccionamiento   (requiere Dev sembrado: npm run seed:dev)
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

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
let n = 0;
const rpc = (method, params) => new Promise((res) => { const id = ++n; waiters.set(id, res); child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); });
await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 't', version: '0' } });
child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
const call = async (name, args = {}) => {
	const r = await rpc('tools/call', { name, arguments: args });
	const txt = r.result?.content?.[0]?.text ?? '';
	if (r.result?.isError) return { ok: false, error: txt };
	try { return { ok: true, data: JSON.parse(txt) }; } catch { return { ok: true, data: txt }; }
};
const results = [];
const rec = (id, titulo, pass, detalle) => { results.push({ id, pass }); console.log(`${pass === true ? 'PASS' : pass === false ? 'FAIL' : 'INFO'} ${id} ${titulo} :: ${String(detalle).slice(0, 400)}`); };

// ---- utilidades de fecha (UTC, para que la zona horaria de la máquina no mueva los días) ----
const sumarDias = (iso, d) => { const x = new Date(iso + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + d); return x.toISOString().slice(0, 10); };
const sumarMeses = (iso, m) => {
	const [y, mo, d] = iso.split('-').map(Number);
	const t = mo - 1 + m;
	const ay = y + Math.floor(t / 12), am = ((t % 12) + 12) % 12;
	const dia = Math.min(d, new Date(Date.UTC(ay, am + 1, 0)).getUTCDate());
	return `${ay}-${String(am + 1).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
};
const diffDias = (a, b) => Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 86400000);
const HOY = '2026-09-24';

// Fondeo: el centro de costo del proyecto de Dev se va vaciando con tantas corridas (los egresos validan saldo).
{
	const c0 = (await call('listar_centros_costo', { limit: 500 })).data;
	const cli = c0.find((c) => c.tipo === 'cliente' && c.id_cliente === 1).id_centro_costo;
	const obra = c0.find((c) => c.tipo === 'proyecto' && c.id_proyecto === 1).id_centro_costo;
	await call('crear_transaccion', { payload: { tipo_alcance: 'externa', id_centro_costo_origen: cli, id_centro_costo_destino: obra, fecha: '2026-09-24', categoria: 'Adelanto', tipo: 'ingreso', tipo_moneda: 'soles', monto_total: 500000, descripcion: 'TEST fondeo del proyecto' } });
}
const T = 'TEST-F';

const centros = (await call('listar_centros_costo', { limit: 500 })).data;
const provC = centros.find((c) => c.tipo === 'proveedor' && c.id_proveedor === 1).id_centro_costo;
const obraC = centros.find((c) => c.tipo === 'proyecto' && c.id_proyecto === 1).id_centro_costo;
const cliC = centros.find((c) => c.tipo === 'cliente' && c.id_cliente === 1).id_centro_costo;
const aisladoC = centros.find((c) => c.tipo === 'cliente' && c.id_cliente === 2).id_centro_costo; // sin ingresos previos como destino
const trxP = (monto, extra = {}) => ({ tipo_alcance: 'externa', id_centro_costo_origen: obraC, id_centro_costo_destino: provC, fecha: HOY, categoria: 'Servicios', tipo: 'egreso', tipo_moneda: 'soles', monto_total: monto, ...extra });
const trxC = (monto, extra = {}) => ({ tipo_alcance: 'externa', id_centro_costo_origen: cliC, id_centro_costo_destino: aisladoC, fecha: HOY, categoria: 'Valorización', tipo: 'ingreso', tipo_moneda: 'soles', monto_total: monto, ...extra });
const verP = async (id) => (await call('ver_cuenta_pagar', { id_cuenta_pagar: id })).data;
const verC = async (id) => (await call('ver_cuenta_cobrar', { id_cuenta_cobrar: id })).data;
const audP = async (id) => (await call('auditar_cuentas_pagar', { id_cuenta_pagar: id })).data;
const audC = async (id) => (await call('auditar_cuentas_cobrar', { id_cuenta_cobrar: id })).data;
const prog = (pagos) => pagos.filter((p) => ['programado'].includes(p.estado_pago)).sort((a, b) => a.fecha_pago.localeCompare(b.fecha_pago));
const suma = (xs) => Number(xs.reduce((s, x) => s + Number(x.monto), 0).toFixed(2));

// =====================================================================================
// ESCENARIO A — CUENTA POR PAGAR con "Fraccionar este pago": 10 meses, cambia a semanal tras el mes 4
// =====================================================================================
const mensuales = Array.from({ length: 10 }, (_, i) => ({ fecha: sumarMeses('2026-10-24', i), monto: 1000 }));
let r = await call('crear_cuenta_pagar', { payload: { id_proveedor: 1, id_centro_costo: obraC, monto_comprometido: 10000, fecha_emision: HOY, fotma_pago: '2', observacion: `${T} A` }, fracciones: mensuales });
const A = r.data?.data?.id_cuenta_pagar;
let v = await verP(A);
rec('F-01', 'Plan de 10 cuotas mensuales de 1000 sobre una cuenta de 10000', r.ok && prog(v.pagos).length === 10 && suma(v.pagos) === 10000 && prog(v.pagos).every((p, i) => i === 0 || diffDias(prog(v.pagos)[i - 1].fecha_pago, p.fecha_pago) >= 28), `cuotas=${prog(v.pagos).length} suma=${suma(v.pagos)} fechas=${prog(v.pagos).map((p) => p.fecha_pago).join(',')}`);

// pagar las 4 primeras cuotas (vía correcta: confirmar la cuota, no crear un pago nuevo)
const idsPagadas = [];
for (const cuota of prog(v.pagos).slice(0, 4)) {
	const rr = await call('confirmar_pago_cuota', { id_pago: cuota.id_pago, transaccion: trxP(1000) });
	if (!rr.ok) console.log('   error confirmando cuota', cuota.id_pago, rr.error);
	idsPagadas.push(cuota.id_pago);
}
v = await verP(A);
const trxPagadas = v.pagos.filter((p) => p.estado_pago === 'pagado').map((p) => p.id_transaccion);
rec('F-02', 'Tras pagar 4 cuotas: pagado 4000, saldo 6000, 4 pagadas + 6 programadas', v.cuenta.monto_pagado == 4000 && v.cuenta.saldo_pendiente == 6000 && trxPagadas.length === 4 && prog(v.pagos).length === 6, `pagado=${v.cuenta.monto_pagado} saldo=${v.cuenta.saldo_pendiente} programadas=${prog(v.pagos).length}`);

// cambio de periodicidad: el saldo restante (6000) pasa a 12 cuotas SEMANALES de 500
const ultimaPagada = v.pagos.filter((p) => p.estado_pago === 'pagado').map((p) => p.fecha_pago).sort().pop();
const semanales = Array.from({ length: 12 }, (_, i) => ({ fecha: sumarDias('2027-02-01', 7 * i), monto: 500 }));
r = await call('refraccionar_cuenta_pagar', { id_cuenta_pagar: A, fracciones: semanales });
v = await verP(A);
const pagadasDespues = v.pagos.filter((p) => p.estado_pago === 'pagado');
rec('F-03', 'Cambiar el saldo restante de mensual a semanal se acepta', r.ok, r.ok ? r.data.mensaje : r.error);
rec('F-04', 'Las 4 cuotas ya pagadas y sus transacciones quedan intactas', pagadasDespues.length === 4 && JSON.stringify(pagadasDespues.map((p) => p.id_pago).sort()) === JSON.stringify([...idsPagadas].sort()) && JSON.stringify(pagadasDespues.map((p) => p.id_transaccion).sort()) === JSON.stringify([...trxPagadas].sort()), `pagadas=${pagadasDespues.length} ids=${pagadasDespues.map((p) => p.id_pago)}`);
rec('F-05', 'Las 6 cuotas mensuales pendientes se reemplazan por 12 semanales de 500', prog(v.pagos).length === 12 && prog(v.pagos).every((p) => Number(p.monto) === 500), `programadas=${prog(v.pagos).length} montos=${[...new Set(prog(v.pagos).map((p) => p.monto))]}`);
const fechasSem = prog(v.pagos).map((p) => p.fecha_pago);
rec('F-06', 'Las nuevas cuotas están separadas exactamente 7 días y empiezan después de la última cuota pagada', fechasSem.every((f, i) => i === 0 || diffDias(fechasSem[i - 1], f) === 7) && fechasSem[0] > ultimaPagada, `primera=${fechasSem[0]} ultimaPagada=${ultimaPagada} pasos=${fechasSem.slice(1).map((f, i) => diffDias(fechasSem[i], f))}`);
rec('F-07', 'Los totales cuadran: pagado + programado = 10000, saldo 6000, sin inconsistencias', suma(v.pagos.filter((p) => p.estado_pago !== 'cancelado')) === 10000 && v.cuenta.saldo_pendiente == 6000 && (await audP(A)).inconsistencias_encontradas === 0, `suma=${suma(v.pagos.filter((p) => p.estado_pago !== 'cancelado'))} saldo=${v.cuenta.saldo_pendiente} audit=${JSON.stringify((await audP(A)).inconsistencias)}`);

// se sigue pudiendo pagar con el plan nuevo
r = await call('confirmar_pago_cuota', { id_pago: prog(v.pagos)[0].id_pago, transaccion: trxP(500) });
v = await verP(A);
rec('F-08', 'Se puede pagar la primera cuota semanal: pagado 4500, saldo 5500', r.ok && v.cuenta.monto_pagado == 4500 && v.cuenta.saldo_pendiente == 5500, `pagado=${v.cuenta.monto_pagado} saldo=${v.cuenta.saldo_pendiente}`);

// segundo cambio (semanal -> mensual) con un pago semanal ya hecho
const mens2 = Array.from({ length: 5 }, (_, i) => ({ fecha: sumarMeses('2027-03-01', i), monto: 1100 }));
r = await call('refraccionar_cuenta_pagar', { id_cuenta_pagar: A, fracciones: mens2 });
v = await verP(A);
rec('F-09', 'Un segundo cambio (semanal → mensual, 5 × 1100) conserva las 5 cuotas pagadas y cuadra', r.ok && v.pagos.filter((p) => p.estado_pago === 'pagado').length === 5 && prog(v.pagos).length === 5 && v.cuenta.saldo_pendiente == 5500 && (await audP(A)).inconsistencias_encontradas === 0, `pagadas=${v.pagos.filter((p) => p.estado_pago === 'pagado').length} programadas=${prog(v.pagos).length} saldo=${v.cuenta.saldo_pendiente}`);

// error de usuario: repartir el TOTAL en vez del saldo restante
r = await call('refraccionar_cuenta_pagar', { id_cuenta_pagar: A, fracciones: [{ fecha: '2027-04-01', monto: 10000 }] });
v = await verP(A);
rec('F-10', 'Re-fraccionar con un monto mayor al saldo restante (10000 en vez de 5500) debería rechazarse', !r.ok, r.ok ? `ACEPTADO — pagado+programado = ${suma(v.pagos.filter((p) => p.estado_pago !== 'cancelado'))} vs comprometido 10000` : r.error);
// restaurar un calendario correcto para poder cerrar la cuenta
await call('refraccionar_cuenta_pagar', { id_cuenta_pagar: A, fracciones: [{ fecha: '2027-04-01', monto: 5500 }] });
v = await verP(A);
r = await call('confirmar_pago_cuota', { id_pago: prog(v.pagos)[0].id_pago, transaccion: trxP(5500) });
v = await verP(A);
rec('F-11', 'Adelantar el pago: juntar el saldo en una sola cuota y pagarla deja la cuenta pagada', r.ok && v.cuenta.saldo_pendiente == 0 && v.cuenta.estado === 'pagado' && (await audP(A)).inconsistencias_encontradas === 0, `saldo=${v.cuenta.saldo_pendiente} estado=${v.cuenta.estado} audit=${JSON.stringify((await audP(A)).inconsistencias)}`);

// pagar una cuota por un monto distinto al programado
r = await call('crear_cuenta_pagar', { payload: { id_proveedor: 1, id_centro_costo: obraC, monto_comprometido: 3000, fecha_emision: HOY, fotma_pago: '2', observacion: `${T} B` }, fracciones: [{ fecha: '2026-10-24', monto: 1000 }, { fecha: '2026-11-24', monto: 1000 }, { fecha: '2026-12-24', monto: 1000 }] });
const B = r.data?.data?.id_cuenta_pagar;
v = await verP(B);
r = await call('confirmar_pago_cuota', { id_pago: prog(v.pagos)[0].id_pago, transaccion: trxP(600) });
v = await verP(B);
const a = await audP(B);
rec('F-12', 'Pagar una cuota de 1000 con una transacción de 600: pago y transacción deben coincidir y el total seguir cuadrando', r.ok && a.inconsistencias_encontradas === 0, `pagado=${v.cuenta.monto_pagado} saldo=${v.cuenta.saldo_pendiente} pagos=${JSON.stringify(v.pagos.map((p) => [p.monto, p.estado_pago]))} audit=${JSON.stringify(a.inconsistencias)}`);

// H7: una transacción MAYOR que la cuota se rechaza
r = await call('crear_cuenta_pagar', { payload: { id_proveedor: 1, id_centro_costo: obraC, monto_comprometido: 2000, fecha_emision: HOY, fotma_pago: '2', observacion: `${T} D` }, fracciones: [{ fecha: '2026-10-24', monto: 1000 }, { fecha: '2026-11-24', monto: 1000 }] });
const D = r.data?.data?.id_cuenta_pagar;
v = await verP(D);
r = await call('confirmar_pago_cuota', { id_pago: prog(v.pagos)[0].id_pago, transaccion: trxP(1500) });
v = await verP(D);
rec('F-12b', 'H7: pagar una cuota de 1000 con una transacción de 1500 se rechaza y no cambia nada', !r.ok && v.cuenta.monto_pagado == 0 && prog(v.pagos).length === 2, r.ok ? 'ACEPTADO' : r.error);

// =====================================================================================
// ESCENARIO B — misma necesidad con "Frecuencia de Pago" (serie de cuentas independientes)
// =====================================================================================
r = await call('crear_serie_cuentas_pagar', { payload: { id_proveedor: 1, id_centro_costo: obraC, monto_comprometido: 1000, fecha_emision: '2026-10-24', frecuencia_pago: 'mensual', fin_periodo_pago: '2027-07-24', observacion: `${T} S` } });
const serie = (r.data?.data ?? []).sort((x, y) => x.id_cuenta_pagar - y.id_cuenta_pagar);
rec('F-13', 'Frecuencia mensual con fin a 10 meses genera 10 cuentas independientes de 1000 (se generan todas de golpe)', serie.length === 10 && serie.every((s) => s.monto_comprometido == 1000), `cuentas=${serie.length}`);
for (const c of serie.slice(0, 4)) await call('registrar_pago_cuenta_pagar', { id_cuenta_pagar: c.id_cuenta_pagar, transaccion: trxP(1000) });
const resto = serie.slice(4);
const antes = (await call('listar_cuentas_pagar', { limit: 200 })).data.filter((x) => x.observacion === `${T} S`).length;
r = await call('actualizar_cuenta_pagar', { id_cuenta_pagar: resto[0].id_cuenta_pagar, cambios: { frecuencia_pago: 'semanal', fin_periodo_pago: '2027-08-31' } });
const despues = (await call('listar_cuentas_pagar', { limit: 200 })).data.filter((x) => x.observacion === `${T} S`).length;
rec('F-14', 'Cambiar frecuencia_pago a "semanal" en una cuenta de la serie NO regenera el calendario de las 6 restantes', null, `edición ${r.ok ? 'aceptada' : 'rechazada: ' + r.error}; cuentas de la serie antes=${antes} después=${despues} (si son iguales, el cambio solo guarda una etiqueta y no reprograma nada)`);

// forma alternativa: dar de baja las 6 restantes y crear una serie semanal por el saldo restante
for (const c of resto) await call('dar_de_baja_cuenta_pagar', { id_cuenta_pagar: c.id_cuenta_pagar });
r = await call('crear_serie_cuentas_pagar', { payload: { id_proveedor: 1, id_centro_costo: obraC, monto_comprometido: 500, fecha_emision: '2027-02-01', frecuencia_pago: 'semanal', fin_periodo_pago: '2027-04-19', observacion: `${T} S2` } });
const semSerie = (r.data?.data ?? []).sort((x, y) => x.id_cuenta_pagar - y.id_cuenta_pagar);
const fs = semSerie.map((x) => x.fecha_emision);
rec('F-15', 'Alternativa manual: dar de baja las 6 cuentas restantes y crear una serie semanal por el saldo (12 × 500 = 6000) funciona', r.ok && semSerie.length === 12 && semSerie.reduce((s, x) => s + Number(x.monto_comprometido), 0) === 6000 && fs.every((f, i) => i === 0 || diffDias(fs[i - 1], f) === 7), `cuentas=${semSerie.length} total=${semSerie.reduce((s, x) => s + Number(x.monto_comprometido), 0)} pasos=${fs.slice(1).map((f, i) => diffDias(fs[i], f)).join(',')}`);
const audS = await audP();
rec('F-16', 'Ninguna cuenta de la serie da de baja pagos ni deja la auditoría global con inconsistencias nuevas de estas series', !audS.inconsistencias.some((i) => serie.some((s) => s.id_cuenta_pagar === i.id_cuenta_pagar) || semSerie.some((s) => s.id_cuenta_pagar === i.id_cuenta_pagar)), JSON.stringify(audS.inconsistencias.filter((i) => serie.some((s) => s.id_cuenta_pagar === i.id_cuenta_pagar))));

// =====================================================================================
// ESCENARIO C — CUENTA POR COBRAR: mismo cambio de periodicidad
// (centro destino aislado: el saldo de Cobrar se deriva de los ingresos a ese centro, ver H6)
// =====================================================================================
const prevIng = (await call('listar_transacciones', { id_centro_costo: aisladoC, limit: 200 })).data.filter((t) => t.tipo === 'ingreso' && t.id_centro_costo_destino === aisladoC && t.estado === 'activo').reduce((s, t) => s + Number(t.monto_total), 0);
r = await call('crear_cuenta_cobrar', { payload: { id_cliente: 2, id_centro_costo: aisladoC, monto: 10000 + prevIng, fecha_emision: HOY, observaciones: `${T} C` }, fracciones: mensuales.map((m) => ({ ...m, monto: (10000 + prevIng) / 10 })) });
const C = r.data?.data?.id_cuenta_cobrar;
let w = await verC(C);
const montoC = 10000 + prevIng;
rec('F-17', 'Cobrar: plan de 10 cuotas mensuales sobre la cuenta', r.ok && w.cobros.filter((c) => c.estado_cobro === 'programado').length === 10, `cuotas=${w.cobros.length} monto=${montoC} (ingresos previos al centro aislado=${prevIng})`);
for (const cuota of w.cobros.filter((c) => c.estado_cobro === 'programado').sort((x, y) => x.fecha_cobro.localeCompare(y.fecha_cobro)).slice(0, 4)) await call('confirmar_cobro_cuota', { id_cobro: cuota.id_cobro, transaccion: trxC(Number(cuota.monto)) });
w = await verC(C);
const cobradas = w.cobros.filter((c) => c.estado_cobro === 'cobrado');
const pendienteC = montoC - w.cuenta.monto_cobrado;
const restC = w.cobros.filter((c) => c.estado_cobro === 'programado');
const sumRest = Number(restC.reduce((s, c) => s + Number(c.monto), 0).toFixed(2));
rec('F-18', 'Cobrar: tras cobrar 4 cuotas hay 4 cobradas y 6 programadas, y el saldo baja', cobradas.length === 4 && restC.length === 6, `cobradas=${cobradas.length} programadas=${restC.length} cobrado=${w.cuenta.monto_cobrado} saldo=${w.cuenta.saldo_pendiente}`);
const semC = Array.from({ length: 12 }, (_, i) => ({ fecha: sumarDias('2027-02-01', 7 * i), monto: Number((sumRest / 12).toFixed(2)) }));
semC[11].monto = Number((sumRest - semC.slice(0, 11).reduce((s, x) => s + x.monto, 0)).toFixed(2));
r = await call('refraccionar_cuenta_cobrar', { id_cuenta_cobrar: C, fracciones: semC });
w = await verC(C);
const restC2 = w.cobros.filter((c) => c.estado_cobro === 'programado').sort((x, y) => x.fecha_cobro.localeCompare(y.fecha_cobro));
rec('F-19', 'Cobrar: el cambio a semanal del saldo restante se acepta, conserva las 4 cobradas y deja 12 cuotas a 7 días', r.ok && w.cobros.filter((c) => c.estado_cobro === 'cobrado').length === 4 && restC2.length === 12 && restC2.every((c, i) => i === 0 || diffDias(restC2[i - 1].fecha_cobro, c.fecha_cobro) === 7), r.ok ? `cobradas=${w.cobros.filter((c) => c.estado_cobro === 'cobrado').length} programadas=${restC2.length}` : r.error);
const audCC = await audC(C);
rec('F-20', 'Cobrar: la auditoría de esa cuenta no encuentra inconsistencias tras el cambio', audCC.inconsistencias_encontradas === 0, JSON.stringify(audCC.inconsistencias));

// H7 también en Cobrar: cobro parcial de una cuota la parte
r = await call('crear_cuenta_cobrar', { payload: { id_cliente: 2, id_centro_costo: aisladoC, monto: 3000, fecha_emision: HOY, observaciones: `${T} E` }, fracciones: [{ fecha: '2026-10-24', monto: 1000 }, { fecha: '2026-11-24', monto: 1000 }, { fecha: '2026-12-24', monto: 1000 }] });
const E = r.data?.data?.id_cuenta_cobrar;
w = await verC(E);
const primera = w.cobros.filter((c) => c.estado_cobro === 'programado').sort((x, y) => x.fecha_cobro.localeCompare(y.fecha_cobro))[0];
r = await call('confirmar_cobro_cuota', { id_cobro: primera.id_cobro, transaccion: trxC(600) });
w = await verC(E);
const audE = await audC(E);
rec('F-21', 'H7 en Cobrar: cobrar 600 de una cuota de 1000 deja 600 cobrado + 400 programado, saldo 2400 y auditoría limpia', r.ok && Number(w.cuenta.monto_cobrado) === 600 && Number(w.cuenta.saldo_pendiente) === 2400 && w.cobros.filter((c) => c.estado_cobro === 'programado').length === 3 && audE.inconsistencias_encontradas === 0, `cobrado=${w.cuenta.monto_cobrado} saldo=${w.cuenta.saldo_pendiente} cobros=${JSON.stringify(w.cobros.map((c) => [c.monto, c.estado_cobro]))} audit=${JSON.stringify(audE.inconsistencias)}`);

console.log(`\n${results.length} casos: ${results.filter((x) => x.pass === true).length} PASS, ${results.filter((x) => x.pass === false).length} FAIL, ${results.filter((x) => x.pass === null).length} INFO`);
child.kill();
