import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const claimGuard = readFileSync(new URL('../js/claim-guard.js', import.meta.url), 'utf8');
const registrationDraft = readFileSync(new URL('../js/registration-draft.js', import.meta.url), 'utf8');
const tvCss = readFileSync(new URL('../css/tv-legibility.css', import.meta.url), 'utf8');

test('registration guard retries the in-app route before hard reloading', () => {
  assert.match(claimGuard, /PopStateEvent\('popstate'\)/);
  assert.match(claimGuard, /HARD_RELOAD_AFTER/);
  assert.match(claimGuard, /Player registered\. Opening your setup page/);
  assert.doesNotMatch(claimGuard, /setInterval\([^]*?,\s*150\s*\)/);
});

test('root render guard preserves scroll across polling refreshes', () => {
  assert.match(claimGuard, /Object\.defineProperty\(root, 'innerHTML'/);
  assert.match(claimGuard, /const scrollBefore = window\.scrollY/);
  assert.match(claimGuard, /window\.scrollTo\(0, target\)/);
  assert.match(claimGuard, /scoreboard-mode/);
});

test('unfinished registration input survives DOM redraws', () => {
  assert.match(registrationDraft, /sessionStorage/);
  assert.match(registrationDraft, /MutationObserver/);
  assert.match(registrationDraft, /playerName/);
  assert.match(registrationDraft, /playerId/);
});

test('TV typography establishes readable minimum sizes for score data', () => {
  assert.match(tvCss, /--tv-copy:\s*clamp\(16px/);
  assert.match(tvCss, /\.tv-final-score-head[\s\S]*font-size:\s*clamp\(15px/);
  assert.match(tvCss, /\.tv-final-score-row[\s\S]*font-size:\s*clamp\(18px/);
  assert.match(tvCss, /font-variant-numeric:\s*tabular-nums/);
});

test('crowded TV boards shed optional prose instead of shrinking key data', () => {
  assert.match(tvCss, /:has\(\.tv-player-progress:nth-child\(6\)\)/);
  assert.match(tvCss, /:has\(\.tv-reveal-card:nth-child\(6\)\)/);
  assert.match(tvCss, /:has\(\.tv-final-score-row:nth-child\(8\)\)/);
});

test('registration recovery blocks duplicate and offline submissions', () => {
  assert.match(claimGuard, /A pending registration survived a DOM refresh/);
  assert.match(claimGuard, /No internet connection\. Reconnect/);
  assert.match(claimGuard, /stopImmediatePropagation/);
});
