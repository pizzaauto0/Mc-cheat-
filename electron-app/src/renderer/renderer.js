'use strict';

const gameListEl = document.getElementById('game-list');
const emptyStateEl = document.getElementById('empty-state');
const gamePanelEl = document.getElementById('game-panel');
const panelTitleEl = document.getElementById('panel-title');
const panelSubtitleEl = document.getElementById('panel-subtitle');
const statusBadgeEl = document.getElementById('status-badge');
const statusTextEl = document.getElementById('status-text');
const hintBannerEl = document.getElementById('hint-banner');
const categoriesEl = document.getElementById('cheat-categories');

let games = [];
let selectedGameId = null;
let running = {}; // gameId -> bool (process detected)
let bridgeConnected = false; // minecraft mod connected via websocket
let cheatState = {}; // id -> value (bool for toggle, number for slider)

function setConnectionStatus() {
  statusBadgeEl.classList.remove('status-offline', 'status-detected', 'status-connected');
  hintBannerEl.classList.add('hidden');

  const isRunning = !!running[selectedGameId];

  if (bridgeConnected) {
    statusBadgeEl.classList.add('status-connected');
    statusTextEl.textContent = 'Verbunden';
  } else if (isRunning) {
    statusBadgeEl.classList.add('status-detected');
    statusTextEl.textContent = 'Erkannt, verbinde ...';
    hintBannerEl.textContent = 'Minecraft laeuft, aber CheatHub findet den CheatBridge-Mod nicht. Ist der Mod im Mods-Ordner installiert und die Welt geladen?';
    hintBannerEl.classList.remove('hidden');
  } else {
    statusBadgeEl.classList.add('status-offline');
    statusTextEl.textContent = 'Nicht erkannt';
    hintBannerEl.textContent = 'Starte Minecraft mit dem CheatBridge-Mod, um Cheats freizuschalten.';
    hintBannerEl.classList.remove('hidden');
  }

  categoriesEl.querySelectorAll('.cheat-card').forEach((card) => {
    card.classList.toggle('enabled-context', bridgeConnected);
  });
}

function renderGameList() {
  gameListEl.innerHTML = '';
  for (const game of games) {
    const card = document.createElement('div');
    card.className = 'game-card' + (game.id === selectedGameId ? ' active' : '');
    card.innerHTML = `
      <div class="game-icon">MC</div>
      <div class="game-meta">
        <div class="game-name">${escapeHtml(game.name)}</div>
        <div class="game-sub">${escapeHtml(game.subtitle)}</div>
      </div>
      <div class="game-live-dot ${running[game.id] ? 'on' : ''}"></div>
    `;
    card.addEventListener('click', () => selectGame(game.id));
    gameListEl.appendChild(card);
  }
}

function selectGame(gameId) {
  selectedGameId = gameId;
  const game = games.find((g) => g.id === gameId);
  if (!game) return;

  emptyStateEl.classList.add('hidden');
  gamePanelEl.classList.remove('hidden');
  panelTitleEl.textContent = game.name;
  panelSubtitleEl.textContent = game.subtitle;

  renderGameList();
  renderCheatCatalog(game);
  setConnectionStatus();
}

function renderCheatCatalog(game) {
  categoriesEl.innerHTML = '';
  for (const category of game.cheatCatalog) {
    const section = document.createElement('div');
    const title = document.createElement('div');
    title.className = 'category-title';
    title.textContent = category.category;
    section.appendChild(title);

    const grid = document.createElement('div');
    grid.className = 'cheat-grid';

    for (const cheat of category.cheats) {
      grid.appendChild(renderCheatCard(cheat));
    }

    section.appendChild(grid);
    categoriesEl.appendChild(section);
  }
}

function renderCheatCard(cheat) {
  const card = document.createElement('div');
  card.className = 'cheat-card';
  card.dataset.cheatId = cheat.id;

  const top = document.createElement('div');
  top.className = 'cheat-card-top';

  const labelWrap = document.createElement('div');
  labelWrap.innerHTML = `
    <div class="cheat-label">${escapeHtml(cheat.label)}</div>
    <div class="cheat-desc">${escapeHtml(cheat.description)}</div>
  `;
  top.appendChild(labelWrap);

  if (cheat.type === 'toggle') {
    const label = document.createElement('label');
    label.className = 'switch';
    label.innerHTML = `<input type="checkbox" /><span class="slider-toggle"></span>`;
    const input = label.querySelector('input');
    input.addEventListener('change', () => {
      window.cheathub.setMinecraftCheat(cheat.id, input.checked);
    });
    top.appendChild(label);
    card.appendChild(top);
  } else if (cheat.type === 'slider') {
    card.appendChild(top);
    const row = document.createElement('div');
    row.className = 'param-row';
    row.innerHTML = `
      <input type="range" min="${cheat.min}" max="${cheat.max}" step="${cheat.step}" value="${cheat.default}" />
      <span class="param-value">${cheat.default}x</span>
    `;
    const input = row.querySelector('input');
    const valueEl = row.querySelector('.param-value');
    input.addEventListener('input', () => {
      valueEl.textContent = `${input.value}x`;
    });
    input.addEventListener('change', () => {
      window.cheathub.setMinecraftParam(cheat.id, 'value', parseFloat(input.value));
    });
    card.appendChild(row);
  } else if (cheat.type === 'action') {
    card.appendChild(top);
    const btn = document.createElement('button');
    btn.className = 'action-btn';
    btn.textContent = 'Ausfuehren';
    btn.addEventListener('click', () => window.cheathub.triggerMinecraftAction(cheat.id));
    card.appendChild(btn);
  }

  return card;
}

function applyRemoteCheatState(cheats) {
  if (!cheats) return;
  cheatState = { ...cheatState, ...cheats };
  for (const [id, value] of Object.entries(cheats)) {
    const card = categoriesEl.querySelector(`.cheat-card[data-cheat-id="${CSS.escape(id)}"]`);
    if (!card) continue;
    const checkbox = card.querySelector('input[type="checkbox"]');
    if (checkbox && typeof value === 'boolean') checkbox.checked = value;
    const range = card.querySelector('input[type="range"]');
    if (range && typeof value === 'number') {
      range.value = value;
      card.querySelector('.param-value').textContent = `${value}x`;
    }
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

async function init() {
  games = await window.cheathub.listGames();
  for (const g of games) running[g.id] = g.running;

  if (games.length > 0) selectGame(games[0].id);

  window.cheathub.onGameStatus(({ gameId, running: isRunning }) => {
    running[gameId] = isRunning;
    renderGameList();
    if (gameId === selectedGameId) setConnectionStatus();
    if (!isRunning && gameId === selectedGameId) {
      bridgeConnected = false;
      setConnectionStatus();
    }
  });

  window.cheathub.onMinecraftBridge(({ event, payload }) => {
    if (event === 'connected') {
      bridgeConnected = true;
    } else if (event === 'disconnected') {
      bridgeConnected = false;
    } else if (event === 'state' && payload && payload.cheats) {
      applyRemoteCheatState(payload.cheats);
    }
    if (selectedGameId === 'minecraft') setConnectionStatus();
  });

  bridgeConnected = await window.cheathub.isMinecraftConnected();
  setConnectionStatus();
}

init();
