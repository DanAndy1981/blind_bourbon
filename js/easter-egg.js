export const EASTER_EGG_COPY = Object.freeze([
  'Do Not Press Me',
  "Like, Seriously, don't push that button again",
  'Come On, Dude. Go Away!',
]);

const ELIGIBLE_STAGES = Object.freeze(['tasting', 'higherLower', 'postReveal']);
const PLACEMENTS = Object.freeze(['upper-left', 'upper-right', 'middle-left', 'middle-right', 'lower-left', 'lower-right']);

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

export function easterEggConfig(gameCode) {
  const key = String(gameCode || 'DERBY').trim().toUpperCase();
  return {
    stage: ELIGIBLE_STAGES[stableHash(`${key}:stage`) % ELIGIBLE_STAGES.length],
    placement: PLACEMENTS[stableHash(`${key}:placement`) % PLACEMENTS.length],
  };
}

export function isEasterEggStageEligible(selectedStage, { phase, bottles = [] } = {}) {
  if (selectedStage === 'tasting') return phase === 'tasting';
  if (selectedStage === 'higherLower') return phase === 'higherLower';
  if (selectedStage !== 'postReveal') return false;
  const revealHasBegun = bottles.some((bottle) => bottle?.revealed === true);
  return revealHasBegun && (phase === 'reveal' || phase === 'final');
}

export function createEasterEggView({ gameCode, phase, bottles = [], presses = 0, dismissed = false } = {}) {
  const config = easterEggConfig(gameCode);
  const pressCount = normalizedPresses(presses);
  return {
    ...config,
    eligible: !dismissed && isEasterEggStageEligible(config.stage, { phase, bottles }),
    dismissed: Boolean(dismissed),
    presses: pressCount,
    concern: Math.min(2, pressCount),
    label: EASTER_EGG_COPY[Math.min(2, pressCount)],
    showSurprise: pressCount === 3,
  };
}

export function advanceEasterEggPresses(presses) {
  return Math.min(3, normalizedPresses(presses) + 1);
}

export function renderEasterEgg(view) {
  if (!view?.eligible) return '';
  if (view.showSurprise) {
    return `
      <section class="tv-shower-surprise" role="dialog" aria-modal="true" aria-label="The forbidden shower surprise">
        <div class="tv-shower-surprise-curtain" aria-hidden="true"></div>
        <img class="tv-shower-surprise-image" src="./assets/moose-shower-surprise.webp" alt="The X-eyed Drunk Moose wears a shower cap beside a surprised possum with its own shower cap and back scrubber">
        <button type="button" class="tv-shower-surprise-dismiss" data-action="dismiss-tv-easter-egg">Close the curtain</button>
      </section>`;
  }
  return `
    <button type="button" class="tv-do-not-press concern-${view.concern} placement-${esc(view.placement)}" data-action="press-tv-easter-egg" data-concern="${view.concern}" data-placement="${esc(view.placement)}">
      <span>${esc(view.label)}</span>
    </button>`;
}
