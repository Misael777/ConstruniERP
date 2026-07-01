import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { supabase } from '$lib/server/supabase';
import { safeEndpoint } from '$lib/server/safeEndpoint';
import { uploadToDrive } from '$lib/server/config';

const handler: RequestHandler = async ({ request }) => {
	const formData = await request.formData();
	const file = formData.get('file');
	const type = String(formData.get('type') || '').trim();
	const projectIdValue = formData.get('projectId');
	const projectId = projectIdValue ? Number(projectIdValue) : null;
	const documentType = String(formData.get('documentType') || '').trim();
	const documentName = String(formData.get('documentName') || '').trim();
	let projectName = String(formData.get('projectName') || '').trim();

	if (!file || !(file instanceof Blob)) {
		return json({ success: false, error: 'Archivo no válido.' }, { status: 400 });
	}

	if (!type || (type !== 'contrato' && type !== 'proforma' && type !== 'documento')) {
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

	const safeName = (value: string) =>
		value
			.trim()
			.replace(/\s+/g, '_')
			.replace(/[^a-zA-Z0-9._-]/g, '')
			.replace(/_+/g, '_')
			.replace(/^_+|_+$/g, '');

	const originalName = file instanceof File ? file.name : 'document.pdf';
	const extension = originalName.includes('.') ? `.${originalName.split('.').pop()}` : '';
	const fileBaseName = type === 'documento'
		? `${safeName(documentType)}_${safeName(documentName || originalName.replace(/\.[^.]+$/, ''))}_${safeName(projectName || 'Proyecto')}`
		: `${type}-${Date.now()}-${safeName(originalName.replace(/\.[^.]+$/, ''))}`;
	const fileName = `${fileBaseName}${extension}`;

	const url = await uploadToDrive(file, fileName, type as 'contrato' | 'proforma' | 'documento');

	if (projectId && type !== 'documento') {
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

	return json({ success: true, url, fileName });
};

export const POST = safeEndpoint(handler);
