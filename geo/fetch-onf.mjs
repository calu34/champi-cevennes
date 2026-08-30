/* Récupère les forêts DOMANIALES ONF des 6 départements (WFS Géoplateforme)
 * et écrit web/assets/data/forets-domaniales.geojson.
 *
 *   node geo/fetch-onf.mjs
 *
 * Source : ONF.FORETS_PUBLIQUES (Licence Ouverte). Attribut cdom_frt = 'OUI' → domaniale.
 * À relancer seulement si le périmètre des forêts change (rare) — la sortie est versionnée.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../..');
const DEPS = ['07', '12', '30', '34', '48', '81'];
const OUT = path.join(ROOT, 'web/assets/data/forets-domaniales.geojson');
const WFS = 'https://data.geopf.fr/wfs/ows';

const round = (x, n = 4) => Math.round(x * 10 ** n) / 10 ** n;
const TOL = 0.0009;   // ~90 m — largement assez pour afficher des massifs

// Douglas-Peucker sur un anneau [[lon,lat],...]
function simplifyRing(pts, tol) {
  if (pts.length < 5) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  const d2 = (p, a, b) => {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1);
    const cx = a[0] + Math.max(0, Math.min(1, t)) * dx, cy = a[1] + Math.max(0, Math.min(1, t)) * dy;
    return (p[0] - cx) ** 2 + (p[1] - cy) ** 2;
  };
  while (stack.length) {
    const [i, j] = stack.pop();
    let maxD = 0, idx = -1;
    for (let k = i + 1; k < j; k++) { const dd = d2(pts[k], pts[i], pts[j]); if (dd > maxD) { maxD = dd; idx = k; } }
    if (maxD > tol * tol) { keep[idx] = 1; stack.push([i, idx], [idx, j]); }
  }
  const out = pts.filter((_, k) => keep[k]);
  return out.length >= 4 ? out : pts;
}

// garde l'anneau extérieur de chaque polygone, simplifié + arrondi
function cleanGeom(g) {
  const polys = g.type === 'MultiPolygon' ? g.coordinates : [g.coordinates];
  const kept = [];
  for (const poly of polys) {
    let ring = simplifyRing(poly[0], TOL).map(c => [round(c[0]), round(c[1])]);
    // aire approx (shoelace, deg²) — vire les miettes < ~4 ha
    let a = 0; for (let k = 0; k < ring.length - 1; k++) a += ring[k][0] * ring[k + 1][1] - ring[k + 1][0] * ring[k][1];
    if (Math.abs(a) / 2 > 3e-6 && ring.length >= 4) kept.push([ring]);
  }
  return kept.length === 1 ? { type: 'Polygon', coordinates: kept[0] }
    : { type: 'MultiPolygon', coordinates: kept };
}

const feats = [];
for (const dep of DEPS) {
  const url = `${WFS}?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature` +
    `&TYPENAMES=ONF.FORETS_PUBLIQUES:ONF_FORETS_PUBLIQUES&SRSNAME=EPSG:4326` +
    `&CQL_FILTER=${encodeURIComponent(`cinse_dep='${dep}'`)}` +
    `&OUTPUTFORMAT=application/json&COUNT=5000`;
  const j = await (await fetch(url)).json();
  const dom = j.features.filter(f => f.properties.cdom_frt === 'OUI');
  for (const f of dom) {
    feats.push({
      type: 'Feature',
      properties: { id: f.properties.iidtn_frt, nom: f.properties.llib_frt, dep },
      geometry: cleanGeom(f.geometry),
    });
  }
  console.log(`  ${dep} : ${dom.length} forêts domaniales / ${j.features.length} forêts publiques`);
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify({ type: 'FeatureCollection', features: feats }));
console.log(`\n${feats.length} forêts domaniales → ${path.relative(ROOT, OUT)} (${(fs.statSync(OUT).size / 1024).toFixed(0)} Ko)`);
