@echo off
setlocal EnableDelayedExpansion
title Construni ERP - Tauri Build - iOS

rem -- colors (ANSI, native on Windows 10 1511+ / 11) ------------------------
for /F %%a in ('echo prompt $E^|cmd') do set "ESC=%%a"
set "C_CYAN=%ESC%[96m"
set "C_YELLOW=%ESC%[93m"
set "C_GRAY=%ESC%[90m"
set "C_BOLD=%ESC%[1m"
set "C_RESET=%ESC%[0m"

set "PLATFORM_NAME=iOS (.ipa)"

call :banner

echo %C_BOLD%%C_YELLOW%[SKIP] No se puede compilar %PLATFORM_NAME% desde este equipo.%C_RESET%
echo.
echo %C_GRAY%  Motivo:%C_RESET%
echo   El build de iOS depende de Xcode y del "xcodebuild" de Apple, que
echo   solo existen en macOS. El propio CLI de Tauri rechaza "tauri ios
echo   build" en un host Windows, asi que ni siquiera se intenta aqui.
echo.
echo %C_GRAY%  Alternativas recomendadas:%C_RESET%
echo   1. Compilar en un Mac con Xcode instalado:
echo        npm install ^&^& npm run tauri ios build
echo   2. Usar GitHub Actions con un runner "macos-latest" y la accion
echo      oficial "tauri-apps/tauri-action". Pregunta si quieres que te
echo      genere el workflow .yml para esto.
echo.

if not defined CI_MASTER_RUN pause
exit /b 2

:banner
echo %C_CYAN%====================================================================%C_RESET%
echo %C_BOLD%  CONSTRUNI ERP  -  TAURI MULTI-PLATFORM BUILDER%C_RESET%
echo %C_CYAN%  Plataforma objetivo:%C_RESET% %C_BOLD%%PLATFORM_NAME%%C_RESET%
echo %C_CYAN%====================================================================%C_RESET%
echo.
exit /b 0
