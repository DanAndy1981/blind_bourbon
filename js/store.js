const FIREBASE_VERSION = '12.16.0';
const LOCAL_PREFIX = 'blind-bourbon-derby::';
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const clone = (value) => JSON.parse(JSON.stringify(value));
const nowIso = () => new Date().toISOString();
const makeId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);

function configuredFirebase(config) {
  return Boolean(config && config.apiKey && config.projectId && config.appId && !String(config.apiKey).includes('PASTE_'));
}

function randomCode(length = 6) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join('');
}

function normalizeCode(code) {
  return String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
}

function responseId(playerId, letter) {
  return `${playerId}_${letter}`;
}

export async function createStore({ forceLocal = false } = {}) {
  const config = window.DERBY_FIREBASE_CONFIG || null;
  if (!forceLocal && configuredFirebase(config)) {
    const store = new FirebaseStore(config);
    await store.init();
    return store;
  }
  const store = new LocalStore();
  await store.init();
  return store;
}

class LocalStore {
  constructor() {
    this.mode = 'local';
    this.isShared = false;
    this.label = 'Local demo mode';
    this.uid = localStorage.getItem(`${LOCAL_PREFIX}uid`) || makeId();
    localStorage.setItem(`${LOCAL_PREFIX}uid`, this.uid);
    this.channel = 'BroadcastChannel' in window ? new BroadcastChannel('blind-bourbon-derby') : null;
  }

  async init() {
    return this;
  }

  key(code) {
    return `${LOCAL_PREFIX}game::${normalizeCode(code)}`;
  }

  read(code) {
    const raw = localStorage.getItem(this.key(code));
    return raw ? JSON.parse(raw) : null;
  }

  write(code, data) {
    data.game.updatedAt = nowIso();
    localStorage.setItem(this.key(code), JSON.stringify(data));
    this.channel?.postMessage({ type: 'changed', code: normalizeCode(code) });
    return clone(data);
  }

  async createGame(payload) {
    let code = normalizeCode(payload.code);
    if (!code) {
      do code = randomCode(); while (this.read(code));
    }
    if (this.read(code)) throw new Error('That game code already exists in this browser.');
    const createdAt = nowIso();
    const players = (payload.players || []).map((player, index) => ({
      id: player.id || makeId(),
      name: String(player.name || '').trim(),
      order: index,
      active: true,
      claimedBy: null,
      bonusPoints: Number(player.bonusPoints || 0),
    })).filter((player) => player.name);
    const bottles = (payload.bottles || []).map((bottle, index) => ({
      letter: bottle.letter,
      order: index,
      active: true,
      revealed: Boolean(bottle.revealed),
    }));
    const details = Object.fromEntries((payload.bottles || []).map((bottle) => [bottle.letter, {
      letter: bottle.letter,
      name: bottle.name || '',
      distillery: bottle.distillery || '',
      retailPrice: bottle.retailPrice === '' ? null : Number(bottle.retailPrice),
      proof: bottle.proof === '' ? null : Number(bottle.proof),
      notes: bottle.notes || '',
    }]));
    const data = {
      game: {
        code,
        title: payload.title || 'Blind Bourbon Derby',
        eventDate: payload.eventDate || '',
        theme: payload.theme || '',
        phase: payload.phase || 'setup',
        hostUid: this.uid,
        createdAt,
        updatedAt: createdAt,
      },
      players,
      bottles,
      details,
      responses: [],
      picks: [],
    };
    this.write(code, data);
    return code;
  }

  async loadGame(code) {
    const data = this.read(code);
    return data ? clone(data) : null;
  }

  async claimPlayer(code, playerId) {
    const data = this.read(code);
    if (!data) throw new Error('Game not found.');
    const player = data.players.find((item) => item.id === playerId);
    if (!player) throw new Error('Player not found.');
    if (player.claimedBy && player.claimedBy !== this.uid) throw new Error('That player card is already claimed.');
    player.claimedBy = this.uid;
    player.claimedAt = nowIso();
    this.write(code, data);
  }

