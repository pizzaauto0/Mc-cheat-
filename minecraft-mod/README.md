# CheatBridge (Fabric-Mod)

Kleiner Client-Mod fuer Minecraft Java Edition **1.21.11** auf **Fabric**. Er startet
einen WebSocket-Server auf `127.0.0.1:34551` (nur lokal erreichbar) und setzt darüber
Cheats um, die von der CheatHub-Electron-App gesteuert werden.

Alle Cheats, die den tatsächlichen Spielzustand verändern (Fly, Speed, keepInventory,
Zeit/Wetter, ...), greifen ausschließlich zu, wenn du selbst Host der Welt bist
(Singleplayer oder "Für LAN öffnen"). Auf fremden Multiplayer-Servern bleibt der Mod
absichtlich wirkungslos für diese Cheats, da er über `MinecraftClient#getServer()`
direkt den integrierten Server anspricht statt Pakete an einen fremden Server zu fälschen.

## Build

Voraussetzungen: JDK 21, Internetzugriff für Gradle/Fabric-Maven beim ersten Build.
Der Gradle-Wrapper liegt schon im Repo, du brauchst **kein separates Gradle** zu
installieren.

**Windows (cmd/PowerShell):**
```
cd minecraft-mod
gradlew.bat build
```

**Linux/macOS:**
```bash
cd minecraft-mod
./gradlew build
```

Das fertige Mod-Jar liegt danach unter `build/libs/cheatbridge-0.1.0.jar`.

