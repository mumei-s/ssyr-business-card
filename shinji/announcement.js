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
  let notice = null;
  let lastRead = '';
  let request = 0;
  let openOnLoad = location.hash === '#announcement';
  section.hidden = false;

  function readLocally() {
    try { lastRead = localStorage.getItem(readKey) || ''; } catch {}
    if (notice) state.textContent = lastRead === notice.id ? 'SHINJIからのメッセージ' : '新着メッセージあり';
  }
  function setExpanded(expanded) {
    if (!notice) return;
    body.hidden = !expanded;
    open.setAttribute('aria-expanded', String(expanded));
    if (expanded) {
      lastRead = notice.id;
      try { localStorage.setItem(readKey, notice.id); } catch {}
      state.textContent = 'SHINJIからのメッセージ';
    }
  }
  function showMessage(text) {
    empty.textContent = text;
    empty.hidden = !text;
  }
  async function refresh() {
    const sequence = ++request;
    try {
      const result = await N.call('card-announcement');
      if (sequence !== request) return;
      const incoming = result.announcement;
      if (incoming !== null && (!N.validThreadId(incoming?.id) ||
          typeof incoming.title !== 'string' || typeof incoming.body !== 'string')) throw Error();
      if (notice?.id !== incoming?.id) {
        body.hidden = true;
        open.setAttribute('aria-expanded', 'false');
      }
      notice = incoming;
      open.hidden = !notice;
      heading.textContent = notice?.title || '';
      body.textContent = notice?.body || '';
      readLocally();
      showMessage(!notice && location.hash === '#announcement' ? '現在掲載中のメッセージはありません。' : '');
      if (openOnLoad && notice) {
        setExpanded(true);
        section.scrollIntoView({block:'start'});
      }
      openOnLoad = false;
    } catch {
      if (sequence !== request) return;
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
  open.addEventListener('click', () => setExpanded(body.hidden));
  window.addEventListener('hashchange', () => {
    if (location.hash === '#announcement') openLatest();
    else { openOnLoad = false; showMessage(''); }
  });
  window.addEventListener('storage', event => { if (!event.key || event.key === readKey) readLocally(); });
  window.addEventListener('pageshow', event => { if (event.persisted) void refresh(); });
  window.addEventListener('focus', refresh);
  window.addEventListener('online', refresh);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) void refresh(); });
  navigator.serviceWorker?.addEventListener?.('message', event => {
    if (event.data?.type === 'ssyr-announcement-open') openLatest();
    else if (event.data?.type === 'ssyr-announcement-update') void refresh();
  });
  setInterval(() => { if (!document.hidden) void refresh(); }, 60000);
  void refresh();
})();
