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

	if (!file || !(file instanceof Blob)) {
		return json({ success: false, error: 'Archivo no válido.' }, { status: 400 });
	}

	if (!type || (type !== 'contrato' && type !== 'proforma')) {
		return json({ success: false, error: 'Tipo de documento inválido.' }, { status: 400 });
	}

	const fileName = `${type}-${Date.now()}-${file instanceof File ? file.name : 'document.pdf'}`;

	const url = await uploadToDrive(file, fileName, type as 'contrato' | 'proforma');

	if (projectId) {
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

	return json({ success: true, url });
};

export const POST = safeEndpoint(handler);
