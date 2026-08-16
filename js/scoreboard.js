import { PHASES, formatMoney, formatNumber } from './scoring.js';

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

export function renderTvScoreboard({ snapshot, calc, joinUrl, qrUrl }) {
  const game = snapshot.game;
  const stage = scoreboardStage(game.phase);
  return `
    <main class="tv-gameboard tv-phase-${esc(stage)}" data-tv-phase="${esc(stage)}">
      <div class="tv-bulb-frame" aria-hidden="true"></div>
      ${renderPhaseMarquee(game, stage)}
      ${renderJoinBug(game, joinUrl, qrUrl)}
      ${renderStage(stage, game, calc)}
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

function renderStage(stage, game, calc) {
  if (stage === 'tasting') return renderTastingStage(calc);
  if (stage === 'higherLower') return renderHigherLowerStage(game, calc);
  if (stage === 'reveal') return renderRevealStage(calc);
  if (stage === 'final') return renderFinalStage(calc);
  return renderLobbyStage(calc);
}

function renderLobbyStage(calc) {
  const joined = calc.players.filter((player) => player.claimedBy).length;
  return `
    <section class="tv-stage tv-lobby-stage">
      <div class="tv-lobby-copy">
        <span class="tv-neon-kicker">Live from the bourbon basement</span>
        <h1>Come on down,<br>you magnificent idiots.</h1>
        <p>Scan the code, claim your contestant card, and try not to embarrass your palate.</p>
        <div class="tv-lobby-count"><strong>${joined}</strong><span>of ${calc.players.length} contestants checked in</span></div>
        <div class="tv-contestant-strip">
          ${calc.players.map((player) => `
            <div class="${player.claimedBy ? 'is-joined' : ''}">
              <span>${player.claimedBy ? '★' : '○'}</span><strong>${esc(player.name)}</strong>
            </div>`).join('')}
        </div>
      </div>
      <img class="tv-lobby-moose" src="./assets/moose.webp" alt="The Drunk Moose welcomes the contestants">
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
        <img src="./assets/moose-bourbon-creek.webp" alt="The Drunk Moose stands in a creek of bourbon and licks it as it spills from a copper still">
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
      <div class="tv-progress-track"><i style="width:${percent}%"></i></div>
      <small>${player.tastingComplete ? 'Ready for the next round' : 'Nosing · guessing · making things up'}</small>
    </article>`;
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
        <img src="./assets/moose-game-show-host.webp" alt="The Drunk Moose in a sweaty velvet suit holding a long game-show wand microphone and a glass of bourbon">
        <p>“The crowd has opinions. Accuracy remains under investigation.”</p>
      </aside>
    </section>`;
}

function renderHigherLowerBottle(bottle, averages = {}, players) {
  const locked = players.filter((player) => (player.higherLowerCompletedLetters || []).includes(bottle.letter)).length;
  const fill = players.length ? Math.round((locked / players.length) * 100) : 0;
  return `
    <article class="tv-hl-bottle-card">
      <div class="tv-sample-letter">${esc(bottle.letter)}</div>
      <div class="tv-bottle-gauge" aria-hidden="true"><i style="height:${Math.max(12, fill)}%"></i></div>
      <div class="tv-hl-values">
        <span><small>Club price guess</small>${formatMoney(averages?.price, 0)}</span>
        <span><small>Club proof guess</small>${formatNumber(averages?.proof, 0)}°</span>
      </div>
      <div class="tv-hl-arrows"><span>↑ Higher</span><span>↓ Lower</span></div>
      <small class="tv-calls-locked">${locked}/${players.length} calls locked</small>
    </article>`;
}

