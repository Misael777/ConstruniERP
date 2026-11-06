/**
 * Datos fijos de la empresa emisora — compartidos por todos los comprobantes/recibos autogenerados en
 * PDF (comprobanteTransferenciaInterna.ts, reciboPagoEfectivo.ts, facturaPdf.ts). Reales y fijos a
 * pedido explícito del usuario — no hay ningún catálogo de "datos de la empresa" en el sistema todavía.
 */
export const EMPRESA_NOMBRE = 'CASALLO & MELCHOR S.A.C.';
export const EMPRESA_RUC = '20609228343';

/** Dirección fiscal impresa en la cabecera de TODOS los comprobantes (Factura, Boleta, Notas y Comprobante de
 * Venta — facturaPdf.ts), copiada tal cual del formato entregado por el usuario. Va en dos líneas, una por
 * elemento. */
export const EMPRESA_DIRECCION_LINEAS = ['AV. FRANCISCO JAVIER MARIATEGUI 1455 DPTO. 201', 'FND. OYAGUE 1455 - JESUS MARIA - LIMA - LIMA'];

/** N° de cuenta de detracciones en el Banco de la Nación que se propone por defecto en el bloque
 * "Información de la detracción" de la Factura (editable por factura). PENDIENTE DE CONFIRMAR con el
 * usuario: vacío hasta que se indique el número real. */
export const DETRACCION_CUENTA_BN_DEFAULT = '';
