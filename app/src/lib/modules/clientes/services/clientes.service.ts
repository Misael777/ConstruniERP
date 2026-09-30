/**
 * Servicio de acceso a datos para `cliente` — hoy el CRUD normal de Clientes vive inline en
 * ClienteModal.svelte (src/lib/components/comercial/clientes/ClienteModal.svelte); este archivo
 * nuevo agrega solo lo que hace falta para el flujo de Préstamo Otorgado (ver TransaccionModal.svelte
 * y finanzas/cuentas-cobrar/+page.svelte), mismo criterio que getOrCrearProveedorPrestamos en
 * proveedores.service.ts.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { getOrCrearCentroCostoParaEntidad } from '$lib/modules/centro-costos/services/centroCostos.service';

export const NOMBRE_CLIENTE_PRESTAMOS = 'PRÉSTAMOS / FINANCIERA';
const DOCUMENTO_CLIENTE_PRESTAMOS = '00000000000';

/** Cliente genérico fijo para las Cuentas por Cobrar que se autogeneran al registrar una transacción
 * Egreso de Categoría "Préstamo Otorgado" con Centro de Costo Origen=Corporativo (ver
 * TransaccionModal.svelte y finanzas/cuentas-cobrar/+page.svelte) — a pedido explícito del usuario:
 * `cuentas_cobrar.id_cliente` es NOT NULL y FK real a `cliente`, pero el prestatario real no
 * necesariamente está registrado como cliente en el sistema, así que ese campo (obligatorio) siempre
 * usa este mismo registro genérico, bloqueado para que no se pueda cambiar — el prestatario real
 * queda registrado en la transacción (id_centro_costo_destino), no acá. Get-or-create por nombre:
 * la primera vez lo crea (mismo patrón que ClienteModal.svelte — nombre + tipo de documento + número
 * + su propio centro de costo vinculado, ver getOrCrearCentroCostoParaEntidad), las siguientes reusa
 * el mismo id. */
export async function getOrCrearClientePrestamos(client: SupabaseClient): Promise<number> {
	const { data: existente, error: errorBusqueda } = await client
		.from('cliente')
		.select('id_cliente')
		.eq('nombre', NOMBRE_CLIENTE_PRESTAMOS)
		.maybeSingle();
	if (errorBusqueda) throw errorBusqueda;
	if (existente) return existente.id_cliente;

	const { data: creado, error } = await client
		.from('cliente')
		.insert({ tip_persona: 'J', nombre: NOMBRE_CLIENTE_PRESTAMOS, tipo_doc: 'RUC', num_documento: DOCUMENTO_CLIENTE_PRESTAMOS })
		.select('id_cliente')
		.single();
	if (error) throw error;

	await getOrCrearCentroCostoParaEntidad(client, 'cliente', creado.id_cliente, NOMBRE_CLIENTE_PRESTAMOS);
	return creado.id_cliente;
}
