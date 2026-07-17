@echo off
setlocal EnableDelayedExpansion
title Construni ERP - Tauri Build - Linux

rem -- colors (ANSI, native on Windows 10 1511+ / 11) ------------------------
for /F %%a in ('echo prompt $E^|cmd') do set "ESC=%%a"
set "C_CYAN=%ESC%[96m"
set "C_GREEN=%ESC%[92m"
set "C_YELLOW=%ESC%[93m"
set "C_GRAY=%ESC%[90m"
set "C_BOLD=%ESC%[1m"
set "C_RESET=%ESC%[0m"

set "PLATFORM_NAME=Linux (.deb / .rpm / .AppImage)"

call :banner

echo %C_BOLD%%C_YELLOW%[SKIP] No se puede compilar %PLATFORM_NAME% desde este equipo.%C_RESET%
echo.
echo %C_GRAY%  Motivo:%C_RESET%
echo   El bundler de Tauri para Linux necesita herramientas nativas de
echo   Linux ^(dpkg-deb, rpmbuild, appimagetool, librerias webkit2gtk,
echo   etc.^) que no existen en Windows. No hay cross-compilacion oficial
echo   soportada para esto.
echo.

where wsl >nul 2>&1
if errorlevel 1 goto :no_wsl
echo %C_GREEN%  [i] WSL detectado en este equipo.%C_RESET%
echo   Puedes intentar el build manualmente DENTRO de una distro WSL que
echo   tenga Node.js, Rust y las dependencias de sistema de Tauri para
echo   Linux ya instaladas ^(ver https://tauri.app -^> Prerequisites -^>
echo   Linux^). Este script no lo ejecuta automaticamente porque no puede
echo   garantizar que esas dependencias esten instaladas en tu distro.
echo     wsl
echo     cd /mnt/c/Users/.../ConstruniERP/app
echo     npm install ^&^& npm run tauri build
echo.
goto :after_wsl
:no_wsl
echo %C_GRAY%  [i] WSL no detectado en este equipo ^(wsl.exe no esta en PATH^).%C_RESET%
echo.
:after_wsl

echo %C_GRAY%  Alternativa recomendada:%C_RESET%
echo   Usar GitHub Actions con un runner "ubuntu-latest" y la accion
echo   oficial "tauri-apps/tauri-action" ^(build real, reproducible, sin
echo   depender de la configuracion del equipo local^). Pregunta si
echo   quieres que te genere el workflow .yml para esto.
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
