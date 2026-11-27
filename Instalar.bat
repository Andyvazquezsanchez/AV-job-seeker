@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title Job Seeker - instalacion
echo.
echo  Job Seeker - instalacion
echo  ------------------------
echo.
rem --- Abierto desde adentro del .zip: Windows lo copia a una carpeta temporal que despues se borra ---
set "HERE=%~dp0"
if /i not "%HERE:\AppData\Local\Temp\=%"=="%HERE%" goto :in_zip
if /i not "%HERE:.zip\=%"=="%HERE%" goto :in_zip
rem --- Node: el que viene incluido en el paquete, o el instalado en la computadora ---
set "NODE=%~dp0runtime\node.exe"
if exist "%NODE%" goto :node_ok
set "NODE="
for /f "delims=" %%i in ('where node 2^>nul') do if not defined NODE set "NODE=%%i"
if not defined NODE goto :no_node
"%NODE%" -e "process.exit(Number(process.versions.node.split('.')[0])>=22?0:1)"
if errorlevel 1 goto :old_node
:node_ok

if exist "node_modules\@electric-sql\pglite" goto :deps_ok
echo  Descargando los componentes del programa (una sola vez, puede tardar unos minutos)...
call npm ci --omit=dev --ignore-scripts
if errorlevel 1 (
  echo.
  echo  No pude descargar los componentes. Revisa la conexion a internet y volve a intentar.
  pause
  exit /b 1
)
:deps_ok

"%NODE%" scripts\setup.js
if errorlevel 1 (
  echo.
  echo  La instalacion no pudo terminar. El detalle esta arriba.
  pause
  exit /b 1
)

rem --- Accesos directos en el Escritorio y en el menu Inicio ---
set "JS_DIR=%~dp0"
call :shortcut Desktop "en el Escritorio"
call :shortcut Programs "en el menu Inicio"
echo.
echo  Instalacion terminada. Tus datos quedan en la carpeta "datos", dentro de esta carpeta.
echo.
echo  Abriendo el panel en tu navegador...
start "Job Seeker" /min "%~dp0Abrir Job Seeker.bat"
echo.
echo  Ya podes cerrar esta ventana.
timeout /t 8 >nul
exit /b 0

:shortcut
rem Crea "Job Seeker.lnk" en la carpeta de Windows indicada (Desktop o Programs, la del menu Inicio).
powershell -NoProfile -Command "$d=[Environment]::GetFolderPath('%~1'); if (-not $d) { exit 1 }; New-Item -ItemType Directory -Force -Path $d | Out-Null; $s=(New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path $d 'Job Seeker.lnk')); $s.TargetPath=(Join-Path $env:JS_DIR 'Abrir Job Seeker.bat'); $s.WorkingDirectory=$env:JS_DIR; $s.WindowStyle=7; $s.IconLocation=(Join-Path $env:SystemRoot 'System32\shell32.dll')+',22'; $s.Description='Abrir el panel de Job Seeker'; $s.Save()" >nul 2>nul
if errorlevel 1 (
  echo   [!]  No pude crear el acceso directo %~2. Podes abrir el programa con "Abrir Job Seeker.bat".
) else (
  echo   [ok] Acceso directo "Job Seeker" creado %~2
)
exit /b 0

:in_zip
echo  Parece que abriste el instalador desde adentro del archivo .zip.
echo  Asi el programa quedaria en una carpeta temporal y tus datos se perderian.
echo.
echo  Primero descomprimilo: clic derecho sobre JobSeeker-Windows.zip, "Extraer todo",
echo  elegi un lugar fijo (por ejemplo Documentos) y despues hace doble clic en
echo  Instalar.bat dentro de la carpeta JobSeeker que se crea.
echo.
pause
exit /b 1

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
