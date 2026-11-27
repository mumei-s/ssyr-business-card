(() => {
  'use strict';
  const N = window.SSYRNotice;
  const {$, el, feedback} = N;
  const scope = new URL('./', location.href).href;
  let contact = null;
  let device = N.getDevice();
  let revision = 0;
  let busy = false;
  let checking = false;
  let pushBusy = false;
  let localBinding = '';
  let signature = null;
  let pending = null;
  let firstLoad = true;
  const pendingReads = new Set();
  const readObserver = 'IntersectionObserver' in window
    ? new IntersectionObserver(entries => {
        for (const entry of entries) {
          if (entry.isIntersecting && !document.hidden) void acknowledge(entry.target).catch(() => {});
        }
      }, {threshold: 1})
    : null;

  async function acknowledge(button) {
    const id = button.dataset.messageId;
    if (!id || !button.isConnected || pendingReads.has(id)) return;
    pendingReads.add(id);
    try {
      await N.call('read', {device, id});
      readObserver?.unobserve(button);
      button.remove();
      syncUnread();
    } finally { pendingReads.delete(id); }
  }

  function render() {
    $('join-panel').hidden = firstLoad || !!contact;
    $('conversation').hidden = $('notifications').hidden = !contact;
    $('join-chat').disabled = $('chat-send').disabled = $('refresh').disabled = busy;
    for (const button of $('message-list').querySelectorAll('button')) button.disabled = busy;
    N.privateChoice($('initial-push'), $('push-guide'));
    if (!contact) return;
    $('identity').textContent = contact.displayName ? 'ご相談者　' + contact.displayName : '';
    const granted = N.pushSupported && Notification.permission === 'granted';
    const active = granted && !!localBinding && contact.enabled && contact.pushBinding === localBinding;
    const blocked = !N.pushSupported || Notification.permission === 'denied';
    $('notification-state').textContent = pushBusy ? '確認中…' : active ? '通知 ON' : contact.enabled ? '要確認' : '通知 OFF';
    $('notice-guide').textContent = blocked
      ? ($('push-guide').textContent + ' 新しい返信は名刺の先頭にも表示します。')
      : '新しい返信は名刺の先頭にも表示します。';
    $('enable-notifications').hidden = active || blocked;
    $('enable-notifications').textContent = contact.enabled ? '端末通知を再設定' : '端末通知をONにする';
    $('stop-notifications').hidden = !contact.enabled;
    $('enable-notifications').disabled = $('stop-notifications').disabled = busy || pushBusy;
  }

  function syncUnread() {
    window.dispatchEvent(new Event('ssyr-business-unread-changed'));
  }

  function renderMessages(messages) {
    const next = JSON.stringify(messages);
    if (next === signature) return;
    signature = next;
    const list = $('message-list');
    const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 48;
    readObserver?.disconnect();
    const contents = document.createDocumentFragment();
    if (!messages.length) contents.append(el('p', 'ご相談の受付が完了しました。こちらから川合へメッセージを送れます。', 'empty-chat'));
    for (const item of [...messages].reverse()) {
      const mine = item.direction === 'inbound';
      const bubble = el('article', undefined, 'bubble ' + (mine ? 'mine' : 'theirs'));
      bubble.append(el('strong', mine ? '自分' : "S's-YR", 'sender'));
      if (item.title && item.title !== 'チャット') bubble.append(el('h3', item.title));
      bubble.append(el('p', item.body, 'message-body'));
      const meta = el('div', undefined, 'message-meta');
      const time = el('time', N.date(item.created_at) + (mine && item.read_at ? ' · 既読' : ''));
      time.dateTime = item.created_at;
      meta.append(time);
      if (mine) {
        meta.append(N.messageDeleteButton(run, () => N.call('chat-delete', {device, id: item.id}), refresh));
      } else if (!item.read_at) {
        const read = el('button', '既読にする', 'read-button');
        read.type = 'button';
        read.dataset.messageId = item.id;
        read.addEventListener('click', () => run(() => acknowledge(read)));
        meta.append(read);
      }
      bubble.append(meta);
      contents.append(bubble);
    }
    list.replaceChildren(contents);
    if (atBottom) list.scrollTop = list.scrollHeight;
    for (const button of list.querySelectorAll('.read-button')) readObserver?.observe(button);
    syncUnread();
  }

  function reset() {
    if (N.getDevice() === device) N.forgetThread(device);
    device = ''; contact = null; signature = null; pending = null; localBinding = '';
    $('message-list').replaceChildren();
    $('chat-body').value = '';
    syncUnread();
  }

  async function inspectBinding(secret) {
    if (!N.pushSupported || Notification.permission !== 'granted') { localBinding = ''; return; }
    try {
      const reg = await N.wait(navigator.serviceWorker.getRegistration(scope), 4000);
      const sub = reg?.scope === scope ? await N.wait(reg.pushManager.getSubscription(), 4000) : null;
      const binding = await N.pushBinding(sub);
      if (device === secret && !pushBusy) { localBinding = binding; render(); }
    } catch { /* Re-registration is available in the settings panel. */ }
  }

  async function refresh() {
    const stamp = revision;
    const secret = N.getDevice();
    if (device !== secret) { signature = null; localBinding = ''; pending = null; $('chat-body').value = ''; }
    device = secret;
    if (!N.validToken(device)) {
      contact = null; firstLoad = false; $('retry-connection').hidden = true; render(); return;
    }
    let data;
    try { data = await N.call('status', {device: secret}); }
    catch (error) {
      if (stamp !== revision || secret !== device) return;
      if (error.status !== 401) throw error;
      reset(); firstLoad = false; render(); feedback('この端末の受付が解除されています。新しいご相談を始められます。'); return;
    }
    if (stamp !== revision || secret !== device) return;
    if (!N.validThreadId(data.contact?.id) || !Array.isArray(data.messages)) throw Error('会話を確認できませんでした。もう一度お試しください。');
    contact = data.contact;
    firstLoad = false;
    $('retry-connection').hidden = true;
    render();
    renderMessages(data.messages);
    void inspectBinding(secret);
  }

  async function run(task) {
    if (busy) return;
    revision++;
    busy = true;
    feedback('');
    render();
    try { await task(); }
    catch (error) {
      feedback(error.message || '通信を確認して、もう一度お試しください。', true);
      if (firstLoad) $('retry-connection').hidden = false;
    } finally { busy = false; render(); }
  }

  async function quietRefresh() {
    if (busy || checking || document.hidden || !N.validToken(N.getDevice())) return;
    checking = true;
    try { await refresh(); } catch { /* Keep the last confirmed conversation and any draft. */ }
    finally { checking = false; }
  }

  function readName() {
    const name = $('visitor-name').value.trim();
    if (!/[^\s\p{Default_Ignorable_Code_Point}\p{Cc}]/u.test(name)) {
      $('visitor-name').focus(); throw Error('川合にわかるお名前を入力してください。');
    }
    const company = $('visitor-company').value.trim();
    const display = company ? company + ' / ' + name : name;
    if (display.length > 100) throw Error('会社名とお名前は区切りを含めて100文字以内で入力してください。');
    return display;
  }

  async function enablePush(secret, id, permission, initial) {
    pushBusy = true; render();
    try {
      if (await permission !== 'granted') {
        feedback('端末通知はOFFです。新しい返信は名刺の先頭で確認できます。'); return;
      }
      const saved = await N.saveChatPush(secret, id, initial);
      if (saved?.id === contact?.id && device === secret) {
        localBinding = saved.pushBinding;
        contact = {...contact, enabled: saved.enabled, pushBinding: saved.pushBinding};
        feedback('返信の端末通知をONにしました。');
      }
    } catch { feedback('通知の設定を確認できませんでした。「返信の通知」から再設定できます。', true); }
    finally { pushBusy = false; render(); }
  }

  $('join-form').addEventListener('submit', event => {
    event.preventDefault();
    void run(async () => {
      const name = readName();
      const initial = $('initial-push');
      const permission = initial.checked && !initial.disabled ? N.requestPushPermission(true) : null;
      const result = await N.startReceiving(name);
      device = result.device;
      contact = result.contact;
      firstLoad = false;
      signature = null;
      render(); renderMessages([]);
      if (permission) void enablePush(device, contact.id, permission, true);
      await refresh();
    });
  });

  $('message-form').addEventListener('submit', event => {
    event.preventDefault();
    void run(async () => {
      const field = $('chat-body');
      const body = field.value.trim();
      if (!body) { field.focus(); throw Error('メッセージを入力してください。'); }
      if (!pending || pending.body !== body) pending = {body, requestId: N.requestId()};
      const result = await N.call('chat-send', {device, ...pending});
      if (!result.message) throw Error('送信結果を確認できません。もう一度お試しください。');
      if (field.value.trim() === body) field.value = '';
      pending = null;
      feedback('メッセージを送信しました。');
      try { await refresh(); }
      catch { feedback('メッセージを送信しました。履歴は「更新」で確認できます。'); }
    });
  });

  $('enable-notifications').addEventListener('click', () => {
    if (busy || pushBusy || !contact) return;
    void enablePush(device, contact.id, N.requestPushPermission(true), false);
  });
  $('stop-notifications').addEventListener('click', () => run(async () => {
    await N.stopChatPush(device);
    await refresh();
    feedback('端末通知をOFFにしました。');
  }));
  $('refresh').addEventListener('click', () => run(refresh));
  $('retry-connection').addEventListener('click', () => run(refresh));
  window.addEventListener('pageshow', quietRefresh);
  window.addEventListener('focus', quietRefresh);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      for (const button of $('message-list').querySelectorAll('.read-button')) {
        readObserver?.unobserve(button); readObserver?.observe(button);
      }
      void quietRefresh();
    }
  });
  navigator.serviceWorker?.addEventListener('message', event => {
    if (event.data?.type === 'ssyr-business-chat-update') void quietRefresh();
  });
  window.addEventListener('storage', event => {
    if (event.key === 'ssyr-business-device-v1' || !event.key) {
      if (!busy) void run(refresh);
    } else if (event.key === 'ssyr-business-changed-v1') void quietRefresh();
  });
  setInterval(quietRefresh, 20000);
  void run(refresh);
})();
