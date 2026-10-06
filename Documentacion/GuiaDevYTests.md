# Guía operativa — Base de datos de Desarrollo (Dev) y lógica de los tests

Manual práctico para un agente de IA (o una persona) que tenga que **usar la base Dev, aplicar migraciones, probar
cambios y escribir tests** en ConstruniERP. Es el "cómo se hace, paso a paso" de lo que
[GuiaAgente.md](GuiaAgente.md) describe a nivel de políticas (§2, §4, §5, §6). Si algo aquí contradice el código o la
base, **manda lo que observes ahora**: corrige este documento.

> Estado descrito: 2026-10-06. Ningún secreto vive aquí. Todo comando de este documento se escribió para **Git Bash
> sobre Windows** (el shell del equipo) y se corre desde `app/` salvo que se diga otra cosa.

---

## 0. Las 10 reglas (léelas aunque no leas nada más)

1. **Dev = `hlfaxszecrxgkbjafepv`. Producción = `nqffgnbcwsixlaodhaku`.** El entorno lo decide **qué archivo de
   credenciales cargas** (`app/.env.dev` o `app/.env`), nunca una variable de "modo".
2. **Todo script que escriba debe tener una guarda** que aborte si la URL no contiene el ref de Dev (§3).
3. **En Producción solo se escribe en Tickets/Releases** (`ticket`, `ticket_evento`, `ticket_comentario`,
   `app_release`). Cualquier otra escritura, solo en Dev.
4. **Dev tiene solo datos sintéticos.** Nunca copies datos reales de Producción a Dev.
5. **Antes de probar, comprueba que el esquema de Dev es igual al de Producción** (o al de Producción + las migraciones
   nuevas que estás probando) — §6.
6. **Un cambio de esquema = un archivo nuevo en `supabase/migrations/`.** Se aplica a Dev, se prueba, y a Producción
   lo aplica **el usuario a mano** en el SQL Editor (§5).
7. **Los tests de escritura corren solo contra Dev** y pasan por la **capa de servicio real** (`*.service.ts` o las
   herramientas MCP que la envuelven), no por INSERT crudo, salvo que el módulo no tenga servicio.
8. **Cada test limpia lo que crea** (o lo marca con un prefijo `TEST-*` reconocible si es una suite larga).
9. **Nunca imprimas credenciales** (claves `service_role`, contraseñas de la URL de Postgres). Para depurar una
   conexión muestra solo host y usuario.
10. **Si el clasificador de permisos de Claude Code bloquea algo** (push a Producción, borrado masivo), no lo rodees:
    explica qué ibas a hacer y dale al usuario el comando exacto.

---

## 0b. Preparar una PC nueva

En una PC con Windows y el repo clonado: `app\setup-dev.bat "<ruta al .env.dev>"`. Instala con winget lo que falte
(Node.js LTS ≥ 22, Git, cliente de PostgreSQL 17 sin servidor), corre `npm install`, descarga Supabase CLI, copia
el `.env.dev` (que se pasa por un canal seguro, nunca por chat) y prueba la API, `psql` y el MCP de Dev
(`scripts/verificar-dev.mjs`, que aborta si el archivo no apunta a Dev). No crea ni toca `app/.env` (Producción).

---

## 1. Mapa de entornos

| | **Desarrollo (Dev)** | **Producción (Prod)** |
|---|---|---|
| Proyecto Supabase | `construnierp-dev` | `CONSTRUNISYS` |
| Ref | `hlfaxszecrxgkbjafepv` | `nqffgnbcwsixlaodhaku` |
| URL API | `https://hlfaxszecrxgkbjafepv.supabase.co` | `https://nqffgnbcwsixlaodhaku.supabase.co` |
| Credenciales | `app/.env.dev` | `app/.env` |
| Postgres (pooler de sesión, puerto 5432) | `aws-0-us-east-1.pooler.supabase.com` | `aws-1-us-west-1.pooler.supabase.com` |
| Versión de Postgres | 17 | 17 |
| Datos | Sintéticos (seed + restos de tests) | Reales de clientes |
| Servidor MCP | `construnierp-dev` (`npm run mcp:dev`): lecturas **y escrituras** | `construnierp` (`npm run mcp`): lecturas + Tickets |
| Quién aplica migraciones | El agente (§5.2) | **El usuario**, a mano (§5.4) |

**Dev puede estar pausado.** Supabase pausa los proyectos gratuitos sin uso. Síntoma: timeouts o
`could not translate host name`/`connection refused`. Solución: pedir al usuario que lo reactive desde el dashboard.
No asumas que un fallo de conexión es un error de tu código.

---

## 2. Credenciales: qué hay en cada archivo y cómo usarlas

Ambos archivos están en `app/` y **gitignoreados** (`app/.gitignore`: `.env` y `.env.*`). Comprobar:
`git check-ignore -v app/.env app/.env.dev`.

| Variable | Para qué | En `.env.dev` | En `.env` |
|---|---|---|---|
| `PUBLIC_SUPABASE_URL` | URL de la API; **es lo que identifica el entorno** | sí | sí |
| `PUBLIC_SUPABASE_ANON_KEY` | Cliente como lo usa la app (respeta RLS) | sí | sí |
| `SUPABASE_SERVICE_ROLE_KEY` | Cliente de agente/scripts (**se salta RLS**) | sí | sí |
| `SUPABASE_DB_URL` | URI de Postgres por el pooler de sesión, contraseña percent-encoded (`#` → `%23`) | sí | sí |
| `GOOGLE_DRIVE_*`, `TAURI_SIGNING_*` | Drive real y firma de releases | **no** | sí |

