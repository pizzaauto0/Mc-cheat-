'use strict';

/**
 * Zentrale Spiele-Registry. Neues Spiel hinzufuegen = neue Datei hier + Eintrag in der Liste.
 * Der Rest der App (Prozess-Erkennung, UI, Bridge-Handling) ist generisch.
 */

const minecraft = require('./minecraft');

const GAMES = [minecraft];

function getGameById(id) {
  return GAMES.find((g) => g.id === id) || null;
}

module.exports = { GAMES, getGameById };
