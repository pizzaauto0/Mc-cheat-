'use strict';

const path = require('path');
const { app, BrowserWindow, ipcMain } = require('electron');

const { GAMES, getGameById } = require('./games');
const { ProcessWatcher } = require('./processWatcher');
const { MinecraftBridge } = require('./mcBridge');

let mainWindow = null;
const processWatcher = new ProcessWatcher(GAMES);

// Aktuell nur eine Bridge (Minecraft). Fuer weitere Spiele: pro Spiel eine eigene
// Bridge-Instanz nach dem Muster in games/<spiel>.js -> bridge-Config anlegen.
const minecraftGame = getGameById('minecraft');
const mcBridge = new MinecraftBridge(minecraftGame.bridge);

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
}

app.whenReady().then(() => {
  wireIpc();
  wireMinecraftBridge();
  createWindow();
  wireGameDetection();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  processWatcher.stop();
  mcBridge.disconnect();
  if (process.platform !== 'darwin') app.quit();
});
