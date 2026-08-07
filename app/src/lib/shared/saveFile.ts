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
import { base64ToUint8Array } from '$lib/shared/base64';

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

/** Igual que guardarArchivoDeTexto pero para contenido BINARIO (ej. un .xlsx generado con exceljs) —
 * a pedido del usuario, las exportaciones de Ventas/Clientes pasaron de CSV a Excel real, que no es
 * texto plano. `contenidoBase64` es el archivo ya codificado en base64 (mismo formato en el que se
 * guarda en payload_cambios de una solicitud de exportación, ver ventasExport/clientesExport
 * .service.ts) — acá se decodifica antes de escribirlo a disco o armar el Blob de descarga. */
export async function guardarArchivoBinario(contenidoBase64: string, nombreSugerido: string, mime: string): Promise<void> {
	const bytes = base64ToUint8Array(contenidoBase64);

	if (isRunningInTauri()) {
		const { save } = await import('@tauri-apps/plugin-dialog');
		const { writeFile } = await import('@tauri-apps/plugin-fs');

		const extension = nombreSugerido.includes('.') ? nombreSugerido.split('.').pop()! : 'xlsx';
		const path = await save({
			defaultPath: nombreSugerido,
			filters: [{ name: extension.toUpperCase(), extensions: [extension] }]
		});
		if (!path) return; // el usuario canceló el diálogo — no es un error

		await writeFile(path, bytes);
		return;
	}

	const blob = new Blob([bytes], { type: mime });
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = nombreSugerido;
	document.body.appendChild(a);
	a.click();
	document.body.removeChild(a);
	URL.revokeObjectURL(url);
}
