import { sanitizeTastingNotesByLetter, tastingNotesFromResponses } from './tasting-notes.js';

export const PHASES = [
  { id: 'setup', label: 'Setup', short: 'Setup' },
  { id: 'tasting', label: 'Blind Tasting', short: 'Taste' },
  { id: 'higherLower', label: 'Higher / Lower', short: 'H / L' },
  { id: 'reveal', label: 'The Reveal', short: 'Reveal' },
  { id: 'final', label: 'Final Results', short: 'Final' },
];

export const BUY_CHOICES = ['Hell Yes', 'Maybe', 'Nope'];
export const HL_CHOICES = ['Higher', 'Lower'];

const asNumber = (value) => {
  if (value === '' || value === null || value === undefined) return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

const average = (values) => {
  const nums = values.map(asNumber).filter((value) => value !== null);
  if (!nums.length) return null;
  return nums.reduce((sum, value) => sum + value, 0) / nums.length;
};

const closeEnough = (a, b) => {
  const left = asNumber(a);
  const right = asNumber(b);
  if (left === null || right === null) return false;
  return Math.abs(left - right) < 0.000001;
};

const normalizeDetails = (details) => {
  if (!details) return {};
  if (!Array.isArray(details)) return details;
  return Object.fromEntries(details.map((detail) => [detail.letter || detail.id, detail]));
};

const byOrder = (a, b) => (a.order ?? 999) - (b.order ?? 999) || String(a.letter || a.name).localeCompare(String(b.letter || b.name));

export function phaseIndex(phase) {
  const index = PHASES.findIndex((item) => item.id === phase);
  return index < 0 ? 0 : index;
}

export function phaseAtLeast(phase, target) {
  return phaseIndex(phase) >= phaseIndex(target);
}

export function summarizePlayerProgress({ bottles = [], responses = [] } = {}) {
  const activeBottles = [...bottles].filter((bottle) => bottle.active !== false).sort(byOrder);
  const responseByLetter = new Map(responses.map((response) => [response.bottleLetter, response]));
  const playerResponses = activeBottles.map((bottle) => responseByLetter.get(bottle.letter) || {});
  const ranks = playerResponses.map((response) => asNumber(response.finalRank)).filter((value) => value !== null);
  const rankSetValid = ranks.length === activeBottles.length
    && new Set(ranks).size === activeBottles.length
    && ranks.every((rank) => Number.isInteger(rank) && rank >= 1 && rank <= activeBottles.length);

  const tastingCompletedLetters = activeBottles
    .filter((bottle, index) => {
      const response = playerResponses[index];
      return BUY_CHOICES.includes(response.buyChoice)
        && asNumber(response.priceGuess) !== null
        && asNumber(response.proofGuess) !== null
        && Number.isInteger(asNumber(response.finalRank));
    })
    .map((bottle) => bottle.letter);
  const higherLowerCompletedLetters = activeBottles
    .filter((bottle, index) => {
      const response = playerResponses[index];
      return HL_CHOICES.includes(response.priceHL) && HL_CHOICES.includes(response.proofHL);
    })
    .map((bottle) => bottle.letter);

  const tastingCompletedFields = playerResponses.reduce((count, response) => {
    let row = 0;
    if (BUY_CHOICES.includes(response.buyChoice)) row += 1;
    if (asNumber(response.priceGuess) !== null) row += 1;
    if (asNumber(response.proofGuess) !== null) row += 1;
    if (Number.isInteger(asNumber(response.finalRank))) row += 1;
    return count + row;
  }, 0);
  const higherLowerCompletedFields = playerResponses.reduce((count, response) =>
    count + (HL_CHOICES.includes(response.priceHL) ? 1 : 0) + (HL_CHOICES.includes(response.proofHL) ? 1 : 0), 0);
  const tastingTotalFields = activeBottles.length * 4;
  const higherLowerTotalFields = activeBottles.length * 2;

  return {
    tastingProgress: tastingTotalFields ? tastingCompletedFields / tastingTotalFields : 0,
    tastingComplete: tastingCompletedLetters.length === activeBottles.length && rankSetValid,
    tastingCompletedLetters,
    tastingNotesByLetter: tastingNotesFromResponses({ bottles: activeBottles, responses: playerResponses }),
    rankSetValid,
    higherLowerProgress: higherLowerTotalFields ? higherLowerCompletedFields / higherLowerTotalFields : 0,
    higherLowerComplete: higherLowerCompletedLetters.length === activeBottles.length,
    higherLowerCompletedLetters,
  };
}

function publishedProgress(player, calculated, hasResponses) {
  if (hasResponses) return calculated;
  const bounded = (value, fallback) => {
    const number = asNumber(value);
    return number === null ? fallback : Math.max(0, Math.min(1, number));
  };
  const letters = (value, fallback) => Array.isArray(value)
    ? value.filter((letter) => typeof letter === 'string')
    : fallback;
  return {
    ...calculated,
    tastingProgress: bounded(player.tastingProgress, calculated.tastingProgress),
    tastingComplete: typeof player.tastingComplete === 'boolean' ? player.tastingComplete : calculated.tastingComplete,
    tastingCompletedLetters: letters(player.tastingCompletedLetters, calculated.tastingCompletedLetters),
    tastingNotesByLetter: sanitizeTastingNotesByLetter(player.tastingNotesByLetter),
    higherLowerProgress: bounded(player.higherLowerProgress, calculated.higherLowerProgress),
    higherLowerComplete: typeof player.higherLowerComplete === 'boolean' ? player.higherLowerComplete : calculated.higherLowerComplete,
    higherLowerCompletedLetters: letters(player.higherLowerCompletedLetters, calculated.higherLowerCompletedLetters),
  };
}

export function calculateGame(snapshot = {}) {
  const game = snapshot.game || {};
  const players = [...(snapshot.players || [])]
    .filter((player) => player.active !== false)
    .sort(byOrder);
  const bottles = [...(snapshot.bottles || [])]
    .filter((bottle) => bottle.active !== false)
    .sort(byOrder);
  const detailsByLetter = normalizeDetails(snapshot.details);
  const responses = snapshot.responses || [];

  const activePlayerIds = new Set(players.map((player) => player.id));
  const activeLetters = new Set(bottles.map((bottle) => bottle.letter));
  const responseMap = new Map();
  for (const response of responses) {
    if (!activePlayerIds.has(response.playerId) || !activeLetters.has(response.bottleLetter)) continue;
    responseMap.set(`${response.playerId}::${response.bottleLetter}`, response);
  }

  const bottleResults = bottles.map((bottle) => {
    const detail = detailsByLetter[bottle.letter] || {};
    const bottleResponses = players
      .map((player) => responseMap.get(`${player.id}::${bottle.letter}`))
      .filter(Boolean);

    const avgPriceGuess = average(bottleResponses.map((response) => response.priceGuess));
    const avgProofGuess = average(bottleResponses.map((response) => response.proofGuess));
    const avgFinish = average(bottleResponses.map((response) => response.finalRank));
    const actualPrice = asNumber(detail.retailPrice);
    const actualProof = asNumber(detail.proof);

    const hellYes = bottleResponses.filter((response) => response.buyChoice === 'Hell Yes').length;
    const maybe = bottleResponses.filter((response) => response.buyChoice === 'Maybe').length;
    const nope = bottleResponses.filter((response) => response.buyChoice === 'Nope').length;

    let priceAnswer = null;
    if (actualPrice !== null && avgPriceGuess !== null) {
      priceAnswer = actualPrice > avgPriceGuess ? 'Higher' : actualPrice < avgPriceGuess ? 'Lower' : 'Push';
    }

    let proofAnswer = null;
    if (actualProof !== null && avgProofGuess !== null) {
      proofAnswer = actualProof > avgProofGuess ? 'Higher' : actualProof < avgProofGuess ? 'Lower' : 'Push';
    }

    const priceGuesses = bottleResponses
      .map((response) => asNumber(response.priceGuess))
      .filter((value) => value !== null);
    let pirWinningGuess = null;
    let pirPointsAvailable = 0;
    if (actualPrice !== null && priceGuesses.length) {
      const notOver = priceGuesses.filter((guess) => guess <= actualPrice);
      if (notOver.length) {
        pirWinningGuess = Math.max(...notOver);
        pirPointsAvailable = 3;
      } else {
        pirWinningGuess = Math.min(...priceGuesses);
        pirPointsAvailable = 2;
      }
    }

    return {
      ...bottle,
      detail,
      responses: bottleResponses,
      avgPriceGuess,
      avgProofGuess,
      avgFinish,
      actualPrice,
      actualProof,
      hellYes,
      maybe,
      nope,
      priceAnswer,
      proofAnswer,
      pirWinningGuess,
      pirPointsAvailable,
      clubPlace: null,
      priceRank: null,
      upsetGap: null,
      disappointmentGap: null,
    };
  });

  const rankedBottles = bottleResults
    .filter((bottle) => bottle.avgFinish !== null)
    .sort((a, b) =>
      a.avgFinish - b.avgFinish ||
      b.hellYes - a.hellYes ||
      b.maybe - a.maybe ||
      (a.order ?? 999) - (b.order ?? 999)
    );

  rankedBottles.forEach((bottle, index) => {
    bottle.clubPlace = index + 1;
  });

  for (const bottle of bottleResults) {
    if (bottle.actualPrice !== null) {
      bottle.priceRank = 1 + bottleResults.filter((other) => other.actualPrice !== null && other.actualPrice > bottle.actualPrice).length;
    }
    if (bottle.priceRank !== null && bottle.clubPlace !== null) {
      // A positive upset gap means a less-expensive bottle outran its price
      // rank. The reverse gap identifies an expensive bottle that disappointed.
      bottle.upsetGap = bottle.priceRank - bottle.clubPlace;
      bottle.disappointmentGap = bottle.clubPlace - bottle.priceRank;
    }
  }

  const winner = rankedBottles.find((bottle) => bottle.clubPlace === 1) || null;
  const lastPlace = rankedBottles.find((bottle) => bottle.clubPlace === bottles.length) || rankedBottles.at(-1) || null;

  const playerResults = players.map((player) => {
    let priceHL = 0;
    let proofHL = 0;
    let priceIsRight = 0;
    const responseDocuments = bottles
      .map((bottle) => responseMap.get(`${player.id}::${bottle.letter}`))
      .filter(Boolean);
    const playerResponses = bottles.map((bottle) => responseMap.get(`${player.id}::${bottle.letter}`) || {});
    const winnerLetter = bottles.find((bottle, index) => asNumber(playerResponses[index].finalRank) === 1)?.letter || null;
    const lastLetter = bottles.find((bottle, index) => asNumber(playerResponses[index].finalRank) === bottles.length)?.letter || null;

    for (const bottle of bottleResults) {
      const response = responseMap.get(`${player.id}::${bottle.letter}`) || {};
      if (bottle.priceAnswer && bottle.priceAnswer !== 'Push' && response.priceHL === bottle.priceAnswer) priceHL += 1;
      if (bottle.proofAnswer && bottle.proofAnswer !== 'Push' && response.proofHL === bottle.proofAnswer) proofHL += 1;
      if (bottle.pirWinningGuess !== null && closeEnough(response.priceGuess, bottle.pirWinningGuess)) {
        priceIsRight += bottle.pirPointsAvailable;
      }
    }

    const winnerPick = winner && winnerLetter === winner.letter ? 5 : 0;
    const lastPick = lastPlace && lastLetter === lastPlace.letter ? 3 : 0;
    const bonus = asNumber(player.bonusPoints) ?? 0;
    const total = priceHL + proofHL + priceIsRight + winnerPick + lastPick + bonus;

    const progress = publishedProgress(
      player,
      summarizePlayerProgress({ bottles, responses: responseDocuments }),
      responseDocuments.length > 0,
    );

    return {
      ...player,
      priceHL,
      proofHL,
      priceIsRight,
      winnerPick,
      lastPick,
      winnerLetter,
      lastLetter,
      bonus,
      total,
      rank: null,
      ...progress,
    };
  });

  for (const player of playerResults) {
    player.rank = 1 + playerResults.filter((other) => other.total > player.total).length;
  }
  playerResults.sort((a, b) => b.total - a.total || (a.order ?? 999) - (b.order ?? 999));

  const upsetCandidates = bottleResults.filter((bottle) => bottle.upsetGap !== null);
  const biggestUpset = upsetCandidates.length
    ? upsetCandidates.reduce((best, bottle) => bottle.upsetGap > best.upsetGap ? bottle : best)
    : null;
  const disappointmentCandidates = bottleResults.filter((bottle) => bottle.disappointmentGap !== null);
  const biggestDisappointment = disappointmentCandidates.length
    ? disappointmentCandidates.reduce((worst, bottle) => bottle.disappointmentGap > worst.disappointmentGap ? bottle : worst)
    : null;
  const highestPlayerScore = playerResults.length ? Math.max(...playerResults.map((player) => player.total)) : null;
  const savants = highestPlayerScore === null
    ? []
    : playerResults.filter((player) => player.total === highestPlayerScore);
  const savant = highestPlayerScore !== null && highestPlayerScore > 0 ? savants[0] : null;
  const lowestPlayerScore = playerResults.length ? Math.min(...playerResults.map((player) => player.total)) : null;
  const biggestLosers = lowestPlayerScore === null
    ? []
    : playerResults.filter((player) => player.total === lowestPlayerScore);

  return {
    game,
    players,
    bottles,
    detailsByLetter,
    responseMap,
    bottleResults,
    rankedBottles,
    revealOrder: [...rankedBottles].sort((a, b) => (b.clubPlace ?? 0) - (a.clubPlace ?? 0)),
    playerResults,
    winner,
    lastPlace,
    biggestUpset,
    biggestDisappointment,
    savant,
    savants,
    biggestLosers,
  };
}

export function formatMoney(value, digits = 0) {
  const number = asNumber(value);
  if (number === null) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(number);
}

export function formatNumber(value, digits = 1) {
  const number = asNumber(value);
  if (number === null) return '—';
  return number.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function clampPercent(value) {
  return Math.max(0, Math.min(100, Math.round((Number(value) || 0) * 100)));
}
