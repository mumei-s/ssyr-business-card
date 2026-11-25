(() => {
  'use strict';
  const N = window.SSYRNotice;
  const entry = document.getElementById('card-chat-start');
  const form = document.getElementById('card-receive-form');
  const name = document.getElementById('card-receive-name');
  const start = document.getElementById('card-receive-start');
  const status = document.getElementById('card-receive-status');
  const open = document.getElementById('card-receive-open');
  const hint = document.getElementById('card-receive-hint');
  const privateChoice = document.getElementById('card-private-default');
  const privateGuide = document.getElementById('card-private-default-status');
  const normalHint = hint.textContent;
  const normalStart = start.textContent;
  let pendingNotice = '';
  let intentVersion = 0;
  let busy = false;
  let lastState = '';

  function setIntent(id = '') {
    ++intentVersion;
    pendingNotice = id;
    hint.textContent = id ? '名前を入力すると、SHINJIとの個別チャットでメッセージの続きを読めます。' : normalHint;
    start.textContent = id ? '名前を登録して続きを読む' : normalStart;
  }
  function continueToChat(threadId) {
    if (!pendingNotice || !N.validThreadId(threadId)) return;
    const hash = new URLSearchParams({thread:threadId, announcement:pendingNotice});
    setIntent();
    location.assign('./notices.html#' + hash);
  }
  function focusName() {
    showForm();
    form.scrollIntoView({block:'center'});
    name.focus({preventScroll:true});
  }
  window.addEventListener('ssyr-open-announcement', async event => {
    const id = event.detail?.id;
    if (!N.validThreadId(id) || busy) return;
    setIntent(id);
    if (!N.getThreads().length) { focusName(); return; }
    const version = intentVersion;
    try {
      const linked = await N.findLinkedReceiver();
      if (version !== intentVersion || busy) return;
      if (linked) {
        N.rememberThread(linked.device, linked.id);
        await event.detail.notificationTask;
        if (version === intentVersion && !busy) continueToChat(linked.id);
      } else focusName();
    } catch {
      if (version !== intentVersion) return;
      setIntent();
      status.textContent = 'チャットの受け取り設定を確認できません。通信が戻ったら「続きを読む」を押してください。';
      status.scrollIntoView({block:'center'});
    }
  });
  window.addEventListener('ssyr-announcement-current', event => {
    if (pendingNotice && pendingNotice !== event.detail?.id) {
      setIntent();
      status.textContent = '掲載内容が変わりました。名刺の上部で最新のメッセージをご確認ください。';
    }
  });
  entry.addEventListener('click', () => setIntent());

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
    N.privateChoice(privateChoice, privateGuide);
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
      const nickname = N.readVisitorName(name);
      const permission = privateChoice.checked && !privateChoice.disabled && !N.getThreads().length ? N.requestPushPermission() : null;
      const cardNotifications = window.SSYRAnnouncementPush?.fromGesture();
      const result = await N.startReceiving(nickname);
      showConnected(result.contact.id);
      const [privateResult] = await Promise.all([N.finishChatPush(result, permission), Promise.resolve(cardNotifications).catch(() => {})]);
      if (privateResult) status.textContent = '招待を受け取りました。' + privateResult;
      continueToChat(result.contact.id);
    } catch (error) {
      status.textContent = error.message || '受け取りを開始できませんでした。もう一度お試しください。';
    } finally {
      busy = false;
      start.disabled = false;
    }
  });
})();
