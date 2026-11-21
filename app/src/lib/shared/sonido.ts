/**
 * Ticket #130: sonido para notificaciones y alertas (app y escritorio). Un "ding-dong" corto generado con Web Audio
 * (sin archivo de audio: funciona igual en navegador, Tauri Windows y Tauri Android). Los navegadores solo permiten
 * sonar después de que el usuario tocó la página alguna vez; antes de eso falla en silencio (nunca rompe la app).
 */
let ctx: AudioContext | null = null;
let ultimo = 0;

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
			void contexto()?.resume();
		} catch {
			/* sin audio */
		}
	};
	window.addEventListener('pointerdown', desbloquear, { once: true, capture: true });
	window.addEventListener('keydown', desbloquear, { once: true, capture: true });
}

/** Tipo de sonido: 'notificacion' (campana) o 'alerta' (⚠, un tono más grave). */
export function sonarAviso(tipo: 'notificacion' | 'alerta' = 'notificacion'): void {
	try {
		// Varias novedades juntas (campana y alertas a la vez): un solo sonido.
		if (Date.now() - ultimo < 1500) return;
		const c = contexto();
		if (!c || c.state !== 'running') return;
		ultimo = Date.now();
		const notas = tipo === 'alerta' ? [659.25, 523.25] : [880, 1174.66];
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

/** Suena cuando el contador SUBE respecto de la lectura anterior (no en la primera carga). */
export function crearDetectorDeNovedades(tipo: 'notificacion' | 'alerta') {
	let anterior: number | null = null;
	return (actual: number) => {
		if (anterior !== null && actual > anterior) sonarAviso(tipo);
		anterior = actual;
	};
}