**Hinweis:** Die Versionsnummern in `gradle.properties` (Fabric Loader, Fabric API,
Loom) sind Stand der Recherche zum Erstellungszeitpunkt dieses Mods. Prüfe vor dem
Bauen kurz [fabricmc.net/develop](https://fabricmc.net/develop/) für 1.21.11, falls
der Build mit "Dependency not found" o.ä. fehlschlägt – dann einfach die Version in
`gradle.properties` aktualisieren.

Da 1.21.11 eine sehr aktuelle Version ist, wurde dieser Code nicht in einer echten
Gradle/Minecraft-Toolchain kompiliert (dafür fehlen hier die Minecraft-Bibliotheken).
Wahrscheinlichste Punkte für kleine Anpassungen nach dem ersten Build:

- **Render-Pipeline** für ESP/Tracer/Xray/Storage-ESP/Waypoints (`render/RenderLayers.java`),
  da Mojang die Rendering-API zwischen 1.21.x-Versionen mehrfach angepasst hat.
- **`EntityAttributes.STEP_HEIGHT`** (Step-Cheat) – der Attributname für die Stufenhöhe
  kann sich zwischen Mapping-Versionen leicht unterscheiden.
- **`FoodComponent#nutrition()/saturation()`** (Auto-Eat) – die Nahrungsmittel-API wurde
  in 1.20.5+ auf Data Components umgestellt, Methodennamen können variieren.
- **`ArmorItem#getSlotType()`** (Auto-Armor) – Mojang hat das Rüstungs-/Ausrüstungssystem
  ("Equipment Assets") in 1.21.x umgebaut, hier ist am ehesten eine kleine Anpassung nötig.
- **`MinecraftServer#getTickManager()#setTickRate()`** (Game-Speed/Timer) – existiert seit
  1.20.2 als Basis für den vanilla `/tick rate`-Befehl, Methodenname kann leicht variieren.
- **`loom_version` in `gradle.properties`** – muss eine exakte Versionsnummer sein
  (keine Ranges wie `1.14.+`, das lehnt Gradles `plugins{}`-Block ab). Falls
  `gradlew build` mit "Plugin ... was not found" abbricht: aktuelle Version auf
  [fabricmc.net/develop](https://fabricmc.net/develop/) nachschauen und eintragen.

Alles andere (Cheat-Logik, WebSocket-Server, Attribute wie Speed/Fastbreak) nutzt seit
langem stabile, gut dokumentierte APIs.

## Installation

1. [Fabric Loader](https://fabricmc.net/use/installer/) für 1.21.11 installieren.
2. [Fabric API](https://modrinth.com/mod/fabric-api) (Version für 1.21.11) in den
   `mods`-Ordner legen.
3. `cheatbridge-0.1.0.jar` (aus `build/libs/`) ebenfalls in den `mods`-Ordner legen.
4. Minecraft mit dem Fabric-Profil starten, Singleplayer-Welt öffnen.
5. CheatHub-App starten – sie verbindet sich automatisch, sobald Minecraft läuft.

## Konfiguration (Port)

Der Mod legt beim ersten Start `config/cheatbridge.properties` im Minecraft-Ordner an:

```properties
port=34551
```

Falls Port 34551 bei dir belegt ist, hier und im CheatHub-Einstellungen-Panel (⚙
Einstellungen → "Minecraft-Bridge-Port") denselben neuen Port eintragen und Minecraft
neu starten.

## Protokoll

Siehe Kommentar am Kopf von `src/main/java/net/pizzaauto/cheatbridge/net/BridgeServer.java`
für das genaue JSON-Nachrichtenformat zwischen App und Mod.

## Cheat-Übersicht

| Id | Typ | Beschreibung |
|---|---|---|
| `fly` | toggle | Freies Fliegen |
| `speed` | slider (1-5x) | Laufgeschwindigkeit |
| `jumpBoost` | slider (1-5x) | Sprunghöhe (Jump-Boost-Effekt) |
| `noFallDamage` | toggle | Kein Fallschaden |
| `nightVision` | toggle | Dauer-Nachtsicht |
| `fullbright` | toggle | Client-seitige Maximalhelligkeit |
| `esp` | toggle | Umrisse von Spielern/Mobs durch Wände |
| `tracers` | toggle | Linien zu nahen Entities |
| `waypoints` | toggle | Zeigt gesetzte Wegpunkte (Taste `K` zum Setzen) |
| `fastBreak` | slider (1-10x) | Abbaugeschwindigkeit |
| `keepInventory` | toggle | Gamerule `keepInventory` |
| `freezeMobs` | toggle | Deaktiviert KI naher Mobs |
| `timeLockDay` | toggle | Friert Uhrzeit auf Tag ein |
| `weatherClear` | toggle | Erzwingt klares Wetter |
| `heal` | action | Leben sofort auffüllen |
| `feed` | action | Hunger sofort auffüllen |
| `jesus` | toggle | Wasserlaufen statt sinken (vereinfachte Näherung) |
| `spider` | toggle | Wände hochklettern beim Hineinlaufen |
| `step` | toggle | Volle Blöcke ohne Springen hochsteigen |
| `xray` | toggle | Markiert Erze (Diamant, Smaragd, Gold, Antiker Schrott, Redstone, Lapis) durch Wände |
| `storageEsp` | toggle | Markiert Truhen/Fässer/Öfen/Shulker-Boxen durch Wände |
| `nuker` | toggle | Baut abbaubare Blöcke im 3-Block-Radius automatisch ab |
| `autoTotem` | toggle | Legt automatisch ein Totem ins Offhand |
| `autoEat` | toggle | Isst automatisch, wenn der Hunger sinkt |
| `autoArmor` | toggle | Rüstet automatisch die beste verfügbare Rüstung aus |
| `killAura` | toggle | Greift automatisch nahe Mobs/Tiere an – **schließt Spieler hart aus** (Filter im Code, kein Konfigurationsschalter) |
| `killAuraRange` | slider (2-8) | Reichweite der Kill Aura in Blöcken |
| `antiKnockback` | toggle | Reduziert Rückstoß via `knockback_resistance`-Attribut stark |
| `noclip` | toggle | Keine Kollision mit Blöcken (am besten mit `fly` kombinieren) |
| `fastClimb` | toggle | Schnelleres Klettern an Leitern/Ranken |
| `mobHealthTags` | toggle | Zeigt Leben (aktuell/max) als Namensschild über nahen Mobs/Tieren |
| `gameSpeed` | slider (0.25-4x) | Welt-Tickrate über den vanilla Tick-Manager (Timer) |
| `veinMiner` | action | Baut die zusammenhängende Blockader unter dem Fadenkreuz ab (max. 64 Blöcke) |

**Wichtiger Vorbehalt zu `antiKnockback`:** Minecraft unterscheidet bei diesem Attribut
nicht zwischen Angreifer-Typen. Es reduziert Rückstoß durch Mobs *und* durch andere
Spieler gleichermaßen – das lässt sich ohne deutlich tiefere Netzwerk-Hooks nicht sauber
trennen. `killAura` dagegen greift nie Spieler an, das ist ein harter Code-Filter
(`!(e instanceof PlayerEntity)`), keine Einstellung.

Bewusst **nicht** übernommen aus Vorbildern wie Meteor Client: alles, was auf echte
Mitspieler zielt oder Anti-Cheat umgeht (automatisches Anvisieren/Angreifen von Spielern,
Blink, Packet Canceler, Notebot-Spam, Nametag-Spoofing, ...). Auch mit "nur für Freunde"
lässt sich ein automatisierter Angriff auf echte Spieler nicht sauber auf Einverständnis
beschränken, deshalb bleibt das außen vor. Alle Cheats bleiben zudem an "du bist Host
deiner Welt" gebunden (Singleplayer/LAN) – sie wirken nicht als Client-Hack auf fremden
Servern oder auf die Charaktere deiner Freunde, wenn die den Mod nicht selbst installiert
haben.

## Neues Spiel für CheatHub bauen (später)

Dieses Muster (lokaler WebSocket-Server + Electron-Connector) lässt sich auf andere
moddable Spiele übertragen. Für nicht-moddable Spiele braucht es später einen anderen
Connector-Typ (z.B. Speicher-Reader) – das ist als eigener `bridge.type` in
`electron-app/src/main/games/*.js` vorgesehen.
