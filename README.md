# CheatHub

Ein eigenständiges Electron-Programm im Stil von WeMod: erkennt laufende Spiele automatisch
und schaltet dafür Singleplayer-Cheats frei, die du per Klick an-/ausschalten kannst.
Aktuell unterstützt: **Minecraft Java Edition 1.21.11**. Die Architektur ist bewusst so
gebaut, dass weitere Spiele später als eigenes "Game-Plugin" ergänzt werden können.

## Warum zwei Teile?

Electron kann nicht in den Minecraft-(Java-)Prozess eingreifen (kein Speicher-Hack wie bei
nativen Games). Deshalb besteht CheatHub aus zwei Komponenten, die lokal über WebSocket
miteinander reden:

1. **`electron-app/`** – die eigentliche App/Oberfläche. Erkennt, ob `javaw`/`java` mit
   Minecraft läuft, zeigt die Spielebibliothek, verbindet sich mit dem Mod und schickt
   Cheat-Befehle.
2. **`minecraft-mod/`** – ein kleiner Fabric-Mod ("CheatBridge"), den du einmalig in deinen
   Minecraft-Mods-Ordner legst. Er startet einen lokalen WebSocket-Server
   (`127.0.0.1:34551`, nur lokal erreichbar) und setzt die Cheats tatsächlich im Spiel um.

```
Electron UI  <── WebSocket (localhost:34551) ──>  Fabric-Mod "CheatBridge"  ──>  Minecraft
```

Nur Singleplayer/lokale Welten – der Mod aktiviert Cheats ausschließlich für die
integrierte Server-Instanz deiner eigenen Welt.

## Setup

### 1. Minecraft-Mod installieren
Siehe [`minecraft-mod/README.md`](minecraft-mod/README.md) – kurz gesagt: Fabric Loader
installieren, `CheatBridge` + Fabric API in den `mods`-Ordner legen, Minecraft starten.

### 2. Electron-App starten
```bash
cd electron-app
npm install
npm start
```

Die App zeigt "Minecraft: nicht erkannt", bis Minecraft läuft. Sobald ein Prozess mit
`javaw`/`java` erkannt wird, versucht sie sich mit dem Mod zu verbinden. Läuft eine Welt,
werden die Cheats im Panel aktiv klickbar.

## Menü per Hotkey öffnen/schließen

Ein globaler Hotkey (Standard: **Einfg/Insert**, alternativ z.B. **F7** einstellbar)
blendet das CheatHub-Fenster ein und aus – funktioniert systemweit, auch wenn Minecraft
gerade im Vordergrund ist. Einstellbar unter **⚙ Einstellungen** in der Sidebar, zusammen
mit dem Minecraft-Bridge-Port (falls 34551 bei dir belegt ist). Die Einstellungen werden
in `config.json` im App-Datenverzeichnis gespeichert und bleiben über Neustarts erhalten.

## Neues Spiel hinzufügen (später)

Jedes Spiel ist ein Modul unter `electron-app/src/main/games/*.js` mit:
- Prozess-Erkennungsmuster (Name/Cmdline-Regex)
- Anzeige-Metadaten (Name, Icon, Beschreibung)
- einem "Connector", der beschreibt, wie die App mit dem Spiel/seinem Bridge-Mod spricht

`src/main/games/index.js` registriert alle Spiele. Für ein neues Spiel reicht eine neue
Datei + Eintrag in der Registry – der Rest der UI (Bibliothek, Cheat-Panel, Verbindungsstatus)
ist generisch und braucht keine Änderung.

## Rechtlicher Hinweis

CheatHub verändert ausschließlich deine eigene lokale Singleplayer-Welt. Es greift nicht in
Multiplayer-Server, andere Spieler oder fremde Prozesse ein. Nutzung auf Servern mit fremden
Regeln/Anti-Cheat kann gegen deren Regeln verstoßen – das liegt in deiner Verantwortung.
