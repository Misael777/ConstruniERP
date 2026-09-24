// Tests de negocio: el "lápiz" de las cuotas (editar el monto/fecha de UNA cuota) y montos desiguales.
// Ver Documentacion/tests/lapiz-cuotas.md. Corre contra el servidor MCP de DEV (marca "TEST-L").
// Uso: cd app && npm run test:negocio:lapiz   (requiere Dev sembrado: npm run seed:dev)
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

const HOY = '2026-09-24';
const T = 'TEST-L';
{
	const c0 = (await call('listar_centros_costo', { limit: 500 })).data;
	const cli = c0.find((c) => c.tipo === 'cliente' && c.id_cliente === 1).id_centro_costo;
	const obra = c0.find((c) => c.tipo === 'proyecto' && c.id_proyecto === 1).id_centro_costo;
	await call('crear_transaccion', { payload: { tipo_alcance: 'externa', id_centro_costo_origen: cli, id_centro_costo_destino: obra, fecha: HOY, categoria: 'Adelanto', tipo: 'ingreso', tipo_moneda: 'soles', monto_total: 200000, descripcion: 'TEST fondeo del proyecto' } });
}
const centros = (await call('listar_centros_costo', { limit: 500 })).data;
const provC = centros.find((c) => c.tipo === 'proveedor' && c.id_proveedor === 1).id_centro_costo;
const obraC = centros.find((c) => c.tipo === 'proyecto' && c.id_proyecto === 1).id_centro_costo;
const cliC = centros.find((c) => c.tipo === 'cliente' && c.id_cliente === 1).id_centro_costo;
const trxP = (monto) => ({ tipo_alcance: 'externa', id_centro_costo_origen: obraC, id_centro_costo_destino: provC, fecha: HOY, categoria: 'Servicios', tipo: 'egreso', tipo_moneda: 'soles', monto_total: monto });
const verP = async (id) => (await call('ver_cuenta_pagar', { id_cuenta_pagar: id })).data;
const verC = async (id) => (await call('ver_cuenta_cobrar', { id_cuenta_cobrar: id })).data;
const audP = async (id) => (await call('auditar_cuentas_pagar', { id_cuenta_pagar: id })).data;
const audC = async (id) => (await call('auditar_cuentas_cobrar', { id_cuenta_cobrar: id })).data;
const cuotasP = (v) => v.pagos.filter((p) => p.estado_pago === 'programado').sort((a, b) => a.fecha_pago.localeCompare(b.fecha_pago) || a.id_pago - b.id_pago);
const montos = (xs) => JSON.stringify(xs.map((x) => Number(x.monto)));
const meses = ['2026-10-24', '2026-11-24', '2026-12-24', '2027-01-24', '2027-02-24'];
const cinco = meses.map((fecha) => ({ fecha, monto: 1000 }));
const nueva = async (obs) => (await call('crear_cuenta_pagar', { payload: { id_proveedor: 1, id_centro_costo: obraC, monto_comprometido: 5000, fecha_emision: HOY, fotma_pago: '2', observacion: `${T} ${obs}` }, fracciones: cinco })).data?.data?.id_cuenta_pagar;

// L-01 editar una cuota del medio a un monto mayor: la última absorbe la diferencia
let A = await nueva('A');
let v = await verP(A);
let r = await call('editar_cuota_pago', { id_pago: cuotasP(v)[1].id_pago, cambios: { monto: 1500 } });
v = await verP(A);
rec('L-01', 'Lápiz: subir la cuota 2 de 1000 a 1500 se acepta y la última se reajusta (queda 500); el total sigue en 5000', r.ok && montos(cuotasP(v)) === '[1000,1500,1000,1000,500]' && (await audP(A)).inconsistencias_encontradas === 0, `cuotas=${montos(cuotasP(v))} ${r.ok ? '' : r.error}`);

