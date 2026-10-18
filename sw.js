'use strict';

const CACHE_PREFIX = `fk-static-${encodeURIComponent(self.registration.scope)}-`;
const CACHE_NAME = `${CACHE_PREFIX}v1`;
const ROOT = new URL('./', self.location.href);
const INDEX = new URL('index.html', ROOT).href;
const STATIC_FILES = [
  'index.html', 'style.css', 'app.js', 'config.js', 'manifest.webmanifest',
  'logo.svg', 'logo-light.svg', 'logo-icon.svg', 'icon-192.png', 'icon-512.png'
].map(path => new URL(path, ROOT).href);
const STATIC_URLS = new Set(STATIC_FILES);

function cacheable(response, target) {
  return response.ok && response.status === 200 && response.type === 'basic' &&
    response.url === target;
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // Aset opsional yang belum tersedia tidak menggagalkan pemasangan shell.
    await Promise.allSettled(STATIC_FILES.map(async target => {
      const response = await fetch(new Request(target, { cache: 'reload' }));
      if (cacheable(response, target)) await cache.put(target, response);
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(name => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
      .map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  // Seluruh lintas origin, termasuk Apps Script dan redirect-nya, tidak ditangani.
  // Query string tidak disimpan agar URL/kunci/data tidak masuk Cache Storage.
  if (request.method !== 'GET' || url.origin !== ROOT.origin || url.search) return;
  const navigation = request.mode === 'navigate' &&
    (url.href === ROOT.href || url.href === INDEX);
  if (!navigation && !STATIC_URLS.has(url.href)) return;
  const target = navigation ? INDEX : url.href;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    try {
      const response = await fetch(request);
      if (response.ok) {
        // Navigasi ke direktori disimpan dengan nama index.html yang tetap.
        if (cacheable(response, request.url)) {
          try { await cache.put(target, response.clone()); } catch { /* Kuota cache penuh. */ }
        }
        return response;
      }
      return (await cache.match(target)) || response;
    } catch {
      return (await cache.match(target)) || new Response('Berkas belum tersedia offline. Buka kembali saat terhubung internet.', {
        status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' }
      });
    }
  })());
});
