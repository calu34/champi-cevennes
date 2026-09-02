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

const isLimit = r => /limit/i.test(r || '');
const isDaily = r => /da(y|ily)/i.test(r || '');   // "Daily API request limit exceeded"

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
const BATCH = 12;                 // petit lot : l'API archive « pèse » lourd (1 an × 5 var)
let gap = 7000;                   // pause entre lots, s'allonge si on tape la limite/minute
console.log(`${need.length} jours à récupérer — par année, lots de ${BATCH} mailles`);
const ts = () => new Date().toISOString().slice(11, 19);

function bail() {
  process.stdout.write('\n');
  const st = stats();
  console.log(`⏸  ${ts()} limite journalière Open-Meteo atteinte. Archive : ${st.mois} mois (${st.premier} → ${st.dernier}).`);
  console.log('   Relance la même commande demain — elle reprendra exactement où elle s\'est arrêtée.');
  process.exit(0);
}

for (let yr = y0; yr <= y1; yr++) {
  const a = `${yr}-01-01`, b = yr === y1 && end < `${yr}-12-31` ? end : `${yr}-12-31`;
  for (let i = 0; i < grid.length; i += BATCH) {
    // ne demander que les mailles dont l'année n'est pas déjà complète (reprise fine)
    const chunk = grid.slice(i, i + BATCH).filter(p => missingDays([p.id], a, b).length);
    process.stdout.write(`\r  ${yr} · ${Math.min(i + BATCH, grid.length)}/${grid.length}   `);
    if (!chunk.length) continue;
    const lat = chunk.map(p => p.lat).join(','), lon = chunk.map(p => p.lon).join(',');
    const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}` +
      `&daily=${DAILY}&start_date=${a}&end_date=${b}&timezone=Europe%2FParis`;
    // patience croissante : 70 s (minute) ×3, 6 min, 15 min, 30 min ×2, sinon = limite jour
    const waits = [70000, 70000, 70000, 360000, 900000, 1800000, 1800000];
    let arr;
    for (let k = 0; k <= waits.length; k++) {
      try {
        const j = await (await fetch(url)).json();
        if (j?.error) {
          if (isLimit(j.reason)) {
            if (isDaily(j.reason) || k === waits.length) bail();
            if (k <= 2) gap = Math.min(gap + 2000, 20000);   // on ralentit le rythme
            console.log(`\n   ${ts()} ${j.reason} — pause ${waits[k] / 1000}s (essai ${k + 1})`);
            await sleep(waits[k]); continue;
          }
          if (/too much data/i.test(j.reason) && chunk.length > 4) { throw Object.assign(new Error('split'), { split: true }); }
          throw new Error(j.reason);
        }
        arr = Array.isArray(j) ? j : [j]; break;
      } catch (e) { if (e.split || k === waits.length) throw e; await sleep(4000); }
    }
    if (!arr) { console.error('\néchec du lot, on saute'); continue; }
    const obs = {};
    chunk.forEach((p, idx) => {
      const o = arr[idx]; if (!o?.daily) return;
      obs[p.id] = { lat: p.lat, lon: p.lon, dep: p.dep, elev: Math.round(o.elevation), time: o.daily.time };
      VARS.forEach((v, vi) => obs[p.id][v] = o.daily[KEYS[vi]]);
    });
    append(obs);
    process.stdout.write(`\r  ${yr} · ${Math.min(i + BATCH, grid.length)}/${grid.length}   `);
    await sleep(gap);
  }
}
process.stdout.write('\n');
const s = stats();
console.log(`archive : ${s.mois} mois (${s.premier} → ${s.dernier}), ${s.Mo} Mo`);
