import { PHASES, formatMoney, formatNumber } from './scoring.js';
import { renderEasterEgg } from './easter-egg.js';
import { selectRevealTastingNotes, tastingNotePreview } from './tasting-notes.js';
import { MAX_PLAYERS } from './registration.js';
import { finaleCueMatches, normalizeFinaleState } from './finale.js';
import { DRUNK_FRIENDLY_RULES } from './game-rules.js';

const esc = (value) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');

const boundedPercent = (value) => Math.round(Math.max(0, Math.min(1, Number(value) || 0)) * 100);
const playerNames = (players) => players.map((player) => player.name).join(' & ');

export function scoreboardStage(phase) {
  return PHASES.some((item) => item.id === phase) ? phase : 'setup';
}

export function renderTvScoreboard({ snapshot, calc, joinUrl, qrUrl, easterEgg = null, activeCue = null }) {
  const game = snapshot.game;
  const stage = scoreboardStage(game.phase);
  return `
    <main class="tv-gameboard tv-phase-${esc(stage)}" data-tv-phase="${esc(stage)}">
      <div class="tv-bulb-frame" aria-hidden="true"></div>
      ${renderPhaseMarquee(game, stage)}
      ${renderJoinBug(game, joinUrl, qrUrl)}
      ${renderStage(stage, game, calc, activeCue)}
      ${renderEasterEgg(easterEgg)}
    </main>`;
}

function renderPhaseMarquee(game, stage) {
  const labels = {
    setup: ['Contestant Call', 'Welcome to the Bourbon Derby'],
    tasting: ['Round One', 'Mystery Glass Tote Board'],
    higherLower: ['Round Two', 'Higher or Lower?'],
    reveal: ['The Main Event', 'Open the Bottle Vault'],
    final: ['Official Results', 'Champions & Questionable Decisions'],
  };
  const [kicker, title] = labels[stage];
  return `
    <div class="tv-phase-marquee" aria-label="${esc(title)}">
      <span>${esc(kicker)}</span>
      <strong>${esc(title)}</strong>
      <small>${esc(game.title || 'Blind Bourbon Derby')}</small>
    </div>`;
}

function renderJoinBug(game, joinUrl, qrUrl) {
  return `
    <aside class="tv-join-bug">
      <img src="${esc(qrUrl)}" alt="QR code to join game ${esc(game.code)}">
      <div><span>Scan to play</span><strong>${esc(game.code)}</strong><small>${esc(joinUrl)}</small></div>
    </aside>`;
}

function renderStage(stage, game, calc, activeCue) {
  if (stage === 'tasting') return renderTastingStage(calc);
  if (stage === 'higherLower') return renderHigherLowerStage(game, calc);
  if (stage === 'reveal') return renderRevealStage(calc, activeCue);
  if (stage === 'final') return renderFinalStage(calc, activeCue);
  return renderLobbyStage(calc);
}

function renderLobbyStage(calc) {
  const joined = calc.players.length;
  return `
    <section class="tv-stage tv-lobby-stage">
      <div class="tv-lobby-copy">
        <span class="tv-neon-kicker">Live from the bourbon basement</span>
        <h1>Come on down,<br>you magnificent idiots.</h1>
        <p>Scan the code, invent a ridiculous name, and register your own contestant card.</p>
        <div class="tv-lobby-count"><strong>${joined}</strong><span>of ${MAX_PLAYERS} player spots filled</span></div>
        <div class="tv-contestant-strip">
          ${calc.players.length ? calc.players.map((player) => `
            <div class="is-joined"><span>★</span><strong>${esc(player.name)}</strong></div>`).join('') : '<div><span>○</span><strong>Waiting for the first brave idiot…</strong></div>'}
        </div>
        <div class="tv-drunk-rules" aria-label="How to win the Bourbon Derby">
          ${DRUNK_FRIENDLY_RULES.map((rule) => `
            <article class="tv-drunk-rule rule-${esc(rule.id)}">
              <b>${esc(rule.points)}</b>
              <div><strong>${esc(rule.title)}</strong><span>${esc(rule.copy)}</span></div>
            </article>`).join('')}
        </div>
      </div>
      <img class="tv-lobby-moose" src="./assets/moose-moonshiner.webp" alt="The Drunk Moose moonshiner welcomes contestants beside his copper still">
    </section>`;
}