// L-02 bajar una cuota: la diferencia se suma a la última
r = await call('editar_cuota_pago', { id_pago: cuotasP(v)[0].id_pago, cambios: { monto: 600 } });
v = await verP(A);
rec('L-02', 'Lápiz: bajar la cuota 1 a 600 suma los 400 a la última (900); el total sigue en 5000', r.ok && montos(cuotasP(v)) === '[600,1500,1000,1000,900]' && (await audP(A)).inconsistencias_encontradas === 0, `cuotas=${montos(cuotasP(v))}`);

// L-03 editar la propia última cuota: la diferencia va a la anterior
r = await call('editar_cuota_pago', { id_pago: cuotasP(v)[4].id_pago, cambios: { monto: 400 } });
v = await verP(A);
rec('L-03', 'Lápiz: editar la ÚLTIMA cuota (900 → 400) reajusta otra cuota y el total sigue en 5000', r.ok && Number(montos(cuotasP(v)).slice(1, -1).split(',').reduce((s, x) => s + Number(x), 0)) === 5000 && (await audP(A)).inconsistencias_encontradas === 0, `cuotas=${montos(cuotasP(v))} ${r.ok ? '' : r.error}`);

// L-04 cambiar solo la fecha de una cuota
r = await call('editar_cuota_pago', { id_pago: cuotasP(v)[2].id_pago, cambios: { fecha_pago: '2027-03-15' } });
v = await verP(A);
rec('L-04', 'Lápiz: mover la fecha de una cuota no toca ningún monto', r.ok && cuotasP(v).some((p) => p.fecha_pago === '2027-03-15') && (await audP(A)).inconsistencias_encontradas === 0, `cuotas=${montos(cuotasP(v))}`);

// L-05 monto absurdo: mayor que todo lo que falta -> la última quedaría negativa
let B = await nueva('B');
v = await verP(B);
r = await call('editar_cuota_pago', { id_pago: cuotasP(v)[0].id_pago, cambios: { monto: 9000 } });
v = await verP(B);
const negativas = cuotasP(v).filter((p) => Number(p.monto) <= 0);
rec('L-05', 'Lápiz: subir una cuota a 9000 en una cuenta de 5000 debería rechazarse (no dejar cuotas negativas ni un total distinto)', !r.ok || (negativas.length === 0 && cuotasP(v).reduce((s, p) => s + Number(p.monto), 0) === 5000), r.ok ? `ACEPTADO — cuotas=${montos(cuotasP(v))}` : r.error);

// L-06 la única cuota pendiente no puede reajustarse contra nadie
let C = await nueva('C');
v = await verP(C);
for (const cuota of cuotasP(v).slice(0, 4)) await call('confirmar_pago_cuota', { id_pago: cuota.id_pago, transaccion: trxP(1000) });
v = await verP(C);
r = await call('editar_cuota_pago', { id_pago: cuotasP(v)[0].id_pago, cambios: { monto: 700 } });
v = await verP(C);
rec('L-06', 'Lápiz: editar el monto de la ÚNICA cuota pendiente (1000 → 700) no debería dejar la cuenta descuadrada', !r.ok || (await audP(C)).inconsistencias_encontradas === 0, r.ok ? `ACEPTADO — cuotas=${montos(cuotasP(v))} audit=${JSON.stringify((await audP(C)).inconsistencias)}` : r.error);

// L-07 editar el monto de una cuota YA PAGADA
v = await verP(C);
const pagada = v.pagos.find((p) => p.estado_pago === 'pagado');
r = await call('editar_cuota_pago', { id_pago: pagada.id_pago, cambios: { monto: 800 } });
const a7 = await audP(C);
rec('L-07', 'Lápiz: cambiar el monto de una cuota ya PAGADA debería rechazarse (su transacción quedaría con otro monto)', !r.ok || a7.inconsistencias_encontradas === 0, r.ok ? `ACEPTADO — audit=${JSON.stringify(a7.inconsistencias.map((i) => i.detalle))}` : r.error);

