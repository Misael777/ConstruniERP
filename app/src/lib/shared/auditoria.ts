/**
 * Auditoría (Control de Accesos → Auditoría) — el "auditor silencioso" del lado del frontend.
 *
 * - Abre una sesión de auditoría al entrar a la app (auditoria_iniciar_sesion) y manda un latido cada 60 s.
 *   Si la app se cierra sin avisar, el servidor la da por terminada a la hora del último latido.
 * - Registra cómo terminó cada sesión: botón de salir (`logout_manual`), pérdida de la sesión de Supabase
 *   (`sesion_expirada`), cierre de la ventana/pestaña (`app_cerrada`).
 * - Registra descargas/PDFs/subidas (registrarAccion) y errores JS no atrapados.
 * - Todo lo que no se pudo enviar queda en un diario local (archivo en disco vía Rust en Tauri, ver
 *   src-tauri/src/auditoria.rs; localStorage en el navegador) y se sube en el siguiente inicio.
 *
 * Cada sesión tiene un token propio: las funciones de la base lo validan para poder registrar el cierre aun
 * cuando la sesión de Supabase ya se perdió (el cliente queda como anónimo). Todo es best-effort: nada de
 * esto debe frenar ni romper la app.
 */
import { supabase, setAuditoriaSesionHeader, SUPABASE_URL, SUPABASE_ANON_KEY } from '$lib/supabaseClient';
import { isRunningInTauri } from '$lib/driveUploadClient';
import { getInfoVersionApp } from '$lib/shared/appVersion';

export type MotivoFinSesion = 'logout_manual' | 'sesion_expirada' | 'app_cerrada' | 'cierre_inesperado';
export type TipoAccionManual = 'descarga' | 'pdf' | 'subida';

interface SesionAuditoria {
	id: string;
	token: string;
	userId: string;
}

type EventoDiario =
	| { kind: 'cierre'; sesion: string; token: string; motivo: MotivoFinSesion; momento: string; detalle?: string | null }
	| { kind: 'accion'; sesion: string; token: string; tipo: TipoAccionManual; modulo: string; resumen: string; momento: string }
	| { kind: 'error'; sesion: string | null; token: string | null; origen: 'js' | 'rust_panic' | 'cierre'; mensaje: string; stack: string | null; plataforma: string | null; momento: string };

const CLAVE_SESION = 'construni_auditoria_sesion'; // sessionStorage: misma vida que la sesión de Supabase
const CLAVE_DIARIO_WEB = 'construni_auditoria_pendientes'; // localStorage: sobrevive al cierre
const MAX_DIARIO_WEB = 200;
const INTERVALO_LATIDO_MS = 60_000;

let sesion: SesionAuditoria | null = null;
let cerrada = false;
let cierreManualEnCurso = false;
let latidoTimer: ReturnType<typeof setInterval> | null = null;
let listenersInstalados = false;
let plataformaActual: string | null = null;

/* ------------------------------------------------------------------------------------------------ */
/* Diario local                                                                                      */
/* ------------------------------------------------------------------------------------------------ */

function leerDiarioWeb(): EventoDiario[] {
	try {
		return JSON.parse(localStorage.getItem(CLAVE_DIARIO_WEB) ?? '[]');
	} catch {
		return [];
	}
}

function escribirDiarioWeb(eventos: EventoDiario[]) {
	try {
		localStorage.setItem(CLAVE_DIARIO_WEB, JSON.stringify(eventos.slice(-MAX_DIARIO_WEB)));
	} catch {
		// almacenamiento lleno o bloqueado: se pierde el evento, no se rompe nada
	}
}

/** Síncrono a propósito (localStorage) — tiene que funcionar dentro de pagehide. */
function agregarDiarioWeb(evento: EventoDiario) {
	escribirDiarioWeb([...leerDiarioWeb(), evento]);
}

async function agregarDiario(evento: EventoDiario) {
	if (isRunningInTauri()) {
		try {
			const { invoke } = await import('@tauri-apps/api/core');
			await invoke('auditoria_diario_agregar', { linea: JSON.stringify(evento) });
			return;
		} catch {
			// cae al diario web
		}
	}
	agregarDiarioWeb(evento);
}

async function tomarDiario(): Promise<EventoDiario[]> {
	const eventos = leerDiarioWeb();
	try {
		localStorage.removeItem(CLAVE_DIARIO_WEB);
	} catch {
		/* noop */
	}
	if (isRunningInTauri()) {
		try {
			const { invoke } = await import('@tauri-apps/api/core');
			const lineas = await invoke<string[]>('auditoria_diario_tomar');
			for (const linea of lineas) {
				try {
					eventos.push(JSON.parse(linea));
				} catch {
					/* línea corrupta (ej. cortada por un corte de luz): se descarta */
				}
			}
		} catch {
			/* noop */
		}
	}
	return eventos;
}

