(() => {
  'use strict';
  const N = window.SSYRNotice;
  const section = document.getElementById('announcement');
  const open = document.getElementById('announcement-open');
  const heading = document.getElementById('announcement-title');
  const state = document.getElementById('announcement-state');
  const preview = document.getElementById('announcement-preview');
  const choice = document.getElementById('announcement-default-choice');
  const empty = document.getElementById('announcement-empty');
  const readKey = 'ssyr-card-announcement-chat-read-v1';
  const scope = new URL('./', location.href).href;
  let notice;
  let lastRead = '';
  let request = 0;
  let openOnLoad = !!section && location.hash === '#announcement';
  if (section) section.hidden = false;

  function reportUnread(unread) {
    window.dispatchEvent(new CustomEvent('ssyr-announcement-unread', {detail: unread}));
  }
  function renderRead() {
    if (notice === undefined) return;
    const unread = !!notice && notice.id !== lastRead;
    if (state && notice) state.textContent = unread ? '新着メッセージあり' : 'SHINJIからのメッセージ';
    reportUnread(unread);
  }
  // Android launchers can use outstanding system notifications for the icon dot.
  async function dismissNotifications(readId, currentId, checkedAt) {
    const registration = await navigator.serviceWorker?.getRegistration?.(scope);
    if (registration?.scope !== scope || !registration.getNotifications) return;
    for (const notification of await registration.getNotifications()) {
      const data = notification.data;
      if (data?.kind !== 'card-announcement' || !N.validThreadId(data.id)) continue;
      if (data.id === readId || (data.id !== currentId && notification.timestamp <= checkedAt)) {
        notification.close();
      }
    }
  }
  function enterChat(event) {
    if (!notice || !section) return;
    if (location.hash === '#announcement') history.replaceState(history.state, '', location.pathname + location.search);
    const notificationTask = event?.isTrusted ? window.SSYRAnnouncementPush?.fromGesture() : undefined;
    window.dispatchEvent(new CustomEvent('ssyr-open-announcement', {detail:{id:notice.id, notificationTask}}));
  }
  // Bound legacy full-text responses to the same public excerpt during rollout.
  function teaser(value, title) {
    const lines = value.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    if (lines[0] === title.trim()) lines.shift();
    const line = lines[0] || '';
    const chars = typeof Intl.Segmenter === 'function'
      ? Array.from(new Intl.Segmenter('ja', {granularity:'grapheme'}).segment(line), part => part.segment)
      : Array.from(line);
    const limit = lines.length > 1 ? 5 : Math.min(5, Math.max(0, chars.length - 1));
    return chars.slice(0, limit).join('').replace(/…+$/, '') + '……';
  }
  window.addEventListener('ssyr-announcement-read', event => {
    const id = event.detail?.id;
    if (section || !N.validThreadId(id)) return;
    lastRead = id;
    try { localStorage.setItem(readKey, id); } catch {}
    renderRead();
    void dismissNotifications(id, id, 0).catch(() => {});
  });
  function showMessage(text) {
    empty.textContent = text;
    empty.hidden = !text;
  }
  async function refresh() {
    const sequence = ++request;
    const checkedAt = Date.now();
    try {
      const result = await N.call('card-announcement');
      if (sequence !== request) return;
      const incoming = result.announcement;
      if (incoming !== null && (!N.validThreadId(incoming?.id) ||
          typeof incoming.title !== 'string' || typeof incoming.body !== 'string')) throw Error();
      notice = incoming && {id:incoming.id, title:incoming.title, preview:teaser(incoming.body, incoming.title)};
      window.dispatchEvent(new CustomEvent('ssyr-announcement-current', {detail:{id:notice?.id || null}}));
      try { lastRead = localStorage.getItem(readKey) || lastRead; } catch {}
      renderRead();
      void dismissNotifications(lastRead, notice?.id, checkedAt).catch(() => {});
      if (!section) return;
      open.hidden = !notice;
      choice.hidden = !notice;
      heading.textContent = notice?.title || '';
      preview.textContent = notice?.preview || '';
      showMessage(!notice && location.hash === '#announcement' ? '現在掲載中のメッセージはありません。' : '');
      if (openOnLoad && notice) enterChat();
      openOnLoad = false;
    } catch {
      if (sequence !== request || !section) return;
      if (openOnLoad || notice) {
        // Do not present a withdrawn item as current if its status cannot be checked.
        open.hidden = true;
        choice.hidden = true;
        showMessage('メッセージを確認できません。通信が戻ったらもう一度名刺を開いてください。');
      }
    }
  }
  function openLatest() {
    openOnLoad = true;
    void refresh();
  }
  open?.addEventListener('click', enterChat);
  window.addEventListener('hashchange', () => {
    if (!section) return;
    if (location.hash === '#announcement') openLatest();
    else { openOnLoad = false; showMessage(''); }
  });
  window.addEventListener('storage', event => {
    if (!event.key || event.key === readKey) {
      try { lastRead = localStorage.getItem(readKey) || ''; } catch {}
      renderRead();
    }
  });
  window.addEventListener('pageshow', event => { if (event.persisted) void refresh(); });
  window.addEventListener('focus', refresh);
  window.addEventListener('online', refresh);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) void refresh(); });
  navigator.serviceWorker?.addEventListener?.('message', event => {
    if (section && event.data?.type === 'ssyr-announcement-open') openLatest();
    else if (event.data?.type === 'ssyr-announcement-update') {
      reportUnread(null);
      if (!document.hidden) void refresh();
    }
  });
  setInterval(() => { if (!document.hidden) void refresh(); }, 60000);
  void refresh();
})();
