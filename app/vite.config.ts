import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { readFileSync } from 'node:fs';

// @ts-ignore
const host = process.env.TAURI_DEV_HOST;

// Versión de la app (package.json, que el script de deploy mantiene igual a tauri.conf.json) — se
// inyecta como constante global para mostrarla en la ERP también en el navegador (ver appVersion.ts).
const appVersion = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8')).version as string;

console.log('[vite.config] TAURI_DEV_HOST =', host ?? '(not set)');
console.log('[vite.config] Binding Vite server to 0.0.0.0:5173 (IPv4 + IPv6)');

export default defineConfig({
	plugins: [tailwindcss(), sveltekit()],
	define: { __APP_VERSION__: JSON.stringify(appVersion) },
	clearScreen: false,
	server: {
		port: 5173,
		strictPort: true,
		// Always bind on 0.0.0.0 so both 127.0.0.1 (IPv4) and [::1] (IPv6) are
		// reachable. On Windows, Vite defaults to [::1] only, which breaks the
		// adb-reverse tunnel that Tauri sets up on the IPv4 loopback.
		host: '0.0.0.0',
		hmr: host
			? {
					protocol: 'ws',
					host,
					port: 5174,
			  }
			: undefined,
	},
	envPrefix: ['VITE_', 'PUBLIC_', 'GOOGLE_'], 
});
