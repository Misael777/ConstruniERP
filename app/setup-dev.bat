@ECHO OFF
REM ============================================================
REM setup-dev.bat - prepara una PC Windows para trabajar con la base de DESARROLLO (Dev) de ConstruniERP:
REM tests de negocio, seed, migraciones a Dev y el servidor MCP de Dev. Ver Documentacion/GuiaDevYTests.md.
REM
REM Uso (desde una terminal normal, en la carpeta app\ del repo ya clonado):
REM   setup-dev.bat                          -> pide la ruta del archivo .env.dev si no existe
REM   setup-dev.bat "D:\ruta\a\.env.dev"     -> copia ese archivo como app\.env.dev
REM
REM Instala (con winget, solo lo que falte):
REM   - Node.js LTS (minimo 22: los scripts usan --env-file y --experimental-strip-types)
REM   - Git (trae Git Bash, el shell que usan los comandos de la guia)
REM   - Herramientas de linea de comandos de PostgreSQL 17 (psql y pg_dump, misma version que Dev y Prod;
REM     SIN el servidor de base de datos)
REM y luego: dependencias npm de app\, Supabase CLI (via npx) y una prueba de conexion a Dev.
REM
REM Credenciales: app\.env.dev NO esta en git (es secreto). Pasalo por un canal seguro (gestor de
REM contrasenas, USB), nunca por chat ni correo. Este script NUNCA crea ni toca app\.env (Produccion).
REM Docker Desktop es opcional (solo para `supabase db dump`/`db push`); no se instala aca.
REM ============================================================

SETLOCAL
cd /d "%~dp0"
SET "DEV_REF=hlfaxszecrxgkbjafepv"
SET "PGBIN=C:\Program Files\PostgreSQL\17\bin"

ECHO ============================================================
ECHO  ConstruniERP - preparar esta PC para la base Dev (%DEV_REF%)
ECHO ============================================================
ECHO.

IF NOT EXIST "package.json" (
	ECHO [setup] Este .bat debe estar en la carpeta app\ del repo ^(no se encontro package.json^).
	GOTO :fallo
)

WHERE winget >NUL 2>&1
IF ERRORLEVEL 1 (
	ECHO [setup] No se encontro winget. Instala "App Installer" desde Microsoft Store y vuelve a correr esto.
	GOTO :fallo
)

REM ---------- 1. Node.js ----------
WHERE node >NUL 2>&1
IF ERRORLEVEL 1 (
	ECHO [setup] Instalando Node.js LTS...
	winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
	SET "PATH=%PATH%;C:\Program Files\nodejs"
)
WHERE node >NUL 2>&1
IF ERRORLEVEL 1 (
	ECHO [setup] Node.js se instalo pero esta terminal aun no lo ve. Cierra la terminal, abre una nueva y vuelve a correr setup-dev.bat.
	GOTO :fallo
)
FOR /F "tokens=1 delims=." %%V IN ('node --version') DO SET "NODE_MAJOR=%%V"
SET "NODE_MAJOR=%NODE_MAJOR:v=%"
IF %NODE_MAJOR% LSS 22 (
	ECHO [setup] Node.js v%NODE_MAJOR% es muy antiguo ^(se necesita 22 o mas^). Actualizando...
	winget upgrade -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
	ECHO [setup] Cierra la terminal, abre una nueva y vuelve a correr setup-dev.bat.
	GOTO :fallo
)
ECHO [setup] Node.js OK ^(v%NODE_MAJOR%^)

REM ---------- 2. Git ----------
WHERE git >NUL 2>&1
IF ERRORLEVEL 1 (
	ECHO [setup] Instalando Git...
	winget install -e --id Git.Git --accept-source-agreements --accept-package-agreements
) ELSE (
	ECHO [setup] Git OK
)

REM ---------- 3. Cliente de PostgreSQL 17 ----------
IF EXIST "%PGBIN%\psql.exe" (
	ECHO [setup] psql 17 OK
) ELSE (
	ECHO [setup] Instalando las herramientas de PostgreSQL 17 ^(solo cliente, sin servidor^)...
	winget install -e --id PostgreSQL.PostgreSQL.17 --accept-source-agreements --accept-package-agreements --override "--mode unattended --unattendedmodeui minimal --disable-components server,pgAdmin,stackbuilder"
	IF NOT EXIST "%PGBIN%\psql.exe" (
		ECHO [setup] AVISO: no se encontro "%PGBIN%\psql.exe". psql es opcional ^(aplicar migraciones a Dev^); el resto funciona sin el.
	)
)