  async releasePlayer(code, playerId) {
    const data = this.read(code);
    if (!data) return;
    const player = data.players.find((item) => item.id === playerId);
    if (!player) return;
    if (player.claimedBy === this.uid || data.game.hostUid === this.uid) {
      player.claimedBy = null;
      delete player.claimedAt;
      this.write(code, data);
    }
  }

  async saveResponse(code, playerId, letter, patch) {
    const data = this.read(code);
    if (!data) throw new Error('Game not found.');
    const id = responseId(playerId, letter);
    const index = data.responses.findIndex((response) => response.id === id);
    const next = {
      ...(index >= 0 ? data.responses[index] : {}),
      id,
      playerId,
      bottleLetter: letter,
      ...patch,
      updatedAt: nowIso(),
    };
    if (index >= 0) data.responses[index] = next;
    else data.responses.push(next);
    this.write(code, data);
  }

  async savePicks(code, playerId, patch) {
    const data = this.read(code);
    if (!data) throw new Error('Game not found.');
    const index = data.picks.findIndex((pick) => pick.playerId === playerId);
    const next = {
      ...(index >= 0 ? data.picks[index] : {}),
      playerId,
      ...patch,
      updatedAt: nowIso(),
    };
    if (index >= 0) data.picks[index] = next;
    else data.picks.push(next);
    this.write(code, data);
  }

  async updateGame(code, patch) {
    const data = this.read(code);
    if (!data) throw new Error('Game not found.');
    Object.assign(data.game, patch);
    this.write(code, data);
  }

  async saveSetup(code, payload) {
    const data = this.read(code);
    if (!data) throw new Error('Game not found.');
    Object.assign(data.game, {
      title: payload.title || data.game.title,
      eventDate: payload.eventDate || '',
      theme: payload.theme || '',
    });

    const existingPlayers = new Map(data.players.map((player) => [player.id, player]));
    data.players = payload.players.map((player, index) => ({
      ...(existingPlayers.get(player.id) || {}),
      id: player.id || makeId(),
      name: String(player.name || '').trim(),
      order: index,
      active: true,
      bonusPoints: Number(player.bonusPoints || existingPlayers.get(player.id)?.bonusPoints || 0),
    })).filter((player) => player.name);

    const retainedPlayerIds = new Set(data.players.map((player) => player.id));
    data.responses = data.responses.filter((response) => retainedPlayerIds.has(response.playerId));
    data.picks = data.picks.filter((pick) => retainedPlayerIds.has(pick.playerId));

    const oldBottles = new Map(data.bottles.map((bottle) => [bottle.letter, bottle]));
    const oldDetails = data.details || {};
    data.bottles = payload.bottles.map((bottle, index) => ({
      ...(oldBottles.get(bottle.letter) || {}),
      letter: bottle.letter,
      order: index,
      active: true,
      revealed: Boolean(oldBottles.get(bottle.letter)?.revealed),
    }));
    data.details = Object.fromEntries(payload.bottles.map((bottle) => [bottle.letter, {
      ...(oldDetails[bottle.letter] || {}),
      letter: bottle.letter,
      name: bottle.name || '',
      distillery: bottle.distillery || '',
      retailPrice: bottle.retailPrice === '' || bottle.retailPrice === null ? null : Number(bottle.retailPrice),
      proof: bottle.proof === '' || bottle.proof === null ? null : Number(bottle.proof),
      notes: bottle.notes || '',
    }]));
    const retainedLetters = new Set(data.bottles.map((bottle) => bottle.letter));
    data.responses = data.responses.filter((response) => retainedLetters.has(response.bottleLetter));
    this.write(code, data);
  }

  async setBonus(code, playerId, points) {
    const data = this.read(code);
    const player = data?.players.find((item) => item.id === playerId);
    if (!player) throw new Error('Player not found.');
    player.bonusPoints = Number(points || 0);
    this.write(code, data);
  }

