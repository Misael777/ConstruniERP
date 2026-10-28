/**
 * Arma el texto del mensaje "Msje" (antes botón "R2" dentro de Nueva/Editar Transacción) — a pedido
 * explícito del usuario, se sacó del modal y ahora vive junto a cada proyecto en la lista de
 * finanzas/tranzacciones (ver +page.svelte), disponible sin necesidad de abrir la transacción para
 * editarla. Tres plantillas distintas, cada una su propia función (en vez de una sola con banderas) —
 * más fácil de leer/ajustar una por separado sin arriesgar romper las otras dos:
 *   - Egreso: armarMensajeEgreso.
 *   - Ingreso (cualquier medio de pago que no sea Efectivo): armarMensajeIngreso.
 *   - Ingreso + Efectivo: armarMensajeIngresoEfectivo (a diferencia de las otras dos, no hay una cuenta
 *     bancaria real de por medio — ver +page.svelte, ese campo queda vacío/"—" en ese caso).
 * Todas son funciones puras — el llamador (+page.svelte) resuelve los labels de cliente/proveedor/
 * cuenta bancaria/proyecto antes de pasarlos acá.
 */
import { formatCurrency } from './fieldConfig';
import { formatearFechaCorta } from './pdfFormatoUtil';

export interface DatosMensajeEgreso {
	usuario: string;
	monto: number;
	proveedor: string;
	/** Label de la cuenta bancaria de origen (ej. "BCP SOLES - 192 4713256045"). */
	cuentaBancaria: string;
	/** 'YYYY-MM-DD' — la fecha de la propia transacción (no la fecha en que se genera el mensaje). */
	fecha: string;
}

/** Pago a proveedor por transferencia/depósito bancario (no efectivo), con la cuenta de origen desde
 * la que se pagó. */
export function armarMensajeEgreso(datos: DatosMensajeEgreso): string {
	return `Yo, ${datos.usuario}, he registrado el pago de ${formatCurrency(datos.monto)} al proveedor ${datos.proveedor}, realizado a la cuenta de ${datos.cuentaBancaria}, con fecha ${formatearFechaCorta(datos.fecha)}.`;
}

export interface DatosMensajeIngreso {
	monto: number;
	/** 'YYYY-MM-DD'. */
	fecha: string;
	cliente: string;
	/** Label de la cuenta bancaria de destino (a la que entró el dinero). */
	cuentaBancaria: string;
	nombreProyecto: string;
}

/** Ingreso recibido por transferencia/depósito bancario (no efectivo) — a nombre de qué cuenta propia
 * entró el dinero, de qué cliente, y a qué proyecto corresponde. */
export function armarMensajeIngreso(datos: DatosMensajeIngreso): string {
	return `Se ha registrado un ingreso de ${formatCurrency(datos.monto)}, el día ${formatearFechaCorta(datos.fecha)} del cliente ${datos.cliente}, a la cuenta a nombre de ${datos.cuentaBancaria}, por el proyecto ${datos.nombreProyecto}`;
}

export interface DatosMensajeIngresoEfectivo {
	monto: number;
	/** 'YYYY-MM-DD'. */
	fecha: string;
	cliente: string;
	/** Label de la cuenta bancaria de destino — normalmente vacío/"—" en Efectivo (el dinero no entra a
	 * ninguna cuenta bancaria real), se muestra igual tal cual llegue. */
	cuentaBancaria: string;
	nombreProyecto: string;
}

/** Ingreso recibido en efectivo — a pedido explícito del usuario, mismo tenor que armarMensajeIngreso
 * (no efectivo), agregando "en efectivo" al monto. */
export function armarMensajeIngresoEfectivo(datos: DatosMensajeIngresoEfectivo): string {
	return `Se ha registrado un ingreso en efectivo de ${formatCurrency(datos.monto)}, el día ${formatearFechaCorta(datos.fecha)} del cliente ${datos.cliente}, a la cuenta a nombre de ${datos.cuentaBancaria}, por el proyecto ${datos.nombreProyecto}`;
}

/** El mensaje va al propio proveedor/cliente: sin el código interno del centro de costo ("CLI-39 - SAF
 * IMPORTS S.A.C." → "SAF IMPORTS S.A.C."). */
function sinCodigoInterno(nombre: string): string {
	return nombre.replace(/^[A-Z]{2,6}-\d+\s*-\s*/, '').trim();
}

/** Tickets #83 / #107 — "Compartir a proveedor": redactado para enviarlo al propio proveedor, con el texto exacto
 * que pidió el cliente: "Se pagó S/ 250.00 al proveedor Denis Paul Valdivia R., el día 06/10/2026." */
export function armarMensajeEgresoParaProveedor(datos: Omit<DatosMensajeEgreso, 'usuario'>): string {
	return `Se pagó ${formatCurrency(datos.monto)} al proveedor ${sinCodigoInterno(datos.proveedor)}, el día ${formatearFechaCorta(datos.fecha)}.`;
}

/** Ticket #83 — "Compartir a cliente": confirmación del ingreso redactada para enviarla al cliente. */
export function armarMensajeIngresoParaCliente(datos: DatosMensajeIngreso): string {
	return `Se registró el pago recibido de ${formatCurrency(datos.monto)} del cliente ${sinCodigoInterno(datos.cliente)}, con fecha ${formatearFechaCorta(datos.fecha)}, por el proyecto ${datos.nombreProyecto}.`;
}
