@echo off
REM Tâche planifiée : collecte quotidienne des données + génération de la carte.
REM Planifier vers 06:00. "Démarrer dans" = le dossier champi-cevennes.

cd /d "%~dp0.."

REM --- source des données : proxy (défaut) ou antilope ---
REM set CHAMPI_SOURCE=antilope
REM set CHAMPI_MF_APPID=xxxxxxxxxxxxxxxxxxxx

node collect\run.mjs >> data\collecte.log 2>&1
