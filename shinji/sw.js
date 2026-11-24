/* Scoped to the SHINJI card; no fetch interception and no cached HTML. */
self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
const scope = new URL(self.registration.scope);
const chat = new URL('notices.html', scope);
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);

function chatUrl(threadId) {
  const target = new URL(chat);
  target.hash = uuid(threadId) ? 'thread=' + threadId : 'messages';
  return target.href;
}

function isCard(url) {
  return url.origin === scope.origin &&
    (url.pathname === scope.pathname || url.pathname === new URL('index.html', scope).pathname);
}

self.addEventListener('push', event => {
  let payload;
  try { payload = event.data?.json(); } catch {}
  if (payload?.kind !== 'message' && payload?.kind !== 'test') return;
  const test = payload.kind === 'test';
  const threadId = uuid(payload.threadId) ? payload.threadId : null;
  event.waitUntil((async () => {
    await self.registration.showNotification('SHINJI', {
      body: test ? 'テスト通知です。' : '新しいメッセージが届きました。',
      icon: new URL('brand-96.png', scope).href,
      tag: test ? 'ssyr-test' : uuid(payload.id) ? payload.id : 'ssyr-chat',
      data: {kind: payload.kind, threadId}
    });
    if (test) return;
    try { await self.navigator.setAppBadge?.(); } catch {}
    for (const client of await self.clients.matchAll({type: 'window', includeUncontrolled: true})) {
      const url = new URL(client.url);
      if (isCard(url) || (url.origin === chat.origin && url.pathname === chat.pathname)) {
        client.postMessage({type: 'ssyr-chat-update'});
      }
    }
  })());
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = chatUrl(event.notification.data?.threadId);
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({type: 'window', includeUncontrolled: true});
    const matching = windows.find(client => client.url === target);
    if (matching) {
      try { await matching.focus(); return; } catch {}
    }
    for (const client of windows) {
      if (!isCard(new URL(client.url))) continue;
      try {
        const next = await client.navigate(target);
        if (next) { await next.focus(); return; }
      } catch {}
    }
    // Other open conversations can contain an unsent draft; leave them in place.
    await self.clients.openWindow(target);
  })());
});
