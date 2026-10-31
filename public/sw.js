/*
 * ERSEL service worker.
 *
 * Rules:
 *  - Navigations are network-first so a new deployment is picked up on the
 *    next visit. The previous version served the cached shell first, which
 *    kept users on an old build forever.
 *  - Hashed build assets under /assets/ are immutable, so cache-first is safe
 *    and fast there.
 *  - Everything else same-origin uses stale-while-revalidate.
 *  - Cross-origin requests (Supabase API, tiles) are never intercepted.
 */
const VERSION = 'ersel-shell-v4';
const SHELL = ['/', '/manifest.webmanifest', '/icon.svg', '/brand/logo-mark.webp'];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(VERSION)
      .then(cache => cache.addAll(SHELL).catch(() => undefined))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== VERSION).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

function isNavigation(request) {
  return request.mode === 'navigate' ||
    (request.method === 'GET' && (request.headers.get('accept') || '').includes('text/html'));
}

async function networkFirst(request) {
  const cache = await caches.open(VERSION);
  try {
    const response = await fetch(request);
    if (response && response.ok) cache.put(request, response.clone());
    return response;
  } catch (error) {
    const cached = await cache.match(request);
    if (cached) return cached;
    const shell = await cache.match('/');
    if (shell) return shell;
    throw error;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(VERSION);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response && response.ok) cache.put(request, response.clone());
  return response;
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(VERSION);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then(response => {
      if (response && response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => undefined);
  return cached || (await network) || Response.error();
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }
  if (url.origin !== self.location.origin) return;

  if (isNavigation(request)) {
    event.respondWith(networkFirst(request));
    return;
  }
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(cacheFirst(request));
    return;
  }
  event.respondWith(staleWhileRevalidate(request));
});

self.addEventListener('push', event => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : '' };
  }
  const title = data.title || (data.notification && data.notification.title) || 'ERSEL';
  const body = data.body || (data.notification && data.notification.body) || '';
  const orderId = (data.data && data.data.orderId) || data.orderId || '';
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: '/brand/icon-192.png',
      badge: '/brand/icon-192.png',
      lang: 'ar',
      dir: 'rtl',
      tag: orderId ? 'ersel-' + orderId : 'ersel-push',
      data: { orderId },
      renotify: true
    })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const orderId = (event.notification.data && event.notification.data.orderId) || '';
  const target = orderId ? '/?order=' + encodeURIComponent(orderId) : '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      for (const client of clients) {
        if ('focus' in client) {
          client.postMessage({ type: 'ersel:open-order', orderId });
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(target);
    })
  );
});
