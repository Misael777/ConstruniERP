import { writable, derived, get } from 'svelte/store';
import { supabase } from '$lib/supabaseClient';
import { buildTree, fillMissingAncestors } from '$lib/utils/tree';
import type { FieldOption } from '$lib/shared/fieldConfig';
import { generarCodigoProyecto } from '$lib/shared/codigoProyecto';

export interface PartidaNode {
    id_partida: number;
    codigo: string;
    descripcion: string;
    nivel: number;
    id_partida_padre: number | null;
    unidad: string | null;
    precio_unitario: number | null;
    children?: PartidaNode[];
}

export interface Plantilla {
    id_plantilla: number;
    nombre: string;
    descripcion: string | null;
    tipo: string | null;
    num_partidas: number;
}

export interface PlantillaDetalle {
    id_plantilla_detalle: number;
    id_partida: number;
    cantidad_sugerida: number | null;
    orden: number | null;
    nombre_partida: string;
    codigo: string;
    nivel: number;
    id_partida_padre: number | null;
}

export interface ProyectoBasico {
    id_proyecto: number;
    nombre_proyecto: string;
}

export interface PresupuestoResumen {
    id_presupuesto: number;
    id_proyecto: number;
    nombre: string;
    fecha_creacion: string;
    nombre_proyecto: string;
    cliente_nombre: string | null;
}

// --- Core stores ---
export const presupuestosList = writable<PresupuestoResumen[]>([]);
export const partidasTree = writable<PartidaNode[]>([]);
export const partidasCount = writable<number>(0);
export const selectedPartida = writable<PartidaNode | null>(null);

export const plantillasList = writable<Plantilla[]>([]);
export const selectedPlantilla = writable<Plantilla | null>(null);
export const selectedPlantillaDetalle = writable<PlantillaDetalle[]>([]);

export const proyectosList = writable<ProyectoBasico[]>([]);

// Separate loading flags to avoid race conditions when both are called concurrently
export const isLoadingTree = writable<boolean>(false);
export const isLoading = writable<boolean>(false); // for plantilla detail fetches

export const errorMessage = writable<string | null>(null);
export const currentAuthUserId = writable<string | null>(null);
export const searchTerm = writable<string>('');

// Drag-from-catalog state (shared across TreeView → PlantillaDetail)
export const draggingNode = writable<PartidaNode | null>(null);
export const draggingPos  = writable<{ x: number; y: number } | null>(null);

// --- Derived: client-side filtered tree (searches codigo and descripcion) ---
function filterTree(nodes: PartidaNode[], term: string): PartidaNode[] {
    return nodes
        .map(node => {
            const matches =
                node.codigo.toLowerCase().includes(term) ||
                node.descripcion.toLowerCase().includes(term);
            const filteredChildren = node.children ? filterTree(node.children, term) : [];
            if (matches || filteredChildren.length > 0) {
                return { ...node, children: filteredChildren };
            }
            return null;
        })
        .filter(Boolean) as PartidaNode[];
}

export const filteredPartidasTree = derived(
    [partidasTree, searchTerm],
    ([$tree, $term]) => {
        const t = $term.trim().toLowerCase();
        return t ? filterTree($tree, t) : $tree;
    }
);

// --- Supabase client guard ---
function getClient() {
    const hasConfig = Boolean(
        import.meta.env.PUBLIC_SUPABASE_URL && import.meta.env.PUBLIC_SUPABASE_ANON_KEY
    );
    if (!hasConfig) {
        throw new Error('Supabase no está configurado. Revisa PUBLIC_SUPABASE_URL y PUBLIC_SUPABASE_ANON_KEY.');
    }
    return supabase;
}

// --- Loaders ---

export async function fetchPartidasTree() {
    isLoadingTree.set(true);
    try {
        const { data, error } = await getClient()
            .from('partida')
            .select('id_partida, codigo, descripcion, nivel, id_partida_padre, unidad, precio_unitario')
            .order('codigo', { ascending: true });

        if (error) throw error;

        const flat: PartidaNode[] = data || [];
        partidasCount.set(flat.length);

        const tree = buildTree(flat, 'id_partida', 'id_partida_padre');

        errorMessage.set(null);
        partidasTree.set(tree);
    } catch (err: any) {
        errorMessage.set(err.message || err.toString());
    } finally {
        isLoadingTree.set(false);
    }
}

