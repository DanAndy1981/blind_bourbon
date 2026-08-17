import { createStore, normalizeCode } from './store.js';
import { MAX_PLAYERS, PLAYER_NAME_MAX_LENGTH } from './registration.js';
import {
  BUY_CHOICES,
  HL_CHOICES,
  PHASES,
  calculateGame,
  clampPercent,
  formatMoney,
  formatNumber,
  phaseAtLeast,
  summarizePlayerProgress,
} from './scoring.js';
import { BOTTLE_LETTERS, activeBottlesFromDraft, hasBottleSetupInfo } from './setup.js';
import { renderTvScoreboard } from './scoreboard.js';
import {
  advanceEasterEggPresses,
  createFinalScoreboardEasterEggView,
  createParticipantEasterEggView,
  renderEasterEgg,
  shouldRenderAfterSnapshot,
} from './easter-egg.js';

const root = document.querySelector('#app');
const LETTERS = BOTTLE_LETTERS;
const SAVE_DELAY = 550;
const SERVICE_WORKER_UPDATE_INTERVAL = 5 * 60 * 1000;

let serviceWorkerRegistration = null;
let serviceWorkerUpdateTimer = null;

const state = {
  store: null,
  code: null,
  view: 'home',
  snapshot: null,
  playerId: null,
  currentLetter: null,
  homePanel: 'join',
  createDraft: null,
  hostTab: 'control',
  hostDraft: null,
  loading: true,
  error: null,
  polling: false,
  pollTimer: null,
  saveTimers: new Map(),
  saveStatus: 'saved',
  easterEggSessions: new Map(),
};

const esc = (value) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');

const selected = (value, expected) => String(value ?? '') === String(expected ?? '') ? 'selected' : '';
const disabled = (value) => value ? 'disabled' : '';
const pct = (value) => `${clampPercent(value)}%`;

