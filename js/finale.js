const SCENES = new Set(['bottles', 'players', 'awards']);
const CUE_TYPES = new Set([
  'bottle',
  'valueChampion',
  'biggestUpset',
  'player',
  'savant',
  'biggestLoser',
  'finalBoard',
]);

export function emptyFinaleState() {
  return {
    scene: 'bottles',
    revealedPlayerIds: [],
    valueChampionRevealed: false,
    biggestUpsetRevealed: false,
    savantRevealed: false,
    biggestLoserRevealed: false,
    finalBoardRevealed: false,
    cueId: 0,
    cueType: '',
    cueTarget: '',
  };
}

function cleanIds(value) {
  return [...new Set((Array.isArray(value) ? value : [])
    .filter((id) => typeof id === 'string' && id)
    .slice(0, 10))];
}

export function normalizeFinaleState(game = {}, { legacyFinalOpen = true } = {}) {
  const raw = game.finaleState;
  if (!raw && legacyFinalOpen && game.phase === 'final') {
    return {
      ...emptyFinaleState(),
      scene: 'awards',
      legacyOpen: true,
      valueChampionRevealed: true,
      biggestUpsetRevealed: true,
      savantRevealed: true,
      biggestLoserRevealed: true,
      finalBoardRevealed: true,
    };
  }

  const base = emptyFinaleState();
  return {
    ...base,
    scene: SCENES.has(raw?.scene) ? raw.scene : base.scene,
    revealedPlayerIds: cleanIds(raw?.revealedPlayerIds),
    valueChampionRevealed: Boolean(raw?.valueChampionRevealed),
    biggestUpsetRevealed: Boolean(raw?.biggestUpsetRevealed),
    savantRevealed: Boolean(raw?.savantRevealed),
    biggestLoserRevealed: Boolean(raw?.biggestLoserRevealed),
    finalBoardRevealed: Boolean(raw?.finalBoardRevealed),
    cueId: Math.max(0, Math.floor(Number(raw?.cueId) || 0)),
    cueType: CUE_TYPES.has(raw?.cueType) ? raw.cueType : '',
    cueTarget: typeof raw?.cueTarget === 'string' ? raw.cueTarget : '',
  };
}

export function nextFinaleState(game, patch = {}, cue = null) {
  const current = normalizeFinaleState(game, { legacyFinalOpen: false });
  const next = normalizeFinaleState({ finaleState: { ...current, ...patch } }, { legacyFinalOpen: false });
  if (!cue || !CUE_TYPES.has(cue.type)) return next;
  return {
    ...next,
    cueId: current.cueId + 1,
    cueType: cue.type,
    cueTarget: typeof cue.target === 'string' ? cue.target : '',
  };
}

export function finalePlayersComplete(finaleState, players = []) {
  const revealed = new Set(normalizeFinaleState({ finaleState }, { legacyFinalOpen: false }).revealedPlayerIds);
  return players.length > 0 && players.every((player) => revealed.has(player.id));
}

export function finaleCueMatches(activeCue, type, target = '') {
  return Boolean(activeCue
    && activeCue.type === type
    && String(activeCue.target || '') === String(target || ''));
}

export function fullFinaleState(game, players = []) {
  return nextFinaleState(game, {
    scene: 'awards',
    revealedPlayerIds: players.map((player) => player.id),
    valueChampionRevealed: true,
    biggestUpsetRevealed: true,
    savantRevealed: true,
    biggestLoserRevealed: true,
    finalBoardRevealed: true,
  }, { type: 'finalBoard' });
}