function renderTastingStage(calc) {
  const ready = calc.playerResults.filter((player) => player.tastingComplete).length;
  const letters = calc.bottles.map((bottle) => bottle.letter);
  return `
    <section class="tv-stage tv-tasting-stage">
      <div class="tv-progress-grid" style="--player-columns:${Math.min(5, Math.max(1, calc.playerResults.length))}">
        ${calc.playerResults.map((player, index) => renderPlayerProgress(player, letters, index)).join('')}
      </div>
      <aside class="tv-tasting-rail">
        <img src="./assets/moose-bourbon-creek.webp" alt="The same X-eyed Drunk Moose in his tasting clothes licks bourbon flowing from the copper still">
        <div class="tv-ready-counter"><strong>${ready}<small>/ ${calc.playerResults.length}</small></strong><span>Palates locked</span></div>
        <p>${ready === calc.playerResults.length && ready ? 'Every glass is scored. Somebody ring the bell.' : 'Scores move live as every mystery glass gets finished.'}</p>
      </aside>
    </section>`;
}

function renderPlayerProgress(player, letters, index) {
  const completed = new Set(player.tastingCompletedLetters || []);
  const percent = boundedPercent(player.tastingProgress);
  return `
    <article class="tv-player-progress ${player.tastingComplete ? 'is-ready' : ''}" style="--player-index:${index}">
      <div class="tv-player-heading"><span>${index + 1}</span><strong>${esc(player.name)}</strong><b>${player.tastingComplete ? 'LOCKED' : `${percent}%`}</b></div>
      <div class="tv-glass-pips" aria-label="${percent}% complete">
        ${letters.map((letter) => `<span class="${completed.has(letter) ? 'is-done' : ''}">${esc(letter)}</span>`).join('')}
      </div>
      ${renderPlayerTastingNotes(player, letters)}
      <div class="tv-tasting-progress" style="--tasting-progress:${percent}%" role="progressbar" aria-label="${esc(player.name)} tasting progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent}" aria-valuetext="${percent}% complete">
        <span class="tv-tasting-progress-track" aria-hidden="true"><i></i></span>
        <strong class="tv-tasting-progress-value">${percent}%</strong>
      </div>
      <small>${player.tastingComplete ? 'Ready for the next round' : 'Nosing · guessing · making things up'}</small>
    </article>`;
}

function renderPlayerTastingNotes(player, letters) {
  const notes = player.tastingNotesByLetter || {};
  const entries = letters
    .map((letter) => ({ letter, note: tastingNotePreview(notes[letter]) }))
    .filter((item) => item.note);
  if (!entries.length) return '<p class="tv-player-notes-empty">Notes hit the board as they type.</p>';
  return `
    <ul class="tv-player-notes" aria-label="${esc(player.name)} tasting notes">
      ${entries.map((item) => `<li><b>${esc(item.letter)}</b><span>${esc(item.note)}</span></li>`).join('')}
    </ul>`;
}

function progressBottleMood(percent) {
  if (percent >= 100) return 'hammered';
  if (percent >= 75) return 'wobbly';
  if (percent >= 50) return 'tipsy';
  if (percent >= 25) return 'warming';
  return 'sober';
}

function renderHigherLowerStage(game, calc) {
  const ready = calc.playerResults.filter((player) => player.higherLowerComplete).length;
  return `
    <section class="tv-stage tv-hl-stage">
      <div class="tv-hl-copy">
        <div class="tv-crowd-call"><span>HIGHER!</span><b>or</b><span>LOWER!</span></div>
        <p>The club average is on the board. Lock in both calls for every mystery bottle.</p>
        <div class="tv-hl-grid" style="--hl-columns:${Math.min(5, Math.max(1, calc.bottles.length))}">
          ${calc.bottles.map((bottle) => renderHigherLowerBottle(bottle, game.publicAverages?.[bottle.letter], calc.playerResults)).join('')}
        </div>
      </div>
      <aside class="tv-hl-host">
        <div class="tv-hl-ready"><strong>${ready}<small>/${calc.playerResults.length}</small></strong><span>crowd cards locked</span></div>
        <img src="./assets/moose-game-show-host.webp" alt="The Drunk Moose with X-shaped eyes holds bourbon and a long game-show wand microphone in his sweaty velvet suit">
        <p>“The crowd has opinions. Accuracy remains under investigation.”</p>
      </aside>
    </section>`;
}

