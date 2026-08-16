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
  const picks = snapshot.picks || [];

  const activePlayerIds = new Set(players.map((player) => player.id));
  const activeLetters = new Set(bottles.map((bottle) => bottle.letter));
  const responseMap = new Map();
  for (const response of responses) {
    if (!activePlayerIds.has(response.playerId) || !activeLetters.has(response.bottleLetter)) continue;
    responseMap.set(`${response.playerId}::${response.bottleLetter}`, response);
  }
  const pickMap = new Map(picks.filter((pick) => activePlayerIds.has(pick.playerId)).map((pick) => [pick.playerId, pick]));

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
      valueIndex: null,
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
      bottle.upsetGap = Math.abs(bottle.priceRank - bottle.clubPlace);
    }
    if (bottle.actualPrice !== null && bottle.actualPrice > 0 && bottle.avgFinish !== null) {
      bottle.valueIndex = ((bottles.length + 1 - bottle.avgFinish) / bottle.actualPrice) * 100;
    }
  }

  const winner = rankedBottles.find((bottle) => bottle.clubPlace === 1) || null;
  const lastPlace = rankedBottles.find((bottle) => bottle.clubPlace === bottles.length) || rankedBottles.at(-1) || null;

  const playerResults = players.map((player) => {
    const pick = pickMap.get(player.id) || {};
    let priceHL = 0;
    let proofHL = 0;
    let priceIsRight = 0;

    for (const bottle of bottleResults) {
      const response = responseMap.get(`${player.id}::${bottle.letter}`) || {};
      if (bottle.priceAnswer && bottle.priceAnswer !== 'Push' && response.priceHL === bottle.priceAnswer) priceHL += 1;
      if (bottle.proofAnswer && bottle.proofAnswer !== 'Push' && response.proofHL === bottle.proofAnswer) proofHL += 1;
      if (bottle.pirWinningGuess !== null && closeEnough(response.priceGuess, bottle.pirWinningGuess)) {
        priceIsRight += bottle.pirPointsAvailable;
      }
    }

    const winnerPick = winner && pick.winnerPick === winner.letter ? 5 : 0;
    const lastPick = lastPlace && pick.lastPick === lastPlace.letter ? 3 : 0;
    const bonus = asNumber(player.bonusPoints) ?? 0;
    const total = priceHL + proofHL + priceIsRight + winnerPick + lastPick + bonus;

    const playerResponses = bottles.map((bottle) => responseMap.get(`${player.id}::${bottle.letter}`) || {});
    const ranks = playerResponses.map((response) => asNumber(response.finalRank)).filter((value) => value !== null);
    const uniqueRanks = new Set(ranks);
    const tastingFieldsComplete = playerResponses.every((response) =>
      BUY_CHOICES.includes(response.buyChoice) &&
      asNumber(response.priceGuess) !== null &&
      asNumber(response.proofGuess) !== null &&
      Number.isInteger(asNumber(response.finalRank))
    );
    const rankSetValid = ranks.length === bottles.length && uniqueRanks.size === bottles.length && ranks.every((rank) => rank >= 1 && rank <= bottles.length);
    const picksComplete = activeLetters.has(pick.winnerPick) && activeLetters.has(pick.lastPick);
    const higherLowerComplete = playerResponses.every((response) => HL_CHOICES.includes(response.priceHL) && HL_CHOICES.includes(response.proofHL));

    const tastingCompletedFields = playerResponses.reduce((count, response) => {
      let row = 0;
      if (BUY_CHOICES.includes(response.buyChoice)) row += 1;
      if (asNumber(response.priceGuess) !== null) row += 1;
      if (asNumber(response.proofGuess) !== null) row += 1;
      if (Number.isInteger(asNumber(response.finalRank))) row += 1;
      return count + row;
    }, 0) + (activeLetters.has(pick.winnerPick) ? 1 : 0) + (activeLetters.has(pick.lastPick) ? 1 : 0);
    const tastingTotalFields = bottles.length * 4 + 2;
    const hlCompletedFields = playerResponses.reduce((count, response) => count + (HL_CHOICES.includes(response.priceHL) ? 1 : 0) + (HL_CHOICES.includes(response.proofHL) ? 1 : 0), 0);
    const hlTotalFields = bottles.length * 2;

    return {
      ...player,
      pick,
      priceHL,
      proofHL,
      priceIsRight,
      winnerPick,
      lastPick,
      bonus,
      total,
      rank: null,
      tastingComplete: tastingFieldsComplete && rankSetValid && picksComplete,
      rankSetValid,
      picksComplete,
      higherLowerComplete,
      tastingProgress: tastingTotalFields ? tastingCompletedFields / tastingTotalFields : 0,
      higherLowerProgress: hlTotalFields ? hlCompletedFields / hlTotalFields : 0,
    };
  });

  for (const player of playerResults) {
    player.rank = 1 + playerResults.filter((other) => other.total > player.total).length;
  }
  playerResults.sort((a, b) => b.total - a.total || (a.order ?? 999) - (b.order ?? 999));

  const valueCandidates = bottleResults.filter((bottle) => bottle.valueIndex !== null);
  const valueChampion = valueCandidates.length
    ? valueCandidates.reduce((best, bottle) => bottle.valueIndex > best.valueIndex ? bottle : best)
    : null;
  const upsetCandidates = bottleResults.filter((bottle) => bottle.upsetGap !== null);
  const biggestUpset = upsetCandidates.length
    ? upsetCandidates.reduce((best, bottle) => bottle.upsetGap > best.upsetGap ? bottle : best)
    : null;
  const savant = playerResults.length && playerResults.some((player) => player.total > 0)
    ? playerResults.reduce((best, player) => player.total > best.total ? player : best)
    : null;

  return {
    game,
    players,
    bottles,
    detailsByLetter,
    responseMap,
    pickMap,
    bottleResults,
    rankedBottles,
    revealOrder: [...rankedBottles].sort((a, b) => (b.clubPlace ?? 0) - (a.clubPlace ?? 0)),
    playerResults,
    winner,
    lastPlace,
    valueChampion,
    biggestUpset,
    savant,
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
