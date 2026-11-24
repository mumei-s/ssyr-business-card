/* SHINJI scope only. No caching of HTML, no fetch interception.
 * Notification sending is not configured. */
self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
