@ECHO OFF
REM ============================================================
REM deploy.bat — un clic para publicar Windows (GitHub Releases) + Android (Drive) y cerrar los
REM tickets aprobados. Ver Documentacion/MecanismoCICD.md para el mecanismo completo.
REM
REM Uso:
REM   deploy.bat                -> patch (por defecto)
REM   deploy.bat minor
REM   deploy.bat major
REM
REM Qué hace, en orden (se detiene si cualquier paso falla):
REM   1. Compila el APK de Android (debug) con `npm run tauri android build -- --debug --target aarch64`.
REM      Solo arm64 (cubre prácticamente cualquier Android real de los últimos ~8 años, incluido el del
REM      cliente) en vez del "universal" (las 4 arquitecturas juntas, ~794MB en una prueba real — mucho
REM      más lento de compilar/subir/descargar y probablemente la causa real de un ENOBUFS visto en un
REM      deploy real al subir un archivo tan grande a Drive).
REM   2. Busca el .apk recién generado bajo src-tauri\gen\android\...\outputs\apk\ (el nombre/carpeta
REM      exacta depende de tu config de Gradle — se toma el más reciente, no un nombre fijo).
REM   3. Corre `npm run release -- --<bump> --apk "<ese .apk>"` — ese script hace TODO lo demás:
REM      gate de calidad, build+firma de Windows, publica en GitHub Releases, sube el APK a Drive,
REM      y cierra los tickets aprobados vinculándolos a la versión nueva.
REM
REM Requiere (ver Documentacion/MecanismoCICD.md, sección Secretos): app\.env con
REM TAURI_SIGNING_PRIVATE_KEY/_PASSWORD, PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
REM GOOGLE_DRIVE_*, y `gh` CLI instalado + logueado (`gh auth login`).
REM ============================================================

SETLOCAL ENABLEDELAYEDEXPANSION
cd /d "%~dp0"

SET BUMP=%1
IF "%BUMP%"=="" SET BUMP=patch
IF NOT "%BUMP%"=="patch" IF NOT "%BUMP%"=="minor" IF NOT "%BUMP%"=="major" (
	ECHO [deploy] Argumento invalido: "%BUMP%" ^(usa patch, minor o major^)
	EXIT /B 1
)

ECHO ============================================================
ECHO  Deploy ConstruniERP — Windows ^(GitHub Releases^) + Android ^(Drive^)
ECHO  Tipo de version: %BUMP%
ECHO ============================================================
ECHO.
ECHO Esto va a: compilar el APK de Android, compilar y FIRMAR el instalador de
ECHO Windows, publicarlos en GitHub/Drive, y cerrar los tickets aprobados
ECHO vinculandolos a la version nueva. No se puede deshacer facilmente una vez
ECHO publicado.
ECHO.
SET /P CONFIRMAR="Continuar? (S/N): "
IF /I NOT "%CONFIRMAR%"=="S" (
	ECHO [deploy] Cancelado por el usuario.
	EXIT /B 0
)

ECHO.
ECHO [deploy] Paso 1/3 — Compilando APK de Android (debug, solo arm64)...
CALL npm run tauri android build -- --debug --target aarch64
IF ERRORLEVEL 1 (
	ECHO [deploy] ERROR: fallo la compilacion de Android. Se aborta antes de tocar Windows/GitHub/Drive.
	EXIT /B 1
)

ECHO.
ECHO [deploy] Paso 2/3 — Buscando el .apk recien generado...
REM Nota: se usa PowerShell para ordenar por fecha (probado): `dir /s /o-d` NO ordena de forma
REM confiable entre subcarpetas (ordena por carpeta, no globalmente) y podia elegir un .apk viejo
REM de otra variante/arquitectura en vez del que se acaba de compilar.
SET APK_PATH=
FOR /F "delims=" %%F IN ('powershell -NoProfile -Command "Get-ChildItem -Path 'src-tauri\gen\android\app\build\outputs\apk' -Recurse -Filter '*debug*.apk' -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1 -ExpandProperty FullName"') DO SET APK_PATH=%%F
IF "%APK_PATH%"=="" (
	ECHO [deploy] ERROR: no se encontro ningun .apk bajo src-tauri\gen\android\app\build\outputs\apk\
	ECHO [deploy] Revisa que el build de Android haya terminado bien, o ajusta la busqueda en este .bat
	ECHO [deploy] si tu proyecto de Android genera el APK en otra carpeta.
	EXIT /B 1
)
ECHO [deploy] APK encontrado: %APK_PATH%

ECHO.
ECHO [deploy] Paso 3/3 — Publicando release (Windows + Android + tickets)...
CALL npm run release -- --%BUMP% --apk "%APK_PATH%"
IF ERRORLEVEL 1 (
	ECHO [deploy] ERROR: fallo scripts/release.mjs — revisa el mensaje de arriba.
	EXIT /B 1
)

ECHO.
ECHO [deploy] Listo.
ENDLOCAL
PAUSE
