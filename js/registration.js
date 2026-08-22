export const MAX_PLAYERS = 10;
export const PLAYER_NAME_MAX_LENGTH = 48;
const REGISTRATION_CONTENTION_CODES = new Set(['aborted', 'failed-precondition', 'permission-denied']);

export function normalizePlayerName(name) {
  return String(name || '').trim().replace(/\s+/g, ' ').slice(0, PLAYER_NAME_MAX_LENGTH);
}

export function isRegistrationContentionError(error) {
  return error?.message === 'REGISTRATION_SLOT_TAKEN'
    || REGISTRATION_CONTENTION_CODES.has(error?.code);
}

function emptyPlayerSlot(order) {
  return {
    id: `player-${String(order + 1).padStart(2, '0')}`,
    name: '',
    order,
    active: false,
    claimedBy: null,
    bonusPoints: 0,
    tastingProgress: 0,
    tastingComplete: false,
    tastingCompletedLetters: [],
    tastingNotesByLetter: {},
    higherLowerProgress: 0,
    higherLowerComplete: false,
    higherLowerCompletedLetters: [],
    easterEggCompleted: false,
    easterEggCompletedStage: null,
  };
}

export function createPlayerRegistrationSlots(players = []) {
  const registered = players
    .map((player) => ({ ...player, name: normalizePlayerName(player.name) }))
    .filter((player) => player.name)
    .slice(0, MAX_PLAYERS);
  return Array.from({ length: MAX_PLAYERS }, (_, order) => {
    const player = registered[order];
    return player ? {
      ...emptyPlayerSlot(order),
      ...player,
      id: player.id || `player-${String(order + 1).padStart(2, '0')}`,
      name: player.name,
      order,
      active: true,
      claimedBy: player.claimedBy || null,
    } : emptyPlayerSlot(order);
  });
}
