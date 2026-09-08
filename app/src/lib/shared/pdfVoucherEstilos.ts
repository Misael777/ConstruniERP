/**
 * CSS compartido por los recibos/comprobantes en PDF renderizados como HTML + html2canvas
 * (comprobanteTransferenciaInterna.ts, reciboPagoEfectivo.ts) — mismo lenguaje visual (header con
 * logo/N°, cajas con bordes redondeados, círculos numerados azules) en ambos documentos. Cada generador
 * puede sumar sus propias clases extra (ver ESTILOS_FIRMA en reciboPagoEfectivo.ts) sin chocar con
 * estas, porque cada render se monta en un contenedor aislado y descartable (ver pdfHtmlRender.ts).
 */
/**
 * Sello de agua "BORRADOR" — a pedido explícito del usuario: TODO recibo que se autogenera (Recibo de
 * Pago, Recibo de Pago a Proveedor, Boucher de Transferencia Interna) queda marcado como borrador hasta
 * que la transacción se guarda de verdad (crea/edita) y recién ahí ese mismo archivo (con el sello ya
 * incluido, no se genera una segunda versión "limpia") se sube a Drive como el comprobante real — mismo
 * criterio ya establecido de "no se guarda de una vez" (ver handleGenerarReciboPago/
 * handleGenerarReciboPagoProveedor/handleGenerarBoucherTransferencia en TransaccionModal.svelte). Se
 * exporta la función (no solo la clase CSS) porque reciboPagoEfectivo.ts NO usa ESTILOS_VOUCHER_BASE
 * (diseño propio de posicionamiento absoluto, escala de fuente muy distinta) y necesita un tamaño de
 * letra distinto para el mismo sello — `fontSizePx` deja que cada plantilla lo ajuste a su propia
 * escala en vez de imponer un tamaño fijo.
 */
export const CSS_MARCA_AGUA = `
	.v-marca-agua { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; overflow: hidden; pointer-events: none; z-index: 999; }
	.v-marca-agua span { display: block; font-weight: 800; color: rgba(100, 116, 139, 0.24); letter-spacing: 0.15em; text-transform: uppercase; white-space: nowrap; transform: rotate(-28deg); user-select: none; }
`;

/** HTML del sello — insertar como último hijo del contenedor de CADA copia (para que quede encima de
 * su propio contenido, no una sola vez sobre toda la hoja), con el tamaño de letra que le calce a esa
 * plantilla. */
export function marcaAguaBorrador(fontSizePx: number): string {
	return `<div class="v-marca-agua"><span style="font-size:${fontSizePx}px">BORRADOR</span></div>`;
}

