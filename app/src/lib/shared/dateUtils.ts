/**
 * `new Date().toISOString().slice(0, 10)` es un bug clásico de zona horaria: `toISOString()`
 * convierte a UTC antes de formatear. Perú es UTC-5, así que cualquier hora local desde
 * aprox. las 7pm en adelante ya cae en el día siguiente en UTC — un campo de fecha que debería
 * mostrar "hoy" por defecto termina mostrando mañana. Esta función arma la fecha YYYY-MM-DD a
 * partir de los componentes LOCALES (getFullYear/getMonth/getDate), no de UTC.
 */
export function getFechaLocalHoy(): string {
	const now = new Date();
	const year = now.getFullYear();
	const month = String(now.getMonth() + 1).padStart(2, '0');
	const day = String(now.getDate()).padStart(2, '0');
	return `${year}-${month}-${day}`;
}
