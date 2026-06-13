import { createClient } from 'npm:@supabase/supabase-js@2'

// 1. Configuración de cabeceras CORS para permitir conexiones desde el EXE de Tauri
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// 2. Variables de entorno nativas de las Edge Functions (Supabase las inyecta solas)
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in function environment');
}

// Cliente administrativo con permisos maestros
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false }
});

// Helper para construir respuestas JSON con soporte CORS
function buildJsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 
      'content-type': 'application/json',
      ...corsHeaders
    }
  });
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

// --- CONTROLADORES API ---

async function listUsers() {
  const { data: authData, error: authError } = await supabase.auth.admin.listUsers({ perPage: 100 });
  if (authError) return buildJsonResponse({ success: false, error: authError.message }, 500);

  const { data: empleados, error: empleadosError } = await supabase
    .from('empleados')
    .select('id, nombre, correo, telefono, rol_id, area_id, fecha_ingreso, salario, horas, periodo, nivel, auth_user_id');

  if (empleadosError) return buildJsonResponse({ success: false, error: empleadosError.message }, 500);

  return buildJsonResponse({ success: true, users: authData.users, empleados });
}

async function getUser(userId: string) {
  const { data: authUser, error: authError } = await supabase.auth.admin.getUserById(userId);
  if (authError) return buildJsonResponse({ success: false, error: authError.message }, 404);

  const { data: empleado, error: empleadoError } = await supabase
    .from('empleados')
    .select('*')
    .eq('auth_user_id', userId)
    .single();

  if (empleadoError && empleadoError.code !== 'PGRST116') {
    return buildJsonResponse({ success: false, error: empleadoError.message }, 500);
  }

  return buildJsonResponse({ success: true, user: authUser, empleado });
}

async function createUser(body: any) {
  const email = String(body.email ?? '').trim().toLowerCase();
  let password = String(body.password ?? '').trim();
  const nombre = body.nombre ? String(body.nombre).trim() : null;

  // If no password is provided by the caller (frontend), generate a secure temporary password
  // This allows creating the Auth user while letting the user set their real password later
  if (!email) {
    return buildJsonResponse({ success: false, error: 'Correo es obligatorio.' }, 400);
  }

  if (!password) {
    // generate a 24-char hex password + a suffix to satisfy complexity
    const rand = crypto.getRandomValues(new Uint8Array(16));
    const hex = Array.from(rand).map((b) => b.toString(16).padStart(2, '0')).join('');
    password = `${hex}A1!`;
  }

  const { data: authData, error: authError } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { nombre }
  });

  if (authError) return buildJsonResponse({ success: false, error: authError.message }, 400);

  const authUserId = authData.user?.id;
  if (!authUserId) return buildJsonResponse({ success: false, error: 'No se generó ID de usuario Auth.' }, 500);

  const { data: empleadoData, error: empleadoError } = await supabase.from('empleados').insert([
    {
      nombre,
      correo: email,
      telefono: body.telefono ?? null,
      rol_id: body.rol_id ?? null,
      area_id: body.area_id ?? null,
      fecha_ingreso: body.fecha_ingreso ?? null,
      salario: body.salario ?? 0,
      horas: body.horas ?? 0,
      periodo: body.periodo ?? 'Mensual',
      nivel: body.nivel ?? null,
      auth_user_id: authUserId
    }
  ]).select('*').single();

  if (empleadoError) {
    await supabase.auth.admin.deleteUser(authUserId);
    return buildJsonResponse({ success: false, error: empleadoError.message }, 500);
  }

  return buildJsonResponse({ success: true, user: authData.user, empleado: empleadoData });
}

