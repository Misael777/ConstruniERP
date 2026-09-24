// Suite de tests de negocio de Cuentas por Pagar/Cobrar — ver Documentacion/tests/. Corre contra el
// servidor MCP de DEV (escribe datos de prueba marcados "TEST-D"; nunca apunta a Producción).
// Uso: cd app && npm run test:negocio   (requiere Dev sembrado: npm run seed:dev)
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
const rec = (id, titulo, pass, detalle) => { results.push({ id, titulo, pass, detalle }); console.log(`${pass === true ? 'PASS' : pass === false ? 'FAIL' : 'INFO'} ${id} ${titulo} :: ${detalle}`); };

const HOY = '2026-09-24';

// Fondeo: el centro de costo del proyecto de Dev se va vaciando con tantas corridas (los egresos validan saldo).
{
	const c0 = (await call('listar_centros_costo', { limit: 500 })).data;
	const cli = c0.find((c) => c.tipo === 'cliente' && c.id_cliente === 1).id_centro_costo;
	const obra = c0.find((c) => c.tipo === 'proyecto' && c.id_proyecto === 1).id_centro_costo;
	await call('crear_transaccion', { payload: { tipo_alcance: 'externa', id_centro_costo_origen: cli, id_centro_costo_destino: obra, fecha: '2026-09-24', categoria: 'Adelanto', tipo: 'ingreso', tipo_moneda: 'soles', monto_total: 500000, descripcion: 'TEST fondeo del proyecto' } });
}
const centros = (await call('listar_centros_costo', { limit: 500 })).data;
const cc = (tipo, campo, id) => centros.find((c) => c.tipo === tipo && c[campo] === id)?.id_centro_costo;
const provC = cc('proveedor', 'id_proveedor', 1);
const cliC = cc('cliente', 'id_cliente', 1);
const obraC = cc('proyecto', 'id_proyecto', 1);
const consC = centros.find((c) => c.tipo === 'consultoria' && c.id_proyecto === 2)?.id_centro_costo;
console.log({ provC, cliC, obraC, consC });
const trx = (o, d, monto, extra = {}) => ({ tipo_alcance: 'externa', id_centro_costo_origen: o, id_centro_costo_destino: d, fecha: HOY, categoria: 'Servicios', tipo: 'egreso', tipo_moneda: 'soles', monto_total: monto, ...extra });
const cuentaP = async (id) => (await call('ver_cuenta_pagar', { id_cuenta_pagar: id })).data;
const cuentaC = async (id) => (await call('ver_cuenta_cobrar', { id_cuenta_cobrar: id })).data;
const audP = async (id) => (await call('auditar_cuentas_pagar', { id_cuenta_pagar: id })).data;
const audC = async (id) => (await call('auditar_cuentas_cobrar', { id_cuenta_cobrar: id })).data;
const T = 'TEST-D';

// ================= CUENTAS POR PAGAR =================
let r = await call('crear_cuenta_pagar', { payload: { id_proveedor: 1, id_centro_costo: obraC, monto_comprometido: 1000, fecha_emision: HOY, fecha_vencimiento: '2026-12-31', observacion: `${T} P1` } });
const p1 = r.data?.data?.id_cuenta_pagar;
let c = (await cuentaP(p1)).cuenta;
rec('P-01', 'Crear cuenta simple', r.ok && c.saldo_pendiente == 1000 && c.monto_pagado == 0 && c.estado === 'pendiente', `saldo=${c.saldo_pendiente} pagado=${c.monto_pagado} estado=${c.estado}`);
rec('P-02', 'Monto imponible + IGV = monto comprometido', Number(c.monto_imponible) + Number(c.monto_igv) === 1000, `imponible=${c.monto_imponible} igv=${c.monto_igv}`);

r = await call('registrar_pago_cuenta_pagar', { id_cuenta_pagar: p1, transaccion: trx(obraC, provC, 400, { categoria: 'Servicios' }) });
let v = await cuentaP(p1);
rec('P-03', 'Pago parcial actualiza pagado/saldo y deja estado pendiente', r.ok && v.cuenta.monto_pagado == 400 && v.cuenta.saldo_pendiente == 600 && v.cuenta.estado === 'pendiente', `pagado=${v.cuenta.monto_pagado} saldo=${v.cuenta.saldo_pendiente} estado=${v.cuenta.estado}`);
const t1 = v.transacciones[0];
rec('P-04', 'La transacción del pago conserva categoria (regresión del bug de fn_crear_transaccion)', t1?.categoria === 'Servicios' && t1?.tipo === 'egreso', `categoria=${t1?.categoria} tipo=${t1?.tipo}`);
rec('P-05', 'Sentido del dinero: origen = centro que paga, destino = proveedor', t1?.id_centro_costo_origen === obraC && t1?.id_centro_costo_destino === provC, `origen=${t1?.id_centro_costo_origen} destino=${t1?.id_centro_costo_destino}`);