`app/.env.local` solo trae `PUBLIC_API_BASE_URL`; no cambia el entorno.

### 2.1 Cargar un archivo de credenciales

- **Node:** `node --env-file=.env.dev script.mjs`. Es la forma estándar en todo el repo.
- **Bash, una sola variable:** no hagas `source .env` (hay líneas con espacios que rompen el parseo). Extrae así:

  ```bash
  DEV_URL=$(grep '^SUPABASE_DB_URL=' .env.dev | cut -d'=' -f2-)     # desde app/
  PROD_URL=$(grep '^SUPABASE_DB_URL=' .env    | cut -d'=' -f2-)
  ```
- **Nunca** hagas `echo $DEV_URL`, `cat .env.dev` ni pegues la salida de un error que incluya la URL completa.
  Para confirmar a qué base apuntas: `echo "$DEV_URL" | sed -E 's#//([^:]+):[^@]+@#//\1:***@#'`.

---

## 3. Guardas de seguridad (obligatorias en todo script que escriba)

Patrón en Node (es el que usa `scripts/seed-dev-main.mjs`):

```js
const DEV_REF = 'hlfaxszecrxgkbjafepv';
if (!process.env.PUBLIC_SUPABASE_URL?.includes(DEV_REF)) {
  console.error('SEGURIDAD: este script solo corre contra Dev. Abortando sin escribir.');
  process.exit(1);
}
```

En un test de vitest: `expect(process.env.PUBLIC_SUPABASE_URL).toContain('hlfaxszecrxgkbjafepv');` como **primera**
línea del test.

En Bash, antes de cualquier `psql`/`supabase` que escriba:

```bash
case "$DEV_URL" in *hlfaxszecrxgkbjafepv*) echo "Destino: DEV";; *) echo "NO ES DEV, abortando"; exit 1;; esac
```

El inverso también existe: el script que marca tickets como resueltos verifica que la URL **sí** sea la de
Producción (`nqffgnbcwsixlaodhaku`) y solo toca tablas de tickets.

---

## 4. Las cinco formas de acceder a Dev (y cuándo usar cada una)

| # | Vía | Cuándo | Respeta reglas de negocio |
|---|---|---|---|
| A | **Herramientas MCP** (`scripts/mcp-call.mjs dev …`) | Consultar o crear datos como lo haría la app; tests de negocio | **Sí** (envuelven los services) |
| B | **Script Node con supabase-js + `service_role`** | Escenarios a medida, verificación fina, limpieza de lo que creaste | Solo si importas los services |
| C | **vitest con `$lib`** (test temporal o permanente) | Probar una función de servicio concreta contra Dev | **Sí** |
| D | **`psql`** directo | Aplicar migraciones, consultas de catálogo, comparar esquemas | No (SQL crudo) |
| E | **Supabase CLI** (`npx supabase …`) | Historial de migraciones (`migration list` / `repair`), `db dump` | No |

### 4.A Herramientas MCP desde la línea de comandos

```bash
cd app
node scripts/mcp-call.mjs dev list                                              # catálogo de herramientas
node scripts/mcp-call.mjs dev '[{"name":"listar_cuentas_pagar","arguments":{"limit":5}}]'
node scripts/mcp-call.mjs dev '[{"name":"ver_cuenta_cobrar","arguments":{"id_cuenta_cobrar":3}},
                                 {"name":"auditar_cuentas_cobrar","arguments":{"id_cuenta_cobrar":3}}]'
```

- Acepta varias llamadas en un mismo arreglo JSON (se ejecutan en orden, un solo arranque del servidor).
- `dev` carga `.env.dev`; el servidor registra las herramientas de escritura **solo** si la URL es la de Dev
  (`filtrarPorEntorno`). En `prod` las de escritura no existen (salvo Tickets).
- Las imágenes (`ver_imagen_adjunta`) se guardan en `%TEMP%` y el script imprime la ruta.
- No confíes en que Claude Code exponga `mcp__construnierp*` como herramientas nativas: aunque `claude mcp list` diga
  "Connected", a menudo no aparecen. `mcp-call.mjs` siempre funciona.
- Catálogo y cómo añadir herramientas: [GuiaAgente.md §3](GuiaAgente.md), [AgentTools.md](AgentTools.md).

### 4.B Script Node con supabase-js

Para algo puntual, crea el script en `app/scripts/tmp_<algo>.mjs` (tiene `node_modules` a mano), ejecútalo y
**bórralo al terminar**:

```bash
cd app && cat > scripts/tmp_consulta.mjs <<'EOF'
import { createClient } from '@supabase/supabase-js';
const url = process.env.PUBLIC_SUPABASE_URL;
if (!url.includes('hlfaxszecrxgkbjafepv')) throw new Error('No es Dev');
const c = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data, error } = await c.from('cobros').select('id_cuenta_cobrar, fecha_cobro, monto, estado, hito').limit(5);
console.log(error ?? data);
EOF
node --env-file=.env.dev scripts/tmp_consulta.mjs; rm scripts/tmp_consulta.mjs
```