export const ESTILOS_VOUCHER_BASE = `
	.voucher-copia { position: relative; font-family: -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1e293b; padding: 22px 26px; box-sizing: border-box; border: 1.5px solid #64748b; border-radius: 14px; }
	${CSS_MARCA_AGUA}
	.v-header { display: flex; align-items: flex-start; justify-content: space-between; border-bottom: 1px solid #dbe3ec; padding-bottom: 14px; margin-bottom: 16px; }
	.v-empresa { display: flex; align-items: center; gap: 10px; }
	/* Círculo blanco con borde navy (calcado del comprobante físico de referencia) en vez del círculo
	   navy sólido de antes — ese fondo navy + el logo invertido a blanco lo dejaba prácticamente
	   invisible. */
	.v-logo { width: 34px; height: 34px; border-radius: 50%; background: #fff; border: 1.5px solid #0f3b5e; color: #0f3b5e; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 15px; flex-shrink: 0; overflow: hidden; }
	/* Ícono de brújula en un solo color — a pedido explícito del usuario, con imagen de referencia
	   (comprobante físico de otra empresa que usó como modelo de formato). No es posible extraer el
	   gráfico exacto de esa captura de pantalla (no hay forma de recortar/vectorizar una imagen pegada
	   en el chat), así que se recreó a mano como SVG — mismo criterio que ICONO_CAMION/ICONO_BILLETE en
	   reciboPagoProveedor.ts (SVG inline en vez de un ícono de fuente/emoji, para que se vea idéntico en
	   navegador, Tauri Windows y Tauri Android). */
	.v-logo-icono { width: 20px; height: 20px; color: #0f3b5e; }
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
	/* Importe/Concepto — antes (ver .v-importe/.v-texto agrandados 4x) no cabían lado a lado y esta
	   sección se apilaba en una sola columna con v-caja-vertical. A pedido explícito del usuario:
	   tamaños reducidos de vuelta y vuelven a ir en la misma línea (v-caja-2col, ver
	   comprobanteTransferenciaInterna.ts), esta clase queda solo por si algún otro recibo la necesita. */
	.v-caja-vertical { display: flex; flex-direction: column; }
	.v-caja-vertical .v-col + .v-col { border-left: none; border-top: 1.5px solid #dbe3ec; }
	.v-col-label { font-size: 9.5px; font-weight: 600; color: #64748b; text-transform: uppercase; letter-spacing: 0.02em; margin-bottom: 4px; }
	.v-col-codigo { font-weight: 700; font-size: 13.5px; color: #0f3b5e; }
	.v-col-nombre { font-size: 11px; color: #334155; margin-top: 2px; word-break: break-word; }
	.v-flecha { width: 26px; height: 26px; border-radius: 50%; background: #0f3b5e; color: #fff; display: flex; align-items: center; justify-content: center; font-size: 13px; position: absolute; left: -13px; top: 50%; transform: translateY(-50%); z-index: 1; box-shadow: 0 0 0 3px #f8fafc; }
	.v-importe { font-weight: 700; font-size: 26px; color: #0f3b5e; line-height: 1.1; }
	.v-importe-letras { font-size: 9.5px; font-style: italic; color: #64748b; margin-top: 3px; }
	.v-texto { font-weight: 700; font-size: 20px; line-height: 1.25; color: #334155; word-break: break-word; }
	.v-cuenta-codigo { font-weight: 700; font-size: 12px; color: #0f3b5e; display: inline-block; min-width: 52px; }
	.v-cuenta-nombre { font-size: 10.5px; color: #334155; }
	.v-footer { border-top: 1px solid #dbe3ec; margin-top: 10px; padding-top: 10px; font-size: 10.5px; color: #475569; line-height: 1.6; }
	.v-footer-titulo { font-weight: 700; color: #0f3b5e; font-size: 10.5px; margin-bottom: 2px; }
	/* Recibos con firma manuscrita (ver reciboPagoProveedor.ts/reciboPagoEfectivo.ts) — a pedido
	   explícito del usuario, con imagen de referencia: mismo lenguaje visual v-* de arriba (cajas
	   redondeadas, círculos numerados) en vez del layout viejo de posicionamiento absoluto con fuentes
	   diminutas. */
	.v-icono-inline { width: 14px; height: 14px; flex-shrink: 0; }
	.v-cashbox-row { display: flex; align-items: center; gap: 4px; font-weight: 700; font-size: 12px; color: #0f3b5e; }
	.v-forma-pago-texto { border: 1.2px solid #94a3b8; border-radius: 8px; padding: 8px 12px; font-size: 12.5px; font-weight: 700; color: #1e293b; letter-spacing: 0.02em; margin-top: 4px; }
	.v-firmas { display: flex; gap: 14px; margin-top: 4px; }
	.v-firma { flex: 1; min-width: 0; text-align: center; border: 1.5px solid #dbe3ec; border-radius: 12px; padding: 12px 10px; background: #f8fafc; }
	.v-firma-titulo { font-size: 9.5px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.02em; margin-bottom: 8px; }
	.v-firma-img-wrap { height: 38px; display: flex; align-items: flex-end; justify-content: center; }
	.v-firma-img { max-height: 38px; max-width: 90%; object-fit: contain; }
	.v-firma-linea { border-top: 1px solid #94a3b8; width: 80%; margin: 4px auto 0; }
	.v-firma-nombre { font-size: 11px; font-weight: 700; color: #1e293b; margin-top: 5px; }
	.v-firma-info { font-size: 9px; color: #64748b; line-height: 1.45; margin-top: 2px; }
`;

/** Ícono de brújula para el círculo del header del "RECIBO - TRANSFERENCIA INTERNA" (ver
 * comprobanteTransferenciaInterna.ts) — calcado del ícono "Compass" de Lucide (mismo criterio que
 * ICONO_CAMION/ICONO_BILLETE en reciboPagoProveedor.ts), NO una copia del logo de otra empresa: no hay
 * forma de extraer el gráfico exacto de una captura de pantalla pegada en el chat, así que se recreó
 * a mano con un ícono genérico de brújula del mismo lenguaje visual que ya usa el resto del ERP.
 * `currentColor` toma el color de `.v-logo-icono` (ver pdfVoucherEstilos.ts). */
export const ICONO_BRUJULA = `<svg class="v-logo-icono" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/></svg>`;

export function escapeHtml(texto: string): string {
	const div = document.createElement('div');
	div.textContent = texto ?? '';
	return div.innerHTML;
}
