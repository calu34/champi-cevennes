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
import { deriveSeries, scoreAt } from '../model/model.mjs';

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

  // 4. habitat : rattacher chaque maille à sa parcelle enrichie (si dispo)
  const parcels = readJSON(R(CFG.paths.parcels), null);
  const habOpts = CFG.habitat;
  for (const p of grid) {
    const s = series[p.id]; if (!s) continue;
    s.habitat = habitatFor(p, s.elev, parcels);
  }

  // 5. contrôle : indices au dernier jour observé
  const kToday = days.indexOf(todayISO());
  let favC = 0, favG = 0;
  for (const id of Object.keys(series)) {
    const s = series[id];
    deriveSeries(s, CFG.model);
    const sc = scoreAt(s, kToday >= 0 ? kToday : days.length - 1, CFG.model);
    if (sc.cepe > 40) favC++;
    if (sc.girolle > 40) favG++;
  }
  log(`au ${todayISO()} : ${favC} mailles cèpe>40, ${favG} girolle>40`);

  // 6. sortie web
  const cells = Object.entries(series).map(([id, s]) => ({
    id, lat: s.lat, lon: s.lon, dep: s.dep, elev: s.elev, habitat: s.habitat,
    series: Object.fromEntries(VARS.map(v => [v, s[v].map(x => Math.round(x * 10) / 10)])),
  }));
  const js = 'window.CHAMPI=' + JSON.stringify({
    generated: new Date().toISOString(),
    source, days, gridStep: CFG.gridStep, habitatOpts: habOpts, cells,
  }) + ';\n';
  fs.mkdirSync(path.dirname(R(CFG.paths.webData)), { recursive: true });
  fs.writeFileSync(R(CFG.paths.webData), js);
  log(`écrit ${CFG.paths.webData} (${(js.length / 1024).toFixed(0)} Ko, ${cells.length} mailles)`);
}

/* place-holder tant que la phase GIS n'est pas faite : seule l'altitude est connue */
function habitatFor(pt, elev, parcels) {
  const h = { elev, forest: null, essence: null, domaniale: null, substrat: null,
              slopeDeg: null, aspect: null, parcel: null };
  if (parcels?.features) {
    // TODO: point-in-polygon sur les parcelles ONF enrichies (phase habitat)
  }
  return h;
}

main().catch(e => { console.error('ÉCHEC:', e.message); process.exit(1); });
