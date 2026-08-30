/* Calage du modèle : rejoue les indices sur les observations passées (GBIF) et
 * compare aux "pseudo-absences" (points/dates au hasard, en saison, loin des obs).
 * Un bon modèle → scores nettement plus hauts aux observations.
 *
 *   node geo/calage.mjs                 # cèpe + girolle sur la zone couverte
 *   node geo/calage.mjs cepe            # une espèce
 *
 * Nécessite une archive météo couvrant les années des observations
 * (node geo/backfill-archive.mjs 2019 2025).
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadDeps, buildGrid } from '../collect/lib.mjs';
import { depsBbox } from '../collect/lib.mjs';
import { assemble } from '../collect/archive.mjs';
import { deriveSeries, scoreSpecies, SPECIES } from '../model/model.mjs';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../..');
const GBIF_KEY = { cepe: 5954958, girolle: 5249504, truffe: 5258468, morille: 2594601 };
const only = process.argv.slice(2);

const grid = buildGrid(loadDeps(ROOT));
const bb = depsBbox(loadDeps(ROOT));
const nearest = (lat, lon) => grid.reduce((b, c) => {
  const d = (c.lat - lat) ** 2 + (c.lon - lon) ** 2;
  return d < b.d ? { c, d } : b;
}, { d: Infinity }).c;

async function gbif(key, page) {
  const u = `https://api.gbif.org/v1/occurrence/search?taxonKey=${key}&country=FR&hasCoordinate=true` +
    `&decimalLatitude=${bb.latMin},${bb.latMax}&decimalLongitude=${bb.lonMin},${bb.lonMax}` +
    `&limit=300&offset=${page * 300}`;
  return (await (await fetch(u)).json());
}

const q = (a, f) => a.slice().sort((x, y) => x - y)[Math.floor(f * (a.length - 1))] ?? 0;

for (const sp of Object.keys(SPECIES)) {
  if (only.length && !only.includes(sp)) continue;
  const key = GBIF_KEY[sp];
  // 1. observations
  const obs = [];
  for (let p = 0; p < 10; p++) {
    const j = await gbif(key, p);
    for (const r of j.results) {
      const d = r.eventDate?.slice(0, 10);
      if (!d || !/^\d{4}-\d\d-\d\d$/.test(d) || r.decimalLatitude == null) continue;
      obs.push({ date: d, lat: r.decimalLatitude, lon: r.decimalLongitude, m: +d.slice(5, 7) });
    }
    if (j.endOfRecords) break;
  }
  const inSeason = obs.filter(o => SPECIES[sp].saison.includes(o.m));

  // 2. scores aux observations
  const cellIds = [...new Set(inSeason.map(o => nearest(o.lat, o.lon).id))];
  const scoreAtObs = [];
  for (const o of inSeason) {
    const c = nearest(o.lat, o.lon);
    const s0 = new Date(Date.parse(o.date) - 105 * 86400000).toISOString().slice(0, 10);
    const ser = assemble([c.id], s0, o.date)[c.id];
    if (ser.time.length < 40 || ser.precip.every(x => x === 0)) continue;   // archive absente
    deriveSeries(ser);
    scoreAtObs.push(scoreSpecies(sp, ser, ser.time.length - 1).value ?? 0);
  }

  // 3. pseudo-absences : mailles/dates au hasard en saison
  const scoreRandom = [];
  const years = [...new Set(inSeason.map(o => +o.date.slice(0, 4)))];
  for (let i = 0; i < 400 && years.length; i++) {
    const c = grid[(Math.random() * grid.length) | 0];
    const yr = years[(Math.random() * years.length) | 0];
    const mo = SPECIES[sp].saison[(Math.random() * SPECIES[sp].saison.length) | 0];
    const day = `${yr}-${String(mo).padStart(2, '0')}-${String(1 + ((Math.random() * 27) | 0)).padStart(2, '0')}`;
    const s0 = new Date(Date.parse(day) - 105 * 86400000).toISOString().slice(0, 10);
    const ser = assemble([c.id], s0, day)[c.id];
    if (ser.time.length < 40 || ser.precip.every(x => x === 0)) continue;
    deriveSeries(ser);
    scoreRandom.push(scoreSpecies(sp, ser, ser.time.length - 1).value ?? 0);
  }

  // 4. rapport
  const nm = SPECIES[sp].nom;
  if (!scoreAtObs.length) { console.log(`\n${nm} : ${inSeason.length} obs en saison, mais archive météo absente → backfill d'abord`); continue; }
  const above = scoreRandom.length
    ? scoreAtObs.filter(v => v > q(scoreRandom, 0.5)).length / scoreAtObs.length : 0;
  console.log(`\n=== ${nm} ===`);
  console.log(`obs GBIF : ${obs.length} (${inSeason.length} en saison, ${scoreAtObs.length} avec météo)`);
  console.log(`  score aux obs      : méd ${q(scoreAtObs, .5).toFixed(0)}  [${q(scoreAtObs, .25).toFixed(0)}–${q(scoreAtObs, .75).toFixed(0)}]  p90 ${q(scoreAtObs, .9).toFixed(0)}`);
  console.log(`  score au hasard    : méd ${q(scoreRandom, .5).toFixed(0)}  [${q(scoreRandom, .25).toFixed(0)}–${q(scoreRandom, .75).toFixed(0)}]`);
  console.log(`  → ${(above * 100).toFixed(0)} % des obs au-dessus de la médiane "au hasard"  (50 % = modèle nul, >70 % = bon signal)`);
}
