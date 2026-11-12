/**
 * Herramientas de agente para CONTROL FINANCIERO — mapean, dato por dato, lo que muestra cada pestaña de
 * Finanzas → Control Financiero (Dashboard, IGV, Consistencia, Conciliación, Incidencias), llamando a las MISMAS
 * funciones de servicio que la pantalla (nunca una copia de la lógica). Así la herramienta y la pantalla dicen
 * siempre lo mismo, y la suite de punta a punta (scripts/tests-negocio-control-financiero.mjs) valida el código real.
 *
 * Lecturas: disponibles también contra Producción (no escriben nada — `cf_consistencia_evaluar` corre los chequeos
 * SIN guardar la revisión). Escrituras: solo Dev (ver filtrarPorEntorno), incluidas las de transacciones que hacen
 * falta para armar escenarios (editar/anular/reactivar/eliminar) y un proyecto ficticio con su centro de costo.
 */
import type { AgentTool } from '../registry.ts';
import { NOMBRE_AGENTE, USUARIO_AGENTE, desempaquetar, exigirNumero, exigirObjeto } from './_util.ts';
import {
	getCentrosCostoOptions,
	getRendimientoPorCentroCosto,
	getGastosCorporativosGlobales,
	getFlujoDeNodos,
	getResumenGeneral,
	getSerieMensualFlujoCaja,
	getProyeccionFutura,
	calcularTotalesRendimiento,
	calcularConcentracionGlobal
} from '$lib/modules/dashboard-finanzas/services/dashboardFinanzas.service';
import {
	getSaldoTotalCentrosCosto,
	getSaldoTotalCuentasBancarias,
	getSaldosDetalleCentrosCosto,
	getSaldosDetalleCuentasBancarias,
	getConciliacionesPendientesCount,
	getConciliaciones,
	getAperturasFinancieras,
	agruparCortes,
	registrarConciliacionInterna,
	registrarConciliacionBancoManual,
	crearAperturaFinancieraLote,
	eliminarCorte,
	type FuenteApertura
} from '$lib/modules/control-financiero/services/conciliacion.service';
import { getIncidencias, getIncidenciasAbiertasCount, getEventosIncidencia, getEtiquetaEntidadAfectada, cerrarIncidencia, resolverSinAjuste, type EstadoIncidencia, type Severidad } from '$lib/modules/control-financiero/services/incidencia.service';
import { ejecutarRevision, evaluarChequeos, getUltimaRevision, calcularEstadoGeneral } from '$lib/modules/control-financiero/services/controlFinanciero.service';
import { getTrayectoriaCentrosCosto, getTrayectoriaCuentasBancarias, type TrayectoriaResultado } from '$lib/modules/control-financiero/services/trayectoria.service';
import { getResumenIgv, getEvolucionIgv, getObjetivoIgv, getComprobantesDelPeriodo, estadoSemaforoIgv, getDatosCrudosPorMes, calcularControlMensual } from '$lib/modules/control-financiero/services/igv.service';
import { updateTransaccion, deleteTransaccion, anularTransaccion, reactivarTransaccion } from '$lib/modules/transacciones/services/transacciones.service';
import { getOrCrearCentroCostoParaEntidad, getOrCrearCentroCostoCompartido } from '$lib/modules/centro-costos/services/centroCostos.service';
import { createCuentaBanco } from '$lib/modules/cuentas-bancarias/services/cuentaBanco.service';

const r2 = (n: number) => Math.round(n * 100) / 100;

/** 'YYYY-MM' (o vacío = mes actual) → Date del día 1 en hora local, igual que el selector de mes de la pestaña IGV. */
function mesDesde(valor: unknown): Date {
	if (valor === undefined || valor === null || valor === '') {
		const hoy = new Date();
		return new Date(hoy.getFullYear(), hoy.getMonth(), 1);
	}
	const m = /^(\d{4})-(\d{2})$/.exec(String(valor));
	if (!m) throw new Error('mes debe tener el formato YYYY-MM.');
	return new Date(Number(m[1]), Number(m[2]) - 1, 1);
}

