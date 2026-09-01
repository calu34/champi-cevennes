/* Service worker — rend la carte installable et utilisable hors-ligne.
 * - coquille (HTML/CSS/JS/modèle) : cache-first, mise à jour en arrière-plan
 * - données (data.js, api/*, geojson) : network-first, repli sur le dernier cache
 * Bump CACHE à chaque changement de coquille.
 */
const CACHE = 'champi-v3';
// coquille minimale garantie ; le reste (modules d'espèces, tuiles…) est mis en
// cache opportunément au 1ᵉʳ chargement en ligne par le handler `fetch`.
const SHELL = [
  './', './index.html', './style.css', './app.mjs', './points.mjs',
  './assets/leaflet.js', './assets/leaflet.css',
  './assets/icon.svg', './assets/icon-192.png',
  './manifest.webmanifest', './model/model.mjs', './model/lib.mjs',
];
const isData = u => /\/(data\.js|api\/|assets\/data\/)/.test(u);

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE)
    .then(c => Promise.all(SHELL.map(u => c.add(u).catch(() => null))))
    .then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const { request } = e;
  if (request.method !== 'GET') return;
  if (isData(request.url)) {
    e.respondWith(
      fetch(request).then(r => { const cp = r.clone(); caches.open(CACHE).then(c => c.put(request, cp)); return r; })
        .catch(() => caches.match(request)));
  } else {
    e.respondWith(
      caches.match(request).then(hit => hit || fetch(request).then(r => {
        const cp = r.clone(); caches.open(CACHE).then(c => c.put(request, cp)); return r;
      })));
  }
});
