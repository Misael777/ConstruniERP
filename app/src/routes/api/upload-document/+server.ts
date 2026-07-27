import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { supabase } from '$lib/server/supabase';
import { safeEndpoint } from '$lib/server/safeEndpoint';
import { uploadToDrive, renameDriveFile, deleteDriveFile } from '$lib/server/config';
import { sanitizeFileSegment, generateUniqueFileName } from '$lib/shared/fileNaming';

const handler: RequestHandler = async ({ request }) => {
	const formData = await request.formData();
	const file = formData.get('file');
	const type = String(formData.get('type') || '').trim();
	const projectIdValue = formData.get('projectId');
	const projectId = projectIdValue ? Number(projectIdValue) : null;
	const documentType = String(formData.get('documentType') || '').trim();
	const documentName = String(formData.get('documentName') || '').trim();
	let projectName = String(formData.get('projectName') || '').trim();
	// Nombre base explícito (sin extensión) — usado por comprobantes de transacción para nombrar el
	// archivo con el código de la transacción en vez del nombre auto-generado por timestamp. Ver
	// TransaccionModal.svelte (uploadComprobante).
	const customFileName = String(formData.get('fileName') || '').trim();

	if (!file || !(file instanceof Blob)) {
		return json({ success: false, error: 'Archivo no válido.' }, { status: 400 });
	}

	if (!type || (type !== 'contrato' && type !== 'proforma' && type !== 'documento' && type !== 'comprobante')) {
		return json({ success: false, error: 'Tipo de documento inválido.' }, { status: 400 });
	}

	if (type === 'documento' && !documentType) {
		return json({ success: false, error: 'El tipo de documento es obligatorio para documentos de proyecto.' }, { status: 400 });
	}

	if ((type === 'documento' || !projectName) && projectId) {
		const { data: project, error: projectError } = await supabase
			.from('proyecto')
			.select('nombre_proyecto')
			.eq('id_proyecto', projectId)
			.single();

		if (!projectError && project?.nombre_proyecto) {
			projectName = project.nombre_proyecto;
		}
	}

	const originalName = file instanceof File ? file.name : 'document.pdf';

	// Todo archivo subido debe tener un nombre único y trazable (pedido explícito del usuario) —
	// generateUniqueFileName agrega fecha+id corto garantizando eso. Única excepción a propósito:
	// un comprobante con `customFileName` ya trae un nombre basado en el código real de la
	// transacción (id_transaccion, único en la BD por sí solo — ver TransaccionModal.svelte), que es
	// MÁS trazable que un id aleatorio; ahí se respeta tal cual en vez de complicarlo.
	const fileName = type === 'comprobante' && customFileName
		? `${sanitizeFileSegment(customFileName)}${originalName.includes('.') ? `.${originalName.split('.').pop()}` : ''}`
		: type === 'documento'
			? generateUniqueFileName(`documento_${documentType}_${documentName || 'doc'}_${projectName || 'Proyecto'}`, originalName)
			: generateUniqueFileName(type, originalName);

	const { url, fileId } = await uploadToDrive(file, fileName, type as 'contrato' | 'proforma' | 'documento' | 'comprobante');

	if (projectId && type !== 'documento' && type !== 'comprobante') {
		if (type === 'contrato') {
			const { error: updateError } = await supabase
				.from('proyecto')
				.update({ contrato: url })
				.eq('id_proyecto', projectId);

			if (updateError) {
				return json({ success: false, error: 'No se pudo actualizar el contrato en el proyecto.' }, { status: 500 });
			}
		} else {
			const { data: project, error: selectError } = await supabase
				.from('proyecto')
				.select('descripcion')
				.eq('id_proyecto', projectId)
				.single();

			if (selectError) {
				return json({ success: false, error: 'No se pudo leer el proyecto para guardar la proforma.' }, { status: 500 });
			}

			const baseDescription = String(project?.descripcion || '');
			let descripcion = baseDescription ? `${baseDescription} ` : '';
			descripcion += `Proforma: ${url}`;

			if (descripcion.length > 200) {
				descripcion = descripcion.slice(0, 200);
			}

			const { error: updateError } = await supabase
				.from('proyecto')
				.update({ descripcion })
				.eq('id_proyecto', projectId);

			if (updateError) {
				return json({ success: false, error: 'No se pudo actualizar la proforma en el proyecto.' }, { status: 500 });
			}
		}
	}

	return json({ success: true, url, fileName, fileId });
};

export const POST = safeEndpoint(handler);

/** Renombra un archivo ya subido — ver renameDriveFile en $lib/server/config.ts. */
const patchHandler: RequestHandler = async ({ request }) => {
	const { fileId, newName } = await request.json();
	if (!fileId || !newName) {
		return json({ success: false, error: 'fileId y newName son requeridos.' }, { status: 400 });
	}
	await renameDriveFile(String(fileId), String(newName));
	return json({ success: true });
};

export const PATCH = safeEndpoint(patchHandler);

/** Borra un archivo por id — usado para no dejar duplicados al reemplazar un comprobante. */
const deleteHandler: RequestHandler = async ({ request }) => {
	const { fileId } = await request.json();
	if (!fileId) {
		return json({ success: false, error: 'fileId es requerido.' }, { status: 400 });
	}
	await deleteDriveFile(String(fileId));
	return json({ success: true });
};

export const DELETE = safeEndpoint(deleteHandler);
