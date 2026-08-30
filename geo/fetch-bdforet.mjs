/* H2 — enrichit web/assets/data/forets-domaniales.geojson avec l'essence dominante
 * de chaque forêt, d'après BD Forêt V2 (IGN, WFS Géoplateforme).
 *
 *   node geo/fetch-onf.mjs      # d'abord (produit le fichier de base)
 *   node geo/fetch-bdforet.mjs  # ensuite (ajoute la propriété `essence`)
 *
 * Classes : feuillu (chêne/châtaignier/hêtre), conifere (pins, sapin, épicéa…),
 *           mixte, autre (lande, forêt ouverte, peupleraie…).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pointInGeom } from '../collect/lib.mjs';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../..');
const FILE = path.join(ROOT, 'web/assets/data/forets-domaniales.geojson');
const WFS = 'https://data.geopf.fr/wfs/ows';
const sleep = ms => new Promise(r => setTimeout(r, ms));

function classify(p) {
  const g = (p.tfv_g11 || '').toLowerCase();
  const e = (p.essence || '').toLowerCase();
  if (g.includes('lande') || g.includes('ouverte') || g.includes('peupl') || g.includes('herbac')) return 'autre';
  if (g.includes('mixte') || g.includes('mélange feuillus conif') || g.includes('melange feuillus conif')) return 'mixte';
  if (g.includes('feuillus')) return 'feuillu';
  if (g.includes('conif')) return 'conifere';
  if (/chêne|chene|châtaignier|chataignier|hêtre|hetre/.test(e)) return 'feuillu';
  if (/pin|sapin|épicéa|epicea|douglas|mélèze|meleze|conif/.test(e)) return 'conifere';
  return 'autre';
}

function bbox(geom) {
  let x0 = 180, y0 = 90, x1 = -180, y1 = -90;
  const walk = c => Array.isArray(c[0]) ? c.forEach(walk)
    : (x0 = Math.min(x0, c[0]), y0 = Math.min(y0, c[1]), x1 = Math.max(x1, c[0]), y1 = Math.max(y1, c[1]));
  walk(geom.coordinates);
  return [x0, y0, x1, y1];
}
function ringArea(ring) {   // shoelace, deg² (ordre de grandeur)
  let a = 0;
  for (let i = 0; i < ring.length - 1; i++) a += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  return Math.abs(a) / 2;
}
function centroid(geom) {
  const poly = geom.type === 'MultiPolygon' ? geom.coordinates[0][0] : geom.coordinates[0];
  let x = 0, y = 0; for (const c of poly) { x += c[0]; y += c[1]; }
  return [x / poly.length, y / poly.length];
}

async function bdforet(bb) {
  const url = `${WFS}?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature` +
    `&TYPENAMES=LANDCOVER.FORESTINVENTORY.V2:formation_vegetale&SRSNAME=EPSG:4326` +
    `&BBOX=${bb[0]},${bb[1]},${bb[2]},${bb[3]},EPSG:4326&OUTPUTFORMAT=application/json&COUNT=20000`;
  const j = await (await fetch(url)).json();
  return j.features || [];
}

const fc = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const tally = { feuillu: 0, conifere: 0, mixte: 0, autre: 0 };

for (const f of fc.features) {
  const bb = bbox(f.geometry);
  let feats = [];
  try { feats = await bdforet(bb); } catch (e) { console.warn('  WFS échec', f.properties.nom, e.message); }
  const area = { feuillu: 0, conifere: 0, mixte: 0, autre: 0 };
  for (const bf of feats) {
    const cen = centroid(bf.geometry);
    if (!pointInGeom(cen, f.geometry)) continue;
    const cls = classify(bf.properties);
    const polys = bf.geometry.type === 'MultiPolygon' ? bf.geometry.coordinates : [bf.geometry.coordinates];
    area[cls] += polys.reduce((s, p) => s + ringArea(p[0]), 0);
  }
  const dom = Object.entries(area).sort((a, b) => b[1] - a[1])[0];
  f.properties.essence = dom[1] > 0 ? dom[0] : 'autre';
  tally[f.properties.essence]++;
  console.log(`  ${f.properties.nom.padEnd(42)} → ${f.properties.essence}`);
  await sleep(150);
}

fs.writeFileSync(FILE, JSON.stringify(fc));
console.log(`\nrépartition : ${JSON.stringify(tally)}  → ${path.relative(ROOT, FILE)}`);
