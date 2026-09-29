/**
 * Arma los datos del PDF (DatosFacturaPdf) a partir de una factura/boleta/nota YA guardada y su detalle —
 * usado para regenerar la vista previa de un borrador o anulado (con sello de agua) tanto desde la lista de
 * "Emisión de Comprobantes" como desde el botón "Ver Factura" de la Nota de Crédito por error en el RUC.
 */
import type { DatosFacturaPdf } from '$lib/shared/facturaPdf';
import type { Factura, FacturaDetalle } from './facturacion.service';
import { DETRACCION_TIPOS_OPERACION, DETRACCION_CODIGOS_BIEN_SERVICIO } from '../config/detraccionCatalogos';
import { TIPOS_NOTA_CREDITO } from '../config/factura.config';

export function datosPdfDesdeFactura(factura: Factura, detalle: FacturaDetalle[], marcaAgua: string | null): DatosFacturaPdf {
	const codigoBien = DETRACCION_CODIGOS_BIEN_SERVICIO.find((c) => c.codigo === factura.detraccion_codigo_bien);
	return {
		tipoDocumento: factura.tipo_comprobante,
		folio: factura.folio,
		fechaEmision: factura.fecha_emision,
		formaPago: factura.forma_pago === 'credito' ? 'credito' : 'contado',
		clienteNombre: factura.cliente_nombre ?? factura.cliente?.nombre ?? '',
		clienteDocumentoLabel: factura.cliente_tipo_doc ?? 'RUC',
		clienteDocumento: factura.cliente_documento ?? '',
		clienteDireccion: factura.cliente_direccion ?? '',
		moneda: factura.moneda === 'USD' ? 'USD' : 'PEN',
		observacion: factura.observacion ?? '',
		lineas: detalle.map((d) => ({ cantidad: Number(d.cantidad), unidad: d.unidad ?? 'Servicio', descripcion: d.descripcion, valorUnitario: Number(d.precio_unitario) })),
		subTotalVentas: Number(factura.sub_total_ventas),
		anticipos: Number(factura.anticipos),
		descuentos: Number(factura.descuentos),
		valorVenta: Number(factura.valor_venta),
		isc: Number(factura.isc),
		igv: Number(factura.monto_igv),
		otrosCargos: Number(factura.otros_cargos),
		otrosTributos: Number(factura.otros_tributos),
		redondeo: Number(factura.redondeo),
		importeTotal: Number(factura.monto_total),
		sujetaDetraccion: factura.sujeta_detraccion,
		porcentajeDetraccion: Number(factura.porcentaje_detraccion ?? 0),
		montoDetraccion: Number(factura.monto_detraccion ?? 0),
		tipoNota: TIPOS_NOTA_CREDITO.find((o) => o.value === factura.tipo_nota)?.label ?? '',
		detraccionTipoOperacion: DETRACCION_TIPOS_OPERACION.find((o) => o.codigo === factura.detraccion_tipo_operacion)?.nombre ?? '',
		detraccionBienServicio: factura.detraccion_bien_servicio ?? '',
		detraccionCodigoBien: codigoBien ? `${codigoBien.codigo} - ${codigoBien.nombre}` : (factura.detraccion_codigo_bien ?? ''),
		detraccionMedioPago: factura.detraccion_medio_pago ?? '',
		detraccionCuentaBn: factura.detraccion_cuenta_bn ?? '',
		marcaAgua
	};
}