/** La trayectoria completa puede ser muy larga: por defecto se resume a saldo final + cantidad de puntos por serie. */
function resumirTrayectoria(t: TrayectoriaResultado, completo: boolean) {
	if (completo) return t;
	return {
		fechas: t.fechas.length,
		series: t.series.map((s) => ({ id: s.id, label: s.label, puntos: s.puntos.length, saldo_final: s.puntos.length ? s.puntos[s.puntos.length - 1].saldo : null }))
	};
}

// ─────────────────────────────── Lectura (también Producción) ───────────────────────────────

const cfDashboard: AgentTool = {
	name: 'cf_dashboard',
	description:
		'Pestaña DASHBOARD de Control Financiero, dato por dato (mismas funciones que la pantalla): ' +
		'salud_financiera {saldo_centros (Σ centros de costo de fondos propios, saldo vigente), saldo_bancos (Σ cuentas activas), diferencia, conciliaciones_pendientes, incidencias_abiertas, ultima_revision {fecha, ok/alerta/error}, estado_general ok|alerta|error}; ' +
		'resumen_general {totalIngresos, totalEgresos, saldoNeto, centrosConMovimiento, empleadosActivos, centrosPorTipo} (tipo ingreso/egreso, SIN transferencias); ' +
		'rendimiento {items por centro: ingresos/egresos (incluyen transferencias y financiamientos del centro), flujoCajaNeto, autosuficiencia %, presupuesto, desviación, burnRate, ROC, concentración; totales; gastos_corporativos; concentracion_global}; ' +
		'flujo_nodos (grafo entre centros), serie_mensual (12 meses), proyeccion (6 meses desde CxC/CxP pendientes), trayectoria_centros/cuentas. ' +
		'Filtros opcionales del rendimiento: tipo (obra|consultoria|bolsa general|otro|...), id_centro_costo. trayectoria_completa=true devuelve todos los puntos.',
	inputSchema: {
		type: 'object',
		properties: { tipo: { type: 'string' }, id_centro_costo: { type: 'number' }, trayectoria_completa: { type: 'boolean' } },
		additionalProperties: false
	},
	permiso: 'ver_control_financiero',
	async handler(input, ctx) {
		const c = ctx.client;
		const filtros = { tipo: input.tipo ? String(input.tipo) : undefined, idCentroCosto: input.id_centro_costo !== undefined ? exigirNumero(input.id_centro_costo, 'id_centro_costo') : null };
		const [resumen, nodos, serie, proyeccion, opciones, items, gastosCorp, trayC, trayB, sc, sb, cp, ia, ur] = await Promise.all([
			getResumenGeneral(c),
			getFlujoDeNodos(c),
			getSerieMensualFlujoCaja(c, 12),
			getProyeccionFutura(c, 6),
			getCentrosCostoOptions(c),
			getRendimientoPorCentroCosto(c, filtros),
			getGastosCorporativosGlobales(c),
			getTrayectoriaCentrosCosto(c),
			getTrayectoriaCuentasBancarias(c),
			getSaldoTotalCentrosCosto(c),
			getSaldoTotalCuentasBancarias(c),
			getConciliacionesPendientesCount(c),
			getIncidenciasAbiertasCount(c),
			getUltimaRevision(c)
		]);
		return {
			salud_financiera: {
				saldo_centros: r2(sc),
				saldo_bancos: r2(sb),
				diferencia: r2(sc - sb),
				conciliaciones_pendientes: cp,
				incidencias_abiertas: ia,
				ultima_revision: ur ? { fecha: ur.fecha, controles_ok: ur.controles_ok, controles_alerta: ur.controles_alerta, controles_error: ur.controles_error } : null,
				estado_general: calcularEstadoGeneral({ incidenciasAbiertas: ia, conciliacionesPendientes: cp, ultimaRevision: ur })
			},
			resumen_general: resumen,
			rendimiento: {
				filtros,
				centros_disponibles: opciones.length,
				items,
				totales: calcularTotalesRendimiento(items, gastosCorp),
				gastos_corporativos: gastosCorp,
				concentracion_global: calcularConcentracionGlobal(items)
			},
			flujo_nodos: nodos,
			serie_mensual: serie,
			proyeccion,
			trayectoria_centros: resumirTrayectoria(trayC, input.trayectoria_completa === true),
			trayectoria_cuentas: resumirTrayectoria(trayB, input.trayectoria_completa === true)
		};
	}
};

