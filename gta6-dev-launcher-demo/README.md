# GTA VI Dev-Build Launcher (Recreation)

Nachbau des viralen TikTok-Trends: ein gefälschter "Grand Theft Auto VI
Development Build" Launcher, der beim Klick auf "LAUNCH GAME" über eine
animierte Übergangs-Sequenz, ein Rockstar-Logo-Splash, in ein GTA-VI-Style
Hauptmenü wechselt.

Alle Grafiken (Logo-Rahmen, Menü-Kacheln) sind eigene CSS/SVG-Illustrationen,
keine Spiel-Screenshots.

## Im Browser öffnen

`index.html` direkt doppelklicken / im Browser öffnen. Keine Installation nötig.

## Als eigenständige Datei bauen

`launcher.py` öffnet `index.html` per `pywebview` in einem eigenen Fenster
statt im Browser. PyInstaller kann nur für das OS bauen, auf dem es läuft
(kein Cross-Compiling) — auf Windows entsteht eine `.exe`, auf Linux ein
ELF-Binary.

**Linux:**
```bash
sudo apt-get install python3-gi gir1.2-gtk-3.0 gir1.2-webkit2-4.1   # GTK3 + WebKit2GTK
pip install -r requirements.txt
./build.sh
```
Ergebnis: `dist/GTA6DevLauncher`. Läuft nur auf Systemen mit installiertem
GTK3 + WebKit2GTK (auf den meisten GNOME-Desktops schon vorhanden) und
einer glibc-Version >= der des Build-Rechners.

**Windows:**
```bat
pip install -r requirements.txt
build.bat
```
Ergebnis: `dist\GTA6DevLauncher.exe`.

Zum Testen ohne Build vorher: `python launcher.py`
