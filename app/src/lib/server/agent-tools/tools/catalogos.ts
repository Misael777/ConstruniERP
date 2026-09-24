/**
 * Herramientas de agente de apoyo (catálogos + transacciones) — lo mínimo para poder ARMAR y VERIFICAR
 * los escenarios de negocio de cuentas por pagar/cobrar: encontrar ids de proveedores, clientes y
 * centros de costo, ver saldos de cuentas bancarias, y crear/listar transacciones sueltas.
 */
import type { AgentTool } from '../registry.ts';
import { crearTransaccionSistema } from '$lib/modules/transacciones/services/transacciones.service';
import { NOMBRE_AGENTE, USUARIO_AGENTE, desempaquetar, exigirNumero, exigirObjeto, limiteDe } from './_util.ts';

const listarProveedores: AgentTool = {
	name: 'listar_proveedores',
	description: 'Lista proveedores (id_proveedor, razon_social, ruc, vendedor = producto/servicio, estado) con el id de su centro de costo automático. limit default 50, máx 200.',
	inputSchema: { type: 'object', properties: { limit: { type: 'number' } }, additionalProperties: false },
	permiso: 'ver_proveedores',
	async handler(input, ctx) {
		const { data, error } = await ctx.client.from('proveedor').select('id_proveedor, razon_social, ruc, vendedor, estado, centro_costo(id_centro_costo, tipo)').order('id_proveedor', { ascending: false }).limit(limiteDe(input.limit));
		if (error) throw new Error(error.message);
		return data ?? [];
	}
};

const listarClientes: AgentTool = {
	name: 'listar_clientes',
	description: 'Lista clientes (id_cliente, nombre, tipo_doc, num_documento, estado) con el id de su centro de costo automático. limit default 50, máx 200.',
	inputSchema: { type: 'object', properties: { limit: { type: 'number' } }, additionalProperties: false },
	permiso: 'ver_clientes',
	async handler(input, ctx) {
		const { data, error } = await ctx.client.from('cliente').select('id_cliente, nombre, tipo_doc, num_documento, estado, centro_costo(id_centro_costo, tipo)').order('id_cliente', { ascending: false }).limit(limiteDe(input.limit));
		if (error) throw new Error(error.message);
		return data ?? [];
	}
};

const listarCentrosCosto: AgentTool = {
	name: 'listar_centros_costo',
	description:
		'Lista centros de costo con su tipo (proyecto|consultoria|cliente|proveedor|subcontratista|empleado|bolsa general|prestamo|otro), estado y la entidad dueña (id_proyecto/id_cliente/id_proveedor/id_empleado). Filtro opcional: tipo. Se necesitan sus ids como origen/destino de toda transacción.',
	inputSchema: { type: 'object', properties: { tipo: { type: 'string' }, limit: { type: 'number' } }, additionalProperties: false },
	permiso: 'ver_centro_costos',
	async handler(input, ctx) {
		let q = ctx.client.from('centro_costo').select('id_centro_costo, codigo, nombre, tipo, estado, id_proyecto, id_cliente, id_proveedor, id_empleado').order('id_centro_costo', { ascending: true }).limit(limiteDe(input.limit, 100, 500));
		if (input.tipo !== undefined) q = q.eq('tipo', String(input.tipo));
		const { data, error } = await q;
		if (error) throw new Error(error.message);
		return data ?? [];
	}
};

const listarCuentasBancarias: AgentTool = {
	name: 'listar_cuentas_bancarias',
	description: 'Lista cuentas bancarias con saldo_inicial y saldo_actual (siempre derivado, nunca escrito a mano).',
	inputSchema: { type: 'object', properties: {}, additionalProperties: false },
	permiso: 'ver_cuentas_bancarias',
	async handler(_input, ctx) {
		const { data, error } = await ctx.client.from('cuenta_banco').select('id_cuenta_banco, numero_cuenta, titular_cuenta, nombre_banco, tipo_cuenta, tipo_moneda, estado, saldo_inicial, saldo_actual').eq('activo', true).order('id_cuenta_banco');
		if (error) throw new Error(error.message);
		return data ?? [];
	}
};

const listarTransacciones: AgentTool = {
	name: 'listar_transacciones',
	description:
		'Lista transacciones (el movimiento REAL de dinero), más recientes primero. Filtros opcionales: id_centro_costo (como origen o destino), tipo (ingreso|egreso|financiamiento|transferencia), limit (default 50, máx 200).',
	inputSchema: {
		type: 'object',
		properties: { id_centro_costo: { type: 'number' }, tipo: { type: 'string' }, limit: { type: 'number' } },
		additionalProperties: false
	},
	permiso: 'ver_transacciones',
	async handler(input, ctx) {
		let q = ctx.client
			.from('transaccion')
			.select('id_transaccion, fecha, tipo, tipo_alcance, categoria, monto_total, tipo_moneda, tipo_cambio, estado, aprobado, id_centro_costo_origen, id_centro_costo_destino, descripcion, documento_pendiente, id_factura')
			.order('id_transaccion', { ascending: false })
			.limit(limiteDe(input.limit));
		if (input.id_centro_costo !== undefined) {
			const c = exigirNumero(input.id_centro_costo, 'id_centro_costo');
			q = q.or(`id_centro_costo_origen.eq.${c},id_centro_costo_destino.eq.${c}`);
		}
		if (input.tipo !== undefined) q = q.eq('tipo', String(input.tipo));
		const { data, error } = await q;
		if (error) throw new Error(error.message);
		return data ?? [];
	}
};

const crearTransaccion: AgentTool = {
	name: 'crear_transaccion',
	escritura: true,
	description:
		'[SOLO DEV] Crea una Transacción suelta con crearTransaccionSistema (RPC fn_crear_transaccion; no exige comprobante). payload requiere tipo_alcance ("interna"|"externa"), id_centro_costo_origen, id_centro_costo_destino, fecha, categoria (del catálogo, ej. Adelanto/Valorización/Compras/Servicios/Honorarios), monto_total, tipo, tipo_moneda ("soles"|"dolares"); opcionales: descripcion, tipo_cambio (si dólares), documento_pendiente, cuente_origen/cuente_destino (numero_cuenta de cuenta_banco, mueve su saldo). Para pagar/cobrar una cuenta usar registrar_pago_cuenta_pagar / registrar_cobro_cuenta_cobrar, no esta.',
	inputSchema: { type: 'object', properties: { payload: { type: 'object' } }, required: ['payload'], additionalProperties: false },
	permiso: 'crear_transacciones',
	async handler(input, ctx) {
		return desempaquetar(await crearTransaccionSistema(ctx.client, exigirObjeto(input.payload, 'payload'), USUARIO_AGENTE, NOMBRE_AGENTE));
	}
};

export const catalogosTools: AgentTool[] = [listarProveedores, listarClientes, listarCentrosCosto, listarCuentasBancarias, listarTransacciones, crearTransaccion];
