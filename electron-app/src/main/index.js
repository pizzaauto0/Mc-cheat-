'use strict';

const path = require('path');
const { app, BrowserWindow, ipcMain, globalShortcut } = require('electron');

const { GAMES, getGameById } = require('./games');
const { ProcessWatcher } = require('./processWatcher');
const { MinecraftBridge } = require('./mcBridge');
const configStore = require('./configStore');

let mainWindow = null;
let appConfig = configStore.load();
const processWatcher = new ProcessWatcher(GAMES);

// Aktuell nur eine Bridge (Minecraft). Fuer weitere Spiele: pro Spiel eine eigene
// Bridge-Instanz nach dem Muster in games/<spiel>.js -> bridge-Config anlegen.
const minecraftGame = getGameById('minecraft');
const mcBridge = new MinecraftBridge({
  host: minecraftGame.bridge.host,
  port: appConfig.minecraftBridgePort
});

function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 880,
    minHeight: 560,
    backgroundColor: '#0f1115',
    title: 'CheatHub',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
}

/** Blendet das Fenster ein/aus -- der globale Hotkey (Standard: Einfg) ruft das auf. */
function toggleWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    return;
  }
  if (mainWindow.isVisible()) {
    mainWindow.hide();
  } else {
    mainWindow.show();
    mainWindow.focus();
  }
}

/** Registriert den globalen Hotkey neu (z.B. nach einer Aenderung in der Config). */
function registerHotkey(accelerator) {
  globalShortcut.unregisterAll();
  const ok = globalShortcut.register(accelerator, toggleWindow);
  if (!ok) {
    console.warn(`Hotkey "${accelerator}" konnte nicht registriert werden (evtl. von einem anderen Programm belegt).`);
  }
  return ok;
}

function wireGameDetection() {
  processWatcher.on('game-started', (gameId) => {
    send('game-status', { gameId, running: true });
    if (gameId === 'minecraft') mcBridge.connect();
  });

  processWatcher.on('game-stopped', (gameId) => {
    send('game-status', { gameId, running: false });
    if (gameId === 'minecraft') mcBridge.disconnect();
  });

  processWatcher.start();
}

function wireMinecraftBridge() {
  mcBridge.on('connected', () => send('minecraft-bridge', { event: 'connected' }));
  mcBridge.on('disconnected', () => send('minecraft-bridge', { event: 'disconnected' }));
  mcBridge.on('hello', (msg) => send('minecraft-bridge', { event: 'hello', payload: msg }));
  mcBridge.on('state', (msg) => send('minecraft-bridge', { event: 'state', payload: msg }));
}

function wireIpc() {
  ipcMain.handle('games:list', () => {
    return GAMES.map((g) => ({
      id: g.id,
      name: g.name,
      subtitle: g.subtitle,
      icon: g.icon,
      cheatCatalog: g.cheatCatalog,
      running: processWatcher.isRunning(g.id)
    }));
  });

  ipcMain.handle('minecraft:isConnected', () => mcBridge.connected);

  ipcMain.handle('minecraft:setCheat', (_evt, { id, enabled }) => {
    return mcBridge.setCheat(id, enabled);
  });

  ipcMain.handle('minecraft:setParam', (_evt, { id, key, value }) => {
    return mcBridge.setParam(id, key, value);
  });

  ipcMain.handle('minecraft:action', (_evt, { id }) => {
    return mcBridge.triggerAction(id);
  });

  ipcMain.handle('config:get', () => appConfig);

  ipcMain.handle('config:allowedHotkeys', () => configStore.ALLOWED_HOTKEYS);

  ipcMain.handle('config:set', (_evt, partial) => {
    const next = { ...appConfig, ...partial };

    if (!configStore.ALLOWED_HOTKEYS.includes(next.hotkey)) {
      next.hotkey = appConfig.hotkey;
    }
    const port = Number(next.minecraftBridgePort);
    next.minecraftBridgePort = Number.isInteger(port) && port > 0 && port < 65536
      ? port
      : appConfig.minecraftBridgePort;

    appConfig = next;
    configStore.save(appConfig);
    registerHotkey(appConfig.hotkey);
    mcBridge.setEndpoint(minecraftGame.bridge.host, appConfig.minecraftBridgePort);

    return appConfig;
  });
}

app.whenReady().then(() => {
  wireIpc();
  wireMinecraftBridge();
  createWindow();
  wireGameDetection();
  registerHotkey(appConfig.hotkey);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  processWatcher.stop();
  mcBridge.disconnect();
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});