function formatDate(value) {
  if (!value) return '';
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

function defaultCreateDraft() {
  return {
    title: 'Blind Bourbon Derby',
    eventDate: new Date().toISOString().slice(0, 10),
    theme: 'Tennessee Throwdown',
    bottles: LETTERS.slice(0, 5).map((letter) => ({
      letter,
      name: '',
      distillery: '',
      retailPrice: '',
      proof: '',
      notes: '',
    })),
  };
}

function getParams() {
  return new URLSearchParams(window.location.search);
}

function buildUrl(code = null, view = null) {
  const url = new URL(window.location.href);
  const demo = getParams().get('demo');
  url.search = '';
  url.hash = '';
  if (demo === '1') url.searchParams.set('demo', '1');
  if (code) url.searchParams.set('game', normalizeCode(code));
  if (view) url.searchParams.set('view', view);
  return url;
}

function navigate({ code = null, view = null, replace = false } = {}) {
  const url = buildUrl(code, view);
  history[replace ? 'replaceState' : 'pushState']({}, '', url);
  route();
}

function playerStorageKey(code) {
  return `blind-bourbon-derby::player::${normalizeCode(code)}`;
}

function getStoredPlayer(code) {
  return localStorage.getItem(playerStorageKey(code));
}

function storePlayer(code, playerId) {
  if (playerId) localStorage.setItem(playerStorageKey(code), playerId);
  else localStorage.removeItem(playerStorageKey(code));
}

function isTextEditing() {
  const active = document.activeElement;
  if (!active) return false;
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(active.tagName) || active.isContentEditable;
}

function isEasterEggSurpriseOpen() {
  return Boolean(root.querySelector('.tv-shower-surprise'));
}

function setSaveStatus(status, message = '') {
  state.saveStatus = status;
  const el = document.querySelector('#save-status');
  if (!el) return;
  el.dataset.status = status;
  el.textContent = message || (status === 'saving' ? 'Saving…' : status === 'error' ? 'Save failed' : 'Saved');
}

function toast(message, type = 'info') {
  let tray = document.querySelector('#toast-tray');
  if (!tray) return;
  const item = document.createElement('div');
  item.className = `toast toast-${type}`;
  item.textContent = message;
  tray.append(item);
  requestAnimationFrame(() => item.classList.add('show'));
  setTimeout(() => {
    item.classList.remove('show');
    setTimeout(() => item.remove(), 250);
  }, 3000);
}

async function safeAction(fn, { busyText = null } = {}) {
  try {
    if (busyText) toast(busyText);
    return await fn();
  } catch (error) {
    console.error(error);
    toast(error?.message || 'Something went wrong.', 'error');
    return null;
  }
}

function ownedPlayer(snapshot = state.snapshot) {
  return snapshot?.players?.find((player) => player.claimedBy === state.store.uid) || null;
}

function isHost(snapshot = state.snapshot) {
  return Boolean(snapshot && (state.store.mode === 'local' || snapshot.game.hostUid === state.store.uid));
}

async function loadSnapshot({ silent = false } = {}) {
  if (!state.code || state.polling) return;
  state.polling = true;
  try {
    const role = state.view === 'host' ? 'host' : state.view === 'scoreboard' ? 'scoreboard' : 'player';
    const storedPlayer = getStoredPlayer(state.code);
    const snapshot = await state.store.loadGame(state.code, { role, playerId: storedPlayer });
    state.snapshot = snapshot;
    if (snapshot) {
      const mine = ownedPlayer(snapshot);
      if (mine) {
        state.playerId = mine.id;
        storePlayer(state.code, mine.id);
      } else {
        state.playerId = null;
        if (storedPlayer) storePlayer(state.code, null);
      }
      const activeLetters = snapshot.bottles.filter((bottle) => bottle.active !== false).sort((a, b) => a.order - b.order).map((bottle) => bottle.letter);
      if (!state.currentLetter || !activeLetters.includes(state.currentLetter)) state.currentLetter = activeLetters[0] || null;
    }
    // Keep the third-press reveal mounted until the viewer closes its curtain.
    // Polling still refreshes state in the background, but replacing the DOM here
    // would restart the curtain animation every few seconds.
    if (shouldRenderAfterSnapshot({
      silent,
      textEditing: isTextEditing(),
      surpriseOpen: isEasterEggSurpriseOpen(),
    })) render();
  } finally {
    state.polling = false;
  }
}

async function route() {
  clearInterval(state.pollTimer);
  const params = getParams();
  state.code = normalizeCode(params.get('game')) || null;
  state.view = params.get('view') || (state.code ? 'player' : 'home');
  syncServiceWorkerUpdateSchedule();
  state.loading = Boolean(state.code);
  state.error = null;
  if (!state.code) {
    state.snapshot = null;
    state.loading = false;
    render();
    return;
  }
  render();
  await loadSnapshot();
  state.loading = false;
  render();
  state.pollTimer = setInterval(() => {
    const shouldPoll = state.view === 'scoreboard' || document.visibilityState === 'visible';
    if (shouldPoll && state.hostTab !== 'setup') loadSnapshot({ silent: true });
  }, 3500);
}

function requestServiceWorkerUpdate() {
  if (!serviceWorkerRegistration) return Promise.resolve();
  return serviceWorkerRegistration.update()
    .catch((error) => console.warn('Service worker update check failed:', error));
}

function syncServiceWorkerUpdateSchedule() {
  if (serviceWorkerUpdateTimer) clearInterval(serviceWorkerUpdateTimer);
  serviceWorkerUpdateTimer = null;
  if (state.view !== 'scoreboard' || !serviceWorkerRegistration) return;
  serviceWorkerUpdateTimer = setInterval(requestServiceWorkerUpdate, SERVICE_WORKER_UPDATE_INTERVAL);
}

async function registerServiceWorker() {
  try {
    serviceWorkerRegistration = await navigator.serviceWorker.register('./sw.js');
    await requestServiceWorkerUpdate();
    syncServiceWorkerUpdateSchedule();
  } catch (error) {
    console.warn('Service worker registration failed:', error);
  }
}

function modeNotice() {
  if (state.store.isShared) return '';
  return `
    <div class="mode-notice">
      <strong>Local demo mode:</strong> this browser can test the whole game, but phones will not share data yet.
      Add your Firebase configuration to turn on live multi-phone play.
    </div>`;
}

function shell(content) {
  const game = state.snapshot?.game;
  const homeUrl = buildUrl().toString();
  return `
    <div class="site-shell">
      <header class="topbar">
        <a class="mini-brand" href="${esc(homeUrl)}" data-action="go-home">
          <span class="mini-star">★</span>
          <span>Blind Bourbon Derby</span>
        </a>
        <div class="topbar-actions">
          ${state.code && game ? `<span class="game-code-chip">Game ${esc(game.code || state.code)}</span>` : ''}
          <span class="store-chip ${state.store.isShared ? 'shared' : 'local'}">${esc(state.store.label)}</span>
        </div>
      </header>
      ${modeNotice()}
      <main>${content}</main>
      <footer class="site-footer">
        <span>Built for a very serious scientific investigation of bourbon.</span>
        <span class="footer-stars">★ ★ ★</span>
      </footer>
    </div>
    <div id="toast-tray" class="toast-tray" aria-live="polite"></div>`;
}

function scoreboardShell(content) {
  return `
    <div class="scoreboard-shell">${content}</div>
    <div id="toast-tray" class="toast-tray" aria-live="polite"></div>`;
}

function render() {
  let content;
  if (state.loading) content = renderLoading();
  else if (!state.code) content = renderHome();
  else if (!state.snapshot) content = renderNotFound();
  else if (state.view === 'host') content = renderHost();
  else if (state.view === 'scoreboard') content = renderScoreboardPage();
  else content = renderPlayerRoute();
  const isStandaloneScoreboard = state.view === 'scoreboard';
  document.body.classList.toggle('scoreboard-mode', isStandaloneScoreboard);
  root.innerHTML = isStandaloneScoreboard ? scoreboardShell(content) : shell(content);
  setSaveStatus(state.saveStatus);
}

function renderLoading() {
  return `
    <section class="paper-panel loading-panel ink-frame">
      <div class="loader-barrel">🥃</div>
      <h1>Rolling out the barrels…</h1>
      <p>Loading the derby.</p>
    </section>`;
}

function renderNotFound() {
  return `
    <section class="paper-panel empty-state ink-frame">
      <div class="empty-icon">?</div>
      <h1>That derby wandered off.</h1>
      <p>No game was found for code <strong>${esc(state.code)}</strong>.</p>
      <form class="inline-form" data-form="join-game">
        <input name="code" maxlength="8" placeholder="Enter game code" autocomplete="off">
        <button class="btn btn-red" type="submit">Try Another Code</button>
      </form>
      <button class="btn btn-ghost" data-action="go-home">Back Home</button>
    </section>`;
}

function renderHome() {
  if (!state.createDraft) state.createDraft = defaultCreateDraft();
  return `
    <section class="hero ink-frame">
      <img src="./assets/derby-banner.webp" alt="Blind Bourbon Derby retro participant scorecard artwork">
      <div class="hero-overlay">
        <p class="eyebrow">Nashville's most needlessly elaborate blind tasting</p>
        <div class="hero-buttons">
          <button class="btn btn-red btn-lg" data-action="show-create">Start a Derby</button>
          <button class="btn btn-navy btn-lg" data-action="show-join">Join a Game</button>
        </div>
      </div>
    </section>

    <section class="home-grid">
      <article class="paper-panel ink-frame home-panel ${state.homePanel === 'join' ? 'active-panel' : ''}">
        <div class="ribbon-title"><span>Join the Tasting</span></div>
        <p>Enter the code your facilitator gives you, then pick your own name.</p>
        <form data-form="join-game" class="join-code-form">
          <label>Game Code
            <input name="code" maxlength="8" inputmode="text" autocomplete="off" placeholder="ABC123" required>
          </label>
          <button class="btn btn-navy btn-lg" type="submit">Find My Player Card</button>
        </form>
        ${!state.store.isShared ? `<button class="btn btn-gold" data-action="try-demo">Open the Populated Demo</button>` : ''}
      </article>

      <article class="paper-panel ink-frame home-panel ${state.homePanel === 'create' ? 'active-panel wide-panel' : ''}">
        <div class="ribbon-title red"><span>Facilitator's Booth</span></div>
        ${state.homePanel === 'create' ? renderCreateForm() : `
          <div class="host-teaser">
            <img src="./assets/moose.webp" alt="Cartoon moose mascot holding a bourbon glass">
            <div>
              <h2>Your wife runs the show.</h2>
              <p>She loads the secret bottle details, opens registration, controls each round, reveals the bourbons, and watches the leaderboard update.</p>
              <button class="btn btn-red" data-action="show-create">Build the Game</button>
            </div>
          </div>`}
      </article>
    </section>`;
}

function renderCreateForm() {
  const draft = state.createDraft;
  return `
    <form data-form="create-game" class="create-game-form">
      <div class="form-grid three">
        <label>Event Name
          <input name="title" value="${esc(draft.title)}" required>
        </label>
        <label>Date
          <input name="eventDate" type="date" value="${esc(draft.eventDate)}">
        </label>
        <label>Theme
          <input name="theme" value="${esc(draft.theme)}" placeholder="Bottled-in-Bond Battle">
        </label>
      </div>

      <div class="setup-section registration-explainer">
        <div><span class="kicker">10 open spots</span><h3>Players register themselves</h3></div>
        <p>Once the game is created, put the scoreboard on the TV. Your buddies scan its QR code, invent their own names, and claim a player card. Registration closes automatically when all ${MAX_PLAYERS} spots are filled.</p>
      </div>

      <div class="setup-section">
        <div class="section-heading">
          <div><span class="kicker">A through J</span><h3>Secret Bottle Vault</h3></div>
          <button type="button" class="btn btn-small btn-red" data-action="add-create-bottle" ${disabled(draft.bottles.length >= 10)}>+ Add Bottle</button>
        </div>
        <p class="host-warning">Enter a bourbon name to put that sample in play. Blank rows are ignored; the active field is capped at A–J.</p>
        <div class="bottle-setup-list">
          ${draft.bottles.map((bottle, index) => renderBottleSetupRow(bottle, index, 'create')).join('')}
        </div>
      </div>

      <div class="form-actions">
        <button class="btn btn-red btn-xl" type="submit">Create the Derby</button>
        <span class="fine-print">The facilitator should create the game on the browser she plans to use all night.</span>
      </div>
    </form>`;
}

function renderBottleSetupRow(bottle, index, context) {
  return `
    <div class="bottle-setup-row" data-${context}-bottle-row="${index}">
      <div class="sample-emblem">${esc(bottle.letter)}</div>
      <label>Bourbon Name<input data-${context}-bottle="${index}" data-field="name" value="${esc(bottle.name)}" placeholder="Secret until reveal"></label>
      <label>Distillery<input data-${context}-bottle="${index}" data-field="distillery" value="${esc(bottle.distillery)}"></label>
      <label>Retail $<input data-${context}-bottle="${index}" data-field="retailPrice" type="number" min="0" step="0.01" inputmode="decimal" value="${esc(bottle.retailPrice)}"></label>
      <label>Proof<input data-${context}-bottle="${index}" data-field="proof" type="number" min="0" step="0.1" inputmode="decimal" value="${esc(bottle.proof)}"></label>
      <label class="wide-field">Age / Notes<input data-${context}-bottle="${index}" data-field="notes" value="${esc(bottle.notes)}" placeholder="Age statement, mash bill, story…"></label>
      ${context === 'create' && state.createDraft.bottles.length > 2 ? `<button type="button" class="icon-btn remove-bottle" title="Remove bottle" data-action="remove-create-bottle" data-index="${index}">×</button>` : ''}
    </div>`;
}

function renderGameMasthead(game, subtitle = '') {
  return `
    <section class="game-masthead ink-frame">
      <div class="masthead-art"></div>
      <div class="masthead-copy">
        <div class="event-line">${esc(game.theme || 'Blind Tasting')}</div>
        <h1>${esc(game.title || 'Blind Bourbon Derby')}</h1>
        <div class="masthead-meta">
          ${game.eventDate ? `<span>${esc(formatDate(game.eventDate))}</span>` : ''}
          <span>Game ${esc(game.code || state.code)}</span>
          ${subtitle ? `<span>${esc(subtitle)}</span>` : ''}
        </div>
      </div>
    </section>`;
}

function renderPlayerRoute() {
  const mine = ownedPlayer();
  if (mine) {
    state.playerId = mine.id;
    return renderPlayerCard(mine);
  }
  if (state.playerId) {
    const player = state.snapshot.players.find((item) => item.id === state.playerId);
    if (player?.claimedBy === state.store.uid) return renderPlayerCard(player);
  }
  return renderJoinGame();
}

function renderJoinGame() {
  const { game, players } = state.snapshot;
  const registered = players.filter((player) => player.active !== false && player.name);
  const openSlots = players.filter((player) => player.active === false && !player.claimedBy);
  const releasedCards = registered.filter((player) => !player.claimedBy);
  return `
    ${renderGameMasthead(game, 'Register your player card')}
    <section class="join-layout">
      <article class="paper-panel ink-frame join-panel">
        <div class="ribbon-title"><span>Step Right Up</span></div>
        <div class="moose-corner"><img src="./assets/moose.webp" alt="Derby moose mascot"></div>
        <p class="lead">Write your own name—good decisions are optional. Your card stays attached to this phone for the rest of the game.</p>
        <div class="registration-count"><strong>${registered.length}</strong><span>of ${MAX_PLAYERS} player spots filled</span></div>
        ${openSlots.length ? `
          <form data-form="register-player" class="claim-form">
            <label>Your Name
              <input name="playerName" maxlength="${PLAYER_NAME_MAX_LENGTH}" autocomplete="nickname" placeholder="Make it funny…" required>
            </label>
            <button class="btn btn-red btn-xl" type="submit">Register & Open My Card</button>
          </form>` : `
          <p class="status-callout warning"><strong>Registration is closed.</strong> All ${MAX_PLAYERS} player spots are taken.</p>`}
        ${releasedCards.length ? `
          <form data-form="claim-player" class="claim-form reclaim-form">
            <label>Reclaim a released card
              <select name="playerId" required>
                <option value="">Select the name…</option>
                ${releasedCards.map((player) => `<option value="${esc(player.id)}">${esc(player.name)}</option>`).join('')}
              </select>
            </label>
            <button class="btn btn-navy" type="submit">Reclaim My Card</button>
          </form>` : ''}
        <div class="join-links">
          ${isHost() ? `<button class="btn btn-navy" data-action="open-host">Open Facilitator Booth</button>` : ''}
          ${phaseAtLeast(game.phase, 'reveal') ? `<button class="btn btn-gold" data-action="open-scoreboard">Watch the Scoreboard</button>` : ''}
        </div>
      </article>
      <aside class="paper-panel rules-card ink-frame">
        <h2>How this works</h2>
        <ol>
          <li>Taste every mystery glass and record your buy vote, price, proof, and final rank.</li>
          <li>Rank every sample once; rank 1 is your winner and the highest rank is your last-place pick.</li>
          <li>Play Higher / Lower against the group's average guesses.</li>
          <li>Watch the reveal and see who becomes the Bourbon Savant.</li>
        </ol>
      </aside>
    </section>`;
}

function renderPhaseBanner(game) {
  const phase = PHASES.find((item) => item.id === game.phase) || PHASES[0];
  const copy = {
    setup: 'The facilitator is loading the field. No peeking in the bottle vault.',
    tasting: 'Taste blind. Enter your buy vote, price, proof, and one unique final rank per sample.',
    higherLower: 'Initial guesses are locked. Beat the group average in Higher / Lower.',
    reveal: 'Pencils down. Watch the Live Results screen as the facilitator reveals the field.',
    final: 'The derby is official. Your blind card stays blind; the full show is on Live Results.',
  }[game.phase];
  return `<div class="phase-banner phase-${esc(game.phase)}"><strong>${esc(phase.label)}</strong><span>${esc(copy)}</span></div>`;
}

function renderPlayerCard(player) {
  const snapshot = state.snapshot;
  const calc = calculateGame(snapshot);
  const game = snapshot.game;
  const bottles = calc.bottles;
  const letter = state.currentLetter || bottles[0]?.letter;
  const bottle = calc.bottleResults.find((item) => item.letter === letter) || calc.bottleResults[0];
  const response = snapshot.responses.find((item) => item.playerId === player.id && item.bottleLetter === bottle?.letter) || {};
  const playerResult = calc.playerResults.find((item) => item.id === player.id);
  const tastingEditable = game.phase === 'tasting';
  const hlEditable = game.phase === 'higherLower';
  const notesEditable = game.phase === 'tasting' || game.phase === 'higherLower';
  const avg = game.publicAverages?.[bottle?.letter] || {};
  const easterEggSession = getEasterEggSession('player', game.phase, player.id);
  const easterEgg = createParticipantEasterEggView({
    gameCode: state.code,
    phase: game.phase,
    players: snapshot.players,
    playerId: player.id,
    presses: easterEggSession.presses,
    dismissed: easterEggSession.dismissed,
  });

  if (!bottle) return `${renderGameMasthead(game, player.name)}<section class="paper-panel empty-state ink-frame"><h2>No bottles are active yet.</h2></section>`;

  const usedRanks = new Map();
  for (const item of snapshot.responses.filter((item) => item.playerId === player.id && item.finalRank !== null && item.finalRank !== '' && item.bottleLetter !== bottle.letter)) {
    usedRanks.set(Number(item.finalRank), item.bottleLetter);
  }

  return `
    ${renderGameMasthead(game, player.name)}
    ${renderPhaseBanner(game)}
    <section class="player-topline paper-panel ink-frame">
      <div>
        <span class="kicker">Participant</span>
        <h2>${esc(player.name)}</h2>
      </div>
      <div class="player-progress">
        <div class="progress-label"><span>Blind card</span><strong>${pct(playerResult?.tastingProgress)}</strong></div>
        <div class="progress-track"><span style="width:${pct(playerResult?.tastingProgress)}"></span></div>
        <div class="progress-label"><span>Higher / Lower</span><strong>${pct(playerResult?.higherLowerProgress)}</strong></div>
        <div class="progress-track navy"><span style="width:${pct(playerResult?.higherLowerProgress)}"></span></div>
      </div>
      <div class="save-cluster">
        <span id="save-status" class="save-status" data-status="${esc(state.saveStatus)}">Saved</span>
        <button class="btn btn-small btn-ghost" data-action="release-player">Switch Name</button>
      </div>
    </section>

    ${game.phase === 'setup' ? `
      <section class="paper-panel waiting-panel ink-frame">
        <img src="./assets/moose.webp" alt="Moose waiting for the derby">
        <div><h2>The bottle vault is still open.</h2><p>Your card will unlock when the facilitator starts the blind tasting.</p></div>
      </section>` : `
      ${renderRankSummary(playerResult, calc.bottles.length)}
      <nav class="sample-tabs" aria-label="Mystery samples">
        ${bottles.map((item) => {
          const itemResponse = snapshot.responses.find((entry) => entry.playerId === player.id && entry.bottleLetter === item.letter) || {};
          const complete = BUY_CHOICES.includes(itemResponse.buyChoice) && itemResponse.priceGuess !== null && itemResponse.priceGuess !== '' && itemResponse.proofGuess !== null && itemResponse.proofGuess !== '' && itemResponse.finalRank;
          return `<button class="sample-tab ${item.letter === bottle.letter ? 'active' : ''} ${complete ? 'complete' : ''}" data-action="set-sample" data-letter="${item.letter}"><span>${item.letter}</span></button>`;
        }).join('')}
      </nav>

      <section class="sample-card ink-frame">
        <div class="sample-card-header">
          <div class="sample-letter-big">${esc(bottle.letter)}</div>
          <div>
            <span class="kicker">Mystery Glass</span>
            <h2>Sample ${esc(bottle.letter)}</h2>
            <p>No labels. No bottle shapes. No funny business.</p>
          </div>
        </div>

        <div class="player-fields ${!tastingEditable && !hlEditable && !notesEditable ? 'locked' : ''}">
          <fieldset ${disabled(!tastingEditable)}>
            <legend>Would I buy it?</legend>
            <div class="choice-grid buy-grid">
              ${BUY_CHOICES.map((choice) => `<button type="button" class="choice-button ${response.buyChoice === choice ? 'active' : ''}" data-action="select-buy" data-letter="${bottle.letter}" data-value="${esc(choice)}" ${disabled(!tastingEditable)}>${esc(choice)}</button>`).join('')}
            </div>
          </fieldset>

          <div class="guess-grid">
            <label>Price Guess
              <span class="input-prefix"><span aria-hidden="true">$</span><input aria-label="Price guess in dollars" data-response-field="priceGuess" data-letter="${bottle.letter}" type="number" min="0" step="1" inputmode="decimal" value="${esc(response.priceGuess ?? '')}" placeholder="45" ${disabled(!tastingEditable)}></span>
            </label>
            <label>Proof Guess
              <input data-response-field="proofGuess" data-letter="${bottle.letter}" type="number" min="0" step="1" inputmode="decimal" value="${esc(response.proofGuess ?? '')}" placeholder="100" ${disabled(!tastingEditable)}>
            </label>
            <label>Final Rank
              <select data-response-field="finalRank" data-letter="${bottle.letter}" ${disabled(!tastingEditable)}>
                <option value="">—</option>
                ${bottles.map((_, index) => {
                  const rank = index + 1;
                  const usedBy = usedRanks.get(rank);
                  return `<option value="${rank}" ${selected(response.finalRank, rank)} ${disabled(Boolean(usedBy))}>${rank}${usedBy ? ` — used by ${usedBy}` : ''}</option>`;
                }).join('')}
              </select>
            </label>
          </div>

          <label class="notes-field">Tasting Notes
            <textarea data-response-field="notes" data-letter="${bottle.letter}" rows="3" placeholder="Nose, palate, finish, wild accusations…" ${disabled(!notesEditable)}>${esc(response.notes || '')}</textarea>
          </label>

          ${phaseAtLeast(game.phase, 'higherLower') ? renderHigherLowerFields(bottle, response, avg, hlEditable) : ''}
        </div>

        <div class="sample-nav-buttons">
          <button class="btn btn-navy" data-action="sample-prev">← Previous</button>
          <span>${calc.bottles.findIndex((item) => item.letter === bottle.letter) + 1} of ${calc.bottles.length}</span>
          <button class="btn btn-red" data-action="sample-next">Next →</button>
        </div>
      </section>

      ${game.phase === 'final' ? renderPersonalScore(playerResult) : ''}`}
    ${renderEasterEgg(easterEgg)}
  `;
}

function renderRankSummary(playerResult, bottleCount) {
  return `
    <section class="rank-summary paper-panel ink-frame">
      <div class="rank-summary-icon">1</div>
      <div><strong>One ranking does it all</strong><span>Rank 1 is your winner. Rank ${bottleCount} is your last-place pick.</span></div>
      ${playerResult && !playerResult.rankSetValid && playerResult.tastingProgress > 0 ? `<div class="rank-warning">Use each rank exactly once, from 1 through ${bottleCount}.</div>` : ''}
    </section>`;
}

function renderHigherLowerFields(bottle, response, avg, editable) {
  return `
    <section class="higher-lower-card">
      <div class="ribbon-title small"><span>Higher / Lower</span></div>
      <div class="hl-grid">
        <div class="hl-question">
          <span class="hl-label">Club Price Guess</span>
          <strong>${avg.price !== null && avg.price !== undefined ? formatMoney(avg.price, 0) : 'Host will announce it'}</strong>
          <div class="choice-grid two">
            ${HL_CHOICES.map((choice) => `<button type="button" class="choice-button ${response.priceHL === choice ? 'active' : ''}" data-action="select-hl" data-field="priceHL" data-letter="${bottle.letter}" data-value="${choice}" ${disabled(!editable)}>${choice}</button>`).join('')}
          </div>
        </div>
        <div class="hl-question">
          <span class="hl-label">Club Proof Guess</span>
          <strong>${avg.proof !== null && avg.proof !== undefined ? `${formatNumber(avg.proof, 1)} proof` : 'Host will announce it'}</strong>
          <div class="choice-grid two">
            ${HL_CHOICES.map((choice) => `<button type="button" class="choice-button ${response.proofHL === choice ? 'active' : ''}" data-action="select-hl" data-field="proofHL" data-letter="${bottle.letter}" data-value="${choice}" ${disabled(!editable)}>${choice}</button>`).join('')}
          </div>
        </div>
      </div>
    </section>`;
}

function renderPersonalScore(player) {
  if (!player) return '';
  return `
    <section class="personal-score ink-frame">
      <div class="score-medallion">${player.total}</div>
      <div><span class="kicker">Your Final Score</span><h2>${player.rank === 1 ? 'Bourbon Savant Territory' : `Leaderboard Place #${player.rank}`}</h2></div>
      <div class="score-breakdown">
        <span>Price H/L <strong>${player.priceHL}</strong></span>
        <span>Proof H/L <strong>${player.proofHL}</strong></span>
        <span>Price Is Right <strong>${player.priceIsRight}</strong></span>
        <span>Ranked Winner <strong>${player.winnerPick}</strong></span>
        <span>Ranked Last <strong>${player.lastPick}</strong></span>
        <span>Bonus <strong>${player.bonus}</strong></span>
      </div>
      <button class="btn btn-gold" data-action="open-scoreboard">Open Full Scoreboard</button>
    </section>`;
}

function renderHost() {
  const snapshot = state.snapshot;
  if (!isHost(snapshot)) {
    return `
      ${renderGameMasthead(snapshot.game, 'Facilitator Booth')}
      <section class="paper-panel empty-state ink-frame">
        <div class="empty-icon">🔒</div>
        <h2>This browser is not the facilitator.</h2>
        <p>The host booth belongs to the browser that created the game. Open the player link instead.</p>
        <button class="btn btn-navy" data-action="open-player">Open Player Entrance</button>
      </section>`;
  }
  if (!state.hostDraft) state.hostDraft = makeHostDraft(snapshot);
  return `
    ${renderGameMasthead(snapshot.game, 'Facilitator Booth')}
    <section class="host-link-bar paper-panel ink-frame">
      <div><span class="kicker">Player Link</span><code>${esc(buildUrl(state.code).toString())}</code></div>
      <button class="btn btn-red" data-action="copy-link">Copy Link</button>
      <button class="btn btn-navy" data-action="share-link">Share</button>
      <button class="btn btn-gold" data-action="open-scoreboard">Scoreboard</button>
    </section>
    <nav class="host-tabs">
      <button class="${state.hostTab === 'control' ? 'active' : ''}" data-action="host-tab" data-tab="control">Game Control</button>
      <button class="${state.hostTab === 'setup' ? 'active' : ''}" data-action="host-tab" data-tab="setup">Event & Bottles</button>
      <button class="${state.hostTab === 'results' ? 'active' : ''}" data-action="host-tab" data-tab="results">Live Results</button>
    </nav>
    ${state.hostTab === 'setup' ? renderHostSetup() : state.hostTab === 'results' ? renderScoreboardBody(true) : renderHostControl()}`;
}

function makeHostDraft(snapshot) {
  const details = snapshot.details || {};
  return {
    title: snapshot.game.title || 'Blind Bourbon Derby',
    eventDate: snapshot.game.eventDate || '',
    theme: snapshot.game.theme || '',
    bottles: LETTERS.map((letter, index) => {
      const bottle = snapshot.bottles.find((item) => item.letter === letter);
      const detail = details[letter] || {};
      return {
        letter,
        active: Boolean(bottle && hasBottleSetupInfo(detail)),
        order: bottle?.order ?? index,
        name: detail.name || '',
        distillery: detail.distillery || '',
        retailPrice: detail.retailPrice ?? '',
        proof: detail.proof ?? '',
        notes: detail.notes || '',
      };
    }),
  };
}

function renderHostControl() {
  const snapshot = state.snapshot;
  const calc = calculateGame(snapshot);
  const game = snapshot.game;
  return `
    <section class="host-control-grid">
      <article class="paper-panel ink-frame phase-control-panel">
        <div class="ribbon-title red"><span>Round Control</span></div>
        <div class="phase-track">
          ${PHASES.map((phase, index) => `
            <button class="phase-step ${game.phase === phase.id ? 'active' : ''} ${phaseAtLeast(game.phase, phase.id) ? 'passed' : ''}" data-action="set-phase" data-phase="${phase.id}">
              <span>${index + 1}</span><strong>${esc(phase.short)}</strong>
            </button>`).join('')}
        </div>
        ${renderPhaseBanner(game)}
        <div class="control-actions">
          <button class="btn btn-navy" data-action="refresh">Refresh Now</button>
          <button class="btn btn-ghost" data-action="host-tab" data-tab="setup">Edit Setup</button>
        </div>
      </article>

      <article class="paper-panel ink-frame player-status-panel">
        <div class="section-heading"><div><span class="kicker">Live</span><h3>Player Status</h3></div><span>${calc.players.length} players</span></div>
        <div class="player-status-list">
          ${calc.playerResults.map((player) => {
            const activeProgress = game.phase === 'higherLower' ? player.higherLowerProgress : player.tastingProgress;
            const ready = game.phase === 'higherLower' ? player.higherLowerComplete : player.tastingComplete;
            return `<div class="player-status-row">
              <div class="claim-dot ${player.claimedBy ? 'claimed' : ''}"></div>
              <div class="status-name"><strong>${esc(player.name)}</strong><small>${player.claimedBy ? 'Card claimed' : 'Not joined yet'}</small></div>
              <div class="mini-progress"><span style="width:${pct(activeProgress)}"></span></div>
              <span class="ready-badge ${ready ? 'ready' : ''}">${ready ? 'Ready' : pct(activeProgress)}</span>
              ${player.claimedBy ? `<button class="icon-btn" title="Release player card" data-action="reset-claim" data-player-id="${esc(player.id)}">↺</button>` : ''}
            </div>`;
          }).join('')}
        </div>
      </article>
    </section>

    ${phaseAtLeast(game.phase, 'higherLower') ? renderHostHigherLower(calc) : ''}
    ${phaseAtLeast(game.phase, 'reveal') ? renderHostReveal(calc) : ''}
    ${renderBonusPanel(calc)}

    <section class="danger-zone paper-panel ink-frame">
      <div><h3>Reset tasting answers</h3><p>Clears every scorecard, bonus point, and reveal. Player names and bottles stay in place.</p></div>
      <button class="btn btn-danger" data-action="reset-answers">Reset Answers</button>
    </section>`;
}

function renderHostHigherLower(calc) {
  return `
    <section class="paper-panel ink-frame host-board">
      <div class="ribbon-title"><span>Live Higher / Lower Host Board</span></div>
      <p class="host-warning">Read the club average aloud. Players answer on their phones before you reveal the actual bottle.</p>
      <div class="host-board-grid">
        ${calc.bottleResults.map((bottle) => `
          <article class="host-board-card">
            <div class="sample-emblem">${bottle.letter}</div>
            <div><span>Avg Price</span><strong>${formatMoney(bottle.avgPriceGuess, 0)}</strong><small>Answer: ${esc(bottle.priceAnswer || '—')}</small></div>
            <div><span>Avg Proof</span><strong>${bottle.avgProofGuess !== null ? formatNumber(bottle.avgProofGuess, 1) : '—'}</strong><small>Answer: ${esc(bottle.proofAnswer || '—')}</small></div>
          </article>`).join('')}
      </div>
    </section>`;
}

function renderHostReveal(calc) {
  const next = calc.revealOrder.find((bottle) => !bottle.revealed);
  return `
    <section class="paper-panel ink-frame reveal-control">
      <div class="section-heading">
        <div><span class="kicker">Announce from last to first</span><h3>The Reveal Board</h3></div>
        <button class="btn btn-red" data-action="reveal-next" ${disabled(!next)}>Reveal Next ${next ? `(Sample ${next.letter})` : ''}</button>
      </div>
      ${!calc.revealOrder.length ? `<p class="status-callout warning">The reveal order appears after players submit valid final ranks.</p>` : `
        <div class="reveal-list">
          ${calc.revealOrder.map((bottle) => {
            const detail = calc.detailsByLetter[bottle.letter] || {};
            return `<div class="reveal-row ${bottle.revealed ? 'revealed' : ''}">
              <span class="finish-number">${bottle.clubPlace}</span>
              <span class="sample-emblem small">${bottle.letter}</span>
              <div><strong>${esc(detail.name || `Sample ${bottle.letter}`)}</strong><small>${esc(detail.distillery || 'Distillery not entered')} · Avg finish ${formatNumber(bottle.avgFinish, 2)}</small></div>
              <div class="reveal-price">${formatMoney(detail.retailPrice, 0)} · ${detail.proof ?? '—'} proof</div>
              <button class="btn btn-small ${bottle.revealed ? 'btn-ghost' : 'btn-red'}" data-action="${bottle.revealed ? 'hide-bottle' : 'reveal-bottle'}" data-letter="${bottle.letter}">${bottle.revealed ? 'Hide' : 'Reveal'}</button>
            </div>`;
          }).join('')}
        </div>`}
    </section>`;
}

function renderBonusPanel(calc) {
  return `
    <section class="paper-panel ink-frame bonus-panel">
      <div class="section-heading"><div><span class="kicker">Manual points</span><h3>Trivia / Bonus</h3></div><span>Saved on change</span></div>
      <div class="bonus-grid">
        ${calc.players.map((player) => `<label><span>${esc(player.name)}</span><input type="number" step="1" data-bonus-player="${esc(player.id)}" value="${esc(player.bonusPoints || 0)}"></label>`).join('')}
      </div>
    </section>`;
}

function renderHostSetup() {
  const draft = state.hostDraft || makeHostDraft(state.snapshot);
  state.hostDraft = draft;
  return `
    <section class="paper-panel ink-frame host-setup-panel">
      <div class="ribbon-title red"><span>Game Night Setup</span></div>
      <form data-form="host-setup">
        <div class="form-grid three">
          <label>Event Name<input name="title" value="${esc(draft.title)}" required></label>
          <label>Date<input name="eventDate" type="date" value="${esc(draft.eventDate)}"></label>
          <label>Theme<input name="theme" value="${esc(draft.theme)}"></label>
        </div>

        <div class="setup-section registration-explainer compact">
          <div><span class="kicker">QR self-registration</span><h3>Players manage their own names</h3></div>
          <p>${state.snapshot.players.filter((player) => player.active !== false).length} of ${MAX_PLAYERS} spots are filled. Use the Player Status panel to release a card if somebody needs to register again.</p>
        </div>

        <div class="setup-section">
          <div class="section-heading"><div><span class="kicker">A–J · blank names stay out</span><h3>Bottle Vault</h3></div><span>Details remain host-only</span></div>
          <p class="host-warning">A sample becomes active when its Bourbon field has a name. Clear the name to remove it from player cards.</p>
          <div class="host-bottle-list">
            ${draft.bottles.map((bottle, index) => `
              <div class="host-bottle-row ${hasBottleSetupInfo(bottle) ? 'active' : ''}">
                <div class="active-toggle" aria-label="Sample ${bottle.letter}"><span>${bottle.letter}</span></div>
                <label>Bourbon<input data-host-bottle="${index}" data-field="name" value="${esc(bottle.name)}"></label>
                <label>Distillery<input data-host-bottle="${index}" data-field="distillery" value="${esc(bottle.distillery)}"></label>
                <label>Retail $<input data-host-bottle="${index}" data-field="retailPrice" type="number" min="0" step="0.01" value="${esc(bottle.retailPrice)}"></label>
                <label>Proof<input data-host-bottle="${index}" data-field="proof" type="number" min="0" step="0.1" value="${esc(bottle.proof)}"></label>
                <label>Age / Notes<input data-host-bottle="${index}" data-field="notes" value="${esc(bottle.notes)}"></label>
              </div>`).join('')}
          </div>
        </div>

        <div class="form-actions sticky-actions">
          <button class="btn btn-red btn-xl" type="submit">Save Event & Bottles</button>
          <button class="btn btn-ghost" type="button" data-action="host-tab" data-tab="control">Cancel</button>
        </div>
      </form>
    </section>`;
}

function renderScoreboardPage() {
  const calc = calculateGame(state.snapshot);
  const joinUrl = buildUrl(state.code).toString();
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&format=svg&qzone=1&data=${encodeURIComponent(joinUrl)}`;
  const session = getEasterEggSession('scoreboard', state.snapshot.game.phase);
  const easterEgg = createFinalScoreboardEasterEggView({
    phase: state.snapshot.game.phase,
    presses: session.presses,
    dismissed: session.dismissed,
  });
  return renderTvScoreboard({ snapshot: state.snapshot, calc, joinUrl, qrUrl, easterEgg });
}

function getEasterEggSession(surface, phase, playerId = '') {
  const key = `${state.code || ''}:${surface}:${phase || ''}:${playerId || ''}`;
  if (!state.easterEggSessions.has(key)) {
    state.easterEggSessions.set(key, { presses: 0, dismissed: false });
  }
  return state.easterEggSessions.get(key);
}

function revealedName(bottle, details) {
  const detail = details[bottle.letter] || bottle.detail || {};
  return bottle.revealed ? (detail.name || `Sample ${bottle.letter}`) : 'Awaiting reveal';
}

function renderScoreboardBody(hostEmbed = false) {
  const snapshot = state.snapshot;
  const calc = calculateGame(snapshot);
  const game = snapshot.game;
  const scoreboardOpen = phaseAtLeast(game.phase, 'reveal');
  const champion = calc.winner;
  const savant = calc.savant;
  const valueChampion = calc.valueChampion;
  const upset = calc.biggestUpset;
  const biggestLosers = calc.biggestLosers || [];
  const biggestLoserNames = biggestLosers.map((player) => player.name).join(' & ');
  const columnCount = Math.min(5, Math.max(1, calc.rankedBottles.length));

  return `
    <div class="${hostEmbed ? 'scoreboard-host-body' : 'tv-scoreboard-body'} ${scoreboardOpen ? 'is-open' : 'is-waiting'}">
      <section class="tv-awards paper-panel ink-frame">
        <div class="scoreboard-section-title"><span>Winner Cards</span><small>Appear automatically as the bottles are revealed</small></div>
        <div class="champion-grid ${game.phase === 'final' ? 'finale' : ''}">
          ${renderChampionCard('Derby Champion', champion?.revealed ? revealedName(champion, calc.detailsByLetter) : 'Awaiting reveal', champion?.revealed ? `Sample ${champion.letter} · Club place #1` : 'The winning bottle is still under wraps', 'trophy', champion?.revealed)}
          ${renderChampionCard('Value Champion', valueChampion?.revealed ? revealedName(valueChampion, calc.detailsByLetter) : 'Awaiting reveal', valueChampion?.revealed ? `Value index ${formatNumber(valueChampion.valueIndex, 2)}` : 'Best finish for the money', 'dollar', valueChampion?.revealed)}
          ${renderChampionCard('Bourbon Savant', scoreboardOpen && savant ? savant.name : 'Leaderboard forming', scoreboardOpen && savant ? `${savant.total} points · Rank #${savant.rank}` : 'Game-show leaderboard winner', 'brain', scoreboardOpen && Boolean(savant))}
          ${renderChampionCard('Biggest Upset', upset?.revealed ? revealedName(upset, calc.detailsByLetter) : 'Awaiting reveal', upset?.revealed ? `${upset.upsetGap} places from price rank` : 'Price versus blind finish', 'upset', upset?.revealed)}
          ${renderChampionCard('Biggest Loser', game.phase === 'final' && biggestLoserNames ? biggestLoserNames : 'Awaiting final score', game.phase === 'final' && biggestLosers.length ? `${biggestLosers[0].total} points · welcome to the basement` : 'Poop trophy not yet awarded', 'poop', game.phase === 'final' && Boolean(biggestLoserNames))}
        </div>
      </section>

      <section class="tv-standings paper-panel ink-frame">
        <div class="scoreboard-section-title"><span>The Derby Finish</span><small>Last place to first place</small></div>
        ${!scoreboardOpen || !calc.rankedBottles.length ? `<div class="tv-waiting"><img src="./assets/moose.webp" alt="Moose waiting for the reveal"><p>${scoreboardOpen ? 'Waiting for valid final rankings.' : 'The finish appears when the facilitator starts the reveal.'}</p></div>` : `
          <div class="standings-list" style="--standing-columns:${columnCount}">
            ${calc.rankedBottles.map((bottle) => renderStandingCard(bottle, calc.detailsByLetter)).join('')}
          </div>`}
      </section>

      <section class="tv-leaderboard paper-panel ink-frame">
        <div class="scoreboard-section-title"><span>Bourbon Savant Leaderboard</span><small>Updates every few seconds</small></div>
        ${!scoreboardOpen ? `<div class="leaderboard-locked"><strong>Scores are under wraps</strong><span>Player standings unlock with The Reveal.</span></div>` : `
          <div class="leaderboard-list">
            ${calc.playerResults.map((player) => `<div class="leaderboard-row ${player.rank === 1 ? 'leader' : ''}">
              <span class="rank-circle">${player.rank}</span>
              <strong>${esc(player.name)}</strong>
              <span><small>H / L</small>${player.priceHL + player.proofHL}</span>
              <span><small>Rank pts</small>${player.winnerPick + player.lastPick}</span>
              <span class="total-cell"><small>Total</small>${player.total}</span>
            </div>`).join('')}
          </div>`}
      </section>
    </div>`;
}

function renderStandingCard(bottle, detailsByLetter) {
  if (!bottle.revealed) {
    return `<article class="standing-card is-hidden"><div class="hidden-reveal-mark">?</div><strong>Awaiting reveal</strong></article>`;
  }
  const detail = detailsByLetter[bottle.letter] || bottle.detail || {};
  const totalVotes = bottle.hellYes + bottle.maybe + bottle.nope || 1;
  return `<article class="standing-card place-${bottle.clubPlace} revealed">
    <div class="place-medallion">${bottle.clubPlace}</div>
    <div class="sample-letter-standing">${bottle.letter}</div>
    <div class="standing-main">
      <h3>${esc(detail.name || `Sample ${bottle.letter}`)}</h3>
      <p>${esc(detail.distillery || 'Distillery not entered')}</p>
      <div class="vote-bar" title="Hell Yes / Maybe / Nope"><span class="yes" style="width:${(bottle.hellYes / totalVotes) * 100}%"></span><span class="maybe" style="width:${(bottle.maybe / totalVotes) * 100}%"></span><span class="nope" style="width:${(bottle.nope / totalVotes) * 100}%"></span></div>
      <div class="vote-labels"><span>Yes ${bottle.hellYes}</span><span>Maybe ${bottle.maybe}</span><span>Nope ${bottle.nope}</span></div>
    </div>
    <div class="standing-actual"><span>${formatMoney(detail.retailPrice, 0)}</span><strong>${detail.proof ?? '—'} proof</strong></div>
  </article>`;
}

function renderChampionCard(title, name, detail, icon, visible = false) {
  const icons = { trophy: '★', dollar: '$', brain: '♛', upset: '!' };
  const iconMarkup = icon === 'poop'
    ? '<img src="./assets/biggest-loser-poop.webp" alt="Steaming cartoon poop trophy">'
    : icons[icon];
  return `
    <article class="champion-card ink-frame ${icon} ${visible ? 'is-revealed' : 'is-hidden'}">
      <div class="champion-icon">${iconMarkup}</div>
      <span>${esc(title)}</span>
      <h2>${esc(name)}</h2>
      <p>${esc(detail)}</p>
    </article>`;
}

function syncCreateDraftFromForm() {
  const form = document.querySelector('[data-form="create-game"]');
  if (!form || !state.createDraft) return;
  state.createDraft.title = form.elements.title?.value || '';
  state.createDraft.eventDate = form.elements.eventDate?.value || '';
  state.createDraft.theme = form.elements.theme?.value || '';
  form.querySelectorAll('[data-create-bottle]').forEach((input) => {
    const index = Number(input.dataset.createBottle);
    const field = input.dataset.field;
    if (state.createDraft.bottles[index]) state.createDraft.bottles[index][field] = input.value;
  });
}

function syncHostDraftFromForm() {
  const form = document.querySelector('[data-form="host-setup"]');
  if (!form || !state.hostDraft) return;
  state.hostDraft.title = form.elements.title?.value || '';
  state.hostDraft.eventDate = form.elements.eventDate?.value || '';
  state.hostDraft.theme = form.elements.theme?.value || '';
  form.querySelectorAll('[data-host-bottle]').forEach((input) => {
    const index = Number(input.dataset.hostBottle);
    const field = input.dataset.field;
    if (state.hostDraft.bottles[index]) state.hostDraft.bottles[index][field] = input.value;
  });
}

function currentResponse(letter) {
  let response = state.snapshot.responses.find((item) => item.playerId === state.playerId && item.bottleLetter === letter);
  if (!response) {
    response = { id: `${state.playerId}_${letter}`, playerId: state.playerId, bottleLetter: letter };
    state.snapshot.responses.push(response);
  }
  return response;
}

function updateResponse(letter, field, value, { immediate = false, rerender = false } = {}) {
  const response = currentResponse(letter);
  response[field] = value;
  setSaveStatus('saving');
  const key = `${letter}::${field}`;
  clearTimeout(state.saveTimers.get(key));
  const save = async () => {
    try {
      const progress = summarizePlayerProgress({
        bottles: state.snapshot.bottles,
        responses: state.snapshot.responses.filter((item) => item.playerId === state.playerId),
      });
      await state.store.saveResponse(state.code, state.playerId, letter, { [field]: value }, progress);
      setSaveStatus('saved');
    } catch (error) {
      console.error(error);
      setSaveStatus('error', 'Save failed — tap again');
      toast(error.message || 'Could not save that answer.', 'error');
    }
  };
  if (immediate) save();
  else state.saveTimers.set(key, setTimeout(save, SAVE_DELAY));
  if (rerender) render();
}

root.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const action = button.dataset.action;

  if (action === 'press-easter-egg') {
    const surface = state.view === 'scoreboard' ? 'scoreboard' : 'player';
    const phase = state.snapshot?.game?.phase;
    const playerId = surface === 'player' ? state.playerId : '';
    if (!phase || (surface === 'player' && !playerId)) return;
    const session = getEasterEggSession(surface, phase, playerId);
    session.presses = advanceEasterEggPresses(session.presses);
    render();
    if (surface === 'player' && session.presses === 3) {
      await safeAction(async () => {
        await state.store.completeEasterEgg(state.code, playerId, phase);
        const player = state.snapshot.players.find((item) => item.id === playerId);
        if (player) Object.assign(player, { easterEggCompleted: true, easterEggCompletedStage: phase });
        render();
      });
    }
    return;
  }
  if (action === 'dismiss-easter-egg') {
    const surprise = button.closest('.tv-shower-surprise');
    const surface = surprise?.dataset.easterSurface || (state.view === 'scoreboard' ? 'scoreboard' : 'player');
    const phase = surprise?.dataset.easterPhase || state.snapshot?.game?.phase;
    const playerId = surface === 'player' ? (surprise?.dataset.easterPlayerId || state.playerId) : '';
    if (!phase || (surface === 'player' && !playerId)) return;
    getEasterEggSession(surface, phase, playerId).dismissed = true;
    surprise?.remove();
    render();
    return;
  }

  if (action === 'go-home') {
    event.preventDefault();
    navigate();
    return;
  }
  if (action === 'show-create') {
    state.homePanel = 'create';
    render();
    return;
  }
  if (action === 'show-join') {
    state.homePanel = 'join';
    render();
    return;
  }
  if (action === 'add-create-bottle') {
    syncCreateDraftFromForm();
    const letter = LETTERS[state.createDraft.bottles.length];
    if (letter) state.createDraft.bottles.push({ letter, name: '', distillery: '', retailPrice: '', proof: '', notes: '' });
    render();
    return;
  }
  if (action === 'remove-create-bottle') {
    syncCreateDraftFromForm();
    state.createDraft.bottles.splice(Number(button.dataset.index), 1);
    state.createDraft.bottles.forEach((bottle, index) => { bottle.letter = LETTERS[index]; });
    render();
    return;
  }
  if (action === 'try-demo') {
    const url = buildUrl('DEMO26', 'scoreboard');
    url.searchParams.set('demo', '1');
    window.location.href = url.toString();
    return;
  }
  if (action === 'open-host') { navigate({ code: state.code, view: 'host' }); return; }
  if (action === 'open-scoreboard') { navigate({ code: state.code, view: 'scoreboard' }); return; }
  if (action === 'open-player') { navigate({ code: state.code }); return; }
  if (action === 'refresh') { await loadSnapshot(); toast('Game refreshed.'); return; }
  if (action === 'copy-link') {
    await navigator.clipboard.writeText(buildUrl(state.code).toString());
    toast('Player link copied.');
    return;
  }
  if (action === 'share-link') {
    const shareData = { title: 'Blind Bourbon Derby', text: `Join game ${state.code}`, url: buildUrl(state.code).toString() };
    if (navigator.share) await navigator.share(shareData);
    else {
      await navigator.clipboard.writeText(shareData.url);
      toast('Player link copied.');
    }
    return;
  }
  if (action === 'release-player') {
    if (!state.playerId) return;
    await safeAction(() => state.store.releasePlayer(state.code, state.playerId));
    storePlayer(state.code, null);
    state.playerId = null;
    await loadSnapshot();
    return;
  }
  if (action === 'set-sample') {
    state.currentLetter = button.dataset.letter;
    render();
    window.scrollTo({ top: document.querySelector('.sample-tabs')?.offsetTop - 20 || 0, behavior: 'smooth' });
    return;
  }
  if (action === 'sample-prev' || action === 'sample-next') {
    const letters = state.snapshot.bottles.filter((bottle) => bottle.active !== false).sort((a, b) => a.order - b.order).map((bottle) => bottle.letter);
    const index = letters.indexOf(state.currentLetter);
    const delta = action === 'sample-prev' ? -1 : 1;
    state.currentLetter = letters[(index + delta + letters.length) % letters.length];
    render();
    window.scrollTo({ top: document.querySelector('.sample-tabs')?.offsetTop - 20 || 0, behavior: 'smooth' });
    return;
  }
  if (action === 'select-buy') {
    updateResponse(button.dataset.letter, 'buyChoice', button.dataset.value, { immediate: true, rerender: true });
    return;
  }
  if (action === 'select-hl') {
    updateResponse(button.dataset.letter, button.dataset.field, button.dataset.value, { immediate: true, rerender: true });
    return;
  }
  if (action === 'host-tab') {
    if (state.hostTab === 'setup') syncHostDraftFromForm();
    state.hostTab = button.dataset.tab;
    if (state.hostTab === 'setup' && !state.hostDraft) state.hostDraft = makeHostDraft(state.snapshot);
    render();
    return;
  }
  if (action === 'set-phase') {
    const nextPhase = button.dataset.phase;
    const calc = calculateGame(state.snapshot);
    const patch = { phase: nextPhase };
    if (nextPhase === 'higherLower') {
      patch.publicAverages = Object.fromEntries(calc.bottleResults.map((bottle) => [bottle.letter, {
        price: bottle.avgPriceGuess,
        proof: bottle.avgProofGuess,
      }]));
    }
    if (nextPhase === 'tasting' || nextPhase === 'setup') patch.publicAverages = {};
    await safeAction(async () => {
      await state.store.updateGame(state.code, patch);
      await loadSnapshot();
      toast(`Round changed to ${PHASES.find((phase) => phase.id === nextPhase)?.label}.`);
    });
    return;
  }
  if (action === 'reveal-bottle' || action === 'hide-bottle') {
    await safeAction(async () => {
      await state.store.revealBottle(state.code, button.dataset.letter, action === 'reveal-bottle');
      await loadSnapshot();
    });
    return;
  }
  if (action === 'reveal-next') {
    const calc = calculateGame(state.snapshot);
    const next = calc.revealOrder.find((bottle) => !bottle.revealed);
    if (!next) return;
    await safeAction(async () => {
      await state.store.revealBottle(state.code, next.letter, true);
      await loadSnapshot();
      toast(`Sample ${next.letter} revealed: ${calc.detailsByLetter[next.letter]?.name || 'mystery bottle'}.`);
    });
    return;
  }
  if (action === 'reset-claim') {
    await safeAction(async () => {
      await state.store.resetPlayerClaim(state.code, button.dataset.playerId);
      await loadSnapshot();
      toast('Player card released.');
    });
    return;
  }
  if (action === 'reset-answers') {
    if (!confirm('Clear every player answer, bonus point, and reveal? This cannot be undone.')) return;
    await safeAction(async () => {
      await state.store.resetAnswers(state.code);
      await loadSnapshot();
      toast('All tasting answers were reset.');
    });
  }
});

root.addEventListener('submit', async (event) => {
  const form = event.target.closest('form[data-form]');
  if (!form) return;
  event.preventDefault();
  const type = form.dataset.form;

  if (type === 'join-game') {
    const code = normalizeCode(new FormData(form).get('code'));
    if (!code) return;
    navigate({ code });
    return;
  }

  if (type === 'claim-player') {
    const playerId = new FormData(form).get('playerId');
    if (!playerId) return;
    await safeAction(async () => {
      await state.store.claimPlayer(state.code, playerId);
      state.playerId = playerId;
      storePlayer(state.code, playerId);
      await loadSnapshot();
      toast('Player card claimed. Good luck.');
    });
    return;
  }

  if (type === 'register-player') {
    const playerName = new FormData(form).get('playerName');
    await safeAction(async () => {
      const playerId = await state.store.registerPlayer(state.code, playerName);
      state.playerId = playerId;
      storePlayer(state.code, playerId);
      await loadSnapshot();
      toast('You are registered. Let the questionable decisions begin.');
    });
    return;
  }

  if (type === 'create-game') {
    syncCreateDraftFromForm();
    const bottles = activeBottlesFromDraft(state.createDraft.bottles);
    if (bottles.length < 2) { toast('Add at least two bottles.', 'error'); return; }
    await safeAction(async () => {
      const code = await state.store.createGame({ ...state.createDraft, bottles });
      state.hostDraft = null;
      navigate({ code, view: 'host' });
    }, { busyText: 'Creating the derby…' });
    return;
  }

  if (type === 'host-setup') {
    syncHostDraftFromForm();
    const bottles = activeBottlesFromDraft(state.hostDraft.bottles);
    if (bottles.length < 2) { toast('Keep at least two active bottles.', 'error'); return; }
    await safeAction(async () => {
      await state.store.saveSetup(state.code, { ...state.hostDraft, bottles });
      state.hostDraft = null;
      state.hostTab = 'control';
      await loadSnapshot();
      toast('Event and bottles saved.');
    });
  }
});

root.addEventListener('input', (event) => {
  const input = event.target.closest('[data-response-field]');
  if (input) {
    const field = input.dataset.responseField;
    let value = input.value;
    if (input.type === 'number' || field === 'finalRank') value = value === '' ? null : Number(value);
    updateResponse(input.dataset.letter, field, value, { immediate: false, rerender: false });
  }
});

root.addEventListener('change', async (event) => {
  const responseInput = event.target.closest('[data-response-field]');
  if (responseInput) {
    const field = responseInput.dataset.responseField;
    let value = responseInput.value;
    if (responseInput.type === 'number' || field === 'finalRank') value = value === '' ? null : Number(value);
    updateResponse(responseInput.dataset.letter, field, value, { immediate: true, rerender: field === 'finalRank' });
    return;
  }
  const bonusInput = event.target.closest('[data-bonus-player]');
  if (bonusInput) {
    await safeAction(async () => {
      await state.store.setBonus(state.code, bonusInput.dataset.bonusPlayer, Number(bonusInput.value || 0));
      await loadSnapshot({ silent: true });
      toast('Bonus points saved.');
    });
  }
});

window.addEventListener('popstate', route);
window.addEventListener('beforeunload', () => {
  for (const timer of state.saveTimers.values()) clearTimeout(timer);
  if (serviceWorkerUpdateTimer) clearInterval(serviceWorkerUpdateTimer);
});

async function boot() {
  try {
    root.innerHTML = `<div class="boot-screen"><div class="loader-barrel">🥃</div><h1>Blind Bourbon Derby</h1><p>Opening the game-show tent…</p></div>`;
    const forceLocal = getParams().get('demo') === '1';
    state.store = await createStore({ forceLocal });
    const params = getParams();
    if (forceLocal && params.get('game') === 'DEMO26') await state.store.createDemoGame();
    if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
      registerServiceWorker();
    }
    await route();
  } catch (error) {
    console.error(error);
    root.innerHTML = shell(`
      <section class="paper-panel empty-state ink-frame">
        <div class="empty-icon">!</div>
        <h1>The derby could not start.</h1>
        <p>${esc(error.message || error)}</p>
        <p class="fine-print">The most common cause is Firebase being configured before Anonymous Authentication or Firestore rules are enabled.</p>
      </section>`);
  }
}

boot();