export async function fetchPlantillas() {
    try {
        // Fetch partida count per plantilla in one query via embedding
        const { data, error } = await getClient()
            .from('plantilla_presupuesto')
            .select('id_plantilla, nombre, descripcion, tipo, plantilla_detalle(id_plantilla_detalle)')
            .order('nombre', { ascending: true });

        if (error) throw error;

        const mapped: Plantilla[] = (data || []).map((row: any) => ({
            id_plantilla: row.id_plantilla,
            nombre: row.nombre,
            descripcion: row.descripcion,
            tipo: row.tipo,
            num_partidas: Array.isArray(row.plantilla_detalle) ? row.plantilla_detalle.length : 0,
        }));

        plantillasList.set(mapped);
    } catch (err: any) {
        errorMessage.set(err.message || err.toString());
    }
}

export async function fetchProyectos() {
    try {
        const { data, error } = await getClient()
            .from('proyecto')
            .select('id_proyecto, nombre_proyecto')
            .eq('estado_proyecto', 'activo')
            .order('nombre_proyecto', { ascending: true });

        if (error) throw error;
        proyectosList.set(data || []);
    } catch (err: any) {
        console.error('Error al cargar proyectos:', err);
    }
}

export async function fetchPlantillaDetalle(id_plantilla: number) {
    isLoading.set(true);
    try {
        const { data, error } = await getClient()
            .from('plantilla_detalle')
            .select('id_plantilla_detalle, id_partida, cantidad_sugerida, orden, partida:id_partida(descripcion, codigo, nivel, id_partida_padre)')
            .eq('id_plantilla', id_plantilla)
            .order('orden', { ascending: true });

        if (error) throw error;

        const detalle: PlantillaDetalle[] = (data || []).map((r: any) => {
            const p = Array.isArray(r.partida) ? r.partida[0] : r.partida;
            return {
                id_plantilla_detalle: r.id_plantilla_detalle,
                id_partida: r.id_partida,
                cantidad_sugerida: r.cantidad_sugerida,
                orden: r.orden,
                nombre_partida: p?.descripcion ?? '',
                codigo: p?.codigo ?? '',
                nivel: p?.nivel ?? 1,
                id_partida_padre: p?.id_partida_padre ?? null,
            };
        });

        errorMessage.set(null);
        selectedPlantillaDetalle.set(detalle);
    } catch (err: any) {
        errorMessage.set(err.message || err.toString());
    } finally {
        isLoading.set(false);
    }
}

/** Igual que fetchPlantillaDetalle, pero devuelve el arreglo en vez de escribirlo en el store
 * `selectedPlantillaDetalle` — usada por InstanciarPlantillaModal.svelte, que puede abrirse desde un
 * contexto (ej. PresupuestoTab.svelte) sin relación con "la plantilla seleccionada" global, así que no
 * debe pisar ese store como efecto secundario de abrir el checklist. */
export async function fetchPlantillaDetalleData(id_plantilla: number): Promise<PlantillaDetalle[]> {
    const { data, error } = await getClient()
        .from('plantilla_detalle')
        .select('id_plantilla_detalle, id_partida, cantidad_sugerida, orden, partida:id_partida(descripcion, codigo, nivel, id_partida_padre)')
        .eq('id_plantilla', id_plantilla)
        .order('orden', { ascending: true });
    if (error) throw error;

    return (data || []).map((r: any) => {
        const p = Array.isArray(r.partida) ? r.partida[0] : r.partida;
        return {
            id_plantilla_detalle: r.id_plantilla_detalle,
            id_partida: r.id_partida,
            cantidad_sugerida: r.cantidad_sugerida,
            orden: r.orden,
            nombre_partida: p?.descripcion ?? '',
            codigo: p?.codigo ?? '',
            nivel: p?.nivel ?? 1,
            id_partida_padre: p?.id_partida_padre ?? null
        };
    });
}