function renderHigherLowerBottle(bottle, averages = {}, players) {
  const locked = players.filter((player) => (player.higherLowerCompletedLetters || []).includes(bottle.letter)).length;
  const fill = players.length ? Math.round((locked / players.length) * 100) : 0;
  const mood = progressBottleMood(fill);
  return `
    <article class="tv-hl-bottle-card">
      <div class="tv-sample-letter">${esc(bottle.letter)}</div>
      <div class="tv-drunk-bottle ${mood}" style="--bottle-fill:${fill}%" role="progressbar" aria-label="Sample ${esc(bottle.letter)} crowd lock-in progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${fill}" aria-valuetext="${locked} of ${players.length} crowd cards locked, ${fill}%">
        <span class="tv-drunk-bottle-liquid" aria-hidden="true"></span>
        <span class="tv-drunk-bottle-face" aria-hidden="true">
          <span class="tv-drunk-bottle-eyes"><i></i><i></i></span>
          <span class="tv-drunk-bottle-mouth"></span>
        </span>
        <span class="tv-drunk-bottle-arms" aria-hidden="true"><i></i><i></i></span>
        <span class="tv-drunk-bottle-legs" aria-hidden="true"><i></i><i></i></span>
        <strong class="tv-drunk-bottle-value">${fill}%</strong>
      </div>
      <div class="tv-hl-values">
        <span><small>Club price guess</small>${formatMoney(averages?.price, 0)}</span>
        <span><small>Club proof guess</small>${formatNumber(averages?.proof, 0)}°</span>
      </div>
      <div class="tv-hl-arrows"><span>↑ Higher</span><span>↓ Lower</span></div>
      <small class="tv-calls-locked">${locked}/${players.length} calls locked</small>
    </article>`;
}

function renderRevealStage(calc, activeCue) {
  const finale = normalizeFinaleState(calc.game, { legacyFinalOpen: false });
  if (finale.scene === 'players') return renderPlayerRevealStage(calc, finale, activeCue);
  if (finale.scene === 'awards') return renderAwardsRevealStage(calc, finale, activeCue);

  const revealOrder = calc.revealOrder.length ? calc.revealOrder : calc.bottleResults;
  const revealedCount = calc.bottles.filter((bottle) => bottle.revealed).length;
  return `
    <section class="tv-stage tv-reveal-stage">
      <div class="tv-reveal-board">
        <div class="tv-stage-title"><strong>The Derby Finish</strong><span>The host controls every curtain</span></div>
        <div class="tv-reveal-grid" style="--reveal-columns:${Math.min(5, Math.max(1, revealOrder.length))}">
          ${revealOrder.map((bottle) => renderRevealBottle(bottle, calc, activeCue)).join('')}
        </div>
      </div>
      <aside class="tv-score-rail">
        <div class="tv-vault-meter"><strong>${revealedCount}<small>/${calc.bottles.length}</small></strong><span>Bottles out of the vault</span></div>
        <div class="tv-bottle-award-stack">
          ${renderDerbyChampionAward(calc, activeCue)}
          ${renderRevealBottleAward("Punches Above Its Weight", calc.biggestUpset, finale.biggestUpsetRevealed, calc, 'biggestUpset', activeCue)}
          ${renderRevealBottleAward('Biggest Waste of Money', calc.biggestDisappointment, finale.biggestDisappointmentRevealed, calc, 'biggestDisappointment', activeCue)}
        </div>
        <p class="tv-reveal-instruction">Next up: player standings, then the Savant and Biggest Loser curtains.</p>
      </aside>
    </section>`;
}

function curtainClasses(open, cueActive = false) {
  return `tv-curtain-card ${open ? 'is-curtain-open' : 'is-curtain-closed'} ${cueActive ? 'is-curtain-cue' : ''}`;
}

