/**
 * Herramientas de agente para Finanzas → Cuentas por Pagar. Lecturas siempre; escrituras solo en Dev
 * (ver registry.ts → filtrarPorEntorno). Las escrituras llaman a las funciones REALES de
 * cuentasPagar.service.ts (vía $lib, ver scripts/lib-resolver.mjs) para pasar por las mismas reglas de
 * negocio que la UI — nunca un INSERT crudo.
 */
import type { AgentTool } from '../registry.ts';
import { calcularFechasRecurrentes, computeEstadoCuentaPagar, createCuentaPagar, confirmarPagoPagado, createCuentasPagarRecurrentes, darDeBajaCuentaPagar, registrarPagoDesdeTransaccion, updateCuentaPagar, updatePago } from '$lib/modules/cuentas-pagar/services/cuentasPagar.service';
import { NOMBRE_AGENTE, USUARIO_AGENTE, desempaquetar, exigirNumero, exigirObjeto, limiteDe, redondear } from './_util.ts';

const CAMPOS_LISTADO =
	'id_cuenta_pagar, id_proveedor, id_centro_costo, num_documento, monto_comprometido, monto_pagado, saldo_pendiente, frecuencia_pago, fin_periodo_pago, fecha_emision, fecha_vencimiento, fecha_pago_programada, estado, prioridad, observacion, proveedor(razon_social)';

const listarCuentasPagar: AgentTool = {
	name: 'listar_cuentas_pagar',
	description:
		'Lista Cuentas por Pagar activas (no dadas de baja), más recientes primero. Filtros opcionales: id_proveedor, estado (pendiente|pagado|vencido), limit (default 50, máx 200). Una Cuenta por Pagar es una OBLIGACIÓN — el dinero real que salió está en sus pagos/transacciones (ver_cuenta_pagar).',
	inputSchema: {
		type: 'object',
		properties: {
			id_proveedor: { type: 'number' },
			estado: { type: 'string', enum: ['pendiente', 'pagado', 'vencido'] },
			limit: { type: 'number' }
		},
		additionalProperties: false
	},
	permiso: 'ver_cuentas_pagar',
	async handler(input, ctx) {
		let q = ctx.client.from('cuentas_pagar').select(CAMPOS_LISTADO).eq('activo', true).order('id_cuenta_pagar', { ascending: false }).limit(limiteDe(input.limit));
		if (input.id_proveedor !== undefined) q = q.eq('id_proveedor', exigirNumero(input.id_proveedor, 'id_proveedor'));
		if (input.estado !== undefined) q = q.eq('estado', String(input.estado));
		const { data, error } = await q;
		if (error) throw new Error(error.message);
		return data ?? [];
	}
};

const verCuentaPagar: AgentTool = {
	name: 'ver_cuenta_pagar',
	description:
		'Detalle de UNA Cuenta por Pagar (por id_cuenta_pagar) con todos sus pagos/cuotas (estado_pago: pagado | programado | cancelado) y las transacciones que respaldan los pagos ya realizados.',
	inputSchema: { type: 'object', properties: { id_cuenta_pagar: { type: 'number' } }, required: ['id_cuenta_pagar'], additionalProperties: false },
	permiso: 'ver_cuentas_pagar',
	async handler(input, ctx) {
		const id = exigirNumero(input.id_cuenta_pagar, 'id_cuenta_pagar');
		const [{ data: cuenta, error: e1 }, { data: pagos, error: e2 }] = await Promise.all([
			ctx.client.from('cuentas_pagar').select('*, proveedor(razon_social)').eq('id_cuenta_pagar', id).maybeSingle(),
			ctx.client.from('pagos').select('id_pago, monto, fecha_pago, medio_pago, estado_pago, id_transaccion, referencia').eq('id_cuenta_pagar', id).order('fecha_pago', { ascending: true }).order('id_pago', { ascending: true })
		]);
		if (e1) throw new Error(e1.message);
		if (e2) throw new Error(e2.message);
		if (!cuenta) throw new Error(`No existe ninguna cuenta por pagar con id_cuenta_pagar=${id}.`);
		const ids = (pagos ?? []).map((p) => p.id_transaccion).filter((x): x is number => x != null);
		const { data: transacciones } = ids.length
			? await ctx.client.from('transaccion').select('id_transaccion, fecha, tipo, categoria, monto_total, tipo_moneda, estado, id_centro_costo_origen, id_centro_costo_destino').in('id_transaccion', ids)
			: { data: [] };
		return { cuenta, pagos: pagos ?? [], transacciones: transacciones ?? [] };
	}
};

