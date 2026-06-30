import { writable } from 'svelte/store';
import { supabase } from '$lib/supabaseClient';

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
    num_partidas?: number;
}

export interface PlantillaDetalle {
    id_plantilla_detalle: number;
    id_partida: number;
    cantidad_sugerida: number | null;
    orden: number | null;
    nombre_partida: string;
}

export const partidasTree = writable<PartidaNode[]>([]);
export const selectedPartida = writable<PartidaNode | null>(null);

export const plantillasList = writable<Plantilla[]>([]);
export const selectedPlantilla = writable<Plantilla | null>(null);
export const selectedPlantillaDetalle = writable<PlantillaDetalle[]>([]);

export const isLoading = writable<boolean>(false);
export const errorMessage = writable<string | null>(null);

function getSupabaseClient() {
    const hasSupabaseConfig = Boolean(import.meta.env.PUBLIC_SUPABASE_URL && import.meta.env.PUBLIC_SUPABASE_ANON_KEY);
    if (!hasSupabaseConfig) {
        throw new Error('La configuración de Supabase no está disponible. Revisa PUBLIC_SUPABASE_URL y PUBLIC_SUPABASE_ANON_KEY.');
    }
    return supabase;
}

export async function fetchPartidasTree() {
    isLoading.set(true);
    try {
        const client = getSupabaseClient();
        const { data, error } = await client
            .from('partida')
            .select('id_partida, codigo, descripcion, nivel, id_partida_padre, unidad, precio_unitario')
            .order('codigo', { ascending: true });
            
        if (error) throw error;
        
        const flatNodes: PartidaNode[] = data || [];
        
        // Convert flat list to tree
        const map = new Map<number, PartidaNode>();
        flatNodes.forEach(n => map.set(n.id_partida, { ...n, children: [] }));
        
        const tree: PartidaNode[] = [];
        flatNodes.forEach(n => {
            if (n.id_partida_padre !== null) {
                const parent = map.get(n.id_partida_padre);
                if (parent) {
                    parent.children = parent.children || [];
                    parent.children.push(map.get(n.id_partida)!);
                } else {
                    tree.push(map.get(n.id_partida)!);
                }
            } else {
                tree.push(map.get(n.id_partida)!);
            }
        });
        
        errorMessage.set(null);
        partidasTree.set(tree);
    } catch (err: any) {
        console.error(err);
        errorMessage.set(err.message || err.toString());
    } finally {
        isLoading.set(false);
    }
}

export async function fetchPlantillas() {
    isLoading.set(true);
    try {
        const client = getSupabaseClient();
        const { data, error } = await client
            .from('plantilla_presupuesto')
            .select('id_plantilla, nombre, descripcion, tipo')
            .order('nombre', { ascending: true });
            
        if (error) throw error;
        
        errorMessage.set(null);
        plantillasList.set(data || []);
    } catch (err: any) {
        console.error(err);
        errorMessage.set(err.message || err.toString());
    } finally {
        isLoading.set(false);
    }
}

export async function fetchPlantillaDetalle(id_plantilla: number) {
    isLoading.set(true);
    try {
        const client = getSupabaseClient();
        const { data, error } = await client
            .from('plantilla_detalle')
            .select('id_plantilla_detalle, id_partida, cantidad_sugerida, orden, partida(descripcion)')
            .eq('id_plantilla', id_plantilla)
            .order('orden', { ascending: true });
            
        if (error) throw error;
        
        const detalle: PlantillaDetalle[] = (data || []).map((r: any) => ({
            id_plantilla_detalle: r.id_plantilla_detalle,
            id_partida: r.id_partida,
            cantidad_sugerida: r.cantidad_sugerida,
            orden: r.orden,
            nombre_partida: Array.isArray(r.partida) ? r.partida[0]?.descripcion : r.partida?.descripcion || ''
        }));
        
        errorMessage.set(null);
        selectedPlantillaDetalle.set(detalle);
    } catch (err: any) {
        console.error(err);
        errorMessage.set(err.message || err.toString());
    } finally {
        isLoading.set(false);
    }
}