/* ------------------------------------------------------------------------------------------------ */
/* Envío al servidor                                                                                 */
/* ------------------------------------------------------------------------------------------------ */

async function enviar(evento: EventoDiario): Promise<boolean> {
	try {
		let error: unknown = null;
		if (evento.kind === 'cierre') {
			({ error } = await supabase.rpc('auditoria_cerrar_sesion', {
				p_sesion: evento.sesion,
				p_token: evento.token,
				p_motivo: evento.motivo,
				p_momento: evento.momento,
				p_detalle: evento.detalle ?? null
			}));
		} else if (evento.kind === 'accion') {
			({ error } = await supabase.rpc('auditoria_registrar_evento', {
				p_sesion: evento.sesion,
				p_token: evento.token,
				p_tipo: evento.tipo,
				p_modulo: evento.modulo,
				p_resumen: evento.resumen,
				p_momento: evento.momento
			}));
		} else {
			({ error } = await supabase.rpc('auditoria_registrar_error', {
				p_sesion: evento.sesion,
				p_token: evento.token,
				p_origen: evento.origen,
				p_mensaje: evento.mensaje,
				p_stack: evento.stack,
				p_plataforma: evento.plataforma,
				p_momento: evento.momento
			}));
		}
		return !error;
	} catch {
		return false;
	}
}

/** Envía; si no llega, lo deja en el diario para el próximo inicio. */
async function enviarOGuardar(evento: EventoDiario) {
	if (!(await enviar(evento))) await agregarDiario(evento);
}

async function avisarSesionANativo(s: SesionAuditoria | null) {
	if (!isRunningInTauri()) return;
	try {
		const { invoke } = await import('@tauri-apps/api/core');
		await invoke('auditoria_sesion_actual', s
			? { sesionId: s.id, token: s.token, url: SUPABASE_URL, anonKey: SUPABASE_ANON_KEY }
			: { sesionId: null, token: null, url: null, anonKey: null });
	} catch {
		/* noop */
	}
}

/* ------------------------------------------------------------------------------------------------ */
/* Ciclo de vida de la sesión                                                                        */
/* ------------------------------------------------------------------------------------------------ */

function leerSesionGuardada(): SesionAuditoria | null {
	try {
		return JSON.parse(sessionStorage.getItem(CLAVE_SESION) ?? 'null');
	} catch {
		return null;
	}
}

function guardarSesion(s: SesionAuditoria | null) {
	try {
		if (s) sessionStorage.setItem(CLAVE_SESION, JSON.stringify(s));
		else sessionStorage.removeItem(CLAVE_SESION);
	} catch {
		/* noop */
	}
}

function detenerLatido() {
	if (latidoTimer) clearInterval(latidoTimer);
	latidoTimer = null;
}

async function latido() {
	if (!sesion || cerrada) return;
	try {
		await supabase.rpc('auditoria_latido', { p_sesion: sesion.id, p_token: sesion.token });
	} catch {
		/* sin red: el siguiente latido lo vuelve a intentar */
	}
}

function iniciarLatido() {
	detenerLatido();
	latidoTimer = setInterval(latido, INTERVALO_LATIDO_MS);
}

/** Se llama al montar el layout de la app, ya con la sesión de Supabase verificada. */
export async function iniciarSesionAuditoria(userId: string): Promise<void> {
	try {
		const { version, plataforma } = await getInfoVersionApp();
		plataformaActual = plataforma;
		instalarListeners();

		// Recarga de la página (F5) dentro de la misma sesión: se reutiliza la sesión de auditoría en vez de
		// abrir otra, y se descarta el "app_cerrada" que dejó el pagehide de esa recarga.
		const guardada = leerSesionGuardada();
		const reutilizar = guardada && guardada.userId === userId ? guardada : null;

		const pendientes = (await tomarDiario()).filter(
			(e) => !(reutilizar && e.kind === 'cierre' && e.sesion === reutilizar.id && e.motivo === 'app_cerrada')
		);
		for (const evento of pendientes) await enviarOGuardar(evento);

		if (reutilizar) {
			sesion = reutilizar;
		} else {
			const { data, error } = await supabase.rpc('auditoria_iniciar_sesion', { p_plataforma: plataforma, p_version: version });
			const fila = Array.isArray(data) ? data[0] : data;
			if (error || !fila) {
				console.warn('[auditoria] No se pudo abrir la sesión de auditoría:', error?.message);
				return;
			}
			sesion = { id: fila.sesion_id, token: fila.token, userId };
		}

		cerrada = false;
		cierreManualEnCurso = false;
		guardarSesion(sesion);
		setAuditoriaSesionHeader(sesion.id);
		await avisarSesionANativo(sesion);
		void latido();
		iniciarLatido();

		// Mantenimiento: cierra sesiones de otros que quedaron sin latido y aplica la retención (14/7 días).
		void supabase.rpc('auditoria_cerrar_huerfanas');
		void supabase.rpc('auditoria_purgar');
	} catch (err) {
		console.warn('[auditoria] Error al iniciar la auditoría:', err);
	}
}

