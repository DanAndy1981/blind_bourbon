const SAMPLE_LETTERS = new Set('ABCDEFGHIJ'.split(''));

export const PUBLIC_TASTING_NOTE_MAX_LENGTH = 280;
export const REVEAL_TASTING_NOTE_MAX_LENGTH = 110;

function cleanNote(value, maxLength = PUBLIC_TASTING_NOTE_MAX_LENGTH) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

export function sanitizeTastingNotesByLetter(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const notes = {};
  for (const [letter, rawNote] of Object.entries(value)) {
    if (!SAMPLE_LETTERS.has(letter)) continue;
    const note = cleanNote(rawNote);
    if (note) notes[letter] = note;
  }
  return notes;
}

export function tastingNotesFromResponses({ bottles = [], responses = [] } = {}) {
  const responseByLetter = new Map(responses.map((response) => [response.bottleLetter, response]));
  const notes = {};
  for (const bottle of bottles.filter((item) => item.active !== false).slice(0, 10)) {
    const note = cleanNote(responseByLetter.get(bottle.letter)?.notes);
    if (note && SAMPLE_LETTERS.has(bottle.letter)) notes[bottle.letter] = note;
  }
  return notes;
}

export function tastingNotePreview(value, maxLength = 58) {
  const note = cleanNote(value);
  if (note.length <= maxLength) return note;
  return `${note.slice(0, Math.max(1, maxLength - 1)).trimEnd()}…`;
}

function hashSeed(value) {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function seededShuffle(items, seedText) {
  const shuffled = [...items];
  let seed = hashSeed(seedText) || 1;
  const random = () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) / 4294967296;
  };
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[target]] = [shuffled[target], shuffled[index]];
  }
  return shuffled;
}

function revealCapacity(bottleCount) {
  if (bottleCount <= 3) return { maxCount: 4, characterBudget: 300 };
  if (bottleCount <= 5) return { maxCount: 3, characterBudget: 210 };
  return { maxCount: 2, characterBudget: 125 };
}

export function selectRevealTastingNotes({
  responses = [],
  players = [],
  gameCode = '',
  bottleLetter = '',
  bottleCount = 1,
} = {}) {
  const playerById = new Map(players.map((player) => [player.id, player]));
  const seen = new Set();
  const candidates = responses
    .map((response) => {
      const note = String(response.notes ?? '').replace(/\s+/g, ' ').trim();
      const player = playerById.get(response.playerId);
      return { note, playerId: response.playerId, playerName: player?.name || 'Anonymous Palate' };
    })
    .filter((item) => {
      if (!item.note || item.note.length > REVEAL_TASTING_NOTE_MAX_LENGTH) return false;
      const fingerprint = item.note.toLocaleLowerCase();
      if (seen.has(fingerprint)) return false;
      seen.add(fingerprint);
      return true;
    })
    .sort((left, right) => String(left.playerId).localeCompare(String(right.playerId)) || left.note.localeCompare(right.note));

  const capacity = revealCapacity(Math.max(1, Number(bottleCount) || 1));
  const seed = `${gameCode}::${bottleLetter}::${candidates.map((item) => `${item.playerId}:${item.note}`).join('|')}`;
  const selected = [];
  let usedCharacters = 0;
  for (const item of seededShuffle(candidates, seed)) {
    const cost = item.note.length + item.playerName.length;
    if (usedCharacters + cost > capacity.characterBudget) continue;
    selected.push(item);
    usedCharacters += cost;
    if (selected.length >= capacity.maxCount) break;
  }
  return selected;
}