const cfConsistenciaUltima: AgentTool = {
	name: 'cf_consistencia_ultima',
	description: 'Pestaña CONSISTENCIA: la última revisión GUARDADA (la que muestran la pestaña y la tarjeta del Dashboard), con cada chequeo {id, label, estado ok|alerta|error, mensaje, detalle evaluado}.',
	inputSchema: { type: 'object', properties: {}, additionalProperties: false },
	permiso: 'ver_control_financiero',
	async handler(_input, ctx) {
		return await getUltimaRevision(ctx.client);
	}
};

const cfConsistenciaEvaluar: AgentTool = {
	name: 'cf_consistencia_evaluar',
	description:
		'Corre EN VIVO todos los chequeos de Consistencia (los mismos que "Ejecutar revisión") SIN guardar la revisión — solo lectura, sirve también en Producción. Chequeos: saldos negativos (centro de costo <0 = error, cuenta bancaria <0 = alerta), integridad de transacciones, integridad de pagos/cobros, saldos bancarios vs recálculo, cuadre Σ centros vs Σ bancos, posibles duplicados, centros de costo y cuentas bancarias de baja en uso.',
	inputSchema: { type: 'object', properties: {}, additionalProperties: false },
	permiso: 'ver_control_financiero',
	async handler(_input, ctx) {
		return await evaluarChequeos(ctx.client);
	}
};

const cfConciliacion: AgentTool = {
	name: 'cf_conciliacion',
	description:
		'Pestaña CONCILIACIÓN: cruce interno {saldo_centros, saldo_bancos, diferencia}, detalle por centro de costo (saldo vigente = última apertura + movimientos posteriores) y por cuenta bancaria, historial de conciliaciones (con su incidencia), aperturas registradas y "Puntos de corte" agrupados (cuál manda en cuántas cuentas/centros).',
	inputSchema: { type: 'object', properties: { limite_historial: { type: 'number' } }, additionalProperties: false },
	permiso: 'ver_control_financiero',
	async handler(input, ctx) {
		const c = ctx.client;
		const [sc, sb, centros, cuentas, historial, aperturas] = await Promise.all([
			getSaldoTotalCentrosCosto(c),
			getSaldoTotalCuentasBancarias(c),
			getSaldosDetalleCentrosCosto(c),
			getSaldosDetalleCuentasBancarias(c),
			getConciliaciones(c, input.limite_historial !== undefined ? exigirNumero(input.limite_historial, 'limite_historial') : 30),
			getAperturasFinancieras(c)
		]);
		return {
			cruce_interno: { saldo_centros: r2(sc), saldo_bancos: r2(sb), diferencia: r2(sc - sb), cuadra: Math.abs(sc - sb) <= 0.01 },
			centros_de_costo: centros,
			cuentas_bancarias: cuentas,
			historial_conciliaciones: historial,
			aperturas,
			puntos_de_corte: agruparCortes(aperturas)
		};
	}
};

