/* Calage à partir des observations terrain envoyées depuis l'appli
 * (data/observations.jsonl, alimenté par POST /api/observ dans serve.mjs).
 *
 *   node geo/observations.mjs            # toutes espèces
 *   node geo/observations.mjs cepe girolle
 *
 * Pour chaque observation « trouvé », rejoue le score de l'espèce à la maille la
 * plus proche et à la date indiquée ; compare aux observations « rien vu » et à
 * des pseudo-absences au hasard. Nécessite l'archive météo (backfill-archive).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadDeps, buildGrid } from '../collect/lib.mjs';
import { assemble } from '../collect/archive.mjs';
import { deriveSeries, scoreSpecies, SPECIES } from '../model/model.mjs';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../..');
const FILE = path.join(ROOT, 'data/observations.jsonl');
const only = process.argv.slice(2);

if (!fs.existsSync(FILE)) { console.log('aucune observation (data/observations.jsonl absent)'); process.exit(0); }
const obs = fs.readFileSync(FILE, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
console.log(`${obs.length} observations`);

const grid = buildGrid(loadDeps(ROOT));
const nearest = (lat, lon) => grid.reduce((b, c) => {
  const d = (c.lat - lat) ** 2 + (c.lon - lon) ** 2;
  return d < b.d ? { c, d } : b;
}, { d: Infinity }).c;

const q = (a, f) => a.slice().sort((x, y) => x - y)[Math.floor(f * (a.length - 1))] ?? 0;

function scoreOf(sp, lat, lon, date) {
  const c = nearest(lat, lon);
  const s0 = new Date(Date.parse(date) - 110 * 86400000).toISOString().slice(0, 10);
  const ser = assemble([c.id], s0, date)[c.id];
  if (!ser || ser.time.length < 40 || ser.precip.every(x => x === 0)) return null;
  deriveSeries(ser);
  return scoreSpecies(sp, ser, ser.time.length - 1).value ?? 0;
}

const species = [...new Set(obs.map(o => o.espece).filter(Boolean))];
for (const sp of species) {
  if (only.length && !only.includes(sp)) continue;
  if (!SPECIES[sp]) continue;
  const found = [], empty = [];
  for (const o of obs) {
    if (o.espece !== sp) continue;
    if (!SPECIES[sp].saison.includes(+o.date.slice(5, 7))) continue;
    const v = scoreOf(sp, o.lat, o.lon, o.date);
    if (v == null) continue;
    (o.resultat === 'rien' ? empty : found).push(v);
  }
  // pseudo-absences
  const rand = [];
  const years = [...new Set(obs.filter(o => o.espece === sp).map(o => +o.date.slice(0, 4)))];
  for (let i = 0; i < 300 && years.length; i++) {
    const c = grid[(Math.random() * grid.length) | 0];
    const yr = years[(Math.random() * years.length) | 0];
    const mo = SPECIES[sp].saison[(Math.random() * SPECIES[sp].saison.length) | 0];
    const day = `${yr}-${String(mo).padStart(2, '0')}-${String(1 + ((Math.random() * 27) | 0)).padStart(2, '0')}`;
    const v = scoreOf(sp, c.lat, c.lon, day);
    if (v != null) rand.push(v);
  }

  console.log(`\n=== ${SPECIES[sp].nom} ===`);
  if (!found.length) { console.log('  pas encore d\'observation « trouvé » exploitable'); continue; }
  console.log(`  trouvé (${found.length})   : méd ${q(found, .5).toFixed(0)}  [${q(found, .25).toFixed(0)}–${q(found, .75).toFixed(0)}]`);
  if (empty.length) console.log(`  rien vu (${empty.length})  : méd ${q(empty, .5).toFixed(0)}  [${q(empty, .25).toFixed(0)}–${q(empty, .75).toFixed(0)}]`);
  if (rand.length) console.log(`  au hasard (${rand.length}): méd ${q(rand, .5).toFixed(0)}`);
  const ref = empty.length >= 5 ? q(empty, .5) : q(rand, .5);
  const above = found.filter(v => v > ref).length / found.length;
  console.log(`  → ${(above * 100).toFixed(0)} % des « trouvé » au-dessus de la médiane de référence`);
}
