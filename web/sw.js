// Rastau service worker: приложение открывается без связи (на трассе, на окраине).
// Данные и фото идут напрямую в базу; здесь кэшируются только файлы приложения, библиотеки и плитки карты.
const V = 'rastau-v8'
const SHELL = ['/', '/index.html', '/manifest.json', '/favicon.svg', '/icons/icon-192.png']
const CDN = /^https:\/\/(cdn\.jsdelivr\.net|cdn\.sheetjs\.com|storage\.googleapis\.com\/mediapipe-models)\//
const TILES = /^https:\/\/tile\.openstreetmap\.org\//
const MAX_TILES = 1500

self.addEventListener('install', (e) => { e.waitUntil(caches.open(V).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())) })
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== V && k !== 'fakt-osm').map((k) => caches.delete(k)))).then(() => self.clients.claim()))
})

async function networkFirst(req) {
  const c = await caches.open(V)
  try {
    const r = await fetch(req)
    if (r.ok) c.put(req, r.clone())
    return r
  } catch {
    return (await c.match(req, { ignoreSearch: req.mode === 'navigate' })) || (await c.match('/index.html')) || Response.error()
  }
}
async function cacheFirst(req, name, limit) {
  const c = await caches.open(name)
  const hit = await c.match(req)
  if (hit) return hit
  const r = await fetch(req)
  if (r.ok || r.type === 'opaque') {
    await c.put(req, r.clone())
    if (limit) c.keys().then((ks) => { if (ks.length > limit) ks.slice(0, ks.length - limit).forEach((k) => c.delete(k)) })
  }
  return r
}

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET') return
  const url = req.url
  if (CDN.test(url)) return e.respondWith(cacheFirst(req, V))
  if (TILES.test(url)) return e.respondWith(cacheFirst(req, 'fakt-osm', MAX_TILES))
  if (new URL(url).origin !== self.location.origin) return
  // Версионированные файлы сборки (app.js?v=…) не меняются: из кэша; страница и остальное: сначала сеть
  if (/\/app\.(js|css)\?v=/.test(url)) return e.respondWith(cacheFirst(req, V))
  e.respondWith(networkFirst(req))
})
