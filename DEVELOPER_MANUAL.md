ConstruniERP — Developer Manual (Single-file)
Purpose

Single-file guide so a developer or an automation agent can read only this file and be productive implementing or modifying features.
Quick TL;DR

ConstruniERP is a SvelteKit app (frontend + routing) with Supabase (auth + Postgres + RLS) and a Tauri wrapper for native desktop builds. App code is under app; Tauri config and Rust code are under src-tauri. DB schema and RBAC scripts are in the root Supabase_*.sql files.
Actionable steps to get started (read in order)

package.json — scripts & dependencies (how to run/build).
supabaseClient.ts — client initialization and public env vars.
+layout.svelte — session validation, role loading, route guards, and app shell.
+page.svelte — login flow implementation.
Supabasedefinitions.sql and Supabase_RBAC_Update.sql — data model and RBAC policies.
+page.server.ts — example of server data loading & KPIs.
config.ts — server-only config and Google Drive upload placeholder.
tauri.conf.json and main.rs — Tauri packaging and native entry point.
Sidebar.svelte — navigation and how new pages are exposed in UI.
+server.ts — example API endpoint pattern and Supabase auth creation.
Repository map (concise)

README.md — high-level repo overview.
Supabasedefinitions.sql, Supabase_*.sql — DB schema, RBAC and migration scripts.
app — main SvelteKit app:
package.json, svelte.config.js, vite.config.ts, tsconfig.json
src/:
lib/: supabaseClient.ts, server/config.ts, server/supabase.ts, components, assets.
routes/: app routes and api handlers (SvelteKit +page.svelte, +page.server.ts, +server.ts, +layout.svelte).
src-tauri/ — Rust + Tauri config for native builds.
static/ — static assets.
Important environment variables

Public (client-side): PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY
Private (server-side): SUPABASE_SERVICE_ROLE_KEY
Google Drive placeholders (server): GOOGLE_DRIVE_CLIENT_ID, GOOGLE_DRIVE_CLIENT_SECRET, GOOGLE_DRIVE_REFRESH_TOKEN, GOOGLE_DRIVE_FOLDER_ID
Note: Google Drive variables are placeholders and require real OAuth2 setup before real uploads will work.
Core application flow (runtime)

Root +layout.svelte loads CSS and favicon.
Root +page.svelte redirects to /login.
Login at (auth)/login/+page.svelte uses Supabase signInWithPassword.
Authenticated routes are under (app)/. (app)/+layout.svelte calls supabase.auth.getSession(), loads empleados → roles.nombre, enforces /iam admin-only guard, and renders Sidebar + content.
Pages fetch data either client-side with supabase (from supabaseClient.ts) or server-side via +page.server.ts / +server.ts.
Desktop: Tauri (src-tauri) launches a window that points to dev server in dev or serves built assets in production.
Key patterns & conventions

SvelteKit routing: create route folders under routes with +page.svelte (UI) and +page.server.ts (server loaders/actions) as needed.
Reuse lib for shared helpers; put server-only secrets in server.
Use Sidebar.svelte navigation items to expose new modules to users.
Wrap API functionality in SvelteKit server handlers (+server.ts) under routes/api/ for REST-like endpoints.
How to add a new module (step-by-step)

Create folder app/src/routes/<module>/.
Add +page.svelte for UI. If you need server data, add +page.server.ts.
Reuse supabase from supabaseClient.ts (client) or server helpers under server.
Add a nav item in Sidebar.svelte if it should appear in the main menu.
Add RBAC checks:
Global guard: update (app)/+layout.svelte for route patterns.
Per-page guard: check role inside +page.server.ts and return redirect/403 as needed.
If schema changes needed, update Supabasedefinitions.sql (or new migration file) and apply in Supabase.
Example: minimal new page

app/src/routes/reports/+page.svelte (create UI).
If data: app/src/routes/reports/+page.server.ts with export function load() that queries Supabase.
Add link in Sidebar.svelte.
Server-side tasks / third-party integrations

Use config.ts to read private envs.
For Google Drive uploads: uploadToDrive() is a placeholder; implement using googleapis in +page.server.ts (server environment) and store produced URL in the DB. Keep OAuth client secret and refresh token in server environment variables.
Database & RBAC pointers

Inspect Supabasedefinitions.sql for table relationships and Supabase_RBAC_Update.sql for roles and policies.
empleados.auth_user_id links application users with Supabase Auth users — changing this is sensitive.
RLS policies currently basic; review and refine per-role before production.
Developer commands (run from app)

Tauri packaging (high-level)

Build frontend: cd app && npm run build
Run Tauri build (requires Rust & Cargo installed). Check tauri.conf.json for bundling options.
Note: If you don't have Rust installed, Tauri packaging will fail — you can still run the web app.
Debugging checklist

Auth/session failures: inspect (app)/+layout.svelte session flow and supabaseClient.ts.
Server errors: see terminal where dev server runs (SvelteKit server logs).
SQL / policy issues: test in Supabase dashboard with RLS policy simulator.
Missing UI route: confirm the route folder and Svelte files exist and Sidebar.svelte links to it.
Known TODOs & placeholders

config.ts: uploadToDrive() returns mocked URL — integrate googleapis.
Some navigation entries in Sidebar.svelte point to routes that don't exist (e.g., /proyectos, /compras, /almacen, /recursos-humanos).
Password reset flow not implemented.
RLS policies are basic and should be hardened by role.
Top files to read first (prioritized)

package.json
supabaseClient.ts
+layout.svelte
+page.svelte
Supabasedefinitions.sql
Supabase_RBAC_Update.sql
+page.server.ts
tauri.conf.json
main.rs
config.ts
PR & commit checklist

Make small, self-contained commits with a clear message.
Run npm run check and fix TypeScript/Svelte issues.
If DB schema changes, update SQL files and include migration steps in PR description.
Document new env vars in this file.
Where to look first when something breaks

UI bug: browser console → component file in routes or components.
Auth: (app)/+layout.svelte, supabaseClient.ts.
API failure: routes/api/* +server.ts handlers and server logs.
Build failure: vite.config.ts, svelte.config.js, package.json deps.
Contact points / hotspots in code

Sidebar & Topbar: Sidebar.svelte, Topbar.svelte
Supabase client: supabaseClient.ts
App shell / guards: +layout.svelte
Tauri entry: main.rs
SQL schemas & RBAC: Supabasedefinitions.sql, Supabase_RBAC_Update.sql
Minimal next steps for you

I can write DEVELOPER_MANUAL.md into the workspace for you (I will attempt it), or
You can paste this content into DEVELOPER_MANUAL.md with the commands below.
Commands to create the file locally (PowerShell)

Commands to create the file locally (Bash / WSL)

File updated in the content above (sentence removed). Want me to attempt writing DEVELOPER_MANUAL.md into the workspace now?

GPT-5 mini • 1x