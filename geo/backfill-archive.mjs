/* Remplit data/archive/ avec l'historique météo ERA5 (Open-Meteo archive) pour la
 * grille courante, sur une plage d'années passées. Sert au calage du modèle.
 *
 *   node geo/backfill-archive.mjs 2019 2025
 *
 * À lancer sur le VPS (l'archive y vit). Une passe : ~1 appel / lot de 80 mailles.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadDeps, buildGrid } from '../collect/lib.mjs';
import { append, missingDays, stats, VARS } from '../collect/archive.mjs';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../..');
const [y0, y1] = process.argv.slice(2).map(Number);
if (!y0 || !y1) { console.error('usage : node geo/backfill-archive.mjs <annéeDébut> <annéeFin>'); process.exit(1); }

const start = `${y0}-01-01`;
const end = `${y1}-12-31`;
const DAILY = 'precipitation_sum,et0_fao_evapotranspiration,temperature_2m_mean,temperature_2m_min,temperature_2m_max';
const KEYS = ['precipitation_sum', 'et0_fao_evapotranspiration', 'temperature_2m_mean', 'temperature_2m_min', 'temperature_2m_max'];
const sleep = ms => new Promise(r => setTimeout(r, ms));

const grid = buildGrid(loadDeps(ROOT));
console.log(`${grid.length} mailles · ${start} → ${end}`);
const ids = grid.map(p => p.id);
const need = missingDays(ids, start, end);
if (!need.length) { console.log('déjà complet'); process.exit(0); }
console.log(`${need.length} jours à récupérer`);

for (let i = 0; i < grid.length; i += 80) {
  const chunk = grid.slice(i, i + 80);
  const lat = chunk.map(p => p.lat).join(','), lon = chunk.map(p => p.lon).join(',');
  const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}` +
    `&daily=${DAILY}&start_date=${start}&end_date=${end}&timezone=Europe%2FParis`;
  let arr;
  for (let a = 0; a < 5; a++) {
    try {
      const j = await (await fetch(url)).json();
      if (j?.error) { if (/limit/i.test(j.reason)) { await sleep(62000); continue; } throw new Error(j.reason); }
      arr = Array.isArray(j) ? j : [j]; break;
    } catch (e) { if (a === 4) throw e; await sleep(5000); }
  }
  const obs = {};
  chunk.forEach((p, idx) => {
    const o = arr[idx]; if (!o?.daily) return;
    obs[p.id] = { lat: p.lat, lon: p.lon, dep: p.dep, elev: Math.round(o.elevation), time: o.daily.time };
    VARS.forEach((v, vi) => obs[p.id][v] = o.daily[KEYS[vi]]);
  });
  append(obs);
  process.stdout.write(`\r  ${Math.min(i + 80, grid.length)}/${grid.length}`);
  await sleep(1500);
}
process.stdout.write('\n');
const s = stats();
console.log(`archive : ${s.mois} mois (${s.premier} → ${s.dernier}), ${s.Mo} Mo`);
