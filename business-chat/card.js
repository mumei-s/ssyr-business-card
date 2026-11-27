(() => {
  'use strict';
  const N = window.SSYRNotice;
  const banner = document.getElementById('business-chat-unread');
  const count = document.getElementById('business-chat-count');
  const cacheKey = 'ssyr-business-unread-v1';
  const changedKey = 'ssyr-business-changed-v1';
  const scope = new URL('./', document.currentScript.src).href;
  let loading = false;
  let revision = 0;
  let timer;

  function show(total) {
    if (!banner) return;
    count.textContent = total ? total + '件' : '';
    banner.hidden = !total;
  }

  function showSaved() {
    const device = N.getDevice();
    try {
      const saved = JSON.parse(localStorage.getItem(cacheKey));
      show(saved?.device === device && Number.isSafeInteger(saved.count) ? saved.count : 0);
    } catch { show(0); }
  }

  async function refresh() {
    if (loading || document.hidden) return;
    const device = N.getDevice();
    if (!N.validToken(device)) { show(0); return; }
    loading = true;
    const stamp = revision;
    const checkedAt = Date.now();
    try {
      const result = await N.call('chat-unread', {devices: [device]});
      if (stamp !== revision || device !== N.getDevice() || document.hidden) return;
      const total = result.counts?.[0], thread = result.threadIds?.[0];
      if (!Number.isSafeInteger(total) || total < 0 || !(N.validThreadId(thread) || (thread === null && total === 0))) return;
      const saved = JSON.stringify({device, count: total});
      try { if (localStorage.getItem(cacheKey) !== saved) localStorage.setItem(cacheKey, saved); } catch {}
      show(total);
      try { await (total ? navigator.setAppBadge?.(total) : navigator.clearAppBadge?.()); } catch {}
      if (total) return;
      const reg = await navigator.serviceWorker?.getRegistration?.(scope);
      if (reg?.scope !== scope || !reg.getNotifications) return;
      for (const item of await reg.getNotifications()) {
        if (item.data?.edition === 'business' && item.data.kind === 'message' && item.timestamp <= checkedAt) item.close();
      }
    } catch { /* Preserve the last confirmed count while offline. */ }
    finally {
      loading = false;
      if (stamp !== revision && !document.hidden) schedule();
    }
  }

  function schedule() {
    revision++;
    clearTimeout(timer);
    if (!document.hidden) timer = setTimeout(refresh, 80);
  }

  window.addEventListener('storage', event => {
    if (event.key === cacheKey) showSaved();
    if (!event.key || event.key === changedKey || event.key === 'ssyr-business-device-v1') { showSaved(); schedule(); }
  });
  window.addEventListener('ssyr-business-unread-changed', () => {
    try { localStorage.setItem(changedKey, String(Date.now())); } catch {}
    schedule();
  });
  navigator.serviceWorker?.addEventListener('message', event => {
    if (event.data?.type === 'ssyr-business-chat-update') schedule();
  });
  window.addEventListener('pageshow', schedule);
  window.addEventListener('focus', schedule);
  document.addEventListener('visibilitychange', schedule);
  setInterval(() => { if (!loading && !document.hidden) schedule(); }, 20000);
  showSaved();
  schedule();
})();
