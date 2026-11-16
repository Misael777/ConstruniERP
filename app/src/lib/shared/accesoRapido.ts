/**
 * Ticket #112 — ingreso rápido con una clave de 4 dígitos o con la huella digital.
 * Ver la migración 20261111150000_ingreso_rapido_frases.sql para el diseño completo. En corto:
 *   - Al iniciar sesión con contraseña, el usuario puede activar el ingreso rápido: el servidor le da a este
 *     dispositivo una llave aleatoria, con la que la contraseña se cifra (AES-GCM) y se guarda en el equipo. La
 *     llave NO se guarda en el equipo (salvo cifrada con la huella, ver abajo).
 *   - Con la clave de 4 dígitos, el servidor devuelve la llave (5 errores seguidos borran el acceso rápido).
 *   - Con la huella (Android), la llave se guarda cifrada con una clave del Keystore que solo se abre con la huella
 *     (biometricCipher de tauri-plugin-biometric).
 *   - Con la contraseña descifrada se inicia sesión normal (signInWithPassword) — si la contraseña cambió, falla y
 *     se vuelve a pedir.
 * Cada base (Producción / Desarrollo) tiene su propio acceso rápido guardado.
 */
import { supabase, ENTORNO } from '$lib/supabaseClient';
import { isRunningInTauri } from '$lib/driveUploadClient';

export interface AccesoRapidoGuardado {
	dispositivo: string;
	email: string;
	nombre: string;
	fotoUrl: string | null;
	/** Contraseña cifrada con la llave del servidor: base64(iv[12] + texto cifrado). */
	cifrado: string;
	/** La llave cifrada con la huella (solo Android). */
	huella: string | null;
}

const CLAVE_STORAGE = `construni_acceso_rapido_${ENTORNO}`;

export function leerAccesoRapido(): AccesoRapidoGuardado | null {
	try {
		const raw = localStorage.getItem(CLAVE_STORAGE);
		if (!raw) return null;
		const v = JSON.parse(raw) as AccesoRapidoGuardado;
		return v?.dispositivo && v?.email && v?.cifrado ? v : null;
	} catch {
		return null;
	}
}

function guardar(v: AccesoRapidoGuardado | null): void {
	try {
		if (v) localStorage.setItem(CLAVE_STORAGE, JSON.stringify(v));
		else localStorage.removeItem(CLAVE_STORAGE);
	} catch {
		// Almacenamiento bloqueado: el ingreso rápido simplemente no queda activo.
	}
}

// ---------- cifrado (WebCrypto, igual en navegador, Windows y Android) ----------

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const desdeB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function importarLlave(llaveB64: string): Promise<CryptoKey> {
	return crypto.subtle.importKey('raw', desdeB64(llaveB64), 'AES-GCM', false, ['encrypt', 'decrypt']);
}

async function cifrar(texto: string, llaveB64: string): Promise<string> {
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await importarLlave(llaveB64), new TextEncoder().encode(texto)));
	const todo = new Uint8Array(iv.length + ct.length);
	todo.set(iv);
	todo.set(ct, iv.length);
	return b64(todo);
}

async function descifrar(cifradoB64: string, llaveB64: string): Promise<string> {
	const todo = desdeB64(cifradoB64);
	const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: todo.slice(0, 12) }, await importarLlave(llaveB64), todo.slice(12));
	return new TextDecoder().decode(pt);
}

// ---------- teléfono / escritorio ----------

/** Pedido de la clienta (14/11/2026): la clave de 4 dígitos es SOLO del teléfono; en escritorio se ingresa con
 * correo y contraseña. Teléfono = app de Android/iOS, o el navegador de un celular (pantalla táctil chica). */
export async function esTelefono(): Promise<boolean> {
	if (isRunningInTauri()) {
		try {
			const { platform } = await import('@tauri-apps/plugin-os');
			const p = platform();
			return p === 'android' || p === 'ios';
		} catch {
			return false;
		}
	}
	try {
		if (/Android|iPhone|iPod|Mobi/i.test(navigator.userAgent)) return true;
		return window.matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 768;
	} catch {
		return false;
	}
}

// ---------- perfil recordado (foto/iniciales en el login de escritorio) ----------

export interface PerfilRecordado {
	email: string;
	nombre: string;
	fotoUrl: string | null;
}

const CLAVE_PERFIL = `construni_perfil_recordado_${ENTORNO}`;

export function leerPerfilRecordado(): PerfilRecordado | null {
	try {
		const v = JSON.parse(localStorage.getItem(CLAVE_PERFIL) ?? 'null') as PerfilRecordado | null;
		return v?.email ? v : null;
	} catch {
		return null;
	}
}

export function guardarPerfilRecordado(v: PerfilRecordado | null): void {
	try {
		if (v) localStorage.setItem(CLAVE_PERFIL, JSON.stringify(v));
		else localStorage.removeItem(CLAVE_PERFIL);
	} catch {
		// Almacenamiento bloqueado: solo no se muestra la foto.
	}
}

// ---------- huella ----------

/** ¿Este equipo puede usar la huella? Solo la app de Android con huella registrada en el teléfono. */
export async function huellaDisponible(): Promise<boolean> {
	if (!isRunningInTauri()) return false;
	try {
		const { platform } = await import('@tauri-apps/plugin-os');
		if (platform() !== 'android') return false;
		const { checkStatus } = await import('@tauri-apps/plugin-biometric');
		return (await checkStatus()).isAvailable;
	} catch (err) {
		console.warn('[accesoRapido] No se pudo consultar la huella:', err);
		return false;
	}
}

