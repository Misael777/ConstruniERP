import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { supabase } from '$lib/server/supabase';
import { safeEndpoint } from '$lib/server/safeEndpoint';

const getHandler: RequestHandler = async () => {
  try {
    const { count, error } = await supabase
      .from('empleados')
      .select('id', { head: true, count: 'exact' });

    if (error) {
      console.error('[first-admin GET] Error counting empleados:', error);
      return json({ canCreate: false, error: error.message }, { status: 500 });
    }

    console.log('[first-admin GET] empleados count:', count);

    // The first-admin flow only needs to know whether any empleados exist.
    // Listing auth users is not required for this endpoint and can fail under some Supabase setups.
    return json({ canCreate: !count || count === 0 });
  } catch (err: any) {
    console.error('[first-admin GET] Unexpected error:', err);
    return json({ canCreate: false, error: err?.message ?? 'Error inesperado' }, { status: 500 });
  }
};

const postHandler: RequestHandler = async ({ request }) => {
  try {
    const body = await request.json();
    const nombre = String(body.nombre ?? '').trim();
    const correo = String(body.email ?? '').trim().toLowerCase();
    const password = String(body.password ?? '');
    const telefono = body.telefono ? String(body.telefono).trim() : null;

    if (!nombre || !correo || !password) {
      return json({ success: false, error: 'Nombre, correo y contraseña son obligatorios.' }, { status: 400 });
    }

    if (password.length < 6) {
      return json({ success: false, error: 'La contraseña debe tener al menos 6 caracteres.' }, { status: 400 });
    }

    const { count, error: countError } = await supabase
      .from('empleados')
      .select('id', { head: true, count: 'exact' });

    if (countError) {
      console.error('[first-admin POST] Error counting empleados:', countError);
      return json({ success: false, error: 'Error de base de datos al verificar empleados.' }, { status: 500 });
    }

    console.log('[first-admin POST] empleados count before create:', count);

    if (count && count > 0) {
      console.warn('[first-admin POST] Aborting first admin creation because empleados already exist.');
      return json({ success: false, error: 'Ya existe al menos un empleado registrado. El primer administrador no se puede crear ahora.' }, { status: 403 });
    }

    let rolId: number | null = null;
    const { data: adminRoleData, error: roleQueryError } = await supabase
      .from('roles')
      .select('id')
      .eq('nombre', 'administrador')
      .maybeSingle();

    if (roleQueryError) {
      console.error('[first-admin POST] Error consultando rol administrador:', roleQueryError);
      return json({ success: false, error: 'Error de base de datos al buscar el rol administrador.' }, { status: 500 });
    }

    if (adminRoleData) {
      rolId = adminRoleData.id;
    } else {
      const { data: createdRole, error: roleCreateError } = await supabase
        .from('roles')
        .insert({ nombre: 'administrador' })
        .select('id')
        .single();

      if (roleCreateError) {
        console.error('[first-admin POST] Error creando rol administrador:', roleCreateError);
        return json({ success: false, error: 'No se pudo crear el rol administrador.' }, { status: 500 });
      }

      rolId = createdRole.id;
    }

    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email: correo,
      password,
      email_confirm: true,
      user_metadata: { nombre }
    });

    if (authError) {
      console.error('[first-admin POST] Error creando usuario Auth:', authError);
      return json({ success: false, error: 'Error al crear la cuenta de autenticación: ' + authError.message }, { status: 400 });
    }

    const authUserId = authData.user.id;
    const fecha_ingreso = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const { data: empleadoData, error: empleadoError } = await supabase
      .from('empleados')
      .insert([
        {
          nombre,
          correo,
          telefono: telefono || null,
          rol_id: rolId,
          auth_user_id: authUserId,
          fecha_ingreso: fecha_ingreso
        }
      ])
      .select('id, nombre, correo, rol_id, auth_user_id, fecha_ingreso')
      .single();

    if (empleadoError) {
      console.error('[first-admin POST] Error insertando empleado:', empleadoError);
      const { error: deleteError } = await supabase.auth.admin.deleteUser(authUserId);
      if (deleteError) {
        console.error('[first-admin POST] Error eliminando usuario Auth huérfano:', deleteError);
      }
      return json({ success: false, error: 'Error al guardar el empleado administrador: ' + empleadoError.message }, { status: 500 });
    }

    return json({ success: true, message: 'Primer administrador creado con éxito.', empleado: empleadoData });
  } catch (err: any) {
    console.error('[first-admin POST] Error inesperado:', err);
    return json({ success: false, error: 'Error inesperado: ' + (err?.message ?? 'Sin detalles') }, { status: 500 });
  }
};

export const GET = safeEndpoint(getHandler);
export const POST = safeEndpoint(postHandler);