  async revealBottle(code, letter, revealed = true) {
    const data = this.read(code);
    const bottle = data?.bottles.find((item) => item.letter === letter);
    if (!bottle) throw new Error('Bottle not found.');
    bottle.revealed = Boolean(revealed);
    this.write(code, data);
  }

  async resetPlayerClaim(code, playerId) {
    const data = this.read(code);
    const player = data?.players.find((item) => item.id === playerId);
    if (!player) return;
    player.claimedBy = null;
    delete player.claimedAt;
    this.write(code, data);
  }

  async resetAnswers(code) {
    const data = this.read(code);
    if (!data) return;
    data.responses = [];
    data.picks = [];
    data.players.forEach((player) => { player.bonusPoints = 0; });
    data.bottles.forEach((bottle) => { bottle.revealed = false; });
    data.game.phase = 'tasting';
    this.write(code, data);
  }

  async createDemoGame() {
    const existing = this.read('DEMO26');
    if (existing) return 'DEMO26';
    const players = ['Daniel', 'Mike', 'Owen', 'Chris', 'Ben', 'Josh'].map((name) => ({ name }));
    const bottles = [
      { letter: 'A', name: 'Cumberland Rail', distillery: 'Volunteer Spirits', retailPrice: 34, proof: 92, notes: 'Caramel, orange peel, toasted oak' },
      { letter: 'B', name: 'Copper Still Reserve', distillery: 'Harpeth Bend', retailPrice: 49, proof: 100, notes: 'Cherry, baking spice, cocoa' },
      { letter: 'C', name: 'Riverboat Bottled-in-Bond', distillery: 'Old Hickory Works', retailPrice: 42, proof: 100, notes: 'Peanut brittle, leather, vanilla' },
      { letter: 'D', name: 'Midnight Ringleader', distillery: 'Nashville Barrel Co.', retailPrice: 64, proof: 114, notes: 'Dark fruit, cinnamon, char' },
      { letter: 'E', name: 'Red Clay Small Batch', distillery: 'Sequatchie Distilling', retailPrice: 28, proof: 90, notes: 'Honey, corn bread, light oak' },
    ];
    const code = await this.createGame({
      code: 'DEMO26',
      title: 'Blind Bourbon Derby',
      eventDate: '2026-08-16',
      theme: 'Tennessee Throwdown',
      phase: 'final',
      players,
      bottles: bottles.map((bottle) => ({ ...bottle, revealed: true })),
    });
    const data = this.read(code);
    data.bottles.forEach((bottle) => { bottle.revealed = true; });
    const buyOptions = ['Hell Yes', 'Maybe', 'Nope'];
    const rankOrders = [
      ['D','B','C','A','E'], ['B','D','A','C','E'], ['D','C','B','E','A'],
      ['B','D','C','A','E'], ['D','B','A','C','E'], ['C','D','B','A','E'],
    ];
    data.players.forEach((player, playerIndex) => {
      const order = rankOrders[playerIndex];
      data.picks.push({ playerId: player.id, winnerPick: playerIndex === 2 ? 'C' : 'D', lastPick: 'E' });
      data.bottles.forEach((bottle, bottleIndex) => {
        const detail = data.details[bottle.letter];
        const rank = order.indexOf(bottle.letter) + 1;
        const priceGuess = Math.max(18, detail.retailPrice + ((playerIndex * 7 + bottleIndex * 5) % 17) - 8);
        const proofGuess = detail.proof + ((playerIndex * 3 + bottleIndex * 4) % 13) - 6;
        const priceAvgBias = [31, 46, 39, 58, 32][bottleIndex];
        const proofAvgBias = [90, 97, 98, 108, 92][bottleIndex];
        data.responses.push({
          id: responseId(player.id, bottle.letter),
          playerId: player.id,
          bottleLetter: bottle.letter,
          buyChoice: buyOptions[(playerIndex + bottleIndex + (rank < 3 ? 0 : 1)) % 3],
          priceGuess,
          proofGuess,
          finalRank: rank,
          priceHL: detail.retailPrice > priceAvgBias ? 'Higher' : 'Lower',
          proofHL: detail.proof > proofAvgBias ? 'Higher' : 'Lower',
          notes: playerIndex === 0 ? ['Easy sipper','Big spice','Classic profile','Dark and punchy','Thin finish'][bottleIndex] : '',
        });
      });
    });
    data.players[0].bonusPoints = 2;
    this.write(code, data);
    return code;
  }
}

