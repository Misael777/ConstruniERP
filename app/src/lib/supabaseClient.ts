import { createClient } from '@supabase/supabase-js';
import { env } from '$env/dynamic/public';

const supabaseUrl = env.PUBLIC_SUPABASE_URL || 'https://mock.supabase.co';
const supabaseAnonKey = env.PUBLIC_SUPABASE_ANON_KEY || 'mock-anon-key';
const hasSupabaseConfig = Boolean(env.PUBLIC_SUPABASE_URL && env.PUBLIC_SUPABASE_ANON_KEY);

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

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
	auth: { storage: almacenamientoDeSesion(), persistSession: true, autoRefreshToken: true }
});
