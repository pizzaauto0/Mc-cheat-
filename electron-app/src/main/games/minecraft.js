'use strict';

/**
 * Game-Plugin fuer Minecraft Java Edition 1.21.11.
 * Enthaelt nur Metadaten + Prozess-Erkennung + welche Bridge-Verbindung genutzt wird.
 * Die eigentliche Cheat-Logik lebt im Fabric-Mod, dieses Modul beschreibt nur,
 * WIE die App das Spiel erkennt und WOHIN sie sich verbindet.
 */

const CHEAT_CATALOG = [
  {
    category: 'Bewegung',
    cheats: [
      { id: 'fly', label: 'Fliegen', type: 'toggle', description: 'Freies Fliegen wie im Kreativmodus, auch im Ueberlebensmodus.' },
      {
        id: 'speed',
        label: 'Lauf-Geschwindigkeit',
        type: 'slider',
        description: 'Multiplikator fuer die Bewegungsgeschwindigkeit.',
        min: 1, max: 5, step: 0.5, default: 2
      },
      {
        id: 'jumpBoost',
        label: 'Sprunghoehe',
        type: 'slider',
        description: 'Erhoehte Sprungkraft.',
        min: 1, max: 5, step: 0.5, default: 2
      },
      { id: 'noFallDamage', label: 'Kein Fallschaden', type: 'toggle', description: 'Verhindert Fallschaden komplett.' }
    ]
  },
  {
    category: 'Sicht',
    cheats: [
      { id: 'nightVision', label: 'Nachtsicht', type: 'toggle', description: 'Dauerhafte Nachtsicht ohne Nebenwirkungen.' },
      { id: 'fullbright', label: 'Fullbright', type: 'toggle', description: 'Client-seitig maximale Helligkeit, auch in dunklen Hoehlen.' },
      { id: 'esp', label: 'ESP (Entity-Vision)', type: 'toggle', description: 'Zeigt Umrisse von Spielern/Mobs durch Waende.' },
      { id: 'tracers', label: 'Tracer-Linien', type: 'toggle', description: 'Linien vom Bildschirmzentrum zu nahen Entities.' },
      { id: 'waypoints', label: 'Waypoints', type: 'toggle', description: 'Zeigt gesetzte Wegpunkte als Marker in der Welt.' }
    ]
  },
  {
    category: 'Abbau & Welt',
    cheats: [
      {
        id: 'fastBreak',
        label: 'Schnellerer Abbau',
        type: 'slider',
        description: 'Multiplikator fuer Block-Abbaugeschwindigkeit.',
        min: 1, max: 10, step: 1, default: 4
      },
      { id: 'keepInventory', label: 'Inventar bei Tod behalten', type: 'toggle', description: 'Setzt die Gamerule keepInventory.' },
      { id: 'freezeMobs', label: 'Mobs einfrieren', type: 'toggle', description: 'Deaktiviert die KI nahegelegener Mobs (keine Angriffe/Bewegung).' },
      { id: 'timeLockDay', label: 'Immer Tag', type: 'toggle', description: 'Hindert die Uhrzeit am Weiterlaufen (Dauer-Tag).' },
      { id: 'weatherClear', label: 'Klares Wetter erzwingen', type: 'toggle', description: 'Beendet/verhindert Regen und Gewitter.' }
    ]
  },
  {
    category: 'Sofort-Aktionen',
    cheats: [
      { id: 'heal', label: 'Vollstaendig heilen', type: 'action', description: 'Setzt Leben und Saettigung sofort auf Maximum.' },
      { id: 'feed', label: 'Saettigen', type: 'action', description: 'Fuellt die Hungerleiste sofort auf.' }
    ]
  }
];

module.exports = {
  id: 'minecraft',
  name: 'Minecraft: Java Edition',
  subtitle: '1.21.11 · Singleplayer',
  icon: 'minecraft.png',
  // Prozessname-Muster, um zu erkennen, ob Minecraft laeuft (Windows: javaw.exe, Linux/macOS: java)
  processPatterns: [/^javaw(\.exe)?$/i, /^java(\.exe)?$/i],
  // Zusaetzliche Absicherung: Kommandozeile sollte auf Minecraft/Fabric hindeuten,
  // damit nicht jeder beliebige Java-Prozess als "Minecraft laeuft" erkannt wird.
  cmdlineHints: [/minecraft/i, /fabric/i, /\.minecraft/i],
  bridge: {
    type: 'websocket',
    host: '127.0.0.1',
    port: 34551
  },
  cheatCatalog: CHEAT_CATALOG
};
