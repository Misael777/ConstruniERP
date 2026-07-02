import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { supabase } from '$lib/server/supabase';
import { isAdminRequest } from '$lib/server/auth';
import { getCuentasPagar, getPagos, getProveedorOptions } from '$lib/modules/cuentas-pagar/services/cuentasPagar.service';
import { DEFAULT_PAGE_SIZE } from '$lib/modules/cuentas-pagar/config/cuentaPagar.config';

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
		const [result, proveedorOptions] = await Promise.all([
			getCuentasPagar(supabase, { page, pageSize, search, sortBy: sortBy || undefined, sortDir: sortDir || undefined }),
			getProveedorOptions(supabase)
		]);

		const selectedPagos = selectedId ? await getPagos(supabase, selectedId) : [];

		return {
			...result,
			search,
			sortBy,
			sortDir,
			selectedId,
			selectedPagos,
			dynamicOptions: { id_proveedor: proveedorOptions },
			loadError: ''
		};
	} catch (err: any) {
		console.error('[cuentas-pagar] Error cargando listado:', err);
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
			selectedPagos: [],
			dynamicOptions: { id_proveedor: [] },
			loadError: err.message || 'No se pudo cargar el listado de cuentas por pagar'
		};
	}
};
