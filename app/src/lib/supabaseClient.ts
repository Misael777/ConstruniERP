import { createClient } from '@supabase/supabase-js';
import { env } from '$env/dynamic/public';

/**
 * Cambio de base PRD / DEV (a pedido del usuario, 22/10/2026 — solo el rol developer lo ve, ver
 * shared/components/EntornoDeveloper.svelte). La elección se guarda en este equipo (localStorage) y se aplica al
 * abrir la app: el cliente de Supabase se crea una sola vez, así que cambiar de base recarga la app en /login
 * (cada base tiene sus propios usuarios). Sin PUBLIC_SUPABASE_URL_DEV/ANON_KEY_DEV en el build, siempre es PRD.
 */
export type Entorno = 'prd' | 'dev';
const CLAVE_ENTORNO = 'construni_entorno';
const devUrl = env.PUBLIC_SUPABASE_URL_DEV || '';
const devKey = env.PUBLIC_SUPABASE_ANON_KEY_DEV || '';
/** true si este build trae la base de desarrollo configurada (para mostrar el cambio de base). */
export const DEV_DISPONIBLE = Boolean(devUrl && devKey);
function entornoElegido(): Entorno {
	if (typeof window === 'undefined' || !DEV_DISPONIBLE) return 'prd';
	try {
		return window.localStorage.getItem(CLAVE_ENTORNO) === 'dev' ? 'dev' : 'prd';
	} catch {
		return 'prd';
	}
}
const usarDev = entornoElegido() === 'dev';
const supabaseUrl = (usarDev ? devUrl : env.PUBLIC_SUPABASE_URL) || 'https://mock.supabase.co';
const supabaseAnonKey = (usarDev ? devKey : env.PUBLIC_SUPABASE_ANON_KEY) || 'mock-anon-key';
const hasSupabaseConfig = Boolean(env.PUBLIC_SUPABASE_URL && env.PUBLIC_SUPABASE_ANON_KEY);
/** Base a la que está conectada la app ahora. 'dev' también cuando el build mismo apunta a Dev (npm run dev --mode dev). */
export const ENTORNO: Entorno = usarDev || (DEV_DISPONIBLE && env.PUBLIC_SUPABASE_URL === devUrl) || /hlfaxszecrxgkbjafepv/.test(supabaseUrl) ? 'dev' : 'prd';
/** true si se puede cambiar de base desde la app (el build trae Dev y no está fijado a Dev por --mode dev). */
export const CAMBIO_ENTORNO_POSIBLE = DEV_DISPONIBLE && env.PUBLIC_SUPABASE_URL !== devUrl;
/** Cambia de base y reinicia la app en el login de la otra base. */
export function cambiarEntorno(nuevo: Entorno): void {
	try {
		if (nuevo === 'dev') window.localStorage.setItem(CLAVE_ENTORNO, 'dev');
		else window.localStorage.removeItem(CLAVE_ENTORNO);
		window.sessionStorage.clear();
	} catch {
		/* almacenamiento bloqueado: no se puede cambiar */
	}
	window.location.href = '/login';
}

if (!hasSupabaseConfig) {
    console.error('[supabaseClient] Missing PUBLIC_SUPABASE_URL or PUBLIC_SUPABASE_ANON_KEY. The partidas tree will show a configuration error until these values are set.');
}

/**
 * A pedido del usuario, la ERP pide correo y contraseña CADA VEZ QUE SE ABRE (app de Windows, Android o
 * pestaña del navegador). Por eso la sesión se guarda en `sessionStorage` (vive mientras la ventana está
 * abierta: sobrevive a navegar y a recargar, pero se borra al cerrar la app) en vez del `localStorage` por
 * defecto de supabase-js, que la conservaba indefinidamente y hacía entrar directo al ERP sin pedir nada.
 * API web estándar: funciona igual en navegador, Tauri Windows (WebView2) y Tauri Android (WebView).
 */
function almacenamientoDeSesion(): Storage | undefined {
	if (typeof window === 'undefined') return undefined;
	try {
		// Borra la sesión que versiones anteriores dejaron guardada de forma permanente (clave
		// "sb-<proyecto>-auth-token" en localStorage), para que el cambio aplique desde la próxima apertura.
		for (const clave of Object.keys(window.localStorage)) {
			if (/^sb-.+-auth-token$/.test(clave)) window.localStorage.removeItem(clave);
		}
		return window.sessionStorage;
	} catch {
		// Almacenamiento bloqueado (entorno restringido): supabase-js cae a su almacenamiento por defecto.
		return undefined;
	}
}

/** URL/clave pública del proyecto — los usa la auditoría para avisar el cierre de la app con un `fetch`
 * keepalive (ver $lib/shared/auditoria.ts), fuera del cliente de supabase-js. */
export const SUPABASE_URL = supabaseUrl;
export const SUPABASE_ANON_KEY = supabaseAnonKey;

/** Sesión de auditoría activa (Control de Accesos → Auditoría). Se manda como header en TODAS las peticiones
 * para que el trigger auditoria_registrar_cambio() de la base sepa a qué sesión pertenece cada cambio de
 * datos. null = sin sesión de auditoría (no se manda el header). */
let auditoriaSesionId: string | null = null;
export function setAuditoriaSesionHeader(sesionId: string | null) {
	auditoriaSesionId = sesionId;
}

const fetchConAuditoria: typeof fetch = (input, init) => {
	if (!auditoriaSesionId) return fetch(input, init);
	const headers = new Headers(init?.headers);
	headers.set('x-auditoria-sesion', auditoriaSesionId);
	return fetch(input, { ...init, headers });
};

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
	auth: { storage: almacenamientoDeSesion(), persistSession: true, autoRefreshToken: true },
	global: { fetch: fetchConAuditoria }
});
