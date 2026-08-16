'use strict';

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const DEFAULTS = {
  hotkey: 'Insert',
  minecraftBridgePort: 34551
};

// Electron-Accelerator-Namen; muss zu einer echten globalShortcut-Taste passen.
const ALLOWED_HOTKEYS = ['Insert', 'F7', 'F8', 'F9', 'Home', 'ScrollLock', 'Pause'];

function configFilePath() {
  return path.join(app.getPath('userData'), 'config.json');
}

function load() {
  try {
    const raw = fs.readFileSync(configFilePath(), 'utf-8');
    const parsed = JSON.parse(raw);
    return { ...DEFAULTS, ...parsed };
  } catch (_) {
    return { ...DEFAULTS };
  }
}

function save(config) {
  const file = configFilePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(config, null, 2), 'utf-8');
}

module.exports = { load, save, DEFAULTS, ALLOWED_HOTKEYS };