const cfIgv: AgentTool = {
	name: 'cf_igv',
	description:
		'Pestaña IGV para un mes (mes = "YYYY-MM", vacío = mes actual): resumen {ventasBase, igvVentas (facturas emitidas), comprasBase, creditoFiscalCompras (egresos externos activos, asumiendo que su monto incluye 18% IGV), igvEstimado, mes anterior y variaciones %}, objetivo mensual y semáforo, evolución de 6 meses, comprobantes del mes (ventas y compras) y el popup "Control Mensual" del año (12 meses REAL/PROYECCIÓN; tasa_igv 0.18 y tasa_pago_a_cuenta 0.01 por defecto, igual que el popup).',
	inputSchema: {
		type: 'object',
		properties: { mes: { type: 'string' }, tasa_igv: { type: 'number' }, tasa_pago_a_cuenta: { type: 'number' }, meses_reales: { type: 'number' } },
		additionalProperties: false
	},
	permiso: 'ver_control_financiero',
	async handler(input, ctx) {
		const c = ctx.client;
		const mes = mesDesde(input.mes);
		const desde = `${mes.getFullYear()}-${String(mes.getMonth() + 1).padStart(2, '0')}-01`;
		const hasta = `${mes.getFullYear()}-${String(mes.getMonth() + 1).padStart(2, '0')}-${String(new Date(mes.getFullYear(), mes.getMonth() + 1, 0).getDate()).padStart(2, '0')}`;
		const mesesReales = input.meses_reales !== undefined ? exigirNumero(input.meses_reales, 'meses_reales') : mes.getMonth() + 1;
		const [resumen, evolucion, objetivo, comprobantes, crudos] = await Promise.all([
			getResumenIgv(c, mes),
			getEvolucionIgv(c, mes, 6),
			getObjetivoIgv(c),
			getComprobantesDelPeriodo(c, desde, hasta),
			getDatosCrudosPorMes(c, mes.getFullYear(), mesesReales)
		]);
		return {
			mes: desde.slice(0, 7),
			resumen,
			objetivo_mensual: objetivo,
			semaforo: estadoSemaforoIgv(resumen.igvEstimado, objetivo),
			evolucion,
			comprobantes,
			control_mensual: calcularControlMensual(crudos, mesesReales, input.tasa_igv !== undefined ? Number(input.tasa_igv) : 0.18, input.tasa_pago_a_cuenta !== undefined ? Number(input.tasa_pago_a_cuenta) : 0.01)
		};
	}
};

const cfIncidencias: AgentTool = {
	name: 'cf_incidencias',
	description:
		'Pestaña INCIDENCIAS: lista (por defecto sin las CLOSED, igual que la pestaña) con la entidad afectada legible, conteo de abiertas (todo lo que no es RESOLVED/CLOSED, el número del Dashboard) y conteo por estado/severidad. Filtros: estado, severidad, incluir_cerradas. con_eventos=true agrega el historial de cada una.',
	inputSchema: {
		type: 'object',
		properties: { estado: { type: 'string' }, severidad: { type: 'string' }, incluir_cerradas: { type: 'boolean' }, con_eventos: { type: 'boolean' } },
		additionalProperties: false
	},
	permiso: 'ver_control_financiero',
	async handler(input, ctx) {
		const c = ctx.client;
		const [lista, abiertas] = await Promise.all([
			getIncidencias(c, { estado: input.estado as EstadoIncidencia | undefined, severidad: input.severidad as Severidad | undefined, incluirCerradas: input.incluir_cerradas === true }),
			getIncidenciasAbiertasCount(c)
		]);
		const items = await Promise.all(
			lista.map(async (i) => ({
				...i,
				entidad_afectada: await getEtiquetaEntidadAfectada(c, i.tipo_entidad, i.id_entidad),
				...(input.con_eventos === true ? { eventos: await getEventosIncidencia(c, i.id_incidencia) } : {})
			}))
		);
		const porEstado: Record<string, number> = {};
		const porSeveridad: Record<string, number> = {};
		for (const i of lista) {
			porEstado[i.estado] = (porEstado[i.estado] ?? 0) + 1;
			porSeveridad[i.severidad] = (porSeveridad[i.severidad] ?? 0) + 1;
		}
		return { abiertas, por_estado: porEstado, por_severidad: porSeveridad, items };
	}
};

// ─────────────────────────────── Escritura (solo Dev) ───────────────────────────────

const cfEjecutarRevision: AgentTool = {
	name: 'cf_ejecutar_revision',
	escritura: true,
	description: '[SOLO DEV] Botón "Ejecutar revisión" / "Ejecutar ahora": corre los chequeos y GUARDA la revisión (es la que muestran Consistencia y la tarjeta del Dashboard).',
	inputSchema: { type: 'object', properties: {}, additionalProperties: false },
	permiso: 'ver_control_financiero',
	async handler(_input, ctx) {
		return await ejecutarRevision(ctx.client, NOMBRE_AGENTE);
	}
};

