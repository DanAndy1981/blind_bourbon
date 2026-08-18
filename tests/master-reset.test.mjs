import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../js/master-reset.js', import.meta.url), 'utf8');
const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const serviceWorker = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');

test('master reset is injected only beside the existing host danger zone', () => {
  assert.match(source, /\[data-action="reset-answers"\]/);
  assert.match(source, /data-master-reset-zone/);
  assert.match(source, /Master Reset & Start Over/);
});

test('master reset requires the current game code before destructive work', () => {
  assert.match(source, /window\.confirm/);
  assert.match(source, /window\.prompt/);
  assert.match(source, /normalizeCode\(typed\) !== code/);
});

test('firebase reset deletes every known game collection before the game document', () => {
  for (const name of ['responses', 'picks', 'bottleDetails', 'bottles', 'players']) {
    assert.match(source, new RegExp(`'${name}'`));
  }
  const childCommit = source.indexOf('await batch.commit()');
  const parentDelete = source.indexOf('await api.deleteDoc(gameRef)');
  assert.ok(childCommit > 0 && parentDelete > childCommit);
});

test('master reset clears browser registration state and returns to setup', () => {
  assert.match(source, /blind-bourbon-derby::game::/);
  assert.match(source, /blind-bourbon-derby::player::/);
  assert.match(source, /pending-registration/);
  assert.match(source, /registration-draft/);
  assert.match(source, /location\.replace/);
});

test('master reset ships in the page and offline app shell', () => {
  assert.match(index, /\.\/js\/master-reset\.js/);
  assert.match(serviceWorker, /\.\/js\/master-reset\.js/);
});
