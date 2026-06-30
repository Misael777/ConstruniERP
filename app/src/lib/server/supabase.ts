import { createClient } from '@supabase/supabase-js';
import { env } from '$env/dynamic/private';
import { env as publicEnv } from '$env/dynamic/public';

const supabaseUrl = publicEnv.PUBLIC_SUPABASE_URL || 'https://mock.supabase.co';
const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY || '';
const anonKey = publicEnv.PUBLIC_SUPABASE_ANON_KEY || '';
const effectiveKey = serviceRoleKey || anonKey || 'mock-key';

if (!serviceRoleKey) {
	console.warn(
		'[Supabase] SUPABASE_SERVICE_ROLE_KEY is not set. Admin-only endpoints will be unavailable until it is configured.'
	);
}

if (!supabaseUrl || supabaseUrl === 'https://mock.supabase.co') {
	console.warn(
		'[Supabase] PUBLIC_SUPABASE_URL is not configured. The app will use the fallback URL until the environment is set.'
	);
}

console.log('[Supabase] Server client initialized with the available credentials.');

export const supabase = createClient(supabaseUrl, effectiveKey);