const cfConciliarInterna: AgentTool = {
	name: 'cf_registrar_conciliacion_interna',
	escritura: true,
	description: '[SOLO DEV] Conciliación → "Registrar conciliación interna" (Σ centros vs Σ bancos). Si hay diferencia abre una incidencia.',
	inputSchema: { type: 'object', properties: {}, additionalProperties: false },
	permiso: 'ver_control_financiero',
	async handler(_input, ctx) {
		return desempaquetar(await registrarConciliacionInterna(ctx.client, NOMBRE_AGENTE));
	}
};

const cfConciliarBanco: AgentTool = {
	name: 'cf_registrar_conciliacion_banco',
	escritura: true,
	description: '[SOLO DEV] Conciliación bancaria manual: monto_banco = lo que dice el estado de cuenta real; numero_cuenta opcional (vacío = consolidado de todas las cuentas). Si difiere del ERP abre una incidencia.',
	inputSchema: { type: 'object', properties: { monto_banco: { type: 'number' }, numero_cuenta: { type: 'string' }, observaciones: { type: 'string' } }, required: ['monto_banco'], additionalProperties: false },
	permiso: 'ver_control_financiero',
	async handler(input, ctx) {
		return desempaquetar(
			await registrarConciliacionBancoManual(ctx.client, exigirNumero(input.monto_banco, 'monto_banco'), input.numero_cuenta ? String(input.numero_cuenta) : null, NOMBRE_AGENTE, input.observaciones ? String(input.observaciones) : null)
		);
	}
};

const cfCrearCorte: AgentTool = {
	name: 'cf_crear_corte',
	escritura: true,
	description:
		'[SOLO DEV] "Generar Apertura" (punto de corte): declara el saldo de cuentas bancarias y centros de costo a una fecha_corte. cuentas=[{id_cuenta_banco, monto}], centros=[{id_centro_costo, monto}]. A partir de ahí el saldo vigente = monto declarado + movimientos POSTERIORES a la fecha. (La pantalla exige que Σ cuentas = Σ centros; esta herramienta no lo exige a propósito, para poder probar el caso descuadrado.)',
	inputSchema: {
		type: 'object',
		properties: { fecha_corte: { type: 'string' }, fuente: { type: 'string' }, observaciones: { type: 'string' }, cuentas: { type: 'array' }, centros: { type: 'array' } },
		required: ['fecha_corte'],
		additionalProperties: false
	},
	permiso: 'ver_control_financiero',
	async handler(input, ctx) {
		return desempaquetar(
			await crearAperturaFinancieraLote(
				ctx.client,
				{
					fecha_corte: String(input.fecha_corte),
					fuente: (input.fuente ? String(input.fuente) : 'otro') as FuenteApertura,
					observaciones: input.observaciones ? String(input.observaciones) : null,
					cuentas: ((input.cuentas as any[]) ?? []).map((x) => ({ id_cuenta_banco: exigirNumero(x.id_cuenta_banco, 'id_cuenta_banco'), monto: exigirNumero(x.monto, 'monto') })),
					centros: ((input.centros as any[]) ?? []).map((x) => ({ id_centro_costo: exigirNumero(x.id_centro_costo, 'id_centro_costo'), monto: exigirNumero(x.monto, 'monto') }))
				},
				USUARIO_AGENTE
			)
		);
	}
};

const cfEliminarCorte: AgentTool = {
	name: 'cf_eliminar_corte',
	escritura: true,
	description: '[SOLO DEV] Elimina un punto de corte completo (todas las aperturas de esa fecha_corte) y recalcula las cuentas afectadas.',
	inputSchema: { type: 'object', properties: { fecha_corte: { type: 'string' } }, required: ['fecha_corte'], additionalProperties: false },
	permiso: 'ver_control_financiero',
	async handler(input, ctx) {
		return desempaquetar(await eliminarCorte(ctx.client, String(input.fecha_corte)));
	}
};

