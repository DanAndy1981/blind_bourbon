function snapshotDocuments(snapshot, { includeId = false } = {}) {
  return snapshot.docs.map((item) => includeId
    ? { id: item.id, ...item.data() }
    : item.data());
}

function stableSnapshotSignature(snapshot) {
  return JSON.stringify(snapshot, (key, value) => (
    ['createdAt', 'updatedAt', 'claimedAt'].includes(key) ? undefined : value
  ));
}

/**
 * Subscribe to the smallest live Firestore projection required by one surface.
 *
 * The TV needs only public player progress until Reveal, participant phones need
 * only their own responses, and the facilitator owns the full private dataset.
 * Keeping those boundaries here prevents the UI from falling back to repeated
 * full-game reads as the event grows.
 */
export function subscribeToFirebaseGame({ api, code, uid, role, playerId, onValue, onError }) {
  const {
    db,
    collection,
    doc,
    onSnapshot,
    orderBy,
    query,
    where,
  } = api;

  let stopped = false;
  let emitQueued = false;
  let lastSignature = '';
  let responseMode = '';
  let responseUnsubscribe = null;
  let detailMode = '';
  let detailUnsubscribe = null;
  const revealedDetailUnsubscribes = new Map();
  const revealedDetailReady = new Set();
  const unsubscribes = [];
  const ready = {
    game: false,
    players: false,
    bottles: false,
    details: false,
    responses: false,
  };
  const current = {
    game: null,
    players: [],
    bottles: [],
    details: {},
    responses: [],
  };

  const fail = (error) => {
    if (!stopped) onError?.(error);
  };

  const emit = () => {
    if (stopped || emitQueued || !ready.game) return;
    if (current.game && !Object.values(ready).every(Boolean)) return;
    emitQueued = true;
    queueMicrotask(() => {
      emitQueued = false;
      if (stopped || !ready.game) return;
      if (current.game && !Object.values(ready).every(Boolean)) return;
      if (!current.game) {
        if (lastSignature === 'missing') return;
        lastSignature = 'missing';
        onValue(null);
        return;
      }
      const value = {
        game: current.game,
        players: current.players,
        bottles: current.bottles,
        details: current.details,
        responses: current.responses,
      };
      const signature = stableSnapshotSignature(value);
      if (signature === lastSignature) return;
      lastSignature = signature;
      onValue(value);
    });
  };

  const clearResponseListener = () => {
    responseUnsubscribe?.();
    responseUnsubscribe = null;
  };

  const desiredResponseMode = () => {
    if (!current.game) return 'pending';
    const isHost = current.game.hostUid === uid;
    if (role === 'host' && isHost) return 'all';
    if (role === 'scoreboard' && ['reveal', 'final'].includes(current.game.phase)) return 'all';
    if (playerId) return `player:${playerId}`;
    return 'none';
  };

  const reconcileResponses = () => {
    const nextMode = desiredResponseMode();
    if (nextMode === responseMode) return;
    responseMode = nextMode;
    clearResponseListener();
    current.responses = [];
    ready.responses = nextMode === 'none';

    if (nextMode === 'pending') return;
    if (nextMode === 'none') {
      emit();
      return;
    }

    const source = nextMode === 'all'
      ? collection(db, 'games', code, 'responses')
      : query(collection(db, 'games', code, 'responses'), where('playerId', '==', playerId));
    responseUnsubscribe = onSnapshot(source, (snapshot) => {
      current.responses = snapshotDocuments(snapshot, { includeId: true });
      ready.responses = true;
      emit();
    }, fail);
  };

  const clearDetailListeners = () => {
    detailUnsubscribe?.();
    detailUnsubscribe = null;
    revealedDetailUnsubscribes.forEach((unsubscribe) => unsubscribe());
    revealedDetailUnsubscribes.clear();
    revealedDetailReady.clear();
  };

  const visibleDetailLetters = () => new Set(current.bottles
    .filter((bottle) => bottle.revealed)
    .map((bottle) => bottle.letter));

  const detailsAreReady = (letters) => [...letters].every((letter) => revealedDetailReady.has(letter));

  const reconcileDetails = () => {
    if (!ready.game || !ready.bottles) return;
    const isHost = current.game.hostUid === uid;
    const nextMode = role === 'host' && isHost
      ? 'all'
      : role === 'scoreboard'
        ? 'revealed'
        : 'none';

    if (nextMode !== detailMode) {
      clearDetailListeners();
      current.details = {};
      detailMode = nextMode;
      ready.details = nextMode === 'none';

      if (nextMode === 'all') {
        detailUnsubscribe = onSnapshot(collection(db, 'games', code, 'bottleDetails'), (snapshot) => {
          current.details = Object.fromEntries(snapshot.docs.map((item) => [item.id, item.data()]));
          ready.details = true;
          emit();
        }, fail);
        return;
      }
    }

    if (nextMode === 'none' || nextMode === 'all') {
      emit();
      return;
    }

    const letters = visibleDetailLetters();
    revealedDetailUnsubscribes.forEach((unsubscribe, letter) => {
      if (letters.has(letter)) return;
      unsubscribe();
      revealedDetailUnsubscribes.delete(letter);
      revealedDetailReady.delete(letter);
      delete current.details[letter];
    });

    letters.forEach((letter) => {
      if (revealedDetailUnsubscribes.has(letter)) return;
      ready.details = false;
      const unsubscribe = onSnapshot(doc(db, 'games', code, 'bottleDetails', letter), (snapshot) => {
        if (snapshot.exists()) current.details[letter] = snapshot.data();
        else delete current.details[letter];
        revealedDetailReady.add(letter);
        ready.details = detailsAreReady(visibleDetailLetters());
        emit();
      }, fail);
      revealedDetailUnsubscribes.set(letter, unsubscribe);
    });

    ready.details = detailsAreReady(letters);
    emit();
  };

  unsubscribes.push(onSnapshot(doc(db, 'games', code), (snapshot) => {
    current.game = snapshot.exists() ? snapshot.data() : null;
    ready.game = true;
    if (!current.game) {
      clearResponseListener();
      clearDetailListeners();
      responseMode = 'none';
      detailMode = 'none';
      ready.responses = true;
      ready.details = true;
      emit();
      return;
    }
    reconcileResponses();
    reconcileDetails();
    emit();
  }, fail));

  unsubscribes.push(onSnapshot(
    query(collection(db, 'games', code, 'players'), orderBy('order')),
    (snapshot) => {
      current.players = snapshotDocuments(snapshot);
      ready.players = true;
      emit();
    },
    fail,
  ));

  unsubscribes.push(onSnapshot(
    query(collection(db, 'games', code, 'bottles'), orderBy('order')),
    (snapshot) => {
      current.bottles = snapshotDocuments(snapshot);
      ready.bottles = true;
      reconcileDetails();
      emit();
    },
    fail,
  ));

  return () => {
    if (stopped) return;
    stopped = true;
    clearResponseListener();
    clearDetailListeners();
    unsubscribes.forEach((unsubscribe) => unsubscribe());
  };
}
