import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { supabase } from '$lib/server/supabase';
import { isAdminRequest } from '$lib/server/auth';
import {
	getCuentasCobrar,
	getCobros,
	getClienteOptions,
	getProyectoOptions
} from '$lib/modules/cuentas-cobrar/services/cuentasCobrar.service';
import { DEFAULT_PAGE_SIZE } from '$lib/modules/cuentas-cobrar/config/cuentaCobrar.config';

// Mismo patrón que centro-costos: mutaciones en app/src/routes/api/cuentas-cobrar/* (+server.ts),
// no SvelteKit form actions (adapter-static no las soporta). prerender=false porque el load
// depende de query params (page/q/sort/dir/selected) en cada request.
export const prerender = false;

export const load: PageServerLoad = async ({ url, cookies }) => {
	if (!(await isAdminRequest(cookies))) {
		throw redirect(302, '/dashboard');
	}

	const page = Number(url.searchParams.get('page') ?? '1') || 1;
	const pageSize = Number(url.searchParams.get('pageSize') ?? String(DEFAULT_PAGE_SIZE)) || DEFAULT_PAGE_SIZE;
	const search = url.searchParams.get('q') ?? '';
	const sortBy = url.searchParams.get('sort') ?? '';
	const sortDir = (url.searchParams.get('dir') as 'asc' | 'desc' | null) ?? '';
	const selectedId = Number(url.searchParams.get('selected') ?? '') || null;

	try {
		const [result, clienteOptions, proyectoOptions] = await Promise.all([
			getCuentasCobrar(supabase, { page, pageSize, search, sortBy: sortBy || undefined, sortDir: sortDir || undefined }),
			getClienteOptions(supabase),
			getProyectoOptions(supabase)
		]);

		const selectedCobros = selectedId ? await getCobros(supabase, selectedId) : [];

		return {
			...result,
			search,
			sortBy,
			sortDir,
			selectedId,
			selectedCobros,
			dynamicOptions: { id_cliente: clienteOptions, id_proyecto: proyectoOptions },
			loadError: ''
		};
	} catch (err: any) {
		console.error('[cuentas-cobrar] Error cargando listado:', err);
		return {
			items: [],
			total: 0,
			page: 1,
			pageSize,
			totalPages: 1,
			search,
			sortBy,
			sortDir,
			selectedId,
			selectedCobros: [],
			dynamicOptions: { id_cliente: [], id_proyecto: [] },
			loadError: err.message || 'No se pudo cargar el listado de cuentas por cobrar'
		};
	}
};