const cfCerrarIncidencia: AgentTool = {
	name: 'cf_resolver_y_cerrar_incidencia',
	escritura: true,
	description: '[SOLO DEV] Resuelve SIN ajuste (con comentario) y cierra una incidencia — el flujo que la pestaña Incidencias hace en dos pasos.',
	inputSchema: { type: 'object', properties: { id_incidencia: { type: 'number' }, comentario: { type: 'string' } }, required: ['id_incidencia', 'comentario'], additionalProperties: false },
	permiso: 'ver_control_financiero',
	async handler(input, ctx) {
		const id = exigirNumero(input.id_incidencia, 'id_incidencia');
		desempaquetar(await resolverSinAjuste(ctx.client, id, String(input.comentario), NOMBRE_AGENTE));
		return desempaquetar(await cerrarIncidencia(ctx.client, id, NOMBRE_AGENTE));
	}
};

/** Lee la transacción actual y le mezcla `cambios` — así se llama a updateTransaccion con el payload COMPLETO, igual
 * que el formulario Editar (que siempre manda todos los campos). */
const editarTransaccion: AgentTool = {
	name: 'editar_transaccion',
	escritura: true,
	description:
		'[SOLO DEV] Edita una transacción como el formulario "Editar Transacción" (updateTransaccion: mismas validaciones, saldo suficiente del centro de origen, sincroniza el pago/cobro vinculado y recalcula las cuentas bancarias). `cambios` se mezcla sobre los valores actuales (ej. {"monto_total": 400} o {"cuente_destino": "..."}). Las externas exigen comprobante: si no tiene, pasar comprobante_url en cambios.',
	inputSchema: { type: 'object', properties: { id_transaccion: { type: 'number' }, cambios: { type: 'object' } }, required: ['id_transaccion', 'cambios'], additionalProperties: false },
	permiso: 'editar_transacciones',
	async handler(input, ctx) {
		const id = exigirNumero(input.id_transaccion, 'id_transaccion');
		const { data: actual, error } = await ctx.client.from('transaccion').select('*').eq('id_transaccion', id).single();
		if (error || !actual) throw new Error(`No existe la transacción #${id}.`);
		const payload: Record<string, unknown> = { ...actual, ...exigirObjeto(input.cambios, 'cambios') };
		// Igual que el formulario: las monedas de las cuentas elegidas deciden si hace falta tipo de cambio.
		const nums = [payload.cuente_origen, payload.cuente_destino].filter(Boolean) as string[];
		const { data: cuentas } = nums.length ? await ctx.client.from('cuenta_banco').select('numero_cuenta, tipo_moneda').in('numero_cuenta', nums) : { data: [] };
		const moneda = (n: unknown) => (cuentas ?? []).find((c: any) => c.numero_cuenta === n)?.tipo_moneda ?? '';
		payload.moneda_cuenta_origen = moneda(payload.cuente_origen);
		payload.moneda_cuenta_destino = moneda(payload.cuente_destino);
		return desempaquetar(await updateTransaccion(ctx.client, id, payload, true));
	}
};

const anularTransaccionTool: AgentTool = {
	name: 'anular_transaccion',
	escritura: true,
	description: '[SOLO DEV] "Anular" (fn_anular_transaccion): deja la fila como anulada, devuelve a "programado" el pago/cobro que respaldaba y recalcula cuentas.',
	inputSchema: { type: 'object', properties: { id_transaccion: { type: 'number' } }, required: ['id_transaccion'], additionalProperties: false },
	permiso: 'editar_transacciones',
	async handler(input, ctx) {
		return desempaquetar(await anularTransaccion(ctx.client, exigirNumero(input.id_transaccion, 'id_transaccion'), true));
	}
};

const reactivarTransaccionTool: AgentTool = {
	name: 'reactivar_transaccion',
	escritura: true,
	description: '[SOLO DEV] "Reactivar" una transacción anulada (vuelve a contar; NO restaura el pago/cobro que se revirtió al anular).',
	inputSchema: { type: 'object', properties: { id_transaccion: { type: 'number' } }, required: ['id_transaccion'], additionalProperties: false },
	permiso: 'editar_transacciones',
	async handler(input, ctx) {
		return desempaquetar(await reactivarTransaccion(ctx.client, exigirNumero(input.id_transaccion, 'id_transaccion'), true));
	}
};

