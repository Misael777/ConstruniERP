ConstruniERP
Overview
ConstruniERP is a modular ERP system for small and medium businesses. It combines a modern SvelteKit frontend with Supabase-backed authentication and data storage, plus a Tauri desktop wrapper for native app delivery.

Main Technologies
SvelteKit — app framework for routing, server-side rendering, and frontend pages
Svelte — UI component framework for reactive interfaces
Tauri — desktop application runtime that packages the web app as a native Windows app
Tailwind CSS — utility-first styling for layouts and components
Supabase — backend service for authentication, database access, and real-time data
Chart.js and svelte-chartjs — for rendering charts and dashboards
Project Structure
package.json
Defines dependencies and scripts for the Svelte/Tauri app
Includes Vite, SvelteKit, Supabase client, Tailwind, Chart.js, and Tauri tooling
src
lib/
supabaseClient.ts — initializes Supabase with public environment keys
server/config.ts — server-side config and Google Drive upload placeholder
routes/
+layout.svelte — global HTML structure, favicon, and app CSS import
(app)/+layout.svelte — authenticated app shell, session validation, role-based route protection, and sidebar layout
dashboard/, finanzas/, ventas/, iam/ — main ERP module pages
(auth)/login/+page.svelte — login page for user authentication
API folders like create-employee-user, send-verification, and verify-code for backend actions
src-tauri
src/main.rs — Tauri entry point to launch the native application window
tauri.conf.json — Tauri configuration for packaging and permissions
How the App Works
User opens the app in a browser or native Tauri window.
The app loads the global layout from +layout.svelte.
The authenticated app shell in +layout.svelte:
checks Supabase session with supabase.auth.getSession()
redirects unauthenticated users to /login
loads the current user role from the empleados table
protects admin-only routes under /iam
The sidebar and main content area are rendered for authenticated users.
User interactions and data operations use Supabase queries from page components and API routes.
Desktop packaging with Tauri uses main.rs to run the web app as a native app.
Key Files Explained
package.json
Contains app scripts: dev, build, preview, prepare, check
Declares frontend and Tauri dependencies
supabaseClient.ts
Creates a Supabase client using PUBLIC_SUPABASE_URL and PUBLIC_SUPABASE_ANON_KEY
config.ts
Stores Google Drive config values from private environment variables
Includes a placeholder uploadToDrive function for future PDF uploads
+layout.svelte
Loads global styles and favicon
Wraps every route with shared HTML head
+layout.svelte
Implements login guard and route-level authorization
Renders the app shell, sidebar, header, and page content
main.rs
Starts the Tauri native application
Ensures no extra console window appears on Windows in release mode
Running the Project
From the app folder:

npm install
npm run dev — start the SvelteKit development server
npm run build — build the app for production
Tauri-specific workflow:

npm run build for the web assets
Tauri packaging is configured via tauri.conf.json and the Rust entry point in main.rs
If you want, I can also create a standalone ARCHITECTURE.md file with the same content.

Raptor mini (Preview) • 1x