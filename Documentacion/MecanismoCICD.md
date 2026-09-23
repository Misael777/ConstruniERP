# Mecanismo de CI/CD — ConstruniERP

**Nota de terminología**: "Cliente" en este documento = el rol **Admin** de la plataforma, la misma
persona/login (no dos roles distintos). Por eso no hay un paso separado de "el cliente confirma
después de actualizar" — quien aprueba el ticket (paso 5 más abajo) y quien usa la app actualizada son
la misma persona, así que ese visto bueno ya quedó dado antes de publicar.

## Qué es "CI" y qué es "CD" acá, y por qué NO es como el CI/CD de una web normal

En una web típica, "CD" (Continuous Delivery/Deployment) suele significar "cada vez que se hace merge a
`main`, se despliega solo a producción". Acá **eso no aplica tal cual**, por dos razones concretas de
este proyecto:

1. Esto es una **app de escritorio (Windows, vía Tauri) y una app Android** — no un sitio web. No hay
   "producción" en un servidor: hay un instalador que cada usuario tiene que descargar e instalar en su
   propia máquina/teléfono. No existe forma de "desplegar" sin que el usuario reciba y ejecute un
   artefacto nuevo.
2. Los builds de Windows necesitan **firma criptográfica** (para que el updater de Tauri confíe en ellos
   y no los rechace) — no es algo que se pueda automatizar sin cuidar dónde vive la clave privada.

Por eso este proyecto separa las dos cosas con claridad:

- **CI (Integración Continua)** = automático, en cada push/PR, sin intervención humana: correr
  `npm run check` y `npx vitest run` en un runner de GitHub Actions. Si falla, se ve en rojo en GitHub
  antes de mezclar el código — nunca toca la app de los usuarios.
- **CD (Entrega Continua)** = **manual, deliberado, un comando** — el developer decide CUÁNDO publicar
  una versión nueva (después de que el Admin aprobó los tickets correspondientes) y corre el script de
  release. No hay "auto-deploy en cada push": el gate real es la aprobación de tickets, no el CI.

## Flujo completo, paso a paso

### Lado Developer (nosotros)

```
1. Escribo código para resolver uno o más tickets.
2. git push → GitHub Actions corre automáticamente:
     npm run check   (0 errores obligatorio)
     npx vitest run   (25/25 obligatorio)
   Si algo falla, el PR/commit queda marcado en rojo — no se mezcla a main así.
3. Mergeo a main cuando el check pasa.
4. Dentro del ERP (o directo en Supabase), marco cada ticket resuelto como "Resuelto".
5. El Admin entra al panel, revisa, y Aprueba (o Rechaza) cada ticket resuelto.
6. Cuando decido que es momento de publicar una versión (puede juntar varios tickets aprobados a la
   vez), corro UN SOLO comando:

     deploy.bat   (o `npm run release -- --patch`; --minor / --major). `deploy.bat` solo pide
     confirmación y llama a `npm run release` — la lógica vive toda en scripts/release.mjs.

   Este script (todo en uno — ya NO hay que compilar el APK a mano antes):
     a. Vuelve a correr check+test como último gate (por si algo cambió desde el push).
     b. Sube la versión en package.json/tauri.conf.json.
     c. Compila el APK de Android (npm run tauri android build -- --debug --target aarch64) DESPUÉS del bump y verifica
        que lleve la versión nueva incrustada. ⚠️ Por qué importa (ticket #8): la versión que la app
        instalada reporta (y que compara contra `app_release` para mostrar "actualización
        disponible") queda incrustada al COMPILAR. Un APK compilado antes del bump lleva la versión
        anterior, y quien lo instale ve el aviso de actualización para siempre. Si la versión no
        coincide, el script aborta antes de publicar nada. (--no-apk = release solo Windows;
        --apk <ruta> = usar un APK ya compilado, se verifica igual.)
     d. Compila el instalador de Windows (npm run tauri build) y lo FIRMA con la clave privada del
        updater (tauri signer sign) — esa clave NUNCA está en el repo, vive solo en la máquina del
        developer (o como GitHub Secret si más adelante se mueve el build a un runner de GitHub).
     e. Genera/actualiza latest.json (el manifest que el updater de Tauri va a leer) y publica todo
        (instalador + manifest) en GitHub Releases con `gh release create`.
     f. Sube el APK a la carpeta de Drive que ya usa el ERP para documentos — mismo mecanismo de
        autenticación que ya existe, no hay nada nuevo que inventar ahí.
     Si algo falla ANTES de publicar (los dos builds van antes), la versión de package.json/
     tauri.conf.json se revierte sola: reintentar es correr el mismo comando. Si falla DESPUÉS de
     publicar, se termina con `npm run release -- --no-bump`.
     g. Se conecta a Supabase, busca todos los tickets en estado 'aprobado' sin release asignado,
        arma el changelog con sus títulos, crea la fila en la tabla `release`, y marca esos tickets
        con el id de ese release y `estado='cerrado'` directamente — sin pedirle al Admin que confirme
        otra vez (ya lo hizo al aprobar en el paso 5).
7. Listo — no hace nada más. La app de cada usuario y el ERP ya tienen todo lo que necesitan para
   ofrecer la actualización solos.
```

### Lado del usuario final (cliente) — Windows

