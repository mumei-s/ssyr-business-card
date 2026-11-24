(() => {
  const button = document.getElementById('install-button');
  const guide = document.getElementById('install-guide');
  const status = document.getElementById('install-status');
  if (!button || !guide || !status) return;
  const hint = document.getElementById('install-hint');
  const standalone = window.matchMedia('(display-mode: standalone)');
  let promptEvent = null, installedThisSession = false;
  function render() {
    const installed = installedThisSession || standalone.matches || navigator.standalone === true;
    button.hidden = installed || !promptEvent;
    guide.hidden = installed;
    status.hidden = !installed;
    if (installed) status.textContent = 'ホーム画面に追加済みです。';
  }
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    promptEvent = event;
    render();
  });
  window.addEventListener('appinstalled', () => {
    installedThisSession = true; promptEvent = null; render();
  });
  if (standalone.addEventListener) standalone.addEventListener('change', render);
  button.addEventListener('click', async () => {
    if (!promptEvent) { guide.open = true; return; }
    const event = promptEvent; promptEvent = null; button.disabled = true;
    try {
      await event.prompt();
      const choice = await event.userChoice;
      if (choice?.outcome === 'dismissed') guide.open = true;
    } catch (_) { guide.open = true; }
    finally { button.disabled = false; render(); }
  });
  if (/iPhone|iPad|iPod/i.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) {
    hint.textContent = 'Safariの共有ボタン →「ホーム画面に追加」→「追加」。ホーム画面のS’s-YRアイコンから名刺を開けます。';
  }
  if ('serviceWorker' in navigator && window.isSecureContext) {
    navigator.serviceWorker.register('./sw.js', {scope:'./',updateViaCache:'none'})
      .catch(() => { /* Browser menu/manual installation remains available. */ });
  }
  render();
})();
