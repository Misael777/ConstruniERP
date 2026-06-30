import { createClient } from '@supabase/supabase-js';
import { env } from '$env/dynamic/public';

const supabaseUrl = env.PUBLIC_SUPABASE_URL || 'https://mock.supabase.co';
const supabaseAnonKey = env.PUBLIC_SUPABASE_ANON_KEY || 'mock-anon-key';
const hasSupabaseConfig = Boolean(env.PUBLIC_SUPABASE_URL && env.PUBLIC_SUPABASE_ANON_KEY);

if (!hasSupabaseConfig) {
    console.error('[supabaseClient] Missing PUBLIC_SUPABASE_URL or PUBLIC_SUPABASE_ANON_KEY. The partidas tree will show a configuration error until these values are set.');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
