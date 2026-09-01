/* Orchestrateur — point d'entrée de la tâche quotidienne.
 *
 *   node collect/run.mjs
 *   CHAMPI_SOURCE=antilope node collect/run.mjs
 *
 * - récupère les jours récents (Open-Meteo) + la lame d'eau radar
 * - les ajoute à l'archive complète  data/archive/<mois>.json
 * - assemble la série longue nécessaire aux espèces (truffe : été → hiver)
 * - écrit  web/data.js  pour la carte
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CFG } from './config.mjs';
import { loadDeps, buildGrid, elevations, todayISO, isoAdd, readJSON } from './lib.mjs';
import { fetchProxy } from './openmeteo.mjs';
import { append, setPrecip, assemble, missingDays, stats, VARS } from './archive.mjs';
import { deriveSeries, scoreSpecies, SPECIES_LIST } from '../model/model.mjs';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../..');
const R = p => path.join(ROOT, p);
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

async function main() {
  const today = todayISO();
  const end = isoAdd(today, CFG.forecastDays);

  // fenêtre longue à assembler : couvre la plus longue fenêtre espèce (~100 j)
  // ET tout l'été concerné pour la truffe (1er juin de l'été de référence).
  const m = +today.slice(5, 7), y = +today.slice(0, 4);
  const summerStart = `${m <= 5 ? y - 1 : y}-06-01`;
  const assembleStart = [isoAdd(today, -105), summerStart].sort()[0];

  const deps = loadDeps(ROOT);
  const grid = buildGrid(deps);
  const ids = grid.map(p => p.id);

  // grille météo (Open-Meteo). Plus grossière que la grille de score sur grande
  // emprise (quota) : la pluie vient alors du radar, Open-Meteo ne sert qu'aux T°/ET0.
  const meteoStep = +(process.env.CHAMPI_METEOSTEP || CFG.meteoGridStep || CFG.gridStep);
  const coarse = meteoStep > CFG.gridStep + 1e-9;
  const meteoGrid = coarse ? buildGrid(deps, meteoStep) : grid;
  log(`${grid.length} mailles${coarse ? ` (météo sur ${meteoGrid.length} pts à ${meteoStep}°)` : ''} · depuis ${assembleStart} · source=${CFG.source}`);

  // 1. jours à récupérer : les 8 derniers + prévision, + trous de l'archive
  const recentStart = isoAdd(today, -8);
  const gaps = missingDays(ids, assembleStart, isoAdd(today, -9));
  const fetchFrom = gaps.length ? gaps[0] : recentStart;
  log(`Open-Meteo ${fetchFrom} → ${end}` + (gaps.length ? `  (+${gaps.length} j de rattrapage)` : ''));
  const proxy = await fetchProxy(meteoGrid, fetchFrom, end, {
    onProgress: (d, t) => process.stdout.write(`\r  ${d}/${t}`),
  });
  process.stdout.write('\n');
  if (![...proxy.values()][0]) throw new Error('aucune donnée Open-Meteo');

  // 2. construire les observations par maille de score
  const obs = {};
  if (coarse) {
    const elev = await elevations(grid, R('data/store/elev.json'));
    const nn = (lat, lon) => meteoGrid.reduce((b, c) => {
      const d = (c.lat - lat) ** 2 + (c.lon - lon) ** 2; return d < b.d ? { c, d } : b;
    }, { d: Infinity }).c;
    for (const p of grid) {
      const mc = proxy.get(nn(p.lat, p.lon).id); if (!mc) continue;
      const e = elev[p.id] ?? mc.elev;
      const dT = -0.0065 * (e - mc.elev);                    // correction gradient adiabatique
      obs[p.id] = { lat: p.lat, lon: p.lon, dep: p.dep, elev: e, time: mc.time };
      obs[p.id].precip = mc.precip; obs[p.id].et0 = mc.et0;
      obs[p.id].tmean = mc.tmean.map(x => x + dT);
      obs[p.id].tmin = mc.tmin.map(x => x + dT);
      obs[p.id].tmax = mc.tmax.map(x => x + dT);
    }
  } else {
    for (const p of grid) {
      const o = proxy.get(p.id); if (!o) continue;
      obs[p.id] = { lat: p.lat, lon: p.lon, dep: p.dep, elev: o.elev, time: o.time };
      for (const v of VARS) obs[p.id][v] = o[v];
    }
  }
  append(obs);

  // 3. lame d'eau radar : remplace la pluie des jours COMPLETS dans l'archive
  let source = 'proxy';
  if (CFG.source === 'antilope') {
    const radarDir = R(CFG.paths.store + '/radar');
    const MIN_SLOTS = 258, MAX_MISS = 30;
    let jm = 0, dj = 0;
    for (let i = 0; i <= 40; i++) {
      const day = isoAdd(today, -i);
      const acc = readJSON(path.join(radarDir, `${day}.json`), null);
      const n = Math.max(acc?.buckets?.length || 0, acc?.slots?.length || 0);
      if (!acc || n < MIN_SLOTS) continue;
      const byId = {};
      for (const id of ids) {
        if ((acc.missing?.[id] || 0) > MAX_MISS) continue;
        if (acc.mm?.[id] != null) byId[id] = acc.mm[id];
      }
      jm += setPrecip(day, byId); dj++;
    }
    source = jm ? `antilope+proxy (radar : ${dj} j, ${jm} jours-mailles)` : 'proxy (aucun jour radar complet)';
    log(source);
  }

  // 4. assembler la série longue depuis l'archive
  const series = assemble(ids, assembleStart, end);
  const days = series[ids[0]].time;
  for (const s of Object.values(series)) deriveSeries(s);

  // 5. contrôle : indices au jour J, par espèce
  const kEval = days.indexOf(today) >= 0 ? days.indexOf(today) : days.length - 1;
  const fav = {};
  for (const sp of SPECIES_LIST) {
    let n = 0;
    for (const s of Object.values(series)) if ((scoreSpecies(sp.id, s, kEval).value ?? 0) > 40) n++;
    fav[sp.nom] = n;
  }
  log(`au ${today} — mailles > 40 : ` + Object.entries(fav).map(([k, v]) => `${k} ${v}`).join(', '));
  const a = stats();
  log(`archive : ${a.mois} mois (${a.premier} → ${a.dernier}), ${a.Mo} Mo`);

  // 6. web/model synchro + sortie carte
  fs.cpSync(R('model'), R('web/model'), { recursive: true });

  // fenêtre expédiée à la carte : ~95 j glissants (curseur) ; la truffe a besoin
  // de tout l'été → on étend jusqu'à summerStart si on est dans sa saison.
  const truffeSaison = [9, 10, 11, 12, 1, 2, 3].includes(m);
  const shipStart = truffeSaison ? assembleStart : isoAdd(today, -95);
  const i0 = Math.max(0, days.indexOf(shipStart) < 0 ? 0 : days.indexOf(shipStart));
  const shipDays = days.slice(i0);
  const cells = Object.entries(series).map(([id, s]) => ({
    id, lat: s.lat, lon: s.lon, dep: s.dep, elev: Math.round(s.elev),
    habitat: { elev: Math.round(s.elev) },
    series: Object.fromEntries(VARS.map(v => [v, s[v].slice(i0).map(x => Math.round(x * 10) / 10)])),
  }));
  const payload = {
    schema: 1,
    generated: new Date().toISOString(), source, days: shipDays,
    gridStep: CFG.gridStep, departements: CFG.departements, habitatOpts: CFG.habitat, cells,
  };
  fs.mkdirSync(path.dirname(R(CFG.paths.webData)), { recursive: true });
  fs.writeFileSync(R(CFG.paths.webData), 'window.CHAMPI=' + JSON.stringify(payload) + ';\n');

  // --- API JSON (appli mobile / clients tiers) : voir MOBILE.md ---
  const apiDir = R('web/api');
  fs.mkdirSync(apiDir, { recursive: true });
  fs.writeFileSync(path.join(apiDir, 'latest.json'), JSON.stringify(payload));

  // instantané compact au jour J : meilleure espèce + scores météo par maille
  const kNow = days.indexOf(today) >= 0 ? days.indexOf(today) : days.length - 1;
  const now = {
    schema: 1, generated: payload.generated, source, day: days[kNow],
    especes: SPECIES_LIST.map(s => ({ id: s.id, nom: s.nom, saison: s.saison,
      enSaison: s.saison.includes(+today.slice(5, 7)) })),
    cells: Object.entries(series).map(([id, s]) => {
      const scores = {};
      for (const sp of SPECIES_LIST) scores[sp.id] = Math.round(scoreSpecies(sp.id, s, kNow).value ?? 0);
      const best = Object.entries(scores).reduce((a, b) => b[1] > a[1] ? b : a, ['', 0]);
      return { id, lat: s.lat, lon: s.lon, dep: s.dep, elev: Math.round(s.elev),
        scores, best: { id: best[0], v: best[1] } };
    }),
  };
  fs.writeFileSync(path.join(apiDir, 'now.json'), JSON.stringify(now));
  fs.writeFileSync(path.join(apiDir, 'meta.json'), JSON.stringify({
    schema: 1, generated: payload.generated, source,
    departements: CFG.departements, gridStep: CFG.gridStep, jours: shipDays.length,
    mailles: cells.length, especes: SPECIES_LIST.map(s => s.id),
    endpoints: { latest: 'api/latest.json', now: 'api/now.json', forets: 'assets/data/forets-publiques.geojson', brulis: 'assets/data/brulis.geojson' },
  }));

  const kb = (fs.statSync(R(CFG.paths.webData)).size / 1024).toFixed(0);
  const kbNow = (fs.statSync(path.join(apiDir, 'now.json')).size / 1024).toFixed(0);
  log(`écrit web/data.js (${kb} Ko) + api/{latest,now,meta}.json (now ${kbNow} Ko) — ${cells.length} mailles, ${shipDays.length} j`);
}

main().catch(e => { console.error('ÉCHEC:', e.message); process.exit(1); });
