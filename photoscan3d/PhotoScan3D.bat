@echo off
rem Lance l'interface graphique dans l'environnement isole cree par install_windows.ps1.
setlocal
cd /d "%~dp0"
if exist ".venv\Scripts\python.exe" (
    ".venv\Scripts\python.exe" -m photoscan3d gui
) else (
    echo L'environnement Python est absent. Executez d'abord :
    echo   powershell -ExecutionPolicy Bypass -File .\install_windows.ps1
    pause
)
