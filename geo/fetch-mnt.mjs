/* H4 — enrichit web/assets/data/forets-publiques.geojson avec altitude, pente et
 * exposition, d'après le MNT RGE ALTI (API altimétrique Géoplateforme).
 *
 *   node geo/fetch-mnt.mjs     (après les autres fetch-*)
 *
 * Pour chaque forêt : 5 points (centre + N/S/E/O à ~500 m) → élévation, d'où
 * pente (°) et exposition (° depuis le Nord, sens de la plus grande descente).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../..');
const FILE = path.join(ROOT, 'web/assets/data/forets-publiques.geojson');
const ALTI = 'https://data.geopf.fr/altimetrie/1.0/calcul/alti/rest/elevation.json';
const DL = 0.006;   // ~500 m en latitude (et un peu moins en longitude à 44°N)

function bboxCenter(geom) {
  let x0 = 180, y0 = 90, x1 = -180, y1 = -90;
  const walk = c => Array.isArray(c[0]) ? c.forEach(walk)
    : (x0 = Math.min(x0, c[0]), y0 = Math.min(y0, c[1]), x1 = Math.max(x1, c[0]), y1 = Math.max(y1, c[1]));
  walk(geom.coordinates);
  return [(x0 + x1) / 2, (y0 + y1) / 2];
}

async function elevations(pts) {
  const url = `${ALTI}?lon=${pts.map(p => p[0].toFixed(5)).join('|')}` +
    `&lat=${pts.map(p => p[1].toFixed(5)).join('|')}&resource=ign_rge_alti_wld&zonly=true`;
  const j = await (await fetch(url)).json();
  return j.elevations;
}

const fc = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const mPerDegLat = 111320;

for (const f of fc.features) {
  const [lon, lat] = bboxCenter(f.geometry);
  const mPerDegLon = 111320 * Math.cos(lat * Math.PI / 180);
  // ordre : centre, Nord, Sud, Est, Ouest
  const pts = [[lon, lat], [lon, lat + DL], [lon, lat - DL], [lon + DL, lat], [lon - DL, lat]];
  let e;
  try { e = await elevations(pts); } catch (err) { console.warn('  alti échec', f.properties.nom); continue; }
  const [c, n, s, ea, w] = e;
  if ([c, n, s, ea, w].some(v => v == null || v < -100)) { f.properties.elev = Math.round(c || 0); continue; }

  const dzdy = (n - s) / (2 * DL * mPerDegLat);          // + = monte vers le Nord
  const dzdx = (ea - w) / (2 * DL * mPerDegLon);         // + = monte vers l'Est
  const slopeDeg = Math.atan(Math.hypot(dzdx, dzdy)) * 180 / Math.PI;
  // exposition = direction de la plus grande DESCENTE, 0=N 90=E 180=S 270=O
  let aspect = (Math.atan2(-dzdx, -dzdy) * 180 / Math.PI + 360) % 360;

  f.properties.elev = Math.round(c);
  f.properties.slopeDeg = +slopeDeg.toFixed(1);
  f.properties.aspect = Math.round(aspect);
  console.log(`  ${f.properties.nom.padEnd(42)} ${String(f.properties.elev).padStart(4)} m · pente ${slopeDeg.toFixed(0)}° · expo ${['N','NE','E','SE','S','SO','O','NO'][Math.round(aspect / 45) % 8]}`);
  await new Promise(r => setTimeout(r, 120));
}

fs.writeFileSync(FILE, JSON.stringify(fc));
const withSlope = fc.features.filter(f => f.properties.slopeDeg != null).length;
console.log(`\n${withSlope}/${fc.features.length} forêts avec pente/expo · fichier ${(fs.statSync(FILE).size / 1024).toFixed(0)} Ko`);
