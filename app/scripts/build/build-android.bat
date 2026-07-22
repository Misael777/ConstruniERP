@echo off
setlocal EnableDelayedExpansion
title Construni ERP - Tauri Build - Android

rem -- colors (ANSI, native on Windows 10 1511+ / 11) ------------------------
for /F %%a in ('echo prompt $E^|cmd') do set "ESC=%%a"
set "CLR_LINE=%ESC%[2K%ESC%[0G"
set "C_CYAN=%ESC%[96m"
set "C_GREEN=%ESC%[92m"
set "C_RED=%ESC%[91m"
set "C_YELLOW=%ESC%[93m"
set "C_GRAY=%ESC%[90m"
set "C_BOLD=%ESC%[1m"
set "C_RESET=%ESC%[0m"

set "PLATFORM_NAME=Android (.apk / .aab)"
set "CHECKS_FAILED=0"

rem -- modo de build: "debug" (firmado con keystore de debug, instalable directo
rem    para pruebas en telefono) o release (default, sin firmar, para Play Store
rem    una vez configurada la keystore de firma). Uso: build-android.bat [debug]
set "BUILD_MODE=release"
set "BUILD_ARGS="
if /I "%~1"=="debug" (
    set "BUILD_MODE=debug"
    set "BUILD_ARGS=-- --debug"
)

pushd "%~dp0..\.."
if errorlevel 1 (
    echo %C_RED%[X] No se pudo ubicar la carpeta del proyecto ^(app/^).%C_RESET%
    exit /b 1
)

call :banner

echo %C_BOLD%%C_CYAN%[1/5] Verificando entorno%C_RESET%
call :pbar "Detectando herramientas" 12
call :check_tool node "Node.js"
call :check_tool npm  "npm"
call :check_tool cargo "Rust (cargo)"
call :check_tool java "JDK (java)"
call :check_env JAVA_HOME "JAVA_HOME"
call :check_env ANDROID_HOME "ANDROID_HOME"
if !CHECKS_FAILED! GTR 0 (
    echo.
    echo %C_RED%[X] Faltan herramientas o variables de entorno requeridas. Aborta.%C_RESET%
    echo %C_GRAY%    Instala Android Studio / SDK y define ANDROID_HOME y JAVA_HOME.%C_RESET%
    goto :fail
)
echo.

echo %C_BOLD%%C_CYAN%[2/5] Preparando dependencias%C_RESET%
if not exist "node_modules\" (
    echo   %C_YELLOW%[!]%C_RESET% node_modules no existe, ejecutando npm install...
    call npm install
    if errorlevel 1 goto :fail
) else (
    call :pbar "Dependencias ya instaladas" 10
)
echo.

echo %C_BOLD%%C_CYAN%[3/5] Proyecto Android%C_RESET%
if exist "src-tauri\gen\android\" (
    call :pbar "Proyecto Android ya inicializado" 8
) else (
    echo   %C_YELLOW%[!]%C_RESET% src-tauri\gen\android no existe, ejecutando tauri android init...
    call npm run tauri android init
    if errorlevel 1 goto :fail
)
echo.

echo %C_BOLD%%C_CYAN%[4/5] Compilando ^(modo: %BUILD_MODE%^)%C_RESET%
if "%BUILD_MODE%"=="debug" (
    echo %C_GRAY%    npm run tauri android build -- --debug%C_RESET%
) else (
    echo %C_GRAY%    npm run tauri android build%C_RESET%
    echo %C_YELLOW%    [!]%C_RESET% APK release queda SIN FIRMAR ^(no instalable hasta configurar
    echo %C_GRAY%        una keystore^). Para probar en un telefono usa: build-android.bat debug%C_RESET%
)
echo %C_GRAY%--------------------------------------------------------------%C_RESET%
set "T_START=%time%"
call npm run tauri android build %BUILD_ARGS%
set "BUILD_ERR=%errorlevel%"
set "T_END=%time%"
echo %C_GRAY%--------------------------------------------------------------%C_RESET%
call :timediff "%T_START%" "%T_END%" ELAPSED
echo.

echo %C_BOLD%%C_CYAN%[5/5] Resultado%C_RESET%
if not "!BUILD_ERR!"=="0" goto :fail

echo %C_GREEN%[OK] Build de Android ^(%BUILD_MODE%^) completado en !ELAPSED!.%C_RESET%
if "%BUILD_MODE%"=="debug" (
    echo %C_GRAY%     APK: src-tauri\gen\android\app\build\outputs\apk\universal\debug\app-universal-debug.apk%C_RESET%
    echo %C_GRAY%     ^(firmado con keystore de debug, listo para instalar^)%C_RESET%
) else (
    echo %C_GRAY%     APK: src-tauri\gen\android\app\build\outputs\apk\universal\release\app-universal-release-unsigned.apk%C_RESET%
    echo %C_GRAY%     ^(SIN FIRMAR - no instalable hasta configurar una keystore de firma^)%C_RESET%
)
popd
if not defined CI_MASTER_RUN pause
exit /b 0