/** Busca el presupuesto del proyecto (uno solo por proyecto, ver nota en instanciarPlantillaSeleccion)
 * o lo crea si todavía no existe. Compartido por cualquier flujo que necesite insertar en
 * presupuesto_detalle sin duplicar esta lógica. */
/** Busca el presupuesto del proyecto (uno solo por proyecto) o lo crea si no existe todavía — ÚNICO
 * punto que debe insertar en `presupuesto`, para que no puedan crearse dos presupuestos distintos para
 * el mismo proyecto por dos caminos que no se conocen entre sí (ver PresupuestoTab.svelte, que antes
 * tenía su propia función local que insertaba sin buscar primero — corregido a pedido del usuario tras
 * ver información distinta según desde dónde se entrara al presupuesto del mismo proyecto). */
export async function ensurePresupuestoParaProyecto(
    client: ReturnType<typeof getClient>,
    id_proyecto: number,
    auth_user_id: string,
    nombre: string = 'Presupuesto Base'
): Promise<number> {
    // order('created_at', desc) para que, si alguna vez llegara a haber más de una fila para el mismo
    // proyecto, se elija consistentemente la MISMA (la más reciente) que ya usan load() en
    // PresupuestoTab.svelte y GanttTab.svelte — sin esto, un `.limit(1)` sin orden explícito no
    // garantiza devolver siempre la misma fila.
    const { data: presupuestos, error: pErr } = await client
        .from('presupuesto')
        .select('id_presupuesto')
        .eq('id_proyecto', id_proyecto)
        .order('created_at', { ascending: false })
        .limit(1);
    if (pErr) throw pErr;

    let presupuesto_id: number | undefined = presupuestos?.[0]?.id_presupuesto;
    if (!presupuesto_id) {
        // Si ya existe, se abre tal cual está (no se le pisa el nombre) — `nombre` solo aplica al crear uno.
        const { data: newP, error: nErr } = await client
            .from('presupuesto')
            .insert({ id_proyecto, nombre, usuario_registro: auth_user_id })
            .select('id_presupuesto');
        if (nErr) throw nErr;
        presupuesto_id = newP?.[0]?.id_presupuesto;
    }

    if (!presupuesto_id) throw new Error('No se pudo obtener o crear el presupuesto');
    return presupuesto_id;
}

/** Para el selector "Nombre" del popup "Nuevo Presupuesto" del módulo independiente Presupuesto — a
 * pedido explícito del usuario, solo ofrece proyectos con venta cerrada, etiquetados con su código
 * generado (mismo criterio que getProyectoOptions en cuentasCobrar.service.ts). */
export async function getProyectoOptionsVentaCerrada(client: ReturnType<typeof getClient>): Promise<FieldOption[]> {
    const { data, error } = await client
        .from('proyecto')
        .select(
            'id_proyecto, tipo_venta, tip_proyecto, estado_predio, tipo_edifica, tipo_obra, tipo_tramite, tipo_intervencion, tipo_edificacion_obra, mes_obra, anio_obra, nro_pisos, distrito, ubicacion, fecha_inicio_plan, created_at, cliente:id_cliente(nombre)'
        )
        .eq('estado_proyecto', 'venta_cerrada')
        .order('fecha_inicio_plan', { ascending: false });
    if (error) throw error;
    return (data ?? []).map((p: any) => ({ value: String(p.id_proyecto), label: generarCodigoProyecto(p) }));
}

/** Lista de presupuestos existentes (todos los proyectos) para la vista "Lista" del módulo
 * independiente Presupuesto. */
