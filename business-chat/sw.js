/* Dedicated S's-YR business reply subscription. Leave navigation and network requests alone. */
self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
const chat = new URL(self.registration.scope);
const card = new URL('../', chat);
const businessPages = new Set([card.href, new URL('index.html', card).href, chat.href, new URL('index.html', chat).href]);

self.addEventListener('push', event => {
  let payload;
  try { payload = event.data?.json(); } catch { return; }
  if (payload?.edition !== 'business' || !['message', 'test'].includes(payload.kind)) return;
  const test = payload.kind === 'test';
  event.waitUntil((async () => {
    await self.registration.showNotification("S's-YR", {
      body: test ? 'テスト通知です。' : '個別チャットに新着メッセージがあります。',
      icon: new URL('shinji/brand-96.png', card).href,
      tag: test ? 'ssyr-business-test' : 'ssyr-business-chat',
      data: {edition: 'business', kind: payload.kind}
    });
    if (test) return;
    try { await self.navigator.setAppBadge?.(); } catch {}
    for (const client of await self.clients.matchAll({type: 'window', includeUncontrolled: true})) {
      const url = new URL(client.url);
      if (businessPages.has(url.origin + url.pathname)) client.postMessage({type: 'ssyr-business-chat-update'});
    }
  })());
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil((async () => {
    for (const client of await self.clients.matchAll({type: 'window', includeUncontrolled: true})) {
      const url = new URL(client.url);
      if (url.origin !== chat.origin || ![chat.pathname, new URL('index.html', chat).pathname].includes(url.pathname)) continue;
      try { await client.focus(); return; } catch {}
    }
    await self.clients.openWindow(chat.href);
  })());
});