r = await call('registrar_pago_cuenta_pagar', { id_cuenta_pagar: p1, transaccion: trx(obraC, provC, 700) });
v = await cuentaP(p1);
rec('P-06', 'Pago que excede el saldo se rechaza y no altera la cuenta', !r.ok && v.cuenta.monto_pagado == 400, `respuesta=${r.ok ? 'ACEPTADO' : 'rechazado'} pagado=${v.cuenta.monto_pagado}`);

r = await call('registrar_pago_cuenta_pagar', { id_cuenta_pagar: p1, transaccion: trx(obraC, provC, 600) });
v = await cuentaP(p1);
rec('P-07', 'Pago del saldo restante deja estado pagado y saldo 0', r.ok && v.cuenta.saldo_pendiente == 0 && v.cuenta.estado === 'pagado', `saldo=${v.cuenta.saldo_pendiente} estado=${v.cuenta.estado}`);
rec('P-08', 'Auditoría sin inconsistencias tras pagos completos', (await audP(p1)).inconsistencias_encontradas === 0, JSON.stringify((await audP(p1)).inconsistencias));

r = await call('registrar_pago_cuenta_pagar', { id_cuenta_pagar: p1, transaccion: trx(obraC, provC, 10) });
rec('P-09', 'No se puede pagar una cuenta ya pagada', !r.ok, r.ok ? 'ACEPTADO (pago sobre cuenta saldada)' : r.error);

// Fraccionada
r = await call('crear_cuenta_pagar', { payload: { id_proveedor: 1, id_centro_costo: obraC, monto_comprometido: 6000, fecha_emision: HOY, fotma_pago: '2', observacion: `${T} P10` }, fracciones: [{ fecha: '2026-10-10', monto: 2000 }, { fecha: '2026-11-10', monto: 2000 }, { fecha: '2026-12-10', monto: 2000 }] });
const p10 = r.data?.data?.id_cuenta_pagar;
v = await cuentaP(p10);
rec('P-10', 'Fraccionada: 3 cuotas programadas que suman el monto, saldo intacto', v.pagos.length === 3 && v.pagos.every((p) => p.estado_pago === 'programado') && v.cuenta.saldo_pendiente == 6000, `cuotas=${v.pagos.length} saldo=${v.cuenta.saldo_pendiente}`);
r = await call('registrar_pago_cuenta_pagar', { id_cuenta_pagar: p10, transaccion: trx(obraC, provC, 2000) });
rec('P-11', 'Fraccionada con cuotas cubriendo el 100%: un pago suelto extra se rechaza', !r.ok, r.ok ? 'ACEPTADO' : r.error);

r = await call('crear_cuenta_pagar', { payload: { id_proveedor: 1, id_centro_costo: obraC, monto_comprometido: 6000, fecha_emision: HOY, observacion: `${T} P12` }, fracciones: [{ fecha: '2026-10-10', monto: 2000 }, { fecha: '2026-11-10', monto: 2000 }] });
const p12 = r.data?.data?.id_cuenta_pagar;
const a12 = p12 ? await audP(p12) : null;
rec('P-12', 'Fraccionamiento con suma distinta al monto (2000+2000 de 6000): el servidor debería rechazarlo', !r.ok, r.ok ? `ACEPTADO — auditoría: ${JSON.stringify(a12?.inconsistencias)}` : r.error);