:fail
echo %C_RED%[FALLO] El build de Android no se completo correctamente.%C_RESET%
popd
if not defined CI_MASTER_RUN pause
exit /b 1

rem -- subroutines -------------------------------------------------------
:banner
echo %C_CYAN%====================================================================%C_RESET%
echo %C_BOLD%  CONSTRUNI ERP  -  TAURI MULTI-PLATFORM BUILDER%C_RESET%
echo %C_CYAN%  Plataforma objetivo:%C_RESET% %C_BOLD%%PLATFORM_NAME%%C_RESET%
echo %C_CYAN%====================================================================%C_RESET%
echo.
exit /b 0

rem NOTE: deliberately goto-based, not if()else() - a display name or path
rem containing parentheses (e.g. "Program Files (x86)") substituted inside a
rem parenthesized block breaks cmd's parser ("was unexpected at this time").
:check_tool
where %~1 >nul 2>&1
if errorlevel 1 goto :check_tool_missing
set "_CT_VER="
for /f "delims=" %%v in ('%~1 --version 2^>nul') do if not defined _CT_VER set "_CT_VER=%%v"
echo   %C_GREEN%[OK]%C_RESET%    %~2  %C_GRAY%!_CT_VER!%C_RESET%
set "_CT_VER="
exit /b 0
:check_tool_missing
echo   %C_RED%[FALTA]%C_RESET% %~2 no encontrado en PATH
set /a "CHECKS_FAILED+=1"
exit /b 0

:check_env
if not defined %~1 goto :check_env_missing
echo   %C_GREEN%[OK]%C_RESET%    %~2  %C_GRAY%=  !%~1!%C_RESET%
exit /b 0
:check_env_missing
echo   %C_RED%[FALTA]%C_RESET% %~2 no esta definida
set /a "CHECKS_FAILED+=1"
exit /b 0

:pbar
set "_PB_LBL=%~1"
set "_PB_STEPS=%~2"
if "%_PB_STEPS%"=="" set "_PB_STEPS=15"
set "_PB_WIDTH=30"
for /L %%p in (1,1,%_PB_STEPS%) do (
    set /a "_PB_FILLED=%%p*_PB_WIDTH/_PB_STEPS"
    set "_PB_BAR="
    for /L %%f in (1,1,!_PB_FILLED!) do set "_PB_BAR=!_PB_BAR!#"
    set /a "_PB_EMPTY=_PB_WIDTH-_PB_FILLED"
    for /L %%e in (1,1,!_PB_EMPTY!) do set "_PB_BAR=!_PB_BAR!."
    set /a "_PB_PCT=%%p*100/_PB_STEPS"
    <nul set /p "=!CLR_LINE!  %C_CYAN%!_PB_LBL! [!_PB_BAR!] !_PB_PCT!%%!C_RESET!"
    ping -n 1 -w 60 127.0.0.1 >nul
)
echo.
set "_PB_LBL=" & set "_PB_STEPS=" & set "_PB_WIDTH=" & set "_PB_FILLED=" & set "_PB_BAR=" & set "_PB_EMPTY=" & set "_PB_PCT="
exit /b 0

:timediff
set "_TD_T1=%~1"
set "_TD_T2=%~2"
for /f "tokens=1-4 delims=:.," %%a in ("%_TD_T1%") do set /a "_TD_S1=(((1%%a-100)*60+(1%%b-100))*60+(1%%c-100))*100+(1%%d-100)" 2>nul
for /f "tokens=1-4 delims=:.," %%a in ("%_TD_T2%") do set /a "_TD_S2=(((1%%a-100)*60+(1%%b-100))*60+(1%%c-100))*100+(1%%d-100)" 2>nul
if not defined _TD_S1 (set "%~3=N/D" & exit /b 0)
if not defined _TD_S2 (set "%~3=N/D" & exit /b 0)
set /a "_TD_DIFF=_TD_S2-_TD_S1"
if !_TD_DIFF! lss 0 set /a "_TD_DIFF+=8640000"
set /a "_TD_MM=_TD_DIFF/6000"
set /a "_TD_SS=(_TD_DIFF/100)%%60"
set "%~3=!_TD_MM!m !_TD_SS!s"
set "_TD_T1=" & set "_TD_T2=" & set "_TD_S1=" & set "_TD_S2=" & set "_TD_DIFF=" & set "_TD_MM=" & set "_TD_SS="
exit /b 0
