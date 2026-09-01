/* Serveur de la carte + endpoint d'observations.
 *   node collect/serve.mjs         → http://localhost:8123
 *
 * - GET  : sert web/ (statique). Les modules ES ne se chargent pas en file://.
 * - POST /api/observ : reçoit une observation terrain (coin marqué depuis l'appli),
 *   l'ajoute à data/observations.jsonl (+ photo dans data/observations/). Sert au
 *   calage du modèle (geo/observations.mjs). Clé partagée optionnelle CHAMPI_OBSERV_KEY.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../../web');
const DATA = path.resolve(fileURLToPath(import.meta.url), '../../data');
const PORT = process.env.PORT || 8123;
const HOST = process.env.HOST || '127.0.0.1';   // 0.0.0.0 seulement derrière un reverse-proxy
const OBSERV_KEY = process.env.CHAMPI_OBSERV_KEY || null;
const MAX_BODY = 900 * 1024;                     // vignette ~100 Ko, large
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.geojson': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg',
};
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, X-Observ-Key' };

const ESPECES = ['cepe', 'girolle', 'pdm', 'trompette', 'ctube', 'sanguin', 'truffe', 'morille', 'autre', ''];
const near = x => typeof x === 'number' && isFinite(x);

function saveObserv(body, ua) {
  const o = JSON.parse(body);
  if (!near(o.lat) || !near(o.lon) || Math.abs(o.lat) > 90 || Math.abs(o.lon) > 180) throw new Error('coordonnées invalides');
  if (!ESPECES.includes(o.espece || '')) throw new Error('espèce inconnue');
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const dir = path.join(DATA, 'observations');
  fs.mkdirSync(dir, { recursive: true });
  let photo = null;
  if (typeof o.photo === 'string' && o.photo.startsWith('data:image/')) {
    const b64 = o.photo.slice(o.photo.indexOf(',') + 1);
    fs.writeFileSync(path.join(dir, `${id}.jpg`), Buffer.from(b64, 'base64'));
    photo = `observations/${id}.jpg`;
  }
  const rec = {
    id, ts: new Date().toISOString(),
    lat: +o.lat.toFixed(6), lon: +o.lon.toFixed(6),
    date: /^\d{4}-\d\d-\d\d$/.test(o.date || '') ? o.date : new Date().toISOString().slice(0, 10),
    espece: o.espece || '', resultat: o.resultat === 'rien' ? 'rien' : 'trouve',
    note: String(o.note || '').slice(0, 500), photo, ua: (ua || '').slice(0, 120),
  };
  fs.appendFileSync(path.join(DATA, 'observations.jsonl'), JSON.stringify(rec) + '\n');
  return { ok: true, id };
}

http.createServer((req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); res.end(); return; }

  if (req.method === 'POST' && req.url.split('?')[0] === '/api/observ') {
    if (OBSERV_KEY && req.headers['x-observ-key'] !== OBSERV_KEY) {
      res.writeHead(403, { ...CORS, 'Content-Type': 'application/json' });
      res.end('{"error":"clé requise"}'); return;
    }
    let body = '', tooBig = false;
    req.on('data', c => { body += c; if (body.length > MAX_BODY) { tooBig = true; req.destroy(); } });
    req.on('end', () => {
      if (tooBig) { res.writeHead(413, CORS); res.end(); return; }
      try {
        const out = saveObserv(body, req.headers['user-agent']);
        res.writeHead(200, { ...CORS, 'Content-Type': 'application/json' });
        res.end(JSON.stringify(out));
      } catch (e) {
        res.writeHead(400, { ...CORS, 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  let rel = decodeURIComponent(req.url.split('?')[0]);
  if (rel === '/') rel = '/index.html';
  const file = path.join(ROOT, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, CORS); res.end('404'); return; }
    const ext = path.extname(file);
    // assets figés (leaflet, icône) : cache long ; le reste : revalidation
    const cache = /[/\\]assets[/\\](leaflet|icon)/.test(file)
      ? 'public, max-age=86400' : 'no-cache';
    res.writeHead(200, { ...CORS, 'Content-Type': TYPES[ext] || 'application/octet-stream', 'Cache-Control': cache });
    res.end(buf);
  });
}).listen(PORT, HOST, () => console.log(`carte : http://${HOST}:${PORT}`));
