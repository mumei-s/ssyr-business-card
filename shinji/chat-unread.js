(() => {
  'use strict';
  const N = window.SSYRNotice;
  const banner = document.getElementById('card-chat-unread');
  const invitation = document.getElementById('card-chat-start');
  const counter = document.getElementById('card-chat-unread-count');
  const entrance = document.getElementById('receive-notices');
  const entranceNote = entrance?.querySelector('small');
  const originalNote = entranceNote?.textContent;
  const signalKey = 'ssyr-card-unread-changed-v1';
  const batchSize = 30;
  let revision = 0;
  let loading = false;
  let scheduled;

  function render(total, firstId) {
    if (banner) {
      const target = './notices.html' + (firstId ? '#thread=' + firstId : '#messages');
      const label = total ? total + '件' : '';
      if (counter.textContent !== label) counter.textContent = label;
      banner.href = target;
      banner.hidden = total === 0;
      if (invitation) invitation.hidden = total > 0;
      if (entrance && entranceNote) {
        entrance.setAttribute('href', total ? target : './notices.html');
        const note = total ? '新着メッセージあり · ' + label : originalNote;
        if (entranceNote.textContent !== note) entranceNote.textContent = note;
      }
    }
    try {
      const operation = total ? navigator.setAppBadge?.(total) : navigator.clearAppBadge?.();
      operation?.catch(() => {});
    } catch {}
  }

  async function dismissReadNotifications(unread, total, checkedAt) {
    const registration = await navigator.serviceWorker?.getRegistration?.(new URL('./', location.href).href);
    if (!registration?.getNotifications || registration.scope !== new URL('./', location.href).href) return;
    for (const notification of await registration.getNotifications()) {
      if (notification.data?.kind !== 'message' || notification.timestamp > checkedAt) continue;
      if (total === 0 || unread.get(notification.data.threadId) === 0) notification.close();
    }
  }

  function requestRefresh() {
    revision++;
    clearTimeout(scheduled);
    if (!document.hidden) scheduled = setTimeout(refresh, 100);
  }

  async function refresh() {
    if (loading || document.hidden) return;
    const stamp = revision;
    const checkedAt = Date.now();
    loading = true;
    try {
      const threads = N.getThreads();
      const unread = new Map();
      let total = 0;
      let firstId = '';
      let connectedId = '';
      for (let offset = 0; offset < threads.length; offset += batchSize) {
        const group = threads.slice(offset, offset + batchSize);
        const result = await N.call('chat-unread', {devices: group.map(t => t.device)});
        if (stamp !== revision || document.hidden) return;
        if (!Array.isArray(result.counts) || result.counts.length !== group.length ||
            !result.counts.every(n => Number.isSafeInteger(n) && n >= 0)) return;
        for (const [i, thread] of group.entries()) {
          const value = result.counts[i];
          if (!connectedId && N.validThreadId(result.threadIds?.[i])) connectedId = result.threadIds[i];
          const id = result.threadIds?.[i] || thread.id;
          if (N.validThreadId(id)) {
            unread.set(id, value);
            if (id !== thread.id) N.rememberThread(thread.device, id);
            if (value && !firstId) firstId = id;
          }
          total += value;
        }
      }
      if (stamp !== revision || document.hidden) return;
      render(total, firstId);
      if (banner) window.dispatchEvent(new CustomEvent('ssyr-card-receive-state', {detail: {threadId: connectedId}}));
      if (threads.length) void dismissReadNotifications(unread, total, checkedAt).catch(() => {});
    } catch {
      // A timed-out read cannot confirm that a previously shown message was read.
    } finally {
      loading = false;
      if (stamp !== revision && !document.hidden) {
        clearTimeout(scheduled);
        scheduled = setTimeout(refresh, 100);
      }
    }
  }

  window.addEventListener('focus', requestRefresh);
  window.addEventListener('pageshow', requestRefresh);
  document.addEventListener('visibilitychange', requestRefresh);
  navigator.serviceWorker?.addEventListener?.('message', e => {
    if (e.data?.type === 'ssyr-chat-update') requestRefresh();
  });
  window.addEventListener('ssyr-chat-unread-changed', () => {
    try { localStorage.setItem(signalKey, String(Date.now())); } catch {}
    requestRefresh();
  });
  window.addEventListener('storage', event => {
    if (!event.key || event.key === signalKey || event.key === 'ssyr-card-device-v1' ||
        event.key.startsWith('ssyr-card-thread-v1:')) requestRefresh();
  });
  setInterval(() => { if (!document.hidden && !loading) requestRefresh(); }, 30000);
  requestRefresh();
})();