function renderRevealBottle(bottle, calc, activeCue) {
  const place = bottle.clubPlace || '—';
  const cueActive = finaleCueMatches(activeCue, 'bottle', bottle.letter);
  if (!bottle.revealed) {
    return `
      <article class="tv-reveal-card is-hidden ${curtainClasses(false)}">
        <span class="tv-place-chip">#${place}</span><strong>?</strong><p>Behind the curtain</p>
      </article>`;
  }
  const detail = calc.detailsByLetter[bottle.letter] || bottle.detail || {};
  const tastingNotes = selectRevealTastingNotes({
    responses: bottle.responses,
    players: calc.players,
    gameCode: calc.game.code,
    bottleLetter: bottle.letter,
    bottleCount: calc.bottles.length,
  });
  return `
    <article class="tv-reveal-card is-revealed place-${place} ${curtainClasses(true, cueActive)}">
      <span class="tv-place-chip">#${place}</span>
      <b>Sample ${esc(bottle.letter)}</b>
      <h3>${esc(detail.name || `Sample ${bottle.letter}`)}</h3>
      <p>${esc(detail.distillery || 'Mystery distillery')}</p>
      <div><span>${formatMoney(detail.retailPrice, 0)}</span><span>${detail.proof ?? '—'} proof</span></div>
      ${tastingNotes.length ? `
        <ul class="tv-reveal-notes" aria-label="Selected tasting notes for Sample ${esc(bottle.letter)}">
          ${tastingNotes.map((item) => `<li><q>${esc(item.note)}</q><span>— ${esc(item.playerName)}</span></li>`).join('')}
        </ul>` : ''}
    </article>`;
}

function renderDerbyChampionAward(calc, activeCue) {
  const bottle = calc.winner;
  const visible = Boolean(bottle?.revealed);
  const detail = bottle ? calc.detailsByLetter[bottle.letter] || bottle.detail || {} : {};
  return `
    <article class="tv-special-bottle-award is-derby ${curtainClasses(visible, finaleCueMatches(activeCue, 'bottle', bottle?.letter || ''))}">
      <div class="tv-derby-star" aria-hidden="true">★</div>
      <div class="tv-bottle-award-copy">
        <span>Derby Champion</span>
        <strong>${visible && bottle ? esc(detail.name || `Sample ${bottle.letter}`) : 'Behind the curtain'}</strong>
        <small>${visible && bottle ? `Sample ${esc(bottle.letter)} · First across the finish line` : 'The winning bourbon'}</small>
      </div>
    </article>`;
}

function renderRevealBottleAward(title, bottle, visible, calc, cueType, activeCue) {
  const detail = bottle ? calc.detailsByLetter[bottle.letter] || bottle.detail || {} : {};
  const isUpset = cueType === 'biggestUpset';
  const detailLine = isUpset
    ? `${formatNumber(bottle?.upsetGap, 0)} places above its price rank`
    : `${formatNumber(bottle?.disappointmentGap, 0)} places below its price rank`;
  const asset = isUpset ? 'award-honey-badger.webp' : 'award-burning-money.webp';
  const alt = isUpset
    ? 'A bruiser rubber-hose cartoon honey badger boxer'
    : 'A miserable rubber-hose cartoon bundle of green money burning';
  return `
    <article class="tv-special-bottle-award ${isUpset ? 'is-upset' : 'is-disappointment'} ${curtainClasses(visible, finaleCueMatches(activeCue, cueType))}">
      ${visible ? `<img class="tv-bottle-award-art" src="./assets/${asset}" alt="${alt}">` : '<div class="tv-bottle-award-question" aria-hidden="true">?</div>'}
      <div class="tv-bottle-award-copy">
        <span>${esc(title)}</span>
        <strong>${visible && bottle ? esc(detail.name || `Sample ${bottle.letter}`) : 'Behind the curtain'}</strong>
        <small>${visible && bottle ? `Sample ${esc(bottle.letter)} · ${esc(detailLine)}` : 'Special bottle reveal'}</small>
        ${visible && isUpset ? '<q>Honey Badger don\'t give a F**k!</q>' : ''}
      </div>
    </article>`;
}

