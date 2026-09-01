/* Petit serveur statique local pour la carte (les modules ES ne se chargent pas en file://).
 *   node collect/serve.mjs         → http://localhost:8123
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../../web');
const PORT = process.env.PORT || 8123;
const HOST = process.env.HOST || '127.0.0.1';   // 0.0.0.0 seulement derrière un reverse-proxy
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.geojson': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

http.createServer((req, res) => {
  let rel = decodeURIComponent(req.url.split('?')[0]);
  if (rel === '/') rel = '/index.html';
  const file = path.join(ROOT, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  fs.readFile(file, (err, buf) => {
    // données lues seules et publiques → CORS ouvert, cache court
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS' };
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }
    if (err) { res.writeHead(404, cors); res.end('404'); return; }
    const ext = path.extname(file);
    const cache = /[/\\]api[/\\]/.test(file) || ext === '.json' || ext === '.geojson'
      ? 'public, max-age=300' : 'public, max-age=3600';
    res.writeHead(200, { ...cors, 'Content-Type': TYPES[ext] || 'application/octet-stream', 'Cache-Control': cache });
    res.end(buf);
  });
}).listen(PORT, HOST, () => console.log(`carte : http://${HOST}:${PORT}`));
