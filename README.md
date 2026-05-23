ConstruniERP
Overview
ConstruniERP es un sistema ERP modular para pequeñas y medianas empresas. Combina una aplicación web moderna basada en SvelteKit con autenticación y almacenamiento de datos basados en Supabase, así como un envoltorio nativo Tauri para la distribución de aplicaciones.

Tecnologías principales
SvelteKit — marco de desarrollo para rutas, renderizado del servidor y páginas del frontend
Svelte — marco de componentes para interfaces de usuario reactivas
Tauri — entorno de ejecución nativo que empaqueta la aplicación web como una aplicación nativa Windows
Tailwind CSS — estilos de utilidad basados en funciones para diseños y componentes
Supabase — servicio backend para autenticación, acceso a bases de datos y datos en tiempo real
Chart.js y svelte-chartjs — para renderizar gráficos y paneles de control
Estructura del proyecto
package.json
Define dependencias y scripts para la aplicación Svelte/Tauri
Incluye Vite, SvelteKit, cliente Supabase, Tailwind, Chart.js y herramientas Tauri
src
lib/
supabaseClient.ts — inicializa Supabase con claves públicas de entorno
server/config.ts — configuración del servidor para acciones backend y placeholder de subida a Google Drive
routes/
+layout.svelte — estructura HTML global, favicon e importación de hojas de estilo de la aplicación
(app)/+layout.svelte — shell de aplicación autenticada, validación de sesión con supabase.auth.getSession()
redirige a los usuarios no autenticados a /login
carga el rol actual del usuario desde la tabla empleados
protege las rutas solo para administradores bajo /iam
se renderizan el sidebar y el área de contenido principal para usuarios autenticados
las interacciones y operaciones de datos se realizan con consultas Supabase en componentes de página y rutas API
Empaqueamiento nativo con Tauri utiliza main.rs para lanzar la ventana de aplicación nativa
Archivos clave explicados
package.json
Define scripts: dev, build, preview, prepare, check
Declara dependencias frontend y Tauri
supabaseClient.ts
Crea un cliente Supabase utilizando PUBLIC_SUPABASE_URL y PUBLIC_SUPABASE_ANON_KEY
config.ts
Almacena valores de configuración de Google Drive desde variables de entorno privadas
Incluye una función placeholder uploadToDrive para futuras subidas de PDFs
+layout.svelte
Carga hojas de estilo globales e icono
Envuelve cada ruta con estructura HTML global
+layout.svelte
Implementa guardado de inicio de sesión y autorización a nivel de ruta
Ruta principal
Desde la carpeta del proyecto:

npm install
npm run dev — inicia el servidor de desarrollo SvelteKit
npm run build — construye la aplicación para producción
Flujo específico de Tauri:

npm run build para los archivos web
El empaquetamiento de Tauri está configurado a través de tauri.conf.json y el punto de entrada en main.rs
Si lo desea, también puedo crear un ARCHITECTURE.md archivo con el mismo contenido.
Raptor mini (Vista previa) • 1x```

path/to/app/package.json
