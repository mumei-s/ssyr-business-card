(() => {
  'use strict';
  const owner = !!document.getElementById('owner-install-button');
  const element = name => document.getElementById((owner ? 'owner-' : '') + 'install-' + name);
  const button = element('button'), guide = element('guide'), status = element('status'), hint = element('hint');
  if (!button || !guide || !status || !hint) return;

  const standalone = matchMedia('(display-mode: standalone)');
  const inApp = () => standalone.matches || navigator.standalone === true;
  const ios = /iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const appName = owner ? "S's-YR 管理" : "S's-YR";
  let promptEvent = null;

  if (ios) {
    hint.textContent = 'Safariでこのページを開き、共有メニューの「ホーム画面に追加」→「追加」を選んでください。アプリライブラリにアイコンが残っていれば、長押ししてホーム画面へ移動できます。';
  } else if (/Android/i.test(navigator.userAgent)) {
    hint.textContent = 'EdgeまたはChromeでこのページを開き、メニューから「ホーム画面に追加」または「アプリをインストール」を選んでください。アプリ一覧に「' + appName + '」が残っていれば、そのアイコンを長押ししてホーム画面へ移動できます。';
  } else {
    hint.textContent = 'ブラウザーのアドレスバーにあるインストールボタンか、メニューの「アプリ」から追加してください。';
  }

  // Display mode identifies the current window. The site cannot read launcher icon placement.
  function render(message = '') {
    button.hidden = false;
    button.textContent = inApp() ? 'アイコンを戻す方法' : 'ホーム画面に追加';
    status.textContent = inApp() ? 'アプリで開いています。' : message;
    status.hidden = !status.textContent;
  }

  function showGuide() {
    guide.hidden = false;
    guide.open = true;
  }

  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    promptEvent = event;
    render();
  });
  window.addEventListener('appinstalled', () => {
    promptEvent = null;
    render('追加の操作が完了しました。');
  });
  window.addEventListener('pageshow', () => render());
  window.addEventListener('focus', () => render());
  document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });
  standalone.addEventListener?.('change', () => render());

  button.addEventListener('click', async () => {
    if (!promptEvent || inApp()) { showGuide(); return; }
    const event = promptEvent;
    promptEvent = null;
    try {
      await event.prompt();
      const choice = await event.userChoice;
      if (choice?.outcome === 'accepted') {
        guide.open = false;
        render('ブラウザーで追加を受け付けました。');
      } else {
        showGuide();
      }
    } catch {
      showGuide();
    }
  });

  // Each installing page is in the same directory as its own worker.
  if ('serviceWorker' in navigator && window.isSecureContext) {
    navigator.serviceWorker.register('./sw.js', {scope: './', updateViaCache: 'none'}).catch(() => {});
  }
  render();
})();
