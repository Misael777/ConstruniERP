// Seed de datos sintéticos para construnierp-dev — Fase B, paso 5 del plan de Desarrollo/Testing
// (floating-snuggling-corbato.md). Sigue EXACTAMENTE el orden de
// "Documentacion/FlujoDeNegocio.md#orden-recomendado-para-llenar-el-erp-desde-cero".
//
// Reusa las funciones de servicio REALES del ERP (importadas vía $lib/..., ver lib-resolver.mjs) para
// que el dato de prueba pase por las mismas reglas de negocio que pasaría un dato real (auto-creación
// de Centro de Costo, cálculo de saldo, RPCs de integridad financiera, etc.) — nada de INSERTs crudos
// salvo en los 5 puntos donde el módulo real no tiene capa de servicio propia (Empleados, Clientes,
// Proveedores, Ventas/Proyecto, Facturación-borrador), documentados en cada sección de abajo.
//
// Idempotente: cada entidad se busca por un nombre/correo fijo antes de crearla — correr esto varias
// veces no duplica nada, solo reusa lo que ya existe y completa lo que falte.
//
// Uso: npm run seed:dev   (carga app/.env.dev — VER LA GUARDA DE SEGURIDAD MÁS ABAJO)

import { createClient } from '@supabase/supabase-js';
import { getOrCrearCentroCostoParaEntidad, getOrCrearCentroCostoCompartido, sincronizarTipoCentroCostoProveedor, actualizarSaldoCentroCostoProyecto } from '$lib/modules/centro-costos/services/centroCostos.service';
import { createCuentaBanco } from '$lib/modules/cuentas-bancarias/services/cuentaBanco.service';
import { createCuentaPagar, createCuentasPagarRecurrentes, calcularFechasRecurrentes, registrarPagoDesdeTransaccion } from '$lib/modules/cuentas-pagar/services/cuentasPagar.service';
import { createCuentaCobrar, registrarCobroDesdeTransaccion } from '$lib/modules/cuentas-cobrar/services/cuentasCobrar.service';
import { crearTransaccionSistema } from '$lib/modules/transacciones/services/transacciones.service';

// ── Guarda de seguridad: este script NUNCA debe poder escribir en Producción ──────────────────────
const DEV_PROJECT_REF = 'hlfaxszecrxgkbjafepv';
const supabaseUrl = process.env.PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceKey) {
	console.error('Faltan PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY. Corré esto con: npm run seed:dev (carga app/.env.dev)');
	process.exit(1);
}
if (!supabaseUrl.includes(DEV_PROJECT_REF)) {
	console.error(`SEGURIDAD: este script SOLO puede correr contra el proyecto Dev (${DEV_PROJECT_REF}).`);
	console.error(`URL detectada: ${supabaseUrl} — no coincide. Abortando sin escribir nada.`);
	process.exit(1);
}

const client = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

const SEED_USUARIO = 'seed-dev-script';
const SEED_NOMBRE = 'Seed Script';
const hoy = new Date().toISOString().slice(0, 10);
const enDias = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const enMeses = (n) => {
	const d = new Date();
	d.setMonth(d.getMonth() + n);
	return d.toISOString().slice(0, 10);
};

function ok(label, r) {
	if (r && typeof r === 'object' && 'success' in r && !r.success) {
		throw new Error(`${label}: ${r.message}${r.errors ? ' — ' + JSON.stringify(r.errors) : ''}`);
	}
	console.log(`  ✓ ${label}`);
	return r;
}