- `service_role` **se salta RLS**: lo que veas no es lo que vería un usuario. Para probar RLS, usa la `anon key` con
  un usuario autenticado, o `SET ROLE`/`request.jwt.claims` en `psql` (ver `Documentacion/tests/auditoria.md`).
- Para importar services (`$lib/...`) desde un `.mjs` suelto hay que registrar el resolver:
  `node --env-file=.env.dev --import ./scripts/register-lib-resolver.mjs --experimental-strip-types script.mjs`.
  **Limitación:** un service que importe algo con runas de Svelte 5 (`*.svelte.ts`, p. ej. `permisos.svelte.ts`)
  no carga en Node. En ese caso usa la vía C (vitest), que sí compila.

### 4.C vitest con `$lib` contra Dev

Es la vía más cómoda para probar **una función de servicio** con la base real. Ver §8.3 (plantilla completa).

### 4.D `psql`

`psql` **no está en el PATH**. Está instalado en `/c/Program Files/PostgreSQL/16/bin/psql.exe` (cliente 16; habla
bien con servidores 17 para consultas y scripts; **`pg_dump` 16 no sirve contra un servidor 17**, ver §6).

```bash
PSQL="/c/Program Files/PostgreSQL/16/bin/psql.exe"
DEV_URL=$(grep '^SUPABASE_DB_URL=' .env.dev | cut -d'=' -f2-)
"$PSQL" -w -q -v ON_ERROR_STOP=1 -d "$DEV_URL" -c "select count(*) from cobros;" < /dev/null
```

**Trampas de `psql` en Windows (ya nos pasaron):**
- **Pon la URL con `-d "$URL"` y todas las opciones ANTES o con `-d`.** Si pasas la URL como argumento posicional y
  opciones después, `psql` de Windows las ignora y abre una sesión interactiva que **se cuelga** esperando input.
- **Siempre `< /dev/null`** y `-w` (no pedir contraseña): si algo falla, termina en vez de quedarse esperando.
- Si se colgó igual: `tasklist | grep -i psql` y `taskkill //PID <pid> //F`.
- Para un archivo: `-1` (una sola transacción) + `-v ON_ERROR_STOP=1` + `-f archivo.sql`. Si una sentencia falla, se
  revierte todo.
- Alternativa sin `psql` local: Docker (`MSYS_NO_PATHCONV=1 docker run --rm -v "<ruta windows>:/m" postgres:17 psql
  "$DEV_URL" -f /m/archivo.sql`). Requiere Docker Desktop encendido.

### 4.E Supabase CLI

Usar siempre `npx supabase …` con `--db-url "$URL"` (no hay `supabase link`). Comandos útiles:

```bash
npx supabase migration list   --db-url "$DEV_URL"     # qué versiones figuran como aplicadas
npx supabase migration repair --status applied <v1> <v2> --db-url "$DEV_URL"   # registrar aplicadas a mano
```

`supabase db push` contra Dev **falló de forma intermitente por el pooler** en sesiones recientes; el camino fiable
es aplicar con `psql` (§5.2) y luego `migration repair`. `db push`/`db dump` además necesitan Docker Desktop.

---

## 5. Migraciones: ciclo completo

### 5.1 Escribir la migración

- Nombre: `supabase/migrations/YYYYMMDDHHMMSS_descripcion_corta.sql` (UTC: `date -u +%Y%m%d%H%M%S`). Debe ordenar
  **después** de la última existente.
- **Idempotente**: `ADD COLUMN IF NOT EXISTS`, `CREATE OR REPLACE FUNCTION`, `CREATE INDEX IF NOT EXISTS`, constraints
  dentro de `DO $$ … IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = '…') …$$`.
- Comentario arriba: qué ticket/hallazgo resuelve, qué toca, si modifica filas.
- Terminar con `NOTIFY pgrst, 'reload schema';` (si no, la API de Supabase tarda en ver la columna nueva).
- **Nunca** `DROP TABLE`/`DROP COLUMN`/`TRUNCATE` sin confirmación explícita del usuario.
- **El código de la app debe tolerar que la migración aún no esté en Producción** cuando sea posible (la app se
  publica y la migración se corre a mano, no siempre en el mismo minuto). Ejemplos reales:
  - `tickets.service.ts → crearTicket`: si el insert falla con un error que menciona `plataforma`, reintenta sin esa
    columna.
  - `cuentasCobrar.service.ts → sincronizarCuotasProgramadas`: si leer `hito` falla, sigue sin hitos y solo incluye la
    columna en el insert cuando hay algún valor.

Ejemplo real (`20261005000100_ticket_plataforma.sql`):

```sql
ALTER TABLE ticket ADD COLUMN IF NOT EXISTS plataforma VARCHAR(10);
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ticket_plataforma_check') THEN
        ALTER TABLE ticket ADD CONSTRAINT ticket_plataforma_check CHECK (plataforma IS NULL OR plataforma IN ('web', 'app'));
    END IF;
END $$;
NOTIFY pgrst, 'reload schema';
```

### 5.2 Aplicarla a Dev (lo hace el agente)

```bash
cd app
PSQL="/c/Program Files/PostgreSQL/16/bin/psql.exe"
DEV_URL=$(grep '^SUPABASE_DB_URL=' .env.dev | cut -d'=' -f2-)
case "$DEV_URL" in *hlfaxszecrxgkbjafepv*) echo "Destino: DEV";; *) echo "NO ES DEV"; exit 1;; esac
for v in 20261005000000_cobros_hito 20261005000100_ticket_plataforma; do
  "$PSQL" -w -q -1 -v ON_ERROR_STOP=1 -d "$DEV_URL" -f "../supabase/migrations/$v.sql" < /dev/null
  echo "$v -> $?"
done
npx supabase migration repair --status applied 20261005000000 20261005000100 --db-url "$DEV_URL"
```

