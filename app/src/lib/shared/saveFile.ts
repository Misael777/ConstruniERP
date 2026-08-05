/**
 * Guarda contenido de texto (ej. un CSV generado en el cliente) a disco — a pedido del usuario: en
 * la app de Windows/Android empaquetada (Tauri), el patrón Blob + `<a download>` no dispara un
 * diálogo nativo "Guardar como", el WebView simplemente lo ignora o lo descarga sin preguntar dónde.
 * Acá se usa el plugin oficial de diálogo (`@tauri-apps/plugin-dialog`, `save()`) + el de filesystem
 * (`@tauri-apps/plugin-fs`, `writeTextFile()`) para mostrar el diálogo real y escribir el archivo en
 * la ruta que el usuario elija. En navegador normal (no Tauri) se mantiene el Blob + `<a download>`
 * de siempre, que el navegador ya maneja con su propio flujo de descarga/guardado.
 */
import { isRunningInTauri } from '$lib/driveUploadClient';

/** Descarga/guarda un archivo de texto — reusable por cualquier exportación (Ventas hoy, otros
 * módulos después) sin duplicar la lógica de branching Tauri-vs-navegador. */
export async function guardarArchivoDeTexto(contenido: string, nombreSugerido: string, mime = 'text/csv;charset=utf-8;'): Promise<void> {
	if (isRunningInTauri()) {
		const { save } = await import('@tauri-apps/plugin-dialog');
		const { writeTextFile } = await import('@tauri-apps/plugin-fs');

		const extension = nombreSugerido.includes('.') ? nombreSugerido.split('.').pop()! : 'csv';
		const path = await save({
			defaultPath: nombreSugerido,
			filters: [{ name: extension.toUpperCase(), extensions: [extension] }]
		});
		if (!path) return; // el usuario canceló el diálogo — no es un error

		await writeTextFile(path, contenido);
		return;
	}

	const blob = new Blob([contenido], { type: mime });
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = nombreSugerido;
	document.body.appendChild(a);
	a.click();
	document.body.removeChild(a);
	URL.revokeObjectURL(url);
}