async function encontrarOCrear(tabla, columnaFiltro, valorFiltro, columnaId, crearFn) {
	const { data: existente } = await client.from(tabla).select(columnaId).eq(columnaFiltro, valorFiltro).maybeSingle();
	if (existente) {
		console.log(`  = ${tabla}.${columnaFiltro}='${valorFiltro}' ya existe, se reusa`);
		return existente[columnaId];
	}
	return crearFn();
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// 1. Empleados + Roles y Permisos (FlujoDeNegocio.md sección 0)
// ═══════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[1/8] Empleados + Roles y Permisos');

async function encontrarOCrearRol(nombre) {
	const { data: existente } = await client.from('roles').select('id').eq('nombre', nombre).maybeSingle();
	if (existente) return existente.id;
	const { data, error } = await client.from('roles').insert({ nombre, descripcion: `Rol '${nombre}' (creado por seed-dev)` }).select('id').single();
	if (error) throw new Error(`No se pudo crear el rol '${nombre}': ${error.message}`);
	return data.id;
}

const rolAdminId = await encontrarOCrearRol('administrador');
const rolAsesorId = await encontrarOCrearRol('asesor');

async function crearEmpleado(nombre, correo, rolId, salario) {
	return encontrarOCrear('empleados', 'correo', correo, 'id', async () => {
		const { data, error } = await client
			.from('empleados')
			.insert({ nombre, correo, rol_id: rolId, fecha_ingreso: hoy, salario, estado: 'activo' })
			.select('id')
			.single();
		if (error) throw new Error(`No se pudo crear empleado ${nombre}: ${error.message}`);
		await getOrCrearCentroCostoParaEntidad(client, 'empleado', data.id, nombre);
		console.log(`  ✓ empleado creado: ${nombre} (#${data.id})`);
		return data.id;
	});
}

const empleadoAdminId = await crearEmpleado('Ana Torres (SEED)', 'ana.torres@seed.construnierp.dev', rolAdminId, 6500);
const empleadoAsesorId = await crearEmpleado('Carlos Ramírez (SEED)', 'carlos.ramirez@seed.construnierp.dev', rolAsesorId, 3200);

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// 2. Clientes y Proveedores (sección 1) — sin capa de servicio propia, se mirra el insert real de
//    ClienteModal.svelte/ProveedorModal.svelte, y se llama a getOrCrearCentroCostoParaEntidad igual
//    que esos componentes hacen justo después de guardar.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[2/8] Clientes y Proveedores');

async function crearCliente({ tip_persona, nombre, tipo_doc, num_documento, direccion, telefono, email }) {
	return encontrarOCrear('cliente', 'nombre', nombre, 'id_cliente', async () => {
		const { data, error } = await client
			.from('cliente')
			.insert({ tip_persona, nombre, tipo_doc, num_documento, direccion, telefono, email, updated_at: new Date().toISOString() })
			.select('id_cliente')
			.single();
		if (error) throw new Error(`No se pudo crear cliente ${nombre}: ${error.message}`);
		await getOrCrearCentroCostoParaEntidad(client, 'cliente', data.id_cliente, nombre);
		console.log(`  ✓ cliente creado: ${nombre} (#${data.id_cliente})`);
		return data.id_cliente;
	});
}

const cliente1Id = await crearCliente({
	tip_persona: 'J', nombre: 'Inversiones Delta SAC (SEED)', tipo_doc: 'RUC', num_documento: '20601234567',
	direccion: 'Av. Javier Prado 1234, San Isidro', telefono: '014567890', email: 'contacto@delta-seed.dev'
});
const cliente2Id = await crearCliente({
	tip_persona: 'N', nombre: 'María Fernanda Quispe (SEED)', tipo_doc: 'DNI', num_documento: '45678912',
	direccion: 'Calle Los Pinos 456, Surco', telefono: '987654321', email: 'mfquispe-seed@example.dev'
});

async function crearProveedor({ razon_social, ruc, vendedor, telefono, email }) {
	return encontrarOCrear('proveedor', 'razon_social', razon_social, 'id_proveedor', async () => {
		const { data, error } = await client
			.from('proveedor')
			.insert({ razon_social, ruc, vendedor, telefono, email, updated_at: new Date().toISOString() })
			.select('id_proveedor')
			.single();
		if (error) throw new Error(`No se pudo crear proveedor ${razon_social}: ${error.message}`);
		await getOrCrearCentroCostoParaEntidad(client, 'proveedor', data.id_proveedor, razon_social);
		await sincronizarTipoCentroCostoProveedor(client, data.id_proveedor, vendedor);
		console.log(`  ✓ proveedor creado: ${razon_social} (#${data.id_proveedor})`);
		return data.id_proveedor;
	});
}

const proveedor1Id = await crearProveedor({
	razon_social: 'Aceros Arequipa Distribuidora SAC (SEED)', ruc: '20112345678',
	vendedor: 'Materiales de Construcción', telefono: '014001122', email: 'ventas@aceros-seed.dev'
});
const proveedor2Id = await crearProveedor({
	razon_social: 'Subcontrata Estructuras JR EIRL (SEED)', ruc: '20198765432',
	vendedor: 'SUBCONTRATISTA - OBRA', telefono: '014003344', email: 'contacto@estructurasjr-seed.dev'
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// 3. Ventas/Proyectos: una de Obra y una de Consultoría, cerradas (sección 3) — sin capa de servicio
//    propia, se mirra el insert real de NuevaVentaModal.svelte y el cierre real de
//    cerrarVentaAprobada (aprobaciones.service.ts, no importable en Node puro por su import de
//    permisos.svelte — se replica su lógica de cierre paso a paso).
// ═══════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[3/8] Ventas/Proyectos (Obra + Consultoría, cerradas)');

async function crearYCerrarVenta({ id_cliente, nombre_proyecto, tipo_venta, precio_venta, responsable }) {
	let idProyecto = await encontrarOCrear('proyecto', 'nombre_proyecto', nombre_proyecto, 'id_proyecto', async () => {
		const { data, error } = await client
			.from('proyecto')
			.insert({
				id_cliente, nombre_proyecto, tipo_venta, precio_venta, costo_estima: precio_venta,
				estado_proyecto: 'activo', responsable, fecha_inicio_plan: hoy, usuario_registro: SEED_USUARIO
			})
			.select('id_proyecto')
			.single();
		if (error) throw new Error(`No se pudo crear proyecto ${nombre_proyecto}: ${error.message}`);
		console.log(`  ✓ proyecto creado: ${nombre_proyecto} (#${data.id_proyecto})`);
		return data.id_proyecto;
	});

	const { data: proyectoActual } = await client.from('proyecto').select('estado_proyecto').eq('id_proyecto', idProyecto).single();
	if (proyectoActual.estado_proyecto === 'venta_cerrada') {
		const { data: centro } = await client.from('centro_costo').select('id_centro_costo').eq('id_proyecto', idProyecto).maybeSingle();
		console.log(`  = venta ya estaba cerrada: ${nombre_proyecto}`);
		return { idProyecto, idCentroProyecto: centro?.id_centro_costo ?? null };
	}

	// Mirroring cerrarVentaAprobada (aprobaciones.service.ts): centro de costo propio del proyecto
	// (compartido por código para Consultoría, propio por proyecto para Obra), estado_proyecto ->
	// 'venta_cerrada', y recálculo del saldo del centro. El "adelanto" es opcional en el flujo real
	// (solo si el usuario lo carga en el modal) — se genera acá como Transacción aparte, en el paso 6.
	const idCentroProyecto =
		tipo_venta === 'consultoria'
			? await getOrCrearCentroCostoCompartido(client, 'consultoria', idProyecto, nombre_proyecto)
			: await getOrCrearCentroCostoParaEntidad(client, 'proyecto', idProyecto, nombre_proyecto);

	const { error: errCierre } = await client.from('proyecto').update({ estado_proyecto: 'venta_cerrada' }).eq('id_proyecto', idProyecto);
	if (errCierre) throw new Error(`No se pudo cerrar la venta ${nombre_proyecto}: ${errCierre.message}`);
	if (idCentroProyecto) await actualizarSaldoCentroCostoProyecto(client, idCentroProyecto);
	console.log(`  ✓ venta cerrada: ${nombre_proyecto} (centro de costo #${idCentroProyecto})`);

	return { idProyecto, idCentroProyecto };
}

const ventaObra = await crearYCerrarVenta({
	id_cliente: cliente1Id, nombre_proyecto: 'Construcción Vivienda Multifamiliar - Delta (SEED)',
	tipo_venta: 'obra', precio_venta: 250000, responsable: 'Ana Torres (SEED)'
});
const ventaConsultoria = await crearYCerrarVenta({
	id_cliente: cliente2Id, nombre_proyecto: 'Estudio de Suelos - Quispe (SEED)',
	tipo_venta: 'consultoria', precio_venta: 15000, responsable: 'Carlos Ramírez (SEED)'
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// 4. Presupuesto (sección 4) — opcional, header simple. Sin `presupuesto_detalle`: requiere un
//    catálogo de `partida` que Dev todavía no tiene sembrado (fuera de alcance de este script).
// ═══════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[4/8] Presupuesto (header, sin catálogo de partidas todavía)');

async function crearPresupuesto(idProyecto, nombre) {
	const { data: existente } = await client.from('presupuesto').select('id_presupuesto').eq('id_proyecto', idProyecto).maybeSingle();
	if (existente) {
		console.log(`  = presupuesto de '${nombre}' ya existe`);
		return existente.id_presupuesto;
	}
	const { data, error } = await client.from('presupuesto').insert({ id_proyecto: idProyecto, nombre, usuario_registro: SEED_USUARIO }).select('id_presupuesto').single();
	if (error) throw new Error(`No se pudo crear presupuesto para proyecto #${idProyecto}: ${error.message}`);
	console.log(`  ✓ presupuesto creado para: ${nombre}`);
	return data.id_presupuesto;
}

await crearPresupuesto(ventaObra.idProyecto, 'Presupuesto inicial - Vivienda Multifamiliar (SEED)');

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// 5. Cuentas Bancarias (sección 5) — necesarias antes de cualquier Transacción real.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[5/8] Cuentas Bancarias');

async function crearCuentaBancoIdempotente(payload) {
	return encontrarOCrear('cuenta_banco', 'numero_cuenta', payload.numero_cuenta, 'id_cuenta_banco', async () => {
		const r = ok(`cuenta bancaria creada: ${payload.titular_cuenta}`, await createCuentaBanco(client, payload, SEED_USUARIO));
		return r.data.id_cuenta_banco;
	});
}

await crearCuentaBancoIdempotente({
	numero_cuenta: '19312345678SEED', titular_cuenta: 'ConstruniERP SAC (SEED)', nombre_banco: 'BCP',
	tipo_cuenta: 'corriente', tipo_moneda: 'soles', estado: 'activa', saldo_inicial: 50000
});
await crearCuentaBancoIdempotente({
	numero_cuenta: '00398765432SEED', titular_cuenta: 'ConstruniERP SAC (SEED)', nombre_banco: 'Interbank',
	tipo_cuenta: 'ahorros', tipo_moneda: 'dolares', estado: 'activa', saldo_inicial: 5000
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// 6. Cuentas por Pagar/Cobrar (Frecuencia de Pago + Fraccionadas) y sus Transacciones (sección 5) —
//    a propósito cubre los DOS mecanismos que se confunden fácil (ver ticket #30 / FlujoDeNegocio.md
//    sección 5), para que quede un ejemplo real y distinguible de cada uno.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[6/8] Cuentas por Pagar/Cobrar + Transacciones');

// --- 6a. Cuenta por Pagar con "Frecuencia de Pago" (genera VARIAS cuentas, mismo monto cada una) ---
// `.is('id_cuenta_pagar_padre', null)` = la CABEZA de la serie (createCuentasPagarRecurrentes deja la
// primera fila sin padre y encadena el resto) — un `.limit(1)` sin orden podía devolver cualquier cuota
// de la serie entre corridas, y el "pago ya registrado" de más abajo se buscaba sobre la equivocada.
const { data: yaExisteSerie } = await client.from('cuentas_pagar').select('id_cuenta_pagar').eq('id_proveedor', proveedor1Id).eq('frecuencia_pago', 'mensual').is('id_cuenta_pagar_padre', null).maybeSingle();
let primerCuentaPagarSerieId = yaExisteSerie?.id_cuenta_pagar ?? null;
if (!primerCuentaPagarSerieId) {
	const payloadRecurrente = {
		id_proveedor: proveedor1Id, monto_comprometido: 3000, fecha_emision: hoy,
		fecha_vencimiento: enDias(15), frecuencia_pago: 'mensual', fin_periodo_pago: enMeses(3),
		fotma_pago: '2', responsable: 'Ana Torres (SEED)', observacion: 'Suministro mensual de acero (SEED)'
	};
	const fechas = calcularFechasRecurrentes('mensual', payloadRecurrente.fecha_emision, payloadRecurrente.fecha_vencimiento, null, payloadRecurrente.fin_periodo_pago);
	const r = ok(`serie de cuentas por pagar (Frecuencia Mensual) — ${fechas.length} cuentas`, await createCuentasPagarRecurrentes(client, payloadRecurrente, SEED_USUARIO, fechas));
	primerCuentaPagarSerieId = r.data[0].id_cuenta_pagar;
} else {
	console.log('  = serie de cuentas por pagar (Frecuencia Mensual) ya existe');
}

// --- 6b. Cuenta por Pagar "Fraccionada" (UNA cuenta, monto repartido en cuotas con fecha propia) ---
const { data: yaExisteFraccionada } = await client.from('cuentas_pagar').select('id_cuenta_pagar').eq('id_proveedor', proveedor2Id).eq('observacion', 'Subcontrata estructuras - 3 cuotas (SEED)').maybeSingle();
let cuentaPagarFraccionadaId = yaExisteFraccionada?.id_cuenta_pagar ?? null;
if (!cuentaPagarFraccionadaId) {
	const payloadFraccionada = {
		id_proveedor: proveedor2Id, monto_comprometido: 6000, fecha_emision: hoy, frecuencia_pago: 'sin_periodicidad',
		fotma_pago: '2', responsable: 'Ana Torres (SEED)', observacion: 'Subcontrata estructuras - 3 cuotas (SEED)'
	};
	const fracciones = [
		{ fecha: enDias(10), monto: 2000 },
		{ fecha: enDias(40), monto: 2000 },
		{ fecha: enDias(70), monto: 2000 }
	];
	const r = ok('cuenta por pagar Fraccionada (3 cuotas)', await createCuentaPagar(client, payloadFraccionada, SEED_USUARIO, fracciones));
	cuentaPagarFraccionadaId = r.data.id_cuenta_pagar;
} else {
	console.log('  = cuenta por pagar Fraccionada ya existe');
}

// --- 6c. Cuenta por Cobrar Fraccionada, sobre la venta de Obra cerrada. `id_centro_costo` es el centro que
//     RECIBE el ingreso (el del proyecto), no el del cliente: fn_recalcular_cuenta_cobrar deriva
//     monto_cobrado de los ingresos activos hacia ese centro.
const { data: centroCliente1 } = await client.from('centro_costo').select('id_centro_costo').eq('id_cliente', cliente1Id).maybeSingle();
const { data: yaExisteCobrar } = await client.from('cuentas_cobrar').select('id_cuenta_cobrar').eq('id_cliente', cliente1Id).maybeSingle();
let cuentaCobrarId = yaExisteCobrar?.id_cuenta_cobrar ?? null;
if (!cuentaCobrarId) {
	const payloadCobrar = {
		id_cliente: cliente1Id, id_centro_costo: ventaObra.idCentroProyecto, monto: 10000, fecha_emision: hoy,
		responsable: 'Carlos Ramírez (SEED)', observaciones: 'Valorización de avance de obra - 2 cuotas (SEED)'
	};
	const fraccionesCobrar = [
		{ fecha: enDias(15), monto: 5000 },
		{ fecha: enDias(45), monto: 5000 }
	];
	const r = ok('cuenta por cobrar Fraccionada (2 cuotas)', await createCuentaCobrar(client, payloadCobrar, SEED_USUARIO, fraccionesCobrar));
	cuentaCobrarId = r.data.id_cuenta_cobrar;
} else {
	console.log('  = cuenta por cobrar ya existe');
}

// --- 6c-bis. Cuenta por Cobrar SIN fraccionar, sobre la venta de Consultoría — a propósito distinta
//     de la 6c (Fraccionada), para poder demostrar 6e (registrarCobroDesdeTransaccion, un cobro REAL
//     vinculado) sin chocar con la validación "el monto supera lo que falta por cubrir" que dispara si
//     ya hay cuotas programadas cubriendo el 100% del monto — mismo criterio que la serie de Pagar
//     (6a, sin fraccionar) usada para 6e del lado de Pagar.
const { data: centroCliente2 } = await client.from('centro_costo').select('id_centro_costo').eq('id_cliente', cliente2Id).maybeSingle();
const { data: yaExisteCobrarSimple } = await client.from('cuentas_cobrar').select('id_cuenta_cobrar').eq('id_cliente', cliente2Id).maybeSingle();
let cuentaCobrarSimpleId = yaExisteCobrarSimple?.id_cuenta_cobrar ?? null;
if (!cuentaCobrarSimpleId) {
	const payloadCobrarSimple = {
		id_cliente: cliente2Id, id_centro_costo: ventaConsultoria.idCentroProyecto, monto: 15000, fecha_emision: hoy,
		responsable: 'Carlos Ramírez (SEED)', observaciones: 'Honorarios estudio de suelos (SEED)'
	};
	const r = ok('cuenta por cobrar simple (sin fraccionar)', await createCuentaCobrar(client, payloadCobrarSimple, SEED_USUARIO, []));
	cuentaCobrarSimpleId = r.data.id_cuenta_cobrar;
} else {
	console.log('  = cuenta por cobrar simple ya existe');
}

// --- 6d. Transacciones "sueltas" (sin cuenta asociada) — el adelanto de la venta de Obra, y un gasto ---
// OJO: NO filtrar por `categoria` acá — fn_crear_transaccion (el RPC que crea TODA transacción) no incluye
// `categoria` en su INSERT (bug real, ver hallazgo en la sesión del 2026-09-24), así que esa columna
// SIEMPRE queda null aunque se mande — filtrar por ella hacía que "ya existe" nunca encontrara nada y
// cada corrida duplicara la transacción. `descripcion` sí se persiste bien, por eso se usa esa.
const { data: yaExisteAdelanto } = await client.from('transaccion').select('id_transaccion').eq('descripcion', 'Adelanto inicial - Vivienda Multifamiliar Delta (SEED)').maybeSingle();
if (!yaExisteAdelanto) {
	ok(
		'transacción: Adelanto de venta (cliente -> proyecto Obra)',
		await crearTransaccionSistema(
			client,
			{
				tipo_alcance: 'externa', id_centro_costo_origen: centroCliente1.id_centro_costo, id_centro_costo_destino: ventaObra.idCentroProyecto,
				fecha: hoy, categoria: 'Adelanto', monto_total: 30000, tipo: 'ingreso', tipo_moneda: 'soles',
				descripcion: 'Adelanto inicial - Vivienda Multifamiliar Delta (SEED)', comprobante_url: 'seed://sin-comprobante'
			},
			SEED_USUARIO,
			SEED_NOMBRE
		)
	);
} else {
	console.log('  = transacción de Adelanto ya existe');
}

const { data: centroProveedor1 } = await client.from('centro_costo').select('id_centro_costo').eq('id_proveedor', proveedor1Id).maybeSingle();
const { data: yaExisteCompra } = await client.from('transaccion').select('id_transaccion').eq('descripcion', 'Compra de materiales - Vivienda Multifamiliar Delta (SEED)').maybeSingle();
if (!yaExisteCompra) {
	ok(
		'transacción: Compra de materiales (proyecto Obra -> proveedor)',
		await crearTransaccionSistema(
			client,
			{
				tipo_alcance: 'externa', id_centro_costo_origen: ventaObra.idCentroProyecto, id_centro_costo_destino: centroProveedor1.id_centro_costo,
				fecha: hoy, categoria: 'Compras', monto_total: 5000, tipo: 'egreso', tipo_moneda: 'soles',
				descripcion: 'Compra de materiales - Vivienda Multifamiliar Delta (SEED)', comprobante_url: 'seed://sin-comprobante'
			},
			SEED_USUARIO,
			SEED_NOMBRE
		)
	);
} else {
	console.log('  = transacción de Compra ya existe');
}

// --- 6e. Vincular un pago/cobro REAL a una cuenta ya existente (registrarPagoDesdeTransaccion/Cobro) ---
const { data: pagosSerie } = await client.from('pagos').select('id_pago, estado_pago').eq('id_cuenta_pagar', primerCuentaPagarSerieId);
if (!pagosSerie?.some((p) => p.estado_pago === 'pagado')) {
	ok(
		'pago registrado sobre la 1ra cuenta de la serie mensual',
		await registrarPagoDesdeTransaccion(
			client,
			primerCuentaPagarSerieId,
			{
				tipo_alcance: 'externa', id_centro_costo_origen: ventaObra.idCentroProyecto, id_centro_costo_destino: centroProveedor1.id_centro_costo,
				fecha: hoy, categoria: 'Compras', monto_total: 3000, tipo: 'egreso', tipo_moneda: 'soles',
				descripcion: 'Pago cuota 1 - suministro mensual (SEED)', comprobante_url: 'seed://sin-comprobante'
			},
			SEED_USUARIO,
			SEED_NOMBRE
		)
	);
} else {
	console.log('  = pago de la 1ra cuota de la serie mensual ya estaba registrado');
}

const { data: cobrosCuenta } = await client.from('cobros').select('id_cobro, estado_cobro').eq('id_cuenta_cobrar', cuentaCobrarSimpleId);
if (!cobrosCuenta?.some((c) => c.estado_cobro === 'cobrado')) {
	ok(
		'cobro registrado sobre la cuenta por cobrar simple (Consultoría)',
		await registrarCobroDesdeTransaccion(
			client,
			cuentaCobrarSimpleId,
			{
				tipo_alcance: 'externa', id_centro_costo_origen: centroCliente2.id_centro_costo, id_centro_costo_destino: ventaConsultoria.idCentroProyecto,
				fecha: hoy, categoria: 'Honorarios', monto_total: 7000, tipo: 'ingreso', tipo_moneda: 'soles',
				descripcion: 'Cobro parcial - honorarios estudio de suelos (SEED)', comprobante_url: 'seed://sin-comprobante'
			},
			SEED_USUARIO,
			SEED_NOMBRE
		)
	);
} else {
	console.log('  = cobro de la cuenta por cobrar simple ya estaba registrado');
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// 7. Control Financiero (sección 6) — 100% lectura/verificación, no origina ningún dato nuevo. Se
//    deja anotado acá (no se implementa una verificación automática todavía) — revisar manualmente
//    el panel de Control Financiero en la app apuntando a Dev, no debería marcar ninguna Incidencia
//    con estos datos de prueba.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[7/8] Control Financiero — revisar manualmente en la app (sin incidencias esperadas)');

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// 8. Factura de ejemplo (sección 7) — facturacion.service.ts no es importable en Node puro (su
//    import chain toca $env/dynamic/public vía uploadProjectDocument), así que se mirra el insert de
//    guardarBorradorFactura (factura + factura_detalle, estado 'borrador', SIN pasar por
//    autorizarYEmitirFactura/Drive) — queda como ejemplo de la Transacción de ingreso ya registrada.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[8/8] Factura de ejemplo (borrador)');

const { data: yaExisteFactura } = await client.from('factura').select('id_factura, folio').eq('id_cliente', cliente1Id).maybeSingle();
if (!yaExisteFactura) {
	const { data: clienteRow } = await client.from('cliente').select('nombre, tipo_doc, num_documento, direccion').eq('id_cliente', cliente1Id).single();
	const montoLinea = 5000;
	const valorVenta = Number((montoLinea / 1.18).toFixed(2));
	const igv = Number((montoLinea - valorVenta).toFixed(2));

	const { data: factura, error: errFactura } = await client
		.from('factura')
		.insert({
			id_cliente: cliente1Id, cliente_nombre: clienteRow.nombre, cliente_tipo_doc: clienteRow.tipo_doc,
			cliente_documento: clienteRow.num_documento, cliente_direccion: clienteRow.direccion, moneda: 'PEN',
			sub_total_ventas: valorVenta, valor_venta: valorVenta, monto_igv: igv, monto_total: montoLinea,
			usuario_registro: SEED_USUARIO
		})
		.select('id_factura, folio')
		.single();
	if (errFactura) throw new Error(`No se pudo crear la factura de ejemplo: ${errFactura.message}`);

	const { error: errDetalle } = await client.from('factura_detalle').insert({
		id_factura: factura.id_factura, descripcion: 'Valorización de obra - Avance mensual (SEED)',
		unidad: 'GLB', cantidad: 1, precio_unitario: montoLinea, monto_total_linea: montoLinea, orden: 0
	});
	if (errDetalle) throw new Error(`No se pudo crear el detalle de la factura de ejemplo: ${errDetalle.message}`);

	console.log(`  ✓ factura borrador creada: folio ${factura.folio ?? '(pendiente)'} — cliente ${clienteRow.nombre}`);
} else {
	console.log(`  = ya existe una factura de ejemplo para este cliente (folio ${yaExisteFactura.folio ?? '(pendiente)'})`);
}

console.log('\n✅ Seed de Dev completo.\n');
