/**
 * Vuelca un error de Supabase/Postgrest a un string legible (message/code/details/hint, lo que
 * venga presente). Pensado para mostrarse directo en un `alert()`: en el .exe empaquetado no hay
 * consola accesible para el usuario, así que el alert es la única forma de ver qué falló realmente.
 */
export function describeError(err: any): string {
	if (!err) return 'Error desconocido';
	if (typeof err === 'string') return err;
	const parts: string[] = [];
	if (err.message) parts.push(String(err.message));
	if (err.code) parts.push(`code=${err.code}`);
	if (err.details) parts.push(`details=${err.details}`);
	if (err.hint) parts.push(`hint=${err.hint}`);
	if (parts.length) return parts.join(' | ');
	// Sin message/code/details/hint (no es un Error ni un PostgrestError reconocible) — String(err) de un
	// objeto plano da "[object Object]", ilegible. Se intenta JSON.stringify para que al menos se vean
	// las claves/valores reales y se pueda diagnosticar qué falló.
	try {
		const json = JSON.stringify(err);
		if (json && json !== '{}') return json;
	} catch {
		/* err no es serializable (ej. referencia circular) — se cae al String(err) de abajo */
	}
	return String(err);
}