function renderPlayerRevealStage(calc, finale, activeCue) {
  const revealed = new Set(finale.revealedPlayerIds);
  return `
    <section class="tv-stage tv-player-reveal-stage">
      <div class="tv-player-reveal-board">
        <div class="tv-stage-title"><strong>Contestant Standings</strong><span>Every point · any reveal order</span></div>
        <div class="tv-player-reveal-grid" style="--player-reveal-columns:${Math.min(5, Math.max(1, calc.playerResults.length))}">
          ${calc.playerResults.map((player) => renderPlayerRevealCard(player, revealed.has(player.id), activeCue)).join('')}
        </div>
      </div>
      <aside class="tv-player-reveal-rail">
        <div class="tv-vault-meter"><strong>${revealed.size}<small>/${calc.playerResults.length}</small></strong><span>Standings revealed</span></div>
        <div class="tv-points-legend">
          <strong>How the damage happened</strong>
          <span>H/L · price guess · winner pick · last pick · bonus</span>
        </div>
        ${renderRevealBottleAward("Punches Above Its Weight", calc.biggestUpset, finale.biggestUpsetRevealed, calc, 'biggestUpset', activeCue)}
        ${renderRevealBottleAward('Biggest Waste of Money', calc.biggestDisappointment, finale.biggestDisappointmentRevealed, calc, 'biggestDisappointment', activeCue)}
        <p class="tv-reveal-instruction">When every ranking is open, the two final award curtains are ready.</p>
      </aside>
    </section>`;
}

function renderPlayerRevealCard(player, visible, activeCue) {
  return `
    <article class="tv-player-result-card ${visible ? 'is-revealed' : 'is-hidden'} ${curtainClasses(visible, finaleCueMatches(activeCue, 'player', player.id))}">
      <span class="tv-player-place">#${player.rank}</span>
      ${visible ? `
        <h2>${esc(player.name)}</h2>
        <strong>${player.total} points</strong>
        <div class="tv-player-score-breakdown">
          <span><small>Price H/L</small>${player.priceHL}</span>
          <span><small>Proof H/L</small>${player.proofHL}</span>
          <span><small>Price game</small>${player.priceIsRight}</span>
          <span><small>Top pick</small>${player.winnerPick}</span>
          <span><small>Last pick</small>${player.lastPick}</span>
          <span><small>Bonus</small>${player.bonus}</span>
        </div>` : '<b>?</b><p>Waiting for the host</p>'}
    </article>`;
}

function renderAwardsRevealStage(calc, finale, activeCue) {
  return `
    <section class="tv-stage tv-awards-reveal-stage">
      <div class="tv-stage-title"><strong>The Final Two</strong><span>One crown · one trip to the basement</span></div>
      <div class="tv-awards-reveal-grid">
        ${renderSavantAward(calc, finale.savantRevealed, activeCue)}
        ${renderLoserAward(calc, finale.biggestLoserRevealed, activeCue)}
      </div>
      <div class="tv-final-board-tease ${finale.savantRevealed && finale.biggestLoserRevealed ? 'is-ready' : ''}">
        <strong>${finale.savantRevealed && finale.biggestLoserRevealed ? 'The final scoreboard is ready.' : 'Two names remain behind the velvet.'}</strong>
        <span>The host opens the complete player and bottle rankings after both awards.</span>
      </div>
    </section>`;
}

function renderSavantAward(calc, visible, activeCue) {
  const winners = calc.savants || [];
  const winningScore = winners[0]?.total ?? 0;
  return `
    <article class="tv-final-award is-winner ${curtainClasses(visible, finaleCueMatches(activeCue, 'savant'))}" data-award="bourbon-savant">
      <div class="tv-award-rays" aria-hidden="true"></div>
      <span>★ Bourbon Savant${winners.length > 1 ? 's' : ''} ★</span>
      <h2>${visible && winners.length ? esc(playerNames(winners)) : 'Behind the curtain'}</h2>
      <strong>${visible ? `${winningScore} points` : '???'}</strong>
      <p>${visible ? (winners.length > 1 ? 'A dead heat at the top of the barrel.' : 'Tonight’s least-questionable palate.') : 'The crown awaits its questionable owner.'}</p>
      ${visible ? '<img class="tv-king-moose" src="./assets/moose-king.webp" alt="The same blind-drunk X-eyed Moose crowned king while bourbon bubbles float around him">' : ''}
    </article>`;
}