function renderRevealStage(calc) {
  const revealOrder = calc.revealOrder.length ? calc.revealOrder : calc.bottleResults;
  const revealedCount = calc.bottles.filter((bottle) => bottle.revealed).length;
  return `
    <section class="tv-stage tv-reveal-stage">
      <div class="tv-reveal-board">
        <div class="tv-stage-title"><strong>The Derby Finish</strong><span>Revealing last place to first</span></div>
        <div class="tv-reveal-grid" style="--reveal-columns:${Math.min(5, Math.max(1, revealOrder.length))}">
          ${revealOrder.map((bottle) => renderRevealBottle(bottle, calc.detailsByLetter)).join('')}
        </div>
      </div>
      <aside class="tv-score-rail">
        <div class="tv-vault-meter"><strong>${revealedCount}<small>/${calc.bottles.length}</small></strong><span>Bottles out of the vault</span></div>
        ${renderCompactAward('Clubhouse Leader', calc.playerResults[0]?.name || 'Calculating…', calc.playerResults[0] ? `${calc.playerResults[0].total} points` : 'Scores update with every reveal', 'star')}
        ${renderCompactAward('Derby Champion', calc.winner?.revealed ? revealedBottleName(calc.winner, calc.detailsByLetter) : 'Still behind the curtain', calc.winner?.revealed ? `Sample ${calc.winner.letter}` : 'First place bottle', 'bottle')}
        ${renderPlayerLeaderboard(calc.playerResults, true)}
      </aside>
    </section>`;
}

function renderRevealBottle(bottle, detailsByLetter) {
  const place = bottle.clubPlace || '—';
  if (!bottle.revealed) {
    return `
      <article class="tv-reveal-card is-hidden">
        <span class="tv-place-chip">#${place}</span><strong>?</strong><p>Behind the curtain</p>
      </article>`;
  }
  const detail = detailsByLetter[bottle.letter] || bottle.detail || {};
  return `
    <article class="tv-reveal-card is-revealed place-${place}">
      <span class="tv-place-chip">#${place}</span>
      <b>Sample ${esc(bottle.letter)}</b>
      <h3>${esc(detail.name || `Sample ${bottle.letter}`)}</h3>
      <p>${esc(detail.distillery || 'Mystery distillery')}</p>
      <div><span>${formatMoney(detail.retailPrice, 0)}</span><span>${detail.proof ?? '—'} proof</span></div>
    </article>`;
}

function renderFinalStage(calc) {
  const winners = calc.savants || [];
  const losers = calc.biggestLosers || [];
  const winningScore = winners[0]?.total ?? 0;
  const losingScore = losers[0]?.total ?? 0;
  return `
    <section class="tv-stage tv-final-stage">
      <div class="tv-final-awards">
        <article class="tv-final-award is-winner" data-award="bourbon-savant">
          <div class="tv-award-rays" aria-hidden="true"></div>
          <span>★ Bourbon Savant${winners.length > 1 ? 's' : ''} ★</span>
          <h2>${winners.length ? esc(playerNames(winners)) : 'No winner yet'}</h2>
          <strong>${winningScore} points</strong>
          <p>${winners.length > 1 ? 'A dead heat at the top of the barrel.' : 'Tonight’s least-questionable palate.'}</p>
          <div class="tv-savant-star" aria-hidden="true">★</div>
        </article>
        <article class="tv-final-award is-loser" data-award="biggest-loser">
          <img src="./assets/biggest-loser-poop.webp" alt="A rubber-hose cartoon poop pile steaming while flies buzz around it">
          <div><span>Biggest Loser${losers.length > 1 ? 's' : ''}</span>
            <h2>${losers.length ? esc(playerNames(losers)) : 'No loser yet'}</h2>
            <strong>${losingScore} points</strong>
            <p>${losers.length > 1 ? 'The basement has multiple tenants.' : 'A truly heroic misunderstanding of bourbon.'}</p>
          </div>
        </article>
      </div>
      <aside class="tv-final-leaderboard">
        <div class="tv-stage-title"><strong>Final Score</strong><span>The official Bourbon Savant leaderboard</span></div>
        ${renderPlayerLeaderboard(calc.playerResults)}
      </aside>
      <div class="tv-final-finish">
        <div class="tv-stage-title"><strong>Bottle Finish</strong><span>Best in glass to bar mat</span></div>
        <div class="tv-finish-strip">
          ${calc.rankedBottles.map((bottle) => renderFinalBottle(bottle, calc.detailsByLetter)).join('') || '<p>Waiting for valid final rankings.</p>'}
        </div>
      </div>
    </section>`;
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

function renderCompactAward(title, name, detail, icon) {
  return `
    <article class="tv-compact-award ${esc(icon)}">
      <span>${esc(title)}</span><strong>${esc(name)}</strong><small>${esc(detail)}</small>
    </article>`;
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
