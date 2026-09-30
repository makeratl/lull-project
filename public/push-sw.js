/*
 * Lull's push handlers, imported by the generated service worker (vite.config.ts → workbox.importScripts).
 * A nudge shows as one notification (a newer one replaces an older one); tapping it opens Lull on Relax.
 */
self.addEventListener('push', event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { /* not JSON: use the defaults */ }
  event.waitUntil(
    self.registration.showNotification(data.title || 'Lull', {
      body: data.body || 'A few minutes of slow breathing?',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag: 'lull-nudge',
      renotify: false,
      data: { url: data.url || '/?screen=relax' },
    }),
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || '/?screen=relax', self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      const open = list.find(c => new URL(c.url).origin === self.location.origin);
      if (open) return open.focus().then(c => (c && 'navigate' in c ? c.navigate(url) : c));
      return self.clients.openWindow(url);
    }),
  );
});
