// KerfDesk Remote service worker (ADR-582/583). Caches the app shell only; never API
// responses, workspace data, previews or camera images.
const VERSION = '__APP_VERSION__';
const CACHE = `kerfdesk-remote-${VERSION}`;
const SHELL = [
  '/app/',
  '/app/app.js',
  '/app/app.css',
  '/app/manifest.webmanifest',
  '/app/icon.svg',
  '/app/icon-maskable.svg',
  '/app/icon-192.png',
  '/app/icon-512.png',
  '/app/icon-maskable-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith('kerfdesk-remote-') && key !== CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (
    event.request.method !== 'GET' ||
    url.origin !== self.location.origin ||
    !SHELL.includes(url.pathname)
  )
    return;
  // Network first so a new release reaches the phone; the cached shell opens offline.
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          void caches.open(CACHE).then((cache) => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(() => caches.match(event.request).then((cached) => cached ?? Response.error())),
  );
});

self.addEventListener('push', (event) => {
  let data = { title: 'KerfDesk', body: 'Check your machine.', tag: 'kerfdesk' };
  try {
    data = { ...data, ...event.data.json() };
  } catch {
    /* Fixed fallback text. */
  }
  event.waitUntil(
    self.registration.showNotification(String(data.title).slice(0, 64), {
      body: String(data.body).slice(0, 200),
      tag: String(data.tag).slice(0, 64),
      icon: '/app/icon-192.png',
      badge: '/app/icon-192.png',
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      const open = clients.find((client) => new URL(client.url).pathname.startsWith('/app/'));
      return open ? open.focus() : self.clients.openWindow('/app/');
    }),
  );
});
