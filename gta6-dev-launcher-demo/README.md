# GTA VI Dev-Build Launcher (Recreation)

Nachbau des viralen TikTok-Trends: ein gefälschter "Grand Theft Auto VI
Development Build" Launcher, der beim Klick auf "LAUNCH GAME" über eine
animierte Übergangs-Sequenz, ein Rockstar-Logo-Splash, in ein GTA-VI-Style
Hauptmenü wechselt.

Alle Grafiken (Logo-Rahmen, Menü-Kacheln) sind eigene CSS/SVG-Illustrationen,
keine Spiel-Screenshots.

## Im Browser öffnen

`index.html` direkt doppelklicken / im Browser öffnen. Keine Installation nötig.

## Als Windows-.exe bauen

Das kann nur auf einem Windows-Rechner gebaut werden (PyInstaller erzeugt
keine Windows-exe von Linux aus). Schritte auf deinem Windows-PC:

```bat
pip install -r requirements.txt
build.bat
```

Die fertige `GTA6DevLauncher.exe` liegt danach in `dist\`. Sie öffnet
`index.html` in einem eigenen Fenster (via `pywebview`) statt im Browser.

Zum Testen ohne Build vorher: `python launcher.py`