- `-> 0` = aplicada. Cualquier otro código: lee el error, corrige el archivo y vuelve a correr (al ser idempotente no
  pasa nada por repetir).
- **Córrela dos veces** si es nueva: la segunda corrida tiene que pasar sin error (prueba de idempotencia).
- `migration repair` registra la versión en `supabase_migrations.schema_migrations` para que el historial de Dev
  coincida con los archivos.

### 5.3 Verificar en Dev

1. Consulta de catálogo de que el objeto existe (columna, constraint, función):
   `select column_name, data_type from information_schema.columns where table_name='ticket' and column_name='plataforma';`
2. Un test que la ejercite por la capa de servicio (§8).
3. `npm run check` (0 errores) y `npm run build`.

### 5.4 Producción (lo hace el usuario)

1. Le das al usuario la **lista ordenada** de archivos a pegar en el **SQL Editor de Producción**, y le avisas qué
   versión de la app depende de ellos.
2. Cuando confirme que los corrió, registras el historial — **pidiendo confirmación antes**, porque escribe en
   Producción:

   ```bash
   PROD_URL=$(grep '^SUPABASE_DB_URL=' .env | cut -d'=' -f2-)
   npx supabase migration repair --status applied <versiones> --db-url "$PROD_URL"
   ```
3. Actualiza la tabla de estado de migraciones en [GuiaAgente.md §4.4](GuiaAgente.md).

**No ejecutes `supabase db push` ni `psql -f` contra Producción.** El clasificador lo bloquea y la regla del proyecto
es que el usuario lo corre a mano.

---

## 6. Comprobar que Dev tiene el mismo esquema que Producción

Hazlo **antes de una ronda de pruebas** y cada vez que el usuario diga que aplicó algo a mano en alguna de las dos
bases. `pg_dump` no sirve (el cliente local es 16 y el servidor 17: "server version mismatch"), así que se compara un
**snapshot del catálogo** sacado con una consulta de solo lectura.

1. Guarda esta consulta como `snapshot.sql` en el scratchpad (no en el repo):

```sql
\pset format unaligned
\pset tuples_only on
BEGIN READ ONLY;
SELECT 'COL ' || c.table_name || '.' || c.column_name || ' ' || c.data_type || coalesce('(' || c.character_maximum_length || ')', '')
  || CASE WHEN c.is_nullable = 'NO' THEN ' NOT NULL' ELSE '' END
  || coalesce(' DEFAULT ' || c.column_default, '') || coalesce(' GEN ' || c.generation_expression, '')
FROM information_schema.columns c JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE'
UNION ALL
SELECT 'CON ' || conrelid::regclass || ' ' || conname || ' ' || pg_get_constraintdef(oid) FROM pg_constraint WHERE connamespace = 'public'::regnamespace
UNION ALL
SELECT 'IDX ' || indexname || ' ' || indexdef FROM pg_indexes WHERE schemaname = 'public'
UNION ALL
SELECT 'FUN ' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ') ' || md5(pg_get_functiondef(p.oid))
FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.prokind = 'f'
UNION ALL
SELECT 'TRG ' || tgrelid::regclass || ' ' || tgname || ' ' || md5(pg_get_triggerdef(oid)) FROM pg_trigger WHERE NOT tgisinternal AND tgrelid::regclass::text NOT LIKE '%.%'
UNION ALL
SELECT 'POL ' || tablename || ' ' || policyname || ' ' || cmd || ' ' || coalesce(qual, '') || ' ' || coalesce(with_check, '') FROM pg_policies WHERE schemaname = 'public'
UNION ALL
SELECT 'RLS ' || relname FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind = 'r' AND relrowsecurity
UNION ALL
SELECT 'VIEW ' || viewname || ' ' || md5(definition) FROM pg_views WHERE schemaname = 'public'
UNION ALL
SELECT 'EXT ' || extname FROM pg_extension
UNION ALL
SELECT 'GRT_TAB ' || table_name || ' ' || grantee || ' ' || privilege_type FROM information_schema.role_table_grants WHERE table_schema = 'public' AND grantee IN ('anon','authenticated')
UNION ALL
SELECT 'GRT_FUN ' || routine_name || ' ' || grantee FROM information_schema.routine_privileges WHERE routine_schema = 'public' AND grantee IN ('anon','authenticated','PUBLIC')
ORDER BY 1;
ROLLBACK;
```

2. Córrela contra ambas (es solo lectura: `BEGIN READ ONLY … ROLLBACK`; contra Producción está permitido):

```bash
"$PSQL" -w -q -d "$DEV_URL"  -f snapshot.sql < /dev/null > snap_dev.txt
"$PSQL" -w -q -d "$PROD_URL" -f snapshot.sql < /dev/null > snap_prod.txt
diff snap_prod.txt snap_dev.txt
```