const auditarCuentasPagar: AgentTool = {
	name: 'auditar_cuentas_pagar',
	description:
		'Test de negocio: recalcula desde los pagos reales y reporta SOLO las inconsistencias de las Cuentas por Pagar activas (o de una sola con id_cuenta_pagar). Reglas: (1) monto_pagado = suma de pagos "pagado"; (2) saldo_pendiente = monto_comprometido − monto_pagado; (3) si la cuenta tiene cuotas programadas (fraccionada), pagado+programado debe sumar monto_comprometido; (4) todo pago "pagado" debe tener transacción de respaldo; (5) estado guardado = estado calculado; (6) el monto del pago = monto en soles de su transacción.',
	inputSchema: { type: 'object', properties: { id_cuenta_pagar: { type: 'number' } }, additionalProperties: false },
	permiso: 'ver_cuentas_pagar',
	async handler(input, ctx) {
		let qc = ctx.client.from('cuentas_pagar').select('id_cuenta_pagar, monto_comprometido, monto_pagado, saldo_pendiente, fecha_vencimiento, fecha_pago_programada, estado').eq('activo', true);
		if (input.id_cuenta_pagar !== undefined) qc = qc.eq('id_cuenta_pagar', exigirNumero(input.id_cuenta_pagar, 'id_cuenta_pagar'));
		const { data: cuentas, error } = await qc;
		if (error) throw new Error(error.message);
		const ids = (cuentas ?? []).map((c) => c.id_cuenta_pagar);
		const { data: pagos, error: e2 } = ids.length
			? await ctx.client.from('pagos').select('id_pago, id_cuenta_pagar, monto, estado_pago, id_transaccion').in('id_cuenta_pagar', ids)
			: { data: [], error: null };
		if (e2) throw new Error(e2.message);
		const idsTrx = (pagos ?? []).map((p) => p.id_transaccion).filter((x): x is number => x != null);
		const { data: trxs } = idsTrx.length ? await ctx.client.from('transaccion').select('id_transaccion, monto_total, tipo_moneda, monto_convertido, tipo_cambio').in('id_transaccion', idsTrx) : { data: [] };

		const inconsistencias: { id_cuenta_pagar: number; regla: string; detalle: string }[] = [];
		for (const c of cuentas ?? []) {
			const propios = (pagos ?? []).filter((p) => p.id_cuenta_pagar === c.id_cuenta_pagar);
			const pagado = redondear(propios.filter((p) => p.estado_pago === 'pagado').reduce((s, p) => s + Number(p.monto), 0));
			const comprometido = Number(c.monto_comprometido);
			const activas = redondear(propios.filter((p) => p.estado_pago !== 'cancelado').reduce((s, p) => s + Number(p.monto), 0));
			const add = (regla: string, detalle: string) => inconsistencias.push({ id_cuenta_pagar: c.id_cuenta_pagar, regla, detalle });
			if (redondear(Number(c.monto_pagado)) !== pagado) add('monto_pagado', `guardado ${c.monto_pagado}, suma de pagos "pagado" ${pagado}`);
			if (redondear(Number(c.saldo_pendiente)) !== redondear(comprometido - pagado)) add('saldo_pendiente', `guardado ${c.saldo_pendiente}, esperado ${redondear(comprometido - pagado)}`);
			if (propios.some((p) => p.estado_pago === 'programado') && activas !== redondear(comprometido)) add('suma_de_cuotas', `pagado+programado suma ${activas}, monto_comprometido ${comprometido}`);
			for (const p of propios) {
				if (p.estado_pago === 'pagado' && p.id_transaccion == null) add('pago_sin_transaccion', `pago #${p.id_pago} está "pagado" sin transacción de respaldo`);
				const t = (trxs ?? []).find((x) => x.id_transaccion === p.id_transaccion);
				if (p.estado_pago === 'pagado' && t) {
					const soles = t.tipo_moneda === 'dolares' ? Number(t.monto_convertido ?? Number(t.monto_total) * Number(t.tipo_cambio ?? 0)) : Number(t.monto_total);
					if (redondear(soles) !== redondear(Number(p.monto))) add('monto_pago_vs_transaccion', `pago #${p.id_pago} vale ${p.monto} pero su transacción #${t.id_transaccion} equivale a ${redondear(soles)} soles`);
				}
			}
			const esperado = computeEstadoCuentaPagar(redondear(comprometido - pagado), c.fecha_vencimiento, c.fecha_pago_programada);
			if (c.estado !== esperado) add('estado', `guardado "${c.estado}", calculado "${esperado}"`);
		}
		return { cuentas_revisadas: (cuentas ?? []).length, inconsistencias_encontradas: inconsistencias.length, inconsistencias };
	}
};