export async function fetchPresupuestos() {
    try {
        const { data, error } = await getClient()
            .from('presupuesto')
            .select('id_presupuesto, id_proyecto, nombre, fecha_creacion, proyecto:id_proyecto(nombre_proyecto, cliente:id_cliente(nombre))')
            .order('fecha_creacion', { ascending: false });
        if (error) throw error;

        const items: PresupuestoResumen[] = (data ?? []).map((r: any) => {
            const proyecto = Array.isArray(r.proyecto) ? r.proyecto[0] : r.proyecto;
            const cliente = Array.isArray(proyecto?.cliente) ? proyecto.cliente[0] : proyecto?.cliente;
            return {
                id_presupuesto: r.id_presupuesto,
                id_proyecto: r.id_proyecto,
                nombre: r.nombre,
                fecha_creacion: r.fecha_creacion,
                nombre_proyecto: proyecto?.nombre_proyecto ?? '',
                cliente_nombre: cliente?.nombre ?? null
            };
        });
        errorMessage.set(null);
        presupuestosList.set(items);
    } catch (err: any) {
        errorMessage.set(err.message || err.toString());
    }
}

/** Busca o crea el presupuesto del proyecto elegido en el popup "Nuevo Presupuesto" — a pedido
 * explícito del usuario, el nombre viene del código generado del proyecto (elegido en el selector), no
 * de texto libre. Si el proyecto ya tenía un presupuesto, se abre ese mismo (ver
 * ensurePresupuestoParaProyecto), sin duplicar ni renombrarlo. */
export async function crearOAbrirPresupuesto(
    id_proyecto: number,
    nombre: string,
    auth_user_id: string
): Promise<{ success: boolean; message: string; id_presupuesto?: number }> {
    try {
        const client = getClient();
        const id_presupuesto = await ensurePresupuestoParaProyecto(client, id_proyecto, auth_user_id, nombre);
        return { success: true, message: 'Presupuesto listo', id_presupuesto };
    } catch (err: any) {
        return { success: false, message: err.message || err.toString() };
    }
}

/**
 * Instancia SOLO las partidas marcadas por el usuario (ver InstanciarPlantillaModal.svelte) — a pedido
 * explícito del usuario: lo no marcado simplemente no se inserta, así queda fuera del presupuesto y de
 * cualquier cálculo sin necesitar ninguna bandera "oculta" en la base de datos. Antes de insertar,
 * completa los ancestros faltantes de cualquier partida marcada (vía fillMissingAncestors, mismo
 * criterio que backfillMissingAncestors en PresupuestoTab.svelte) para que el árbol del presupuesto
 * quede siempre conectado raíz→hoja, aunque el usuario no haya marcado el capítulo/subcapítulo padre.
 */
export async function instanciarPlantillaSeleccion(
    id_plantilla: number,
    id_proyecto: number,
    ids_partida_seleccionadas: number[],
    usar_cantidades: boolean,
    auth_user_id: string
) {
    isLoading.set(true);
    try {
        const client = getClient();
        const presupuesto_id = await ensurePresupuestoParaProyecto(client, id_proyecto, auth_user_id);

        const { data: detalles, error: dErr } = await client
            .from('plantilla_detalle')
            .select('id_partida, cantidad_sugerida, partida:id_partida(id_partida_padre)')
            .eq('id_plantilla', id_plantilla);
        if (dErr) throw dErr;
        if (!detalles?.length) {
            errorMessage.set(null);
            return { success: true, message: 'Esta plantilla no tiene partidas.' };
        }

        const filas = detalles.map((d: any) => ({
            id_partida: d.id_partida as number,
            id_partida_padre: (Array.isArray(d.partida) ? d.partida[0] : d.partida)?.id_partida_padre ?? null,
            cantidad_sugerida: d.cantidad_sugerida as number | null
        }));

        const seleccionadas = filas.filter((f) => ids_partida_seleccionadas.includes(f.id_partida));
        const completas = fillMissingAncestors(seleccionadas, filas, 'id_partida', 'id_partida_padre');

        const payload = completas.map((f) => ({
            id_presupuesto: presupuesto_id,
            id_partida: f.id_partida,
            cantidad: usar_cantidades ? (f.cantidad_sugerida ?? 0) : 0,
            usuario_registro: auth_user_id
        }));

        const { error: iErr } = await client.from('presupuesto_detalle').insert(payload);
        if (iErr) throw iErr;

        errorMessage.set(null);
        return { success: true, message: `Se insertaron ${payload.length} partidas en el presupuesto`, count: payload.length, id_presupuesto: presupuesto_id };
    } catch (err: any) {
        errorMessage.set(err.message || err.toString());
        return { success: false, message: err.message || err.toString(), count: 0 };
    } finally {
        isLoading.set(false);
    }
}

