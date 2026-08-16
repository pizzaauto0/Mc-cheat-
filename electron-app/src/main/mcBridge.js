'use strict';

const WebSocket = require('ws');
const { EventEmitter } = require('events');

const RECONNECT_DELAY_MS = 2000;

/**
 * Verbindet sich mit dem lokalen WebSocket-Server, den der CheatBridge-Fabric-Mod
 * in Minecraft startet, sobald das Spiel laeuft. Reine Transport-Schicht: kennt das
 * JSON-Protokoll, aber keine Cheat-spezifische Logik.
 *
 * Protokoll (siehe minecraft-mod/README.md):
 *   Mod -> App: {type:"hello", ...}, {type:"state", cheats:{...}, player, inWorld}, {type:"pong"}
 *   App -> Mod: {type:"setCheat", id, enabled}, {type:"setParam", id, key, value},
 *               {type:"action", id}, {type:"ping"}
 */
class MinecraftBridge extends EventEmitter {
  constructor({ host = '127.0.0.1', port = 34551 } = {}) {
    super();
    this.host = host;
    this.port = port;
    this.ws = null;
    this._shouldConnect = false;
    this._reconnectTimer = null;
    this.connected = false;
  }

  connect() {
    if (this._shouldConnect) return;
    this._shouldConnect = true;
    this._open();
  }

  disconnect() {
    this._shouldConnect = false;
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.removeAllListeners();
      try { this.ws.close(); } catch (_) { /* noop */ }
      this.ws = null;
    }
    this.connected = false;
  }

  _open() {
    if (!this._shouldConnect) return;

    const url = `ws://${this.host}:${this.port}`;
    const ws = new WebSocket(url, { handshakeTimeout: 2000 });
    this.ws = ws;

    ws.on('open', () => {
      this.connected = true;
      this.emit('connected');
    });

    ws.on('message', (data) => {
      let msg;
      try {
        msg = JSON.parse(data.toString());
      } catch (_) {
        return;
      }
      this.emit('message', msg);
      if (msg.type) this.emit(msg.type, msg);
    });

    ws.on('close', () => {
      const wasConnected = this.connected;
      this.connected = false;
      if (wasConnected) this.emit('disconnected');
      this._scheduleReconnect();
    });

    ws.on('error', () => {
      // Fehler wird ueber 'close' weiterverarbeitet (reconnect); hier nur schlucken,
      // damit ungefangene 'error'-Events den Prozess nicht crashen.
    });
  }

  _scheduleReconnect() {
    if (!this._shouldConnect || this._reconnectTimer) return;
    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      if (this._shouldConnect) this._open();
    }, RECONNECT_DELAY_MS);
  }

  _send(payload) {
    if (!this.connected || !this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(payload));
    return true;
  }

  setCheat(id, enabled) {
    return this._send({ type: 'setCheat', id, enabled });
  }

  setParam(id, key, value) {
    return this._send({ type: 'setParam', id, key, value });
  }

  triggerAction(id) {
    return this._send({ type: 'action', id });
  }

  ping() {
    return this._send({ type: 'ping' });
  }
}

module.exports = { MinecraftBridge };
