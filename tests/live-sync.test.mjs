import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { subscribeToFirebaseGame } from '../js/live-game-subscription.js';

function fakeFirestore() {
  const listeners = [];
  const reference = (type, args) => ({ type, path: args.slice(1).join('/'), clauses: [] });
  const api = {
    db: {},
    collection(...args) { return reference('collection', args); },
    doc(...args) { return reference('doc', args); },
    orderBy(field) { return { type: 'orderBy', field }; },
    where(field, operator, value) { return { type: 'where', field, operator, value }; },
    query(source, ...clauses) { return { ...source, clauses }; },
    onSnapshot(source, onValue, onError) {
      const listener = { source, onValue, onError, active: true };
      listeners.push(listener);
      return () => { listener.active = false; };
    },
  };

  function active(path) {
    return listeners.filter((listener) => listener.active && listener.source.path === path);
  }

  function emitDoc(path, value) {
    active(path).forEach((listener) => listener.onValue({
      exists: () => value !== null,
      data: () => value,
    }));
  }

  function emitCollection(path, values) {
    active(path).forEach((listener) => {
      const filtered = listener.source.clauses
        .filter((clause) => clause.type === 'where' && clause.operator === '==')
        .reduce((items, clause) => items.filter((item) => item[clause.field] === clause.value), values);
      listener.onValue({
        docs: filtered.map(({ id, ...value }) => ({ id, data: () => value })),
      });
    });
  }

  return { api, active, emitCollection, emitDoc, listeners };
}

const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

test('the tasting scoreboard streams only public progress and reacts without a polling delay', async () => {
  const fake = fakeFirestore();
  const values = [];
  const stop = subscribeToFirebaseGame({
    api: fake.api,
    code: 'TEST12',
    uid: 'host-uid',
    role: 'scoreboard',
    playerId: null,
    onValue: (value) => values.push(value),
    onError: assert.fail,
  });

  fake.emitDoc('games/TEST12', { code: 'TEST12', hostUid: 'host-uid', phase: 'tasting' });
  fake.emitCollection('games/TEST12/players', [{ id: 'p1', name: 'Ada', order: 0, tastingProgress: 0 }]);
  fake.emitCollection('games/TEST12/bottles', [{ id: 'A', letter: 'A', order: 0, revealed: false }]);
  await settle();

  assert.equal(values.length, 1);
  assert.deepEqual(values[0].responses, []);
  assert.deepEqual(values[0].details, {});
  assert.equal(fake.active('games/TEST12/responses').length, 0, 'tasting TV must not download private responses');

  fake.emitCollection('games/TEST12/players', [{ id: 'p1', name: 'Ada', order: 0, tastingProgress: 0.75 }]);
  await settle();
  assert.equal(values.at(-1).players[0].tastingProgress, 0.75);
  assert.equal(values.length, 2);

  stop();
  assert.ok(fake.listeners.every((listener) => !listener.active));
});

test('the scoreboard expands to reveal data only when the game reaches reveal', async () => {
  const fake = fakeFirestore();
  const values = [];
  subscribeToFirebaseGame({
    api: fake.api,
    code: 'TEST34',
    uid: 'tv-uid',
    role: 'scoreboard',
    playerId: null,
    onValue: (value) => values.push(value),
    onError: assert.fail,
  });

  fake.emitDoc('games/TEST34', { code: 'TEST34', hostUid: 'host-uid', phase: 'tasting' });
  fake.emitCollection('games/TEST34/players', [{ id: 'p1', name: 'Lin', order: 0 }]);
  fake.emitCollection('games/TEST34/bottles', [{ id: 'A', letter: 'A', order: 0, revealed: false }]);
  await settle();

  fake.emitDoc('games/TEST34', { code: 'TEST34', hostUid: 'host-uid', phase: 'reveal' });
  fake.emitCollection('games/TEST34/bottles', [{ id: 'A', letter: 'A', order: 0, revealed: true }]);
  assert.equal(fake.active('games/TEST34/responses').length, 1);
  assert.equal(fake.active('games/TEST34/bottleDetails/A').length, 1);

  fake.emitCollection('games/TEST34/responses', [{ id: 'p1_A', playerId: 'p1', bottleLetter: 'A', finalRank: 1 }]);
  fake.emitDoc('games/TEST34/bottleDetails/A', { letter: 'A', name: 'Test Bourbon' });
  await settle();

  assert.equal(values.at(-1).game.phase, 'reveal');
  assert.equal(values.at(-1).responses.length, 1);
  assert.equal(values.at(-1).details.A.name, 'Test Bourbon');
});

