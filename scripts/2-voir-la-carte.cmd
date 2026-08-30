@echo off
REM Lance le serveur local et ouvre la carte. Laisser la fenetre ouverte pendant la consultation.
cd /d "%~dp0.."
start "champi-serveur" cmd /c "node collect\serve.mjs"
timeout /t 2 /nobreak >nul
start "" http://localhost:8123
echo Carte ouverte sur http://localhost:8123
echo Ferme la fenetre "champi-serveur" pour arreter.
