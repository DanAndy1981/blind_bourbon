import { PHASES, phaseIndex } from './scoring.js';

function activePlayers(players = []) {
  return players.filter((player) => player?.active !== false);
}

function destinationLabel(phase) {
  return PHASES.find((item) => item.id === phase)?.label || phase;
}

/**
 * Builds the facilitator's soft warning before a forward phase change.
 * The warning deliberately never blocks the host: real events sometimes need
 * to move on even when somebody has put a phone down or left the room.
 */
export function phaseAdvanceWarning({ currentPhase, nextPhase, players = [] } = {}) {
  const currentIndex = phaseIndex(currentPhase);
  const nextIndex = phaseIndex(nextPhase);
  const higherLowerIndex = phaseIndex('higherLower');
  const revealIndex = phaseIndex('reveal');

  if (nextIndex <= currentIndex || nextIndex < higherLowerIndex) return null;

  const active = activePlayers(players);
  if (!active.length) return null;

  const needsBothSections = nextIndex >= revealIndex;
  const incomplete = active.filter((player) => (
    !player.tastingComplete || (needsBothSections && !player.higherLowerComplete)
  ));
  if (!incomplete.length) return null;

  const completeCount = active.length - incomplete.length;
  const sectionLabel = needsBothSections ? 'both scorecard sections' : 'the blind tasting card';
  const names = incomplete.map((player) => player.name || 'Unnamed player');
  const message = [
    `Only ${completeCount} of ${active.length} players have finished ${sectionLabel}.`,
    `Still move to ${destinationLabel(nextPhase)}?`,
    '',
    `Waiting on: ${names.join(', ')}`,
  ].join('\n');

  return {
    completeCount,
    totalCount: active.length,
    incompleteNames: names,
    message,
  };
}