// L-08 anular una cuota cuando el resto no cuadra se bloquea
let D = await nueva('D');
v = await verP(D);
r = await call('editar_cuota_pago', { id_pago: cuotasP(v)[1].id_pago, cambios: {}, estado_pago: 'cancelado' });
v = await verP(D);
rec('L-08', 'Lápiz: anular una cuota sin reajustar antes las demás se bloquea con un mensaje claro', !r.ok && cuotasP(v).length === 5, r.ok ? 'ACEPTADO' : r.error);

// L-09 montos desiguales DENTRO de una serie de "Frecuencia de Pago": cada cuenta es independiente
r = await call('crear_serie_cuentas_pagar', { payload: { id_proveedor: 1, id_centro_costo: obraC, monto_comprometido: 500, fecha_emision: '2026-10-24', frecuencia_pago: 'mensual', fin_periodo_pago: '2027-01-24', observacion: `${T} S` } });
const serie = (r.data?.data ?? []).sort((a, b) => a.id_cuenta_pagar - b.id_cuenta_pagar);
r = await call('actualizar_cuenta_pagar', { id_cuenta_pagar: serie[1].id_cuenta_pagar, cambios: { monto_comprometido: 800 } });
const despues = [];
for (const c of serie) despues.push(Number((await verP(c.id_cuenta_pagar)).cuenta.monto_comprometido));
rec('L-09', 'Serie por Frecuencia: cambiar el monto de UNA cuenta (500 → 800) solo afecta a esa; las demás siguen en 500', r.ok && JSON.stringify(despues) === '[500,800,500,500]', `montos=${JSON.stringify(despues)} ${r.ok ? '' : r.error}`);
const p2 = (await verP(serie[1].id_cuenta_pagar)).cuenta;
rec('L-10', 'Serie por Frecuencia: al cambiar el monto se recalculan saldo, IGV e imponible de esa cuenta', Number(p2.saldo_pendiente) === 800 && Math.abs(Number(p2.monto_imponible) + Number(p2.monto_igv) - 800) < 0.01, `saldo=${p2.saldo_pendiente} imponible=${p2.monto_imponible} igv=${p2.monto_igv}`);

// L-11 el lápiz en Cuentas por Cobrar
let E = (await call('crear_cuenta_cobrar', { payload: { id_cliente: 1, id_centro_costo: obraC, monto: 5000, fecha_emision: HOY, observaciones: `${T} E` }, fracciones: cinco })).data?.data?.id_cuenta_cobrar;
let w = await verC(E);
const cuotasC = (x) => x.cobros.filter((c) => c.estado_cobro === 'programado').sort((a, b) => a.fecha_cobro.localeCompare(b.fecha_cobro) || a.id_cobro - b.id_cobro);
r = await call('editar_cuota_cobro', { id_cobro: cuotasC(w)[1].id_cobro, cambios: { monto: 1500 } });
w = await verC(E);
rec('L-11', 'Cobrar: el lápiz sube la cuota 2 a 1500 y la última se reajusta (500); el total sigue en 5000', r.ok && montos(cuotasC(w)) === '[1000,1500,1000,1000,500]' && (await audC(E)).inconsistencias_encontradas === 0, `cuotas=${montos(cuotasC(w))} ${r.ok ? '' : r.error}`);
r = await call('editar_cuota_cobro', { id_cobro: cuotasC(w)[0].id_cobro, cambios: { monto: 9000 } });
w = await verC(E);
rec('L-12', 'Cobrar: subir una cuota a 9000 en una cuenta de 5000 debería rechazarse', !r.ok || cuotasC(w).every((c) => Number(c.monto) > 0), r.ok ? `ACEPTADO — cuotas=${montos(cuotasC(w))}` : r.error);

console.log(`\n${results.length} casos: ${results.filter((x) => x.pass === true).length} PASS, ${results.filter((x) => x.pass === false).length} FAIL, ${results.filter((x) => x.pass === null).length} INFO`);
child.kill();
