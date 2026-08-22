// Preserve a typed player name across live-data-driven DOM refreshes.
// The main app intentionally redraws its current screen when shared state changes;
// this tiny companion keeps an unfinished registration form from losing input.
(() => {
  'use strict';

  const FORM_SELECTOR = 'form[data-form="register-player"], form[data-form="claim-player"]';
  const PLAYER_CARD_SELECTOR = '.player-topline, .sample-card, .sample-tabs';
  const KEY_PREFIX = 'blind-bourbon-derby::registration-draft::';
  let restoreQueued = false;

  const code = () => String(new URLSearchParams(location.search).get('game') || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 8);
  const key = () => `${KEY_PREFIX}${code()}`;

  function read() {
    if (!code()) return null;
    try {
      return JSON.parse(sessionStorage.getItem(key()) || 'null');
    } catch {
      return null;
    }
  }

  function write(form) {
    if (!form || !code()) return;
    const draft = {
      type: form.dataset.form,
      playerName: form.querySelector('[name="playerName"]')?.value || '',
      playerId: form.querySelector('[name="playerId"]')?.value || '',
    };
    try {
      sessionStorage.setItem(key(), JSON.stringify(draft));
    } catch {
      // Storage can be unavailable in privacy modes; registration still works.
    }
  }

  function clear() {
    if (!code()) return;
    try { sessionStorage.removeItem(key()); } catch { /* no-op */ }
  }

  function restore() {
    if (document.querySelector(PLAYER_CARD_SELECTOR)) {
      clear();
      return;
    }
    const draft = read();
    const form = document.querySelector(FORM_SELECTOR);
    if (!draft || !form || form.dataset.form !== draft.type) return;
    const name = form.querySelector('[name="playerName"]');
    const select = form.querySelector('[name="playerId"]');
    if (name && !name.value) name.value = draft.playerName;
    if (select && !select.value) select.value = draft.playerId;
  }

  document.addEventListener('input', (event) => write(event.target.closest?.(FORM_SELECTOR)), true);
  document.addEventListener('change', (event) => write(event.target.closest?.(FORM_SELECTOR)), true);
  document.addEventListener('submit', (event) => write(event.target.closest?.(FORM_SELECTOR)), true);

  const root = document.querySelector('#app');
  if (root) {
    new MutationObserver(() => {
      if (restoreQueued) return;
      restoreQueued = true;
      requestAnimationFrame(() => {
        restoreQueued = false;
        restore();
      });
    }).observe(root, { childList: true, subtree: true });
  }

  window.addEventListener('pageshow', restore);
  document.addEventListener('DOMContentLoaded', restore, { once: true });
})();