test('a participant subscribes only to the claimed card responses', async () => {
  const fake = fakeFirestore();
  const values = [];
  subscribeToFirebaseGame({
    api: fake.api,
    code: 'TEST56',
    uid: 'player-uid',
    role: 'player',
    playerId: 'p2',
    onValue: (value) => values.push(value),
    onError: assert.fail,
  });

  fake.emitDoc('games/TEST56', { code: 'TEST56', hostUid: 'host-uid', phase: 'tasting' });
  fake.emitCollection('games/TEST56/players', [{ id: 'p2', name: 'Grace', order: 0 }]);
  fake.emitCollection('games/TEST56/bottles', [{ id: 'A', letter: 'A', order: 0, revealed: false }]);
  const responseListener = fake.active('games/TEST56/responses')[0];
  assert.deepEqual(responseListener.source.clauses, [{
    type: 'where', field: 'playerId', operator: '==', value: 'p2',
  }]);
  fake.emitCollection('games/TEST56/responses', [{ id: 'p2_A', playerId: 'p2', bottleLetter: 'A', notes: 'Caramel' }]);
  await settle();

  assert.equal(values.at(-1).responses[0].playerId, 'p2');
  assert.equal(fake.active('games/TEST56/bottleDetails').length, 0);
});

test('a burst of scoreboard progress changes coalesces without losing the newest state', async () => {
  const fake = fakeFirestore();
  const values = [];
  subscribeToFirebaseGame({
    api: fake.api,
    code: 'BURST1',
    uid: 'host-uid',
    role: 'scoreboard',
    playerId: null,
    onValue: (value) => values.push(value),
    onError: assert.fail,
  });

  fake.emitDoc('games/BURST1', { code: 'BURST1', hostUid: 'host-uid', phase: 'tasting' });
  fake.emitCollection('games/BURST1/bottles', [{ id: 'A', letter: 'A', order: 0, revealed: false }]);
  fake.emitCollection('games/BURST1/players', Array.from({ length: 10 }, (_, index) => ({
    id: `p${index + 1}`,
    name: `Player ${index + 1}`,
    order: index,
    tastingProgress: 0,
  })));
  await settle();
  assert.equal(values.length, 1);

  for (let step = 1; step <= 100; step += 1) {
    fake.emitCollection('games/BURST1/players', Array.from({ length: 10 }, (_, index) => ({
      id: `p${index + 1}`,
      name: `Player ${index + 1}`,
      order: index,
      tastingProgress: step / 100,
      tastingComplete: step === 100,
    })));
  }
  await settle();

  assert.equal(values.length, 2, 'one render should absorb a same-tick listener burst');
  assert.ok(values.at(-1).players.every((player) => player.tastingComplete));
  assert.ok(values.at(-1).players.every((player) => player.tastingProgress === 1));
});

test('ten simultaneous participants remain isolated during a shared answer burst', async () => {
  const fake = fakeFirestore();
  const clients = Array.from({ length: 10 }, (_, index) => {
    const playerId = `p${index + 1}`;
    const values = [];
    const stop = subscribeToFirebaseGame({
      api: fake.api,
      code: 'TENNOW',
      uid: `uid-${playerId}`,
      role: 'player',
      playerId,
      onValue: (value) => values.push(value),
      onError: assert.fail,
    });
    return { playerId, values, stop };
  });
  const roster = clients.map(({ playerId }, index) => ({
    id: playerId,
    name: `Player ${index + 1}`,
    order: index,
    tastingProgress: 1,
    tastingComplete: true,
  }));

  fake.emitDoc('games/TENNOW', { code: 'TENNOW', hostUid: 'host-uid', phase: 'tasting' });
  fake.emitCollection('games/TENNOW/players', roster);
  fake.emitCollection('games/TENNOW/bottles', [{ id: 'A', letter: 'A', order: 0, revealed: false }]);
  fake.emitCollection('games/TENNOW/responses', clients.map(({ playerId }, index) => ({
    id: `${playerId}_A`,
    playerId,
    bottleLetter: 'A',
    notes: `Private note ${index + 1}`,
  })));
  await settle();

  assert.equal(fake.active('games/TENNOW/responses').length, 10);
  clients.forEach(({ playerId, values }, index) => {
    assert.equal(values.at(-1).responses.length, 1);
    assert.equal(values.at(-1).responses[0].playerId, playerId);
    assert.equal(values.at(-1).responses[0].notes, `Private note ${index + 1}`);
  });

  clients.forEach(({ stop }) => stop());
  assert.equal(fake.active('games/TENNOW/responses').length, 0);
});

test('response saves are queued as one atomic multi-document operation', () => {
  const appSource = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
  const storeSource = readFileSync(new URL('../js/store.js', import.meta.url), 'utf8');

  assert.match(appSource, /pendingResponsePatches: new Map\(\)/);
  assert.match(appSource, /await state\.store\.saveResponses\(/);
  assert.match(appSource, /mustRenderTransition = phaseChanged \|\| ownershipChanged/);
  assert.match(appSource, /textEditing: !mustRenderTransition/);
  assert.match(storeSource, /async saveResponses\(code, playerId, changes, progress = null\)/);
  assert.match(storeSource, /changes\.forEach\([\s\S]*batch\.set\([\s\S]*batch\.update\([\s\S]*await batch\.commit\(\)/);
  assert.match(storeSource, /const \[appApi, authApi, firestoreApi\] = await Promise\.all\(\[/);
  assert.doesNotMatch(appSource, /}, 3500\);/);
});
