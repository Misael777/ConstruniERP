/**
 * Vuelca un error de Supabase/Postgrest a un string legible (message/code/details/hint, lo que
 * venga presente). Pensado para mostrarse directo en un `alert()`: en el .exe empaquetado no hay
 * consola accesible para el usuario, así que el alert es la única forma de ver qué falló realmente.
 */
export function describeError(err: any): string {
	if (!err) return 'Error desconocido';
	const parts: string[] = [];
	if (err.message) parts.push(String(err.message));
	if (err.code) parts.push(`code=${err.code}`);
	if (err.details) parts.push(`details=${err.details}`);
	if (err.hint) parts.push(`hint=${err.hint}`);
	return parts.length ? parts.join(' | ') : String(err);
}
