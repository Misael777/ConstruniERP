import { createClient } from '@supabase/supabase-js';
import { env } from '$env/dynamic/private';
import { env as publicEnv } from '$env/dynamic/public';

const supabaseUrl = publicEnv.PUBLIC_SUPABASE_URL || 'https://mock.supabase.co';
const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseKey) {
	console.error(
		'[Supabase] Missing SUPABASE_SERVICE_ROLE_KEY in server environment. ' +
		'Admin API endpoints will fail. ' +
		'Please set SUPABASE_SERVICE_ROLE_KEY in .env.local (see .env.local.example)'
	);
	throw new Error(
		'Server configuration error: SUPABASE_SERVICE_ROLE_KEY not set. ' +
		'This is required for admin operations like user creation/deletion. ' +
		'Copy .env.local.example to .env.local and add your Supabase Service Role Key.'
	);
}

if (!supabaseUrl || supabaseUrl === 'https://mock.supabase.co') {
	console.error(
		'[Supabase] Missing PUBLIC_SUPABASE_URL in server environment. ' +
		'Please set PUBLIC_SUPABASE_URL in .env.local (see .env.local.example)'
	);
	throw new Error(
		'Server configuration error: PUBLIC_SUPABASE_URL not set or still using mock value. ' +
		'Please configure your Supabase project URL.'
	);
}

console.log('[Supabase] Server client initialized with Service Role Key.');

export const supabase = createClient(supabaseUrl, supabaseKey);