REM ---------- 4. Credenciales de Dev ----------
IF EXIST ".env.dev" (
	ECHO [setup] app\.env.dev ya existe; no se modifica.
) ELSE (
	SET "ORIGEN=%~1"
	IF "%~1"=="" SET /P "ORIGEN=Ruta del archivo .env.dev que te pasaron (arrastralo aqui y Enter): "
	CALL :copiar_env
	IF ERRORLEVEL 1 GOTO :fallo
)
findstr /C:"%DEV_REF%" ".env.dev" >NUL 2>&1
IF ERRORLEVEL 1 (
	ECHO [setup] SEGURIDAD: app\.env.dev no menciona el proyecto Dev ^(%DEV_REF%^). Revisa que no sea el de Produccion.
	GOTO :fallo
)

REM ---------- 5. Dependencias npm y Supabase CLI ----------
ECHO [setup] Instalando dependencias npm de app\ ^(puede tardar unos minutos^)...
CALL npm install
IF ERRORLEVEL 1 GOTO :fallo
ECHO [setup] Descargando Supabase CLI ^(npx^)...
CALL npx -y supabase --version
IF ERRORLEVEL 1 ECHO [setup] AVISO: no se pudo descargar Supabase CLI; reintenta luego con: npx -y supabase --version

REM ---------- 6. Pruebas de conexion a Dev ----------
ECHO.
ECHO [setup] Probando la API de Supabase Dev...
node --env-file=.env.dev scripts/verificar-dev.mjs
IF ERRORLEVEL 1 GOTO :fallo

IF EXIST "%PGBIN%\psql.exe" (
	ECHO [setup] Probando la conexion Postgres a Dev con psql...
	FOR /F "tokens=1,* delims==" %%A IN ('findstr /B /C:"SUPABASE_DB_URL=" ".env.dev"') DO (
		"%PGBIN%\psql.exe" -w -q -A -t -d "%%B" -c "select 'psql OK: ' || current_database() || ' / ' || split_part(version(), ' ', 2);" < NUL
	)
	IF ERRORLEVEL 1 ECHO [setup] AVISO: psql no pudo conectar. Revisa SUPABASE_DB_URL ^(debe ser la del Session pooler^).
)

ECHO [setup] Probando el servidor MCP de Dev...
CALL node scripts/mcp-call.mjs dev "[{\"name\":\"listar_centros_costo\",\"arguments\":{\"limit\":1}}]" >NUL
IF ERRORLEVEL 1 (
	ECHO [setup] AVISO: el servidor MCP de Dev no respondio. Prueba a mano: node scripts/mcp-call.mjs dev list
) ELSE (
	ECHO [setup] MCP de Dev OK
)

ECHO.
ECHO ============================================================
ECHO  Listo. Esta PC puede usar la base Dev.
ECHO.
ECHO  Siguientes pasos (desde app\):
ECHO    npm run seed:dev                -^> datos sinteticos base
ECHO    npm run test:negocio            -^> tests de negocio contra Dev
ECHO    node scripts/mcp-call.mjs dev list
ECHO.
ECHO  Opcional - registrar el MCP de Dev en Claude Code (desde la raiz del repo):
ECHO    claude mcp add construnierp-dev -- npm --prefix app run mcp:dev
ECHO.
ECHO  Guia completa: Documentacion\GuiaDevYTests.md
ECHO ============================================================
ENDLOCAL
EXIT /B 0

:copiar_env
SET "ORIGEN=%ORIGEN:"=%"
IF "%ORIGEN%"=="" (
	ECHO [setup] No se indico el archivo .env.dev. Pideselo al responsable del proyecto.
	EXIT /B 1
)
IF NOT EXIST "%ORIGEN%" (
	ECHO [setup] No existe: %ORIGEN%
	EXIT /B 1
)
COPY /Y "%ORIGEN%" ".env.dev" >NUL
ECHO [setup] Copiado a app\.env.dev ^(git lo ignora; no lo subas a ningun lado^).
EXIT /B 0

:fallo
ECHO.
ECHO [setup] Se detuvo. Corrige lo indicado arriba y vuelve a correr setup-dev.bat.
ENDLOCAL
EXIT /B 1