async function updateUser(body: any) {
  const authUserId = String(body.auth_user_id ?? body.id ?? '').trim();
  if (!authUserId || !isUuid(authUserId)) {
    return buildJsonResponse({ success: false, error: 'auth_user_id válido es requerido para actualizar.' }, 400);
  }

  const updates: any = {};
  if (body.email) updates.email = String(body.email).trim().toLowerCase();
  if (body.password) updates.password = String(body.password);
  if (body.nombre || body.nombre === '') updates.user_metadata = { nombre: String(body.nombre).trim() };

  if (Object.keys(updates).length > 0) {
    const { error: authError } = await supabase.auth.admin.updateUserById(authUserId, updates);
    if (authError) return buildJsonResponse({ success: false, error: authError.message }, 400);
  }

  const empleadoUpdate: any = {};
  if (body.nombre) empleadoUpdate.nombre = String(body.nombre).trim();
  if (body.email) empleadoUpdate.correo = String(body.email).trim().toLowerCase();
  if (body.telefono) empleadoUpdate.telefono = String(body.telefono).trim();
  if (body.rol_id !== undefined) empleadoUpdate.rol_id = body.rol_id;
  if (body.area_id !== undefined) empleadoUpdate.area_id = body.area_id;
  if (body.fecha_ingreso) empleadoUpdate.fecha_ingreso = body.fecha_ingreso;
  if (body.salario !== undefined) empleadoUpdate.salario = body.salario;
  if (body.horas !== undefined) empleadoUpdate.horas = body.horas;
  if (body.periodo) empleadoUpdate.periodo = body.periodo;
  if (body.nivel) empleadoUpdate.nivel = body.nivel;

  let empleadoData = null;
  if (Object.keys(empleadoUpdate).length > 0) {
    const { data, error } = await supabase.from('empleados').update(empleadoUpdate).eq('auth_user_id', authUserId).select('*').single();
    if (error) return buildJsonResponse({ success: false, error: error.message }, 500);
    empleadoData = data;
  }

  return buildJsonResponse({ success: true, auth_user_id: authUserId, empleado: empleadoData });
}

async function deleteUser(userId: string | null) {
  if (!userId) return buildJsonResponse({ success: false, error: 'auth_user_id es requerido para eliminar.' }, 400);

  let authUserId = userId;
  if (!isUuid(authUserId)) {
    const { data: empleado, error: empleadoError } = await supabase.from('empleados').select('auth_user_id').eq('id', Number(userId)).single();
    if (empleadoError || !empleado?.auth_user_id) {
      return buildJsonResponse({ success: false, error: 'No se encontró auth_user_id para el id proporcionado.' }, 404);
    }
    authUserId = empleado.auth_user_id;
  }

  // Se borra primero de la tabla empleados para no violar restricciones de esquema en cascada
  const { error: deleteError } = await supabase.from('empleados').delete().eq('auth_user_id', authUserId);
  if (deleteError) return buildJsonResponse({ success: false, error: deleteError.message }, 500);

  const { error: authError } = await supabase.auth.admin.deleteUser(authUserId);
  if (authError) return buildJsonResponse({ success: false, error: authError.message }, 500);

  return buildJsonResponse({ success: true, auth_user_id: authUserId });
}

async function resetPassword(body: any) {
  const authUserId = String(body.auth_user_id ?? '').trim();
  const password = String(body.password ?? '').trim();

  if (!authUserId || !isUuid(authUserId) || !password) {
    return buildJsonResponse({ success: false, error: 'auth_user_id y password son requeridos.' }, 400);
  }

  const { data, error } = await supabase.auth.admin.updateUserById(authUserId, { password });
  if (error) return buildJsonResponse({ success: false, error: error.message }, 500);

  return buildJsonResponse({ success: true, user: data });
}

// 3. Servidor Central Nativo de Deno
Deno.serve(async (req) => {
  // Manejo del preflight de CORS exigido por los navegadores/Tauri
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const idFromQuery = url.searchParams.get('id');
  const action = url.searchParams.get('action');
  let body: any = null;

  if (req.method !== 'GET') {
    body = await req.json().catch(() => null);
  }

  try {
    if (req.method === 'GET') {
      if (idFromQuery) return await getUser(idFromQuery);
      return await listUsers();
    }

    if (req.method === 'POST') {
      if (action === 'reset-password') return await resetPassword(body);
      return await createUser(body);
    }

    if (req.method === 'PUT') {
      return await updateUser(body);
    }

    if (req.method === 'DELETE') {
      return await deleteUser(idFromQuery || (body ? body.id : null));
    }

    return buildJsonResponse({ success: false, error: 'Método no permitido' }, 405);
  } catch (err: any) {
    return buildJsonResponse({ success: false, error: err.message }, 500);
  }
});
