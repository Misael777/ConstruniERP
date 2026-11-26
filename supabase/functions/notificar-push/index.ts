// Ticket #113 (26/11/2026): envía avisos al CELULAR (Firebase Cloud Messaging, API HTTP v1) aunque la app esté cerrada.
//
// La llama la base de datos (triggers de solicitud_aprobacion y ticket, vía pg_net; ver la migración
// 20261127160000_push_notificaciones.sql) con { tabla, id, evento } y la cabecera x-push-secret, que debe coincidir con
// push_config.secreto. Quién recibe el aviso y su texto los arma fn_push_destinatarios; aquí solo se buscan los
// celulares de esos usuarios (dispositivo_push) y se envía un mensaje de DATOS a cada uno: la app Android
// (PushMessagingService.kt) arma la notificación agrupada por categoría ("CONSTRUNI ERP · Finanzas").
//
// Secreto de la función: FCM_SERVICE_ACCOUNT = el JSON de la cuenta de servicio de Firebase (nunca en el repo).
// Se publica SIN verificación de JWT (la llama la base de datos): supabase functions deploy notificar-push --no-verify-jwt
import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

interface CuentaServicio {
	project_id: string;
	client_email: string;
	private_key: string;
}

const json = (cuerpo: unknown, status = 200) => new Response(JSON.stringify(cuerpo), { status, headers: { 'Content-Type': 'application/json' } });

const b64url = (datos: ArrayBuffer | Uint8Array | string) => {
	const bytes = typeof datos === 'string' ? new TextEncoder().encode(datos) : new Uint8Array(datos);
	let bin = '';
	for (const b of bytes) bin += String.fromCharCode(b);
	return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

/** Token OAuth de Google para FCM (JWT firmado con la clave de la cuenta de servicio). Se reutiliza ~50 min. */
let tokenCache: { valor: string; vence: number } | null = null;
async function tokenGoogle(cuenta: CuentaServicio): Promise<string> {
	if (tokenCache && tokenCache.vence > Date.now()) return tokenCache.valor;
	const ahora = Math.floor(Date.now() / 1000);
	const cabecera = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
	const carga = b64url(
		JSON.stringify({ iss: cuenta.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging', aud: 'https://oauth2.googleapis.com/token', iat: ahora, exp: ahora + 3600 })
	);
	const pem = cuenta.private_key.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
	const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
	const clave = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
	const firma = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', clave, new TextEncoder().encode(`${cabecera}.${carga}`));
	const resp = await fetch('https://oauth2.googleapis.com/token', {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${cabecera}.${carga}.${b64url(firma)}` })
	});
	if (!resp.ok) throw new Error(`OAuth de Google: ${resp.status} ${await resp.text()}`);
	const { access_token } = await resp.json();
	tokenCache = { valor: access_token, vence: Date.now() + 50 * 60 * 1000 };
	return access_token;
}

Deno.serve(async (req) => {
	if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405);

	const { data: config } = await supabase.from('push_config').select('secreto').eq('id', true).maybeSingle();
	if (!config?.secreto || req.headers.get('x-push-secret') !== config.secreto) return json({ error: 'No autorizado' }, 401);

	const crudo = Deno.env.get('FCM_SERVICE_ACCOUNT');
	if (!crudo) return json({ error: 'Falta el secreto FCM_SERVICE_ACCOUNT' }, 500);
	const cuenta = JSON.parse(crudo) as CuentaServicio;

	const { tabla, id, evento } = await req.json().catch(() => ({}));
	if (!tabla || !id || !evento) return json({ error: 'Faltan tabla, id o evento' }, 400);

	const { data: avisos, error } = await supabase.rpc('fn_push_destinatarios', { p_tabla: tabla, p_id: id, p_evento: evento });
	if (error) return json({ error: error.message }, 500);
	if (!avisos?.length) return json({ enviados: 0 });

	const usuarios = [...new Set((avisos as { auth_user_id: string }[]).map((a) => a.auth_user_id))];
	const { data: dispositivos } = await supabase.from('dispositivo_push').select('token, auth_user_id').in('auth_user_id', usuarios);
	if (!dispositivos?.length) return json({ enviados: 0, sinCelular: usuarios.length });

	const acceso = await tokenGoogle(cuenta);
	let enviados = 0;
	const invalidos: string[] = [];
	for (const d of dispositivos) {
		const a = (avisos as any[]).find((x) => x.auth_user_id === d.auth_user_id);
		if (!a) continue;
		const resp = await fetch(`https://fcm.googleapis.com/v1/projects/${cuenta.project_id}/messages:send`, {
			method: 'POST',
			headers: { Authorization: `Bearer ${acceso}`, 'Content-Type': 'application/json' },
			body: JSON.stringify({
				message: {
					token: d.token,
					// Solo datos: la app arma la notificación agrupada por categoría (también con la app cerrada).
					data: { titulo: a.titulo ?? '', cuerpo: a.cuerpo ?? '', categoria: a.categoria ?? 'general', categoria_nombre: a.categoria_nombre ?? 'General', url: a.url ?? '/' },
					android: { priority: 'HIGH', ttl: '86400s' }
				}
			})
		});
		if (resp.ok) enviados++;
		else {
			const texto = await resp.text();
			// Celular que desinstaló la app o cambió de token: se borra para no reintentar.
			if (resp.status === 404 || /UNREGISTERED|INVALID_ARGUMENT/.test(texto)) invalidos.push(d.token);
			else console.error('FCM', resp.status, texto);
		}
	}
	if (invalidos.length) await supabase.from('dispositivo_push').delete().in('token', invalidos);
	return json({ enviados, invalidos: invalidos.length });
});
