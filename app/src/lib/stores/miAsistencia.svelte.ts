// =============================================================
// Mi asistencia — estado del botón «Mi asistencia» de Inicio (MiAsistenciaBoton). A pedido del usuario solo
// aparece a quien tiene su ficha de Personal vinculada a su usuario Y un horario libre o mixto (los de horario
// fijo marcan en el huellero; el servidor también lo exige en fn_mi_asistencia_marcar).
// =============================================================
import { supabase } from '$lib/supabaseClient';
import { toast } from '$lib/stores/toast';
import { hoyLima } from '$lib/modules/personal/services/personal.service';
import { reloj, type Marca } from '$lib/modules/asistencia/services/asistencia.service';
import { getMiAsistencia, marcarMiAsistencia, jornadaDelDia } from '$lib/modules/asistencia/services/miAsistencia.service';

const LIMA_MS = 5 * 3_600_000;
/** Tipos de horario que marcan desde el ERP. */
export const HORARIOS_ERP = ['libre', 'mixto'];

export const miJornada = $state({
	cargado: false,
	/** Vinculado y con horario libre o mixto: solo entonces se muestra el botón. */
	disponible: false,
	nombre: '',
	horario: '',
	/** 'libre' | 'mixto' | 'fijo' (ticket #117: el aviso de horario libre pregunta antes "¿Vas a laborar hoy?"). */
	tipoHorario: '',
	/** Marcas desde el lunes de esta semana hasta hoy. */
	marcasSemana: [] as Marca[],
	marcando: false
});

/** Minuto actual del día en hora de Lima. */
export const minutoLima = (ms = Date.now()) => {
	const d = new Date(ms - LIMA_MS);
	return d.getUTCHours() * 60 + d.getUTCMinutes();
};

/** Fecha 'YYYY-MM-DD' sumándole días. */
export const sumarDias = (fecha: string, dias: number) => {
	const d = new Date(`${fecha}T00:00:00Z`);
	d.setUTCDate(d.getUTCDate() + dias);
	return d.toISOString().slice(0, 10);
};

/** Lunes de la semana de `fecha`. */
export const lunesDe = (fecha: string) => sumarDias(fecha, -((new Date(`${fecha}T00:00:00Z`).getUTCDay() + 6) % 7));

/** Jornada de hoy con el tramo abierto contado hasta `ahoraMs`. */
export const jornadaHoy = (ahoraMs = Date.now()) => jornadaDelDia(miJornada.marcasSemana, hoyLima(), minutoLima(ahoraMs));

/** Minutos trabajados en la semana (hoy cuenta hasta `ahoraMs`). */
export function minutosSemana(ahoraMs = Date.now()): number {
	const hoy = hoyLima();
	let total = 0;
	for (let f = lunesDe(hoy); f <= hoy; f = sumarDias(f, 1)) {
		total += jornadaDelDia(miJornada.marcasSemana, f, f === hoy ? minutoLima(ahoraMs) : null).minutos;
	}
	return total;
}

export async function cargarMiJornada(): Promise<void> {
	try {
		const hoy = hoyLima();
		const datos = await getMiAsistencia(supabase, lunesDe(hoy), hoy);
		const tipo = datos?.horario?.tipo ?? 'fijo';
		// Ticket #110: con "Registro manual" activado marca desde el ERP con cualquier horario.
		miJornada.disponible = !!datos && (HORARIOS_ERP.includes(tipo) || !!datos.personal.registro_manual);
		miJornada.nombre = datos?.personal.nombre ?? '';
		miJornada.horario = datos?.horario?.nombre ?? '';
		miJornada.tipoHorario = tipo;
		miJornada.marcasSemana = datos?.marcas ?? [];
	} catch (err) {
		// Sin conexión u otro error: el botón simplemente no aparece.
		console.warn('[MiAsistencia] No se pudo cargar la jornada:', err);
	} finally {
		miJornada.cargado = true;
	}
}

/** Registra ingreso o salida (según cómo esté la jornada de hoy) y avisa la hora registrada. */
export async function marcarMiJornada(): Promise<boolean> {
	if (miJornada.marcando) return false;
	miJornada.marcando = true;
	const eraIngreso = !jornadaHoy().enJornada;
	try {
		const marcadoEn = await marcarMiAsistencia(supabase);
		await cargarMiJornada();
		const hora = reloj(minutoLima(Date.parse(marcadoEn)));
		if (eraIngreso) toast.success(`Ingreso registrado a las ${hora}. ¡Buen trabajo!`);
		else toast.success(`Salida registrada a las ${hora}. Hoy llevas ${duracionCorta(jornadaHoy().minutos)}.`);
		return true;
	} catch (err: any) {
		toast.error(err?.message ?? 'No se pudo registrar. Revisa tu conexión e inténtalo de nuevo.');
		return false;
	} finally {
		miJornada.marcando = false;
	}
}

/** 200 → "3 h 20 min"; 45 → "45 min"; 0 → "0 min". */
export function duracionCorta(min: number): string {
	const h = Math.floor(min / 60);
	const m = Math.floor(min % 60);
	return h ? `${h} h ${String(m).padStart(2, '0')} min` : `${m} min`;
}