export async function instanciarPlantilla(id_plantilla: number, id_proyecto: number, usar_cantidades: boolean, crear_metrados: boolean, auth_user_id: string) {
    isLoading.set(true);
    try {
        const client = getSupabaseClient();

        // 1. Check if presupuesto exists
        let { data: presupuestos, error: pErr } = await client
            .from('presupuesto')
            .select('id_presupuesto')
            .eq('id_proyecto', id_proyecto)
            .limit(1);
            
        if (pErr) throw pErr;
        
        let presupuesto_id = presupuestos?.[0]?.id_presupuesto;
        
        if (!presupuesto_id) {
            const { data: newP, error: nErr } = await client
                .from('presupuesto')
                .insert({
                    id_proyecto,
                    nombre: "Presupuesto Base",
                    usuario_registro: auth_user_id
                })
                .select('id_presupuesto');
            if (nErr) throw nErr;
            presupuesto_id = newP?.[0]?.id_presupuesto;
        }
        
        // 2. Get template details
        const { data: detalles, error: dErr } = await client
            .from('plantilla_detalle')
            .select('id_partida, cantidad_sugerida')
            .eq('id_plantilla', id_plantilla);
            
        if (dErr) throw dErr;
        
        // 3. Insert into presupuesto_detalle
        if (detalles && detalles.length > 0) {
            const payload = detalles.map((d: any) => ({
                id_presupuesto: presupuesto_id,
                id_partida: d.id_partida,
                cantidad: usar_cantidades ? (d.cantidad_sugerida || 0) : 0,
                usuario_registro: auth_user_id
            }));
            
            const { error: iErr } = await client
                .from('presupuesto_detalle')
                .insert(payload);
                
            if (iErr) throw iErr;
            
            errorMessage.set(null);
            return { success: true, message: `Se insertaron ${payload.length} partidas en el presupuesto` };
        }
        errorMessage.set(null);
        return { success: true, message: 'No hay partidas para insertar.' };
    } catch (err: any) {
        console.error(err);
        errorMessage.set(err.message || err.toString());
        return { success: false, message: err.message || err.toString() };
    } finally {
        isLoading.set(false);
    }
}

// CRUD Operations for Partida
export async function createPartida(partida: Omit<PartidaNode, 'id_partida' | 'children'>) {
    try {
        const client = getSupabaseClient();
        const { data, error } = await client
            .from('partida')
            .insert({
                codigo: partida.codigo,
                descripcion: partida.descripcion,
                nivel: partida.nivel,
                id_partida_padre: partida.id_partida_padre,
                unidad: partida.unidad,
                precio_unitario: partida.precio_unitario
            })
            .select('id_partida, codigo, descripcion, nivel, id_partida_padre, unidad, precio_unitario')
            .single();
            
        if (error) throw error;
        
        errorMessage.set(null);
        await fetchPartidasTree();
        return { success: true, message: 'Partida creada exitosamente', data };
    } catch (err: any) {
        const message = err.message || err.toString();
        console.error(message);
        return { success: false, message };
    }
}

export async function updatePartida(id_partida: number, updates: Partial<Omit<PartidaNode, 'id_partida' | 'children'>>) {
    try {
        const client = getSupabaseClient();
        const { data, error } = await client
            .from('partida')
            .update(updates)
            .eq('id_partida', id_partida)
            .select('id_partida, codigo, descripcion, nivel, id_partida_padre, unidad, precio_unitario')
            .single();
            
        if (error) throw error;
        
        errorMessage.set(null);
        selectedPartida.set(data);
        await fetchPartidasTree();
        return { success: true, message: 'Partida actualizada exitosamente', data };
    } catch (err: any) {
        const message = err.message || err.toString();
        console.error(message);
        return { success: false, message };
    }
}

export async function deletePartida(id_partida: number) {
    try {
        const client = getSupabaseClient();
        const { error } = await client
            .from('partida')
            .delete()
            .eq('id_partida', id_partida);
            
        if (error) throw error;
        
        errorMessage.set(null);
        selectedPartida.set(null);
        await fetchPartidasTree();
        return { success: true, message: 'Partida eliminada exitosamente' };
    } catch (err: any) {
        const message = err.message || err.toString();
        console.error(message);
        return { success: false, message };
    }
}
