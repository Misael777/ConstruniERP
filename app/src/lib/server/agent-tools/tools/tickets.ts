/**
 * Herramientas de agente para el módulo de Soporte/Tickets — demo inicial de la capa de herramientas
 * (ver registry.ts y Documentacion/AgentTools.md).
 *
 * NOTA IMPORTANTE sobre por qué estas consultas están reescritas acá en vez de importar directo
 * tickets.service.ts/releases.service.ts: tickets.service.ts importa `permisosState` de
 * `$lib/stores/permisos.svelte.ts`, que usa sintaxis de runes de Svelte 5 (`$state`) — solo el
 * compilador de Svelte sabe procesar esa sintaxis. El servidor MCP corre como proceso de Node puro
 * (sin Vite/Svelte de por medio), así que un `import` directo de ese archivo rompería al cargar. Las
 * consultas de acá son EXACTAMENTE las mismas que getTicketsDeveloper/getTicket/getComentarios/
 * getUltimoRelease (mismas tablas, mismos filtros, mismo orden) — no es lógica nueva, solo
 * reimplementada standalone para poder correr en este contexto.
 */
import type { AgentTool } from '../registry.ts';

interface TicketCompacto {
	id_ticket: number;
	tipo: string;
	modulo: string | null;
	titulo: string;
	descripcion: string;
	prioridad: string;
	estado: string;
	creado_por: string | null;
	resuelto_por: string | null;
	resuelto_en: string | null;
	aprobado_por: string | null;
	aprobado_en: string | null;
	motivo_rechazo: string | null;
	id_release: number | null;
	created_at: string;
	imagen_url: string | null;
}

/** Recorta campos irrelevantes para un agente (ids internos, columnas de auditoría que no aportan) —
 * misma lección de gh-axi: salida compacta, no el JSON crudo completo de Supabase. */
function compactarTicket(row: Record<string, unknown>): TicketCompacto {
	return {
		id_ticket: row.id_ticket as number,
		tipo: row.tipo as string,
		modulo: row.modulo as string | null,
		titulo: row.titulo as string,
		descripcion: row.descripcion as string,
		prioridad: row.prioridad as string,
		estado: row.estado as string,
		creado_por: row.creado_por as string | null,
		resuelto_por: row.resuelto_por as string | null,
		resuelto_en: row.resuelto_en as string | null,
		aprobado_por: row.aprobado_por as string | null,
		aprobado_en: row.aprobado_en as string | null,
		motivo_rechazo: row.motivo_rechazo as string | null,
		id_release: row.id_release as number | null,
		created_at: row.created_at as string,
		imagen_url: (row.imagen_url as string | null) ?? null
	};
}

const listarTickets: AgentTool = {
	name: 'listar_tickets',
	description:
		'Lista TODOS los tickets del módulo de Soporte — mismo dataset completo que ve el Panel Developer en /soporte/developer sin ningún filtro aplicado ("todos los tickets reportados"). Incluye reclamos, sugerencias, incidencias y requerimientos, con su estado actual (abierto, en_progreso, resuelto, aprobado, rechazado, cerrado).',
	inputSchema: { type: 'object', properties: {}, additionalProperties: false },
	permiso: 'ver_soporte_developer',
	async handler(_input, ctx) {
		const { data, error } = await ctx.client.from('ticket').select('*').order('created_at', { ascending: false });
		if (error) throw new Error(error.message);
		return (data ?? []).map(compactarTicket);
	}
};

const verTicket: AgentTool = {
	name: 'ver_ticket',
	description:
		'Detalle completo de un ticket puntual (por id_ticket) más su hilo de comentarios completo. Incluye la imagen_url del ticket y de cada comentario que tenga un adjunto — para VER esas imágenes de verdad (no solo la URL), usar la herramienta ver_imagen_adjunta pasándole esa imagen_url.',
	inputSchema: {
		type: 'object',
		properties: { id_ticket: { type: 'number', description: 'id_ticket del ticket a consultar' } },
		required: ['id_ticket'],
		additionalProperties: false
	},
	permiso: 'ver_soporte_developer',
	async handler(input, ctx) {
		const idTicket = Number(input.id_ticket);
		if (!Number.isFinite(idTicket)) throw new Error('id_ticket debe ser un número.');
		const [{ data: ticket, error: errTicket }, { data: comentarios, error: errComentarios }] = await Promise.all([
			ctx.client.from('ticket').select('*').eq('id_ticket', idTicket).maybeSingle(),
			ctx.client.from('ticket_comentario').select('*').eq('id_ticket', idTicket).order('created_at', { ascending: true })
		]);
		if (errTicket) throw new Error(errTicket.message);
		if (errComentarios) throw new Error(errComentarios.message);
		if (!ticket) throw new Error(`No existe ningún ticket con id_ticket=${idTicket}.`);
		return {
			ticket: compactarTicket(ticket),
			comentarios: (comentarios ?? []).map((c: Record<string, unknown>) => ({
				id_comentario: c.id_comentario,
				autor: c.autor,
				mensaje: c.mensaje,
				created_at: c.created_at,
				imagen_url: c.imagen_url ?? null
			}))
		};
	}
};

