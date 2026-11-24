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

  function showConnected(threadId, confirmed = true) {
    entry.hidden = true;
    form.hidden = true;
    status.textContent = confirmed
      ? '招待を受け取りました。メッセージを送らなくても、新着はこの名刺に表示されます。端末通知のON・OFFは、チャットを開いて設定できます。'
      : 'このブラウザーの会話は、チャット画面から確認できます。';
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

  function showSavedState() {
    if (busy) return;
    const threads = N.getThreads();
    if (threads.length) showConnected(threads.find(thread => N.validThreadId(thread.id))?.id, false);
    else showForm();
  }
  showSavedState();
  window.addEventListener('pageshow', event => { if (event.persisted) showSavedState(); });
  window.addEventListener('storage', event => {
    if (!event.key || event.key === 'ssyr-card-device-v1' || event.key.startsWith('ssyr-card-thread-v1:')) showSavedState();
  });

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
      const result = await N.startReceiving(N.readVisitorName(name));
      showConnected(result.contact.id);
    } catch (error) {
      status.textContent = error.message || '受け取りを開始できませんでした。もう一度お試しください。';
    } finally {
      busy = false;
      start.disabled = false;
    }
  });
})();
