/* Archive météo complète, append-only : data/archive/<YYYY-MM>.json
 *   { month, updated, cells: { id: { lat,lon,dep,elev,
 *       d: { "YYYY-MM-DD": [precip, et0, tmean, tmin, tmax] } } } }
 *
 * Mémoire longue : truffe (été → hiver), morille (sortie d'hiver), et calage du
 * modèle sur observations passées (GBIF / iNaturalist).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const VARS = ['precip', 'et0', 'tmean', 'tmin', 'tmax'];
const ROOT = path.resolve(fileURLToPath(import.meta.url), '../..');
const DIR = path.join(ROOT, 'data/archive');
const monthOf = iso => iso.slice(0, 7);
const fileOf = m => path.join(DIR, `${m}.json`);
const _cache = {};
const load = m => (_cache[m] ??= fs.existsSync(fileOf(m))
  ? JSON.parse(fs.readFileSync(fileOf(m), 'utf8'))
  : { month: m, updated: null, cells: {} });
function save(m) {
  fs.mkdirSync(DIR, { recursive: true });
  _cache[m].updated = new Date().toISOString();
  fs.writeFileSync(fileOf(m), JSON.stringify(_cache[m]));
}

export function dateRange(a, b) {
  const out = []; let d = a;
  while (d <= b) { out.push(d); d = new Date(Date.parse(d) + 86400000).toISOString().slice(0, 10); }
  return out;
}

/** jours de [start,end] absents de l'archive pour au moins une maille de `ids` */
export function missingDays(ids, start, end) {
  const miss = [];
  for (const d of dateRange(start, end)) {
    const a = load(monthOf(d));
    const ok = ids.every(id => a.cells[id]?.d?.[d] != null);
    if (!ok) miss.push(d);
  }
  return miss;
}

/** obs = { id: { time:[ISO], precip:[], et0:[], tmean:[], tmin:[], tmax:[], lat,lon,dep,elev } } */
export function append(obs) {
  const touched = new Set();
  for (const [id, o] of Object.entries(obs)) {
    o.time.forEach((day, i) => {
      const m = monthOf(day); const a = load(m); touched.add(m);
      const c = a.cells[id] ??= { lat: o.lat, lon: o.lon, dep: o.dep, elev: o.elev, d: {} };
      c.lat ??= o.lat; c.lon ??= o.lon; c.dep ??= o.dep; c.elev ??= o.elev;
      c.d[day] = VARS.map(v => {
        const x = o[v]?.[i];
        return x == null ? null : Math.round(x * 100) / 100;
      });
    });
  }
  for (const m of touched) save(m);
}

/** remplace la pluie (indice 0) d'un jour — lame d'eau radar */
export function setPrecip(day, byId) {
  const m = monthOf(day); const a = load(m);
  let n = 0;
  for (const [id, mm] of Object.entries(byId)) {
    const row = a.cells[id]?.d?.[day];
    if (row && mm != null) { row[0] = Math.round(mm * 100) / 100; n++; }
  }
  if (n) save(m);
  return n;
}

/** série continue [start,end] par maille. null → 0 (pluie/et0) ou dernière valeur (T°) */
export function assemble(ids, start, end) {
  const days = dateRange(start, end);
  const out = {};
  for (const id of ids) out[id] = { time: days, ...Object.fromEntries(VARS.map(v => [v, new Array(days.length).fill(null)])) };
  days.forEach((day, k) => {
    const a = load(monthOf(day));
    for (const id of ids) {
      const c = a.cells[id]; if (!c) continue;
      const o = out[id];
      o.lat ??= c.lat; o.lon ??= c.lon; o.dep ??= c.dep; o.elev ??= c.elev;
      const row = c.d[day];
      if (row) VARS.forEach((v, vi) => { o[v][k] = row[vi]; });
    }
  });
  for (const o of Object.values(out)) {
    for (const v of VARS) {
      let last = v[0] === 't' ? 10 : 0;
      for (let i = 0; i < o[v].length; i++) {
        if (o[v][i] == null) o[v][i] = v[0] === 't' ? last : 0;
        else last = o[v][i];
      }
    }
  }
  return out;
}

export function stats() {
  if (!fs.existsSync(DIR)) return { mois: 0 };
  const files = fs.readdirSync(DIR).filter(f => f.endsWith('.json')).sort();
  let bytes = 0; for (const f of files) bytes += fs.statSync(path.join(DIR, f)).size;
  return { mois: files.length, premier: files[0]?.slice(0, 7), dernier: files.at(-1)?.slice(0, 7), Mo: +(bytes / 1e6).toFixed(1) };
}
