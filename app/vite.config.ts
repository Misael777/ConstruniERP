import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';

// @ts-ignore
const host = process.env.TAURI_DEV_HOST;

console.log('[vite.config] TAURI_DEV_HOST =', host ?? '(not set)');
console.log('[vite.config] Binding Vite server to 0.0.0.0:5173 (IPv4 + IPv6)');

export default defineConfig({
	plugins: [tailwindcss(), sveltekit()],
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
	}
});
