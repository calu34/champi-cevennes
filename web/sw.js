/* Service worker — rend la carte installable et utilisable hors-ligne.
 * Stratégie :
 *   - assets figés (leaflet, icônes) : cache-first (jamais périmés)
 *   - tout le reste (HTML, JS, modèle, data, geojson) : network-first, repli cache
 * → un simple rechargement en ligne récupère le nouveau code ; hors-ligne = dernier cache.
 */
const CACHE = 'champi-v4';
const PRECACHE = [
  './', './index.html', './style.css', './app.mjs', './points.mjs',
  './manifest.webmanifest', './model/model.mjs', './model/lib.mjs',
  './assets/leaflet.js', './assets/leaflet.css', './assets/icon.svg', './assets/icon-192.png',
];
const frozen = u => /\/assets\/(leaflet|icon)/.test(u);

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE)
    .then(c => Promise.all(PRECACHE.map(u => c.add(u).catch(() => null))))
    .then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const { request } = e;
  if (request.method !== 'GET') return;
  const put = r => { const cp = r.clone(); caches.open(CACHE).then(c => c.put(request, cp)); return r; };

  if (frozen(request.url)) {
    e.respondWith(caches.match(request).then(hit => hit || fetch(request).then(put)));
  } else {
    // network-first : on prend la version en ligne si dispo, sinon le cache
    e.respondWith(fetch(request).then(put).catch(() => caches.match(request)));
  }
});