const eliminarTransaccionTool: AgentTool = {
	name: 'eliminar_transaccion',
	escritura: true,
	description: '[SOLO DEV] "Eliminar" (deleteTransaccion): borrado definitivo con las mismas guardas que la pantalla (no si está aprobada, facturada o respalda un pago/cobro — ahí hay que anular).',
	inputSchema: { type: 'object', properties: { id_transaccion: { type: 'number' } }, required: ['id_transaccion'], additionalProperties: false },
	permiso: 'eliminar_transacciones',
	async handler(input, ctx) {
		return desempaquetar(await deleteTransaccion(ctx.client, exigirNumero(input.id_transaccion, 'id_transaccion'), true));
	}
};

const crearProyectoPrueba: AgentTool = {
	name: 'crear_proyecto_prueba',
	escritura: true,
	description:
		'[SOLO DEV] Crea un proyecto FICTICIO ya con venta cerrada (nombre, id_cliente, tipo_venta obra|consultoria, precio_venta) y su centro de costo, igual que lo crea el cierre de venta (Obra: getOrCrearCentroCostoParaEntidad; Consultoría: getOrCrearCentroCostoCompartido). Devuelve id_proyecto e id_centro_costo.',
	inputSchema: {
		type: 'object',
		properties: { nombre: { type: 'string' }, id_cliente: { type: 'number' }, tipo_venta: { type: 'string' }, precio_venta: { type: 'number' } },
		required: ['nombre', 'id_cliente'],
		additionalProperties: false
	},
	permiso: 'crear_ventas',
	async handler(input, ctx) {
		const tipoVenta = input.tipo_venta === 'consultoria' ? 'consultoria' : 'obra';
		const nombre = String(input.nombre);
		const { data: p, error } = await ctx.client
			.from('proyecto')
			.insert({ nombre_proyecto: nombre, id_cliente: exigirNumero(input.id_cliente, 'id_cliente'), tipo_venta: tipoVenta, precio_venta: input.precio_venta !== undefined ? exigirNumero(input.precio_venta, 'precio_venta') : null, estado_proyecto: 'venta_cerrada' })
			.select('id_proyecto')
			.single();
		if (error || !p) throw new Error(`No se pudo crear el proyecto: ${error?.message}`);
		const idCentro =
			tipoVenta === 'consultoria'
				? await getOrCrearCentroCostoCompartido(ctx.client, 'consultoria', p.id_proyecto, nombre)
				: await getOrCrearCentroCostoParaEntidad(ctx.client, 'proyecto', p.id_proyecto, nombre);
		if (!idCentro) throw new Error(`Se creó el proyecto #${p.id_proyecto} pero no su centro de costo.`);
		return { id_proyecto: p.id_proyecto, id_centro_costo: idCentro };
	}
};

const crearCuentaBancariaPrueba: AgentTool = {
	name: 'crear_cuenta_bancaria_prueba',
	escritura: true,
	description:
		'[SOLO DEV] Crea una cuenta bancaria con createCuentaBanco (mismas validaciones que la pantalla Cuentas Bancarias). payload: numero_cuenta, titular_cuenta, nombre_banco, tipo_cuenta (corriente|ahorros|efectivo|...), tipo_moneda (soles|dolares), saldo_inicial, estado ("activa").',
	inputSchema: { type: 'object', properties: { payload: { type: 'object' } }, required: ['payload'], additionalProperties: false },
	permiso: 'crear_cuentas_bancarias',
	async handler(input, ctx) {
		return desempaquetar(await createCuentaBanco(ctx.client, { estado: 'activa', ...exigirObjeto(input.payload, 'payload') }, USUARIO_AGENTE));
	}
};

export const controlFinancieroTools: AgentTool[] = [
	crearCuentaBancariaPrueba,
	cfDashboard,
	cfConsistenciaUltima,
	cfConsistenciaEvaluar,
	cfConciliacion,
	cfIgv,
	cfIncidencias,
	cfEjecutarRevision,
	cfConciliarInterna,
	cfConciliarBanco,
	cfCrearCorte,
	cfEliminarCorte,
	cfCerrarIncidencia,
	editarTransaccion,
	anularTransaccionTool,
	reactivarTransaccionTool,
	eliminarTransaccionTool,
	crearProyectoPrueba
];
