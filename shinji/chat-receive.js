(() => {
  'use strict';
  const N = window.SSYRNotice;
  const entry = document.getElementById('card-chat-start');
  const form = document.getElementById('card-receive-form');
  const name = document.getElementById('card-receive-name');
  const start = document.getElementById('card-receive-start');
  const status = document.getElementById('card-receive-status');
  const open = document.getElementById('card-receive-open');
  let busy = false;
  let lastState = '';

  function showConnected(threadId) {
    entry.hidden = true;
    form.hidden = true;
    status.textContent = '受け取り設定済みです。このブラウザーで名刺を開くと、新着が表示されます。';
    open.href = N.validThreadId(threadId) ? './notices.html#thread=' + threadId : './notices.html';
    open.hidden = false;
    lastState = 'connected';
  }

  function showForm() {
    entry.hidden = false;
    form.hidden = false;
    open.hidden = true;
    if (lastState !== 'form') status.textContent = '';
    lastState = 'form';
  }

  if (N.getThreads().length) {
    status.textContent = 'このブラウザーの会話は、チャット画面からも確認できます。';
    // Existing users can enter their chat during a slow connection.
    open.hidden = false;
  } else {
    showForm();
  }

  window.addEventListener('ssyr-card-receive-state', event => {
    if (busy) return;
    if (N.validThreadId(event.detail?.threadId)) showConnected(event.detail.threadId);
    else showForm();
  });

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (busy) return;
    busy = true;
    start.disabled = true;
    status.textContent = '受け取りを設定しています…';
    try {
      const result = await N.startReceiving(name.value.trim());
      showConnected(result.contact.id);
    } catch (error) {
      status.textContent = error.message || '受け取りを開始できませんでした。もう一度お試しください。';
    } finally {
      busy = false;
      start.disabled = false;
    }
  });
})();
