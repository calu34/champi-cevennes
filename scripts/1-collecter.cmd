@echo off
REM Collecte manuelle (affiche le deroulement). Double-clic pour lancer.
cd /d "%~dp0.."

REM --- decommenter quand le compte Meteo-France est pret ---
REM set CHAMPI_SOURCE=antilope
REM set CHAMPI_MF_APPID=colle_ici_l_application_id

node collect\run.mjs
echo.
echo ---- termine ----
pause
