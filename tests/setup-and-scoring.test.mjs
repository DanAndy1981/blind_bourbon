import assert from 'node:assert/strict';
import test from 'node:test';

import { calculateGame } from '../js/scoring.js';
import { activeBottlesFromDraft } from '../js/setup.js';

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
