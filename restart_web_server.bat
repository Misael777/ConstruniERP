@echo off
setlocal enabledelayedexpansion

echo ============================================
echo  ConstruniERP - Reiniciar servidor de desarrollo
echo ============================================
echo.

REM 1. Matar cualquier proceso escuchando en el puerto 5173 (el dev server de Vite)
echo Buscando procesos en el puerto 5173...
set FOUND=0
for /f "tokens=5" %%P in ('netstat -ano ^| findstr ":5173" ^| findstr "LISTENING"') do (
    echo Matando proceso PID %%P...
    taskkill /PID %%P /F >nul 2>&1
    set FOUND=1
)
if "!FOUND!"=="0" (
    echo No habia ningun proceso escuchando en el puerto 5173.
) else (
    echo Proceso^(s^) terminado^(s^).
)
echo.

REM 2. Limpiar el cache de SvelteKit/Vite (borra .svelte-kit dentro de app\)
echo Limpiando cache ^(app\.svelte-kit^)...
cd /d "%~dp0app"
if exist ".svelte-kit" (
    rmdir /s /q ".svelte-kit"
    echo Cache eliminado.
) else (
    echo No habia cache que limpiar.
)
echo.

REM 3. Iniciar el servidor de desarrollo de nuevo
echo Iniciando "npm run dev"...
echo ^(Deja esta ventana abierta - cerrarla detiene el servidor^)
echo.
call npm run dev

endlocal