```
1. Abre la app de escritorio como siempre (no hace nada especial).
2. En segundo plano, la app pregunta (vía @tauri-apps/plugin-updater) si hay una versión más nueva que
   la instalada, comparando contra el latest.json publicado en GitHub — el usuario JAMÁS ve la palabra
   "GitHub" en ningún lado.
3. Si hay una versión nueva: aparece un diálogo simple "Hay una actualización disponible — ¿instalar
   ahora?". El usuario confirma.
4. La app descarga el instalador (ya firmado, Tauri valida la firma automáticamente antes de
   instalar), lo instala, y se reinicia sola con la versión nueva.
5. Dentro del ERP, si entra a un ticket que reportó, ve el banner "✅ Incluido en la versión 1.4.2" —
   así sabe exactamente qué se corrigió y en qué versión, sin tener que preguntarle a nadie por
   WhatsApp.
```

### Lado del usuario final (cliente) — Android

```
1. Entra al ERP en su teléfono como siempre.
2. Ve en un ticket (o en un aviso general) el botón "Actualizar disponible".
3. Toca el botón → la app abre en el navegador del teléfono el enlace público de descarga directa del
   APK (Drive, `drive.usercontent.google.com/download?...&confirm=t`) y el navegador lo baja. (Antes
   la app lo bajaba a caché y lo abría con `openPath`, pero eso nunca pudo funcionar en Android: falta
   el permiso `opener:allow-open-path`, `openPath` no usa FileProvider y el manifest no declara
   `REQUEST_INSTALL_PACKAGES` — ticket #8.)
4. El usuario toca el archivo descargado y Android abre el instalador nativo — acá SÍ hace falta un
   paso manual del usuario (tocar "Instalar", y la primera vez, permitir "orígenes desconocidos" para el
   navegador): Android no permite que ninguna app se auto-instale sola por seguridad, fuera de Play
   Store. No hay forma de evitar este paso sin publicar en Play Store.
5. Termina la instalación, la app se actualiza.
```

## Diagrama del flujo completo

```
 DEVELOPER                          GITHUB                         SUPABASE
 ─────────                          ──────                         ────────
 push código  ──────────────────▶  Actions: check + test
                                    (falla = commit en rojo)

 marca ticket "Resuelto" ──────────────────────────────────────▶  ticket.estado='resuelto'

                                                        ADMIN
                                                        ─────
                                    ◀──────────────  revisa y Aprueba/Rechaza
                                                     ticket.estado='aprobado'

 corre scripts/release.mjs
   ├─ check + test (gate final)
   ├─ tauri build + firma  ────▶  Release (instalador + latest.json)
   ├─ sube APK  ─────────────────────────▶  Google Drive
   └─ busca tickets aprobados ──────────────────────────────▶  crea fila `release`
                                                                tickets.id_release + estado='cerrado'

                    ┌─────────────────────────────────────────────────┐
                    │                  USUARIO FINAL                  │
                    │  Windows: app pregunta sola, confirma, listo.    │
                    │  Android: toca "Actualizar" en el ticket,        │
                    │  descarga de Drive, instala a mano.              │
                    └─────────────────────────────────────────────────┘
```

## Cómo se cargan las variables de entorno

`npm run release -- --patch` (nunca `node scripts/release.mjs` directo) — el script de `package.json`
ya invoca `node --env-file=app/.env`, así que TODO lo que ya está en el `.env` de siempre de la app
(Supabase, Drive) se carga solo, sin configurar nada aparte. Solo hay que AGREGAR a ese mismo `.env`
las dos cosas genuinamente nuevas: `TAURI_SIGNING_PRIVATE_KEY`/`_PASSWORD` (la clave de firma, ver
abajo) y `GOOGLE_DRIVE_FOLDER_ID_RELEASES` (carpeta nueva de Drive para los APK de release).

## Secretos y seguridad — qué NO debe pasar nunca

- La clave privada de firma del updater (`tauri signer generate` produce un par de claves) **nunca se
  commitea al repo**. Vive en el `.env`/keychain local del developer, o como GitHub Actions Secret si el
  build se mueve a un runner en la nube.
- La clave pública sí va en `tauri.conf.json` (es pública a propósito, así el updater puede verificar la
  firma sin exponer nada sensible).
- El script de deploy necesita una Supabase **service role key** (no la anon key que usa el resto del
  ERP) para escribir en `release`/`ticket` sin pasar por los permisos normales de usuario — esa key
  tampoco se commitea, vive en el `.env` local del developer, igual que la clave de firma.
- El token de `gh` (GitHub CLI) y las credenciales de Drive que use el script también quedan fuera del
  repo, mismo criterio.

## Camino de evolución (no para la v1, pero vale dejarlo anotado)

Hoy el build y la firma corren en la máquina del developer (más simple de armar, cero infraestructura
nueva). Un paso más "CI/CD de verdad" sería mover el build+firma a un GitHub Action disparado a mano
(`workflow_dispatch`) que corra en un runner de Windows de GitHub, usando la clave privada como Secret
— así el binario que se firma nunca depende de la laptop de un developer en particular, y queda un
registro público de "quién disparó qué build, cuándo". No es necesario para arrancar, pero es la
mejora natural una vez que el flujo manual esté probado y funcionando.
