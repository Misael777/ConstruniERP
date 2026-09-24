/**
 * Herramientas de agente para Finanzas → Cuentas por Cobrar. Mismo criterio que cuentas-pagar.ts:
 * lecturas siempre, escrituras solo en Dev, escrituras vía las funciones REALES de
 * cuentasCobrar.service.ts. OJO: a diferencia de Pagar, Cobrar NO tiene "Frecuencia de Pago"/series
 * periódicas — solo fraccionamiento en cuotas.
 */
import type { AgentTool } from '../registry.ts';
import { computeEstadoCuentaCobrar, confirmarCobroCobrado, createCuentaCobrar, registrarCobroDesdeTransaccion, updateCuentaCobrar } from '$lib/modules/cuentas-cobrar/services/cuentasCobrar.service';
import { NOMBRE_AGENTE, USUARIO_AGENTE, desempaquetar, exigirNumero, exigirObjeto, limiteDe, redondear } from './_util.ts';

const CAMPOS_LISTADO =
	'id_cuenta_cobrar, id_cliente, id_centro_costo, id_proyecto, num_documento, monto, monto_cobrado, saldo_pendiente, moneda, fecha_emision, fecha_vencimiento, estado, prioridad, observaciones, cliente(nombre)';

const listarCuentasCobrar: AgentTool = {
	name: 'listar_cuentas_cobrar',
	description:
		'Lista Cuentas por Cobrar activas (no dadas de baja), más recientes primero. Filtros opcionales: id_cliente, estado (pendiente|pagado|vencido), limit (default 50, máx 200). Una Cuenta por Cobrar es lo que te DEBEN; su monto_cobrado/saldo_pendiente se derivan de SUS PROPIOS cobros "cobrado" (igual que Pagar con sus pagos). Su monto está siempre en soles (con moneda USD = monto_dolares × tipo_cambio).',
	inputSchema: {
		type: 'object',
		properties: { id_cliente: { type: 'number' }, estado: { type: 'string' }, limit: { type: 'number' } },
		additionalProperties: false
	},
	permiso: 'ver_cuentas_cobrar',
	async handler(input, ctx) {
		let q = ctx.client.from('cuentas_cobrar').select(CAMPOS_LISTADO).eq('activo', true).order('id_cuenta_cobrar', { ascending: false }).limit(limiteDe(input.limit));
		if (input.id_cliente !== undefined) q = q.eq('id_cliente', exigirNumero(input.id_cliente, 'id_cliente'));
		if (input.estado !== undefined) q = q.eq('estado', String(input.estado));
		const { data, error } = await q;
		if (error) throw new Error(error.message);
		return data ?? [];
	}
};

const verCuentaCobrar: AgentTool = {
	name: 'ver_cuenta_cobrar',
	description:
		'Detalle de UNA Cuenta por Cobrar (por id_cuenta_cobrar) con todos sus cobros/cuotas (estado_cobro: cobrado | programado | cancelado) y las transacciones que respaldan los cobros ya realizados.',
	inputSchema: { type: 'object', properties: { id_cuenta_cobrar: { type: 'number' } }, required: ['id_cuenta_cobrar'], additionalProperties: false },
	permiso: 'ver_cuentas_cobrar',
	async handler(input, ctx) {
		const id = exigirNumero(input.id_cuenta_cobrar, 'id_cuenta_cobrar');
		const [{ data: cuenta, error: e1 }, { data: cobros, error: e2 }] = await Promise.all([
			ctx.client.from('cuentas_cobrar').select('*, cliente(nombre), proyecto(nombre_proyecto)').eq('id_cuenta_cobrar', id).maybeSingle(),
			ctx.client.from('cobros').select('id_cobro, monto, fecha_cobro, medio_cobro, estado_cobro, id_transaccion, referencia').eq('id_cuenta_cobrar', id).order('fecha_cobro', { ascending: true }).order('id_cobro', { ascending: true })
		]);
		if (e1) throw new Error(e1.message);
		if (e2) throw new Error(e2.message);
		if (!cuenta) throw new Error(`No existe ninguna cuenta por cobrar con id_cuenta_cobrar=${id}.`);
		const ids = (cobros ?? []).map((c) => c.id_transaccion).filter((x): x is number => x != null);
		const { data: transacciones } = ids.length
			? await ctx.client.from('transaccion').select('id_transaccion, fecha, tipo, categoria, monto_total, tipo_moneda, estado, id_centro_costo_origen, id_centro_costo_destino').in('id_transaccion', ids)
			: { data: [] };
		return { cuenta, cobros: cobros ?? [], transacciones: transacciones ?? [] };
	}
};

