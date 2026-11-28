/**
 * Ticket #130: sonido para notificaciones y alertas (app y escritorio). Un "ding-dong" corto generado con Web Audio
 * (sin archivo de audio: funciona igual en navegador, Tauri Windows y Tauri Android). Los navegadores solo permiten
 * sonar después de que el usuario tocó la página alguna vez; antes de eso el aviso queda PENDIENTE y suena con el
 * primer toque, clic o tecla (rechazado 24/11/2026: "no me suena nada" — al abrir la app con avisos pendientes no
 * sonaba porque el audio aún estaba bloqueado y el aviso se perdía).
 */
let ctx: AudioContext | null = null;
let ultimo = 0;
/** Ticket #153 (27/11/2026): sonido propio para una tarea nueva y para una aprobación pendiente o resuelta. */
export type TipoSonido = 'notificacion' | 'alerta' | 'tarea' | 'aprobacion';
let pendiente: TipoSonido | null = null;
const NOTAS: Record<TipoSonido, number[]> = {
	notificacion: [880, 1174.66],
	alerta: [659.25, 523.25],
	// Tarea: tres notas ascendentes cortas.
	tarea: [523.25, 659.25, 783.99],
	// Aprobación: dos notas iguales y una más alta (llamada de atención).
	aprobacion: [987.77, 987.77, 1318.51]
};

function contexto(): AudioContext | null {
	if (typeof window === 'undefined') return null;
	const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
	if (!AC) return null;
	ctx ??= new AC();
	return ctx;
}

// El contexto se "desbloquea" con el primer toque o clic del usuario.
if (typeof window !== 'undefined') {
	const desbloquear = () => {
		try {
			const c = contexto();
			if (!c) return;
			void c.resume().then(() => {
				if (pendiente) {
					const tipo = pendiente;
					pendiente = null;
					sonarAviso(tipo);
				}
			});
		} catch {
			/* sin audio */
		}
	};
	// No "once": si el primer toque no alcanzó a desbloquear el audio, el siguiente lo intenta de nuevo.
	window.addEventListener('pointerdown', desbloquear, { capture: true });
	window.addEventListener('keydown', desbloquear, { capture: true });
}

/** Tipo de sonido: 'notificacion' (campana), 'alerta' (⚠, más grave), 'tarea' (tarea nueva) o 'aprobacion'. */
export function sonarAviso(tipo: TipoSonido = 'notificacion'): void {
	try {
		// Varias novedades juntas (campana y alertas a la vez): un solo sonido.
		if (Date.now() - ultimo < 1500) return;
		const c = contexto();
		if (!c) return;
		if (c.state !== 'running') {
			// Aún sin permiso de audio: suena en cuanto el usuario toque la pantalla.
			pendiente ??= tipo;
			void c.resume().catch(() => {});
			return;
		}
		ultimo = Date.now();
		const notas = NOTAS[tipo] ?? NOTAS.notificacion;
		notas.forEach((frecuencia, i) => {
			const t = c.currentTime + i * 0.16;
			const osc = c.createOscillator();
			const vol = c.createGain();
			osc.type = 'sine';
			osc.frequency.value = frecuencia;
			vol.gain.setValueAtTime(0.0001, t);
			vol.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
			vol.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
			osc.connect(vol).connect(c.destination);
			osc.start(t);
			osc.stop(t + 0.4);
		});
	} catch {
		/* sin audio: no pasa nada */
	}
}

/** Suena al abrir la app si ya hay algo pendiente (primera lectura > 0) y después cada vez que el contador SUBE. */
export function crearDetectorDeNovedades(tipo: TipoSonido) {
	let anterior: number | null = null;
	return (actual: number) => {
		if (anterior === null ? actual > 0 : actual > anterior) sonarAviso(tipo);
		anterior = actual;
	};
}