const crearCuentaPagar: AgentTool = {
	name: 'crear_cuenta_pagar',
	escritura: true,
	description:
		'[SOLO DEV] Crea UNA Cuenta por Pagar con createCuentaPagar (mismas validaciones que la UI). payload requiere id_proveedor, monto_comprometido, fecha_emision (YYYY-MM-DD); opcionales: id_centro_costo, moneda ("PEN" por defecto | "USD" con monto_dolares y tipo_cambio: monto_comprometido = dólares × TC), fecha_vencimiento, fotma_pago ("1" contado|"2" crédito|"3" porcentaje), frecuencia_pago ("sin_periodicidad" por defecto), observacion, etc. `fracciones` = [{fecha, monto}] reparte ESA cuenta en cuotas ("Fraccionar este pago") y debe sumar monto_comprometido. Para una serie periódica usar crear_serie_cuentas_pagar, no esta.',
	inputSchema: {
		type: 'object',
		properties: {
			payload: { type: 'object' },
			fracciones: { type: 'array', items: { type: 'object', properties: { fecha: { type: 'string' }, monto: { type: 'number' } }, required: ['fecha', 'monto'] } }
		},
		required: ['payload'],
		additionalProperties: false
	},
	permiso: 'crear_cuentas_pagar',
	async handler(input, ctx) {
		const payload = { frecuencia_pago: 'sin_periodicidad', ...exigirObjeto(input.payload, 'payload') };
		const fracciones = Array.isArray(input.fracciones) ? (input.fracciones as { fecha: string; monto: number }[]) : [];
		return desempaquetar(await createCuentaPagar(ctx.client, payload, USUARIO_AGENTE, fracciones));
	}
};

const crearSerieCuentasPagar: AgentTool = {
	name: 'crear_serie_cuentas_pagar',
	escritura: true,
	description:
		'[SOLO DEV] "Frecuencia de Pago": genera VARIAS Cuentas por Pagar de una vez (mensual|quincenal|semanal), cada una por el monto ÍNTEGRO de monto_comprometido (NO reparte el monto — eso es fraccionar). payload requiere id_proveedor, monto_comprometido, fecha_emision, frecuencia_pago y fin_periodo_pago; opcional fecha_vencimiento/fecha_pago_programada (se desplazan igual que la emisión).',
	inputSchema: { type: 'object', properties: { payload: { type: 'object' } }, required: ['payload'], additionalProperties: false },
	permiso: 'crear_cuentas_pagar',
	async handler(input, ctx) {
		const p = exigirObjeto(input.payload, 'payload');
		const fechas = calcularFechasRecurrentes(String(p.frecuencia_pago ?? ''), p.fecha_emision as string, p.fecha_vencimiento as string, p.fecha_pago_programada as string, p.fin_periodo_pago as string);
		return desempaquetar(await createCuentasPagarRecurrentes(ctx.client, p, USUARIO_AGENTE, fechas));
	}
};

const registrarPagoCuentaPagar: AgentTool = {
	name: 'registrar_pago_cuenta_pagar',
	escritura: true,
	description:
		'[SOLO DEV] Registra un pago REAL sobre una Cuenta por Pagar: crea la Transacción de egreso y la fila en pagos de forma atómica (registrarPagoDesdeTransaccion → RPC fn_confirmar_pago). `transaccion` requiere tipo_alcance ("externa"), id_centro_costo_origen, id_centro_costo_destino, fecha, categoria, monto_total, tipo ("egreso"), tipo_moneda ("soles"|"dolares"). El pago descuenta el monto EN SOLES de la transacción (en dólares: monto_total × tipo_cambio, que es obligatorio). Falla si supera lo que falta por cubrir (cuotas programadas ya cubren el 100%).',
	inputSchema: {
		type: 'object',
		properties: { id_cuenta_pagar: { type: 'number' }, transaccion: { type: 'object' } },
		required: ['id_cuenta_pagar', 'transaccion'],
		additionalProperties: false
	},
	permiso: 'crear_cuentas_pagar',
	async handler(input, ctx) {
		const id = exigirNumero(input.id_cuenta_pagar, 'id_cuenta_pagar');
		const t = { comprobante_url: 'agente://sin-comprobante', ...exigirObjeto(input.transaccion, 'transaccion') };
		return desempaquetar(await registrarPagoDesdeTransaccion(ctx.client, id, t, USUARIO_AGENTE, NOMBRE_AGENTE));
	}
};

