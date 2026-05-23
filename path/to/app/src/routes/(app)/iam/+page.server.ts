import { error } from '@sveltejs/kit';
import { supabase } from '$lib/server/supabaseClient';

export async function load({ locals }) {
  const user = await locals.supabase.auth.user();
  if (!user) {
    throw error(401, 'No está autenticado');
  }

  // Aquí puedes agregar la lógica para cargar los datos del modulo IAM
  // Por ejemplo, obtener roles o permisos del usuario actual

  return {};
}
