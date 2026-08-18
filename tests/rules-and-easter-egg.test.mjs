import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const css = readFileSync(new URL('../css/rules-and-easter-egg.css', import.meta.url), 'utf8');

test('TV setup rules use couch-readable type and a simpler display face', () => {
  assert.match(css, /\.tv-drunk-rule strong[\s\S]*font-family:\s*var\(--font-condensed\)/);
  assert.match(css, /\.tv-drunk-rule strong[\s\S]*font-size:\s*clamp\(22px/);
  assert.match(css, /\.tv-drunk-rule span[\s\S]*font-size:\s*clamp\(19px/);
  assert.match(css, /\.tv-drunk-rule span[\s\S]*font-weight:\s*600/);
});

test('setup rules compact only after the contestant strip gains a second row', () => {
  assert.match(css, /:has\(\.tv-contestant-strip > div:nth-child\(6\)\)/);
  assert.match(css, /:has\(\.tv-contestant-strip > div:nth-child\(6\)\)[\s\S]*\.tv-drunk-rule span[\s\S]*clamp\(17px/);
});

test('participant setup rules are larger on phones', () => {
  assert.match(css, /\.participant-rules \.drunk-rule strong[\s\S]*clamp\(1\.12rem/);
  assert.match(css, /\.participant-rules \.drunk-rule span[\s\S]*clamp\(\.96rem/);
  assert.match(css, /\.participant-rules \.drunk-rule span[\s\S]*line-height:\s*1\.4/);
});

test('portrait Easter egg shows the complete shower illustration', () => {
  assert.match(css, /@media \(orientation: portrait\) and \(max-width: 900px\)/);
  assert.match(css, /\.tv-shower-surprise\.surface-player \.tv-shower-surprise-image[\s\S]*object-fit:\s*contain/);
  assert.match(css, /object-position:\s*center center/);
  assert.match(css, /tvSurprisePortraitReveal/);
});