const confirmarPagoCuota: AgentTool = {
	name: 'confirmar_pago_cuota',
	escritura: true,
	description:
		'[SOLO DEV] Paga una CUOTA programada existente (fila de pagos con estado_pago "programado", ver ver_cuenta_pagar): la pasa a "pagado" y crea su transacción de egreso, atómico (confirmarPagoPagado → fn_confirmar_pago con p_id_pago). Es la vía correcta para pagar una cuenta fraccionada; si la transacción es MENOR que la cuota, la cuota se parte (pagado por lo abonado + el resto sigue programado) y si es MAYOR se rechaza; registrar_pago_cuenta_pagar en cambio crea un pago NUEVO y se rechaza si las cuotas ya cubren el 100%. `transaccion` igual que en registrar_pago_cuenta_pagar (monto_total = monto de la cuota).',
	inputSchema: { type: 'object', properties: { id_pago: { type: 'number' }, transaccion: { type: 'object' } }, required: ['id_pago', 'transaccion'], additionalProperties: false },
	permiso: 'crear_cuentas_pagar',
	async handler(input, ctx) {
		const idPago = exigirNumero(input.id_pago, 'id_pago');
		const t = { comprobante_url: 'agente://sin-comprobante', ...exigirObjeto(input.transaccion, 'transaccion') };
		return desempaquetar(await confirmarPagoPagado(ctx.client, idPago, t, USUARIO_AGENTE, NOMBRE_AGENTE));
	}
};

const refraccionarCuentaPagar: AgentTool = {
	name: 'refraccionar_cuenta_pagar',
	escritura: true,
	description:
		'[SOLO DEV] Reemplaza el calendario de cuotas PENDIENTES de una Cuenta por Pagar — equivale a abrir "Editar" → "Configurar Cuotas" en la UI sin tocar ningún otro campo (updateCuentaPagar). Las cuotas ya "pagado" NO se tocan; solo se sustituyen las "programado" por `fracciones` = [{fecha, monto}] (deben sumar EXACTAMENTE monto_comprometido − monto_pagado; el servidor lo valida). Sirve para cambiar la periodicidad del saldo restante (ej. de mensual a semanal).',
	inputSchema: {
		type: 'object',
		properties: { id_cuenta_pagar: { type: 'number' }, fracciones: { type: 'array', items: { type: 'object', properties: { fecha: { type: 'string' }, monto: { type: 'number' } }, required: ['fecha', 'monto'] } } },
		required: ['id_cuenta_pagar', 'fracciones'],
		additionalProperties: false
	},
	permiso: 'editar_cuentas_pagar',
	async handler(input, ctx) {
		const id = exigirNumero(input.id_cuenta_pagar, 'id_cuenta_pagar');
		const { data: fila, error } = await ctx.client.from('cuentas_pagar').select('*').eq('id_cuenta_pagar', id).maybeSingle();
		if (error) throw new Error(error.message);
		if (!fila) throw new Error(`No existe ninguna cuenta por pagar con id_cuenta_pagar=${id}.`);
		const payload = Object.fromEntries(Object.entries(fila).map(([k, v]) => [k, v ?? '']));
		return desempaquetar(await updateCuentaPagar(ctx.client, id, payload, true, input.fracciones as { fecha: string; monto: number }[]));
	}
};

