@echo off
REM Run this on Windows, inside this folder, after: pip install -r requirements.txt
pyinstaller --onefile --noconsole --name GTA6DevLauncher --add-data "index.html;." launcher.py
echo.
echo Done. Find the exe in dist\GTA6DevLauncher.exe
pause