const auditarCuentasCobrar: AgentTool = {
	name: 'auditar_cuentas_cobrar',
	description:
		'Test de negocio: recalcula y reporta SOLO las inconsistencias de las Cuentas por Cobrar activas (o de una sola con id_cuenta_cobrar). Espeja fn_recalcular_cuenta_cobrar: (1) monto_cobrado = suma de sus cobros "cobrado"; (2) saldo_pendiente = max(monto − monto_cobrado, 0); (3) si la cuenta tiene cuotas programadas (fraccionada), cobrado+programado debe sumar monto; (4) todo cobro "cobrado" debe tener transacción de respaldo; (5) estado guardado = pagado si saldo 0, vencido si pasó fecha_vencimiento, si no pendiente; (6) el monto del cobro = monto en soles de su transacción.',
	inputSchema: { type: 'object', properties: { id_cuenta_cobrar: { type: 'number' } }, additionalProperties: false },
	permiso: 'ver_cuentas_cobrar',
	async handler(input, ctx) {
		let qc = ctx.client.from('cuentas_cobrar').select('id_cuenta_cobrar, monto, monto_cobrado, saldo_pendiente, fecha_vencimiento, estado').eq('activo', true);
		if (input.id_cuenta_cobrar !== undefined) qc = qc.eq('id_cuenta_cobrar', exigirNumero(input.id_cuenta_cobrar, 'id_cuenta_cobrar'));
		const { data: cuentas, error } = await qc;
		if (error) throw new Error(error.message);
		const ids = (cuentas ?? []).map((c) => c.id_cuenta_cobrar);
		const { data: cobros, error: e2 } = ids.length
			? await ctx.client.from('cobros').select('id_cobro, id_cuenta_cobrar, monto, estado_cobro, id_transaccion').in('id_cuenta_cobrar', ids)
			: { data: [], error: null };
		if (e2) throw new Error(e2.message);
		const idsTrx = (cobros ?? []).map((c) => c.id_transaccion).filter((x): x is number => x != null);
		const { data: trxs } = idsTrx.length
			? await ctx.client.from('transaccion').select('id_transaccion, monto_total, tipo_moneda, monto_convertido, tipo_cambio').in('id_transaccion', idsTrx)
			: { data: [] };

		const inconsistencias: { id_cuenta_cobrar: number; regla: string; detalle: string }[] = [];
		for (const c of cuentas ?? []) {
			const propios = (cobros ?? []).filter((x) => x.id_cuenta_cobrar === c.id_cuenta_cobrar);
			const cobrado = redondear(propios.filter((x) => x.estado_cobro === 'cobrado').reduce((s, x) => s + Number(x.monto), 0));
			const monto = Number(c.monto);
			const saldoEsperado = redondear(Math.max(monto - cobrado, 0));
			const activas = redondear(propios.filter((x) => x.estado_cobro !== 'cancelado').reduce((s, x) => s + Number(x.monto), 0));
			const add = (regla: string, detalle: string) => inconsistencias.push({ id_cuenta_cobrar: c.id_cuenta_cobrar, regla, detalle });
			if (redondear(Number(c.monto_cobrado)) !== cobrado) add('monto_cobrado', `guardado ${c.monto_cobrado}, suma de cobros "cobrado" ${cobrado}`);
			if (redondear(Number(c.saldo_pendiente)) !== saldoEsperado) add('saldo_pendiente', `guardado ${c.saldo_pendiente}, esperado ${saldoEsperado}`);
			if (propios.some((x) => x.estado_cobro === 'programado') && activas !== redondear(monto)) add('suma_de_cuotas', `cobrado+programado suma ${activas}, monto ${monto}`);
			for (const x of propios) {
				if (x.estado_cobro === 'cobrado' && x.id_transaccion == null) add('cobro_sin_transaccion', `cobro #${x.id_cobro} está "cobrado" sin transacción de respaldo`);
				const t = (trxs ?? []).find((y) => y.id_transaccion === x.id_transaccion);
				if (x.estado_cobro === 'cobrado' && t) {
					const soles = t.tipo_moneda === 'dolares' ? Number(t.monto_convertido ?? Number(t.monto_total) * Number(t.tipo_cambio ?? 0)) : Number(t.monto_total);
					if (redondear(soles) !== redondear(Number(x.monto))) add('monto_cobro_vs_transaccion', `cobro #${x.id_cobro} vale ${x.monto} pero su transacción #${t.id_transaccion} equivale a ${redondear(soles)} soles`);
				}
			}
			const esperado = computeEstadoCuentaCobrar(saldoEsperado, c.fecha_vencimiento);
			if (c.estado !== esperado) add('estado', `guardado "${c.estado}", calculado "${esperado}"`);
		}
		return { cuentas_revisadas: (cuentas ?? []).length, inconsistencias_encontradas: inconsistencias.length, inconsistencias };
	}
};

