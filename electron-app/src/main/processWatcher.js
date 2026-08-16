'use strict';

const { EventEmitter } = require('events');

/**
 * Pollt periodisch die laufenden Prozesse und meldet, welche registrierten Spiele
 * gerade laufen. ps-list ist ein reines ESM-Package, daher per dynamic import geladen.
 */
class ProcessWatcher extends EventEmitter {
  constructor(games, { intervalMs = 3000 } = {}) {
    super();
    this.games = games;
    this.intervalMs = intervalMs;
    this._timer = null;
    this._running = new Set();
    this._psList = null;
  }

  async _loadPsList() {
    if (!this._psList) {
      const mod = await import('ps-list');
      this._psList = mod.default;
    }
    return this._psList;
  }

  start() {
    if (this._timer) return;
    this._tick();
    this._timer = setInterval(() => this._tick(), this.intervalMs);
  }

  stop() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  async _tick() {
    let processes;
    try {
      const psList = await this._loadPsList();
      processes = await psList();
    } catch (err) {
      this.emit('error', err);
      return;
    }

    for (const game of this.games) {
      const isRunning = this._matchesGame(game, processes);
      const wasRunning = this._running.has(game.id);

      if (isRunning && !wasRunning) {
        this._running.add(game.id);
        this.emit('game-started', game.id);
      } else if (!isRunning && wasRunning) {
        this._running.delete(game.id);
        this.emit('game-stopped', game.id);
      }
    }
  }

  _matchesGame(game, processes) {
    return processes.some((proc) => {
      const name = proc.name || '';
      const cmd = proc.cmd || proc.cmdline || '';
      const nameMatches = (game.processPatterns || []).some((re) => re.test(name));
      if (!nameMatches) return false;

      const hints = game.cmdlineHints || [];
      // Wenn keine Hints definiert sind, oder die Kommandozeile nicht auslesbar war
      // (z.B. fehlende Rechte auf manchen Systemen), reicht der Namenstreffer.
      if (hints.length === 0 || !cmd) return true;
      return hints.some((re) => re.test(cmd));
    });
  }

  isRunning(gameId) {
    return this._running.has(gameId);
  }
}

module.exports = { ProcessWatcher };
