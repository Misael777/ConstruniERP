/**
 * CSS compartido por los recibos/comprobantes en PDF renderizados como HTML + html2canvas
 * (comprobanteTransferenciaInterna.ts, reciboPagoEfectivo.ts) — mismo lenguaje visual (header con
 * logo/N°, cajas con bordes redondeados, círculos numerados azules) en ambos documentos. Cada generador
 * puede sumar sus propias clases extra (ver ESTILOS_FIRMA en reciboPagoEfectivo.ts) sin chocar con
 * estas, porque cada render se monta en un contenedor aislado y descartable (ver pdfHtmlRender.ts).
 */
export const ESTILOS_VOUCHER_BASE = `
	.voucher-copia { font-family: -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1e293b; padding: 22px 26px; box-sizing: border-box; border: 1.5px solid #64748b; border-radius: 14px; }
	.v-header { display: flex; align-items: flex-start; justify-content: space-between; border-bottom: 2px solid #0f3b5e; padding-bottom: 14px; margin-bottom: 16px; }
	.v-empresa { display: flex; align-items: center; gap: 10px; }
	.v-logo { width: 34px; height: 34px; border-radius: 50%; background: #0f3b5e; color: #fff; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 15px; flex-shrink: 0; overflow: hidden; }
	.v-logo-img { width: 100%; height: 100%; object-fit: cover; }
	.v-empresa-nombre { font-weight: 700; font-size: 15px; color: #0f3b5e; }
	.v-empresa-ruc { font-size: 11px; color: #64748b; margin-top: 1px; }
	.v-header-right { text-align: right; }
	.v-numero-badge { display: inline-block; border: 1.5px solid #0f3b5e; color: #0f3b5e; font-weight: 700; font-size: 15px; padding: 3px 12px; border-radius: 8px; margin-bottom: 4px; }
	.v-header-meta { font-size: 10.5px; color: #64748b; line-height: 1.5; }
	.v-header-meta .v-titulo { font-weight: 600; color: #334155; }
	.v-intro { font-size: 12px; color: #334155; margin-bottom: 16px; line-height: 1.5; }
	.v-seccion { margin-bottom: 14px; }
	.v-seccion-titulo { display: flex; align-items: center; gap: 8px; font-weight: 700; font-size: 12.5px; color: #0f3b5e; margin-bottom: 6px; }
	.v-num-circulo { width: 20px; height: 20px; border-radius: 50%; background: #0f3b5e; color: #fff; font-size: 11px; font-weight: 700; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
	.v-caja { border: 1.5px solid #dbe3ec; border-radius: 12px; background: #f8fafc; overflow: hidden; }
	.v-caja-2col { display: flex; }
	.v-caja-1col { padding: 10px 14px; }
	.v-col { flex: 1; min-width: 0; padding: 10px 14px; }
	.v-col + .v-col { border-left: 1.5px solid #dbe3ec; position: relative; }
	/* Importe/Concepto (ver .v-importe/.v-texto, agrandados 4x a pedido explícito del usuario) ya no
	   caben lado a lado sin desbordarse y superponerse — esta sección se apila en una sola columna, cada
	   bloque a todo el ancho, en vez de usar v-caja-2col. */
	.v-caja-vertical { display: flex; flex-direction: column; }
	.v-caja-vertical .v-col + .v-col { border-left: none; border-top: 1.5px solid #dbe3ec; }
	.v-col-label { font-size: 9.5px; font-weight: 600; color: #64748b; text-transform: uppercase; letter-spacing: 0.02em; margin-bottom: 4px; }
	.v-col-codigo { font-weight: 700; font-size: 13.5px; color: #0f3b5e; }
	.v-col-nombre { font-size: 11px; color: #334155; margin-top: 2px; word-break: break-word; }
	.v-flecha { width: 26px; height: 26px; border-radius: 50%; background: #0f3b5e; color: #fff; display: flex; align-items: center; justify-content: center; font-size: 13px; position: absolute; left: -13px; top: 50%; transform: translateY(-50%); z-index: 1; box-shadow: 0 0 0 3px #f8fafc; }
	.v-importe { font-weight: 700; font-size: 68px; color: #0f3b5e; line-height: 1.1; }
	.v-importe-letras { font-size: 9.5px; font-style: italic; color: #64748b; margin-top: 3px; }
	.v-texto { font-size: 44px; line-height: 1.15; color: #334155; word-break: break-word; }
	.v-cuenta-codigo { font-weight: 700; font-size: 12px; color: #0f3b5e; display: inline-block; min-width: 52px; }
	.v-cuenta-nombre { font-size: 10.5px; color: #334155; }
	.v-footer { border-top: 1px solid #dbe3ec; margin-top: 10px; padding-top: 10px; font-size: 10.5px; color: #475569; line-height: 1.6; }
	.v-footer-titulo { font-weight: 700; color: #0f3b5e; font-size: 10.5px; margin-bottom: 2px; }
`;

export function escapeHtml(texto: string): string {
	const div = document.createElement('div');
	div.textContent = texto ?? '';
	return div.innerHTML;
}
