/**
 * Exportar cualquier vista a Excel (.xlsx) — a pedido del usuario ("todas las vistas debo poder exportar").
 * Genérico: cada pantalla pasa sus columnas y sus filas tal como las muestra (ya filtradas/buscadas). Mismo
 * mecanismo que ventasExport.service.ts: exceljs arma el archivo en memoria y guardarArchivoBinario lo guarda
 * (diálogo "Guardar como" en Tauri Windows/Android, descarga normal en navegador).
 */
import ExcelJS from 'exceljs';
import { guardarArchivoBinario } from '$lib/shared/saveFile';
import { arrayBufferToBase64 } from '$lib/shared/base64';

export interface ColumnaExportacion {
	titulo: string;
	/** Ancho aproximado en caracteres (por defecto 18). */
	ancho?: number;
	/** 'moneda' aplica formato S/ con 2 decimales a valores numéricos. */
	formato?: 'moneda';
}

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export async function exportarTablaXlsx(opciones: {
	/** Nombre base del archivo, sin extensión (se le agrega la fecha). */
	nombreArchivo: string;
	hoja: string;
	columnas: ColumnaExportacion[];
	filas: (string | number | null | undefined)[][];
}): Promise<void> {
	const libro = new ExcelJS.Workbook();
	const hoja = libro.addWorksheet(opciones.hoja.slice(0, 31));
	hoja.columns = opciones.columnas.map((c) => ({ header: c.titulo, width: c.ancho ?? 18 }));
	const encabezado = hoja.getRow(1);
	encabezado.font = { bold: true, color: { argb: 'FFFFFFFF' } };
	encabezado.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F3B5E' } };
	for (const fila of opciones.filas) hoja.addRow(fila.map((v) => (v === null || v === undefined ? '' : v)));
	opciones.columnas.forEach((c, i) => {
		if (c.formato === 'moneda') hoja.getColumn(i + 1).numFmt = '"S/ "#,##0.00';
	});
	hoja.views = [{ state: 'frozen', ySplit: 1 }];

	const buffer = await libro.xlsx.writeBuffer();
	const fecha = new Date().toLocaleDateString('en-CA');
	await guardarArchivoBinario(arrayBufferToBase64(buffer as ArrayBuffer), `${opciones.nombreArchivo}_${fecha}.xlsx`, XLSX_MIME);
}