// --- Plantilla CRUD ---

export async function createPlantilla(data: {
    nombre: string;
    descripcion?: string | null;
    tipo?: string | null;
}) {
    try {
        const { data: result, error } = await getClient()
            .from('plantilla_presupuesto')
            .insert({ nombre: data.nombre, descripcion: data.descripcion || null, tipo: data.tipo || null })
            .select('id_plantilla, nombre, descripcion, tipo')
            .single();

        if (error) throw error;

        await fetchPlantillas();
        return { success: true, message: 'Plantilla creada exitosamente', data: result };
    } catch (err: any) {
        return { success: false, message: err.message || err.toString() };
    }
}

export async function updatePlantilla(
    id_plantilla: number,
    data: { nombre: string; descripcion?: string | null; tipo?: string | null }
) {
    try {
        const { data: result, error } = await getClient()
            .from('plantilla_presupuesto')
            .update({ nombre: data.nombre, descripcion: data.descripcion || null, tipo: data.tipo || null })
            .eq('id_plantilla', id_plantilla)
            .select('id_plantilla, nombre, descripcion, tipo')
            .single();

        if (error) throw error;

        await fetchPlantillas();
        // Si la plantilla editada es la seleccionada, refresca su nombre/tipo en el panel de detalle
        // (selectedPlantillaDetalle no cambia, solo los metadatos de la plantilla misma).
        selectedPlantilla.update((current) => (current?.id_plantilla === id_plantilla ? { ...current, ...result } : current));
        return { success: true, message: 'Plantilla actualizada exitosamente', data: result };
    } catch (err: any) {
        return { success: false, message: err.message || err.toString() };
    }
}

/** Elimina la plantilla y, en cadena, su plantilla_detalle (ON DELETE CASCADE, ver DER2.sql) — NO
 * afecta ninguna partida del catálogo global ni ningún presupuesto de proyecto ya instanciado desde
 * ella (presupuesto_detalle no tiene FK hacia plantilla_detalle, son copias independientes). */
export async function deletePlantilla(id_plantilla: number) {
    try {
        const { error } = await getClient().from('plantilla_presupuesto').delete().eq('id_plantilla', id_plantilla);
        if (error) throw error;

        if (get(selectedPlantilla)?.id_plantilla === id_plantilla) {
            selectedPlantilla.set(null);
            selectedPlantillaDetalle.set([]);
        }
        await fetchPlantillas();
        return { success: true, message: 'Plantilla eliminada exitosamente' };
    } catch (err: any) {
        return { success: false, message: err.message || err.toString() };
    }
}

// --- Partida CRUD ---

export async function createPartida(partida: Omit<PartidaNode, 'id_partida' | 'children'>) {
    try {
        const { data, error } = await getClient()
            .from('partida')
            .insert({
                codigo: partida.codigo,
                descripcion: partida.descripcion,
                nivel: partida.nivel,
                id_partida_padre: partida.id_partida_padre,
                unidad: partida.unidad,
                precio_unitario: partida.precio_unitario,
            })
            .select('id_partida, codigo, descripcion, nivel, id_partida_padre, unidad, precio_unitario')
            .single();

        if (error) throw error;

        errorMessage.set(null);
        await fetchPartidasTree();
        return { success: true, message: 'Partida creada exitosamente', data };
    } catch (err: any) {
        return { success: false, message: err.message || err.toString() };
    }
}

export async function updatePartida(
    id_partida: number,
    updates: Partial<Omit<PartidaNode, 'id_partida' | 'children'>>
) {
    try {
        const { data, error } = await getClient()
            .from('partida')
            .update(updates)
            .eq('id_partida', id_partida)
            .select('id_partida, codigo, descripcion, nivel, id_partida_padre, unidad, precio_unitario')
            .single();

        if (error) throw error;

        errorMessage.set(null);
        // Refresh the tree; do NOT set selectedPartida here to avoid re-triggering any reactive effects
        await fetchPartidasTree();
        return { success: true, message: 'Partida actualizada exitosamente', data };
    } catch (err: any) {
        return { success: false, message: err.message || err.toString() };
    }
}

