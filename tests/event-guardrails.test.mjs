import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { phaseAdvanceWarning } from '../js/event-guardrails.js';
import { isRegistrationContentionError } from '../js/registration.js';

const players = [
  { id: 'p1', name: 'Ada', tastingComplete: true, higherLowerComplete: true },
  { id: 'p2', name: 'Grace', tastingComplete: false, higherLowerComplete: false },
  { id: 'p3', name: 'Lin', tastingComplete: true, higherLowerComplete: false },
];

test('forward round warnings name unfinished players without hard-blocking the host', () => {
  const warning = phaseAdvanceWarning({
    currentPhase: 'tasting',
    nextPhase: 'higherLower',
    players,
  });

  assert.equal(warning.completeCount, 2);
  assert.equal(warning.totalCount, 3);
  assert.deepEqual(warning.incompleteNames, ['Grace']);
  assert.match(warning.message, /Only 2 of 3 players/);
  assert.match(warning.message, /Waiting on: Grace/);
});

test('reveal warnings require both scorecard sections and ignore inactive players', () => {
  const warning = phaseAdvanceWarning({
    currentPhase: 'higherLower',
    nextPhase: 'reveal',
    players: [...players, { name: 'Left Early', active: false }],
  });

  assert.deepEqual(warning.incompleteNames, ['Grace', 'Lin']);
  assert.match(warning.message, /both scorecard sections/);
  assert.doesNotMatch(warning.message, /Left Early/);
});

test('backward, same-phase, and fully ready changes do not warn', () => {
  assert.equal(phaseAdvanceWarning({ currentPhase: 'reveal', nextPhase: 'tasting', players }), null);
  assert.equal(phaseAdvanceWarning({ currentPhase: 'tasting', nextPhase: 'tasting', players }), null);
  assert.equal(phaseAdvanceWarning({
    currentPhase: 'higherLower',
    nextPhase: 'reveal',
    players: players.map((player) => ({ ...player, tastingComplete: true, higherLowerComplete: true })),
  }), null);
});

test('simultaneous registration conflicts are retryable without hiding unrelated failures', () => {
  assert.equal(isRegistrationContentionError(new Error('REGISTRATION_SLOT_TAKEN')), true);
  assert.equal(isRegistrationContentionError({ code: 'aborted' }), true);
  assert.equal(isRegistrationContentionError({ code: 'failed-precondition' }), true);
  assert.equal(isRegistrationContentionError({ code: 'permission-denied' }), true);
  assert.equal(isRegistrationContentionError({ code: 'unauthenticated' }), false);
  assert.equal(isRegistrationContentionError(new Error('Network failed')), false);
});

test('event UI wires exclusive host actions, retry recovery, connection state, and release confirmations', () => {
  const appSource = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
  const cssSource = readFileSync(new URL('../css/styles.css', import.meta.url), 'utf8');
  const serviceWorkerSource = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');

  assert.match(appSource, /async function safeHostAction/);
  assert.match(appSource, /workspace\.inert = busy/);
  assert.match(appSource, /phaseAdvanceWarning\(\{/);
  assert.match(appSource, /data-action="retry-responses"/);
  assert.match(appSource, /window\.addEventListener\('online'/);
  assert.match(appSource, /data-action="retry-connection"/);
  assert.match(appSource, /Switch away from \$\{playerName\}/);
  assert.match(appSource, /Release \$\{player\?\.name/);
  assert.match(cssSource, /\.scoreboard-connection-chip/);
  assert.match(cssSource, /\.host-workspace\.is-saving/);
  assert.match(serviceWorkerSource, /event-guardrails\.js/);
});