const actualizarCuentaPagar: AgentTool = {
	name: 'actualizar_cuenta_pagar',
	escritura: true,
	description:
		'[SOLO DEV] Edita campos de una Cuenta por Pagar como lo haría el formulario Editar (updateCuentaPagar, mismas validaciones): `cambios` se mezcla sobre los valores actuales (ej. {"frecuencia_pago":"semanal","fin_periodo_pago":"2027-06-30"}). NO toca las cuotas (conserva las "programado" existentes). Recalcula saldo y estado.',
	inputSchema: { type: 'object', properties: { id_cuenta_pagar: { type: 'number' }, cambios: { type: 'object' } }, required: ['id_cuenta_pagar', 'cambios'], additionalProperties: false },
	permiso: 'editar_cuentas_pagar',
	async handler(input, ctx) {
		const id = exigirNumero(input.id_cuenta_pagar, 'id_cuenta_pagar');
		const { data: fila, error } = await ctx.client.from('cuentas_pagar').select('*').eq('id_cuenta_pagar', id).maybeSingle();
		if (error) throw new Error(error.message);
		if (!fila) throw new Error(`No existe ninguna cuenta por pagar con id_cuenta_pagar=${id}.`);
		const { data: cuotas } = await ctx.client.from('pagos').select('fecha_pago, monto').eq('id_cuenta_pagar', id).eq('estado_pago', 'programado');
		const payload = { ...Object.fromEntries(Object.entries(fila).map(([k, v]) => [k, v ?? ''])), ...exigirObjeto(input.cambios, 'cambios') };
		const fracciones = (cuotas ?? []).map((c) => ({ fecha: c.fecha_pago as string, monto: Number(c.monto) }));
		return desempaquetar(await updateCuentaPagar(ctx.client, id, payload, true, fracciones));
	}
};

const darDeBajaCuentaPagarTool: AgentTool = {
	name: 'dar_de_baja_cuenta_pagar',
	escritura: true,
	description: '[SOLO DEV] Da de baja (soft-delete, activo=false) una Cuenta por Pagar — deja de listarse y de contar en las auditorías. No borra pagos ni transacciones.',
	inputSchema: { type: 'object', properties: { id_cuenta_pagar: { type: 'number' } }, required: ['id_cuenta_pagar'], additionalProperties: false },
	permiso: 'eliminar_cuentas_pagar',
	async handler(input, ctx) {
		return desempaquetar(await darDeBajaCuentaPagar(ctx.client, exigirNumero(input.id_cuenta_pagar, 'id_cuenta_pagar')));
	}
};

const editarCuotaPago: AgentTool = {
	name: 'editar_cuota_pago',
	escritura: true,
	description:
		'[SOLO DEV] El "lápiz" de una cuota: edita monto/fecha/medio/referencia de UNA fila de pagos (updatePago, mismas validaciones y reajustes que la UI). `cambios` se mezcla sobre los valores actuales (ej. {"monto":1500}); `estado_pago` opcional ("programado"|"cancelado" — pasar a "pagado" se hace con confirmar_pago_cuota). Si cambia el monto de una cuota programada, el sistema reajusta la ÚLTIMA cuota programada para que el total siga cuadrando.',
	inputSchema: {
		type: 'object',
		properties: { id_pago: { type: 'number' }, cambios: { type: 'object' }, estado_pago: { type: 'string', enum: ['programado', 'cancelado'] } },
		required: ['id_pago', 'cambios'],
		additionalProperties: false
	},
	permiso: 'editar_cuentas_pagar',
	async handler(input, ctx) {
		const id = exigirNumero(input.id_pago, 'id_pago');
		const { data: fila, error } = await ctx.client.from('pagos').select('monto, fecha_pago, medio_pago, num_operacion, referencia').eq('id_pago', id).maybeSingle();
		if (error) throw new Error(error.message);
		if (!fila) throw new Error(`No existe ningún pago con id_pago=${id}.`);
		const payload = { ...Object.fromEntries(Object.entries(fila).map(([k, v]) => [k, v ?? ''])), ...exigirObjeto(input.cambios, 'cambios') };
		return desempaquetar(await updatePago(ctx.client, id, payload, input.estado_pago as 'programado' | 'cancelado' | undefined, true));
	}
};

export const cuentasPagarTools: AgentTool[] = [listarCuentasPagar, verCuentaPagar, auditarCuentasPagar, crearCuentaPagar, crearSerieCuentasPagar, registrarPagoCuentaPagar, confirmarPagoCuota, refraccionarCuentaPagar, actualizarCuentaPagar, darDeBajaCuentaPagarTool, editarCuotaPago];