// Serie
r = await call('crear_serie_cuentas_pagar', { payload: { id_proveedor: 1, id_centro_costo: obraC, monto_comprometido: 500, fecha_emision: '2026-10-31', fecha_vencimiento: '2026-11-15', frecuencia_pago: 'mensual', fin_periodo_pago: '2027-01-31', observacion: `${T} P13` } });
const serie = r.data?.data ?? [];
rec('P-13', 'Serie mensual: una cuenta por mes, cada una con el monto ÍNTEGRO', r.ok && serie.length === 4 && serie.every((s) => s.monto_comprometido == 500), `cuentas=${serie.length} montos=${serie.map((s) => s.monto_comprometido)}`);
rec('P-14', 'Serie mensual: 31-oct + 1 mes recorta a fin de mes (30-nov, 31-dic, 31-ene)', JSON.stringify(serie.map((s) => s.fecha_emision)) === JSON.stringify(['2026-10-31', '2026-11-30', '2026-12-31', '2027-01-31']), JSON.stringify(serie.map((s) => s.fecha_emision)));
const filasSerie = [];
for (const s of serie) filasSerie.push((await cuentaP(s.id_cuenta_pagar)).cuenta);
const tienePadre = filasSerie.every((x) => 'id_cuenta_pagar_padre' in x);
rec('P-15', 'Serie mensual: encadenada por id_cuenta_pagar_padre (la primera sin padre)', tienePadre && filasSerie[0].id_cuenta_pagar_padre === null && filasSerie.slice(1).every((x, i) => x.id_cuenta_pagar_padre === filasSerie[i].id_cuenta_pagar), tienePadre ? JSON.stringify(filasSerie.map((x) => x.id_cuenta_pagar_padre)) : 'la columna id_cuenta_pagar_padre NO EXISTE en la BD (migración nunca aplicada) y el servicio ignora el error del UPDATE');
r = await call('crear_serie_cuentas_pagar', { payload: { id_proveedor: 1, monto_comprometido: 500, fecha_emision: HOY, frecuencia_pago: 'mensual', observacion: `${T} P16` } });
rec('P-16', 'Serie periódica sin fin_periodo_pago se rechaza', !r.ok, r.ok ? 'ACEPTADO' : r.error);

// Validaciones
for (const [id, monto] of [['P-17', 0], ['P-18', -50]]) {
	r = await call('crear_cuenta_pagar', { payload: { id_proveedor: 1, monto_comprometido: monto, fecha_emision: HOY, observacion: `${T} ${id}` } });
	rec(id, `monto_comprometido = ${monto} se rechaza`, !r.ok, r.ok ? 'ACEPTADO' : r.error);
}
r = await call('crear_cuenta_pagar', { payload: { id_proveedor: 1, monto_comprometido: 100, fecha_emision: '2026-10-10', fecha_vencimiento: '2026-09-01', observacion: `${T} P19` } });
rec('P-19', 'fecha_vencimiento anterior a fecha_emision debería rechazarse', !r.ok, r.ok ? `ACEPTADO (id ${r.data?.data?.id_cuenta_pagar}, estado ${r.data?.data?.estado})` : r.error);
r = await call('crear_cuenta_pagar', { payload: { id_proveedor: 999999, monto_comprometido: 100, fecha_emision: HOY, observacion: `${T} P20` } });
rec('P-20', 'Proveedor inexistente se rechaza', !r.ok, r.ok ? 'ACEPTADO' : r.error);
r = await call('crear_cuenta_pagar', { payload: { id_proveedor: 1, monto_comprometido: 100, fecha_emision: HOY, frecuencia_pago: 'contado', observacion: `${T} P21` } });
rec('P-21', 'frecuencia_pago "contado" se rechaza (no es valor real de la BD)', !r.ok, r.ok ? 'ACEPTADO' : r.error);

// Moneda
r = await call('crear_cuenta_pagar', { payload: { id_proveedor: 1, id_centro_costo: obraC, monto_comprometido: 1000, fecha_emision: HOY, observacion: `${T} P22` } });
const p22 = r.data?.data?.id_cuenta_pagar;
r = await call('registrar_pago_cuenta_pagar', { id_cuenta_pagar: p22, transaccion: trx(obraC, provC, 100, { tipo_moneda: 'dolares', tipo_cambio: 3.75 }) });
v = await cuentaP(p22);
rec('P-22', 'H4: un pago de US$100 (TC 3.75) sobre una cuenta en soles descuenta 375, no 100', r.ok && Number(v.cuenta.monto_pagado) === 375 && Number(v.cuenta.saldo_pendiente) === 625, `pagado=${v.cuenta.monto_pagado} saldo=${v.cuenta.saldo_pendiente} pago=${JSON.stringify(v.pagos.map((p) => p.monto))}`);

