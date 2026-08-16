'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('cheathub', {
  listGames: () => ipcRenderer.invoke('games:list'),
  isMinecraftConnected: () => ipcRenderer.invoke('minecraft:isConnected'),

  setMinecraftCheat: (id, enabled) => ipcRenderer.invoke('minecraft:setCheat', { id, enabled }),
  setMinecraftParam: (id, key, value) => ipcRenderer.invoke('minecraft:setParam', { id, key, value }),
  triggerMinecraftAction: (id) => ipcRenderer.invoke('minecraft:action', { id }),

  getConfig: () => ipcRenderer.invoke('config:get'),
  getAllowedHotkeys: () => ipcRenderer.invoke('config:allowedHotkeys'),
  setConfig: (partial) => ipcRenderer.invoke('config:set', partial),

  onGameStatus: (callback) => {
    const listener = (_evt, payload) => callback(payload);
    ipcRenderer.on('game-status', listener);
    return () => ipcRenderer.removeListener('game-status', listener);
  },

  onMinecraftBridge: (callback) => {
    const listener = (_evt, payload) => callback(payload);
    ipcRenderer.on('minecraft-bridge', listener);
    return () => ipcRenderer.removeListener('minecraft-bridge', listener);
  }
});
