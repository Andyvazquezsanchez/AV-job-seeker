@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title Job Seeker - no cierres esta ventana mientras lo uses
rem --- Node: el que viene incluido en el paquete, o el instalado en la computadora ---
set "NODE=%~dp0runtime\node.exe"
if exist "%NODE%" goto :node_ok
set "NODE="
for /f "delims=" %%i in ('where node 2^>nul') do if not defined NODE set "NODE=%%i"
if not defined NODE goto :no_node
"%NODE%" -e "process.exit(Number(process.versions.node.split('.')[0])>=22?0:1)"
if errorlevel 1 goto :old_node
:node_ok

if not exist "node_modules\@electric-sql\pglite" (
  echo.
  echo  Falta instalar el programa. Hace doble clic en "Instalar.bat" primero.
  pause
  exit /b 1
)
if not exist "datos\base" "%NODE%" scripts\setup.js
"%NODE%" scripts\dashboard.js --open
if errorlevel 1 pause
exit /b 0

:no_node
echo.
echo  No encontre Node.js en esta computadora y este paquete no lo trae incluido.
echo  Node.js es el motor gratuito que hace funcionar el programa.
echo.
where winget >nul 2>nul
if errorlevel 1 goto :node_manual
choice /c SN /n /m "  Lo instalo ahora con el instalador de Windows (winget)? [S/N] "
if errorlevel 2 goto :node_manual
winget install -e --id OpenJS.NodeJS.LTS
echo.
echo  Cuando termine la instalacion, cerra esta ventana y volve a hacer doble clic en este archivo.
pause
exit /b 1

:node_manual
echo  Descargalo de https://nodejs.org (boton LTS), instalalo con todas las opciones por defecto
echo  y volve a hacer doble clic en este archivo.
pause
exit /b 1

:old_node
echo.
echo  La version de Node.js instalada es anterior a la 22. Actualizala desde https://nodejs.org
echo  y volve a hacer doble clic en este archivo.
pause
exit /b 1
