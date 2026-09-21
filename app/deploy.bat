@ECHO OFF
REM ============================================================
REM deploy.bat - un clic para publicar Windows (GitHub Releases) + Android (Drive) y cerrar los
REM tickets aprobados. Ver Documentacion/MecanismoCICD.md para el mecanismo completo.
REM
REM Uso:
REM   deploy.bat                -> patch (por defecto)
REM   deploy.bat minor
REM   deploy.bat major
REM
REM Este .bat solo pide confirmacion y llama a `npm run release` - TODO lo demas (gate de calidad, subir
REM la version, compilar el APK de Android en debug/arm64, compilar y firmar Windows, publicar, subir el
REM APK a Drive y cerrar los tickets) vive en scripts/release.mjs.
REM
REM IMPORTANTE (ticket #8): antes este .bat compilaba el APK ANTES de llamar a release.mjs, que recien
REM ahi subia la version - asi cada APK quedaba con la version anterior incrustada y quien lo instalaba
REM veia "actualizacion disponible" para siempre. Ahora el APK se compila DENTRO de release.mjs, despues
REM del bump, y ademas se verifica su version antes de publicar. No volver a compilarlo aca.
REM
REM Requiere (ver Documentacion/MecanismoCICD.md, seccion Secretos): app\.env con
REM TAURI_SIGNING_PRIVATE_KEY/_PASSWORD, PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
REM GOOGLE_DRIVE_*, y `gh` CLI instalado + logueado (`gh auth login`). Correrlo desde la misma terminal
REM donde compilas el APK a mano (necesita ANDROID_HOME, NDK_HOME y JAVA_HOME).
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
ECHO  Deploy ConstruniERP - Windows ^(GitHub Releases^) + Android ^(Drive^)
ECHO  Tipo de version: %BUMP%
ECHO ============================================================
ECHO.
ECHO Esto va a: subir la version, compilar el APK de Android ^(debug, arm64^),
ECHO compilar y FIRMAR el instalador de Windows, publicarlos en GitHub/Drive, y
ECHO cerrar los tickets aprobados vinculandolos a la version nueva. No se puede
ECHO deshacer facilmente una vez publicado. Si algo falla ANTES de publicar, la
ECHO version se revierte sola y basta con volver a correr este .bat.
ECHO.
SET /P CONFIRMAR="Continuar? (S/N): "
IF /I NOT "%CONFIRMAR%"=="S" (
	ECHO [deploy] Cancelado por el usuario.
	EXIT /B 0
)

ECHO.
ECHO [deploy] Publicando release (version + APK + Windows + tickets)...
CALL npm run release -- --%BUMP%
IF ERRORLEVEL 1 (
	ECHO [deploy] ERROR: fallo scripts/release.mjs - revisa el mensaje de arriba.
	EXIT /B 1
)

ECHO.
ECHO [deploy] Listo.
ENDLOCAL
PAUSE
