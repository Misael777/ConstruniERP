/**
 * Datos fijos de la empresa emisora — compartidos por todos los comprobantes/recibos autogenerados en
 * PDF (comprobanteTransferenciaInterna.ts, reciboPagoEfectivo.ts, facturaPdf.ts). Reales y fijos a
 * pedido explícito del usuario — no hay ningún catálogo de "datos de la empresa" en el sistema todavía.
 */
export const EMPRESA_NOMBRE = 'CASALLO & MELCHOR S.A.C.';
export const EMPRESA_RUC = '20609228343';

/** Dirección fiscal que se imprime en la cabecera de la Factura (facturaPdf.ts). PENDIENTE DE
 * CONFIRMAR con el usuario: en la imagen de referencia el número de la avenida/oficina no se lee bien,
 * así que solo se incluyó la parte legible — completar aquí (un solo lugar) y se refleja en todas las
 * facturas nuevas. */
export const EMPRESA_DIRECCION = 'AV. FRANCISCO XAVIER MARIATEGUI - JESUS MARIA - LIMA - LIMA';

/** N° de cuenta de detracciones en el Banco de la Nación que se propone por defecto en el bloque
 * "Información de la detracción" de la Factura (editable por factura). PENDIENTE DE CONFIRMAR con el
 * usuario: vacío hasta que se indique el número real. */
export const DETRACCION_CUENTA_BN_DEFAULT = '';
