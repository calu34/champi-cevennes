/* Orchestrateur — point d'entrée de la tâche planifiée.
 *
 *   node collect/run.mjs                 # source par défaut (CHAMPI_SOURCE ou 'proxy')
 *   CHAMPI_SOURCE=antilope node collect/run.mjs
 *
 * Produit  web/data.js  (consommé par la carte) et met à jour  data/store/series.json.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CFG } from './config.mjs';
import { loadDeps, buildGrid, todayISO, isoAdd, readJSON, writeJSON } from './lib.mjs';
import { fetchProxy } from './openmeteo.mjs';
import { deriveSeries, scoreSpecies, SPECIES_LIST } from '../model/model.mjs';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../..');
const R = p => path.join(ROOT, p);
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

const VARS = ['precip', 'et0', 'tmean', 'tmin', 'tmax'];

async function main() {
  const start = isoAdd(todayISO(), -CFG.window);
  const end = isoAdd(todayISO(), CFG.forecastDays);
  log(`fenêtre ${start} → ${end}  · source=${CFG.source}`);

  const deps = loadDeps(ROOT);
  const grid = buildGrid(deps);
  log(`${grid.length} mailles sur ${CFG.departements.join(', ')}`);

  // 1. météo de base (pluie proxy + T°/ET0) sur toute la fenêtre
  log('Open-Meteo…');
  const proxy = await fetchProxy(grid, start, end, {
    onProgress: (d, t) => process.stdout.write(`\r  ${d}/${t}`),
  });
  process.stdout.write('\n');
  const anyPoint = [...proxy.values()][0];
  if (!anyPoint) throw new Error('aucune donnée Open-Meteo reçue');
  const days = anyPoint.time.slice();

  // structure série par point, alignée sur `days`
  const series = {};
  for (const p of grid) {
    const o = proxy.get(p.id);
    if (!o) continue;
    series[p.id] = { lat: p.lat, lon: p.lon, dep: p.dep, elev: o.elev, time: days };
    for (const v of VARS) series[p.id][v] = o[v];
  }

  // 2. si source ANTILOPE : remplacer la pluie des jours COMPLETS par la lame d'eau radar
  //    (cumul des passes 5 min faites par collect/poller.mjs). Jours incomplets → proxy.
  let source = 'proxy';
  if (CFG.source === 'antilope') {
    const radarDir = R(CFG.paths.store + '/radar');
    const MIN_SLOTS = 258;         // ~90 % de 288 passes / jour
    const MAX_MISS = 30;           // trous radar tolérés par maille / jour
    let jm = 0; const daysUsed = [];
    for (let i = 0; i < days.length; i++) {
      const acc = readJSON(path.join(radarDir, `${days[i]}.json`), null);
      const nSlots = Math.max(acc?.buckets?.length || 0, acc?.slots?.length || 0);
      if (!acc || nSlots < MIN_SLOTS) continue;
      for (const p of grid) {
        const s = series[p.id]; if (!s) continue;
        if ((acc.missing?.[p.id] || 0) > MAX_MISS) continue;
        if (acc.mm?.[p.id] != null) { s.precip[i] = acc.mm[p.id]; jm++; }
      }
      daysUsed.push(days[i]);
    }
    source = jm ? `antilope+proxy (radar : ${daysUsed.length} j, ${jm} jours-mailles)` : 'proxy (aucun jour radar complet)';
    log(source);
  }

  // 3. persistance du store (pour l'accumulation ANTILOPE au fil des jours)
  writeJSON(R(CFG.paths.store + '/series.json'),
    { updated: new Date().toISOString(), source, days, points: series });

  // 4. habitat de maille : seule l'altitude (l'enrichissement essence/substrat/MNT
  //    est porté par la couche forêts, côté carte — voir geo/).
  for (const p of grid) { const s = series[p.id]; if (s) s.habitat = { elev: s.elev }; }

  // 5. contrôle : indices au dernier jour observé, par espèce
  const kToday = days.indexOf(todayISO());
  const kEval = kToday >= 0 ? kToday : days.length - 1;
  const fav = {};
  for (const s of Object.values(series)) deriveSeries(s);
  for (const sp of SPECIES_LIST) {
    let n = 0;
    for (const s of Object.values(series)) if ((scoreSpecies(sp.id, s, kEval).value ?? 0) > 40) n++;
    fav[sp.nom] = n;
  }
  log(`au ${todayISO()} — mailles > 40 : ` + Object.entries(fav).map(([k, v]) => `${k} ${v}`).join(', '));

  // 5b. garder web/model/ synchro avec model/ (la carte importe web/model/model.mjs)
  fs.cpSync(R('model'), R('web/model'), { recursive: true });

  // 6. sortie web
  const cells = Object.entries(series).map(([id, s]) => ({
    id, lat: s.lat, lon: s.lon, dep: s.dep, elev: s.elev, habitat: s.habitat,
    series: Object.fromEntries(VARS.map(v => [v, s[v].map(x => Math.round(x * 10) / 10)])),
  }));
  const js = 'window.CHAMPI=' + JSON.stringify({
    generated: new Date().toISOString(),
    source, days, gridStep: CFG.gridStep, departements: CFG.departements,
    habitatOpts: CFG.habitat, cells,
  }) + ';\n';
  fs.mkdirSync(path.dirname(R(CFG.paths.webData)), { recursive: true });
  fs.writeFileSync(R(CFG.paths.webData), js);
  log(`écrit ${CFG.paths.webData} (${(js.length / 1024).toFixed(0)} Ko, ${cells.length} mailles)`);
}

main().catch(e => { console.error('ÉCHEC:', e.message); process.exit(1); });
