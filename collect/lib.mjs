/* Utilitaires : chargement geojson départements, construction de grille, masque. */
import fs from 'node:fs';
import path from 'node:path';
import { CFG } from './config.mjs';

const DAY = 86400000;
export const todayISO = () => new Date().toLocaleDateString('sv-SE');   // YYYY-MM-DD, heure locale
export const isoAdd = (iso, n) => new Date(Date.parse(iso) + n * DAY).toISOString().slice(0, 10);
export const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / DAY);

/* --- point dans polygone (Polygon + MultiPolygon), coords [lon,lat] --- */
function pointInRing(pt, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if (((yi > pt[1]) !== (yj > pt[1])) &&
        (pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}
function pointInPolygon(pt, poly) {
  if (!pointInRing(pt, poly[0])) return false;
  for (let k = 1; k < poly.length; k++) if (pointInRing(pt, poly[k])) return false;
  return true;
}
export function pointInGeom(pt, geom) {
  if (!geom) return false;
  if (geom.type === 'Polygon') return pointInPolygon(pt, geom.coordinates);
  if (geom.type === 'MultiPolygon') return geom.coordinates.some(p => pointInPolygon(pt, p));
  return false;
}

export function loadDeps(rootDir) {
  const deps = {};
  for (const c of CFG.departements) {
    const p = path.join(rootDir, CFG.paths.depGeojson, `dep-${c}.geojson`);
    deps[c] = JSON.parse(fs.readFileSync(p, 'utf8'));
  }
  return deps;
}

/** grille de points {id,lat,lon,dep} masquée aux 6 départements */
export function buildGrid(deps) {
  const { bbox, gridStep: st } = CFG;
  const pts = [];
  for (let la = bbox.latMin; la <= bbox.latMax; la += st)
    for (let lo = bbox.lonMin; lo <= bbox.lonMax; lo += st) {
      const lat = +la.toFixed(4), lon = +lo.toFixed(4);
      let dep = null;
      for (const c of CFG.departements)
        if (pointInGeom([lon, lat], deps[c].geometry)) { dep = c; break; }
      if (dep) pts.push({ id: `${lat}_${lon}`, lat, lon, dep });
    }
  return pts;
}

export const readJSON = (f, fb = null) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : fb);
export function writeJSON(f, obj) {
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify(obj));
}
