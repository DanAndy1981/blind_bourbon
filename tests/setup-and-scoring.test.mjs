import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  EASTER_EGG_COPY,
  advanceEasterEggPresses,
  completedEasterEggPlayer,
  createFinalScoreboardEasterEggView,
  createParticipantEasterEggView,
  participantEasterEggTarget,
  renderEasterEgg,
  shouldRenderAfterSnapshot,
} from '../js/easter-egg.js';
import { calculateGame, summarizePlayerProgress } from '../js/scoring.js';
import { renderTvScoreboard, scoreboardStage } from '../js/scoreboard.js';
import {
  MAX_PLAYERS,
  PLAYER_NAME_MAX_LENGTH,
  createPlayerRegistrationSlots,
  normalizePlayerName,
} from '../js/registration.js';
import { activeBottlesFromDraft } from '../js/setup.js';
import {
  REVEAL_TASTING_NOTE_MAX_LENGTH,
  sanitizeTastingNotesByLetter,
  selectRevealTastingNotes,
} from '../js/tasting-notes.js';

function renderTvPhase(phase) {
  const snapshot = {
    game: { code: 'TEST10', title: 'Test Derby', phase, publicAverages: { A: { price: 42, proof: 100 } } },
    players: [{ id: 'p1', name: 'Daniel', order: 0, active: true }],
    bottles: [{ letter: 'A', order: 0, active: true, revealed: phase === 'final' }],
    details: {},
    responses: [],
  };

  return renderTvScoreboard({
    snapshot,
    calc: calculateGame(snapshot),
    joinUrl: 'https://example.test/?game=TEST10',
    qrUrl: 'https://example.test/qr.svg',
  });
}

function imageAltFor(html, assetName) {
  const escapedAssetName = assetName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const imageTag = html.match(new RegExp(`<img\\b[^>]*${escapedAssetName}[^>]*>`, 'i'))?.[0];
  assert.ok(imageTag, `Expected ${assetName} to be rendered`);
  const alt = imageTag.match(/\balt="([^"]+)"/i)?.[1];
  assert.ok(alt, `Expected ${assetName} to have meaningful alt text`);
  return alt;
}

function tastingProgressTagFor(html, playerName) {
  const escapedPlayerName = playerName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const progress = html.match(new RegExp(`<div\\b[^>]*aria-label="${escapedPlayerName} tasting progress"[^>]*>`, 'i'))?.[0];
  assert.ok(progress, `Expected ${playerName} to have semantic tasting progress`);
  return progress;
}

function drunkBottleTagFor(html, letter) {
  const bottle = html.match(new RegExp(`<div\\b[^>]*aria-label="Sample ${letter} crowd lock-in progress"[^>]*>`, 'i'))?.[0];
  assert.ok(bottle, `Expected Sample ${letter} to have a crowd lock-in bottle`);
  return bottle;
}

function classCount(html, className, { prefix = false } = {}) {
  const suffix = prefix ? '(?:\\s|\")' : '\"';
  return [...html.matchAll(new RegExp(`class="${className}${suffix}`, 'g'))].length;
}

function easterEggFixture({ gameCode = 'EGG001', phase = 'final', presses = 0, dismissed = false } = {}) {
  const bottles = [{ letter: 'A', order: 0, active: true, revealed: phase === 'final' }];
  const view = createFinalScoreboardEasterEggView({ phase, presses, dismissed });
  const snapshot = {
    game: { code: gameCode, title: 'Test Derby', phase },
    players: [{ id: 'p1', name: 'Daniel', order: 0, active: true }],
    bottles,
    details: {},
    responses: [],
  };
  const html = renderTvScoreboard({
    snapshot,
    calc: calculateGame(snapshot),
    joinUrl: `https://example.test/?game=${gameCode}`,
    qrUrl: 'https://example.test/qr.svg',
    easterEgg: view,
  });
  return { html, view };
}