// H4: cuenta por pagar EN DÓLARES
r = await call('crear_cuenta_pagar', { payload: { id_proveedor: 1, id_centro_costo: obraC, moneda: 'USD', monto_dolares: 1000, tipo_cambio: 3.75, fecha_emision: HOY, observacion: `${T} P24` } });
const p24 = r.data?.data?.id_cuenta_pagar;
c = p24 ? (await cuentaP(p24)).cuenta : {};
rec('P-24', 'H4: cuenta en USD (1000 x 3.75): monto_comprometido = 3750 soles y saldo = 3750', r.ok && Number(c.monto_comprometido) === 3750 && Number(c.saldo_pendiente) === 3750 && c.moneda === 'USD', r.ok ? `moneda=${c.moneda} comprometido=${c.monto_comprometido} saldo=${c.saldo_pendiente}` : r.error);
r = await call('registrar_pago_cuenta_pagar', { id_cuenta_pagar: p24, transaccion: trx(obraC, provC, 400, { tipo_moneda: 'dolares', tipo_cambio: 3.75 }) });
v = await cuentaP(p24);
rec('P-25', 'H4: pagar US$400 a TC 3.75 en esa cuenta descuenta 1500 soles (saldo 2250) y la auditoría cuadra', r.ok && Number(v.cuenta.monto_pagado) === 1500 && Number(v.cuenta.saldo_pendiente) === 2250 && (await audP(p24)).inconsistencias_encontradas === 0, `pagado=${v.cuenta.monto_pagado} saldo=${v.cuenta.saldo_pendiente} audit=${JSON.stringify((await audP(p24)).inconsistencias)}`);
r = await call('registrar_pago_cuenta_pagar', { id_cuenta_pagar: p24, transaccion: trx(obraC, provC, 100, { tipo_moneda: 'dolares' }) });
rec('P-26', 'H4: una transacción en dólares sin tipo de cambio se rechaza', !r.ok, r.ok ? 'ACEPTADO' : r.error);
r = await call('crear_cuenta_pagar', { payload: { id_proveedor: 1, moneda: 'USD', fecha_emision: HOY, observacion: `${T} P27` } });
rec('P-27', 'H4: cuenta en USD sin monto_dolares/tipo_cambio se rechaza', !r.ok, r.ok ? 'ACEPTADO' : r.error);

// Integridad transversal (solo las cuentas creadas en esta corrida: Dev puede traer restos de corridas viejas)
const todo = await audP();
const propias = todo.inconsistencias.filter((i) => i.id_cuenta_pagar >= p1);
rec('P-23', 'Auditoría de las cuentas por pagar creadas en esta corrida', propias.length === 0, `inconsistencias=${JSON.stringify(propias)}`);

// ================= CUENTAS POR COBRAR =================
const cobrarSuelta = async (obs, monto) => (await call('crear_cuenta_cobrar', { payload: { id_cliente: 2, id_centro_costo: consC, monto, fecha_emision: HOY, fecha_vencimiento: '2026-12-31', observaciones: obs } })).data?.data;
const cobra = (id, m, extra = {}) => call('registrar_cobro_cuenta_cobrar', { id_cuenta_cobrar: id, transaccion: trx(cliC, consC, m, { tipo: 'ingreso', categoria: 'Honorarios', ...extra }) });
const primeraCobrar = (await cuentaAislada2()).id_cuenta_cobrar;
async function cuentaAislada2() { return await cobrarSuelta(`${T} C1`, 20000); }
// H6: el saldo sale de los cobros PROPIOS de la cuenta
let cA = { id_cuenta_cobrar: primeraCobrar };
let w = await cuentaC(cA.id_cuenta_cobrar);
rec('C-01', 'H6: una cuenta nueva sobre un centro que ya recibió ingresos nace SIN cobrado (los ingresos ajenos no cuentan)', Number(w.cuenta.monto_cobrado) === 0 && Number(w.cuenta.saldo_pendiente) === 20000 && w.cuenta.estado === 'pendiente', `cobrado=${w.cuenta.monto_cobrado} saldo=${w.cuenta.saldo_pendiente} estado=${w.cuenta.estado}`);

r = await cobra(cA.id_cuenta_cobrar, 1000);
w = await cuentaC(cA.id_cuenta_cobrar);
rec('C-03', 'H6: un cobro parcial de 1000 deja cobrado 1000 y saldo 19000 (solo cuenta ese cobro)', r.ok && Number(w.cuenta.monto_cobrado) === 1000 && Number(w.cuenta.saldo_pendiente) === 19000, `cobrado=${w.cuenta.monto_cobrado} saldo=${w.cuenta.saldo_pendiente}`);
rec('C-04', 'La transacción del cobro conserva categoria y es ingreso', w.transacciones[0]?.categoria === 'Honorarios' && w.transacciones[0]?.tipo === 'ingreso', `categoria=${w.transacciones[0]?.categoria} tipo=${w.transacciones[0]?.tipo}`);