// --- Plantilla-detalle helpers ---

export function countDescendants(node: PartidaNode): number {
    if (!node.children?.length) return 0;
    return node.children.reduce((sum, c) => sum + 1 + countDescendants(c), 0);
}

function collectAll(node: PartidaNode): PartidaNode[] {
    const out: PartidaNode[] = [node];
    if (node.children?.length) {
        for (const c of node.children) out.push(...collectAll(c));
    }
    return out;
}

export async function removePartidaFromPlantilla(
    id_plantilla_detalle: number,
    id_plantilla: number
): Promise<{ success: boolean; message: string }> {
    try {
        const { error } = await getClient()
            .from('plantilla_detalle')
            .delete()
            .eq('id_plantilla_detalle', id_plantilla_detalle);
        if (error) throw error;
        await fetchPlantillaDetalle(id_plantilla);
        await fetchPlantillas();
        return { success: true, message: 'Partida eliminada de la plantilla' };
    } catch (err: any) {
        return { success: false, message: err.message ?? String(err) };
    }
}

/** Edita cantidad_sugerida/orden de una fila de la plantilla — a pedido del usuario, el menú "Editar"
 * de PlantillaDetail.svelte (antes cantidad_sugerida quedaba fija en 1 al agregar, sin forma de
 * ajustarla desde la UI). */
export async function updatePlantillaDetalle(
    id_plantilla_detalle: number,
    updates: { cantidad_sugerida?: number; orden?: number },
    id_plantilla: number
): Promise<{ success: boolean; message: string }> {
    try {
        const { error } = await getClient().from('plantilla_detalle').update(updates).eq('id_plantilla_detalle', id_plantilla_detalle);
        if (error) throw error;
        await fetchPlantillaDetalle(id_plantilla);
        return { success: true, message: 'Partida actualizada' };
    } catch (err: any) {
        return { success: false, message: err.message ?? String(err) };
    }
}

export async function addPartidaToPlantilla(
    id_plantilla: number,
    node: PartidaNode
): Promise<{ success: boolean; message: string; count: number }> {
    try {
        const client = getClient();

        // Load current items in one query
        const { data: currItems, error: cErr } = await client
            .from('plantilla_detalle')
            .select('id_partida, orden')
            .eq('id_plantilla', id_plantilla);
        if (cErr) throw cErr;

        const maxOrden = Math.max(0, ...(currItems ?? []).map((r: any) => r.orden ?? 0));
        const existingIds = new Set((currItems ?? []).map((r: any) => r.id_partida as number));

        const nodes = collectAll(node).filter(n => !existingIds.has(n.id_partida));
        if (!nodes.length) {
            return { success: true, message: 'Todas las partidas ya están en la plantilla', count: 0 };
        }

        const payload = nodes.map((n, i) => ({
            id_plantilla,
            id_partida: n.id_partida,
            cantidad_sugerida: 1,
            orden: maxOrden + i + 1,
        }));

        const { error: iErr } = await client.from('plantilla_detalle').insert(payload);
        if (iErr) throw iErr;

        await fetchPlantillaDetalle(id_plantilla);
        await fetchPlantillas();

        return { success: true, message: `${nodes.length} partida(s) agregada(s)`, count: nodes.length };
    } catch (err: any) {
        return { success: false, message: err.message ?? String(err), count: 0 };
    }
}

export async function deletePartida(id_partida: number) {
    try {
        const { error } = await getClient()
            .from('partida')
            .delete()
            .eq('id_partida', id_partida);

        if (error) throw error;

        errorMessage.set(null);
        selectedPartida.set(null);
        await fetchPartidasTree();
        return { success: true, message: 'Partida eliminada exitosamente' };
    } catch (err: any) {
        return { success: false, message: err.message || err.toString() };
    }
}
