import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { supabase } from '$lib/server/supabase';
import { isAdminRequest } from '$lib/server/auth';
import { getCentroCostos } from '$lib/modules/centro-costos/services/centroCostos.service';
import { DEFAULT_PAGE_SIZE } from '$lib/modules/centro-costos/config/centroCostos.config';

// Las mutaciones (crear/editar/eliminar) viven en app/src/routes/api/centro-costos/*
// como +server.ts (mismo patrón que /api/create-employee-user, /api/delete-employee-user, etc.)
// en vez de SvelteKit form actions: el proyecto usa @sveltejs/adapter-static, que NO soporta
// `export const actions` en +page.server.ts (falla el build con "Cannot prerender pages with actions").
//
// Esta página depende de query params (page/q/sort/dir) en cada request, así que tampoco puede
// prerenderizarse (SvelteKit bloquea leer url.searchParams en una página prerenderizada).
// AJUSTAR: en un build estático puro (Tauri sin servidor Node embebido) este +page.server.ts no
// se ejecuta en producción — solo funciona con `npm run dev` / `vite preview`. Si necesitas que
// este listado funcione dentro del .exe empaquetado por Tauri, habrá que migrarlo a carga
// client-side con el cliente anon (mismo patrón que el módulo de partidas).
export const prerender = false;

export const load: PageServerLoad = async ({ url, cookies }) => {
	// Guard "solo admin" server-side (además del guard client-side existente en (app)/+layout.svelte).
	if (!(await isAdminRequest(cookies))) {
		throw redirect(302, '/dashboard');
	}

	const page = Number(url.searchParams.get('page') ?? '1') || 1;
	const pageSize = Number(url.searchParams.get('pageSize') ?? String(DEFAULT_PAGE_SIZE)) || DEFAULT_PAGE_SIZE;
	const search = url.searchParams.get('q') ?? '';
	const sortBy = url.searchParams.get('sort') ?? '';
	const sortDir = (url.searchParams.get('dir') as 'asc' | 'desc' | null) ?? '';

	try {
		const result = await getCentroCostos(supabase, {
			page,
			pageSize,
			search,
			sortBy: sortBy || undefined,
			sortDir: sortDir || undefined
		});
		return { ...result, search, sortBy, sortDir, loadError: '' };
	} catch (err: any) {
		console.error('[centros-de-costos] Error cargando listado:', err);
		return {
			items: [],
			total: 0,
			page: 1,
			pageSize,
			totalPages: 1,
			search,
			sortBy,
			sortDir,
			loadError: err.message || 'No se pudo cargar el listado de centros de costo'
		};
	}
};
