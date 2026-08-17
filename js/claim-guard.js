// Runtime hardening for mobile registration and long, auto-refreshing pages.
// This script loads before app.js so it can guard the registration workflow
// and preserve the user's scroll position when the app refreshes the DOM.
(() => {
  'use strict';

  const FORM_SELECTOR = 'form[data-form="claim-player"], form[data-form="register-player"]';
  const PLAYER_CARD_SELECTOR = '.player-topline, .sample-card, .sample-tabs';
  const APP_PREFIX = 'blind-bourbon-derby::';
  const PENDING_PREFIX = `${APP_PREFIX}pending-registration::`;
  const RECOVERY_PARAM = '_claimRecovery';
  const ROUTE_RETRY_LIMIT = 18;
  const ROUTE_RETRY_MS = 450;
  const HARD_RELOAD_AFTER = 10;
  const FORM_TIMEOUT_MS = 25000;
  const SCROLL_SUPPRESS_MS = 1200;

  let suppressScrollUntil = 0;
  let activeWatchdog = null;
  let rootGuardInstalled = false;
  let restoringScroll = false;
  let lastKnownRoute = location.href;
  let observerRefreshQueued = false;

  const normalizeCode = (value) => String(value || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 8);

  const gameCode = () => normalizeCode(new URLSearchParams(location.search).get('game'));
  const playerStorageKey = (code = gameCode()) => `${APP_PREFIX}player::${normalizeCode(code)}`;
  const pendingStorageKey = (code = gameCode()) => `${PENDING_PREFIX}${normalizeCode(code)}`;

  function now() {
    return Date.now();
  }

  function suppressScrollRestore(duration = SCROLL_SUPPRESS_MS) {
    suppressScrollUntil = performance.now() + duration;
  }

  function isEditing() {
    const active = document.activeElement;
    return Boolean(active && (
      ['INPUT', 'TEXTAREA', 'SELECT'].includes(active.tagName)
      || active.isContentEditable
    ));
  }

  function readPending(code = gameCode()) {
    if (!code) return null;
    try {
      const raw = sessionStorage.getItem(pendingStorageKey(code));
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function writePending(pending, code = gameCode()) {
    if (!code) return;
    try {
      sessionStorage.setItem(pendingStorageKey(code), JSON.stringify(pending));
    } catch {
      // Registration still works when sessionStorage is restricted.
    }
  }

  function clearPending(code = gameCode()) {
    if (!code) return;
    try {
      sessionStorage.removeItem(pendingStorageKey(code));
    } catch {
      // Ignore restricted storage.
    }
  }

  function cleanRecoveryParam() {
    const url = new URL(location.href);
    if (!url.searchParams.has(RECOVERY_PARAM)) return;
    url.searchParams.delete(RECOVERY_PARAM);
    suppressScrollRestore();
    history.replaceState(history.state, '', url);
    lastKnownRoute = location.href;
  }

  function installRootScrollGuard() {
    if (rootGuardInstalled) return;
    const root = document.querySelector('#app');
    const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
    if (!root || !descriptor?.get || !descriptor?.set) return;

    rootGuardInstalled = true;
    Object.defineProperty(root, 'innerHTML', {
      configurable: true,
      enumerable: false,
      get() {
        return descriptor.get.call(root);
      },
      set(value) {
        const routeBefore = location.href;
        const scrollBefore = window.scrollY;
        const shouldRestore = scrollBefore > 24
          && performance.now() >= suppressScrollUntil
          && routeBefore === lastKnownRoute
          && !document.body.classList.contains('scoreboard-mode')
          && !isEditing();

        descriptor.set.call(root, value);
        lastKnownRoute = location.href;

        if (!shouldRestore) return;
        requestAnimationFrame(() => requestAnimationFrame(() => {
          if (location.href !== routeBefore || performance.now() < suppressScrollUntil) return;
          const maxScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
          const target = Math.min(scrollBefore, maxScroll);
          if (Math.abs(window.scrollY - target) < 2) return;
          restoringScroll = true;
          const previousBehavior = document.documentElement.style.scrollBehavior;
          document.documentElement.style.scrollBehavior = 'auto';
          window.scrollTo(0, target);
          document.documentElement.style.scrollBehavior = previousBehavior;
          requestAnimationFrame(() => { restoringScroll = false; });
        }));
      },
    });
  }

  function formStatus(form, text, tone = 'working') {
    if (!form) return null;
    let status = form.querySelector('[data-claim-status]');
    if (!status) {
      status = document.createElement('div');
      status.dataset.claimStatus = '1';
      status.className = 'claim-status';
      status.setAttribute('role', 'status');
      status.setAttribute('aria-live', 'polite');
      form.append(status);
    }
    if (status.dataset.tone !== tone) status.dataset.tone = tone;
    if (status.textContent !== text) status.textContent = text;
    return status;
  }

  function lockForm(form) {
    if (!form) return;
    const wasBusy = form.dataset.claimBusy === '1';
    form.dataset.claimBusy = '1';
    form.setAttribute('aria-busy', 'true');
    const button = form.querySelector('button[type="submit"]');
    if (button) {
      button.dataset.originalText ||= button.textContent;
      button.disabled = true;
      const busyText = form.dataset.form === 'register-player'
        ? 'Registering Player…'
        : 'Opening Player Card…';
      if (button.textContent !== busyText) button.textContent = busyText;
    }
    if (wasBusy) return;
    queueMicrotask(() => {
      form.querySelectorAll('input').forEach((input) => { input.readOnly = true; });
      form.querySelectorAll('select').forEach((select) => {
        select.dataset.claimLocked = '1';
        select.setAttribute('aria-disabled', 'true');
      });
    });
  }

  function unlockForm(form, message = '') {
    if (!form) return;
    form.dataset.claimBusy = '0';
    form.removeAttribute('aria-busy');
    const button = form.querySelector('button[type="submit"]');
    if (button) {
      button.disabled = false;
      button.textContent = button.dataset.originalText
        || (form.dataset.form === 'register-player' ? 'Register & Open My Card' : 'Reclaim My Card');
    }
    form.querySelectorAll('input').forEach((input) => { input.readOnly = false; });
    form.querySelectorAll('select').forEach((select) => {
      delete select.dataset.claimLocked;
      select.removeAttribute('aria-disabled');
    });
    if (message) formStatus(form, message, 'error');
  }

  function currentErrorMessage() {
    const toast = [...document.querySelectorAll('.toast-error')].at(-1);
    return toast?.textContent?.trim() || '';
  }

  function playerCardIsOpen() {
    return Boolean(document.querySelector(PLAYER_CARD_SELECTOR));
  }

  function registrationForm() {
    return document.querySelector(FORM_SELECTOR);
  }

  function addRecoveryPanel(form, pending) {
    if (!form || form.querySelector('[data-claim-recovery-panel]')) return;
    const panel = document.createElement('div');
    panel.dataset.claimRecoveryPanel = '1';
    panel.className = 'claim-recovery-panel';
    panel.innerHTML = `
      <strong>Your player was registered, but this phone did not finish opening the card.</strong>
      <span>Try the saved card again. If it still will not open, ask the facilitator to release ${escapeHtml(pending?.name || 'your name')} and then reclaim it.</span>
      <div>
        <button type="button" class="btn btn-navy" data-claim-recovery="retry">Open Saved Card</button>
        <button type="button" class="btn btn-ghost" data-claim-recovery="clear">Start Over</button>
      </div>`;
    form.append(panel);
  }

  function escapeHtml(value) {
    return String(value || '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function refreshPlayerRoute() {
    try {
      window.dispatchEvent(new PopStateEvent('popstate'));
    } catch {
      window.dispatchEvent(new Event('popstate'));
    }
  }

  function hardRecoveryReload(pending) {
    const code = gameCode();
    const reloads = Number(pending.reloads || 0);
    if (reloads >= 2) return false;
    const next = { ...pending, reloads: reloads + 1, lastReloadAt: now() };
    writePending(next, code);
    const url = new URL(location.href);
    url.searchParams.set(RECOVERY_PARAM, String(next.reloads));
    suppressScrollRestore(3000);
    location.replace(url);
    return true;
  }

  function stopWatchdog() {
    if (activeWatchdog) clearInterval(activeWatchdog);
    activeWatchdog = null;
  }

  function startWatchdog(form, pending) {
    stopWatchdog();
    const code = gameCode();
    const startedAt = pending.startedAt || now();
    let attempts = Number(pending.routeAttempts || 0);

    const tick = () => {
      if (playerCardIsOpen()) {
        stopWatchdog();
        clearPending(code);
        cleanRecoveryParam();
        window.scrollTo({ top: 0, behavior: 'auto' });
        return;
      }

      const liveForm = registrationForm();
      const storedPlayerId = localStorage.getItem(playerStorageKey(code));
      const errorMessage = currentErrorMessage();

      // The app writes the claimed player ID before it refreshes its snapshot.
      // Once that ID exists, registration succeeded even if a later refresh
      // produces a transient read error. Always recover the saved card first.
      if (storedPlayerId) {
        pending.playerId = storedPlayerId;
        pending.routeAttempts = attempts;
        writePending(pending, code);
        if (liveForm) {
          lockForm(liveForm);
          formStatus(liveForm, 'Player registered. Opening your setup page…', 'success');
        }
        refreshPlayerRoute();
        attempts += 1;

        if (attempts === HARD_RELOAD_AFTER) {
          pending.routeAttempts = attempts;
          writePending(pending, code);
          hardRecoveryReload(pending);
        }
        if (attempts >= ROUTE_RETRY_LIMIT && liveForm) {
          stopWatchdog();
          unlockForm(liveForm);
          formStatus(liveForm, 'The card is saved, but this phone could not reopen it automatically.', 'error');
          addRecoveryPanel(liveForm, pending);
        }
        return;
      }

      if (errorMessage && liveForm) {
        stopWatchdog();
        clearPending(code);
        unlockForm(liveForm, errorMessage);
        return;
      }

      if (now() - startedAt > FORM_TIMEOUT_MS && liveForm) {
        stopWatchdog();
        clearPending(code);
        unlockForm(liveForm, 'Registration took too long. Check your connection and tap once to try again.');
      }
    };

    tick();
    activeWatchdog = setInterval(tick, ROUTE_RETRY_MS);
  }

  function beginRegistrationGuard(form) {
    const code = gameCode();
    const existing = readPending(code);
    if (form.dataset.claimBusy === '1' || (existing && now() - existing.startedAt < FORM_TIMEOUT_MS)) {
      return false;
    }

    const name = form.dataset.form === 'register-player'
      ? form.querySelector('[name="playerName"]')?.value?.trim()
      : form.querySelector('[name="playerId"] option:checked')?.textContent?.trim();

    const pending = {
      code,
      type: form.dataset.form,
      name: name || 'your player',
      startedAt: now(),
      routeAttempts: 0,
      reloads: 0,
    };
    // Remove stale error toasts so the watchdog only reacts to an error from
    // this submission rather than an unrelated message that is fading out.
    document.querySelectorAll('.toast-error').forEach((toast) => toast.remove());
    writePending(pending, code);
    lockForm(form);
    formStatus(form, 'Saving your player card. Keep this page open…');
    startWatchdog(form, pending);
    return true;
  }

  function resumePendingRegistration() {
    installRootScrollGuard();
    if (playerCardIsOpen()) {
      stopWatchdog();
      clearPending();
      cleanRecoveryParam();
      return;
    }

    const pending = readPending();
    const form = registrationForm();
    if (!pending || !form) return;

    if (now() - pending.startedAt > 2 * 60 * 1000) {
      clearPending();
      return;
    }

    lockForm(form);
    formStatus(form, pending.playerId
      ? 'Your player card is saved. Reopening it now…'
      : 'Finishing registration…');
    startWatchdog(form, pending);
  }

  document.addEventListener('submit', (event) => {
    const form = event.target.closest?.(FORM_SELECTOR);
    if (!form) return;

    if (!navigator.onLine) {
      event.preventDefault();
      event.stopImmediatePropagation();
      formStatus(form, 'No internet connection. Reconnect, then tap once to register.', 'error');
      return;
    }

    if (form.dataset.claimBusy === '1') {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }

    suppressScrollRestore(2500);
    if (!beginRegistrationGuard(form)) {
      // A pending registration survived a DOM refresh. Do not submit a second
      // Firebase transaction; resume opening the card already in flight.
      event.preventDefault();
      event.stopImmediatePropagation();
      resumePendingRegistration();
    }
  }, true);

  document.addEventListener('click', (event) => {
    const recovery = event.target.closest?.('[data-claim-recovery]');
    if (recovery) {
      const code = gameCode();
      const pending = readPending(code) || { code, startedAt: now(), reloads: 0, routeAttempts: 0 };
      if (recovery.dataset.claimRecovery === 'clear') {
        clearPending(code);
        localStorage.removeItem(playerStorageKey(code));
        location.reload();
      } else {
        pending.routeAttempts = 0;
        pending.reloads = 0;
        pending.startedAt = now();
        writePending(pending, code);
        const form = registrationForm();
        if (form) {
          lockForm(form);
          formStatus(form, 'Trying the saved card again…');
          startWatchdog(form, pending);
        }
      }
      return;
    }

    const action = event.target.closest?.('[data-action]')?.dataset.action;
    if (action && [
      'go-home', 'open-host', 'open-player', 'host-tab',
      'set-sample', 'sample-prev', 'sample-next', 'try-demo',
    ].includes(action)) {
      suppressScrollRestore();
    }
  }, true);

  ['pushState', 'replaceState'].forEach((method) => {
    const original = history[method];
    history[method] = function patchedHistory(...args) {
      suppressScrollRestore();
      const result = original.apply(this, args);
      lastKnownRoute = location.href;
      return result;
    };
  });

  window.addEventListener('popstate', () => {
    suppressScrollRestore();
    lastKnownRoute = location.href;
  }, true);

  window.addEventListener('scroll', () => {
    if (!restoringScroll) lastKnownRoute = location.href;
  }, { passive: true });

  window.addEventListener('online', () => {
    document.documentElement.classList.remove('is-offline');
    if (readPending()) refreshPlayerRoute();
  });
  window.addEventListener('offline', () => {
    document.documentElement.classList.add('is-offline');
  });
  if (!navigator.onLine) document.documentElement.classList.add('is-offline');

  window.addEventListener('pageshow', resumePendingRegistration);
  document.addEventListener('DOMContentLoaded', resumePendingRegistration, { once: true });

  const observer = new MutationObserver(() => {
    if (observerRefreshQueued) return;
    observerRefreshQueued = true;
    requestAnimationFrame(() => {
      observerRefreshQueued = false;
      resumePendingRegistration();
    });
  });
  const root = document.querySelector('#app');
  if (root) observer.observe(root, { childList: true, subtree: true });
})();
