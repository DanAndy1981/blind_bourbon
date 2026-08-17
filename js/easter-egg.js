export const EASTER_EGG_COPY = Object.freeze([
  'Do Not Press Me',
  "Like, Seriously, don't push that button again",
  'Come On, Dude. Go Away!',
]);

const PARTICIPANT_PHASE_OFFSETS = Object.freeze({
  tasting: 0,
  higherLower: 1,
  reveal: 2,
});

const esc = (value) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');

function stableHash(value) {
  let hash = 2166136261;
  for (const char of String(value ?? '')) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function normalizedPresses(value) {
  return Math.max(0, Math.min(3, Math.trunc(Number(value) || 0)));
}

function activePlayers(players = []) {
  return players
    .filter((player) => player?.active !== false)
    .sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
}

export function participantEasterEggTarget(gameCode, players, phase) {
  const offset = PARTICIPANT_PHASE_OFFSETS[phase];
  const eligiblePlayers = activePlayers(players);
  if (offset === undefined || !eligiblePlayers.length) return null;
  const key = String(gameCode || 'DERBY').trim().toUpperCase();
  const firstIndex = stableHash(`${key}:participant-hunt`) % eligiblePlayers.length;
  return eligiblePlayers[(firstIndex + offset) % eligiblePlayers.length];
}

export function completedEasterEggPlayer(players = []) {
  return activePlayers(players).find((player) => player.easterEggCompleted === true) || null;
}

function baseView({ presses = 0, dismissed = false, surface, placement }) {
  const pressCount = normalizedPresses(presses);
  return {
    surface,
    placement,
    dismissed: Boolean(dismissed),
    presses: pressCount,
    concern: Math.min(2, pressCount),
    label: EASTER_EGG_COPY[Math.min(2, pressCount)],
    showSurprise: pressCount === 3,
  };
}

export function createParticipantEasterEggView({
  gameCode,
  phase,
  players = [],
  playerId,
  presses = 0,
  dismissed = false,
} = {}) {
  const view = baseView({
    presses,
    dismissed,
    surface: 'player',
    placement: stableHash(`${gameCode}:${phase}:player-placement`) % 2 ? 'player-left' : 'player-right',
  });
  const target = participantEasterEggTarget(gameCode, players, phase);
  const completedBy = completedEasterEggPlayer(players);
  const isTarget = Boolean(target && target.id === playerId);
  const isLocalCompleter = Boolean(
    view.showSurprise
    && completedBy?.id === playerId
    && completedBy?.easterEggCompletedStage === phase,
  );
  return {
    ...view,
    targetPlayerId: target?.id || null,
    eligible: !view.dismissed && isTarget && (!completedBy || isLocalCompleter),
  };
}

export function createFinalScoreboardEasterEggView({ phase, presses = 0, dismissed = false } = {}) {
  const view = baseView({ presses, dismissed, surface: 'scoreboard', placement: 'qr' });
  return {
    ...view,
    eligible: !view.dismissed && phase === 'final',
  };
}

export function advanceEasterEggPresses(presses) {
  return Math.min(3, normalizedPresses(presses) + 1);
}

export function renderEasterEgg(view) {
  if (!view?.eligible) return '';
  const surface = view.surface === 'player' ? 'player' : 'scoreboard';
  if (view.showSurprise) {
    return `
      <section class="tv-shower-surprise surface-${surface}" role="dialog" aria-modal="true" aria-label="The forbidden shower surprise">
        <div class="tv-shower-surprise-curtain" aria-hidden="true"></div>
        <img class="tv-shower-surprise-image" src="./assets/moose-shower-surprise.webp" alt="The X-eyed Drunk Moose is caught in a ridiculous shower with a surprised shower-capped possum and her back scrubber">
        <button type="button" class="tv-shower-surprise-dismiss" data-action="dismiss-easter-egg">Close the curtain</button>
      </section>`;
  }
  return `
    <button type="button" class="tv-do-not-press surface-${surface} concern-${view.concern} placement-${esc(view.placement)}" data-action="press-easter-egg" data-concern="${view.concern}" data-placement="${esc(view.placement)}">
      <span>${esc(view.label)}</span>
    </button>`;
}