3. Cómo leer el `diff`:
   - **Diferencias cosméticas esperadas (ignorar):** la forma en que Postgres reescribe algunos `CHECK`, y funciones
     creadas desde el SQL Editor de Producción que quedan con saltos `\r\n` (su `md5` difiere). Para confirmar que una
     función es igual, compara `pg_get_functiondef` sin espacios en blanco.
   - **Diferencias reales:** columna/índice/función que existe en un lado y no en el otro. Busca qué migración la crea
     (`grep -l <nombre> ../supabase/migrations/*.sql`) y en qué base falta. Si falta en Dev, aplícala (§5.2). Si falta
     en Producción, **avísale al usuario**; no la apliques tú.
   - Lo esperado tras tu trabajo: Dev = Producción + exactamente las migraciones nuevas que estás probando.

4. Historial: `npx supabase migration list --db-url "$DEV_URL"` debe listar las mismas versiones que hay en
   `supabase/migrations/` (todas `applied` en Dev).

---

## 7. Datos de Dev

### 7.1 Seed

```bash
cd app && npm run seed:dev
```

- Idempotente (busca cada entidad por nombre/correo fijo antes de crearla) y **aborta si la URL no es Dev**.
- Usa los services reales (`getOrCrearCentroCostoParaEntidad`, `createCuentaPagar`, `crearTransaccionSistema`…). INSERT
  crudo solo donde el módulo no tiene servicio: empleados, clientes, proveedores, proyecto/venta y factura borrador.
- Crea: 2 empleados, 2 clientes, 2 proveedores, una venta de Obra (proyecto 1) y una de Consultoría (proyecto 2)
  cerradas, presupuesto, 2 cuentas bancarias, cuentas por pagar (serie mensual + fraccionada) y por cobrar,
  transacciones enlazadas y una factura borrador.
- **No crea usuarios de Supabase Auth.** Para entrar a la app apuntando a Dev, el usuario tiene que crear uno en el
  dashboard de Dev (Authentication) y su fila en `empleados` con un rol.

### 7.2 Estado real de Dev