const crearCuentaCobrar: AgentTool = {
	name: 'crear_cuenta_cobrar',
	escritura: true,
	description:
		'[SOLO DEV] Crea una Cuenta por Cobrar con createCuentaCobrar (mismas validaciones que la UI). payload requiere id_cliente, id_centro_costo (el centro que RECIBE el ingreso — normalmente el del proyecto/venta), monto, fecha_emision (YYYY-MM-DD); opcionales: id_proyecto, fecha_vencimiento, moneda, observaciones. `fracciones` = [{fecha, monto}] reparte la cuenta en cuotas y debe sumar monto.',
	inputSchema: {
		type: 'object',
		properties: {
			payload: { type: 'object' },
			fracciones: { type: 'array', items: { type: 'object', properties: { fecha: { type: 'string' }, monto: { type: 'number' } }, required: ['fecha', 'monto'] } }
		},
		required: ['payload'],
		additionalProperties: false
	},
	permiso: 'crear_cuentas_cobrar',
	async handler(input, ctx) {
		const fracciones = Array.isArray(input.fracciones) ? (input.fracciones as { fecha: string; monto: number }[]) : [];
		return desempaquetar(await createCuentaCobrar(ctx.client, exigirObjeto(input.payload, 'payload'), USUARIO_AGENTE, fracciones));
	}
};

const registrarCobroCuentaCobrar: AgentTool = {
	name: 'registrar_cobro_cuenta_cobrar',
	escritura: true,
	description:
		'[SOLO DEV] Registra un cobro REAL sobre una Cuenta por Cobrar: crea la Transacción de ingreso y la fila en cobros de forma atómica (registrarCobroDesdeTransaccion → RPC fn_confirmar_cobro). `transaccion` requiere tipo_alcance ("externa"), id_centro_costo_origen (centro del cliente), id_centro_costo_destino, fecha, categoria, monto_total, tipo ("ingreso"), tipo_moneda. Falla si el monto supera lo que falta por cubrir (cuotas programadas ya cubren el 100%).',
	inputSchema: {
		type: 'object',
		properties: { id_cuenta_cobrar: { type: 'number' }, transaccion: { type: 'object' } },
		required: ['id_cuenta_cobrar', 'transaccion'],
		additionalProperties: false
	},
	permiso: 'crear_cuentas_cobrar',
	async handler(input, ctx) {
		const id = exigirNumero(input.id_cuenta_cobrar, 'id_cuenta_cobrar');
		const t = { comprobante_url: 'agente://sin-comprobante', ...exigirObjeto(input.transaccion, 'transaccion') };
		return desempaquetar(await registrarCobroDesdeTransaccion(ctx.client, id, t, USUARIO_AGENTE, NOMBRE_AGENTE));
	}
};

const confirmarCobroCuota: AgentTool = {
	name: 'confirmar_cobro_cuota',
	escritura: true,
	description:
		'[SOLO DEV] Cobra una CUOTA programada existente (fila de cobros con estado_cobro "programado", ver ver_cuenta_cobrar): la pasa a "cobrado" y crea su transacción de ingreso, atómico (confirmarCobroCobrado → fn_confirmar_cobro con p_id_cobro). Vía correcta para cobrar una cuenta fraccionada; una transacción MENOR que la cuota la parte (cobrado + resto programado), una MAYOR se rechaza. `transaccion` igual que en registrar_cobro_cuenta_cobrar.',
	inputSchema: { type: 'object', properties: { id_cobro: { type: 'number' }, transaccion: { type: 'object' } }, required: ['id_cobro', 'transaccion'], additionalProperties: false },
	permiso: 'crear_cuentas_cobrar',
	async handler(input, ctx) {
		const idCobro = exigirNumero(input.id_cobro, 'id_cobro');
		const t = { comprobante_url: 'agente://sin-comprobante', ...exigirObjeto(input.transaccion, 'transaccion') };
		return desempaquetar(await confirmarCobroCobrado(ctx.client, idCobro, t, USUARIO_AGENTE, NOMBRE_AGENTE));
	}
};

