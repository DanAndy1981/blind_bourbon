// Mobile claim guard: prevents repeated taps while Firebase is claiming a player
// and recovers from the rare case where the background refresh races the claim.
(() => {
  const playerStorageKey = (code) => `blind-bourbon-derby::player::${String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8)}`;

  document.addEventListener('submit', (event) => {
    const form = event.target.closest?.('form[data-form="claim-player"]');
    if (!form) return;

    const button = form.querySelector('button[type="submit"]');
    if (button?.dataset.claimBusy === '1') {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }

    if (button) {
      button.dataset.claimBusy = '1';
      button.disabled = true;
      button.textContent = 'Opening Player Card…';
    }

    const code = new URLSearchParams(location.search).get('game');
    const key = playerStorageKey(code);
    let tries = 0;
    const timer = setInterval(() => {
      tries += 1;
      const claimedPlayerId = localStorage.getItem(key);
      const claimFormStillVisible = document.querySelector('form[data-form="claim-player"]');

      if (claimedPlayerId && claimFormStillVisible) {
        clearInterval(timer);
        location.reload();
        return;
      }

      if (!claimFormStillVisible || tries >= 20) {
        clearInterval(timer);
        if (button && document.contains(button)) {
          button.dataset.claimBusy = '0';
          button.disabled = false;
          button.textContent = 'Open My Player Card';
        }
      }
    }, 150);
  }, true);
})();
