import { chromium } from 'playwright';
import fs from 'fs';

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto('http://localhost:5173/');

const base64 = await page.evaluate(async () => {
	const mod = await import('/src/lib/shared/comprobanteTransferenciaInterna.ts');
	return await mod.generarComprobanteTransferenciaInternaBase64({
		numero: 12,
		fecha: '2026-08-31',
		origenCodigo: 'PRY-001',
		origenNombre: 'Construcción Torre Norte',
		destinoCodigo: 'PRY-002',
		destinoNombre: 'Edificio Sur',
		monto: 15000,
		concepto: 'Pago a cuenta por suministro de materiales según Factura N° F001-000452',
		usuario: 'Juan Perez'
	});
});

// Guarda el PDF a disco y lo abre por file:// (evita el límite de tamaño de una data: URL) con el
// visor nativo de Chromium, para verificar el archivo EXACTO que genera la función pública.
fs.writeFileSync('C:/Users/Misael/AppData/Local/Temp/claude/d--construni-ConstruniERP/3b00c505-2f15-47c9-81ef-8d26a53c26e2/scratchpad/comprobante_real.pdf', Buffer.from(base64, 'base64'));
const pdfPage = await browser.newPage({ viewport: { width: 850, height: 1100 } });
await pdfPage.goto('file://C:/Users/Misael/AppData/Local/Temp/claude/d--construni-ConstruniERP/3b00c505-2f15-47c9-81ef-8d26a53c26e2/scratchpad/comprobante_real.pdf');
await pdfPage.waitForTimeout(1500);
await pdfPage.screenshot({ path: 'C:/Users/Misael/AppData/Local/Temp/claude/d--construni-ConstruniERP/3b00c505-2f15-47c9-81ef-8d26a53c26e2/scratchpad/comprobante_real_logo.png' });
console.log('OK, base64 length:', base64.length);
await browser.close();
