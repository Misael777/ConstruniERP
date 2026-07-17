@echo off
setlocal EnableDelayedExpansion
title Construni ERP - Tauri Build - Windows

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

set "PLATFORM_NAME=Windows Desktop (.exe / .msi)"
set "CHECKS_FAILED=0"

pushd "%~dp0..\.."
if errorlevel 1 (
    echo %C_RED%[X] No se pudo ubicar la carpeta del proyecto ^(app/^).%C_RESET%
    exit /b 1
)

call :banner

echo %C_BOLD%%C_CYAN%[1/4] Verificando entorno%C_RESET%
call :pbar "Detectando herramientas" 12
call :check_tool node "Node.js"
call :check_tool npm  "npm"
call :check_tool cargo "Rust (cargo)"
if !CHECKS_FAILED! GTR 0 (
    echo.
    echo %C_RED%[X] Faltan herramientas requeridas en el PATH. Aborta.%C_RESET%
    goto :fail
)
echo.

echo %C_BOLD%%C_CYAN%[2/4] Preparando dependencias%C_RESET%
if not exist "node_modules\" (
    echo   %C_YELLOW%[!]%C_RESET% node_modules no existe, ejecutando npm install...
    call npm install
    if errorlevel 1 goto :fail
) else (
    call :pbar "Dependencias ya instaladas" 10
)
echo.

echo %C_BOLD%%C_CYAN%[3/4] Compilando ^(npm run tauri build^)%C_RESET%
echo %C_GRAY%--------------------------------------------------------------%C_RESET%
set "T_START=%time%"
call npm run tauri build
set "BUILD_ERR=%errorlevel%"
set "T_END=%time%"
echo %C_GRAY%--------------------------------------------------------------%C_RESET%
call :timediff "%T_START%" "%T_END%" ELAPSED
echo.

echo %C_BOLD%%C_CYAN%[4/4] Resultado%C_RESET%
if not "!BUILD_ERR!"=="0" goto :fail

echo %C_GREEN%[OK] Build de Windows completado en !ELAPSED!.%C_RESET%
echo %C_GRAY%     Artefactos: src-tauri\target\release\bundle\%C_RESET%
popd
if not defined CI_MASTER_RUN pause
exit /b 0

:fail
echo %C_RED%[FALLO] El build de Windows no se completo correctamente.%C_RESET%
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

rem NOTE: deliberately goto-based, not if()else() - a display name containing
rem parentheses (e.g. "Rust (cargo)") substituted inside a parenthesized block
rem breaks cmd's parser ("was unexpected at this time"). goto sidesteps it.
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
