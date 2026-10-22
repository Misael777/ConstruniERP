/**
 * Modo diagnóstico (a pedido del usuario, para el congelamiento al subir una transferencia desde Android):
 * un registro paso a paso que se guarda en el propio teléfono (localStorage, escritura síncrona) ANTES de
 * cada paso pesado. Si Android mata la app a la mitad (falta de memoria), el registro sobrevive y al volver a
 * abrirla se ve cuál fue el último paso que alcanzó a empezar — ver revisarCaidaAnterior.
 *
 * Se ve desde la app con el panel DiagnosticoPanel.svelte (se activa tocando 5 veces la versión, arriba a la
 * derecha). El registro se graba siempre (es barato); el panel solo se muestra con el modo activo. Una caída a
 * mitad de una operación se reporta además a la auditoría (ver reportarDiagnostico en auditoria.ts), así se
 * puede ver en Prod aunque nadie haya abierto el panel.
 */

const CLAVE_LOG = 'construni_diag_log';
const CLAVE_EN_CURSO = 'construni_diag_en_curso';
const CLAVE_ACTIVO = 'construni_diag_activo';
const MAX_ENTRADAS = 300;

export interface EntradaDiag {
	t: string;
	paso: string;
	datos?: Record<string, unknown>;
	memoria?: string | null;
}

export interface OperacionEnCurso {
	nombre: string;
	t: string;
}

function leerJson<T>(clave: string, porDefecto: T): T {
	try {
		const crudo = localStorage.getItem(clave);
		return crudo ? (JSON.parse(crudo) as T) : porDefecto;
	} catch {
		return porDefecto;
	}
}

function escribir(clave: string, valor: unknown) {
	try {
		if (valor === null) localStorage.removeItem(clave);
		else localStorage.setItem(clave, JSON.stringify(valor));
	} catch {
		/* localStorage lleno o bloqueado: el diagnóstico nunca debe romper la app */
	}
}

export const diagState = $state({
	activo: typeof localStorage !== 'undefined' && leerJson<boolean>(CLAVE_ACTIVO, false),
	abierto: false,
	/** Sube con cada entrada nueva, para que el panel se refresque. */
	version: 0
});

/** Memoria del JavaScript de la página (solo Chromium/WebView de Android la expone). No incluye la memoria
 * de canvas ni de Tesseract (WASM), que es justamente la sospechosa — por eso cada paso anota además el
 * tamaño en píxeles de lo que se procesa. */
export function memoriaActual(): string | null {
	const m = (performance as unknown as { memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number } }).memory;
	if (!m) return null;
	return `${Math.round(m.usedJSHeapSize / 1048576)} / ${Math.round(m.jsHeapSizeLimit / 1048576)} MB`;
}

export function diag(paso: string, datos?: Record<string, unknown>): void {
	const entrada: EntradaDiag = { t: new Date().toISOString(), paso, ...(datos ? { datos } : {}), memoria: memoriaActual() };
	const log = leerJson<EntradaDiag[]>(CLAVE_LOG, []);
	log.push(entrada);
	escribir(CLAVE_LOG, log.slice(-MAX_ENTRADAS));
	diagState.version++;
	console.log(`[diag] ${paso}`, datos ?? '', entrada.memoria ?? '');
}

/** Marca el inicio de una operación pesada. Si la app muere antes de terminarOperacion, la marca queda
 * guardada y revisarCaidaAnterior la encuentra en el próximo arranque. */
export function iniciarOperacion(nombre: string, datos?: Record<string, unknown>): void {
	escribir(CLAVE_EN_CURSO, { nombre, t: new Date().toISOString() } satisfies OperacionEnCurso);
	diag(`▶ ${nombre}`, datos);
}

export function terminarOperacion(nombre: string, datos?: Record<string, unknown>): void {
	escribir(CLAVE_EN_CURSO, null);
	diag(`■ ${nombre}`, datos);
}

/** Al arrancar la app: si quedó una operación sin terminar, la app se cerró (o la mató Android) en medio de
 * ella. Devuelve esa operación (una sola vez) y la anota en el registro. */
export function revisarCaidaAnterior(): OperacionEnCurso | null {
	const enCurso = leerJson<OperacionEnCurso | null>(CLAVE_EN_CURSO, null);
	if (!enCurso) return null;
	escribir(CLAVE_EN_CURSO, null);
	diag(`✖ La app se cerró en medio de "${enCurso.nombre}" (empezó ${new Date(enCurso.t).toLocaleTimeString('es-PE')})`);
	return enCurso;
}

export function leerLog(): EntradaDiag[] {
	return leerJson<EntradaDiag[]>(CLAVE_LOG, []);
}

export function limpiarLog(): void {
	escribir(CLAVE_LOG, null);
	diagState.version++;
}

export function activarDiagnostico(activo: boolean): void {
	diagState.activo = activo;
	if (!activo) diagState.abierto = false;
	escribir(CLAVE_ACTIVO, activo ? true : null);
}

export function formatearEntrada(e: EntradaDiag): string {
	const hora = new Date(e.t).toLocaleTimeString('es-PE', { hour12: false }) + '.' + String(new Date(e.t).getMilliseconds()).padStart(3, '0');
	const datos = e.datos ? ' ' + JSON.stringify(e.datos) : '';
	return `${hora}  ${e.paso}${datos}${e.memoria ? `  [mem ${e.memoria}]` : ''}`;
}

/** Datos del equipo útiles para el diagnóstico. */
export function infoEquipo(): Record<string, unknown> {
	const nav = navigator as Navigator & { deviceMemory?: number };
	return {
		memoriaEquipoGB: nav.deviceMemory ?? null,
		nucleos: nav.hardwareConcurrency ?? null,
		pantalla: `${screen.width}x${screen.height} @${window.devicePixelRatio}`,
		agente: navigator.userAgent.slice(0, 160)
	};
}