function renderLoserAward(calc, visible, activeCue) {
  const losers = calc.biggestLosers || [];
  const losingScore = losers[0]?.total ?? 0;
  return `
    <article class="tv-final-award is-loser ${curtainClasses(visible, finaleCueMatches(activeCue, 'biggestLoser'))}" data-award="biggest-loser">
      ${visible ? '<img src="./assets/biggest-loser-poop.webp" alt="A rubber-hose cartoon poop pile steaming while flies buzz around it">' : '<div class="tv-award-question">?</div>'}
      <div><span>Biggest Loser${losers.length > 1 ? 's' : ''}</span>
        <h2>${visible && losers.length ? esc(playerNames(losers)) : 'Behind the curtain'}</h2>
        <strong>${visible ? `${losingScore} points` : '???'}</strong>
        <p>${visible ? (losers.length > 1 ? 'The basement has multiple tenants.' : 'A truly heroic misunderstanding of bourbon.') : 'The poop trophy is standing by.'}</p>
      </div>
    </article>`;
}

function renderFinalStage(calc, activeCue) {
  const finale = normalizeFinaleState(calc.game);
  if (!finale.finalBoardRevealed) return renderAwardsRevealStage(calc, finale, activeCue);
  return `
    <section class="tv-stage tv-final-stage ${finaleCueMatches(activeCue, 'finalBoard') ? 'is-final-curtain-cue' : ''}">
      <div class="tv-final-awards">
        ${renderSavantAward(calc, true, null)}
        ${renderLoserAward(calc, true, null)}
      </div>
      <section class="tv-final-leaderboard">
        <div class="tv-stage-title"><strong>Official Final Score</strong><span>Every point in the barrel</span></div>
        ${renderDetailedPlayerLeaderboard(calc.playerResults)}
      </section>
      <div class="tv-final-finish">
        <div class="tv-stage-title">
          <strong>Bottle Finish</strong>
          <span>${esc(finalBottleAwardsSummary(calc))}</span>
        </div>
        <div class="tv-finish-strip">
          ${calc.rankedBottles.map((bottle) => renderFinalBottle(bottle, calc.detailsByLetter)).join('') || '<p>Waiting for valid final rankings.</p>'}
        </div>
      </div>
    </section>`;
}

function renderDetailedPlayerLeaderboard(players) {
  return `
    <div class="tv-final-score-table">
      <div class="tv-final-score-head"><span>#</span><span>Player</span><span>Price H/L</span><span>Proof H/L</span><span>Price Game</span><span>Top Pick</span><span>Last Pick</span><span>Bonus</span><span>Total</span></div>
      ${players.map((player) => `
        <div class="tv-final-score-row ${player.rank === 1 ? 'is-leader' : ''}">
          <span>${player.rank}</span><strong>${esc(player.name)}</strong><span>${player.priceHL}</span><span>${player.proofHL}</span><span>${player.priceIsRight}</span><span>${player.winnerPick}</span><span>${player.lastPick}</span><span>${player.bonus}</span><b>${player.total}</b>
        </div>`).join('')}
    </div>`;
}

function finalBottleAwardsSummary(calc) {
  const upsetName = calc.biggestUpset ? revealedBottleName(calc.biggestUpset, calc.detailsByLetter) : '—';
  const disappointmentName = calc.biggestDisappointment ? revealedBottleName(calc.biggestDisappointment, calc.detailsByLetter) : '—';
  return `Punches Above: ${upsetName} · Biggest Waste: ${disappointmentName}`;
}

function renderFinalBottle(bottle, detailsByLetter) {
  if (!bottle.revealed) {
    return `<article class="tv-finish-card is-hidden"><strong>#${bottle.clubPlace}</strong><span>?</span><small>Hidden</small></article>`;
  }
  return `
    <article class="tv-finish-card place-${bottle.clubPlace}">
      <strong>#${bottle.clubPlace}</strong><span>${esc(bottle.letter)}</span>
      <small>${esc(revealedBottleName(bottle, detailsByLetter))}</small>
    </article>`;
}

function revealedBottleName(bottle, detailsByLetter) {
  const detail = detailsByLetter[bottle.letter] || bottle.detail || {};
  return detail.name || `Sample ${bottle.letter}`;
}

function renderPlayerLeaderboard(players, compact = false) {
  return `
    <div class="tv-player-leaderboard ${compact ? 'is-compact' : ''}">
      ${players.map((player) => `
        <div class="${player.rank === 1 ? 'is-leader' : ''}">
          <span>${player.rank}</span><strong>${esc(player.name)}</strong><b>${player.total}</b>
        </div>`).join('')}
    </div>`;
}