r = await cobra(cA.id_cuenta_cobrar, 999999);
rec('C-05', 'Cobro que excede lo que falta por cubrir se rechaza', !r.ok, r.ok ? 'ACEPTADO' : r.error);

const cB = await cobrarSuelta(`${T} C6`, 20000);
rec('C-06', 'H6: dos cuentas sobre el mismo centro son independientes (el cobro de A no cambia a B)', Number(cB?.monto_cobrado) === 0 && Number((await cuentaC(cB.id_cuenta_cobrar)).cuenta.saldo_pendiente) === 20000, `cuenta B cobrado=${cB?.monto_cobrado}`);

await call('crear_transaccion', { payload: trx(cliC, consC, 5000, { tipo: 'ingreso', categoria: 'Abonos', descripcion: `${T} ingreso suelto` }) });
const stale = await audC(cA.id_cuenta_cobrar);
rec('C-07', 'H6: un ingreso suelto al mismo centro no altera la cuenta y la auditoría sigue limpia', stale.inconsistencias_encontradas === 0, JSON.stringify(stale.inconsistencias));

r = await call('crear_cuenta_cobrar', { payload: { id_cliente: 2, id_centro_costo: consC, monto: 3000, fecha_emision: HOY, observaciones: `${T} C8` }, fracciones: [{ fecha: '2026-10-10', monto: 1000 }, { fecha: '2026-11-10', monto: 1000 }] });
rec('C-08', 'Fraccionamiento con suma distinta al monto (1000+1000 de 3000) debería rechazarse', !r.ok, r.ok ? `ACEPTADO (id ${r.data?.data?.id_cuenta_cobrar})` : r.error);

r = await call('crear_cuenta_cobrar', { payload: { id_cliente: 2, id_centro_costo: consC, monto: 0, fecha_emision: HOY, observaciones: `${T} C9` } });
rec('C-09', 'monto = 0 se rechaza', !r.ok, r.ok ? 'ACEPTADO' : r.error);
r = await call('crear_cuenta_cobrar', { payload: { id_cliente: 2, monto: 100, fecha_emision: HOY, observaciones: `${T} C10` } });
rec('C-10', 'Sin id_centro_costo se rechaza (obligatorio)', !r.ok, r.ok ? 'ACEPTADO' : r.error);
r = await call('crear_cuenta_cobrar', { payload: { id_cliente: 2, id_centro_costo: consC, monto: 100, fecha_emision: '2026-10-10', fecha_vencimiento: '2026-09-01', observaciones: `${T} C11` } });
rec('C-11', 'fecha_vencimiento anterior a fecha_emision debería rechazarse', !r.ok, r.ok ? 'ACEPTADO' : r.error);
r = await call('crear_cuenta_cobrar', { payload: { id_cliente: 2, id_centro_costo: consC, moneda: 'USD', monto_dolares: 1000, tipo_cambio: 3.75, monto: 0, fecha_emision: HOY, observaciones: `${T} C12` } });
rec('C-12', 'Cuenta en USD: monto = monto_dolares x tipo_cambio y saldo = ese monto (no 0)', r.ok && Number(r.data?.data?.monto) === 3750 && Number(r.data?.data?.saldo_pendiente) === 3750, r.ok ? `monto=${r.data?.data?.monto} saldo=${r.data?.data?.saldo_pendiente} (esperado 3750)` : r.error);
const cUsd = r.data?.data?.id_cuenta_cobrar;
r = await cobra(cUsd, 400, { tipo_moneda: 'dolares', tipo_cambio: 3.75 });
w = await cuentaC(cUsd);
rec('C-14', 'H4: cobrar US$400 a TC 3.75 en la cuenta en USD descuenta 1500 soles (saldo 2250)', r.ok && Number(w.cuenta.monto_cobrado) === 1500 && Number(w.cuenta.saldo_pendiente) === 2250, `cobrado=${w.cuenta.monto_cobrado} saldo=${w.cuenta.saldo_pendiente}`);

const totalC = await audC();
const propiasC = totalC.inconsistencias.filter((i) => i.id_cuenta_cobrar >= cA.id_cuenta_cobrar);
rec('C-13', 'Auditoría de las cuentas por cobrar creadas en esta corrida', propiasC.length === 0, `inconsistencias=${JSON.stringify(propiasC)}`);

const fallas = results.filter((x) => x.pass === false).length;
console.log(`\n${results.length} casos: ${results.filter((x) => x.pass === true).length} PASS, ${fallas} FAIL, ${results.filter((x) => x.pass === null).length} INFO`);
child.kill();
