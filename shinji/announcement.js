(() => {
  'use strict';
  const N = window.SSYRNotice;
  const section = document.getElementById('announcement');
  const open = document.getElementById('announcement-open');
  const heading = document.getElementById('announcement-title');
  const state = document.getElementById('announcement-state');
  const body = document.getElementById('announcement-body');
  const empty = document.getElementById('announcement-empty');
  const readKey = 'ssyr-card-announcement-read-v1';
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
  function setExpanded(expanded) {
    if (!notice || !section) return;
    body.hidden = !expanded;
    open.setAttribute('aria-expanded', String(expanded));
    if (expanded) {
      lastRead = notice.id;
      try { localStorage.setItem(readKey, notice.id); } catch {}
      renderRead();
      void dismissNotifications(lastRead, notice.id, 0).catch(() => {});
    }
  }
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
      const changed = notice?.id !== incoming?.id;
      notice = incoming;
      try { lastRead = localStorage.getItem(readKey) || lastRead; } catch {}
      renderRead();
      void dismissNotifications(lastRead, notice?.id, checkedAt).catch(() => {});
      if (!section) return;
      if (changed) {
        body.hidden = true;
        open.setAttribute('aria-expanded', 'false');
      }
      open.hidden = !notice;
      heading.textContent = notice?.title || '';
      body.textContent = notice?.body || '';
      showMessage(!notice && location.hash === '#announcement' ? '現在掲載中のメッセージはありません。' : '');
      if (openOnLoad && notice) {
        setExpanded(true);
        section.scrollIntoView({block:'start'});
      }
      openOnLoad = false;
    } catch {
      if (sequence !== request || !section) return;
      if (openOnLoad || notice) {
        // Do not present a withdrawn item as current if its status cannot be checked.
        open.hidden = true;
        body.hidden = true;
        open.setAttribute('aria-expanded', 'false');
        showMessage('メッセージを確認できません。通信が戻ったらもう一度名刺を開いてください。');
      }
    }
  }
  function openLatest() {
    openOnLoad = true;
    void refresh();
  }
  open?.addEventListener('click', () => setExpanded(body.hidden));
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
