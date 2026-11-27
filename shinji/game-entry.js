(() => {
  'use strict';
  const section = document.getElementById('chat-game');
  const link = document.getElementById('chat-game-url');
  const message = document.getElementById('chat-game-message');
  if (!section || !link || !message) return;

  const game = new URL('./games/straight-ring/', location.href);
  const N = window.SSYRNotice;
  let recipient = '', request = 0, checking = false;

  function hide() {
    section.hidden = true;
    link.removeAttribute('href');
    link.textContent = '';
    message.textContent = '';
  }

  async function playableRelease() {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6500);
    const options = {cache:'no-store', credentials:'omit', redirect:'error', signal:controller.signal};
    try {
      const state = await fetch(new URL('release.json', game), options);
      if (!state.ok) return false;
      const data = await state.json();
      if (data?.version !== 1 || data.ready !== true || data.entry !== 'index.html' ||
          typeof data.verifiedCommit !== 'string' || !/^[a-f0-9]{40}$/.test(data.verifiedCommit)) return false;
      const entry = await fetch(new URL(data.entry, game), {...options, method:'HEAD'});
      return entry.ok && /^text\/html(?:;|$)/i.test(entry.headers.get('Content-Type') || '');
    } finally { clearTimeout(timeout); }
  }

  async function setRecipient(device, refresh = false) {
    if (device !== recipient) {
      recipient = device;
      ++request;
      checking = false;
      hide();
    } else if (!refresh || checking) return;
    if (!device) return;
    const sequence = ++request;
    checking = true;
    try {
      const access = await N.call('game-access', {device});
      if (sequence !== request) return;
      if (access?.allowed !== true || !await playableRelease()) {
        if (sequence === request) hide();
        return;
      }
      if (sequence === request) {
        link.href = game.href;
        link.textContent = game.href;
        message.textContent = typeof access.message === 'string' ? access.message : '';
        section.hidden = false;
      }
    } catch { if (sequence === request) hide(); }
    finally { if (sequence === request) checking = false; }
  }

  window.SSYRChatGame = {setRecipient};
})();
