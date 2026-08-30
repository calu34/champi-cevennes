/* H3 — enrichit web/assets/data/forets-domaniales.geojson avec le substrat
 * (acide / neutre / calcaire) d'après la carte lithologique simplifiée BRGM 1/1 000 000.
 *
 *   node geo/fetch-brgm.mjs     (après fetch-onf.mjs / fetch-bdforet.mjs)
 *
 * 1/1M = résolution grossière, mais suffisant pour l'opposition Cévennes (schiste/
 * granite, acide) vs Causses (calcaire). Sert aussi de base au masque carte truffe.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pointInGeom } from '../collect/lib.mjs';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../..');
const FILE = path.join(ROOT, 'web/assets/data/forets-domaniales.geojson');
const BRGM = 'https://geoservices.brgm.fr/geologie';

// CODE_GEOL de LITHO_1M_SIMPLIFIEE → classe substrat
const CODE = {
  1: 'neutre',   // Argiles
  2: 'calcaire', // Calcaires, marnes et gypse
  3: 'calcaire', // Craie
  5: 'acide',    // Grès
  6: 'neutre',   // Sables
  7: 'neutre',   // Basaltes et rhyolites
  8: 'acide',    // Granites
  10: 'acide',   // Gneiss
  12: 'acide',   // Schistes et grès
};
function classify(p) {
  const c = CODE[+p.CODE_GEOL];
  if (c) return c;
  const d = (p.DESCR || '').toLowerCase();
  if (/calcaire|marne|craie|dolomie|gypse/.test(d)) return 'calcaire';
  if (/schiste|grès|gres|granite|gneiss|micaschiste|quartzite|rhyolite|arkose/.test(d)) return 'acide';
  return 'neutre';
}

function bbox(geom) {
  let x0 = 180, y0 = 90, x1 = -180, y1 = -90;
  const walk = c => Array.isArray(c[0]) ? c.forEach(walk)
    : (x0 = Math.min(x0, c[0]), y0 = Math.min(y0, c[1]), x1 = Math.max(x1, c[0]), y1 = Math.max(y1, c[1]));
  walk(geom.coordinates);
  return [x0, y0, x1, y1];
}

// grille de points internes à un polygone (jusqu'à ~25)
function samplePoints(geom) {
  const [x0, y0, x1, y1] = bbox(geom);
  const n = 5, pts = [];
  for (let i = 1; i <= n; i++) for (let k = 1; k <= n; k++) {
    const p = [x0 + (x1 - x0) * i / (n + 1), y0 + (y1 - y0) * k / (n + 1)];
    if (pointInGeom(p, geom)) pts.push(p);
  }
  return pts.length ? pts : [[(x0 + x1) / 2, (y0 + y1) / 2]];
}

// litho nationale (une seule requête, ~200 polygones sur la zone)
const url = `${BRGM}?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature&TYPENAMES=ms:LITHO_1M_SIMPLIFIEE` +
  `&OUTPUTFORMAT=geojson&SRSNAME=EPSG:4326&BBOX=43.0,1.3,45.6,5.1&COUNT=5000`;
const litho = (await (await fetch(url)).json()).features;
console.log(`${litho.length} polygones lithologiques chargés`);

const substratAt = ([lon, lat]) => {
  for (const f of litho) if (pointInGeom([lon, lat], f.geometry)) return classify(f.properties);
  return null;
};

const fc = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const tally = { acide: 0, neutre: 0, calcaire: 0 };
for (const f of fc.features) {
  const votes = { acide: 0, neutre: 0, calcaire: 0 };
  for (const p of samplePoints(f.geometry)) { const s = substratAt(p); if (s) votes[s]++; }
  const dom = Object.entries(votes).sort((a, b) => b[1] - a[1])[0];
  f.properties.substrat = dom[1] > 0 ? dom[0] : 'acide';
  tally[f.properties.substrat]++;
  console.log(`  ${f.properties.nom.padEnd(42)} → ${f.properties.substrat}`);
}
fs.writeFileSync(FILE, JSON.stringify(fc));
console.log(`\nrépartition : ${JSON.stringify(tally)}`);
