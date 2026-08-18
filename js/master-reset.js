const FIREBASE_VERSION = '12.16.0';
const RESET_COLLECTIONS = Object.freeze([
  'responses',
  'picks',
  'bottleDetails',
  'bottles',
  'players',
]);
const BATCH_LIMIT = 400;

let resetInProgress = false;
let injectionQueued = false;

const normalizeCode = (value) => String(value || '')
  .toUpperCase()
  .replace(/[^A-Z0-9]/g, '')
  .slice(0, 8);

function currentGameCode() {
  return normalizeCode(new URLSearchParams(location.search).get('game'));
}

function configuredFirebase(config) {
  return Boolean(
    config
      && config.apiKey
      && config.projectId
      && config.appId
      && !String(config.apiKey).includes('PASTE_')
  );
}

function clearGameBrowserState(code) {
  const localKeys = [
    `blind-bourbon-derby::game::${code}`,
    `blind-bourbon-derby::player::${code}`,
    `blind-bourbon-derby::pending-registration::${code}`,
  ];
  const sessionKeys = [
    `blind-bourbon-derby::registration-draft::${code}`,
  ];

  for (const key of localKeys) {
    try { localStorage.removeItem(key); } catch { /* Storage can be unavailable. */ }
  }
  for (const key of sessionKeys) {
    try { sessionStorage.removeItem(key); } catch { /* Storage can be unavailable. */ }
  }
}

function goToFreshSetup() {
  const url = new URL(location.href);
  url.search = '';
  url.hash = '';
  location.replace(url.toString());
}

function resetCopy(code) {
  return `
    <div>
      <span class="kicker">Nuclear option</span>
      <h3>Master game reset</h3>
      <p>Permanently deletes game <strong>${code}</strong>, every player, every score, and the complete bottle vault. You will return to a blank facilitator setup and everyone must scan the new QR code and register again.</p>
    </div>
    <button class="btn btn-danger btn-lg" type="button" data-master-reset-game ${resetInProgress ? 'disabled' : ''}>
      ${resetInProgress ? 'Resetting the Derby…' : 'Master Reset & Start Over'}
    </button>`;
}

function injectMasterReset() {
  const resetAnswersButton = document.querySelector('[data-action="reset-answers"]');
  if (!resetAnswersButton) return;
  const dangerZone = resetAnswersButton.closest('.danger-zone') || resetAnswersButton.parentElement;
  if (!dangerZone || dangerZone.parentElement?.querySelector(':scope > [data-master-reset-zone]')) return;

  const code = currentGameCode();
  if (!code) return;

  const section = document.createElement('section');
  section.className = 'paper-panel ink-frame danger-zone master-reset-zone';
  section.dataset.masterResetZone = '1';
  section.innerHTML = resetCopy(code);
  dangerZone.insertAdjacentElement('afterend', section);
}

function scheduleInjection() {
  if (injectionQueued) return;
  injectionQueued = true;
  requestAnimationFrame(() => {
    injectionQueued = false;
    injectMasterReset();
  });
}

async function firebaseContext() {
  const base = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}`;
  const [appApi, authApi, firestoreApi] = await Promise.all([
    import(`${base}/firebase-app.js`),
    import(`${base}/firebase-auth.js`),
    import(`${base}/firebase-firestore.js`),
  ]);

  const config = window.DERBY_FIREBASE_CONFIG;
  if (!configuredFirebase(config)) return null;

  const app = appApi.getApps().length ? appApi.getApp() : appApi.initializeApp(config);
  const auth = authApi.getAuth(app);
  try {
    await authApi.setPersistence(auth, authApi.browserLocalPersistence);
  } catch {
    // The main app may already have established persistence.
  }
  if (!auth.currentUser) await authApi.signInAnonymously(auth);
  if (!auth.currentUser) throw new Error('Could not verify the facilitator account.');

  return {
    auth,
    db: firestoreApi.getFirestore(app),
    api: firestoreApi,
  };
}

async function deleteFirebaseGame(code) {
  const context = await firebaseContext();
  if (!context) return false;

  const { auth, db, api } = context;
  const gameRef = api.doc(db, 'games', code);
  const gameSnap = await api.getDoc(gameRef);
  if (!gameSnap.exists()) return true;
  if (gameSnap.data().hostUid !== auth.currentUser.uid) {
    throw new Error('Only the facilitator browser that created this derby can master-reset it.');
  }

  const snapshots = await Promise.all(RESET_COLLECTIONS.map((name) => (
    api.getDocs(api.collection(db, 'games', code, name))
  )));
  const refs = snapshots.flatMap((snapshot) => snapshot.docs.map((item) => item.ref));

  // Delete child documents first. Firestore does not recursively delete
  // subcollections when a parent document is removed.
  for (let index = 0; index < refs.length; index += BATCH_LIMIT) {
    const batch = api.writeBatch(db);
    refs.slice(index, index + BATCH_LIMIT).forEach((ref) => batch.delete(ref));
    await batch.commit();
  }

  await api.deleteDoc(gameRef);
  return true;
}

async function performMasterReset(code) {
  const useFirebase = configuredFirebase(window.DERBY_FIREBASE_CONFIG)
    && new URLSearchParams(location.search).get('demo') !== '1';

  if (useFirebase) await deleteFirebaseGame(code);
  clearGameBrowserState(code);
  goToFreshSetup();
}

function confirmMasterReset(code) {
  const first = window.confirm(
    `MASTER RESET GAME ${code}?\n\nThis permanently deletes all bottle details, players, answers, scores, and reveal progress. The current player link will stop working.`
  );
  if (!first) return false;

  const typed = window.prompt(`Type the game code ${code} to confirm the permanent reset:`);
  if (normalizeCode(typed) !== code) {
    if (typed !== null) window.alert('Game code did not match. Nothing was reset.');
    return false;
  }
  return true;
}

document.addEventListener('click', async (event) => {
  const button = event.target.closest?.('[data-master-reset-game]');
  if (!button || resetInProgress) return;

  const code = currentGameCode();
  if (!code || !confirmMasterReset(code)) return;

  resetInProgress = true;
  button.disabled = true;
  button.textContent = 'Resetting the Derby…';

  try {
    await performMasterReset(code);
  } catch (error) {
    resetInProgress = false;
    button.disabled = false;
    button.textContent = 'Master Reset & Start Over';
    console.error('Master reset failed:', error);
    window.alert(`The master reset did not finish. Leave this page open and try again; the reset is safe to retry.\n\n${error?.message || error}`);
    scheduleInjection();
  }
});

const root = document.querySelector('#app');
if (root) new MutationObserver(scheduleInjection).observe(root, { childList: true, subtree: true });
document.addEventListener('DOMContentLoaded', scheduleInjection, { once: true });
window.addEventListener('pageshow', scheduleInjection);
scheduleInjection();