const refraccionarCuentaCobrar: AgentTool = {
	name: 'refraccionar_cuenta_cobrar',
	escritura: true,
	description:
		'[SOLO DEV] Reemplaza el calendario de cuotas PENDIENTES de una Cuenta por Cobrar (equivale a Editar → Configurar Cuotas, updateCuentaCobrar). Las cuotas ya "cobrado" no se tocan; las "programado" se sustituyen por `fracciones` = [{fecha, monto}] (deben sumar EXACTAMENTE monto − monto_cobrado; el servidor lo valida).',
	inputSchema: {
		type: 'object',
		properties: { id_cuenta_cobrar: { type: 'number' }, fracciones: { type: 'array', items: { type: 'object', properties: { fecha: { type: 'string' }, monto: { type: 'number' } }, required: ['fecha', 'monto'] } } },
		required: ['id_cuenta_cobrar', 'fracciones'],
		additionalProperties: false
	},
	permiso: 'editar_cuentas_cobrar',
	async handler(input, ctx) {
		const id = exigirNumero(input.id_cuenta_cobrar, 'id_cuenta_cobrar');
		const { data: fila, error } = await ctx.client.from('cuentas_cobrar').select('*').eq('id_cuenta_cobrar', id).maybeSingle();
		if (error) throw new Error(error.message);
		if (!fila) throw new Error(`No existe ninguna cuenta por cobrar con id_cuenta_cobrar=${id}.`);
		const payload = Object.fromEntries(Object.entries(fila).map(([k, v]) => [k, v ?? '']));
		return desempaquetar(await updateCuentaCobrar(ctx.client, id, payload, true, input.fracciones as { fecha: string; monto: number }[]));
	}
};

const actualizarCuentaCobrar: AgentTool = {
	name: 'actualizar_cuenta_cobrar',
	escritura: true,
	description:
		'[SOLO DEV] Edita campos de una Cuenta por Cobrar como lo haría el formulario Editar (updateCuentaCobrar, mismas validaciones): `cambios` se mezcla sobre los valores actuales. NO toca las cuotas (conserva las "programado" existentes). Recalcula saldo y estado.',
	inputSchema: { type: 'object', properties: { id_cuenta_cobrar: { type: 'number' }, cambios: { type: 'object' } }, required: ['id_cuenta_cobrar', 'cambios'], additionalProperties: false },
	permiso: 'editar_cuentas_cobrar',
	async handler(input, ctx) {
		const id = exigirNumero(input.id_cuenta_cobrar, 'id_cuenta_cobrar');
		const { data: fila, error } = await ctx.client.from('cuentas_cobrar').select('*').eq('id_cuenta_cobrar', id).maybeSingle();
		if (error) throw new Error(error.message);
		if (!fila) throw new Error(`No existe ninguna cuenta por cobrar con id_cuenta_cobrar=${id}.`);
		const { data: cuotas } = await ctx.client.from('cobros').select('fecha_cobro, monto').eq('id_cuenta_cobrar', id).eq('estado_cobro', 'programado');
		const payload = { ...Object.fromEntries(Object.entries(fila).map(([k, v]) => [k, v ?? ''])), ...exigirObjeto(input.cambios, 'cambios') };
		const fracciones = (cuotas ?? []).map((c) => ({ fecha: c.fecha_cobro as string, monto: Number(c.monto) }));
		return desempaquetar(await updateCuentaCobrar(ctx.client, id, payload, true, fracciones));
	}
};

export const cuentasCobrarTools: AgentTool[] = [listarCuentasCobrar, verCuentaCobrar, auditarCuentasCobrar, crearCuentaCobrar, registrarCobroCuentaCobrar, confirmarCobroCuota, refraccionarCuentaCobrar, actualizarCuentaCobrar];