test('blank bourbon rows are excluded and active rows are capped at A-J', () => {
  const draft = [
    { letter: 'A', name: '  Alpha  ' },
    { letter: 'B', name: '   ', distillery: 'Ignored Distillery' },
    ...'CDEFGHIJKL'.split('').map((letter) => ({ letter, name: `Bottle ${letter}` })),
  ];

  const active = activeBottlesFromDraft(draft);

  assert.deepEqual(active.map((bottle) => bottle.letter), ['A', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J']);
  assert.equal(active[0].name, 'Alpha');
  assert.ok(active.every((bottle) => bottle.active));
});

test('rank 1 and the highest rank replace manual winner and last-place picks', () => {
  const players = [
    { id: 'p1', name: 'Daniel', order: 0, active: true },
    { id: 'p2', name: 'Mike', order: 1, active: true },
  ];
  const bottles = ['A', 'B', 'C'].map((letter, order) => ({ letter, order, active: true, revealed: false }));
  const ranks = {
    p1: { A: 1, B: 2, C: 3 },
    p2: { A: 1, B: 2, C: 3 },
  };
  const responses = players.flatMap((player) => bottles.map((bottle) => ({
    playerId: player.id,
    bottleLetter: bottle.letter,
    buyChoice: 'Maybe',
    priceGuess: 40,
    proofGuess: 100,
    finalRank: ranks[player.id][bottle.letter],
  })));

  const result = calculateGame({
    game: { phase: 'tasting' },
    players,
    bottles,
    responses,
    details: Object.fromEntries(bottles.map((bottle) => [bottle.letter, { letter: bottle.letter, name: `Bottle ${bottle.letter}` }])),
    picks: [{ playerId: 'p1', winnerPick: 'C', lastPick: 'A' }],
  });

  assert.equal(result.winner.letter, 'A');
  assert.equal(result.lastPlace.letter, 'C');
  assert.equal(result.playerResults[0].winnerLetter, 'A');
  assert.equal(result.playerResults[0].lastLetter, 'C');
  assert.equal(result.playerResults[0].winnerPick, 5);
  assert.equal(result.playerResults[0].lastPick, 3);
  assert.equal(result.playerResults[0].tastingProgress, 1);
  assert.equal(result.playerResults[0].tastingComplete, true);
});

test('sanitized progress preserves live TV updates without exposing guesses', () => {
  const bottles = ['A', 'B'].map((letter, order) => ({ letter, order, active: true }));
  const progress = summarizePlayerProgress({
    bottles,
    responses: [
      { bottleLetter: 'A', buyChoice: 'Hell Yes', priceGuess: 40, proofGuess: 100, finalRank: 1, priceHL: 'Higher', proofHL: 'Lower' },
      { bottleLetter: 'B', buyChoice: 'Maybe', priceGuess: 55, notes: '  Brown sugar   and oak  ' },
    ],
  });

  assert.equal(progress.tastingProgress, 0.75);
  assert.equal(progress.tastingComplete, false);
  assert.deepEqual(progress.tastingCompletedLetters, ['A']);
  assert.deepEqual(progress.tastingNotesByLetter, { B: 'Brown sugar and oak' });
  assert.equal(progress.higherLowerProgress, 0.5);
  assert.deepEqual(progress.higherLowerCompletedLetters, ['A']);

  const result = calculateGame({
    game: { phase: 'tasting' },
    bottles,
    responses: [],
    players: [{
      id: 'p1',
      name: 'Daniel',
      active: true,
      ...progress,
    }],
  });

  assert.equal(result.playerResults[0].tastingProgress, 0.75);
  assert.deepEqual(result.playerResults[0].tastingCompletedLetters, ['A']);
  assert.deepEqual(result.playerResults[0].tastingNotesByLetter, { B: 'Brown sugar and oak' });
  assert.equal(result.playerResults[0].total, 0);
});

test('public tasting notes are sanitized and reveal selections stay stable and card-sized', () => {
  const sanitized = sanitizeTastingNotesByLetter({
    A: '  caramel   bomb  ',
    B: 'x'.repeat(400),
    Z: 'not a real sample',
    C: '',
  });
  assert.equal(sanitized.A, 'caramel bomb');
  assert.equal(sanitized.B.length, 280);
  assert.deepEqual(Object.keys(sanitized), ['A', 'B']);

  const players = Array.from({ length: 7 }, (_, index) => ({ id: `p${index + 1}`, name: `Player ${index + 1}` }));
  const responses = players.map((player, index) => ({
    playerId: player.id,
    notes: index === 6 ? 'A'.repeat(REVEAL_TASTING_NOTE_MAX_LENGTH + 1) : `Short comment number ${index + 1}`,
  }));
  const input = { responses, players, gameCode: 'NOTES1', bottleLetter: 'A', bottleCount: 3 };
  const first = selectRevealTastingNotes(input);
  const second = selectRevealTastingNotes(input);
  assert.deepEqual(first, second, 'Automatic scoreboard refreshes must not reshuffle the comments');
  assert.equal(first.length, 4);
  assert.ok(first.every((item) => item.note.length <= REVEAL_TASTING_NOTE_MAX_LENGTH));
  assert.equal(selectRevealTastingNotes({ ...input, bottleCount: 10 }).length, 2);
});

test('final results identify every player tied for the biggest-loser award', () => {
  const players = [
    { id: 'p1', name: 'Winner', order: 0, active: true, bonusPoints: 4 },
    { id: 'p2', name: 'Loser One', order: 1, active: true },
    { id: 'p3', name: 'Loser Two', order: 2, active: true },
  ];
  const result = calculateGame({ game: { phase: 'final' }, players, bottles: [], responses: [] });

  assert.deepEqual(result.savants.map((player) => player.name), ['Winner']);
  assert.deepEqual(result.biggestLosers.map((player) => player.name), ['Loser One', 'Loser Two']);
});

test('the TV renderer maps every game phase to an active game-show stage', () => {
  assert.deepEqual(
    ['setup', 'tasting', 'higherLower', 'reveal', 'final'].map(scoreboardStage),
    ['setup', 'tasting', 'higherLower', 'reveal', 'final'],
  );
  assert.equal(scoreboardStage('something-old'), 'setup');
});

test('the participant hunt rotates deterministically across Taste, H/L, and Reveal', () => {
  const tenPlayers = Array.from({ length: 10 }, (_, order) => ({ id: `p${order + 1}`, name: `Player ${order + 1}`, order, active: true }));
  const tenTargets = ['tasting', 'higherLower', 'reveal'].map((phase) => participantEasterEggTarget('EGG001', tenPlayers, phase)?.id);
  assert.equal(new Set(tenTargets).size, 3);
  assert.deepEqual(
    ['tasting', 'higherLower', 'reveal'].map((phase) => participantEasterEggTarget(' egg001 ', tenPlayers, phase)?.id),
    tenTargets,
  );

  const twoPlayers = tenPlayers.slice(0, 2);
  const twoTargets = ['tasting', 'higherLower', 'reveal'].map((phase) => participantEasterEggTarget('EGG001', twoPlayers, phase)?.id);
  assert.notEqual(twoTargets[0], twoTargets[1]);
  assert.equal(twoTargets[2], twoTargets[0]);
  assert.equal(participantEasterEggTarget('EGG001', twoPlayers, 'final'), null);
});

test('only one participant sees each round and a completed hunt stops later handoffs', () => {
  const players = Array.from({ length: 4 }, (_, order) => ({ id: `p${order + 1}`, name: `Player ${order + 1}`, order, active: true }));
  const tastingTarget = participantEasterEggTarget('EGG001', players, 'tasting');
  const hlTarget = participantEasterEggTarget('EGG001', players, 'higherLower');
  const revealTarget = participantEasterEggTarget('EGG001', players, 'reveal');

  for (const player of players) {
    const view = createParticipantEasterEggView({ gameCode: 'EGG001', phase: 'tasting', players, playerId: player.id });
    assert.equal(view.eligible, player.id === tastingTarget.id);
  }
  assert.equal(createParticipantEasterEggView({ gameCode: 'EGG001', phase: 'higherLower', players, playerId: hlTarget.id }).eligible, true);
  assert.equal(createParticipantEasterEggView({ gameCode: 'EGG001', phase: 'reveal', players, playerId: revealTarget.id }).eligible, true);
  assert.equal(createParticipantEasterEggView({ gameCode: 'EGG001', phase: 'final', players, playerId: tastingTarget.id }).eligible, false);

  tastingTarget.easterEggCompleted = true;
  tastingTarget.easterEggCompletedStage = 'tasting';
  assert.equal(completedEasterEggPlayer(players)?.id, tastingTarget.id);
  assert.equal(createParticipantEasterEggView({ gameCode: 'EGG001', phase: 'higherLower', players, playerId: hlTarget.id }).eligible, false);
  assert.equal(createParticipantEasterEggView({ gameCode: 'EGG001', phase: 'reveal', players, playerId: revealTarget.id }).eligible, false);
  assert.equal(createParticipantEasterEggView({ gameCode: 'EGG001', phase: 'tasting', players, playerId: tastingTarget.id, presses: 3 }).eligible, true);
});

test('the Easter egg follows the exact three warnings and preserves concern across rerenders', () => {
  assert.deepEqual(EASTER_EGG_COPY, [
    'Do Not Press Me',
    "Like, Seriously, don't push that button again",
    'Come On, Dude. Go Away!',
  ]);

  let presses = 0;
  const players = [{ id: 'p1', name: 'Daniel', order: 0, active: true }];
  for (const [concern, label] of EASTER_EGG_COPY.entries()) {
    const firstView = createParticipantEasterEggView({ gameCode: 'EGG001', phase: 'tasting', players, playerId: 'p1', presses });
    const rerenderedView = createParticipantEasterEggView({ gameCode: 'EGG001', phase: 'tasting', players, playerId: 'p1', presses });
    assert.equal(firstView.eligible, true);
    assert.equal(firstView.label, label);
    assert.equal(firstView.concern, concern);
    assert.equal(firstView.showSurprise, false);
    assert.deepEqual(rerenderedView, firstView);
    assert.match(renderEasterEgg(rerenderedView), new RegExp(`concern-${concern}`));
    presses = advanceEasterEggPresses(presses);
  }

  assert.equal(presses, 3);
  assert.equal(advanceEasterEggPresses(presses), 3);
});

test('the third press opens the shower surprise and dismissal persists until a new game session', () => {
  const players = [{ id: 'p1', name: 'Daniel', order: 0, active: true }];
  const view = createParticipantEasterEggView({ gameCode: 'EGG001', phase: 'tasting', players, playerId: 'p1', presses: 3 });
  const html = renderEasterEgg(view);
  const alt = imageAltFor(html, 'moose-shower-surprise.webp');

  assert.equal(view.showSurprise, true);
  assert.match(html, /class="tv-shower-surprise surface-player"/);
  assert.match(html, /role="dialog"/);
  assert.match(html, /aria-modal="true"/);
  assert.match(html, /data-easter-surface="player"/);
  assert.match(html, /data-easter-phase="tasting"/);
  assert.match(html, /data-easter-player-id="p1"/);
  assert.match(html, /class="tv-shower-surprise-curtain"/);
  assert.match(html, /class="tv-shower-surprise-image"/);
  assert.match(html, /class="tv-shower-surprise-dismiss"/);
  assert.match(html, /data-action="dismiss-easter-egg"/);
  assert.doesNotMatch(html, /class="tv-do-not-press/);
  assert.match(alt, /drunk moose/i);
  assert.match(alt, /shower|curtain/i);
  assert.match(alt, /surprise|caught|ridiculous/i);

  const dismissedView = createParticipantEasterEggView({ gameCode: 'EGG001', phase: 'tasting', players, playerId: 'p1', presses: 3, dismissed: true });
  assert.equal(dismissedView.dismissed, true);
  assert.equal(dismissedView.eligible, false);
  assert.equal(renderEasterEgg(dismissedView), '');

  const newGameView = createParticipantEasterEggView({ gameCode: 'EGG002', phase: 'higherLower', players, playerId: 'p1', presses: 0, dismissed: false });
  assert.equal(newGameView.dismissed, false);
  assert.equal(newGameView.label, EASTER_EGG_COPY[0]);
  assert.equal(newGameView.concern, 0);
  assert.equal(newGameView.showSurprise, false);
  assert.match(renderEasterEgg(newGameView), /data-action="press-easter-egg"/);

  const appSource = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
  assert.match(appSource, /easterEggSessions: new Map\(\)/);
  assert.match(appSource, /state\.store\.completeEasterEgg\(state\.code, playerId, phase\)/);
  assert.match(appSource, /function isEasterEggSurpriseOpen\(\)/);
  assert.match(appSource, /shouldRenderAfterSnapshot\(\{/);
  assert.match(appSource, /button\.closest\('\.tv-shower-surprise'\)/);
  assert.match(appSource, /surprise\?\.remove\(\)/);
});

test('silent polling keeps the shower reveal mounted until its curtain is closed', () => {
  assert.equal(shouldRenderAfterSnapshot({ silent: false, surpriseOpen: true }), true);
  assert.equal(shouldRenderAfterSnapshot({ silent: true, textEditing: true }), false);
  assert.equal(shouldRenderAfterSnapshot({ silent: true, surpriseOpen: true }), false);
  assert.equal(shouldRenderAfterSnapshot({ silent: true, surpriseOpen: false, textEditing: false }), true);

  let renderCount = 1;
  for (let poll = 0; poll < 4; poll += 1) {
    if (shouldRenderAfterSnapshot({ silent: true, surpriseOpen: true })) renderCount += 1;
  }
  assert.equal(renderCount, 1, 'The open shower dialog must survive repeated polling cycles');
});

test('the host results embed has no Easter-egg renderer or controls', () => {
  const appSource = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
  const hostRendererStart = appSource.indexOf('function renderScoreboardBody(hostEmbed = false)');
  const hostRendererEnd = appSource.indexOf('function renderStandingCard', hostRendererStart);
  assert.ok(hostRendererStart >= 0 && hostRendererEnd > hostRendererStart, 'Expected to find the host results renderer');
  const hostRendererSource = appSource.slice(hostRendererStart, hostRendererEnd);

  assert.match(appSource, /state\.hostTab === 'results' \? renderScoreboardBody\(true\)/);
  assert.doesNotMatch(hostRendererSource, /EasterEgg|easter-egg|tv-do-not-press|tv-shower-surprise/i);

  const { html, view } = easterEggFixture({ presses: 0 });
  assert.equal(view.placement, 'qr');
  assert.match(html, /data-action="press-easter-egg"/);
  assert.match(html, /surface-scoreboard[^"\n]*placement-qr/);
  const standaloneWithoutView = renderTvPhase('tasting');
  assert.doesNotMatch(standaloneWithoutView, /press-easter-egg|tv-do-not-press|tv-shower-surprise/);
  assert.equal(createFinalScoreboardEasterEggView({ phase: 'reveal' }).eligible, false);
  assert.equal(createFinalScoreboardEasterEggView({ phase: 'final' }).eligible, true);
});

test('the setup TV stage renders the moonshiner moose artwork with meaningful alt text', () => {
  const html = renderTvPhase('setup');
  const alt = imageAltFor(html, 'moose-moonshiner.webp');

  assert.match(html, /data-tv-phase="setup"/);
  assert.match(alt, /moose/i);
  assert.match(alt, /moonshin|copper still/i);
});

test('the tasting TV stage renders the Bourbon Creek moose artwork with meaningful alt text', () => {
  const html = renderTvPhase('tasting');
  const alt = imageAltFor(html, 'moose-bourbon-creek.webp');

  assert.match(html, /data-tv-phase="tasting"/);
  assert.match(alt, /same/i);
  assert.match(alt, /drunk moose/i);
  assert.match(alt, /x(?:-shaped)?-?eyed|x(?:-shaped)? eyes/i);
  assert.match(alt, /bourbon/i);
});

test('the Higher or Lower TV stage renders the microphone host artwork with bourbon context', () => {
  const html = renderTvPhase('higherLower');
  const alt = imageAltFor(html, 'moose-game-show-host.webp');

  assert.match(html, /data-tv-phase="higherLower"/);
  assert.match(alt, /moose/i);
  assert.match(alt, /x(?:-shaped)? eyes/i);
  assert.match(alt, /mic|microphone/i);
  assert.match(alt, /bourbon/i);
});

test('tasting uses compact semantic progress instead of either drunk-bottle treatment', () => {
  const progressCases = [
    { name: 'Just Starting', progress: 0 },
    { name: 'Quarter Done', progress: 0.25 },
    { name: 'Half Done', progress: 0.5 },
    { name: 'Almost Done', progress: 0.75 },
    { name: 'All Done', progress: 1 },
  ];
  const snapshot = {
    game: { code: 'TEST10', title: 'Test Derby', phase: 'tasting' },
    players: progressCases.map(({ name, progress }, order) => ({
      id: `p${order + 1}`,
      name,
      order,
      active: true,
      tastingProgress: progress,
      tastingComplete: progress === 1,
    })),
    bottles: [{ letter: 'A', order: 0, active: true, revealed: false }],
    details: {},
    responses: [],
  };
  const html = renderTvScoreboard({
    snapshot,
    calc: calculateGame(snapshot),
    joinUrl: 'https://example.test/?game=TEST10',
    qrUrl: 'https://example.test/qr.svg',
  });

  assert.equal(classCount(html, 'tv-tasting-progress'), progressCases.length);
  assert.equal(classCount(html, 'tv-drunk-bottle', { prefix: true }), 0);
  assert.equal(classCount(html, 'tv-progress-bottle', { prefix: true }), 0);
  assert.equal(classCount(html, 'tv-tasting-progress-track'), progressCases.length);
  assert.equal(classCount(html, 'tv-tasting-progress-value'), progressCases.length);

  for (const { name, progress } of progressCases) {
    const percent = progress * 100;
    const progressTag = tastingProgressTagFor(html, name);
    assert.match(progressTag, /class="tv-tasting-progress"/);
    assert.match(progressTag, /role="progressbar"/);
    assert.match(progressTag, /aria-valuemin="0"/);
    assert.match(progressTag, /aria-valuemax="100"/);
    assert.match(progressTag, new RegExp(`aria-valuenow="${percent}"`));
    assert.match(progressTag, new RegExp(`aria-valuetext="${percent}% complete"`));
    assert.match(progressTag, new RegExp(`--tasting-progress:\\s*${percent}%`));
  }
});

test('Taste cards show each player’s published notes without loading private guesses', () => {
  const snapshot = {
    game: { code: 'NOTES1', title: 'Notes Derby', phase: 'tasting' },
    players: [{
      id: 'p1', name: 'Daniel', order: 0, active: true,
      tastingProgress: 0.5, tastingCompletedLetters: ['A'],
      tastingNotesByLetter: { A: 'Cherry cola', B: 'Hot cinnamon finish' },
    }],
    bottles: ['A', 'B'].map((letter, order) => ({ letter, order, active: true, revealed: false })),
    details: {},
    responses: [],
  };
  const html = renderTvScoreboard({
    snapshot,
    calc: calculateGame(snapshot),
    joinUrl: 'https://example.test/?game=NOTES1',
    qrUrl: 'https://example.test/qr.svg',
  });

  assert.match(html, /class="tv-player-notes"/);
  assert.match(html, /Cherry cola/);
  assert.match(html, /Hot cinnamon finish/);
  assert.doesNotMatch(html, /priceGuess|proofGuess|finalRank/);
});

test('revealed bottle cards show stable short comments and hide long or unrevealed notes', () => {
  const players = Array.from({ length: 6 }, (_, index) => ({ id: `p${index + 1}`, name: `Palate ${index + 1}`, order: index, active: true }));
  const bottle = { letter: 'A', order: 0, active: true, revealed: true };
  const responses = players.map((player, index) => ({
    playerId: player.id,
    bottleLetter: 'A',
    finalRank: 1,
    notes: index === 5 ? 'A'.repeat(REVEAL_TASTING_NOTE_MAX_LENGTH + 20) : `Funny short note ${index + 1}`,
  }));
  const snapshot = {
    game: { code: 'NOTES1', title: 'Notes Derby', phase: 'reveal' },
    players,
    bottles: [bottle],
    details: { A: { letter: 'A', name: 'The Revealed Bourbon', distillery: 'Test Still', retailPrice: 45, proof: 100 } },
    responses,
  };
  const renderSnapshot = (nextSnapshot) => renderTvScoreboard({
    snapshot: nextSnapshot,
    calc: calculateGame(nextSnapshot),
    joinUrl: 'https://example.test/?game=NOTES1',
    qrUrl: 'https://example.test/qr.svg',
  });
  const revealedHtml = renderSnapshot(snapshot);
  assert.match(revealedHtml, /class="tv-reveal-notes"/);
  assert.equal(classCount(revealedHtml, 'tv-reveal-notes'), 1);
  assert.equal((revealedHtml.match(/Funny short note/g) || []).length, 4);
  assert.doesNotMatch(revealedHtml, new RegExp(`A{${REVEAL_TASTING_NOTE_MAX_LENGTH + 20}}`));

  const hiddenSnapshot = { ...snapshot, bottles: [{ ...bottle, revealed: false }] };
  assert.doesNotMatch(renderSnapshot(hiddenSnapshot), /tv-reveal-notes|Funny short note/);
});

test('Higher or Lower renders one semantic drunken bottle per active bourbon', () => {
  const moodCases = [
    { letter: 'A', percent: 0, locked: 0, mood: 'sober' },
    { letter: 'B', percent: 25, locked: 1, mood: 'warming' },
    { letter: 'C', percent: 50, locked: 2, mood: 'tipsy' },
    { letter: 'D', percent: 75, locked: 3, mood: 'wobbly' },
    { letter: 'E', percent: 100, locked: 4, mood: 'hammered' },
  ];
  const snapshot = {
    game: {
      code: 'TEST10',
      title: 'Test Derby',
      phase: 'higherLower',
      publicAverages: Object.fromEntries(moodCases.map(({ letter }) => [letter, { price: 42, proof: 100 }])),
    },
    players: [
      { id: 'p1', name: 'One', order: 0, active: true, higherLowerCompletedLetters: ['B', 'C', 'D', 'E'] },
      { id: 'p2', name: 'Two', order: 1, active: true, higherLowerCompletedLetters: ['C', 'D', 'E'] },
      { id: 'p3', name: 'Three', order: 2, active: true, higherLowerCompletedLetters: ['D', 'E'] },
      { id: 'p4', name: 'Four', order: 3, active: true, higherLowerCompletedLetters: ['E'] },
    ],
    bottles: moodCases.map(({ letter }, order) => ({ letter, order, active: true, revealed: false })),
    details: {},
    responses: [],
  };
  const html = renderTvScoreboard({
    snapshot,
    calc: calculateGame(snapshot),
    joinUrl: 'https://example.test/?game=TEST10',
    qrUrl: 'https://example.test/qr.svg',
  });

  assert.equal(classCount(html, 'tv-drunk-bottle', { prefix: true }), moodCases.length);
  for (const hook of ['liquid', 'face', 'eyes', 'mouth', 'arms', 'legs', 'value']) {
    assert.equal(classCount(html, `tv-drunk-bottle-${hook}`), moodCases.length);
  }

  for (const { letter, percent, locked, mood } of moodCases) {
    const bottle = drunkBottleTagFor(html, letter);
    assert.match(bottle, new RegExp(`class="[^"]*\\b${mood}\\b`));
    assert.match(bottle, /role="progressbar"/);
    assert.match(bottle, /aria-valuemin="0"/);
    assert.match(bottle, /aria-valuemax="100"/);
    assert.match(bottle, new RegExp(`aria-valuenow="${percent}"`));
    assert.match(bottle, new RegExp(`aria-valuetext="${locked} of 4 crowd cards locked, ${percent}%"`));
    assert.match(bottle, new RegExp(`--bottle-fill:\\s*${percent}%`));
  }
});

test('the final TV stage renders the real biggest-loser artwork and no persistent header', () => {
  const snapshot = {
    game: { code: 'TEST10', title: 'Test Derby', phase: 'final' },
    players: [
      { id: 'p1', name: 'Winner', order: 0, active: true, bonusPoints: 2 },
      { id: 'p2', name: 'Last Place', order: 1, active: true },
    ],
    bottles: [],
    details: {},
    responses: [],
  };
  const html = renderTvScoreboard({
    snapshot,
    calc: calculateGame(snapshot),
    joinUrl: 'https://example.test/?game=TEST10',
    qrUrl: 'https://example.test/qr.svg',
  });

  assert.match(html, /data-tv-phase="final"/);
  assert.match(html, /data-award="biggest-loser"/);
  assert.match(html, /Last Place/);
  assert.match(html, /biggest-loser-poop\.webp/);
  assert.match(imageAltFor(html, 'biggest-loser-poop.webp'), /poop/i);
  const kingAlt = imageAltFor(html, 'moose-king.webp');
  assert.match(kingAlt, /moose/i);
  assert.match(kingAlt, /king|crown/i);
  assert.match(kingAlt, /x(?:-shaped)?-?eyed|x(?:-shaped)? eyes|blind/i);
  assert.match(kingAlt, /bubbl|dizz/i);
  assert.doesNotMatch(html, /tv-savant-star/);
  assert.doesNotMatch(html, /tv-scoreboard-header|under wraps/i);
});

test('portrait scoreboards center the King Moose without changing the TV layout', () => {
  const styles = readFileSync(new URL('../css/styles.css', import.meta.url), 'utf8');
  const portraitStart = styles.indexOf('@media (max-aspect-ratio: 4 / 3)');
  const portraitEnd = styles.indexOf('\n}', portraitStart);
  assert.ok(portraitStart >= 0 && portraitEnd > portraitStart, 'Expected a portrait scoreboard override');
  const portraitStyles = styles.slice(portraitStart, portraitEnd);

  assert.match(portraitStyles, /body\.scoreboard-mode \.tv-king-moose/);
  assert.match(portraitStyles, /top:\s*50%/);
  assert.match(portraitStyles, /bottom:\s*auto/);
  assert.match(portraitStyles, /transform:\s*translate\(-50%, -50%\)/);
  assert.match(portraitStyles, /object-position:\s*center/);
});

test('new games reserve exactly 10 hidden self-registration slots', () => {
  const slots = createPlayerRegistrationSlots();
  assert.equal(MAX_PLAYERS, 10);
  assert.equal(slots.length, MAX_PLAYERS);
  assert.deepEqual(slots.map((player) => player.id), Array.from({ length: 10 }, (_, index) => `player-${String(index + 1).padStart(2, '0')}`));
  assert.ok(slots.every((player) => player.active === false && player.name === '' && player.claimedBy === null));

  const legacyCompatible = createPlayerRegistrationSlots([{ id: 'old-player', name: '  Captain   Bad Decisions  ' }]);
  assert.equal(legacyCompatible[0].id, 'old-player');
  assert.equal(legacyCompatible[0].name, 'Captain Bad Decisions');
  assert.equal(legacyCompatible[0].active, true);
  assert.equal(legacyCompatible.filter((player) => player.active !== false).length, 1);
  assert.equal(normalizePlayerName('x'.repeat(PLAYER_NAME_MAX_LENGTH + 20)).length, PLAYER_NAME_MAX_LENGTH);
});

test('setup removes host-entered names and the join screen owns registration', () => {
  const appSource = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
  const storeSource = readFileSync(new URL('../js/store.js', import.meta.url), 'utf8');
  const rulesSource = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');

  assert.match(appSource, /data-form="register-player"/);
  assert.match(appSource, /name="playerName"/);
  assert.match(appSource, /Registration is closed/);
  assert.doesNotMatch(appSource, /data-create-player|data-host-player|add-create-player|add-host-player/);
  assert.match(storeSource, /async registerPlayer\(code, name\)/);
  assert.match(storeSource, /runTransaction\(db/);
  assert.match(storeSource, /Registration is closed\. All 10 player spots are taken/);
  assert.match(rulesSource, /resource\.data\.active == false[\s\S]*request\.resource\.data\.active == true/);
  assert.match(rulesSource, /request\.resource\.data\.name\.size\(\) <= 48/);
  assert.match(rulesSource, /affectedKeys\(\)\.hasOnly\(\[[\s\S]*'name'[\s\S]*'active'[\s\S]*'claimedBy'[\s\S]*'claimedAt'/);
});

test('the lobby advertises self-registration and excludes hidden slots', () => {
  const snapshot = {
    game: { code: 'JOIN10', title: 'Funny Name Derby', phase: 'setup' },
    players: createPlayerRegistrationSlots([{ name: 'Whiskey Business', claimedBy: 'uid-1' }]),
    bottles: [],
    details: {},
    responses: [],
  };
  const html = renderTvScoreboard({
    snapshot,
    calc: calculateGame(snapshot),
    joinUrl: 'https://example.test/?game=JOIN10',
    qrUrl: 'https://example.test/qr.svg',
  });
  assert.match(html, /1<\/strong><span>of 10 player spots filled/);
  assert.match(html, /Whiskey Business/);
  assert.match(html, /invent a ridiculous name/i);
  assert.doesNotMatch(html, /player-02/);
});

test('participant completion is shared on the player card and reset with the game', () => {
  const storeSource = readFileSync(new URL('../js/store.js', import.meta.url), 'utf8');
  const rulesSource = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');

  assert.match(storeSource, /async completeEasterEgg\(code, playerId, phase\)/);
  assert.match(storeSource, /easterEggCompleted:\s*true/);
  assert.match(storeSource, /easterEggCompletedStage:\s*phase/);
  assert.match(storeSource, /async resetAnswers\(code\)[\s\S]*easterEggCompleted:\s*false/);
  assert.match(rulesSource, /validEasterEggCompletion\(\)/);
  assert.match(rulesSource, /affectedKeys\(\)\.hasOnly\(\[[\s\S]*'easterEggCompleted'[\s\S]*'easterEggCompletedStage'/);
  assert.match(rulesSource, /request\.resource\.data\.easterEggCompletedStage in \['tasting', 'higherLower', 'reveal'\]/);
  assert.match(rulesSource, /validTastingNotes\(request\.resource\.data\.tastingNotesByLetter\)/);
  assert.match(rulesSource, /affectedKeys\(\)\.hasOnly\(\[[\s\S]*'tastingNotesByLetter'/);
});

test('the service worker precaches TV assets and refreshes standalone boards safely', () => {
  const serviceWorkerSource = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  const appSource = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');

  for (const asset of [
    './js/easter-egg.js',
    './js/tasting-notes.js',
    './js/registration.js',
    './assets/moose-bourbon-creek.webp',
    './assets/moose-moonshiner.webp',
    './assets/moose-game-show-host.webp',
    './assets/moose-king.webp',
    './assets/moose-shower-surprise.webp',
    './assets/biggest-loser-poop.webp',
  ]) {
    assert.ok(serviceWorkerSource.includes(`'${asset}'`), `Expected the service worker to precache ${asset}`);
  }
  assert.match(serviceWorkerSource, /CACHE_NAME = 'blind-bourbon-derby-v14-self-registration'/);
  assert.doesNotMatch(serviceWorkerSource, /blind-bourbon-derby-v11-phone-king-centering/);
  const codeAssetStart = serviceWorkerSource.indexOf('if (isCodeAsset)');
  const codeAssetEnd = serviceWorkerSource.indexOf('\n  event.respondWith(', codeAssetStart);
  assert.ok(codeAssetStart >= 0 && codeAssetEnd > codeAssetStart, 'Expected a dedicated code-asset fetch path');
  const codeAssetFetchSource = serviceWorkerSource.slice(codeAssetStart, codeAssetEnd);
  assert.match(codeAssetFetchSource, /fetch\(request\)[\s\S]*\.catch\(\(\) => caches\.match\(request\)\)/);
  assert.doesNotMatch(codeAssetFetchSource, /cached \|\| network/);
  assert.match(serviceWorkerSource, /clients\.matchAll\(\{ type: 'window' \}\)/);
  assert.match(serviceWorkerSource, /searchParams\.get\('view'\) === 'scoreboard'/);
  assert.match(serviceWorkerSource, /client\.navigate\(client\.url\)/);
  assert.match(appSource, /SERVICE_WORKER_UPDATE_INTERVAL = 5 \* 60 \* 1000/);
  assert.match(appSource, /serviceWorkerRegistration\.update\(\)/);
  assert.match(appSource, /state\.view !== 'scoreboard' \|\| !serviceWorkerRegistration/);
});
