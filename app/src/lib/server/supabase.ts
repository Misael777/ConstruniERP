import { createClient } from '@supabase/supabase-js';
import { env } from '$env/dynamic/private';
import { env as publicEnv } from '$env/dynamic/public';

const supabaseUrl = publicEnv.PUBLIC_SUPABASE_URL || 'https://mock.supabase.co';
const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY || publicEnv.PUBLIC_SUPABASE_ANON_KEY || 'mock-key';

export const supabase = createClient(supabaseUrl, supabaseKey);
