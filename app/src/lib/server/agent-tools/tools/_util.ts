/** Helpers compartidos por los archivos de dominio de agent-tools. */

/** Convierte el ServiceResult de un *.service.ts en un valor de retorno o un Error — así el agente
 * recibe el mensaje real de la regla de negocio que falló (isError en el protocolo MCP) en vez de un
 * "success: false" ambiguo dentro de un resultado aparentemente exitoso. */
export function desempaquetar<T>(r: { success: boolean; message: string; data?: T; errors?: Record<string, string> }): { mensaje: string; data: T | undefined } {
	if (!r.success) {
		throw new Error(`${r.message}${r.errors ? ' — ' + JSON.stringify(r.errors) : ''}`);
	}
	return { mensaje: r.message, data: r.data };
}

export function exigirNumero(valor: unknown, nombre: string): number {
	const n = Number(valor);
	if (valor === undefined || valor === null || valor === '' || !Number.isFinite(n)) throw new Error(`${nombre} debe ser un número.`);
	return n;
}

export function exigirObjeto(valor: unknown, nombre: string): Record<string, unknown> {
	if (!valor || typeof valor !== 'object' || Array.isArray(valor)) throw new Error(`${nombre} debe ser un objeto.`);
	return valor as Record<string, unknown>;
}

export function limiteDe(valor: unknown, porDefecto = 50, maximo = 200): number {
	const n = Number(valor);
	return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), maximo) : porDefecto;
}

/** Usuario que queda en usuario_registro de todo lo que crean las herramientas de escritura. */
export const USUARIO_AGENTE = 'agente-mcp';
export const NOMBRE_AGENTE = 'Agente MCP';

export const redondear = (n: number): number => Number(n.toFixed(2));