async function cifradoHuella(motivo: string, datos: { dataToEncrypt?: string; dataToDecrypt?: string }): Promise<string> {
	const { biometricCipher } = await import('@tauri-apps/plugin-biometric');
	const { data } = await biometricCipher(motivo, {
		...datos,
		title: 'Construni ERP',
		subtitle: motivo,
		cancelTitle: 'Usar clave',
		allowDeviceCredential: false
	});
	return data;
}

// ---------- flujo ----------

/** Activa el ingreso rápido en este equipo. Se llama justo después de iniciar sesión con la contraseña. */
export async function activarAccesoRapido(params: {
	pin: string;
	email: string;
	password: string;
	nombre: string;
	fotoUrl: string | null;
	conHuella: boolean;
}): Promise<{ huellaActivada: boolean }> {
	const dispositivo = leerAccesoRapido()?.dispositivo ?? crypto.randomUUID();
	const { data: llave, error } = await supabase.rpc('fn_acceso_rapido_activar', { p_dispositivo: dispositivo, p_pin: params.pin });
	if (error || !llave) throw new Error(error?.message || 'No se pudo activar el ingreso rápido.');
	const cifrado = await cifrar(params.password, llave as string);
	let huella: string | null = null;
	if (params.conHuella) {
		try {
			huella = await cifradoHuella('Registra tu huella para ingresar', { dataToEncrypt: llave as string });
		} catch (err) {
			// Canceló o falló: queda solo con la clave de 4 dígitos.
			console.warn('[accesoRapido] No se activó la huella:', err);
		}
	}
	guardar({ dispositivo, email: params.email, nombre: params.nombre, fotoUrl: params.fotoUrl, cifrado, huella });
	return { huellaActivada: !!huella };
}

export class AccesoRapidoError extends Error {
	constructor(
		message: string,
		/** true: el acceso rápido ya no sirve (bloqueado/borrado) — hay que ingresar con la contraseña. */
		readonly invalidado = false
	) {
		super(message);
	}
}

/** Con la clave de 4 dígitos: devuelve el correo y la contraseña para iniciar sesión. */
export async function abrirConClave(pin: string): Promise<{ email: string; password: string }> {
	const g = leerAccesoRapido();
	if (!g) throw new AccesoRapidoError('Este equipo no tiene ingreso rápido.', true);
	const { data, error } = await supabase.rpc('fn_acceso_rapido_abrir', { p_dispositivo: g.dispositivo, p_pin: pin });
	if (error) throw new AccesoRapidoError('No se pudo conectar. Revisa tu conexión a internet e intenta de nuevo.');
	const r = data as { ok: boolean; llave?: string; motivo?: string; restantes?: number };
	if (r.ok && r.llave) return { email: g.email, password: await descifrar(g.cifrado, r.llave) };
	if (r.motivo === 'clave') {
		const n = r.restantes ?? 0;
		throw new AccesoRapidoError(`Clave incorrecta. Te ${n === 1 ? 'queda 1 intento' : `quedan ${n} intentos`}.`);
	}
	guardar(null);
	throw new AccesoRapidoError(
		r.motivo === 'bloqueado'
			? 'Demasiados intentos. Por seguridad, ingresa con tu contraseña y vuelve a crear tu clave.'
			: 'El ingreso rápido de este equipo ya no está activo. Ingresa con tu contraseña.',
		true
	);
}

/** Con la huella: devuelve el correo y la contraseña para iniciar sesión. */
export async function abrirConHuella(): Promise<{ email: string; password: string }> {
	const g = leerAccesoRapido();
	if (!g?.huella) throw new AccesoRapidoError('La huella no está activada en este equipo.');
	const llave = await cifradoHuella('Ingresa con tu huella', { dataToDecrypt: g.huella });
	const { data: vigente, error } = await supabase.rpc('fn_acceso_rapido_vigente', { p_dispositivo: g.dispositivo });
	if (error) throw new AccesoRapidoError('No se pudo conectar. Revisa tu conexión a internet e intenta de nuevo.');
	if (!vigente) {
		guardar(null);
		throw new AccesoRapidoError('El ingreso rápido de este equipo ya no está activo. Ingresa con tu contraseña.', true);
	}
	return { email: g.email, password: await descifrar(g.cifrado, llave) };
}

/** Quita el ingreso rápido de este equipo (en el servidor y en el equipo). */
export async function quitarAccesoRapido(): Promise<void> {
	const g = leerAccesoRapido();
	guardar(null);
	if (g) {
		const { error } = await supabase.rpc('fn_acceso_rapido_quitar', { p_dispositivo: g.dispositivo });
		if (error) console.warn('[accesoRapido] No se pudo quitar en el servidor:', error);
	}
}

/** Actualiza nombre/foto mostrados (ej. si cambió la foto del trabajador). */
export function actualizarPerfilAccesoRapido(nombre: string, fotoUrl: string | null): void {
	const g = leerAccesoRapido();
	if (g) guardar({ ...g, nombre, fotoUrl });
}

export interface FraseDelDia {
	frase: string;
	autor: string | null;
}

export async function fraseDelDia(): Promise<FraseDelDia | null> {
	try {
		const { data } = await supabase.rpc('fn_frase_del_dia');
		const fila = Array.isArray(data) ? data[0] : data;
		return fila?.frase ? { frase: fila.frase, autor: fila.autor ?? null } : null;
	} catch {
		return null;
	}
}