Dev **no está limpio**: tiene restos de corridas anteriores (`TEST-D`, `TEST-F`, `TEST-L`, transacciones "TEST fondeo
del proyecto" de 500 000). No asumas ids fijos salvo tras un reset; busca por nombre/tipo (como hacen los runners):

```js
const centros = (await call('listar_centros_costo', { limit: 500 })).data;
const obraC = centros.find((c) => c.tipo === 'proyecto' && c.id_proyecto === 1)?.id_centro_costo;
```

### 7.3 Reset de Dev (lo corre el usuario)

Un borrado masivo desde el agente fue bloqueado por el clasificador. Dale al usuario esto para el **SQL Editor de
Dev**:

```sql
TRUNCATE TABLE factura_detalle, factura, cobros, pagos, cuentas_cobrar, cuentas_pagar, transaccion,
  presupuesto, centro_costo, proyecto, proveedor, cliente, empleados, cuenta_banco RESTART IDENTITY CASCADE;
```

y luego `npm run seed:dev`. Con los ids reiniciados el seed es determinista (centros: empleados 1-2, clientes 3-4,
proveedores 5-6, proyectos 7-8).

### 7.4 Correr la app (UI) contra Dev

`npm run dev` usa `app/.env` (**Producción**). Para levantar la UI contra Dev: `npx vite dev --mode dev` (Vite carga
`.env` y encima `.env.dev`, que sobrescribe las variables de Supabase). Cuidado:
- Las variables `GOOGLE_DRIVE_*` siguen saliendo de `app/.env`: **subir archivos desde la UI en Dev los sube al Drive
  real**. No subas archivos en esa modalidad salvo que el usuario lo apruebe.
- Necesitas un usuario de Auth en Dev (§7.1).
- Esta vía no se ha usado aún de forma rutinaria; confirma en la consola del navegador que `PUBLIC_SUPABASE_URL`
  apunta a `hlfaxszecrxgkbjafepv` antes de tocar nada.

---

## 8. La lógica de los tests

Hay **cuatro niveles**, de más barato a más caro. Usa el más bajo que pruebe de verdad lo que cambiaste.

| Nivel | Qué prueba | Dónde vive | Cómo se corre | Toca la base |
|---|---|---|---|---|
| 1. Chequeo estático | Tipos, Svelte, que compile | — | `npm run check` (0 errores) y `npm run build` | No |
| 2. Unitarios | Funciones puras | `src/**/*.test.ts` (3 archivos, 31 tests) | `npx vitest run` | No |
| 3. Tests de negocio | Reglas de negocio de punta a punta por la capa de servicio | `scripts/tests-negocio-*.mjs` + `Documentacion/tests/*.md` | `npm run test:negocio*` | **Dev** |
| 4. Tests de integración puntuales | Una función de servicio o un componente concreto | Temporales (se borran) | vitest con config temporal | Dev o ninguna |

Además, la verificación manual en pantalla (navegador o app) es la única que prueba la UI de verdad. **Di siempre
qué nivel corriste y cuál no** ("probé la capa de servicio en Dev, no la pantalla", "no se probó en un celular real").

### 8.1 Nivel 1 — chequeo estático

```bash
cd app && npm run check     # svelte-check: debe dar 0 errores; los ~165 warnings son la línea base
npm run build               # vite build; las líneas que contienen "error" en el log suelen ser nombres de variables
```

Para saber si una advertencia es tuya: compara el conteo antes y después del cambio, o filtra por el archivo que tocaste
(`npm run check 2>&1 | grep -A3 MiArchivo.svelte`).

### 8.2 Nivel 3 — tests de negocio (las suites permanentes)

```bash
cd app
npm run seed:dev                       # requisito
npm run test:negocio                   # 40 casos  P-xx (Pagar) y C-xx (Cobrar)
npm run test:negocio:fraccionamiento   # 22 casos  F-xx (cambio de periodicidad a mitad de plan)
npm run test:negocio:lapiz             # 12 casos  L-xx (editar cuotas, montos desiguales)
```

Referencia (2026-09-25): 38/40 (los 2 FAIL son el hallazgo abierto H3), 21/22 + 1 INFO, 12/12.

**Cómo están construidos** (`scripts/tests-negocio-cuentas.mjs` es el modelo):

1. **Arrancan el servidor MCP de Dev como proceso hijo** (`node --env-file=.env.dev … mcp-server/index.ts`) y hablan
   JSON-RPC por stdio: `initialize` → `notifications/initialized` → `tools/call`. Así la prueba pasa exactamente por los
   mismos services que la UI, y el servidor solo expone escrituras si la URL es Dev (segunda guarda).
2. **Helpers:**
   - `call(name, args)` → `{ ok, data | error }` (`ok=false` si la herramienta devolvió `isError`).
   - `rec(id, titulo, pass, detalle)` imprime `PASS`/`FAIL`/`INFO` (`pass === true / false / null`).
3. **Fondeo:** antes de empezar crean una transacción de ingreso de 500 000 al centro del proyecto, porque los egresos
   validan el saldo del centro origen y tantas corridas lo vacían.
4. **Marcado:** todo lo creado lleva un prefijo en observación/descripción (`TEST-D`, `TEST-F`, `TEST-L`) para
   reconocerlo en Dev.
5. **Fechas fijas** (`const HOY = '2026-09-24'`) y aritmética en UTC: la zona horaria de la máquina no debe mover días.
6. **Auditorías acotadas a la corrida:** las herramientas `auditar_*` se llaman sobre los ids creados en esta corrida
   (≥ el primero creado), porque Dev trae restos viejos que podrían tener inconsistencias ajenas.
7. **Cada caso verifica el estado resultante leyéndolo de nuevo** (`ver_cuenta_*`), no la respuesta de la escritura.
   Ejemplo:

   ```js
   r = await call('registrar_pago_cuenta_pagar', { id_cuenta_pagar: p1, transaccion: trx(obraC, provC, 700) });
   v = await cuentaP(p1);
   rec('P-06', 'Pago que excede el saldo se rechaza y no altera la cuenta',
       !r.ok && v.cuenta.monto_pagado == 400, `respuesta=${r.ok ? 'ACEPTADO' : 'rechazado'} pagado=${v.cuenta.monto_pagado}`);
   ```

**Semántica de resultados:**
- **PASS** — el sistema hace lo que el negocio espera.
- **FAIL** — un **hallazgo** del sistema (acepta algo que no debería, deja datos inconsistentes). No se "arregla"
  cambiando la expectativa: se documenta en `Documentacion/tests/<modulo>.md` (sección Hallazgos, con impacto y arreglo
  sugerido) y en el resumen de `tests/README.md`.
- **INFO** — comportamiento correcto pero no obvio (regla de diseño) que hay que dejar escrita.
- **Antes de declarar un FAIL, descarta que el error sea del test** (pasó varias veces: un filtro por una columna que
  la base nunca guardaba). Lee el dato real con `mcp-call.mjs` o un script.
- **Cada hallazgo corregido deja un caso de regresión** que falla sin el arreglo (P-04 verifica que la transacción de un
  pago conserve `categoria`, el bug de `fn_crear_transaccion`).

**Añadir un caso o un módulo:**
1. Ubica el módulo y sus dependencias en [FlujoDeNegocio.md](FlujoDeNegocio.md).
2. Si falta una herramienta MCP para armar o verificar el escenario, créala (GuiaAgente §3.6), con una `auditar_*` si
   hay una invariante recalculable (p. ej. "saldo = monto − suma de pagos").
3. Añade el caso al runner con un **ID estable** y un título que diga qué se espera.
4. Formato del documento (`Documentacion/tests/<modulo>.md`): tabla `| ID | Caso | Resultado |` en estilo
   Dado/Cuando/Entonces, sección "Hallazgos", y tabla de "campos sospechosos/redundantes" del módulo.
5. Actualiza la tabla de módulos y el resumen de hallazgos en [tests/README.md](tests/README.md).
6. Módulos sin tests todavía: Transacciones, Centro de Costos, Cuentas Bancarias, Ventas, Facturación, Control
   Financiero (prioridad: Transacciones y Centro de Costos).

### 8.3 Nivel 4 — test de integración puntual con vitest (contra Dev)

Útil cuando cambiaste **una función de servicio** y quieres probarla con la base real sin escribir una suite
permanente. Se crea **dentro de `app/`** (vitest no resuelve `node_modules` ni `$lib` desde el scratchpad), se corre
y se borra.

```bash
cd app && mkdir -p src/__tmp
cat > vitest.tmp.config.ts <<'EOF'
import { defineConfig } from 'vitest/config';
import path from 'path';
export default defineConfig({
  resolve: { alias: { $lib: path.resolve(__dirname, 'src/lib') } },
  test: { environment: 'node', include: ['src/__tmp/**/*.test.ts'] },
});
EOF
# … escribe src/__tmp/<algo>.test.ts (plantilla abajo) …
node --env-file=.env.dev node_modules/vitest/vitest.mjs run --config vitest.tmp.config.ts
rm -rf src/__tmp vitest.tmp.config.ts      # SIEMPRE, pase o falle
```

Plantilla (real: así se probaron los hitos de cobro y el CHECK de `ticket.plataforma`):

```ts
import { test, expect } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { createCuentaCobrar, sincronizarCuotasProgramadas } from '$lib/modules/cuentas-cobrar/services/cuentasCobrar.service';

test('hito de cobro se guarda y se conserva al re-fraccionar (Dev)', async () => {
  const url = process.env.PUBLIC_SUPABASE_URL!;
  expect(url).toContain('hlfaxszecrxgkbjafepv');                 // 1) guarda: solo Dev
  const c = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  // 2) armar: tomar datos existentes en vez de suponer ids
  const { data: cc } = await c.from('centro_costo').select('id_centro_costo, id_cliente')
    .not('id_cliente', 'is', null).limit(1).single();

  // 3) actuar por la capa de servicio
  const r = await createCuentaCobrar(c, { /* … */ observaciones: 'PRUEBA HITO (borrar)' }, 'test',
    [{ fecha: '2026-12-01', monto: 700, hito: 'Entrega final' }, { fecha: '2026-11-01', monto: 300, hito: 'Firma de contrato' }]);
  expect(r.success, r.message).toBe(true);
  const id = r.data!.id_cuenta_cobrar;

  try {
    // 4) verificar leyendo de la base
    const leer = async () => (await c.from('cobros').select('fecha_cobro, hito').eq('id_cuenta_cobrar', id).order('fecha_cobro')).data!;
    expect((await leer()).map((x) => x.hito)).toEqual(['Firma de contrato', 'Entrega final']);
    // … más pasos …
  } finally {
    // 5) limpiar SOLO lo creado, por id, y comprobar que se borró
    await c.from('cobros').delete().eq('id_cuenta_cobrar', id);
    await c.from('cuentas_cobrar').delete().eq('id_cuenta_cobrar', id);
    expect((await c.from('cuentas_cobrar').select('id_cuenta_cobrar').eq('id_cuenta_cobrar', id)).data).toEqual([]);
  }
}, 60000);
```

Reglas de estos tests:
- La guarda va **primero**; el `finally` limpia **por id** lo que se creó (nunca un borrado por filtro amplio).
- Pasa el cliente con `service_role` a las funciones que reciben `client` como parámetro (la mayoría de los services
  del ERP lo aceptan). Si una función usa el cliente global de `supabaseClient.ts`, no funcionará en Node: pruébala
  vía MCP o en la UI.
- Para comprobar una **restricción de la base** (CHECK, UNIQUE, RLS), intenta la escritura inválida y espera el error
  por nombre: `expect(bad.error?.message).toMatch(/ticket_plataforma_check/)`.
- Si el test pasa y quieres conservarlo, conviértelo en un caso de una suite de negocio (§8.2) en vez de dejarlo en
  `src/` (los `*.test.ts` de `src/` corren en `npx vitest run` y no deben depender de la red).

### 8.4 Nivel 4 — test de componente Svelte (sin base)

Para un comportamiento de UI que no se ve en el chequeo estático (por ejemplo, que un desplegable se monte en `body`
y se quite al cerrar), monta el componente en **jsdom**. Igual que §8.3, en `src/__tmp/` con una config temporal, pero
con `environment: 'jsdom'` y el plugin de Svelte:

```ts
// vitest.tmp.config.ts
import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import path from 'path';
export default defineConfig({
  plugins: [svelte()],
  resolve: { alias: { $lib: path.resolve(__dirname, 'src/lib') }, conditions: ['browser'] },
  test: { environment: 'jsdom', include: ['src/__tmp/**/*.test.ts'] },
});
```

```ts
import { mount, unmount, flushSync } from 'svelte';
import SelectConSaldo from '$lib/shared/components/SelectConSaldo.svelte';
const host = document.createElement('div'); document.body.appendChild(host);
const cmp = mount(SelectConSaldo, { target: host, props: { /* … */ } });
host.querySelector('button')!.click(); flushSync();
// asserts sobre el DOM …
unmount(cmp);
```

`jsdom` ya está en `app/node_modules`. Borra config y carpeta al terminar. Aclara al reportar que jsdom **no** calcula layout (no prueba posiciones ni recortes
reales); eso se confirma en un navegador.

### 8.5 Tests de SQL (funciones, triggers, RLS)

Cuando la lógica vive en SQL (RPC `SECURITY DEFINER`, triggers, políticas):
- Escribe un `pruebas.sql` en el scratchpad que haga todo **dentro de una transacción y termine en `ROLLBACK`**, de
  modo que no deje rastro en Dev:

  ```sql
  BEGIN;
  -- simular un usuario autenticado y el header que manda la app
  SELECT set_config('request.jwt.claims', '{"sub":"<uuid de prueba>","role":"authenticated"}', true);
  SELECT set_config('request.headers', '{"x-auditoria-sesion":"<uuid>"}', true);
  SET LOCAL ROLE authenticated;
  -- … ejercitar la función / trigger y SELECT de verificación con un resultado legible …
  RESET ROLE;
  ROLLBACK;
  ```
- Para probar RLS: `SET LOCAL ROLE anon` / `authenticated` y comprobar que el SELECT devuelve 0 filas o falla con
  `42501`.
- Si Dev no responde, la alternativa usada para la auditoría fue un **Postgres 16 local temporal** (`initdb` +
  `pg_ctl` en `/c/Program Files/PostgreSQL/16/bin`, con stubs de `auth.uid()` y de las tablas necesarias), apagado y
  borrado al terminar. Documenta en el `.md` del módulo que se probó así y no en Dev.
- Ejemplo de casos documentados: [tests/auditoria.md](tests/auditoria.md) (AU-01 … AU-12).

---

## 9. Flujo completo de un cambio (checklist)

1. **Entender** el módulo: `FlujoDeNegocio.md`, el `*.service.ts`, su `config`, y el ticket (`mcp-call.mjs prod
   ver_ticket`).
2. **Comprobar Dev**: responde (§1), esquema igual a Producción (§6), seed presente (§7).
3. **Reproducir** el problema en Dev (herramienta MCP, script o test que falle).
4. **Corregir**: código y, si hace falta, migración nueva (§5.1) aplicada a Dev (§5.2), con el código tolerante a que
   la migración falte en Producción.
5. **Verificar**: `npm run check` (0 errores), `npx vitest run`, la suite `test:negocio*` del módulo si existe, y un test
   puntual (§8.3/§8.4) para lo nuevo. Repite la migración para confirmar idempotencia.
6. **Limpiar**: borra scripts `tmp_*`, `src/__tmp/`, `vitest.tmp.config.ts` y los datos de prueba que creaste por id.
   `git status` no debe mostrar archivos temporales ni `.env*`.
7. **Documentar**: `Documentacion/tests/<modulo>.md` y `tests/README.md` si hubo casos o hallazgos; la tabla de
   migraciones de [GuiaAgente.md §4.4](GuiaAgente.md); `FlujoDeNegocio.md` si cambió una regla.
8. **Entregar al usuario**: qué cambió, qué se probó y en qué nivel, qué **no** se probó (pantalla, celular real), y la
   lista ordenada de migraciones que debe correr en Producción antes o junto con el release.
9. **Tickets**: marcarlos como resueltos en Producción según [GuiaAgente.md §5.4](GuiaAgente.md), con un comentario
   honesto. No se commitea ni se hace push salvo que el usuario lo pida.

---

## 10. Problemas conocidos y su solución

| Síntoma | Causa | Qué hacer |
|---|---|---|
| Timeout / `could not translate host name` contra Dev | Proyecto Dev pausado, o se usó la conexión directa (solo IPv6) | Pedir al usuario que lo reactive; usar siempre la URL del pooler de `SUPABASE_DB_URL` |
| `psql` se queda colgado | Opciones después de la URL posicional / sin `< /dev/null` | `-d "$URL"`, `-w`, `< /dev/null`; matar el proceso con `taskkill` |
| `pg_dump: server version mismatch` | Cliente 16, servidor 17 | Usar el snapshot de catálogo (§6) |
| `supabase db push` falla en el pooler | Intermitente en este entorno | Aplicar con `psql` (§5.2) + `migration repair` |
| `supabase db dump`/`push`: "cannot find the file specified" | Docker Desktop apagado | Arrancarlo y esperar a que `docker info` responda |
| Columna nueva "no existe" vía API justo después de crearla | Caché de esquema de PostgREST | `NOTIFY pgrst, 'reload schema';` (va al final de cada migración) |
| `Cannot find package` / `$lib` no resuelve en un test | Config o test fuera de `app/` | Ponerlos en `app/src/__tmp/` y `app/vitest.tmp.config.ts` |
| Error al importar un service en Node (`$state`, `$derived`) | El service importa un `*.svelte.ts` con runas | Probar vía vitest (compila Svelte) o vía MCP |
| Lo que lee el script no coincide con lo que ve un usuario | `service_role` se salta RLS | Probar con `anon key` + usuario, o `SET ROLE` en SQL (§8.5) |
| Egreso rechazado por saldo en un test | El centro de costo origen se vació con corridas anteriores | Fondear antes con un ingreso (como los runners) |
| Una auditoría reporta inconsistencias en Dev que no son tuyas | Restos de corridas viejas | Acotar la auditoría a los ids creados en la corrida |
| Heredoc largo falla con "unexpected EOF" | Comillas mezcladas en Git Bash | Escribir el archivo con la herramienta de archivos y ejecutarlo |
| Comando bloqueado por el clasificador | Escritura a Producción o borrado masivo | No rodearlo; dar al usuario el comando exacto |

---

## 11. Referencias

- [GuiaAgente.md](GuiaAgente.md) — políticas generales, servidor MCP, estado de migraciones (§4.4), tickets (§5.4).
- [tests/README.md](tests/README.md) — suites de negocio, módulos cubiertos y hallazgos.
- [FlujoDeNegocio.md](FlujoDeNegocio.md) — orden de llenado del ERP y dependencias entre módulos.
- [AgentTools.md](AgentTools.md) — arquitectura de las herramientas MCP.
- [../supabase/migrations/README.md](../supabase/migrations/README.md) — convenciones de migraciones.
- Scripts: `app/scripts/mcp-call.mjs`, `seed-dev.mjs` + `seed-dev-main.mjs`, `tests-negocio-*.mjs`,
  `register-lib-resolver.mjs` + `lib-resolver.mjs`.