const ultimaVersionApp: AgentTool = {
	name: 'ultima_version_app',
	description:
		'Última versión de la app publicada (módulo de Releases) — a qué versión quedaron agrupados los tickets aprobados más recientes.',
	inputSchema: { type: 'object', properties: {}, additionalProperties: false },
	permiso: 'ver_soporte_developer',
	async handler(_input, ctx) {
		const { data, error } = await ctx.client
			.from('app_release')
			.select('id_release, version, changelog, publicado_por, created_at')
			.order('created_at', { ascending: false })
			.limit(1)
			.maybeSingle();
		if (error) throw new Error(error.message);
		return data ?? null;
	}
};

/** Extrae el fileId de Drive de una URL de descarga (`uc?export=download&id=X`) o de visor
 * (`/file/d/X/...`) — misma lógica que extractDriveFileId en uploadProjectDocument.ts, reimplementada
 * acá standalone por la misma razón del comentario de arriba (ese archivo termina importando código
 * pensado para correr en el cliente/navegador). */
function extraerDriveFileId(url: string): string | null {
	const queryMatch = url.match(/[?&]id=([^&]+)/);
	if (queryMatch) return queryMatch[1];
	const pathMatch = url.match(/\/file\/d\/([^/]+)/);
	return pathMatch ? pathMatch[1] : null;
}

/** Mismo intercambio OAuth2 refresh_token -> access_token que ya usa el resto del ERP para Drive (ver
 * getDriveAccessToken en server/config.ts) — reimplementado leyendo directo de process.env en vez de
 * `$env/dynamic/private` (específico de SvelteKit), ya que este proceso corre fuera de ese runtime. */
async function obtenerAccessTokenDrive(): Promise<string> {
	const clientId = process.env.GOOGLE_DRIVE_CLIENT_ID;
	const clientSecret = process.env.GOOGLE_DRIVE_CLIENT_SECRET;
	const refreshToken = process.env.GOOGLE_DRIVE_REFRESH_TOKEN;
	if (!clientId || !clientSecret || !refreshToken) {
		throw new Error('Faltan credenciales de Google Drive en el entorno (GOOGLE_DRIVE_CLIENT_ID/GOOGLE_DRIVE_CLIENT_SECRET/GOOGLE_DRIVE_REFRESH_TOKEN).');
	}
	const res = await fetch('https://oauth2.googleapis.com/token', {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token' })
	});
	const data = await res.json();
	if (!res.ok || !data.access_token) {
		throw new Error(`Error obteniendo token de Drive: ${data.error_description || data.error || 'desconocido'}`);
	}
	return data.access_token as string;
}

/** Resultado especial que el servidor MCP reconoce para devolver un bloque `image` real (ver
 * mcp-server/index.ts) en vez de texto — así el agente puede VER la imagen, no solo leer su URL. */
export interface ImagenAdjunta {
	mimeType: string;
	base64: string;
}

const verImagenAdjunta: AgentTool = {
	name: 'ver_imagen_adjunta',
	description:
		'Descarga y devuelve como imagen real (no un link) el adjunto de un ticket o de un comentario, dada la imagen_url que devuelve ver_ticket.',
	inputSchema: {
		type: 'object',
		properties: { imagen_url: { type: 'string', description: 'URL de Drive devuelta en imagen_url por ver_ticket' } },
		required: ['imagen_url'],
		additionalProperties: false
	},
	permiso: 'ver_soporte_developer',
	async handler(input): Promise<ImagenAdjunta> {
		const url = String(input.imagen_url ?? '');
		const fileId = extraerDriveFileId(url);
		if (!fileId) throw new Error(`No se pudo extraer el id de Drive de la URL: ${url}`);
		const accessToken = await obtenerAccessTokenDrive();
		const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`, {
			headers: { Authorization: `Bearer ${accessToken}` }
		});
		if (!res.ok) throw new Error(`No se pudo descargar la imagen de Drive: ${await res.text()}`);
		const contentType = res.headers.get('Content-Type') || 'image/jpeg';
		const buffer = Buffer.from(await res.arrayBuffer());
		return { mimeType: contentType, base64: buffer.toString('base64') };
	}
};

export const ticketsTools: AgentTool[] = [listarTickets, verTicket, ultimaVersionApp, verImagenAdjunta];
