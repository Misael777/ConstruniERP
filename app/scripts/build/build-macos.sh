#!/usr/bin/env bash
# Real macOS build (produces .app / .dmg via npm run tauri build).
# Must run on an actual Mac with Xcode Command Line Tools, Node.js and Rust
# installed - this is NOT a cross-compiler, it just wraps the real build with
# the same banner/checks/progress-bar treatment as the Windows .bat scripts.
set -uo pipefail

if [ -t 1 ]; then
    C_CYAN=$'\033[96m'
    C_GREEN=$'\033[92m'
    C_RED=$'\033[91m'
    C_YELLOW=$'\033[93m'
    C_GRAY=$'\033[90m'
    C_BOLD=$'\033[1m'
    C_RESET=$'\033[0m'
else
    C_CYAN=""; C_GREEN=""; C_RED=""; C_YELLOW=""; C_GRAY=""; C_BOLD=""; C_RESET=""
fi

PLATFORM_NAME="macOS Desktop (.app / .dmg)"
CHECKS_FAILED=0

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$APP_DIR" || { echo "${C_RED}[X] No se pudo ubicar la carpeta del proyecto (app/).${C_RESET}"; exit 1; }

pause_unless_master() {
    if [ -z "${CI_MASTER_RUN:-}" ]; then
        read -rp "Presiona Enter para salir..." _
    fi
}

banner() {
    echo "${C_CYAN}====================================================================${C_RESET}"
    echo "${C_BOLD}  CONSTRUNI ERP  -  TAURI MULTI-PLATFORM BUILDER${C_RESET}"
    echo "${C_CYAN}  Plataforma objetivo:${C_RESET} ${C_BOLD}${PLATFORM_NAME}${C_RESET}"
    echo "${C_CYAN}====================================================================${C_RESET}"
    echo
}

pbar() {
    local label="$1" steps="${2:-15}" width=30
    local p filled empty bar pct
    for ((p = 1; p <= steps; p++)); do
        filled=$((p * width / steps))
        empty=$((width - filled))
        bar="$(printf '%*s' "$filled" '' | tr ' ' '#')$(printf '%*s' "$empty" '' | tr ' ' '.')"
        pct=$((p * 100 / steps))
        printf "\r  ${C_CYAN}%s [%s] %d%%${C_RESET}" "$label" "$bar" "$pct"
        sleep 0.06
    done
    echo
}

check_tool() {
    local cmd="$1" label="$2" ver
    if ! command -v "$cmd" >/dev/null 2>&1; then
        echo "  ${C_RED}[FALTA]${C_RESET} $label no encontrado en PATH"
        CHECKS_FAILED=$((CHECKS_FAILED + 1))
        return
    fi
    ver="$("$cmd" --version 2>/dev/null | head -n1)"
    echo "  ${C_GREEN}[OK]${C_RESET}    $label  ${C_GRAY}${ver}${C_RESET}"
}

check_xcode() {
    if ! xcode-select -p >/dev/null 2>&1; then
        echo "  ${C_RED}[FALTA]${C_RESET} Xcode Command Line Tools no instaladas"
        echo "  ${C_GRAY}         Instala con: xcode-select --install${C_RESET}"
        CHECKS_FAILED=$((CHECKS_FAILED + 1))
        return
    fi
    echo "  ${C_GREEN}[OK]${C_RESET}    Xcode Command Line Tools  ${C_GRAY}$(xcode-select -p)${C_RESET}"
}

banner

echo "${C_BOLD}${C_CYAN}[1/4] Verificando entorno${C_RESET}"
pbar "Detectando herramientas" 12
check_tool node "Node.js"
check_tool npm "npm"
check_tool cargo "Rust (cargo)"
check_xcode
if [ "$CHECKS_FAILED" -gt 0 ]; then
    echo
    echo "${C_RED}[X] Faltan herramientas requeridas. Aborta.${C_RESET}"
    pause_unless_master
    exit 1
fi
echo

echo "${C_BOLD}${C_CYAN}[2/4] Preparando dependencias${C_RESET}"
if [ ! -d node_modules ]; then
    echo "  ${C_YELLOW}[!]${C_RESET} node_modules no existe, ejecutando npm install..."
    if ! npm install; then
        pause_unless_master
        exit 1
    fi
else
    pbar "Dependencias ya instaladas" 10
fi
echo

echo "${C_BOLD}${C_CYAN}[3/4] Compilando (npm run tauri build)${C_RESET}"
echo "${C_GRAY}--------------------------------------------------------------${C_RESET}"
T_START=$(date +%s)
npm run tauri build
BUILD_ERR=$?
T_END=$(date +%s)
echo "${C_GRAY}--------------------------------------------------------------${C_RESET}"
ELAPSED=$((T_END - T_START))
ELAPSED_STR="$((ELAPSED / 60))m $((ELAPSED % 60))s"
echo

echo "${C_BOLD}${C_CYAN}[4/4] Resultado${C_RESET}"
if [ "$BUILD_ERR" -ne 0 ]; then
    echo "${C_RED}[FALLO] El build de macOS no se completo correctamente.${C_RESET}"
    pause_unless_master
    exit 1
fi

echo "${C_GREEN}[OK] Build de macOS completado en ${ELAPSED_STR}.${C_RESET}"
echo "${C_GRAY}     Artefactos: src-tauri/target/release/bundle/${C_RESET}"
pause_unless_master
exit 0