class FirebaseStore {
  constructor(config) {
    this.config = config;
    this.mode = 'firebase';
    this.isShared = true;
    this.label = 'Live shared mode';
    this.uid = null;
    this.api = null;
  }

  async init() {
    const base = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}`;
    const appApi = await import(`${base}/firebase-app.js`);
    const authApi = await import(`${base}/firebase-auth.js`);
    const firestoreApi = await import(`${base}/firebase-firestore.js`);
    const app = appApi.initializeApp(this.config);
    const auth = authApi.getAuth(app);
    await authApi.setPersistence(auth, authApi.browserLocalPersistence);
    if (!auth.currentUser) await authApi.signInAnonymously(auth);
    this.uid = auth.currentUser.uid;
    this.api = { ...firestoreApi, app, auth, db: firestoreApi.getFirestore(app) };
    return this;
  }

  gameRef(code) {
    return this.api.doc(this.api.db, 'games', normalizeCode(code));
  }

  async createGame(payload) {
    const { db, doc, getDoc, writeBatch, collection, serverTimestamp } = this.api;
    let code = normalizeCode(payload.code);
    if (!code) {
      for (let attempts = 0; attempts < 12; attempts += 1) {
        const candidate = randomCode();
        if (!(await getDoc(doc(db, 'games', candidate))).exists()) {
          code = candidate;
          break;
        }
      }
    }
    if (!code) throw new Error('Could not generate a unique game code. Try again.');
    if ((await getDoc(doc(db, 'games', code))).exists()) throw new Error('That game code already exists.');

    const batch = writeBatch(db);
    batch.set(doc(db, 'games', code), {
      code,
      title: payload.title || 'Blind Bourbon Derby',
      eventDate: payload.eventDate || '',
      theme: payload.theme || '',
      phase: payload.phase || 'setup',
      hostUid: this.uid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    (payload.players || []).map((player) => ({ ...player, name: String(player.name || '').trim() })).filter((player) => player.name).forEach((player, index) => {
      const id = player.id || makeId();
      batch.set(doc(collection(db, 'games', code, 'players'), id), {
        id,
        name: player.name,
        order: index,
        active: true,
        claimedBy: null,
        bonusPoints: Number(player.bonusPoints || 0),
      });
    });

    (payload.bottles || []).forEach((bottle, index) => {
      batch.set(doc(db, 'games', code, 'bottles', bottle.letter), {
        letter: bottle.letter,
        order: index,
        active: true,
        revealed: Boolean(bottle.revealed),
      });
      batch.set(doc(db, 'games', code, 'bottleDetails', bottle.letter), {
        letter: bottle.letter,
        name: bottle.name || '',
        distillery: bottle.distillery || '',
        retailPrice: bottle.retailPrice === '' || bottle.retailPrice === null ? null : Number(bottle.retailPrice),
        proof: bottle.proof === '' || bottle.proof === null ? null : Number(bottle.proof),
        notes: bottle.notes || '',
      });
    });

    await batch.commit();
    return code;
  }

  async loadGame(code, { playerId = null, role = 'player' } = {}) {
    const { db, doc, getDoc, getDocs, collection, query, orderBy, where } = this.api;
    code = normalizeCode(code);
    const gameSnap = await getDoc(doc(db, 'games', code));
    if (!gameSnap.exists()) return null;
    const game = gameSnap.data();
    const isHost = game.hostUid === this.uid;

    const [playersSnap, bottlesSnap] = await Promise.all([
      getDocs(query(collection(db, 'games', code, 'players'), orderBy('order'))),
      getDocs(query(collection(db, 'games', code, 'bottles'), orderBy('order'))),
    ]);
    const players = playersSnap.docs.map((item) => item.data());
    const bottles = bottlesSnap.docs.map((item) => item.data());

    let detailDocs = [];
    if (isHost) {
      detailDocs = (await getDocs(collection(db, 'games', code, 'bottleDetails'))).docs;
    } else {
      const visibleLetters = bottles.filter((bottle) => bottle.revealed || game.phase === 'final').map((bottle) => bottle.letter);
      const snaps = await Promise.all(visibleLetters.map((letter) => getDoc(doc(db, 'games', code, 'bottleDetails', letter))));
      detailDocs = snaps.filter((snap) => snap.exists());
    }
    const details = Object.fromEntries(detailDocs.map((item) => [item.id, item.data()]));

    let responses = [];
    let picks = [];
    const canReadAll = isHost || game.phase === 'reveal' || game.phase === 'final' || role === 'host';
    try {
      if (canReadAll) {
        const [responsesSnap, picksSnap] = await Promise.all([
          getDocs(collection(db, 'games', code, 'responses')),
          getDocs(collection(db, 'games', code, 'picks')),
        ]);
        responses = responsesSnap.docs.map((item) => ({ id: item.id, ...item.data() }));
        picks = picksSnap.docs.map((item) => item.data());
      } else if (playerId) {
        const [responsesSnap, pickSnap] = await Promise.all([
          getDocs(query(collection(db, 'games', code, 'responses'), where('playerId', '==', playerId))),
          getDoc(doc(db, 'games', code, 'picks', playerId)),
        ]);
        responses = responsesSnap.docs.map((item) => ({ id: item.id, ...item.data() }));
        if (pickSnap.exists()) picks = [pickSnap.data()];
      }
    } catch (error) {
      console.warn('Some private game data could not be read yet:', error);
    }

    return { game, players, bottles, details, responses, picks };
  }

  async claimPlayer(code, playerId) {
    const { db, doc, runTransaction, serverTimestamp } = this.api;
    code = normalizeCode(code);
    await runTransaction(db, async (transaction) => {
      const ref = doc(db, 'games', code, 'players', playerId);
      const snap = await transaction.get(ref);
      if (!snap.exists()) throw new Error('Player not found.');
      const data = snap.data();
      if (data.claimedBy && data.claimedBy !== this.uid) throw new Error('That player card is already claimed.');
      transaction.update(ref, { claimedBy: this.uid, claimedAt: serverTimestamp() });
    });
  }

  async releasePlayer(code, playerId) {
    const { db, doc, updateDoc, deleteField } = this.api;
    await updateDoc(doc(db, 'games', normalizeCode(code), 'players', playerId), {
      claimedBy: null,
      claimedAt: deleteField(),
    });
  }

  async saveResponse(code, playerId, letter, patch) {
    const { db, doc, setDoc, serverTimestamp } = this.api;
    await setDoc(doc(db, 'games', normalizeCode(code), 'responses', responseId(playerId, letter)), {
      playerId,
      bottleLetter: letter,
      ...patch,
      updatedAt: serverTimestamp(),
    }, { merge: true });
  }

  async savePicks(code, playerId, patch) {
    const { db, doc, setDoc, serverTimestamp } = this.api;
    await setDoc(doc(db, 'games', normalizeCode(code), 'picks', playerId), {
      playerId,
      ...patch,
      updatedAt: serverTimestamp(),
    }, { merge: true });
  }

  async updateGame(code, patch) {
    const { db, doc, updateDoc, serverTimestamp } = this.api;
    await updateDoc(doc(db, 'games', normalizeCode(code)), { ...patch, updatedAt: serverTimestamp() });
  }

  async saveSetup(code, payload) {
    const { db, doc, getDocs, collection, writeBatch, serverTimestamp } = this.api;
    code = normalizeCode(code);
    const [playersSnap, bottlesSnap] = await Promise.all([
      getDocs(collection(db, 'games', code, 'players')),
      getDocs(collection(db, 'games', code, 'bottles')),
    ]);
    const oldPlayers = new Map(playersSnap.docs.map((item) => [item.id, item.data()]));
    const oldBottles = new Map(bottlesSnap.docs.map((item) => [item.id, item.data()]));
    const batch = writeBatch(db);

    batch.update(doc(db, 'games', code), {
      title: payload.title || 'Blind Bourbon Derby',
      eventDate: payload.eventDate || '',
      theme: payload.theme || '',
      updatedAt: serverTimestamp(),
    });

    const retainedPlayerIds = new Set();
    payload.players.map((player) => ({ ...player, name: String(player.name || '').trim() })).filter((player) => player.name).forEach((player, index) => {
      const id = player.id || makeId();
      retainedPlayerIds.add(id);
      const existing = oldPlayers.get(id) || {};
      batch.set(doc(db, 'games', code, 'players', id), {
        id,
        name: player.name,
        order: index,
        active: true,
        claimedBy: existing.claimedBy || null,
        claimedAt: existing.claimedAt || null,
        bonusPoints: Number(player.bonusPoints ?? existing.bonusPoints ?? 0),
      });
    });
    for (const old of playersSnap.docs) {
      if (!retainedPlayerIds.has(old.id)) batch.delete(old.ref);
    }

    const retainedLetters = new Set();
    payload.bottles.forEach((bottle, index) => {
      retainedLetters.add(bottle.letter);
      const existing = oldBottles.get(bottle.letter) || {};
      batch.set(doc(db, 'games', code, 'bottles', bottle.letter), {
        letter: bottle.letter,
        order: index,
        active: true,
        revealed: Boolean(existing.revealed),
      });
      batch.set(doc(db, 'games', code, 'bottleDetails', bottle.letter), {
        letter: bottle.letter,
        name: bottle.name || '',
        distillery: bottle.distillery || '',
        retailPrice: bottle.retailPrice === '' || bottle.retailPrice === null ? null : Number(bottle.retailPrice),
        proof: bottle.proof === '' || bottle.proof === null ? null : Number(bottle.proof),
        notes: bottle.notes || '',
      });
    });
    for (const old of bottlesSnap.docs) {
      if (!retainedLetters.has(old.id)) {
        batch.delete(old.ref);
        batch.delete(doc(db, 'games', code, 'bottleDetails', old.id));
      }
    }

    await batch.commit();
  }

  async setBonus(code, playerId, points) {
    const { db, doc, updateDoc } = this.api;
    await updateDoc(doc(db, 'games', normalizeCode(code), 'players', playerId), { bonusPoints: Number(points || 0) });
  }

  async revealBottle(code, letter, revealed = true) {
    const { db, doc, updateDoc } = this.api;
    await updateDoc(doc(db, 'games', normalizeCode(code), 'bottles', letter), { revealed: Boolean(revealed) });
  }

  async resetPlayerClaim(code, playerId) {
    return this.releasePlayer(code, playerId);
  }

  async resetAnswers(code) {
    const { db, doc, getDocs, collection, writeBatch, serverTimestamp } = this.api;
    code = normalizeCode(code);
    const [responsesSnap, picksSnap, playersSnap, bottlesSnap] = await Promise.all([
      getDocs(collection(db, 'games', code, 'responses')),
      getDocs(collection(db, 'games', code, 'picks')),
      getDocs(collection(db, 'games', code, 'players')),
      getDocs(collection(db, 'games', code, 'bottles')),
    ]);
    const batch = writeBatch(db);
    responsesSnap.docs.forEach((item) => batch.delete(item.ref));
    picksSnap.docs.forEach((item) => batch.delete(item.ref));
    playersSnap.docs.forEach((item) => batch.update(item.ref, { bonusPoints: 0 }));
    bottlesSnap.docs.forEach((item) => batch.update(item.ref, { revealed: false }));
    batch.update(doc(db, 'games', code), { phase: 'tasting', updatedAt: serverTimestamp() });
    await batch.commit();
  }

  async createDemoGame() {
    throw new Error('The populated demo is available only before Firebase is configured.');
  }
}

export { makeId, normalizeCode };
