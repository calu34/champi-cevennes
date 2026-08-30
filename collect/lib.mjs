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

/** emprise (bbox) = union des géométries départements */
export function depsBbox(deps) {
  let latMin = 90, latMax = -90, lonMin = 180, lonMax = -180;
  const walk = c => Array.isArray(c[0]) ? c.forEach(walk)
    : (lonMin = Math.min(lonMin, c[0]), lonMax = Math.max(lonMax, c[0]),
       latMin = Math.min(latMin, c[1]), latMax = Math.max(latMax, c[1]));
  for (const d of Object.values(deps)) walk(d.geometry.coordinates);
  return { latMin, latMax, lonMin, lonMax };
}

/** grille de points {id,lat,lon,dep} masquée aux départements de CFG.
 *  Points calés sur un réseau global (multiples de `step`) → identifiants STABLES
 *  quand on ajoute des départements ou change l'emprise. */
export function buildGrid(deps, step = CFG.gridStep) {
  const st = step;
  const bb = depsBbox(deps);
  const snap = (x, dir) => Math[dir](x / st) * st;
  const pts = [];
  for (let la = snap(bb.latMin, 'floor'); la <= bb.latMax; la += st)
    for (let lo = snap(bb.lonMin, 'floor'); lo <= bb.lonMax; lo += st) {
      const lat = +la.toFixed(4), lon = +lo.toFixed(4);
      let dep = null;
      for (const c of CFG.departements)
        if (pointInGeom([lon, lat], deps[c].geometry)) { dep = c; break; }
      if (dep) pts.push({ id: `${lat}_${lon}`, lat, lon, dep });
    }
  return pts;
}

/** altitude (m) de chaque point via l'API altimétrique Géoplateforme, cachée sur disque */
export async function elevations(pts, cacheFile) {
  const cache = cacheFile && fs.existsSync(cacheFile) ? JSON.parse(fs.readFileSync(cacheFile, 'utf8')) : {};
  const todo = pts.filter(p => cache[p.id] == null);
  for (let i = 0; i < todo.length; i += 180) {
    const b = todo.slice(i, i + 180);
    const u = 'https://data.geopf.fr/altimetrie/1.0/calcul/alti/rest/elevation.json' +
      `?lon=${b.map(p => p.lon.toFixed(5)).join('|')}&lat=${b.map(p => p.lat.toFixed(5)).join('|')}` +
      '&resource=ign_rge_alti_wld&zonly=true';
    try {
      const e = (await (await fetch(u)).json()).elevations;
      b.forEach((p, k) => { if (e?.[k] != null && e[k] > -1000) cache[p.id] = Math.round(e[k]); });
    } catch { /* on garde ce qu'on a */ }
    await new Promise(r => setTimeout(r, 200));
  }
  if (cacheFile) { fs.mkdirSync(path.dirname(cacheFile), { recursive: true }); fs.writeFileSync(cacheFile, JSON.stringify(cache)); }
  return cache;
}

export const readJSON = (f, fb = null) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : fb);
export function writeJSON(f, obj) {
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify(obj));
}
