@echo off
setlocal EnableDelayedExpansion
title Construni ERP - Tauri Build - Todas las plataformas

rem -- colors (ANSI, native on Windows 10 1511+ / 11) ------------------------
for /F %%a in ('echo prompt $E^|cmd') do set "ESC=%%a"
set "C_CYAN=%ESC%[96m"
set "C_GREEN=%ESC%[92m"
set "C_RED=%ESC%[91m"
set "C_YELLOW=%ESC%[93m"
set "C_GRAY=%ESC%[90m"
set "C_BOLD=%ESC%[1m"
set "C_RESET=%ESC%[0m"

rem Sub-scripts must not pause on their own - only this master script pauses,
rem once, at the very end.
set "CI_MASTER_RUN=1"

echo %C_CYAN%====================================================================%C_RESET%
echo %C_BOLD%  CONSTRUNI ERP  -  TAURI MULTI-PLATFORM BUILDER%C_RESET%
echo %C_CYAN%  Modo: build de TODAS las plataformas soportadas%C_RESET%
echo %C_CYAN%====================================================================%C_RESET%
echo   1. Windows   (nativo - build real)
echo   2. Android   (nativo - build real)
echo   3. macOS     (requiere host macOS - informativo)
echo   4. iOS       (requiere host macOS - informativo)
echo   5. Linux     (requiere host Linux/WSL - informativo)
echo.

set "R_WIN=?" & set "R_AND=?" & set "R_MAC=?" & set "R_IOS=?" & set "R_LIN=?"
set "T_WIN=" & set "T_AND=" & set "T_MAC=" & set "T_IOS=" & set "T_LIN="

echo.
echo %C_BOLD%%C_CYAN%^>^>^> [1/5] WINDOWS%C_RESET%
set "T_START=%time%"
call "%~dp0build-windows.bat"
set "R_WIN=%errorlevel%"
set "T_END=%time%"
call :timediff "%T_START%" "%T_END%" T_WIN

echo.
echo %C_BOLD%%C_CYAN%^>^>^> [2/5] ANDROID%C_RESET%
set "T_START=%time%"
call "%~dp0build-android.bat"
set "R_AND=%errorlevel%"
set "T_END=%time%"
call :timediff "%T_START%" "%T_END%" T_AND

echo.
echo %C_BOLD%%C_CYAN%^>^>^> [3/5] MACOS%C_RESET%
call "%~dp0build-macos.bat"
set "R_MAC=%errorlevel%"

echo.
echo %C_BOLD%%C_CYAN%^>^>^> [4/5] IOS%C_RESET%
call "%~dp0build-ios.bat"
set "R_IOS=%errorlevel%"

echo.
echo %C_BOLD%%C_CYAN%^>^>^> [5/5] LINUX%C_RESET%
call "%~dp0build-linux.bat"
set "R_LIN=%errorlevel%"

echo.
echo %C_CYAN%====================================================================%C_RESET%
echo %C_BOLD%  RESUMEN DE BUILD MULTIPLATAFORMA%C_RESET%
echo %C_CYAN%====================================================================%C_RESET%
call :result_line "Windows" "!R_WIN!" "!T_WIN!"
call :result_line "Android" "!R_AND!" "!T_AND!"
call :result_line "macOS  " "!R_MAC!" ""
call :result_line "iOS    " "!R_IOS!" ""
call :result_line "Linux  " "!R_LIN!" ""
echo %C_CYAN%====================================================================%C_RESET%
echo %C_GRAY%  Artefactos Windows: src-tauri\target\release\bundle\%C_RESET%
echo %C_GRAY%  Artefactos Android: src-tauri\gen\android\app\build\outputs\%C_RESET%
echo %C_CYAN%====================================================================%C_RESET%

set "OVERALL_FAIL=0"
if "!R_WIN!"=="1" set "OVERALL_FAIL=1"
if "!R_AND!"=="1" set "OVERALL_FAIL=1"

pause
if "!OVERALL_FAIL!"=="1" exit /b 1
exit /b 0

rem -- subroutines -------------------------------------------------------
:result_line
set "_RL_NAME=%~1"
set "_RL_CODE=%~2"
set "_RL_TIME=%~3"
if "%_RL_CODE%"=="0" goto :result_ok
if "%_RL_CODE%"=="2" goto :result_skip
goto :result_fail
:result_ok
echo   %C_GREEN%[OK]  %C_RESET%  !_RL_NAME!    !_RL_TIME!
exit /b 0
:result_skip
echo   %C_YELLOW%[SKIP]%C_RESET%  !_RL_NAME!    (host no compatible, ver detalle arriba)
exit /b 0
:result_fail
echo   %C_RED%[FALLO]%C_RESET%  !_RL_NAME!    (ver detalle arriba)
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