/** Registra el fin de la sesión actual (una sola vez). */
export async function registrarCierre(motivo: MotivoFinSesion, detalle?: string): Promise<void> {
	if (!sesion || cerrada) return;
	cerrada = true;
	detenerLatido();
	const s = sesion;
	sesion = null;
	guardarSesion(null);
	setAuditoriaSesionHeader(null);
	await avisarSesionANativo(null);
	await enviarOGuardar({ kind: 'cierre', sesion: s.id, token: s.token, motivo, momento: new Date().toISOString(), detalle: detalle ?? null });
}

/** ¿El SIGNED_OUT que está llegando lo provocó el botón de "Cerrar sesión"? */
export function esCierreManual(): boolean {
	return cierreManualEnCurso;
}

/** Único punto de "Cerrar sesión" de la app (layout y sidebar). */
export async function cerrarSesion(): Promise<void> {
	cierreManualEnCurso = true;
	await registrarCierre('logout_manual');
	await supabase.auth.signOut();
}

/** Descargas, PDFs y subidas de archivos — se llama desde los puntos centrales (saveFile.ts, generadores de
 * PDF, subidas a Drive). `modulo` por defecto = la pantalla donde está el usuario (ej. /comercial/ventas). */
export function registrarAccion(tipo: TipoAccionManual, resumen: string, modulo?: string): void {
	if (!sesion) return;
	const moduloFinal = modulo ?? (typeof window !== 'undefined' ? window.location.pathname : '');
	void enviarOGuardar({ kind: 'accion', sesion: sesion.id, token: sesion.token, tipo, modulo: moduloFinal, resumen, momento: new Date().toISOString() });
}

/* ------------------------------------------------------------------------------------------------ */
/* Listeners globales                                                                                */
/* ------------------------------------------------------------------------------------------------ */

let erroresEsteMinuto = 0;
let inicioMinuto = Date.now();

function registrarErrorJs(mensaje: string, stack: string | null) {
	const ahora = Date.now();
	if (ahora - inicioMinuto > 60_000) {
		inicioMinuto = ahora;
		erroresEsteMinuto = 0;
	}
	if (++erroresEsteMinuto > 10) return; // freno local; la base tiene el suyo
	void enviarOGuardar({
		kind: 'error',
		sesion: sesion?.id ?? null,
		token: sesion?.token ?? null,
		origen: 'js',
		mensaje: mensaje.slice(0, 1000),
		stack: stack?.slice(0, 4000) ?? null,
		plataforma: plataformaActual,
		momento: new Date().toISOString()
	});
}

function instalarListeners() {
	if (listenersInstalados || typeof window === 'undefined') return;
	listenersInstalados = true;

	window.addEventListener('error', (e) => {
		registrarErrorJs(e.message || String(e.error), e.error instanceof Error ? (e.error.stack ?? null) : null);
	});
	window.addEventListener('unhandledrejection', (e) => {
		const r = e.reason;
		registrarErrorJs(r instanceof Error ? r.message : String(r), r instanceof Error ? (r.stack ?? null) : null);
	});

	// Al volver a la app (ej. Android la tenía en segundo plano) se manda un latido enseguida.
	document.addEventListener('visibilitychange', () => {
		if (document.visibilityState === 'visible') void latido();
	});

	// Cierre de la pestaña/ventana: pagehide no distingue un cierre de una recarga (F5), así que acá NO se
	// cierra la sesión en el servidor (una recarga la dejaría cerrada y sin latido). Se anota el cierre en
	// el diario local (síncrono, siempre llega; si fue una recarga, iniciarSesionAuditoria lo descarta) y se
	// manda un último latido keepalive para que, si de verdad se cerró, la hora quede exacta. En Tauri,
	// además, Rust registra el cierre real de la ventana (ver src-tauri/src/auditoria.rs).
	window.addEventListener('pagehide', () => {
		if (!sesion || cerrada) return;
		const momento = new Date().toISOString();
		agregarDiarioWeb({ kind: 'cierre', sesion: sesion.id, token: sesion.token, motivo: 'app_cerrada', momento, detalle: 'Se cerró la ventana o pestaña' });
		try {
			fetch(`${SUPABASE_URL}/rest/v1/rpc/auditoria_latido`, {
				method: 'POST',
				keepalive: true,
				headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
				body: JSON.stringify({ p_sesion: sesion.id, p_token: sesion.token })
			});
		} catch {
			/* noop */
		}
	});
}
